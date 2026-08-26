// Bulk Excel/CSV import for the Transactions page — the 4-step wizard (Upload → Names → Sites →
// Check → Done). Decisions live in the tested src/lib import layer; the resolve rows are the faithful
// prototype state machine (components/import/ResolveRow). Design follows briklay-import-simple.html.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useOrgId } from '../lib/auth/AuthProvider';
import { useSnackbar } from '../components/Snackbar';
import { OTHER_TRADE } from '../lib/trades';
import { readWorkbook } from '../lib/importWorkbook';
import { parseTable, hasAmbiguousDates } from '../lib/importSheet';
import {
  groupNames, groupSites, validateRow, findDuplicates,
  type ParsedRow, type ExistingTxn, type ResolvedRow,
} from '../lib/importResolve';
import { partiesToClassify, classificationsByName, TRADE_VOCAB } from '../lib/importClassify';
import { scorePayeeName } from '../lib/payeeSearch';
import { parseIndianAmount, parseSheetDate, type TxnMode } from '../lib/importParse';
import { commitImport, type ResolvedCommitRow, type NewStakeholder, type NewProject, type CommitResult } from '../lib/importCommit';
import ResolveRow, { type ResolveValue, type Cand } from '../components/import/ResolveRow';
import NameFixPicker, { type RowPartyChoice } from '../components/import/NameFixPicker';
import SiteResolveRow from '../components/import/SiteResolveRow';
import { loadImportDraft, saveImportDraft, clearImportDraft } from '../lib/importDraft';

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const inr = (n: number) => '₹' + n.toLocaleString('en-IN');
const MODES: TxnMode[] = ['Cash', 'UPI', 'NEFT', 'Cheque'];
const STEP_NAME = ['Upload', 'Names', 'Sites', 'Check'];

type SB = { stakeholder_id: string; name: string; type: string; category: string | null };
type PR = { id: string; name: string };

/** A project applied to the whole sheet: none, an existing project, or a new one created at commit. */
type BulkProject = { kind: 'none' } | { kind: 'existing'; id: string; name: string } | { kind: 'new'; name: string };

/** Everything the wizard needs to resume an in-progress import (autosaved to localStorage). */
interface ImportDraft {
  v: 1;
  batchId: string;
  fileName: string;
  step: number;
  rows: ParsedRow[];
  dayFirst: boolean | undefined;
  nameRes: Record<string, ResolveValue>;
  siteRes: Record<string, ResolveValue>;
  created: SB[];
  createdProj: PR[];
  fixEdit: Record<number, string>;
  rowParty: Record<number, RowPartyChoice>;
  fixSkip: Record<number, boolean>;
  dupKeep: Record<number, boolean>;
  defaultMode: TxnMode;
  bulkProject?: BulkProject;
  savedAt: number;
}

