# Graph Report - Briklay Fly  (2026-09-03)

## Corpus Check
- 735 files · ~1,344,059 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3202 nodes · 5001 edges · 74 communities detected
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 723 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 107|Community 107]]
- [[_COMMUNITY_Community 119|Community 119]]
- [[_COMMUNITY_Community 120|Community 120]]
- [[_COMMUNITY_Community 122|Community 122]]
- [[_COMMUNITY_Community 125|Community 125]]

## God Nodes (most connected - your core abstractions)
1. `pick()` - 54 edges
2. `send()` - 45 edges
3. `dispatch()` - 38 edges
4. `answerSiteops()` - 36 edges
5. `runSiteops()` - 32 edges
6. `show()` - 27 edges
7. `applyTerminals()` - 27 edges
8. `resolveAgainstSingleFamily()` - 24 edges
9. `handlePillSelection()` - 22 edges
10. `sendNowDurable()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `mondayOf()` --calls--> `settleWeeklyPaymentOnLedger()`  [INFERRED]
  src\lib\attendanceApi.ts → src\lib\weeklyPaymentsApi.ts
- `capFirst()` --calls--> `normalizeTxn()`  [INFERRED]
  src\pages\NewPurchaseOrder.tsx → supabase\functions\whatsapp-webhook\_extract.ts
- `cadenceFor()` --calls--> `loadCadenceMap()`  [INFERRED]
  supabase\functions\siteops-chase\index.ts → supabase\functions\whatsapp-webhook\_siteops_timing.ts
- `scoreProjects()` --calls--> `resolveProject()`  [INFERRED]
  supabase\functions\whatsapp-webhook\_match.ts → supabase\functions\whatsapp-webhook\_resolve.ts
- `mBatch()` --calls--> `line()`  [INFERRED]
  supabase\functions\whatsapp-webhook\_messages.ts → supabase\functions\whatsapp-webhook\__tests__\resolution_llm.test.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (107): answerSiteops(), answerWithPhoto(), applyBatchResolution(), applyQcFailures(), applyTaskBlockedById(), applyTaskProgressById(), applyTaskUpdate(), applyTerminals() (+99 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (127): bindingKey(), graphIsMaterialized(), materializeProjectTasksUncached(), placeOfTask(), gatesByTask(), gatesFromBinding(), safeGeometry(), safeInstantiate() (+119 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (111): composeLLM(), fallbackReply(), isGreeting(), runConcierge(), systemFor(), userContent(), commitInterruptedProc(), stampPossibleFollowup() (+103 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (82): submit(), addOpening(), remove(), saveDate(), decide(), inr(), submit(), daysLeft() (+74 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (33): baseSeed(), twoAskSeed(), ask(), ctxFor(), model(), tUpdated(), upd(), base() (+25 more)

### Community 5 - "Community 5"
Cohesion: 0.04
Nodes (77): isStopWord(), addCustomBrand(), brandsFor(), getCustomBrands(), LS_KEY(), buildConflictPills(), buildNovelVariantPills(), buildPills() (+69 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (74): allocIdOf(), assertLinkable(), attachToContract(), clearOneTime(), createContract(), fallbackTitle(), fileAsLabour(), generateContractTitle() (+66 more)

### Community 7 - "Community 7"
Cohesion: 0.03
Nodes (49): classifyPhotoFollowup(), wa(), buildComponents(), buildTemplateMessage(), sendTemplate(), line(), promptFor(), withTask() (+41 more)

### Community 8 - "Community 8"
Cohesion: 0.05
Nodes (70): commitEdit(), imageDeterministic(), parseDigitToken(), parseSpokenAmount(), callClaude(), callOpenAI(), classifyImage(), classifyImageAnthropic() (+62 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (43): tradeWords(), call(), issue(), prog(), seed(), task(), bestTokenOverlap(), pickTokens() (+35 more)

### Community 10 - "Community 10"
Cohesion: 0.05
Nodes (74): answerProcurement(), finalizeDirectVendor(), flowIdFor(), handleSingle(), loadApprover(), loadProjects(), loadVendors(), markReadyForApproval() (+66 more)

### Community 11 - "Community 11"
Cohesion: 0.04
Nodes (51): backfillOrg(), backfillParty(), deriveCertified(), num(), today(), deriveParty(), num(), parityOrg() (+43 more)

### Community 12 - "Community 12"
Cohesion: 0.04
Nodes (38): openDoc(), parseStoredPath(), resolveDocUrl(), async(), patchProblem(), toggleSnag(), fileToBase64Str(), fireCelebration() (+30 more)

### Community 13 - "Community 13"
Cohesion: 0.04
Nodes (29): answerPaymentTotal(), answerReporting(), groupBySite(), loadProjects(), loadStakeholders(), num(), orderRows(), pickFrom() (+21 more)

### Community 14 - "Community 14"
Cohesion: 0.04
Nodes (42): handler(), close(), go(), handleClose(), handleOpen(), toggle(), close(), handleSave() (+34 more)

### Community 15 - "Community 15"
Cohesion: 0.05
Nodes (33): balStr(), buildPartyStatementDoc(), downloadPartyStatement(), money(), ordered(), amountInWords(), amountText(), dataPair() (+25 more)

### Community 16 - "Community 16"
Cohesion: 0.05
Nodes (40): addDepartment(), addEntity(), applyFilter(), bind(), chooseKind(), clear(), col(), dayCell() (+32 more)

### Community 17 - "Community 17"
Cohesion: 0.05
Nodes (39): useDeskApi(), useMockDeskApi(), ago(), assignReasonOf(), bucketRef(), buildChase(), buildStory(), buildTaskStory() (+31 more)

### Community 18 - "Community 18"
Cohesion: 0.04
Nodes (26): handleSave(), suggestCostCode(), costCodeLabel(), getCostCode(), classifyExpenseHead(), deriveDirection(), escapeRegExp(), generalExpenseLabel() (+18 more)

### Community 19 - "Community 19"
Cohesion: 0.07
Nodes (29): autoSplit(), blank(), doCreate(), evenAmounts(), file(), matchGenHeads(), normHead(), pickGen() (+21 more)

### Community 20 - "Community 20"
Cohesion: 0.07
Nodes (32): applyAll(), imgCtx(), runTurn(), seed(), task(), checkExprAt(), findMigrationsDir(), loadEnumChecks() (+24 more)

### Community 21 - "Community 21"
Cohesion: 0.07
Nodes (19): readStoredSession(), useAuth(), useCan(), useOrgId(), classifyRefreshError(), extractErrorCode(), parseStoredSession(), useSnackbar() (+11 more)

### Community 22 - "Community 22"
Cohesion: 0.07
Nodes (21): addStage(), attemptCreate(), blankStage(), calcAmount(), clearBad(), fmt(), getMode(), h() (+13 more)

### Community 23 - "Community 23"
Cohesion: 0.1
Nodes (22): saidAsOf(), fiveFloors(), line(), buildCandidateSet(), buildResolutionUser(), disposeRawResponse(), isBool(), isStr() (+14 more)

### Community 24 - "Community 24"
Cohesion: 0.1
Nodes (16): byTypeFor(), commitMove(), goTo(), loop(), measure(), moveTo(), nearestTo(), onLeave() (+8 more)

### Community 25 - "Community 25"
Cohesion: 0.13
Nodes (20): bandedMatch(), canonRole(), isKnownTrade(), levenshtein(), matchPayee(), nameTokenScore(), rankPayeeName(), roleVerdict() (+12 more)

### Community 26 - "Community 26"
Cohesion: 0.14
Nodes (20): buildClassifierPrompt(), clamp01(), classifyUserTask(), dedupe(), gatewayAnchor(), introducesCycle(), resolveFreedomSet(), sanitizeScope() (+12 more)

### Community 27 - "Community 27"
Cohesion: 0.19
Nodes (10): expect(), expectThrows(), fmt(), norm(), runAll(), suite(), test(), body() (+2 more)

### Community 28 - "Community 28"
Cohesion: 0.11
Nodes (4): clearPersistedCache(), doSignOut(), onEnter(), start()

### Community 29 - "Community 29"
Cohesion: 0.2
Nodes (3): Evaluator, messageFor(), verdictFor()

### Community 30 - "Community 30"
Cohesion: 0.19
Nodes (14): buildExtractionPrompt(), buildReRankPrompt(), cleanExtractionResult(), extractItems(), generateStructuredSkuWithContext(), generateVectorEmbedding(), looksLikePlaceholder(), matchItems() (+6 more)

### Community 31 - "Community 31"
Cohesion: 0.12
Nodes (2): seed(), SEED2()

### Community 32 - "Community 32"
Cohesion: 0.17
Nodes (7): addPhotos(), fmt(), goodOf(), handleSubmit(), parseTiffDate(), readExifDate(), readPhotoDate()

### Community 33 - "Community 33"
Cohesion: 0.14
Nodes (2): matchGenHeads(), normHead()

### Community 34 - "Community 34"
Cohesion: 0.15
Nodes (3): cand(), floorSeed(), fourFloors()

### Community 35 - "Community 35"
Cohesion: 0.16
Nodes (5): ProjectHome(), useProjectCode(), if(), isClientReceipt(), isExcludedFromSpent()

### Community 36 - "Community 36"
Cohesion: 0.19
Nodes (6): ctxFor(), imgCtx(), tQItem(), tTaskUpdate(), tUpdateResolve(), upd()

### Community 37 - "Community 37"
Cohesion: 0.18
Nodes (3): BI(), chaseSeed(), seed()

### Community 38 - "Community 38"
Cohesion: 0.32
Nodes (11): act(), briklayChat(), checkRegistration(), greetOnce(), local10(), onlyDigits(), onTap(), prettyPhone() (+3 more)

### Community 39 - "Community 39"
Cohesion: 0.2
Nodes (4): amtOf(), dismiss(), entryView(), invalidateEntries()

### Community 41 - "Community 41"
Cohesion: 0.24
Nodes (5): isValidEmail(), saveEmail(), sendPhoneOtp(), toE164(), verifyPhoneOtp()

### Community 43 - "Community 43"
Cohesion: 0.29
Nodes (7): bandRange(), buildRationale(), draftStages(), extractMeasured(), normalizeWeights(), templateKeyForTrade(), titleCase()

### Community 44 - "Community 44"
Cohesion: 0.31
Nodes (6): confirmSpawn(), invalidate(), invalidateObjects(), onPickFile(), post(), quickAction()

### Community 45 - "Community 45"
Cohesion: 0.22
Nodes (2): closed(), openLive()

### Community 46 - "Community 46"
Cohesion: 0.27
Nodes (6): PeekLink(), fmtDate(), Label(), summarizeScope(), woTone(), usePeek()

### Community 49 - "Community 49"
Cohesion: 0.25
Nodes (2): advanceFromName(), tick()

### Community 50 - "Community 50"
Cohesion: 0.39
Nodes (7): boundedFetch(), coalescedRefresh(), hasBearer(), isOnline(), timeoutFetch(), urlOf(), withBearer()

### Community 51 - "Community 51"
Cohesion: 0.33
Nodes (4): canonicalRank(), findAbstractCycle(), isHardNature(), validateLibrary()

### Community 52 - "Community 52"
Cohesion: 0.25
Nodes (2): ProblemRow(), useSwipe()

### Community 53 - "Community 53"
Cohesion: 0.32
Nodes (3): handleSendOtp(), handleVerifyOtp(), toE164()

### Community 54 - "Community 54"
Cohesion: 0.32
Nodes (5): autoSet(), isOn(), ruleHints(), toggle(), A()

### Community 55 - "Community 55"
Cohesion: 0.36
Nodes (4): getInitials(), levenshtein(), matchPayee(), matchProject()

### Community 57 - "Community 57"
Cohesion: 0.29
Nodes (2): model(), R_CREATE()

### Community 59 - "Community 59"
Cohesion: 0.33
Nodes (3): handleCreateProject(), fmtProjectId(), uniqueProjectId()

### Community 60 - "Community 60"
Cohesion: 0.43
Nodes (4): genId(), handleKeyDown(), patchRow(), saveRow()

### Community 61 - "Community 61"
Cohesion: 0.48
Nodes (5): usePrefetchPO(), usePrefetchStakeholder(), usePrefetchTxn(), usePrefetchWO(), useThrottledPrefetch()

### Community 63 - "Community 63"
Cohesion: 0.43
Nodes (5): TxnRow(), dot(), formatShortDate(), formatTxn(), isCostCode()

### Community 66 - "Community 66"
Cohesion: 0.33
Nodes (2): handled(), minsAgo()

### Community 69 - "Community 69"
Cohesion: 0.4
Nodes (2): go(), onKey()

### Community 71 - "Community 71"
Cohesion: 0.53
Nodes (4): importPO(), importTxn(), importWO(), preloadPeekChunks()

### Community 76 - "Community 76"
Cohesion: 0.6
Nodes (3): isValidMobile(), localDigits(), PhoneInput()

### Community 77 - "Community 77"
Cohesion: 0.5
Nodes (2): prefetchTxn(), txnPeekKey()

### Community 80 - "Community 80"
Cohesion: 0.6
Nodes (3): classificationsByName(), norm(), snapClassification()

### Community 82 - "Community 82"
Cohesion: 0.7
Nodes (4): nodeKey(), nodeKeyOf(), unitKeyOf(), zoneIdOf()

### Community 83 - "Community 83"
Cohesion: 0.5
Nodes (2): FinancialsCashflow(), lastNMonths()

### Community 89 - "Community 89"
Cohesion: 0.67
Nodes (2): handleClose(), handleSubmit()

### Community 91 - "Community 91"
Cohesion: 0.67
Nodes (2): bloom(), REDUCED()

### Community 98 - "Community 98"
Cohesion: 0.67
Nodes (2): concealedByPlaster(), unit()

### Community 102 - "Community 102"
Cohesion: 0.83
Nodes (3): json(), judge(), serperListings()

### Community 107 - "Community 107"
Cohesion: 1.0
Nodes (2): handleClose(), onKey()

### Community 119 - "Community 119"
Cohesion: 1.0
Nodes (2): downloadGRNChallan(), fmtDate()

### Community 120 - "Community 120"
Cohesion: 1.0
Nodes (2): poGateState(), poIsPriced()

### Community 122 - "Community 122"
Cohesion: 1.0
Nodes (2): insertionIndex(), withNewTask()

### Community 125 - "Community 125"
Cohesion: 1.0
Nodes (2): placeOf(), stageOfFloorless()

## Knowledge Gaps
- **Thin community `Community 31`** (17 nodes): `no_such_floor_ask.test.ts`, `base()`, `blindModel()`, `convoOf()`, `ctxPin()`, `geo()`, `imgCtx()`, `model()`, `preambleOf()`, `projConvoOf()`, `row()`, `seed()`, `SEED2()`, `shortlist()`, `stateWrites()`, `textCtx()`, `tUpd()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (15 nodes): `add()`, `capitalizeWords()`, `FieldQuestion()`, `fieldStyle()`, `h()`, `matchGenHeads()`, `normHead()`, `openCreate()`, `pickGeneralHead()`, `rm()`, `selectPayee()`, `uid()`, `up()`, `update()`, `ResolvePopup.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (10 nodes): `WOListSheet.tsx`, `balance()`, `closed()`, `D()`, `doneStages()`, `dstr()`, `fmt()`, `openLive()`, `pctPaid()`, `useWOListData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (9 nodes): `advanceFromName()`, `choose()`, `onRowClick()`, `pickExisting()`, `settle()`, `tick()`, `toMatch()`, `undo()`, `ResolveRow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (8 nodes): `away()`, `ProblemRow()`, `useIsDesktop()`, `useIsTouch()`, `useRowClose()`, `useSwipe()`, `Problems.tsx`, `useDesk.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (8 nodes): `held_project_fold.test.ts`, `convoOf()`, `ctxFor()`, `it()`, `model()`, `projectSlots()`, `R_CREATE()`, `seed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (7 nodes): `duplicate_narration.test.ts`, `calls()`, `ctxFor()`, `handled()`, `minsAgo()`, `model()`, `seed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (6 nodes): `DirLabel()`, `go()`, `onDown()`, `onKey()`, `opt()`, `NewTxnFab.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (5 nodes): `fmtDate()`, `prefetchTxn()`, `txnPeekFn()`, `txnPeekKey()`, `TransactionPeek.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (5 nodes): `FinancialsCashflow()`, `fmt()`, `lastNMonths()`, `monthLabel()`, `FinancialsCashflow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 89`** (4 nodes): `handleClose()`, `handleSubmit()`, `updateRow()`, `QuoteEntryDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 91`** (4 nodes): `bloom()`, `Btn()`, `REDUCED()`, `Btn.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 98`** (4 nodes): `evaluate.test.ts`, `blockworkDoneGround()`, `concealedByPlaster()`, `unit()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 107`** (3 nodes): `handleClose()`, `onKey()`, `StakeholderLedgerDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 119`** (3 nodes): `downloadGRNChallan()`, `fmtDate()`, `grnChallan.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 120`** (3 nodes): `poGateState()`, `poIsPriced()`, `poLifecycle.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 122`** (3 nodes): `insertionIndex()`, `withNewTask()`, `add.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 125`** (3 nodes): `placeOf()`, `stageOfFloorless()`, `stages.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `parseAmount()` connect `Community 2` to `Community 8`, `Community 21`?**
  _High betweenness centrality (0.158) - this node is a cross-community bridge._
- **Why does `NewInvoice()` connect `Community 21` to `Community 8`, `Community 2`, `Community 11`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._
- **Why does `saveRefBill()` connect `Community 2` to `Community 12`?**
  _High betweenness centrality (0.083) - this node is a cross-community bridge._
- **Are the 41 inferred relationships involving `send()` (e.g. with `processJob()` and `resurfacePending()`) actually correct?**
  _`send()` has 41 INFERRED edges - model-reasoned connections that need verification._
- **Are the 29 inferred relationships involving `dispatch()` (e.g. with `processJob()` and `send()`) actually correct?**
  _`dispatch()` has 29 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `answerSiteops()` (e.g. with `closeConversation()` and `sendNowDurable()`) actually correct?**
  _`answerSiteops()` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 18 inferred relationships involving `runSiteops()` (e.g. with `getOpenBatch()` and `resolveProject()`) actually correct?**
  _`runSiteops()` has 18 INFERRED edges - model-reasoned connections that need verification._