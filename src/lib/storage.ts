import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// The documents bucket is private (Sprint 0.5 P2). Stored values are historically
// full public-object URLs (.../storage/v1/object/public/<bucket>/<path>); we parse
// out {bucket, path} and mint a short-lived signed URL on demand. Works for any
// bucket, so it also handles rough-entry-media proof images uniformly.

const PUBLIC_OBJECT_RE = /\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/;
const SIGN_TTL_SECONDS = 3600;

/** Convert a stored Supabase public-object URL into a short-lived signed URL.
 *  Non-Supabase URLs (external links) are returned unchanged; null on failure. */
export async function resolveDocUrl(stored: string | null | undefined): Promise<string | null> {
  if (!stored) return null;
  const m = stored.match(PUBLIC_OBJECT_RE);
  if (!m) return stored; // not a supabase public-object URL — use as-is
  const bucket = m[1];
  const path = decodeURIComponent(m[2]);
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGN_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** Resolve a stored doc URL and open it in a new tab. */
export async function openDoc(stored: string | null | undefined): Promise<void> {
  const url = await resolveDocUrl(stored);
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

/** React hook: resolves a stored doc URL to a signed URL for <img>/<a> rendering.
 *  Returns null while resolving or if there's nothing to show. */
export function useSignedDocUrl(stored: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!stored) { setUrl(null); return; }
    resolveDocUrl(stored).then((u) => { if (active) setUrl(u); });
    return () => { active = false; };
  }, [stored]);
  return url;
}
