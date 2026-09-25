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
  sender_name: string | null; wa_message_id: string | null; converted_po_id: string | null; rfq_id: string | null;
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

/* A fast, calm skeleton so the phone screen never flashes blank while the request loads — the shape of
 * what's coming: the quote thumbnail, what was read, and a few item rows. */
function PqrSkeleton() {
  const bar = { display: 'block', borderRadius: 8, background: 'linear-gradient(100deg,#EAE1D2 30%,#F4EEE3 50%,#EAE1D2 70%)', backgroundSize: '200% 100%', animation: 'pqrSk 1.15s ease-in-out infinite' } as React.CSSProperties;
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#F6F1E9', padding: 'calc(16px + env(safe-area-inset-top)) 18px 18px', overflow: 'hidden' }}>
      <style>{'@keyframes pqrSk{from{background-position:200% 0}to{background-position:-200% 0}}'}</style>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <span style={{ ...bar, width: 70, height: 92, borderRadius: 7, flex: 'none' }} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
          <span style={{ ...bar, width: '55%', height: 13 }} />
          <span style={{ ...bar, width: '80%', height: 11 }} />
          <span style={{ ...bar, width: '70%', height: 11 }} />
        </div>
      </div>
      <span style={{ ...bar, width: 120, height: 12, margin: '30px 0 14px' }} />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '14px 0', borderTop: '1px solid #EFE7DC' }}>
          <span style={{ ...bar, width: 28, height: 28, borderRadius: 14, flex: 'none' }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={{ ...bar, width: '60%', height: 12 }} />
            <span style={{ ...bar, width: '35%', height: 9 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* A request that already became a PO or a quote request — the deep link lands here, says what it became,
 * and offers to open it (never re-opens the editable screen). Dark, on-theme, one clear action. */
function PrConvertedNotice({ kind, refLabel, onOpen, onBack }: { kind: 'po' | 'rfq'; refLabel: string; onOpen: () => void; onBack: () => void }) {
  const isPO = kind === 'po';
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#15100C', color: '#FAF8F3', display: 'flex', flexDirection: 'column', padding: 'calc(14px + env(safe-area-inset-top)) 20px calc(20px + env(safe-area-inset-bottom))', fontFamily: "'DM Sans',system-ui,sans-serif", zIndex: 40 }}>
      <button type="button" onClick={onBack} aria-label="Back" style={{ display: 'flex', alignItems: 'center', gap: 6, height: 44, marginLeft: -8, padding: '0 10px', border: 0, borderRadius: 22, background: 'none', color: 'rgba(250,248,243,.75)', font: 'inherit', fontSize: 15, fontWeight: 600 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>Requests
      </button>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: 14, maxWidth: 360, margin: '0 auto' }}>
        <span style={{ width: 66, height: 66, borderRadius: 33, background: isPO ? 'rgba(47,93,58,.9)' : 'rgba(212,99,62,.9)', display: 'grid', placeItems: 'center' }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
        </span>
        <h1 style={{ margin: 0, fontFamily: "'Playfair Display',Georgia,serif", fontWeight: 600, fontSize: 26, lineHeight: 1.15 }}>
          {isPO ? 'This became a purchase order' : 'Quotes have been requested'}
        </h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: 'rgba(250,248,243,.65)' }}>
          {isPO
            ? <>This request is now <b style={{ color: '#FAF8F3', fontFamily: "'DM Mono',ui-monospace,monospace", fontWeight: 500 }}>{refLabel}</b>. Open it to send, receive or bill it.</>
            : <>This request went out to suppliers for quotes. Their rates will land on the enquiry as they reply.</>}
        </p>
      </div>
      <button type="button" onClick={onOpen} style={{ height: 56, border: 0, borderRadius: 28, background: isPO ? '#2F5D3A' : '#B5472A', color: '#fff', fontSize: 16.5, fontWeight: 600, boxShadow: `0 16px 28px -14px ${isPO ? 'rgba(47,93,58,.9)' : 'rgba(181,71,42,.95)'}` }}>
        {isPO ? `Open ${refLabel}` : 'Open the quote request'}
      </button>
    </div>
  );
}

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
        .select('id, org_id, status, created_at, image_url, sender_name, wa_message_id, converted_po_id, rfq_id, site_id, site_raw, vendor_id, vendor_raw, '
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
    queryKey: ['purchase_request_wa', pr?.wa_message_id],
    enabled: !!pr?.wa_message_id,
    queryFn: async () => {
      // The inbound message (text, or the voice transcript) lives on wa_message_log — procurement
      // requests never write a rough_entries row, so the message must come from here.
      const { data } = await supabase.from('wa_message_log')
        .select('content, media_url, created_at')
        .eq('wa_message_id', pr!.wa_message_id!).eq('direction', 'IN')
        .order('created_at', { ascending: true });
      return (data ?? []).map((w: { content: string | null; media_url: string | null }) => ({
        raw_text: w.content, raw_image_url: w.media_url, sender_name: null,
      })) as { raw_text: string | null; raw_image_url: string | null; sender_name: string | null }[];
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
        supabase.from('stakeholders').select('stakeholder_id, name, category, contact').eq('type', 'Vendor').is('merged_into', null).order('name'),
        supabase.from('bills').select('stakeholder_id').eq('org_id', orgId),
      ]);
      const n: Record<string, number> = {};
      (bills ?? []).forEach((b: { stakeholder_id: string | null }) => { if (b.stakeholder_id) n[b.stakeholder_id] = (n[b.stakeholder_id] || 0) + 1; });
      return (vs ?? []).map((v: { stakeholder_id: string; name: string; category: string | null; contact: string | null }) => ({
        name: v.name,
        sub: [v.category, n[v.stakeholder_id] ? `${n[v.stakeholder_id]} bill${n[v.stakeholder_id] === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || 'On file',
        id: v.stakeholder_id,
        phone: v.contact || '',
        bills: n[v.stakeholder_id] || 0,
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

  if (prQ.isLoading || !request || !pr) return <PqrSkeleton />;

  // This request is no longer a draft — it became a PO or went out for quotes. Don't re-open the editable
  // screen (which would let it be ordered twice); say what it became and offer to open it.
  const isPO = !!pr.converted_po_id || pr.status === 'placed' || pr.status === 'fulfilled';
  const isRfq = !isPO && (pr.status === 'quoted' || !!pr.rfq_id);
  if (isPO || isRfq) {
    return (
      <PrConvertedNotice
        kind={isPO ? 'po' : 'rfq'}
        refLabel={isPO ? (pr.converted_po_id || 'the purchase order') : 'the quote request'}
        onOpen={() => navigate(isPO && pr.converted_po_id ? `/purchase-orders/${pr.converted_po_id}` : pr.rfq_id ? `/rfq/${pr.rfq_id}` : '/purchase-orders')}
        onBack={() => navigate('/purchase-orders?status=draft')}
      />
    );
  }

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

    // Replace items ATOMICALLY (delete + insert in one transaction) — a failed write can never leave the
    // request empty (the "edit an item and it vanishes" bug when a spec column was missing).
    const { data, error: iErr } = await supabase.rpc('set_purchase_request_items', {
      p_pr_id: pr.id,
      p_items: out.items.filter((it) => it.name.trim()).map((it) => ({
        item_name: it.name.trim(), quantity: Number(it.qty) ? String(Number(it.qty)) : '', unit: it.unit || '',
        note: it.note.trim(), width_mm: it.w.trim() ? String(Number(it.w) || '') : '', height_mm: it.h.trim() ? String(Number(it.h) || '') : '',
        brand: it.brand.trim(), spec: it.spec.trim(), source_line: it.raw || '', read_fields: it.read || {},
      })),
    });
    const r = data as { success?: boolean; error?: string } | null;
    if (iErr || (r && r.success === false)) throw new Error(r?.error || iErr?.message || 'Could not save the items');
    qc.invalidateQueries({ queryKey: ['purchase_request', pr.id] });
    qc.invalidateQueries({ queryKey: ['daybook_purchase_requests', orgId] });
  };

  // The org's suppliers for the quote flow — bought-from ones (they have bills) float to the top.
  const suppliers = (payeeQ.data ?? []).map((v) => ({ id: v.id, name: v.name, sub: v.sub, phone: v.phone, suggested: v.bills > 0 }));

  // Create the PO — the same RPC the desktop calls — then land on the PO list with the new order
  // highlighted (NOT open the PO). The mobile list reads location.state.freshPoId to light it up.
  const createPO = async () => {
    const { data, error } = await supabase.rpc('promote_purchase_request_to_po', { p_pr_id: pr.id, p_approver_id: session.user.id });
    const r = data as { success?: boolean; error?: string; po_id?: string } | null;
    if (error || !r?.success || !r.po_id) throw new Error(r?.error || error?.message || 'Could not create it');
    qc.invalidateQueries({ queryKey: ['po_list_sheet'] });
    qc.invalidateQueries({ queryKey: ['po_list_pending_prs'] });
    qc.invalidateQueries({ queryKey: ['daybook_purchase_requests', orgId] });
    navigate('/purchase-orders', { state: { freshPoId: r.po_id } });
  };

  // Request quotes — send the WhatsApp RFQ to the picked suppliers via the send-rfq edge function, with
  // this request's items. A brand-new supplier is created (with its number) before the send.
  const sendQuotes = async ({ recipients, note, replyBy }: { recipients: { id?: string; name: string; phone: string }[]; note: string; replyBy: string }) => {
    const days = replyBy === 'Tomorrow' ? 1 : replyBy === 'This week' ? 5 : 2;
    const by = new Date(); by.setDate(by.getDate() + days); by.setHours(18, 0, 0, 0);
    const siteId = idOf(projects, request.project);
    const items = request.items.filter((it) => it.name.trim()).map((it, i) => ({
      line: i + 1, item_name: it.name.trim(), unit: it.unit || null,
      qty: Number(it.qty) || 1, spec: [it.w && it.h ? `${it.w} × ${it.h} mm` : '', it.spec, it.brand].filter(Boolean).join(' · ') || null,
    }));
    const recips = await Promise.all(recipients.map(async (rc) => {
      let id = rc.id;
      if (!id && rc.name.trim()) id = (await createParty(rc.name.trim(), 'Vendor', pr.org_id)).id;
      if (id && rc.phone) await supabase.from('stakeholders').update({ contact: rc.phone }).eq('stakeholder_id', id);
      return { stakeholderId: id, name: rc.name, phone: rc.phone };
    }));
    const { data, error } = await supabase.functions.invoke('send-rfq', {
      body: { orgId: pr.org_id, projectId: siteId, deliveryLocation: request.project || null, quoteBy: by.toISOString(), note: note || null, items, recipients: recips },
    });
    if (error) throw error;
    const res = data as { ok?: boolean; error?: string; rfq_id?: string } | null;
    if (!res?.ok) throw new Error(res?.error || 'Could not send the requests');
    // The request has gone out for quotes — move it out of the review inbox, linked to its enquiry.
    await supabase.from('purchase_requests').update({ status: 'quoted', rfq_id: res.rfq_id ?? null }).eq('id', pr.id);
    qc.invalidateQueries({ queryKey: ['pqr_payees', orgId] });
    qc.invalidateQueries({ queryKey: ['po_list_pending_prs'] });
    qc.invalidateQueries({ queryKey: ['daybook_purchase_requests', orgId] });
  };

  return (
    <PurchaseRequestMobile
      request={request}
      projects={projects}
      payees={payees}
      suppliers={suppliers}
      // The desktop page's rule, unchanged: a supervisor raises requests, the office turns them into
      // orders. So the pair is not offered to them at all.
      canOrder={profile?.role === 'management' || profile?.role === 'principal' || profile?.role === 'accountant'}
      onBack={() => navigate('/purchase-orders?status=draft')}
      onCreatePayee={(name) => setExtraPayees((x) => [{ name, sub: 'New party' }, ...x])}
      onSave={save}
      onCreatePO={createPO}
      onSendQuotes={sendQuotes}
      // Delete the draft (items cascade); leave the screen back to the list.
      onDelete={async () => {
        const { error } = await supabase.from('purchase_requests').delete().eq('id', pr.id);
        if (error) return;
        qc.invalidateQueries({ queryKey: ['po_list_pending_prs'] });
        qc.invalidateQueries({ queryKey: ['daybook_purchase_requests', orgId] });
        navigate('/purchase-orders?status=draft');
      }}
      // Nothing reads a second sheet yet, so the page says so rather than pretending.
      onAddPage={() => 'Send the next sheet on WhatsApp and it lands here'}
    />
  );
}
