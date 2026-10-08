# Graph Report - Briklay Fly  (2026-09-29)

## Corpus Check
- 949 files · ~1,700,723 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4228 nodes · 6743 edges · 92 communities detected
- Extraction: 84% EXTRACTED · 16% INFERRED · 0% AMBIGUOUS · INFERRED: 1087 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 53|Community 53]]
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
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 110|Community 110]]
- [[_COMMUNITY_Community 111|Community 111]]
- [[_COMMUNITY_Community 115|Community 115]]
- [[_COMMUNITY_Community 119|Community 119]]
- [[_COMMUNITY_Community 126|Community 126]]
- [[_COMMUNITY_Community 138|Community 138]]
- [[_COMMUNITY_Community 139|Community 139]]
- [[_COMMUNITY_Community 142|Community 142]]

## God Nodes (most connected - your core abstractions)
1. `pick()` - 65 edges
2. `send()` - 51 edges
3. `show()` - 47 edges
4. `dispatch()` - 47 edges
5. `answerSiteops()` - 36 edges
6. `runSiteops()` - 34 edges
7. `applyTerminals()` - 31 edges
8. `resolveAgainstSingleFamily()` - 24 edges
9. `handlePillSelection()` - 22 edges
10. `sendNowDurable()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `setOpen()` --calls--> `h()`  [INFERRED]
  src\components\day-book\SearchPicker.tsx → src\pages\PurchaseRequestDetail.tsx
- `VendorHub()` --calls--> `useOrgId()`  [INFERRED]
  src\components\txn-ledger\VendorHub.tsx → src\lib\auth\AuthProvider.tsx
- `buildChase()` --calls--> `nameOf()`  [INFERRED]
  src\lib\desk\fromDb.ts → supabase\functions\siteops-notify-assignment\index.ts
- `openReceive()` --calls--> `show()`  [INFERRED]
  src\pages\Bills.tsx → src\pages\VendorQuote.tsx
- `afterReceive()` --calls--> `show()`  [INFERRED]
  src\pages\Bills.tsx → src\pages\VendorQuote.tsx

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (147): answerSiteops(), answerWithPhoto(), applyBatchResolution(), applyQcFailures(), applyTaskBlockedById(), applyTaskProgressById(), applyTaskUpdate(), applyTerminals() (+139 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (147): bindingKey(), graphIsMaterialized(), materializeProjectTasksUncached(), placeOfTask(), gatesByTask(), gatesFromBinding(), safeGeometry(), safeInstantiate() (+139 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (146): answerBillPayment(), attachBillDoc(), billAi(), billRawText(), billReplyKind(), findPrecedingCaption(), fmtNum(), isCleanAmount() (+138 more)

### Community 3 - "Community 3"
Cohesion: 0.01
Nodes (36): baseSeed(), twoAskSeed(), ask(), ctxFor(), model(), tUpdated(), upd(), ctxFor() (+28 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (92): askRaju(), remaining(), save(), step(), summary(), daysLeft(), digits(), doEnable() (+84 more)

### Community 5 - "Community 5"
Cohesion: 0.03
Nodes (89): composeLLM(), fallbackReply(), isGreeting(), runConcierge(), systemFor(), userContent(), classifyPhotoFollowup(), stampPossibleFollowup() (+81 more)

### Community 6 - "Community 6"
Cohesion: 0.02
Nodes (58): readStoredSession(), useAuth(), useCan(), useOrgId(), classifyRefreshError(), extractErrorCode(), parseStoredSession(), useMintBill() (+50 more)

### Community 7 - "Community 7"
Cohesion: 0.03
Nodes (67): AttendanceSheet(), isoOf(), confirm(), confirm(), commit(), cardKeyToCols(), cellFrom(), commitCrewSettlement() (+59 more)

### Community 8 - "Community 8"
Cohesion: 0.03
Nodes (78): onMsg(), resolveVendorId(), createVendor(), guessVendor(), low(), onPrimary(), save(), whatsMissing() (+70 more)

### Community 9 - "Community 9"
Cohesion: 0.03
Nodes (84): isStopWord(), addCustomBrand(), brandsFor(), getCustomBrands(), LS_KEY(), buildConflictPills(), buildNovelVariantPills(), buildPills() (+76 more)

### Community 10 - "Community 10"
Cohesion: 0.03
Nodes (68): parseAmount(), ageOf(), bucketOf(), day(), hapt(), inr(), link(), short() (+60 more)

### Community 11 - "Community 11"
Cohesion: 0.03
Nodes (53): wa(), buildComponents(), buildTemplateMessage(), sendTemplate(), line(), promptFor(), withTask(), cadenceFor() (+45 more)

### Community 12 - "Community 12"
Cohesion: 0.03
Nodes (52): save(), setQ(), summary(), handler(), close(), go(), handleClose(), handleOpen() (+44 more)

### Community 13 - "Community 13"
Cohesion: 0.05
Nodes (78): clean(), dayBookLink(), entryLink(), partyLedgerLink(), problemLink(), reviewLink(), taskLink(), tasksLink() (+70 more)

### Community 14 - "Community 14"
Cohesion: 0.04
Nodes (60): createBill(), allocIdOf(), assertLinkable(), attachToContract(), createContract(), fallbackTitle(), fileAsLabour(), generateContractTitle() (+52 more)

### Community 15 - "Community 15"
Cohesion: 0.03
Nodes (37): saveBillAllocations(), adjustContractPayment(), applyAttribution(), attributeAdvanceToContract(), attributeTag(), attributeToBills(), attributeToContractCertified(), attributeToPhase() (+29 more)

### Community 16 - "Community 16"
Cohesion: 0.04
Nodes (53): closeSheet(), contractPct(), countOf(), end(), engagementForm(), esc(), fail(), go() (+45 more)

### Community 17 - "Community 17"
Cohesion: 0.04
Nodes (35): answerPaymentTotal(), answerReporting(), groupBySite(), loadProjects(), loadStakeholders(), num(), orderRows(), pickFrom() (+27 more)

### Community 18 - "Community 18"
Cohesion: 0.04
Nodes (45): handleCreateProject(), resolveEntry(), buildImportRows(), commitImport(), clearImportDraft(), key(), loadImportDraft(), saveImportDraft() (+37 more)

### Community 19 - "Community 19"
Cohesion: 0.05
Nodes (50): buildNudgeBody(), buildRecord(), clampNum(), clampStr(), composeDemoLLM(), encodeDemo(), inr(), nudgeCta() (+42 more)

### Community 20 - "Community 20"
Cohesion: 0.05
Nodes (43): addAdjustment(), payableTagLabel(), isMissingTable(), band(), begin(), buzz(), canPull(), clamp01() (+35 more)

### Community 21 - "Community 21"
Cohesion: 0.03
Nodes (27): at(), submit(), clearOpening(), doMerge(), fmtDate(), inr(), rowAmount(), rowDir() (+19 more)

### Community 22 - "Community 22"
Cohesion: 0.07
Nodes (38): balStr(), downloadPartyStatementExcel(), fmtDate(), money(), ordered(), particularsOf(), vchNo(), vchType() (+30 more)

### Community 23 - "Community 23"
Cohesion: 0.05
Nodes (37): handleSave(), suggestCostCode(), NameList(), nameRows(), nudge(), toggleSug(), costCodeLabel(), getCostCode() (+29 more)

### Community 24 - "Community 24"
Cohesion: 0.05
Nodes (27): poGateState(), poIsPriced(), poPayState(), handleSave(), h(), handleTap(), if(), ProjectHome() (+19 more)

### Community 25 - "Community 25"
Cohesion: 0.06
Nodes (28): addDays(), approvePhase(), attempt(), attemptQuiet(), baseWin(), commit(), durOf(), isoOf() (+20 more)

### Community 26 - "Community 26"
Cohesion: 0.05
Nodes (27): patchProblem(), toggleSnag(), patchProblem(), toggleSnag(), appendEvent(), legacyToFollowupType(), notifyAssignment(), trailKey() (+19 more)

### Community 27 - "Community 27"
Cohesion: 0.08
Nodes (23): renameWalletHolder(), buzz(), commit(), esc(), save(), add(), hapt(), reallyDelete() (+15 more)

### Community 28 - "Community 28"
Cohesion: 0.06
Nodes (31): applyAll(), imgCtx(), runTurn(), seed(), task(), checkExprAt(), findMigrationsDir(), loadEnumChecks() (+23 more)

### Community 29 - "Community 29"
Cohesion: 0.06
Nodes (27): setAdvanceMemo(), backfillOrg(), backfillParty(), deriveCertified(), num(), today(), deriveParty(), num() (+19 more)

### Community 30 - "Community 30"
Cohesion: 0.09
Nodes (28): ago(), assignReasonOf(), bucketRef(), buildChase(), buildStory(), buildTaskStory(), capitalise(), chaseWhen() (+20 more)

### Community 31 - "Community 31"
Cohesion: 0.08
Nodes (28): bandedMatch(), canonRole(), isKnownTrade(), levenshtein(), matchPayee(), nameTokenScore(), rankPayeeName(), roleVerdict() (+20 more)

### Community 32 - "Community 32"
Cohesion: 0.08
Nodes (17): amountOf(), buzz(), choose(), doFile(), file(), goStep(), onKey(), press() (+9 more)

### Community 33 - "Community 33"
Cohesion: 0.09
Nodes (18): isTouch(), startLamp(), byTypeFor(), commitMove(), goTo(), loop(), measure(), moveTo() (+10 more)

### Community 34 - "Community 34"
Cohesion: 0.14
Nodes (20): buildClassifierPrompt(), clamp01(), classifyUserTask(), dedupe(), gatewayAnchor(), introducesCycle(), resolveFreedomSet(), sanitizeScope() (+12 more)

### Community 35 - "Community 35"
Cohesion: 0.2
Nodes (3): Evaluator, messageFor(), verdictFor()

### Community 36 - "Community 36"
Cohesion: 0.19
Nodes (14): buildExtractionPrompt(), buildReRankPrompt(), cleanExtractionResult(), extractItems(), generateStructuredSkuWithContext(), generateVectorEmbedding(), looksLikePlaceholder(), matchItems() (+6 more)

### Community 37 - "Community 37"
Cohesion: 0.12
Nodes (2): seed(), SEED2()

### Community 38 - "Community 38"
Cohesion: 0.17
Nodes (7): addPhotos(), fmt(), goodOf(), handleSubmit(), parseTiffDate(), readExifDate(), readPhotoDate()

### Community 39 - "Community 39"
Cohesion: 0.15
Nodes (3): cand(), floorSeed(), fourFloors()

### Community 40 - "Community 40"
Cohesion: 0.21
Nodes (7): ctaOnScreen(), go(), hapt(), onFab(), onScroll(), onTab(), openMore()

### Community 41 - "Community 41"
Cohesion: 0.14
Nodes (2): clearPersistedCache(), doSignOut()

### Community 42 - "Community 42"
Cohesion: 0.19
Nodes (6): useDeskApi(), useMockDeskApi(), deskCoreQuery(), deskPlanQuery(), DeskUnsupported, useLiveDeskApi()

### Community 43 - "Community 43"
Cohesion: 0.18
Nodes (3): BI(), chaseSeed(), seed()

### Community 44 - "Community 44"
Cohesion: 0.32
Nodes (11): act(), briklayChat(), checkRegistration(), greetOnce(), local10(), onlyDigits(), onTap(), prettyPhone() (+3 more)

### Community 45 - "Community 45"
Cohesion: 0.21
Nodes (5): base(), nearest(), upd(), updResolve(), withNearest()

### Community 47 - "Community 47"
Cohesion: 0.29
Nodes (7): bandRange(), buildRationale(), draftStages(), extractMeasured(), normalizeWeights(), templateKeyForTrade(), titleCase()

### Community 48 - "Community 48"
Cohesion: 0.31
Nodes (6): confirmSpawn(), invalidate(), invalidateObjects(), onPickFile(), post(), quickAction()

### Community 49 - "Community 49"
Cohesion: 0.22
Nodes (2): closed(), openLive()

### Community 50 - "Community 50"
Cohesion: 0.27
Nodes (6): PeekLink(), fmtDate(), Label(), summarizeScope(), woTone(), usePeek()

### Community 53 - "Community 53"
Cohesion: 0.28
Nodes (3): handleSendOtp(), handleVerifyOtp(), toE164()

### Community 54 - "Community 54"
Cohesion: 0.39
Nodes (7): boundedFetch(), coalescedRefresh(), hasBearer(), isOnline(), timeoutFetch(), urlOf(), withBearer()

### Community 55 - "Community 55"
Cohesion: 0.33
Nodes (4): canonicalRank(), findAbstractCycle(), isHardNature(), validateLibrary()

### Community 56 - "Community 56"
Cohesion: 0.25
Nodes (2): cm(), DEC()

### Community 57 - "Community 57"
Cohesion: 0.28
Nodes (3): canonicalizeBatch(), parseJson(), runChat()

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
Cohesion: 0.32
Nodes (4): remaining(), send(), step(), summary()

### Community 64 - "Community 64"
Cohesion: 0.29
Nodes (2): getInitials(), matchProject()

### Community 66 - "Community 66"
Cohesion: 0.29
Nodes (2): model(), R_CREATE()

### Community 68 - "Community 68"
Cohesion: 0.43
Nodes (4): genId(), handleKeyDown(), patchRow(), saveRow()

### Community 69 - "Community 69"
Cohesion: 0.43
Nodes (5): TxnRow(), dot(), formatShortDate(), formatTxn(), isCostCode()

### Community 70 - "Community 70"
Cohesion: 0.33
Nodes (2): CertifyDialog(), INR()

### Community 71 - "Community 71"
Cohesion: 0.48
Nodes (5): usePrefetchPO(), usePrefetchStakeholder(), usePrefetchTxn(), usePrefetchWO(), useThrottledPrefetch()

### Community 73 - "Community 73"
Cohesion: 0.71
Nodes (6): audio(), cueFail(), cueStart(), cueStop(), haptic(), note()

### Community 75 - "Community 75"
Cohesion: 0.43
Nodes (5): buildDemo(), inr(), onMsg(), slugify(), toE164()

### Community 77 - "Community 77"
Cohesion: 0.33
Nodes (2): handled(), minsAgo()

### Community 79 - "Community 79"
Cohesion: 0.33
Nodes (2): BootLoader(), isBooted()

### Community 80 - "Community 80"
Cohesion: 0.53
Nodes (4): importPO(), importTxn(), importWO(), preloadPeekChunks()

### Community 83 - "Community 83"
Cohesion: 0.33
Nodes (2): safeRedirect(), LoginRegister()

### Community 84 - "Community 84"
Cohesion: 0.6
Nodes (3): isValidMobile(), localDigits(), PhoneInput()

### Community 85 - "Community 85"
Cohesion: 0.6
Nodes (3): close(), handleSave(), reset()

### Community 86 - "Community 86"
Cohesion: 0.5
Nodes (2): prefetchTxn(), txnPeekKey()

### Community 87 - "Community 87"
Cohesion: 0.5
Nodes (3): unsureOf(), bill(), iso()

### Community 88 - "Community 88"
Cohesion: 0.5
Nodes (3): crossCutsFor(), hrefOf(), titles()

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
Nodes (2): FinancialsCashflow(), lastNMonths()

### Community 101 - "Community 101"
Cohesion: 0.67
Nodes (2): handleClose(), handleSubmit()

### Community 102 - "Community 102"
Cohesion: 0.67
Nodes (2): bloom(), REDUCED()

### Community 110 - "Community 110"
Cohesion: 0.67
Nodes (2): inr(), rs()

### Community 111 - "Community 111"
Cohesion: 0.83
Nodes (3): hidesGlobalFab(), ownsBottomBar(), ownsCreateAction()

### Community 115 - "Community 115"
Cohesion: 0.67
Nodes (2): concealedByPlaster(), unit()

### Community 119 - "Community 119"
Cohesion: 0.83
Nodes (3): json(), judge(), serperListings()

### Community 126 - "Community 126"
Cohesion: 1.0
Nodes (2): handleClose(), onKey()

### Community 138 - "Community 138"
Cohesion: 1.0
Nodes (2): downloadGRNChallan(), fmtDate()

### Community 139 - "Community 139"
Cohesion: 1.0
Nodes (2): insertionIndex(), withNewTask()

### Community 142 - "Community 142"
Cohesion: 1.0
Nodes (2): placeOf(), stageOfFloorless()

## Knowledge Gaps
- **Thin community `Community 37`** (17 nodes): `no_such_floor_ask.test.ts`, `base()`, `blindModel()`, `convoOf()`, `ctxPin()`, `geo()`, `imgCtx()`, `model()`, `preambleOf()`, `projConvoOf()`, `row()`, `seed()`, `SEED2()`, `shortlist()`, `stateWrites()`, `textCtx()`, `tUpd()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (14 nodes): `clearPersistedCache()`, `shouldPersistQuery()`, `can()`, `checkScroll()`, `doSignOut()`, `e()`, `h()`, `initials()`, `isActive()`, `measure()`, `RailItem()`, `RailLabel()`, `BriklayRail.tsx`, `queryClient.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (10 nodes): `WOListSheet.tsx`, `balance()`, `closed()`, `D()`, `doneStages()`, `dstr()`, `fmt()`, `openLive()`, `pctPaid()`, `useWOListData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (9 nodes): `singular_unit.test.ts`, `cm()`, `ctxFor()`, `DEC()`, `DEC_EMPTY()`, `decomposeCalls()`, `resolutionCalls()`, `seed()`, `unitModel()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (8 nodes): `away()`, `ProblemRow()`, `useIsDesktop()`, `useIsTouch()`, `useRowClose()`, `useSwipe()`, `Problems.tsx`, `useDesk.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (8 nodes): `Check()`, `closeSheet()`, `dayLabel()`, `fmt()`, `shortDate()`, `stateOf()`, `timeOf()`, `PartyLedgerMobile.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (8 nodes): `buildDescription()`, `calcOverall()`, `getInitials()`, `inferCategory()`, `levenshtein()`, `matchPayee()`, `matchProject()`, `index.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (8 nodes): `held_project_fold.test.ts`, `convoOf()`, `ctxFor()`, `it()`, `model()`, `projectSlots()`, `R_CREATE()`, `seed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 70`** (7 nodes): `CertifyDialog()`, `dLabel()`, `fmtQ()`, `INR()`, `stageShape()`, `todayISO()`, `CertifyDialog.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 77`** (7 nodes): `duplicate_narration.test.ts`, `calls()`, `ctxFor()`, `handled()`, `minsAgo()`, `model()`, `seed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 79`** (6 nodes): `BootLoader()`, `isBooted()`, `markBooted()`, `onBooted()`, `BootLoader.tsx`, `bootSignal.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 83`** (6 nodes): `loginRouteFor()`, `safeRedirect()`, `LoginRegister()`, `toE164()`, `routes.ts`, `LoginRegister.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 86`** (5 nodes): `fmtDate()`, `prefetchTxn()`, `txnPeekFn()`, `txnPeekKey()`, `TransactionPeek.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 89`** (5 nodes): `DocPeek.tsx`, `docSigning.ts`, `DocPeek()`, `isPdf()`, `useSignedDocs()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 93`** (5 nodes): `FinancialsCashflow()`, `fmt()`, `lastNMonths()`, `monthLabel()`, `FinancialsCashflow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 101`** (4 nodes): `handleClose()`, `handleSubmit()`, `updateRow()`, `QuoteEntryDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 102`** (4 nodes): `bloom()`, `Btn()`, `REDUCED()`, `Btn.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 110`** (4 nodes): `ContractsMobile.tsx`, `inr()`, `rs()`, `useContractCards()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 115`** (4 nodes): `evaluate.test.ts`, `blockworkDoneGround()`, `concealedByPlaster()`, `unit()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 126`** (3 nodes): `handleClose()`, `onKey()`, `StakeholderLedgerDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 138`** (3 nodes): `downloadGRNChallan()`, `fmtDate()`, `grnChallan.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 139`** (3 nodes): `insertionIndex()`, `withNewTask()`, `add.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 142`** (3 nodes): `placeOf()`, `stageOfFloorless()`, `stages.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `say()` connect `Community 20` to `Community 0`, `Community 7`, `Community 8`, `Community 14`, `Community 17`?**
  _High betweenness centrality (0.179) - this node is a cross-community bridge._
- **Why does `runSiteops()` connect `Community 0` to `Community 3`, `Community 11`, `Community 20`, `Community 25`, `Community 28`?**
  _High betweenness centrality (0.147) - this node is a cross-community bridge._
- **Why does `show()` connect `Community 4` to `Community 10`, `Community 12`, `Community 20`, `Community 21`, `Community 27`?**
  _High betweenness centrality (0.124) - this node is a cross-community bridge._
- **Are the 47 inferred relationships involving `send()` (e.g. with `processJob()` and `resurfacePending()`) actually correct?**
  _`send()` has 47 INFERRED edges - model-reasoned connections that need verification._
- **Are the 42 inferred relationships involving `show()` (e.g. with `save()` and `save()`) actually correct?**
  _`show()` has 42 INFERRED edges - model-reasoned connections that need verification._
- **Are the 38 inferred relationships involving `dispatch()` (e.g. with `processJob()` and `send()`) actually correct?**
  _`dispatch()` has 38 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `answerSiteops()` (e.g. with `closeConversation()` and `sendNowDurable()`) actually correct?**
  _`answerSiteops()` has 15 INFERRED edges - model-reasoned connections that need verification._