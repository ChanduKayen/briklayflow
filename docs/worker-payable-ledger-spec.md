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
  reads `v_party_balance.to_pay` and adds a **“carried from the ledger · owed from earlier”** row for
  `to_pay − represented`, where `represented` is what this week’s rows already show. This surfaces
  any worker owed from earlier weeks (or with no attendance this week at all).
- **After** = B/F + this week − paid, with the existing *carried / advance / re-agreed* WHY-on-pay.
- **Mark paid** records a real transaction (a debit), FIFO against the oldest credit.

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

**Our model — a per-party floor with an org default.** The boundary for any line is:

```
floor = COALESCE( this party's opening as_of ,   -- the party's own cutover, if set
                  org ledger_start_date ,        -- else the org-wide books-start default
                  the line's own date )          -- else no floor → count all history
count a line  ⇔  kind = 'opening'  OR  line_date >= floor
```

So the **org `ledger_start_date`** is a bulk *default* for parties you haven’t touched, and each
**opening balance carries its own `as_of`** that overrides it locally. `v_party_balance` applies this
per-party floor (`20260910000001`), and the party page’s line display drops pre-opening lines to
match.

**One date in practice.** These are not two boundaries to reconcile — the org date is a *default* and
the per-party date is an *override*. The opening editor defaults its *starts-on* date to the org
books-start date, so you set the date once for the business and only ever retype it for the rare party
that started on a different day. A party that carried nothing needs no opening at all — the org date
already floors them.

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
