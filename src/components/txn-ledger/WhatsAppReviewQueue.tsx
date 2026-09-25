/**
 * WhatsAppReviewQueue — the Day Book review, brought home to the Transactions page.
 *
 * Entries captured over WhatsApp (rough_entries, PENDING / AWAITING_CONTEXT) sit as paper at the TOP of the
 * ledger: who sent it, what was read, what it still needs, one button. Approve files it DOWN into the ledger
 * below. Unposted money is never in the net figure — it waits here.
 *
 * This is the artifact's "Waiting from WhatsApp" section (docs/artifact), wired to the REAL write path:
 *   · resolveEntry()  — the AI blob → payee/project ids against the live lists
 *   · matchPayee() / searchPayees() / matchProject()  — the fuzzy resolvers the picker menus use
 *   · fileRoughEntry() / fileBill() / fileRoughEntrySplit() / createParty() / rejectRoughEntry()
 * The SPLIT reuses the proven day-book CardSplitPanel (fileRoughEntrySplit) rather than a second split UI.
 *
 * Deliberate v1 simplifications vs the mock (no real backing on the server, so not faked):
 *   · no "purpose / how it posts" control — posting is derived from allocations, not a free choice
 *   · date is shown read-only (fileRoughEntry keeps the entry's own date)
 *   · "Paid from → Wallet" means the SENDER's wallet (walletForSender), not an arbitrary pick
 *   · no duplicate banner — the client types don't model it (idempotency is guarded server-side)
 */
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useOrgId } from '../../lib/auth/AuthProvider';
import type { RoughEntry } from '../../types';
import {
  resolveEntry, type StakeholderLite, type ProjectLite,
} from '../day-book/resolveEntry';
import {
  fileRoughEntry, fileBill, createParty, rejectRoughEntry,
  isResolved, isBillResolved, errMessage,
  type ResolvedFields,
} from '../day-book/fileEntry';
import { matchPayee, searchPayees } from '../../lib/payeeSearch';
import { matchProject } from '../../lib/projectSearch';
import { CardSplitPanel } from '../day-book/CardSplitPanel';
import { useSignedDocUrl } from '../../lib/storage';

// resolveEntry's StakeholderLite has no aliases; the daybook query selects them and the fuzzy matchers use
// them, so carry a widened type (assignable back to StakeholderLite for resolveEntry / CardSplitPanel).
type StakeLite = StakeholderLite & { aliases?: string[] | null };

// ── small helpers ─────────────────────────────────────────────────────────────
const inr = (n: number) => {
  const s = String(Math.abs(Math.round(n)));
  if (s.length <= 3) return '₹' + s;
  const last = s.slice(-3), rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return '₹' + rest + ',' + last;
};
const initials = (n: string) => (n || '?').split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
const first = (n: string) => (n || '').split(' ')[0];
const short = (s: string) => (s || '').replace('Residence', 'Res.').replace('Apartments', 'Apts');
// a stable colour per project name (the mock hard-coded these; here we derive one)
const SITE_HUES = ['#B5472A', '#2F5D3A', '#8A6A2E', '#4B5F8A', '#6A4B8A', '#2E6E7A'];
const siteColor = (name: string) => {
  if (!name) return '#8A7B6E';
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return SITE_HUES[h % SITE_HUES.length];
};
const whenLabel = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(+d)) return '';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
};

type Draft = {
  payeeId: string; payeeName: string; payeeType: string;
  projectId: string; projectName: string;
  amount: number; description: string;
  funding?: 'wallet' | 'bank';
  alias?: string;
};

type MenuState = { id: string; kind: 'party' | 'site' | 'type' | 'from' } | null;

