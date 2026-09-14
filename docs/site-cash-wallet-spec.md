# Site-Cash Wallet — Spec

Cash held by a supervisor is the company's money in a different location, not an expense. A wallet is an **asset account** (a cash book), drawn down by spends. Balances are derived; entries are the truth.

Decisions locked: **one wallet per supervisor (team member), spanning all their sites**; **team members only** (outside parties stay in the vendor/advance flow); **running float** (issue and top up any amount, any time); **wallet spends are instant cash expenses** (book the cost on the spot, no vendor payable).

---

## 1. The principle

Giving cash to a supervisor **moves** money (Bank → Wallet); it does not **spend** it. It becomes cost only when the supervisor buys something. Two asset accounts:

- **Bank / Cash** — the source.
- **Wallet** — the same money, now *held by a custodian* ("cash in hand with Ravi").

The float is an asset the whole time it is undrawn. Only the drawdown hits P&L. This is the classic **imprest / petty-cash / cash-book** model.

The error this whole design prevents: booking the advance as cost *and* the supervisor's spends as cost — the same rupee counted twice.

---

## 2. The three money channels

Every payment already in the system is money leaving the bank. The wallet adds a second cash location, so a payment now carries a **funding source** and, when it is a movement, a **destination**.

| Channel | funded_from | kind | Cost code? | In "cash out of bank"? | In "expense / site cost"? |
|---|---|---|---|---|---|
| **Direct bank spend** (today's normal payment) | bank | spend | yes (head + site) | yes | yes |
| **Float issue** (site advance → wallet) | bank | transfer → wallet | **no** | yes | **no** |
| **Wallet spend** (supervisor buys on site) | wallet | spend | yes (head + site) | **no** | yes |
| **Return / settlement** (cash back to office) | wallet | transfer → bank | no | **no** (money re-enters bank) | no |
| **Handover** (Ravi → Suresh) *(optional v1)* | wallet A | transfer → wallet B | no | no | no |

**The two-views rule — the crux.**
- *Cash out of the company* = direct bank spends **+** float issues. Wallet spends are **not** here (that money left the bank already, as the float).
- *Expense / project cost* = direct bank spends **+** wallet spends. Float issues are **not** here.

Float issue and wallet spend sit on opposite sides of these two totals. That is double-entry made visible, and it is the guardrail against the double-count.

### 2.1 Capture — a supervisor's WhatsApp payment defaults to his wallet

This is what makes the wallet effortless. A supervisor's **main way of reporting a payment is WhatsApp**, and the cash he is spending is the float he was given. So:

The rule keys on **the account/phone that holds a wallet**: whoever has a wallet issued to them is defaulted to spending *from that wallet*. Two capture surfaces, two behaviours:

**A) WhatsApp (field capture) — silent default, review override.**
- **A payment reported over WhatsApp by someone who holds a wallet defaults to `funded_from = his wallet`** — a *wallet spend*, not a bank payment. He never has to say "from my wallet"; it is the assumption, because it is the truth ~almost always.
- **Identity → wallet:** the sender's phone resolves to a team member (existing phone↔member coupling), and that member owns exactly one wallet. No holder guess is ever needed — the sender *is* the holder.
- **Day Book keeps the human override.** The review card shows the funding source in plain words — **"From Ravi's wallet"** with a simple switch to **"From bank"** / **"From office cash"** — for the exceptions. The default is right; the override is one tap.
- The wallet **self-reconciles from the stream**: floats issued, every WhatsApp spend draws it down — no separate bookkeeping.

**B) New Transaction page (desk capture) — ask, don't assume.**
- **If the logged-in entrant holds a wallet, New Transaction asks outright: "Paying from — [Bank / Cash] or [your wallet]?"** — an explicit chooser, not a silent default.
- Why ask here and default there: a desk entrant (e.g. an **accountant who also holds a wallet**) is just as likely to be making a company bank payment as spending his own float. WhatsApp is a supervisor in the field (wallet is the safe bet); the New Transaction desk is deliberate and could be either, so it is shown and chosen, never presumed.
- The wallet offered is **the entrant's own** wallet. A spend out of *another person's* wallet only ever arrives through that person's own WhatsApp/entry — never assignable to someone else's wallet from this page.
- **Entrants with no wallet** see no chooser — it's an ordinary bank/cash payment, exactly as today.

