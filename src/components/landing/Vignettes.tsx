/**
 * The four #magic vignette cards (verbatim from docs/reference/BriklayLanding.jsx).
 * Each runs a self-contained CSS keyframe loop; gating/pausing is handled by the
 * parent <Gate>. The reference's rail fill referenced an undefined V.userSoft —
 * per ruling it renders as V.inkSoft (#3D3830); no duplicate token added.
 */
import type { CSSProperties } from 'react';
import { Check, ArrowRight, Truck, FileText, Camera, ArrowUpRight } from 'lucide-react';
import { V, SEG, font, serif, nums } from './landingTokens';
import { AppWin, Bloom } from './AppShell';

export function VignetteCapture() {
  return (
    <div className="vcard rounded-2xl p-5 sm:p-6" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
      <Bloom />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: V.field, color: V.sys, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', ...font }}>
          <b style={{ color: V.terraDeep }}>01</b> Create order
        </span>
        {/* synced stepper — the map for the loop */}
        <div className="flex items-center gap-2 flex-wrap" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', ...font }}>
          <span className="lab1" style={{ color: V.faint }}>Said</span>
          <span style={{ color: V.line }}>→</span>
          <span className="lab2" style={{ color: V.faint }}>Approved</span>
          <span style={{ color: V.line }}>→</span>
          <span className="lab3" style={{ color: V.faint }}>Quoted</span>
          <span style={{ color: V.line }}>→</span>
          <span className="lab4" style={{ color: V.faint }}>Awarded</span>
        </div>
      </div>
      <div className="mt-3" style={{ position: 'relative' }}>
      <AppWin title="New purchase order">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs font-medium uppercase" style={{ color: V.terraDeep, letterSpacing: '0.1em', ...font }}>
          Say it. It's filed.
        </span>
      </div>

      <div className="relative" style={{ minHeight: 136 }}>

        {/* phases 1+2 — one scene: typed words resolve into the SKU, in place */}
        <div className="loop-ph12 absolute inset-0">
          <div className="relative" style={{ height: 32 }}>
            {/* the raw words, typed live, dissolve out */}
            <div className="rawT absolute inset-x-0 top-0">
              <p className="text-lg font-medium" style={{ color: V.ink, ...font }}>
                <span className="typeT">kankara 2 lorry</span><span className="blinkc" style={{ color: V.terra }}>|</span>
              </p>
            </div>
            {/* the SKU sharpens in, same position */}
            <div className="skuT absolute inset-x-0 top-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="pillpop inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ background: V.field, color: V.inkSoft, ...font }}>
                  <Check size={11} strokeWidth={3} /> linked
                </span>
                <p className="text-sm font-medium flex-1" style={{ color: V.ink, ...font }}>Coarse aggregate · 20mm</p>
                <p className="text-sm" style={{ color: V.sys, ...font, ...nums }}>2 lorry → 14 MT</p>
              </div>
            </div>
          </div>
          <div className="relative mt-3" style={{ minHeight: 64 }}>
            {/* the question occupies the slot, then leaves */}
            <div className="askT absolute inset-x-0 top-0">
              <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl" style={{ background: V.askWash, border: `1px solid ${V.askLine}` }}>
                <p className="text-sm" style={{ color: '#6B4407', ...font }}>
                  Found coarse aggregate. Which size? <b className="chip20">20mm</b> · 12mm · 40mm
                </p>
              </div>
            </div>
            {/* approval arrives quietly, then the next action presents itself */}
            <div className="apprT absolute inset-x-0 top-0">
              <p className="text-xs" style={{ color: V.faint, ...font, ...nums }}>
                ✓ approved by you · 14:32
              </p>
              <button
                className="btnQ mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium px-3.5 py-2 rounded-lg"
                style={{ background: V.surface, border: `1px solid ${V.line}`, color: V.ink, ...font, pointerEvents: 'none' }}
                tabIndex={-1}
                aria-hidden="true"
              >
                Get quotes · 3 vendors <ArrowRight size={12} />
              </button>
            </div>
          </div>
        </div>

        {/* phase 3 — quotes */}
        <div className="loop-ph3 absolute inset-0">
          <p className="text-xs mb-2" style={{ color: V.sys, ...font }}>
            Quotes requested · your 3 aggregate vendors
          </p>
          <div className="space-y-1.5">
            <div className="vSel flex items-center justify-between rounded-lg px-3 py-1.5" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
              <span className="text-xs font-medium" style={{ color: V.ink, ...font }}>Sri Surya Lorry Transport</span>
              <span className="text-xs font-medium" style={{ color: V.ink, ...font, ...nums }}>₹30,400 <span style={{ color: V.terraDeep }}>· best price</span></span>
            </div>
            <div className="flex items-center justify-between rounded-lg px-3 py-1.5" style={{ background: V.field }}>
              <span className="text-xs" style={{ color: V.sys, ...font }}>Godavari Aggregates</span>
              <span className="text-xs" style={{ color: V.sys, ...font, ...nums }}>₹31,850</span>
            </div>
            <div className="flex items-center justify-between rounded-lg px-3 py-1.5" style={{ background: V.field }}>
              <span className="text-xs" style={{ color: V.sys, ...font }}>Coastal Sands</span>
              <span className="text-xs" style={{ color: V.sys, ...font, ...nums }}>₹32,100</span>
            </div>
          </div>
          <p className="text-xs mt-2" style={{ color: V.faint, ...font }}>
            checked against what you last paid. No quiet rate creep
          </p>
        </div>

        {/* phase 4 — awarded */}
        <div className="loop-ph4 absolute inset-0">
          <div className="rounded-xl px-4 py-3" style={{ background: V.sageWash }}>
            <p className="text-sm font-medium" style={{ color: V.sage, ...font, ...nums }}>
              PO-0152 awarded · Sri Surya Lorry Transport · ₹30,400
            </p>
            <p className="text-xs mt-1" style={{ color: V.sage, ...font }}>
              vendor notified · order open for goods receival
            </p>
          </div>
          <p className="text-xs mt-2.5" style={{ color: V.faint, ...font }}>
            One typed line became an approved order, at the best price
          </p>
        </div>

      </div>
      </AppWin>
      </div>
    </div>
  );
}

