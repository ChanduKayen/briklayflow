-- Client Billing module
-- client_invoices  — one row per invoice
-- client_payments  — one row per receipt/payment recorded
-- Clients are stored as stakeholders with type = 'Client'

CREATE TABLE IF NOT EXISTS public.client_invoices (
  invoice_id              text        PRIMARY KEY,
  client_id               text        REFERENCES public.stakeholders(stakeholder_id),
  project_id              text        REFERENCES public.projects(project_id),
  invoice_type            text        NOT NULL DEFAULT 'invoice',
  subject                 text,
  invoice_date            date        NOT NULL DEFAULT CURRENT_DATE,
  due_date                date,
  line_items              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  subtotal                numeric     NOT NULL DEFAULT 0,
  tax_rate                numeric     NOT NULL DEFAULT 0,
  tax_amount              numeric     NOT NULL DEFAULT 0,
  total_amount            numeric     NOT NULL DEFAULT 0,
  paid_amount             numeric     NOT NULL DEFAULT 0,
  status                  text        NOT NULL DEFAULT 'Draft',
  notes                   text,
  doc_url                 text,
  source                  text        NOT NULL DEFAULT 'manual',
  created_by              uuid        REFERENCES auth.users(id),
  created_at              timestamptz DEFAULT now(),
  -- Construction billing columns
  milestone_name          text,
  gross_amount            numeric     NOT NULL DEFAULT 0,
  previous_bills_amount   numeric     NOT NULL DEFAULT 0,
  net_bill_amount         numeric     NOT NULL DEFAULT 0,
  retention_rate          numeric     NOT NULL DEFAULT 0,
  retention_amount        numeric     NOT NULL DEFAULT 0,
  net_payable_pretax      numeric     NOT NULL DEFAULT 0,
  gst_applicable          boolean     NOT NULL DEFAULT true,
  sac_code                text        DEFAULT '995411',
  cgst_rate               numeric     NOT NULL DEFAULT 9,
  cgst_amount             numeric     NOT NULL DEFAULT 0,
  sgst_amount             numeric     NOT NULL DEFAULT 0,
  igst_amount             numeric     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ci_project  ON public.client_invoices (project_id);
CREATE INDEX IF NOT EXISTS idx_ci_client   ON public.client_invoices (client_id);
CREATE INDEX IF NOT EXISTS idx_ci_status   ON public.client_invoices (status);

CREATE TABLE IF NOT EXISTS public.client_payments (
  payment_id    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    text        NOT NULL REFERENCES public.client_invoices (invoice_id) ON DELETE CASCADE,
  amount        numeric     NOT NULL,
  payment_date  date        NOT NULL DEFAULT CURRENT_DATE,
  payment_mode  text        NOT NULL DEFAULT 'NEFT',
  reference     text,
  notes         text,
  txn_id        text,
  created_by    uuid        REFERENCES auth.users(id),
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cp_invoice ON public.client_payments (invoice_id);

-- RLS
ALTER TABLE public.client_invoices  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_payments  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Client billing access" ON public.client_invoices;
CREATE POLICY "Client billing access" ON public.client_invoices FOR ALL
  USING  (public.current_user_role() IN ('principal', 'management', 'accountant'))
  WITH CHECK (public.current_user_role() IN ('principal', 'management', 'accountant'));

DROP POLICY IF EXISTS "Client billing access" ON public.client_payments;
CREATE POLICY "Client billing access" ON public.client_payments FOR ALL
  USING  (public.current_user_role() IN ('principal', 'management', 'accountant'))
  WITH CHECK (public.current_user_role() IN ('principal', 'management', 'accountant'));
