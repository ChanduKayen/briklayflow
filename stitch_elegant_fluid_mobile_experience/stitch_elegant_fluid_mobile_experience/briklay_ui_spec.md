# Briklay Payment System — UI Functionality Specification

**Scope:** What every screen does, what it shows, and how users interact with it.  
**Not prescribed:** Visual styling, spacing, animations, icon choices, micro-interactions — those are implementation decisions.

---

## App Shell

### Navigation

The app has a persistent left sidebar visible on all screens. It contains:

- Briklay logo / wordmark at the top
- Primary navigation links: Dashboard, Transactions, Projects, Work Orders, Purchase Orders, Stakeholders, Documents
- At the bottom: logged-in user's name, role badge, and a logout option

Supervisors see only: Transactions, their assigned Project, Work Orders (read-only), Documents. They do not see the global Stakeholders registry or Purchase Orders list.

On mobile viewports, the sidebar collapses into a hamburger menu. All functionality remains accessible.

### Page header

Every page has a header showing the page title, a breadcrumb trail (e.g. Projects → Sai Residency → Work Orders → WO-2025-018), and a primary action button relevant to that page (e.g. "New Transaction", "New Work Order").

---

## Screen 1 — Login

Single email and password form. No registration flow — accounts are created by management from the Settings screen. On successful login, the user lands on the Dashboard.

If a supervisor tries to access a URL outside their project scope, they are redirected to their project dashboard with a message explaining the access restriction.

---

## Screen 2 — Global Dashboard

The first screen after login. Gives a health check across all active projects.

**Summary row at top** — four metric cards:
- Total transactions this month (count)
- Total amount paid out this month (sum)
- Open unflagged balance across all active WOs
- Number of transactions flagged (unlinked or AI-flagged)

**Active projects panel** — one card per active project showing:
- Project name and location
- WO contracted total vs paid vs balance (three numbers, one progress bar)
- PO contracted total vs paid vs balance (same)
- Count of pending milestone approvals awaiting management action
- Clicking a project card navigates to that Project Dashboard

**Pending actions panel** — a list of items that require attention, in priority order:
- Milestones marked complete by supervisor, awaiting management approval (with WO name, worker, amount at stake)
- Flagged transactions (AI bill flags or unlinked transactions)
- Work orders in Draft state older than 7 days
- Purchase orders in Issued state with no payment activity in 30+ days

**Recent transactions strip** — last 10 transactions across all projects. Each row shows: date, stakeholder name, amount, projects covered (pill tags), and flag status. Clicking a row opens the Transaction Detail page.

---

## Screen 3 — Transaction Ledger (Global)

The primary working screen for the accountant. Shows all transactions across all projects.

### Table structure

One row per transaction. Columns:

| Column | Content |
|---|---|
| Txn ID | Clickable, opens detail |
| Date | Sortable |
| Stakeholder | Name, with category shown smaller below |
| Total Amount | Right-aligned |
| Payment Mode | Cash / NEFT / UPI / Cheque |
| Projects | Pill tags for each project this transaction was allocated to. If more than 2, show "2 more" |
| Category | Advance / Running Bill / Final / Material / Other |
| Status | Active or Voided |
| Flags | Icon indicators — one for AI bill flag, one for unlinked status. Both can appear simultaneously |
| Entered By | User name |

### Filter bar

Sits above the table. Always visible. Contains:

- Date range picker (from / to). Defaults to current month.
- Project multi-select dropdown. "All projects" by default.
- Stakeholder search / select. Type to filter.
- Payment mode checkboxes.
- Category multi-select.
- Flag filter: All / Flagged only / Clean only / Unlinked only.
- Amount range: min and max number inputs.
- A "Clear all filters" link that resets everything.

All filters are additive (AND logic). Applied instantly without a submit button. Row count updates as filters change.

### Search bar

Separate from filters. Searches across: Txn ID, Stakeholder name, Remarks. Results highlight matching text in the row.

### Column sorting

