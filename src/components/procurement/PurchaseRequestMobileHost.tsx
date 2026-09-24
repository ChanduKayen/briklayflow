/**
 * The phone's purchase-request screen, wired.
 *
 * PurchaseRequestMobile is the reference design, ported verbatim; this is what feeds it. It reads the
 * same request the desktop page reads, offers the org's projects and suppliers to its two pickers,
 * and performs the same writes the desktop page performs — the site, the supplier and the items —
 * through the same RPC when the request is promoted. Nothing about the desktop page changes: it is
 * still the surface on a wide screen, and this one only exists below the phone breakpoint.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { useOrgId } from '../../lib/auth/AuthProvider';
import { useUserProfile } from '../../App';
import { createParty } from '../day-book/fileEntry';
import PurchaseRequestMobile, { type PqrItem, type PqrRequest } from './PurchaseRequestMobile';

/* A blank sheet of paper, for a request that came in without a photo. The hero always shows one. */
const NO_PHOTO = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 184"><rect width="140" height="184" fill="#F4EFE6"/>'
  + '<g fill="#DCD2C4"><rect x="16" y="22" width="76" height="9" rx="2"/><rect x="16" y="46" width="108" height="5" rx="2"/>'
  + '<rect x="16" y="60" width="108" height="5" rx="2"/><rect x="16" y="74" width="88" height="5" rx="2"/>'
  + '<rect x="16" y="98" width="108" height="5" rx="2"/><rect x="16" y="112" width="70" height="5" rx="2"/></g></svg>');

interface PrItemRow {
  id: string; item_index: number | null; item_name: string; quantity: number | string | null; unit: string | null;
  note: string | null; width_mm: number | string | null; height_mm: number | string | null;
  brand: string | null; spec: string | null; source_line: string | null; read_fields: Record<string, number> | null;
}
interface PrRow {
  id: string; org_id: string; status: string; created_at: string; image_url: string | null;
  sender_name: string | null; wa_message_id: string | null; converted_po_id: string | null;
  site_id: string | null; site_raw: string | null; vendor_id: string | null; vendor_raw: string | null;
  purchase_request_items: PrItemRow[];
  projects: { name: string } | null;
  stakeholders: { name: string } | null;
}

/** "today, 9:41 am" · "yesterday, 4:02 pm" · "12 Sept, 9:41 am" — the reference's own phrasing. */
function whenOf(iso: string): string {
  const d = new Date(iso), now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const gap = Math.round((day(now) - day(d)) / 864e5);
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  const head = gap === 0 ? 'today' : gap === 1 ? 'yesterday' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return head + ', ' + time;
}
const str = (v: unknown) => (v == null || v === '' ? '' : String(v));

