// Desktop Purchase-orders list — an exact port of the reference artifact, wired to real data.
//
// The reference's own left rail + page chrome are dropped (the app owns those); this renders the
// reference's scrollable main content under `.pox`. Everything is wired to the real hooks + actions:
//   the WhatsApp INBOX = draft purchase_requests (Review → the request page, Make PO → promote RPC),
//   the TABLE = live/fulfilled POs grouped by where each one is (send · sent · received · billed · paid),
//   Send to vendor = the existing SendToVendorModal, a pending PO shows Approve (decide_purchase_order).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth/AuthProvider';
import { useOrgId } from '../../lib/auth/AuthProvider';
import { useUserProfile } from '../../App';
import { searchPayees } from '../../lib/payeeSearch';
import { scoreProjectName } from '../../lib/projectSearch';
import { createParty } from '../day-book/fileEntry';
import SendToVendorModal from '../po-new-ui/SendToVendorModal';
import { usePOListData, usePendingPRs, useOpenRfqs, type PORow, type PendingPR, type RfqRow } from './POListSheet';
import { PO_LIST_DESKTOP_CSS } from './poListDesktopCss';

type Opt = { id: string; name: string; sub?: string };

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const D = (s: string | null) => (s ? new Date(s) : new Date(NaN));
const dstr = (d: Date) => (isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
const short = (s: string) => (s || '').replace(' Residence', '').replace(' Apartments', '').replace("'s", '');
const initials = (n: string) => (n || '').replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
// A stable warm dot colour per site name (the reference hand-picks; here we hash into the same palette).
const SITE_PAL = ['#B5472A', '#7E9A77', '#C08A2B', '#5E7D9A', '#8A6D3B', '#6B8E7A', '#A6603C'];
const siteColor = (s: string) => { let h = 0; for (let i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return SITE_PAL[h % SITE_PAL.length]; };

const Tick = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>;
const Wa = ({ style }: { style?: React.CSSProperties }) => <svg viewBox="0 0 24 24" aria-hidden="true" style={style}><path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.6-1.2A9 9 0 1 0 12 3Z" /></svg>;

type Stage = 'pending' | 'send' | 'sent' | 'recv' | 'bill' | 'paid';
function stageOf(p: PORow): Stage {
  if (p.approvalStatus === 'PENDING' && !p.cancelled) return 'pending';
  const received = !!p.recv;
  const billed = p.billed > 0.5;
  if (billed && p.paid >= p.billed - 0.5) return 'paid';
  if (received && billed) return 'bill';
  if (received) return 'recv';
  if (p.sent) return 'sent';
  return 'send';
}
type Grp = 'wait' | 'recv' | 'bill' | 'paid';
const grpOf = (st: Stage): Grp => (st === 'send' || st === 'sent' || st === 'pending' ? 'wait' : st);
const GROUPS: Record<Grp, [string, string]> = {
  wait: ['Awaiting delivery', ''], recv: ['Received, no bill', 'Ask the vendor for the bill, or attach it'],
  bill: ['To pay', ''], paid: ['Fulfilled', 'Received, billed and paid'],
};
const balanceOf = (p: PORow) => Math.max(0, p.billed - p.paid);
const isLate = (p: PORow) => !p.recv && !!p.due && !isNaN(D(p.due).getTime()) && D(p.due).getTime() < Date.now();

export default function POListDesktop({ projectId }: { projectId?: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const orgId = useOrgId();
  const { userId } = useAuth();
  const { data: profile } = useUserProfile(userId ?? '');
  const canApprove = profile?.role === 'management' || profile?.role === 'principal';
  const canOrder = profile?.role === 'management' || profile?.role === 'principal' || profile?.role === 'accountant';

  const { rows, isLoading } = usePOListData(projectId);
  const { data: pending = [] } = usePendingPRs(projectId);
  const { data: rfqs = [] } = useOpenRfqs(projectId);
  // The org's projects + vendors — feed the peek's resolve fields.
  const { data: projects = [] } = useQuery({
    queryKey: ['pox_projects', orgId], enabled: !!orgId,
    queryFn: async (): Promise<Opt[]> => ((await supabase.from('projects').select('project_id, name').eq('org_id', orgId).eq('status', 'Active').order('name')).data ?? []).map((p: any) => ({ id: p.project_id, name: p.name })),
  });
  const { data: vendors = [] } = useQuery({
    queryKey: ['pox_vendors', orgId], enabled: !!orgId,
    queryFn: async (): Promise<Opt[]> => ((await supabase.from('stakeholders').select('stakeholder_id, name, category').eq('org_id', orgId).eq('type', 'Vendor').is('merged_into', null).order('name')).data ?? []).map((v: any) => ({ id: v.stakeholder_id, name: v.name, sub: v.category || undefined })),
  });

  const [tab, setTab] = useState<'active' | 'done' | 'quotes'>('active');
  const [q, setQ] = useState('');
  const [sendRow, setSendRow] = useState<PORow | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const say = (t: string) => { setToast(t); window.clearTimeout((say as any)._t); (say as any)._t = window.setTimeout(() => setToast(''), 2400); };

  const openPO = (id: string) => navigate(`/purchase-orders/${id}`, { state: projectId ? { from: 'project', projectId } : { from: 'list' } });

  const live = rows.filter((p) => !p.cancelled && stageOf(p) !== 'paid');
  const fulfilled = rows.filter((p) => !p.cancelled && stageOf(p) === 'paid');
  const owed = live.reduce((a, p) => a + balanceOf(p), 0);
  const lateCount = live.filter(isLate).length;

  const approve = useMutation({
    mutationFn: async (poId: string) => {
      const { data, error } = await supabase.rpc('decide_purchase_order', { p_po_id: poId, p_action: 'APPROVE' });
      const r = data as { success?: boolean; error?: string } | null;
      if (error || !r?.success) throw new Error(r?.error === 'The creator of a PO cannot approve it' ? "You can't approve a PO you created — ask another approver." : (r?.error || error?.message || 'Could not approve'));
    },
    onMutate: (id) => setBusyId(id),
    onSettled: () => setBusyId(null),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['po_list_sheet'] }); say('Order approved — released'); },
    onError: (e) => say((e as Error).message),
  });

  const makePO = useMutation({
    mutationFn: async ({ prId, asRfq }: { prId: string; asRfq: boolean }) => {
      const { data, error } = await supabase.rpc('promote_purchase_request_to_po', { p_pr_id: prId, p_approver_id: userId });
      const r = data as { success?: boolean; error?: string; po_id?: string } | null;
      if (error || !r?.success || !r.po_id) throw new Error(r?.error || error?.message || 'Could not make the PO');
      if (asRfq) await supabase.from('purchase_orders').update({ status: 'RFQ' }).eq('po_id', r.po_id);
      return r.po_id;
    },
    onMutate: ({ prId }) => setBusyId(prId),
    onSettled: () => setBusyId(null),
    onSuccess: (poId, { asRfq }) => {
      qc.invalidateQueries({ queryKey: ['po_list_pending_prs'] });
      qc.invalidateQueries({ queryKey: ['po_list_sheet'] });
      setPeekId(null);
      navigate('/purchase-orders?status=draft', { replace: true });
      navigate(`/purchase-orders/${poId}`, { state: { justCreated: true, createdKind: asRfq ? 'rfq' : 'po' } });
    },
    onError: (e) => say((e as Error).message),
  });

  // ── table rows for the current tab + search ──
  const ql = q.trim().toLowerCase();
  const visiblePOs = useMemo(() => rows.filter((p) => {
    if (p.cancelled) return false;
    const st = stageOf(p);
    if (tab === 'active' ? st === 'paid' : tab === 'done' ? st !== 'paid' : true) return false;
    if (tab === 'quotes') return false;   // quotes tab shows RFQs, handled separately
    return !ql || (p.vendor + ' ' + p.id + ' ' + p.site + ' ' + p.items.map((i) => i.n).join(' ')).toLowerCase().includes(ql);
  }), [rows, tab, ql]);

  const visibleRfqs = tab === 'quotes' ? rfqs.filter((r) => !ql || (r.site + ' ' + r.summary).toLowerCase().includes(ql)) : [];

  return (
    <div className="pox">
      <style>{PO_LIST_DESKTOP_CSS}</style>
      <div className="wrap">
        <header className="top">
          <div>
            <h1>Purchase orders</h1>
            <p><b>{inr(owed)}</b> owed to vendors on <b>{live.length}</b> live order{live.length !== 1 ? 's' : ''} · {lateCount > 0 ? <b style={{ color: 'var(--clay)' }}>{lateCount} late</b> : <span className="ok">nothing late</span>}</p>
          </div>
          <div className="acts">
            <button type="button" className="btn" onClick={() => navigate('/purchase-orders/new?mode=rfq')}><svg viewBox="0 0 24 24"><path d="M4 6.5h16v11H4z" /><path d="m4 7 8 6 8-6" /></svg>Request quotes</button>
            <button type="button" className="btn pri" onClick={() => navigate('/purchase-orders/new')}><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>New PO</button>
          </div>
        </header>

        {/* the inbox */}
        <section className={`inbox${pending.length ? '' : ' clear'}`}>
          <div className="hd">
            <span className="mark"><Wa /></span>
            {pending.length
              ? <><h2>Waiting from WhatsApp<b>{pending.length}</b></h2><span className="n">Not orders yet. Check each one, then make the PO.</span></>
              : <><h2>Nothing waiting from WhatsApp</h2><span className="n">Requests your site sends on WhatsApp land here to review.</span></>}
          </div>
          {pending.map((r) => <ReqRow key={r.id} r={r} canOrder={canOrder} busy={busyId === r.id}
            onPhoto={() => r.imageUrl && setViewer(r.imageUrl)} onReview={() => setPeekId(r.id)} onMake={() => makePO.mutate({ prId: r.id, asRfq: false })} />)}
        </section>

        {/* tools */}
        <div className="tools">
          <label className="find"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
            <input type="search" placeholder="Vendor, item, site or PO number" aria-label="Search orders" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          {ql && <p className="result"><b>{tab === 'quotes' ? visibleRfqs.length : visiblePOs.length}</b> {(tab === 'quotes' ? visibleRfqs.length : visiblePOs.length) === 1 ? 'order' : 'orders'}<button type="button" onClick={() => setQ('')}>Show all</button></p>}
          <div className="tabs" role="tablist">
            {([['active', 'Live', live.length], ['done', 'Fulfilled', fulfilled.length], ['quotes', 'Quotes', rfqs.length + rows.filter((p) => p.rfq).length]] as const).map(([k, label, n]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}<em>{n}</em></button>
            ))}
          </div>
        </div>

        {/* the table */}
        <section className="tbl">
          <div className="tr th"><div>Vendor · PO</div><div>Items</div><div>Site</div><div>Ordered</div><div>Where it is</div><div className="r">Owed</div></div>
          {isLoading ? <div className="empty">Loading…</div>
            : tab === 'quotes'
              ? (visibleRfqs.length ? visibleRfqs.map((r) => <RfqTr key={r.rfq_id} r={r} onOpen={() => navigate(`/rfq/${r.rfq_id}`)} />)
                : <div className="empty"><b>No open quotes</b>Ask vendors to quote from Request quotes.</div>)
              : (() => {
                const order: Grp[] = tab === 'active' ? ['wait', 'recv', 'bill'] : ['paid'];
                const groups = order.filter((g) => visiblePOs.some((p) => grpOf(stageOf(p)) === g));
                if (!groups.length) return <div className="empty"><b>No orders here</b>{ql ? 'Try another word, or clear the search.' : 'Nothing to show in this tab.'}</div>;
                return groups.map((g) => {
                  const gr = visiblePOs.filter((p) => grpOf(stageOf(p)) === g);
                  const gOwed = gr.reduce((a, p) => a + (stageOf(p) === 'bill' ? balanceOf(p) : 0), 0);
                  return (
                    <div key={g}>
                      <div className="grp"><h4>{GROUPS[g][0]}<small>{gr.length}</small></h4><span>{g === 'bill' ? <><b>{inr(gOwed)}</b> owed</> : GROUPS[g][1]}</span></div>
                      {gr.map((p) => <PoTr key={p.id} p={p} canApprove={canApprove} busy={busyId === p.id}
                        onOpen={() => openPO(p.id)} onSend={() => setSendRow(p)} onApprove={() => approve.mutate(p.id)} onAttach={() => openPO(p.id)} />)}
                    </div>
                  );
                });
              })()}
          <div className="foot">
            <span>{tab === 'active' ? `${live.length} live order${live.length !== 1 ? 's' : ''}` : tab === 'done' ? `${fulfilled.length} fulfilled` : `${rfqs.length} open quote${rfqs.length !== 1 ? 's' : ''}`}</span>
            <span>Owed on these · <b>{inr(visiblePOs.filter((p) => stageOf(p) === 'bill').reduce((a, p) => a + balanceOf(p), 0))}</b></span>
          </div>
        </section>
      </div>

      {/* side peek — a request, fully editable (the request page, in place) */}
      <div className={`pox-scrim${peekId ? ' on' : ''}`} onClick={() => setPeekId(null)} />
      <aside className={`pox-peek${peekId ? ' on' : ''}`} aria-live="polite">
        {peekId && <PeekEditor key={peekId} prId={peekId} orgId={orgId ?? ''} projects={projects} vendors={vendors} canOrder={canOrder}
          creating={busyId === peekId}
          onClose={() => setPeekId(null)} onPhoto={(url) => setViewer(url)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['po_list_pending_prs'] }); qc.invalidateQueries({ queryKey: ['po_list_sheet'] }); }}
          onCreate={(asRfq) => makePO.mutate({ prId: peekId, asRfq })} />}
      </aside>

      <div className={`pox-viewer${viewer ? ' on' : ''}`} role="dialog" aria-modal="true" onClick={() => setViewer(null)}>{viewer && <img src={viewer} alt="The request photo" />}</div>
      <div className={`pox-toast${toast ? ' on' : ''}`} role="status">{toast}</div>

      {sendRow && (
        <SendToVendorModal open={!!sendRow} poId={sendRow.id} vendorId={sendRow.stakeholderId} vendorName={sendRow.vendor}
          vendorContact={sendRow.vendorContact} projectName={sendRow.site}
          totalLabel={sendRow.rfq || sendRow.value <= 0 ? undefined : inr(sendRow.value)} onClose={() => setSendRow(null)} />
      )}
    </div>
  );
}

