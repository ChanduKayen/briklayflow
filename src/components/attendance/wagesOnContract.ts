// "These wages — against the contract, or on their own?"
//
// A worker put on DAILY WAGES who also holds a contract on the same site leaves one thing unsaid: is
// each day's wage an advance the contract absorbs, or money owed beside the contract? Both are real
// arrangements, and the answer changes what the party is owed — so it is asked once, plainly, at the
// moment the worker is added, on both surfaces.
//
//   • against the contract → the crew keeps its daily muster but is linked to the contract in 'wages'
//     measure (basis 'contract', accrual 'day'). Each attendance save folds the new wages into the
//     contract's phases in order: the fold certifies that ₹ against the phase — so what is left to
//     certify on the contract falls by exactly that much — and stamps those days settled, so they stop
//     accruing a separate wage. One credit, never two.
//   • on their own → nothing to write. Plain day wages, and the contract is certified by itself.
//
// The copy lives here so the desktop dialog and the phone's sheet say the same words.
import { supabase } from '../../lib/supabase';
import { loadWorkOrdersForProject, putCrewOnContract } from '../../lib/attendanceApi';

export interface WageContract {
  woId: string;
  label: string;
  value: number;   // the agreed contract value
  left: number;    // still to certify on it — what these wages would come off
}

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

/** This party's live contracts on this site, each with what is still to certify on it. Empty → there
 *  is nothing to ask about, and the caller must not ask. */
export async function loadWageContracts(projectId: string, stakeholderId: string | null): Promise<WageContract[]> {
  if (!stakeholderId) return [];
  const all = await loadWorkOrdersForProject(projectId);
  const mine = all.filter((w) => w.stakeholderId === stakeholderId);
  if (!mine.length) return [];
  const woIds = mine.map((w) => w.wo_id);

  // What each contract has already certified — lump reads its latest per phase, measured sums.
  const { data: ms } = await supabase.from('wo_milestones').select('milestone_id, wo_id').in('wo_id', woIds);
  const woOfMs: Record<string, string> = {};
  (ms ?? []).forEach((m: { milestone_id: string; wo_id: string }) => { woOfMs[m.milestone_id] = m.wo_id; });
  const certByWo: Record<string, number> = {};
  const msIds = Object.keys(woOfMs);
  if (msIds.length) {
    const { data: certs } = await supabase.from('work_certifications')
      .select('milestone_id, reading_kind, computed_amount, reading_date').in('milestone_id', msIds).eq('status', 'approved');
    const latestLump: Record<string, { d: string; amt: number }> = {};
    type Cert = { milestone_id: string; reading_kind: string; computed_amount: number | null; reading_date: string | null };
    (certs ?? []).forEach((c: Cert) => {
      const wo = woOfMs[c.milestone_id]; if (!wo) return;
      const amt = Number(c.computed_amount) || 0;
      if (c.reading_kind === 'lump') {
        const cur = latestLump[c.milestone_id];
        if (!cur || (c.reading_date || '') > cur.d) latestLump[c.milestone_id] = { d: c.reading_date || '', amt };
      } else certByWo[wo] = (certByWo[wo] || 0) + amt;
    });
    Object.entries(latestLump).forEach(([mid, v]) => { const wo = woOfMs[mid]; if (wo) certByWo[wo] = (certByWo[wo] || 0) + v.amt; });
  }
  return mine.map((w) => ({
    woId: w.wo_id, label: w.label, value: w.orderValue,
    left: Math.max(0, Math.round(w.orderValue - (certByWo[w.wo_id] || 0))),
  }));
}

/** Link a freshly-added crew to the contract its wages come off. Nothing is certified here — the fold
 *  happens on each attendance save, day by day, so it can never run ahead of the days marked. */
export async function setWagesAgainstContract(p: {
  crewId: string; orgId: string; projectId: string; stakeholderId: string | null; woId: string;
}): Promise<void> {
  await putCrewOnContract({
    crewId: p.crewId, orgId: p.orgId, projectId: p.projectId, stakeholderId: p.stakeholderId,
    woId: p.woId, stageIds: null, mode: 'keep_wages', measure: 'wages',
  });
}

// ── the words, one copy, both surfaces ───────────────────────────────────────────────────────────
export const WAGES_ASK = {
  title: 'How should these day wages be counted?',
  sub: (name: string) => `${name} already has a contract on this site.`,
  offLabel: 'Take them off the contract',
  offDesc: (c: WageContract) =>
    `Every day marked comes off ${c.label} — ${inr(c.left)} left on it today. Their account shows the wages set against the contract, never a second amount owed.`,
  keepLabel: 'Keep them separate',
  keepDesc: 'Day wages are owed as wages. The contract stays whole and is paid on its own, as its stages are certified.',
  which: 'Which contract do they come off?',
  doneOff: (name: string, label: string) => `${name}'s wages now come off ${label}`,
  doneKeep: (name: string) => `${name} is on day wages`,
} as const;

/** How a row reads once the wages come off a contract — used on the muster and in the toast. */
export const wagesAgainstLabel = (stage: string | null | undefined) =>
  stage ? `wages · set against ${stage}` : 'wages · set against the contract';