Every column header is clickable to sort ascending / descending. Sort state is shown visually on the active column header. Default sort is date descending (most recent first).

### Bulk actions

Checkbox on each row. When one or more rows are selected, a bulk action bar appears showing:
- Count of selected rows and their total amount
- Export selected as CSV
- (Management only) Void selected

### Export

A button in the top-right area. Exports the current filtered view (not just the visible page) as a CSV. Exported columns match the table. Amounts are unformatted numbers for easy use in Excel.

### New transaction button

Opens the Transaction Entry Form (see Screen 4) in a full-page view or a wide drawer — not a small modal, because the form is substantial.

---

## Screen 4 — Transaction Entry Form

The most frequently used form in the system. Entered from the global ledger or from any Project page.

### Form layout — top section (transaction header)

Fields shown at the top, in a single form area:

- **Stakeholder** — searchable dropdown. Type to filter by name or category. Required.
- **Date** — date picker. Defaults to today.
- **Total Amount** — number input. Required.
- **Payment Mode** — segmented control or dropdown: Cash / NEFT / UPI / Cheque.
- **Category** — dropdown: Advance / Running Bill / Final / Material / Other.
- **Remarks** — single-line text input. Optional.

### Allocation section — middle

Header label: "Allocate this payment across projects." Below it, a running balance indicator showing: "₹X allocated of ₹Y total — ₹Z remaining." This updates live as the user fills in allocation rows. The remaining amount turns red if over-allocated, green when exactly balanced, and amber when under-allocated.

Each allocation row contains:

- **Project** — dropdown. If entered from a project page, this is pre-filled and locked for the first row.
- **Order type** — toggle or segmented control: Work Order / Purchase Order.
- **Order** — dropdown filtered by selected project and order type. Shows order ID and stakeholder name. If the order type is WO and the selected WO has approved milestones, a milestone dropdown appears below.
- **Milestone** — appears only for WOs with approved milestones. Dropdown showing milestone name, planned amount, and how much has already been paid against it. Optional — user can leave unselected.
- **Amount** — number input. Required per row.

Buttons at the end of the allocation rows section:
- "Add another project" — adds a new blank allocation row
- "Remove" link on each row (except when only one row exists)

### Unmapped allocation warning

If the user tries to proceed without selecting an order on any allocation row, a clear inline warning appears below that row: "This allocation has no Work Order or Purchase Order linked. It will be saved as unlinked and flagged for review." The user can choose to leave it unlinked anyway.

### Document upload section — bottom

Label: "Attach bill / invoice / voucher." A drag-and-drop upload area accepting images (JPG, PNG) and PDFs. Optional.

After upload:
- Thumbnail or file name shown with a remove option.
- A small informational note: "Our AI will verify this bill against the transaction details and flag any discrepancies."
- No loading state is shown here — verification happens in the background after save.

### Validation and save

The Save button is active at all times. On click:

1. If allocations do not sum to total amount — show an error and prevent save. The balance indicator highlights the discrepancy. Cannot proceed.
2. If any allocation has no order linked — show the unmapped warning modal with two options: "Save and flag it" or "Go back."
3. If a possible duplicate is detected (same stakeholder + same amount + same date ±1 day) — show a warning modal listing the matching transaction. Two options: "Yes, save as new" or "Cancel."
4. If all validations pass — save, navigate to the new Transaction Detail page, show a success indicator.

### Editing a saved transaction

Transactions can be edited only by accountant or management, and only while status is Active. Editing opens the same form pre-filled. The Txn ID, entered_by, and created_at are shown read-only at the top.

---

## Screen 5 — Transaction Detail Page

Shows the full record for a single transaction.

**Header area:**
- Txn ID, status badge (Active / Voided), created date, entered by
- Edit button (accountant / management only, Active transactions only)
- Void button (accountant / management only, with confirmation modal)

**Summary block:**
- Stakeholder name and category
- Total amount, payment mode, date, category, remarks

**Allocation table:**
Every allocation row showing: project name, order type, order ID and name, milestone (if tagged), allocated amount. If any row is unlinked, it is visually distinguished with the unlinked flag.

