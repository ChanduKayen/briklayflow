-- ─────────────────────────────────────────────────────────────────────────────
-- P2·P3 · Role enforcement in RLS  (role-remediation plan, phases 2 & 3)
--
-- APPLY ONLY AFTER 20260830000001 (P0) AND 20260830000002 (P1), and after the two
-- role mismatches are reconciled — this enforcement reads org_memberships via
-- has_role_in_org(), so a wrong/absent membership row locks the user out.
--
-- Hybrid model (signed off): add a ROLE predicate to each policy; keep the direct
-- writes the client already makes. Every policy keeps its org_id base — org scoping
-- is never removed, only role is added.
--
-- v1 scope (non-breaking): fence the SUPERVISOR out of money / contracts / POs /
-- projects / parties. The finer management-vs-accountant split (only management
-- approves/creates/cancels a contract; accountant may not edit a contract) is
-- enforced at the action layer (approve RPCs already check management/principal;
-- UI in P6) so this migration doesn't break accountant-run auto-close, releases,
-- or site-ops project setup.
--   finance = accountant + management + principal
--
-- WATCH-POINT: stakeholders read is finance-only. If a supervisor material-request
-- flow needs vendor names, widen the stakeholders read policy (add a select policy
-- for all org members) — verify in testing.
--
-- ROLLBACK: for each table below, recreate the original org-only policy and drop
-- the new ones:
--   create policy "org member access" on public.<t> for all
--     using (org_id in (select public.get_my_org_ids()))
--     with check (org_id in (select public.get_my_org_ids()));
--   drop policy "<new policy>" on public.<t>;   -- (repeat per new policy)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Group 1 · read = write = finance (transactions, allocations, client billing, parties) ──
do $$
declare t text;
begin
  foreach t in array array['transactions','txn_allocations','client_invoices','client_payments','stakeholders']
  loop
    execute format($f$
      create policy "finance rw" on public.%1$I for all
        using      (org_id in (select public.get_my_org_ids())
                    and public.has_role_in_org(org_id, variadic array['accountant'::text,'management'::text,'principal'::text]))
        with check (org_id in (select public.get_my_org_ids())
                    and public.has_role_in_org(org_id, variadic array['accountant'::text,'management'::text,'principal'::text]));
      drop policy "org member access" on public.%1$I;
    $f$, t);
  end loop;
end $$;

-- ── Group 2 · read = all, write = finance (contracts, POs, projects) ──
-- Everyone in the org may read; only finance roles may write (supervisor excluded).
do $$
declare t text;
begin
  foreach t in array array['work_orders','wo_milestones','projects','purchase_orders','po_line_items']
  loop
    execute format($f$
      create policy "%1$s read" on public.%1$I for select
        using (org_id in (select public.get_my_org_ids()));
      create policy "%1$s write" on public.%1$I for all
        using      (org_id in (select public.get_my_org_ids())
                    and public.has_role_in_org(org_id, variadic array['accountant'::text,'management'::text,'principal'::text]))
        with check (org_id in (select public.get_my_org_ids())
                    and public.has_role_in_org(org_id, variadic array['accountant'::text,'management'::text,'principal'::text]));
      drop policy "org member access" on public.%1$I;
    $f$, t);
  end loop;
end $$;

-- ── po_approvals · scoped through the parent PO (it has no org_id of its own) ──
create policy "po_approvals read" on public.po_approvals for select
  using (po_id in (select po_id from public.purchase_orders
                    where org_id in (select public.get_my_org_ids())));
create policy "po_approvals write" on public.po_approvals for all
  using      (po_id in (select p.po_id from public.purchase_orders p
                         where p.org_id in (select public.get_my_org_ids())
                           and public.has_role_in_org(p.org_id, variadic array['accountant'::text,'management'::text,'principal'::text])))
  with check (po_id in (select p.po_id from public.purchase_orders p
                         where p.org_id in (select public.get_my_org_ids())
                           and public.has_role_in_org(p.org_id, variadic array['accountant'::text,'management'::text,'principal'::text])));
drop policy "org member access" on public.po_approvals;

-- ── rough_entries (day book) · all read + INSERT (supervisor may submit), finance edits/deletes ──
create policy "re read"   on public.rough_entries for select
  using (org_id in (select public.get_my_org_ids()));
create policy "re insert" on public.rough_entries for insert
  with check (org_id in (select public.get_my_org_ids()));            -- any org member, incl. supervisor
create policy "re update" on public.rough_entries for update
  using      (org_id in (select public.get_my_org_ids()) and public.has_role_in_org(org_id, variadic array['accountant'::text,'management'::text,'principal'::text]))
  with check (org_id in (select public.get_my_org_ids()) and public.has_role_in_org(org_id, variadic array['accountant'::text,'management'::text,'principal'::text]));
create policy "re delete" on public.rough_entries for delete
  using (org_id in (select public.get_my_org_ids()) and public.has_role_in_org(org_id, variadic array['accountant'::text,'management'::text,'principal'::text]));
drop policy "org member access" on public.rough_entries;

-- ── follow_up_rules (config) · all read, management/principal write ──
create policy "fur read"  on public.follow_up_rules for select
  using (org_id in (select public.get_my_org_ids()));
create policy "fur write" on public.follow_up_rules for all
  using      (org_id in (select public.get_my_org_ids()) and public.has_role_in_org(org_id, variadic array['management'::text,'principal'::text]))
  with check (org_id in (select public.get_my_org_ids()) and public.has_role_in_org(org_id, variadic array['management'::text,'principal'::text]));
drop policy "org member access" on public.follow_up_rules;

-- ── Left unchanged (org-scoped, all members) — supervisor legitimately writes these:
--   purchase_requests, purchase_request_items, po_grn, po_grn_items,
--   site_tasks, site_task_qc, site_task_comments, site_narrations, problems,
--   problem_resolutions, todos, siteops_unplaced, attachments, chase_batches,
--   followup_events, site_ref_counters
-- Approval/promotion within purchasing is gated inside its RPCs, not here.