// ── an inbox request row ──
function needsOf(r: PendingPR): [string, string][] { return [['Project', r.site], ['Supplier', r.supplier]]; }
const ready = (r: PendingPR) => needsOf(r).every((x) => x[1]);

function ReqRow({ r, canOrder, busy, onPhoto, onReview, onMake }: { r: PendingPR; canOrder: boolean; busy: boolean; onPhoto: () => void; onReview: () => void; onMake: () => void }) {
  return (
    <div className="req">
      {r.pages
        ? <button type="button" className="paper" aria-label="See the photo" onClick={onPhoto}>{r.imageUrl && <img src={r.imageUrl} alt="" />}<span className="pg">{r.pages} page</span></button>
        : <div className="paper" style={{ background: 'none', boxShadow: 'none', border: '1.5px dashed var(--line-2)', cursor: 'default' }} />}
      <div className="what"><b>{r.title}</b><span>{r.items.length} {r.items.length === 1 ? 'item' : 'items'} read {r.pages ? 'from the photo' : 'from the message'}</span>{r.said && <i title={r.said}>“{r.said}”</i>}</div>
      <div className="who"><span className="av">{initials(r.from)}</span><div>{r.from}<span>{r.when}</span></div></div>
      <div className={`site${r.site ? '' : ' none'}`}>{r.site ? <><i style={{ background: siteColor(r.site) }} />{short(r.site)}</> : '—'}</div>
      <div className="needs">{needsOf(r).map(([label, val]) => (
        <div key={label} className={`need${val ? ' ok' : ''}`}><i>{val ? <Tick /> : null}</i>{val ? <>{label}: <b>{label === 'Project' ? short(val) : val}</b></> : `Add the ${label.toLowerCase()}`}</div>
      ))}</div>
      <div className="go">
        {ready(r) && canOrder
          ? <><button type="button" className="btn pri" disabled={busy} onClick={onMake}>{busy ? 'Making…' : 'Make PO'}</button><button type="button" className="btn" onClick={onReview}>Review</button></>
          : <button type="button" className="btn ink" onClick={onReview}>Review ›</button>}
      </div>
    </div>
  );
}

