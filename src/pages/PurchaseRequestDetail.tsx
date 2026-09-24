// The draft purchase-request card — the WhatsApp reply's link target, and the review surface.
//
// A supervisor photographs / types a materials list on WhatsApp; the webhook stages it as a DRAFT
// purchase_request (with the photo attached). This page is the "Day Book card, but in the PO page",
// styled to match the PO detail page (.podx tokens): everything the model read is EDITABLE — title,
// site, vendor, and each item with its spec — and from here the office turns it into a purchase order
// or a quote request. Vendor + site resolve the SAME way the Day Book review card does (searchPayees /
// project scoring): seeded with what was read, never silently locked to a soft match, always re-pickable.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useUserProfile } from '../App';
import { useOrgId } from '../lib/auth/AuthProvider';
import { WhatsAppGlyph } from '../components/day-book/atoms';
import { searchPayees } from '../lib/payeeSearch';
import { scoreProjectName } from '../lib/projectSearch';
import { NewPartyRow } from '../components/ResolvePopup';
import { useIsMobile } from '../lib/useIsMobile';
import PurchaseRequestMobileHost from '../components/procurement/PurchaseRequestMobileHost';

interface PRItem { item_name: string; quantity: string; unit: string; note: string }
interface PRRow {
  id: string; status: string; title: string | null; image_url: string | null;
  site_id: string | null; site_raw: string | null; vendor_id: string | null; vendor_raw: string | null;
  sender_name: string | null; sender_number: string | null; created_at: string; converted_po_id: string | null;
  projects: { name: string } | null; stakeholders: { name: string } | null;
  purchase_request_items: { item_index: number; item_name: string; quantity: number | null; unit: string | null; note: string | null }[];
}

