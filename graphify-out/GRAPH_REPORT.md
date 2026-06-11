# Graph Report - Briklay Fly  (2026-06-11)

## Corpus Check
- 213 files · ~642,665 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 703 nodes · 919 edges · 26 communities detected
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 127 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]

## God Nodes (most connected - your core abstractions)
1. `resolveAgainstSingleFamily()` - 23 edges
2. `handlePillSelection()` - 22 edges
3. `handleFamilySuggestionClick()` - 18 edges
4. `updateLine()` - 16 edges
5. `handleSessionReply()` - 16 edges
6. `processMessage()` - 12 edges
7. `handleDownloadPDF()` - 11 edges
8. `handleFinancial()` - 11 edges
9. `detectAttributeConflicts()` - 10 edges
10. `extractAttrs()` - 10 edges

## Surprising Connections (you probably didn't know these)
- `isStopWord()` --calls--> `buildPills()`  [INFERRED]
  src\lib\brandFilter.ts → src\lib\buildPillsFromResolution.ts
- `handleDownloadPDF()` --calls--> `SectionLabel()`  [INFERRED]
  src\pages\BillDetail.tsx → src\pages\NewTransaction.tsx
- `handleSave()` --calls--> `parseAmount()`  [INFERRED]
  src\pages\ProjectPurchaseOrders.tsx → supabase\functions\whatsapp-webhook\_handlers.ts
- `commitEdit()` --calls--> `parseAmount()`  [INFERRED]
  src\components\ProjectBudget.tsx → supabase\functions\whatsapp-webhook\_handlers.ts
