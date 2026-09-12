# Bill · PO · Transaction Reconciliation — Design

> **Status:** design only, no code yet · **v1 scope:** exact-payee gate · **Pattern:** propose → dispose → review

Reconciliation ties **money → bill(s) → PO** so all three sides derive a truthful *paid / outstanding*. This is a **suggestive front-end over `txn_allocations`**, not a new data model.

---

## 1. The mental model — a triangle, not a line

There are three entities, each answering a different question:

| Entity | Question it answers | Lives in |
|---|---|---|
| **PO** | What was *agreed* | `purchase_orders` (order value, delivery) |
| **Bill** | What the vendor is *demanding* | `bills` (amount + outstanding; `bills.po_id` ties it to a PO) |
| **Transaction** | What money *actually moved* | `transactions` + `txn_allocations` |

```
                 PO  (what was agreed)
                /  \
   bills.po_id /    \  order_ref = po_id
              /      \
          Bill ------ Transaction
        (demanded)  txn_allocations.bill_id  (money moved)
```

**The join already exists.** One `txn_allocations` row can carry `order_type='PO'`, `order_ref=po_id`, **and** `bill_id` together — that single row *is* the reconciliation record. So the amount landed on a bill also lands on its PO, keeping `poPaidRollup` / `v_po_paid` honest. (This is the "bill's paid updated but its PO stayed ₹0" bug we already fixed — the design must preserve it.)

---

## 2. Reuse the "propose / dispose / review" split

Same shape as the SiteOps resolution engine. Keep the boundary **hard** — it's what makes it trustworthy.

- **Model proposes** — a ranked shortlist of candidate bills, each with a one-line rationale ("same payee, exact ₹ outstanding, bill dated 3 wks before payment"). *Never the final allocation.*
- **Code disposes** — the deterministic allocator turns ranked candidates into actual amounts. **Money math is never the model's job.**
- **Human reviews** — a *"Suggested reconciliation — Review"* card. Accept / modify / leave unlinked.

---

## 3. The v1 caveat — payee is a hard, exact gate

**v1 — exact payee only.** The candidate pool is *only* bills whose payee is the **same resolved stakeholder** as the transaction's payee:

```
bills.stakeholder_id === txn.stakeholder_id
```

No fuzzy, no aliases, no token-bag. Match → rank. No match → **abstain** (leave unlinked for manual attach). This de-risks the worst error: a payment landing on the *wrong vendor's* bill.

**v2 — smart payee resolution.** Swap the exact gate for `scorePayeeRich` (token-bag, nature-aware, jumble/short-full tolerant) so "Sreenu" ≈ "Srinu Reddy", spelling variants, and un-resolved free-text names get caught.

**The seam is a single swap point:**

```
resolvePayee(txn) → stakeholderId
   v1: exact stakeholder equality
   v2: smart scorer → best stakeholder (+ its own confidence)
```

Everything *downstream* of `resolvePayee` — ranking, allocation, the review card, both-directions views — is **built once in v1 and never touched again**. Only the gate gets smarter.

### The caveat this creates

Exact-payee only works when the txn payee has resolved to a stakeholder. Design both cases so v1 degrades *honestly*:

- **Payee resolved** → run the engine on that stakeholder's bills. The common path.
- **Payee free-text / unresolved** (WhatsApp entry, new vendor) → **abstain**: *"Couldn't auto-place — pick a bill"* → straight into the attach-bill picker. Don't guess across vendors. This is exactly the gap v2 closes, so it's the right thing to leave open.

---

## 4. The reconciliation window — a cutover per payee

**The problem it solves.** An unbounded bill pool reaches back forever, so an *old* payment reconciled today can claim a *newer* bill — even one a more recent payment should settle. Per-transaction greedy matching over a time-agnostic pool has no cross-transaction consistency: reconcile the same payments in a different order and you get a different, un-auditable result.

