// SITE DESK — the Problems view: ProblemRow, ProblemList, PendingView, PlacementCard.
//
// THE THREE SEGMENTS ARE A LIFECYCLE, left to right: Pending · Open · Sorted.
//   Pending = caught from WhatsApp, no home yet (siteops_unplaced)
//   Open    = live, with a home
//   Sorted  = closed, with its reason and photos intact
// Default is Open — the middle, because that is where the work is.

import { useEffect, useRef, useState } from 'react'
import type { DeskPending, DeskProblem, ProblemKind } from '../../lib/desk/types'
import { isOldAge } from '../../lib/desk/derive'
import { useSwipe } from './useDesk'
import { Btn } from './Btn'
import { Seg } from './Seg'
import { Medallion } from './Medallion'
import { problemTone } from '../../lib/desk/medTone'

export type Segment = 'pending' | 'open' | 'sorted'
export type SortBy = 'severe' | 'new'
export type KindFilter = 'all' | ProblemKind

/* ---------- ProblemRow ---------- */
export function ProblemRow({
  item, selected, closing, reopening, isTouch, onOpen, onSwipeClose,
}: {
  item: DeskProblem
  selected: boolean
  closing: boolean
  reopening: boolean
  isTouch: boolean
  onOpen: () => void
  onSwipeClose: () => void
}) {
  const swipeable = item.state !== 'resolved'
  const { ref, swiping, consumedTap, handlers } = useSwipe<HTMLButtonElement>(isTouch && swipeable)

  const hasPhoto = !!item.photos?.length

  return (
    <div
      className={`rowwrap ${swiping ? 'swiping' : ''} ${closing ? 'closing' : ''} ${reopening ? 'opening' : ''}`}
      data-id={item.id}
    >
      {swipeable && (
        <div className="row-under">
          <button onClick={(e) => { e.stopPropagation(); onSwipeClose() }}>✓ Close</button>
        </div>
      )}

      <button
        ref={ref}
        className={`row ${selected ? 'sel' : ''}`}
        {...handlers}
        onClick={() => { if (!consumedTap()) onOpen() }}
      >
        {/* WHO HAS THE BALL — read the left column alone and you know the shape of the list. */}
        <span className="r-med"><Medallion tone={problemTone(item.state)} /></span>

        {/* THE PROBLEM IS THE HEADER. The ref leads the subtext — findable, not shouting. */}
        <div className="row-body">
          <div className="headline">{item.title}</div>
          <div className="meta">
            <span className="ref">{item.ref}</span>
            {' · '}
            {[
              item.kind === 'snag' ? 'Snag' : 'Issue',
              item.kind === 'snag' ? (item.loc ?? 'Project-wide') : item.tag,
            ].filter(Boolean).join(' · ')}
          </div>
        </div>

        {/* ONE FACT: how long this has been sitting there. The full sentence ("Jaggu silent 4 days,
            two chases done") is a READING matter — it lives in the detail, where he has asked for
            it by opening the thing. The row is for scanning. */}
        <div className="r-right">
          {hasPhoto
            ? <span className="cam" title="has a photo">📷</span>
            : item.photoPending ? <span className="cam" title="photo pending — Briklay is asking">📷…</span> : null}
          <span className={`age ${isOldAge(item) ? 'old' : ''}`} title={item.status}>
            {item.days === 0 ? 'today' : `${item.days}d`}
          </span>
        </div>
      </button>
    </div>
  )
}

/* ---------- ProblemList ---------- */
export function ProblemList({
  items, segment, sortBy, openId, closingId, reopeningId, isTouch, siteName, kindF,
  onOpen, onSwipeClose,
}: {
  items: DeskProblem[]
  segment: Segment
  sortBy: SortBy
  openId: string | null
  closingId: string | null
  reopeningId: string | null
  isTouch: boolean
  siteName: string | null
  kindF: KindFilter
  onOpen: (id: string) => void
  onSwipeClose: (id: string) => void
}) {
  const head = segment === 'sorted'
    ? 'Recently sorted — every closed item keeps its reason and photos'
    : sortBy === 'severe'
      ? 'Yours first — red needs you, grey is with Briklay'
      : 'Latest first — red needs you, grey is with Briklay'

  return (
    <div className="list">
      <div className="list-head">{head}</div>
      {items.length === 0 ? (
        <div className="empty">
          <b>Nothing here</b>
          No {kindF === 'all' ? 'items' : `${kindF}s`}{' '}
          {siteName ? `at ${siteName}` : segment === 'sorted' ? 'sorted yet' : 'open'}.
        </div>
      ) : (
        items.map((i) => (
          <ProblemRow
            key={i.id}
            item={i}
            selected={i.id === openId}
            closing={i.id === closingId}
            reopening={i.id === reopeningId}
            isTouch={isTouch}
            onOpen={() => onOpen(i.id)}
            onSwipeClose={() => onSwipeClose(i.id)}
          />
        ))
      )}
    </div>
  )
}

