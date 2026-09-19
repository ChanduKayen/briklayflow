/**
 * Signing the papers an entry carries, for looking at.
 *
 * A stored document URL is a Supabase public-object URL that expires, so nothing is signed until
 * something is about to show it — the thumbnails when their row is opened, the document when it is.
 * Kept beside the peek rather than inside it so that file exports a component only.
 */
import { useEffect, useState } from 'react';
import { resolveDocUrl } from '../../lib/storage';

export type Paper = { kind: 'Bill' | 'Proof'; url: string };

export const isPdf = (u: string) => /\.pdf(\?|$)/i.test(u);

/**
 * Sign a handful of stored documents at once. An answer is stamped with the list it belongs to, so
 * one that lands late can never dress a different entry's papers.
 */
export function useSignedDocs(urls: string[]): Record<string, string | null> {
  const key = urls.join('|');
  const [signed, setSigned] = useState<{ key: string; map: Record<string, string | null> }>({ key: '', map: {} });
  useEffect(() => {
    if (!key) return;
    let live = true;
    void Promise.all(key.split('|').map((u) => resolveDocUrl(u).catch(() => null))).then((out) => {
      if (!live) return;
      const map: Record<string, string | null> = {};
      key.split('|').forEach((u, n) => { map[u] = out[n]; });
      setSigned({ key, map });
    });
    return () => { live = false; };
  }, [key]);
  return signed.key === key ? signed.map : {};
}