- `suggestCostCode()` --calls--> `getCostCode()`  [INFERRED]
  src\components\QuickTransactionSheet.tsx → src\lib\costCodes.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (60): buildConflictPills(), buildNovelVariantPills(), buildPills(), humanLabel(), detectAttributeConflicts(), detectUnit(), dimensionsConflict(), extractNumber() (+52 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (11): handleSave(), suggestCostCode(), costCodeLabel(), getCostCode(), autoCloseWOIfFullyPaid(), getTxnType(), h(), handleSave() (+3 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (12): useAuth(), useCan(), useOrgId(), PeekLink(), CreateStakeholderForm(), genTxnId(), handlePost(), useSnackbar() (+4 more)

### Community 3 - "Community 3"
Cohesion: 0.12
Nodes (29): commitEdit(), buildConfirmMsg(), buildDescription(), createRoughEntry(), fetchImageAsBase64(), findTopMatches(), fmtAmount(), handleFinancial() (+21 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (18): amountInWords(), amountText(), dataPair(), drawFooter(), drawHeader(), drawLogoMark(), drawRule(), drawSignatures() (+10 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (14): add(), applyPercent(), multiply(), parseAmount(), round(), subtract(), sum(), NewInvoice() (+6 more)

### Community 6 - "Community 6"
Cohesion: 0.13
Nodes (16): handleSubmit(), clearAllFilters(), derive(), fmtShortDate(), inr(), isOverdue(), milestoneState(), poFullyReceived() (+8 more)

### Community 7 - "Community 7"
Cohesion: 0.18
Nodes (20): callClaude(), callOpenAI(), classifyImage(), classifyImageAnthropic(), classifyImageOpenAI(), classifyIntent(), classifyIntentAI(), classifyMessage() (+12 more)

### Community 8 - "Community 8"
Cohesion: 0.19
Nodes (14): buildExtractionPrompt(), buildReRankPrompt(), cleanExtractionResult(), extractItems(), generateStructuredSkuWithContext(), generateVectorEmbedding(), looksLikePlaceholder(), matchItems() (+6 more)

### Community 9 - "Community 9"
Cohesion: 0.13
Nodes (4): SourceIcon(), if(), isClientReceipt(), isExcludedFromSpent()

### Community 10 - "Community 10"
Cohesion: 0.21
Nodes (9): handler(), close(), go(), handleClose(), handleOpen(), toggle(), close(), handleSave() (+1 more)

### Community 12 - "Community 12"
Cohesion: 0.2
Nodes (2): handleClose(), handleKeyDown()

### Community 14 - "Community 14"
Cohesion: 0.2
Nodes (1): handleSave()

### Community 16 - "Community 16"
Cohesion: 0.29
Nodes (4): normalizeFraction(), scanDimension(), extractAttributesFromInput(), normalizeAttrValue()

### Community 17 - "Community 17"
Cohesion: 0.36
Nodes (4): getInitials(), levenshtein(), matchPayee(), matchProject()

### Community 18 - "Community 18"
Cohesion: 0.43
Nodes (4): genId(), handleKeyDown(), patchRow(), saveRow()

### Community 19 - "Community 19"
Cohesion: 0.48
Nodes (5): usePrefetchPO(), usePrefetchStakeholder(), usePrefetchTxn(), usePrefetchWO(), useThrottledPrefetch()

### Community 21 - "Community 21"
Cohesion: 0.43
Nodes (5): TxnRow(), dot(), formatShortDate(), formatTxn(), isCostCode()

### Community 24 - "Community 24"
Cohesion: 0.38
Nodes (3): emptyForm(), handleSave(), openAdd()

### Community 30 - "Community 30"
Cohesion: 0.6
Nodes (4): matchSKUs(), matchSKUsFromFile(), matchSKUsFromText(), handleDocumentUpload()

### Community 31 - "Community 31"
Cohesion: 0.5
Nodes (2): FinancialsCashflow(), lastNMonths()

### Community 32 - "Community 32"
Cohesion: 0.5
Nodes (2): handleSubmit(), triggerCelebration()

### Community 33 - "Community 33"
Cohesion: 0.8
Nodes (4): addCustomBrand(), brandsFor(), getCustomBrands(), LS_KEY()

### Community 38 - "Community 38"
Cohesion: 0.67
Nodes (2): handleClose(), handleSubmit()

### Community 51 - "Community 51"
Cohesion: 0.67
Nodes (1): isStopWord()

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (2): downloadGRNChallan(), fmtDate()

## Knowledge Gaps
- **Thin community `Community 12`** (11 nodes): `DrawerSkeleton()`, `filterRow()`, `fmt()`, `formatLedgerDate()`, `getInitials()`, `handleAddTransaction()`, `handleClose()`, `handleKeyDown()`, `monthHeading()`, `monthKey()`, `StakeholderLedgerDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 14`** (10 nodes): `async()`, `dateRange()`, `Dropdown()`, `FilterChip()`, `fmtDate()`, `fmtShortDate()`, `getItemsPreview()`, `handleSave()`, `isOverdue()`, `ProjectPurchaseOrders.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (5 nodes): `FinancialsCashflow()`, `fmt()`, `lastNMonths()`, `monthLabel()`, `FinancialsCashflow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (5 nodes): `handleForgotPassword()`, `handleResendConfirmation()`, `handleSubmit()`, `triggerCelebration()`, `Login.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (4 nodes): `handleClose()`, `handleSubmit()`, `updateRow()`, `QuoteEntryDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (3 nodes): `isStopWord()`, `stripBrandNames()`, `brandFilter.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (3 nodes): `downloadGRNChallan()`, `fmtDate()`, `grnChallan.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `computeLine()` connect `Community 5` to `Community 0`?**
  _High betweenness centrality (0.116) - this node is a cross-community bridge._
- **Why does `NewInvoice()` connect `Community 5` to `Community 2`, `Community 3`?**
  _High betweenness centrality (0.108) - this node is a cross-community bridge._
- **Why does `parseAmount()` connect `Community 3` to `Community 5`, `Community 14`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **Are the 9 inferred relationships involving `resolveAgainstSingleFamily()` (e.g. with `addStep()` and `resolveAgainstTree()`) actually correct?**
  _`resolveAgainstSingleFamily()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `handlePillSelection()` (e.g. with `createTrace()` and `addStep()`) actually correct?**
  _`handlePillSelection()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `handleFamilySuggestionClick()` (e.g. with `resolveAgainstTree()` and `buildPills()`) actually correct?**
  _`handleFamilySuggestionClick()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `handleSessionReply()` (e.g. with `processMessage()` and `clearSession()`) actually correct?**
  _`handleSessionReply()` has 5 INFERRED edges - model-reasoned connections that need verification._