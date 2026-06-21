# Graph Report - Briklay Fly  (2026-06-20)

## Corpus Check
- 310 files · ~754,032 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1072 nodes · 1581 edges · 35 communities detected
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 218 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 70|Community 70]]

## God Nodes (most connected - your core abstractions)
1. `pick()` - 31 edges
2. `resolveAgainstSingleFamily()` - 23 edges
3. `dispatch()` - 23 edges
4. `handlePillSelection()` - 22 edges
5. `handleFamilySuggestionClick()` - 18 edges
6. `runTransaction()` - 17 edges
7. `updateLine()` - 16 edges
8. `send()` - 15 edges
9. `handleSessionReply()` - 15 edges
10. `answerTransaction()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `handleDownloadPDF()` --calls--> `SectionLabel()`  [INFERRED]
  src\pages\BillDetail.tsx → src\pages\NewTransaction.tsx
- `suggestCostCode()` --calls--> `getCostCode()`  [INFERRED]
  src\components\QuickTransactionSheet.tsx → src\lib\costCodes.ts
- `useSnackbar()` --calls--> `NewInvoice()`  [INFERRED]
  src\components\Snackbar.tsx → src\pages\NewInvoice.tsx
- `TxnRow()` --calls--> `formatTxn()`  [INFERRED]
  src\components\TxnRow.tsx → src\lib\formatTxn.ts
- `isStopWord()` --calls--> `buildPills()`  [INFERRED]
  src\lib\brandFilter.ts → src\lib\buildPillsFromResolution.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (65): isStopWord(), buildConflictPills(), buildNovelVariantPills(), buildPills(), humanLabel(), normalizeFraction(), scanDimension(), extractAttributesFromInput() (+57 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (63): composeLLM(), fallbackReply(), isGreeting(), runConcierge(), systemFor(), userContent(), answerProcurement(), handleSingle() (+55 more)

### Community 2 - "Community 2"
Cohesion: 0.1
Nodes (43): parseDigitToken(), parseSpokenAmount(), callClaude(), callOpenAI(), classifyImage(), classifyImageAnthropic(), classifyImageOpenAI(), classifyIntent() (+35 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (13): useAuth(), useCan(), useOrgId(), PeekLink(), CreateStakeholderForm(), genTxnId(), handlePost(), useSnackbar() (+5 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (14): handleSave(), suggestCostCode(), markGeneral(), costCodeLabel(), getCostCode(), classifyExpenseHead(), autoCloseWOIfFullyPaid(), h() (+6 more)

### Community 5 - "Community 5"
Cohesion: 0.13
Nodes (33): ackLine(), buildSourcingPrompt(), buildVendorList(), entryLine(), mAbandoned(), mAccessPaused(), mAskAmount(), mAskBoth() (+25 more)

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (18): amountInWords(), amountText(), dataPair(), drawFooter(), drawHeader(), drawLogoMark(), drawRule(), drawSignatures() (+10 more)

### Community 7 - "Community 7"
Cohesion: 0.09
Nodes (13): parseAmount(), commitEdit(), add(), applyPercent(), multiply(), parseAmount(), round(), subtract() (+5 more)

### Community 8 - "Community 8"
Cohesion: 0.12
Nodes (21): changeNumber(), changeRole(), daysLeft(), digits(), disableMember(), doEnable(), enableMember(), intlPhone() (+13 more)

### Community 9 - "Community 9"
Cohesion: 0.16
Nodes (24): buildConfirmMsg(), buildDescription(), createRoughEntry(), fetchImageAsBase64(), findTopMatches(), fmtAmount(), handleFinancial(), handleGeneral() (+16 more)

### Community 10 - "Community 10"
Cohesion: 0.12
Nodes (22): sendTypingIndicator(), constantTimeEqual(), guessLang(), handleProspect(), processJob(), recordInbound(), verifyMetaSignature(), describeImage() (+14 more)

### Community 11 - "Community 11"
Cohesion: 0.13
Nodes (15): clearAllFilters(), derive(), fmtShortDate(), inr(), isOverdue(), milestoneState(), poFullyReceived(), poHasBill() (+7 more)

### Community 12 - "Community 12"
Cohesion: 0.11
Nodes (15): handler(), close(), go(), handleClose(), handleOpen(), toggle(), close(), handleSave() (+7 more)

### Community 13 - "Community 13"
Cohesion: 0.16
Nodes (13): createParty(), errMessage(), fileRoughEntry(), fileRoughEntrySplit(), genTxnId(), rejectRoughEntry(), restoreRoughEntry(), addParty() (+5 more)

### Community 14 - "Community 14"
Cohesion: 0.17
Nodes (14): deriveDirection(), escapeRegExp(), isGeneralExpense(), isNotLinked(), parseStageLabel(), payeeLabel(), resolveAnchor(), emit() (+6 more)

### Community 15 - "Community 15"
Cohesion: 0.12
Nodes (5): openDoc(), resolveDocUrl(), async(), chip(), toggle()

### Community 16 - "Community 16"
Cohesion: 0.19
Nodes (14): buildExtractionPrompt(), buildReRankPrompt(), cleanExtractionResult(), extractItems(), generateStructuredSkuWithContext(), generateVectorEmbedding(), looksLikePlaceholder(), matchItems() (+6 more)

### Community 17 - "Community 17"
Cohesion: 0.17
Nodes (9): daysLeft(), digits(), doEnable(), intlPhone(), local10(), onToggle(), prettyPhone(), roleLabel() (+1 more)

### Community 18 - "Community 18"
Cohesion: 0.14
Nodes (2): clearPersistedCache(), doSignOut()

### Community 19 - "Community 19"
Cohesion: 0.21
Nodes (7): calcAmount(), getMode(), handleDraftStages(), handleNameBlur(), suggestUnit(), uiAllocateWeighted(), updateStage()

### Community 20 - "Community 20"
Cohesion: 0.32
Nodes (11): act(), briklayChat(), checkRegistration(), greetOnce(), local10(), onlyDigits(), onTap(), prettyPhone() (+3 more)

### Community 22 - "Community 22"
Cohesion: 0.2
Nodes (2): handleClose(), handleKeyDown()

### Community 24 - "Community 24"
Cohesion: 0.29
Nodes (7): bandRange(), buildRationale(), draftStages(), extractMeasured(), normalizeWeights(), templateKeyForTrade(), titleCase()

### Community 25 - "Community 25"
Cohesion: 0.31
Nodes (8): addCustomBrand(), brandsFor(), getCustomBrands(), LS_KEY(), matchSKUs(), matchSKUsFromFile(), matchSKUsFromText(), handleDocumentUpload()

### Community 26 - "Community 26"
Cohesion: 0.22
Nodes (2): isClientReceipt(), isExcludedFromSpent()

### Community 29 - "Community 29"
Cohesion: 0.39
Nodes (7): classifyWithLLM(), detectLanguage(), extractJson(), isBareAffirmNeg(), looksActionableTxn(), routeMessage(), validate()

### Community 31 - "Community 31"
Cohesion: 0.36
Nodes (4): getInitials(), levenshtein(), matchPayee(), matchProject()

### Community 32 - "Community 32"
Cohesion: 0.43
Nodes (4): genId(), handleKeyDown(), patchRow(), saveRow()

### Community 33 - "Community 33"
Cohesion: 0.43
Nodes (5): TxnRow(), dot(), formatShortDate(), formatTxn(), isCostCode()

### Community 34 - "Community 34"
Cohesion: 0.48
Nodes (5): usePrefetchPO(), usePrefetchStakeholder(), usePrefetchTxn(), usePrefetchWO(), useThrottledPrefetch()

### Community 44 - "Community 44"
Cohesion: 0.5
Nodes (2): FinancialsCashflow(), lastNMonths()

### Community 45 - "Community 45"
Cohesion: 0.5
Nodes (2): handleSubmit(), triggerCelebration()

### Community 47 - "Community 47"
Cohesion: 0.6
Nodes (2): buildComponents(), sendTemplate()

### Community 51 - "Community 51"
Cohesion: 0.67
Nodes (2): handleClose(), handleSubmit()

### Community 70 - "Community 70"
Cohesion: 1.0
Nodes (2): downloadGRNChallan(), fmtDate()

## Knowledge Gaps
- **Thin community `Community 18`** (14 nodes): `clearPersistedCache()`, `shouldPersistQuery()`, `can()`, `close()`, `doSignOut()`, `e()`, `h()`, `initials()`, `isActive()`, `measure()`, `RailItem()`, `RailLabel()`, `BriklayRail.tsx`, `queryClient.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (11 nodes): `DrawerSkeleton()`, `filterRow()`, `fmt()`, `formatLedgerDate()`, `getInitials()`, `handleAddTransaction()`, `handleClose()`, `handleKeyDown()`, `monthHeading()`, `monthKey()`, `StakeholderLedgerDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (10 nodes): `AnimatedNumber()`, `e()`, `fmtAmt()`, `fmtDate()`, `genTxnId()`, `h()`, `if()`, `isClientReceipt()`, `isExcludedFromSpent()`, `ProjectDetail.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (5 nodes): `FinancialsCashflow()`, `fmt()`, `lastNMonths()`, `monthLabel()`, `FinancialsCashflow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (5 nodes): `handleForgotPassword()`, `handleResendConfirmation()`, `handleSubmit()`, `triggerCelebration()`, `Login.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (5 nodes): `buildComponents()`, `sendTemplate()`, `index.ts`, `wa-templates.ts`, `whatsapp.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (4 nodes): `handleClose()`, `handleSubmit()`, `updateRow()`, `QuoteEntryDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (3 nodes): `downloadGRNChallan()`, `fmtDate()`, `grnChallan.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `NewInvoice()` connect `Community 7` to `Community 3`?**
  _High betweenness centrality (0.117) - this node is a cross-community bridge._
- **Why does `parseAmount()` connect `Community 7` to `Community 1`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **Why does `computeLine()` connect `Community 7` to `Community 0`?**
  _High betweenness centrality (0.074) - this node is a cross-community bridge._
- **Are the 9 inferred relationships involving `resolveAgainstSingleFamily()` (e.g. with `addStep()` and `resolveAgainstTree()`) actually correct?**
  _`resolveAgainstSingleFamily()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 16 inferred relationships involving `dispatch()` (e.g. with `processJob()` and `send()`) actually correct?**
  _`dispatch()` has 16 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `handlePillSelection()` (e.g. with `createTrace()` and `addStep()`) actually correct?**
  _`handlePillSelection()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 7 inferred relationships involving `handleFamilySuggestionClick()` (e.g. with `resolveAgainstTree()` and `buildPills()`) actually correct?**
  _`handleFamilySuggestionClick()` has 7 INFERRED edges - model-reasoned connections that need verification._