**Bill / document panel:**
If a document is attached, show a thumbnail with a view/download link. If AI verification has run, show the verification results:
- Each check listed with its result: pass or flagged
- For flagged items, the specific detail (e.g. "Invoice shows ₹95,000 — transaction is ₹1,00,000. Difference: ₹5,000")
- An "Acknowledge all flags" button if flags are present and unacknowledged
- If verification is still running, show a subtle in-progress indicator

**Void record panel:**
If the transaction has been voided, show: voided by, voided at, and void reason.

---

## Screen 6 — Project List

A grid or list of all projects. Each card shows:
- Project name and location
- Status badge
- Start date
- Quick stats: total WOs, total POs, total paid this month

Clicking a project card opens the Project Dashboard. A "New Project" button is visible to management only.

---

## Screen 7 — Project Dashboard

The main view for a single project. This is also where supervisors land after login.

**Project header:**
Project name, location, status, start date. Management sees an edit button.

**Financial summary — two panels side by side:**

WO Summary panel:
- Total WO value contracted
- Total paid against WOs
- Balance remaining
- A summary progress bar (paid / total)
- Count of active WOs

PO Summary panel:
- Same structure for purchase orders

**Pending milestone approvals:**
If any milestones are in Completed status (marked by supervisor, awaiting approval), they appear here as a priority list. Each item shows: WO name, worker name, milestone name, trigger condition, planned amount. Management sees an Approve button on each. Clicking approve changes milestone status to Approved without leaving this screen.

**Work orders tab:**
A table of all WOs for this project. Columns: WO ID, worker name, scope (truncated), total value, paid, balance, status, milestone progress (e.g. "2 of 4 milestones paid"). Clicking a row opens the WO Detail page.

**Purchase orders tab:**
A table of all POs for this project. Columns: PO ID, vendor name, items summary, total value, paid, balance, status. Clicking a row opens the PO Detail page.

**Transactions tab:**
Shows all transaction allocations for this project. This is a project-scoped view — not full transactions. Columns: date, stakeholder, order linked, milestone (if tagged), allocated amount, payment mode, parent Txn ID (clickable link to full transaction). Filters: date range, stakeholder, order, flag status.

---

## Screen 8 — Work Order List

A table of all work orders across all projects (or scoped to one project if accessed from the project page).

Columns: WO ID, project, worker, scope (truncated), total value, paid, balance, milestone progress, status.

Filters: project, worker, status, date range.

New Work Order button (management only). Clicking any row opens WO Detail.

---

## Screen 9 — Work Order Creation

Accessed via "New Work Order" button. Management only.

### Step indicator

Three steps shown at the top: 1. Order Details → 2. Milestones → 3. Document. User can navigate between steps freely but cannot save until all required fields are filled.

### Step 1 — Order Details

- Project — dropdown, required
- Worker — searchable dropdown filtered to stakeholders of type Worker, required
- Scope of Work — textarea, required
- Total Contract Value — number input, required
- Date Issued — date picker, defaults to today
- Status — defaults to Draft

### Step 2 — Milestones

Two options presented with equal weight:

**Option A: Upload WO document for AI extraction**
A drag-and-drop upload area. Accepts images and PDFs. After upload:
- A processing state shown (document is being read)
- On completion, the milestone table is populated with extracted data
- Each row shows a small "AI extracted" tag
- A summary note shows: extracted total vs WO total, and whether they match
- If they don't match, a prominent warning shows the gap and blocks moving to Step 3

**Option B: Add milestones manually**
The milestone table starts with one blank row. User fills in: sequence number (auto-incremented), milestone name, trigger condition, planned amount. "Add milestone" button adds more rows. Each row has a remove button.

Regardless of path, the milestone table shows:
- A running total of milestone amounts vs WO total at the bottom
- If the totals don't match, the difference is shown in red and the user cannot proceed

