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
// "today, 9:41 am" · "yesterday, 5:12 pm" · "12 Sept, 8:03 am" — the reference's own phrasing.
function whenLabel(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const gap = Math.round((day(now) - day(d)) / 864e5);
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  const head = gap === 0 ? 'today' : gap === 1 ? 'yesterday' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return head + ', ' + time;
}
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
  // NOTE: useAuth().userId is the org_membership row id, NOT the auth user id. The profile lookup and the
  // promote RPC both key on the auth user id (user_profiles.id / org_memberships.user_id), so resolve the
  // real session uid here — passing the membership id made the RPC answer "Not authorized to approve".
  const [authUid, setAuthUid] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getSession().then(({ data }) => setAuthUid(data.session?.user.id ?? null)); }, []);
  const { data: profile } = useUserProfile(authUid ?? '');
  const canApprove = profile?.role === 'management' || profile?.role === 'principal';
  // Anyone but a supervisor can raise an order (principal / management / accountant, and any other/legacy
  // role) — a supervisor only reviews. Using "not supervisor" so a null/legacy role never locks the office out.
  const canOrder = profile?.role !== 'supervisor';

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
  const [freshId, setFreshId] = useState<string | null>(null);   // a just-made PO row, briefly highlighted
  const [filingId, setFilingId] = useState<string | null>(null); // an inbox request sliding out as it becomes a PO
  const [okId, setOkId] = useState<string | null>(null);         // an inbox Make-PO button showing its ✓ beat
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

  // Promote a request to a PO. We deliberately DON'T open the PO — the new order lands in the list and is
  // briefly highlighted, so the office sees where it went. Returns the new po_id.
  const promote = async (prId: string, asRfq: boolean) => {
    const { data, error } = await supabase.rpc('promote_purchase_request_to_po', { p_pr_id: prId, p_approver_id: authUid });
    const r = data as { success?: boolean; error?: string; po_id?: string } | null;
    if (error || !r?.success || !r.po_id) throw new Error(r?.error || error?.message || 'Could not make the PO');
    if (asRfq) await supabase.from('purchase_orders').update({ status: 'RFQ' }).eq('po_id', r.po_id);
    return r.po_id;
  };
  // Refresh the list, move to the tab it appears on, highlight the new row and glide it into view.
  const settleNewPO = (poId: string) => {
    setTab('active');
    qc.invalidateQueries({ queryKey: ['po_list_pending_prs'] });
    qc.invalidateQueries({ queryKey: ['po_list_sheet'] });
    setFreshId(poId);
    let tries = 0;
    const tick = () => { const el = document.querySelector('.pox .tbl .tr.fresh') as HTMLElement | null; if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); else if (tries++ < 24) window.setTimeout(tick, 60); };
    window.setTimeout(tick, 90);
    window.clearTimeout((settleNewPO as any)._t); (settleNewPO as any)._t = window.setTimeout(() => setFreshId(null), 2400);
  };
  // From an inbox row: spinner → ✓ beat → the paper files away → the new PO row highlights in the table.
  const makeFromInbox = async (prId: string) => {
    setBusyId(prId);
    try {
      const poId = await promote(prId, false);
      setBusyId(null); setOkId(prId); say('Purchase order made · under Awaiting delivery');
      window.setTimeout(() => {
        setFilingId(prId);
        window.setTimeout(() => { settleNewPO(poId); setFilingId(null); setOkId(null); }, 460);
      }, 460);
    } catch (e) { setBusyId(null); say((e as Error).message); }
  };
  // From the review card: the peek plays its own ✓ and closes itself; we run the RPC and settle the list.
  const makeFromPeek = async (prId: string, asRfq: boolean) => { const poId = await promote(prId, asRfq); settleNewPO(poId); };

  // Delete a draft request from the peek's ⋯ menu (items cascade). Close the peek + refresh the inbox.
  const deletePR = async (prId: string) => {
    const { error } = await supabase.from('purchase_requests').delete().eq('id', prId);
    if (error) { say(error.message || 'Could not delete it'); return; }
    setPeekId(null);
    qc.invalidateQueries({ queryKey: ['po_list_pending_prs'] });
    say('Request deleted');
  };

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
              ? <><h2>Material requests from WhatsApp<b>{pending.length}</b></h2><span className="n">Not orders yet. Check each one, then make the PO.</span></>
              : <><h2>No material requests from WhatsApp</h2><span className="n">Requests your site sends on WhatsApp land here to review.</span></>}
          </div>
          {pending.map((r) => <ReqRow key={r.id} r={r} canOrder={canOrder} busy={busyId === r.id} ok={okId === r.id} filing={filingId === r.id}
            onPhoto={() => r.imageUrl && setViewer(r.imageUrl)} onReview={() => setPeekId(r.id)} onMake={() => makeFromInbox(r.id)} />)}
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
                      {gr.map((p) => <PoTr key={p.id} p={p} canApprove={canApprove} busy={busyId === p.id} fresh={p.id === freshId}
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
          onClose={() => setPeekId(null)} onPhoto={(url) => setViewer(url)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['po_list_pending_prs'] }); qc.invalidateQueries({ queryKey: ['po_list_sheet'] }); }}
          onCreate={(asRfq) => makeFromPeek(peekId, asRfq)} onDelete={() => deletePR(peekId)} />}
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

