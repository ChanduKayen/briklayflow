import type React from 'react';

/**
 * The composer's draft — the sentence so far — plus the small pure helpers and the scoped CSS that
 * dress it. Kept beside TxComposer rather than inside it so the panel file exports a component only.
 */
export type TxDraft = {
  dir: 'out' | 'in';
  partyId: string; party: string; partyType: string;
  amt: string;
  site: string; siteName: string;
  via: PayMode;
  date: string;          // ISO yyyy-mm-dd
  dateWord: 'Today' | 'Yesterday' | 'Earlier';
  note: string;
  bill: File | null; proof: File | null;
  hinted: boolean;       // the slip was pre-filled from the last payment to this party
  open: string;          // which slip row is open
  step: 1 | 2 | 3;
};
export type PayMode = 'NEFT' | 'UPI' | 'Cheque' | 'Cash';
export const VIA: PayMode[] = ['NEFT', 'UPI', 'Cheque', 'Cash'];

export const today = () => new Date().toISOString().slice(0, 10);
export const shift = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); };

export const emptyDraft = (dir: 'out' | 'in' = 'out'): TxDraft => ({
  dir, partyId: '', party: '', partyType: '', amt: '', site: '', siteName: '', via: 'UPI',
  date: today(), dateWord: 'Today', note: '', bill: null, proof: null, hinted: false, open: '', step: 1,
});

export const initials = (n: string) => n.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
export const fmt = (s: string) => (parseInt(String(s).replace(/\D/g, '') || '0', 10)).toLocaleString('en-IN');

/** The amount, read back — so a missing zero is caught by the ear, not by a recount. */
export function words(n: number): string {
  n = Math.floor(n); if (!n) return '';
  const o = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const t = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const two = (x: number): string => (x < 20 ? o[x] : t[Math.floor(x / 10)] + (x % 10 ? '-' + o[x % 10] : ''));
  const three = (x: number): string => (x >= 100 ? o[Math.floor(x / 100)] + ' hundred' + (x % 100 ? ' ' : '') : '') + (x % 100 ? two(x % 100) : '');
  let out = '';
  ([[10000000, 'crore'], [100000, 'lakh'], [1000, 'thousand']] as [number, string][]).forEach(([v, name]) => {
    if (n >= v) { out += (v === 10000000 ? three(Math.floor(n / v)) : two(Math.floor(n / v))) + ' ' + name + ' '; n %= v; }
  });
  return (out + three(n)).trim();
}



/** The bill panel's state — capture → read → check, and the two endings that are not "saved". */
export type BillState = {
  stage: 'capture' | 'reading' | 'check' | 'bad';
  file: File | null;
  /** an object URL for a photo; '' for a PDF, which shows the stand-in sheet */
  img: string;
  f: { vendor: string; no: string; date: string; amount: string; site: string; siteName: string };
  vendorId: string;
  lines: { name: string; spec: string | null; unit: string | null; qty: number; rate: number; amount: number }[];
  /** what the reader was unsure of — a hollow clay ring, asking to be checked */
  unsure: string[];
  openRow: string;
  dupe: { id: string; billNo: string | null; billDate: string | null; amount: number } | null;
  /** the user looked at the collision and said these are two different bills */
  kept: boolean;
  viewer: boolean;
  /** fields revealed so far, so each one arrives as it is read rather than all at once */
  got: string[];
};

export const emptyBill = (): BillState => ({
  stage: 'capture', file: null, img: '', vendorId: '', lines: [], unsure: [], openRow: '', dupe: null, kept: false, viewer: false,
  f: { vendor: '', no: '', date: '', amount: '', site: '', siteName: '' }, got: [],
});

export const genTxnId = () => `TXN-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
export const genStkId = () => `STK-${Math.floor(1000 + Math.random() * 9000)}`;

export const TX_CSS = `
/* =====================================================================
   NEW TRANSACTION.  The bar opens, exactly as it does for More: same panel,
   same colour, same size. One question at a time.
   ===================================================================== */
