# Graph Report - Briklay Fly  (2026-09-20)

## Corpus Check
- 886 files · ~1,587,606 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3967 nodes · 6264 edges · 88 communities detected
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 964 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 100|Community 100]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 110|Community 110]]
- [[_COMMUNITY_Community 111|Community 111]]
- [[_COMMUNITY_Community 115|Community 115]]
- [[_COMMUNITY_Community 120|Community 120]]
- [[_COMMUNITY_Community 125|Community 125]]
- [[_COMMUNITY_Community 137|Community 137]]
- [[_COMMUNITY_Community 138|Community 138]]
- [[_COMMUNITY_Community 141|Community 141]]

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
- `mPartyLedger()` --calls--> `row()`  [INFERRED]
  supabase\functions\whatsapp-webhook\_messages.ts → supabase\functions\whatsapp-webhook\__tests__\type_tie.test.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (108): answerSiteops(), answerWithPhoto(), applyBatchResolution(), applyQcFailures(), applyTaskBlockedById(), applyTaskProgressById(), applyTaskUpdate(), applyTerminals() (+100 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (169): answerBillPayment(), attachBillDoc(), billAi(), billRawText(), billReplyKind(), findPrecedingCaption(), fmtNum(), isCleanAmount() (+161 more)

### Community 2 - "Community 2"
Cohesion: 0.01
Nodes (43): baseSeed(), twoAskSeed(), ask(), ctxFor(), model(), tUpdated(), upd(), ctxFor() (+35 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (147): bindingKey(), graphIsMaterialized(), materializeProjectTasksUncached(), placeOfTask(), gatesByTask(), gatesFromBinding(), safeGeometry(), safeInstantiate() (+139 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (100): at(), submit(), clearOpening(), doMerge(), fmtDate(), inr(), rowAmount(), rowDir() (+92 more)

### Community 5 - "Community 5"
Cohesion: 0.02
Nodes (78): confirm(), confirm(), commit(), loadWageContracts(), setWagesAgainstContract(), wagesContractStanding(), confirm(), cardKeyToCols() (+70 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (84): isStopWord(), addCustomBrand(), brandsFor(), getCustomBrands(), LS_KEY(), buildConflictPills(), buildNovelVariantPills(), buildPills() (+76 more)

### Community 7 - "Community 7"
Cohesion: 0.03
Nodes (106): answerProcurement(), finalizeDirectVendor(), flowIdFor(), handleSingle(), loadApprover(), loadProjects(), loadVendors(), markReadyForApproval() (+98 more)

### Community 8 - "Community 8"
Cohesion: 0.03
Nodes (77): createVendor(), guessVendor(), low(), onPrimary(), save(), whatsMissing(), guessVendor(), low() (+69 more)

### Community 9 - "Community 9"
Cohesion: 0.03
Nodes (70): ageOf(), bucketOf(), day(), hapt(), inr(), link(), short(), intakeCommit() (+62 more)

### Community 10 - "Community 10"
Cohesion: 0.03
Nodes (51): tradeWords(), call(), issue(), prog(), seed(), task(), src(), stripComments() (+43 more)

### Community 11 - "Community 11"
Cohesion: 0.03
Nodes (49): classifyPhotoFollowup(), wa(), buildComponents(), buildTemplateMessage(), sendTemplate(), line(), promptFor(), withTask() (+41 more)

### Community 12 - "Community 12"
Cohesion: 0.04
Nodes (66): buildNudgeBody(), buildRecord(), clampNum(), clampStr(), composeDemoLLM(), encodeDemo(), inr(), nudgeCta() (+58 more)

### Community 13 - "Community 13"
Cohesion: 0.04
Nodes (52): isTouch(), startLamp(), applyAll(), byTypeFor(), commitMove(), goTo(), loop(), measure() (+44 more)

### Community 14 - "Community 14"
Cohesion: 0.05
Nodes (58): createBill(), allocIdOf(), assertLinkable(), attachToContract(), createContract(), fallbackTitle(), fileAsLabour(), generateContractTitle() (+50 more)

### Community 15 - "Community 15"
Cohesion: 0.04
Nodes (43): handleCreateProject(), buildImportRows(), commitImport(), clearImportDraft(), key(), loadImportDraft(), saveImportDraft(), detectColumns() (+35 more)

### Community 16 - "Community 16"
Cohesion: 0.05
Nodes (46): closeSheet(), contractPct(), countOf(), end(), engagementForm(), esc(), fail(), go() (+38 more)

### Community 17 - "Community 17"
Cohesion: 0.04
Nodes (28): daysAgo(), file_(), iso(), NewBillModal(), onFormKey(), pad2(), parseBillDate(), pick() (+20 more)

### Community 18 - "Community 18"
Cohesion: 0.04
Nodes (24): deleteBill(), openDoc(), parseStoredPath(), resolveDocUrl(), useLongPress(), goBack(), inr(), onDelete() (+16 more)

### Community 19 - "Community 19"
Cohesion: 0.05
Nodes (38): isMissingTable(), band(), begin(), buzz(), canPull(), clamp01(), coveredUp(), draw() (+30 more)

### Community 20 - "Community 20"
Cohesion: 0.07
Nodes (38): balStr(), downloadPartyStatementExcel(), fmtDate(), money(), ordered(), particularsOf(), vchNo(), vchType() (+30 more)

### Community 21 - "Community 21"
Cohesion: 0.05
Nodes (37): handleSave(), suggestCostCode(), NameList(), nameRows(), nudge(), toggleSug(), costCodeLabel(), getCostCode() (+29 more)

### Community 22 - "Community 22"
Cohesion: 0.05
Nodes (29): handler(), close(), go(), handleClose(), handleOpen(), toggle(), handler(), go() (+21 more)

### Community 23 - "Community 23"
Cohesion: 0.05
Nodes (23): AttendanceSheet(), isoOf(), readStoredSession(), useAuth(), useCan(), useOrgId(), classifyRefreshError(), extractErrorCode() (+15 more)

### Community 24 - "Community 24"
Cohesion: 0.06
Nodes (25): renameWalletHolder(), buzz(), commit(), esc(), save(), add(), hapt(), reallyDelete() (+17 more)

### Community 25 - "Community 25"
Cohesion: 0.05
Nodes (28): patchProblem(), toggleSnag(), patchProblem(), toggleSnag(), appendEvent(), legacyToFollowupType(), notifyAssignment(), trailKey() (+20 more)

### Community 26 - "Community 26"
Cohesion: 0.06
Nodes (32): bandedMatch(), canonRole(), isKnownTrade(), levenshtein(), matchPayee(), nameTokenScore(), rankPayeeName(), roleVerdict() (+24 more)

### Community 27 - "Community 27"
Cohesion: 0.06
Nodes (26): addDays(), approvePhase(), attempt(), attemptQuiet(), baseWin(), commit(), durOf(), isoOf() (+18 more)

### Community 28 - "Community 28"
Cohesion: 0.09
Nodes (28): ago(), assignReasonOf(), bucketRef(), buildChase(), buildStory(), buildTaskStory(), capitalise(), chaseWhen() (+20 more)

### Community 29 - "Community 29"
Cohesion: 0.08
Nodes (17): amountOf(), buzz(), choose(), doFile(), file(), goStep(), onKey(), press() (+9 more)

### Community 30 - "Community 30"
Cohesion: 0.08
Nodes (8): handleSave(), h(), handleTap(), if(), ProjectHome(), useProjectCode(), onSelect(), pick()

### Community 31 - "Community 31"
Cohesion: 0.08
Nodes (3): taskStatus(), upNextRefs(), statusOf()

### Community 32 - "Community 32"
Cohesion: 0.14
Nodes (20): buildClassifierPrompt(), clamp01(), classifyUserTask(), dedupe(), gatewayAnchor(), introducesCycle(), resolveFreedomSet(), sanitizeScope() (+12 more)

### Community 33 - "Community 33"
Cohesion: 0.2
Nodes (3): Evaluator, messageFor(), verdictFor()

### Community 34 - "Community 34"
Cohesion: 0.19
Nodes (14): buildExtractionPrompt(), buildReRankPrompt(), cleanExtractionResult(), extractItems(), generateStructuredSkuWithContext(), generateVectorEmbedding(), looksLikePlaceholder(), matchItems() (+6 more)

### Community 35 - "Community 35"
Cohesion: 0.12
Nodes (2): seed(), SEED2()

### Community 36 - "Community 36"
Cohesion: 0.17
Nodes (7): addPhotos(), fmt(), goodOf(), handleSubmit(), parseTiffDate(), readExifDate(), readPhotoDate()

### Community 37 - "Community 37"
Cohesion: 0.15
Nodes (3): cand(), floorSeed(), fourFloors()

### Community 38 - "Community 38"
Cohesion: 0.14
Nodes (2): clearPersistedCache(), doSignOut()

### Community 39 - "Community 39"
Cohesion: 0.21
Nodes (7): ctaOnScreen(), go(), hapt(), onFab(), onScroll(), onTab(), openMore()

### Community 40 - "Community 40"
Cohesion: 0.15
Nodes (2): fmtAmendVal(), fmtDiffVal()

### Community 41 - "Community 41"
Cohesion: 0.19
Nodes (6): useDeskApi(), useMockDeskApi(), deskCoreQuery(), deskPlanQuery(), DeskUnsupported, useLiveDeskApi()

### Community 42 - "Community 42"
Cohesion: 0.18
Nodes (3): BI(), chaseSeed(), seed()

### Community 43 - "Community 43"
Cohesion: 0.32
Nodes (11): act(), briklayChat(), checkRegistration(), greetOnce(), local10(), onlyDigits(), onTap(), prettyPhone() (+3 more)

### Community 45 - "Community 45"
Cohesion: 0.29
Nodes (7): bandRange(), buildRationale(), draftStages(), extractMeasured(), normalizeWeights(), templateKeyForTrade(), titleCase()

### Community 46 - "Community 46"
Cohesion: 0.27
Nodes (6): PeekLink(), fmtDate(), Label(), summarizeScope(), woTone(), usePeek()

### Community 47 - "Community 47"
Cohesion: 0.31
Nodes (6): confirmSpawn(), invalidate(), invalidateObjects(), onPickFile(), post(), quickAction()

### Community 48 - "Community 48"
Cohesion: 0.22
Nodes (2): closed(), openLive()

### Community 51 - "Community 51"
Cohesion: 0.28
Nodes (3): handleSendOtp(), handleVerifyOtp(), toE164()

### Community 52 - "Community 52"
Cohesion: 0.39
Nodes (7): boundedFetch(), coalescedRefresh(), hasBearer(), isOnline(), timeoutFetch(), urlOf(), withBearer()

### Community 53 - "Community 53"
Cohesion: 0.33
Nodes (4): canonicalRank(), findAbstractCycle(), isHardNature(), validateLibrary()

### Community 54 - "Community 54"
Cohesion: 0.25
Nodes (2): cm(), DEC()

### Community 55 - "Community 55"
Cohesion: 0.25
Nodes (2): ProblemRow(), useSwipe()

### Community 56 - "Community 56"
Cohesion: 0.29
Nodes (2): fmt(), stateOf()

### Community 57 - "Community 57"
Cohesion: 0.36
Nodes (5): chooseContact(), closeNum(), contactPicker(), digits(), finishNum()

### Community 58 - "Community 58"
Cohesion: 0.43
Nodes (7): decodeDemo(), encodeDemo(), fromBase64Url(), num(), sanitize(), str(), toBase64Url()

### Community 59 - "Community 59"
Cohesion: 0.32
Nodes (5): autoSet(), isOn(), ruleHints(), toggle(), A()

### Community 60 - "Community 60"
Cohesion: 0.29
Nodes (2): getInitials(), matchProject()

### Community 62 - "Community 62"
Cohesion: 0.29
Nodes (2): model(), R_CREATE()

### Community 65 - "Community 65"
Cohesion: 0.43
Nodes (4): genId(), handleKeyDown(), patchRow(), saveRow()

### Community 66 - "Community 66"
Cohesion: 0.33
Nodes (2): CertifyDialog(), INR()

### Community 67 - "Community 67"
Cohesion: 0.48
Nodes (5): usePrefetchPO(), usePrefetchStakeholder(), usePrefetchTxn(), usePrefetchWO(), useThrottledPrefetch()

### Community 69 - "Community 69"
Cohesion: 0.71
Nodes (6): audio(), cueFail(), cueStart(), cueStop(), haptic(), note()

### Community 70 - "Community 70"
Cohesion: 0.43
Nodes (5): TxnRow(), dot(), formatShortDate(), formatTxn(), isCostCode()

### Community 72 - "Community 72"
Cohesion: 0.43
Nodes (5): buildDemo(), inr(), onMsg(), slugify(), toE164()

### Community 74 - "Community 74"
Cohesion: 0.33
Nodes (2): handled(), minsAgo()

### Community 78 - "Community 78"
Cohesion: 0.33
Nodes (2): BootLoader(), isBooted()

### Community 79 - "Community 79"
Cohesion: 0.53
Nodes (4): importPO(), importTxn(), importWO(), preloadPeekChunks()

### Community 80 - "Community 80"
Cohesion: 0.33
Nodes (2): safeRedirect(), LoginRegister()

### Community 83 - "Community 83"
Cohesion: 0.6
Nodes (3): isValidMobile(), localDigits(), PhoneInput()

### Community 84 - "Community 84"
Cohesion: 0.6
Nodes (3): close(), handleSave(), reset()

### Community 85 - "Community 85"
Cohesion: 0.5
Nodes (2): prefetchTxn(), txnPeekKey()

### Community 86 - "Community 86"
Cohesion: 0.5
Nodes (3): unsureOf(), bill(), iso()

### Community 87 - "Community 87"
Cohesion: 0.5
Nodes (3): crossCutsFor(), hrefOf(), titles()

### Community 88 - "Community 88"
Cohesion: 0.4
Nodes (2): DocPeek(), useSignedDocs()

### Community 89 - "Community 89"
Cohesion: 0.6
Nodes (3): classificationsByName(), norm(), snapClassification()

### Community 91 - "Community 91"
Cohesion: 0.7
Nodes (4): nodeKey(), nodeKeyOf(), unitKeyOf(), zoneIdOf()

### Community 92 - "Community 92"
Cohesion: 0.5
Nodes (2): FinancialsCashflow(), lastNMonths()

### Community 100 - "Community 100"
Cohesion: 0.67
Nodes (2): handleClose(), handleSubmit()

### Community 101 - "Community 101"
Cohesion: 0.67
Nodes (2): bloom(), REDUCED()

### Community 110 - "Community 110"
Cohesion: 0.83
Nodes (3): hidesGlobalFab(), ownsBottomBar(), ownsCreateAction()

### Community 111 - "Community 111"
Cohesion: 0.67
Nodes (2): poGateState(), poIsPriced()

### Community 115 - "Community 115"
Cohesion: 0.67
Nodes (2): concealedByPlaster(), unit()

### Community 120 - "Community 120"
Cohesion: 0.83
Nodes (3): json(), judge(), serperListings()

### Community 125 - "Community 125"
Cohesion: 1.0
Nodes (2): handleClose(), onKey()

### Community 137 - "Community 137"
Cohesion: 1.0
Nodes (2): downloadGRNChallan(), fmtDate()

### Community 138 - "Community 138"
Cohesion: 1.0
Nodes (2): insertionIndex(), withNewTask()

### Community 141 - "Community 141"
Cohesion: 1.0
Nodes (2): placeOf(), stageOfFloorless()

## Knowledge Gaps
- **Thin community `Community 35`** (17 nodes): `no_such_floor_ask.test.ts`, `base()`, `blindModel()`, `convoOf()`, `ctxPin()`, `geo()`, `imgCtx()`, `model()`, `preambleOf()`, `projConvoOf()`, `row()`, `seed()`, `SEED2()`, `shortlist()`, `stateWrites()`, `textCtx()`, `tUpd()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (14 nodes): `clearPersistedCache()`, `shouldPersistQuery()`, `can()`, `checkScroll()`, `doSignOut()`, `e()`, `h()`, `initials()`, `isActive()`, `measure()`, `RailItem()`, `RailLabel()`, `BriklayRail.tsx`, `queryClient.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (14 nodes): `afterAttach()`, `allocStatus()`, `fmtAmendVal()`, `fmtDiffVal()`, `fmtWhen()`, `generatePDF()`, `getPOBalance()`, `isPO()`, `linkAction()`, `openAmendModal()`, `openLightbox()`, `openWallet()`, `rupee()`, `TransactionDetail.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (10 nodes): `WOListSheet.tsx`, `balance()`, `closed()`, `D()`, `doneStages()`, `dstr()`, `fmt()`, `openLive()`, `pctPaid()`, `useWOListData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (9 nodes): `singular_unit.test.ts`, `cm()`, `ctxFor()`, `DEC()`, `DEC_EMPTY()`, `decomposeCalls()`, `resolutionCalls()`, `seed()`, `unitModel()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (8 nodes): `away()`, `ProblemRow()`, `useIsDesktop()`, `useIsTouch()`, `useRowClose()`, `useSwipe()`, `Problems.tsx`, `useDesk.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (8 nodes): `Check()`, `closeSheet()`, `dayLabel()`, `fmt()`, `shortDate()`, `stateOf()`, `timeOf()`, `PartyLedgerMobile.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (8 nodes): `buildDescription()`, `calcOverall()`, `getInitials()`, `inferCategory()`, `levenshtein()`, `matchPayee()`, `matchProject()`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (8 nodes): `held_project_fold.test.ts`, `convoOf()`, `ctxFor()`, `it()`, `model()`, `projectSlots()`, `R_CREATE()`, `seed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (7 nodes): `CertifyDialog()`, `dLabel()`, `fmtQ()`, `INR()`, `stageShape()`, `todayISO()`, `CertifyDialog.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 74`** (7 nodes): `duplicate_narration.test.ts`, `calls()`, `ctxFor()`, `handled()`, `minsAgo()`, `model()`, `seed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (6 nodes): `BootLoader()`, `isBooted()`, `markBooted()`, `onBooted()`, `BootLoader.tsx`, `bootSignal.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 80`** (6 nodes): `loginRouteFor()`, `safeRedirect()`, `LoginRegister()`, `toE164()`, `routes.ts`, `LoginRegister.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 85`** (5 nodes): `fmtDate()`, `prefetchTxn()`, `txnPeekFn()`, `txnPeekKey()`, `TransactionPeek.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 88`** (5 nodes): `DocPeek.tsx`, `docSigning.ts`, `DocPeek()`, `isPdf()`, `useSignedDocs()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 92`** (5 nodes): `FinancialsCashflow()`, `fmt()`, `lastNMonths()`, `monthLabel()`, `FinancialsCashflow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 100`** (4 nodes): `handleClose()`, `handleSubmit()`, `updateRow()`, `QuoteEntryDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 101`** (4 nodes): `bloom()`, `Btn()`, `REDUCED()`, `Btn.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 111`** (4 nodes): `poGateState()`, `poIsPriced()`, `poPayState()`, `poLifecycle.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 115`** (4 nodes): `evaluate.test.ts`, `blockworkDoneGround()`, `concealedByPlaster()`, `unit()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 125`** (3 nodes): `handleClose()`, `onKey()`, `StakeholderLedgerDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 137`** (3 nodes): `downloadGRNChallan()`, `fmtDate()`, `grnChallan.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 138`** (3 nodes): `insertionIndex()`, `withNewTask()`, `add.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 141`** (3 nodes): `placeOf()`, `stageOfFloorless()`, `stages.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `say()` connect `Community 19` to `Community 0`, `Community 1`, `Community 5`?**
  _High betweenness centrality (0.168) - this node is a cross-community bridge._
- **Why does `runSiteops()` connect `Community 0` to `Community 2`, `Community 10`, `Community 11`, `Community 13`, `Community 19`, `Community 27`?**
  _High betweenness centrality (0.141) - this node is a cross-community bridge._
- **Why does `show()` connect `Community 4` to `Community 24`, `Community 18`, `Community 19`?**
  _High betweenness centrality (0.112) - this node is a cross-community bridge._
- **Are the 44 inferred relationships involving `send()` (e.g. with `processJob()` and `resurfacePending()`) actually correct?**
  _`send()` has 44 INFERRED edges - model-reasoned connections that need verification._
- **Are the 37 inferred relationships involving `dispatch()` (e.g. with `processJob()` and `send()`) actually correct?**
  _`dispatch()` has 37 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `answerSiteops()` (e.g. with `closeConversation()` and `sendNowDurable()`) actually correct?**
  _`answerSiteops()` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 20 inferred relationships involving `runSiteops()` (e.g. with `getOpenBatch()` and `say()`) actually correct?**
  _`runSiteops()` has 20 INFERRED edges - model-reasoned connections that need verification._