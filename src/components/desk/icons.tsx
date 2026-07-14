// SITE DESK — the two marks the interaction language is built on.
//
// The SPINNER is a stroked arc with round caps — quiet confidence, not a chopped-off ring.
// The CHECK is not revealed, it is WRITTEN: `stroke-dasharray` + `stroke-dashoffset` let CSS draw
// the tick along its own path (see `@keyframes dsk-draw`). A check that fades in has merely
// appeared; a check that draws itself has been MADE.
//
// They live here, apart from the components, so Fast Refresh keeps working.

export const Spinner = (
  <svg className="spin" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
  </svg>
)

export const Check = (
  <svg className="check" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
)
