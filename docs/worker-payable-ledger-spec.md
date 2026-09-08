# The Worker Payable Ledger

*Companion to “The Allocation Ledger.” This spec fixes the payables gap where a daily-wage
worker’s carried dues showed ₹0 while a contract worker carried correctly.*

---

## 1. The principle

> **Nothing is a payable until it exists as a line in the party’s ledger. The weekly Payables
> run never computes a number the ledger doesn’t already hold — it only *settles* what’s there.**

The party ledger (the running *khata*) is the single source of truth for what is owed. The
Payables page is a **settlement surface** over it, not a second calculator. This is how a good
*khata* book, Tally, and every real payables system work — and it is the mental model the Indian
labour economy already runs on: the only question anyone asks is *“kitna baaki hai?”* (how much is
pending overall, carried from before). A screen that resets weekly and shows only this week is not
trusted, because it doesn’t answer that question.

Consequences that fall out of the principle:

- **Carry-forward is normal, not an error.** You pay weekly, but the account never closes. B/F is
  non-zero for anyone not fully settled.
- **Advances are first-class.** A payment ahead of accrued work is a negative balance (advance),
  netted against future accrual — not a special case.
- **One party, many sites.** A worker on two sites has *one* running balance; each line is tagged
  to its site for costing, and the party page consolidates.

---

## 2. The accrual model

Every obligation becomes a **credit line** in the ledger the moment it is recognized. The channel
is the engagement’s **declared** `accrual_basis` (never inferred):

| Basis | How it accrues | Source |
|---|---|---|
| `day` (NMR / daily wage) | each day present × rate → a wage credit dated that day | `labour_attendance` × rate, live |
| `work` (contract) | **presence only** — accrues *nothing* per day; owed by certified stages | approved `work_certifications` |
| `measurement` | the muster reading *is* the certification | auto-cert on muster |
| `piece` (*gutha*) | discrete agreed lump jobs | explicit `work_certifications` |

**The presence-only guard is load-bearing:** a `work`/`measurement` crew must never accrue *both* a
per-day wage *and* certified value, or it is owed twice. Only `day` engagements mint a wage line.

**Cadence.** Wage accrual is a **live view** over attendance — it does not need a nightly posting
job. `v_party_ledger_line` derives the wage line directly from `labour_attendance × rate` for every
`day`-basis engagement, so the balance is always current and carry-forward is emergent. (A future
“lock the week” freeze can be layered on if attendance needs an immutable posting boundary, but it
is not required for correctness.)

---

## 3. Data model (all present today)

- **`v_party_ledger_line`** — the single UNION that emits one credit/debit line per event: PO bills,
  consolidated bills, opening balances, adjustments, payments (debit), **day-basis wages**, and
  approved certifications. Columns: `org_id, stakeholder_id, project_id, line_date, kind, ref_id,
  label, billed, paid`.
- **`v_party_balance`** — sums `billed − paid` per party → `to_pay` (owed) / `advance` (paid ahead),
  and **applies the cutover** (see §5). This is the one number the party page hero and Payables both
  read, so they cannot drift.
- **`work_certifications`** — the governed certified obligation (measured/piece = Σ incremental;
  lump = latest per milestone; only `status = 'approved'` counts).
- **`labour_crews.accrual_basis` / `labour_direct_workers.accrual_basis`** — the declared channel
  (`day|work|measurement|piece`), with `basis_confirmed` driving the “assumed — confirm” chip.
- **`stakeholder_opening_balances`** — the carried amount at the cutover (see §5).
- **`organizations.ledger_start_date`** — the cutover boundary.

---

## 4. How Payables reads the ledger

`weeklyPaymentsApi` builds the run entirely from the ledger:

- **This week** = credits dated inside the week (contract stages certified this week; day wages from
  this week’s muster).
- **Balance B/F** = the ledger balance the week rows don’t already represent. A carry-forward pass
  reads `v_party_balance.to_pay` and **folds the remainder (`to_pay − represented`) INTO that worker’s
  own row** as its B/F — so the run shows **one row per worker** (B/F + This week together), never a
  “this week” row plus a duplicate “carried from the ledger” row. A worker owed from before with no
  work this week gets a single B/F-only row ("owed from earlier").
