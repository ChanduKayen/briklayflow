// SITE DESK — the prototype's fixtures, typed.
//
// This is site-desk-v30.html's data, verbatim, EXCEPT where the prototype's copy claimed
// something the backend does not do. Per the founder's ruling (2026-07-12): the chase cron is
// daily at 09:00 IST, so "Babai chases again at 6 pm" would be a lie. Those lines now read
// honestly. Every such change is marked HONEST-COPY below and listed in
// docs/SITE_DESK_UI_PARITY.md.
//
// Replaced wholesale when the endpoints in docs/SITE_DESK_INTEGRATION_MAP.md land. Components
// never import this file — they take data through DeskApi (api.ts).

import type { DeskPending, DeskPlan, DeskProblem, DeskSite, DeskTask, TaskGate } from './types'

/** A hard predecessor in the mock plan. The mock's edges are structural — the ones a drag may not
 *  cross — so that is what they say, and the mock's drag is refereed by the same rule as the real
 *  one (edit.ts · checkMove). */
const gate = (ref: string): TaskGate => ({ ref, nature: 'IMPOSSIBLE', reason: 'structural' })

export const SITE_CODES: Record<string, string> = {
  'Dr Sonudharya Residence': 'DSR',
  'ASM Elite': 'ASM',
  'Chitturi Magnova': 'CHM',
  'Aiswarya Enclave': 'AIS',
}

export const MOCK_MEMBERS = [
  { id: 'u-ravi', name: 'Ravi' },
  { id: 'u-suresh', name: 'Suresh' },
  { id: 'u-mahesh', name: 'Mahesh' },
  { id: 'u-ramesh', name: 'Ramesh' },
  { id: 'u-kiran', name: 'Kiran' },
]

export const MOCK_SITES: DeskSite[] = [
  { name: 'Dr Sonudharya Residence', code: 'DSR', projectId: 'p-dsr', projectType: 'Villa', supervisorId: 'u-ravi', pct: 42, focus: 'Ground floor', state: 'hot', note: '1 task stuck on tiles', youCount: 2, openCount: 4 },
  { name: 'ASM Elite', code: 'ASM', projectId: 'p-asm', projectType: 'Apartment', supervisorId: 'u-kiran', pct: 68, focus: 'Second floor', state: 'hot', note: 'Slab waiting on approval', youCount: 1, openCount: 3 },
  { name: 'Chitturi Magnova', code: 'CHM', projectId: 'p-chm', projectType: 'Apartment', supervisorId: null, pct: 35, focus: 'Ground floor', state: 'hot', note: 'Painting blocked by wiring', youCount: 1, openCount: 2 },
  { name: 'Aiswarya Enclave', code: 'AIS', projectId: 'p-ais', projectType: 'Villa', supervisorId: 'u-ramesh', pct: 88, focus: 'Finishing', state: 'ok', note: 'On track — 2 snags to close', youCount: 0, openCount: 3 },
]

