// SITE DESK — SIGN A PRIVATE PHOTO URL, LAZILY, AT RENDER TIME.
//
// The desk's photos live in a PRIVATE bucket, so every one needs a short-lived signed URL. That signing
// used to happen inside the desk query, up front — every photo in the org signed before the list could
// paint. After the core/plan split most of it moved off the Problems path already; this removes the rest:
// a photo is signed only when it is actually about to be shown, and the result is cached (react-query) so
// scrolling back to it costs nothing.
//
// A signed URL is good for an hour (the query mints them with a 3600s TTL); we treat it as fresh for 55
// minutes and let react-query re-sign after that, so a URL never expires under a photo the user is looking
// at.

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../supabase'

/**
 * The signed URL for a private object, or null while it resolves / if it can't be signed.
 *
 * `eager` is an already-signed URL the caller may already hold (the mock provides one; a query that still
 * signs up front would too) — when present we use it verbatim and never hit storage. Otherwise we sign
 * `bucket`/`path` on demand. With neither, there is nothing to show and the hook is inert.
 */
export function useSignedUrl(
  bucket: string | null | undefined,
  path: string | null | undefined,
  eager?: string | null,
): string | null {
  const canSign = !eager && !!bucket && !!path
  const { data } = useQuery({
    queryKey: ['signed-url', bucket, path],
    queryFn: async () => {
      const { data: s } = await supabase.storage.from(bucket as string).createSignedUrl(path as string, 3600)
      return s?.signedUrl ?? null
    },
    enabled: canSign,
    staleTime: 55 * 60 * 1000,   // a 3600s URL, treated fresh for 55min — re-signed before it can expire
    gcTime: 60 * 60 * 1000,
  })
  return eager ?? data ?? null
}
