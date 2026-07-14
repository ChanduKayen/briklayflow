# Graph Report - Briklay Fly  (2026-07-12)

## Corpus Check
- 535 files · ~1,053,574 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2240 nodes · 3455 edges · 58 communities detected
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 426 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 118|Community 118]]
- [[_COMMUNITY_Community 119|Community 119]]

## God Nodes (most connected - your core abstractions)
1. `pick()` - 43 edges
2. `send()` - 42 edges
3. `dispatch()` - 37 edges
4. `answerSiteops()` - 32 edges
5. `runSiteops()` - 28 edges
6. `resolveAgainstSingleFamily()` - 23 edges
7. `handlePillSelection()` - 22 edges
8. `applyTerminals()` - 22 edges
9. `handleFamilySuggestionClick()` - 18 edges
10. `runTransaction()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `handleDownloadPDF()` --calls--> `SectionLabel()`  [INFERRED]
  src\pages\BillDetail.tsx → src\pages\NewTransaction.tsx
- `cadenceFor()` --calls--> `loadCadenceMap()`  [INFERRED]
  supabase\functions\siteops-chase\index.ts → supabase\functions\whatsapp-webhook\_siteops_timing.ts
- `scoreProjects()` --calls--> `resolveProject()`  [INFERRED]
  supabase\functions\whatsapp-webhook\_match.ts → supabase\functions\whatsapp-webhook\_resolve.ts
- `distillSignal()` --calls--> `correctReadback()`  [INFERRED]
  supabase\functions\whatsapp-webhook\_siteops_reanalyze.ts → supabase\functions\whatsapp-webhook\_agents\siteops.ts
- `assertAllApplied()` --calls--> `applyTerminals()`  [INFERRED]
  supabase\functions\whatsapp-webhook\_siteops_resolution.ts → supabase\functions\whatsapp-webhook\_agents\siteops.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (40): ctxFor(), imgCtx(), tQItem(), tTaskUpdate(), tUpdateResolve(), upd(), addToOpenBatch(), getOpenBatch() (+32 more)

### Community 1 - "Community 1"
Cohesion: 0.03
Nodes (76): answerSiteops(), answerWithPhoto(), applyBatchResolution(), applyQcFailures(), applyTaskBlockedById(), applyTaskProgressById(), applyTaskUpdate(), applyTerminals() (+68 more)

### Community 2 - "Community 2"
Cohesion: 0.04
Nodes (79): composeLLM(), fallbackReply(), isGreeting(), runConcierge(), systemFor(), userContent(), stampPossibleFollowup(), answerTransaction() (+71 more)

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (73): isStopWord(), addCustomBrand(), brandsFor(), getCustomBrands(), LS_KEY(), buildConflictPills(), buildNovelVariantPills(), buildPills() (+65 more)

### Community 4 - "Community 4"
Cohesion: 0.03
Nodes (45): classifyPhotoFollowup(), buildComponents(), buildTemplateMessage(), sendTemplate(), line(), promptFor(), withTask(), cadenceFor() (+37 more)

### Community 5 - "Community 5"
Cohesion: 0.04
Nodes (79): fanOutQc(), persistGraph(), reconcile(), toPersistRows(), buildBlockVM(), buildCommonFloorVM(), buildFloorVM(), buildFoundationFloorVM() (+71 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (68): imageDeterministic(), parseDigitToken(), parseSpokenAmount(), callClaude(), callOpenAI(), classifyImage(), classifyImageAnthropic(), classifyImageOpenAI() (+60 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (72): answerProcurement(), commitInterruptedProc(), finalizeDirectVendor(), flowIdFor(), handleSingle(), loadApprover(), loadProjects(), loadVendors() (+64 more)

### Community 8 - "Community 8"
Cohesion: 0.04
Nodes (37): call(), issue(), prog(), seed(), task(), applyStructureCodeFloor(), asStr(), callLLM() (+29 more)

### Community 9 - "Community 9"
Cohesion: 0.06
Nodes (39): handler(), close(), go(), handleClose(), handleOpen(), toggle(), close(), handleSave() (+31 more)

### Community 10 - "Community 10"
Cohesion: 0.06
Nodes (21): parseAmount(), commitEdit(), useSnackbar(), add(), applyPercent(), multiply(), parseAmount(), round() (+13 more)

### Community 11 - "Community 11"
Cohesion: 0.06
Nodes (27): patchProblem(), toggleSnag(), patchProblem(), toggleSnag(), appendEvent(), legacyToFollowupType(), notifyAssignment(), trailKey() (+19 more)

### Community 12 - "Community 12"
Cohesion: 0.06
Nodes (23): commitVendorPayment(), createVendorPurchase(), getVendorHub(), num(), poName(), projectIdOf(), readVendorBill(), vendorPaidToDate() (+15 more)

### Community 13 - "Community 13"
Cohesion: 0.06
Nodes (20): readStoredSession(), useAuth(), useCan(), useOrgId(), classifyRefreshError(), extractErrorCode(), parseStoredSession(), PeekLink() (+12 more)

### Community 14 - "Community 14"
Cohesion: 0.06
Nodes (20): if(), isClientReceipt(), isExcludedFromSpent(), byTypeFor(), commitMove(), goTo(), loop(), measure() (+12 more)

### Community 15 - "Community 15"
Cohesion: 0.11
Nodes (18): amountInWords(), amountText(), dataPair(), drawFooter(), drawHeader(), drawLogoMark(), drawRule(), drawSignatures() (+10 more)

### Community 16 - "Community 16"
Cohesion: 0.09
Nodes (24): file(), sendTypingIndicator(), constantTimeEqual(), guessLang(), handleProspect(), processJob(), recordInbound(), verifyMetaSignature() (+16 more)

### Community 17 - "Community 17"
Cohesion: 0.12
Nodes (21): changeNumber(), changeRole(), daysLeft(), digits(), disableMember(), doEnable(), enableMember(), intlPhone() (+13 more)

### Community 18 - "Community 18"
Cohesion: 0.1
Nodes (19): checkExprAt(), findMigrationsDir(), loadEnumChecks(), parseEnumExpr(), stripLineComments(), datasetFor(), defaultChecks(), defaultColumns() (+11 more)

### Community 19 - "Community 19"
Cohesion: 0.13
Nodes (15): clearAllFilters(), derive(), fmtShortDate(), inr(), isOverdue(), milestoneState(), poFullyReceived(), poHasBill() (+7 more)

### Community 20 - "Community 20"
Cohesion: 0.14
Nodes (20): buildClassifierPrompt(), clamp01(), classifyUserTask(), dedupe(), gatewayAnchor(), introducesCycle(), resolveFreedomSet(), sanitizeScope() (+12 more)

### Community 21 - "Community 21"
Cohesion: 0.1
Nodes (5): openDoc(), resolveDocUrl(), async(), chip(), toggle()

### Community 22 - "Community 22"
Cohesion: 0.17
Nodes (14): deriveDirection(), escapeRegExp(), isGeneralExpense(), isNotLinked(), parseStageLabel(), payeeLabel(), resolveAnchor(), emit() (+6 more)

### Community 23 - "Community 23"
Cohesion: 0.2
Nodes (3): Evaluator, messageFor(), verdictFor()

### Community 24 - "Community 24"
Cohesion: 0.19
Nodes (14): buildExtractionPrompt(), buildReRankPrompt(), cleanExtractionResult(), extractItems(), generateStructuredSkuWithContext(), generateVectorEmbedding(), looksLikePlaceholder(), matchItems() (+6 more)

### Community 25 - "Community 25"
Cohesion: 0.17
Nodes (9): daysLeft(), digits(), doEnable(), intlPhone(), local10(), onToggle(), prettyPhone(), roleLabel() (+1 more)

### Community 26 - "Community 26"
Cohesion: 0.21
Nodes (11): errMessage(), fileRoughEntry(), fileRoughEntrySplit(), genTxnId(), rejectRoughEntry(), restoreRoughEntry(), runFile(), runReject() (+3 more)

### Community 27 - "Community 27"
Cohesion: 0.13
Nodes (2): seed(), SEED2()

### Community 28 - "Community 28"
Cohesion: 0.15
Nodes (6): handleSave(), suggestCostCode(), costCodeLabel(), getCostCode(), classifyExpenseHead(), autoCloseWOIfFullyPaid()

### Community 29 - "Community 29"
Cohesion: 0.25
Nodes (9): buildingNodeId(), buildingTypeEnabled(), CycleError, instantiate(), makeNode(), perFloorNodeId(), perZoneNodeId(), resolvePred() (+1 more)

### Community 30 - "Community 30"
Cohesion: 0.16
Nodes (3): cand(), floorSeed(), fourFloors()

### Community 31 - "Community 31"
Cohesion: 0.15
Nodes (2): clearPersistedCache(), doSignOut()

### Community 32 - "Community 32"
Cohesion: 0.18
Nodes (3): BI(), chaseSeed(), seed()

### Community 34 - "Community 34"
Cohesion: 0.32
Nodes (11): act(), briklayChat(), checkRegistration(), greetOnce(), local10(), onlyDigits(), onTap(), prettyPhone() (+3 more)

### Community 35 - "Community 35"
Cohesion: 0.21
Nodes (5): base(), nearest(), upd(), updResolve(), withNearest()

### Community 37 - "Community 37"
Cohesion: 0.2
Nodes (2): handleClose(), handleKeyDown()

### Community 39 - "Community 39"
Cohesion: 0.29
Nodes (7): bandRange(), buildRationale(), draftStages(), extractMeasured(), normalizeWeights(), templateKeyForTrade(), titleCase()

### Community 40 - "Community 40"
Cohesion: 0.31
Nodes (6): confirmSpawn(), invalidate(), invalidateObjects(), onPickFile(), post(), quickAction()

### Community 41 - "Community 41"
Cohesion: 0.4
Nodes (7): expect(), expectThrows(), fmt(), norm(), runAll(), suite(), test()

### Community 44 - "Community 44"
Cohesion: 0.39
Nodes (7): boundedFetch(), coalescedRefresh(), hasBearer(), isOnline(), timeoutFetch(), urlOf(), withBearer()

### Community 45 - "Community 45"
Cohesion: 0.25
Nodes (2): cm(), DEC()

### Community 46 - "Community 46"
Cohesion: 0.39
Nodes (4): canonicalRank(), findAbstractCycle(), isHardNature(), validateLibrary()

### Community 49 - "Community 49"
Cohesion: 0.36
Nodes (4): getInitials(), levenshtein(), matchPayee(), matchProject()

### Community 50 - "Community 50"
Cohesion: 0.29
Nodes (2): baseSeed(), twoAskSeed()

### Community 51 - "Community 51"
Cohesion: 0.32
Nodes (3): ask(), ctxFor(), model()

### Community 53 - "Community 53"
Cohesion: 0.29
Nodes (2): model(), R_CREATE()

### Community 55 - "Community 55"
Cohesion: 0.43
Nodes (4): genId(), handleKeyDown(), patchRow(), saveRow()

### Community 56 - "Community 56"
Cohesion: 0.48
Nodes (5): usePrefetchPO(), usePrefetchStakeholder(), usePrefetchTxn(), usePrefetchWO(), useThrottledPrefetch()

### Community 58 - "Community 58"
Cohesion: 0.43
Nodes (5): TxnRow(), dot(), formatShortDate(), formatTxn(), isCostCode()

### Community 59 - "Community 59"
Cohesion: 0.33
Nodes (3): handleCreateProject(), fmtProjectId(), uniqueProjectId()

### Community 62 - "Community 62"
Cohesion: 0.33
Nodes (2): postToMeta(), parseSentWamid()

### Community 63 - "Community 63"
Cohesion: 0.33
Nodes (2): handled(), minsAgo()

### Community 83 - "Community 83"
Cohesion: 0.5
Nodes (2): prefetchTxn(), txnPeekKey()

### Community 86 - "Community 86"
Cohesion: 0.6
Nodes (3): dry(), nodeOf(), wet()

### Community 88 - "Community 88"
Cohesion: 0.5
Nodes (2): FinancialsCashflow(), lastNMonths()

### Community 95 - "Community 95"
Cohesion: 0.67
Nodes (2): handleClose(), handleSubmit()

### Community 118 - "Community 118"
Cohesion: 1.0
Nodes (2): downloadGRNChallan(), fmtDate()

### Community 119 - "Community 119"
Cohesion: 1.0
Nodes (2): poGateState(), poIsPriced()

## Knowledge Gaps
- **Thin community `Community 27`** (16 nodes): `no_such_floor_ask.test.ts`, `base()`, `blindModel()`, `convoOf()`, `ctxPin()`, `geo()`, `imgCtx()`, `model()`, `preambleOf()`, `projConvoOf()`, `row()`, `seed()`, `SEED2()`, `shortlist()`, `textCtx()`, `tUpd()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (13 nodes): `clearPersistedCache()`, `shouldPersistQuery()`, `can()`, `doSignOut()`, `e()`, `h()`, `initials()`, `isActive()`, `measure()`, `RailItem()`, `RailLabel()`, `BriklayRail.tsx`, `queryClient.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (11 nodes): `DrawerSkeleton()`, `filterRow()`, `fmt()`, `formatLedgerDate()`, `getInitials()`, `handleAddTransaction()`, `handleClose()`, `handleKeyDown()`, `monthHeading()`, `monthKey()`, `StakeholderLedgerDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (9 nodes): `singular_unit.test.ts`, `cm()`, `ctxFor()`, `DEC()`, `DEC_EMPTY()`, `decomposeCalls()`, `resolutionCalls()`, `seed()`, `unitModel()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (8 nodes): `adoption.test.ts`, `baseSeed()`, `convosOpened()`, `ctxFor()`, `lowOn()`, `model()`, `script()`, `twoAskSeed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (8 nodes): `held_project_fold.test.ts`, `convoOf()`, `ctxFor()`, `it()`, `model()`, `projectSlots()`, `R_CREATE()`, `seed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (7 nodes): `index.ts`, `message_map.test.ts`, `_wa_message_map.ts`, `backoffSeconds()`, `postToMeta()`, `buildMapRow()`, `parseSentWamid()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (7 nodes): `duplicate_narration.test.ts`, `calls()`, `ctxFor()`, `handled()`, `minsAgo()`, `model()`, `seed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (5 nodes): `fmtDate()`, `prefetchTxn()`, `txnPeekFn()`, `txnPeekKey()`, `TransactionPeek.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 88`** (5 nodes): `FinancialsCashflow()`, `fmt()`, `lastNMonths()`, `monthLabel()`, `FinancialsCashflow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 95`** (4 nodes): `handleClose()`, `handleSubmit()`, `updateRow()`, `QuoteEntryDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 118`** (3 nodes): `downloadGRNChallan()`, `fmtDate()`, `grnChallan.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 119`** (3 nodes): `poGateState()`, `poIsPriced()`, `poLifecycle.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `NewInvoice()` connect `Community 10` to `Community 13`?**
  _High betweenness centrality (0.146) - this node is a cross-community bridge._
- **Why does `parseAmount()` connect `Community 10` to `Community 2`?**
  _High betweenness centrality (0.119) - this node is a cross-community bridge._
- **Why does `computeLine()` connect `Community 10` to `Community 3`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._
- **Are the 39 inferred relationships involving `send()` (e.g. with `processJob()` and `resurfacePending()`) actually correct?**
  _`send()` has 39 INFERRED edges - model-reasoned connections that need verification._
- **Are the 28 inferred relationships involving `dispatch()` (e.g. with `processJob()` and `send()`) actually correct?**
  _`dispatch()` has 28 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `answerSiteops()` (e.g. with `closeConversation()` and `send()`) actually correct?**
  _`answerSiteops()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `runSiteops()` (e.g. with `getOpenBatch()` and `resolveProject()`) actually correct?**
  _`runSiteops()` has 15 INFERRED edges - model-reasoned connections that need verification._