**The fix is a cutover — and Briklay already has it.** Every mature ledger draws a **per-party cutover line**, freezes everything before it into one opening figure, and reconciles only the **open items after it.** You don't reconcile history; you reconcile the live window. In Briklay this line already exists as the party's **opening balance** (`L.opening.asOf`), whose own copy says it out loud:

> "The books begin for this party on this date: attendance, **bills and payments count from here on**; anything earlier is settled by this figure."

So the design is simply: **bind the engine to each payee's `asOf`.**

- Bills dated **before** the cutover → invisible to reconciliation (absorbed in the opening lump).
- Payments dated **before** the cutover → same.
- The engine only ever sees the **post-cutover open items** — a small, coherent, same-era pool.
- No opening balance on a party → fall back to the **org books-start** (`orgCutover`) as the floor.

This alone kills the worst case (an ancient advance colliding with a recent bill) and makes every match auditable: *"why did this payment match that bill?"* always has a bounded, dated answer.

### How the mature systems frame it

Every serious AP ledger (SAP, Oracle, Tally, QuickBooks, Xero) runs on two ideas we should borrow:

1. **Open-item accounting.** Each invoice and each payment is an "open item" against the vendor sub-ledger; reconciliation *clears* open items against each other and never re-touches cleared ones. An **advance is its own open credit item** — cleared when a future invoice arrives, **not forced onto a coincidental bill**. That is the honest home for our leftover advance.
2. **A hard cutover + period lock.** The opening balance is the sum of pre-cutover items; a closed period is frozen. Reconciliation only touches open periods. Our per-party `asOf` *is* their per-vendor statement opening balance.

On top of those, their matching uses strong keys first (invoice no. / reference / exact amount auto-match; everything else *proposed*, never forced), **aging + FIFO** within the open items (a payment applies to the oldest open invoice first), and **3-way match** (PO ↔ receipt ↔ invoice ↔ payment) — our triangle.

### What the cutover does and doesn't solve