export const MOCK_PROBLEMS: DeskProblem[] = [
  {
    id: '1', ref: 'DSR-21', kind: 'issue', state: 'you', title: 'Municipal water not arranged',
    site: 'Dr Sonudharya Residence', siteCode: 'DSR', tag: 'Material', days: 6, last: 48,
    person: { name: 'Jaggu', phone: '+91 98765 40012' },
    status: 'Waiting on you — Jaggu silent 4 days, two chases done',
    story: [
      { t: 'event', l: 'Issue raised by site team', w: '6 days ago' },
      { t: 'event', l: 'Briklay asked Jaggu on WhatsApp', w: '5 days ago' },
      { t: 'msg', from: 'Jaggu', text: 'Tanker union strike sir, will check tomorrow', w: '5 days ago' },
      { t: 'event', l: 'Briklay asked again — “[DSR-21] any update on water?”', w: '3 days ago' },
      { t: 'miss', l: 'No reply since', w: '4 days silent' },
    ],
    guide: 'Briklay has chased twice. His last reply mentioned a tanker strike — that may have ended. <b>This needs your voice now.</b>',
    draft: 'Jaggu, water at Dr Sonudharya site (DSR-21) is pending 6 days now. Strike is over as far as I know. I need a tanker arranged by tomorrow morning — confirm to me tonight. — Chandu',
    secondary: 'Give to someone else',
  },
  {
    id: '2', ref: 'ASM-14', kind: 'issue', state: 'you', title: 'Extra cement — needs your approval',
    site: 'ASM Elite', siteCode: 'ASM', tag: 'Approval', days: 2, last: 4,
    person: { name: 'Hari', phone: '+91 98480 22314' },
    status: 'Waiting on you 2 days · ₹18,400',
    photos: [{ e: '🧾', l: "Hari's estimate" }, { e: '🏗️', l: 'Slab area' }],
    story: [
      { t: 'msg', from: 'Hari', text: 'Sir slab area came more than drawing, need 40 bags extra. Sending photo', w: '2 days ago' },
      { t: 'event', l: 'Briklay checked against estimate — 8% over, within slab variance', w: '2 days ago' },
      { t: 'miss', l: 'Sent to you for approval', w: 'waiting 2 days' },
    ],
    guide: "Slab work <b>pauses without this</b>. Briklay's check says the quantity is plausible. Approving notifies Hari instantly.",
    approve: 'Approve ₹18,400',
    secondary: 'Ask Hari why',
  },
  {
    id: '3', ref: 'DSR-19', kind: 'issue', state: 'you', title: 'Tiles not arrived from vendor',
    site: 'Dr Sonudharya Residence', siteCode: 'DSR', tag: 'Material', days: 5, last: 70,
    person: { name: 'Sri Balaji Ceramics', phone: '+91 88497 11230' },
    status: 'Waiting on you — vendor silent 3 days',
    story: [
      { t: 'event', l: 'Tiles ordered — 1,200 sq ft, vitrified', w: '5 days ago' },
      { t: 'msg', from: 'Sri Balaji Ceramics', text: 'Stock coming from Morbi, 2 days', w: '4 days ago' },
      { t: 'event', l: 'Briklay chased for a delivery date', w: '3 days ago' },
      { t: 'miss', l: 'No response from vendor', w: '3 days silent' },
    ],
    guide: 'Flooring team goes idle from Monday. Vendor promised “2 days” and vanished. <b>Escalate, or start a backup order.</b>',
    draft: "Balaji garu, tiles for Dr Sonudharya site (order DSR-19) were promised in 2 days — it's been 4. If the material can't reach by Monday I'll have to order elsewhere and adjust the advance. Please confirm dispatch today. — Chandu, Briklay",
    secondary: 'Find another vendor',
  },
  {
    id: '4', ref: 'CHM-08', kind: 'issue', state: 'you', title: 'Electrician not turning up',
    site: 'Chitturi Magnova', siteCode: 'CHM', tag: 'Labour', days: 3, last: 20,
    person: { name: 'Suresh', phone: '+91 96032 88451' },
    status: 'Waiting on you — promised Thursday, didn’t come',
    story: [
      { t: 'event', l: 'Reported by supervisor', w: '3 days ago' },
      { t: 'msg', from: 'Suresh', text: 'Thursday pakka sir, finishing another site', w: '2 days ago' },
      { t: 'miss', l: 'Didn’t show up Thursday', w: 'yesterday' },
    ],
    guide: "Second-fix wiring is <b>blocking the painters</b>. He's answered Briklay but not delivered — your word carries more weight.",
    draft: 'Suresh, you gave word for Thursday at Chitturi Magnova (CHM-08) and didn’t come. Painters are standing because of wiring. Be on site tomorrow 8 am or I give the work to someone else. — Chandu',
    secondary: 'Give to someone else',
  },
  {
    id: '5', ref: 'ASM-15', kind: 'issue', state: 'chasing', title: 'Main doors — teak frames',
    site: 'ASM Elite', siteCode: 'ASM', tag: 'Material', days: 1, last: 8,
    person: { name: 'JK Rao', phone: '+91 90000 12873' },
    // HONEST-COPY: was "Babai chases again at 6 pm if no reply". The cron is daily, 09:00 IST.
    status: 'Briklay chases again tomorrow morning if no reply',
    story: [
      { t: 'event', l: 'Briklay asked JK Rao — “[ASM-15] doors sorted?”', w: '9 am today' },
      { t: 'event', l: 'Message read', w: '11 am' },
      // HONEST-COPY: was "If no reply by 6 pm, Babai chases again".
      { t: 'next', l: 'If no reply, Briklay chases again tomorrow morning', w: 'automatic' },
    ],
    guide: 'Nothing needed from you. Briklay keeps following up until JK Rao answers.',
    secondary: 'Close',
  },
  {
    id: '6', ref: 'AIS-11', kind: 'snag', state: 'chasing', title: 'Tile sounds hollow — master bathroom',
    site: 'Aiswarya Enclave', siteCode: 'AIS', loc: '2nd floor · master bath', days: 2, last: 16,
    person: { name: 'Ramesh', phone: '+91 97011 45662' },
    status: 'Rework accepted · fix photo due tonight',
    photos: [{ e: '🧱', l: 'Snag photo' }, { e: '📐', l: 'Marked area' }],
    story: [
      { t: 'event', l: 'Snag logged with photo — 4 tiles, hollow on tap', w: '2 days ago' },
      { t: 'msg', from: 'Ramesh', text: 'Seen sir, adhesive issue. Will redo tomorrow morning', w: 'yesterday' },
      { t: 'next', l: 'Briklay asked for a photo of the fix by tonight', w: 'automatic' },
    ],
    guide: 'Nothing needed from you. Snag closes only after the fix photo is verified.',
    secondary: 'Close',
  },
  {
    id: '7', ref: 'AIS-12', kind: 'issue', state: 'chasing', title: 'Paint shade approval from client',
    site: 'Aiswarya Enclave', siteCode: 'AIS', tag: 'Client', days: 1, last: 14,
    person: { name: 'Client — Aiswarya', phone: '' },
    status: 'Client viewed · gentle reminder tomorrow',
    story: [
      { t: 'event', l: 'Three shade samples sent to client', w: 'yesterday' },
      { t: 'event', l: 'Client viewed the message', w: 'yesterday evening' },
      { t: 'next', l: 'Briklay reminds them tomorrow morning', w: 'automatic' },
    ],
    guide: 'Nothing needed from you. Client reminders are worded gently and stop after two tries.',
    secondary: 'Close',
  },
  {
    id: '8', ref: 'DSR-22', kind: 'snag', state: 'chasing', title: 'Seepage mark — bedroom ceiling',
    site: 'Dr Sonudharya Residence', siteCode: 'DSR', loc: '1st floor · bedroom 2', days: 0, last: 3,
    person: { name: 'Supervisor Ravi', phone: '+91 91822 40917' },
    photoPending: true,
    status: 'High severity · Briklay asked Ravi for a photo',
    story: [
      { t: 'event', l: 'Reported on phone call — damp patch near AC point', w: '3 hours ago' },
      { t: 'event', l: 'Briklay asked Ravi on WhatsApp for a photo of the patch', w: '2 hours ago' },
      // HONEST-COPY: was "If no photo by evening, Babai asks again".
      { t: 'next', l: 'If no photo, Briklay asks again tomorrow', w: 'automatic' },
    ],
    guide: 'Seepage is treated as <b>high severity</b> — it chases daily. No photo yet; Briklay is collecting it so the plumber sees exactly what to trace.',
    secondary: 'Close',
  },
  {
    id: '9', ref: 'AIS-09', kind: 'snag', state: 'moving', title: 'Staircase railing alignment',
    site: 'Aiswarya Enclave', siteCode: 'AIS', loc: 'Main stair · ground floor', days: 0, last: 2,
    person: { name: 'Ramesh', phone: '+91 97011 45662' },
    status: 'Fixed · photo received — confirm to close',
    photos: [{ e: '🪜', l: 'Before' }, { e: '✅', l: 'After' }],
    story: [
      { t: 'event', l: 'Snag logged', w: '3 days ago' },
      { t: 'event', l: 'Rework done', w: 'this morning' },
      { t: 'msg', from: 'Ramesh', text: 'AIS-09 done sir, checked with level. Photo attached', w: 'this morning' },
    ],
    guide: 'Ramesh says done and the fix photo is in. <b>Briklay has pre-filled the resolution</b> — confirm and it closes.',
    verify: true, prefillNote: 'Rework verified from fix photo — level-checked by Ramesh',
    secondary: 'View photos',
  },
  {
    id: '10', ref: 'CHM-09', kind: 'issue', state: 'moving', title: 'Sand delivery — 2 units',
    site: 'Chitturi Magnova', siteCode: 'CHM', tag: 'Material', days: 0, last: 5,
    person: { name: 'Vendor', phone: '' },
    status: 'Vendor confirmed · arriving before noon',
    photos: [{ e: '🧾', l: 'Challan' }],
    story: [
      { t: 'event', l: 'Ordered', w: '2 days ago' },
      { t: 'msg', from: 'Vendor', text: 'Loading now, reaches site by 11.30. Challan attached', w: 'today 9 am' },
    ],
    guide: 'On track. When the site team confirms it landed, Briklay will propose closing this.',
    verify: true, prefillNote: 'Delivered — challan received, site confirmation pending',
    secondary: 'Close',
  },
  {
    id: '11', ref: 'ASM-13', kind: 'snag', state: 'moving', title: 'False ceiling gap — hall corner',
    site: 'ASM Elite', siteCode: 'ASM', loc: 'Hall · NE corner', days: 1, last: 10,
    person: { name: 'Ceiling team', phone: '' },
    photos: [{ e: '📷', l: 'Snag photo' }],
    status: 'Fix in progress · done by tomorrow',
    story: [
      { t: 'event', l: 'Snag logged', w: 'yesterday' },
      { t: 'event', l: 'Team accepted, rework started', w: 'this morning' },
      { t: 'next', l: 'Briklay asks for a photo when they say it’s done', w: 'automatic' },
    ],
    guide: 'Moving on its own. Closes after photo verification.',
    secondary: 'Close',
  },

  /* ---------- Sorted (history stays) ---------- */
  {
    id: '12', ref: 'DSR-18', kind: 'issue', state: 'resolved', title: 'Cement — 200 bags for footing',
    site: 'Dr Sonudharya Residence', siteCode: 'DSR', tag: 'Material', days: 4, last: 50,
    person: { name: 'Vendor', phone: '' },
    status: 'Fixed · auto-closed from challan + site confirmation',
    photos: [{ e: '🧾', l: 'Challan' }],
    story: [
      { t: 'event', l: 'Ordered — 200 bags OPC 53', w: '6 days ago' },
      { t: 'msg', from: 'Vendor', text: 'Dispatched, challan attached', w: '4 days ago' },
      { t: 'msg', from: 'Supervisor Ravi', text: 'DSR-18 received sir, 200 bags counted', w: '2 days ago' },
      { t: 'resolve', l: 'Closed — Fixed', w: '2 days ago' },
    ],
    resolution: { outcome: 'Fixed', note: 'Delivered in full. Challan matched against order; count confirmed by Ravi.', by: 'Briklay — auto-closed', when: '2 days ago' },
  },
  {
    id: '13', ref: 'AIS-07', kind: 'snag', state: 'resolved', title: 'Window latch loose — bedroom 1',
    site: 'Aiswarya Enclave', siteCode: 'AIS', loc: '1st floor · bedroom 1', days: 5, last: 30,
    person: { name: 'Ramesh', phone: '' },
    photos: [{ e: '🪟', l: 'Before' }, { e: '✅', l: 'After' }],
    status: 'Fixed · verified with photo, closed by you',
    story: [
      { t: 'event', l: 'Snag logged with photo', w: '6 days ago' },
      { t: 'msg', from: 'Ramesh', text: 'Latch replaced sir, photo attached', w: 'yesterday' },
      { t: 'resolve', l: 'Closed — Fixed', w: 'yesterday' },
    ],
    resolution: { outcome: 'Fixed', note: 'Latch replaced; before/after photos on record.', by: 'You', when: 'yesterday' },
  },
  {
    id: '14', ref: 'CHM-06', kind: 'issue', state: 'resolved', title: 'Wiring delay — same as electrician issue',
    site: 'Chitturi Magnova', siteCode: 'CHM', tag: 'Labour', days: 3, last: 60,
    person: { name: '—', phone: '' },
    status: 'Same problem as CHM-08',
    story: [
      { t: 'event', l: 'Raised by second supervisor', w: '3 days ago' },
      { t: 'resolve', l: 'Closed — same as CHM-08', w: '2 days ago' },
    ],
    resolution: { outcome: 'Same as another', note: 'Same blocker as CHM-08 — tracking there.', by: 'You', when: '2 days ago' },
  },
]