// ── a PO table row ──
function PoTr({ p, canApprove, busy, onOpen, onSend, onApprove, onAttach }: { p: PORow; canApprove: boolean; busy: boolean; onOpen: () => void; onSend: () => void; onApprove: () => void; onAttach: () => void }) {
  const st = stageOf(p);
  const shown = p.items.slice(0, 2).map((i) => i.n).join(', ');
  const rest = p.items.length - 2;
  return (
    <div className="tr" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
      <div className="v"><b>{p.vendor}</b><span>{p.id}</span></div>
      <div className="items"><span>{shown || 'No items'}</span>{rest > 0 && <em>+{rest}</em>}</div>
      <div className="site"><i style={{ background: siteColor(p.site) }} />{short(p.site)}</div>
      <div className="when">{dstr(D(p.ordered))}<span>{(p.by || '').split(' ')[0]}</span></div>
      <div onClick={(e) => e.stopPropagation()}>{statusCell(p, st, { canApprove, busy, onSend, onApprove, onAttach })}</div>
      <div className={`amt${st === 'bill' ? '' : st === 'paid' ? ' paid' : ' none'}`}>{st === 'bill' ? <>{inr(balanceOf(p))}<small>owed</small></> : st === 'paid' ? inr(p.paid || p.billed) : '—'}</div>
    </div>
  );
}

