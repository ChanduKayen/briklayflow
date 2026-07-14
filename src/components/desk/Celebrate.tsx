// SITE DESK — THE CARD CELEBRATES, NOT THE BUTTON.
//
// A button that flashes green says "the click registered". That is a receipt, not a moment — and it
// is the wrong object anyway: the button did not get finished, THE WORK did. So when a task is done
// or a problem is closed, the whole card takes the moment: the paper washes green, the tick is drawn
// across it, and the thing you just finished is named — because in a week the only thing you will
// remember is what you closed, not which control you pressed.
//
// AND IT HANDS YOU THE NEXT ONE. The card does not just applaud and vanish, leaving you to work out
// where the page went. It says what comes next, by name, and then goes there. Finishing something is
// exactly the moment you have no idea what to do next — so the page answers before you have to ask.
//
// Two and a bit seconds: long enough to read a name, short enough that nobody ever waits on it. It is
// dismissible the whole time — click it and it takes you straight on.

import { useEffect } from 'react'
import { Check } from './icons'

export function Celebrate({
  verb, title, next, onDone,
}: {
  /** what happened, in one word: "Done" · "Closed" */
  verb: string
  /** what it happened TO — the thing you just finished */
  title: string
  /** what the page is about to open, by name. null = nothing is left waiting. */
  next: string | null
  onDone: () => void
}) {
  useEffect(() => {
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const t = setTimeout(onDone, calm ? 700 : 2200)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div
      className="cheer"
      role="status"
      onClick={onDone}                              /* never a wait — click through it */
      title="Continue"
    >
      <div className="cheer-in">
        <span className="cheer-disc">{Check}</span>
        <div className="cheer-verb">{verb}</div>
        <div className="cheer-what">{title}</div>

        <div className="cheer-next">
          {next
            ? <><span className="cn-k">Next up</span><span className="cn-v">{next}</span></>
            : <span className="cn-k done">Nothing else is waiting here</span>}
        </div>
      </div>
    </div>
  )
}
