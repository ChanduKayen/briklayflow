-- ─────────────────────────────────────────────────────────────────────────────
-- RFQ (request for quotation) · Phase 1 storage
--
-- A request records a BOQ (no prices) and the vendors it was sent to; each vendor
-- gets an unguessable token that (Phase 2) opens a no-login page to enter rates.
-- The send-rfq edge function writes these with the service role after authorizing
-- the caller; the client never writes them directly. Org members (finance tier)
-- can read for the "Awaiting quotes" view. Anon token RPCs land in Phase 2.
--
-- ROLLBACK: drop table public.rfq_quotes, public.rfq_recipients, public.rfqs cascade;
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.rfqs (
  rfq_id            uuid primary key default gen_random_uuid(),
  org_id            uuid not null,
  project_id        text,
  created_by        uuid,
  status            text not null default 'open',      -- open | closed
  quote_by          date,
  delivery_location text,
  items             jsonb not null default '[]'::jsonb, -- [{ line, item_name, unit, qty, spec }]
  created_at        timestamptz not null default now()
);

create table if not exists public.rfq_recipients (
  recipient_id  uuid primary key default gen_random_uuid(),
  rfq_id        uuid not null references public.rfqs(rfq_id) on delete cascade,
  org_id        uuid not null,
  stakeholder_id text,
  vendor_name   text,
  vendor_phone  text,
  token         uuid not null default gen_random_uuid() unique,
  status        text not null default 'sent',          -- sent | opened | quoted
  sent_at       timestamptz not null default now(),
  quoted_at     timestamptz
);

create table if not exists public.rfq_quotes (
  quote_id     uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.rfq_recipients(recipient_id) on delete cascade,
  rfq_id       uuid not null,
  org_id       uuid not null,
  line         int,
  unit_rate    numeric,
  note         text,
  submitted_at timestamptz not null default now()
);

create index if not exists rfq_recipients_rfq_idx on public.rfq_recipients (rfq_id);
create index if not exists rfq_quotes_recipient_idx on public.rfq_quotes (recipient_id);

alter table public.rfqs           enable row level security;
alter table public.rfq_recipients enable row level security;
alter table public.rfq_quotes     enable row level security;

-- Read for finance-tier org members; no client write policies (edge fn = service role writes)
create policy "rfq read" on public.rfqs for select
  using (org_id in (select public.get_my_org_ids())
         and public.has_role_in_org(org_id, variadic array['accountant'::text,'management'::text,'principal'::text]));
create policy "rfq_recipients read" on public.rfq_recipients for select
  using (org_id in (select public.get_my_org_ids())
         and public.has_role_in_org(org_id, variadic array['accountant'::text,'management'::text,'principal'::text]));
create policy "rfq_quotes read" on public.rfq_quotes for select
  using (org_id in (select public.get_my_org_ids())
         and public.has_role_in_org(org_id, variadic array['accountant'::text,'management'::text,'principal'::text]));