function statusCell(p: PORow, st: Stage, a: { canApprove: boolean; busy: boolean; onSend: () => void; onApprove: () => void; onAttach: () => void }) {
  if (st === 'pending') return <div className="st"><i className="ring" /><div><b>Awaiting approval</b>{a.canApprove
    ? <span><button type="button" className="act ghost" style={{ height: 26, padding: '0 10px' }} disabled={a.busy} onClick={a.onApprove}>{a.busy ? 'Approving…' : 'Approve'}</button></span>
    : <span>needs an approver</span>}</div></div>;
  if (st === 'send') return <div className="st"><button type="button" className="act" onClick={a.onSend}><svg viewBox="0 0 24 24"><path d="M21 3 10 14M21 3l-7 18-4-8-8-4 19-6Z" /></svg>Send to vendor</button></div>;
  if (st === 'sent') return <div className="st"><i className="dot" style={{ background: 'var(--line-2)' }} /><div><b>Sent {dstr(D(p.sent))}</b><span>Awaiting delivery</span></div></div>;
  if (st === 'recv') return <div className="st"><i className="ring" /><div><b>Received {dstr(D(p.recv))}</b><span>No bill yet · <u onClick={a.onAttach}>attach one</u></span></div></div>;
  const billNo = p.bills.find((b) => b.no)?.no || '';
  if (st === 'bill') return <div className="st"><i className="dot" style={{ background: 'var(--sage-hi)' }} /><div><b>Received {dstr(D(p.recv))}</b><span>{billNo ? `Bill ${billNo} · ` : ''}{inr(p.billed)}</span></div></div>;
  return <div className="st"><span className="tick"><Tick /></span><div><b className="quiet">Paid</b><span>{billNo ? `Bill ${billNo} · ` : ''}{inr(p.paid || p.billed)}</span></div></div>;
}

