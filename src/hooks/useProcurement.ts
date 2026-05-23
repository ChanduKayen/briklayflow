import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { RFQPOData, QuoteRate } from '../types/procurement';

// ── useRFQPOs ─────────────────────────────────────────────────────────────────

export function useRFQPOs() {
  return useQuery<RFQPOData[]>({
    queryKey: ['rfq_pos'],
    staleTime: 30_000,
    queryFn: async () => {
      // Both queries run in parallel — PO list never depends on rfq data
      const [poResult, rfqResult] = await Promise.all([
        supabase
          .from('purchase_orders')
          .select(`
            po_id, org_id, status, date_issued, created_at, ordered_by,
            projects(name, site_location),
            stakeholders(name, category),
            po_line_items(id, item_name, unit, quantity_ordered)
          `)
          .eq('status', 'RFQ')
          .order('created_at', { ascending: false }),

        // Async IIFE so we can use try/catch — the Supabase builder is a thenable
        // but does not expose .catch() as a method.
        (async () => {
          try {
            return await supabase
              .from('rfqs')
              .select(`
                id, rfq_number, title, response_deadline, status,
                selected_quote_id, source_mr_id, converted_to_po_id,
                rfq_items(id, rfq_id, material, spec, qty, unit, source_mr_item_id),
                rfq_quotes(
                  id, rfq_id, vendor_id, rates, total_quoted,
                  validity_date, terms, attachment_url, received_at, status,
                  stakeholders(name, category)
                )
              `)
              .not('status', 'in', '("converted_to_po","cancelled")');
          } catch {
            return { data: null, error: null };
          }
        })(),
      ]);

      if (poResult.error) throw poResult.error;
      const rows = (poResult.data ?? []) as any[];
      if (rows.length === 0) return [];

      // Build po_id → rfq map from whatever came back (may be null if table missing)
      const rfqByPoId: Record<string, any> = {};
      for (const rfq of rfqResult.data ?? []) {
        if (!rfq.converted_to_po_id) continue;
        rfqByPoId[rfq.converted_to_po_id] = {
          id: rfq.id,
          rfq_number: rfq.rfq_number,
          title: rfq.title,
          response_deadline: rfq.response_deadline,
          status: rfq.status,
          selected_quote_id: rfq.selected_quote_id,
          source_mr_id: rfq.source_mr_id,
          rfq_items: rfq.rfq_items ?? [],
          rfq_quotes: (rfq.rfq_quotes ?? []).map((q: any) => ({
            id: q.id,
            rfq_id: q.rfq_id,
            vendor_id: q.vendor_id,
            rates: q.rates ?? [],
            total_quoted: q.total_quoted,
            validity_date: q.validity_date,
            terms: q.terms,
            attachment_url: q.attachment_url,
            received_at: q.received_at,
            status: q.status,
            vendor_name: (q.stakeholders as any)?.name ?? q.vendor_id,
            vendor_category: (q.stakeholders as any)?.category ?? null,
          })),
        };
      }

      return rows.map((po): RFQPOData => ({
        po_id: po.po_id,
        org_id: po.org_id,
        status: po.status,
        date_issued: po.date_issued,
        created_at: po.created_at,
        ordered_by: po.ordered_by,
        source_rfq_id: null,
        projects: po.projects,
        stakeholders: po.stakeholders,
        po_line_items: po.po_line_items ?? [],
        rfq: rfqByPoId[po.po_id] ?? null,
      }));
    },
  });
}

// ── useRFQQuoteCounts ─────────────────────────────────────────────────────────

export function useRFQQuoteCounts() {
  return useQuery<{ rfq_po_count: number; vendor_responses: number }>({
    queryKey: ['rfq_quote_counts'],
    queryFn: async () => {
      const { count: rfq_po_count } = await supabase
        .from('purchase_orders')
        .select('po_id', { count: 'exact', head: true })
        .eq('status', 'RFQ');

      const { count: vendor_responses } = await supabase
        .from('rfq_quotes')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'received');

      return {
        rfq_po_count: rfq_po_count ?? 0,
        vendor_responses: vendor_responses ?? 0,
      };
    },
  });
}

// ── useCreateRFQForPO ─────────────────────────────────────────────────────────

interface CreateRFQInput {
  po_id: string;
  org_id: string;
  title: string;
  response_deadline: string;
  line_items: Array<{
    id: string;
    item_name: string;
    unit: string | null;
    quantity_ordered: number | null;
  }>;
  vendor_ids: string[];
}

