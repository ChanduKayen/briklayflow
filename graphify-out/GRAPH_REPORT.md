# Graph Report - Briklay Fly  (2026-06-26)

## Corpus Check
- 343 files · ~790,111 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1203 nodes · 1798 edges · 43 communities detected
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 246 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]

## God Nodes (most connected - your core abstractions)
1. `pick()` - 35 edges
2. `dispatch()` - 25 edges
3. `resolveAgainstSingleFamily()` - 23 edges
4. `handlePillSelection()` - 22 edges
5. `send()` - 19 edges
6. `handleFamilySuggestionClick()` - 18 edges
7. `runTransaction()` - 18 edges
8. `updateLine()` - 16 edges
9. `handleSessionReply()` - 15 edges
10. `answerTransaction()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `handleDownloadPDF()` --calls--> `SectionLabel()`  [INFERRED]
  src\pages\BillDetail.tsx → src\pages\NewTransaction.tsx
- `processJob()` --calls--> `sendTypingIndicator()`  [INFERRED]
  supabase\functions\whatsapp-webhook\index.ts → supabase\functions\whatsapp-webhook\_format.ts
- `llm()` --calls--> `enrichProject()`  [INFERRED]
  scripts\siteops-enrich.mjs → src\lib\siteOps\enrich.ts
- `useSnackbar()` --calls--> `NewInvoice()`  [INFERRED]
  src\components\Snackbar.tsx → src\pages\NewInvoice.tsx
- `TxnRow()` --calls--> `formatTxn()`  [INFERRED]
  src\components\TxnRow.tsx → src\lib\formatTxn.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (65): isStopWord(), buildConflictPills(), buildNovelVariantPills(), buildPills(), humanLabel(), normalizeFraction(), scanDimension(), extractAttributesFromInput() (+57 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (76): composeLLM(), fallbackReply(), isGreeting(), runConcierge(), systemFor(), userContent(), answerProcurement(), commitInterruptedProc() (+68 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (21): parseAmount(), commitEdit(), useSnackbar(), add(), applyPercent(), multiply(), parseAmount(), round() (+13 more)

### Community 3 - "Community 3"
Cohesion: 0.1
Nodes (43): parseDigitToken(), parseSpokenAmount(), callClaude(), callOpenAI(), classifyImage(), classifyImageAnthropic(), classifyImageOpenAI(), classifyIntent() (+35 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (23): commitVendorPayment(), createVendorPurchase(), getVendorHub(), num(), poName(), projectIdOf(), readVendorBill(), vendorPaidToDate() (+15 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (29): allocIdOf(), attachToContract(), clearOneTime(), createContract(), fallbackTitle(), fileAsLabour(), generateContractTitle(), getTrackingOptions() (+21 more)

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (37): ackLine(), buildPickVendorsFlow(), buildSelectVendorFlow(), buildSourcingPrompt(), buildVendorList(), entryLine(), mAbandoned(), mAccessPaused() (+29 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (16): useAuth(), useCan(), useOrgId(), PeekLink(), fmtDate(), Label(), summarizeScope(), woTone() (+8 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (18): amountInWords(), amountText(), dataPair(), drawFooter(), drawHeader(), drawLogoMark(), drawRule(), drawSignatures() (+10 more)

### Community 9 - "Community 9"
Cohesion: 0.12
Nodes (21): changeNumber(), changeRole(), daysLeft(), digits(), disableMember(), doEnable(), enableMember(), intlPhone() (+13 more)

### Community 10 - "Community 10"
Cohesion: 0.16
Nodes (24): buildConfirmMsg(), buildDescription(), createRoughEntry(), fetchImageAsBase64(), findTopMatches(), fmtAmount(), handleFinancial(), handleGeneral() (+16 more)

### Community 11 - "Community 11"
Cohesion: 0.13
Nodes (15): clearAllFilters(), derive(), fmtShortDate(), inr(), isOverdue(), milestoneState(), poFullyReceived(), poHasBill() (+7 more)

### Community 12 - "Community 12"
Cohesion: 0.12
Nodes (21): constantTimeEqual(), guessLang(), handleProspect(), processJob(), recordInbound(), verifyMetaSignature(), describeImage(), downloadMedia() (+13 more)

### Community 13 - "Community 13"
Cohesion: 0.11
Nodes (5): openDoc(), resolveDocUrl(), async(), chip(), toggle()

### Community 14 - "Community 14"
Cohesion: 0.17
Nodes (14): deriveDirection(), escapeRegExp(), isGeneralExpense(), isNotLinked(), parseStageLabel(), payeeLabel(), resolveAnchor(), emit() (+6 more)

### Community 15 - "Community 15"
Cohesion: 0.19
Nodes (14): buildExtractionPrompt(), buildReRankPrompt(), cleanExtractionResult(), extractItems(), generateStructuredSkuWithContext(), generateVectorEmbedding(), looksLikePlaceholder(), matchItems() (+6 more)

### Community 16 - "Community 16"
Cohesion: 0.17
Nodes (9): daysLeft(), digits(), doEnable(), intlPhone(), local10(), onToggle(), prettyPhone(), roleLabel() (+1 more)

### Community 17 - "Community 17"
Cohesion: 0.21
Nodes (11): errMessage(), fileRoughEntry(), fileRoughEntrySplit(), genTxnId(), rejectRoughEntry(), restoreRoughEntry(), runFile(), runReject() (+3 more)

### Community 18 - "Community 18"
Cohesion: 0.19
Nodes (10): handler(), close(), go(), handleClose(), handleOpen(), toggle(), close(), handleSave() (+2 more)

### Community 19 - "Community 19"
Cohesion: 0.15
Nodes (6): handleSave(), suggestCostCode(), costCodeLabel(), getCostCode(), classifyExpenseHead(), autoCloseWOIfFullyPaid()

### Community 20 - "Community 20"
Cohesion: 0.14
Nodes (2): clearPersistedCache(), doSignOut()

### Community 22 - "Community 22"
Cohesion: 0.32
Nodes (11): act(), briklayChat(), checkRegistration(), greetOnce(), local10(), onlyDigits(), onTap(), prettyPhone() (+3 more)

### Community 23 - "Community 23"
Cohesion: 0.26
Nodes (9): submit(), buildStack(), expand(), habitableLabels(), unitLabels(), upperLabel(), generateSiteTasks(), planReplaceAll() (+1 more)

### Community 25 - "Community 25"
Cohesion: 0.2
Nodes (2): handleClose(), handleKeyDown()

### Community 27 - "Community 27"
Cohesion: 0.29
Nodes (7): bandRange(), buildRationale(), draftStages(), extractMeasured(), normalizeWeights(), templateKeyForTrade(), titleCase()

### Community 28 - "Community 28"
Cohesion: 0.22
Nodes (2): isClientReceipt(), isExcludedFromSpent()

### Community 30 - "Community 30"
Cohesion: 0.36
Nodes (8): classifyWithLLM(), detectLanguage(), extractJson(), isBareAffirmNeg(), looksActionableProcurement(), looksActionableTxn(), routeMessage(), validate()

### Community 32 - "Community 32"
Cohesion: 0.36
Nodes (7): llm(), buildEnrichUserPrompt(), enrichProject(), planFanOut(), safeParseJSON(), stackSummary(), validatePhaseEnrichment()

### Community 35 - "Community 35"
Cohesion: 0.39
Nodes (4): groupTasks(), isParking(), levelLabel(), phaseLabel()

### Community 36 - "Community 36"
Cohesion: 0.36
Nodes (4): getInitials(), levenshtein(), matchPayee(), matchProject()

### Community 37 - "Community 37"
Cohesion: 0.43
Nodes (4): genId(), handleKeyDown(), patchRow(), saveRow()

### Community 38 - "Community 38"
Cohesion: 0.48
Nodes (5): usePrefetchPO(), usePrefetchStakeholder(), usePrefetchTxn(), usePrefetchWO(), useThrottledPrefetch()

### Community 40 - "Community 40"
Cohesion: 0.43
Nodes (5): TxnRow(), dot(), formatShortDate(), formatTxn(), isCostCode()

### Community 41 - "Community 41"
Cohesion: 0.33
Nodes (3): handleCreateProject(), fmtProjectId(), uniqueProjectId()

### Community 48 - "Community 48"
Cohesion: 0.5
Nodes (2): prefetchTxn(), txnPeekKey()

### Community 51 - "Community 51"
Cohesion: 0.6
Nodes (4): matchSKUs(), matchSKUsFromFile(), matchSKUsFromText(), handleDocumentUpload()

### Community 52 - "Community 52"
Cohesion: 0.5
Nodes (2): FinancialsCashflow(), lastNMonths()

### Community 53 - "Community 53"
Cohesion: 0.5
Nodes (2): handleSubmit(), triggerCelebration()

### Community 54 - "Community 54"
Cohesion: 0.8
Nodes (4): addCustomBrand(), brandsFor(), getCustomBrands(), LS_KEY()

### Community 57 - "Community 57"
Cohesion: 0.6
Nodes (2): buildComponents(), sendTemplate()

### Community 62 - "Community 62"
Cohesion: 0.67
Nodes (2): handleClose(), handleSubmit()

### Community 80 - "Community 80"
Cohesion: 1.0
Nodes (2): downloadGRNChallan(), fmtDate()

### Community 81 - "Community 81"
Cohesion: 1.0
Nodes (2): poGateState(), poIsPriced()

## Knowledge Gaps
- **Thin community `Community 20`** (14 nodes): `clearPersistedCache()`, `shouldPersistQuery()`, `can()`, `close()`, `doSignOut()`, `e()`, `h()`, `initials()`, `isActive()`, `measure()`, `RailItem()`, `RailLabel()`, `BriklayRail.tsx`, `queryClient.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (11 nodes): `DrawerSkeleton()`, `filterRow()`, `fmt()`, `formatLedgerDate()`, `getInitials()`, `handleAddTransaction()`, `handleClose()`, `handleKeyDown()`, `monthHeading()`, `monthKey()`, `StakeholderLedgerDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (10 nodes): `AnimatedNumber()`, `e()`, `fmtAmt()`, `fmtDate()`, `genTxnId()`, `h()`, `if()`, `isClientReceipt()`, `isExcludedFromSpent()`, `ProjectDetail.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (5 nodes): `fmtDate()`, `prefetchTxn()`, `txnPeekFn()`, `txnPeekKey()`, `TransactionPeek.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (5 nodes): `FinancialsCashflow()`, `fmt()`, `lastNMonths()`, `monthLabel()`, `FinancialsCashflow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (5 nodes): `handleForgotPassword()`, `handleResendConfirmation()`, `handleSubmit()`, `triggerCelebration()`, `Login.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (5 nodes): `buildComponents()`, `sendTemplate()`, `index.ts`, `wa-templates.ts`, `whatsapp.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (4 nodes): `handleClose()`, `handleSubmit()`, `updateRow()`, `QuoteEntryDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (3 nodes): `downloadGRNChallan()`, `fmtDate()`, `grnChallan.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (3 nodes): `poGateState()`, `poIsPriced()`, `poLifecycle.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `NewInvoice()` connect `Community 2` to `Community 7`?**
  _High betweenness centrality (0.113) - this node is a cross-community bridge._
- **Why does `computeLine()` connect `Community 2` to `Community 0`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **Why does `parseAmount()` connect `Community 2` to `Community 1`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Are the 18 inferred relationships involving `dispatch()` (e.g. with `processJob()` and `send()`) actually correct?**
  _`dispatch()` has 18 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `resolveAgainstSingleFamily()` (e.g. with `addStep()` and `resolveAgainstTree()`) actually correct?**
  _`resolveAgainstSingleFamily()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `handlePillSelection()` (e.g. with `createTrace()` and `addStep()`) actually correct?**
  _`handlePillSelection()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 17 inferred relationships involving `send()` (e.g. with `processJob()` and `dispatch()`) actually correct?**
  _`send()` has 17 INFERRED edges - model-reasoned connections that need verification._