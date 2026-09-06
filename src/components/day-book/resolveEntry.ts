/**
 * What a captured entry actually resolves to — the ONE place the AI's guesses are checked
 * against the org's real rows.
 *
 * `ai_extracted` is a jsonb blob the WhatsApp extractor writes. `payee_id` and `project_id` are
 * strings in it that LOOK like keys. A project id the AI assembled from a name ("PRJ-ASM-ELITE" —
 * the exact shape a real one takes) once sailed through every check and the first thing to notice
 * it named nothing was the foreign key, thrown in the owner's face after he pressed Approve.
 *
 * So an id counts as resolved only if it names a row we can actually see. This lived inside
 * ReviewCard; the phone's review deck needs exactly the same judgement, and two copies of it would
 * be two chances to lose it.
 */
import type { RoughEntry } from '../../types';
import { gapsOf, isResolved, type Gap, type ResolvedFields } from './fileEntry';

export interface StakeholderLite { stakeholder_id: string; name: string; type?: string; category?: string }
export interface ProjectLite { project_id: string; name: string }

export interface EntryResolution {
  payeeId: string | null;
  /** worth showing even when the id was a phantom — it is what the site SAID */
  payeeName: string | null;
  projectId: string | null;
  projectName: string | null;
  projectRaw: string | null;
  description: string;
  amount: number;
  resolved: ResolvedFields;
  gaps: Gap[];
  ready: boolean;
}

const nrm = (s?: string | null) => (s ?? '').trim().toLowerCase();

export function resolveEntry(
  entry: RoughEntry,
  stakeholders: StakeholderLite[],
  projects: ProjectLite[],
): EntryResolution {
  const ai = entry.ai_extracted || {};

  // ID FIRST — but a missed id is not always a phantom. This card's copy of the project list can
  // lag what the editor just wrote, so when the id misses, fall back to an EXACT, UNIQUE name match
  // against the SAME real list. A phantom id whose name matches no row we can see stays unresolved.
  const projectByName = (() => {
    const q = nrm(ai.project_name);
    if (!q) return null;
    const hits = projects.filter((p) => nrm(p.name) === q);
    return hits.length === 1 ? hits[0] : null;
  })();
  const projectById = ai.project_id ? projects.find((p) => p.project_id === ai.project_id) ?? null : null;
  const projectRow = projectById ?? projectByName;
  const payeeRow = ai.payee_id ? stakeholders.find((s) => s.stakeholder_id === ai.payee_id) ?? null : null;

  const payeeId = payeeRow?.stakeholder_id ?? null;
  const payeeName = payeeRow?.name ?? ai.payee_name ?? ai.payee_raw ?? null;
  const projectId = projectRow?.project_id ?? null;
  const projectName = projectRow?.name ?? null;
  const projectRaw = projectRow ? null : (ai.project_name || ai.project_raw || null);
  const description = (ai.description || ai.description_raw || '').trim();
  const amount = parseFloat(String(ai.amount ?? '').replace(/[^\d.]/g, '')) || 0;

  const resolved: ResolvedFields = { payeeId: payeeId || '', projectId: projectId || '', amount, description, generalExpense: false };
  return { payeeId, payeeName, projectId, projectName, projectRaw, description, amount, resolved, gaps: gapsOf(resolved), ready: isResolved(resolved) };
}
