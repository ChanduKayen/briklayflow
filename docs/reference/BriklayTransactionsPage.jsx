// BriklayTransactionsPage.jsx — reference design v2 (award pass)
// The thesis: this is a LEDGER, not a table. Signature: the resurrected rituals of a
// hand-kept day-book — the spine (one thread of money through the day), ruling off
// (day totals closed with the bookkeeper's double rule, set in serif), and the month
// flow bar. Entries are machine-set; totals are written. No orphan rupees, visibly.

import React, { useState } from "react";
import {
  ArrowUpRight, ArrowDownLeft, Search, Download, Paperclip, Plus, Link2, ChevronDown,
} from "lucide-react";

const V = {
  ink: "#1E1A15", inkSoft: "#3D3830", sys: "#6B6258", faint: "#9A9186",
  terra: "#BC4B27", terraDeep: "#8F3318", terraWash: "#FBEFE9",
  ask: "#8A5A0B", askWash: "#FBF3E0", askLine: "#E5C98F",
  sage: "#2F5D34", sageWash: "#E9F2E7",
  page: "#FBF9F6", surface: "#FFFFFF", field: "#F4F2EE", line: "#EAE6E0",
};
const font = { fontFamily: "'DM Sans', system-ui, sans-serif" };
const serif = { fontFamily: "Georgia, 'Times New Roman', serif" };
const nums = { fontVariantNumeric: "tabular-nums" };
const terraGrad = "linear-gradient(135deg, #C75530 0%, #A93E1F 100%)";

const DAYS = [
  {
    date: "11 Jun", weekday: "Thursday",
    rows: [
      { id: 1, dir: "out", payee: "Chandu Koppineedi", who: "Worker · Mason · ASM Elite", anchor: { kind: "WO", ref: "WO-ASME-260521-004", label: "Full payment" }, amount: "2,000", attach: true },
      { id: 2, dir: "out", payee: "Chandu Koppineedi", who: "Worker · Mason · ASM Elite", anchor: { kind: "WO", ref: "WO-ASME-260521-004", label: "Full payment" }, amount: "2,000" },
      { id: 3, dir: "out", payee: "Chandu Koppineedi", who: "Worker · Mason · ASM Elite", anchor: { kind: "WO", ref: "WO-ASME-260521-004", label: "Full payment" }, amount: "5,000", attach: true },
      { id: 4, dir: "in",  payee: "Dr Esther Soundharya", who: "Client · ASM Elite", anchor: { kind: "CLIENT", ref: "Client billing", label: "Stage 1" }, amount: "5,00,000", attach: true },
      { id: 5, dir: "out", payee: "Chandu Koppineedi", who: "Worker · Mason · ASM Elite", anchor: { kind: "WO", ref: "WO-ASME-260611-006", label: "Plastering" }, amount: "5,000" },
      { id: 6, dir: "out", payee: "Chandu Koppineedi", who: "Worker · Mason · ASM Elite", anchor: { kind: "WO", ref: "WO-ASME-260611-006", label: "Brick work" }, amount: "20,000" },
      { id: 7, dir: "out", payee: "Chandu Koppineedi", who: "Worker · Mason · ASM Elite", anchor: { kind: "WO", ref: "WO-ASME-260611-006", label: "Brick work" }, amount: "25,000", attach: true },
      { id: 8, dir: "out", payee: "Trinad", who: "Worker · Mason · Dr Shyam's Residence", anchor: null, remark: "Reason Std", amount: "555" },
      { id: 9, dir: "out", payee: "Mahendra Electricals", who: "Supplier · Electrical materials · ASM Elite", anchor: { kind: "PO", ref: "PO-ASME-260611-020", label: "Payment" }, amount: "52" },
    ],
    out: "59,607", inn: "5,00,000",
  },
];

const MONTH = {
  label: "June 2026", entries: 16, unlinked: 1,
  out: "2,09,607", inn: "5,00,000", net: "+ ₹2,90,393",
  outPct: 29.5, // of total month movement, for the flow bar
};

