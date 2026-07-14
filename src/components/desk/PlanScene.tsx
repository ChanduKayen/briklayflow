// PLAN SETUP — THE SCENE. One SVG, every coordinate owned.
//
// A PORT, NOT A REINTERPRETATION. The geometry, the eases, the durations and the stagger are the
// reference's (plan-setup-v6.html), to the decimal and to the millisecond — including the things
// that look like details and are not: the callout lanes that elbow DOWN through the ground band so a
// leader line never crosses another, the label clamp that pulls a long word back inside
// the frame, and the fact that the tower LIFTS when a stilt appears rather than being redrawn.
//
// WHY IT IS IMPERATIVE INSIDE A REACT COMPONENT: this is one continuously-animated object, not a
// tree of elements with props. Re-rendering the SVG on every keystroke would kill every tween in
// flight — the floor that is still rising would snap to its mark. So React owns the INPUTS, and the
// scene owns its own DOM: it is built once, and each change is a tween from where things actually
// are to where they now belong. That is what makes it feel like a building being built rather than a
// picture being replaced.

import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import type { Parking } from '../../lib/desk/planRules'

export interface SceneHandle {
  /** the plan is born: the building lights up from the ground */
  celebrate: () => void
}

export function PlanScene({
  floors, units, park, has, onReady,
}: {
  floors: number
  units: number
  park: Parking
  /** is this system drawn? (the same isOn the readback uses — one truth, two views) */
  has: (name: string) => boolean
  onReady?: (h: SceneHandle) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const capRef = useRef<HTMLDivElement>(null)

  // The scene's own state, deliberately OUTSIDE React: it must survive re-renders untouched.
  const api = useRef<{
    sync: (f: number, u: number, p: Parking, has: (n: string) => boolean) => void
    celebrate: () => void
  } | null>(null)

  useEffect(() => {
    const svg = svgRef.current
    const cap = capRef.current
    if (!svg || !cap) return

    const reduced = window.matchMedia('(prefers-reduced-motion:reduce)').matches
    const D = (x: number) => (reduced ? 0 : x)
    const NS = 'http://www.w3.org/2000/svg'
    const mk = (t: string, at: Record<string, string | number> = {}, parent?: Element) => {
      const e = document.createElementNS(NS, t)
      for (const k in at) e.setAttribute(k, String(at[k]))
      ;(parent ?? svg).appendChild(e)
      return e as SVGElement
    }

    // live inputs — the scene reads these, React writes them through sync()
    let floorsN = floors, unitsN = units, parkN = park
    let hasFn = has

    /* geometry: the single source of truth */
    const W = 340, GY = 236                       // ground line y
    const CX = W / 2, BW = 120, BX = CX - BW / 2  // building
    const GAP = 3
    const FH = () => (floorsN <= 5 ? 24 : floorsN <= 7 ? 20 : 17)
    const stiltH = () => (parkN === 'stilt' ? 22 : 0)
    const floorY = (i: number) => GY - stiltH() - (i + 1) * FH() - i * GAP   // top of floor i
    const topY = () => floorY(floorsN - 1)
    const SHAFT = { x: BX + 10, w: 14 }

    /* paper + ground (static) */
    const gGround = mk('g')
    mk('line', { x1: CX - 114, y1: GY, x2: CX + 114, y2: GY, stroke: '#a29a91', 'stroke-width': 2, 'stroke-linecap': 'round', opacity: .55 }, gGround)
    for (let x = CX - 108; x <= CX + 102; x += 8) {
      const fade = 1 - Math.abs(x - CX) / 120
      mk('line', { x1: x, y1: GY + 3, x2: x + 6, y2: GY + 9, stroke: '#a29a91', 'stroke-width': 1, opacity: (.38 * Math.max(.15, fade)).toFixed(2) }, gGround)
    }

    /* layers (order = z) */
    const gCellar = mk('g', { opacity: 0 })
    const gStilt = mk('g', { opacity: 0 })
    const gFloors = mk('g')
    const gShaft = mk('g', { opacity: 0 })
    const gRoof = mk('g')
    const gDecor = mk('g')
    const gNotes = mk('g')

    /* cellar: a dashed volume BELOW the ground */
    mk('rect', { x: BX + 8, y: GY + 3, width: BW - 16, height: 17, rx: 4, fill: '#f4f3f0', stroke: '#a29a91', 'stroke-width': 1.4, 'stroke-dasharray': '4 3', opacity: .75 }, gCellar)

    /* stilt: pillars standing ON the ground, under the first slab */
    const pillars = [0, 1, 2, 3].map((i) =>
      mk('rect', { x: BX + 14 + i * ((BW - 32) / 3), y: GY - 22, width: 4, height: 22, rx: 1.5, fill: '#a29a91', opacity: .55 }, gStilt))

    /* THE COMPOUND WALL IS NOT DRAWN.
     *
     * It ran the full width of the frame at ground level — precisely the band every ground-level
     * callout (STILT, CELLAR, DG SET) has to cross to reach its label. Its own "COMPOUND WALL" leader
     * then had to thread the same band, and on a small frame the lines and the words collided. The
     * wall is the least informative thing in the drawing anyway: EVERY building gets one (it is in the
     * rules' base set), so drawing it tells you nothing you did not already know, while costing the
     * scene the one lane its useful labels need.
     *
     * It is still BUILT — the system stays in the readback, in the popover, and in the generated task
     * set. It is only the picture that stops saying it. */

    /* decor in exclusive slots: greens left of the building, DG right of it — clear of the footprint */
    const gGreens = mk('g', { opacity: 0 }, gDecor)
    mk('circle', { cx: CX - 76, cy: GY - 5, r: 4.5, fill: '#3c6e53', opacity: .5 }, gGreens)
    mk('circle', { cx: CX - 68, cy: GY - 4, r: 3, fill: '#3c6e53', opacity: .5 }, gGreens)
    const gDG = mk('g', { opacity: 0 }, gDecor)
    mk('rect', { x: CX + 64, y: GY - 12, width: 17, height: 12, rx: 2.5, fill: '#f4f3f0', stroke: '#a29a91', 'stroke-width': 1.4 }, gDG)
    mk('line', { x1: CX + 67, y1: GY - 9, x2: CX + 78, y2: GY - 9, stroke: '#a29a91', 'stroke-width': 1.2, opacity: .7 }, gDG)
    mk('line', { x1: CX + 67, y1: GY - 6, x2: CX + 78, y2: GY - 6, stroke: '#a29a91', 'stroke-width': 1.2, opacity: .7 }, gDG)

    /* shaft: inside the building, over the slabs */
    const shaftRect = mk('rect', { x: SHAFT.x, y: 0, width: SHAFT.w, height: 0, rx: 2.5, fill: 'rgba(255,255,255,.6)', stroke: '#a29a91', 'stroke-width': 1.3, 'stroke-dasharray': '3 2.5' }, gShaft)
    const shaftCab = mk('rect', { x: SHAFT.x + 3, y: 0, width: SHAFT.w - 6, height: 6, rx: 1.5, fill: '#a29a91', opacity: .55 }, gShaft)

    /* roof furniture: tank (right) + solar (left) — positioned as groups */
    const gTank = mk('g', { opacity: 0 }, gRoof)
    mk('path', { d: 'M0 4 v8 c0 2.2 3.8 3.6 8.5 3.6 s8.5 -1.4 8.5 -3.6 v-8', fill: '#efece7', stroke: '#a29a91', 'stroke-width': 1.3 }, gTank)
    mk('ellipse', { cx: 8.5, cy: 4, rx: 8.5, ry: 2.8, fill: '#e7e4df', stroke: '#a29a91', 'stroke-width': 1.3 }, gTank)
    mk('line', { x1: 3.5, y1: 15.4, x2: 3.5, y2: 20, stroke: '#a29a91', 'stroke-width': 1.3 }, gTank)
    mk('line', { x1: 13.5, y1: 15.4, x2: 13.5, y2: 20, stroke: '#a29a91', 'stroke-width': 1.3 }, gTank)
    const gSolar = mk('g', { opacity: 0 }, gRoof)
    ;[0, 1, 2].forEach((i) => mk('rect', { x: i * 9, y: 0, width: 7, height: 12, rx: 1.5, fill: '#bcc8d6', transform: 'skewX(-14)' }, gSolar))

    /* floors */
    interface FloorEl { g: SVGElement; r: SVGElement; dots: SVGElement }
    let floorEls: FloorEl[] = []

    function makeFloor(i: number): FloorEl {
      const g = mk('g', {}, gFloors)
      const r = mk('rect', { x: BX, y: 0, width: BW, height: FH(), rx: 5, fill: '#f4f3f0', stroke: '#eceae6', 'stroke-width': 1 }, g)
      const dots = mk('g', {}, g)
      gsap.set(g, { y: floorY(i) })
      return { g, r, dots }
    }

    function dotsFor(f: FloorEl) {
      f.dots.innerHTML = ''
      const lift = shown.lift
      const x0 = lift ? SHAFT.x + SHAFT.w + 8 : BX + 10
      const x1 = BX + BW - 10
      const cy = FH() / 2
      const n = unitsN
      for (let k = 0; k < n; k++) {
        const cx = n === 1 ? (x0 + x1) / 2 : x0 + (x1 - x0) * (k + .5) / n
        mk('rect', { x: cx - 3, y: cy - 3, width: 6, height: 6, rx: 2, fill: '#a29a91', opacity: .55 }, f.dots)
      }
    }

    /* what's currently drawn */
    const shown: Record<string, boolean> = {
      lift: false, tank: false, solar: false, greens: false, dg: false, stilt: false, cellar: false,
    }

    /* callout definitions: exact anchors from geometry.
       lane: ground items are labeled BELOW the ground line, in their own clear band */
    interface Anchor { x: number; y: number; side: 'left' | 'right'; lane?: number }
    const anchors: Record<string, () => Anchor> = {
      tank: () => ({ x: CX + BW / 2 - 6, y: topY() - 12, side: 'right' }),
      solar: () => ({ x: BX + 8, y: topY() - 8, side: 'left' }),
      lift: () => ({ x: SHAFT.x - 2, y: topY() + FH() * .7, side: 'left' }),
      stilt: () => ({ x: BX + 16, y: GY - 3, side: 'left', lane: GY + 18 }),
      cellar: () => ({ x: BX + 6, y: GY + 12, side: 'left' }),
      dg: () => ({ x: CX + 72, y: GY - 1, side: 'right', lane: GY + 18 }),
      homes: () => ({ x: BX + BW + 2, y: topY() + FH() / 2, side: 'right' }),
    }
    const labels: Record<string, string | (() => string)> = {
      tank: 'TANK', solar: 'SOLAR', lift: 'LIFT', stilt: 'STILT',
      cellar: 'CELLAR', dg: 'DG SET',
      homes: () => (unitsN === 1 ? '1 HOME' : `${unitsN} HOMES`) + ' / FLOOR',
    }

    let noteTimer: ReturnType<typeof setTimeout> | undefined
    function drawNotes() {
      clearTimeout(noteTimer)
      noteTimer = setTimeout(() => {
        gNotes.innerHTML = ''
        const keys = ['tank', 'solar', 'lift', 'stilt', 'cellar', 'dg', 'homes']
          .filter((k) => (k === 'homes' ? floorsN > 0 : shown[k]))

        const items = keys.map((k) => {
          const a = anchors[k]()
          const label = typeof labels[k] === 'function' ? (labels[k] as () => string)() : (labels[k] as string)
          return { k, ...a, label, ly: a.lane != null ? a.lane : a.y }
        })

        // two lanes, and nothing in a lane may collide with its neighbour
        ;(['left', 'right'] as const).forEach((side) => {
          const list = items.filter((i) => i.side === side).sort((a, b) => a.ly - b.ly)
          for (let j = 1; j < list.length; j++) if (list[j].ly - list[j - 1].ly < 15) list[j].ly = list[j - 1].ly + 15
        })

        items.forEach((i) => {
          const gx = i.side === 'left' ? 66 : W - 66
          const g = mk('g', { opacity: 0 }, gNotes)
          mk('circle', { cx: i.x, cy: i.y, r: 2, fill: '#a29a91', opacity: .75 }, g)
          // lane items elbow DOWN first, then out — never across the ground band
          const pts = i.lane != null
            ? `${i.x},${i.y} ${i.x},${i.ly} ${gx},${i.ly} ${gx + (i.side === 'left' ? -3 : 3)},${i.ly}`
            : `${i.x},${i.y} ${gx},${i.y} ${gx},${i.ly} ${gx + (i.side === 'left' ? -3 : 3)},${i.ly}`
          const pl = mk('polyline', { points: pts, fill: 'none', stroke: '#a29a91', 'stroke-width': 1, opacity: .5 }, g) as SVGPolylineElement
          const t = mk('text', { x: i.side === 'left' ? 62 : W - 62, y: i.ly + 3, 'text-anchor': i.side === 'left' ? 'end' : 'start' }, g) as SVGTextElement
          t.textContent = i.label
          // clamp: the label must live inside the frame, whatever its length
          const len = t.getComputedTextLength()
          if (i.side === 'left' && 62 - len < 4) t.setAttribute('x', String(len + 4))
          if (i.side === 'right' && (W - 62) + len > W - 4) t.setAttribute('x', String(W - 4 - len))
          const plen = pl.getTotalLength()
          pl.setAttribute('stroke-dasharray', String(plen))
          pl.setAttribute('stroke-dashoffset', String(plen))
          gsap.to(g, { opacity: 1, duration: D(.3) })
          gsap.to(pl, { strokeDashoffset: 0, duration: D(.45), ease: 'power2.out' })
        })
      }, reduced ? 0 : 340)
    }

    /* layout: everything tweens to its true position */
    function layout() {
      while (floorEls.length < floorsN) {
        const i = floorEls.length
        const f = makeFloor(i)
        floorEls.push(f)
        gsap.from(f.g, { y: floorY(i) - 20, opacity: 0, duration: D(.5), ease: 'back.out(1.5)' })
      }
      while (floorEls.length > floorsN) {
        const f = floorEls.pop()!
        gsap.to(f.g, { y: '-=14', opacity: 0, duration: D(.22), ease: 'power1.in', onComplete: () => f.g.remove() })
      }
      // heights + positions (also handles FH shrink & stilt shift)
      floorEls.forEach((f, i) => {
        f.r.setAttribute('height', String(FH()))
        gsap.to(f.g, { y: floorY(i), duration: D(.45), ease: 'power3.out' })
        dotsFor(f)
      })
      // shaft spans stilt-top (or ground) to roof
      const shTop = topY(), shBot = GY - stiltH()
      gsap.to(shaftRect, { attr: { y: shTop, height: Math.max(0, shBot - shTop) }, duration: D(.45), ease: 'power3.out' })
      gsap.to(shaftCab, { attr: { y: shTop + 3 }, duration: D(.45), ease: 'power3.out' })
      // roof furniture rides the roof
      gsap.to(gTank, { x: CX + BW / 2 - 40, y: topY() - 20, duration: D(.45), ease: 'power3.out' })
      gsap.set(gSolar, { x: BX + 18 })
      gsap.to(gSolar, { y: topY() - 13, duration: D(.45), ease: 'power3.out' })
      drawNotes()

      const total = floorsN * unitsN
      cap!.innerHTML = total === 1
        ? `<b>A single home</b> · ground${floorsN > 1 ? ' + ' + (floorsN - 1) : ''}`
        : `<b>${total} homes</b> · ${floorsN} floor${floorsN > 1 ? 's' : ''} × ${unitsN}`
    }

    function show(g: SVGElement, on: boolean, key: string, anim?: 'rise' | 'dig') {
      if (on === shown[key]) return
      shown[key] = on
      if (on) {
        if (anim === 'rise') gsap.fromTo(g, { opacity: 0, scaleY: 0, transformOrigin: '50% 100%' }, { opacity: 1, scaleY: 1, duration: D(.5), ease: 'back.out(1.4)' })
        else if (anim === 'dig') gsap.fromTo(g, { opacity: 0, scaleY: 0, transformOrigin: '50% 0%' }, { opacity: 1, scaleY: 1, duration: D(.5), ease: 'power3.out' })
        else gsap.fromTo(g, { opacity: 0, scale: .6, transformOrigin: '50% 50%' }, { opacity: 1, scale: 1, duration: D(.5), ease: 'back.out(1.6)' })
      } else {
        gsap.to(g, { opacity: 0, scale: .8, duration: D(.22), ease: 'power1.in' })
      }
    }

    function sync(f: number, u: number, p: Parking, hasNext: (n: string) => boolean) {
      floorsN = f; unitsN = u; parkN = p; hasFn = hasNext
      const h = hasFn
      show(gShaft, h('Lift'), 'lift')
      show(gTank, h('Overhead tank'), 'tank')
      show(gSolar, h('Rooftop solar'), 'solar')
      show(gGreens, h('Landscaping'), 'greens')
      show(gDG, h('DG / generator'), 'dg')
      // stilt pillars rise one by one; cellar digs downward
      const wantStilt = parkN === 'stilt', wantCellar = parkN === 'cellar'
      if (wantStilt !== shown.stilt) {
        shown.stilt = wantStilt
        if (wantStilt) {
          gsap.set(gStilt, { opacity: 1 })
          gsap.fromTo(pillars, { scaleY: 0, transformOrigin: '50% 100%' }, { scaleY: 1, duration: D(.4), ease: 'back.out(1.6)', stagger: D(.06) })
        } else gsap.to(gStilt, { opacity: 0, duration: D(.2) })
      }
      show(gCellar, wantCellar, 'cellar', 'dig')
      layout()      // stilt changes lift the whole tower
      floorEls.forEach(dotsFor)   // lift toggling changes dot centering
      drawNotes()
    }

    /** THE PLAN IS BORN. The building lights up from the ground — the one moment it goes green. */
    function celebrate() {
      floorEls.forEach((f, i) => {
        gsap.to(f.r, { attr: { fill: '#eef4f0', stroke: '#cfe0d5' }, duration: D(.4), delay: D(.12 + i * .11) })
        gsap.to(f.dots.children, { attr: { fill: '#3c6e53' }, duration: D(.4), delay: D(.12 + i * .11) })
      })
    }

    layout()
    api.current = { sync, celebrate }
    onReady?.({ celebrate })

    return () => {
      clearTimeout(noteTimer)
      gsap.killTweensOf('*')
      floorEls = []
      svg.innerHTML = ''
      api.current = null
    }
    // built ONCE. every subsequent change goes through sync() — see the note at the top of the file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // React owns the inputs; the scene owns its DOM. This is the only wire between them.
  useEffect(() => { api.current?.sync(floors, units, park, has) })

  return (
    <div className="preview">
      <svg ref={svgRef} id="scene" viewBox="0 0 340 292" aria-label="The building, drawn live" />
      <div className="bcap" ref={capRef} />
    </div>
  )
}
