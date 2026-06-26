// Project id generation. project_id is a TEXT primary key, GLOBALLY unique.
// Convention: PRJ-<slug-of-name>. Existing projects with legacy UUID ids keep them
// (ids are opaque keys everywhere — no code pattern-matches the format), this is forward-only.

/** Deterministic PRJ-<slug> from a name — safe for a live id preview (no randomness to jitter). */
export function fmtProjectId(name: string): string {
  const slug = name.toUpperCase().replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 12)
  return `PRJ-${slug || 'NEW'}`
}

/**
 * Collision-safe PRJ id (slug + short random suffix). For flows with NO live id preview
 * (e.g. onboarding, whose default name "My First Project" would otherwise collide across
 * every org on the global PK). The suffix keeps it unique without changing the readable prefix.
 */
export function uniqueProjectId(name: string): string {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `${fmtProjectId(name)}-${rand}`
}
