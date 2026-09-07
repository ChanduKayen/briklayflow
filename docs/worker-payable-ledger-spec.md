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

## 5. The cutover — carry every party across the boundary

Turning accrual on must not resurrect months of raw history as fresh dues. The cutover
(`organizations.ledger_start_date`) treats everything **before** the boundary as settled and counts
live accrual only **on/after** it:

```
count a line  ⇔  ledger_start_date IS NULL          -- no cutover: count all history
              OR  line_date >= ledger_start_date     -- on/after the boundary
              OR  kind = 'opening'                    -- the opening always counts
```

**This is exactly why the daily workers showed ₹0 carried:** a cutover date was set, their
pre-cutover attendance was (correctly) excluded, and **no opening balance was captured for them**, so
their genuine carried dues vanished. The one contract worker carried ₹85,001 because his certified
work landed on/after the boundary (or he had an opening). Contracts looked fine; daily wages didn’t.

**The rule:** *every* party’s carried balance across the cutover must be captured as a
`stakeholder_opening_balance`, or it is lost. Making the owner search for each party one-by-one
guarantees some get missed.

**The guided cutover (this change).** When a cutover date is set, the system computes what *every*
worker and vendor carried across it — from the same ledger the app uses — and offers each as an
opening balance to confirm:

- **RPC `party_balances_before(p_cutover date)`** returns, per party, `Σ(billed − paid)` over
  `v_party_ledger_line` for lines strictly **before** the cutover (excluding prior `opening` lines).
  `net > 0` → *we owe them* (`work_owed`); `net < 0` → *advance with them* (`paid_ahead`).
- **`CutoverSetup`** lists these as **“Carried as of this date,”** pre-filled, with a **Carry**
  button per party and **Carry all**. Confirming writes a `stakeholder_opening_balance`
  (`as_of = cutover`), after which that party’s pre-cutover history is ignored and their opening +
  post-cutover accrual is the running balance.

The result: after the cutover, every unpaid party — daily workers included — carries a correct B/F,
and the “carried from the ledger” rows appear in Payables by construction.

---

## 6. Invariants

1. **One source.** The hero, the party page, and Payables all read `v_party_balance`. Never compute a
   party’s dues anywhere else.
2. **Declared, not inferred.** Accrual follows `accrual_basis`; a `work` crew never accrues a day wage.
3. **Approved only.** A pending certification is not owed (like a pending PO).
4. **Cutover completeness.** If `ledger_start_date` is set, every party with a non-zero pre-cutover
   balance must have an opening balance, or their carry is lost. The guided flow enforces this by
   surfacing them all.
5. **Payment = debit, FIFO.** Marking paid records a real transaction allocated oldest-first.

---

## 7. Follow-ups (not in this change)

- **Confirm-basis pass.** Backfilled `accrual_basis` is `basis_confirmed = false` (“assumed”). A crew
  wrongly assumed `work` will accrue nothing per day — a data-quality surface, not a ledger bug.
- **Optional week-close freeze** for an immutable posting boundary (see §2).
- **Advance recovery UX** — showing, at pay time, an advance being drawn down against new accrual.
