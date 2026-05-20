# Graph Report - Briklay Fly  (2026-05-18)

## Corpus Check
- 138 files · ~304,814 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 453 nodes · 537 edges · 20 communities detected
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 75 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 41|Community 41]]

## God Nodes (most connected - your core abstractions)
1. `handleSessionReply()` - 16 edges
2. `processMessage()` - 12 edges
3. `handleFinancial()` - 11 edges
4. `handleDownloadPDF()` - 10 edges
5. `setColor()` - 9 edges
6. `handleDownloadPDF()` - 9 edges
7. `processImageWithContext()` - 9 edges
8. `sendWA()` - 9 edges
9. `handleImageMessage()` - 8 edges
10. `drawRule()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `commitEdit()` --calls--> `parseAmount()`  [INFERRED]
  src\components\ProjectBudget.tsx → supabase\functions\whatsapp-webhook\_handlers.ts
- `handleDownloadPDF()` --calls--> `fmtRupee()`  [INFERRED]
  src\pages\BillDetail.tsx → src\pages\NewWorkOrder.tsx
- `handleSave()` --calls--> `parseAmount()`  [INFERRED]
  src\pages\ProjectPurchaseOrders.tsx → supabase\functions\whatsapp-webhook\_handlers.ts
- `TxnRow()` --calls--> `formatTxn()`  [INFERRED]
  src\components\TxnRow.tsx → src\lib\formatTxn.ts
- `usePeek()` --calls--> `WorkOrderDetail()`  [INFERRED]
  src\context\PeekContext.tsx → src\pages\WorkOrderDetail.tsx

## Communities

### Community 0 - "Community 0"
Cohesion: 0.15
Nodes (28): buildConfirmMsg(), buildDescription(), createRoughEntry(), fetchImageAsBase64(), findTopMatches(), fmtAmount(), handleFinancial(), handleGeneral() (+20 more)

### Community 1 - "Community 1"
Cohesion: 0.1
Nodes (16): useAuth(), useCan(), useOrgId(), CreateStakeholderForm(), useSnackbar(), add(), applyPercent(), multiply() (+8 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (7): costCodeLabel(), getCostCode(), getTxnType(), h(), handleSave(), suggestCostCode(), getTxnType()

### Community 3 - "Community 3"
Cohesion: 0.18
Nodes (17): amountInWords(), amountText(), dataPair(), drawFooter(), drawHeader(), drawLogoMark(), drawRule(), drawSignatures() (+9 more)

### Community 4 - "Community 4"
Cohesion: 0.18
Nodes (20): callClaude(), callOpenAI(), classifyImage(), classifyImageAnthropic(), classifyImageOpenAI(), classifyIntent(), classifyIntentAI(), classifyMessage() (+12 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (4): PeekLink(), WOPeek(), usePeek(), statusBadgeClass()

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (4): SourceIcon(), if(), isClientReceipt(), isExcludedFromSpent()

### Community 9 - "Community 9"
Cohesion: 0.21
Nodes (6): calcAmount(), fmtRupee(), getMode(), handleNameBlur(), suggestUnit(), updateStage()

### Community 10 - "Community 10"
Cohesion: 0.2
Nodes (2): genTxnId(), handlePost()

### Community 11 - "Community 11"
Cohesion: 0.2
Nodes (2): extractFromDocument(), fileToBase64()

### Community 13 - "Community 13"
Cohesion: 0.2
Nodes (1): handleSave()

### Community 15 - "Community 15"
Cohesion: 0.33
Nodes (6): handler(), close(), go(), handleClose(), handleOpen(), toggle()

### Community 16 - "Community 16"
Cohesion: 0.28
Nodes (4): AmountDisplay(), fileToBase64Str(), runReconciliation(), useCountUp()

### Community 19 - "Community 19"
Cohesion: 0.29
Nodes (2): AmountDisplay(), useCountUp()

### Community 20 - "Community 20"
Cohesion: 0.36
Nodes (4): getInitials(), levenshtein(), matchPayee(), matchProject()

### Community 21 - "Community 21"
Cohesion: 0.43
Nodes (5): TxnRow(), dot(), formatShortDate(), formatTxn(), isCostCode()

### Community 25 - "Community 25"
Cohesion: 0.4
Nodes (1): commitEdit()

### Community 26 - "Community 26"
Cohesion: 0.5
Nodes (2): FinancialsCashflow(), lastNMonths()

### Community 38 - "Community 38"
Cohesion: 1.0
Nodes (2): downloadGRNChallan(), fmtDate()

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (2): handleSubmit(), triggerCelebration()

## Knowledge Gaps
- **Thin community `Community 10`** (11 nodes): `ConfBadge()`, `fmtTime()`, `genTxnId()`, `h()`, `handleDismiss()`, `handlePost()`, `payeeSimilarityScore()`, `selectPayee()`, `sortByPayeeSimilarity()`, `suggestCostCode()`, `ResolvePopup.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 11`** (11 nodes): `addLine()`, `applyExtractedItems()`, `extractFromDocument()`, `fileToBase64()`, `fmtDate()`, `handleProjectChange()`, `newLine()`, `removeLine()`, `SectionLabel()`, `updateLine()`, `NewPurchaseOrder.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 13`** (10 nodes): `async()`, `dateRange()`, `Dropdown()`, `FilterChip()`, `fmtDate()`, `fmtShortDate()`, `getItemsPreview()`, `handleSave()`, `isOverdue()`, `ProjectPurchaseOrders.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (8 nodes): `AmountDisplay()`, `fmtAmendVal()`, `getPhaseBalance()`, `getPOBalance()`, `getWOBalance()`, `openAmendModal()`, `useCountUp()`, `TransactionDetail.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (5 nodes): `commitEdit()`, `fmt()`, `MetricCard()`, `startEdit()`, `ProjectBudget.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (5 nodes): `FinancialsCashflow()`, `fmt()`, `lastNMonths()`, `monthLabel()`, `FinancialsCashflow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (3 nodes): `downloadGRNChallan()`, `fmtDate()`, `grnChallan.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (3 nodes): `handleSubmit()`, `triggerCelebration()`, `Login.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `NewInvoice()` connect `Community 1` to `Community 0`?**
  _High betweenness centrality (0.158) - this node is a cross-community bridge._
- **Why does `multiply()` connect `Community 1` to `Community 9`?**
  _High betweenness centrality (0.118) - this node is a cross-community bridge._
- **Why does `calcAmount()` connect `Community 9` to `Community 1`?**
  _High betweenness centrality (0.117) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `handleSessionReply()` (e.g. with `processMessage()` and `clearSession()`) actually correct?**
  _`handleSessionReply()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `processMessage()` (e.g. with `logMessage()` and `sendWA()`) actually correct?**
  _`processMessage()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `handleFinancial()` (e.g. with `processMessage()` and `extractEntities()`) actually correct?**
  _`handleFinancial()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `handleDownloadPDF()` (e.g. with `setColor()` and `setDraw()`) actually correct?**
  _`handleDownloadPDF()` has 9 INFERRED edges - model-reasoned connections that need verification._