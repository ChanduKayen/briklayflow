// SITE DESK (v30) — the page.
//
// Routes (all behind the feature flag, see src/lib/desk/flag.ts):
//   /desk                          → /desk/all/problems
//   /desk/:site/problems           :site = 'all' | a project_code (DSR)
//   /desk/:site/problems/:ref      deep link straight to one item
//   /desk/:site/plan               'all' → the pick-a-project state
//   ?loc={unit}                    focus one flat in the Work Plan
//
// SCOPE IS ONE THING, SHARED BY BOTH TABS, and it lives in the URL — so a link is always a
// place, and a refresh never loses where he was. It is also mirrored to localStorage, so
// arriving at a bare /desk lands him back on the project he was last looking at.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'

import '../styles/desk.css'
import { useAuth } from '../lib/auth/AuthProvider'
import { useDeskApi, type TaskEdit as TaskEditPatch } from '../lib/desk/api'
import type { DeskPlan, DeskProblem, DeskTask, Outcome, TaskState } from '../lib/desk/types'
import {
  sevScore, sliceFloor, taskStatus, floorName, setTaskState as applyState, bumpDuration,
  SITE_FLOOR, BUILDING_FLOOR, AMENITY_FLOOR,
} from '../lib/desk/derive'
import { PlanSetup } from '../components/desk/PlanSetup'
import { HeaderTabs, ScopePicker, SettingsGear, Sheet, SupervisorPill, UndoToast, type ToastState } from '../components/desk/Chrome'
import { useScrollCue } from '../components/desk/ScrollCue'
import { DetailBar, DetailContent, type Mode } from '../components/desk/Detail'
import {
  PendingView, ProblemControls, ProblemList,
  type KindFilter, type Segment, type SortBy,
} from '../components/desk/Problems'
import { TaskGroups, type Group } from '../components/desk/Plan'
import { Building } from '../components/desk/Building'
import { Celebrate } from '../components/desk/Celebrate'
import { TaskSheetBody, TaskSheetBar } from '../components/desk/TaskSheet'
import { TaskDelete } from '../components/desk/TaskDelete'
import { TaskMove } from '../components/desk/TaskMove'
import { TaskAdd } from '../components/desk/TaskAdd'
import { useIsDesktop, useIsTouch, useRowClose } from '../components/desk/useDesk'
import { DeskSkeleton } from '../components/desk/Skeleton'

const SCOPE_KEY = 'briklay_desk_scope'
let TOAST_SEQ = 0

/** Why these sit together. Keyed by the engine's phase names; anything unlisted just has no note. */
const GROUP_NOTES: Record<string, string> = {
  Structure: 'in sequence',
  Services: 'run in parallel, alongside structure',
  Finishes: 'after slab',
  'Whole floor': 'one job for the floor',
  'Floor common': 'corridor, lobby, stairs',
  'Site-wide': 'whole site — no floor',
  Foundation: 'before anything stands',
}

/**
 * THE SAME DESK, UNDER A PROJECT.
 *
 * A project page wants this desk, scoped to that project — and the desk was ALREADY scoped: every list
 * on it (problems, the plan, the pending queue, the rail, the detail) filters on `scope`, and `scope`
 * came from the URL. So there is nothing here to rebuild and nothing to fork. There are exactly two
 * things a second home needs:
 *
 *   lockedSite   the project this desk belongs to. It comes from the ROUTE (/projects/:id/desk), not
 *                from a picker, and it cannot be changed from inside — you are already in the project,
 *                and "All sites" would be a trapdoor out of the very page you opened.
 *   basePath     where its own links point. The desk navigates constantly (open an item, close it,
 *                follow a ref, switch tab) and every one of those has to stay inside the house it is
 *                standing in, or a click on a problem quietly teleports you out of the project.
 *
 * A FORK WOULD HAVE BEEN THE EASY THING AND THE WRONG ONE. Two desks means two places to fix the next
 * bug, and the one nobody is looking at rots. This is one desk with two front doors.
 */