/** PENDING — the "to place" queue (siteops_unplaced). The prototype had no visual for this;
 *  the Parity Ledger creates it, so these are shaped from the real table's columns. */
export const MOCK_PENDING: DeskPending[] = [
  { id: 'u1', text: 'Slab work going on, curing started', sender: 'Ravi', senderNumber: '+91 91822 40917', when: '2 hours ago', interrupted: false, site: 'Dr Sonudharya Residence' },
  { id: 'u2', text: 'Photo of the wall crack near staircase', sender: 'Ramesh', senderNumber: '+91 97011 45662', when: '4 hours ago', interrupted: true, photo: true, site: 'Aiswarya Enclave' },
  { id: 'u3', text: 'Sand 2 units unloaded', sender: 'Hari', senderNumber: '+91 98480 22314', when: 'yesterday', interrupted: false, site: null },
  { id: 'u4', text: 'Tiles hollow in one more bathroom sir', sender: 'Ramesh', senderNumber: '+91 97011 45662', when: 'yesterday', interrupted: true, photo: true, site: 'Aiswarya Enclave' },
]

/* ---------- Plans ---------- */

const DSR_TASKS: DeskTask[] = [
  { ref: 'DSR-28', title: 'Footings', group: 'Structure', trade: 'Civil', state: 'done', afters: [], assignee: 'Ravi', dur: '6d', doneW: '12 Jun' },
  {
    ref: 'DSR-29', title: 'Plinth beams', group: 'Structure', trade: 'Civil', state: 'done', afters: [gate('DSR-28')],
    assignee: 'Ravi', dur: '3d', doneW: '19 Jun',
    // A FAILED check on finished work — the most valuable line on the screen, and still cheap to fix.
    qc: [
      { id: 'q4', question: 'Is the beam top level checked against the datum?', critical: true, status: 'failed', answer: 'Level is 12mm high at the north end' },
      { id: 'q5', question: 'Was the shuttering leak-free before the pour?', critical: false, status: 'confirmed', answer: null },
    ],
  },
  {
    ref: 'DSR-30', title: 'Columns', group: 'Structure', trade: 'Civil', state: 'active', afters: [gate('DSR-29')],
    assignee: 'Ravi', dur: '4d', started: 3, note: 'Started Tuesday · east row done',
    // A CRITICAL check still open on work that is finishing — the last moment to look.
    qc: [
      { id: 'q1', question: 'Are cover blocks placed under the column steel at the required spacing?', critical: true, status: 'pending', answer: null },
      { id: 'q2', question: 'Is the column verticality checked with a plumb bob?', critical: false, status: 'confirmed', answer: 'Checked east row, within 3mm' },
      { id: 'q3', question: 'Is the reinforcement lapping as per drawing?', critical: false, status: 'pending', answer: null },
    ],
  },
  { ref: 'DSR-31', title: 'Beams', group: 'Structure', trade: 'Civil', state: 'todo', afters: [gate('DSR-30')], assignee: 'Ravi', dur: '3d' },
  { ref: 'DSR-32', title: 'Slab', group: 'Structure', trade: 'Civil', state: 'todo', afters: [gate('DSR-31')], assignee: 'Ravi', dur: '5d' },
  { ref: 'DSR-33', title: 'Shuttering removal (de-prop)', group: 'Structure', trade: 'Civil', state: 'todo', afters: [gate('DSR-32')], assignee: 'Ravi', dur: '1d' },
  { ref: 'DSR-34', title: 'Electrical conduiting', group: 'Services', trade: 'Electrical', state: 'todo', afters: [], assignee: 'Suresh', dur: '3d' },
  { ref: 'DSR-35', title: 'In-wall plumbing', group: 'Services', trade: 'Plumbing', state: 'todo', afters: [], assignee: 'Mahesh', dur: '3d' },
  { ref: 'DSR-36', title: 'Pressure test', group: 'Services', trade: 'Plumbing', state: 'todo', afters: [gate('DSR-35')], assignee: 'Mahesh', dur: '1d' },
  { ref: 'DSR-37', title: 'Blockwork (walls)', group: 'Finishes', trade: 'Masonry', state: 'todo', afters: [gate('DSR-32')], assignee: 'Ravi', dur: '6d' },
  { ref: 'DSR-38', title: 'Flooring prep', group: 'Finishes', trade: 'Tiling', state: 'todo', afters: [gate('DSR-37')], blockedBy: 'DSR-19', assignee: 'Ramesh', dur: '2d' },
]