// ── a quote (RFQ) row in the Quotes tab ──
function RfqTr({ r, onOpen }: { r: RfqRow; onOpen: () => void }) {
  return (
    <div className="tr" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
      <div className="v"><b>{r.sent} vendor{r.sent !== 1 ? 's' : ''} asked</b><span>ENQ-{r.rfq_id.slice(0, 6).toUpperCase()}</span></div>
      <div className="items"><span>{r.summary || `${r.itemCount} items`}</span></div>
      <div className="site"><i style={{ background: siteColor(r.site) }} />{short(r.site)}</div>
      <div className="when">{dstr(D(r.created_at))}</div>
      <div className="st"><i className="dot" style={{ background: 'var(--gold, #C08A2B)' }} /><div>{r.replied > 0 ? <><b>{r.replied} of {r.sent} quoted</b><span>{r.best != null ? `best ${inr(r.best)} · ` : ''}tap to compare</span></> : <><b>Awaiting quotes</b><span>{r.sent} asked</span></>}</div></div>
      <div className="amt none">—</div>
    </div>
  );
}

// ── the side peek ──
// ── the editable side peek — the request page, in place. No separate PR screen needed. ──
interface EItem { rowId: string; name: string; qty: string; unit: string; w: string; h: string; brand: string; spec: string; note: string }