- **Solves** the cross-era theft, the unbounded pool, and the un-auditable match; gives every vendor a clean "reconciliation starts here."
- **Does not solve alone** the ambiguity *within* the window — two ₹500 bills both dated after the cutover. That still needs the **batch/aging matcher** (Build order, below) plus confidence honesty (don't say "certain" when two bills tie). The cutover's job is to shrink the problem to a small, same-era set where oldest-first FIFO is actually correct.

> One line: **reconciliation window = (party's `asOf`) → now.** Everything before is the opening balance; everything after is open items the engine matches oldest-first, proposing not forcing, clearing confirmed items so they leave the pool. No new field needed — reuse the boundary the opening balance already establishes, and make the engine refuse to look past it.

---

## 5. The pipeline

**1 · Gather candidates.** Hard filter by exact payee (v1) + project + **inside the cutover window** (§4 — bills/payments on or after the party's `asOf`). Then score each bill on signals (weights, not gates):

- **Outstanding amount vs txn amount** — *strongest* signal. Exact outstanding = near-certain.
- **PO reference** — `findPOsByBill` already does OCR bill-number → PO; a hit is a near-hard link.
- **Bill date** — *soft, one-directional*: payment-after-bill is neutral/positive; payment-before-bill-exists is a mild negative. **Never exclude on date** (a bill can arrive weeks after an advance).
- **Description / material** overlap (bill lines ↔ txn narration).

**2 · Rank, don't name-match.** Emit a confidence per candidate. This is where the model earns its keep — turning "same vendor, 4 open bills" into "*this* one, because…". **Confidence honesty:** a single exact-amount match inside the window is *high*; **two or more bills matching the same amount is *not* — drop to medium and say "2 bills match this amount"**; a bill that postdates the payment by a lot is a plausible advance but *not certain* — temper it and keep the bill date on the card so a wrong-era match is caught by eye.

**3 · Allocate deterministically.**

- Exact outstanding exists → allocate to that bill.
- Multiple exact matches → **oldest bill first**.
- No exact match → allocate against **oldest outstanding bills first**.
- Continue until the transaction amount is exhausted.
- `txn > available bill balances` → **leftover stays unallocated** (an advance).
- `txn < bill balance` → the bill **retains its outstanding balance** (partially paid).
- The amount on each bill *also* writes `order_ref = bills.po_id` so the PO sees the payment.

**4 · Confidence gate — never force.** Three bands:

| Band | Trigger | Behaviour |
|---|---|---|
| **High** | **one** exact outstanding match + payee (+ PO ref) inside the window | pre-fill the allocation, still labelled *Suggested* — one tap to accept |
| **Medium** | payee + partial signals | show the shortlist, **nothing pre-selected** |
| **Low / none** | weak or no signal | **abstain** → attach-bill picker (the *modify* surface) |

**5 · Don't force anything.** The system says *"Suggested reconciliation — Review."* User can **accept, modify, or leave it unlinked.**

**6 · Show both directions.** Same allocations, read from every corner:

- **On the transaction** — "Allocated to Bill 442 (₹340) · Bill TR/1338 (₹500) · ₹100 unallocated (advance)."
- **On the bill** — "Paid by txn on 8 Sept (₹340 of ₹340) · settled."
- **On the PO** — the three-tick row: Received / ✓ Bill / ✓ paid, with the linked-bills list as drill-down.

*One derivation, three views — never three separate truths.*

---

## 6. Persistence — add a *state*, not a table

`txn_allocations` is the record. Give it a lifecycle:

```
suggested  →  confirmed
(system, greyed,   (user accepted,
 Review affordance)  feeds the ledger)
```

- Store **confidence** + a short **rationale** on the suggestion, so the review card explains itself and an audit can see *why*.
- A `suggested` allocation **must not** move `v_party_ledger_line` / payables until confirmed — a guess must never distort a balance.

---

## 7. Guardrails

- **Cutover-bounded** — the engine never looks before the party's `asOf` (§4); pre-cutover items are the opening balance and are out of scope.
- **Voided txns never reconcile** (immutability already enforced).
- **Multi-project split** — run the allocator per **(payee, project)** pool; never blend sites. A split payment → one allocation row per project.
- **Advance vs shortfall** — overflow = an honest `ADVANCE` against the party (never invent a bill to absorb money); underflow = bill stays open.
- **Idempotency** — re-running the suggester on an already-confirmed txn fills only the *still-unallocated remainder*; never duplicates or overrides confirmed rows.
- **Bill-after-payment is normal — but bounded** — the engine may attach a *later* bill to an *earlier* payment (a genuine advance), yet only **inside the same cutover window**, and a large payment→bill date gap **tempers confidence** rather than claiming certainty. This is the double-edged guardrail: right for a true advance, wrong for a coincidental amount collision — so it proposes, never forces.

---

## 8. Build order

1. **Cutover-bounded, read-only suggestion engine** — gate candidates by exact payee **and** the party's `asOf` window (§4); surface a *"Suggested reconciliation — Review"* card on the transaction. No auto-commit.
2. **Accept / modify / unlink**, wired to `set_txn_allocations` + the existing attach-bill picker.
3. **Confidence honesty** — single exact match = high; ambiguous ties + big date gaps drop to medium with the reason shown (§5, step 2).
4. **Three-corner display** (txn / bill / PO all reading the same allocations).
5. **Per-vendor batch/aging matcher** — replace per-transaction greedy with a within-window assignment (payments↔bills solved together, oldest-first) so an old payment can't strip a bill a newer one owns. The durable fix for the within-window ambiguity.
6. **Auto pre-fill** for the high-confidence band only.

> In one line: *the attach-bill picker, run backwards and automatically, gated by exact payee **and a per-party cutover** (v1), with a confidence gate and a review step.*