export default function WhatsAppReviewQueue() {
  const orgId = useOrgId();
  const qc = useQueryClient();

  // ── data — same shapes ReviewCard/resolveEntry expect ──
  const { data: entries = [] } = useQuery({
    queryKey: ['rough_entries'],
    queryFn: async () => {
      const { data, error } = await supabase.from('rough_entries').select('*')
        .in('status', ['PENDING', 'AWAITING_CONTEXT'])
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as RoughEntry[];
    },
  });
  const { data: stakeholders = [] } = useQuery({
    queryKey: ['daybook_stakeholders'],
    queryFn: async () => {
      const { data, error } = await supabase.from('stakeholders')
        .select('stakeholder_id, name, type, category, aliases').is('merged_into', null).order('name');
      if (error) throw error;
      return (data ?? []) as StakeLite[];
    },
  });
  const { data: projects = [] } = useQuery({
    queryKey: ['daybook_projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects')
        .select('project_id, name').eq('status', 'Active').order('name');
      if (error) throw error;
      return (data ?? []) as ProjectLite[];
    },
  });

  const [openId, setOpenId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [splitId, setSplitId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [filing, setFiling] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState('');
  const [lightbox, setLightbox] = useState<string | null>(null);
  // The queue opens COLLAPSED — a quiet one-line summary that invites a tap. The choice is remembered.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('bk-warq-open') !== '1'; } catch { return true; }
  });
  const setCollapsedPersist = useCallback((v: boolean) => {
    setCollapsed(v); try { localStorage.setItem('bk-warq-open', v ? '0' : '1'); } catch { /* private mode */ }
  }, []);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2800);
  }, []);

  const stakeTypeById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stakeholders) m.set(s.stakeholder_id, (s.category || s.type || '') as string);
    return m;
  }, [stakeholders]);

  // per-entry resolution + the editable draft on top of it
  const resolve = useCallback((e: RoughEntry) => resolveEntry(e, stakeholders, projects), [stakeholders, projects]);

  const draftFor = useCallback((e: RoughEntry): Draft => {
    const existing = drafts[e.id];
    if (existing) return existing;
    const r = resolve(e);
    const ai = e.ai_extracted || {};
    const isBill = ai.kind === 'BILL';
    const amount = isBill ? Number(ai.payment?.amount ?? ai.bill_total ?? r.amount ?? 0) : (r.amount || 0);
    return {
      payeeId: r.payeeId ?? '',
      payeeName: r.payeeName ?? (ai.payee_raw ?? ai.vendor_name ?? ''),
      payeeType: r.payeeId ? (stakeTypeById.get(r.payeeId) || '') : '',
      projectId: r.projectId ?? '',
      projectName: r.projectName ?? (ai.project_raw ?? ''),
      amount, description: r.description ?? (ai.description ?? ''),
      funding: undefined,
    };
  }, [drafts, resolve, stakeTypeById]);

  const patchDraft = useCallback((e: RoughEntry, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [e.id]: { ...draftFor(e), ...patch } }));
  }, [draftFor]);

  // Reject the AI's reading of ONE field before approving — it drops back to "needs input" so the reviewer
  // picks the right one. The raw heard value is kept as the hint (menu default), only the resolved id clears.
  const rejectField = useCallback((e: RoughEntry, field: 'party' | 'site') => {
    if (field === 'party') patchDraft(e, { payeeId: '', payeeType: '', alias: undefined });
    else patchDraft(e, { projectId: '' });
    say(field === 'party' ? 'Cleared the payee — pick the right one' : 'Cleared the project — pick the right one');
  }, [patchDraft, say]);

  const isBillEntry = (e: RoughEntry) => e.ai_extracted?.kind === 'BILL';
  const readyOf = useCallback((e: RoughEntry): boolean => {
    const d = draftFor(e);
    if (isBillEntry(e)) return isBillResolved({ vendorId: d.payeeId, projectId: d.projectId || null, amount: d.amount });
    return isResolved({ payeeId: d.payeeId, projectId: d.projectId, amount: d.amount, description: d.description });
  }, [draftFor]);

  const said = (e: RoughEntry) =>
    e.raw_text || e.transcribed_text || e.ai_extracted?.description_raw || e.ai_extracted?.description || 'Photo / voice note';
  const ref = (e: RoughEntry) => e.re_number || ('DB-' + e.id.slice(0, 4).toUpperCase());

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['rough_entries'] });
    qc.invalidateQueries({ queryKey: ['daybook_review_count'] });
    qc.invalidateQueries({ queryKey: ['ledger'] });
    qc.invalidateQueries({ queryKey: ['stakeholders'] });
    qc.invalidateQueries({ queryKey: ['projects'] });
  }, [qc]);

  // ── actions ──
  const approve = useCallback(async (e: RoughEntry, quiet = false) => {
    if (filing.has(e.id)) return;
    const d = draftFor(e);
    if (!readyOf(e)) { setOpenId(e.id); say('One thing before this posts — fill what is marked.'); return; }
    setFiling((s) => new Set(s).add(e.id));
    try {
      if (isBillEntry(e)) {
        const ai = e.ai_extracted!;
        await fileBill(e, orgId, {
          vendorId: d.payeeId, projectId: d.projectId || null,
          amount: Number(ai.bill_total ?? d.amount), paidAmount: ai.payment?.amount ?? null,
          funding: d.funding,
        });
      } else {
        const fields: ResolvedFields = {
          payeeId: d.payeeId, projectId: d.projectId, amount: d.amount, description: d.description, funding: d.funding,
        };
        await fileRoughEntry(e, orgId, fields);
      }
      if (!quiet) say('Posted · ' + inr(d.amount) + ' to ' + (d.payeeName || 'party'));
      if (openId === e.id) setOpenId(null);
      setMenu(null);
      invalidateAll();
    } catch (err) {
      say(errMessage(err, "Couldn't file — try again"));
    } finally {
      setFiling((s) => { const n = new Set(s); n.delete(e.id); return n; });
    }
  }, [filing, draftFor, readyOf, orgId, openId, say, invalidateAll]);

  const discard = useCallback(async (e: RoughEntry) => {
    setMenu(null);
    try { await rejectRoughEntry(e); say('Discarded'); invalidateAll(); }
    catch (err) { say(errMessage(err, "Couldn't discard")); }
  }, [say, invalidateAll]);

  const approveAll = useCallback(async () => {
    const ready = entries.filter(readyOf);
    const rest = entries.filter((e) => !readyOf(e));
    for (const e of ready) { await approve(e, true); }
    if (rest.length) { setOpenId(rest[0].id); say((ready.length ? 'Posted ' + ready.length + '. ' : '') + rest.length + (rest.length === 1 ? ' entry needs' : ' entries need') + ' a detail first.'); }
    else if (ready.length) say('Posted ' + ready.length + ' ' + (ready.length === 1 ? 'entry' : 'entries'));
  }, [entries, readyOf, approve, say]);

  // close any open menu on an outside click / escape
  useEffect(() => {
    if (!menu) return;
    const onDoc = (ev: MouseEvent) => { if (!(ev.target as HTMLElement).closest('.war-menu, [data-fix]')) setMenu(null); };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [menu]);

  if (entries.length === 0) return null;   // nothing waiting → the section is simply absent

  const sum = entries.reduce((a, e) => a + draftFor(e).amount, 0);
  const allReady = entries.every(readyOf);
  const senders = Array.from(new Set(entries.map((e) => e.sender_name || 'WhatsApp')));
  const previewNames = senders.slice(0, 3).map(first).join(', ') + (senders.length > 3 ? ' +' + (senders.length - 3) : '');
  const latest = entries[entries.length - 1];   // oldest-first, so the last is the most recent

  // ── collapsed: a quiet one-line peek that invites a tap ──
  if (collapsed) {
    return (
      <section className="war war-collapsed">
        <style>{CSS}</style>
        <button type="button" className="war-peek" onClick={() => setCollapsedPersist(false)}>
          <span className="war-mark" dangerouslySetInnerHTML={{ __html: WA }} />
          <span className="war-peek-avs">{senders.slice(0, 3).map((s) => <span key={s} className="av">{initials(s)}</span>)}</span>
          <span className="war-peek-txt">
            <b>{entries.length} waiting from WhatsApp<em>{inr(sum)}</em></b>
            <span className="pv">from {previewNames} · <i>“{said(latest).slice(0, 60)}{said(latest).length > 60 ? '…' : ''}”</i></span>
          </span>
          <span className="war-peek-cta">Review<span className="chev" dangerouslySetInnerHTML={{ __html: CHV }} /></span>
        </button>
        {lightbox && <div className="war-lb" onClick={() => setLightbox(null)}><img src={lightbox} alt="what was sent" /></div>}
      </section>
    );
  }

  return (
    <section className="war war-open">
      <style>{CSS}</style>
      <div className="war-hd">
        <span className="war-mark" dangerouslySetInnerHTML={{ __html: WA }} />
        <h2>Waiting from WhatsApp<b>{entries.length}</b><b>{inr(sum)}</b>
          <button type="button" className="war-all" onClick={approveAll}>Approve all {entries.length}</button>
        </h2>
        <span className="war-n">{allReady ? 'Everything is read. Approve them one by one, or all at once.' : 'Not posted yet. Approve what is ready; anything missing will ask.'}</span>
        <button type="button" className="war-collapse" title="Collapse" aria-label="Collapse" onClick={() => setCollapsedPersist(true)}><span className="chev up" dangerouslySetInnerHTML={{ __html: CHV }} /></button>
      </div>

      {entries.map((e) => {
        const d = draftFor(e);
        const open = openId === e.id;
        const isFiling = filing.has(e.id);
        const projColor = d.projectName ? siteColor(d.projectName) : '#8A7B6E';
        return (
          <div key={e.id} className={'war-req' + (open ? ' open' : '') + (isFiling ? ' filing' : '')}>
            <div className="war-row" onClick={(ev) => { if (!(ev.target as HTMLElement).closest('button,a,input,.war-menu')) setOpenId(open ? null : e.id); }}>
              <EntryPaper entry={e} amount={d.amount} onOpen={setLightbox} />
              {/* what */}
              <div className="war-what">
                <b>{d.payeeName || 'Not read'}</b>
                <span>{d.projectName ? <><i style={{ background: projColor }} />{short(d.projectName)}</> : 'Site not read'}{d.payeeType ? ' · ' + d.payeeType : ''}</span>
                <q title={said(e)}>{said(e)}</q>
              </div>
              {/* who */}
              <div className="war-who">
                <span className="av">{initials(e.sender_name || 'WA')}</span>
                <div><span className="nm">{e.sender_name || 'WhatsApp'}</span><span className="sub">{whenLabel(e.created_at)}</span></div>
              </div>
              {/* needs — a resolved chip carries a reject ✕ so a wrong reading can be cleared before approving */}
              <div className="war-needs">
                {d.payeeId
                  ? <span className="war-chip"><button type="button" className="war-need ok" data-fix onClick={() => setMenu({ id: e.id, kind: 'party' })} title="Change who was paid"><i dangerouslySetInnerHTML={{ __html: TICK }} /><b>{d.payeeName}</b>{d.alias ? <small>also “{d.alias}”</small> : null}<span className="ch" dangerouslySetInnerHTML={{ __html: CHV }} /></button><button type="button" className="war-rej" title="Not the right payee — clear it" aria-label="Reject payee" onClick={(ev) => { ev.stopPropagation(); rejectField(e, 'party'); }} dangerouslySetInnerHTML={{ __html: X }} /></span>
                  : <button type="button" className="war-need" data-fix onClick={() => setMenu({ id: e.id, kind: 'party' })}><i />Add to contacts<span className="ch" dangerouslySetInnerHTML={{ __html: CHV }} /></button>}
                {d.projectId
                  ? <span className="war-chip"><button type="button" className="war-need ok" data-fix onClick={() => setMenu({ id: e.id, kind: 'site' })} title="Change the project"><i style={{ boxShadow: 'none', background: projColor }} /><b>{short(d.projectName)}</b><span className="ch" dangerouslySetInnerHTML={{ __html: CHV }} /></button><button type="button" className="war-rej" title="Not the right project — clear it" aria-label="Reject project" onClick={(ev) => { ev.stopPropagation(); rejectField(e, 'site'); }} dangerouslySetInnerHTML={{ __html: X }} /></span>
                  : <button type="button" className="war-need" data-fix onClick={() => setMenu({ id: e.id, kind: 'site' })}><i />Which project?<span className="ch" dangerouslySetInnerHTML={{ __html: CHV }} /></button>}
                {menu && menu.id === e.id && (menu.kind === 'party' || menu.kind === 'site' || menu.kind === 'type' || menu.kind === 'from') && !open &&
                  <FieldMenu kind={menu.kind} entry={e} draft={d} stakeholders={stakeholders} projects={projects}
                    onPatch={(p) => patchDraft(e, p)} onClose={() => setMenu(null)} say={say} orgId={orgId} setMenu={setMenu} />}
              </div>
              {/* amount */}
              <div className="war-amt">− {inr(d.amount)}<small>unposted</small></div>
              {/* actions */}
              <div className="war-go">
                <button type="button" className="war-btn pri" disabled={isFiling} onClick={() => approve(e)}><span dangerouslySetInnerHTML={{ __html: TICK }} />Approve</button>
                {!isBillEntry(e) && <button type="button" className="war-btn split" onClick={() => { setOpenId(e.id); setSplitId(e.id); }}>Split</button>}
                <button type="button" className="war-btn dots" aria-label="More" onClick={() => setMenu(menu && menu.kind === 'from' && menu.id === e.id ? null : { id: e.id, kind: 'from' })}>···</button>
                {menu && menu.id === e.id && menu.kind === 'from' &&
                  <div className="war-menu" style={{ right: 0, left: 'auto' }}>
                    <button type="button" onClick={() => { setMenu(null); say('Opens the WhatsApp thread with ' + first(e.sender_name || '')); }}><span dangerouslySetInnerHTML={{ __html: WA_G }} />Reply to {first(e.sender_name || 'them')} on WhatsApp</button>
                    <button type="button" onClick={() => discard(e)}>Not a payment — discard</button>
                  </div>}
              </div>
            </div>

            {open &&
              <div className="war-more">
                <div className="war-story">
                  <EntryPaper entry={e} amount={d.amount} big onOpen={setLightbox} />
                  <div>
                    <p className="said">“{said(e)}”</p>
                    <div className="meta">{e.sender_name || 'WhatsApp'} · {whenLabel(e.created_at)} · via WhatsApp · Nº {ref(e)}</div>
                  </div>
                </div>

                {splitId === e.id
                  ? <div className="war-splitwrap">
                      <CardSplitPanel entry={e} orgId={orgId} stakeholders={stakeholders} projects={projects}
                        base={{ payeeId: d.payeeId || '', payeeName: d.payeeName || '', projectId: d.projectId || '', amount: d.amount, description: d.description }}
                        onFiled={() => { setSplitId(null); setOpenId(null); say('Filed as a split'); invalidateAll(); }}
                        onClose={() => setSplitId(null)}
                        onError={(m) => say(m)} />
                    </div>
                  : <ReviewForm entry={e} draft={d} isBill={isBillEntry(e)} menu={menu}
                      stakeholders={stakeholders} projects={projects} orgId={orgId}
                      onPatch={(p) => patchDraft(e, p)} onReject={(f) => rejectField(e, f)} setMenu={setMenu} say={say} whenLabel={whenLabel(e.created_at)} />}
              </div>}
          </div>
        );
      })}

      {toast && <div className="war-toast">{toast}</div>}
      {lightbox && <div className="war-lb" onClick={() => setLightbox(null)}><img src={lightbox} alt="what was sent" /></div>}
    </section>
  );
}