export default function PurchaseRequestMobileHost({ id, session }: { id: string; session: Session }) {
  const navigate = useNavigate();
  const orgId = useOrgId();
  const qc = useQueryClient();
  const { data: profile } = useUserProfile(session.user.id);
  const [extraPayees, setExtraPayees] = useState<{ name: string; sub: string }[]>([]);

  const prQ = useQuery({
    queryKey: ['purchase_request', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('purchase_requests')
        .select('id, org_id, status, created_at, image_url, sender_name, wa_message_id, converted_po_id, site_id, site_raw, vendor_id, vendor_raw, '
          + 'purchase_request_items(id, item_index, item_name, quantity, unit, note, width_mm, height_mm, brand, spec, source_line, read_fields), '
          + 'projects(name), stakeholders(name)')
        .eq('id', id).single();
      if (error) throw error;
      return data as unknown as PrRow;
    },
  });
  const pr = prQ.data ?? null;

  // The message the photo arrived with lives on the WhatsApp message the request was read from — the
  // same wa_message_id the day book keys its own rows by. A request raised any other way has none.
  const waQ = useQuery({
    queryKey: ['purchase_request_wa', pr?.org_id, pr?.wa_message_id],
    enabled: !!pr?.wa_message_id && !!pr?.org_id,
    queryFn: async () => {
      const { data } = await supabase.from('rough_entries')
        .select('raw_text, raw_image_url, sender_name, created_at')
        .eq('org_id', pr!.org_id).eq('wa_message_id', pr!.wa_message_id!)
        .order('created_at', { ascending: true });
      return (data ?? []) as { raw_text: string | null; raw_image_url: string | null; sender_name: string | null }[];
    },
  });

  const projQ = useQuery({
    queryKey: ['pqr_projects', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const [{ data: ps }, { data: open }] = await Promise.all([
        supabase.from('projects').select('project_id, name').eq('status', 'Active').order('name'),
        supabase.from('purchase_requests').select('site_id, status').eq('org_id', orgId),
      ]);
      const n: Record<string, number> = {};
      (open ?? []).forEach((r: { site_id: string | null; status: string }) => {
        if (!r.site_id || r.status === 'closed' || r.status === 'fulfilled') return;
        n[r.site_id] = (n[r.site_id] || 0) + 1;
      });
      return (ps ?? []).map((x: { project_id: string; name: string }) => ({
        name: x.name,
        sub: n[x.project_id] ? `${n[x.project_id]} open request${n[x.project_id] === 1 ? '' : 's'}` : 'No requests yet',
        id: x.project_id,
      }));
    },
  });

  const payeeQ = useQuery({
    queryKey: ['pqr_payees', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const [{ data: vs }, { data: bills }] = await Promise.all([
        supabase.from('stakeholders').select('stakeholder_id, name, category').eq('type', 'Vendor').is('merged_into', null).order('name'),
        supabase.from('bills').select('stakeholder_id').eq('org_id', orgId),
      ]);
      const n: Record<string, number> = {};
      (bills ?? []).forEach((b: { stakeholder_id: string | null }) => { if (b.stakeholder_id) n[b.stakeholder_id] = (n[b.stakeholder_id] || 0) + 1; });
      return (vs ?? []).map((v: { stakeholder_id: string; name: string; category: string | null }) => ({
        name: v.name,
        sub: [v.category, n[v.stakeholder_id] ? `${n[v.stakeholder_id]} bill${n[v.stakeholder_id] === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || 'On file',
        id: v.stakeholder_id,
      }));
    },
  });

  const request: PqrRequest | null = useMemo(() => {
    if (!pr) return null;
    const wa = waQ.data ?? [];
    const photos = [pr.image_url, ...wa.map((w) => w.raw_image_url)].filter(Boolean) as string[];
    return {
      from: pr.sender_name || wa.find((w) => w.sender_name)?.sender_name || 'WhatsApp',
      when: whenOf(pr.created_at),
      said: wa.map((w) => (w.raw_text || '').trim()).filter(Boolean).join(' · '),
      pages: Math.max(1, photos.length),
      photo: photos[0] || NO_PHOTO,
      project: pr.projects?.name || pr.site_raw || '',
      payee: pr.stakeholders?.name || pr.vendor_raw || '',
      items: [...(pr.purchase_request_items ?? [])]
        .sort((a, b) => (a.item_index ?? 0) - (b.item_index ?? 0))
        .map((r): PqrItem => ({
          rowId: r.id, name: r.item_name || '', qty: str(r.quantity) || '1', unit: r.unit || 'Nos',
          w: str(r.width_mm), h: str(r.height_mm), brand: r.brand || '', spec: r.spec || '',
          note: r.note || '', raw: r.source_line || '', read: r.read_fields || {},
        })),
    };
  }, [pr, waQ.data]);

  if (prQ.isLoading || !request || !pr) return null;

  const projects = projQ.data ?? [];
  const payees = [...extraPayees, ...(payeeQ.data ?? [])];
  const idOf = (list: { name: string; id?: string }[], name: string) =>
    list.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase())?.id ?? null;

  // The desktop page's write, exactly: the header, then the items replaced wholesale.
  const save = async (out: { project: string; payee: string; items: PqrItem[] }) => {
    const siteId = idOf(projects, out.project);
    let vendorId = idOf(payees, out.payee);
    if (!vendorId && out.payee.trim()) vendorId = (await createParty(out.payee.trim(), 'Vendor', pr.org_id)).id;

    const { error: hErr } = await supabase.from('purchase_requests').update({
      site_id: siteId, site_raw: siteId ? null : (out.project.trim() || null),
      vendor_id: vendorId, vendor_raw: vendorId ? null : (out.payee.trim() || null),
    }).eq('id', pr.id);
    if (hErr) throw hErr;

    const { error: dErr } = await supabase.from('purchase_request_items').delete().eq('purchase_request_id', pr.id);
    if (dErr) throw dErr;
    const rows = out.items.filter((it) => it.name.trim()).map((it, i) => ({
      purchase_request_id: pr.id, org_id: pr.org_id, item_index: i,
      item_name: it.name.trim(), quantity: Number(it.qty) || null, unit: it.unit || null,
      note: it.note.trim() || null,
      width_mm: it.w.trim() ? Number(it.w) : null, height_mm: it.h.trim() ? Number(it.h) : null,
      brand: it.brand.trim() || null, spec: it.spec.trim() || null,
      source_line: it.raw || null, read_fields: it.read || {},
    }));
    if (rows.length) { const { error } = await supabase.from('purchase_request_items').insert(rows); if (error) throw error; }
    qc.invalidateQueries({ queryKey: ['purchase_request', pr.id] });
    qc.invalidateQueries({ queryKey: ['daybook_purchase_requests', orgId] });
  };

  // Promote it, the same RPC the desktop page calls. asRfq marks the resulting PO a quotation.
  const promote = async (asRfq: boolean) => {
    const { data, error } = await supabase.rpc('promote_purchase_request_to_po', { p_pr_id: pr.id, p_approver_id: session.user.id });
    const r = data as { success?: boolean; error?: string; po_id?: string } | null;
    if (error || !r?.success || !r.po_id) throw new Error(r?.error || error?.message || 'Could not create it');
    if (asRfq) await supabase.from('purchase_orders').update({ status: 'RFQ' }).eq('po_id', r.po_id);
    navigate(`/purchase-orders/${r.po_id}`);
  };

  return (
    <PurchaseRequestMobile
      request={request}
      projects={projects}
      payees={payees}
      // The desktop page's rule, unchanged: a supervisor raises requests, the office turns them into
      // orders. So the pair the screen becomes after saving is not offered to them at all.
      canOrder={profile?.role === 'management' || profile?.role === 'principal' || profile?.role === 'accountant'}
      onBack={() => navigate('/purchase-orders?status=draft')}
      onCreatePayee={(name) => setExtraPayees((x) => [{ name, sub: 'New party' }, ...x])}
      onSave={save}
      // Undo: put back what was on the books before the save. The draft on screen is left alone.
      onUnsave={() => save({
        project: pr.projects?.name || pr.site_raw || '',
        payee: pr.stakeholders?.name || pr.vendor_raw || '',
        items: request.items,
      })}
      onRequestQuotes={() => { void promote(true); }}
      onCreatePO={() => { void promote(false); }}
      // Nothing reads a second sheet yet, so the page says so rather than pretending.
      onAddPage={() => 'Send the next sheet on WhatsApp and it lands here'}
    />
  );
}
