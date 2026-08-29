/**
 * DocThumb — an inline, previewable thumbnail for a stored document (bill / proof).
 *
 * The `documents` bucket is PRIVATE, so a stored public-object URL won't render directly; we
 * mint a short-lived SIGNED url (useSignedDocUrl) for the <img>. Behaviour:
 *   · image → a small PORTRAIT thumbnail anchored to the TOP of the doc (bills carry their
 *     header/logo up there, so a cover-crop shows real content, not the blank centre margin).
 *     Click → onImageClick(signedUrl) so the caller opens a beautiful full lightbox (falls back
 *     to opening in a new tab when no handler is given).
 *   · pdf → a "View bill (PDF)" chip that opens the signed doc.
 *   · if the signed image fails to load (missing object / bad path) → a clear "View bill"
 *     fallback button instead of a silent grey box.
 */
import { useState, useEffect } from 'react';
import { useSignedDocUrl, openDoc } from '../lib/storage';

export function DocThumb({ stored, w = 46, h = 58, onImageClick, label = 'View bill' }: {
  stored: string | null | undefined;
  w?: number;
  h?: number;
  onImageClick?: (signedUrl: string) => void;
  label?: string;
}) {
  const signed = useSignedDocUrl(stored);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [signed]);

  if (!stored) return null;
  const isPdf = /\.pdf(\?|$)/i.test(stored);

  const ViewChip = (text: string) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); void openDoc(stored); }}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 8, border: '1px solid rgba(0,0,0,.12)', background: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#A94E2B', lineHeight: 1 }}
    >
      <span aria-hidden>📄</span> {text}
    </button>
  );

  if (isPdf) return ViewChip(`${label} (PDF)`);
  if (failed) return ViewChip(label);

  if (!signed) {
    // resolving — a soft shimmering placeholder (not a broken-looking box)
    return <span style={{ display: 'inline-block', width: w, height: h, borderRadius: 8, background: 'linear-gradient(90deg,rgba(0,0,0,.04),rgba(0,0,0,.07),rgba(0,0,0,.04))', backgroundSize: '200% 100%', animation: 'docThumbShimmer 1.1s linear infinite' }} aria-label="loading preview" />;
  }

  return (
    <span
      className="dt-wrap"
      role="button"
      title="Click to preview"
      onClick={(e) => { e.stopPropagation(); if (onImageClick) onImageClick(signed); else void openDoc(stored); }}
      style={{ position: 'relative', display: 'inline-block', width: w, height: h, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(0,0,0,.12)', cursor: 'pointer', background: '#faf8f4', flex: 'none' }}
    >
      <style>{`@keyframes docThumbShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}.dt-ov{opacity:0;transition:opacity .15s}.dt-wrap:hover .dt-ov{opacity:1}`}</style>
      <img
        src={signed}
        alt="Bill preview"
        loading="lazy"
        onError={() => setFailed(true)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center', display: 'block' }}
      />
      <span className="dt-ov" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(20,16,12,.28)', color: '#fff', fontSize: 14 }} aria-hidden>⤢</span>
    </span>
  );
}
