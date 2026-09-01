# Graph Report - Briklay Fly  (2026-09-01)

## Corpus Check
- 702 files · ~1,301,710 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3018 nodes · 4712 edges · 75 communities detected
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 674 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 101|Community 101]]
- [[_COMMUNITY_Community 103|Community 103]]
- [[_COMMUNITY_Community 110|Community 110]]
- [[_COMMUNITY_Community 114|Community 114]]
- [[_COMMUNITY_Community 130|Community 130]]
- [[_COMMUNITY_Community 131|Community 131]]
- [[_COMMUNITY_Community 133|Community 133]]
- [[_COMMUNITY_Community 136|Community 136]]

## God Nodes (most connected - your core abstractions)
1. `pick()` - 54 edges
2. `send()` - 45 edges
3. `dispatch()` - 38 edges
4. `answerSiteops()` - 36 edges
5. `runSiteops()` - 32 edges
6. `applyTerminals()` - 27 edges
7. `resolveAgainstSingleFamily()` - 24 edges
8. `handlePillSelection()` - 22 edges
9. `show()` - 22 edges
10. `sendNowDurable()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `buildChase()` --calls--> `nameOf()`  [INFERRED]
  src\lib\desk\fromDb.ts → supabase\functions\siteops-notify-assignment\index.ts
- `capFirst()` --calls--> `normalizeTxn()`  [INFERRED]
  src\pages\NewPurchaseOrder.tsx → supabase\functions\whatsapp-webhook\_extract.ts
- `saveRefBill()` --calls--> `parseAmount()`  [INFERRED]
  src\pages\PurchaseOrderDetail.tsx → supabase\functions\whatsapp-webhook\_agents\transaction.ts
- `cadenceFor()` --calls--> `loadCadenceMap()`  [INFERRED]
  supabase\functions\siteops-chase\index.ts → supabase\functions\whatsapp-webhook\_siteops_timing.ts
- `pickable()` --calls--> `runReporting()`  [INFERRED]
  supabase\functions\whatsapp-webhook\_match.ts → supabase\functions\whatsapp-webhook\_agents\reporting.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.02
Nodes (139): composeLLM(), fallbackReply(), isGreeting(), runConcierge(), systemFor(), userContent(), commitInterruptedProc(), answerSiteops() (+131 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (127): bindingKey(), graphIsMaterialized(), materializeProjectTasksUncached(), placeOfTask(), gatesByTask(), gatesFromBinding(), safeGeometry(), safeInstantiate() (+119 more)

### Community 2 - "Community 2"
Cohesion: 0.02
Nodes (27): baseSeed(), twoAskSeed(), ask(), ctxFor(), model(), tUpdated(), upd(), row() (+19 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (75): daysLeft(), digits(), doEnable(), intlPhone(), local10(), onToggle(), prettyPhone(), roleLabel() (+67 more)

### Community 4 - "Community 4"
Cohesion: 0.04
Nodes (77): isStopWord(), addCustomBrand(), brandsFor(), getCustomBrands(), LS_KEY(), buildConflictPills(), buildNovelVariantPills(), buildPills() (+69 more)

### Community 5 - "Community 5"
Cohesion: 0.03
Nodes (65): classifyPhotoFollowup(), saidAsOf(), d(), decideAssociation(), isBareAffirmation(), photoRelatedness(), subjectTokens(), prefilterCandidates() (+57 more)

### Community 6 - "Community 6"
Cohesion: 0.03
Nodes (73): allocIdOf(), assertLinkable(), attachToContract(), clearOneTime(), createContract(), fallbackTitle(), fileAsLabour(), generateContractTitle() (+65 more)

### Community 7 - "Community 7"
Cohesion: 0.05
Nodes (83): answerProcurement(), finalizeDirectVendor(), flowIdFor(), handleSingle(), loadApprover(), loadProjects(), loadVendors(), markReadyForApproval() (+75 more)

### Community 8 - "Community 8"
Cohesion: 0.05
Nodes (70): commitEdit(), imageDeterministic(), parseDigitToken(), parseSpokenAmount(), callClaude(), callOpenAI(), classifyImage(), classifyImageAnthropic() (+62 more)

### Community 9 - "Community 9"
Cohesion: 0.05
Nodes (70): answerTransaction(), applyPlan(), applyPrefix(), attachProofImage(), buildPlan(), commitEntry(), fmtNum(), handleWriteFailure() (+62 more)

### Community 10 - "Community 10"
Cohesion: 0.04
Nodes (32): call(), issue(), prog(), seed(), task(), bestTokenOverlap(), pickTokens(), resolveTypedPick() (+24 more)

### Community 11 - "Community 11"
Cohesion: 0.04
Nodes (28): answerPaymentTotal(), answerReporting(), groupBySite(), loadProjects(), loadStakeholders(), num(), orderRows(), pickFrom() (+20 more)

### Community 12 - "Community 12"
Cohesion: 0.04
Nodes (40): openDoc(), parseStoredPath(), resolveDocUrl(), async(), patchProblem(), toggleSnag(), fileToBase64Str(), fireCelebration() (+32 more)

### Community 13 - "Community 13"
Cohesion: 0.04
Nodes (39): handler(), close(), go(), handleClose(), handleOpen(), toggle(), close(), handleSave() (+31 more)

### Community 14 - "Community 14"
Cohesion: 0.06
Nodes (27): amountInWords(), amountText(), dataPair(), drawFooter(), drawHeader(), drawLogoMark(), drawRule(), drawSignatures() (+19 more)

### Community 15 - "Community 15"
Cohesion: 0.04
Nodes (26): handleSave(), suggestCostCode(), costCodeLabel(), getCostCode(), classifyExpenseHead(), deriveDirection(), escapeRegExp(), generalExpenseLabel() (+18 more)

### Community 16 - "Community 16"
Cohesion: 0.06
Nodes (34): applyAll(), imgCtx(), runTurn(), seed(), task(), checkExprAt(), findMigrationsDir(), loadEnumChecks() (+26 more)

### Community 17 - "Community 17"
Cohesion: 0.07
Nodes (29): autoSplit(), blank(), doCreate(), evenAmounts(), file(), matchGenHeads(), normHead(), pickGen() (+21 more)

### Community 18 - "Community 18"
Cohesion: 0.06
Nodes (15): wa(), buildComponents(), buildTemplateMessage(), sendTemplate(), line(), promptFor(), withTask(), cadenceFor() (+7 more)

### Community 19 - "Community 19"
Cohesion: 0.09
Nodes (28): ago(), assignReasonOf(), bucketRef(), buildChase(), buildStory(), buildTaskStory(), capitalise(), chaseWhen() (+20 more)

### Community 20 - "Community 20"
Cohesion: 0.07
Nodes (19): readStoredSession(), useAuth(), useCan(), useOrgId(), classifyRefreshError(), extractErrorCode(), parseStoredSession(), useSnackbar() (+11 more)

### Community 21 - "Community 21"
Cohesion: 0.07
Nodes (21): addStage(), attemptCreate(), blankStage(), calcAmount(), clearBad(), fmt(), getMode(), h() (+13 more)

### Community 22 - "Community 22"
Cohesion: 0.1
Nodes (16): byTypeFor(), commitMove(), goTo(), loop(), measure(), moveTo(), nearestTo(), onLeave() (+8 more)

### Community 23 - "Community 23"
Cohesion: 0.13
Nodes (20): bandedMatch(), canonRole(), isKnownTrade(), levenshtein(), matchPayee(), nameTokenScore(), rankPayeeName(), roleVerdict() (+12 more)

### Community 24 - "Community 24"
Cohesion: 0.14
Nodes (20): buildClassifierPrompt(), clamp01(), classifyUserTask(), dedupe(), gatewayAnchor(), introducesCycle(), resolveFreedomSet(), sanitizeScope() (+12 more)

### Community 25 - "Community 25"
Cohesion: 0.2
Nodes (3): Evaluator, messageFor(), verdictFor()

### Community 26 - "Community 26"
Cohesion: 0.19
Nodes (14): buildExtractionPrompt(), buildReRankPrompt(), cleanExtractionResult(), extractItems(), generateStructuredSkuWithContext(), generateVectorEmbedding(), looksLikePlaceholder(), matchItems() (+6 more)

### Community 27 - "Community 27"
Cohesion: 0.16
Nodes (11): src(), stripComments(), renderHistory(), classifyWithLLM(), detectLanguage(), extractJson(), looksActionableProcurement(), looksActionableTxn() (+3 more)

### Community 28 - "Community 28"
Cohesion: 0.12
Nodes (2): seed(), SEED2()

### Community 29 - "Community 29"
Cohesion: 0.17
Nodes (7): addPhotos(), fmt(), goodOf(), handleSubmit(), parseTiffDate(), readExifDate(), readPhotoDate()

### Community 30 - "Community 30"
Cohesion: 0.14
Nodes (2): matchGenHeads(), normHead()

### Community 31 - "Community 31"
Cohesion: 0.15
Nodes (3): cand(), floorSeed(), fourFloors()

### Community 32 - "Community 32"
Cohesion: 0.16
Nodes (5): ProjectHome(), useProjectCode(), if(), isClientReceipt(), isExcludedFromSpent()

### Community 33 - "Community 33"
Cohesion: 0.19
Nodes (6): ctxFor(), imgCtx(), tQItem(), tTaskUpdate(), tUpdateResolve(), upd()

### Community 34 - "Community 34"
Cohesion: 0.15
Nodes (2): clearPersistedCache(), doSignOut()

### Community 35 - "Community 35"
Cohesion: 0.19
Nodes (6): useDeskApi(), useMockDeskApi(), deskCoreQuery(), deskPlanQuery(), DeskUnsupported, useLiveDeskApi()

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
Cohesion: 0.2
Nodes (4): amtOf(), dismiss(), entryView(), invalidateEntries()

### Community 40 - "Community 40"
Cohesion: 0.21
Nodes (5): base(), nearest(), upd(), updResolve(), withNearest()

### Community 42 - "Community 42"
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

### Community 53 - "Community 53"
Cohesion: 0.25
Nodes (2): cm(), DEC()

### Community 54 - "Community 54"
Cohesion: 0.25
Nodes (2): ProblemRow(), useSwipe()

### Community 55 - "Community 55"
Cohesion: 0.32
Nodes (3): handleSendOtp(), handleVerifyOtp(), toE164()

### Community 56 - "Community 56"
Cohesion: 0.32
Nodes (5): autoSet(), isOn(), ruleHints(), toggle(), A()

### Community 57 - "Community 57"
Cohesion: 0.36
Nodes (4): getInitials(), levenshtein(), matchPayee(), matchProject()

### Community 59 - "Community 59"
Cohesion: 0.29
Nodes (2): model(), R_CREATE()

### Community 61 - "Community 61"
Cohesion: 0.33
Nodes (3): handleCreateProject(), fmtProjectId(), uniqueProjectId()

### Community 62 - "Community 62"
Cohesion: 0.43
Nodes (4): genId(), handleKeyDown(), patchRow(), saveRow()

### Community 63 - "Community 63"
Cohesion: 0.43
Nodes (5): TxnRow(), dot(), formatShortDate(), formatTxn(), isCostCode()

### Community 64 - "Community 64"
Cohesion: 0.29
Nodes (2): inr(), UiLivingSentence()

### Community 65 - "Community 65"
Cohesion: 0.48
Nodes (5): usePrefetchPO(), usePrefetchStakeholder(), usePrefetchTxn(), usePrefetchWO(), useThrottledPrefetch()

### Community 69 - "Community 69"
Cohesion: 0.33
Nodes (2): handled(), minsAgo()

### Community 78 - "Community 78"
Cohesion: 0.4
Nodes (2): go(), onKey()

### Community 80 - "Community 80"
Cohesion: 0.53
Nodes (4): importPO(), importTxn(), importWO(), preloadPeekChunks()

### Community 87 - "Community 87"
Cohesion: 0.5
Nodes (2): prefetchTxn(), txnPeekKey()

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

### Community 103 - "Community 103"
Cohesion: 0.67
Nodes (2): bloom(), REDUCED()

### Community 110 - "Community 110"
Cohesion: 0.67
Nodes (2): concealedByPlaster(), unit()

### Community 114 - "Community 114"
Cohesion: 0.83
Nodes (3): json(), judge(), serperListings()

### Community 130 - "Community 130"
Cohesion: 1.0
Nodes (2): downloadGRNChallan(), fmtDate()

### Community 131 - "Community 131"
Cohesion: 1.0
Nodes (2): poGateState(), poIsPriced()

### Community 133 - "Community 133"
Cohesion: 1.0
Nodes (2): insertionIndex(), withNewTask()

### Community 136 - "Community 136"
Cohesion: 1.0
Nodes (2): placeOf(), stageOfFloorless()

## Knowledge Gaps
- **Thin community `Community 28`** (17 nodes): `no_such_floor_ask.test.ts`, `base()`, `blindModel()`, `convoOf()`, `ctxPin()`, `geo()`, `imgCtx()`, `model()`, `preambleOf()`, `projConvoOf()`, `row()`, `seed()`, `SEED2()`, `shortlist()`, `stateWrites()`, `textCtx()`, `tUpd()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (15 nodes): `add()`, `capitalizeWords()`, `FieldQuestion()`, `fieldStyle()`, `h()`, `matchGenHeads()`, `normHead()`, `openCreate()`, `pickGeneralHead()`, `rm()`, `selectPayee()`, `uid()`, `up()`, `update()`, `ResolvePopup.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (13 nodes): `clearPersistedCache()`, `shouldPersistQuery()`, `can()`, `doSignOut()`, `e()`, `h()`, `initials()`, `isActive()`, `measure()`, `RailItem()`, `RailLabel()`, `BriklayRail.tsx`, `queryClient.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (12 nodes): `DrawerSkeleton()`, `filterRow()`, `fmt()`, `formatLedgerDate()`, `getInitials()`, `handleAddTransaction()`, `handleClose()`, `handleKeyDown()`, `monthHeading()`, `monthKey()`, `splitByProject()`, `StakeholderLedgerDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (10 nodes): `WOListSheet.tsx`, `balance()`, `closed()`, `D()`, `doneStages()`, `dstr()`, `fmt()`, `openLive()`, `pctPaid()`, `useWOListData()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (9 nodes): `advanceFromName()`, `choose()`, `onRowClick()`, `pickExisting()`, `settle()`, `tick()`, `toMatch()`, `undo()`, `ResolveRow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (9 nodes): `singular_unit.test.ts`, `cm()`, `ctxFor()`, `DEC()`, `DEC_EMPTY()`, `decomposeCalls()`, `resolutionCalls()`, `seed()`, `unitModel()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (8 nodes): `away()`, `ProblemRow()`, `useIsDesktop()`, `useIsTouch()`, `useRowClose()`, `useSwipe()`, `Problems.tsx`, `useDesk.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (8 nodes): `held_project_fold.test.ts`, `convoOf()`, `ctxFor()`, `it()`, `model()`, `projectSlots()`, `R_CREATE()`, `seed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (7 nodes): `initialsOf()`, `inr()`, `statusTone()`, `UiLivingSentence.tsx`, `Orders.tsx`, `Slot()`, `UiLivingSentence()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 69`** (7 nodes): `duplicate_narration.test.ts`, `calls()`, `ctxFor()`, `handled()`, `minsAgo()`, `model()`, `seed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 78`** (6 nodes): `DirLabel()`, `go()`, `onDown()`, `onKey()`, `opt()`, `NewTxnFab.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 87`** (5 nodes): `fmtDate()`, `prefetchTxn()`, `txnPeekFn()`, `txnPeekKey()`, `TransactionPeek.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 93`** (5 nodes): `FinancialsCashflow()`, `fmt()`, `lastNMonths()`, `monthLabel()`, `FinancialsCashflow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 101`** (4 nodes): `handleClose()`, `handleSubmit()`, `updateRow()`, `QuoteEntryDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 103`** (4 nodes): `bloom()`, `Btn()`, `REDUCED()`, `Btn.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 110`** (4 nodes): `evaluate.test.ts`, `blockworkDoneGround()`, `concealedByPlaster()`, `unit()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 130`** (3 nodes): `downloadGRNChallan()`, `fmtDate()`, `grnChallan.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 131`** (3 nodes): `poGateState()`, `poIsPriced()`, `poLifecycle.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 133`** (3 nodes): `insertionIndex()`, `withNewTask()`, `add.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 136`** (3 nodes): `placeOf()`, `stageOfFloorless()`, `stages.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `parseAmount()` connect `Community 9` to `Community 8`, `Community 20`, `Community 12`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **Why does `materializeProjectTasksUncached()` connect `Community 1` to `Community 0`, `Community 5`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Why does `normalizeTxn()` connect `Community 8` to `Community 10`, `Community 11`, `Community 4`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Are the 41 inferred relationships involving `send()` (e.g. with `processJob()` and `resurfacePending()`) actually correct?**
  _`send()` has 41 INFERRED edges - model-reasoned connections that need verification._
- **Are the 29 inferred relationships involving `dispatch()` (e.g. with `processJob()` and `send()`) actually correct?**
  _`dispatch()` has 29 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `answerSiteops()` (e.g. with `closeConversation()` and `sendNowDurable()`) actually correct?**
  _`answerSiteops()` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 18 inferred relationships involving `runSiteops()` (e.g. with `getOpenBatch()` and `resolveProject()`) actually correct?**
  _`runSiteops()` has 18 INFERRED edges - model-reasoned connections that need verification._