# Graph Report - Briklay Fly  (2026-06-12)

## Corpus Check
- 222 files · ~660,463 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 726 nodes · 940 edges · 26 communities detected
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 126 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 57|Community 57]]

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
- `commitEdit()` --calls--> `parseAmount()`  [INFERRED]
  src\components\ProjectBudget.tsx → supabase\functions\whatsapp-webhook\_handlers.ts
- `suggestCostCode()` --calls--> `getCostCode()`  [INFERRED]
  src\components\QuickTransactionSheet.tsx → src\lib\costCodes.ts
- `TxnRow()` --calls--> `formatTxn()`  [INFERRED]
  src\components\TxnRow.tsx → src\lib\formatTxn.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (64): buildConflictPills(), buildNovelVariantPills(), buildPills(), humanLabel(), detectAttributeConflicts(), detectUnit(), dimensionsConflict(), extractNumber() (+56 more)

### Community 1 - "Community 1"
Cohesion: 0.09
Nodes (47): callClaude(), callOpenAI(), classifyImage(), classifyImageAnthropic(), classifyImageOpenAI(), classifyIntent(), classifyIntentAI(), classifyMessage() (+39 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (7): handleSave(), suggestCostCode(), costCodeLabel(), getCostCode(), autoCloseWOIfFullyPaid(), getTxnType(), getTxnType()

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (16): useAuth(), useCan(), useOrgId(), CreateStakeholderForm(), genTxnId(), handlePost(), useSnackbar(), add() (+8 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (18): amountInWords(), amountText(), dataPair(), drawFooter(), drawHeader(), drawLogoMark(), drawRule(), drawSignatures() (+10 more)

### Community 5 - "Community 5"
Cohesion: 0.13
Nodes (16): handleSubmit(), clearAllFilters(), derive(), fmtShortDate(), inr(), isOverdue(), milestoneState(), poFullyReceived() (+8 more)

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (5): PeekLink(), WOPeek(), usePeek(), statusBadgeClass(), WorkOrderDetail()

### Community 7 - "Community 7"
Cohesion: 0.19
Nodes (14): buildExtractionPrompt(), buildReRankPrompt(), cleanExtractionResult(), extractItems(), generateStructuredSkuWithContext(), generateVectorEmbedding(), looksLikePlaceholder(), matchItems() (+6 more)

### Community 8 - "Community 8"
Cohesion: 0.12
Nodes (3): commitEdit(), handleSave(), parseAmount()

### Community 9 - "Community 9"
Cohesion: 0.13
Nodes (4): SourceIcon(), if(), isClientReceipt(), isExcludedFromSpent()

### Community 10 - "Community 10"
Cohesion: 0.15
Nodes (5): h(), SectionLabel(), emptyForm(), handleSave(), openAdd()

### Community 11 - "Community 11"
Cohesion: 0.21
Nodes (9): handler(), close(), go(), handleClose(), handleOpen(), toggle(), close(), handleSave() (+1 more)

### Community 13 - "Community 13"
Cohesion: 0.21
Nodes (7): calcAmount(), getMode(), handleDraftStages(), handleNameBlur(), suggestUnit(), uiAllocateWeighted(), updateStage()

### Community 14 - "Community 14"
Cohesion: 0.2
Nodes (2): handleClose(), handleKeyDown()

### Community 16 - "Community 16"
Cohesion: 0.29
Nodes (7): bandRange(), buildRationale(), draftStages(), extractMeasured(), normalizeWeights(), templateKeyForTrade(), titleCase()

### Community 19 - "Community 19"
Cohesion: 0.29
Nodes (4): normalizeFraction(), scanDimension(), extractAttributesFromInput(), normalizeAttrValue()

### Community 20 - "Community 20"
Cohesion: 0.36
Nodes (4): getInitials(), levenshtein(), matchPayee(), matchProject()

### Community 21 - "Community 21"
Cohesion: 0.43
Nodes (4): genId(), handleKeyDown(), patchRow(), saveRow()

### Community 22 - "Community 22"
Cohesion: 0.43
Nodes (5): TxnRow(), dot(), formatShortDate(), formatTxn(), isCostCode()

### Community 23 - "Community 23"
Cohesion: 0.48
Nodes (5): usePrefetchPO(), usePrefetchStakeholder(), usePrefetchTxn(), usePrefetchWO(), useThrottledPrefetch()

### Community 32 - "Community 32"
Cohesion: 0.5
Nodes (2): FinancialsCashflow(), lastNMonths()

### Community 33 - "Community 33"
Cohesion: 0.5
Nodes (2): handleSubmit(), triggerCelebration()

### Community 34 - "Community 34"
Cohesion: 0.8
Nodes (4): addCustomBrand(), brandsFor(), getCustomBrands(), LS_KEY()

### Community 39 - "Community 39"
Cohesion: 0.67
Nodes (2): handleClose(), handleSubmit()

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (2): downloadGRNChallan(), fmtDate()

### Community 57 - "Community 57"
Cohesion: 0.67
Nodes (1): isStopWord()

## Knowledge Gaps
- **Thin community `Community 14`** (11 nodes): `DrawerSkeleton()`, `filterRow()`, `fmt()`, `formatLedgerDate()`, `getInitials()`, `handleAddTransaction()`, `handleClose()`, `handleKeyDown()`, `monthHeading()`, `monthKey()`, `StakeholderLedgerDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (5 nodes): `FinancialsCashflow()`, `fmt()`, `lastNMonths()`, `monthLabel()`, `FinancialsCashflow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (5 nodes): `handleForgotPassword()`, `handleResendConfirmation()`, `handleSubmit()`, `triggerCelebration()`, `Login.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (4 nodes): `handleClose()`, `handleSubmit()`, `updateRow()`, `QuoteEntryDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (3 nodes): `downloadGRNChallan()`, `fmtDate()`, `grnChallan.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (3 nodes): `isStopWord()`, `stripBrandNames()`, `brandFilter.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `computeLine()` connect `Community 3` to `Community 0`?**
  _High betweenness centrality (0.091) - this node is a cross-community bridge._
- **Why does `NewInvoice()` connect `Community 3` to `Community 8`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **Why does `parseAmount()` connect `Community 8` to `Community 1`, `Community 3`?**
  _High betweenness centrality (0.067) - this node is a cross-community bridge._
- **Are the 9 inferred relationships involving `resolveAgainstSingleFamily()` (e.g. with `addStep()` and `resolveAgainstTree()`) actually correct?**
  _`resolveAgainstSingleFamily()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `handlePillSelection()` (e.g. with `createTrace()` and `addStep()`) actually correct?**
  _`handlePillSelection()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `handleFamilySuggestionClick()` (e.g. with `resolveAgainstTree()` and `buildPills()`) actually correct?**
  _`handleFamilySuggestionClick()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `handleSessionReply()` (e.g. with `processMessage()` and `clearSession()`) actually correct?**
  _`handleSessionReply()` has 5 INFERRED edges - model-reasoned connections that need verification._