-- Billing overhaul: add construction-specific columns to client_invoices
ALTER TABLE public.client_invoices
  ADD COLUMN IF NOT EXISTS milestone_name         text,
  ADD COLUMN IF NOT EXISTS gross_amount           numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS previous_bills_amount  numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_bill_amount        numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retention_rate         numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retention_amount       numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_payable_pretax     numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_applicable         boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sac_code               text    DEFAULT '995411',
  ADD COLUMN IF NOT EXISTS cgst_rate              numeric NOT NULL DEFAULT 9,
  ADD COLUMN IF NOT EXISTS cgst_amount            numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount            numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount            numeric NOT NULL DEFAULT 0;
