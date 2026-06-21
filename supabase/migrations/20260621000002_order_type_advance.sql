-- Vendor advance / credit: a payment (or part of one) parked against a vendor with no
-- order to clear yet. Modelled as a txn_allocations row with order_type = 'ADVANCE' and
-- no order_ref. MONEY ONLY — never a GRN/stock write.
--
-- Note: isNotLinked() already treats any truthy order_type as "linked", so an ADVANCE
-- allocation is not flagged as orphaned by the ledger nudge.
--
-- ALTER TYPE ... ADD VALUE must run on its own (not inside a txn that then uses it).
ALTER TYPE public.order_type_enum ADD VALUE IF NOT EXISTS 'ADVANCE';
