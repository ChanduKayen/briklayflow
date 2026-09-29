-- ─────────────────────────────────────────────────────────────────────────────
-- ASK FOR A COUNT / SNAPSHOT — reconcile stock to a physical count from the site.
--
-- Same shape as the receive link: the office taps "Ask for a count" (one material) or
-- "Ask for a snapshot" (the whole site) → create_count_token mints a link. The supervisor
-- opens it (public, /count/<token>), types what's actually on site, sends. count_token_submit
-- posts an 'adjustment' movement per material = counted − current, so on-hand becomes the
-- counted number, with the difference visible in the ledger. The token is the authority.
--
-- ROLLBACK:
--   drop function if exists public.count_token_submit(text,jsonb);
--   drop function if exists public.count_token_load(text);
--   drop function if exists public.create_count_token(uuid,text,uuid);
--   drop table if exists public.count_tokens;
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.count_tokens (
  token        text primary key,
  org_id       uuid not null,
  project_id   text not null,
  inventory_id uuid,                                   -- null = snapshot (every material on site)
  created_by   uuid,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '3 days',
  used_at      timestamptz
);
alter table public.count_tokens enable row level security;

create or replace function public.create_count_token(p_org_id uuid, p_project_id text, p_inventory_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tok text;
begin
  if p_org_id not in (select public.get_my_org_ids()) then return jsonb_build_object('ok', false, 'error', 'Access denied'); end if;
  v_tok := replace(gen_random_uuid()::text, '-', '');
  insert into public.count_tokens (token, org_id, project_id, inventory_id, created_by)
  values (v_tok, p_org_id, p_project_id, p_inventory_id, auth.uid());
  return jsonb_build_object('ok', true, 'token', v_tok);
end $$;
revoke execute on function public.create_count_token(uuid,text,uuid) from anon, public;
grant  execute on function public.create_count_token(uuid,text,uuid) to authenticated;

-- Public: the materials to count (name + unit; current on-hand hidden so the count is honest).
create or replace function public.count_token_load(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t record; v_site text; v_items jsonb;
begin
  select * into t from public.count_tokens where token = p_token;
  if t.token is null then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  if t.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'This link has expired.'); end if;
  select name into v_site from public.projects where project_id = t.project_id;

  select coalesce(jsonb_agg(x order by x->>'item_name'), '[]'::jsonb) into v_items from (
    select jsonb_build_object('inventory_id', s.inventory_id, 'item_name', coalesce(inv.display_name, max(s.item_name)), 'unit', coalesce(inv.unit, max(s.unit))) as x
    from public.stock_ledger s
    left join public.inventory_items inv on inv.inventory_id = s.inventory_id
    where s.org_id = t.org_id and s.project_id = t.project_id and s.inventory_id is not null
      and (t.inventory_id is null or s.inventory_id = t.inventory_id)
    group by s.inventory_id, inv.display_name, inv.unit
  ) q;

  return jsonb_build_object('ok', true, 'used', t.used_at is not null, 'site', v_site,
    'scope', case when t.inventory_id is null then 'snapshot' else 'one' end, 'items', v_items);
end $$;
revoke execute on function public.count_token_load(text) from public;
grant  execute on function public.count_token_load(text) to anon, authenticated;

-- Public: reconcile — post an 'adjustment' movement per counted material.
create or replace function public.count_token_submit(p_token text, p_counts jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t record; c jsonb; v_inv uuid; v_counted numeric; v_cur numeric; v_diff numeric; v_name text; v_unit text; v_n int := 0;
begin
  select * into t from public.count_tokens where token = p_token for update;
  if t.token is null then return jsonb_build_object('ok', false, 'error', 'This link is not valid.'); end if;
  if t.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'This link has expired.'); end if;
  if t.used_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;

  for c in select * from jsonb_array_elements(coalesce(p_counts, '[]'::jsonb)) loop
    v_inv := nullif(c->>'inventory_id', '')::uuid;
    v_counted := nullif(c->>'counted', '')::numeric;
    if v_inv is null or v_counted is null then continue; end if;
    select coalesce(sum(qty) filter (where direction = 'in'), 0) - coalesce(sum(qty) filter (where direction = 'out'), 0),
           max(item_name), max(unit)
      into v_cur, v_name, v_unit
      from public.stock_ledger where org_id = t.org_id and project_id = t.project_id and inventory_id = v_inv;
    v_diff := v_counted - coalesce(v_cur, 0);
    if abs(v_diff) > 0.0001 then
      insert into public.stock_ledger (org_id, project_id, item_name, unit, qty, direction, kind, note, ref_type, inventory_id, created_by)
      values (t.org_id, t.project_id, coalesce(c->>'item_name', v_name), coalesce(c->>'unit', v_unit), abs(v_diff),
              case when v_diff > 0 then 'in' else 'out' end, 'adjustment',
              'stock count · counted ' || v_counted || ', system had ' || coalesce(v_cur, 0), 'count', v_inv, t.created_by);
      v_n := v_n + 1;
    end if;
  end loop;

  update public.count_tokens set used_at = now() where token = p_token;
  return jsonb_build_object('ok', true, 'adjusted', v_n);
exception when others then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $$;
revoke execute on function public.count_token_submit(text,jsonb) from public;
grant  execute on function public.count_token_submit(text,jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
