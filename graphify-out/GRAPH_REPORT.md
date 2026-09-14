# Graph Report - Briklay Fly  (2026-09-14)

## Corpus Check
- 835 files · ~1,503,071 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3646 nodes · 5777 edges · 79 communities detected
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 888 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 107|Community 107]]
- [[_COMMUNITY_Community 119|Community 119]]
- [[_COMMUNITY_Community 121|Community 121]]
- [[_COMMUNITY_Community 124|Community 124]]

## God Nodes (most connected - your core abstractions)
1. `pick()` - 64 edges
2. `send()` - 47 edges
3. `dispatch()` - 46 edges
4. `answerSiteops()` - 36 edges
5. `runSiteops()` - 33 edges
6. `show()` - 29 edges
7. `applyTerminals()` - 27 edges
8. `resolveAgainstSingleFamily()` - 24 edges
9. `handlePillSelection()` - 22 edges
10. `sendNowDurable()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `openContractPicker()` --calls--> `loadWorkOrdersForProject()`  [INFERRED]
  src\components\attendance\AttendanceMobile.tsx → src\lib\attendanceApi.ts
- `buildChase()` --calls--> `nameOf()`  [INFERRED]
  src\lib\desk\fromDb.ts → supabase\functions\siteops-notify-assignment\index.ts
- `cadenceFor()` --calls--> `loadCadenceMap()`  [INFERRED]
  supabase\functions\siteops-chase\index.ts → supabase\functions\whatsapp-webhook\_siteops_timing.ts
- `mBatch()` --calls--> `line()`  [INFERRED]
  supabase\functions\whatsapp-webhook\_messages.ts → supabase\functions\whatsapp-webhook\__tests__\resolution_llm.test.ts
- `mPartyLedger()` --calls--> `row()`  [INFERRED]
  supabase\functions\whatsapp-webhook\_messages.ts → supabase\functions\whatsapp-webhook\__tests__\type_tie.test.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (118): answerSiteops(), answerWithPhoto(), applyBatchResolution(), applyQcFailures(), applyTaskBlockedById(), applyTaskProgressById(), applyTaskUpdate(), applyTerminals() (+110 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (199): answerBillPayment(), attachBillDoc(), billAi(), billRawText(), billReplyKind(), findPrecedingCaption(), fmtNum(), isCleanAmount() (+191 more)

### Community 2 - "Community 2"
Cohesion: 0.01
Nodes (35): baseSeed(), twoAskSeed(), ask(), ctxFor(), model(), tUpdated(), upd(), seed() (+27 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (98): at(), submit(), clearOpening(), doMerge(), fmtDate(), inr(), rowAmount(), rowDir() (+90 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (127): bindingKey(), graphIsMaterialized(), materializeProjectTasksUncached(), placeOfTask(), gatesByTask(), gatesFromBinding(), safeGeometry(), safeInstantiate() (+119 more)

### Community 5 - "Community 5"
Cohesion: 0.02
Nodes (112): intakeCommit(), intakeExtract(), intakeResolveVendor(), runIntake(), linkParts(), rankLoosePayments(), convertLegacyPoBill(), createBill() (+104 more)

### Community 6 - "Community 6"
Cohesion: 0.04
Nodes (82): isStopWord(), addCustomBrand(), brandsFor(), getCustomBrands(), LS_KEY(), buildConflictPills(), buildNovelVariantPills(), buildPills() (+74 more)

### Community 7 - "Community 7"
Cohesion: 0.03
Nodes (68): confirm(), commit(), autoSettleCrewWages(), cardKeyToCols(), cellFrom(), commitCrewSettlement(), crewPhases(), iso() (+60 more)

### Community 8 - "Community 8"
Cohesion: 0.03
Nodes (49): classifyPhotoFollowup(), wa(), buildComponents(), buildTemplateMessage(), sendTemplate(), line(), promptFor(), withTask() (+41 more)

### Community 9 - "Community 9"
Cohesion: 0.03
Nodes (53): call(), issue(), prog(), seed(), task(), src(), stripComments(), renderHistory() (+45 more)

### Community 10 - "Community 10"
Cohesion: 0.05
Nodes (70): clean(), money(), ackLine(), buildPickVendorsFlow(), buildSelectVendorFlow(), buildSourcingPrompt(), buildVendorList(), entryLine() (+62 more)

### Community 11 - "Community 11"
Cohesion: 0.04
Nodes (49): isTouch(), startLamp(), applyAll(), byTypeFor(), commitMove(), goTo(), loop(), measure() (+41 more)

### Community 12 - "Community 12"
Cohesion: 0.03
Nodes (39): NewBillModal(), DragSheet(), PeekLink(), handleSave(), suggestCostCode(), fmtDate(), Label(), summarizeScope() (+31 more)

### Community 13 - "Community 13"
Cohesion: 0.05
Nodes (50): createVendor(), guessVendor(), low(), save(), whatsMissing(), autoSplit(), blank(), doCreate() (+42 more)

### Community 14 - "Community 14"
Cohesion: 0.04
Nodes (38): handleCreateProject(), fmtProjectId(), uniqueProjectId(), buzz(), finish(), go(), parseEntry(), saveFirm() (+30 more)

### Community 15 - "Community 15"
Cohesion: 0.03
Nodes (25): inr(), rupees(), Thumb(), deleteBill(), openDoc(), parseStoredPath(), resolveDocUrl(), useSignedDocUrl() (+17 more)

### Community 16 - "Community 16"
Cohesion: 0.07
Nodes (38): balStr(), downloadPartyStatementExcel(), fmtDate(), money(), ordered(), particularsOf(), vchNo(), vchType() (+30 more)

### Community 17 - "Community 17"
Cohesion: 0.06
Nodes (38): useDeskApi(), useMockDeskApi(), ago(), assignReasonOf(), bucketRef(), buildChase(), buildStory(), buildTaskStory() (+30 more)

### Community 18 - "Community 18"
Cohesion: 0.07
Nodes (35): closeSheet(), contractPct(), countOf(), end(), engagementForm(), esc(), fail(), go() (+27 more)

### Community 19 - "Community 19"
Cohesion: 0.07
Nodes (42): commitEdit(), keepTyping(), sendTypingIndicator(), buildConfirmMsg(), buildDescription(), createRoughEntry(), fetchImageAsBase64(), findTopMatches() (+34 more)

### Community 20 - "Community 20"
Cohesion: 0.05
Nodes (27): handler(), close(), go(), handleClose(), handleOpen(), toggle(), handler(), go() (+19 more)

### Community 21 - "Community 21"
Cohesion: 0.05
Nodes (30): buildImportRows(), commitImport(), clearImportDraft(), key(), loadImportDraft(), saveImportDraft(), detectColumns(), pad() (+22 more)

### Community 22 - "Community 22"
Cohesion: 0.05
Nodes (28): patchProblem(), toggleSnag(), patchProblem(), toggleSnag(), appendEvent(), legacyToFollowupType(), notifyAssignment(), trailKey() (+20 more)

### Community 23 - "Community 23"
Cohesion: 0.05
Nodes (23): AttendanceSheet(), isoOf(), readStoredSession(), useAuth(), useCan(), useOrgId(), classifyRefreshError(), extractErrorCode() (+15 more)

### Community 24 - "Community 24"
Cohesion: 0.06
Nodes (30): addStage(), attemptCreate(), blankStage(), calcAmount(), clearBad(), fmt(), getMode(), h() (+22 more)

### Community 25 - "Community 25"
Cohesion: 0.12
Nodes (14): auditLines(), n(), parseModelJson(), expect(), expectThrows(), fmt(), norm(), runAll() (+6 more)

### Community 26 - "Community 26"
Cohesion: 0.1
Nodes (21): createWallet(), issueFloat(), loadMyWallet(), loadWallets(), num(), removeWallet(), returnCash(), rowToWallet() (+13 more)

### Community 27 - "Community 27"
Cohesion: 0.14
Nodes (20): saidAsOf(), buildCandidateSet(), buildResolutionUser(), disposeRawResponse(), isBool(), isStr(), isStrOrNull(), loadGeometry() (+12 more)

### Community 28 - "Community 28"
Cohesion: 0.08
Nodes (8): handleSave(), h(), handleTap(), if(), ProjectHome(), useProjectCode(), onSelect(), pick()

### Community 29 - "Community 29"
Cohesion: 0.13
Nodes (20): bandedMatch(), canonRole(), isKnownTrade(), levenshtein(), matchPayee(), nameTokenScore(), rankPayeeName(), roleVerdict() (+12 more)

### Community 30 - "Community 30"
Cohesion: 0.14
Nodes (20): buildClassifierPrompt(), clamp01(), classifyUserTask(), dedupe(), gatewayAnchor(), introducesCycle(), resolveFreedomSet(), sanitizeScope() (+12 more)

### Community 31 - "Community 31"
Cohesion: 0.08
Nodes (3): taskStatus(), upNextRefs(), statusOf()

### Community 32 - "Community 32"
Cohesion: 0.2
Nodes (3): Evaluator, messageFor(), verdictFor()

### Community 33 - "Community 33"
Cohesion: 0.19
Nodes (14): buildExtractionPrompt(), buildReRankPrompt(), cleanExtractionResult(), extractItems(), generateStructuredSkuWithContext(), generateVectorEmbedding(), looksLikePlaceholder(), matchItems() (+6 more)

### Community 34 - "Community 34"
Cohesion: 0.17
Nodes (7): addPhotos(), fmt(), goodOf(), handleSubmit(), parseTiffDate(), readExifDate(), readPhotoDate()

### Community 35 - "Community 35"
Cohesion: 0.15
Nodes (3): cand(), floorSeed(), fourFloors()

### Community 36 - "Community 36"
Cohesion: 0.14
Nodes (2): clearPersistedCache(), doSignOut()

### Community 37 - "Community 37"
Cohesion: 0.18
Nodes (3): BI(), chaseSeed(), seed()

### Community 38 - "Community 38"
Cohesion: 0.32
Nodes (11): act(), briklayChat(), checkRegistration(), greetOnce(), local10(), onlyDigits(), onTap(), prettyPhone() (+3 more)

### Community 39 - "Community 39"
Cohesion: 0.21
Nodes (5): base(), nearest(), upd(), updResolve(), withNearest()

### Community 41 - "Community 41"
Cohesion: 0.29
Nodes (7): bandRange(), buildRationale(), draftStages(), extractMeasured(), normalizeWeights(), templateKeyForTrade(), titleCase()

### Community 42 - "Community 42"
Cohesion: 0.31
Nodes (5): fabClick(), go(), goDir(), hapt(), measure()

### Community 43 - "Community 43"
Cohesion: 0.31
Nodes (6): confirmSpawn(), invalidate(), invalidateObjects(), onPickFile(), post(), quickAction()

### Community 44 - "Community 44"
Cohesion: 0.22
Nodes (2): closed(), openLive()

### Community 45 - "Community 45"
Cohesion: 0.22
Nodes (2): isClientReceipt(), isExcludedFromSpent()

### Community 48 - "Community 48"
Cohesion: 0.28
Nodes (3): handleSendOtp(), handleVerifyOtp(), toE164()

### Community 49 - "Community 49"
Cohesion: 0.39
Nodes (7): boundedFetch(), coalescedRefresh(), hasBearer(), isOnline(), timeoutFetch(), urlOf(), withBearer()

### Community 50 - "Community 50"
Cohesion: 0.33
Nodes (4): canonicalRank(), findAbstractCycle(), isHardNature(), validateLibrary()

### Community 51 - "Community 51"
Cohesion: 0.25
Nodes (2): cm(), DEC()

### Community 52 - "Community 52"
Cohesion: 0.25
Nodes (2): ProblemRow(), useSwipe()

### Community 53 - "Community 53"
Cohesion: 0.29
Nodes (2): fmt(), stateOf()

### Community 54 - "Community 54"
Cohesion: 0.36
Nodes (5): chooseContact(), closeNum(), contactPicker(), digits(), finishNum()

### Community 55 - "Community 55"
Cohesion: 0.32
Nodes (5): autoSet(), isOn(), ruleHints(), toggle(), A()

### Community 56 - "Community 56"
Cohesion: 0.29
Nodes (2): getInitials(), matchProject()

### Community 57 - "Community 57"
Cohesion: 0.29
Nodes (2): model(), R_CREATE()

### Community 59 - "Community 59"
Cohesion: 0.43
Nodes (4): genId(), handleKeyDown(), patchRow(), saveRow()

### Community 60 - "Community 60"
Cohesion: 0.43
Nodes (5): TxnRow(), dot(), formatShortDate(), formatTxn(), isCostCode()

### Community 61 - "Community 61"
Cohesion: 0.48
Nodes (5): usePrefetchPO(), usePrefetchStakeholder(), usePrefetchTxn(), usePrefetchWO(), useThrottledPrefetch()

### Community 63 - "Community 63"
Cohesion: 0.71
Nodes (6): audio(), cueFail(), cueStart(), cueStop(), haptic(), note()

### Community 66 - "Community 66"
Cohesion: 0.33
Nodes (2): handled(), minsAgo()

### Community 67 - "Community 67"
Cohesion: 0.33
Nodes (2): BootLoader(), isBooted()

### Community 68 - "Community 68"
Cohesion: 0.53
Nodes (4): importPO(), importTxn(), importWO(), preloadPeekChunks()

### Community 71 - "Community 71"
Cohesion: 0.6
Nodes (3): isValidMobile(), localDigits(), PhoneInput()

### Community 72 - "Community 72"
Cohesion: 0.6
Nodes (3): close(), handleSave(), reset()

### Community 73 - "Community 73"
Cohesion: 0.5
Nodes (2): prefetchTxn(), txnPeekKey()

### Community 74 - "Community 74"
Cohesion: 0.6
Nodes (3): classificationsByName(), norm(), snapClassification()

### Community 76 - "Community 76"
Cohesion: 0.7
Nodes (4): nodeKey(), nodeKeyOf(), unitKeyOf(), zoneIdOf()

### Community 77 - "Community 77"
Cohesion: 0.5
Nodes (3): crossCutsFor(), hrefOf(), titles()

### Community 78 - "Community 78"
Cohesion: 0.5
Nodes (2): FinancialsCashflow(), lastNMonths()

### Community 84 - "Community 84"
Cohesion: 0.67
Nodes (2): handleClose(), handleSubmit()

### Community 85 - "Community 85"
Cohesion: 0.67
Nodes (2): bloom(), REDUCED()

### Community 93 - "Community 93"
Cohesion: 0.83
Nodes (3): hidesGlobalFab(), ownsBottomBar(), ownsCreateAction()

### Community 94 - "Community 94"
Cohesion: 0.67
Nodes (2): poGateState(), poIsPriced()

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

### Community 121 - "Community 121"
Cohesion: 1.0
Nodes (2): insertionIndex(), withNewTask()

### Community 124 - "Community 124"
Cohesion: 1.0
Nodes (2): placeOf(), stageOfFloorless()

## Knowledge Gaps
- **Thin community `Community 36`** (14 nodes): `clearPersistedCache()`, `shouldPersistQuery()`, `can()`, `checkScroll()`, `doSignOut()`, `e()`, `h()`, `initials()`, `isActive()`, `measure()`, `RailItem()`, `RailLabel()`, `BriklayRail.tsx`, `queryClient.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (10 nodes): `WOListSheet.tsx`, `balance()`, `closed()`, `D()`, `doneStages()`, `dstr()`, `fmt()`, `openLive()`, `pctPaid()`, `useWOListData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (10 nodes): `AnimatedNumber()`, `e()`, `fmtAmt()`, `fmtDate()`, `genTxnId()`, `h()`, `isClientReceipt()`, `isExcludedFromSpent()`, `supervisorName()`, `ProjectDetail.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (9 nodes): `singular_unit.test.ts`, `cm()`, `ctxFor()`, `DEC()`, `DEC_EMPTY()`, `decomposeCalls()`, `resolutionCalls()`, `seed()`, `unitModel()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (8 nodes): `away()`, `ProblemRow()`, `useIsDesktop()`, `useIsTouch()`, `useRowClose()`, `useSwipe()`, `Problems.tsx`, `useDesk.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (8 nodes): `Check()`, `closeSheet()`, `dayLabel()`, `fmt()`, `shortDate()`, `stateOf()`, `timeOf()`, `PartyLedgerMobile.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (8 nodes): `buildDescription()`, `calcOverall()`, `getInitials()`, `inferCategory()`, `levenshtein()`, `matchPayee()`, `matchProject()`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (8 nodes): `held_project_fold.test.ts`, `convoOf()`, `ctxFor()`, `it()`, `model()`, `projectSlots()`, `R_CREATE()`, `seed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (7 nodes): `duplicate_narration.test.ts`, `calls()`, `ctxFor()`, `handled()`, `minsAgo()`, `model()`, `seed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 67`** (6 nodes): `BootLoader()`, `isBooted()`, `markBooted()`, `onBooted()`, `BootLoader.tsx`, `bootSignal.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 73`** (5 nodes): `fmtDate()`, `prefetchTxn()`, `txnPeekFn()`, `txnPeekKey()`, `TransactionPeek.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (5 nodes): `FinancialsCashflow()`, `fmt()`, `lastNMonths()`, `monthLabel()`, `FinancialsCashflow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (4 nodes): `handleClose()`, `handleSubmit()`, `updateRow()`, `QuoteEntryDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 85`** (4 nodes): `bloom()`, `Btn()`, `REDUCED()`, `Btn.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 94`** (4 nodes): `poGateState()`, `poIsPriced()`, `poPayState()`, `poLifecycle.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 98`** (4 nodes): `evaluate.test.ts`, `blockworkDoneGround()`, `concealedByPlaster()`, `unit()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 107`** (3 nodes): `handleClose()`, `onKey()`, `StakeholderLedgerDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 119`** (3 nodes): `downloadGRNChallan()`, `fmtDate()`, `grnChallan.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 121`** (3 nodes): `insertionIndex()`, `withNewTask()`, `add.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 124`** (3 nodes): `placeOf()`, `stageOfFloorless()`, `stages.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `NewInvoice()` connect `Community 23` to `Community 1`, `Community 19`, `Community 7`?**
  _High betweenness centrality (0.150) - this node is a cross-community bridge._
- **Why does `parseAmount()` connect `Community 1` to `Community 19`, `Community 15`, `Community 23`?**
  _High betweenness centrality (0.148) - this node is a cross-community bridge._
- **Why does `show()` connect `Community 3` to `Community 15`?**
  _High betweenness centrality (0.102) - this node is a cross-community bridge._
- **Are the 43 inferred relationships involving `send()` (e.g. with `processJob()` and `resurfacePending()`) actually correct?**
  _`send()` has 43 INFERRED edges - model-reasoned connections that need verification._
- **Are the 37 inferred relationships involving `dispatch()` (e.g. with `processJob()` and `send()`) actually correct?**
  _`dispatch()` has 37 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `answerSiteops()` (e.g. with `closeConversation()` and `sendNowDurable()`) actually correct?**
  _`answerSiteops()` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 19 inferred relationships involving `runSiteops()` (e.g. with `getOpenBatch()` and `say()`) actually correct?**
  _`runSiteops()` has 19 INFERRED edges - model-reasoned connections that need verification._