**Shared milestone table columns:**
Seq. no. / Milestone name / Trigger condition / Planned amount / Remove button

### Step 3 — Document

Drag-and-drop area to upload the physical WO document (the signed copy). If the document was already uploaded in Step 2 via the AI path, it is shown here as already attached. User can replace it.

A "Save Work Order" button at the bottom. WO is saved in Draft status. A prompt appears: "Activate this WO? (Requires milestone amounts to equal contract value.)" If the user confirms, status changes to Active.

---

## Screen 10 — Work Order Detail

Full view of a single work order.

**Header:** WO ID, status badge, project name, worker name, date issued. Edit button (management only, Draft/Active status only).

**Summary block:** Scope of work, total contract value, total paid, balance, percentage complete (paid/total).

**Document panel:** If a WO document is attached, show thumbnail with view/download link. If AI extraction was used, show a note: "Milestones extracted from uploaded document on [date]."

**Milestone tracker — the core of this screen:**

A table with one row per milestone:

| Seq | Milestone Name | Trigger Condition | Planned Amount | Paid | Balance | Status | Actions |
|---|---|---|---|---|---|---|---|

Status display:
- Pending — grey
- Completed (awaiting approval) — amber, with the date marked and who marked it
- Approved (payable) — green, with approved-by and date
- Paid / Partially Paid — shows amount paid vs planned

Actions column (role-dependent):
- Supervisor: "Mark Complete" button on Pending milestones only (for their project)
- Management: "Approve" button on Completed milestones
- Accountant / Management: no milestone action buttons — payments are entered via the Transaction Entry Form

Mark Complete triggers a confirmation: "Confirm that [milestone name] work is physically complete on site. This will be sent to management for payment approval." On confirm, milestone moves to Completed status, and the item appears in the project dashboard's pending approvals list.

Approve triggers a confirmation: "Approve [milestone name] for payment (₹X)? This makes it eligible for payment entry." On confirm, milestone moves to Approved.

**Payment history panel:**
A table of all transaction allocations that reference this WO, optionally filtered by milestone. Columns: date, Txn ID (link), milestone tagged, amount paid, payment mode. Running total at the bottom.

---

## Screen 11 — Purchase Order List

Same structure as Work Order List but for POs. Columns: PO ID, project, vendor, items summary, total value, paid, balance, status.

---

## Screen 12 — Purchase Order Creation

Single-step form (no document extraction — POs are created manually):

- Project — dropdown
- Vendor — searchable dropdown filtered to type Vendor
- Date Issued — date picker
- Line items table: description / qty / unit / rate / amount (auto-calculated). "Add line" button adds rows. Remove button per row. Total auto-sums at the bottom.
- Total Order Value — auto-calculated from line items. Can be overridden manually if the PO is a lump sum without line item detail.
- Document upload — optional, for the formal PO document
- Status — defaults to Draft

Save button saves in Draft. A prompt asks if they want to mark it Issued.

---

## Screen 13 — Purchase Order Detail

**Header:** PO ID, status badge, project, vendor, date issued. Edit button (accountant / management, non-Closed status).

**Summary block:** Total order value, total paid, balance.

**Line items panel:** The structured item table as entered. Read-only view. Edit button opens the creation form pre-filled.

**Document panel:** Uploaded PO document with view/download.

**Status control:** Dropdown to change status (Issued → Received → Closed). Confirmation required for each change.

**Payment history panel:** Same structure as WO — all allocations pointing to this PO. Date, Txn ID link, amount, payment mode. Running total.

---

## Screen 14 — Stakeholder Registry

A table of all workers and vendors.

Columns: Stakeholder ID, name, type badge (Worker / Vendor), category, contact, GSTIN presence (yes/no icon).

Filters: type toggle (All / Workers / Vendors), category multi-select, search by name.

"New Stakeholder" button (accountant / management). Clicking a row opens Stakeholder Detail.

---

## Screen 15 — Stakeholder Detail

**Header:** Stakeholder name, type badge, category. Edit button (accountant / management).