**Common to both:** if the choice overdraws the wallet (float not yet recorded), it still books as a wallet spend and the balance goes **negative → flagged** (W8) — prompting "record the advance", never blocking the spend.

---

## 3. Q1 — a transaction classified "site advance"

From Day Book, the classifier, or New Transaction, tagging a payment "site advance" routes it into the **float-issue** channel:

- **No cost code, no site cost, no vendor payable.** Never touches P&L.
- Effects: **Bank ↓, Wallet ↑.** Net worth unchanged.
- The supervisor is **not a vendor we paid** — he is a custodian who now owes an accounting. It reads "float issued to Ravi's wallet", never "₹50,000 paid to Ravi".
- Requires a **holder** (which supervisor's wallet). If the tag arrives without one, hold it for assignment — never guess.

## 4. Q2 — how it sits in the transactions list

**An entry, with no accounting of it.**

- It **shows** in the list (fully auditable: ₹50k left the bank for Ravi on the 3rd).
- It is typed **transfer** and **excluded from every expense/cost rollup** (as an inter-account transfer is excluded from P&L anywhere).
- The accounting — cost head, site, vendor-for-record — attaches to the **spend inside the wallet**, not to the float. The main book records *movements*; the wallet's sub-ledger records the *spends that get accounted*.

## 5. Q3 — the wallet is its own ledger (Cash Book)

A first-class ledger account, structurally the party ledger's twin:

- **Debit** = floats in.
- **Credit** = spends out (each carrying site + head) and returns.
- **Balance** = cash still in the supervisor's hands = a company asset.

Surfaced **subtly on the Transactions page as "Wallets · cash book"** — a small section listing each supervisor's wallet + live balance; click opens its ledger in the existing side-drawer. This is the traditional petty-cash book, promoted to a real account.

## 6. Q4 — the whole accounting (double-entry view)

| Event | Debit | Credit | P&L? |
|---|---|---|---|
| Issue float | Wallet (Ravi) | Bank | no |
| Wallet spend | Cost (site · head) | Wallet (Ravi) | **yes** |
| Return cash | Bank | Wallet (Ravi) | no |
| Shortage at reconcile | Recoverable-from-Ravi (or shortage cost) | Wallet | surfaced |
| Overage at reconcile | Wallet | Unrecorded-float / income | surfaced |

**Wallet balance = Σ floats − Σ spends − Σ returns.** Always derived, never stored (§8).

Lifecycle: issue → spend (draws down, tags site) → top up when low (running float) → return / close → reconcile against a physical count.

---

## 7. Invariants — enforce in the database, not just code

| # | Invariant | Enforcement |
|---|---|---|
| W1 | A wallet holder is an **active team member** | FK + trigger |
| W2 | A transfer (float / return / handover) carries **no cost code** and is excluded from P&L | type + rollup filter |
| W3 | A wallet **spend** carries a site **and** a cost head | CHECK / trigger |
| W4 | Every payment has **exactly one** funded_from (a bank/cash account **or** one wallet) | CHECK |
| W5 | Wallet balance is **derived** from entries; nothing writes a stored balance | code review + no column to patch |
| W6 | Amounts in **integer paise**, no floats anywhere (matches the reconciliation engine) | CHECK |
| W7 | Voiding any entry re-derives the wallet; no entry is patched in place | code |
| W8 | A negative wallet balance is **allowed but flagged**, never blocked | derived + surfaced |

W8 is deliberate: blocking a spend that exceeds the recorded float would *lose a real spend* to protect a number. A negative balance means a top-up wasn't recorded yet — surface it ("₹X spent beyond float — record the missing advance"), don't refuse the truth.

---

## 8. Derive, never patch (shared with the reconciliation engine)

The wallet balance and every rollup are **computed from entries** — floats, spends, returns. Any change (void, edit, re-tag, holder change) **re-derives**; nothing mutates a cached balance. Same discipline as the reconciliation spec: entries are the truth, balances are a function of them, and correctness survives any edit because there is no second copy to drift.

The wallet is **out of the vendor-reconciliation pool** entirely (that engine is bill-backed vendor credits only). Site cash is a third channel: cash-location transfers, not bill matching, not contract advance-against-measurement.

---

## 9. Edge cases

| Case | Behaviour |
|---|---|
| Supervisor reports a payment on WhatsApp, no source stated | **Defaults to his wallet** (wallet spend). The sender is the holder — no guess. |
| Supervisor says on WhatsApp / in Day Book "paid from office / bank" | Override → funded_from = bank; it's a direct bank spend, not a wallet draw. |
| Non-supervisor or office-entered payment | Defaults to bank/cash — only team-member supervisors hold wallets. |
| WhatsApp sender not yet mapped to a member | Existing resolve/identify flow; don't invent a wallet. |
| New Transaction, entrant **holds a wallet** | Ask outright: pay from **Bank/Cash** or **your wallet** — explicit chooser, no silent default. |
| New Transaction, entrant **has no wallet** | No chooser; ordinary bank/cash payment, exactly as today. |
| Accountant with a wallet enters a **bank** payment | Picks Bank in the chooser → direct bank spend; his wallet is untouched. |
| Advance tagged with no holder | Hold for assignment; never guess the supervisor. |
| Spend recorded before its float | Balance goes negative → **flag** "spent beyond float", prompt to record the advance. Never block. |
| Wallet spend bought from a known vendor | Record the vendor **for provenance only** — it's cash-paid, so **no payable is created** (locked decision). |
| Supervisor runs several sites | One wallet, one balance; each spend tags its site, so **site cost stays exact** while custody stays personal. |
| Void a float | Wallet ↓; if now negative, flag. Recompute. |
| Void a wallet spend | Wallet ↑; the site's cost drops. Recompute. |
| Re-tag a normal spend → site advance (or back) | Row moves channel → excluded/included in the two views → recompute. |
| Change a spend's holder (wrong wallet) | Leaves one wallet, enters another → recompute both. |
| Supervisor leaves with cash | Outstanding balance = **recoverable from him**; settle by a return entry or a shortage adjustment — surfaced, never written off silently. |
| Reconcile: book ≠ counted cash | Book the difference as **shortage (recoverable/cost)** or **overage (unrecorded float)** with a note. Never adjust the balance by hand. |
| Zero / negative amount entry | Zero excluded; negative rejected at ingestion. |
| Handover Ravi → Suresh | Transfer wallet A → wallet B (optional v1); both balances move, no P&L. |

---

## 10. Observability

Every wallet entry carries: `channel` (float / spend / return / handover), `funded_from`, `holder`, `site` (spends), `cost_head` (spends), `source` (daybook / whatsapp / manual / inferred), `created_at`, and a proof/receipt reference where one exists. A per-wallet activity log makes "why is Ravi's balance ₹X" answerable on a phone call.

---

## 11. Test set — ship none of this without these passing

1. Issue ₹50k float → wallet balance ₹50k; bank out ₹50k; **expense total unchanged**.
2. Wallet spend ₹8k (cement, Site A) → wallet ₹42k; Site A cost +₹8k; **bank-out unchanged**.
3. Float + three wallet spends → balance = float − Σspends, to the paise.
4. Two views over the same data: cash-out = floats + bank-spends; expense = bank-spends + wallet-spends; **no rupee in both advance and its spend**.
5. Spend before float → negative balance, flagged, not blocked.
6. Void a float that spends now exceed → recompute leaves a flagged negative, no orphan.
7. Re-tag a spend to site-advance → drops out of site cost, into the wallet; recompute.
8. Multi-site supervisor: three sites' spends from one wallet → each site's cost correct, one personal balance.
9. Reconcile with a ₹500 shortage → surfaced as recoverable, balance still derived.
10. Supervisor handover → A down, B up, company total cash unchanged.
11. Paise-level float and spends → balance settles exactly, none stuck at ₹0.01.
12. WhatsApp spend by a supervisor, no source stated → **funded from his wallet by default**, balance draws down, site cost booked.
13. Same spend, Day Book override to "from bank" → becomes a direct bank spend; wallet balance untouched.
14. New Transaction by a wallet-holder → **chooser shown**; pick wallet → wallet draws down; pick bank → bank spend, wallet untouched.
15. New Transaction by an entrant with no wallet → no chooser; ordinary bank/cash payment.

---

## 12. Out of scope

- **Outside parties / contractors** — their advances stay in the vendor/advance flow (bills, or contract advance-against-measurement settled by certification). Not this wallet.
- **Wallet spends settling vendor bills** — locked out for v1 (spends are instant cash expenses). If added later, that spend must also route through the reconciliation engine.
- **Imprest ceilings / forced top-up-to-fixed** — running float only for v1.
