# Graph Report - Briklay Fly  (2026-06-27)

## Corpus Check
- 378 files · ~836,844 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1381 nodes · 2116 edges · 43 communities detected
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 301 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]

## God Nodes (most connected - your core abstractions)
1. `pick()` - 35 edges
2. `dispatch()` - 26 edges
3. `send()` - 25 edges
4. `resolveAgainstSingleFamily()` - 23 edges
5. `handlePillSelection()` - 22 edges
6. `handleFamilySuggestionClick()` - 18 edges
7. `runTransaction()` - 18 edges
8. `updateLine()` - 16 edges
9. `handleSessionReply()` - 15 edges
10. `answerTransaction()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `handleDownloadPDF()` --calls--> `SectionLabel()`  [INFERRED]
  src\pages\BillDetail.tsx → src\pages\NewTransaction.tsx
- `cadenceFor()` --calls--> `loadCadenceMap()`  [INFERRED]
  supabase\functions\siteops-chase\index.ts → supabase\functions\whatsapp-webhook\_siteops_timing.ts
- `processJob()` --calls--> `sendTypingIndicator()`  [INFERRED]
  supabase\functions\whatsapp-webhook\index.ts → supabase\functions\whatsapp-webhook\_format.ts
- `conciergeRun()` --calls--> `runConcierge()`  [INFERRED]
  supabase\functions\whatsapp-webhook\_registry.ts → supabase\functions\whatsapp-webhook\_agents\concierge.ts
- `notifyAssigneeAtCreation()` --calls--> `ownerPhone()`  [INFERRED]
  supabase\functions\whatsapp-webhook\_siteops_route.ts → supabase\functions\whatsapp-webhook\_siteops_assign.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.04
Nodes (116): answerProcurement(), commitInterruptedProc(), finalizeDirectVendor(), flowIdFor(), handleSingle(), loadApprover(), loadProjects(), loadVendors() (+108 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (65): isStopWord(), buildConflictPills(), buildNovelVariantPills(), buildPills(), humanLabel(), normalizeFraction(), scanDimension(), extractAttributesFromInput() (+57 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (61): answerSiteops(), applyBatchResolution(), findPrincipal(), finishRoute(), fmtDay(), handleBatchReply(), loadMembers(), loadSupervisor() (+53 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (17): parseAmount(), commitEdit(), useSnackbar(), add(), applyPercent(), multiply(), parseAmount(), round() (+9 more)

### Community 4 - "Community 4"
Cohesion: 0.1
Nodes (43): parseDigitToken(), parseSpokenAmount(), callClaude(), callOpenAI(), classifyImage(), classifyImageAnthropic(), classifyImageOpenAI(), classifyIntent() (+35 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (25): amountInWords(), amountText(), dataPair(), drawFooter(), drawHeader(), drawLogoMark(), drawRule(), drawSignatures() (+17 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (23): commitVendorPayment(), createVendorPurchase(), getVendorHub(), num(), poName(), projectIdOf(), readVendorBill(), vendorPaidToDate() (+15 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (24): buildResolutionStory(), patchProblem(), toggleTodo(), patchProblem(), toggleTodo(), appendEvent(), legacyToFollowupType(), notifyAssignment() (+16 more)

### Community 8 - "Community 8"
Cohesion: 0.08
Nodes (29): allocIdOf(), attachToContract(), clearOneTime(), createContract(), fallbackTitle(), fileAsLabour(), generateContractTitle(), getTrackingOptions() (+21 more)

### Community 9 - "Community 9"
Cohesion: 0.07
Nodes (12): buildComponents(), buildTemplateMessage(), sendTemplate(), line(), promptFor(), withTask(), cadenceFor(), recordChase() (+4 more)

### Community 10 - "Community 10"
Cohesion: 0.07
Nodes (16): useAuth(), useCan(), useOrgId(), PeekLink(), fmtDate(), Label(), summarizeScope(), woTone() (+8 more)

### Community 11 - "Community 11"
Cohesion: 0.1
Nodes (27): composeLLM(), fallbackReply(), isGreeting(), runConcierge(), systemFor(), userContent(), constantTimeEqual(), guessLang() (+19 more)

### Community 12 - "Community 12"
Cohesion: 0.12
Nodes (21): changeNumber(), changeRole(), daysLeft(), digits(), disableMember(), doEnable(), enableMember(), intlPhone() (+13 more)

### Community 13 - "Community 13"
Cohesion: 0.16
Nodes (24): buildConfirmMsg(), buildDescription(), createRoughEntry(), fetchImageAsBase64(), findTopMatches(), fmtAmount(), handleFinancial(), handleGeneral() (+16 more)

### Community 14 - "Community 14"
Cohesion: 0.13
Nodes (15): clearAllFilters(), derive(), fmtShortDate(), inr(), isOverdue(), milestoneState(), poFullyReceived(), poHasBill() (+7 more)

### Community 15 - "Community 15"
Cohesion: 0.11
Nodes (5): openDoc(), resolveDocUrl(), async(), chip(), toggle()

### Community 16 - "Community 16"
Cohesion: 0.17
Nodes (14): deriveDirection(), escapeRegExp(), isGeneralExpense(), isNotLinked(), parseStageLabel(), payeeLabel(), resolveAnchor(), emit() (+6 more)

### Community 17 - "Community 17"
Cohesion: 0.19
Nodes (14): buildExtractionPrompt(), buildReRankPrompt(), cleanExtractionResult(), extractItems(), generateStructuredSkuWithContext(), generateVectorEmbedding(), looksLikePlaceholder(), matchItems() (+6 more)

### Community 18 - "Community 18"
Cohesion: 0.17
Nodes (9): daysLeft(), digits(), doEnable(), intlPhone(), local10(), onToggle(), prettyPhone(), roleLabel() (+1 more)

### Community 19 - "Community 19"
Cohesion: 0.21
Nodes (11): errMessage(), fileRoughEntry(), fileRoughEntrySplit(), genTxnId(), rejectRoughEntry(), restoreRoughEntry(), runFile(), runReject() (+3 more)

### Community 20 - "Community 20"
Cohesion: 0.19
Nodes (10): handler(), close(), go(), handleClose(), handleOpen(), toggle(), close(), handleSave() (+2 more)

### Community 21 - "Community 21"
Cohesion: 0.15
Nodes (6): handleSave(), suggestCostCode(), costCodeLabel(), getCostCode(), classifyExpenseHead(), autoCloseWOIfFullyPaid()

### Community 22 - "Community 22"
Cohesion: 0.15
Nodes (2): clearPersistedCache(), doSignOut()

### Community 24 - "Community 24"
Cohesion: 0.32
Nodes (11): act(), briklayChat(), checkRegistration(), greetOnce(), local10(), onlyDigits(), onTap(), prettyPhone() (+3 more)

### Community 25 - "Community 25"
Cohesion: 0.26
Nodes (9): submit(), buildStack(), expand(), habitableLabels(), unitLabels(), upperLabel(), generateSiteTasks(), planReplaceAll() (+1 more)

### Community 26 - "Community 26"
Cohesion: 0.27
Nodes (9): llm(), buildEnrichUserPrompt(), enrichProject(), llm(), planFanOut(), safeParseJSON(), stackSummary(), validatePhaseEnrichment() (+1 more)

### Community 28 - "Community 28"
Cohesion: 0.2
Nodes (2): handleClose(), handleKeyDown()

### Community 29 - "Community 29"
Cohesion: 0.2
Nodes (2): isClientReceipt(), isExcludedFromSpent()

### Community 31 - "Community 31"
Cohesion: 0.29
Nodes (7): bandRange(), buildRationale(), draftStages(), extractMeasured(), normalizeWeights(), templateKeyForTrade(), titleCase()

### Community 33 - "Community 33"
Cohesion: 0.36
Nodes (8): addDays(), assembleImpact(), buildImpactUser(), callLLM(), computeImpact(), computeNeighborhood(), iso(), parseImpact()

### Community 37 - "Community 37"
Cohesion: 0.36
Nodes (4): getInitials(), levenshtein(), matchPayee(), matchProject()

### Community 38 - "Community 38"
Cohesion: 0.43
Nodes (4): genId(), handleKeyDown(), patchRow(), saveRow()

### Community 39 - "Community 39"
Cohesion: 0.43
Nodes (5): TxnRow(), dot(), formatShortDate(), formatTxn(), isCostCode()

### Community 40 - "Community 40"
Cohesion: 0.48
Nodes (5): usePrefetchPO(), usePrefetchStakeholder(), usePrefetchTxn(), usePrefetchWO(), useThrottledPrefetch()

### Community 42 - "Community 42"
Cohesion: 0.33
Nodes (3): handleCreateProject(), fmtProjectId(), uniqueProjectId()

### Community 50 - "Community 50"
Cohesion: 0.5
Nodes (2): prefetchTxn(), txnPeekKey()

### Community 53 - "Community 53"
Cohesion: 0.8
Nodes (4): addCustomBrand(), brandsFor(), getCustomBrands(), LS_KEY()

### Community 54 - "Community 54"
Cohesion: 0.6
Nodes (4): matchSKUs(), matchSKUsFromFile(), matchSKUsFromText(), handleDocumentUpload()

### Community 55 - "Community 55"
Cohesion: 0.5
Nodes (2): FinancialsCashflow(), lastNMonths()

### Community 56 - "Community 56"
Cohesion: 0.5
Nodes (2): handleSubmit(), triggerCelebration()

### Community 63 - "Community 63"
Cohesion: 0.67
Nodes (2): handleClose(), handleSubmit()

### Community 83 - "Community 83"
Cohesion: 1.0
Nodes (2): downloadGRNChallan(), fmtDate()

### Community 84 - "Community 84"
Cohesion: 1.0
Nodes (2): poGateState(), poIsPriced()

## Knowledge Gaps
- **Thin community `Community 22`** (13 nodes): `clearPersistedCache()`, `shouldPersistQuery()`, `can()`, `doSignOut()`, `e()`, `h()`, `initials()`, `isActive()`, `measure()`, `RailItem()`, `RailLabel()`, `BriklayRail.tsx`, `queryClient.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (11 nodes): `DrawerSkeleton()`, `filterRow()`, `fmt()`, `formatLedgerDate()`, `getInitials()`, `handleAddTransaction()`, `handleClose()`, `handleKeyDown()`, `monthHeading()`, `monthKey()`, `StakeholderLedgerDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (11 nodes): `AnimatedNumber()`, `e()`, `fmtAmt()`, `fmtDate()`, `genTxnId()`, `h()`, `if()`, `isClientReceipt()`, `isExcludedFromSpent()`, `supervisorName()`, `ProjectDetail.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (5 nodes): `fmtDate()`, `prefetchTxn()`, `txnPeekFn()`, `txnPeekKey()`, `TransactionPeek.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (5 nodes): `FinancialsCashflow()`, `fmt()`, `lastNMonths()`, `monthLabel()`, `FinancialsCashflow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (5 nodes): `handleForgotPassword()`, `handleResendConfirmation()`, `handleSubmit()`, `triggerCelebration()`, `Login.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (4 nodes): `handleClose()`, `handleSubmit()`, `updateRow()`, `QuoteEntryDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (3 nodes): `downloadGRNChallan()`, `fmtDate()`, `grnChallan.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (3 nodes): `poGateState()`, `poIsPriced()`, `poLifecycle.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `NewInvoice()` connect `Community 3` to `Community 10`?**
  _High betweenness centrality (0.134) - this node is a cross-community bridge._
- **Why does `parseAmount()` connect `Community 3` to `Community 0`?**
  _High betweenness centrality (0.096) - this node is a cross-community bridge._
- **Why does `computeLine()` connect `Community 3` to `Community 1`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Are the 19 inferred relationships involving `dispatch()` (e.g. with `processJob()` and `send()`) actually correct?**
  _`dispatch()` has 19 INFERRED edges - model-reasoned connections that need verification._
- **Are the 23 inferred relationships involving `send()` (e.g. with `processJob()` and `dispatch()`) actually correct?**
  _`send()` has 23 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `resolveAgainstSingleFamily()` (e.g. with `addStep()` and `resolveAgainstTree()`) actually correct?**
  _`resolveAgainstSingleFamily()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `handlePillSelection()` (e.g. with `createTrace()` and `addStep()`) actually correct?**
  _`handlePillSelection()` has 10 INFERRED edges - model-reasoned connections that need verification._