.mnav .tx-scrim{pointer-events:auto;position:absolute;inset:0;z-index:17;background:rgba(9,6,3,.52);backdrop-filter:saturate(.8) blur(1.5px);-webkit-backdrop-filter:saturate(.8) blur(1.5px);opacity:0;transition:opacity .35s ease}
.mnav .tx-scrim.on{opacity:1}
.mnav .tx{pointer-events:auto;position:absolute;left:var(--nav-gap);right:var(--nav-gap);bottom:calc(var(--nav-gap) + env(safe-area-inset-bottom) + max(0px, var(--kb,0px) - 12px));
  z-index:18;max-width:406px;margin:0 auto;height:var(--h,548px);padding:8px 14px calc(var(--nav-h) + 12px);
  /* riding above the keyboard must not push the question off the top */
  max-height:calc(100% - 24px - max(0px, var(--kb,0px) - 12px));
  display:flex;flex-direction:column;border-radius:32px;background:var(--night-bg);color:rgb(var(--cream));box-shadow:var(--lift);
  transform-origin:calc(100% - 60px) 100%;transform:translateY(24px) scale(.96);opacity:0;overflow:hidden;
  transition:transform .46s var(--ease),opacity .28s ease,bottom .25s ease,padding-bottom .25s ease,height .5s var(--ease)}
.mnav .tx.on{transform:none;opacity:1;transition:transform .5s var(--ease),opacity .3s ease,bottom .25s ease,padding-bottom .25s ease,height .5s var(--ease)}
.mnav.kb .tx{padding-bottom:14px}
.mnav .tx .grab{flex:none;display:grid;place-items:center;height:20px;touch-action:none}
.mnav .tx .grab i{width:36px;height:4px;border-radius:2px;background:rgba(var(--cream),.18)}
.mnav .tx-head{flex:none;display:flex;align-items:center;gap:6px;min-height:48px;margin:2px -4px 10px}
.mnav .tx-head .ico{flex:none;width:40px;height:40px;border:0;border-radius:20px;background:none;color:rgba(var(--cream),.7);display:grid;place-items:center;cursor:pointer}
.mnav .tx-head .ico svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.mnav .tx-head h2{flex:1;min-width:0;margin:0;font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:21px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mnav .tx-head h2 button{padding:0;border:0;background:none;font:inherit;color:inherit;cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-decoration-color:rgba(var(--cream),.4);text-underline-offset:5px}
.mnav .steps{flex:none;display:flex;gap:6px;padding-right:8px}
.mnav .steps i{width:6px;height:6px;border-radius:50%;box-shadow:inset 0 0 0 1.5px rgba(var(--cream),.35);transition:background-color .3s ease,box-shadow .3s ease,transform .4s var(--ease)}
.mnav .steps i.was{background:rgba(var(--cream),.8);box-shadow:none}
.mnav .steps i.now{background:var(--clay-hi);box-shadow:none;transform:scale(1.25)}
.mnav .tx-body{flex:1;min-height:0;min-width:0;display:flex;flex-direction:column;gap:9px;animation:txStepIn .42s var(--ease) both}
.mnav .tx-body.back{animation-name:txStepBack}
.mnav .tx-body.s1{gap:14px;padding:4px 2px 0}
.mnav .tx-body.s2{gap:6px;padding:0 2px}
.mnav .tx-body.s3{gap:0;padding:0 2px}
.mnav .tx-body > *{flex:none;min-width:0}
.mnav .tx-body > .people,.mnav .tx-body > .pad3,.mnav .tx-body > .slip{flex:1}
@keyframes txStepIn{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:none}}
@keyframes txStepBack{from{opacity:0;transform:translateX(-18px)}to{opacity:1;transform:none}}
.mnav .tx small.cap{font-size:12.5px;font-weight:600;color:rgba(var(--cream),.5);margin:4px 4px -2px}

/* 1 · who */
.mnav .dir{flex:none;display:flex;align-items:center;gap:6px;height:32px;padding:0 4px 0 10px;border-radius:16px;border:0;background:none;cursor:pointer;
  font:inherit;font-size:13px;font-weight:600;color:rgba(var(--cream),.85)}