/** The villa: floors only. No block bar, no flat strip. */
const DSR_PLAN: DeskPlan = {
  floors: [
    { n: 'Foundation', pct: 100 }, { n: 'Stilt', pct: 100 }, { n: 'Ground', pct: 24 },
    { n: 'First', pct: 0 }, { n: 'Second', pct: 0 }, { n: 'Terrace', pct: 0 },
  ],
  focus: 'Ground',
  tasks: DSR_TASKS.map((t) => ({ ...t, floor: 'Ground' })),
}

/** The apartment: floors, then flats + common. Every task carries its own floor/unit, so the
 *  floor slice is DERIVED (sliceFloor) and any floor can be opened — including one at 0%. */
const ASM_COMMON: DeskTask[] = [
  { ref: 'ASM-20', title: 'Beams — first floor', group: 'Whole floor', trade: 'Civil', state: 'done', afters: [], assignee: 'Kiran', dur: '3d', doneW: '1 Jul', floor: 'First' },
  { ref: 'ASM-21', title: 'Slab — first floor', group: 'Whole floor', trade: 'Civil', state: 'todo', afters: [gate('ASM-20')], blockedBy: 'ASM-14', assignee: 'Kiran', dur: '5d', floor: 'First' },
  { ref: 'ASM-30', title: 'Corridor + lift lobby screed', group: 'Floor common', trade: 'Civil', state: 'todo', afters: [gate('ASM-21')], assignee: 'Kiran', dur: '2d', floor: 'First' },
  // Site-wide work belongs to NO floor, and must not vanish because you stood on one.
  { ref: 'ASM-27', title: 'Compound wall', group: 'Site-wide', trade: 'Civil', state: 'active', afters: [], assignee: 'Kiran', dur: '10d', started: 6, floor: null },
  { ref: 'ASM-28', title: 'STP pit excavation', group: 'Site-wide', trade: 'Civil', state: 'todo', afters: [gate('ASM-27')], assignee: 'Kiran', dur: '4d', floor: null },
  // The Second floor exists and is at 0% — clicking it must OPEN it, not toast "not started".
  { ref: 'ASM-50', title: 'Columns — second floor', group: 'Whole floor', trade: 'Civil', state: 'todo', afters: [gate('ASM-21')], assignee: 'Kiran', dur: '4d', floor: 'Second' },
  { ref: 'ASM-51', title: 'Beams — second floor', group: 'Whole floor', trade: 'Civil', state: 'todo', afters: [gate('ASM-50')], assignee: 'Kiran', dur: '3d', floor: 'Second' },
]

