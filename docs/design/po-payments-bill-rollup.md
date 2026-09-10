# Design — PO payments: show-only, rolled up from bills

Status: DRAFT for sign-off. No code yet.

## 1. The problem
The PO detail plays **two roles at once**: it lets you **record** a payment AND it **shows** paid/balance.
That is the confusion. Money really lives in the ledger, against **bills**; the PO minting its own
payments is a second, competing entry point for the same money.

Concretely today:
- **Record payment** (`PurchaseOrderDetail.tsx:652 recordPayment`) inserts a transaction with a
  `txn_allocations` row `order_type='PO', order_ref=poId`. The PO mints payments directly.
- **Paid** is derived only from `order_type='PO'` allocations (`:594-597`, `:1013-1014`).
- A **bill** carries its own paid via `bill_id` allocations; `bills.po_id` links a bill to a PO.
- So a payment recorded against a **bill** (bill_id) does **not** show on that bill's **PO** unless it is
  also `order_type='PO'`-tagged — and there is no per-bill balance rollup on the PO.

## 2. Decisions taken (from the product owner)
- **Show-only, rolled up from bills.** The PO does not record payments; it reflects paid/balance derived
  from its bills. Payments are recorded in the ledger / against a bill.
- **2b**: a payment linked to a **bill** that sits on a PO must show on the PO with its status and
  balance — **even when the payment has no direct PO link** — and the PO rolls up per-bill balances plus
  its overall balance across all its bills.

## 3. Proposed model — the PO is a mirror of its bills

**Units.** A PO's *billed* is the sum of its **bills**; a bill's *paid* is the sum of its **`bill_id`
allocations**. The PO derives everything from those.

Per PO:
- `billed`  = Σ `bills.amount` where `bills.po_id = PO`  (+ legacy `PO.vendor_bill_amount` **only when no
  bills row names the PO** — the same fallback the ledger view uses).
- `paid`    = Σ payments allocated to the PO's bills (via `bill_id`)  **+** legacy direct `order_type='PO'`
  payments — **counted once per payment** (see §4).
- `balance` = `billed − paid`.

Per bill (a row on the PO):
- `amount`, `paid` (Σ its `bill_id` allocations), `balance = amount − paid`, plus its status
  (Unpaid / Partial / Paid).

## 4. The double-count trap (must resolve)
A recent fix made a bill-settling payment **also** carry `order_type='PO'` when the bill has a `po_id`.
If PO `paid` sums **both** `order_type='PO'` and `bill_id` allocations, a single payment counts **twice**.
Resolution — the PO's paid is a **de-duplicated** sum over allocations that are *either*:
- `order_type='PO' AND order_ref = PO`, **or**
- `bill_id ∈ (the PO's bills)`,

de-duplicated by `allocation_id`. Then both tags can coexist harmlessly. (Alternative: drop the
`order_type='PO'` tag on bill-settling payments and make `bill_id` the sole source — simpler, but loses
the direct-PO-payment legacy path. Recommend the de-dup union so legacy direct payments still count.)

## 5. Flow / UI changes
- **Remove "Record payment"** from the PO detail (show-only). Payments are recorded in the ledger or via
  the bill's "record payment" (the from-the-bill flow).
- The PO **Payments** section becomes a **derived** list: every payment touching any of the PO's bills
  (via `bill_id`) plus any legacy direct-PO payments, with per-bill grouping.
- Add a **per-bill balance table** on the PO: each bill → billed · paid · balance · status; and a PO
  footer → Σ billed · Σ paid · overall balance.
- 2b is automatic once paid is derived from `bill_id ∈ PO's bills`: a payment against a bill shows on the
  PO regardless of a direct PO link.

## 6. Data / migration needs
- **No schema change strictly required** — `bills.po_id` and `txn_allocations.bill_id` already exist.
- The de-dup paid rollup can be a **DB view/RPC** (`v_po_paid` keyed by po_id) or computed client-side in
  `PurchaseOrderDetail`. A view keeps every surface (PO list, PO detail, ledger) consistent — recommended.
- Requires migration `20260912000000` (the `bill_id` column) to be applied.

## 7. Open questions for sign-off
1. **Remove "Record payment" entirely**, or keep it but make it record **against the PO's bill** (so it
   rolls up the same way)? (Owner chose show-only → default is remove; the "record against the bill"
   convenience is a smaller alternative.)
2. Paid rollup as a **DB view** (consistent everywhere) or **client-side** (smaller change, PO-detail
   only)? (Recommend the view.)
3. When a PO has **no bill yet** but has a **legacy direct-PO advance** payment — keep showing it as a PO
   advance (paid, no bill) until a bill is attached? (Recommend yes — it's the "advance" case.)