// ── the paper — the actual photo when the entry carried one, else the amount slip ─────────────────────────
function EntryPaper({ entry, amount, big, onOpen }: { entry: RoughEntry; amount: number; big?: boolean; onOpen: (url: string) => void }) {
  const signed = useSignedDocUrl(entry.raw_image_url);   // the stored URL can go stale — re-sign it
  const url = signed ?? entry.raw_image_url ?? null;
  const isBill = entry.ai_extracted?.kind === 'BILL';
  const modeTxt = entry.ai_extracted?.mode ? 'paid via ' + entry.ai_extracted.mode : (isBill ? 'bill' : 'paid');
  if (url) {
    return (
      <button type="button" className={'war-paper has-img' + (big ? ' big' : '')} title="Open the photo" aria-label="Open the photo"
        onClick={(ev) => { ev.stopPropagation(); onOpen(url); }}>
        <img src={url} alt="what was sent" />
      </button>
    );
  }
  return (
    <div className={'war-paper' + (big ? ' big' : '')}>
      <span className="rc">{inr(amount).replace('₹', '')}<small>{modeTxt}</small></span>
    </div>
  );
}

// ── the expanded review form (right column) ───────────────────────────────────
function ReviewForm({ entry, draft, isBill, menu, stakeholders, projects, orgId, onPatch, onReject, setMenu, say }: {
  entry: RoughEntry; draft: Draft; isBill: boolean; menu: MenuState;
  stakeholders: StakeLite[]; projects: ProjectLite[]; orgId: string;
  onPatch: (p: Partial<Draft>) => void; onReject: (f: 'party' | 'site') => void; setMenu: (m: MenuState) => void; say: (m: string) => void; whenLabel: string;
}) {
  const projColor = draft.projectName ? siteColor(draft.projectName) : '#8A7B6E';
  const open = (kind: NonNullable<MenuState>['kind']) => setMenu(menu && menu.id === entry.id && menu.kind === kind ? null : { id: entry.id, kind });
  const dateLabel = entry.ai_extracted?.date || new Date(entry.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return (
    <div className="war-form">
      <div className="grid">
        <label>Paid to</label>
        <div className="war-fld">
          <button type="button" className={'ctl' + (draft.payeeId ? '' : ' miss')} data-fix onClick={() => open('party')}>
            <span className="v">{draft.payeeId ? <>{draft.payeeName}{draft.payeeType ? <small>{draft.payeeType}</small> : null}</> : <>Add “{draft.payeeName || 'party'}” to contacts</>}</span>
            <span className="ch" dangerouslySetInnerHTML={{ __html: CHV }} />
          </button>
          {draft.payeeId && <button type="button" className="war-rej fld" title="Not the right payee — clear it" aria-label="Reject payee" onClick={() => onReject('party')} dangerouslySetInnerHTML={{ __html: X }} />}
          {menu && menu.id === entry.id && (menu.kind === 'party' || menu.kind === 'type') &&
            <FieldMenu kind={menu.kind} entry={entry} draft={draft} stakeholders={stakeholders} projects={projects} onPatch={onPatch} onClose={() => setMenu(null)} say={say} orgId={orgId} setMenu={setMenu} inForm />}
        </div>

        <label>Project</label>
        <div className="war-fld">
          <button type="button" className={'ctl' + (draft.projectId ? '' : ' miss')} data-fix onClick={() => open('site')}>
            <span className="v">{draft.projectId ? <><i style={{ background: projColor }} />{draft.projectName}</> : 'Choose a project'}</span>
            <span className="ch" dangerouslySetInnerHTML={{ __html: CHV }} />
          </button>
          {draft.projectId && <button type="button" className="war-rej fld" title="Not the right project — clear it" aria-label="Reject project" onClick={() => onReject('site')} dangerouslySetInnerHTML={{ __html: X }} />}
          {menu && menu.id === entry.id && menu.kind === 'site' &&
            <FieldMenu kind="site" entry={entry} draft={draft} stakeholders={stakeholders} projects={projects} onPatch={onPatch} onClose={() => setMenu(null)} say={say} orgId={orgId} setMenu={setMenu} inForm />}
        </div>

        <label>Amount</label>
        <div className="war-fld">
          <div className="amtrow">
            <span className="ctl amtctl"><span className="pre">₹</span>
              <input className="mono" type="text" inputMode="numeric" defaultValue={Math.round(draft.amount).toLocaleString('en-IN')}
                aria-label="Amount" disabled={isBill}
                onBlur={(ev) => { const v = parseInt(ev.target.value.replace(/[^\d]/g, ''), 10); if (v && v !== draft.amount) { onPatch({ amount: v }); say('Amount set to ' + inr(v)); } else if (!v) ev.target.value = Math.round(draft.amount).toLocaleString('en-IN'); }}
                onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }} />
            </span>
            <span className="on-date">on <b>{dateLabel}</b></span>
          </div>
        </div>

        <label>Paid from</label>
        <div className="war-fld">
          <div className="seg" role="group" aria-label="Paid from">
            <button type="button" className={draft.funding === 'wallet' ? '' : 'on'} onClick={() => onPatch({ funding: 'bank' })}><span dangerouslySetInnerHTML={{ __html: BANK }} />Company</button>
            <button type="button" className={draft.funding === 'wallet' ? 'on' : ''} onClick={() => onPatch({ funding: 'wallet' })}><span dangerouslySetInnerHTML={{ __html: WAL }} />Wallet<small>{first(entry.sender_name || 'sender')}</small></button>
          </div>
        </div>

        <label>For</label>
        <div className="war-fld">
          <span className="line"><input type="text" placeholder="What was this for? Optional." defaultValue={draft.description || ''} aria-label="Note"
            onBlur={(ev) => onPatch({ description: ev.target.value })} /></span>
        </div>
      </div>
    </div>
  );
}

