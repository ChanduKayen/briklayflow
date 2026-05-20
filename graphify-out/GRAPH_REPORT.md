# Graph Report - Briklay Fly  (2026-05-20)

## Corpus Check
- 149 files · ~319,021 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 485 nodes · 583 edges · 22 communities detected
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 77 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 43|Community 43]]

## God Nodes (most connected - your core abstractions)
1. `handleSessionReply()` - 16 edges
2. `processMessage()` - 12 edges
3. `handleFinancial()` - 11 edges
4. `handleDownloadPDF()` - 10 edges
5. `setColor()` - 9 edges
6. `handleDownloadPDF()` - 9 edges
7. `processImageWithContext()` - 9 edges
8. `sendWA()` - 9 edges
9. `updateLine()` - 8 edges
10. `handleImageMessage()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `commitEdit()` --calls--> `parseAmount()`  [INFERRED]
  src\components\ProjectBudget.tsx → supabase\functions\whatsapp-webhook\_handlers.ts
- `handleDownloadPDF()` --calls--> `fmtRupee()`  [INFERRED]
  src\pages\BillDetail.tsx → src\pages\NewWorkOrder.tsx
- `handleSave()` --calls--> `parseAmount()`  [INFERRED]
  src\pages\ProjectPurchaseOrders.tsx → supabase\functions\whatsapp-webhook\_handlers.ts
- `useSnackbar()` --calls--> `NewInvoice()`  [INFERRED]
  src\components\Snackbar.tsx → src\pages\NewInvoice.tsx
- `TxnRow()` --calls--> `formatTxn()`  [INFERRED]
  src\components\TxnRow.tsx → src\lib\formatTxn.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.15
Nodes (28): buildConfirmMsg(), buildDescription(), createRoughEntry(), fetchImageAsBase64(), findTopMatches(), fmtAmount(), handleFinancial(), handleGeneral() (+20 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (7): costCodeLabel(), getCostCode(), getTxnType(), h(), handleSave(), suggestCostCode(), getTxnType()

### Community 2 - "Community 2"
Cohesion: 0.09
Nodes (8): useAuth(), useCan(), useOrgId(), CreateStakeholderForm(), genTxnId(), handlePost(), useSnackbar(), InwardRegister()

### Community 3 - "Community 3"
Cohesion: 0.18
Nodes (17): amountInWords(), amountText(), dataPair(), drawFooter(), drawHeader(), drawLogoMark(), drawRule(), drawSignatures() (+9 more)

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

### Community 8 - "Community 8"
Cohesion: 0.23
Nodes (9): add(), applyPercent(), multiply(), parseAmount(), round(), subtract(), sum(), NewInvoice() (+1 more)

### Community 11 - "Community 11"
Cohesion: 0.21
Nodes (6): calcAmount(), fmtRupee(), getMode(), handleNameBlur(), suggestUnit(), updateStage()

### Community 13 - "Community 13"
Cohesion: 0.2
Nodes (1): handleSave()

### Community 16 - "Community 16"
Cohesion: 0.33
Nodes (6): handler(), close(), go(), handleClose(), handleOpen(), toggle()

### Community 17 - "Community 17"
Cohesion: 0.28
Nodes (4): AmountDisplay(), fileToBase64Str(), runReconciliation(), useCountUp()

### Community 19 - "Community 19"
Cohesion: 0.33
Nodes (6): buildExtractionPrompt(), buildReRankPrompt(), extractItems(), matchItems(), reRankWithLLM(), trgmSearch()

### Community 20 - "Community 20"
Cohesion: 0.32
Nodes (3): emptyForm(), handleSave(), openAdd()

### Community 21 - "Community 21"
Cohesion: 0.29
Nodes (2): AmountDisplay(), useCountUp()

### Community 22 - "Community 22"
Cohesion: 0.36
Nodes (4): getInitials(), levenshtein(), matchPayee(), matchProject()

### Community 23 - "Community 23"
Cohesion: 0.43
Nodes (5): TxnRow(), dot(), formatShortDate(), formatTxn(), isCostCode()

### Community 27 - "Community 27"
Cohesion: 0.4
Nodes (1): commitEdit()

### Community 28 - "Community 28"
Cohesion: 0.5
Nodes (2): FinancialsCashflow(), lastNMonths()

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (2): downloadGRNChallan(), fmtDate()

### Community 43 - "Community 43"
Cohesion: 1.0
Nodes (2): handleSubmit(), triggerCelebration()

## Knowledge Gaps
- **Thin community `Community 13`** (10 nodes): `async()`, `dateRange()`, `Dropdown()`, `FilterChip()`, `fmtDate()`, `fmtShortDate()`, `getItemsPreview()`, `handleSave()`, `isOverdue()`, `ProjectPurchaseOrders.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (8 nodes): `AmountDisplay()`, `fmtAmendVal()`, `getPhaseBalance()`, `getPOBalance()`, `getWOBalance()`, `openAmendModal()`, `useCountUp()`, `TransactionDetail.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (5 nodes): `commitEdit()`, `fmt()`, `MetricCard()`, `startEdit()`, `ProjectBudget.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (5 nodes): `FinancialsCashflow()`, `fmt()`, `lastNMonths()`, `monthLabel()`, `FinancialsCashflow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (3 nodes): `downloadGRNChallan()`, `fmtDate()`, `grnChallan.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (3 nodes): `handleSubmit()`, `triggerCelebration()`, `Login.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `NewInvoice()` connect `Community 8` to `Community 0`, `Community 2`?**
  _High betweenness centrality (0.151) - this node is a cross-community bridge._
- **Why does `multiply()` connect `Community 8` to `Community 11`?**
  _High betweenness centrality (0.113) - this node is a cross-community bridge._
- **Why does `calcAmount()` connect `Community 11` to `Community 8`?**
  _High betweenness centrality (0.112) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `handleSessionReply()` (e.g. with `processMessage()` and `clearSession()`) actually correct?**
  _`handleSessionReply()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `processMessage()` (e.g. with `logMessage()` and `sendWA()`) actually correct?**
  _`processMessage()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `handleFinancial()` (e.g. with `processMessage()` and `extractEntities()`) actually correct?**
  _`handleFinancial()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `handleDownloadPDF()` (e.g. with `setColor()` and `setDraw()`) actually correct?**
  _`handleDownloadPDF()` has 9 INFERRED edges - model-reasoned connections that need verification._