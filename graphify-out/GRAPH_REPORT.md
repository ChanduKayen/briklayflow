# Graph Report - Briklay Fly  (2026-06-13)

## Corpus Check
- 232 files · ~669,858 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 777 nodes · 996 edges · 28 communities detected
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 130 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 60|Community 60]]

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
- `handleDownloadPDF()` --calls--> `SectionLabel()`  [INFERRED]
  src\pages\BillDetail.tsx → src\pages\NewTransaction.tsx
- `handleSave()` --calls--> `parseAmount()`  [INFERRED]
  src\pages\ProjectPurchaseOrders.tsx → supabase\functions\whatsapp-webhook\_handlers.ts
- `commitEdit()` --calls--> `parseAmount()`  [INFERRED]
  src\components\ProjectBudget.tsx → supabase\functions\whatsapp-webhook\_handlers.ts
- `suggestCostCode()` --calls--> `getCostCode()`  [INFERRED]
  src\components\QuickTransactionSheet.tsx → src\lib\costCodes.ts
- `TxnRow()` --calls--> `formatTxn()`  [INFERRED]
  src\components\TxnRow.tsx → src\lib\formatTxn.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (61): isStopWord(), buildConflictPills(), buildNovelVariantPills(), buildPills(), humanLabel(), detectAttributeConflicts(), detectUnit(), dimensionsConflict() (+53 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (49): commitEdit(), callClaude(), callOpenAI(), classifyImage(), classifyImageAnthropic(), classifyImageOpenAI(), classifyIntent(), classifyIntentAI() (+41 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (14): handleSave(), suggestCostCode(), costCodeLabel(), getCostCode(), deriveDirection(), escapeRegExp(), isNotLinked(), parseStageLabel() (+6 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (20): useAuth(), useCan(), useOrgId(), CreateStakeholderForm(), genTxnId(), handlePost(), useSnackbar(), digits() (+12 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (18): amountInWords(), amountText(), dataPair(), drawFooter(), drawHeader(), drawLogoMark(), drawRule(), drawSignatures() (+10 more)

### Community 5 - "Community 5"
Cohesion: 0.14
Nodes (15): clearAllFilters(), derive(), fmtShortDate(), inr(), isOverdue(), milestoneState(), poFullyReceived(), poHasBill() (+7 more)

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (5): PeekLink(), WOPeek(), usePeek(), statusBadgeClass(), WorkOrderDetail()

### Community 7 - "Community 7"
Cohesion: 0.19
Nodes (14): buildExtractionPrompt(), buildReRankPrompt(), cleanExtractionResult(), extractItems(), generateStructuredSkuWithContext(), generateVectorEmbedding(), looksLikePlaceholder(), matchItems() (+6 more)

### Community 8 - "Community 8"
Cohesion: 0.15
Nodes (5): h(), SectionLabel(), emptyForm(), handleSave(), openAdd()

### Community 9 - "Community 9"
Cohesion: 0.21
Nodes (9): handler(), close(), go(), handleClose(), handleOpen(), toggle(), close(), handleSave() (+1 more)

### Community 10 - "Community 10"
Cohesion: 0.19
Nodes (8): createParty(), fileRoughEntry(), genTxnId(), rejectRoughEntry(), addParty(), mark(), runFile(), runReject()

### Community 12 - "Community 12"
Cohesion: 0.21
Nodes (7): calcAmount(), getMode(), handleDraftStages(), handleNameBlur(), suggestUnit(), uiAllocateWeighted(), updateStage()

### Community 13 - "Community 13"
Cohesion: 0.2
Nodes (2): handleClose(), handleKeyDown()

### Community 15 - "Community 15"
Cohesion: 0.29
Nodes (7): bandRange(), buildRationale(), draftStages(), extractMeasured(), normalizeWeights(), templateKeyForTrade(), titleCase()

### Community 17 - "Community 17"
Cohesion: 0.22
Nodes (2): isClientReceipt(), isExcludedFromSpent()

### Community 18 - "Community 18"
Cohesion: 0.2
Nodes (1): handleSave()

### Community 21 - "Community 21"
Cohesion: 0.29
Nodes (4): normalizeFraction(), scanDimension(), extractAttributesFromInput(), normalizeAttrValue()

### Community 22 - "Community 22"
Cohesion: 0.36
Nodes (4): getInitials(), levenshtein(), matchPayee(), matchProject()

### Community 23 - "Community 23"
Cohesion: 0.43
Nodes (4): genId(), handleKeyDown(), patchRow(), saveRow()

### Community 24 - "Community 24"
Cohesion: 0.48
Nodes (5): usePrefetchPO(), usePrefetchStakeholder(), usePrefetchTxn(), usePrefetchWO(), useThrottledPrefetch()

### Community 26 - "Community 26"
Cohesion: 0.43
Nodes (5): TxnRow(), dot(), formatShortDate(), formatTxn(), isCostCode()

### Community 35 - "Community 35"
Cohesion: 0.6
Nodes (4): matchSKUs(), matchSKUsFromFile(), matchSKUsFromText(), handleDocumentUpload()

### Community 36 - "Community 36"
Cohesion: 0.5
Nodes (2): FinancialsCashflow(), lastNMonths()

### Community 37 - "Community 37"
Cohesion: 0.5
Nodes (2): handleSubmit(), triggerCelebration()

### Community 38 - "Community 38"
Cohesion: 0.8
Nodes (4): addCustomBrand(), brandsFor(), getCustomBrands(), LS_KEY()

### Community 43 - "Community 43"
Cohesion: 0.67
Nodes (2): handleClose(), handleSubmit()

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (2): onlyDigits(), StartOnWhatsApp()

### Community 60 - "Community 60"
Cohesion: 1.0
Nodes (2): downloadGRNChallan(), fmtDate()

## Knowledge Gaps
- **Thin community `Community 13`** (11 nodes): `DrawerSkeleton()`, `filterRow()`, `fmt()`, `formatLedgerDate()`, `getInitials()`, `handleAddTransaction()`, `handleClose()`, `handleKeyDown()`, `monthHeading()`, `monthKey()`, `StakeholderLedgerDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (10 nodes): `AnimatedNumber()`, `e()`, `fmtAmt()`, `fmtDate()`, `genTxnId()`, `h()`, `if()`, `isClientReceipt()`, `isExcludedFromSpent()`, `ProjectDetail.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (10 nodes): `async()`, `dateRange()`, `Dropdown()`, `FilterChip()`, `fmtDate()`, `fmtShortDate()`, `getItemsPreview()`, `handleSave()`, `isOverdue()`, `ProjectPurchaseOrders.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (5 nodes): `FinancialsCashflow()`, `fmt()`, `lastNMonths()`, `monthLabel()`, `FinancialsCashflow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (5 nodes): `handleForgotPassword()`, `handleResendConfirmation()`, `handleSubmit()`, `triggerCelebration()`, `Login.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (4 nodes): `handleClose()`, `handleSubmit()`, `updateRow()`, `QuoteEntryDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (3 nodes): `onlyDigits()`, `StartOnWhatsApp()`, `StartOnWhatsApp.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (3 nodes): `downloadGRNChallan()`, `fmtDate()`, `grnChallan.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `NewInvoice()` connect `Community 3` to `Community 1`?**
  _High betweenness centrality (0.083) - this node is a cross-community bridge._
- **Why does `computeLine()` connect `Community 3` to `Community 0`?**
  _High betweenness centrality (0.081) - this node is a cross-community bridge._
- **Why does `parseAmount()` connect `Community 1` to `Community 18`, `Community 3`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **Are the 9 inferred relationships involving `resolveAgainstSingleFamily()` (e.g. with `addStep()` and `resolveAgainstTree()`) actually correct?**
  _`resolveAgainstSingleFamily()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `handlePillSelection()` (e.g. with `createTrace()` and `addStep()`) actually correct?**
  _`handlePillSelection()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `handleFamilySuggestionClick()` (e.g. with `resolveAgainstTree()` and `buildPills()`) actually correct?**
  _`handleFamilySuggestionClick()` has 7 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `handleSessionReply()` (e.g. with `processMessage()` and `clearSession()`) actually correct?**
  _`handleSessionReply()` has 5 INFERRED edges - model-reasoned connections that need verification._