# Graph Report - Briklay Fly  (2026-07-14)

## Corpus Check
- 612 files · ~1,206,944 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2604 nodes · 4046 edges · 67 communities detected
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 552 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 106|Community 106]]
- [[_COMMUNITY_Community 111|Community 111]]
- [[_COMMUNITY_Community 128|Community 128]]
- [[_COMMUNITY_Community 129|Community 129]]
- [[_COMMUNITY_Community 130|Community 130]]
- [[_COMMUNITY_Community 133|Community 133]]

## God Nodes (most connected - your core abstractions)
1. `pick()` - 45 edges
2. `send()` - 43 edges
3. `dispatch()` - 38 edges
4. `answerSiteops()` - 36 edges
5. `runSiteops()` - 32 edges
6. `applyTerminals()` - 26 edges
7. `resolveAgainstSingleFamily()` - 23 edges
8. `handlePillSelection()` - 22 edges
9. `sendNowDurable()` - 22 edges
10. `handleFamilySuggestionClick()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `cadenceFor()` --calls--> `loadCadenceMap()`  [INFERRED]
  supabase\functions\siteops-chase\index.ts → supabase\functions\whatsapp-webhook\_siteops_timing.ts
- `scoreProjects()` --calls--> `resolveProject()`  [INFERRED]
  supabase\functions\whatsapp-webhook\_match.ts → supabase\functions\whatsapp-webhook\_resolve.ts
- `mBatch()` --calls--> `line()`  [INFERRED]
  supabase\functions\whatsapp-webhook\_messages.ts → supabase\functions\whatsapp-webhook\__tests__\resolution_llm.test.ts
- `loadCandidates()` --calls--> `runSiteops()`  [INFERRED]
  supabase\functions\whatsapp-webhook\_siteops_candidates.ts → supabase\functions\whatsapp-webhook\_agents\siteops.ts
- `groundingLabels()` --calls--> `runSiteops()`  [INFERRED]
  supabase\functions\whatsapp-webhook\_siteops_candidates.ts → supabase\functions\whatsapp-webhook\_agents\siteops.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (143): bindingKey(), graphIsMaterialized(), materializeProjectTasksUncached(), placeOfTask(), gatesByTask(), gatesFromBinding(), safeGeometry(), safeInstantiate() (+135 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (112): composeLLM(), fallbackReply(), isGreeting(), runConcierge(), systemFor(), userContent(), commitInterruptedProc(), answerSiteops() (+104 more)

### Community 2 - "Community 2"
Cohesion: 0.01
Nodes (31): baseSeed(), twoAskSeed(), ctxFor(), imgCtx(), tQItem(), tTaskUpdate(), tUpdateResolve(), upd() (+23 more)

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (73): isStopWord(), addCustomBrand(), brandsFor(), getCustomBrands(), LS_KEY(), buildConflictPills(), buildNovelVariantPills(), buildPills() (+65 more)

### Community 4 - "Community 4"
Cohesion: 0.03
Nodes (41): classifyPhotoFollowup(), d(), call(), issue(), prog(), seed(), task(), decideAssociation() (+33 more)

### Community 5 - "Community 5"
Cohesion: 0.04
Nodes (51): buildComponents(), buildTemplateMessage(), sendTemplate(), line(), promptFor(), withTask(), cadenceFor(), recordChase() (+43 more)

### Community 6 - "Community 6"
Cohesion: 0.05
Nodes (71): answerProcurement(), finalizeDirectVendor(), flowIdFor(), handleSingle(), loadApprover(), loadProjects(), loadVendors(), markReadyForApproval() (+63 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (72): answerTransaction(), applyPlan(), applyPrefix(), buildPlan(), commitEntry(), fmtNum(), handleWriteFailure(), isHardCancel() (+64 more)

### Community 8 - "Community 8"
Cohesion: 0.04
Nodes (36): readStoredSession(), useAuth(), useCan(), useOrgId(), classifyRefreshError(), extractErrorCode(), parseStoredSession(), PeekLink() (+28 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (28): handleSave(), suggestCostCode(), costCodeLabel(), getCostCode(), classifyExpenseHead(), openDoc(), resolveDocUrl(), deriveDirection() (+20 more)

### Community 10 - "Community 10"
Cohesion: 0.06
Nodes (39): handler(), close(), go(), handleClose(), handleOpen(), toggle(), close(), handleSave() (+31 more)

### Community 11 - "Community 11"
Cohesion: 0.07
Nodes (37): commitEdit(), handleSave(), callOpenAI(), classifyImage(), classifyImageAnthropic(), classifyImageOpenAI(), classifyIntent(), classifyIntentAI() (+29 more)

### Community 12 - "Community 12"
Cohesion: 0.05
Nodes (28): patchProblem(), toggleSnag(), patchProblem(), toggleSnag(), appendEvent(), legacyToFollowupType(), notifyAssignment(), trailKey() (+20 more)

### Community 13 - "Community 13"
Cohesion: 0.06
Nodes (25): amountInWords(), amountText(), dataPair(), drawFooter(), drawHeader(), drawLogoMark(), drawRule(), drawSignatures() (+17 more)

### Community 14 - "Community 14"
Cohesion: 0.06
Nodes (32): useDeskApi(), useMockDeskApi(), ago(), buildChase(), buildStory(), buildTaskStory(), capitalise(), chaseWhen() (+24 more)

### Community 15 - "Community 15"
Cohesion: 0.06
Nodes (33): imgCtx(), runTurn(), seed(), task(), checkExprAt(), findMigrationsDir(), loadEnumChecks(), parseEnumExpr() (+25 more)

### Community 16 - "Community 16"
Cohesion: 0.09
Nodes (25): file(), keepTyping(), sendTypingIndicator(), constantTimeEqual(), guessLang(), handleProspect(), processJob(), recordInbound() (+17 more)

### Community 17 - "Community 17"
Cohesion: 0.1
Nodes (16): byTypeFor(), commitMove(), goTo(), loop(), measure(), moveTo(), nearestTo(), onLeave() (+8 more)

### Community 18 - "Community 18"
Cohesion: 0.09
Nodes (17): useSnackbar(), add(), applyPercent(), multiply(), parseAmount(), round(), subtract(), sum() (+9 more)

### Community 19 - "Community 19"
Cohesion: 0.12
Nodes (21): changeNumber(), changeRole(), daysLeft(), digits(), disableMember(), doEnable(), enableMember(), intlPhone() (+13 more)

### Community 20 - "Community 20"
Cohesion: 0.13
Nodes (15): clearAllFilters(), derive(), fmtShortDate(), inr(), isOverdue(), milestoneState(), poFullyReceived(), poHasBill() (+7 more)

### Community 21 - "Community 21"
Cohesion: 0.08
Nodes (2): taskStatus(), statusOf()

### Community 22 - "Community 22"
Cohesion: 0.14
Nodes (20): buildClassifierPrompt(), clamp01(), classifyUserTask(), dedupe(), gatewayAnchor(), introducesCycle(), resolveFreedomSet(), sanitizeScope() (+12 more)

### Community 23 - "Community 23"
Cohesion: 0.17
Nodes (13): errMessage(), fileRoughEntry(), fileRoughEntrySplit(), genTxnId(), rejectRoughEntry(), restoreRoughEntry(), leave(), runFile() (+5 more)

### Community 24 - "Community 24"
Cohesion: 0.2
Nodes (3): Evaluator, messageFor(), verdictFor()

### Community 25 - "Community 25"
Cohesion: 0.19
Nodes (14): buildExtractionPrompt(), buildReRankPrompt(), cleanExtractionResult(), extractItems(), generateStructuredSkuWithContext(), generateVectorEmbedding(), looksLikePlaceholder(), matchItems() (+6 more)

### Community 26 - "Community 26"
Cohesion: 0.25
Nodes (17): composeItemPickBody(), composePhotoAck(), bold(), buttonText(), correctionLine(), destinationLine(), heading(), italic() (+9 more)

### Community 27 - "Community 27"
Cohesion: 0.17
Nodes (9): daysLeft(), digits(), doEnable(), intlPhone(), local10(), onToggle(), prettyPhone(), roleLabel() (+1 more)

### Community 28 - "Community 28"
Cohesion: 0.12
Nodes (2): seed(), SEED2()

### Community 29 - "Community 29"
Cohesion: 0.19
Nodes (11): src(), stripComments(), renderHistory(), classifyWithLLM(), detectLanguage(), extractJson(), looksActionableProcurement(), looksActionableTxn() (+3 more)

### Community 30 - "Community 30"
Cohesion: 0.15
Nodes (3): cand(), floorSeed(), fourFloors()

### Community 31 - "Community 31"
Cohesion: 0.16
Nodes (5): ProjectHome(), useProjectCode(), if(), isClientReceipt(), isExcludedFromSpent()

### Community 32 - "Community 32"
Cohesion: 0.22
Nodes (8): attempt(), attemptQuiet(), onEditSave(), onPrimary(), onSend(), onTaskDur(), onTaskNote(), onTaskState()

### Community 33 - "Community 33"
Cohesion: 0.15
Nodes (2): clearPersistedCache(), doSignOut()

### Community 34 - "Community 34"
Cohesion: 0.18
Nodes (3): BI(), chaseSeed(), seed()

### Community 35 - "Community 35"
Cohesion: 0.32
Nodes (11): act(), briklayChat(), checkRegistration(), greetOnce(), local10(), onlyDigits(), onTap(), prettyPhone() (+3 more)

### Community 36 - "Community 36"
Cohesion: 0.21
Nodes (5): base(), nearest(), upd(), updResolve(), withNearest()

### Community 39 - "Community 39"
Cohesion: 0.2
Nodes (2): handleClose(), handleKeyDown()

### Community 40 - "Community 40"
Cohesion: 0.42
Nodes (7): expect(), expectThrows(), fmt(), norm(), runAll(), suite(), test()

### Community 42 - "Community 42"
Cohesion: 0.29
Nodes (7): bandRange(), buildRationale(), draftStages(), extractMeasured(), normalizeWeights(), templateKeyForTrade(), titleCase()

### Community 43 - "Community 43"
Cohesion: 0.31
Nodes (6): confirmSpawn(), invalidate(), invalidateObjects(), onPickFile(), post(), quickAction()

### Community 46 - "Community 46"
Cohesion: 0.39
Nodes (7): boundedFetch(), coalescedRefresh(), hasBearer(), isOnline(), timeoutFetch(), urlOf(), withBearer()

### Community 47 - "Community 47"
Cohesion: 0.33
Nodes (4): canonicalRank(), findAbstractCycle(), isHardNature(), validateLibrary()

### Community 48 - "Community 48"
Cohesion: 0.25
Nodes (2): tUpdated(), upd()

### Community 49 - "Community 49"
Cohesion: 0.25
Nodes (2): cm(), DEC()

### Community 50 - "Community 50"
Cohesion: 0.25
Nodes (2): ProblemRow(), useSwipe()

### Community 51 - "Community 51"
Cohesion: 0.32
Nodes (5): autoSet(), isOn(), ruleHints(), toggle(), A()

### Community 52 - "Community 52"
Cohesion: 0.29
Nodes (2): dismiss(), invalidateEntries()

### Community 54 - "Community 54"
Cohesion: 0.36
Nodes (4): getInitials(), levenshtein(), matchPayee(), matchProject()

### Community 55 - "Community 55"
Cohesion: 0.32
Nodes (3): ask(), ctxFor(), model()

### Community 57 - "Community 57"
Cohesion: 0.29
Nodes (2): model(), R_CREATE()

### Community 60 - "Community 60"
Cohesion: 0.33
Nodes (3): handleCreateProject(), fmtProjectId(), uniqueProjectId()

### Community 61 - "Community 61"
Cohesion: 0.43
Nodes (4): genId(), handleKeyDown(), patchRow(), saveRow()

### Community 62 - "Community 62"
Cohesion: 0.48
Nodes (5): usePrefetchPO(), usePrefetchStakeholder(), usePrefetchTxn(), usePrefetchWO(), useThrottledPrefetch()

### Community 64 - "Community 64"
Cohesion: 0.43
Nodes (5): TxnRow(), dot(), formatShortDate(), formatTxn(), isCostCode()

### Community 68 - "Community 68"
Cohesion: 0.33
Nodes (2): handled(), minsAgo()

### Community 84 - "Community 84"
Cohesion: 0.5
Nodes (2): prefetchTxn(), txnPeekKey()

### Community 88 - "Community 88"
Cohesion: 0.7
Nodes (4): nodeKey(), nodeKeyOf(), unitKeyOf(), zoneIdOf()

### Community 89 - "Community 89"
Cohesion: 0.5
Nodes (2): FinancialsCashflow(), lastNMonths()

### Community 98 - "Community 98"
Cohesion: 0.67
Nodes (2): handleClose(), handleSubmit()

### Community 101 - "Community 101"
Cohesion: 0.67
Nodes (2): bloom(), REDUCED()

### Community 106 - "Community 106"
Cohesion: 0.67
Nodes (2): concealedByPlaster(), unit()

### Community 111 - "Community 111"
Cohesion: 0.67
Nodes (2): defined(), stripComments()

### Community 128 - "Community 128"
Cohesion: 1.0
Nodes (2): downloadGRNChallan(), fmtDate()

### Community 129 - "Community 129"
Cohesion: 1.0
Nodes (2): poGateState(), poIsPriced()

### Community 130 - "Community 130"
Cohesion: 1.0
Nodes (2): insertionIndex(), withNewTask()

### Community 133 - "Community 133"
Cohesion: 1.0
Nodes (2): placeOf(), stageOfFloorless()

## Knowledge Gaps
- **Thin community `Community 21`** (24 nodes): `acrossFlats()`, `applyUndo()`, `bumpDuration()`, `canClose()`, `closeItem()`, `firstName()`, `floorName()`, `groupIsFoldable()`, `hasLiveWork()`, `isOldAge()`, `openBlockers()`, `pctDone()`, `planFloors()`, `reopenItem()`, `setTaskState()`, `sevScore()`, `siteCodeOf()`, `sliceFloor()`, `snapshot()`, `splitRefs()`, `taskStatus()`, `upNextRefs()`, `derive.ts`, `statusOf()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (17 nodes): `no_such_floor_ask.test.ts`, `base()`, `blindModel()`, `convoOf()`, `ctxPin()`, `geo()`, `imgCtx()`, `model()`, `preambleOf()`, `projConvoOf()`, `row()`, `seed()`, `SEED2()`, `shortlist()`, `stateWrites()`, `textCtx()`, `tUpd()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (13 nodes): `clearPersistedCache()`, `shouldPersistQuery()`, `can()`, `doSignOut()`, `e()`, `h()`, `initials()`, `isActive()`, `measure()`, `RailItem()`, `RailLabel()`, `BriklayRail.tsx`, `queryClient.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (11 nodes): `DrawerSkeleton()`, `filterRow()`, `fmt()`, `formatLedgerDate()`, `getInitials()`, `handleAddTransaction()`, `handleClose()`, `handleKeyDown()`, `monthHeading()`, `monthKey()`, `StakeholderLedgerDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (9 nodes): `confirmation.test.ts`, `bodyOf()`, `ctaOf()`, `failed()`, `ok()`, `tCreated()`, `tMiss()`, `tUpdated()`, `upd()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (9 nodes): `singular_unit.test.ts`, `cm()`, `ctxFor()`, `DEC()`, `DEC_EMPTY()`, `decomposeCalls()`, `resolutionCalls()`, `seed()`, `unitModel()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (8 nodes): `away()`, `ProblemRow()`, `useIsDesktop()`, `useIsTouch()`, `useRowClose()`, `useSwipe()`, `Problems.tsx`, `useDesk.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (8 nodes): `byRecent()`, `dismiss()`, `handleFiled()`, `handleRejected()`, `invalidateEntries()`, `restore()`, `viewTxn()`, `Logbook.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (8 nodes): `held_project_fold.test.ts`, `convoOf()`, `ctxFor()`, `it()`, `model()`, `projectSlots()`, `R_CREATE()`, `seed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 68`** (7 nodes): `duplicate_narration.test.ts`, `calls()`, `ctxFor()`, `handled()`, `minsAgo()`, `model()`, `seed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (5 nodes): `fmtDate()`, `prefetchTxn()`, `txnPeekFn()`, `txnPeekKey()`, `TransactionPeek.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 89`** (5 nodes): `FinancialsCashflow()`, `fmt()`, `lastNMonths()`, `monthLabel()`, `FinancialsCashflow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 98`** (4 nodes): `handleClose()`, `handleSubmit()`, `updateRow()`, `QuoteEntryDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 101`** (4 nodes): `bloom()`, `Btn()`, `REDUCED()`, `Btn.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 106`** (4 nodes): `evaluate.test.ts`, `blockworkDoneGround()`, `concealedByPlaster()`, `unit()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 111`** (4 nodes): `pending_credibility.test.ts`, `defined()`, `raw()`, `stripComments()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 128`** (3 nodes): `downloadGRNChallan()`, `fmtDate()`, `grnChallan.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 129`** (3 nodes): `poGateState()`, `poIsPriced()`, `poLifecycle.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 130`** (3 nodes): `insertionIndex()`, `withNewTask()`, `add.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 133`** (3 nodes): `placeOf()`, `stageOfFloorless()`, `stages.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `NewInvoice()` connect `Community 18` to `Community 8`, `Community 11`, `Community 7`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Why does `parseAmount()` connect `Community 7` to `Community 18`, `Community 11`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **Why does `materializeProjectTasksUncached()` connect `Community 0` to `Community 1`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **Are the 39 inferred relationships involving `send()` (e.g. with `processJob()` and `resurfacePending()`) actually correct?**
  _`send()` has 39 INFERRED edges - model-reasoned connections that need verification._
- **Are the 29 inferred relationships involving `dispatch()` (e.g. with `processJob()` and `send()`) actually correct?**
  _`dispatch()` has 29 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `answerSiteops()` (e.g. with `closeConversation()` and `sendNowDurable()`) actually correct?**
  _`answerSiteops()` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 18 inferred relationships involving `runSiteops()` (e.g. with `getOpenBatch()` and `resolveProject()`) actually correct?**
  _`runSiteops()` has 18 INFERRED edges - model-reasoned connections that need verification._