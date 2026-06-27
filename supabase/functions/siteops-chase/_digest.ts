// Block B2 — the BATCHED DIGEST renderer. Pure (no I/O) so it's unit-testable
// and so the orchestrator can render a real digest in ?preview=1 without sending.
//
// The governing discipline (B2): ONE message per owner, never per-issue spam;
// grouped by project for multi-site owners; impact context carried on issues
// that have it; one-word-answerable; a colleague checking in, never
// "reminder: 3 open issues". To-dos ride the same digest, simpler.

export interface ChaseItem {
  kind: 'issue' | 'todo'
  id: string
  orgId: string
  projectId: string | null
  projectName: string
  title: string
  taskName: string | null            // the blocked task, for the "(2F slab)" parenthetical
  impactImplication: string | null   // issues only — "may delay 2F slab (Fri)" from problems.impact
  cause: string | null
  escalated?: boolean                 // chased up after the owner went silent (B3)
  ownerLabel?: string | null          // the original owner's name, for the escalation line
}

export interface OwnerDigest {
  phone: string
  name: string | null
  items: ChaseItem[]
}

/** The one-word-answerable prompt for an item — what the owner replies to. */
export function promptFor(it: ChaseItem): string {
  if (it.kind === 'todo') return 'done?'
  if (it.impactImplication) return 'still on?'   // time-pressured framing when work is threatened
  // deterministic variety between the two one-word prompts (no per-run randomness)
  const h = it.id.charCodeAt(0) + it.id.charCodeAt(Math.max(0, it.id.length - 1))
  return h % 2 === 0 ? 'sorted?' : 'still on?'
}

// Append the blocked task as a parenthetical, unless the title already names it
// (our issue titles are often verbose: "2nd floor slab cement short").
function withTask(title: string, taskName: string | null): string {
  const t = title.trim()
  if (!taskName) return t
  const core = taskName.split('·')[0].trim().toLowerCase()
  if (core && t.toLowerCase().includes(core)) return t
  return `${t} (${taskName})`
}

function line(it: ChaseItem): string {
  if (it.kind === 'todo') return `📋 ${it.title.trim()} — ${promptFor(it)}`
  const impact = it.impactImplication ? ` _${it.impactImplication}_` : ''
  // escalated → a heads-up to the principal/supervisor, naming who's gone quiet
  if (it.escalated) {
    const who = it.ownerLabel ? ` (no word from ${it.ownerLabel})` : ''
    return `⤴️ ${withTask(it.title, it.taskName)}${who} — can you nudge?${impact}`
  }
  return `⚠️ ${withTask(it.title, it.taskName)} — ${promptFor(it)}${impact}`
}

/**
 * Render ONE owner's due items into a single WhatsApp message, grouped by
 * project (busiest site first), issues above to-dos within each site. Returns
 * the message body (WhatsApp markdown: *bold*, _italic_).
 */
export function renderDigest(d: OwnerDigest): string {
  // group by project, preserving a stable "most items first, then name" order
  const groups = new Map<string, ChaseItem[]>()
  for (const it of d.items) {
    const key = it.projectName
    const g = groups.get(key)
    if (g) g.push(it)
    else groups.set(key, [it])
  }
  const ordered = [...groups.entries()].sort((a, b) =>
    b[1].length - a[1].length || a[0].localeCompare(b[0]))

  const blocks = ordered.map(([project, items]) => {
    const sorted = [...items].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'issue' ? -1 : 1))
    const header = `*${project}* — quick check on ${items.length}:`
    return [header, ...sorted.map(line)].join('\n')
  })

  return blocks.join('\n\n')
}

/**
 * The digest as ONE LINE (no newlines/tabs) for a WhatsApp TEMPLATE variable —
 * Meta rejects newline/tab/4+-space inside a variable value, so the multi-line
 * renderDigest can't ride a {{1}} slot. Sites joined by " | ", items by "; ".
 *   "Lakshmi Villa: cement short — still on?; masons short — sorted? | ASM Elite: call inspector — done?"
 */
export function renderDigestInline(d: OwnerDigest): string {
  const groups = new Map<string, ChaseItem[]>()
  for (const it of d.items) {
    const g = groups.get(it.projectName)
    if (g) g.push(it); else groups.set(it.projectName, [it])
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  return ordered.map(([project, items]) => {
    const lst = items
      .map((it) => `${withTask(it.title, it.taskName)} — ${promptFor(it)}`.replace(/\s+/g, ' ').trim())
      .join('; ')
    return `${project}: ${lst}`
  }).join(' | ')
}