function agoLabel(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.round(h / 24)} d ago`;
}

export default function ImportTransactions({ onClose }: { session: Session; onClose?: (imported?: boolean) => void }) {
  const navigate = useNavigate();
  const orgId = useOrgId();
  const { show: showSnackbar } = useSnackbar();
  const fileInput = useRef<HTMLInputElement>(null);
  const classifiedRef = useRef(false);

  const [batchId, setBatchId] = useState(() => 'imp' + Math.random().toString(36).slice(2, 10));
  const refYear = useMemo(() => new Date().getFullYear(), []);
  const [draft, setDraft] = useState<ImportDraft | null>(null);   // a saved, resumable import (shown on Upload)

  const [step, setStep] = useState(0);
  const [stakeholders, setStakeholders] = useState<SB[]>([]);
  const [projects, setProjects] = useState<PR[]>([]);
  const [created, setCreated] = useState<SB[]>([]);            // parties inserted DURING this import (insert-on-tick)
  const [createdProj, setCreatedProj] = useState<PR[]>([]);    // projects inserted during this import
  const [loaded, setLoaded] = useState(false);

  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [dayFirst, setDayFirst] = useState<boolean | undefined>(undefined);
  const [existing, setExisting] = useState<ExistingTxn[]>([]);

  const [nameRes, setNameRes] = useState<Record<string, ResolveValue>>({});
  const [siteRes, setSiteRes] = useState<Record<string, ResolveValue>>({});
  const [fixEdit, setFixEdit] = useState<Record<number, string>>({});
  const [rowParty, setRowParty] = useState<Record<number, RowPartyChoice>>({}); // blank-name rows: chosen party / new / no-party
  const [fixSkip, setFixSkip] = useState<Record<number, boolean>>({});
  const [dupKeep, setDupKeep] = useState<Record<number, boolean>>({});
  // Whole-sheet project: applied to every row that has no site of its own (the common "one sheet = one
  // project" case, e.g. a single-site expenses export with no per-row site column).
  const [bulkProject, setBulkProject] = useState<BulkProject>({ kind: 'none' });

  const [committing, setCommitting] = useState(false);
  const [defaultMode, setDefaultMode] = useState<TxnMode>('Cash'); // fallback for rows whose sheet left mode blank
  const [result, setResult] = useState<CommitResult | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);       // rows we sent to the RPC (the import checksum LHS)
  const [verifiedCount, setVerifiedCount] = useState<number | null>(null); // rows the DB actually holds for the batch
  const [focusKey, setFocusKey] = useState<string | null>(null);   // row whose create-form name field should focus

  // After a row is ticked, jump to the next row that still needs a create-form (mode 'form').
  const advanceFocus = (groups: { key: string }[], res: Record<string, ResolveValue>, afterKey: string) => {
    const i = groups.findIndex((g) => g.key === afterKey);
    for (let j = i + 1; j < groups.length; j++) if (res[groups[j].key]?.mode === 'form') return setFocusKey(groups[j].key);
    setFocusKey(null);
  };

  const stkLabel = (s: SB) => `${s.name} (${s.type.toLowerCase()}${s.category ? ` · ${s.category.toLowerCase()}` : ''})`;
  // Grouping uses the LOADED roster only (stable). The search POOL adds session-created parties so a
  // later variant spelling can match one you just made — the fix for the duplicate problem.
  const allStk = useMemo(() => [...stakeholders, ...created], [stakeholders, created]);
  const allProj = useMemo(() => [...projects, ...createdProj], [projects, createdProj]);
  const stkById = useMemo(() => new Map(allStk.map((s) => [s.stakeholder_id, s])), [allStk]);

  // ── load org stakeholders + active projects once ────────────────────────────────────────────────
  useEffect(() => {
    if (!orgId) return;
    (async () => {
      const [s, p] = await Promise.all([
        supabase.from('stakeholders').select('stakeholder_id,name,type,category').eq('org_id', orgId),
        supabase.from('projects').select('project_id,name').eq('org_id', orgId).eq('status', 'Active').order('name'),
      ]);
      setStakeholders((s.data ?? []) as SB[]);
      setProjects(((p.data ?? []) as any[]).map((r) => ({ id: r.project_id, name: r.name })));
      setLoaded(true);
    })();
  }, [orgId]);

  // Surface a saved draft on the Upload step (only before a file is loaded this session).
  useEffect(() => {
    if (!orgId || rows.length) return;
    const d = loadImportDraft<ImportDraft>(orgId);
    if (d && d.v === 1 && d.rows?.length) setDraft(d);
  }, [orgId, rows.length]);

  // Autosave the whole wizard as one draft whenever it changes (debounced), while a file is open and
  // we're mid-flow (Names/Sites/Check). Upload (0) and Done (4) don't save; Done clears it explicitly.
  useEffect(() => {
    if (!orgId || !rows.length || step < 1 || step > 3) return;
    const snapshot: ImportDraft = {
      v: 1, batchId, fileName, step, rows, dayFirst, nameRes, siteRes, created, createdProj,
      fixEdit, rowParty, fixSkip, dupKeep, defaultMode, bulkProject, savedAt: Date.now(),
    };
    const t = setTimeout(() => saveImportDraft(orgId, snapshot), 500);
    return () => clearTimeout(t);
  }, [orgId, batchId, fileName, step, rows, dayFirst, nameRes, siteRes, created, createdProj,
      fixEdit, rowParty, fixSkip, dupKeep, defaultMode, bulkProject]);

  function resumeDraft() {
    const d = draft;
    if (!d) return;
    setBatchId(d.batchId); setFileName(d.fileName); setRows(d.rows); setDayFirst(d.dayFirst);
    setNameRes(d.nameRes); setSiteRes(d.siteRes); setCreated(d.created); setCreatedProj(d.createdProj);
    setFixEdit(d.fixEdit); setRowParty(d.rowParty); setFixSkip(d.fixSkip); setDupKeep(d.dupKeep);
    setDefaultMode(d.defaultMode); setBulkProject(d.bulkProject ?? { kind: 'none' });
    classifiedRef.current = true;   // choices already made — don't re-run the LLM classify
    setDraft(null);
    setStep(d.step);
  }

  function discardDraft() {
    if (orgId) clearImportDraft(orgId);
    setDraft(null);
  }

  // One close path — signals whether an import actually happened, so the Ledger can reveal the new rows.
  const close = () => onClose?.(!!result);

  // Esc closes the overlay — but not when a field/dropdown is focused (there Esc dismisses the dropdown).
  useEffect(() => {
    if (!onClose) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if ((e.target as HTMLElement)?.closest('input,select,textarea')) return;
      onClose(!!result);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, result]);

  const parsedForGroups = useMemo(() =>
    dayFirst === undefined ? rows : rows.map((r) => {
      const d = parseSheetDate(rawDateOf(r), { refYear, dayFirst });
      return { ...r, date: d.iso, dateAmbiguous: d.ambiguous };
    }), [rows, dayFirst, refYear]);

  const nameGroups = useMemo(() => groupNames(parsedForGroups, stakeholders.map((s) => ({ stakeholder_id: s.stakeholder_id, name: s.name, type: s.type, category: s.category }))),
    [parsedForGroups, stakeholders]);
  const siteGroups = useMemo(() => groupSites(parsedForGroups, projects), [parsedForGroups, projects]);

  async function onFile(f: File) {
    try {
      const table = await readWorkbook(f);
      if (!table.rows.length) { showSnackbar('That sheet has no rows.', { type: 'error' }); return; }
      const { rows: parsed } = parseTable(table, { refYear });
      setBatchId('imp' + Math.random().toString(36).slice(2, 10));   // a fresh file is its own batch
      setNameRes({}); setSiteRes({}); setCreated([]); setCreatedProj([]);
      setFixEdit({}); setRowParty({}); setFixSkip({}); setDupKeep({}); setBulkProject({ kind: 'none' }); setFocusKey(null);
      classifiedRef.current = false;
      setFileName(f.name); setRows(parsed);
      setDayFirst(hasAmbiguousDates(parsed) ? undefined : false);
      setStep(1);
    } catch (e: any) {
      showSnackbar(e?.message || 'Could not read that file.', { type: 'error' });
    }
  }

  // seed resolutions + classify whenever groups change. MERGE (preserve existing keys) so a dayFirst
  // re-group — or an insert-on-tick that just set createdId — is never wiped.
  useEffect(() => {
    if (!rows.length) return;
    setNameRes((prev) => {
      const next = { ...prev };
      for (const g of nameGroups) if (!next[g.key]) next[g.key] = g.match.best
        ? { mode: 'match', chosenId: g.match.best.id, chosenLabel: labelForStkId(g.match.best.id, stkById, g.match.best.name) }
        : { mode: 'form', newName: g.src, newType: 'Vendor', newTrade: OTHER_TRADE };
      return next;
    });
    setSiteRes((prev) => {
      const next = { ...prev };
      for (const g of siteGroups) if (!next[g.key]) next[g.key] = g.match.best
        ? { mode: 'match', chosenId: g.match.best.id, chosenLabel: g.match.best.name }
        : { mode: 'form', newName: g.src };
      return next;
    });

    const toClassify = partiesToClassify(nameGroups);
    if (toClassify.length && !classifiedRef.current) {
      classifiedRef.current = true;
      supabase.functions.invoke('sku-matcher', {
        body: { action: 'classifyStakeholderTrade', parties: toClassify, trade_vocab: TRADE_VOCAB },
      }).then(({ data }) => {
        const byName = classificationsByName(data?.results ?? []);
        setNameRes((prev) => {
          const next = { ...prev };
          for (const g of nameGroups) {
            const c = byName[g.key];
            if (c && next[g.key]?.mode === 'form') next[g.key] = { ...next[g.key], newType: c.type, newTrade: c.trade };
          }
          return next;
        });
      }).catch(() => { /* classify is best-effort */ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameGroups, siteGroups]);

  // existing txns for the sheet's date span (dup detection)
  useEffect(() => {
    if (step !== 3 || !orgId) return;
    const dates = parsedForGroups.map((r) => r.date).filter((d): d is string => !!d);
    if (!dates.length) return;
    const min = dates.reduce((m, d) => (d < m ? d : m));
    const max = dates.reduce((m, d) => (d > m ? d : m));
    supabase.from('transactions')
      .select('txn_id,stakeholder_id,date,total_amount,payment_mode,ai_flag_data')
      .eq('org_id', orgId).eq('status', 'Active').gte('date', min).lte('date', max)
      .then(({ data }) => setExisting(((data ?? []) as any[]).map((t) => ({
        txn_id: t.txn_id, stakeholder_id: t.stakeholder_id, date: t.date,
        amount: Number(t.total_amount), mode: (t.payment_mode ?? null) as TxnMode | null,
      }))));
  }, [step, orgId, parsedForGroups]);

  // ── candidates for the resolve rows (FUZZY nearest — surfaces related names, not just substrings) ──
  const nameSearch = (q: string): Cand[] => {
    const t = q.trim().toLowerCase();
    return allStk.map((s) => ({ id: s.stakeholder_id, label: stkLabel(s), r: scorePayeeName(t, s.name.toLowerCase()) }))
      .sort((a, b) => b.r - a.r).slice(0, 8).map(({ id, label }) => ({ id, label }));
  };
  const nameDefault = (g: typeof nameGroups[number]): Cand[] =>
    [g.match.best, ...g.match.alts].filter(Boolean).map((c) => ({ id: c!.id, label: labelForStkId(c!.id, stkById, c!.name) }));

  // ── derived: dups, fixes, what will import ──────────────────────────────────────────────────────
  const stakeholderIdOf = (row: ParsedRow): string | null => {
    const v = nameRes[norm(row.name ?? '')];
    if (!v) return null;
    return v.mode === 'newdone' ? (v.createdId ?? null) : (v.chosenId ?? null);
  };
  const resolvedForDup: ResolvedRow[] = useMemo(() => parsedForGroups.map((r) => ({
    rowNo: r.rowNo, stakeholderId: stakeholderIdOf(r), date: r.date, amount: r.amount, mode: r.mode,
  })), [parsedForGroups, nameRes]);
  const dupHits = useMemo(() => findDuplicates(resolvedForDup, existing), [resolvedForDup, existing]);
  const dupRowNos = useMemo(() => new Set(dupHits.map((h) => h.rowNo)), [dupHits]);

  const fixRows = useMemo(() => parsedForGroups.filter((r) => validateRow(r) !== null), [parsedForGroups]);
  const fixResolved = (r: ParsedRow): boolean => {
    if (fixSkip[r.rowNo]) return true;
    const issue = validateRow(r); if (!issue) return true;
    // A blank name is resolved by a party CHOICE (pick existing / add new / no party), not free text.
    if (issue.field === 'name') return !!rowParty[r.rowNo];
    const v = (fixEdit[r.rowNo] ?? '').trim();
    if (!v) return false;
    if (issue.field === 'amount') { const a = parseIndianAmount(v); return a != null && a !== 0; }
    if (issue.field === 'date') return parseSheetDate(v, { refYear, dayFirst }).iso != null;
    return true;
  };

  // Resolved = created (newdone) OR pointed at a party/site (a chosenId) — whether that came from the
  // auto-match or the user picking one by hand. Gating must read the CHOICE, not whether auto-match hit.
  const isResolved = (res?: ResolveValue) => res?.mode === 'newdone' || (res?.mode === 'match' && !!res.chosenId);
  const groupBlocked = (res?: ResolveValue) => !isResolved(res);
  const namesBlocked = nameGroups.some((g) => groupBlocked(nameRes[g.key]));
  const sitesBlocked = siteGroups.some((g) => groupBlocked(siteRes[g.key]));
  const checkBlocked = fixRows.some((r) => !fixResolved(r));

  const willImport = useMemo(() => parsedForGroups.filter((r) => {
    if (fixSkip[r.rowNo]) return false;
    if (validateRow(r) && !fixResolved(r)) return false;
    if (dupRowNos.has(r.rowNo) && !dupKeep[r.rowNo]) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [parsedForGroups, fixSkip, fixEdit, rowParty, dupRowNos, dupKeep]);
  const sheetTotal = useMemo(() => willImport.reduce((s, r) => s + Math.abs(r.amount ?? 0), 0), [willImport]);
  // Rows the sheet left with no payment mode — they'll be saved as the chosen default (payment_mode is NOT NULL).
  const blankModeCount = useMemo(() => willImport.filter((r) => r.mode == null).length, [willImport]);

  // ── register-on-tick: a ticked new party/site joins the in-session search pool immediately (temp
  // NEW: id) so a later variant spelling can match it. No DB write here — ticking can never fail or
  // block; the real rows are created atomically at commit. ──────────────────────────────────────────
  const registerParty = (key: string, v: ResolveValue) => {
    const id = `NEW:${key}`;
    const rec: SB = { stakeholder_id: id, name: v.newName || key, type: (v.newType ?? 'Vendor'), category: v.newTrade || 'General' };
    setCreated((c) => [...c.filter((s) => s.stakeholder_id !== id), rec]);
    setNameRes((prev) => ({ ...prev, [key]: { ...v, createdId: id } }));
  };
  const registerProject = (key: string, v: ResolveValue) => {
    const id = `NEW:${key}`;
    setCreatedProj((c) => [...c.filter((p) => p.id !== id), { id, name: v.newName || key }]);
    setSiteRes((prev) => ({ ...prev, [key]: { ...v, createdId: id } }));
  };
  const onNameChange = (key: string, v: ResolveValue) => {
    if (v.mode === 'newdone') registerParty(key, v);
    else setNameRes((prev) => ({ ...prev, [key]: v }));
  };
  const onSiteChange = (key: string, v: ResolveValue) => {
    if (v.mode === 'newdone') registerProject(key, v);
    else setSiteRes((prev) => ({ ...prev, [key]: v }));
  };

  // ── commit ──────────────────────────────────────────────────────────────────────────────────────
  async function doCommit() {
    setCommitting(true);
    try {
      // Every ticked new party/site becomes a create at commit (keyed by its group key). A row can
      // reference one either because its OWN group is 'newdone', or because it matched a session
      // NEW: id (a variant that pointed at a party created for another group).
      const newStakeholders: NewStakeholder[] = nameGroups
        .filter((g) => nameRes[g.key]?.mode === 'newdone')
        .map((g) => { const v = nameRes[g.key]; return { tempKey: g.key, name: v.newName || g.src, type: (v.newType ?? 'Vendor'), category: v.newTrade || 'General' }; });
      // Blank-name rows the user chose to "add as new" become creates too — keyed by normalized name so
      // two rows that type the same new name share one party. Skip keys a name group already creates.
      const groupKeys = new Set(newStakeholders.map((s) => s.tempKey));
      for (const choice of Object.values(rowParty)) {
        if (choice?.kind !== 'new') continue;
        const key = norm(choice.name);
        if (groupKeys.has(key) || newStakeholders.some((s) => s.tempKey === key)) continue;
        newStakeholders.push({ tempKey: key, name: choice.name, type: 'Vendor', category: OTHER_TRADE });
      }
      const newProjects: NewProject[] = siteGroups
        .filter((g) => siteRes[g.key]?.mode === 'newdone')
        .map((g) => ({ tempKey: g.key, name: siteRes[g.key].newName || g.src }));

      // The whole-sheet project — resolved once, applied to every row that has no site of its own.
      let bulkId: string | null = null, bulkKey: string | null = null;
      if (bulkProject.kind === 'existing') bulkId = bulkProject.id;
      else if (bulkProject.kind === 'new' && bulkProject.name.trim()) {
        bulkKey = norm(bulkProject.name);
        if (!newProjects.some((p) => p.tempKey === bulkKey)) newProjects.push({ tempKey: bulkKey, name: bulkProject.name.trim() });
      }

      const partyRef = (nv?: ResolveValue): { id: string | null; key: string | null; type: string | null } => {
        if (!nv) return { id: null, key: null, type: null };
        if (nv.mode === 'newdone') return { id: null, key: nv.createdId?.slice(4) ?? null, type: nv.newType ?? 'Vendor' };
        if (nv.chosenId?.startsWith('NEW:')) return { id: null, key: nv.chosenId.slice(4), type: stkById.get(nv.chosenId)?.type ?? null };
        return { id: nv.chosenId ?? null, key: null, type: nv.chosenId ? (stkById.get(nv.chosenId)?.type ?? null) : null };
      };
      const siteRef = (sv?: ResolveValue): { id: string | null; key: string | null } => {
        if (!sv) return { id: null, key: null };
        if (sv.mode === 'newdone') return { id: null, key: sv.createdId?.slice(4) ?? null };
        if (sv.chosenId?.startsWith('NEW:')) return { id: null, key: sv.chosenId.slice(4) };
        return { id: sv.chosenId ?? null, key: null };
      };

      const commitRows: ResolvedCommitRow[] = willImport.map((r) => {
        const applied = applyFix(r, fixEdit[r.rowNo], refYear, dayFirst);
        // A blank-name row resolves its party from the Check-step picker (existing / new / no party);
        // every other row resolves by its sheet name through the Names step, as before.
        let pr: { id: string | null; key: string | null; type: string | null };
        const choice = validateRow(r)?.field === 'name' ? rowParty[r.rowNo] : undefined;
        if (choice?.kind === 'existing') pr = { id: choice.id, key: null, type: stkById.get(choice.id)?.type ?? null };
        else if (choice?.kind === 'new') pr = { id: null, key: norm(choice.name), type: 'Vendor' };
        else if (choice?.kind === 'none') pr = { id: null, key: null, type: null };
        else pr = partyRef(nameRes[norm(applied.name ?? '')]);
        const sr0 = applied.site ? siteRef(siteRes[norm(applied.site)]) : { id: null, key: null };
        // No per-row site → fall back to the whole-sheet project (if the user chose one).
        const sr = (sr0.id || sr0.key) ? sr0 : { id: bulkId, key: bulkKey };
        return {
          rowNo: applied.rowNo,
          date: applied.date as string,
          amount: applied.amount as number,
          mode: applied.mode ?? defaultMode,   // payment_mode is NOT NULL — blank rows fall back to the chosen default
          note: applied.note,
          stakeholderId: pr.id,
          newPartyKey: pr.key,
          partyType: pr.type,
          projectId: sr.id,
          newProjectKey: sr.key,
          directionCell: applied.directionCell,
        };
      });

      // A FRESH batch per commit — so a delete-and-reimport always re-inserts every row instead of being
      // silently skipped by the (org,batch,row) idempotency of a reused batch. Cross-run duplicates are
      // still caught the honest way: findDuplicates flags them against the existing books on the next run.
      const commitBatchId = 'imp' + Math.random().toString(36).slice(2, 10);
      setBatchId(commitBatchId);

      const res = await commitImport(supabase, { orgId: orgId!, batchId: commitBatchId, newStakeholders, newProjects, rows: commitRows });
      setSelectedCount(commitRows.length);

      // Read back what the APP actually holds for this batch — the app-side half of the checksum, from the
      // database itself (not the RPC's own tally), so a mismatch can never hide.
      let verified: number | null = null;
      try {
        const { count } = await supabase.from('transactions')
          .select('txn_id', { count: 'exact', head: true })
          .eq('org_id', orgId!).eq('import_batch_id', commitBatchId).eq('status', 'Active');
        verified = count ?? 0;
      } catch { verified = null; }
      setVerifiedCount(verified);

      // Keep the draft if anything did NOT land, so the user can retry the rest; clear it only on a clean run.
      const accounted = res.inserted.length + res.skipped.length + res.failed.length;
      const clean = res.failed.length === 0 && accounted === commitRows.length && (verified == null || verified === res.inserted.length);
      if (clean && orgId) clearImportDraft(orgId);
      setResult(res); setStep(4);
    } catch (e: any) {
      showSnackbar(e?.message || 'Import failed.', { type: 'error' });
    } finally {
      setCommitting(false);
    }
  }

  // ── shell ───────────────────────────────────────────────────────────────────────────────────────
  const TITLE = ['Import transactions', 'Step 1 of 3 — Names', 'Step 2 of 3 — Sites', 'Step 3 of 3 — Check before import', 'Imported'];
  const SUB = ['', `${fileName} · ${rows.length} rows · ${nameGroups.length} names`,
    `${fileName} · ${rows.length} rows · ${siteGroups.length} sites`, `${fileName} · ${rows.length} rows`, fileName];
  const NEXT = ['Choose file', 'Next', 'Next', committing ? 'Importing…' : 'Import', 'Done'];
  const blocked = (step === 1 && namesBlocked) || (step === 2 && sitesBlocked) || (step === 3 && checkBlocked) || committing;

  function next() {
    if (blocked) return;
    if (step === 0) { fileInput.current?.click(); return; }
    if (step === 3) { doCommit(); return; }
    if (step === 4) { onClose ? onClose(!!result) : navigate('/ledger'); return; }
    setStep(step + 1);
  }

  const cnt = (mode: string, list: { key: string }[], res: Record<string, ResolveValue>) => list.filter((g) => res[g.key]?.mode === mode).length;
  const nameToDo = nameGroups.filter((g) => groupBlocked(nameRes[g.key])).length;
  const siteToDo = siteGroups.filter((g) => groupBlocked(siteRes[g.key])).length;
  const foot =
    step === 1 ? `${cnt('match', nameGroups, nameRes)} matched · ${cnt('newdone', nameGroups, nameRes)} new${nameToDo ? ` · ${nameToDo} to add` : ''}` :
    step === 2 ? `${cnt('match', siteGroups, siteRes)} matched · ${cnt('newdone', siteGroups, siteRes)} new${siteToDo ? ` · ${siteToDo} to add` : ''}` :
    step === 3 ? `${willImport.length} rows will go in${fixRows.filter((r) => !fixResolved(r)).length ? ` · ${fixRows.filter((r) => !fixResolved(r)).length} to fix or skip` : ''}` : '';

  return (
    <div
      className={onClose ? 'imp-overlay' : 'imp-wrap'}
      onMouseDown={onClose ? (e) => { if (e.target === e.currentTarget) close(); } : undefined}
    >
      <style>{CSS}</style>
      <div className={onClose ? 'imp-card imp-modal' : 'imp-card'}>
        <div className="imp-head">
          <div><h1>{TITLE[step]}</h1><span>{SUB[step]}</span></div>
          {onClose && <button className="imp-x" onClick={close} title="Close (Esc)" aria-label="Close">✕</button>}
        </div>
        <div className="imp-body">
          <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />

          {step === 0 && (draft ? (
            <div className="imp-resume">
              <span className="rz-tag">Unfinished import</span>
              <b>{draft.fileName || 'Untitled sheet'}</b>
              <div className="mut">{draft.rows.length} rows · Step {Math.min(draft.step, 3)} of 3 — {STEP_NAME[draft.step] ?? ''} · saved {agoLabel(draft.savedAt)}</div>
              <div className="rz-actions">
                <button className="go" onClick={resumeDraft}>Resume</button>
                <button onClick={discardDraft}>Discard &amp; start new</button>
              </div>
            </div>
          ) : (
            <div className="imp-drop" onClick={() => loaded && fileInput.current?.click()}>
              <b>Drop an Excel or CSV file here</b>{loaded ? 'or click to choose' : 'loading your parties…'}
              <br /><br /><span className="mut">Needs columns for date, name, amount. Site, mode and note are optional.</span>
            </div>
          ))}

          {step === 1 && (
            <>
              {dayFirst === undefined && (
                <div className="imp-ask">Some dates like <b>3/8</b> could be day-first or month-first. Which is your sheet?
                  <button onClick={() => setDayFirst(true)}>Day first (3 Aug)</button>
                  <button onClick={() => setDayFirst(false)}>Month first (Mar 8)</button>
                </div>
              )}
              <p>Every name in your sheet. <span className="mut">Click a row to change it. New ones need a tick. <span className="doubt">?</span> means we’re not fully sure.</span></p>
              <table><thead><tr><th style={{ width: 210 }}>In your sheet</th><th>In Briklay</th><th style={{ width: 64 }}>Rows</th></tr></thead>
                <tbody>{nameGroups.map((g) => nameRes[g.key] && (
                  <ResolveRow key={g.key} src={g.src} count={g.rowNos.length} doubt={g.match.doubt}
                    hasBest={!!g.match.best} bestId={g.match.best?.id} bestLabel={g.match.best ? labelForStkId(g.match.best.id, stkById, g.match.best.name) : undefined}
                    defaultCands={nameDefault(g)} search={nameSearch}
                    value={nameRes[g.key]} onChange={(v) => onNameChange(g.key, v)}
                    focused={focusKey === g.key} onTicked={() => advanceFocus(nameGroups, nameRes, g.key)} />
                ))}</tbody>
              </table>
            </>
          )}

          {step === 2 && (
            <>
              {/* Whole-sheet project — the fix for a sheet with no per-row site column (one sheet = one site). */}
              <div className="imp-bulk">
                <div className="imp-bulk-h"><b>Project for the whole sheet</b>
                  <span className="mut"> — links every {siteGroups.length ? 'row that has no site below' : 'imported row'} to one project.</span></div>
                <select
                  value={bulkProject.kind === 'existing' ? `id:${bulkProject.id}` : bulkProject.kind === 'new' ? '__new' : ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) setBulkProject({ kind: 'none' });
                    else if (v === '__new') setBulkProject({ kind: 'new', name: '' });
                    else { const id = v.slice(3); setBulkProject({ kind: 'existing', id, name: allProj.find((p) => p.id === id)?.name ?? '' }); }
                  }}>
                  <option value="">— leave unlinked (no project) —</option>
                  {allProj.map((p) => <option key={p.id} value={`id:${p.id}`}>{p.name}</option>)}
                  <option value="__new">＋ Add a new project…</option>
                </select>
                {bulkProject.kind === 'new' && (
                  <input placeholder="new project name" autoFocus value={bulkProject.name}
                    onChange={(e) => setBulkProject({ kind: 'new', name: e.target.value })} />
                )}
                {!allProj.length && <div className="mut" style={{ marginTop: 6 }}>No active projects found in your account — use “Add a new project”.</div>}
              </div>

              {siteGroups.length > 0 ? <>
                <p style={{ marginTop: 18 }}>Sites named in your sheet. <span className="mut">Map each to one of your projects, or add it as a new site. These override the whole-sheet project above.</span></p>
                <table><thead><tr><th style={{ width: 240 }}>In your sheet</th><th>Map to a project in Briklay</th><th style={{ width: 64 }}>Rows</th></tr></thead>
                  <tbody>{siteGroups.map((g) => siteRes[g.key] && (
                    <SiteResolveRow key={g.key} src={g.src} count={g.rowNos.length} doubt={g.match.doubt}
                      projects={allProj.map((p) => ({ id: p.id, name: p.name }))}
                      value={siteRes[g.key]} onChange={(v) => onSiteChange(g.key, v)} />
                  ))}</tbody>
                </table>
              </> : (
                <p className="mut" style={{ marginTop: 14 }}>
                  Your sheet has no per-row site column. {bulkProject.kind === 'none'
                    ? 'Pick a project above to link every row to it, or leave it unlinked.'
                    : 'Every row will be linked to the project above.'}
                </p>
              )}
            </>
          )}

          {step === 3 && (
            <>
              {fixRows.length > 0 && <>
                <h3>A few rows need a hand <span className="mut">— {fixRows.length} of {rows.length}. Sort each one or skip it; the other {rows.length - fixRows.length} import as-is.</span></h3>
                <table><thead><tr><th style={{ width: 46 }}>Row</th><th>Name / party</th><th style={{ width: 110 }}>Amount</th><th>What’s missing — your fix</th><th style={{ width: 64 }} /></tr></thead>
                  <tbody>{fixRows.map((r) => { const issue = validateRow(r)!; const done = fixResolved(r) && !fixSkip[r.rowNo]; return (
                    <tr key={r.rowNo} className={fixSkip[r.rowNo] ? 'skip' : ''}>
                      <td className="num">{r.rowNo}</td>
                      <td>{issue.field === 'name'
                        ? <NameFixPicker value={rowParty[r.rowNo]} search={nameSearch}
                            onChoose={(c) => setRowParty({ ...rowParty, [r.rowNo]: c })}
                            onClear={() => { const n = { ...rowParty }; delete n[r.rowNo]; setRowParty(n); }} />
                        : (r.name || <span className="mut">no name</span>)}</td>
                      <td className="num">{issue.field === 'amount'
                        ? <input placeholder={issue.why === 'zero' ? 'not zero' : 'e.g. 1500'} value={fixEdit[r.rowNo] ?? ''} onChange={(e) => setFixEdit({ ...fixEdit, [r.rowNo]: e.target.value })} />
                        : inr(Math.abs(r.amount ?? 0))}</td>
                      <td>{issue.field === 'date'
                        ? <div className="fixcell"><span className="bad">Date {issue.why === 'ambiguous' ? 'unclear' : 'missing'}</span>
                            <input placeholder="e.g. 5 Aug" value={fixEdit[r.rowNo] ?? ''} onChange={(e) => setFixEdit({ ...fixEdit, [r.rowNo]: e.target.value })} /></div>
                        : issue.field === 'amount'
                          ? <span className="bad">Amount {issue.why === 'zero' ? 'is zero' : 'is blank'} — type it in the Amount cell</span>
                          : <span className={done ? 'okmut' : 'mut'}>{done ? 'Sorted ✓' : 'No name in your sheet — pick a party on the left'}</span>}</td>
                      <td><span className="lnk" onClick={() => setFixSkip({ ...fixSkip, [r.rowNo]: !fixSkip[r.rowNo] })}>{fixSkip[r.rowNo] ? 'Undo' : 'Skip'}</span></td>
                    </tr>
                  ); })}</tbody>
                </table>
              </>}
              {dupHits.length > 0 && <>
                <h3>Already in your books <span className="mut">— skipped unless you switch them on</span></h3>
                <table><thead><tr><th style={{ width: 46 }}>Row</th><th>In your sheet</th><th>Already in Briklay</th><th style={{ width: 70 }}>Import</th></tr></thead>
                  <tbody>{dupHits.map((h) => { const r = parsedForGroups.find((x) => x.rowNo === h.rowNo)!; return (
                    <tr key={h.rowNo} className={dupKeep[h.rowNo] ? '' : 'skip'}>
                      <td className="num">{h.rowNo}</td>
                      <td className="mut">{r.date} · {r.name} · {inr(Math.abs(r.amount ?? 0))}</td>
                      <td className="mut">{h.existing.date} · {inr(Math.abs(h.existing.amount))} · {h.existing.txn_id}</td>
                      <td><input type="checkbox" checked={!!dupKeep[h.rowNo]} onChange={(e) => setDupKeep({ ...dupKeep, [h.rowNo]: e.target.checked })} /></td>
                    </tr>
                  ); })}</tbody>
                </table>
              </>}
              {blankModeCount > 0 && (
                <div className="imp-mode">
                  <span><b>{blankModeCount}</b> {blankModeCount === 1 ? 'row has' : 'rows have'} no payment mode in the sheet. Save {blankModeCount === 1 ? 'it' : 'them'} as:</span>
                  <select value={defaultMode} onChange={(e) => setDefaultMode(e.target.value as TxnMode)}>
                    {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              )}
              {bulkProject.kind !== 'none' && (
                <p className="mut">Rows without their own site will be linked to project <b>{bulkProject.kind === 'existing' ? bulkProject.name : `${bulkProject.name || '—'} (new)`}</b>.</p>
              )}
              <p className="recon">{willImport.length} rows · <b>{inr(sheetTotal)}</b> will be added to Transactions.</p>
            </>
          )}

          {step === 4 && result && (() => {
            const ins = result.inserted.length, skp = result.skipped.length, fld = result.failed.length;
            const accounted = ins + skp + fld;
            const checksumOK = accounted === selectedCount;                 // every selected row hit a bucket
            const appOK = verifiedCount == null || verifiedCount === ins;   // the DB holds exactly what we inserted
            const allIn = checksumOK && appOK && fld === 0 && ins === selectedCount;
            // Group failures by their exact reason so a systemic cause reads as one line, not 471.
            const byReason = new Map<string, number[]>();
            for (const f of result.failed) { const k = f.error || 'unknown error'; (byReason.get(k) ?? byReason.set(k, []).get(k)!).push(f.row_no); }
            const reasons = [...byReason.entries()].map(([reason, rowsArr]) => ({ reason, rowsArr })).sort((a, b) => b.rowsArr.length - a.rowsArr.length);
            const fmtRows = (arr: number[]) => arr.slice().sort((a, b) => a - b).join(', ');
            return (
            <>
              <div className={`imp-recon ${allIn ? 'ok' : 'bad'}`}>
                {allIn
                  ? <b>✓ All {ins} rows imported. Excel and app match.</b>
                  : <b>⚠ Mismatch — {selectedCount - ins} of {selectedCount} rows did NOT import. Details below.</b>}
              </div>

              {/* The two systems, side by side — the checksum the user asked for. */}
              <table className="imp-recontable"><tbody>
                <tr><td>Your Excel file</td><td className="num"><b>{rows.length}</b> rows</td></tr>
                <tr><td className="ind">selected to import <span className="mut">(after fixes, skips & duplicates)</span></td><td className="num">{selectedCount}</td></tr>
                <tr className="sep"><td>Imported into the app</td><td className="num"><b>{ins}</b></td></tr>
                {skp > 0 && <tr><td className="ind">already imported before (skipped)</td><td className="num">{skp}</td></tr>}
                {fld > 0 && <tr className="badrow"><td className="ind">failed (not imported)</td><td className="num">{fld}</td></tr>}
                <tr className="sep"><td>Checksum &nbsp;<span className="mut">selected = imported + skipped + failed</span></td>
                    <td className="num">{selectedCount} {checksumOK ? '=' : '≠'} {ins}+{skp}+{fld} {checksumOK ? '✓' : '✗'}</td></tr>
                <tr><td>App now holds for this import <span className="mut">(counted in the database)</span></td>
                    <td className="num">{verifiedCount == null ? 'unverified' : <>{verifiedCount} {appOK ? '✓' : '✗'}</>}</td></tr>
              </tbody></table>

              <p className="mut" style={{ marginTop: 12 }}>
                {Object.keys(result.createdIds).length} new {Object.keys(result.createdIds).length === 1 ? 'party' : 'parties'}
                {Object.keys(result.createdProjectIds).length ? `, ${Object.keys(result.createdProjectIds).length} new site` : ''} added.
                {' '}Batch <code>{result.batchId}</code>.
              </p>
              {ins > 0 && onClose && (
                <p className="mut" style={{ marginTop: -4 }}>
                  Imported entries can span past months. Your ledger will switch to <b>All dates</b> when you close, so every one of these {ins} rows is visible — not just this month's.
                </p>
              )}

              {fld > 0 && <>
                <h3>Rows that failed — {fld} of {selectedCount}, grouped by reason</h3>
                <table><thead><tr><th style={{ width: 60 }}>Count</th><th>Reason (exact database error)</th><th>Rows</th></tr></thead>
                  <tbody>{reasons.map(({ reason, rowsArr }) => (
                    <tr key={reason}><td className="num">{rowsArr.length}</td><td className="bad">{reason}</td><td className="mut" style={{ wordBreak: 'break-word' }}>{fmtRows(rowsArr)}</td></tr>
                  ))}</tbody>
                </table>
              </>}

              {skp > 0 && <>
                <h3>Rows skipped as already-imported <span className="mut">— rows: {fmtRows(result.skipped)}</span></h3>
              </>}
            </>
            );
          })()}
        </div>
        <div className="imp-foot">
          <span className="mut">{foot}</span>
          <span>
            {step >= 1 && step <= 3 && <button onClick={() => setStep(step - 1)} disabled={committing}>Back</button>}{' '}
            {/* On Upload the Resume card owns the action while a draft is showing. */}
            {!(step === 0 && draft) && <button className="go" onClick={next} disabled={blocked} style={{ opacity: blocked ? 0.5 : 1 }}>{NEXT[step]}</button>}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────
function labelForStkId(id: string, byId: Map<string, SB>, fallback: string): string {
  const s = byId.get(id);
  return s ? `${s.name} (${s.type.toLowerCase()}${s.category ? ` · ${s.category.toLowerCase()}` : ''})` : fallback;
}

function rawDateOf(r: ParsedRow): string | null {
  if (!r.date) return null;
  if (!r.dateAmbiguous) return r.date;
  const [y, m, d] = r.date.split('-').map(Number);
  return `${d}/${m}/${y}`;
}

function applyFix(r: ParsedRow, edit: string | undefined, refYear: number, dayFirst?: boolean): ParsedRow {
  const v = (edit ?? '').trim();
  if (!v) return r;
  const issue = validateRow(r);
  if (!issue) return r;
  if (issue.field === 'amount') return { ...r, amount: parseIndianAmount(v) };
  if (issue.field === 'date') { const d = parseSheetDate(v, { refYear, dayFirst }); return { ...r, date: d.iso, dateAmbiguous: d.ambiguous }; }
  return { ...r, name: v };
}

const CSS = `
.imp-wrap,.imp-overlay{--ink:#1E1A15;--mut:#6B6258;--line:#EAE6E0;--bg:#FBF9F6;--terra:#BC4B27;--sage:#2F5D34;--sage-soft:#E9F2E7;
  font-family:'DM Sans',system-ui,sans-serif;color:var(--ink)}
