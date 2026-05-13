export type UserRole = 'principal' | 'management' | 'accountant' | 'supervisor';
export type ProjectStatus = 'Active' | 'Completed' | 'On Hold';

export interface UserProfile {
  id: string;
  name: string;
  role: UserRole;
  assigned_projects: string[];
  created_at: string;
}

export interface Project {
  project_id: string;
  name: string;
  site_location: string;
  status: ProjectStatus;
  start_date: string;
  created_by: string;
  created_at: string;
}

export type StakeholderType = 'Worker' | 'Vendor' | 'Client';
export type WOStatus = 'Draft' | 'Issued' | 'Active' | 'Closed' | 'Cancelled';
export type WOSource = 'uploaded_doc' | 'manual';
export type MilestoneStatus = 'Pending' | 'Completed' | 'Approved' | 'Paid' | 'Partially Paid';
export type POStatus = 'Draft' | 'Issued' | 'Received' | 'Closed';
export type PaymentMode = 'Cash' | 'NEFT' | 'UPI' | 'Cheque';
export type TxnStatus = 'Active' | 'Voided';
export type AIFlagStatus = 'Clean' | 'Flagged' | 'Acknowledged';
export type OrderType = 'WO' | 'PO';

export type GSTRegType = 'Regular' | 'Composition' | 'Unregistered';

export interface Stakeholder {
  stakeholder_id: string;
  name: string;
  type: StakeholderType;
  category: string;
  contact?: string;
  bank_details?: string;
  gstin?: string;
  gst_reg_type?: GSTRegType;
  is_approved?: boolean;
  rating?: number | null;
  rating_delivery?: number | null;
  rating_quality?: number | null;
  rating_pricing?: number | null;
  created_at: string;
}

export interface StatusHistoryEntry {
  status: string;
  at: string;
  by: string;
}

export interface WorkOrder {
  wo_id: string;
  project_id: string;
  stakeholder_id: string;
  scope_of_work: string;
  order_value: number;
  status: WOStatus;
  date_issued: string;
  source: WOSource;
  source_doc_url?: string;
  created_by?: string;
  created_at: string;
  // status_history column (JSONB) — add to DB with:
  // ALTER TABLE work_orders ADD COLUMN status_history jsonb DEFAULT '[]'::jsonb;
  status_history?: StatusHistoryEntry[];
}

export interface WOMilestone {
  milestone_id: string;
  wo_id: string;
  seq_no: number;
  name: string;
  description?: string;
  trigger_condition: string;
  planned_amount: number;
  status: MilestoneStatus;
  ai_extracted: boolean;
  completed_by?: string;
  approved_by?: string;
  completed_at?: string;
  approved_at?: string;
}

export interface POItem {
  description: string;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
}

export interface PurchaseOrder {
  po_id: string;
  project_id: string;
  stakeholder_id: string;
  items: POItem[];
  order_value: number;
  status: POStatus;
  date_issued: string;
  doc_url?: string;
  created_by?: string;
  created_at: string;
}

export interface TxnAllocation {
  allocation_id: string;
  txn_id: string;
  project_id: string;
  order_type?: OrderType;
  order_ref?: string;
  milestone_id?: string;
  allocated_amount: number;
}

// ── Client Billing ────────────────────────────────────────────────────────────

export type InvoiceType = 'invoice' | 'proforma' | 'advance' | 'credit_note' | 'receipt' | 'progress' | 'final';
export type InvoiceStatus = 'Draft' | 'Sent' | 'Partial' | 'Paid' | 'Overdue' | 'Void' | 'Cancelled';

export interface InvoiceLineItem {
  description: string;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
}

export interface ClientInvoice {
  invoice_id: string;
  client_id?: string;
  project_id?: string;
  invoice_type: InvoiceType;
  subject?: string;
  invoice_date: string;
  due_date?: string;
  line_items: InvoiceLineItem[];
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
  paid_amount: number;
  status: InvoiceStatus;
  notes?: string;
  doc_url?: string;
  source: 'manual' | 'ai_extracted';
  created_by?: string;
  created_at: string;
  // Construction billing fields
  milestone_name?: string | null;
  gross_amount?: number | null;
  previous_bills_amount?: number | null;
  net_bill_amount?: number | null;
  retention_rate?: number | null;
  retention_amount?: number | null;
  net_payable_pretax?: number | null;
  gst_applicable?: boolean | null;
  sac_code?: string | null;
  cgst_rate?: number | null;
  cgst_amount?: number | null;
  sgst_amount?: number | null;
  igst_amount?: number | null;
}

export interface ClientPayment {
  payment_id: string;
  invoice_id: string;
  amount: number;
  payment_date: string;
  payment_mode: PaymentMode;
  reference?: string;
  notes?: string;
  txn_id?: string;
  created_by?: string;
  created_at: string;
}

export interface Transaction {
  txn_id: string;
  stakeholder_id: string;
  date: string;
  total_amount: number;
  payment_mode: PaymentMode;
  category: string;
  remarks?: string;
  status: TxnStatus;
  bill_doc_url?: string;
  ai_flag_status: AIFlagStatus;
  ai_flag_data: any;
  entered_by?: string;
  voided_by?: string;
  voided_at?: string;
  created_at: string;
}