// A resolve field, modelled on the Day Book review card: a text box seeded with what was read, a LIVE
// suggestion list that opens on focus (ranked by the shared matcher), a ✓ when a real record is chosen,
// a hint when the typed name is not on file, and — for vendors — an inline "add new" that reuses the
// review card's own NewPartyRow. `id` is the chosen record ('' = unresolved / free text in `text`).
function Resolve<T extends { id: string; name: string; sub?: string }>({
  label, text, id, onText, onPick, onClear, rank, placeholder, disabled, unresolvedHint, createKind, onCreated,
}: {
  label: string; text: string; id: string;
  onText: (v: string) => void; onPick: (row: T) => void; onClear: () => void;
  rank: (q: string) => T[]; placeholder: string; disabled?: boolean; unresolvedHint?: string;
  createKind?: 'Vendor'; onCreated?: (id: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const hits = !id ? rank(text).slice(0, 7) : [];
  const canAdd = !!createKind && !id && !!text.trim() && !hits.some((h) => h.name.toLowerCase() === text.trim().toLowerCase());

  if (creating && createKind) {
    return (
      <label className="fld">
        <span>{label}</span>
        <NewPartyRow
          defaultName={text} lockType={createKind}
          onCreated={(nid, nname) => { setCreating(false); onCreated?.(nid, nname); }}
          onCancel={() => setCreating(false)}
        />
      </label>
    );
  }

  return (
    <label className="fld" ref={boxRef as any}>
      <span>{label}</span>
      <div className={`rz${id ? ' ok' : ''}`}>
        <input
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => { onText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
        {id
          ? <button type="button" className="rz-x" title="Change" onClick={onClear} disabled={disabled} aria-label="Change">✕</button>
          : <svg className="rz-i" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>}
        {open && !id && (hits.length > 0 || canAdd) && (
          <div className="rz-drop">
            {hits.map((h) => (
              <button key={h.id} type="button" className="rz-opt" onMouseDown={(e) => { e.preventDefault(); onPick(h); setOpen(false); }}>
                <b>{h.name}</b>{h.sub ? <small>{h.sub}</small> : null}
              </button>
            ))}
            {canAdd && (
              <button type="button" className="rz-add" onMouseDown={(e) => { e.preventDefault(); setOpen(false); setCreating(true); }}>
                + Add “{text.trim()}” as a new {createKind!.toLowerCase()}
              </button>
            )}
          </div>
        )}
      </div>
      {!id && text.trim() && unresolvedHint && <em className="rz-hint">{unresolvedHint}</em>}
    </label>
  );
}

export default function PurchaseRequestDetail({ session }: { session: Session }) {
  const { id } = useParams();
  // On a phone the request has its own screen — the quote as it came in, what was read off it, and
  // the two things it is still missing. This page is the desktop surface and is unchanged.
  const isPhone = useIsMobile();
  const navigate = useNavigate();
  const orgId = useOrgId();
  const { data: profile } = useUserProfile(session.user.id);
  const canAct = profile?.role === 'management' || profile?.role === 'principal' || profile?.role === 'accountant';

  const { data: pr, isLoading } = useQuery({
    queryKey: ['purchase_request', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_requests')
        .select('id, status, title, image_url, site_id, site_raw, vendor_id, vendor_raw, sender_name, sender_number, created_at, converted_po_id, projects(name), stakeholders(name), purchase_request_items(item_index, item_name, quantity, unit, note)')
        .eq('id', id).single();
      if (error) throw error;
      return data as unknown as PRRow;
    },
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['pr_projects', orgId],
    enabled: !!orgId,
    queryFn: async () => (await supabase.from('projects').select('project_id, name').eq('org_id', orgId).eq('status', 'Active').order('name')).data ?? [],
  });
  const { data: vendors = [] } = useQuery({
    queryKey: ['pr_vendors', orgId],
    enabled: !!orgId,
    queryFn: async () => (await supabase.from('stakeholders').select('stakeholder_id, name, category, aliases').eq('org_id', orgId).eq('type', 'Vendor').is('merged_into', null).order('name')).data ?? [],
  });

  // ── editable form state, seeded from the request ──
  const [title, setTitle] = useState('');
  const [siteId, setSiteId] = useState('');
  const [siteText, setSiteText] = useState('');       // what's shown/typed in the site field
  const [vendorId, setVendorId] = useState('');
  const [vendorText, setVendorText] = useState('');   // what's shown/typed in the vendor field
  const [items, setItems] = useState<PRItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    if (!pr) return;
    setTitle(pr.title ?? '');
    setSiteId(pr.site_id ?? '');
    setSiteText(pr.projects?.name ?? pr.site_raw ?? '');
    setVendorId(pr.vendor_id ?? '');
    setVendorText(pr.stakeholders?.name ?? pr.vendor_raw ?? '');
    setItems([...(pr.purchase_request_items ?? [])].sort((a, b) => a.item_index - b.item_index)
      .map((it) => ({ item_name: it.item_name, quantity: it.quantity != null ? String(it.quantity) : '', unit: it.unit ?? '', note: it.note ?? '' })));
    setDirty(false);
  }, [pr]);

  const alreadyPo = !!pr?.converted_po_id;
  const touch = () => setDirty(true);
  const setItem = (i: number, patch: Partial<PRItem>) => { setItems((p) => p.map((it, j) => (j === i ? { ...it, ...patch } : it))); touch(); };
  const addItem = () => { setItems((p) => [...p, { item_name: '', quantity: '', unit: '', note: '' }]); touch(); };
  const delItem = (i: number) => { setItems((p) => p.filter((_, j) => j !== i)); touch(); };

  const cleanItems = useMemo(() => items.filter((it) => it.item_name.trim()), [items]);

  // Resolve rankers — the SAME matchers the Day Book review card uses, so a name found there is found here.
  const rankVendor = (q: string) =>
    searchPayees(vendors as any[], q).map((v: any) => ({ id: v.stakeholder_id, name: v.name, sub: v.category || undefined }));
  const rankSite = (q: string) => {
    const n = q.trim().toLowerCase();
    if (!n) return (projects as any[]).map((p) => ({ id: p.project_id, name: p.name }));   // focus with no text → the whole list
    return (projects as any[])
      .map((p) => ({ id: p.project_id, name: p.name, r: scoreProjectName(n, p.name) }))
      .filter((p) => p.r >= 0.3).sort((a, b) => b.r - a.r)
      .map(({ id, name }) => ({ id, name }));
  };

  // Persist the edits: header on purchase_requests, items replaced wholesale (delete + insert).
  const save = useMutation({
    mutationFn: async () => {
      const { error: e1 } = await supabase.from('purchase_requests').update({
        title: title.trim() || null,
        site_id: siteId || null,
        site_raw: siteId ? null : (siteText.trim() || null),
        vendor_id: vendorId || null,
        vendor_raw: vendorId ? null : (vendorText.trim() || null),
      }).eq('id', id);
      if (e1) throw e1;
      await supabase.from('purchase_request_items').delete().eq('purchase_request_id', id);
      if (cleanItems.length) {
        const { error: e2 } = await supabase.from('purchase_request_items').insert(cleanItems.map((it, i) => ({
          purchase_request_id: id, org_id: orgId, item_index: i,
          item_name: it.item_name.trim(),
          quantity: it.quantity.trim() ? Number(it.quantity.replace(/[^\d.]/g, '')) || null : null,
          unit: it.unit.trim() || null, note: it.note.trim() || null,
        })));
        if (e2) throw e2;
      }
    },
    onSuccess: () => { setDirty(false); setMsg('Saved'); setTimeout(() => setMsg(null), 1800); },
    onError: (e) => setMsg((e as Error)?.message || 'Could not save'),
  });

  // Promote to a real PO (items copied by the RPC). asRfq → mark the resulting PO a quotation.
  const create = useMutation({
    mutationFn: async (asRfq: boolean) => {
      if (dirty) await save.mutateAsync();
      const { data, error } = await supabase.rpc('promote_purchase_request_to_po', { p_pr_id: id, p_approver_id: session.user.id });
      const r = data as { success?: boolean; error?: string; po_id?: string } | null;
      if (error || !r?.success || !r.po_id) throw new Error(r?.error || error?.message || 'Could not create it');
      if (asRfq) await supabase.from('purchase_orders').update({ status: 'RFQ' }).eq('po_id', r.po_id);
      return r.po_id;
    },
    onSuccess: (poId, asRfq) => {
      // Land on the new order with a success beat, and leave the LIST behind it so Back returns there
      // (not to this now-converted request). replace drops the request; the push adds the order.
      navigate('/purchase-orders?status=draft', { replace: true });
      navigate(`/purchase-orders/${poId}`, { state: { justCreated: true, createdKind: asRfq ? 'rfq' : 'po' } });
    },
    onError: (e) => setMsg((e as Error)?.message || 'Could not create it'),
  });

  // Discard a draft request (items cascade). Only a not-yet-promoted draft can be deleted.
  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('purchase_requests').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => navigate('/purchase-orders?status=draft'),
    onError: (e) => setMsg((e as Error)?.message || 'Could not delete it'),
  });

  if (isPhone && id) return <PurchaseRequestMobileHost id={id} session={session} />;
  if (isLoading) return (
    <div className="prx"><style>{CSS}</style><div className="page">
      <div className="crumb"><span className="sk sk-t" style={{ width: 150 }} /></div>
      <div className="head"><span className="sk sk-h1" /><div className="meta"><span className="sk sk-t" style={{ width: 90 }} /><span className="sk sk-t" style={{ width: 130 }} /></div></div>
      <div className="grid">
        <div className="col">
          <div className="card facts"><span className="sk sk-fld" /><span className="sk sk-fld" /></div>
          <div className="card"><span className="sk sk-t" style={{ width: 70, marginBottom: 12 }} />{[0, 1, 2, 3].map((i) => <span key={i} className="sk sk-row" />)}</div>
        </div>
        <div className="col side"><span className="sk sk-t" style={{ width: 70, marginBottom: 10 }} /><span className="sk sk-photo" /></div>
      </div>
    </div></div>
  );
  if (!pr) return (
    <div className="prx"><style>{CSS}</style><div className="page">
      <div className="crumb"><a onClick={() => navigate('/purchase-orders?status=draft')}>Purchase orders</a> › <b>Request</b></div>
      <div className="empty">This request was not found.</div>
    </div></div>
  );

  const fromWa = !!pr.sender_number;
  const busy = save.isPending || create.isPending;
  const dateStr = new Date(pr.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="prx">
      <style>{CSS}</style>
      <div className="page">
        <div className="crumb"><a onClick={() => navigate('/purchase-orders?status=draft')}>Purchase orders</a> › <b>Materials request</b></div>

        <header className="head">
          <div className="hl">
            <input className="h1" value={title} onChange={(e) => { setTitle(e.target.value); touch(); }} placeholder="Materials request" aria-label="Title" />
            <div className="meta">
              <span className={`tag ${alreadyPo ? 'ok' : 'draft'}`}>{alreadyPo ? 'Promoted' : 'Draft request'}</span>
              {fromWa && <span className="wa"><WhatsAppGlyph size={13} color="#1FA855" /> from WhatsApp{pr.sender_name ? ` · ${pr.sender_name}` : ''}</span>}
              <span>· {dateStr}</span>
            </div>
          </div>
        </header>

        <div className="grid">
          <div className="col">
            <div className="card facts">
              <Resolve
                label="Vendor" text={vendorText} id={vendorId}
                placeholder="Not set — search a vendor" disabled={alreadyPo}
                rank={rankVendor}
                createKind="Vendor"
                onCreated={(nid, nname) => { setVendorId(nid); setVendorText(nname); touch(); }}
                onText={(v) => { setVendorText(v); setVendorId(''); touch(); }}
                onPick={(r) => { setVendorId(r.id); setVendorText(r.name); touch(); }}
                onClear={() => { setVendorId(''); touch(); }}
                unresolvedHint="Not one of your vendors yet — pick one, add them, or leave it for the office."
              />
              <Resolve
                label="Site" text={siteText} id={siteId}
                placeholder="Choose a site" disabled={alreadyPo}
                rank={rankSite}
                onText={(v) => { setSiteText(v); setSiteId(''); touch(); }}
                onPick={(r) => { setSiteId(r.id); setSiteText(r.name); touch(); }}
                onClear={() => { setSiteId(''); touch(); }}
                unresolvedHint="No site matched — pick the right one before creating the order."
              />
            </div>

            <div className="card">
              <div className="ch">Items <em>{cleanItems.length}</em></div>
              <div className="items">
                <div className="ih"><span>Item</span><span className="q">Qty</span><span className="u">Unit</span><span className="n">Spec / detail</span><span className="x" /></div>
                {items.map((it, i) => (
                  <div className="irow" key={i}>
                    <input value={it.item_name} onChange={(e) => setItem(i, { item_name: e.target.value })} placeholder="Material" disabled={alreadyPo} />
                    <input className="q" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} inputMode="decimal" placeholder="—" disabled={alreadyPo} />
                    <input className="u" value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })} placeholder="unit" disabled={alreadyPo} />
                    <input className="n" value={it.note} onChange={(e) => setItem(i, { note: e.target.value })} placeholder="size · glass · system · finish…" disabled={alreadyPo} />
                    {!alreadyPo && <button className="rm" title="Remove" onClick={() => delItem(i)}>✕</button>}
                  </div>
                ))}
              </div>
              {!alreadyPo && <button className="addrow" onClick={addItem}>+ Add item</button>}
            </div>

            {!alreadyPo && (
              <div className="actions">
                {/* Anyone on the request can save their edits — a supervisor raises and edits requests. */}
                <button className="ghost" disabled={!dirty || busy} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save'}</button>
                <span className="sp" />
                {/* Placing the order is the office's call — management / principal / accountant only. */}
                {canAct && <>
                  <button className="prim2" disabled={busy} onClick={() => create.mutate(true)}>Request quotes</button>
                  <button className="prim" disabled={busy} onClick={() => create.mutate(false)}>{create.isPending ? 'Creating…' : 'Create purchase order'}</button>
                </>}
              </div>
            )}
            {alreadyPo && <div className="actions"><button className="prim" onClick={() => navigate(`/purchase-orders/${pr.converted_po_id}`)}>Open purchase order {pr.converted_po_id}</button></div>}
            {msg && <p className="msg">{msg}</p>}

            {!alreadyPo && canAct && (
              <div className="danger">
                {!confirmDel
                  ? <button className="del" onClick={() => setConfirmDel(true)}>Delete request</button>
                  : <span className="delc">Delete this request?
                      <button className="delyes" disabled={del.isPending} onClick={() => del.mutate()}>{del.isPending ? 'Deleting…' : 'Delete'}</button>
                      <button className="delno" onClick={() => setConfirmDel(false)}>Keep</button>
                    </span>}
              </div>
            )}
          </div>

          <div className="col side">
            <div className="ch">The photo</div>
            {pr.image_url
              ? <a href={pr.image_url} target="_blank" rel="noreferrer" className="photo"><img src={pr.image_url} alt="Materials request" /></a>
              : <div className="card empty sm">No photo — this request came in as text.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.prx{--cream:#F6F2EA;--paper:#FFFDF9;--paper-2:#FBF8F2;--ink:#2F2622;--ink-2:#6E635B;--ink-3:#A39A91;
  --line:#E4DCD0;--line-2:#EFE9DF;--terra:#C4502B;--terra-deep:#A8431F;--sage:#5F7F5B;--sage-tint:#E7EFE4;
  --gold:#B8862E;--gold-tint:#F7EEDA;--serif:"Playfair Display",Georgia,serif;--sans:"DM Sans",system-ui,sans-serif;--mono:"DM Mono",ui-monospace,monospace;
  background:var(--cream);min-height:100vh;color:var(--ink);font:15px/1.45 var(--sans);-webkit-font-smoothing:antialiased}
.prx *{box-sizing:border-box}
.prx .page{max-width:1000px;margin:0 auto;padding:22px 32px 90px}
.prx .crumb{display:flex;align-items:center;gap:6px;color:var(--ink-3);font-size:13px;margin-bottom:16px}
.prx .crumb a{color:var(--ink-2);text-decoration:none;cursor:pointer;padding:4px 6px;border-radius:6px;margin-left:-6px}
.prx .crumb a:hover{background:var(--paper);color:var(--terra)}
.prx .crumb b{color:var(--ink);font-weight:500}
.prx .head{margin-bottom:18px}
.prx .h1{font:600 28px/1.1 var(--serif);letter-spacing:-.01em;border:0;border-bottom:1px dashed transparent;background:none;color:var(--ink);width:100%;padding:2px 0;outline:none}
.prx .h1:hover,.prx .h1:focus{border-bottom-color:var(--line)}
.prx .meta{display:flex;align-items:center;gap:6px 14px;flex-wrap:wrap;margin-top:9px;color:var(--ink-2);font-size:13.5px}
.prx .tag{font:500 12.5px/1 var(--mono);letter-spacing:.04em;padding:6px 9px;border-radius:6px;border:1px solid var(--line);background:var(--paper)}
.prx .tag.draft{color:#8A5A0B;background:var(--gold-tint);border-color:#EBD9B4}
.prx .tag.ok{color:var(--sage);background:var(--sage-tint);border-color:#CFE0C9}
.prx .wa{display:inline-flex;align-items:center;gap:6px}
.prx .grid{display:grid;grid-template-columns:1fr 320px;gap:18px}
.prx .card{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:14px}
.prx .fld{display:block;margin-bottom:12px;position:relative}
.prx .fld:last-child{margin-bottom:0}
.prx .fld>span{display:block;font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);margin-bottom:6px}
.prx .rz{position:relative;display:flex;align-items:center}
.prx .rz input{width:100%;height:42px;border:1px solid var(--line);border-radius:9px;background:var(--paper);padding:0 34px 0 12px;font:inherit;color:var(--ink);outline:none}
.prx .rz.ok input{border-color:#CFE0C9;background:#FCFDFB}
.prx .rz input:focus{border-color:var(--terra)}
.prx .rz-i{position:absolute;right:12px;color:var(--ink-3);pointer-events:none}
.prx .rz-x{position:absolute;right:8px;width:24px;height:24px;border:0;background:none;color:var(--ink-3);border-radius:6px;cursor:pointer;font-size:12px}
.prx .rz-x:hover{background:#F8E7DE;color:var(--terra)}
.prx .rz-drop{position:absolute;z-index:30;top:46px;left:0;right:0;background:var(--paper);border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 30px rgba(60,45,30,.14);overflow-y:auto;max-height:264px}
.prx .rz-opt{display:flex;align-items:baseline;gap:8px;width:100%;text-align:left;border:0;border-top:1px solid var(--line-2);background:none;font:inherit;color:var(--ink);padding:9px 12px;cursor:pointer}
.prx .rz-opt:first-child{border-top:0}
.prx .rz-opt:hover{background:var(--paper-2)}
.prx .rz-opt b{font-weight:500;font-size:14px}
.prx .rz-opt small{color:var(--ink-3);font-size:12px}
.prx .rz-add{display:block;width:100%;text-align:left;border:0;border-top:1px solid var(--line-2);background:var(--gold-tint);color:#8A5A0B;font:inherit;font-weight:600;font-size:13px;padding:10px 12px;cursor:pointer;position:sticky;bottom:0}
.prx .rz-add:hover{background:#F1E4C2}
.prx .rz-hint{display:block;margin-top:6px;font-size:12px;font-style:normal;color:#8A5A0B}
.prx .ch{font:600 11.5px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2);margin:0 0 12px;display:flex;align-items:center;gap:10px}
.prx .ch em{font-style:normal;color:var(--ink-3)}
.prx .items .ih,.prx .items .irow{display:grid;grid-template-columns:1.5fr 62px 72px 1.6fr 28px;gap:8px;align-items:center}
.prx .items .ih{font-size:11px;letter-spacing:.04em;color:var(--ink-3);padding:0 2px 7px}
.prx .items .irow{margin-bottom:7px}
.prx .items input{height:38px;border:1px solid var(--line);border-radius:8px;background:var(--paper);padding:0 10px;font:inherit;font-size:14px;color:var(--ink);outline:none;min-width:0}
.prx .items input:focus{border-color:var(--terra)}
.prx .items input.q{font-family:var(--mono);text-align:right}
.prx .items input.n{color:var(--ink-2)}
.prx .items .rm{width:28px;height:28px;border:0;background:none;color:var(--ink-3);border-radius:6px;cursor:pointer;font-size:12px}
.prx .items .rm:hover{background:#F8E7DE;color:var(--terra)}
.prx .addrow{margin-top:5px;background:none;border:1px dashed var(--line);border-radius:9px;color:var(--ink-2);font:inherit;padding:9px 12px;cursor:pointer;width:100%}
.prx .addrow:hover{border-color:var(--terra);color:var(--terra)}
.prx .actions{display:flex;align-items:center;gap:10px;margin-top:6px}
.prx .actions .sp{flex:1}
.prx .actions button{height:44px;padding:0 18px;border-radius:10px;font:inherit;font-weight:600;cursor:pointer;border:1px solid var(--line);background:var(--paper);color:var(--ink)}
.prx .actions .ghost:disabled{opacity:.45;cursor:default}
.prx .actions .prim{background:var(--terra);border-color:var(--terra);color:#fff}
.prx .actions .prim:hover{background:var(--terra-deep)}
.prx .actions .prim2{background:var(--gold-tint);border-color:#EBD9B4;color:#8A5A0B}
.prx .actions button:disabled{opacity:.55;cursor:default}
.prx .msg{margin:10px 0 0;font-size:13px;color:var(--sage)}
.prx .danger{margin-top:20px;padding-top:14px;border-top:1px dashed var(--line)}
.prx .del{background:none;border:0;color:var(--ink-3);font:inherit;font-size:13px;cursor:pointer;padding:4px 0}
.prx .del:hover{color:var(--terra)}
.prx .delc{display:inline-flex;align-items:center;gap:10px;font-size:13px;color:var(--ink-2)}
.prx .delyes{background:#F8E7DE;border:1px solid #E7C4B4;color:var(--terra);font:inherit;font-weight:600;font-size:13px;padding:6px 13px;border-radius:8px;cursor:pointer}
.prx .delyes:hover{background:#F2D6C8}
.prx .delno{background:none;border:0;color:var(--ink-2);font:inherit;font-size:13px;cursor:pointer;text-decoration:underline}
.prx .side .ch{margin-bottom:10px}
.prx .side .photo{display:block;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--paper)}
.prx .side .photo img{display:block;width:100%;height:auto}
.prx .empty{padding:36px 16px;text-align:center;color:var(--ink-3)}
.prx .empty.sm{padding:18px;font-size:13px}
.prx .sk{display:block;border-radius:8px;background:linear-gradient(100deg,var(--line-2) 30%,#F3ECE0 50%,var(--line-2) 70%);background-size:200% 100%;animation:prxShim 1.15s ease-in-out infinite}
@keyframes prxShim{from{background-position:200% 0}to{background-position:-200% 0}}
.prx .sk-t{height:12px}
.prx .sk-h1{height:30px;width:60%;margin:2px 0 0;border-radius:9px}
.prx .sk-fld{height:42px;margin-bottom:12px;border-radius:9px}
.prx .sk-fld:last-child{margin-bottom:0}
.prx .sk-row{height:38px;margin-bottom:8px;border-radius:8px}
.prx .sk-photo{height:220px;border-radius:12px}
@media (max-width:820px){
  .prx .page{padding:16px 16px 90px}
  .prx .grid{grid-template-columns:1fr}
  .prx .col.side{order:-1}
  .prx .items .ih,.prx .items .irow{grid-template-columns:1.4fr 50px 58px 28px}
  .prx .items .n{display:none}
}
`;