// ── field menus (party / site / type) ─────────────────────────────────────────
function FieldMenu({ kind, entry, draft, stakeholders, projects, onPatch, onClose, say, orgId, setMenu, inForm }: {
  kind: NonNullable<MenuState>['kind']; entry: RoughEntry; draft: Draft;
  stakeholders: StakeLite[]; projects: ProjectLite[];
  onPatch: (p: Partial<Draft>) => void; onClose: () => void; say: (m: string) => void;
  orgId: string; setMenu: (m: MenuState) => void; inForm?: boolean;
}) {
  const [q, setQ] = useState(kind === 'party' ? (draft.payeeName || '') : '');
  const [busy, setBusy] = useState(false);
  const raw = draft.payeeName || entry.ai_extracted?.payee_raw || '';

  if (kind === 'site') {
    const m = matchProject(raw, projects.map((p) => ({ id: p.project_id, name: p.name })));
    const best = m.band !== 'open' ? m.best : null;
    return (
      <div className={'war-menu' + (inForm ? ' inform' : '')}>
        <h4>Which project is this for?</h4>
        {projects.map((p) => (
          <button key={p.project_id} type="button" className={p.project_id === draft.projectId ? 'sel' : ''}
            onClick={() => { onPatch({ projectId: p.project_id, projectName: p.name }); say('Project set to ' + short(p.name)); onClose(); }}>
            <i style={{ background: siteColor(p.name) }} />{p.name}{best && best.id === p.project_id ? <small>closest</small> : null}
          </button>
        ))}
      </div>
    );
  }

  if (kind === 'type') {
    return (
      <div className={'war-menu' + (inForm ? ' inform' : '')}>
        <h4>Add {raw} as</h4>
        {(['Vendor', 'Worker', 'Client'] as const).map((t) => (
          <button key={t} type="button" disabled={busy} onClick={async () => {
            setBusy(true);
            try { const p = await createParty(raw, t, orgId); onPatch({ payeeId: p.id, payeeName: p.name, payeeType: t }); say(p.name + ' added as ' + t.toLowerCase()); onClose(); }
            catch (err) { say(errMessage(err, "Couldn't add contact")); }
            finally { setBusy(false); }
          }}>{t}</button>
        ))}
      </div>
    );
  }

  // kind === 'party' — the payee resolution menu
  const band = matchPayee(raw, stakeholders.map((s) => ({ stakeholder_id: s.stakeholder_id, name: s.name, type: s.type ?? null, category: s.category ?? null, aliases: s.aliases ?? null })));
  const best = band.band !== 'open' ? band.best : null;
  const results = q.trim() ? searchPayees(stakeholders, q) : stakeholders;
  const nameType = (id: string) => { const s = stakeholders.find((x) => x.stakeholder_id === id); return s ? (s.category || s.type || 'Contact') : 'Contact'; };
  const pick = (s: StakeholderLite, alias?: string) => {
    onPatch({ payeeId: s.stakeholder_id, payeeName: s.name, payeeType: (s.category || s.type || '') as string, alias });
    say(alias ? '“' + alias + '” saved for ' + s.name : 'Paid to ' + s.name);
    onClose();
  };
  return (
    <div className={'war-menu payee' + (inForm ? ' inform' : '')}>
      <input autoFocus type="text" value={q} placeholder="Search your contacts…" aria-label="Search contacts" onChange={(ev) => setQ(ev.target.value)} />
      {best && !q.trim() &&
        <>
          <h4>Best match</h4>
          <div className="best">
            <button type="button" className="two" onClick={() => { const s = stakeholders.find((x) => x.stakeholder_id === best.id); if (s) pick(s); }}>
              <span className="nm">{best.name}</span><small>{nameType(best.id)}{band.band === 'confirm' ? ' · likely' : ' · matched'}</small>
            </button>
            {band.band === 'confirm' && raw &&
              <button type="button" className="sub" onClick={() => { const s = stakeholders.find((x) => x.stakeholder_id === best.id); if (s) pick(s, raw); }}>
                <span dangerouslySetInnerHTML={{ __html: LINK }} /><span>Save <b>“{raw}”</b> as another name for {best.name}, so it matches by itself next time</span>
              </button>}
          </div>
        </>}
      <div className="wa">
        <button type="button" className="new" onClick={() => setMenu({ id: entry.id, kind: 'type' })}>
          <span className="ic">{(raw[0] || '+').toUpperCase()}</span><span>Not here? Add <b>{raw || 'contact'}</b><small>new contact</small></span>
        </button>
      </div>
      <h4>All contacts</h4>
      {results.slice(0, 40).map((s) => (
        <button key={s.stakeholder_id} type="button" className={'two' + (s.stakeholder_id === draft.payeeId ? ' sel' : '')} onClick={() => pick(s)}>
          {s.name}<small>{(s.category || s.type || 'Contact') as string}</small>
        </button>
      ))}
      {results.length === 0 && <div className="note">No contact matches “{q}”.</div>}
    </div>
  );
}