**Contact block:** Phone, bank details, GSTIN.

**Work orders panel** (Workers only):
A table of all WOs for this worker across all projects. Columns: WO ID, project, total value, paid, balance, status, milestone progress. Summary row at top: lifetime contracted / lifetime paid / lifetime balance.

**Purchase orders panel** (Vendors only):
Same structure for POs.

**Transaction history panel:**
All transactions where this stakeholder appears. Columns: date, Txn ID, total transaction amount, allocated to (list of projects), mode, flag status. Date range filter.

---

## Screen 16 — Document Vault

A searchable archive of all uploaded documents across the system.

**Document grid or list:**
Each document shows: file thumbnail (for images) or file icon (for PDFs), file name, entity type (WO / PO / Transaction / Milestone), linked entity ID (clickable link to that record), project name, uploaded by, uploaded date.

**Filters:** entity type, project, date range, uploaded by.

**Search:** by file name or linked entity ID.

Clicking a document opens it in a preview panel (inline PDF viewer or image viewer) with a download button.

---

## Screen 17 — Settings (Management only)

**User management section:**
A table of all user accounts. Columns: name, email, role, assigned projects (for supervisors), last active. Actions: Edit role, Edit project assignments, Deactivate account.

"Invite user" button — opens a form: email, name, role. If supervisor is selected, a project multi-select appears. An invite email is sent via Supabase Auth.

**Project archive section:**
A list of all projects. Each project has a status toggle (Active / Completed / On Hold) and a soft-delete (archive) option. Archived projects are hidden from most views but data is preserved.

---

## Key Cross-Screen Behaviours

### Flag indicators

Two flag types exist across the system. Both appear as compact indicators on transaction rows in any table or list view:

1. **Unlinked** — transaction has one or more allocations with no WO or PO. Shows on: ledger rows, project transaction view, stakeholder transaction history.

2. **Bill flagged** — AI found a discrepancy on an attached bill. Shows on the same views.

Both can appear simultaneously on the same transaction. Acknowledged flags show in a visually subdued state (still visible, just less prominent than unacknowledged ones).

### Balance display on WO and PO records

Wherever a WO or PO is shown — in lists, in detail pages, in project dashboards — the three numbers (contracted / paid / balance) appear together. A progress bar always accompanies them visually representing paid vs total.

### Order ID linking

Everywhere an order ID appears (in allocation tables, in transaction details, in stakeholder history), it is a clickable link to that WO or PO's detail page.

### Overdue indicators

- A WO that has an Approved milestone (payable) with no payment for more than 14 days shows a subtle age indicator.
- A PO in Issued status with no payment for more than 30 days shows a similar indicator.
These appear in list views as a small age badge on the row.

### Empty states

Every list and table has a meaningful empty state — not just a blank area. The empty state explains why the list is empty and offers the primary action to fix it. For example: "No work orders yet for this project. Create the first one." with a button.

### Mobile behaviour

All forms are usable on mobile. The transaction entry form is the highest priority for mobile usability since it will be used on site. Allocation rows stack vertically on small screens. The balance indicator is pinned near the save button so it is always visible when the keyboard is up.

---

## What Is Left as UX Freedom

The following are intentionally not prescribed — they are decisions for the builder:

- Visual hierarchy, spacing system, and padding values
- Colour palette and how it's applied within the Briklay brand
- Typography scale and weight choices
- Whether the transaction form is a full-page view, a side drawer, or a modal
- Animation and transition styles (page transitions, row insertions, form state changes)
- How filters collapse/expand on mobile
- Exact icon set and which icon maps to which concept
- Skeleton loading states and shimmer effects
- Toast / notification placement and duration
- How tooltips and contextual help are surfaced
- The exact visual treatment of the AI flag indicators (badge, dot, icon, colour — as long as they are distinguishable from each other and from clean records)
- Whether the milestone tracker on the WO detail page is a table or a vertical timeline
- Empty state illustration style

---

*UI spec complete. All functional behaviour is defined. Visual and interaction design is open.*