export default function SiteDeskV2({
  session, tab, lockedSite, basePath = '/desk',
}: {
  session: Session
  tab: 'problems' | 'plan'
  /** A project_code (CHAK). Set by the project route; the site picker disappears and `all` is unreachable. */
  lockedSite?: string
  /** The root every link on this desk hangs off. '/desk' standalone, '/projects/PRJ-X/desk' embedded. */
  basePath?: string
}) {
  const nav = useNavigate()
  const { site: routeSite = 'all', ref: routeRef } = useParams<{ site: string; ref: string }>()
  const site = lockedSite ?? routeSite
  const [params, setParams] = useSearchParams()
  const { orgId } = useAuth()
  const queryClient = useQueryClient()
  // THE AUTH UID, not useAuth().userId — that one is the MEMBERSHIP id (AuthProvider.tsx:389), and
  // followup_events.actor_id / problem_resolutions.closed_by both FK to auth.users(id). Passing the
  // membership id made every note and every Close fail the foreign key, silently.
  const api = useDeskApi({ orgId: orgId ?? null, userId: session?.user?.id ?? null })
  const isDesktop = useIsDesktop()
  const isTouch = useIsTouch()

  /* ── ARRIVING FROM WHATSAPP ────────────────────────────────────────────────────────────────────────
   * Every confirmation Babai sends carries a button, and a button is a claim: "the thing I just told you
   * about is one tap away, and it is HERE". `?task=<ref>` and `?seg=pending` are the two the message layer
   * emits (_links.ts), and they land you ON the record — not on a list to go hunting through.
   *
   * SEEDED, not pinned: read once, on arrival, so the address bar decides where you START and every click
   * after that is still yours. (The problems deep link needs nothing here — an open problem is already the
   * URL itself, /desk/:site/problems/:ref, and the segment derives from the item's own state.) */
  const [segmentPick, setSegment] = useState<Segment | null>(() => {
    const seg = params.get('seg')
    return seg === 'pending' || seg === 'open' || seg === 'sorted' ? seg : null
  })
  const [sortBy, setSortBy] = useState<SortBy>('severe')
  const [kindF, setKindF] = useState<KindFilter>('all')
  const [openTaskRef, setOpenTaskRef] = useState<string | null>(() => params.get('task'))
  const [deleteRef, setDeleteRef] = useState<string | null>(null)   // the ⋯ → Delete confirmation
  const [moveRef, setMoveRef] = useState<string | null>(null)       // the ⋯ → Move (the drag, for fingers)
  const [addSection, setAddSection] = useState<string | null>(null) // the section "+" → Add a task
  const [mode, setMode] = useState<Mode>({ k: 'view' })
  const [toast, setToastState] = useState<ToastState | null>(null)
  const setToast = useCallback((t: { msg: string; undo?: () => void } | null) => {
    setToastState(t ? { ...t, id: ++TOAST_SEQ } : null)   // a fresh id → a fresh mount → it slides in
  }, [])
  const [reopeningId, setReopeningId] = useState<string | null>(null)
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const [taskNote, setTaskNote] = useState('')
  const { closingId, close: animateClose } = useRowClose()

  /* FINISHING IS A MOMENT, AND IT BELONGS TO THE CARD.
   *
   * The button used to flash green and that was the whole event — a receipt for a click, on the wrong
   * object entirely: the button did not get finished, the WORK did. So the card takes the moment and
   * then hands over what comes next, by name (see Celebrate.tsx).
   *
   * `cheer` is only the announcement. What comes NEXT is never stored in it — it is derived after the
   * write lands, so the page names the task that is actually next, including one this very click just
   * unblocked. A promise made from stale data is worse than no promise. */
  const [cheer, setCheer] = useState<{ verb: string; title: string } | null>(null)
  const closeAfterCheer = useRef<(() => void) | null>(null)

  const scope = site === 'all' ? 'all' : site.toUpperCase()
  const scopedSite = api.sites.find((s) => s.code === scope) ?? null
  const currentUnit = params.get('loc') ?? 'Common'

  // The REMEMBERED scope belongs to the standalone desk — where you left off, so a bare /desk lands you
  // back there. A desk locked inside a project must never write it: opening a project would silently
  // reset where the global desk thinks you were.
  useEffect(() => { if (!lockedSite) localStorage.setItem(SCOPE_KEY, scope) }, [scope, lockedSite])

  /* THE HEADER FROSTS ONCE CONTENT HAS PASSED BENEATH IT.
   *
   * There is ONE scrollbar on this page — the window's — and on the plan the only thing it can move
   * is the task list, because the rail and the detail are pinned exactly where they already sit (see
   * desk.css: they stick at the very offset they start at, so they do not travel even one pixel
   * before catching — that was the jitter).
   *
   * At rest the bar IS the paper: no glass, no shadow, nothing to explain. The moment the list slides
   * under it, it frosts, because now it is a layer above the page and has to say so.
   * (rAF-throttled: scroll must never be the thing that stutters.) */
  const [lifted, setLifted] = useState(false)

  /* THE EDGE OF EACH LIST. A list that runs under the fold has to say so — the desk's lists ended at the
     bottom of the window with a clean card border, and a clean edge is a full stop. One per scrolling
     column; the pinned card beside them has nothing to do with it. */
  const planCue = useScrollCue()
  const listCue = useScrollCue()
  useEffect(() => {
    let queued = false
    const onScroll = () => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => { queued = false; setLifted(window.scrollY > 4) })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  /**
   * AN EMPTY PROBLEMS TAB IS A DEAD END.
   *
   * Problems is the landing tab, and rightly so: it is the half of the desk that needs a human. But a site
   * with nothing wrong has NOTHING on it — so picking that site drops the supervisor on a blank list that
   * tells him nothing, and he has to work out for himself that the thing he wants is one tab over. The app
   * knew the list was empty before it drew it.
   *
   * So when he picks a site with no open problems, take him to its work plan — which is where he was going
   * anyway. Rules, in order:
   *   · 'All sites' → never redirect. The org-wide problem list is the whole point of that view.
   *   · already on the plan → stay on the plan. Never yank a man off the tab he chose.
   *   · the site HAS open problems → leave him on Problems. That is the tab that needs him.
   * And it fires only on a SITE PICK, never on mount: clicking the Problems tab yourself must always show
   * you Problems, empty or not. Choosing to look at nothing is a valid thing to choose.
   */
  const tabForSite = useCallback((code: string): 'problems' | 'plan' => {
    if (code === 'all' || tab === 'plan') return tab
    const hasOpen = api.problems.some((p) => p.siteCode === code && p.state !== 'resolved')
    return hasOpen ? 'problems' : 'plan'
  }, [api.problems, tab])

  /** Where a link goes. Under a project the site is IMPLIED by the address, so it is not repeated in it:
   *  /projects/PRJ-X/desk/problems/CHAK-14 — not /projects/PRJ-X/desk/chak/problems/CHAK-14. */
  const href = useCallback((s: string, t: 'problems' | 'plan', ref?: string) => (
    lockedSite
      ? `${basePath}/${t}${ref ? `/${ref}` : ''}`
      : `${basePath}/${s.toLowerCase()}/${t}${ref ? `/${ref}` : ''}`
  ), [basePath, lockedSite])

  const goto = useCallback((s: string, t: 'problems' | 'plan', ref?: string) => {
    // A deep scroll on one tab must not land you halfway down the other.
    window.scrollTo({ top: 0, behavior: 'auto' })
    nav(href(s, t, ref))
  }, [nav, href])

  /* ---------- Problems ----------
   * THE OPEN ITEM IS THE URL, not a copy of it in state. A deep link, a back button and a click
   * on a row are then all the same thing, and none of them can disagree with the address bar.
   * The segment likewise DERIVES from the deep link (a link to a closed item lands on Sorted),
   * until he touches the control himself — after that his choice wins. */
  const openItem = routeRef ? api.problems.find((p) => p.ref === routeRef) ?? null : null
  const segment: Segment = segmentPick ?? (openItem?.state === 'resolved' ? 'sorted' : 'open')

  const problems = useMemo(() => {
    const wanted: (DeskProblem['state'])[] = segment === 'sorted' ? ['resolved'] : ['you', 'chasing', 'moving']
    const list = api.problems.filter((p) =>
      wanted.includes(p.state)
      && (scope === 'all' || p.siteCode === scope)
      && (kindF === 'all' || p.kind === kindF))

    return segment === 'sorted' || sortBy === 'new'
      ? list.slice().sort((a, b) => a.last - b.last)
      : list.slice().sort((a, b) => sevScore(b) - sevScore(a))
  }, [api.problems, segment, scope, kindF, sortBy])

  const pending = useMemo(
    () => (scope === 'all' ? api.pending : api.pending.filter((p) => !p.site || api.sites.find((s) => s.code === scope)?.name === p.site)),
    [api.pending, api.sites, scope],
  )

  const needsYou = api.problems.filter((p) => p.state === 'you' && (scope === 'all' || p.siteCode === scope)).length

  // Opening an item KEEPS the current scope — reading DSR-21 from "All projects" must not
  // silently narrow the list to DSR. Only an explicit cross-link (gotoRef) changes site.
  const openDetail = useCallback((id: string) => {
    const p = api.problems.find((x) => x.id === id)
    if (!p) return
    setMode({ k: 'view' })
    nav(href(scope, 'problems', p.ref), { replace: true })
  }, [api.problems, nav, href, scope])

  const dismissDetail = useCallback(() => {
    setMode({ k: 'view' })
    nav(href(scope, 'problems'), { replace: true })
  }, [nav, href, scope])

  /** Any ref, from anywhere — a status line, a unit badge, a task's blocker. ONE ref space, so
   *  this resolves a problem OR a task without the caller having to know which it was. */
  const gotoRef = useCallback((r: string) => {
    const p = api.problems.find((x) => x.ref === r)
    if (p) { setMode({ k: 'view' }); goto(p.siteCode, 'problems', p.ref); return }
    setOpenTaskRef(r)
    goto(scope, 'plan')
  }, [api.problems, goto, scope])

  /**
   * THE CLOSE. One question (the outcome), then the row collapses out of the list and an Undo
   * sits there for 4.5 seconds. On mobile we let the sheet leave first — otherwise the collapse
   * happens behind it and he never sees the thing he did.
   */
  const confirmClose = async (outcome: Outcome, note: string) => {
    const item = openItem
    if (!item) return
    // AWAIT THE WRITE. The row must not fade out over a close the database refused — which is
    // exactly what happened while closed_by carried the wrong id and the FK silently rejected it.
    let snap
    try {
      snap = await api.close(item.id, outcome, note)
    } catch (e) {
      setToast({ msg: (e as Error).message })
      return
    }
    const wasSheet = !isDesktop
    const snapshot = snap
    const finish = () => {
      dismissDetail()
      animateClose(item.id, wasSheet, () => {
        setToast({
          msg: `${item.ref} closed — ${outcome}`,
          undo: () => { api.undo(snapshot!); setReopeningId(item.id); setTimeout(() => setReopeningId(null), 1100) },
        })
      })
    }

    // ON DESKTOP THE CARD CELEBRATES FIRST — the thing you closed gets named before it leaves. On a
    // phone the sheet must go first or the row collapses behind it and he never sees what he did.
    if (isDesktop) { setCheer({ verb: 'Closed', title: item.title }); closeAfterCheer.current = finish }
    else finish()
  }

  const swipeClose = (id: string) => { openDetail(id); setTimeout(() => setMode({ k: 'resolve' }), 60) }

  /**
   * An action the backend cannot honour must SAY SO. It never toasts a success it did not achieve —
   * "Sent on WhatsApp" when nothing was sent is the one unforgivable lie here.
   *
   * AND IT RETHROWS. The toast is for the human; the rejection is for the BUTTON, which flashes
   * green on success and red on failure. Swallowing the error here would make every button flash
   * green over a write the database refused — the same lie, wearing nicer clothes.
   */
  const attempt = async (run: () => Promise<void>, ok: string) => {
    try { await run(); setToast({ msg: ok }) }
    catch (e) { setToast({ msg: (e as Error).message }); throw e }
  }
  /** For callers that are not a Btn (a <select>, a keyboard handler) — nothing to flash, so the
   *  rejection stops here rather than becoming an unhandled promise. */
  const attemptQuiet = (run: () => Promise<void>, ok: string) => { void attempt(run, ok).catch(() => {}) }

  const onPrimary = async (act: 'call' | 'approve' | 'nudge' | 'reopen') => {
    const item = openItem
    if (!item) return
    if (act === 'call') { window.location.assign(`tel:${item.person.phone.replace(/\s/g, '')}`); return }
    if (act === 'approve') {
      await attempt(() => api.approve(item.id), `Approved — ${item.person.name} notified on WhatsApp`)
      if (!isDesktop) dismissDetail()
      return
    }
    if (act === 'nudge') {
      await attempt(() => api.nudge(item.id), 'Follow-up moved up — Briklay chases on the next run')
      if (!isDesktop) dismissDetail()
      return
    }
    if (act === 'reopen') {
      await attempt(() => api.reopen(item.id), `${item.ref} reopened`)
      setSegment('open')
      setReopeningId(item.id)
      setTimeout(() => setReopeningId(null), 1100)
      if (!isDesktop) dismissDetail()
    }
  }

  const onSend = async (text: string) => {
    const item = openItem
    if (!item) return
    // The await resolves the moment the send succeeds — which is what lets the Send button play its
    // success + bloom. So DON'T yank the composer away on that same tick; let the celebration land,
    // then fold back to the story. A failure throws out of here (composer stays open, toast explains).
    await attempt(() => api.say(item.id, text), `Sent to ${item.person.name} — reply will land here`)
    setTimeout(() => { setMode({ k: 'view' }); if (!isDesktop) dismissDetail() }, 1400)
  }

  /* ---------- Plan ---------- */

  const basePlan = scope === 'all' ? null : api.planFor(scope)

  /**
   * THE FLOOR IS A PLACE YOU CAN GO. It used to only raise a toast ("Second — not started yet"),
   * which is the least useful thing a click can do: a floor at 0% is exactly the floor you want
   * to open, because that is where the work you have not started lives.
   *
   * The floor comes from the URL (?floor=), so it deep-links and survives a refresh; with none
   * named, the plan's own focus (the lowest unfinished floor) stands.
   */
  const floorParam = params.get('floor')
  const plan: DeskPlan | null = useMemo(() => {
    if (!basePlan) return null
    const wanted = floorParam && basePlan.floors.some((f) => f.n === floorParam) ? floorParam : basePlan.focus
    if (wanted === basePlan.focus) return basePlan
    return { ...basePlan, focus: wanted }
  }, [basePlan, floorParam])

  // memoised: it feeds the live-edge lookup, and a fresh [] every render would re-run it every render
  const allTasks: DeskTask[] = useMemo(() => plan?.tasks ?? [], [plan])
  const slice = useMemo(() => (plan ? sliceFloor(plan.tasks, plan.focus) : null), [plan])

  const planTasks = useMemo(() => {
    if (!slice) return []
    if (!slice.units || currentUnit === 'Common') return slice.common
    return slice.units.list.find((u) => u.u === currentUnit)?.tasks ?? slice.common
  }, [slice, currentUnit])

  /** Groups come from the tasks themselves (the engine's `phase`), so a real plan groups by what
   *  it actually contains rather than by a hard-coded list that only fits the mock.
   *
   *  THE NOTE IS THE TRADE — WHO DOES THIS WORK. It came up from the task detail, where it was
   *  printed once per task to say a thing that is true of the whole phase, and where you only saw
   *  it after you had already picked the task. On the header it answers "whose men am I looking at?"
   *  before you read a single row. A phase that mixes trades names them (up to two, then "+n"); a
   *  phase whose trade we do not know keeps its old hand-written note. */
  const planGroups: Group[] = useMemo(() => {
    /**
     * A BUILDING IS BUILT IN THIS ORDER, SO THE PAGE IS READ IN THIS ORDER.
     *
     * The sections used to come out in whatever order their first task happened to land in seq_no —
     * which on a real plan is not the order the work happens, because a floor's services and finishes
     * interleave with the structure above them. So Finishes could sit above Services, and the page
     * read as though the flats were painted before they were wired.
     *
     * Structure carries the load, services go in the walls it makes, finishes cover the services.
     * That is the sequence of every building ever built, and it is not up to the sort order of a
     * column. Anything that is not one of the three (a hand-made group, a floor-common band) keeps
     * its natural position after them.
     */
    const LAYERS = ['Structure', 'Services', 'Finishes']
    const rank = (n: string) => {
      const i = LAYERS.indexOf(n)
      return i === -1 ? LAYERS.length : i
    }
    const names = [...new Set(planTasks.map((t) => t.group))]
      .sort((a, b) => rank(a) - rank(b))
    return names.map((n) => {
      const trades = [...new Set(
        planTasks.filter((t) => t.group === n).map((t) => t.trade?.trim()).filter(Boolean),
      )] as string[]
      const note = trades.length === 0 ? (GROUP_NOTES[n] ?? '')
        : trades.length <= 2 ? trades.join(' · ')
          : `${trades.slice(0, 2).join(' · ')} +${trades.length - 2}`
      return { n, note }
    })
  }, [planTasks])

  /* THE LIST OPENS ON THE WORK, NOT ON THE TOP OF IT.
   *
   * A floor's list is mostly history: everything already done, in the order it was done, and the
   * live edge is somewhere in the middle of it. Landing at row one means landing on finished work
   * and scrolling past it to find the question you actually came to answer — every single time.
   *
   * So the list arrives at the LIVE EDGE: the first task in progress, or, if nothing is running, the
   * first one that can start. Nothing running and nothing startable (the whole floor is done, or all
   * of it is waiting on the floor below) — then the top is the honest place to be, because there is
   * no edge to show. Centred, not just barely in view, so what comes before and after is visible too:
   * you land ON the work, with its context around it. */
  const edgeRef = useMemo(() => {
    const byRef = (r: string) => allTasks.find((t) => t.ref === r)
    const live = planTasks.find((t) => taskStatus(t, api.problems, byRef).cls === 'live')
    if (live) return live.ref
    return planTasks.find((t) => taskStatus(t, api.problems, byRef).cls === 'ready')?.ref ?? null
  }, [planTasks, allTasks, api.problems])

  /* AND IT IS OPEN WHEN YOU GET THERE.
   *
   * Arriving at the live task with an empty pane beside it makes you click the very thing the page
   * just pointed at — a second step to reach the place it had already decided you were going. So the
   * live edge is the selection until you make one of your own: DERIVED, not written into state, so a
   * floor never has to remember whether it "already auto-selected" — the page simply always has the
   * work open, and anything you pick (or deep-link to) wins over what it volunteered. */
  const selectedRef = openTaskRef ?? edgeRef
  const openTask = selectedRef ? allTasks.find((t) => t.ref === selectedRef) ?? null : null

  /* AND YOU SEE IT HAPPEN. The list does NOT arrive pre-scrolled — that reads as "the page loaded
   * weird", and it silently steals the fact that there is finished work above. So: the floor lands at
   * its top, you get a beat to see it whole, and then the page GLIDES down to the live edge. The
   * movement is the message — it says "this is the part that is yours", and it shows you what it
   * scrolled past on the way. (Reduced motion: it just lands there, no glide.) */
  const arriving = useRef(false)
  useEffect(() => {
    if (tab !== 'plan') return
    window.scrollTo({ top: 0 })                     // start at the top of the floor, always
    if (!edgeRef) return

    arriving.current = true
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const t = setTimeout(() => {
      const row = document.querySelector<HTMLElement>(`.plan-list [data-ref="${CSS.escape(edgeRef)}"]`)
      row?.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' })
      window.setTimeout(() => { arriving.current = false }, 600)
    }, calm ? 0 : 420)                              // long enough to register the top, short enough not to wait
    return () => clearTimeout(t)
    // ARRIVAL ONLY. `edgeRef` is deliberately NOT a dependency — see the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, scope, plan?.focus, currentUnit])

  /**
   * THE EDGE MOVED — DO NOT REBUILD THE JOURNEY.
   *
   * When a task is marked done the live edge steps to the next one, and this used to run the whole
   * arrival sequence again: jump the page back to the very top of the floor and then glide all the
   * way down. So finishing a task threw the list to the beginning and scrolled it past everything —
   * every time. He was already looking at the row; the app took it away from him to bring it back.
   *
   * A row he can already see does not need to be scrolled to AT ALL. So: if the new edge is comfortably
   * on screen, do nothing — the highlight is the whole message. Only when it has moved out of sight do
   * we move, and then by the LEAST we can ('nearest'), not by re-centring the world.
   */
  useEffect(() => {
    if (tab !== 'plan' || !edgeRef || arriving.current) return
    const row = document.querySelector<HTMLElement>(`.plan-list [data-ref="${CSS.escape(edgeRef)}"]`)
    if (!row) return

    const r = row.getBoundingClientRect()
    const margin = 96                                // the sticky header's worth of breathing room
    const visible = r.top >= margin && r.bottom <= window.innerHeight - 24
    if (visible) return                              // he is looking right at it. Leave him alone.

    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    row.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' })
  }, [edgeRef, tab])

  const setUnit = (u: string) => {
    const next = new URLSearchParams(params)
    if (u === 'Common') next.delete('loc'); else next.set('loc', u)
    setParams(next, { replace: true })
  }

  const onTaskState = async (s: TaskState) => {
    if (!openTask) return
    const t = openTask
    await attempt(
      () => api.patchTask(scope, t.ref, (x) => applyState(x, s)),
      s === 'done' ? `${t.ref} done — next task unlocked`
        : s === 'active' ? `${t.ref} started` : `${t.ref} reset`,
    )
    if (s === 'done') setCheer({ verb: 'Done', title: t.title })
  }

  /** The card has had its moment. Let go of what was finished — the derived live edge (the very task
   *  the celebration just named) becomes the selection on its own — and, on a closed problem, let the
   *  row collapse out of the list now rather than behind the celebration. */
  const cheerDone = useCallback(() => {
    setCheer(null)
    setOpenTaskRef(null)
    setMode({ k: 'view' })
    const run = closeAfterCheer.current
    closeAfterCheer.current = null
    run?.()
  }, [])

  /** WHAT THE CELEBRATION PROMISES, and it must be true: the next task the page will actually open,
   *  or the next problem still waiting on you. Named from live data, after the write. */
  const nextUp = !cheer ? null
    : tab === 'plan'
      ? allTasks.find((t) => t.ref === edgeRef && t.ref !== openTaskRef)?.title ?? null
      : problems.find((p) => p.id !== openItem?.id)?.title ?? null
  const onTaskDur = (d: number) => {
    if (openTask) attemptQuiet(() => api.patchTask(scope, openTask.ref, (t) => bumpDuration(t, d)), 'Duration updated')
  }
  // A typed note goes to site_task_comments — the SAME table the WhatsApp resolver writes to, so
  // a typed update and a spoken one land in one trail and read as one story.
  const onTaskNote = async () => {
    if (!openTask || !taskNote.trim()) return
    const text = taskNote.trim()
    await attempt(() => api.addTaskNote(openTask.ref, text), `Update added to ${openTask.ref}`)
    setTaskNote('')
  }

  /**
   * The drop is REFEREED before anything is written (lib/desk/edit.ts · checkMove). A move that
   * breaks a DESTRUCTIVE edge goes through with the damage named — it is his site and his call; only
   * the physically impossible is refused.
   *
   * NO TOAST. The verdict already travelled with his hand — it was on the row he was holding the work
   * over, in colour, before he let go — and the rows then visibly rearrange themselves. Announcing it
   * a third time at the bottom of the screen would be the app talking to itself. The toast survives
   * only for a FAILED WRITE, which is the one thing the drag could not have told him.
   */
  const onDrop = async (from: string, to: string) => {
    if (!plan) return
    try {
      await api.reorder(scope, from, to)
    } catch (e) {
      setToast({ msg: e instanceof Error ? e.message : 'Could not save the new order' })
    }
  }

  const deleteTask = allTasks.find((t) => t.ref === deleteRef) ?? null
  const moveTask = allTasks.find((t) => t.ref === moveRef) ?? null

  /** Edit, in the card. The rename rule lives in edit.ts; this only reports what it did. */
  const onEditSave = async (patch: TaskEditPatch) => {
    if (!openTask) return
    const t = openTask
    const kin = patch.renameScope === 'type' && patch.name
      ? allTasks.filter((x) => x.taskTypeId && x.taskTypeId === t.taskTypeId).length
      : 1
    await attempt(
      () => api.editTask(scope, t.ref, patch),
      patch.name && kin > 1 ? `Renamed ${kin} tasks` : patch.name ? `${t.ref} renamed` : `${t.ref} updated`,
    )
  }

  /* ---------- Render ---------- */

  const detailFor = (): { content: React.ReactNode; bar: React.ReactNode } | null => {
    if (tab === 'plan' && openTask) {
      return {
        content: (
          <TaskSheetBody
            task={openTask} problems={api.problems} allTasks={allTasks}
            members={api.members} note={taskNote} setNote={setTaskNote} onEdit={onEditSave}
            onOpen={setOpenTaskRef} onRef={gotoRef} onState={onTaskState} onDur={onTaskDur} onNote={onTaskNote}
            onAssign={(uid) => attemptQuiet(
              () => api.assignTask(openTask.ref, uid),
              uid ? `Assigned to ${api.members.find((m) => m.id === uid)?.name}` : 'Unassigned',
            )}
            onQc={(qcId, status) => attempt(
              () => api.answerQc(qcId, status, null),
              status === 'failed' ? 'Marked not right — this will need redoing'
                : status === 'confirmed' ? 'Check confirmed' : 'Check reopened',
            )}
          />
        ),
        bar: (
          <TaskSheetBar
            task={openTask}
            onState={onTaskState}
            onReopen={() => { void onTaskState('active') }}
          />
        ),
      }
    }
    if (tab === 'problems' && openItem) {
      return {
        content: (
          <DetailContent
            item={openItem} tasks={allTasks} isTouch={isTouch}
            onNote={(t) => attempt(() => api.addNote(openItem.id, t), 'Note added')}
            members={api.members}
            onAssign={(uid) => {
              const name = api.members.find((m) => m.id === uid)?.name
              attemptQuiet(
                () => api.assignProblem(openItem.id, uid),
                uid ? `Reassigned to ${name ?? 'them'} — notifying on WhatsApp` : 'Unassigned',
              )
            }}
          />
        ),
        bar: (
          <DetailBar
            item={openItem} isTouch={isTouch} mode={mode} setMode={setMode}
            onPrimary={onPrimary} onConfirmClose={confirmClose} onSend={onSend}
          />
        ),
      }
    }
    return null
  }

  const detail = detailFor()
  const sheetOpen = !isDesktop && !!detail

  /**
   * BRING THE DETAIL INTO THE FRAME.
   *
   * On a long plan you select a task 40 rows down, and the panel — pinned at the top of the
   * workspace — is nowhere near your eyes. The click "did nothing", as far as you can see. So the
   * panel comes to you: it scrolls into view the moment something is selected.
   *
   * `block: 'nearest'` on purpose: if it is already visible, nothing moves at all. The page only
   * intervenes when it has to.
   */
  /**
   * THE FIRST ITEM IS OPEN, BECAUSE A DETAIL PANEL WITH NOTHING IN IT IS A THIRD OF THE SCREEN SAYING
   * "SELECT AN ITEM TO SEE ITS FULL STORY".
   *
   * The plan has always worked this way — it lands on the live edge — and the problems tab did not, so
   * arriving at it meant looking at a list and an empty box, and having to click something before the
   * page would tell you anything. The most urgent item is already at the top of the list (the sort is
   * severity); opening it is not a decision, it is the answer to the question he came with.
   *
   * Desktop only: on a phone the detail is a SHEET, and a sheet that opens itself is a page you have to
   * dismiss before you can even see the list.
   */
  useEffect(() => {
    if (tab !== 'problems' || !isDesktop) return
    if (routeRef || segment === 'pending' || !problems.length) return
    nav(href(scope, 'problems', problems[0].ref), { replace: true })
  }, [tab, isDesktop, routeRef, segment, problems, nav, href, scope])

  const panelRef = useRef<HTMLElement>(null)
  const selectedKey = openTaskRef ?? openItem?.id ?? null
  useEffect(() => {
    if (!isDesktop || !selectedKey) return
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [selectedKey, isDesktop])

  return (
    <div className="desk-root">
      <div className="shell">
        {/* ONE LINE: where you are · what you are looking at · who it answers to. */}
        <header className={`topbar ${lifted ? 'lifted' : ''}`}>
          <div className="topbar-left">
            <SettingsGear variant="desktop" onClick={() => nav('/desk/settings/chasing')} />

            {/* THE PICKER IS FOR CHOOSING A SITE, AND UNDER A PROJECT THE SITE IS ALREADY CHOSEN.
                Leaving it there would put a trapdoor out of the page you just opened — and an "All
                sites" option on a project page is a sentence that does not mean anything. The site's
                NAME takes its place, because you still want to be told where you are. */}
            {lockedSite
              ? <span className="scope-locked">{scopedSite?.name ?? scope}</span>
              : (
                <ScopePicker
                  sites={api.sites}
                  scope={scope}
                  onScope={(code) => { setOpenTaskRef(null); goto(code, tabForSite(code)) }}
                />
              )}
            <HeaderTabs
              tab={tab === 'plan' ? 'plan' : 'problems'}
              onTab={(t) => goto(scope, t === 'plan' ? 'plan' : 'problems')}
              needsYou={needsYou}
            />
          </div>

          <div className="topbar-right">
            {scopedSite && (
              <SupervisorPill
                members={api.members}
                current={scopedSite.supervisorId}
                onAssign={(uid) => attemptQuiet(
                  () => api.assignSupervisor(scope, uid),
                  uid ? `Supervisor set — ${api.members.find((m) => m.id === uid)?.name}` : 'Supervisor cleared',
                )}
              />
            )}
            <SettingsGear variant="mobile" onClick={() => nav('/desk/settings/chasing')} />
          </div>
        </header>

        {api.error && (
          <div className="headline-card hot" style={{ marginTop: 16 }}>
            <div className="hl-label">Not connected</div>
            <div className="hl-sub" style={{ marginTop: 6 }}>{api.error}</div>
          </div>
        )}

        <div className="tab-body">

        {/* ═══ THE SHAPE OF THE PAGE, BEFORE THE PAGE ═══════════════════════════════════════════
            The desk is a big read, and it used to show NOTHING while it did it — a blank workspace,
            then everything at once. A skeleton is not a spinner: a spinner says "wait", a skeleton
            says "here is what is coming, and here is where it will be". The eye finds the list, the
            rail and the detail card before there is anything in them, and when the data lands nothing
            jumps — because the bones ARE the real markup (see Skeleton.tsx). */}
        {api.loading && !api.error && <DeskSkeleton tab={tab === 'plan' ? 'plan' : 'problems'} />}

        {!api.loading && <>
        {/* ================= WORK PLAN =================
            The picker shows ONLY at "All projects". Once a site is chosen, a missing plan means
            "not laid out yet" — and the answer to that is the wizard, never the picker again. */}
        {tab === 'plan' && (
          scope === 'all' ? (
            <div className="plan-empty-all" style={{ paddingTop: 22 }}>
              <div className="pe-big">Pick one project to see its plan</div>
              <div className="pe-sub">
                A work plan is one building's sequence, so it can't span every project at once.
                Choose a project above.
              </div>
              <div className="pe-list">
                {api.sites.map((s) => (
                  <button key={s.code} className="pe-item" onClick={() => goto(s.code, 'plan')}>
                    <span className={`sm-dot ${s.state === 'hot' ? 'hot' : s.state === 'ok' ? 'ok' : 'mid'}`} />
                    <div className="sm-body">
                      <div className="sm-name">{s.name} <span className="sm-code">{s.code}</span></div>
                      <div className={`sm-state ${s.state === 'hot' ? 'hot' : ''}`}>{s.focus} · {s.note}</div>
                    </div>
                    <span className="sm-pct">{s.pct}%</span>
                  </button>
                ))}
              </div>
            </div>
          ) : api.plansLoading && (!plan || plan.tasks.length === 0) ? (
            /* THE PLAN IS A SEPARATE, LATER LOAD than the Problems list — so an empty `plan` here can
               mean "still loading", not "no plan yet". Show the plan skeleton until it lands; only THEN
               is a truly-empty plan the wizard's cue. Without this, opening the Work Plan before the
               plan query returns would flash the setup wizard over a plan that was already there. */
            <DeskSkeleton tab="plan" />
          ) : !plan || plan.tasks.length === 0 ? (
            /* NO PLAN YET. A project with no tasks is not an empty screen — it is a building waiting
               to be described. PlanSetup asks for it (and draws it as you answer); setupPlan() does
               the write, and it is the SAME door the new-project wizard uses. One generator, always:
               a second one is the exact mistake this codebase already paid for. */
            <div className="plan-setup">
              <PlanSetup
                projectId={scopedSite?.projectId ?? ''}
                projectType={scopedSite?.projectType ?? ''}
                onComplete={(r) => {
                  // PlanSetup writes TASKS — those live in the PLAN query. Invalidate both so the new
                  // plan lands and the site cards' pct refreshes.
                  void queryClient.invalidateQueries({ queryKey: ['desk'] })
                  void queryClient.invalidateQueries({ queryKey: ['deskPlan'] })
                  setToast({
                    msg: r.generated
                      ? `Plan laid out — ${r.taskCount} tasks`
                      : 'This building type has no sequence yet — nothing was generated',
                  })
                }}
              />
            </div>
          ) : (
            <>
              {/* THREE COLUMNS: the building · the work on the floor you picked · the task itself. */}
              <div className="workspace plan-workspace">
                <Building
                  floors={plan.floors}
                  focus={plan.focus}
                  units={slice?.units?.list ?? null}
                  common={slice?.common ?? []}
                  problems={api.problems}
                  currentUnit={currentUnit}
                  onFloor={(n) => {
                    const next = new URLSearchParams(params)
                    next.set('floor', n)
                    next.delete('loc')            // the flats belong to the floor you just left
                    setParams(next, { replace: true })
                    setOpenTaskRef(null)
                  }}
                  onUnit={setUnit}
                  onRef={gotoRef}
                />

                <div className="plan-col" ref={planCue.ref}>
                  {/* SAY WHAT THE COLUMN IS. "Fourth · Flat Unit A" is a breadcrumb, and a breadcrumb
                      above a list of tasks makes you work out for yourself what you are looking at. */}
                  <div className="col-cap">
                    <span>
                      Tasks for {floorName(plan.focus)}
                      {slice?.units
                        ? currentUnit === 'Common' ? ' · common areas' : ` · Flat ${currentUnit}`
                        : ''}
                    </span>
                    <em>{planTasks.length}</em>
                  </div>

                  <div className="list plan-list">
                    {/* Blocks render ONLY when a site has more than one — and INSIDE the card, so a
                        site that has two blocks does not sit one band lower than a site that has one. */}
                    {plan.blocks && plan.blocks.length > 1 && (
                      <div className="blockbar">
                        {plan.blocks.map((b) => <button key={b} className="blockchip">{b}</button>)}
                      </div>
                    )}
                    <div className="list-head">
                      {api.canReorder
                        ? 'Drag a task to reorder it — you’ll be told if a job can’t come before another'
                        : 'In the order the work has to happen'}
                    </div>
                    {/* The across-flats rollup is GONE. On the prototype's 4 activities it read as one
                        crisp sentence; against a real 26-type engine plan it was a wall of "0/2" that
                        said nothing. A summary that lists everything is not a summary. */}
                    {planTasks.length === 0 ? (
                      <div className="empty">
                        <b>Nothing on this floor yet</b>
                        No tasks are laid out for {plan.focus}.
                      </div>
                    ) : (
                      <TaskGroups
                        tasks={planTasks} groups={planGroups} problems={api.problems} allTasks={allTasks}
                        // DRAG WORKS ON EVERY FLOOR, INCLUDING ONES WITH FLATS. This used to be
                        // `&& !slice?.units` — switched off the moment a floor had flats on it, which
                        // is most floors, which is why "dragging doesn't work". That guard was written
                        // when a drop had no referee and nowhere to persist to: reordering a slice of
                        // a floor would have meant guessing at the project-wide sequence. It does not
                        // guess now. The referee is the engine (checkMove) and the write is the whole
                        // project's order in one statement (siteops_resequence).
                        draggable={api.canReorder} isTouch={isTouch} openRef={selectedRef}
                        folded={folded} onFold={(g) => setFolded((f) => ({ ...f, [g]: true }))}
                        onOpen={setOpenTaskRef} onRef={gotoRef} onDrop={onDrop}
                        onDelete={setDeleteRef} onMove={api.canReorder ? setMoveRef : undefined}
                        onAdd={setAddSection}
                      />
                    )}
                  </div>
                  {planCue.cue}
                </div>
                <div className="panel-col">
                  {/* .pin holds the caption AND the card together for the whole scroll — the column
                      is full-height so this never gets released when the task list runs out. */}
                  <div className="pin">
                    <div className="col-cap">
                      <span>{openTask ? `Task · ${openTask.ref}` : 'Task detail'}</span>
                    </div>
                    <aside className="panel" ref={panelRef} aria-label="Task detail">
                      {isDesktop && detail ? (
                        <>
                          <div className="d-scroll">{detail.content}</div>
                          <div className="d-bar">{detail.bar}</div>
                        </>
                      ) : (
                        <div className="panel-empty">Select a task to see its details.</div>
                      )}
                      {/* the card takes the moment, names what it finished, and hands you the next one */}
                      {cheer && <Celebrate verb={cheer.verb} title={cheer.title} next={nextUp} onDone={cheerDone} />}
                    </aside>
                  </div>
                </div>
              </div>
            </>
          )
        )}

        {/* ================= PROBLEMS ================= */}
        {tab === 'problems' && (
          <>
            {/* ══ THE CONTROLS BELONG TO THE LIST ═══════════════════════════════════════════════════
                They used to sit ABOVE the grid, spanning both columns — so Pending·Open·Sorted was a
                page-level banner, and the card's column began underneath it. Two things followed, and
                both were wrong: the tabs scrolled away on their own while the list they govern stayed,
                and the card started a whole control-bar lower than the top of the frame it had to fit
                into.

                They are the LIST's controls. They name what it is showing and how it is sorted, and
                nothing on the right-hand card answers to them. So they live in the list's column and
                travel with it: tabs and rows move as one thing, and the card — which the scroll has no
                business touching — is pinned from the top of the frame and whole in it. */}
            <div className="workspace">
              <div className="list-col" ref={listCue.ref}>
                <ProblemControls
                  segment={segment} setSegment={setSegment}
                  sortBy={sortBy} setSort={setSortBy}
                  kindF={kindF} setKind={setKindF}
                  pendingCount={pending.length}
                />
                {segment === 'pending' ? (
                  <PendingView
                    items={pending}
                    onPlace={(id) => attempt(() => api.place(id), 'Opening placement — pick where it belongs')}
                    onDismiss={(id) => attempt(() => api.dismissPending(id), 'Dismissed')}
                  />
                ) : (
                  <ProblemList
                    items={problems} segment={segment} sortBy={sortBy}
                    openId={openItem?.id ?? null} closingId={closingId} reopeningId={reopeningId}
                    isTouch={isTouch} siteName={scopedSite?.name ?? null} kindF={kindF}
                    onOpen={openDetail} onSwipeClose={swipeClose}
                  />
                )}
                {listCue.cue}
              </div>

              {/* ONE SCROLLBAR, AND THE ONLY THING IT MOVES IS THE LIST.
                  The plan already worked this way: the detail is PINNED, you spin the wheel and the work
                  scrolls past it. The problems tab let the whole page move instead, so reading a long
                  thread carried the item you were reading off the top of the screen. Same rule, both
                  tabs — the thing you are looking AT stays still, and the things you are looking THROUGH
                  move. */}
              <div className="pin">
                <aside className="panel" ref={panelRef} aria-label="Item detail">
                  {isDesktop && detail ? (
                    <>
                      <div className="d-scroll">{detail.content}</div>
                      <div className="d-bar">{detail.bar}</div>
                    </>
                  ) : (
                    <div className="panel-empty">Select an item to see its full story.</div>
                  )}
                  {cheer && <Celebrate verb={cheer.verb} title={cheer.title} next={nextUp} onDone={cheerDone} />}
                </aside>
              </div>
            </div>
          </>
        )}
        </>}
        </div>
      </div>

      {/* Mobile: the same content, in a sheet. */}
      <Sheet open={sheetOpen} onClose={() => { if (tab === 'plan') setOpenTaskRef(null); else dismissDetail() }}>
        {detail && (
          <>
            <div className="d-scroll">{detail.content}</div>
            <div className="d-bar">{detail.bar}</div>
          </>
        )}
      </Sheet>

      {addSection && (
        <TaskAdd
          section={addSection}
          // WHERE HE IS LOOKING IS WHERE THE JOB GOES. He never types the floor or the flat, because
          // he already said both by pressing "+" on the section he was reading.
          floor={plan?.focus === SITE_FLOOR || plan?.focus === BUILDING_FLOOR || plan?.focus === AMENITY_FLOOR
            ? null
            : plan?.focus ?? null}
          unit={slice?.units && currentUnit !== 'Common' ? currentUnit : null}
          onClose={() => setAddSection(null)}
          onAdd={(draft) => attempt(() => api.addTask(scope, draft), `“${draft.name.trim()}” added`)}
        />
      )}

      {moveTask && plan && (
        <TaskMove
          task={moveTask}
          tasks={plan.tasks}      /* judged against the WHOLE plan — a cross-floor gate must still bite */
          offer={planTasks}       /* offered: the floor he is looking at, not 1,500 rows */
          onClose={() => setMoveRef(null)}
          onMove={(targetRef) => onDrop(moveTask.ref, targetRef)}
        />
      )}

      {deleteTask && (
        <TaskDelete
          task={deleteTask} allTasks={allTasks} problems={api.problems}
          onClose={() => setDeleteRef(null)}
          onDelete={async () => {
            // The open card must not survive the task it was showing.
            if (openTaskRef === deleteTask.ref) setOpenTaskRef(null)
            await attempt(() => api.deleteTask(scope, deleteTask.ref), `${deleteTask.ref} deleted`)
          }}
        />
      )}

      <UndoToast toast={toast} onDone={() => setToast(null)} />
    </div>
  )
}