/* ---------- PlacementCard — the Pending segment's row ----------
 * No prototype reference existed for this (the ledger creates it), so it is built in v30's
 * grammar: same padding, same headline weight, same meta line. It carries what the old
 * "to place" queue carried — the capture, who sent it, and whether we asked a question that
 * never got answered (QUESTION INTERRUPTED). */
export function PlacementCard({
  item, onPlace, onDismiss,
}: {
  item: DeskPending
  onPlace: () => void | Promise<unknown>
  onDismiss: () => void | Promise<unknown>
}) {
  return (
    <div className="pcard">
      <span className="ref">{item.photo ? '📷' : '💬'}</span>
      <div className="pcard-body">
        <div className="pcard-text">{item.text}</div>
        <div className="pcard-meta">
          {item.sender} · {item.senderNumber} · {item.when}
          {item.site ? ` · looks like ${item.site}` : ' · site unknown'}
        </div>
        {item.interrupted && (
          <span className="chip-interrupted">Question interrupted — he never answered</span>
        )}
        <div className="pcard-acts">
          <Btn variant="bare" className="place" successLabel="Placed" onClick={onPlace}>Place</Btn>
          <Btn variant="bare" className="dismiss" successLabel="Gone" onClick={onDismiss}>Dismiss</Btn>
        </div>
      </div>
    </div>
  )
}

export function PendingView({
  items, onPlace, onDismiss,
}: {
  items: DeskPending[]
  onPlace: (id: string) => void | Promise<unknown>
  onDismiss: (id: string) => void | Promise<unknown>
}) {
  return (
    <div className="list">
      <div className="list-head">Caught from WhatsApp — waiting for a home.</div>
      {items.length === 0 ? (
        <div className="empty"><b>Nothing waiting</b>Every capture has found a home.</div>
      ) : (
        items.map((p) => (
          <PlacementCard key={p.id} item={p} onPlace={() => onPlace(p.id)} onDismiss={() => onDismiss(p.id)} />
        ))
      )}
    </div>
  )
}

/* ---------- The segment + sort/filter controls ----------
 * Severity sort and the kind filter HIDE in Pending: an unplaced capture has no kind and no
 * severity yet — that is precisely what makes it pending. Chronological only. */
export function ProblemControls({
  segment, setSegment, sortBy, setSort, kindF, setKind, pendingCount,
}: {
  segment: Segment
  setSegment: (s: Segment) => void
  sortBy: SortBy
  setSort: (s: SortBy) => void
  kindF: KindFilter
  setKind: (k: KindFilter) => void
  pendingCount: number
}) {
  const [menu, setMenu] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const away = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setMenu(false) }
    document.addEventListener('click', away)
    return () => document.removeEventListener('click', away)
  }, [menu])

  const label = [sortBy === 'severe' ? 'Urgent' : 'Newest', kindF !== 'all' ? (kindF === 'issue' ? 'Issues' : 'Snags') : null]
    .filter(Boolean).join(' · ')

  return (
    <div className="controls" style={{ paddingTop: 16 }}>
      <div className="ctl-row">
        {/* The lifecycle, left to right — and the thumb glides between them. */}
        <Seg<Segment>
          ariaLabel="Item lifecycle"
          value={segment}
          onChange={setSegment}
          options={[
            { value: 'pending', label: 'Pending', count: pendingCount },
            { value: 'open', label: 'Open' },
            { value: 'sorted', label: 'Sorted' },
          ]}
        />
        <div className="spacer" />

        {segment !== 'pending' && (
          <div className="menuwrap" ref={wrap}>
            <button className="iconbtn" onClick={(e) => { e.stopPropagation(); setMenu((m) => !m) }} aria-label="Sort and filter">
              <span>{label}</span>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              </svg>
            </button>
            {menu && (
              <div className="menu">
                {segment === 'open' && (
                  <>
                    <div className="menu-label">Sort</div>
                    <button className={sortBy === 'severe' ? 'on' : ''} onClick={() => setSort('severe')}>Most urgent first</button>
                    <button className={sortBy === 'new' ? 'on' : ''} onClick={() => setSort('new')}>Newest first</button>
                    <div className="menu-sep" />
                  </>
                )}
                <div className="menu-label">Show</div>
                <button className={kindF === 'all' ? 'on' : ''} onClick={() => setKind('all')}>Everything</button>
                <button className={kindF === 'issue' ? 'on' : ''} onClick={() => setKind('issue')}>Only issues</button>
                <button className={kindF === 'snag' ? 'on' : ''} onClick={() => setKind('snag')}>Only snags</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
