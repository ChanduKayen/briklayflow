/**
 * The way in.
 *
 * The search itself is summoned — it floats over whatever page you are on and is gone again on
 * escape. That leaves nothing to see at rest, so where a page used to keep its own search box this
 * stands in its place: the same pill, quieter, saying which key opens it. Tapping it is the phone's
 * way in, since a phone has no space bar.
 */
import { useSearch } from './searchScope';
import { useIsMobile } from '../../lib/useIsMobile';

const CSS = `
.csx-hint{display:inline-flex; align-items:center; gap:9px; background:#FFFDF7; border:1px solid #E6DECD;
  border-radius:999px; padding:8px 14px; cursor:text; font-family:'DM Sans',-apple-system,sans-serif;
  font-size:13.5px; color:#9A8C77; transition:border-color .2s, box-shadow .2s, color .2s; max-width:100%}
.csx-hint:hover{border-color:#6E5F4C; color:#6E5F4C; box-shadow:0 10px 24px -20px rgba(42,36,28,.6)}
.csx-hint .ic{font-size:14px; line-height:1; flex:none}
.csx-hint .lbl{white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.csx-hint .kbd{font-family:'DM Mono','SF Mono',Consolas,monospace; font-size:10.5px; color:#9A8C77;
  border:1px solid #E6DECD; border-radius:6px; padding:2px 8px; flex:none}
`;

export default function SearchHint({ label, className }: { label: string; className?: string }) {
  const { openSearch } = useSearch();
  const isMobile = useIsMobile();
  return (
    <button type="button" className={`csx-hint${className ? ' ' + className : ''}`} onClick={openSearch}
      aria-label={`Search ${label}`}>
      <style>{CSS}</style>
      <span className="ic">⌕</span>
      <span className="lbl">Search {label}</span>
      {!isMobile && <span className="kbd">space</span>}
    </button>
  );
}