function PeekEditor({ prId, orgId, projects, vendors, canOrder, creating, onClose, onPhoto, onSaved, onCreate }: {
  prId: string; orgId: string; projects: Opt[]; vendors: Opt[]; canOrder: boolean; creating: boolean;
  onClose: () => void; onPhoto: (url: string) => void; onSaved: () => void; onCreate: (asRfq: boolean) => void;
}) {
  const pr = useQuery({
    queryKey: ['pox_pr', prId],
    queryFn: async () => (await supabase.from('purchase_requests')
      .select('id, org_id, image_url, title, site_id, site_raw, vendor_id, vendor_raw, sender_name, wa_message_id, created_at, projects(name), stakeholders(name), purchase_request_items(id, item_index, item_name, quantity, unit, note, width_mm, height_mm, brand, spec)')
      .eq('id', prId).single()).data as any,
  });

  const [title, setTitle] = useState('');
  const [siteId, setSiteId] = useState(''); const [siteText, setSiteText] = useState('');
  const [vendorId, setVendorId] = useState(''); const [vendorText, setVendorText] = useState('');
  const [items, setItems] = useState<EItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saying, setSaying] = useState(false);
  const [said, setSaid] = useState('');

  useEffect(() => {
    const d = pr.data; if (!d) return;
    setTitle(d.title || 'Materials request');
    setSiteId(d.site_id || ''); setSiteText(d.projects?.name || d.site_raw || '');
    setVendorId(d.vendor_id || ''); setVendorText(d.stakeholders?.name || d.vendor_raw || '');
    setItems([...(d.purchase_request_items ?? [])].sort((a: any, b: any) => (a.item_index ?? 0) - (b.item_index ?? 0)).map((it: any) => ({
      rowId: it.id, name: it.item_name || '', qty: it.quantity != null ? String(it.quantity) : '', unit: it.unit || '',
      w: it.width_mm != null ? String(it.width_mm) : '', h: it.height_mm != null ? String(it.height_mm) : '', brand: it.brand || '', spec: it.spec || '', note: it.note || '',
    })));
    setDirty(false);
    // The message it came in with — best-effort from the WhatsApp row.
    if (d.wa_message_id) supabase.from('rough_entries').select('raw_text').eq('org_id', d.org_id).eq('wa_message_id', d.wa_message_id).limit(1)
      .then(({ data }) => setSaid((data?.[0]?.raw_text as string) || ''));
    else setSaid('');
  }, [pr.data]);

  const touch = () => setDirty(true);
  const setItem = (i: number, patch: Partial<EItem>) => { setItems((p) => p.map((it, j) => (j === i ? { ...it, ...patch } : it))); touch(); };
  const addItem = () => { setItems((p) => [...p, { rowId: '', name: '', qty: '', unit: '', w: '', h: '', brand: '', spec: '', note: '' }]); touch(); };
  const delItem = (i: number) => { setItems((p) => p.filter((_, j) => j !== i)); touch(); };
  const clean = items.filter((it) => it.name.trim());

  const rankVendors = (q: string) => searchPayees(vendors as any[], q).slice(0, 7) as Opt[];
  const rankProjects = (q: string) => { const n = q.trim().toLowerCase(); return (!n ? projects : projects.map((p) => ({ p, r: scoreProjectName(n, p.name) })).filter((x) => x.r >= 0.3 || x.p.name.toLowerCase().includes(n)).sort((a, b) => b.r - a.r).map((x) => x.p)).slice(0, 7); };

  const persist = async () => {
    await supabase.from('purchase_requests').update({
      title: title.trim() || null,
      site_id: siteId || null, site_raw: siteId ? null : (siteText.trim() || null),
      vendor_id: vendorId || null, vendor_raw: vendorId ? null : (vendorText.trim() || null),
    }).eq('id', prId);
    await supabase.from('purchase_request_items').delete().eq('purchase_request_id', prId);
    if (clean.length) {
      const { error } = await supabase.from('purchase_request_items').insert(clean.map((it, i) => ({
        purchase_request_id: prId, org_id: orgId, item_index: i, item_name: it.name.trim(),
        quantity: it.qty.trim() ? Number(it.qty.replace(/[^\d.]/g, '')) || null : null, unit: it.unit.trim() || null, note: it.note.trim() || null,
        width_mm: it.w.trim() ? Number(it.w) || null : null, height_mm: it.h.trim() ? Number(it.h) || null : null, brand: it.brand.trim() || null, spec: it.spec.trim() || null,
      })));
      if (error) throw error;
    }
  };
  const save = async () => { setSaying(true); setMsg(null); try { await persist(); setDirty(false); onSaved(); setMsg('Saved'); setTimeout(() => setMsg(null), 1600); } catch (e) { setMsg((e as Error).message || 'Could not save'); } finally { setSaying(false); } };
  const create = async (asRfq: boolean) => { setMsg(null); try { if (dirty) await persist(); setDirty(false); onSaved(); onCreate(asRfq); } catch (e) { setMsg((e as Error).message || 'Could not create it'); } };

  const readyToOrder = !!siteId && !!vendorId;
  const busy = saying || creating;
  const imageUrl = pr.data?.image_url as string | undefined;

  return (
    <>
      <div className="ph">
        <div className="t">
          <input className="title-in" value={title} onChange={(e) => { setTitle(e.target.value); touch(); }} placeholder="Materials request" aria-label="Title" />
          <span><Wa style={{ width: 13, height: 13, fill: '#3DBB6C', verticalAlign: -2, marginRight: 6 }} />From <b style={{ color: 'rgb(250,248,243)' }}>{pr.data?.sender_name || 'WhatsApp'}</b></span>
        </div>
        <button type="button" className="x" aria-label="Close" onClick={onClose}><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
      </div>

      {imageUrl && <div className="came">
        <button type="button" className="paper" onClick={() => onPhoto(imageUrl)}><img src={imageUrl} alt="" /></button>
        <div><div className="n">{clean.length}<small>items read from the photo</small></div><p>{readyToOrder ? 'Everything is here. Create the order below.' : 'Set the site and supplier, then order.'}</p></div>
      </div>}
      {said && <div className="said">“{said}”</div>}

      <div className="two">
        <DarkResolve label="Supplier" text={vendorText} id={vendorId} placeholder="Search a vendor" rank={rankVendors} createLabel="vendor" orgId={orgId}
          onText={(v) => { setVendorText(v); setVendorId(''); touch(); }} onPick={(o) => { setVendorId(o.id); setVendorText(o.name); touch(); }}
          onClear={() => { setVendorId(''); touch(); }} onCreated={(id, name) => { setVendorId(id); setVendorText(name); touch(); }}
          hint="Not one of your vendors yet — pick one or add it" />
        <DarkResolve label="Project" text={siteText} id={siteId} placeholder="Choose a site" rank={rankProjects}
          onText={(v) => { setSiteText(v); setSiteId(''); touch(); }} onPick={(o) => { setSiteId(o.id); setSiteText(o.name); touch(); }}
          onClear={() => { setSiteId(''); touch(); }} hint="No site matched — pick the right one" />
      </div>

      <div className="ihd"><h3 style={{ margin: 0 }}>Items <span style={{ color: 'rgba(250,248,243,.4)' }}>{clean.length}</span></h3></div>
      {items.map((it, i) => (
        <div className="iedit" key={i}>
          <div className="iline">
            <span className="no">{i + 1}</span>
            <input value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} placeholder="Material / description" />
            <input className="mono" value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} inputMode="decimal" placeholder="Qty" />
            <input value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })} placeholder="Unit" />
            <button type="button" className="rm" title="Remove" onClick={() => delItem(i)}>✕</button>
          </div>
          <div className="ispec">
            <input className="mono" value={it.w} onChange={(e) => setItem(i, { w: e.target.value })} inputMode="decimal" placeholder="W mm" />
            <input className="mono" value={it.h} onChange={(e) => setItem(i, { h: e.target.value })} inputMode="decimal" placeholder="H mm" />
            <input value={it.brand} onChange={(e) => setItem(i, { brand: e.target.value })} placeholder="Brand" />
            <input value={it.spec} onChange={(e) => setItem(i, { spec: e.target.value })} placeholder="Spec / code / system" />
            <input value={it.note} onChange={(e) => setItem(i, { note: e.target.value })} placeholder="Note" />
          </div>
        </div>
      ))}
      <button type="button" className="addi" onClick={addItem}>+ Add item</button>

      {msg && <p className="pmsg">{msg}</p>}
      <div className="pfoot">
        <button type="button" className="btn" disabled={!dirty || busy} onClick={save}>{saying ? <><span className="spin" />Saving…</> : 'Save'}</button>
        {canOrder && <>
          <button type="button" className="btn" disabled={!readyToOrder || busy} onClick={() => create(true)}>Request quotes</button>
          <button type="button" className="btn pri" disabled={!readyToOrder || busy} onClick={() => create(false)}>{creating ? <><span className="spin" />Creating…</> : 'Create PO'}</button>
        </>}
      </div>
    </>
  );
}

