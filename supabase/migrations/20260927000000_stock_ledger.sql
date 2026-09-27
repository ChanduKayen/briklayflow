-- ─────────────────────────────────────────────────────────────────────────────
-- STOCK LEDGER — goods received at site become stock.
--
-- Until now "received so far" was only ever derived (summing po_grn_items on read);
-- nothing recorded stock on hand. This adds an append-only movement ledger: every
-- GRN line received in GOOD condition writes one 'in' movement, keyed to the project.
-- On-hand per item/site is the running sum (in − out); issues/adjustments (out) can be
-- added later without changing this shape.
--
-- The write is hooked into create_grn (the one atomic receipt RPC) so a receipt and its
-- stock movement land together. Existing good receipts are backfilled once, idempotently.
--
-- ROLLBACK:
--   (restore create_grn from 20260518112514_create_grn_module.sql)
--   drop view if exists public.v_stock_on_hand;
--   drop table if exists public.stock_ledger;
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.stock_ledger (
  entry_id        uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  project_id      text not null,                         -- PRJ-… slug, matches po_grn.project_id
  item_name       text not null,
  unit            text,
  qty             numeric not null check (qty >= 0),     -- always positive; direction carries the sign
  direction       text not null check (direction in ('in','out')),
  kind            text not null default 'grn_receipt',   -- grn_receipt | issue | adjustment | return
  condition       text,                                  -- good | damaged | rejected (for a receipt)
  unit_rate       numeric,                               -- valuation at the movement
  ref_type        text,                                  -- 'grn' | 'issue' | …
  ref_id          text,                                  -- e.g. grn_id
  po_line_item_id uuid,
  note            text,
  created_by      uuid,
  created_at      timestamptz not null default now()
);

create index if not exists stock_ledger_site_item_idx on public.stock_ledger (org_id, project_id, lower(btrim(item_name)));
create index if not exists stock_ledger_ref_idx        on public.stock_ledger (ref_type, ref_id);

alter table public.stock_ledger enable row level security;
drop policy if exists "stock_ledger read" on public.stock_ledger;
create policy "stock_ledger read" on public.stock_ledger for select
  using (org_id in (select public.get_my_org_ids()));
-- Writes go through create_grn (SECURITY DEFINER) / future RPCs; no direct client insert policy.

-- On-hand per (site, item, unit): the running balance, with a display name and a stock value.
create or replace view public.v_stock_on_hand
with (security_invoker = true) as
select
  org_id,
  project_id,
  lower(btrim(item_name))                                              as item_key,
  max(item_name)                                                       as item_name,
  unit,
  coalesce(sum(qty) filter (where direction = 'in'), 0)
    - coalesce(sum(qty) filter (where direction = 'out'), 0)           as on_hand,
  coalesce(sum(qty) filter (where direction = 'in'), 0)               as total_in,
  coalesce(sum(qty) filter (where direction = 'out'), 0)              as total_out,
  coalesce(sum(qty * coalesce(unit_rate, 0)) filter (where direction = 'in'), 0)
    - coalesce(sum(qty * coalesce(unit_rate, 0)) filter (where direction = 'out'), 0) as stock_value,
  max(created_at)                                                      as last_movement_at
from public.stock_ledger
group by org_id, project_id, lower(btrim(item_name)), unit;

-- ── Recreate create_grn — same receipt insert, now ALSO writing a stock movement per
--    GOOD line (damaged/rejected are received but do not become usable stock). ──
create or replace function public.create_grn(
  p_org_id         uuid,
  p_po_id          text,
  p_project_id     text,
  p_stakeholder_id text,
  p_receipt_date   date,
  p_dc_number      text,
  p_vehicle_number text,
  p_driver_name    text,
  p_remarks        text,
  p_received_by    uuid,
  p_items          jsonb
) returns table (grn_id text, success boolean, error text)
language plpgsql security definer as $$
declare
  v_grn_id    text;
  v_item      jsonb;
  v_condition text;
  v_qty       numeric;
begin
  if p_org_id not in (select public.get_my_org_ids()) then
    return query select null::text, false, 'Access denied';
    return;
  end if;

  v_grn_id := public.generate_grn_id(p_org_id, p_project_id);

  insert into public.po_grn (
    grn_id, org_id, po_id, project_id, stakeholder_id, receipt_date,
    dc_number, vehicle_number, driver_name, remarks, received_by
  ) values (
    v_grn_id, p_org_id, p_po_id, p_project_id, p_stakeholder_id, p_receipt_date,
    p_dc_number, p_vehicle_number, p_driver_name, p_remarks, p_received_by
  );

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_condition := coalesce(nullif(v_item->>'condition', ''), 'good');
    v_qty       := (v_item->>'qty_received')::numeric;

    insert into public.po_grn_items (
      grn_id, org_id, po_line_item_id, item_name, unit,
      qty_ordered, qty_received, unit_rate, condition, remarks
    ) values (
      v_grn_id, p_org_id, nullif(v_item->>'po_line_item_id', '')::uuid,
      v_item->>'item_name', v_item->>'unit',
      (v_item->>'qty_ordered')::numeric, v_qty,
      nullif(v_item->>'unit_rate', '')::numeric, v_condition, nullif(v_item->>'remarks', '')
    );

    -- Goods received in good condition become stock on this site.
    if v_condition = 'good' and coalesce(v_qty, 0) > 0 then
      insert into public.stock_ledger (
        org_id, project_id, item_name, unit, qty, direction, kind, condition,
        unit_rate, ref_type, ref_id, po_line_item_id, created_by
      ) values (
        p_org_id, p_project_id, v_item->>'item_name', v_item->>'unit', v_qty, 'in', 'grn_receipt', 'good',
        nullif(v_item->>'unit_rate', '')::numeric, 'grn', v_grn_id, nullif(v_item->>'po_line_item_id', '')::uuid, p_received_by
      );
    end if;
  end loop;

  return query select v_grn_id, true, null::text;

exception when others then
  return query select null::text, false, sqlerrm;
end;
$$;

-- ── Backfill: every past GOOD receipt becomes a stock movement, once. ──
insert into public.stock_ledger (org_id, project_id, item_name, unit, qty, direction, kind, condition, unit_rate, ref_type, ref_id, po_line_item_id, created_by, created_at)
select g.org_id, g.project_id, i.item_name, i.unit, i.qty_received, 'in', 'grn_receipt', 'good', i.unit_rate, 'grn', g.grn_id, i.po_line_item_id, g.received_by, coalesce(g.created_at, now())
from public.po_grn_items i
join public.po_grn g on g.grn_id = i.grn_id
where coalesce(i.condition, 'good') = 'good' and coalesce(i.qty_received, 0) > 0
  and not exists (
    select 1 from public.stock_ledger s
    where s.ref_type = 'grn' and s.ref_id = g.grn_id
      and s.item_name = i.item_name and s.po_line_item_id is not distinct from i.po_line_item_id
  );

notify pgrst, 'reload schema';