- **After** = B/F + this week − paid, with the existing *carried / advance / re-agreed* WHY-on-pay.
- **Mark paid** records a real transaction (a debit), FIFO against the oldest credit.
- **Only the current week carries.** A live balance is "as of now", so past weeks are a **read-only
  record** of that week's attendance and payments — the amount is static, Mark-paid becomes a quiet
  "record", and a note points to the party ledger for the live position. The carry pass runs for the
  current week alone (`WeeklyPayments.isCurrentWeek`).

So the fix is **not on the Payables page** — it already reads the ledger correctly. It is that the
ledger must actually *hold* every party’s dues. Which is where the cutover comes in.

---

## 5. Opening balance IS the cutover — per party

**Opening balance and cutover are two halves of one act, not two features.**

- The **cutover** (a.k.a. books-start / go-live date) is the *when*: the boundary before which
  history is settled and after which the system tracks transactionally.
- The **opening balance** is the *how much*: the figure that account carried *into* the system at
  that boundary — the seed of its running balance.

Every real system works this way (Tally’s *Books beginning from* + per-ledger opening balances;
QuickBooks/Zoho’s opening-balance-as-of-a-date). Two rules make it correct:

1. **The figure is entered by hand, not derived.** You are cutting over *because* the pre-system
   history is incomplete or untrusted; auto-summing it would seed the books with the very numbers you
   don’t believe. The owner asserts *“₹1000 as of Aug 31.”*
2. **The opening’s date is that account’s floor.** Setting *“₹1000 as of Aug 31 for Ramesh”* means
   Ramesh’s books start Aug 31 at ₹1000; his earlier attendance/bills are settled and ignored, and
   accrual runs from Aug 31.

**Our model — the cutover takes effect per party, only via that party's opening.** The boundary for
any line is:

```
count a line  ⇔  kind = 'opening'                       -- the opening always counts
              OR  this party has NO opening              -- → count ALL its history (nothing dropped)
              OR  line_date >= this party's opening as_of -- opening set → opening + everything after
```

So an **opening balance IS the cutover for that party**: set one (any figure, even ₹0) and the party's
books start on its date; before it is settled by the figure, after it accrues. A party with **no**
opening keeps its **full history** — because dropping history you haven't captured as an opening
*invents money* (a worker paid ₹1.79L against ₹35k of work, cut off with no opening, wrongly read as
"₹11k to pay" — the advance that covered it was thrown away). `v_party_balance` applies this
(`20260910000002`, superseding the org-wide filter in `20260910000001`), and the party page's line
display floors on the same per-party opening.

**Pre-cutover history is collapsed, not deleted.** When a party has an opening, the running balance is
scoped to the opening onward (matching `v_party_balance`), but the earlier rows aren't thrown away — the
party ledger keeps them in a muted, collapsed *"N entries before the cutover · settled by the opening"*
section you open on demand (their own historical running, read-only). Same instinct as Tally/QuickBooks/
bank statements: the opening carries the prior period, the detail stays one tap away.
(`loadPartyLedger.preOpening` → `PreCutoverSection`.)

**The org date is only a default, never a silent filter.** `organizations.ledger_start_date` supplies
the date the opening editor pre-fills — so you set it once for the business and rarely retype it — but
it does **not** gate any party on its own. To deliberately start a party clean at a date, set their
opening to ₹0 as of that date; to ignore the whole idea, set no opening and the full history stands.

**Where you set it.** On **each party’s ledger** (`StakeholderDetail` → *Opening balance*): amount +
*starts-on* date + direction (we owe / advance), optionally split by site. This is the primary
surface — you set the figure yourself, for the one party in front of you. The org-wide
`CutoverSetup` (in Payables/Attendance) sets the *default* books-start date and lists the openings.

**Why the daily workers showed ₹0:** the org cutover excluded their pre-cutover attendance, and no
opening balance carried them across — so their dues vanished. Under this model you set each party’s
opening (₹X as of the date), which both seeds the balance *and* starts their accrual, so every unpaid
party carries a correct B/F and the “carried from the ledger” row appears in Payables.

---