/* ---------- atoms ---------- */

function DirMedallion({ dir }) {
  const out = dir === "out";
  return (
    <span
      className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 relative"
      style={{
        background: out ? V.terraWash : V.sageWash,
        boxShadow: `0 0 0 3px ${V.surface}`, // ring masks the spine behind it
        zIndex: 1,
      }}
      aria-label={out ? "Money out" : "Money in"}
    >
      {out ? <ArrowUpRight size={14} color={V.terraDeep} /> : <ArrowDownLeft size={14} color={V.sage} />}
    </span>
  );
}

function Amount({ dir, value }) {
  const out = dir === "out";
  return (
    <p className="text-[15px] font-medium text-right" style={{ color: out ? V.terraDeep : V.sage, ...font, ...nums }}>
      <span className="mr-0.5" style={{ fontSize: 12 }}>{out ? "−" : "+"}</span>₹{value}
    </p>
  );
}

function AnchorChip({ anchor }) {
  if (!anchor) {
    return (
      <button
        className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md"
        style={{ background: V.askWash, border: `1px solid ${V.askLine}`, color: V.ask, ...font }}
      >
        not linked yet · link it
      </button>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md"
      style={{ background: V.field, color: V.inkSoft, ...font }}
    >
      <Link2 size={11} style={{ color: V.faint }} />
      <span style={{ color: V.faint }}>{anchor.ref}</span>
      <span>·</span>
      <span>{anchor.label}</span>
    </span>
  );
}

function FilterChip({ children, active, tone }) {
  const ask = tone === "ask";
  return (
    <button
      className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full"
      style={
        ask ? { background: V.askWash, border: `1px solid ${V.askLine}`, color: V.ask, ...font }
        : active ? { background: V.terraWash, border: `1px solid #EFD6C9`, color: V.terraDeep, ...font }
        : { background: V.surface, border: `1px solid ${V.line}`, color: V.inkSoft, ...font }
      }
    >
      {children}{!ask && <ChevronDown size={13} style={{ color: V.faint }} />}
    </button>
  );
}

/* ---------- the month flow bar: in vs out, one glance ---------- */

function FlowBar() {
  return (
    <div className="mt-5" style={{ maxWidth: 460 }}>
      <div className="flex h-2 rounded-full overflow-hidden" style={{ background: V.field }}>
        <div style={{ width: `${100 - MONTH.outPct}%`, background: V.sage, opacity: 0.85 }} />
        <div style={{ width: `${MONTH.outPct}%`, background: V.terra, opacity: 0.8 }} />
      </div>
      <div className="flex items-baseline justify-between mt-2">
        <p className="text-xs" style={{ color: V.sys, ...font, ...nums }}>
          <span style={{ color: V.sage }}>+ ₹{MONTH.inn} in</span>
          <span className="mx-1.5" style={{ color: V.line }}>|</span>
          <span style={{ color: V.terraDeep }}>− ₹{MONTH.out} out</span>
        </p>
        <p className="text-xs" style={{ color: V.inkSoft, ...font, ...nums }}>
          net <b style={{ color: V.sage }}>{MONTH.net}</b>
        </p>
      </div>
    </div>
  );
}

/* ---------- the entry: machine-set, threaded on the spine ---------- */

function Entry({ r }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="grid items-center gap-3 px-4 rounded-xl relative"
      style={{
        gridTemplateColumns: "28px minmax(0,1.4fr) minmax(0,1.6fr) 24px 130px",
        height: 56,
        background: hover ? V.field : "transparent",
        transition: "background .15s",
      }}
    >
      <DirMedallion dir={r.dir} />
      <div className="min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: V.ink, ...font }}>{r.payee}</p>
        <p className="text-xs truncate" style={{ color: V.faint, ...font }}>{r.who}</p>
      </div>
      <div className="min-w-0 flex items-center gap-2">
        <AnchorChip anchor={r.anchor} />
        {r.remark && <span className="text-xs truncate" style={{ color: V.sys, ...font }}>{r.remark}</span>}
      </div>
      <span className="flex justify-center">
        {r.attach && <Paperclip size={13} style={{ color: V.faint }} />}
      </span>
      <Amount dir={r.dir} value={r.amount} />
    </div>
  );
}