function ReqRow({ r, canOrder, busy, ok, filing, onPhoto, onReview, onMake }: { r: PendingPR; canOrder: boolean; busy: boolean; ok: boolean; filing: boolean; onPhoto: () => void; onReview: () => void; onMake: () => void }) {
  // The row carries its ITEMS, exactly as a PO row does — not a generic "Materials request".
  const names = r.items.map((i) => i.name).filter(Boolean);
  const shown = names.slice(0, 2).join(', ');
  const more = names.length - 2;
  const itemsLine = shown ? shown + (more > 0 ? ` +${more}` : '') : (r.title || 'Materials request');
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  return (
    <div className={`req${filing ? ' filing' : ''}`} role="button" tabIndex={0} onClick={onReview} onKeyDown={(e) => { if (e.key === 'Enter') onReview(); }}>
      {r.pages
        ? <button type="button" className="paper" aria-label="See the photo" onClick={stop(onPhoto)}>{r.imageUrl && <img src={r.imageUrl} alt="" />}<span className="pg">{r.pages} page</span></button>
        : <div className="paper" style={{ background: 'none', boxShadow: 'none', border: '1.5px dashed var(--line-2)', cursor: 'default' }} />}
      <div className="what"><b>{itemsLine}</b><span>{r.items.length} {r.items.length === 1 ? 'item' : 'items'} read {r.pages ? 'from the photo' : 'from the message'}</span>{r.said && <i title={r.said}>“{r.said}”</i>}</div>
      <div className="who"><span className="av">{initials(r.from)}</span><div>{r.from}<span>{r.when}</span></div></div>
      <div className={`site${r.site ? '' : ' none'}`}>{r.site ? <><i style={{ background: siteColor(r.site) }} />{short(r.site)}</> : '—'}</div>
      <div className="needs">{needsOf(r).map(([label, val]) => (
        <div key={label} className={`need${val ? ' ok' : ''}`}><i>{val ? <Tick /> : null}</i>{val ? <>{label}: <b>{label === 'Project' ? short(val) : val}</b></> : `Add the ${label.toLowerCase()}`}</div>
      ))}</div>
      <div className="go">
        {ready(r) && canOrder
          ? <><button type="button" className={`btn pri${ok ? ' ok' : ''}`} disabled={busy || ok} onClick={stop(onMake)}>{ok ? <><Tick />PO made</> : busy ? <><span className="spin" />Making…</> : 'Make PO'}</button><button type="button" className="btn ink" onClick={stop(onReview)}>Review</button></>
          : <button type="button" className="btn ink" onClick={stop(onReview)}>Review ›</button>}
      </div>
    </div>
  );
}

