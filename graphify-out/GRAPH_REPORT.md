# Graph Report - Briklay Fly  (2026-08-27)

## Corpus Check
- 666 files · ~1,270,652 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2841 nodes · 4406 edges · 69 communities detected
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 594 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 97|Community 97]]
- [[_COMMUNITY_Community 100|Community 100]]
- [[_COMMUNITY_Community 106|Community 106]]
- [[_COMMUNITY_Community 111|Community 111]]
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
Cohesion: 0.03
Nodes (133): composeLLM(), fallbackReply(), isGreeting(), runConcierge(), systemFor(), userContent(), commitInterruptedProc(), answerSiteops() (+125 more)

### Community 1 - "Community 1"
Cohesion: 0.01
Nodes (40): baseSeed(), twoAskSeed(), ask(), ctxFor(), model(), ctxFor(), imgCtx(), tQItem() (+32 more)

### Community 2 - "Community 2"
Cohesion: 0.02
Nodes (131): bindingKey(), graphIsMaterialized(), materializeProjectTasksUncached(), placeOfTask(), gatesByTask(), gatesFromBinding(), safeGeometry(), safeInstantiate() (+123 more)

### Community 3 - "Community 3"
Cohesion: 0.03
Nodes (51): classifyPhotoFollowup(), buildComponents(), buildTemplateMessage(), sendTemplate(), line(), promptFor(), withTask(), cadenceFor() (+43 more)

### Community 4 - "Community 4"
Cohesion: 0.04
Nodes (73): isStopWord(), addCustomBrand(), brandsFor(), getCustomBrands(), LS_KEY(), buildConflictPills(), buildNovelVariantPills(), buildPills() (+65 more)

### Community 5 - "Community 5"
Cohesion: 0.03
Nodes (52): call(), issue(), prog(), seed(), task(), src(), stripComments(), classifyWithLLM() (+44 more)

### Community 6 - "Community 6"
Cohesion: 0.04
Nodes (71): commitEdit(), handleSave(), imageDeterministic(), parseDigitToken(), parseSpokenAmount(), callClaude(), callOpenAI(), classifyImage() (+63 more)

### Community 7 - "Community 7"
Cohesion: 0.05
Nodes (83): answerProcurement(), finalizeDirectVendor(), flowIdFor(), handleSingle(), loadApprover(), loadProjects(), loadVendors(), markReadyForApproval() (+75 more)