/* ---------- the day: a page of the rojmel, ruled off ---------- */

function DayGroup({ day }) {
  return (
    <section className="mt-7">
      <p className="px-4 py-2 text-sm sticky top-0" style={{ background: V.page, color: V.ink, zIndex: 2, ...serif }}>
        {day.date} <span className="text-xs" style={{ color: V.faint, ...font }}>· {day.weekday}</span>
      </p>

      <div className="rounded-2xl pt-1 overflow-hidden relative" style={{ background: V.surface, border: "1px solid #E3DDD4" }}>
        {/* the spine: one thread of money through the day */}
        <div
          aria-hidden="true"
          className="absolute"
          style={{ left: 29, top: 16, bottom: 64, width: 1, background: V.line }}
        />

        {day.rows.map((r) => <Entry key={r.id} r={r} />)}

        {/* ruling off: the bookkeeper closes the day */}
        <div
          className="flex items-baseline justify-between px-4 py-3 mt-1"
          style={{ borderTop: `1px solid ${V.line}` }}
        >
          <p className="text-sm" style={{ color: V.inkSoft, ...serif, fontStyle: "italic" }}>
            Day closed
          </p>
          <div className="text-right">
            <p className="text-sm" style={{ color: V.inkSoft, ...serif, ...nums }}>
              <span style={{ color: V.terraDeep }}>− ₹{day.out}</span>
              <span className="mx-2" style={{ color: V.faint }}>·</span>
              <span style={{ color: V.sage }}>+ ₹{day.inn}</span>
            </p>
            <div className="mt-1.5 ml-auto" style={{ width: 148, borderTop: `1px solid ${V.inkSoft}`, borderBottom: `1px solid ${V.inkSoft}`, height: 4 }} />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- page ---------- */

export default function BriklayTransactionsPage() {
  return (
    <div className="min-h-screen px-6 sm:px-10 py-8" style={{ background: V.page, ...font }}>
      <div className="mx-auto" style={{ maxWidth: 880 }}>

        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl" style={{ color: V.ink, ...serif }}>Transactions</h1>
            <p className="text-sm mt-2" style={{ color: V.sys, ...font, ...nums }}>
              {MONTH.label} · {MONTH.entries} entries
            </p>
            <FlowBar />
          </div>
          <button
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl"
            style={{ background: terraGrad, color: "#fff", ...font }}
          >
            <Plus size={15} /> New transaction
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap mt-7">
          <FilterChip active>Jun 2026</FilterChip>
          <FilterChip>Type</FilterChip>
          <FilterChip>Project</FilterChip>
          {MONTH.unlinked > 0 && <FilterChip tone="ask">{MONTH.unlinked} not linked</FilterChip>}
          <span className="flex-1" />
          <div
            className="inline-flex items-center gap-2 px-3 rounded-full"
            style={{ background: V.surface, border: `1px solid ${V.line}`, height: 36, minWidth: 200 }}
          >
            <Search size={14} style={{ color: V.faint }} />
            <input placeholder="Search payee, order, remark" className="bg-transparent text-sm outline-none flex-1" style={{ color: V.ink, ...font }} />
          </div>
          <button
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full"
            style={{ background: V.surface, border: `1px solid ${V.line}`, color: V.inkSoft, ...font }}
          >
            <Download size={13} style={{ color: V.faint }} /> Export
          </button>
        </div>

        {DAYS.map((d) => <DayGroup key={d.date} day={d} />)}

      </div>
    </div>
  );
}
