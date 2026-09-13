# Graph Report - Briklay Fly  (2026-09-13)

## Corpus Check
- 827 files · ~1,487,454 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3599 nodes · 5698 edges · 80 communities detected
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 875 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 106|Community 106]]
- [[_COMMUNITY_Community 111|Community 111]]
- [[_COMMUNITY_Community 123|Community 123]]
- [[_COMMUNITY_Community 125|Community 125]]
- [[_COMMUNITY_Community 128|Community 128]]

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
- `cadenceFor()` --calls--> `loadCadenceMap()`  [INFERRED]
  supabase\functions\siteops-chase\index.ts → supabase\functions\whatsapp-webhook\_siteops_timing.ts
- `scoreProjects()` --calls--> `resolveProject()`  [INFERRED]
  supabase\functions\whatsapp-webhook\_match.ts → supabase\functions\whatsapp-webhook\_resolve.ts
- `mBatch()` --calls--> `line()`  [INFERRED]
  supabase\functions\whatsapp-webhook\_messages.ts → supabase\functions\whatsapp-webhook\__tests__\resolution_llm.test.ts
- `mBatch()` --calls--> `money()`  [INFERRED]
  supabase\functions\whatsapp-webhook\_messages.ts → supabase\functions\whatsapp-webhook\__tests__\reporting_payment.test.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (112): answerSiteops(), answerWithPhoto(), applyBatchResolution(), applyQcFailures(), applyTaskBlockedById(), applyTaskProgressById(), applyTaskUpdate(), applyTerminals() (+104 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (153): answerBillPayment(), billAi(), billRawText(), billReplyKind(), findPrecedingCaption(), fmtNum(), isCleanAmount(), parseBillAnswer() (+145 more)

### Community 2 - "Community 2"
Cohesion: 0.01
Nodes (35): baseSeed(), twoAskSeed(), ask(), ctxFor(), model(), tUpdated(), upd(), ctxFor() (+27 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (86): classifyPhotoFollowup(), wa(), buildComponents(), buildTemplateMessage(), sendTemplate(), line(), promptFor(), withTask() (+78 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (127): bindingKey(), graphIsMaterialized(), materializeProjectTasksUncached(), placeOfTask(), gatesByTask(), gatesFromBinding(), safeGeometry(), safeInstantiate() (+119 more)

### Community 5 - "Community 5"
Cohesion: 0.02
Nodes (91): submit(), clearOpening(), fmtDate(), inr(), rowAmount(), rowDir(), rowExpanded(), saveDate() (+83 more)

### Community 6 - "Community 6"
Cohesion: 0.02
Nodes (70): confirm(), commit(), autoSettleCrewWages(), cardKeyToCols(), cellFrom(), commitCrewSettlement(), crewPhases(), iso() (+62 more)

### Community 7 - "Community 7"
Cohesion: 0.04
Nodes (82): isStopWord(), addCustomBrand(), brandsFor(), getCustomBrands(), LS_KEY(), buildConflictPills(), buildNovelVariantPills(), buildPills() (+74 more)

### Community 8 - "Community 8"
Cohesion: 0.05
Nodes (78): clean(), dayBookLink(), entryLink(), partyLedgerLink(), problemLink(), reviewLink(), taskLink(), tasksLink() (+70 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (56): intakeCommit(), intakeExtract(), intakeResolveVendor(), runIntake(), linkParts(), rankLoosePayments(), convertLegacyPoBill(), extractBill() (+48 more)

### Community 10 - "Community 10"
Cohesion: 0.05
Nodes (56): createBill(), allocIdOf(), assertLinkable(), attachToContract(), createContract(), fallbackTitle(), fileAsLabour(), generateContractTitle() (+48 more)

### Community 11 - "Community 11"
Cohesion: 0.04
Nodes (36): answerPaymentTotal(), answerReporting(), groupBySite(), loadProjects(), loadStakeholders(), num(), orderRows(), pickFrom() (+28 more)

### Community 12 - "Community 12"
Cohesion: 0.03
Nodes (28): parseAmount(), inr(), rupees(), Thumb(), commitEdit(), deleteBill(), unlinkBillFromPO(), openDoc() (+20 more)

### Community 13 - "Community 13"
Cohesion: 0.04
Nodes (45): handleCreateProject(), buildImportRows(), commitImport(), clearImportDraft(), key(), loadImportDraft(), saveImportDraft(), detectColumns() (+37 more)

### Community 14 - "Community 14"
Cohesion: 0.03
Nodes (38): NewBillModal(), DragSheet(), PeekLink(), handleSave(), suggestCostCode(), fmtDate(), Label(), summarizeScope() (+30 more)

### Community 15 - "Community 15"
Cohesion: 0.05
Nodes (36): balStr(), buildPartyStatementDoc(), downloadPartyStatement(), money(), ordered(), amountInWords(), amountText(), dataPair() (+28 more)

### Community 16 - "Community 16"
Cohesion: 0.04
Nodes (38): doMerge(), learnAlias(), matchGenHeads(), normHead(), rememberCaptured(), selectPayee(), addStakeholderAlias(), mergeStakeholders() (+30 more)

### Community 17 - "Community 17"
Cohesion: 0.05
Nodes (50): createVendor(), guessVendor(), low(), save(), whatsMissing(), autoSplit(), blank(), doCreate() (+42 more)

### Community 18 - "Community 18"
Cohesion: 0.06
Nodes (54): attachBillDoc(), attachProofImage(), canTranscribe(), sarvamLang(), transcribeAudio(), file(), keepTyping(), sendTypingIndicator() (+46 more)

### Community 19 - "Community 19"
Cohesion: 0.07
Nodes (35): closeSheet(), contractPct(), countOf(), end(), engagementForm(), esc(), fail(), go() (+27 more)

### Community 20 - "Community 20"
Cohesion: 0.05
Nodes (27): handler(), close(), go(), handleClose(), handleOpen(), toggle(), handler(), go() (+19 more)

### Community 21 - "Community 21"
Cohesion: 0.05
Nodes (23): AttendanceSheet(), isoOf(), readStoredSession(), useAuth(), useCan(), useOrgId(), classifyRefreshError(), extractErrorCode() (+15 more)

### Community 22 - "Community 22"
Cohesion: 0.05
Nodes (28): patchProblem(), toggleSnag(), patchProblem(), toggleSnag(), appendEvent(), legacyToFollowupType(), notifyAssignment(), trailKey() (+20 more)

### Community 23 - "Community 23"
Cohesion: 0.06
Nodes (26): addDays(), approvePhase(), attempt(), attemptQuiet(), baseWin(), commit(), durOf(), isoOf() (+18 more)

### Community 24 - "Community 24"
Cohesion: 0.08
Nodes (29): ago(), assignReasonOf(), bucketRef(), buildChase(), buildStory(), buildTaskStory(), capitalise(), chaseWhen() (+21 more)

### Community 25 - "Community 25"
Cohesion: 0.07
Nodes (32): applyAll(), imgCtx(), runTurn(), seed(), task(), checkExprAt(), findMigrationsDir(), loadEnumChecks() (+24 more)

### Community 26 - "Community 26"
Cohesion: 0.09
Nodes (18): isTouch(), startLamp(), byTypeFor(), commitMove(), goTo(), loop(), measure(), moveTo() (+10 more)

### Community 27 - "Community 27"
Cohesion: 0.1
Nodes (22): saidAsOf(), fiveFloors(), line(), buildCandidateSet(), buildResolutionUser(), disposeRawResponse(), isBool(), isStr() (+14 more)

### Community 28 - "Community 28"
Cohesion: 0.12
Nodes (14): auditLines(), n(), parseModelJson(), expect(), expectThrows(), fmt(), norm(), runAll() (+6 more)

### Community 29 - "Community 29"
Cohesion: 0.08
Nodes (7): seed(), SEED2(), base(), nearest(), upd(), updResolve(), withNearest()

### Community 30 - "Community 30"
Cohesion: 0.13
Nodes (20): bandedMatch(), canonRole(), isKnownTrade(), levenshtein(), matchPayee(), nameTokenScore(), rankPayeeName(), roleVerdict() (+12 more)

### Community 31 - "Community 31"
Cohesion: 0.14
Nodes (20): buildClassifierPrompt(), clamp01(), classifyUserTask(), dedupe(), gatewayAnchor(), introducesCycle(), resolveFreedomSet(), sanitizeScope() (+12 more)

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
Cohesion: 0.19
Nodes (6): useDeskApi(), useMockDeskApi(), deskCoreQuery(), deskPlanQuery(), DeskUnsupported, useLiveDeskApi()

### Community 38 - "Community 38"
Cohesion: 0.18
Nodes (3): BI(), chaseSeed(), seed()

### Community 39 - "Community 39"
Cohesion: 0.32
Nodes (11): act(), briklayChat(), checkRegistration(), greetOnce(), local10(), onlyDigits(), onTap(), prettyPhone() (+3 more)

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

### Community 60 - "Community 60"
Cohesion: 0.43
Nodes (4): genId(), handleKeyDown(), patchRow(), saveRow()

### Community 61 - "Community 61"
Cohesion: 0.43
Nodes (5): TxnRow(), dot(), formatShortDate(), formatTxn(), isCostCode()

### Community 62 - "Community 62"
Cohesion: 0.48
Nodes (5): usePrefetchPO(), usePrefetchStakeholder(), usePrefetchTxn(), usePrefetchWO(), useThrottledPrefetch()

### Community 64 - "Community 64"
Cohesion: 0.71
Nodes (6): audio(), cueFail(), cueStart(), cueStop(), haptic(), note()

### Community 67 - "Community 67"
Cohesion: 0.33
Nodes (2): handled(), minsAgo()

### Community 70 - "Community 70"
Cohesion: 0.33
Nodes (2): BootLoader(), isBooted()

### Community 71 - "Community 71"
Cohesion: 0.53
Nodes (4): importPO(), importTxn(), importWO(), preloadPeekChunks()

### Community 74 - "Community 74"
Cohesion: 0.6
Nodes (3): isValidMobile(), localDigits(), PhoneInput()

### Community 75 - "Community 75"
Cohesion: 0.6
Nodes (3): close(), handleSave(), reset()

### Community 76 - "Community 76"
Cohesion: 0.5
Nodes (2): prefetchTxn(), txnPeekKey()

### Community 77 - "Community 77"
Cohesion: 0.6
Nodes (3): classificationsByName(), norm(), snapClassification()

### Community 79 - "Community 79"
Cohesion: 0.7
Nodes (4): nodeKey(), nodeKeyOf(), unitKeyOf(), zoneIdOf()

### Community 80 - "Community 80"
Cohesion: 0.5
Nodes (3): crossCutsFor(), hrefOf(), titles()

### Community 81 - "Community 81"
Cohesion: 0.5
Nodes (2): FinancialsCashflow(), lastNMonths()

### Community 84 - "Community 84"
Cohesion: 0.5
Nodes (2): src(), stripComments()

### Community 88 - "Community 88"
Cohesion: 0.67
Nodes (2): handleClose(), handleSubmit()

### Community 89 - "Community 89"
Cohesion: 0.67
Nodes (2): bloom(), REDUCED()

### Community 97 - "Community 97"
Cohesion: 0.83
Nodes (3): hidesGlobalFab(), ownsBottomBar(), ownsCreateAction()

### Community 98 - "Community 98"
Cohesion: 0.67
Nodes (2): poGateState(), poIsPriced()

### Community 102 - "Community 102"
Cohesion: 0.67
Nodes (2): concealedByPlaster(), unit()

### Community 106 - "Community 106"
Cohesion: 0.83
Nodes (3): json(), judge(), serperListings()

### Community 111 - "Community 111"
Cohesion: 1.0
Nodes (2): handleClose(), onKey()

### Community 123 - "Community 123"
Cohesion: 1.0
Nodes (2): downloadGRNChallan(), fmtDate()

### Community 125 - "Community 125"
Cohesion: 1.0
Nodes (2): insertionIndex(), withNewTask()

### Community 128 - "Community 128"
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
- **Thin community `Community 67`** (7 nodes): `duplicate_narration.test.ts`, `calls()`, `ctxFor()`, `handled()`, `minsAgo()`, `model()`, `seed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (6 nodes): `BootLoader()`, `isBooted()`, `markBooted()`, `onBooted()`, `BootLoader.tsx`, `bootSignal.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (5 nodes): `fmtDate()`, `prefetchTxn()`, `txnPeekFn()`, `txnPeekKey()`, `TransactionPeek.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (5 nodes): `FinancialsCashflow()`, `fmt()`, `lastNMonths()`, `monthLabel()`, `FinancialsCashflow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 84`** (5 nodes): `router_referent.test.ts`, `defined()`, `raw()`, `src()`, `stripComments()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 88`** (4 nodes): `handleClose()`, `handleSubmit()`, `updateRow()`, `QuoteEntryDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 89`** (4 nodes): `bloom()`, `Btn()`, `REDUCED()`, `Btn.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 98`** (4 nodes): `poGateState()`, `poIsPriced()`, `poPayState()`, `poLifecycle.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 102`** (4 nodes): `evaluate.test.ts`, `blockworkDoneGround()`, `concealedByPlaster()`, `unit()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 111`** (3 nodes): `handleClose()`, `onKey()`, `StakeholderLedgerDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 123`** (3 nodes): `downloadGRNChallan()`, `fmtDate()`, `grnChallan.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 125`** (3 nodes): `insertionIndex()`, `withNewTask()`, `add.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 128`** (3 nodes): `placeOf()`, `stageOfFloorless()`, `stages.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `parseAmount()` connect `Community 12` to `Community 1`, `Community 21`?**
  _High betweenness centrality (0.129) - this node is a cross-community bridge._
- **Why does `NewInvoice()` connect `Community 21` to `Community 18`, `Community 12`, `Community 6`?**
  _High betweenness centrality (0.109) - this node is a cross-community bridge._
- **Why does `show()` connect `Community 5` to `Community 16`, `Community 12`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **Are the 43 inferred relationships involving `send()` (e.g. with `processJob()` and `resurfacePending()`) actually correct?**
  _`send()` has 43 INFERRED edges - model-reasoned connections that need verification._
- **Are the 37 inferred relationships involving `dispatch()` (e.g. with `processJob()` and `send()`) actually correct?**
  _`dispatch()` has 37 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `answerSiteops()` (e.g. with `closeConversation()` and `sendNowDurable()`) actually correct?**
  _`answerSiteops()` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 19 inferred relationships involving `runSiteops()` (e.g. with `getOpenBatch()` and `say()`) actually correct?**
  _`runSiteops()` has 19 INFERRED edges - model-reasoned connections that need verification._