export function useCreateRFQForPO() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateRFQInput) => {
      const { data: rfqNumData, error: numErr } = await supabase.rpc('generate_doc_number', {
        p_prefix: 'RFQ',
        p_table_name: 'rfqs',
        p_num_col: 'rfq_number',
      });
      if (numErr) throw numErr;

      const { data: rfq, error: rfqErr } = await supabase
        .from('rfqs')
        .insert({
          rfq_number: rfqNumData as string,
          org_id: input.org_id,
          title: input.title,
          response_deadline: input.response_deadline,
          status: 'draft',
          converted_to_po_id: input.po_id,
        })
        .select('id')
        .single();
      if (rfqErr) throw rfqErr;

      const rfqId = rfq.id as string;

      const rfqItems = input.line_items.map((li) => ({
        rfq_id: rfqId,
        material: li.item_name,
        qty: li.quantity_ordered ?? 1,
        unit: li.unit ?? 'Nos',
      }));

      if (rfqItems.length > 0) {
        const { error: itemsErr } = await supabase.from('rfq_items').insert(rfqItems);
        if (itemsErr) throw itemsErr;
      }

      if (input.vendor_ids.length > 0) {
        const quotes = input.vendor_ids.map((vid) => ({
          rfq_id: rfqId,
          vendor_id: vid,
          rates: [],
          total_quoted: 0,
          status: 'pending',
        }));
        const { error: quotesErr } = await supabase.from('rfq_quotes').insert(quotes);
        if (quotesErr) throw quotesErr;
      }

      const { error: poErr } = await supabase
        .from('purchase_orders')
        .update({ source_rfq_id: rfqId })
        .eq('po_id', input.po_id);
      if (poErr) throw poErr;

      return rfqId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rfq_pos'] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      qc.invalidateQueries({ queryKey: ['rfq_quote_counts'] });
    },
  });
}

// ── useAddVendorToRFQ ─────────────────────────────────────────────────────────

interface AddVendorInput {
  rfq_id: string;
  vendor_id: string;
}

export function useAddVendorToRFQ() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: AddVendorInput) => {
      const { error } = await supabase.from('rfq_quotes').insert({
        rfq_id: input.rfq_id,
        vendor_id: input.vendor_id,
        rates: [],
        total_quoted: 0,
        status: 'pending',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rfq_pos'] });
      qc.invalidateQueries({ queryKey: ['rfq_quote_counts'] });
    },
  });
}

// ── useSubmitQuote ────────────────────────────────────────────────────────────

interface SubmitQuoteInput {
  quote_id: string;
  rfq_id: string;
  rates: QuoteRate[];
  total_quoted: number;
  validity_date?: string | null;
  terms?: string | null;
}

export function useSubmitQuote() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: SubmitQuoteInput) => {
      const { error: quoteErr } = await supabase
        .from('rfq_quotes')
        .update({
          rates: input.rates,
          total_quoted: input.total_quoted,
          status: 'received',
          received_at: new Date().toISOString(),
          ...(input.validity_date !== undefined ? { validity_date: input.validity_date } : {}),
          ...(input.terms !== undefined ? { terms: input.terms } : {}),
        })
        .eq('id', input.quote_id);
      if (quoteErr) throw quoteErr;

      // Promote rfq to quotes_received if not already further along
      const { data: rfq } = await supabase
        .from('rfqs')
        .select('status')
        .eq('id', input.rfq_id)
        .single();

      if (rfq && rfq.status === 'draft' || rfq?.status === 'sent') {
        await supabase
          .from('rfqs')
          .update({ status: 'quotes_received' })
          .eq('id', input.rfq_id);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rfq_pos'] });
      qc.invalidateQueries({ queryKey: ['rfq_quote_counts'] });
    },
  });
}

// ── useSelectVendor ───────────────────────────────────────────────────────────

interface SelectVendorInput {
  quote_id: string;
  rfq_id: string;
  po_id: string;
  vendor_id: string;
}

export function useSelectVendor() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: SelectVendorInput) => {
      // 1. Mark selected quote
      const { error: e1 } = await supabase
        .from('rfq_quotes')
        .update({ status: 'selected' })
        .eq('id', input.quote_id);
      if (e1) throw e1;

      // 2. Reject all others in this rfq
      const { error: e2 } = await supabase
        .from('rfq_quotes')
        .update({ status: 'rejected' })
        .eq('rfq_id', input.rfq_id)
        .neq('id', input.quote_id);
      if (e2) throw e2;

      // 3. Update rfq: selected_quote_id + vendor_selected status
      const { error: e3 } = await supabase
        .from('rfqs')
        .update({ selected_quote_id: input.quote_id, status: 'vendor_selected' })
        .eq('id', input.rfq_id);
      if (e3) throw e3;

      // 4. Promote PO to ORDERED, assign vendor, confirm rates
      const { error: e4 } = await supabase
        .from('purchase_orders')
        .update({
          status: 'ORDERED',
          stakeholder_id: input.vendor_id,
          rate_status: 'confirmed',
        })
        .eq('po_id', input.po_id);
      if (e4) throw e4;

      // 5. Mark rfq converted
      const { error: e5 } = await supabase
        .from('rfqs')
        .update({ status: 'converted_to_po', converted_to_po_id: input.po_id })
        .eq('id', input.rfq_id);
      if (e5) throw e5;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rfq_pos'] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      qc.invalidateQueries({ queryKey: ['rfq_quote_counts'] });
    },
  });
}