// ── a PO table row ──
function PoTr({ p, canApprove, busy, fresh, onOpen, onSend, onApprove, onAttach }: { p: PORow; canApprove: boolean; busy: boolean; fresh: boolean; onOpen: () => void; onSend: () => void; onApprove: () => void; onAttach: () => void }) {
  const st = stageOf(p);
  const shown = p.items.slice(0, 2).map((i) => i.n).join(', ');
  const rest = p.items.length - 2;
  return (
    <div className={`tr${fresh ? ' fresh' : ''}`} tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
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
// ── the editable side peek — the request page, in place. Designed EXACTLY to the reference artifact:
//    a paper header, the message it came in on, two pickers, items that open to a sentence you fill in.
//    "Changes are kept as you type" — no Save button; edits persist (debounced) and on close/create. ──
interface EItem { rowId: string; name: string; qty: string; unit: string; w: string; h: string; brand: string; spec: string; note: string }
const UNITS = ['Nos', 'Set', 'Sqft', 'Rft', 'Kg', 'Bag'];
const unitOpts = (u: string) => (u && !UNITS.some((x) => x.toLowerCase() === u.toLowerCase()) ? [u, ...UNITS] : UNITS);
const sizeOf = (it: EItem) => (it.w && it.h ? `${it.w} × ${it.h} mm` : '');
const specOf = (it: EItem) => [sizeOf(it), it.spec, it.brand].filter(Boolean).join(' · ');
const parseSize = (v: string): { w: string; h: string } => { const m = v.replace(/mm/gi, '').match(/(\d+(?:\.\d+)?)\s*[x×*/]\s*(\d+(?:\.\d+)?)/i); return m ? { w: m[1], h: m[2] } : { w: '', h: '' }; };

function PeekEditor({ prId, orgId, projects, vendors, canOrder, onClose, onPhoto, onSaved, onCreate, onDelete }: {
  prId: string; orgId: string; projects: Opt[]; vendors: Opt[]; canOrder: boolean;
  onClose: () => void; onPhoto: (url: string) => void; onSaved: () => void; onCreate: (asRfq: boolean) => Promise<void>; onDelete: () => void;
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
  const [makingKind, setMakingKind] = useState<null | 'po' | 'rfq'>(null);
  const [madeKind, setMadeKind] = useState<null | 'po' | 'rfq'>(null);   // the ✓ success beat before the card closes
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [said, setSaid] = useState('');
  const [edit, setEdit] = useState(-1);            // which item row is open for editing
  const [brandAll, setBrandAll] = useState(false);
  const [noteOpen, setNoteOpen] = useState(-1);

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
  const setSize = (i: number, v: string) => setItem(i, parseSize(v));
  const addItem = () => { setItems((p) => [...p, { rowId: '', name: '', qty: '', unit: 'Nos', w: '', h: '', brand: '', spec: '', note: '' }]); setNoteOpen(-1); setEdit(items.length); touch(); };
  const delItem = (i: number) => { setItems((p) => p.filter((_, j) => j !== i)); setEdit(-1); touch(); };
  const startEdit = (i: number) => { setNoteOpen(-1); setEdit(i); };
  const toggleBrandAll = (i: number) => { const nb = !brandAll; setBrandAll(nb); if (nb) { const b = items[i].brand; setItems((p) => p.map((x) => ({ ...x, brand: b }))); touch(); } };
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

  // "Changes are kept as you type" — debounce a save while dirty, and flush on close (unmount).
  const flush = useRef<{ dirty: boolean; run: () => Promise<void> }>({ dirty: false, run: async () => {} });
  flush.current = { dirty, run: async () => { try { await persist(); onSaved(); } catch { /* keep local edits */ } } };
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => { void (async () => { try { await persist(); setDirty(false); onSaved(); } catch (e) { setMsg((e as Error).message || 'Could not save'); } })(); }, 800);
    return () => clearTimeout(t);
  }, [dirty, title, siteId, siteText, vendorId, vendorText, items]);
  useEffect(() => () => { if (flush.current.dirty) void flush.current.run(); }, []);

  // Make PO / Request quotes: run it, then play a subtle ✓ success beat on the button before the card closes.
  const create = async (asRfq: boolean) => {
    setMsg(null); setMakingKind(asRfq ? 'rfq' : 'po');
    try {
      if (dirty) await persist();
      setDirty(false); onSaved();
      await onCreate(asRfq);
      setMakingKind(null); setMadeKind(asRfq ? 'rfq' : 'po');
      setTimeout(() => onClose(), 950);
    } catch (e) { setMakingKind(null); setMsg((e as Error).message || 'Could not create it'); }
  };

  const readyToOrder = !!siteId && !!vendorId;
  const missing = (siteId ? 0 : 1) + (vendorId ? 0 : 1);
  const busy = !!makingKind || !!madeKind;
  const imageUrl = pr.data?.image_url as string | undefined;
  const enterDone = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); setEdit(-1); } };

  return (
    <>
      <div className="ph">
        <div className="t">
          <input className="title-in" value={title} onChange={(e) => { setTitle(e.target.value); touch(); }} placeholder="Materials request" aria-label="Title" />
          <span><Wa style={{ width: 13, height: 13, fill: '#3DBB6C', verticalAlign: -2, marginRight: 6 }} />From <b style={{ color: 'rgb(250,248,243)' }}>{pr.data?.sender_name || 'WhatsApp'}</b>{whenLabel(pr.data?.created_at) ? ` · ${whenLabel(pr.data?.created_at)}` : ''}</span>
        </div>
        <div className="ph-acts">
          <button type="button" className="kebab" aria-label="More" onClick={() => { setMenuOpen((o) => !o); setConfirmDel(false); }}><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg></button>
          <button type="button" className="x" aria-label="Close" onClick={onClose}><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
          {menuOpen && (
            <div className="kmenu" onMouseLeave={() => { setMenuOpen(false); setConfirmDel(false); }}>
              {confirmDel
                ? <><span className="kq">Delete this request?</span><button type="button" className="kdel" onClick={() => { setMenuOpen(false); onDelete(); }}>Delete</button><button type="button" className="kcancel" onClick={() => { setMenuOpen(false); setConfirmDel(false); }}>Keep it</button></>
                : <button type="button" className="kitem del" onClick={() => setConfirmDel(true)}><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7" /></svg>Delete request</button>}
            </div>
          )}
        </div>
      </div>

      <div className="came">
        {imageUrl
          ? <button type="button" className="paper" onClick={() => onPhoto(imageUrl)}><img src={imageUrl} alt="" /></button>
          : <div className="paper" style={{ background: 'none', boxShadow: 'none', border: '1.5px dashed rgba(250,248,243,.25)' }} />}
        <div><div className="n">{items.length}<small>{items.length === 1 ? 'item' : 'items'} read {imageUrl ? 'from the photo' : 'from the message'}</small></div><p>{readyToOrder ? 'Everything is here. Make the order below.' : `${missing === 1 ? 'One thing' : 'Two things'} to add, then it can be ordered.`}</p></div>
      </div>
      {said && <div className="said">“{said}”</div>}

      <div className="two">
        <PkResolve label="Project" ask="Which site is this for?" text={siteText} id={siteId} rank={rankProjects}
          onText={(v) => { setSiteText(v); setSiteId(''); touch(); }} onPick={(o) => { setSiteId(o.id); setSiteText(o.name); touch(); }}
          onClear={() => { setSiteId(''); touch(); }} />
        <PkResolve label="Supplier" ask="Who gave this quote?" text={vendorText} id={vendorId} rank={rankVendors} createLabel="vendor" orgId={orgId}
          onText={(v) => { setVendorText(v); setVendorId(''); touch(); }} onPick={(o) => { setVendorId(o.id); setVendorText(o.name); touch(); }}
          onClear={() => { setVendorId(''); touch(); }} onCreated={(id, name) => { setVendorId(id); setVendorText(name); touch(); }} />
      </div>

      <div className="ith"><h3>Items</h3><span>Click an item to change it</span></div>
      {items.map((it, i) => edit === i ? (
        <div className="le" key={i}>
          <div className="r1">
            <span className="no">{i + 1}</span>
            <input autoFocus value={it.name} placeholder="Item" aria-label="Item" onChange={(e) => setItem(i, { name: e.target.value })} onKeyDown={enterDone} />
            <input className="qty" value={it.qty} inputMode="numeric" placeholder="Qty" aria-label="Quantity" onChange={(e) => setItem(i, { qty: e.target.value })} onKeyDown={enterDone} />
            <select value={unitOpts(it.unit).includes(it.unit) ? it.unit : (it.unit || 'Nos')} aria-label="Unit" onChange={(e) => setItem(i, { unit: e.target.value })}>{unitOpts(it.unit || 'Nos').map((u) => <option key={u}>{u}</option>)}</select>
            <button type="button" className="ok" aria-label="Done" onClick={() => setEdit(-1)}><Tick /></button>
          </div>
          <div className="fill">
            <span className="sl"><span>Size</span><input value={sizeOf(it)} placeholder="W × H mm" size={13} aria-label="Size" onChange={(e) => setSize(i, e.target.value)} /></span><span className="dot">·</span>
            <span className="sl"><span>Spec</span><input value={it.spec} placeholder="e.g. 8mm clear glass" size={22} aria-label="Specification" onChange={(e) => setItem(i, { spec: e.target.value })} /></span><span className="dot">·</span>
            <span className="sl"><span>Brand</span><input value={it.brand} placeholder="—" size={10} aria-label="Brand" onChange={(e) => setItem(i, { brand: e.target.value })} /><button type="button" className="all" aria-pressed={brandAll} title="Use this brand on every item" onClick={() => toggleBrandAll(i)}>all {items.length}</button></span>
            {(it.note || noteOpen === i)
              ? <span className="sl note"><input value={it.note} placeholder="Note for the supplier" aria-label="Note" onChange={(e) => setItem(i, { note: e.target.value })} /></span>
              : <><span className="dot">·</span><button type="button" className="lk" onClick={() => setNoteOpen(i)}>Add a note</button></>}
            <button type="button" className="lk rm" onClick={() => delItem(i)}>Remove</button>
          </div>
        </div>
      ) : (
        <div className="li" key={i} onClick={() => startEdit(i)}>
          <span className="no">{i + 1}</span>
          <span className="m"><b>{it.name || 'Unnamed item'}</b><span className={`sp${specOf(it) ? '' : ' none'}`}>{specOf(it)}</span>{it.note && <span className="nt">“{it.note}”</span>}</span>
          <span className="q">{it.qty || '1'}<small>{it.unit || 'Nos'}</small></span>
          <button type="button" className="pen" aria-label="Edit" onClick={(e) => { e.stopPropagation(); startEdit(i); }}><svg viewBox="0 0 24 24"><path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4Z" /><path d="m13 7 4 4" /></svg></button>
        </div>
      ))}
      <button type="button" className="addli" onClick={addItem}>+ Add new item</button>
      <p className="hintl">Changes are kept as you type. Tab moves between fields, Enter closes the row.</p>

      {msg && <p className="pmsg">{msg}</p>}
      <div className="pfoot">
        {canOrder ? <>
          <button type="button" className={`btn${madeKind === 'rfq' ? ' ok' : ''}`} disabled={busy || !readyToOrder} title={readyToOrder ? undefined : 'Set the project and supplier first'} onClick={() => create(true)}>{madeKind === 'rfq' ? <><Tick />Quotes requested</> : makingKind === 'rfq' ? <><span className="spin" />Requesting…</> : 'Request quotes'}</button>
          <button type="button" className={`btn pri${madeKind === 'po' ? ' ok' : ''}`} disabled={busy || !readyToOrder} title={readyToOrder ? undefined : 'Set the project and supplier first'} onClick={() => create(false)}>{madeKind === 'po' ? <><Tick />PO made</> : makingKind === 'po' ? <><span className="spin" />Creating…</> : 'Make PO'}</button>
        </> : <button type="button" className="btn" disabled title="A supervisor can review but not raise an order">Only a manager can order</button>}
      </div>
    </>
  );
}

