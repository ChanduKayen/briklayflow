// SITE DESK — the feature flag.
//
// The portal had NO flag mechanism of any kind before this (the only `import.meta.env` usage in
// src/ was the two Supabase connection vars). This is the smallest thing that satisfies the
// constraint "the portal renders with Site Desk off", using the pattern the repo already has.
//
//   VITE_SITE_DESK=1   → on
//   VITE_SITE_DESK=0   → off  (the escape hatch: brings the old Site Management hub back)
//   unset              → ON. Everywhere.
//
// IT DEFAULTS ON NOW, AND IT HAS TO. The old Site Management hub — Task Manager, Snags & Issues,
// Follow-up Rules — has been deleted, and the desk is what replaced it. A default of "off in
// production" would therefore mean a production build with NO site surface of any kind: not the new
// one, because the flag hid it, and not the old one, because it no longer exists. The flag survives
// only as a kill switch, and pulling it now costs you the whole feature rather than half of it.
//
// With the flag off, /desk/* is not registered at all and no nav entry appears — the old Site
// Management pages (/tasks, /site-desk, /follow-up-rules) are untouched and remain the only way
// in. That is deliberate: they stay routable until parity sign-off.
//
// TODO(map §4 · gap 11): if per-ORG staging is wanted (some orgs on, some off), this becomes a
// column on `organizations` read through useAuth() — the call sites below do not change.

const raw = import.meta.env.VITE_SITE_DESK as string | undefined

export const SITE_DESK_ENABLED: boolean = raw !== '0'