// ── Enhanced Purchase Order types ─────────────────────────────────────────────

export type EnhancedPOStatus =
  | 'Draft'
  | 'Pending Approval'
  | 'Approved'
  | 'Ordered'
  | 'Partially Delivered'
  | 'Delivered'
  | 'Tallied'
  | 'Disputed'
  | 'Cancelled';

export interface POLineItem {
  id?: string;
  po_id?: string;
  line_number: number;
  category_id?: string;
  item_name: string;
  specification?: string;
  unit: string;
  quantity_ordered: number;
  quantity_delivered?: number;
  quantity_accepted?: number;
  quantity_rejected?: number;
  unit_rate: number;
  basic_amount: number;
  discount_percent?: number;
  discount_amount?: number;
  gst_rate: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  total_amount: number;
  is_ai_extracted?: boolean;
  delivery_status?: string;
}

export interface POGRN {
  id?: string;
  po_id: string;
  grn_number: string;
  receipt_date: string;
  received_by_name?: string;
  delivery_challan_no?: string;
  ewaybill_number?: string;
  vehicle_number?: string;
  condition: 'GOOD' | 'DAMAGED' | 'PARTIAL';
  notes?: string;
  created_by?: string;
  created_at?: string;
}

export interface POApproval {
  id?: string;
  po_id: string;
  approver_user_id?: string;
  action: 'APPROVED' | 'REJECTED' | 'SENT_BACK';
  remarks?: string;
  actioned_at?: string;
}

// ── Rough Entries (Inbox) ─────────────────────────────────────────────────────

export type RoughEntrySource =
  | 'WHATSAPP_TEXT' | 'WHATSAPP_IMAGE' | 'WHATSAPP_VOICE'
  | 'UI_TEXT' | 'UI_IMAGE';

export type RoughEntryStatus = 'PENDING' | 'POSTED' | 'DISMISSED';

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface AIExtracted {
  processed?: boolean;
  error?: string;
  // Raw strings from AI (Step 1)
  payee_raw?: string | null;
  project_raw?: string | null;
  // Server-matched payee (Step 2)
  payee_id?: string | null;
  payee_name?: string | null;
  payee_matched?: boolean;
  payee_unmatched?: boolean;
  payee_confidence?: ConfidenceLevel | null;
  payee_closest_match?: Array<{ id: string; name: string; type: string; category: string }> | null;
  // Server-matched project (Step 3)
  project_id?: string | null;
  project_name?: string | null;
  project_matched?: boolean;
  project_unmatched?: boolean;
  project_confidence?: ConfidenceLevel | null;
  project_closest_match?: Array<{ id: string; name: string }> | null;
  // Transaction fields
  amount?: number | null;
  date?: string | null;
  mode?: 'Cash' | 'NEFT' | 'UPI' | 'Cheque' | null;
  transaction_type?: 'Worker Payment' | 'Material Purchase' | 'General Expense' | null;
  category_code?: string | null;
  category_name?: string | null;
  description?: string | null;
  description_raw?: string | null;
  work_type?: string | null;
  floor_or_area?: string | null;
  material_name?: string | null;
  material_quantity?: string | null;
  material_unit?: string | null;
  wo_id?: string | null;
  wo_number?: string | null;
  // Flat confidence fields (Step 5)
  amount_confidence?: ConfidenceLevel | null;
  description_confidence?: ConfidenceLevel | null;
  overall_confidence?: ConfidenceLevel | null;
  // Legacy nested confidence (backward compat with old entries)
  confidence?: {
    payee: ConfidenceLevel;
    amount: ConfidenceLevel;
    description: ConfidenceLevel;
    project: ConfidenceLevel;
    mode: ConfidenceLevel;
    overall: ConfidenceLevel;
  };
}

export interface RoughEntry {
  id: string;
  re_number: string;
  source: RoughEntrySource;
  raw_text?: string | null;
  raw_image_url?: string | null;
  raw_audio_url?: string | null;
  transcribed_text?: string | null;
  sender_name?: string | null;
  sender_number?: string | null;
  ai_extracted: AIExtracted;
  status: RoughEntryStatus;
  resolved_txn_id?: string | null;
  created_at: string;
  created_by?: string | null;
}

export interface EnhancedPurchaseOrder {
  po_id: string;
  project_id: string;
  stakeholder_id: string;
  items: POItem[];
  order_value: number;
  status: string;
  date_issued: string;
  doc_url?: string;
  created_by?: string;
  created_at: string;
  ordered_by?: string;
  expected_delivery?: string;
  delivered_date?: string;
  delivery_location?: string;
  payment_terms_days?: number;
  approval_status?: string;
  approved_by?: string;
  approved_at?: string;
  approval_remarks?: string;
  gst_value?: number;
  total_value?: number;
  three_way_match?: string;
  vendor_bill_no?: string;
  vendor_bill_date?: string;
  ewaybill_number?: string;
  internal_notes?: string;
  vendor_notes?: string;
}