### Community 8 - "Community 8"
Cohesion: 0.05
Nodes (59): answerPaymentTotal(), answerReporting(), groupBySite(), loadProjects(), loadStakeholders(), num(), orderRows(), pickFrom() (+51 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (33): readStoredSession(), useAuth(), useCan(), useOrgId(), classifyRefreshError(), extractErrorCode(), parseStoredSession(), PeekLink() (+25 more)

### Community 10 - "Community 10"
Cohesion: 0.04
Nodes (39): handler(), close(), go(), handleClose(), handleOpen(), toggle(), close(), handleSave() (+31 more)

### Community 11 - "Community 11"
Cohesion: 0.04
Nodes (28): handleSave(), suggestCostCode(), costCodeLabel(), getCostCode(), classifyExpenseHead(), openDoc(), resolveDocUrl(), deriveDirection() (+20 more)

### Community 12 - "Community 12"
Cohesion: 0.06
Nodes (37): allocIdOf(), assertLinkable(), attachToContract(), createContract(), fallbackTitle(), fileAsLabour(), generateContractTitle(), getTrackingOptions() (+29 more)

### Community 13 - "Community 13"
Cohesion: 0.06
Nodes (37): useDeskApi(), useMockDeskApi(), ago(), assignReasonOf(), bucketRef(), buildChase(), buildStory(), buildTaskStory() (+29 more)

### Community 14 - "Community 14"
Cohesion: 0.05
Nodes (28): amountInWords(), amountText(), dataPair(), drawFooter(), drawHeader(), drawLogoMark(), drawRule(), drawSignatures() (+20 more)

### Community 15 - "Community 15"
Cohesion: 0.05
Nodes (28): patchProblem(), toggleSnag(), patchProblem(), toggleSnag(), appendEvent(), legacyToFollowupType(), notifyAssignment(), trailKey() (+20 more)

### Community 16 - "Community 16"
Cohesion: 0.06
Nodes (34): applyAll(), imgCtx(), runTurn(), seed(), task(), checkExprAt(), findMigrationsDir(), loadEnumChecks() (+26 more)

### Community 17 - "Community 17"
Cohesion: 0.07
Nodes (31): daysLeft(), digits(), doEnable(), intlPhone(), local10(), onToggle(), prettyPhone(), roleLabel() (+23 more)

### Community 19 - "Community 19"
Cohesion: 0.08
Nodes (21): payeeSimilarityScore(), bandedMatch(), canonRole(), isKnownTrade(), levenshtein(), matchPayee(), nameTokenScore(), rankPayeeName() (+13 more)

### Community 20 - "Community 20"
Cohesion: 0.09
Nodes (26): file(), keepTyping(), sendTypingIndicator(), constantTimeEqual(), guessLang(), handleProspect(), processJob(), recordInbound() (+18 more)

### Community 21 - "Community 21"
Cohesion: 0.1
Nodes (16): byTypeFor(), commitMove(), goTo(), loop(), measure(), moveTo(), nearestTo(), onLeave() (+8 more)

### Community 22 - "Community 22"
Cohesion: 0.13
Nodes (15): clearAllFilters(), derive(), fmtShortDate(), inr(), isOverdue(), milestoneState(), poFullyReceived(), poHasBill() (+7 more)

### Community 23 - "Community 23"
Cohesion: 0.08
Nodes (3): taskStatus(), upNextRefs(), statusOf()

### Community 24 - "Community 24"
Cohesion: 0.14
Nodes (20): buildClassifierPrompt(), clamp01(), classifyUserTask(), dedupe(), gatewayAnchor(), introducesCycle(), resolveFreedomSet(), sanitizeScope() (+12 more)

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

### Community 41 - "Community 41"
Cohesion: 0.29
Nodes (7): bandRange(), buildRationale(), draftStages(), extractMeasured(), normalizeWeights(), templateKeyForTrade(), titleCase()

### Community 42 - "Community 42"
Cohesion: 0.31
Nodes (6): confirmSpawn(), invalidate(), invalidateObjects(), onPickFile(), post(), quickAction()

### Community 45 - "Community 45"
Cohesion: 0.25
Nodes (2): advanceFromName(), tick()

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
Nodes (3): handleSendOtp(), handleVerifyOtp(), toE164()

### Community 52 - "Community 52"
Cohesion: 0.32
Nodes (5): autoSet(), isOn(), ruleHints(), toggle(), A()

### Community 53 - "Community 53"
Cohesion: 0.29
Nodes (2): dismiss(), invalidateEntries()

### Community 55 - "Community 55"
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

### Community 72 - "Community 72"
Cohesion: 0.53
Nodes (4): importPO(), importTxn(), importWO(), preloadPeekChunks()

### Community 81 - "Community 81"
Cohesion: 0.5
Nodes (2): prefetchTxn(), txnPeekKey()

### Community 84 - "Community 84"
Cohesion: 0.6
Nodes (3): classificationsByName(), norm(), snapClassification()

### Community 86 - "Community 86"
Cohesion: 0.7
Nodes (4): nodeKey(), nodeKeyOf(), unitKeyOf(), zoneIdOf()

### Community 87 - "Community 87"
Cohesion: 0.5
Nodes (2): FinancialsCashflow(), lastNMonths()

### Community 97 - "Community 97"
Cohesion: 0.67
Nodes (2): handleClose(), handleSubmit()

### Community 100 - "Community 100"
Cohesion: 0.67
Nodes (2): bloom(), REDUCED()

### Community 106 - "Community 106"
Cohesion: 0.67
Nodes (2): concealedByPlaster(), unit()

### Community 111 - "Community 111"
Cohesion: 0.67
Nodes (2): defined(), stripComments()

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
- **Thin community `Community 45`** (9 nodes): `advanceFromName()`, `choose()`, `onRowClick()`, `pickExisting()`, `settle()`, `tick()`, `toMatch()`, `undo()`, `ResolveRow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (9 nodes): `confirmation.test.ts`, `bodyOf()`, `ctaOf()`, `failed()`, `ok()`, `tCreated()`, `tMiss()`, `tUpdated()`, `upd()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (9 nodes): `singular_unit.test.ts`, `cm()`, `ctxFor()`, `DEC()`, `DEC_EMPTY()`, `decomposeCalls()`, `resolutionCalls()`, `seed()`, `unitModel()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (8 nodes): `away()`, `ProblemRow()`, `useIsDesktop()`, `useIsTouch()`, `useRowClose()`, `useSwipe()`, `Problems.tsx`, `useDesk.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (8 nodes): `byRecent()`, `dismiss()`, `handleFiled()`, `handleRejected()`, `invalidateEntries()`, `restore()`, `viewTxn()`, `Logbook.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (8 nodes): `held_project_fold.test.ts`, `convoOf()`, `ctxFor()`, `it()`, `model()`, `projectSlots()`, `R_CREATE()`, `seed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (7 nodes): `duplicate_narration.test.ts`, `calls()`, `ctxFor()`, `handled()`, `minsAgo()`, `model()`, `seed()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 81`** (5 nodes): `fmtDate()`, `prefetchTxn()`, `txnPeekFn()`, `txnPeekKey()`, `TransactionPeek.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 87`** (5 nodes): `FinancialsCashflow()`, `fmt()`, `lastNMonths()`, `monthLabel()`, `FinancialsCashflow.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 97`** (4 nodes): `handleClose()`, `handleSubmit()`, `updateRow()`, `QuoteEntryDrawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 100`** (4 nodes): `bloom()`, `Btn()`, `REDUCED()`, `Btn.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 106`** (4 nodes): `evaluate.test.ts`, `blockworkDoneGround()`, `concealedByPlaster()`, `unit()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 111`** (4 nodes): `pending_credibility.test.ts`, `defined()`, `raw()`, `stripComments()`
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

- **Why does `parseAmount()` connect `Community 8` to `Community 9`, `Community 6`?**
  _High betweenness centrality (0.119) - this node is a cross-community bridge._
- **Why does `NewInvoice()` connect `Community 9` to `Community 8`, `Community 6`?**
  _High betweenness centrality (0.119) - this node is a cross-community bridge._
- **Why does `materializeProjectTasksUncached()` connect `Community 2` to `Community 0`?**
  _High betweenness centrality (0.073) - this node is a cross-community bridge._
- **Are the 41 inferred relationships involving `send()` (e.g. with `processJob()` and `resurfacePending()`) actually correct?**
  _`send()` has 41 INFERRED edges - model-reasoned connections that need verification._
- **Are the 29 inferred relationships involving `dispatch()` (e.g. with `processJob()` and `send()`) actually correct?**
  _`dispatch()` has 29 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `answerSiteops()` (e.g. with `closeConversation()` and `sendNowDurable()`) actually correct?**
  _`answerSiteops()` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Are the 18 inferred relationships involving `runSiteops()` (e.g. with `getOpenBatch()` and `resolveProject()`) actually correct?**
  _`runSiteops()` has 18 INFERRED edges - model-reasoned connections that need verification._