// A dark resolve field for the peek — input + ranked dropdown, ✓ when a real record is chosen, and (for
// vendors) an inline "add" that creates the party. Mirrors the review card's resolve, on the dark card.
function DarkResolve({ label, text, id, placeholder, rank, hint, createLabel, orgId, onText, onPick, onClear, onCreated }: {
  label: string; text: string; id: string; placeholder: string; rank: (q: string) => Opt[]; hint?: string;
  createLabel?: string; orgId?: string; onText: (v: string) => void; onPick: (o: Opt) => void; onClear: () => void; onCreated?: (id: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const hits = open && !id ? rank(text) : [];
  const canAdd = !!createLabel && !id && !!text.trim() && !hits.some((h) => h.name.toLowerCase() === text.trim().toLowerCase());
  const addNew = async () => {
    if (!orgId || adding) return; setAdding(true);
    try { const p = await createParty(text.trim(), 'Vendor', orgId); onCreated?.(p.id, text.trim()); setOpen(false); } catch { /* ignore */ } finally { setAdding(false); }
  };
  return (
    <label className={`fld rz${id ? ' ok' : ''}`} ref={boxRef as any}>
      <span>{label}</span>
      <input className="in" value={text} placeholder={placeholder} onChange={(e) => { onText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {id
        ? <button type="button" className="x" style={{ position: 'absolute', right: 6, bottom: 6, width: 30, height: 30, borderRadius: 8 }} title="Change" onClick={onClear}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
        : null}
      {open && !id && (hits.length > 0 || canAdd) && (
        <div className="rz-drop">
          {hits.map((h) => <button key={h.id} type="button" className="rz-opt" onMouseDown={(e) => { e.preventDefault(); onPick(h); setOpen(false); }}>{h.name}{h.sub ? <small>{h.sub}</small> : null}</button>)}
          {canAdd && <button type="button" className="rz-opt rz-add" onMouseDown={(e) => { e.preventDefault(); void addNew(); }}>{adding ? 'Adding…' : `+ Add “${text.trim()}” as a new ${createLabel}`}</button>}
        </div>
      )}
      {!id && text.trim() && hint && <em className="rz-hint">{hint}</em>}
    </label>
  );
}