export function VignettePO() {
  return (
    <div className="vcard rounded-2xl p-5" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full mb-3" style={{ background: V.field, color: V.sys, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', ...font }}>
        <b style={{ color: V.terraDeep }}>02</b> Track order
      </span>
      <Bloom />
      <AppWin title="Purchase orders">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium" style={{ color: V.ink, ...font }}>Sri Surya Lorry Transport</p>
          <p className="text-xs" style={{ color: V.sys, ...font }}>PO-0152 · coarse aggregate 20mm · 14 MT</p>
        </div>
        <p className="text-sm font-medium" style={{ color: V.ink, ...font, ...nums }}>₹30,400</p>
      </div>
      <div className="flex gap-1 my-3.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex-1 rounded-full overflow-hidden" style={{ height: 4, background: V.line }}>
            <div className="h-full rounded-full loop-rail" style={{ background: V.inkSoft, animationDelay: `${i * 1.1}s` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap">
        {[
          { Icon: Truck, label: 'Goods received', d: '1.1s' },
          { Icon: FileText, label: 'Bill entered', d: '2.2s' },
          { Icon: Camera, label: 'Photo on file', d: '3.3s' },
        ].map(({ label, d }) => (
          <span
            key={label}
            className="loop-chip inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
            style={{ background: V.field, color: V.inkSoft, animationDelay: d, ...font }}
          >
            <Check size={11} strokeWidth={3} /> {label}
          </span>
        ))}
      </div>
      </AppWin>
      <p className="text-xs mt-3" style={{ color: V.faint, ...font }}>
        the order knows its own next step
      </p>
    </div>
  );
}

export function VignetteWO() {
  const widths = [36, 28, 36];
  return (
    <div className="vcard rounded-2xl p-5" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full mb-3" style={{ background: V.field, color: V.sys, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', ...font }}>
        <b style={{ color: V.terraDeep }}>04</b> Assign &amp; track work
      </span>
      <Bloom />
      <AppWin title="New work order">
      <p className="text-sm leading-relaxed" style={{ color: V.inkSoft, ...serif }}>
        Hiring <b>Harish K</b> for <b>The Pride</b>, worth{' '}
        <b style={nums}>₹5,00,000</b>, paid in <b>3 stages</b>.
      </p>
      <div className="relative flex h-3 rounded-full overflow-hidden mt-4" style={{ background: V.askWash }}>
        {widths.map((w, i) => (
          <div key={i} className="h-full loop-alloc" style={{ '--w': `${w}%`, background: SEG[i], animationDelay: `${i * 0.9}s` } as CSSProperties} />
        ))}
        <div className="absolute inset-0 loop-amber" style={{ background: 'transparent', border: `1px solid ${V.askLine}`, borderRadius: 999 }} />
      </div>
      <div className="relative mt-2" style={{ height: 18 }}>
        <p className="absolute inset-0 text-xs loop-amber" style={{ color: V.ask, ...font, ...nums }}>
          ₹1,80,000 not yet staged…
        </p>
        <p className="absolute inset-0 text-xs loop-caption" style={{ color: V.sage, ...font, ...nums }}>
          the full ₹5,00,000 is allocated. Reconciled
        </p>
      </div>
      <div className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 mt-3" style={{ background: V.field }}>
        <p className="text-xs" style={{ color: V.inkSoft, ...font, ...nums }}>✓ stage 1 paid · ₹1,80,000</p>
        <p className="text-xs" style={{ color: V.sys, ...font, ...nums }}>stage 2 due 5 Jul</p>
      </div>
      </AppWin>
      <p className="text-xs mt-3" style={{ color: V.faint, ...font }}>
        work is paid stage by stage, against the order. No loose payments
      </p>
    </div>
  );
}

export function VignetteTxn() {
  return (
    <div className="vcard rounded-2xl p-5" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full mb-3" style={{ background: V.field, color: V.sys, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', ...font }}>
        <b style={{ color: V.terraDeep }}>03</b> Pay against it
      </span>
      <Bloom />
      <AppWin title="New payment">
      <div className="relative" style={{ minHeight: 150 }}>

        {/* phase 1 — you say the payment */}
        <div className="loop-txnA absolute inset-0">
          <p className="text-xs mb-2" style={{ color: V.faint, ...font }}>you said</p>
          <p className="text-base font-medium" style={{ color: V.ink, ...font }}>
            paid 14,000 to Sri Surya<span style={{ color: V.terra }}>|</span>
          </p>
          <p className="text-xs mt-3 inline-flex items-center gap-1.5" style={{ color: V.sys, ...font }}>
            <ArrowUpRight size={12} color={V.terraDeep} /> money out · finding its order…
          </p>
        </div>

        {/* phase 2 — matched to THE order, balance updated, guard stated */}
        <div className="loop-txnB absolute inset-0">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: V.terraWash }}>
              <ArrowUpRight size={13} color={V.terraDeep} />
            </span>
            <p className="text-xs flex-1" style={{ color: V.inkSoft, ...font }}>
              Sri Surya · <b>against PO-0152</b>
            </p>
            <p className="text-sm font-medium" style={{ color: V.terraDeep, ...font, ...nums }}>− ₹14,000</p>
          </div>
          <div className="rounded-xl px-3 py-2.5 mt-3" style={{ background: V.field }}>
            <p className="text-xs" style={{ color: V.sage, ...font, ...nums }}>
              ✓ matched to your open order with this vendor
            </p>
            <p className="text-xs mt-1" style={{ color: V.inkSoft, ...font, ...nums }}>
              PO-0152: ₹14,000 paid · ₹16,400 remaining
            </p>
          </div>
          <p className="text-xs mt-2.5" style={{ color: V.faint, ...font }}>
            a payment above the order's balance gets flagged, not filed
          </p>
        </div>

      </div>
      </AppWin>
    </div>
  );
}
