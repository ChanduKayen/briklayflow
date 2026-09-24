// Desktop Purchase-orders list — an exact port of the reference artifact, wired to real data.
//
// The reference's own left rail + page chrome are dropped (the app owns those); this renders the
// reference's scrollable main content under `.pox`. Everything is wired to the real hooks + actions:
//   the WhatsApp INBOX = draft purchase_requests (Review → the request page, Make PO → promote RPC),
//   the TABLE = live/fulfilled POs grouped by where each one is (send · sent · received · billed · paid),
//   Send to vendor = the existing SendToVendorModal, a pending PO shows Approve (decide_purchase_order).
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth/AuthProvider';
import { useUserProfile } from '../../App';
import SendToVendorModal from '../po-new-ui/SendToVendorModal';
import { usePOListData, usePendingPRs, useOpenRfqs, type PORow, type PendingPR, type RfqRow } from './POListSheet';
import { PO_LIST_DESKTOP_CSS } from './poListDesktopCss';

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
  const { userId } = useAuth();
  const { data: profile } = useUserProfile(userId ?? '');
  const canApprove = profile?.role === 'management' || profile?.role === 'principal';
  const canOrder = profile?.role === 'management' || profile?.role === 'principal' || profile?.role === 'accountant';

  const { rows, isLoading } = usePOListData(projectId);
  const { data: pending = [] } = usePendingPRs(projectId);
  const { data: rfqs = [] } = useOpenRfqs(projectId);

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
    mutationFn: async (prId: string) => {
      const { data, error } = await supabase.rpc('promote_purchase_request_to_po', { p_pr_id: prId, p_approver_id: userId });
      const r = data as { success?: boolean; error?: string; po_id?: string } | null;
      if (error || !r?.success || !r.po_id) throw new Error(r?.error || error?.message || 'Could not make the PO');
      return r.po_id;
    },
    onMutate: (id) => setBusyId(id),
    onSettled: () => setBusyId(null),
    onSuccess: (poId) => {
      qc.invalidateQueries({ queryKey: ['po_list_pending_prs'] });
      qc.invalidateQueries({ queryKey: ['po_list_sheet'] });
      setPeekId(null);
      navigate('/purchase-orders?status=draft', { replace: true });
      navigate(`/purchase-orders/${poId}`, { state: { justCreated: true, createdKind: 'po' } });
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

  const req = pending.find((r) => r.id === peekId) || null;

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
            onPhoto={() => r.imageUrl && setViewer(r.imageUrl)} onReview={() => setPeekId(r.id)} onMake={() => makePO.mutate(r.id)} />)}
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

      {/* side peek — a request, read */}
      <div className={`pox-scrim${req ? ' on' : ''}`} onClick={() => setPeekId(null)} />
      <aside className={`pox-peek${req ? ' on' : ''}`} aria-live="polite">
        {req && <Peek r={req} canOrder={canOrder} busy={busyId === req.id}
          onClose={() => setPeekId(null)} onPhoto={() => req.imageUrl && setViewer(req.imageUrl)}
          onOpenReview={() => { setPeekId(null); navigate(`/purchase-orders/pr/${req.id}`); }} onMake={() => makePO.mutate(req.id)} />}
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
function Peek({ r, canOrder, busy, onClose, onPhoto, onOpenReview, onMake }: { r: PendingPR; canOrder: boolean; busy: boolean; onClose: () => void; onPhoto: () => void; onOpenReview: () => void; onMake: () => void }) {
  return (
    <>
      <div className="ph"><div className="t"><h2>{r.title}</h2><span><Wa style={{ width: 13, height: 13, fill: '#3DBB6C', verticalAlign: -2, marginRight: 6 }} />From <b style={{ color: 'rgb(250,248,243)' }}>{r.from}</b> · {r.when}</span></div>
        <button type="button" className="x" aria-label="Close" onClick={onClose}><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></button></div>
      <div className="came">
        {r.pages ? <button type="button" className="paper" onClick={onPhoto}>{r.imageUrl && <img src={r.imageUrl} alt="" />}</button> : <div className="paper" style={{ background: 'none', boxShadow: 'none', border: '1.5px dashed rgba(250,248,243,.25)' }} />}
        <div><div className="n">{r.items.length}<small>items read {r.pages ? 'from the photo' : 'from the message'}</small></div><p>{ready(r) ? 'Everything is here. One click makes the purchase order.' : 'Two things to add, then it can be ordered.'}</p></div>
      </div>
      {r.said && <div className="said">“{r.said}”</div>}
      <h3>Still to add</h3>
      {needsOf(r).map(([label, val]) => (
        <div key={label} className={`prow${val ? ' ok' : ''}`}><span className="mk">{val ? <Tick /> : null}</span><span className="l">{label}</span><span className={`v${val ? '' : ' ask'}`}>{val || (label === 'Project' ? 'Which site is this for?' : 'Who gave this quote?')}</span></div>
      ))}
      <h3>On the {r.pages ? 'quote' : 'message'}</h3>
      {r.items.map((it, i) => <div className="irow" key={i}><span className="no">{i + 1}</span><span className="m"><b>{it.name || 'Item'}</b></span><em>{it.qty}</em></div>)}
      <div className="pfoot">
        <button type="button" className="btn" onClick={onOpenReview}>Open review</button>
        {ready(r) && canOrder && <button type="button" className="btn pri" disabled={busy} onClick={onMake}>{busy ? 'Making…' : 'Make PO'}</button>}
      </div>
    </>
  );
}
