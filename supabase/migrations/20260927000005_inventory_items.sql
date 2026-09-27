-- ─────────────────────────────────────────────────────────────────────────────
-- INVENTORY IDENTITY — an org-scoped material master (model B).
--
-- The global `sku_directory` is a shared, curated dictionary. This is different: a
-- per-ORG identity for the materials THIS builder actually transacts, built bottom-up
-- from bills/POs. Each row is one distinct material, identified by four buckets:
--   item · variant · dimension · grade      (category + unit are attributes, not identity)
-- with `aliases[]` = every raw vendor wording that has resolved here (the learning loop),
-- and an OPTIONAL `sku_id` link back to the global catalogue (kept open, unused for now).
--
-- The stock ledger will fold on `inventory_id` instead of a free-text name, so "TMT 12mm"
-- and "12mm TMT bar" become ONE material — and its unit becomes the one standard unit.
--
-- This migration lays the identity + the two writer RPCs. Matching (inventory_match),
-- the commit path, the view fold and the backfill land in the next two migrations.
--
-- ROLLBACK:
--   drop function if exists public.create_inventory_item(uuid,text,text,text,text,text,text,text,text);
--   drop function if exists public.append_inventory_alias(uuid,text);
--   alter table public.stock_ledger          drop column if exists inventory_id;
--   alter table public.bill_line_resolutions drop column if exists inventory_id;
--   drop table if exists public.inventory_items;
--   drop function if exists public.inv_norm(text);
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_trgm;

-- Identity normalizer: case-fold, trim, collapse internal whitespace. IMMUTABLE so it
-- can back the uniqueness index. NULL and '' both normalize to '' (one empty bucket).
create or replace function public.inv_norm(t text)
returns text language sql immutable as $$
  select lower(btrim(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g')))
$$;

create table if not exists public.inventory_items (
  inventory_id uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  item         text not null,                 -- base material: "Cement", "TMT Bar"
  variant      text,                          -- material / colour / type
  dimension    text,                          -- size
  grade        text,                          -- grade / class / schedule
  category     text,                          -- grouping + soft match hint ONLY (not identity)
  unit         text,                          -- the material's ONE standard unit
  aliases      text[] not null default '{}',  -- raw wordings seen; drives cheap matching
  sku_id       text references public.sku_directory(sku_id),  -- optional link to global catalogue
  -- Built with plain || / coalesce / nullif / btrim — all IMMUTABLE (concat_ws AND
  -- array_to_string are only STABLE, so both are rejected in a generated column).
  -- item is NOT NULL; each other bucket contributes " · value" only when present.
  display_name text generated always as (
    btrim(item)
    || coalesce(' · ' || nullif(btrim(dimension), ''), '')
    || coalesce(' · ' || nullif(btrim(variant), ''), '')
    || coalesce(' · ' || nullif(btrim(grade), ''), '')
  ) stored,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- "Same material" = same org + same four normalized buckets.
create unique index if not exists inventory_items_identity_uidx
  on public.inventory_items (
    org_id,
    public.inv_norm(item),
    public.inv_norm(variant),
    public.inv_norm(dimension),
    public.inv_norm(grade)
  );

create index if not exists inventory_items_org_idx  on public.inventory_items (org_id);
create index if not exists inventory_items_item_trgm on public.inventory_items using gin (item gin_trgm_ops);

alter table public.inventory_items enable row level security;
drop policy if exists "inventory_items read" on public.inventory_items;
create policy "inventory_items read" on public.inventory_items for select
  using (org_id in (select public.get_my_org_ids()));
-- Writes go through the SECURITY DEFINER RPCs below; no direct client insert/update policy.

-- ── Stock + resolution rows gain the identity link (additive, back-compatible) ──
alter table public.stock_ledger          add column if not exists inventory_id uuid references public.inventory_items(inventory_id);
alter table public.bill_line_resolutions add column if not exists inventory_id uuid references public.inventory_items(inventory_id);
create index if not exists stock_ledger_inventory_idx on public.stock_ledger (inventory_id);

-- ── Learning loop: attach a raw wording to a material, case-insensitively deduped. ──
create or replace function public.append_inventory_alias(p_inventory_id uuid, p_alias text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(btrim(p_alias), '') = '' then return; end if;
  update public.inventory_items
     set aliases = aliases || array[btrim(p_alias)], updated_at = now()
   where inventory_id = p_inventory_id
     and org_id in (select public.get_my_org_ids())
     and not exists (
       select 1 from unnest(aliases) a where lower(btrim(a)) = lower(btrim(p_alias))
     );
end $$;
revoke execute on function public.append_inventory_alias(uuid, text) from anon, public;
grant  execute on function public.append_inventory_alias(uuid, text) to authenticated;

-- ── Create (or find) a material by its four buckets. Idempotent on the identity. ──
create or replace function public.create_inventory_item(
  p_org_id      uuid,
  p_item        text,
  p_variant     text default null,
  p_dimension   text default null,
  p_grade       text default null,
  p_category    text default null,
  p_unit        text default null,
  p_first_alias text default null,
  p_sku_id      text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_org_id not in (select public.get_my_org_ids()) then
    raise exception 'Access denied';
  end if;
  if coalesce(btrim(p_item), '') = '' then
    raise exception 'a material name is required';
  end if;

  -- Already exists (same org + four buckets)? Return it, just learn the new wording.
  select inventory_id into v_id
    from public.inventory_items
   where org_id = p_org_id
     and public.inv_norm(item)      = public.inv_norm(p_item)
     and public.inv_norm(variant)   = public.inv_norm(p_variant)
     and public.inv_norm(dimension) = public.inv_norm(p_dimension)
     and public.inv_norm(grade)     = public.inv_norm(p_grade)
   limit 1;
  if v_id is not null then
    if coalesce(btrim(p_first_alias), '') <> '' then perform public.append_inventory_alias(v_id, p_first_alias); end if;
    return v_id;
  end if;

  insert into public.inventory_items (org_id, item, variant, dimension, grade, category, unit, aliases, sku_id, created_by)
  values (
    p_org_id,
    btrim(p_item),
    nullif(btrim(coalesce(p_variant, '')), ''),
    nullif(btrim(coalesce(p_dimension, '')), ''),
    nullif(btrim(coalesce(p_grade, '')), ''),
    nullif(btrim(coalesce(p_category, '')), ''),
    nullif(btrim(coalesce(p_unit, '')), ''),
    case when coalesce(btrim(p_first_alias), '') <> '' then array[btrim(p_first_alias)] else '{}' end,
    nullif(btrim(coalesce(p_sku_id, '')), ''),
    auth.uid()
  )
  returning inventory_id into v_id;
  return v_id;
end $$;
revoke execute on function public.create_inventory_item(uuid,text,text,text,text,text,text,text,text) from anon, public;
grant  execute on function public.create_inventory_item(uuid,text,text,text,text,text,text,text,text) to authenticated;

notify pgrst, 'reload schema';
