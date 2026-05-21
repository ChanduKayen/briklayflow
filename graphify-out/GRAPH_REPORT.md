# Graph Report - Briklay Fly  (2026-05-21)

## Corpus Check
- 152 files · ~333,803 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 507 nodes · 604 edges · 22 communities detected
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 78 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 44|Community 44]]

## God Nodes (most connected - your core abstractions)
1. `handleSessionReply()` - 16 edges
2. `processMessage()` - 12 edges
3. `handleDownloadPDF()` - 11 edges
4. `handleFinancial()` - 11 edges
5. `setColor()` - 9 edges
6. `handleDownloadPDF()` - 9 edges
7. `processImageWithContext()` - 9 edges
8. `sendWA()` - 9 edges
9. `updateLine()` - 8 edges
10. `handleImageMessage()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `commitEdit()` --calls--> `parseAmount()`  [INFERRED]
  src\components\ProjectBudget.tsx → supabase\functions\whatsapp-webhook\_handlers.ts
- `handleDownloadPDF()` --calls--> `SectionLabel()`  [INFERRED]
  src\pages\BillDetail.tsx → src\pages\NewTransaction.tsx
- `handleSave()` --calls--> `parseAmount()`  [INFERRED]
  src\pages\ProjectPurchaseOrders.tsx → supabase\functions\whatsapp-webhook\_handlers.ts
- `suggestCostCode()` --calls--> `getCostCode()`  [INFERRED]
  src\components\QuickTransactionSheet.tsx → src\lib\costCodes.ts
- `TxnRow()` --calls--> `formatTxn()`  [INFERRED]
  src\components\TxnRow.tsx → src\lib\formatTxn.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (11): handleSave(), suggestCostCode(), costCodeLabel(), getCostCode(), autoCloseWOIfFullyPaid(), getTxnType(), h(), handleSave() (+3 more)

### Community 1 - "Community 1"
Cohesion: 0.11
Nodes (18): amountInWords(), amountText(), dataPair(), drawFooter(), drawHeader(), drawLogoMark(), drawRule(), drawSignatures() (+10 more)

### Community 2 - "Community 2"
Cohesion: 0.15
Nodes (28): buildConfirmMsg(), buildDescription(), createRoughEntry(), fetchImageAsBase64(), findTopMatches(), fmtAmount(), handleFinancial(), handleGeneral() (+20 more)

### Community 3 - "Community 3"
Cohesion: 0.12
Nodes (14): useAuth(), useCan(), useOrgId(), CreateStakeholderForm(), useSnackbar(), add(), applyPercent(), multiply() (+6 more)

### Community 4 - "Community 4"
Cohesion: 0.12
Nodes (14): matchSKUs(), matchSKUsFromFile(), matchSKUsFromText(), addMissingToDictionary(), autoAddItemToDictionary(), autoMatchSKU(), clearSKU(), extractFromDocument() (+6 more)

### Community 5 - "Community 5"
Cohesion: 0.18
Nodes (20): callClaude(), callOpenAI(), classifyImage(), classifyImageAnthropic(), classifyImageOpenAI(), classifyIntent(), classifyIntentAI(), classifyMessage() (+12 more)

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (5): PeekLink(), WOPeek(), usePeek(), statusBadgeClass(), WorkOrderDetail()

### Community 7 - "Community 7"
Cohesion: 0.12
Nodes (4): SourceIcon(), if(), isClientReceipt(), isExcludedFromSpent()

### Community 10 - "Community 10"
Cohesion: 0.2
Nodes (2): genTxnId(), handlePost()

### Community 11 - "Community 11"
Cohesion: 0.2
Nodes (2): handleClose(), handleKeyDown()

### Community 12 - "Community 12"
Cohesion: 0.24
Nodes (5): calcAmount(), getMode(), handleNameBlur(), suggestUnit(), updateStage()

### Community 14 - "Community 14"
Cohesion: 0.2
Nodes (1): handleSave()

### Community 17 - "Community 17"
Cohesion: 0.33
Nodes (6): handler(), close(), go(), handleClose(), handleOpen(), toggle()

### Community 18 - "Community 18"
Cohesion: 0.33
Nodes (6): buildExtractionPrompt(), buildReRankPrompt(), extractItems(), matchItems(), reRankWithLLM(), trgmSearch()

### Community 19 - "Community 19"
Cohesion: 0.36
Nodes (4): getInitials(), levenshtein(), matchPayee(), matchProject()

### Community 20 - "Community 20"
Cohesion: 0.43
Nodes (4): genId(), handleKeyDown(), patchRow(), saveRow()

### Community 21 - "Community 21"
Cohesion: 0.43
Nodes (5): TxnRow(), dot(), formatShortDate(), formatTxn(), isCostCode()

### Community 24 - "Community 24"
Cohesion: 0.38
Nodes (3): emptyForm(), handleSave(), openAdd()

### Community 28 - "Community 28"
Cohesion: 0.4
Nodes (1): commitEdit()

### Community 29 - "Community 29"
Cohesion: 0.5
Nodes (2): FinancialsCashflow(), lastNMonths()

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (2): downloadGRNChallan(), fmtDate()

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (2): handleSubmit(), triggerCelebration()

## Knowledge Gaps
- **Thin community `Community 10`** (11 nodes): `ConfBadge()`, `fmtTime()`, `genTxnId()`, `h()`, `handleDismiss()`, `handlePost()`, `payeeSimilarityScore()`, `selectPayee()`, `sortByPayeeSimilarity()`, `suggestCostCode()`, `ResolvePopup.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 11`** (11 nodes): `DrawerSkeleton()`, `filterRow()`, `fmt()`, `formatLedgerDate()`, `getInitials()`, `handleAddTransaction()`, `handleClose()`, `handleKeyDown()`, `monthHeading()`, `monthKey()`, `StakeholderLedgerDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 14`** (10 nodes): `async()`, `dateRange()`, `Dropdown()`, `FilterChip()`, `fmtDate()`, `fmtShortDate()`, `getItemsPreview()`, `handleSave()`, `isOverdue()`, `ProjectPurchaseOrders.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (5 nodes): `commitEdit()`, `fmt()`, `MetricCard()`, `startEdit()`, `ProjectBudget.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (5 nodes): `FinancialsCashflow()`, `fmt()`, `lastNMonths()`, `monthLabel()`, `FinancialsCashflow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (3 nodes): `downloadGRNChallan()`, `fmtDate()`, `grnChallan.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (3 nodes): `handleSubmit()`, `triggerCelebration()`, `Login.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `NewInvoice()` connect `Community 3` to `Community 2`?**
  _High betweenness centrality (0.116) - this node is a cross-community bridge._
- **Why does `parseAmount()` connect `Community 2` to `Community 3`, `Community 28`, `Community 14`?**
  _High betweenness centrality (0.103) - this node is a cross-community bridge._
- **Why does `handleDownloadPDF()` connect `Community 1` to `Community 0`?**
  _High betweenness centrality (0.102) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `handleSessionReply()` (e.g. with `processMessage()` and `clearSession()`) actually correct?**
  _`handleSessionReply()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `processMessage()` (e.g. with `logMessage()` and `sendWA()`) actually correct?**
  _`processMessage()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `handleDownloadPDF()` (e.g. with `setColor()` and `setDraw()`) actually correct?**
  _`handleDownloadPDF()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `handleFinancial()` (e.g. with `processMessage()` and `extractEntities()`) actually correct?**
  _`handleFinancial()` has 4 INFERRED edges - model-reasoned connections that need verification._