## 6. Invariants

1. **One source.** The hero, the party page, and Payables all read `v_party_balance`. Never compute a
   party’s dues anywhere else.
2. **Declared, not inferred.** Accrual follows `accrual_basis`; a `work` crew never accrues a day wage.
3. **Approved only.** A pending certification is not owed (like a pending PO).
4. **Opening = per-party cutover.** A party’s opening balance is entered by hand and its `as_of`
   date is that party’s accrual floor (org `ledger_start_date` is only the default for parties
   without one). Pre-floor history is settled by the figure, never re-summed.
5. **Payment = debit, FIFO.** Marking paid records a real transaction allocated oldest-first.

---

## 5a. Everything reaches the ledger

Two feeds used to fall outside the single source; both are now folded in so the party page, the balance
view and Payables agree:

- **Day wages on the new engine.** The allocation engine stores obligations as `ledger_credits` and
  never posted a wage — so a day-basis worker's attendance was counted in `v_party_balance` (the view
  derives it) yet was **invisible** on the party page (the new-engine reader read only `ledger_credits`).
  `readParty` now folds in the same muster-derived wage lines (`loadWorkerWageEntries`, day-basis only,
  so no double-count with certifications) and adds them to open credits, so the hero and the lines both
  show them.
- **Payment requests.** "Add a payment request" for a known party is a real obligation, so it now
  **persists** as a certified-side `party_adjustment` (amount, site, note) instead of a throwaway local
  row — it enters `v_party_balance`, shows on the party ledger and in the week's carry, and can be
  removed like any other line (§6a). A party-less ad-hoc entry stays a local-only row.

## 5b. Uncertified contract work is nudged, not hidden

A contract crew's stage readings are captured in the muster but only reach the ledger once **certified
and approved** (§2) — correct, but it can look like the reading was lost. The party ledger now shows a
gold nudge — *“₹X of contract work recorded, not yet certified · Certify →”* — whenever recorded stage
work exceeds what's been approved (`loadUncertifiedStage`: per milestone, readings-implied earned −
approved certifications; measured/piece = Σ, lump = latest %). It links to Attendance to certify. Day
wages need no such nudge — they accrue on attendance directly.

## 5c. Only LIVE obligations count

A line is a real obligation only if the document behind it is live. The ledger excludes:

- **Voided payments** — everywhere (`status IS DISTINCT FROM 'Voided'`).
- **Cancelled POs** and **unapproved POs** (PENDING/REJECTED) — a PO bill counts only when
  `approval_status = 'APPROVED'` and `status <> 'CANCELLED'`, matching `loadVendorRows` so the vendor
  list and the ledger agree (`20260910000003` + the `loadPartyLedger` PO read).
- **Certifications on a cancelled work order** — an approved cert is dropped if its WO is `Cancelled`
  (the cert's `status='approved'` alone wasn't enough; the contract can die under it).

Closed / Settled work orders are **not** excluded — work certified on them is still genuinely owed
until paid; only *Cancelled* means "never happened."

## 5d. Bills are a first-class entity

A vendor bill is now its own row (`bills`: vendor + optional site + amount + document + lines,
optionally naming one PO), not just columns on a PO. Standalone bills (no PO) are first-class. The
**Bills** page (`/bills`) is the register; drag-and-drop anywhere on it (or **Add bill**) uploads one
or many documents into a queue, each read by the extract-only AI (`reconcile-po-bill`), then a confirm
sheet names the **vendor + site**, checks the figures, and **warns on a duplicate** (same vendor +
same bill number) before minting.

**Vendor credit comes from bills, not POs.** `v_party_ledger_line` reads every `bills` row, plus a PO's
own `vendor_bill_amount` only as a **fallback when no bills row names that PO** — so a bill recorded
through the old PO flow still counts exactly once, and nothing is lost or doubled while write paths
migrate (`20260911000000`). Consolidated / opening / adjustment sources are unchanged.

## 5e. Payments settle bills (the allocation writer)