// ── icons ─────────────────────────────────────────────────────────────────────
const WA = '<svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:#25A65B"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.1.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.1-.2-.2-.4-.3Z"/></svg>';
const WA_G = '<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:#25A65B"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Z"/></svg>';
const TICK = '<svg viewBox="0 0 24 24" style="width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round"><path d="m5 12 4.5 4.5L19 7"/></svg>';
const CHV = '<svg viewBox="0 0 24 24" style="fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round"><path d="m6 9 6 6 6-6"/></svg>';
const X = '<svg viewBox="0 0 24 24" style="width:11px;height:11px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const LINK = '<svg viewBox="0 0 24 24"><path d="M10 13a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 1 0-5.7-5.7L11.3 6"/><path d="M14 11a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7L12.7 18"/></svg>';
const BANK = '<svg viewBox="0 0 24 24"><path d="M3 10 12 4l9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"/></svg>';
const WAL = '<svg viewBox="0 0 24 24"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1H6a1.5 1.5 0 0 0 0 3h15v6.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-10Z"/><circle cx="16.5" cy="14.5" r="1"/></svg>';

// ── scoped styles (ported from the artifact's inbox section) ───────────────────
const CSS = `
.war{--ink:#2B211A;--ink-2:#5C4F45;--ink-3:#8A7B6E;--line-2:#DCD2C4;--paper:#FFFFFF;--wash:#F3EEE5;--sheet:#F4EFE6;--clay:#B5472A;--clay-wash:#FBEDE6;--sage:#2F5D3A;--wa:#25A65B;--serif:'Playfair Display',Georgia,serif;--ease:cubic-bezier(.22,.8,.24,1);
  /* the shared, lightened card surface — also used on the PO page (see bk-soft-card) */
  --card:linear-gradient(180deg,#FEFCF8 0%,#F7F2EA 100%);--card-line:#EFE7DA;
  margin:0 0 22px;padding:6px 16px 4px;border-radius:22px;background:var(--card);box-shadow:0 1px 0 rgba(43,33,26,.02),inset 0 0 0 1px var(--card-line);position:relative;font-family:'DM Sans',system-ui,sans-serif;color:var(--ink-2)}
.war *{box-sizing:border-box}
.war .war-hd{display:flex;align-items:center;gap:12px;padding:10px 8px 6px;flex-wrap:wrap}
.war .war-mark{width:22px;height:22px;display:grid;place-items:center}
.war .war-hd h2{margin:0;display:flex;align-items:center;gap:0;font-weight:600;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3)}
.war .war-hd h2 b{font-family:'DM Mono',monospace;font-weight:500;color:var(--ink-2);margin-left:8px;letter-spacing:0}
.war .war-hd h2 b+b{color:var(--ink-3)}
.war .war-all{margin-left:14px;height:30px;padding:0 13px;border-radius:16px;border:1px solid var(--clay);background:none;color:var(--clay);font-size:13px;font-weight:600;line-height:1;cursor:pointer}
.war .war-all:hover{background:var(--clay-wash)}
.war .war-n{margin-left:auto;font-size:12.5px;color:var(--ink-3)}
.war .war-req{border-top:1px dashed var(--card-line);border-radius:14px;transition:background .28s var(--ease),box-shadow .28s var(--ease),transform .5s var(--ease),opacity .4s}
.war .war-req:first-of-type{border-top:0}
.war .war-req:hover{background:rgba(255,255,255,.5)}
.war .war-req.open{background:linear-gradient(180deg,#FFFFFF 0%,#FDFBF7 100%);box-shadow:0 8px 26px -18px rgba(43,33,26,.35);position:relative;z-index:3}
.war .war-req.filing{opacity:0;transform:translateY(40px) scale(.98)}
.war .war-row{display:grid;grid-template-columns:64px minmax(0,1.35fr) minmax(0,.9fr) minmax(0,1.35fr) 130px max-content;gap:20px;align-items:center;padding:14px 8px;cursor:pointer}
.war .war-row>*{min-width:0}
.war .war-paper{position:relative;width:52px;height:68px;border:0;padding:0;border-radius:5px;background:#FBF7F0;box-shadow:0 10px 18px -12px rgba(43,33,26,.55),0 0 0 1px rgba(43,33,26,.06);transform:rotate(-3deg);display:grid;place-items:center;overflow:hidden;transition:transform .3s var(--ease),box-shadow .3s var(--ease)}
.war .war-req:nth-of-type(odd) .war-paper{transform:rotate(2.5deg)}
.war .war-paper.has-img{cursor:zoom-in}
.war .war-paper.has-img:hover{transform:rotate(0) scale(1.04);box-shadow:0 14px 24px -12px rgba(43,33,26,.6),0 0 0 1px rgba(43,33,26,.08)}
.war .war-paper img{width:100%;height:100%;object-fit:cover;display:block}
.war .war-paper .rc{width:44px;text-align:center;font-family:'DM Mono',monospace;font-size:9px;font-weight:500;color:var(--ink);letter-spacing:-.02em}
.war .war-paper .rc small{display:block;font-size:6px;color:var(--ink-3);margin-top:1px}
.war .war-paper.big{width:112px;height:140px;border-radius:8px;transform:rotate(-2deg);box-shadow:0 14px 26px -16px rgba(43,33,26,.6),0 0 0 1px rgba(43,33,26,.07)}
.war .war-paper.big .rc{width:auto;font-size:15px}
.war .war-paper.big .rc small{font-size:8px;font-family:'DM Sans',sans-serif;margin-top:2px}
.war .war-what b{display:block;font-size:15.5px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.war .war-what span{display:block;margin-top:2px;font-size:13px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.war .war-what span i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:7px;vertical-align:1px}
.war .war-what q{display:block;margin-top:6px;font-family:var(--serif);font-style:italic;font-size:13.5px;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;quotes:"“" "”"}
.war .war-who{display:flex;align-items:center;gap:10px;font-size:13.5px;color:var(--ink-2)}
.war .war-who .av{width:30px;height:30px;border-radius:15px;background:rgba(43,33,26,.07);display:grid;place-items:center;font-size:11px;font-weight:700;color:var(--ink-2);flex:none}
.war .war-who>div{min-width:0}
.war .war-who .nm{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.war .war-who .sub{display:block;font-size:12.5px;color:var(--ink-3)}
.war .war-needs{display:flex;flex-direction:row;flex-wrap:wrap;gap:6px;position:relative;max-width:100%}
.war .war-need{display:inline-flex;align-items:center;height:30px;padding:0 10px 0 8px;border-radius:15px;border:1px solid var(--line-2);background:var(--paper);font-size:13px;color:var(--ink);font-weight:500;gap:7px;cursor:pointer;max-width:100%;white-space:nowrap}
.war .war-need i{width:12px;height:12px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--clay);display:grid;place-items:center;flex:none}
.war .war-need .ch{width:11px;height:11px;flex:none;margin-left:2px;color:var(--ink-3)}
.war .war-need b{font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px}
.war .war-need small{color:var(--ink-3);font-weight:400}
.war .war-need.ok i{background:var(--sage);box-shadow:none;color:#fff}
.war .war-need.ok:hover,.war .war-need:hover{border-color:var(--ink-3);background:#FFFDF9}
.war .war-need:not(.ok){border:1.5px dashed var(--clay);color:var(--clay);background:var(--clay-wash)}
.war .war-amt{text-align:right;font-family:'DM Mono',monospace;font-size:17px;font-weight:500;color:var(--ink-2);padding-top:2px}
.war .war-amt small{display:block;font-family:'DM Sans',sans-serif;font-size:11.5px;color:var(--ink-3);font-weight:500;margin-top:2px}
.war .war-go{display:flex;gap:6px;justify-content:flex-end;position:relative;min-width:max-content}
.war .war-btn{height:36px;padding:0 14px;border-radius:18px;border:1px solid transparent;background:none;color:var(--ink);font-weight:600;font-size:14px;display:inline-flex;align-items:center;gap:7px;line-height:1;cursor:pointer;white-space:nowrap}
.war .war-btn svg{flex:none}
.war .war-btn.pri{background:var(--clay);border-color:var(--clay);color:#fff;padding:0 16px 0 13px}
.war .war-btn.pri:hover{background:#D4633E;border-color:#D4633E}
.war .war-btn.pri:disabled{opacity:.5;cursor:default}
.war .war-btn.split{background:var(--ink);border-color:var(--ink);color:#FAF8F3;padding:0 15px}
.war .war-btn.dots{width:36px;padding:0;justify-content:center;color:var(--ink-3);font-size:17px;letter-spacing:.5px}
.war .war-btn.dots:hover,.war .war-btn.split:hover{filter:brightness(1.05)}
/* expanded */
.war .war-more{display:grid;grid-template-columns:1fr 480px;gap:36px;padding:2px 8px 22px;align-items:start}
.war .war-story{display:grid;grid-template-columns:112px 1fr;gap:24px;align-items:start}
.war .war-story .said{font-family:var(--serif);font-style:italic;font-size:16.5px;line-height:1.5;color:var(--ink);margin:0}
.war .war-story .meta{margin-top:6px;font-size:12.5px;color:var(--ink-3);font-family:'DM Mono',monospace}
.war .war-form{border-left:1px dashed var(--line-2);padding-left:32px}
.war .war-form .grid{display:grid;grid-template-columns:78px 1fr;gap:14px 16px;align-items:center}
.war .war-form .grid label{font-size:13px;color:var(--ink-3);font-weight:500}
.war .war-fld{display:flex;align-items:center;gap:10px;position:relative;min-width:0}
.war .war-fld .ctl{display:flex;align-items:center;gap:8px;height:42px;padding:0 10px 0 12px;border-radius:12px;border:1px solid var(--line-2);background:var(--paper);font-size:14px;font-weight:500;color:var(--ink);text-align:left;width:100%;min-width:0;cursor:pointer}
.war .war-fld .ctl:hover{border-color:var(--ink-3)}
.war .war-fld .ctl .v{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.war .war-fld .ctl .v i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px}
.war .war-fld .ctl .v small{font-weight:400;color:var(--ink-3);margin-left:6px}
.war .war-fld .ctl .ch{width:14px;height:14px;flex:none;color:var(--ink-3)}
.war .war-fld .ctl.miss{border:1.5px dashed var(--clay);background:var(--clay-wash);color:var(--clay);font-weight:600}
.war .war-fld .ctl.miss .ch{color:var(--clay)}
.war .war-fld .amtrow{display:flex;align-items:center;gap:10px;width:100%}
.war .war-fld .amtctl{width:200px;flex:none;cursor:text}
.war .war-fld .pre{color:var(--ink-3);font-family:'DM Mono',monospace;font-weight:500}
.war .war-fld .ctl input{border:0;background:none;padding:0;height:100%;width:100%;min-width:0;font-size:14px;font-weight:500;color:var(--ink);outline:none}
.war .war-fld .ctl input.mono{font-family:'DM Mono',monospace}
.war .war-fld .on-date{display:inline-flex;align-items:center;gap:6px;font-size:14px;color:var(--ink-2)}
.war .war-fld .on-date b{font-weight:500;color:var(--ink)}
.war .war-fld .line{display:flex;align-items:center;width:100%;height:42px;border-bottom:1px dashed var(--line-2)}
.war .war-fld .line input{border:0;background:none;padding:0;width:100%;font-size:14.5px;color:var(--ink);outline:none;height:100%}
.war .war-fld .line:focus-within{border-bottom-style:solid;border-bottom-color:var(--ink-2)}
.war .seg{display:inline-flex;height:42px;padding:3px;border-radius:12px;background:var(--wash);border:1px solid #E9E1D6;gap:3px}
.war .seg button{height:100%;padding:0 14px;border:0;border-radius:9px;background:none;font-size:14px;font-weight:500;color:var(--ink-3);display:inline-flex;align-items:center;gap:8px;cursor:pointer}
.war .seg button svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.war .seg button.on{background:var(--paper);color:var(--ink);box-shadow:0 1px 2px rgba(43,33,26,.08),0 0 0 1px #E9E1D6}
.war .seg button small{font-weight:400;color:var(--ink-3);font-family:'DM Mono',monospace;font-size:12px}
.war .war-splitwrap{grid-column:1 / -1}
/* menu */
.war .war-menu{position:absolute;z-index:30;top:calc(100% + 6px);left:0;background:var(--paper);border:1px solid var(--line-2);border-radius:14px;box-shadow:0 18px 40px -20px rgba(43,33,26,.5);padding:6px;min-width:230px;max-height:320px;overflow:auto}
.war .war-menu.inform{left:0;right:0;min-width:0}
.war .war-menu.payee{min-width:340px}
.war .war-menu h4{margin:6px 10px 4px;font-size:11.5px;font-weight:600;color:var(--ink-3);letter-spacing:.04em}
.war .war-menu input{width:100%;height:36px;border:0;border-bottom:1px solid #E9E1D6;padding:0 10px;margin-bottom:4px;background:none;font-size:13.5px;outline:none;color:var(--ink)}
.war .war-menu button{display:flex;align-items:center;gap:10px;width:100%;min-height:36px;padding:0 10px;border:0;background:none;border-radius:9px;font-size:13.5px;color:var(--ink);text-align:left;cursor:pointer}
.war .war-menu button:hover{background:var(--wash)}
.war .war-menu button.sel{background:var(--wash)}
.war .war-menu button.sel::after{content:"";margin-left:auto;width:6px;height:6px;border-radius:50%;background:var(--sage)}
.war .war-menu button i{width:8px;height:8px;border-radius:50%;flex:none}
.war .war-menu button small{color:var(--ink-3);margin-left:auto;font-size:12px}
.war .war-menu button.two{flex-direction:column;align-items:flex-start;gap:2px;padding:8px 10px}
.war .war-menu button.two small{margin-left:0}
.war .war-menu .best{margin:0 0 4px;border:1px solid #E9E1D6;border-radius:12px;background:var(--wash);overflow:hidden}
.war .war-menu .best button.two{border-radius:0}
.war .war-menu .best .nm{font-size:14.5px;font-weight:600;color:var(--ink)}
.war .war-menu .best .sub{border-top:1px dashed var(--line-2);font-size:12.5px;color:var(--ink-2);line-height:1.35;white-space:normal;align-items:flex-start;padding:8px 12px}
.war .war-menu .best .sub svg{width:13px;height:13px;flex:none;fill:none;stroke:var(--ink-3);stroke-width:2;margin-top:1px}
.war .war-menu .best .sub b{font-weight:600}
.war .war-menu .wa{border-top:1px dashed var(--line-2);margin-top:4px;padding-top:4px}
.war .war-menu .wa button .ic{width:26px;height:26px;border-radius:13px;background:#15100C;color:#FAF8F3;display:grid;place-items:center;flex:none;font-weight:700;font-size:12px}
.war .war-menu .wa button small{margin-left:6px}
.war .war-menu .note{font-size:12px;color:var(--ink-3);padding:6px 10px}
.war .war-toast{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);background:#15100C;color:#FAF8F3;padding:12px 18px;border-radius:14px;font-size:14px;z-index:60;box-shadow:0 18px 40px -18px rgba(0,0,0,.6);max-width:520px;text-align:center}
/* reject ✕ — a resolved chip / field carries a quiet way to clear a wrong reading before approving */
.war .war-chip{position:relative;display:inline-flex}
.war .war-rej{position:absolute;top:-6px;right:-6px;width:16px;height:16px;border-radius:8px;border:1px solid var(--line-2);background:#FFFDF9;color:var(--ink-3);display:grid;place-items:center;padding:0;opacity:0;transform:scale(.7);transition:opacity .15s,transform .15s,color .15s,border-color .15s;cursor:pointer;z-index:2}
.war .war-chip:hover .war-rej,.war .war-rej:focus-visible{opacity:1;transform:scale(1)}
.war .war-rej:hover{color:#B3261E;border-color:#E8B4AD;background:#FDF0EE}
.war .war-rej.fld{position:static;opacity:.55;transform:none;width:26px;height:26px;border-radius:13px;flex:none;margin-left:-2px}
.war .war-rej.fld:hover{opacity:1}
/* header collapse control */
.war .war-collapse{width:28px;height:28px;border-radius:14px;border:1px solid transparent;background:none;color:var(--ink-3);display:grid;place-items:center;cursor:pointer;transition:background .15s,color .15s}
.war .war-collapse:hover{background:rgba(43,33,26,.05);color:var(--ink-2)}
.war .war-collapse .chev.up{display:block;transform:rotate(180deg)}
.war .war-collapse .chev.up svg{width:14px;height:14px}
/* collapsed: the quiet peek that invites a tap */
.war.war-collapsed{padding:0}
.war .war-peek{display:flex;align-items:center;gap:14px;width:100%;padding:12px 16px;border:0;background:none;border-radius:22px;text-align:left;cursor:pointer;color:var(--ink-2);transition:background .2s var(--ease)}
.war .war-peek:hover{background:rgba(255,255,255,.5)}
.war .war-peek .war-mark{flex:none}
.war .war-peek-avs{display:inline-flex;flex:none}
.war .war-peek-avs .av{width:26px;height:26px;border-radius:13px;background:#EBE3D6;box-shadow:0 0 0 2px var(--card-line, #FEFCF8);display:grid;place-items:center;font-size:10px;font-weight:700;color:var(--ink-2);margin-left:-8px}
.war .war-peek-avs .av:first-child{margin-left:0}
.war .war-peek-txt{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}
.war .war-peek-txt b{font-size:14px;font-weight:600;color:var(--ink);display:flex;align-items:baseline;gap:8px}
.war .war-peek-txt b em{font-style:normal;font-family:'DM Mono',monospace;font-weight:500;font-size:13px;color:var(--clay)}
.war .war-peek-txt .pv{font-size:12.5px;color:var(--ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.war .war-peek-txt .pv i{font-family:var(--serif);font-style:italic;color:var(--ink-2)}
.war .war-peek-cta{flex:none;display:inline-flex;align-items:center;gap:4px;height:32px;padding:0 12px;border-radius:16px;border:1px solid var(--clay);color:var(--clay);font-size:13px;font-weight:600;background:none;transition:background .18s}
.war .war-peek:hover .war-peek-cta{background:var(--clay-wash)}
.war .war-peek-cta .chev{width:13px;height:13px;transform:rotate(-90deg)}
/* lightbox */
.war .war-lb{position:fixed;inset:0;z-index:80;background:rgba(21,16,12,.78);display:grid;place-items:center;padding:32px;cursor:zoom-out;animation:war-fade .2s ease}
.war .war-lb img{max-width:min(92vw,900px);max-height:90vh;border-radius:10px;box-shadow:0 30px 80px -20px rgba(0,0,0,.7)}
@keyframes war-fade{from{opacity:0}to{opacity:1}}
@media (max-width:1100px){.war .war-more{grid-template-columns:1fr}.war .war-form{border-left:0;padding-left:0}.war .war-peek-txt .pv{display:none}}
@media (prefers-reduced-motion:reduce){.war *{transition:none!important}}
`;
