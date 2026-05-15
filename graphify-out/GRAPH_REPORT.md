# Graph Report - Briklay Fly  (2026-05-14)

## Corpus Check
- 91 files · ~261,127 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 337 nodes · 415 edges · 13 communities detected
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 58 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 23|Community 23]]

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
- `handleDownloadPDF()` --calls--> `fmtRupee()`  [INFERRED]
  src\pages\BillDetail.tsx → src\pages\NewWorkOrder.tsx
- `PeekLink()` --calls--> `usePeek()`  [INFERRED]
  src\components\PeekLink.tsx → src\context\PeekContext.tsx
- `POPeek()` --calls--> `usePeek()`  [INFERRED]
  src\components\POPeek.tsx → src\context\PeekContext.tsx
- `TxnRow()` --calls--> `formatTxn()`  [INFERRED]
  src\components\TxnRow.tsx → src\lib\formatTxn.ts
- `usePeek()` --calls--> `WorkOrderDetail()`  [INFERRED]
  src\context\PeekContext.tsx → src\pages\WorkOrderDetail.tsx

## Communities

### Community 0 - "Community 0"
Cohesion: 0.15
Nodes (28): buildConfirmMsg(), buildDescription(), createRoughEntry(), fetchImageAsBase64(), findTopMatches(), fmtAmount(), handleFinancial(), handleGeneral() (+20 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (6): costCodeLabel(), getCostCode(), getTxnType(), h(), handleSave(), suggestCostCode()

### Community 2 - "Community 2"
Cohesion: 0.1
Nodes (6): PeekLink(), POPeek(), WOPeek(), usePeek(), statusBadgeClass(), WorkOrderDetail()

### Community 3 - "Community 3"
Cohesion: 0.18
Nodes (20): callClaude(), callOpenAI(), classifyImage(), classifyImageAnthropic(), classifyImageOpenAI(), classifyIntent(), classifyIntentAI(), classifyMessage() (+12 more)

### Community 4 - "Community 4"
Cohesion: 0.27
Nodes (17): amountInWords(), amountText(), dataPair(), drawFooter(), drawHeader(), drawLogoMark(), drawRule(), drawSignatures() (+9 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (4): CreateStakeholderForm(), ResolvePopup(), useSnackbar(), NewInvoice()

### Community 6 - "Community 6"
Cohesion: 0.17
Nodes (2): extractFromDocument(), fileToBase64()

### Community 7 - "Community 7"
Cohesion: 0.21
Nodes (6): calcAmount(), fmtRupee(), getMode(), handleNameBlur(), suggestUnit(), updateStage()

### Community 9 - "Community 9"
Cohesion: 0.25
Nodes (2): fileToBase64Str(), runReconciliation()

### Community 13 - "Community 13"
Cohesion: 0.29
Nodes (2): AmountDisplay(), useCountUp()

### Community 14 - "Community 14"
Cohesion: 0.36
Nodes (4): getInitials(), levenshtein(), matchPayee(), matchProject()

### Community 15 - "Community 15"
Cohesion: 0.43
Nodes (5): TxnRow(), dot(), formatShortDate(), formatTxn(), isCostCode()

### Community 23 - "Community 23"
Cohesion: 0.5
Nodes (2): FinancialsCashflow(), lastNMonths()

## Knowledge Gaps
- **Thin community `Community 6`** (13 nodes): `addLine()`, `applyExtractedItems()`, `computeLine()`, `extractFromDocument()`, `fileToBase64()`, `fmtDate()`, `genPONumber()`, `handleProjectChange()`, `newLine()`, `removeLine()`, `SectionLabel()`, `updateLine()`, `NewPurchaseOrder.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 9`** (9 nodes): `fileToBase64Str()`, `fireCelebration()`, `fmtDate()`, `genGRNNumber()`, `handleSave()`, `isOverdue()`, `runReconciliation()`, `useCountUp()`, `PurchaseOrderDetail.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 13`** (8 nodes): `AmountDisplay()`, `fmtAmendVal()`, `getPhaseBalance()`, `getPOBalance()`, `getWOBalance()`, `openAmendModal()`, `useCountUp()`, `TransactionDetail.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (5 nodes): `FinancialsCashflow()`, `fmt()`, `lastNMonths()`, `monthLabel()`, `FinancialsCashflow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SectionLabel()` connect `Community 4` to `Community 1`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `handleDownloadPDF()` connect `Community 4` to `Community 22`, `Community 7`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **Why does `handleDownloadPDF()` connect `Community 4` to `Community 9`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `handleSessionReply()` (e.g. with `processMessage()` and `clearSession()`) actually correct?**
  _`handleSessionReply()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `processMessage()` (e.g. with `logMessage()` and `sendWA()`) actually correct?**
  _`processMessage()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `handleFinancial()` (e.g. with `processMessage()` and `extractEntities()`) actually correct?**
  _`handleFinancial()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `handleDownloadPDF()` (e.g. with `setColor()` and `setDraw()`) actually correct?**
  _`handleDownloadPDF()` has 9 INFERRED edges - model-reasoned connections that need verification._