.mnav .dir svg{width:14px;height:14px;fill:none;stroke:var(--clay-hi);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;transition:transform .4s var(--ease)}
.mnav .dir.in svg{transform:rotate(180deg);stroke:#8FC79A}
.mnav .find{flex:none;min-width:0;display:flex;align-items:center;gap:12px;height:54px;padding:0 16px;border-radius:18px;background:rgba(var(--cream),.07)}
.mnav .find svg{flex:none;width:18px;height:18px;fill:none;stroke:rgba(var(--cream),.5);stroke-width:2;stroke-linecap:round}
.mnav .find input{flex:1;min-width:0;height:100%;border:0;background:none;outline:none;font:inherit;font-size:16.5px;color:rgb(var(--cream))}
.mnav .find input::placeholder{color:rgba(var(--cream),.4)}
.mnav .find:focus-within{box-shadow:inset 0 0 0 1.5px var(--clay-hi)}
.mnav .caprow{display:flex;align-items:center;justify-content:space-between;margin:2px 4px -4px}
.mnav .caprow .cap{margin:0}
.mnav .people{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;scrollbar-width:none;margin:0 -4px;
  -webkit-mask-image:linear-gradient(#000 calc(100% - 28px),transparent);mask-image:linear-gradient(#000 calc(100% - 28px),transparent)}
.mnav .people::-webkit-scrollbar{display:none}
.mnav .who{flex:none;display:flex;align-items:center;gap:14px;min-height:60px;padding:0 8px;border:0;border-radius:16px;background:none;color:rgb(var(--cream));
  font:inherit;cursor:pointer;text-align:left;box-shadow:0 1px 0 0 rgba(var(--cream),.07)}
.mnav .who:active{background:rgba(var(--cream),.08)}
.mnav .who .av2{flex:none;width:38px;height:38px;border-radius:19px;background:rgba(var(--cream),.09);display:grid;place-items:center;
  font-style:normal;font-size:12.5px;font-weight:700;color:rgba(var(--cream),.85)}
.mnav .who b{flex:1;min-width:0;font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mnav .who em{flex:none;font-style:normal;font-family:'DM Mono',ui-monospace,monospace;font-size:12.5px;color:rgba(var(--cream),.5)}
.mnav .who.add{color:var(--clay-hi);box-shadow:none}
.mnav .who.add .av2{background:rgba(212,99,62,.16);color:var(--clay-hi)}
.mnav .who.add em{color:inherit;opacity:.7;font-family:inherit}

/* 2 · how much — three columns, big digits, no boxes (the layout hands already know) */
.mnav .amt2{flex:none;display:flex;flex-direction:column;align-items:center;gap:3px;padding:2px 0 6px;text-align:center}
.mnav .amt2 .line{display:flex;align-items:center;justify-content:center;gap:4px;width:100%;position:relative;min-height:58px}
.mnav .amt2 .fig{display:flex;align-items:baseline;gap:6px;font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:48px;line-height:1.1;font-variant-numeric:lining-nums}
.mnav .amt2 .fig span{font-size:30px;color:var(--clay-hi)}
.mnav .amt2 .fig b{font-weight:600}
.mnav .amt2 .fig b.zero{color:rgba(var(--cream),.28)}
.mnav .amt2 .fig.long{font-size:38px}
.mnav .amt2 .fig.tick{animation:txTick .16s ease-out}
@keyframes txTick{from{transform:scale(1.045)}to{transform:none}}
.mnav .amt2 .del{position:absolute;right:0;top:50%;margin-top:-24px;width:48px;height:48px;border:0;border-radius:24px;background:none;color:rgba(var(--cream),.6);
  display:grid;place-items:center;cursor:pointer;transition:opacity .2s}
.mnav .amt2 .del:active{background:rgba(var(--cream),.1)}
.mnav .amt2 .del[disabled]{opacity:0}
.mnav .amt2 .del svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.mnav .amt2 p{margin:0;min-height:18px;font-size:13px;color:rgba(var(--cream),.55)}
.mnav .amt2 .last{margin-top:4px;height:32px;padding:0 14px;border-radius:16px;border:1px solid rgba(var(--cream),.16);background:none;cursor:pointer;
  font:inherit;font-size:13px;font-weight:600;color:rgba(var(--cream),.85)}
.mnav .pad3{flex:1;min-height:0;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(4,1fr);gap:2px 8px;user-select:none;-webkit-user-select:none}
.mnav .k3{border:0;border-radius:20px;background:none;color:rgb(var(--cream));font-family:inherit;font-size:28px;font-weight:500;display:grid;place-items:center;
  cursor:pointer;touch-action:manipulation;font-variant-numeric:lining-nums}
.mnav .k3.z{font-size:22px;letter-spacing:.04em;color:rgba(var(--cream),.85)}
.mnav .k3.hit{background:rgba(var(--cream),.13)}
.mnav .k3.go{background:var(--clay);font-size:16px;font-weight:600;display:flex;gap:6px;align-items:center;justify-content:center;transition:opacity .25s ease}
.mnav .k3.go[disabled]{opacity:.32}
.mnav .k3.go svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}

/* 3 · the slip: not a form to fill, a receipt to glance at */
.mnav .tx .why{flex:none;margin:-4px 4px 8px;font-size:13px;color:rgba(var(--cream),.5);text-wrap:pretty}
.mnav .slip{position:relative;flex:1;min-height:0;overflow:auto;scrollbar-width:none;margin:0 -4px;padding:0 4px}
.mnav .slip::-webkit-scrollbar{display:none}
.mnav .rowS{display:flex;align-items:center;gap:10px;width:100%;min-height:52px;padding:0 4px;border:0;background:none;color:rgb(var(--cream));
  font:inherit;cursor:pointer;text-align:left;box-shadow:0 1px 0 0 rgba(var(--cream),.08)}
.mnav .rowS .l{flex:none;width:92px;font-size:14px;color:rgba(var(--cream),.55);display:flex;align-items:center;gap:7px}
.mnav .rowS .v{flex:1;min-width:0;text-align:right;font-size:15.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mnav .rowS .v.none{color:var(--clay-hi)}
.mnav .rowS .v.mono{font-family:'DM Mono',ui-monospace,monospace;font-weight:500}
.mnav .rowS .v.chg{animation:txChg .9s ease-out}
@keyframes txChg{0%,25%{color:var(--clay-hi)}100%{color:rgb(var(--cream))}}
.mnav .rowS .c{flex:none;width:16px;height:16px;fill:none;stroke:rgba(var(--cream),.35);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;transition:transform .35s var(--ease)}
.mnav .rowS.open{box-shadow:none}
.mnav .rowS.open .c{transform:rotate(90deg)}
.mnav .pick{padding:2px 4px 14px;box-shadow:0 1px 0 0 rgba(var(--cream),.08);animation:txPickIn .38s var(--ease) both}
@keyframes txPickIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.mnav .opt{display:flex;align-items:center;gap:12px;width:100%;min-height:46px;padding:0 10px;border:0;border-radius:14px;background:none;cursor:pointer;
  color:rgba(var(--cream),.85);font:inherit;font-size:15px;font-weight:600;text-align:left}
.mnav .opt:active{background:rgba(var(--cream),.08)}
.mnav .opt i{flex:none;width:9px;height:9px;border-radius:50%;box-shadow:inset 0 0 0 1.5px rgba(var(--cream),.35);transition:background-color .25s,box-shadow .25s}
.mnav .opt[aria-pressed="true"]{color:rgb(var(--cream))}
.mnav .opt[aria-pressed="true"] i{background:var(--clay-hi);box-shadow:none}
.mnav .seg{display:grid;grid-template-columns:repeat(4,1fr);gap:0;margin:4px 0 0;padding:3px;border-radius:16px;background:rgba(var(--cream),.07)}
.mnav .seg button{height:42px;border:0;border-radius:13px;background:none;cursor:pointer;color:rgba(var(--cream),.75);font:inherit;font-size:14px;font-weight:600;
  transition:background .25s ease,color .25s ease}
.mnav .seg button[aria-pressed="true"]{background:rgb(var(--cream));color:var(--night)}
.mnav .chips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:4px -4px 0;padding:0 4px}
.mnav .chips::-webkit-scrollbar{display:none}
.mnav .chip2{position:relative;flex:none;display:inline-flex;align-items:center;height:44px;padding:0 16px;border-radius:22px;border:0;background:rgba(var(--cream),.07);
  color:rgba(var(--cream),.85);font:inherit;font-size:14px;font-weight:600;white-space:nowrap;cursor:pointer;transition:background .25s ease,color .25s ease}
.mnav .chip2[aria-pressed="true"]{background:rgb(var(--cream));color:var(--night)}
.mnav .chip2 input{position:absolute;inset:0;opacity:0;cursor:pointer}
.mnav .note{display:block;width:100%;height:46px;margin-top:4px;border:0;border-radius:14px;background:rgba(var(--cream),.07);padding:0 14px;
  font:inherit;font-size:15.5px;color:rgb(var(--cream));outline:none}
.mnav .note::placeholder{color:rgba(var(--cream),.4)}
.mnav .note:focus{box-shadow:inset 0 0 0 1.5px var(--clay-hi)}
.mnav .extras{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
.mnav .xtra{position:relative;display:inline-flex;align-items:center;gap:7px;height:38px;padding:0 14px 0 11px;border-radius:19px;border:1px solid rgba(var(--cream),.16);
  background:none;color:rgba(var(--cream),.8);font-size:13.5px;font-weight:600;overflow:hidden;cursor:pointer}
.mnav .xtra svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.mnav .xtra input{position:absolute;inset:0;opacity:0;cursor:pointer}
.mnav .xtra.has{border-color:rgba(143,199,154,.5);color:#A9D6B1}
.mnav .tx .file{flex:none;margin-top:auto;display:flex;flex-direction:column;gap:2px;padding-top:12px}
.mnav .tx .btnF{flex:none;width:100%;height:54px;border:0;border-radius:16px;background:var(--clay);color:#fff;font:inherit;font-size:16.5px;font-weight:600;cursor:pointer}
.mnav .tx .all{flex:none;align-self:center;height:36px;padding:0 12px;border:0;background:none;cursor:pointer;color:rgba(var(--cream),.6);font:inherit;font-size:13.5px;
  text-decoration:underline;text-underline-offset:3px}
@media (prefers-reduced-motion:reduce){.mnav .tx,.mnav .tx-body,.mnav .pick{animation:none!important;transition-duration:.01ms!important}}
`;

/**
 * The one way in. The nav bar's action opens the panel, and so does the Transactions page's own
 * "+ New transaction" — the reference wires both to the same thing, so the phone never has two
 * different ways to write the same entry. The bar binds; anyone may open.
 */
let openPanel: ((dir: 'out' | 'in') => void) | null = null;
export const composer = {
  bind(f: (dir: 'out' | 'in') => void) { openPanel = f; return () => { if (openPanel === f) openPanel = null; }; },
  get available() { return !!openPanel; },
  open(dir: 'out' | 'in' = 'out') { openPanel?.(dir); },
};

/**
 * The "Add a bill" card, lent to a page.
 *
 * The bar already owns one, with its stylesheet, its place in the stack and its status capsule. A
 * page that needs a bill recorded — a payment being pointed at the paper it settles — asks for that
 * one rather than standing up a second copy, which outside the bar's scope would come up undressed.
 * It may say who is billing and for which site, and hear back what was filed.
 */
export interface BillDoorOpts {
  lock?: { vendorId: string; vendorName: string; projectId: string; projectName: string } | null;
  onFiled?: (billId: string) => void;
}
let openBill: ((o: BillDoorOpts) => void) | null = null;
export const billDoor = {
  /** The bar alone binds. */
  bind(f: (o: BillDoorOpts) => void) { openBill = f; return () => { if (openBill === f) openBill = null; }; },
  get available() { return !!openBill; },
  open(o: BillDoorOpts = {}) { openBill?.(o); },
};

/**
 * The bar, lent to a page. In select mode the Transactions page's actions take the bar's place —
 * the tabs step down, the actions step up, in the same capsule. Nothing floats over the rows you
 * are choosing. A page offers its toolbar; the bar owns the capsule and the crossfade.
 */
let takeBar: ((node: React.ReactNode) => void) | null = null;
export const navTakeover = {
  /** The bar alone binds. A page that calls this takes the bar out of its own hands — don't. */
  bind(f: (node: React.ReactNode) => void) { takeBar = f; return () => { if (takeBar === f) takeBar = null; }; },
  offer(node: React.ReactNode) { takeBar?.(node); },
  release() { takeBar?.(null); },
};