// The peek's resolve picker — styled EXACTLY as the reference's `.pk .sel` (ring → ✓, chevron), but real:
// typing opens a ranked dropdown, a pick sets the record, and (for vendors) an inline "add" creates the party.
function PkResolve({ label, ask, text, id, rank, createLabel, orgId, onText, onPick, onClear, onCreated }: {
  label: string; ask: string; text: string; id: string; rank: (q: string) => Opt[];
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
  const chev = <svg className="c" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>;
  return (
    <div className="pk" ref={boxRef as any}>
      <label>{label}</label>
      <div className="pkbox">
        {id
          ? <button type="button" className="sel" onClick={onClear}><span className="tk"><Tick /></span><span className="tx">{text}</span>{chev}</button>
          : <div className="sel ask"><span className="ring" /><input value={text} placeholder={ask} onChange={(e) => { onText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />{chev}</div>}
        {open && !id && (hits.length > 0 || canAdd) && (
          <div className="rz-drop">
            {hits.map((h) => <button key={h.id} type="button" className="rz-opt" onMouseDown={(e) => { e.preventDefault(); onPick(h); setOpen(false); }}>{h.name}{h.sub ? <small>{h.sub}</small> : null}</button>)}
            {canAdd && <button type="button" className="rz-opt rz-add" onMouseDown={(e) => { e.preventDefault(); void addNew(); }}>{adding ? 'Adding…' : `+ Add “${text.trim()}” as a new ${createLabel}`}</button>}
          </div>
        )}
      </div>
    </div>
  );
}
