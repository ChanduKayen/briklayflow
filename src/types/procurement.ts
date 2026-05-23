// Sprint 2: Procurement types

export type RFQStatus =
  | 'draft'
  | 'sent'
  | 'quotes_received'
  | 'vendor_selected'
  | 'converted_to_po'
  | 'cancelled';

export type QuoteStatus = 'pending' | 'received' | 'selected' | 'rejected';

export interface QuoteRate {
  rfq_item_id: string;
  rate: number;
  available_qty: number;
  delivery_days: number;
}

export interface RFQItem {
  id: string;
  rfq_id: string;
  material: string;
  spec: string | null;
  qty: number;
  unit: string;
  source_mr_item_id: string | null;
}

export interface RFQQuote {
  id: string;
  rfq_id: string;
  vendor_id: string;
  vendor_name: string;
  vendor_category: string | null;
  rates: QuoteRate[];
  total_quoted: number;
  validity_date: string | null;
  terms: string | null;
  attachment_url: string | null;
  received_at: string | null;
  status: QuoteStatus;
}

export interface RFQSummary {
  id: string;
  rfq_number: string;
  title: string;
  response_deadline: string;
  status: RFQStatus;
  selected_quote_id: string | null;
  source_mr_id: string | null;
  rfq_items: RFQItem[];
  rfq_quotes: RFQQuote[];
}

export interface RFQPOData {
  po_id: string;
  org_id: string;
  status: string;
  date_issued: string | null;
  created_at: string;
  ordered_by: string | null;
  source_rfq_id: string | null;
  projects: { name: string; site_location: string | null } | null;
  stakeholders: { name: string; category: string | null } | null;
  po_line_items: Array<{
    id: string;
    item_name: string;
    unit: string | null;
    quantity_ordered: number | null;
  }>;
  rfq: RFQSummary | null;
}
