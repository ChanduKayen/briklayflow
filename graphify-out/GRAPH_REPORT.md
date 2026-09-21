# Graph Report - Briklay Fly  (2026-09-21)

## Corpus Check
- 892 files · ~1,605,414 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3985 nodes · 6304 edges · 90 communities detected
- Extraction: 84% EXTRACTED · 16% INFERRED · 0% AMBIGUOUS · INFERRED: 983 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 103|Community 103]]
- [[_COMMUNITY_Community 104|Community 104]]
- [[_COMMUNITY_Community 113|Community 113]]
- [[_COMMUNITY_Community 114|Community 114]]
- [[_COMMUNITY_Community 118|Community 118]]
- [[_COMMUNITY_Community 123|Community 123]]
- [[_COMMUNITY_Community 128|Community 128]]
- [[_COMMUNITY_Community 140|Community 140]]
- [[_COMMUNITY_Community 141|Community 141]]
- [[_COMMUNITY_Community 144|Community 144]]

## God Nodes (most connected - your core abstractions)
1. `pick()` - 64 edges
2. `send()` - 48 edges
3. `dispatch()` - 46 edges
4. `answerSiteops()` - 36 edges
5. `runSiteops()` - 34 edges
6. `show()` - 32 edges
7. `applyTerminals()` - 31 edges
8. `resolveAgainstSingleFamily()` - 24 edges
9. `handlePillSelection()` - 22 edges
10. `sendNowDurable()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `buildChase()` --calls--> `nameOf()`  [INFERRED]
  src\lib\desk\fromDb.ts → supabase\functions\siteops-notify-assignment\index.ts
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
Cohesion: 0.02
Nodes (170): composeLLM(), fallbackReply(), isGreeting(), runConcierge(), systemFor(), userContent(), answerProcurement(), commitInterruptedProc() (+162 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (161): answerBillPayment(), attachBillDoc(), billAi(), billRawText(), billReplyKind(), findPrecedingCaption(), fmtNum(), isCleanAmount() (+153 more)

### Community 2 - "Community 2"
Cohesion: 0.01
Nodes (39): baseSeed(), twoAskSeed(), ask(), ctxFor(), model(), tUpdated(), upd(), ctxFor() (+31 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (127): bindingKey(), graphIsMaterialized(), materializeProjectTasksUncached(), placeOfTask(), gatesByTask(), gatesFromBinding(), safeGeometry(), safeInstantiate() (+119 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (95): at(), submit(), clearOpening(), doMerge(), fmtDate(), inr(), rowAmount(), rowDir() (+87 more)

### Community 5 - "Community 5"
Cohesion: 0.02
Nodes (83): ageOf(), bucketOf(), day(), hapt(), inr(), link(), short(), linkParts() (+75 more)

### Community 6 - "Community 6"
Cohesion: 0.02
Nodes (75): closeSheet(), contractPct(), countOf(), end(), engagementForm(), esc(), fail(), go() (+67 more)

### Community 7 - "Community 7"
Cohesion: 0.03
Nodes (84): isStopWord(), addCustomBrand(), brandsFor(), getCustomBrands(), LS_KEY(), buildConflictPills(), buildNovelVariantPills(), buildPills() (+76 more)

### Community 8 - "Community 8"
Cohesion: 0.03
Nodes (77): createVendor(), guessVendor(), low(), onPrimary(), save(), whatsMissing(), guessVendor(), low() (+69 more)

### Community 9 - "Community 9"
Cohesion: 0.03
Nodes (64): isWageSettleNote(), mondayOf(), deriveParty(), num(), parityOrg(), parityParty(), allocateToCredit(), allocateToPool() (+56 more)

### Community 10 - "Community 10"
Cohesion: 0.03
Nodes (52): call(), issue(), prog(), seed(), task(), src(), stripComments(), classifyWithLLM() (+44 more)

### Community 11 - "Community 11"
Cohesion: 0.03
Nodes (42): wa(), buildComponents(), buildTemplateMessage(), sendTemplate(), line(), promptFor(), withTask(), cadenceFor() (+34 more)

### Community 12 - "Community 12"
Cohesion: 0.05
Nodes (58): createBill(), allocIdOf(), assertLinkable(), attachToContract(), createContract(), fallbackTitle(), fileAsLabour(), generateContractTitle() (+50 more)

### Community 13 - "Community 13"
Cohesion: 0.04
Nodes (36): answerPaymentTotal(), answerReporting(), groupBySite(), loadProjects(), loadStakeholders(), num(), orderRows(), pickFrom() (+28 more)

### Community 14 - "Community 14"
Cohesion: 0.03
Nodes (46): handleCreateProject(), resolveEntry(), buildImportRows(), commitImport(), clearImportDraft(), key(), loadImportDraft(), saveImportDraft() (+38 more)

### Community 15 - "Community 15"
Cohesion: 0.05
Nodes (69): clean(), ackLine(), buildPickVendorsFlow(), buildSelectVendorFlow(), buildSourcingPrompt(), buildVendorList(), entryLine(), fmtAmt() (+61 more)

### Community 16 - "Community 16"
Cohesion: 0.04
Nodes (46): payableTagLabel(), approve(), isMissingTable(), loadApprovals(), unapprove(), weekKey(), band(), begin() (+38 more)

### Community 17 - "Community 17"
Cohesion: 0.05
Nodes (30): amountOf(), buzz(), choose(), doFile(), file(), goStep(), onKey(), press() (+22 more)

### Community 18 - "Community 18"
Cohesion: 0.07
Nodes (39): balStr(), downloadPartyStatementExcel(), fmtDate(), money(), ordered(), particularsOf(), vchNo(), vchType() (+31 more)

### Community 19 - "Community 19"
Cohesion: 0.05
Nodes (38): handleSave(), suggestCostCode(), NameList(), nameRows(), nudge(), toggleSug(), costCodeLabel(), getCostCode() (+30 more)

### Community 20 - "Community 20"
Cohesion: 0.04
Nodes (26): DragSheet(), NewTxnMenuButton(), usePartyMoney(), useSheetDrag(), useSheetFlag(), useIsMobile(), useLiveCount(), useSoftKeyboard() (+18 more)

### Community 21 - "Community 21"
Cohesion: 0.05
Nodes (37): intakeCommit(), intakeExtract(), intakeResolveVendor(), runIntake(), bandedMatch(), canonRole(), isKnownTrade(), levenshtein() (+29 more)

### Community 22 - "Community 22"
Cohesion: 0.05
Nodes (29): handler(), close(), go(), handleClose(), handleOpen(), toggle(), handler(), go() (+21 more)

### Community 23 - "Community 23"
Cohesion: 0.06
Nodes (28): onMsg(), resolveVendorId(), addDays(), approvePhase(), attempt(), attemptQuiet(), baseWin(), commit() (+20 more)

### Community 24 - "Community 24"
Cohesion: 0.05
Nodes (23): AttendanceSheet(), isoOf(), readStoredSession(), useAuth(), useCan(), useOrgId(), classifyRefreshError(), extractErrorCode() (+15 more)

### Community 25 - "Community 25"
Cohesion: 0.05
Nodes (29): patchProblem(), toggleSnag(), patchProblem(), toggleSnag(), appendEvent(), legacyToFollowupType(), notifyAssignment(), trailKey() (+21 more)

### Community 27 - "Community 27"
Cohesion: 0.07
Nodes (32): applyAll(), imgCtx(), runTurn(), seed(), task(), checkExprAt(), findMigrationsDir(), loadEnumChecks() (+24 more)

### Community 28 - "Community 28"
Cohesion: 0.09
Nodes (28): ago(), assignReasonOf(), bucketRef(), buildChase(), buildStory(), buildTaskStory(), capitalise(), chaseWhen() (+20 more)

### Community 29 - "Community 29"
Cohesion: 0.09
Nodes (18): isTouch(), startLamp(), byTypeFor(), commitMove(), goTo(), loop(), measure(), moveTo() (+10 more)

### Community 30 - "Community 30"
Cohesion: 0.1
Nodes (22): saidAsOf(), fiveFloors(), line(), buildCandidateSet(), buildResolutionUser(), disposeRawResponse(), isBool(), isStr() (+14 more)

### Community 31 - "Community 31"
Cohesion: 0.11
Nodes (19): buildNudgeBody(), buildRecord(), clampNum(), clampStr(), composeDemoLLM(), encodeDemo(), inr(), nudgeCta() (+11 more)

### Community 32 - "Community 32"
Cohesion: 0.08
Nodes (8): handleSave(), h(), handleTap(), if(), ProjectHome(), useProjectCode(), onSelect(), pick()

### Community 33 - "Community 33"
Cohesion: 0.14
Nodes (20): buildClassifierPrompt(), clamp01(), classifyUserTask(), dedupe(), gatewayAnchor(), introducesCycle(), resolveFreedomSet(), sanitizeScope() (+12 more)

### Community 34 - "Community 34"
Cohesion: 0.1
Nodes (6): learnAlias(), rememberCaptured(), selectPayee(), selectTeammate(), addStakeholderAlias(), resolveTeammateParty()

### Community 35 - "Community 35"
Cohesion: 0.11
Nodes (4): useLongPress(), chip(), EntryRow(), toggle()

### Community 36 - "Community 36"
Cohesion: 0.18
Nodes (3): Evaluator, messageFor(), verdictFor()

### Community 37 - "Community 37"
Cohesion: 0.19
Nodes (14): buildExtractionPrompt(), buildReRankPrompt(), cleanExtractionResult(), extractItems(), generateStructuredSkuWithContext(), generateVectorEmbedding(), looksLikePlaceholder(), matchItems() (+6 more)

### Community 38 - "Community 38"
Cohesion: 0.12
Nodes (2): seed(), SEED2()

### Community 39 - "Community 39"
Cohesion: 0.17
Nodes (7): addPhotos(), fmt(), goodOf(), handleSubmit(), parseTiffDate(), readExifDate(), readPhotoDate()

### Community 40 - "Community 40"
Cohesion: 0.15
Nodes (3): cand(), floorSeed(), fourFloors()

### Community 41 - "Community 41"
Cohesion: 0.21
Nodes (7): ctaOnScreen(), go(), hapt(), onFab(), onScroll(), onTab(), openMore()

### Community 42 - "Community 42"
Cohesion: 0.14
Nodes (2): clearPersistedCache(), doSignOut()

### Community 43 - "Community 43"
Cohesion: 0.19
Nodes (6): useDeskApi(), useMockDeskApi(), deskCoreQuery(), deskPlanQuery(), DeskUnsupported, useLiveDeskApi()

### Community 44 - "Community 44"
Cohesion: 0.18
Nodes (3): BI(), chaseSeed(), seed()

### Community 45 - "Community 45"
Cohesion: 0.32
Nodes (11): act(), briklayChat(), checkRegistration(), greetOnce(), local10(), onlyDigits(), onTap(), prettyPhone() (+3 more)

### Community 46 - "Community 46"
Cohesion: 0.21
Nodes (5): base(), nearest(), upd(), updResolve(), withNearest()

### Community 48 - "Community 48"
Cohesion: 0.29
Nodes (7): bandRange(), buildRationale(), draftStages(), extractMeasured(), normalizeWeights(), templateKeyForTrade(), titleCase()

### Community 49 - "Community 49"
Cohesion: 0.31
Nodes (6): confirmSpawn(), invalidate(), invalidateObjects(), onPickFile(), post(), quickAction()

### Community 50 - "Community 50"
Cohesion: 0.22
Nodes (2): closed(), openLive()

### Community 51 - "Community 51"
Cohesion: 0.27
Nodes (6): PeekLink(), fmtDate(), Label(), summarizeScope(), woTone(), usePeek()

### Community 54 - "Community 54"
Cohesion: 0.28
Nodes (3): handleSendOtp(), handleVerifyOtp(), toE164()

### Community 55 - "Community 55"
Cohesion: 0.39
Nodes (7): boundedFetch(), coalescedRefresh(), hasBearer(), isOnline(), timeoutFetch(), urlOf(), withBearer()

### Community 56 - "Community 56"
Cohesion: 0.33
Nodes (4): canonicalRank(), findAbstractCycle(), isHardNature(), validateLibrary()

### Community 57 - "Community 57"
Cohesion: 0.25
Nodes (2): cm(), DEC()

### Community 58 - "Community 58"
Cohesion: 0.25
Nodes (2): ProblemRow(), useSwipe()

### Community 59 - "Community 59"
Cohesion: 0.29
Nodes (2): fmt(), stateOf()

### Community 60 - "Community 60"
Cohesion: 0.36
Nodes (5): chooseContact(), closeNum(), contactPicker(), digits(), finishNum()

### Community 61 - "Community 61"
Cohesion: 0.43
Nodes (7): decodeDemo(), encodeDemo(), fromBase64Url(), num(), sanitize(), str(), toBase64Url()

### Community 62 - "Community 62"
Cohesion: 0.32
Nodes (5): autoSet(), isOn(), ruleHints(), toggle(), A()

### Community 63 - "Community 63"
Cohesion: 0.29
Nodes (2): getInitials(), matchProject()

### Community 64 - "Community 64"
Cohesion: 0.29
Nodes (2): model(), R_CREATE()

### Community 67 - "Community 67"
Cohesion: 0.43
Nodes (4): genId(), handleKeyDown(), patchRow(), saveRow()

### Community 68 - "Community 68"
Cohesion: 0.43
Nodes (5): TxnRow(), dot(), formatShortDate(), formatTxn(), isCostCode()

### Community 69 - "Community 69"
Cohesion: 0.33
Nodes (2): CertifyDialog(), INR()

### Community 70 - "Community 70"
Cohesion: 0.48
Nodes (5): usePrefetchPO(), usePrefetchStakeholder(), usePrefetchTxn(), usePrefetchWO(), useThrottledPrefetch()

### Community 72 - "Community 72"
Cohesion: 0.71
Nodes (6): audio(), cueFail(), cueStart(), cueStop(), haptic(), note()

### Community 74 - "Community 74"
Cohesion: 0.43
Nodes (5): buildDemo(), inr(), onMsg(), slugify(), toE164()

### Community 76 - "Community 76"
Cohesion: 0.33
Nodes (2): handled(), minsAgo()

### Community 81 - "Community 81"
Cohesion: 0.33
Nodes (2): BootLoader(), isBooted()

### Community 82 - "Community 82"
Cohesion: 0.53
Nodes (4): importPO(), importTxn(), importWO(), preloadPeekChunks()

### Community 83 - "Community 83"
Cohesion: 0.33
Nodes (2): safeRedirect(), LoginRegister()

### Community 86 - "Community 86"
Cohesion: 0.6
Nodes (3): isValidMobile(), localDigits(), PhoneInput()

### Community 87 - "Community 87"
Cohesion: 0.6
Nodes (3): close(), handleSave(), reset()

### Community 88 - "Community 88"
Cohesion: 0.5
Nodes (2): prefetchTxn(), txnPeekKey()

### Community 89 - "Community 89"
Cohesion: 0.4
Nodes (2): DocPeek(), useSignedDocs()

### Community 90 - "Community 90"
Cohesion: 0.6
Nodes (3): classificationsByName(), norm(), snapClassification()

### Community 92 - "Community 92"
Cohesion: 0.7
Nodes (4): nodeKey(), nodeKeyOf(), unitKeyOf(), zoneIdOf()

### Community 93 - "Community 93"
Cohesion: 0.5
Nodes (3): unsureOf(), bill(), iso()

### Community 94 - "Community 94"
Cohesion: 0.5
Nodes (3): crossCutsFor(), hrefOf(), titles()

### Community 95 - "Community 95"
Cohesion: 0.5
Nodes (2): FinancialsCashflow(), lastNMonths()

### Community 103 - "Community 103"
Cohesion: 0.67
Nodes (2): handleClose(), handleSubmit()

### Community 104 - "Community 104"
Cohesion: 0.67
Nodes (2): bloom(), REDUCED()

### Community 113 - "Community 113"
Cohesion: 0.83
Nodes (3): hidesGlobalFab(), ownsBottomBar(), ownsCreateAction()

### Community 114 - "Community 114"
Cohesion: 0.67
Nodes (2): poGateState(), poIsPriced()

### Community 118 - "Community 118"
Cohesion: 0.67
Nodes (2): concealedByPlaster(), unit()

### Community 123 - "Community 123"
Cohesion: 0.83
Nodes (3): json(), judge(), serperListings()

### Community 128 - "Community 128"
Cohesion: 1.0
Nodes (2): handleClose(), onKey()

### Community 140 - "Community 140"
Cohesion: 1.0
Nodes (2): downloadGRNChallan(), fmtDate()

### Community 141 - "Community 141"
Cohesion: 1.0
Nodes (2): insertionIndex(), withNewTask()

### Community 144 - "Community 144"
Cohesion: 1.0
Nodes (2): placeOf(), stageOfFloorless()

## Knowledge Gaps
- **Thin community `Community 38`** (17 nodes): `no_such_floor_ask.test.ts`, `base()`, `blindModel()`, `convoOf()`, `ctxPin()`, `geo()`, `imgCtx()`, `model()`, `preambleOf()`, `projConvoOf()`, `row()`, `seed()`, `SEED2()`, `shortlist()`, `stateWrites()`, `textCtx()`, `tUpd()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (14 nodes): `clearPersistedCache()`, `shouldPersistQuery()`, `can()`, `checkScroll()`, `doSignOut()`, `e()`, `h()`, `initials()`, `isActive()`, `measure()`, `RailItem()`, `RailLabel()`, `BriklayRail.tsx`, `queryClient.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (10 nodes): `WOListSheet.tsx`, `balance()`, `closed()`, `D()`, `doneStages()`, `dstr()`, `fmt()`, `openLive()`, `pctPaid()`, `useWOListData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (9 nodes): `singular_unit.test.ts`, `cm()`, `ctxFor()`, `DEC()`, `DEC_EMPTY()`, `decomposeCalls()`, `resolutionCalls()`, `seed()`, `unitModel()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (8 nodes): `away()`, `ProblemRow()`, `useIsDesktop()`, `useIsTouch()`, `useRowClose()`, `useSwipe()`, `Problems.tsx`, `useDesk.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (8 nodes): `Check()`, `closeSheet()`, `dayLabel()`, `fmt()`, `shortDate()`, `stateOf()`, `timeOf()`, `PartyLedgerMobile.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (8 nodes): `buildDescription()`, `calcOverall()`, `getInitials()`, `inferCategory()`, `levenshtein()`, `matchPayee()`, `matchProject()`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (8 nodes): `held_project_fold.test.ts`, `convoOf()`, `ctxFor()`, `it()`, `model()`, `projectSlots()`, `R_CREATE()`, `seed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (7 nodes): `CertifyDialog()`, `dLabel()`, `fmtQ()`, `INR()`, `stageShape()`, `todayISO()`, `CertifyDialog.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 76`** (7 nodes): `duplicate_narration.test.ts`, `calls()`, `ctxFor()`, `handled()`, `minsAgo()`, `model()`, `seed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (6 nodes): `BootLoader()`, `isBooted()`, `markBooted()`, `onBooted()`, `BootLoader.tsx`, `bootSignal.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (6 nodes): `loginRouteFor()`, `safeRedirect()`, `LoginRegister()`, `toE164()`, `routes.ts`, `LoginRegister.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 88`** (5 nodes): `fmtDate()`, `prefetchTxn()`, `txnPeekFn()`, `txnPeekKey()`, `TransactionPeek.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 89`** (5 nodes): `DocPeek.tsx`, `docSigning.ts`, `DocPeek()`, `isPdf()`, `useSignedDocs()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 95`** (5 nodes): `FinancialsCashflow()`, `fmt()`, `lastNMonths()`, `monthLabel()`, `FinancialsCashflow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 103`** (4 nodes): `handleClose()`, `handleSubmit()`, `updateRow()`, `QuoteEntryDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 104`** (4 nodes): `bloom()`, `Btn()`, `REDUCED()`, `Btn.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 114`** (4 nodes): `poGateState()`, `poIsPriced()`, `poPayState()`, `poLifecycle.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 118`** (4 nodes): `evaluate.test.ts`, `blockworkDoneGround()`, `concealedByPlaster()`, `unit()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 128`** (3 nodes): `handleClose()`, `onKey()`, `StakeholderLedgerDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 140`** (3 nodes): `downloadGRNChallan()`, `fmtDate()`, `grnChallan.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 141`** (3 nodes): `insertionIndex()`, `withNewTask()`, `add.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 144`** (3 nodes): `placeOf()`, `stageOfFloorless()`, `stages.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `say()` connect `Community 16` to `Community 0`, `Community 13`?**
  _High betweenness centrality (0.175) - this node is a cross-community bridge._
- **Why does `runSiteops()` connect `Community 0` to `Community 2`, `Community 10`, `Community 11`, `Community 16`, `Community 23`, `Community 27`?**
  _High betweenness centrality (0.144) - this node is a cross-community bridge._
- **Why does `show()` connect `Community 4` to `Community 16`, `Community 20`, `Community 5`?**
  _High betweenness centrality (0.113) - this node is a cross-community bridge._
- **Are the 44 inferred relationships involving `send()` (e.g. with `processJob()` and `resurfacePending()`) actually correct?**
  _`send()` has 44 INFERRED edges - model-reasoned connections that need verification._
- **Are the 37 inferred relationships involving `dispatch()` (e.g. with `processJob()` and `send()`) actually correct?**
  _`dispatch()` has 37 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `answerSiteops()` (e.g. with `closeConversation()` and `sendNowDurable()`) actually correct?**
  _`answerSiteops()` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 20 inferred relationships involving `runSiteops()` (e.g. with `getOpenBatch()` and `say()`) actually correct?**
  _`runSiteops()` has 20 INFERRED edges - model-reasoned connections that need verification._