.imp-wrap{min-height:100vh;background:var(--bg);padding:40px 16px}
.imp-overlay{position:fixed;inset:0;z-index:1000;background:rgba(30,26,21,0.55);display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow:auto}
.imp-card{max-width:960px;width:100%;margin:0 auto;background:#fff;border:1px solid var(--line);border-radius:12px}
.imp-modal{max-width:1000px;display:flex;flex-direction:column;max-height:calc(100vh - 64px);box-shadow:0 24px 60px rgba(30,26,21,0.35);animation:imp-pop .18s ease-out}
.imp-modal .imp-head,.imp-modal .imp-foot{flex:none}.imp-modal .imp-body{overflow:auto}
@keyframes imp-pop{from{opacity:0;transform:translateY(10px) scale(.99)}to{opacity:1;transform:none}}
.imp-head{padding:18px 24px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:16px}
.imp-x{flex:none;width:32px;height:32px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--mut);cursor:pointer;font-size:13px;line-height:1;display:grid;place-items:center;transition:all .15s}
.imp-x:hover{color:var(--terra);border-color:var(--terra);background:#FCF3EF}
@media (max-width:640px){.imp-overlay{padding:0}.imp-modal{max-height:100vh;min-height:100vh;border-radius:0;border:0}}
.imp-head h1{margin:0;font-size:18px;font-weight:600}.imp-head span{color:var(--mut);font-size:13px}
.imp-body{padding:24px}
.imp-body p{margin:0 0 16px}.imp-body .mut{color:var(--mut)}
.imp-body h3{font-size:15px;font-weight:600;margin:22px 0 10px}.imp-body h3:first-child{margin-top:0}
.imp-body table{border-collapse:collapse;width:100%;margin-bottom:8px}
.imp-body th,.imp-body td{border:1px solid var(--line);padding:8px 12px;text-align:left;vertical-align:middle;font-size:14px}
.imp-body th{background:#F4F2EE;font-weight:500;font-size:12.5px;color:var(--mut)}
.imp-body td.num,.imp-body th.num{text-align:right;font-variant-numeric:tabular-nums}
.imp-body select,.imp-body input{font:inherit;color:inherit;border:1px solid var(--line);border-radius:6px;padding:6px 8px;background:#fff;width:100%}
/* resolve row interactions (ported from the prototype) */
.doubt{color:var(--terra);font-weight:700;margin-left:4px}
.tag{font-size:11px;font-weight:600;padding:1px 6px;border-radius:4px;margin-left:8px;vertical-align:1px}
.tag.new{color:var(--terra);background:#F7E6DC}
.tag.ok{color:var(--sage);background:var(--sage-soft)}
.fixcell{display:flex;align-items:center;gap:8px}.fixcell input{max-width:150px}
.okmut{color:var(--sage);font-weight:600;font-size:13px}
.txt{display:flex;align-items:center;justify-content:space-between;gap:10px}
.caret{flex:none;width:22px;height:22px;border-radius:4px;display:grid;place-items:center;color:var(--mut);font-size:11px;opacity:.55;border:1px solid transparent;transition:all .15s}
tr.editable{cursor:pointer}tr.editable:hover td{background:#FCFAF6}tr.editable:hover .caret{opacity:1;color:var(--terra);border-color:var(--line);background:#fff}
.form{display:grid;grid-template-columns:1.3fr .9fr 1.1fr auto auto;gap:6px;align-items:center}
.form.site{grid-template-columns:1fr auto auto}
.cellwrap{position:relative}
.cellwrap input.hascaret{padding-right:24px}
.cellcaret{position:absolute;right:3px;top:50%;transform:translateY(-50%);border:none;background:none;color:var(--mut);cursor:pointer;font-size:11px;line-height:1;padding:4px}
.cellcaret:hover{color:var(--terra)}
.ib{width:32px;height:32px;border-radius:6px;border:1px solid var(--line);background:#fff;display:grid;place-items:center;cursor:pointer;padding:0}
.ib.tick{color:var(--sage);border-color:var(--sage)}.ib.tick:hover{background:var(--sage);color:#fff}
.ib.undo{color:var(--mut)}.ib.undo:hover{background:#F5F0E8}
.cb{border-color:var(--terra)!important}
.dd{position:absolute;left:-1px;right:-1px;top:100%;z-index:5;background:#fff;border:1px solid var(--line);border-top:0;border-radius:0 0 6px 6px;box-shadow:0 8px 20px rgba(59,42,31,.12);max-height:220px;overflow:auto}
.dd div{padding:7px 12px;cursor:pointer;font-size:14px}.dd div.hi{background:#F4F2EE}.dd .addnew{color:var(--terra);border-top:1px solid var(--line)}
@keyframes settle{0%{background:var(--sage-soft)}100%{background:transparent}}td.settled{animation:settle 1.4s ease-out}
@keyframes pop{0%{transform:scale(.97);opacity:.4}100%{transform:scale(1);opacity:1}}td.settled .txt{animation:pop .3s ease-out}
.bad{color:#8A5A12;background:#FBF0DA;font-size:12px;font-weight:600;padding:1px 6px;border-radius:4px}
.recon{margin-top:14px;font-size:15px}.ok{color:var(--sage);font-weight:600}
.imp-recon{border-radius:8px;padding:12px 14px;font-size:15px;margin-bottom:16px}
.imp-recon.ok{background:var(--sage-soft);color:var(--sage);border:1px solid #BcdCB8}
.imp-recon.bad{background:#FBEAE4;color:#A5341A;border:1px solid #E9C3B6}
.imp-recontable{width:100%;border-collapse:collapse;margin-bottom:4px}
.imp-recontable td{border:1px solid var(--line);padding:8px 12px;font-size:14px}
.imp-recontable td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.imp-recontable td.ind{padding-left:26px;color:var(--mut)}
.imp-recontable tr.sep td{border-top:2px solid #D9D3CA;font-weight:600}
.imp-recontable tr.badrow td{color:#A5341A}
.imp-body code{background:#F4F2EE;border-radius:4px;padding:1px 5px;font-size:12px}
.imp-mode{display:flex;align-items:center;gap:10px;background:#FBF0DA;border:1px solid #EAD9B0;border-radius:8px;padding:12px 14px;margin-top:14px;font-size:14px}
.imp-mode select{width:auto;min-width:120px}
.imp-bulk{background:#F4F2EE;border:1px solid var(--line);border-radius:8px;padding:14px 16px}
.imp-bulk-h{margin-bottom:8px;font-size:14px}
.imp-bulk select,.imp-bulk input{max-width:360px}
.imp-bulk input{margin-top:8px}
tr.skip td{color:var(--mut);opacity:.7}
.lnk{color:var(--mut);text-decoration:underline;text-underline-offset:3px;cursor:pointer;font-size:13px}
.imp-resume{border:1px solid #EAD9B0;background:#FBF7EE;border-radius:10px;padding:22px 24px}
.imp-resume .rz-tag{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--terra);background:#F7E6DC;padding:2px 8px;border-radius:4px;margin-bottom:10px}
.imp-resume b{display:block;font-size:17px;font-weight:600;margin-bottom:4px}
.imp-resume .rz-actions{display:flex;gap:10px;margin-top:16px}
.imp-resume .rz-actions button{font:inherit;padding:9px 18px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);cursor:pointer}
.imp-resume .rz-actions button.go{background:var(--terra);color:#fff;border-color:var(--terra);font-weight:600}
.imp-drop{border:1.5px dashed var(--line);border-radius:10px;padding:56px;text-align:center;color:var(--mut);cursor:pointer}
.imp-drop b{display:block;color:var(--ink);font-weight:500;margin-bottom:6px}
.imp-ask{background:#FBF0DA;border:1px solid #EAD9B0;border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:14px}
.imp-ask button{margin-left:8px;font:inherit;padding:5px 12px;border-radius:6px;border:1px solid var(--line);background:#fff;cursor:pointer}
.imp-foot{padding:16px 24px;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}
.imp-foot button{font:inherit;padding:9px 18px;border-radius:8px;border:1px solid var(--line);background:#fff;color:var(--ink);cursor:pointer}
.imp-foot button.go{background:var(--terra);color:#fff;border-color:var(--terra);font-weight:600}
`;
