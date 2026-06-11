/**
 * UiContextRecap — SYSTEM-voice sticky recap (brief §5): vendor · project ·
 * date · PO id, kept visible while scrolling the item list. Pure display of
 * values the page already holds; no handlers, no state.
 */
import { V, nums } from './voiceTokens';

interface UiContextRecapProps {
  initials: string;
  vendorName: string;
  projectName?: string;
  /** Short date, e.g. "11 Jun". */
  dateLabel?: string;
  /** PO id / placeholder, e.g. "PO-0152" or "Auto-generated". */
  poLabel?: string;
}

export default function UiContextRecap({
  initials, vendorName, projectName, dateLabel, poLabel,
}: UiContextRecapProps) {
  return (
    <div
      className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2.5 mt-6 flex items-center gap-2 text-xs"
      style={{ background: V.page, borderBottom: `1px solid ${V.line}`, color: V.system }}
    >
      <span
        className="w-5 h-5 rounded-full flex items-center justify-center font-medium shrink-0"
        style={{ background: V.field, fontSize: 9 }}
      >
        {initials}
      </span>
      <span className="font-medium truncate" style={{ color: V.user }}>{vendorName}</span>
      {projectName && (
        <>
          <span style={{ color: V.systemFaint }}>·</span>
          <span className="truncate">{projectName}</span>
        </>
      )}
      {dateLabel && (
        <>
          <span style={{ color: V.systemFaint }}>·</span>
          <span className="shrink-0" style={nums}>{dateLabel}</span>
        </>
      )}
      <span className="flex-1" />
      {poLabel && <span className="shrink-0" style={{ color: V.systemFaint, ...nums }}>{poLabel}</span>}
    </div>
  );
}
