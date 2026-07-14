/**
 * SITE DESK — THE SHAPE OF THE PAGE, BEFORE THE PAGE.
 *
 * The desk used to show NOTHING while it loaded — a blank workspace, then everything at once. And it is
 * a big read (every project, problem, task, QC row, narration, and a signed URL minted per photo), so
 * "nothing" was a second or two of a page that looked broken, followed by a bang.
 *
 * A skeleton is not a loading indicator. A spinner says "wait"; a skeleton says "HERE is what is
 * coming, and here is where it will be" — so the eye has already found the list, the rail and the
 * detail card before there is anything in them, and when the data lands nothing jumps. That only works
 * if the bones are the RIGHT bones: the same columns, the same row height, the same medallion in the
 * same place. A grey box that resolves into a different shape is worse than no box at all, because it
 * moves the furniture twice.
 *
 * So these are drawn from the real markup — .row, .panel, .bd-card — and share its CSS. If the row
 * changes shape, this changes with it.
 */

/* One placeholder line. `w` is a percentage — real text is ragged, and a skeleton of identical bars
 * reads as a machine, not a page. */
function Bar({ w, h = 9 }: { w: string; h?: number }) {
  return <span className="sk-bar" style={{ width: w, height: h }} />
}

/** A row: the medallion, the two lines of text, and the one fact on the right. */
function SkRow({ seed }: { seed: number }) {
  // deterministic ragged widths — a list where every headline is the same length looks like a grid
  const head = [62, 48, 74, 55, 68, 43][seed % 6]
  const meta = [38, 46, 30, 42, 34, 50][seed % 6]
  return (
    <div className="row sk-row">
      <span className="r-med"><span className="sk-med" /></span>
      <div className="row-body">
        <Bar w={`${head}%`} h={11} />
        <div style={{ marginTop: 7 }}><Bar w={`${meta}%`} h={8} /></div>
      </div>
      <div className="r-right"><Bar w="26px" h={8} /></div>
    </div>
  )
}

/** The list card — the same white card the rows really live in. */
export function SkeletonList({ rows = 6, head = true }: { rows?: number; head?: boolean }) {
  return (
    <div className="list">
      {head && <div className="list-head"><Bar w="180px" h={8} /></div>}
      {Array.from({ length: rows }, (_, i) => <SkRow key={i} seed={i} />)}
    </div>
  )
}

/** The detail card, pinned on the right: a title, a status spine, and a paragraph of story. */
export function SkeletonPanel() {
  return (
    <aside className="panel sk-panel" aria-hidden="true">
      <div className="d-scroll" style={{ padding: 20 }}>
        <Bar w="34%" h={8} />
        <div style={{ marginTop: 14 }}><Bar w="78%" h={17} /></div>
        <div style={{ marginTop: 22 }}><Bar w="100%" h={34} /></div>
        <div style={{ marginTop: 22 }}><Bar w="46%" h={8} /></div>
        <div style={{ marginTop: 12 }}><Bar w="92%" h={9} /></div>
        <div style={{ marginTop: 9 }}><Bar w="84%" h={9} /></div>
        <div style={{ marginTop: 9 }}><Bar w="61%" h={9} /></div>
        <div style={{ marginTop: 24 }}><Bar w="100%" h={64} /></div>
      </div>
    </aside>
  )
}

/** The building rail — the floors, stacked, as they will be. */
function SkeletonBuilding() {
  return (
    <div className="building" aria-hidden="true">
      <div className="col-cap"><Bar w="70px" h={7} /></div>
      <div className="bd-card" style={{ padding: 10 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} style={{ padding: '11px 8px' }}>
            <Bar w={`${[70, 55, 82, 60, 74, 50][i]}%`} h={9} />
            <div style={{ marginTop: 8 }}><Bar w="100%" h={5} /></div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * THE WHOLE WORKSPACE, in the shape it is about to take. The plan is three columns (the building, the
 * work, the task); the problems tab is two (the list, the item). Each gets its own bones, because a
 * skeleton that guesses wrong is furniture that moves twice.
 */
export function DeskSkeleton({ tab }: { tab: 'problems' | 'plan' }) {
  if (tab === 'plan') {
    return (
      <div className="workspace plan-workspace sk" aria-busy="true">
        <SkeletonBuilding />
        <div className="plan-col">
          <div className="col-cap"><Bar w="140px" h={7} /></div>
          <SkeletonList rows={7} />
        </div>
        <div className="panel-col">
          <div className="pin">
            <div className="col-cap"><Bar w="90px" h={7} /></div>
            <SkeletonPanel />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="workspace sk" aria-busy="true">
      <div><SkeletonList rows={6} head={false} /></div>
      <div className="pin"><SkeletonPanel /></div>
    </div>
  )
}