const ASM_UNITS: Array<{ u: string; tasks: DeskTask[] }> = [
      { u: '101', tasks: [
        { ref: 'ASM-31', title: 'Conduiting', group: 'Flat 101', trade: 'Electrical', state: 'done', afters: [], assignee: 'Suresh', dur: '2d', doneW: '28 Jun' },
        { ref: 'ASM-32', title: 'In-wall plumbing', group: 'Flat 101', trade: 'Plumbing', state: 'active', afters: [gate('ASM-31')], assignee: 'Mahesh', dur: '2d', started: 1 },
        { ref: 'ASM-33', title: 'Tiling', group: 'Flat 101', trade: 'Tiling', state: 'todo', afters: [gate('ASM-32')], assignee: 'Ramesh', dur: '3d' },
        { ref: 'ASM-34', title: 'Door frames', group: 'Flat 101', trade: 'Carpentry', state: 'todo', afters: [gate('ASM-33')], assignee: 'Rao', dur: '1d' },
      ] },
      { u: '102', tasks: [
        { ref: 'ASM-35', title: 'Conduiting', group: 'Flat 102', trade: 'Electrical', state: 'done', afters: [], assignee: 'Suresh', dur: '2d', doneW: '30 Jun' },
        { ref: 'ASM-36', title: 'In-wall plumbing', group: 'Flat 102', trade: 'Plumbing', state: 'todo', afters: [], assignee: 'Mahesh', dur: '2d' },
        { ref: 'ASM-37', title: 'Tiling', group: 'Flat 102', trade: 'Tiling', state: 'todo', afters: [gate('ASM-36')], assignee: 'Ramesh', dur: '3d' },
        { ref: 'ASM-38', title: 'Door frames', group: 'Flat 102', trade: 'Carpentry', state: 'todo', afters: [gate('ASM-37')], assignee: 'Rao', dur: '1d' },
      ] },
      { u: '103', tasks: [
        { ref: 'ASM-39', title: 'Conduiting', group: 'Flat 103', trade: 'Electrical', state: 'todo', afters: [], assignee: 'Suresh', dur: '2d' },
        { ref: 'ASM-40', title: 'In-wall plumbing', group: 'Flat 103', trade: 'Plumbing', state: 'todo', afters: [gate('ASM-39')], assignee: 'Mahesh', dur: '2d' },
        { ref: 'ASM-41', title: 'Door frames', group: 'Flat 103', trade: 'Carpentry', state: 'todo', afters: [], blockedBy: 'ASM-15', assignee: 'Rao', dur: '1d' },
      ] },
      { u: '104', tasks: [
        { ref: 'ASM-42', title: 'Conduiting', group: 'Flat 104', trade: 'Electrical', state: 'done', afters: [], assignee: 'Suresh', dur: '2d', doneW: '25 Jun' },
        { ref: 'ASM-43', title: 'In-wall plumbing', group: 'Flat 104', trade: 'Plumbing', state: 'done', afters: [], assignee: 'Mahesh', dur: '2d', doneW: '2 Jul' },
        { ref: 'ASM-44', title: 'Tiling', group: 'Flat 104', trade: 'Tiling', state: 'done', afters: [], assignee: 'Ramesh', dur: '3d', doneW: '5 Jul' },
        { ref: 'ASM-45', title: 'Door frames', group: 'Flat 104', trade: 'Carpentry', state: 'done', afters: [], assignee: 'Rao', dur: '1d', doneW: '6 Jul' },
      ] },
]

const ASM_PLAN: DeskPlan = {
  floors: [{ n: 'Foundation', pct: 100 }, { n: 'Ground', pct: 100 }, { n: 'First', pct: 62 }, { n: 'Second', pct: 0 }],
  focus: 'First',
  tasks: [
    ...ASM_COMMON,
    ...ASM_UNITS.flatMap((u) => u.tasks.map((t) => ({ ...t, floor: 'First', unit: u.u }))),
  ],
}

export const MOCK_PLANS: Record<string, DeskPlan> = { DSR: DSR_PLAN, ASM: ASM_PLAN }

/** Groups carry their own note — "why these sit together". */
export const DSR_GROUPS = [
  { n: 'Structure', note: 'in sequence' },
  { n: 'Services', note: 'run in parallel, alongside structure' },
  { n: 'Finishes', note: 'after slab' },
]
export const ASM_COMMON_GROUPS = [
  { n: 'Whole floor', note: 'one job for the floor' },
  { n: 'Floor common', note: 'corridor, lobby, stairs' },
  { n: 'Site-wide', note: 'whole site — no floor' },
]
