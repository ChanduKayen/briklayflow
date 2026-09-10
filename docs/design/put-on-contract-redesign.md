# Design — "Put on contract" (Attendance) redesign

Status: DRAFT for sign-off. No code yet.

## 1. What it is
On the Attendance sheet, a crew or a single ("direct") worker who is on **daily wages** has a
**"put on contract"** action. It links them to a Work Order (WO) so their obligation is tracked by
**certified stages** instead of days.

## 2. Current implementation (and why it's wrong)

**Flow — raw DOM string-hacking, not a component.**
- Crew: `onContractForm` (`AttendanceSheet.tsx:882`) replaces a label `<span>` with an injected
  `<select>` built from an HTML string, wired with `q()` / `innerHTML` / `addEventListener`.
- Direct worker: `onContractDirect` (`:934`) does the same against a different anchor.
- This is exactly why the crew version was a **silent no-op** for a long time — it bailed on a
  `data-wageslbl` attribute the render never emitted (just patched). Fragile, unmaintainable, and the
  UX (a dropdown injected into a table cell) is not first-class.

**Operations — destructive.**
- `linkCrewToWorkOrder` (`attendanceApi.ts:313`) sets
  `labour_crews.{wo_id, is_contract, basis:'contract', accrual_basis:'work', stage_ids}`.
- `promoteDirectToCrew` (`attendanceApi.ts:323`) creates a one-person crew **and DELETES the
  `labour_direct_workers` row — cascading away ALL that worker's attendance.** The days they actually
  worked are gone.

**Ledger — retroactive erasure.**
- `v_party_ledger_line` computes a crew's wage credits from its **current** `accrual_basis`
  (`WHERE accrual_basis='day'`). Flipping to `'work'` doesn't just stop *future* accrual — it
  **retroactively removes every past day-wage credit** that crew ever had. The worker's balance and
  "Ahead" figure lurch the instant you click. There is no model of the transition.

## 3. Decisions taken (from the product owner)
- **Ask-per-conversion**: at the moment of putting on contract, ask whether the past logged days stay
  as wages, or fold into the contract.
- Non-destructive (implied): keep the attendance record.

## 4. Proposed design

### 4.1 Flow (a real React sheet — mirrors the PO attach-bill sheet)
1. Click "put on contract" → open a portal sheet (not a DOM injection).
2. **Pick the contract**: this party's live WOs on this site, or **+ New contract**
   (→ `/work-orders/new` prefilled with project + stakeholder).
3. If the WO has phases → **phase multi-select** (which stages this crew works). Default all.
4. **Ask-per-conversion** — the sheet states the facts and offers the choice:
   > "This crew has **N days · ₹X** in daily wages logged up to today. From now they're paid by
   > certified stages. What about the ₹X already logged?"
   > **[ Keep it as wages ]  [ Fold it into the contract ]**
5. Confirm → apply. A clear success line: "On contract WO-… · past wages kept / folded."

### 4.2 Operations (non-destructive)
- **Crew**: set `wo_id, is_contract, basis='contract', accrual_basis='work', stage_ids, basis_changed_at=today`.
- **Direct worker**: convert **without deleting** — either keep the worker row and mark it converted,
  or create the crew AND **migrate its `labour_attendance` rows** to the crew (never delete). Attendance
  history is preserved for the record either way.

### 4.3 Ledger rules — the crux
The current bug is that flipping `accrual_basis` recomputes wages from scratch. The fix pins the
past at the cutover:

- **Keep it as wages** → the day-wages **through `basis_changed_at`** stay as real credits. Two ways to
  implement:
  - **(A) Snapshot (recommended for v1)** — at conversion, write ONE fixed credit capturing the accrued
    day-wages through the cutover (a `party_adjustments` row, `side='certified'`, note "Daily wages
    through <date>"), then stop day-accrual. Immutable, simple, no wage-join rewrite. Loses per-day
    detail in the ledger (shows one lump), but the money is exact.
  - **(B) View cutover** — add `basis_changed_at` to the wage branches so day-wages accrue for
    attendance **dated before** the cutover even when `accrual_basis='work'`. Keeps per-day detail;
    more complex (view + both wage unions).
- **Fold into the contract** → discard the day-wage accruals (attendance kept for the record only);
  obligation = certified stages only. Any day-wages already **paid** stay as debits and simply read as
  "paid ahead" until certifications catch up — correct, because the contract value now absorbs that work.

### 4.4 Migration needs
- `labour_crews` + `labour_direct_workers`: add `basis_changed_at date` (and optionally
  `conversion_mode text` check 'keep_wages' | 'fold').
- Snapshot path (A): a `party_adjustments` insert at conversion (no schema change beyond the above).
- View cutover path (B): restate `v_party_ledger_line` wage branches with the `basis_changed_at` guard.
- Non-destructive direct conversion: stop deleting `labour_direct_workers` + cascading attendance;
  migrate attendance to the new crew instead.

## 5. Open questions for sign-off
1. **Keep-as-wages mechanism: snapshot (A) or view-cutover (B)?** (Recommend A for v1 — exact money,
   least risk; B later if per-day detail on the statement matters.)
2. **Direct-worker conversion**: keep the worker row marked converted, or create a crew and migrate its
   attendance? (Either preserves history; the crew path unifies with the crew UI.)
3. Should "put on contract" be **reversible** (put back on daily wages)? Today it is one-way and messy.
