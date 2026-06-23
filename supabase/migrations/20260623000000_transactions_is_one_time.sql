-- One-time payments
-- ─────────────────
-- A deliberate "this outflow is a standalone one-time payment" flag, set from the
-- ledger's Track chip (and the contract hub's one-off exit). It is NOT part of any
-- contract / PO: once marked, the ledger stops nudging to link it, isNotLinked() no
-- longer treats it as orphaned money, and party ledgers group these under a
-- "One-time payments" section.
--
-- The money is already in the project's cost breakdown via its txn_allocations row;
-- this column only records the owner's intent. Nullable-safe default so existing rows
-- are untouched. Client UPDATE on transactions (used by void / recategorise) already
-- covers writing this column under the existing RLS policy.
alter table public.transactions
  add column if not exists is_one_time boolean not null default false;
