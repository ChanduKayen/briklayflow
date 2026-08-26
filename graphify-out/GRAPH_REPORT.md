# Graph Report - Briklay Fly  (2026-08-26)

## Corpus Check
- 661 files · ~1,265,893 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2834 nodes · 4391 edges · 68 communities detected
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 592 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
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
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 107|Community 107]]
- [[_COMMUNITY_Community 127|Community 127]]
- [[_COMMUNITY_Community 128|Community 128]]
- [[_COMMUNITY_Community 130|Community 130]]
- [[_COMMUNITY_Community 133|Community 133]]

## God Nodes (most connected - your core abstractions)
1. `pick()` - 54 edges
2. `send()` - 45 edges
3. `dispatch()` - 38 edges
4. `answerSiteops()` - 36 edges
5. `runSiteops()` - 32 edges
6. `applyTerminals()` - 27 edges
7. `resolveAgainstSingleFamily()` - 23 edges
8. `handlePillSelection()` - 22 edges
9. `sendNowDurable()` - 22 edges
10. `handleFamilySuggestionClick()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `cadenceFor()` --calls--> `loadCadenceMap()`  [INFERRED]
  supabase\functions\siteops-chase\index.ts → supabase\functions\whatsapp-webhook\_siteops_timing.ts
- `logRouterDecision()` --calls--> `dispatch()`  [INFERRED]
  supabase\functions\whatsapp-webhook\_conversation.ts → supabase\functions\whatsapp-webhook\_dispatch.ts
- `scoreProjects()` --calls--> `resolveProject()`  [INFERRED]
  supabase\functions\whatsapp-webhook\_match.ts → supabase\functions\whatsapp-webhook\_resolve.ts
- `mBatch()` --calls--> `line()`  [INFERRED]
  supabase\functions\whatsapp-webhook\_messages.ts → supabase\functions\whatsapp-webhook\__tests__\resolution_llm.test.ts
- `mBatch()` --calls--> `money()`  [INFERRED]
  supabase\functions\whatsapp-webhook\_messages.ts → supabase\functions\whatsapp-webhook\__tests__\reporting_payment.test.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (104): answerSiteops(), answerWithPhoto(), applyBatchResolution(), applyQcFailures(), applyTaskBlockedById(), applyTaskProgressById(), applyTaskUpdate(), applyTerminals() (+96 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (37): baseSeed(), twoAskSeed(), ask(), ctxFor(), model(), tUpdated(), upd(), ctxFor() (+29 more)

### Community 2 - "Community 2"
Cohesion: 0.02
Nodes (83): classifyPhotoFollowup(), d(), call(), issue(), prog(), seed(), task(), fmtDay() (+75 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (111): bindingKey(), graphIsMaterialized(), materializeProjectTasksUncached(), placeOfTask(), gatesByTask(), gatesFromBinding(), safeGeometry(), safeInstantiate() (+103 more)

### Community 4 - "Community 4"
Cohesion: 0.03
Nodes (107): answerProcurement(), commitInterruptedProc(), finalizeDirectVendor(), flowIdFor(), handleSingle(), loadApprover(), loadProjects(), loadVendors() (+99 more)

### Community 5 - "Community 5"
Cohesion: 0.04
Nodes (73): isStopWord(), addCustomBrand(), brandsFor(), getCustomBrands(), LS_KEY(), buildConflictPills(), buildNovelVariantPills(), buildPills() (+65 more)

### Community 6 - "Community 6"
Cohesion: 0.04
Nodes (64): composeLLM(), fallbackReply(), isGreeting(), runConcierge(), systemFor(), userContent(), stampPossibleFollowup(), file() (+56 more)

### Community 7 - "Community 7"
Cohesion: 0.05
Nodes (67): clean(), dayBookLink(), entryLink(), partyLedgerLink(), problemLink(), reviewLink(), taskLink(), tasksLink() (+59 more)

### Community 8 - "Community 8"
Cohesion: 0.04
Nodes (49): applyAll(), byTypeFor(), commitMove(), goTo(), loop(), measure(), moveTo(), nearestTo() (+41 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (42): handler(), close(), go(), handleClose(), handleOpen(), toggle(), close(), handleSave() (+34 more)

### Community 10 - "Community 10"
Cohesion: 0.04
Nodes (28): handleSave(), suggestCostCode(), costCodeLabel(), getCostCode(), classifyExpenseHead(), openDoc(), resolveDocUrl(), deriveDirection() (+20 more)

### Community 11 - "Community 11"
Cohesion: 0.05
Nodes (38): useDeskApi(), useMockDeskApi(), ago(), assignReasonOf(), bucketRef(), buildChase(), buildStory(), buildTaskStory() (+30 more)

### Community 12 - "Community 12"
Cohesion: 0.06
Nodes (37): allocIdOf(), assertLinkable(), attachToContract(), createContract(), fallbackTitle(), fileAsLabour(), generateContractTitle(), getTrackingOptions() (+29 more)

### Community 13 - "Community 13"
Cohesion: 0.05
Nodes (28): amountInWords(), amountText(), dataPair(), drawFooter(), drawHeader(), drawLogoMark(), drawRule(), drawSignatures() (+20 more)

### Community 14 - "Community 14"
Cohesion: 0.05
Nodes (28): patchProblem(), toggleSnag(), patchProblem(), toggleSnag(), appendEvent(), legacyToFollowupType(), notifyAssignment(), trailKey() (+20 more)

### Community 15 - "Community 15"
Cohesion: 0.07
Nodes (31): daysLeft(), digits(), doEnable(), intlPhone(), local10(), onToggle(), prettyPhone(), roleLabel() (+23 more)

### Community 16 - "Community 16"
Cohesion: 0.06
Nodes (21): parseAmount(), commitEdit(), useSnackbar(), add(), applyPercent(), multiply(), parseAmount(), round() (+13 more)

### Community 17 - "Community 17"
Cohesion: 0.06
Nodes (16): readStoredSession(), useAuth(), useCan(), useOrgId(), classifyRefreshError(), extractErrorCode(), parseStoredSession(), PeekLink() (+8 more)

### Community 18 - "Community 18"
Cohesion: 0.11
Nodes (34): callOpenAI(), classifyImage(), classifyImageAnthropic(), classifyImageOpenAI(), classifyIntent(), classifyIntentAI(), classifyMessage(), isValidClass() (+26 more)

### Community 19 - "Community 19"
Cohesion: 0.08
Nodes (21): payeeSimilarityScore(), bandedMatch(), canonRole(), isKnownTrade(), levenshtein(), matchPayee(), nameTokenScore(), rankPayeeName() (+13 more)

### Community 20 - "Community 20"
Cohesion: 0.11
Nodes (21): saidAsOf(), line(), buildCandidateSet(), buildResolutionUser(), disposeRawResponse(), isBool(), isStr(), isStrOrNull() (+13 more)

### Community 21 - "Community 21"
Cohesion: 0.09
Nodes (8): buildComponents(), buildTemplateMessage(), sendTemplate(), line(), promptFor(), withTask(), cadenceFor(), recordChase()

### Community 22 - "Community 22"
Cohesion: 0.13
Nodes (15): clearAllFilters(), derive(), fmtShortDate(), inr(), isOverdue(), milestoneState(), poFullyReceived(), poHasBill() (+7 more)

### Community 23 - "Community 23"
Cohesion: 0.14
Nodes (20): buildClassifierPrompt(), clamp01(), classifyUserTask(), dedupe(), gatewayAnchor(), introducesCycle(), resolveFreedomSet(), sanitizeScope() (+12 more)

### Community 24 - "Community 24"
Cohesion: 0.08
Nodes (3): taskStatus(), upNextRefs(), statusOf()

### Community 25 - "Community 25"
Cohesion: 0.15
Nodes (16): fanOutQc(), persistGraph(), reconcile(), toPersistRows(), buildStack(), expand(), habitableLabels(), unitLabels() (+8 more)

### Community 26 - "Community 26"
Cohesion: 0.16
Nodes (13): errMessage(), fileRoughEntry(), fileRoughEntrySplit(), genTxnId(), rejectRoughEntry(), restoreRoughEntry(), leave(), runFile() (+5 more)

### Community 27 - "Community 27"
Cohesion: 0.19
Nodes (10): expect(), expectThrows(), fmt(), norm(), runAll(), suite(), test(), body() (+2 more)

### Community 28 - "Community 28"
Cohesion: 0.2
Nodes (3): Evaluator, messageFor(), verdictFor()

### Community 29 - "Community 29"
Cohesion: 0.19
Nodes (14): buildExtractionPrompt(), buildReRankPrompt(), cleanExtractionResult(), extractItems(), generateStructuredSkuWithContext(), generateVectorEmbedding(), looksLikePlaceholder(), matchItems() (+6 more)

### Community 30 - "Community 30"
Cohesion: 0.18
Nodes (10): billedOf(), closeDrawer(), creditOf(), exportCsv(), h(), outstandingOf(), paidOf(), saveParty() (+2 more)

### Community 31 - "Community 31"
Cohesion: 0.12
Nodes (2): seed(), SEED2()

### Community 32 - "Community 32"
Cohesion: 0.15
Nodes (3): cand(), floorSeed(), fourFloors()

### Community 33 - "Community 33"
Cohesion: 0.16
Nodes (5): ProjectHome(), useProjectCode(), if(), isClientReceipt(), isExcludedFromSpent()

### Community 34 - "Community 34"
Cohesion: 0.22
Nodes (8): attempt(), attemptQuiet(), onEditSave(), onPrimary(), onSend(), onTaskDur(), onTaskNote(), onTaskState()

### Community 35 - "Community 35"
Cohesion: 0.15
Nodes (2): clearPersistedCache(), doSignOut()

### Community 36 - "Community 36"
Cohesion: 0.18
Nodes (3): BI(), chaseSeed(), seed()

### Community 37 - "Community 37"
Cohesion: 0.18
Nodes (2): handleClose(), handleKeyDown()

### Community 38 - "Community 38"
Cohesion: 0.32
Nodes (11): act(), briklayChat(), checkRegistration(), greetOnce(), local10(), onlyDigits(), onTap(), prettyPhone() (+3 more)

### Community 39 - "Community 39"
Cohesion: 0.21
Nodes (5): base(), nearest(), upd(), updResolve(), withNearest()

### Community 42 - "Community 42"
Cohesion: 0.29
Nodes (7): bandRange(), buildRationale(), draftStages(), extractMeasured(), normalizeWeights(), templateKeyForTrade(), titleCase()

### Community 43 - "Community 43"
Cohesion: 0.31
Nodes (6): confirmSpawn(), invalidate(), invalidateObjects(), onPickFile(), post(), quickAction()

### Community 46 - "Community 46"
Cohesion: 0.25
Nodes (2): advanceFromName(), tick()

### Community 47 - "Community 47"
Cohesion: 0.39
Nodes (7): boundedFetch(), coalescedRefresh(), hasBearer(), isOnline(), timeoutFetch(), urlOf(), withBearer()

### Community 48 - "Community 48"
Cohesion: 0.33
Nodes (4): canonicalRank(), findAbstractCycle(), isHardNature(), validateLibrary()

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

### Community 56 - "Community 56"
Cohesion: 0.29
Nodes (2): model(), R_CREATE()

### Community 58 - "Community 58"
Cohesion: 0.33
Nodes (3): handleCreateProject(), fmtProjectId(), uniqueProjectId()

### Community 59 - "Community 59"
Cohesion: 0.43
Nodes (4): genId(), handleKeyDown(), patchRow(), saveRow()

### Community 60 - "Community 60"
Cohesion: 0.43
Nodes (5): TxnRow(), dot(), formatShortDate(), formatTxn(), isCostCode()

### Community 61 - "Community 61"
Cohesion: 0.48
Nodes (5): usePrefetchPO(), usePrefetchStakeholder(), usePrefetchTxn(), usePrefetchWO(), useThrottledPrefetch()

### Community 66 - "Community 66"
Cohesion: 0.33
Nodes (2): handled(), minsAgo()

### Community 75 - "Community 75"
Cohesion: 0.53
Nodes (4): importPO(), importTxn(), importWO(), preloadPeekChunks()

### Community 84 - "Community 84"
Cohesion: 0.5
Nodes (2): prefetchTxn(), txnPeekKey()

### Community 88 - "Community 88"
Cohesion: 0.6
Nodes (3): classificationsByName(), norm(), snapClassification()

### Community 90 - "Community 90"
Cohesion: 0.7
Nodes (4): nodeKey(), nodeKeyOf(), unitKeyOf(), zoneIdOf()

### Community 91 - "Community 91"
Cohesion: 0.5
Nodes (2): FinancialsCashflow(), lastNMonths()

### Community 98 - "Community 98"
Cohesion: 0.67
Nodes (2): handleClose(), handleSubmit()

### Community 101 - "Community 101"
Cohesion: 0.67
Nodes (2): bloom(), REDUCED()

### Community 107 - "Community 107"
Cohesion: 0.67
Nodes (2): concealedByPlaster(), unit()

### Community 127 - "Community 127"
Cohesion: 1.0
Nodes (2): downloadGRNChallan(), fmtDate()

### Community 128 - "Community 128"
Cohesion: 1.0
Nodes (2): poGateState(), poIsPriced()

### Community 130 - "Community 130"
Cohesion: 1.0
Nodes (2): insertionIndex(), withNewTask()

### Community 133 - "Community 133"
Cohesion: 1.0
Nodes (2): placeOf(), stageOfFloorless()

## Knowledge Gaps
- **Thin community `Community 31`** (17 nodes): `no_such_floor_ask.test.ts`, `base()`, `blindModel()`, `convoOf()`, `ctxPin()`, `geo()`, `imgCtx()`, `model()`, `preambleOf()`, `projConvoOf()`, `row()`, `seed()`, `SEED2()`, `shortlist()`, `stateWrites()`, `textCtx()`, `tUpd()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (13 nodes): `clearPersistedCache()`, `shouldPersistQuery()`, `can()`, `doSignOut()`, `e()`, `h()`, `initials()`, `isActive()`, `measure()`, `RailItem()`, `RailLabel()`, `BriklayRail.tsx`, `queryClient.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (12 nodes): `DrawerSkeleton()`, `filterRow()`, `fmt()`, `formatLedgerDate()`, `getInitials()`, `handleAddTransaction()`, `handleClose()`, `handleKeyDown()`, `monthHeading()`, `monthKey()`, `splitByProject()`, `StakeholderLedgerDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (9 nodes): `advanceFromName()`, `choose()`, `onRowClick()`, `pickExisting()`, `settle()`, `tick()`, `toMatch()`, `undo()`, `ResolveRow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (9 nodes): `singular_unit.test.ts`, `cm()`, `ctxFor()`, `DEC()`, `DEC_EMPTY()`, `decomposeCalls()`, `resolutionCalls()`, `seed()`, `unitModel()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (8 nodes): `away()`, `ProblemRow()`, `useIsDesktop()`, `useIsTouch()`, `useRowClose()`, `useSwipe()`, `Problems.tsx`, `useDesk.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (8 nodes): `byRecent()`, `dismiss()`, `handleFiled()`, `handleRejected()`, `invalidateEntries()`, `restore()`, `viewTxn()`, `Logbook.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (8 nodes): `held_project_fold.test.ts`, `convoOf()`, `ctxFor()`, `it()`, `model()`, `projectSlots()`, `R_CREATE()`, `seed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (7 nodes): `duplicate_narration.test.ts`, `calls()`, `ctxFor()`, `handled()`, `minsAgo()`, `model()`, `seed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (5 nodes): `fmtDate()`, `prefetchTxn()`, `txnPeekFn()`, `txnPeekKey()`, `TransactionPeek.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 91`** (5 nodes): `FinancialsCashflow()`, `fmt()`, `lastNMonths()`, `monthLabel()`, `FinancialsCashflow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 98`** (4 nodes): `handleClose()`, `handleSubmit()`, `updateRow()`, `QuoteEntryDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 101`** (4 nodes): `bloom()`, `Btn()`, `REDUCED()`, `Btn.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 107`** (4 nodes): `evaluate.test.ts`, `blockworkDoneGround()`, `concealedByPlaster()`, `unit()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 127`** (3 nodes): `downloadGRNChallan()`, `fmtDate()`, `grnChallan.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 128`** (3 nodes): `poGateState()`, `poIsPriced()`, `poLifecycle.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 130`** (3 nodes): `insertionIndex()`, `withNewTask()`, `add.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 133`** (3 nodes): `placeOf()`, `stageOfFloorless()`, `stages.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `parseAmount()` connect `Community 16` to `Community 4`?**
  _High betweenness centrality (0.110) - this node is a cross-community bridge._
- **Why does `NewInvoice()` connect `Community 16` to `Community 17`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Why does `materializeProjectTasksUncached()` connect `Community 3` to `Community 0`, `Community 20`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Are the 41 inferred relationships involving `send()` (e.g. with `processJob()` and `resurfacePending()`) actually correct?**
  _`send()` has 41 INFERRED edges - model-reasoned connections that need verification._
- **Are the 29 inferred relationships involving `dispatch()` (e.g. with `processJob()` and `send()`) actually correct?**
  _`dispatch()` has 29 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `answerSiteops()` (e.g. with `closeConversation()` and `sendNowDurable()`) actually correct?**
  _`answerSiteops()` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 18 inferred relationships involving `runSiteops()` (e.g. with `getOpenBatch()` and `resolveProject()`) actually correct?**
  _`runSiteops()` has 18 INFERRED edges - model-reasoned connections that need verification._