Attaching a bill to a payment is the **payment→bill allocation**, so a bill's paid/unpaid stops being
virtual FIFO and becomes recorded fact, one transaction at a time. A `txn_allocations` row can now point
at a bill (`bill_id`, `20260912000000`); a bill's paid = Σ allocations to it. The vendor NET is
unchanged (`v_party_balance` already nets at the party level) — `bill_id` only makes per-bill
settlement real.

**The picker (`BillAllocateSheet`)** is the doctrine, used from both the tx create flow and tx detail:
shows the vendor's unpaid bills with remaining; exact-match (payment = one bill's remaining)
pre-selects; multi-select to clear several bills with one payment; partial when the payment is smaller;
**"upload a new one"** mid-payment (vendor known → extract → mint → allocate in one motion); **"no bill"**
is a legal exit (the remainder is the without-bills bucket); and **advance against an order** → an
optional inert *"towards PO-xxx"* memo (`transactions.advance_po_ref`), pure tracking, never a money
link. Writes through `set_txn_allocations` (complete-set replace; parts sum to the txn total).

Vendor payments **no longer attach a PO**: the create-time PO obligation hub is worker-only now; a
vendor payment settles bills (attached right after save). Workers keep ContractHub unchanged.

## 5f. One bill-intake pipeline, five doors

Every door that records a vendor bill runs ONE pipeline (`billIntake.ts`) —
**upload → extract → resolve vendor → dedupe → mint bill (credit emergent) → propose links** — so the
flows can't drift into five behaviours and five bug surfaces. A door is a thin wrapper that only
pre-fills **context**: the Bills page knows nothing (resolves + confirms the vendor); the tx pickers
know the vendor + payment (no questions, allocation auto-written); the PO door (parked) knows vendor +
PO; WhatsApp (parked) knows the sender.

**Dedupe lives in the pipeline, never in a door** — the same paper genuinely arrives twice through
different doors (site engineer WhatsApps the photo Tuesday; you attach it to the PO Friday). The
fingerprint is **vendor + bill-number**; on a collision `intakeCommit` returns the existing bill and the
door offers to **link it instead of minting a duplicate** — the tx picker selects the existing bill for
this payment, the Bills page opens it — turning the duplicate into a free reconciliation. `allowDuplicate`
lets the user deliberately proceed when it's genuinely a different bill sharing a number.

Live wrappers today: the Bills-page drag-drop and the tx `BillAllocateSheet`. PO record-bill and
WhatsApp intake stay on their parked flows, ready to become wrappers on the same pipeline.

## 6a. Correcting a stray line

The ledger is derived, so a wrong line is only ever a wrong **source row** — you don't post a
cosmetic reversal, you remove the thing that created it. Each credit/accrual line on a party's ledger
carries a management-only **remove** (×), which deletes at the source, dispatched by the line's origin:

| Line | Removed by |
|---|---|
| new-engine stored credit (`c-…`) | `removeCredit` — frees any settling payment (its allocation is deleted → reads as advance again), then deletes the credit |
| approved certification (`cert-…`) | delete the `work_certifications` row |
| manual adjustment (`adj-…`) | delete the `party_adjustments` row |
| day wage (`wage-…`) | delete that day's `labour_attendance` for the subject — the derived line then vanishes |

Payments, vendor PO bills, opening and consolidated bills are **not** removed here — they have their
own flows (void the payment, edit the bill on its PO, edit the opening). This is what closes the
*“I cleared it in attendance but the ledger kept it”* gap: a certification/credit minted from a muster
reading is a separate governed object, so when the reading is a mistake you remove the resulting line
directly. (`removeLedgerLine` in `partyLedgerApi`, `removeCredit` in `ledgerWrite`.)

## 7. Follow-ups (not in this change)

- **Confirm-basis pass.** Backfilled `accrual_basis` is `basis_confirmed = false` (“assumed”). A crew
  wrongly assumed `work` will accrue nothing per day — a data-quality surface, not a ledger bug.
- **Optional week-close freeze** for an immutable posting boundary (see §2).
- **Advance recovery UX** — showing, at pay time, an advance being drawn down against new accrual.
- **Auto-reconcile attendance → certification.** Today, editing/clearing a muster reading does not
  reverse a certification/credit already minted from it; §6a is the manual correction. A future pass
  could reverse or flag the dependent credit automatically when its source reading changes.
