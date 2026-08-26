// A single autosaved draft of an in-progress Transactions import, kept in the browser (localStorage,
// org-scoped) so the wizard survives a refresh / closed tab and can be resumed from the Import button.
// Generic on the shape — the page owns the ImportDraft type; this only does safe JSON I/O. One draft
// per org (single-draft design): a newer save overwrites the older one.

const key = (orgId: string) => `briklay:import-draft:${orgId}`;

export function loadImportDraft<T>(orgId: string): T | null {
  try { const s = localStorage.getItem(key(orgId)); return s ? (JSON.parse(s) as T) : null; }
  catch { return null; }
}

export function saveImportDraft<T>(orgId: string, draft: T): void {
  // Private mode / quota can throw — the draft just won't persist, which is acceptable.
  try { localStorage.setItem(key(orgId), JSON.stringify(draft)); } catch { /* ignore */ }
}

export function clearImportDraft(orgId: string): void {
  try { localStorage.removeItem(key(orgId)); } catch { /* ignore */ }
}
