// SiteOps constraint engine — public barrel. Import from here, not the individual modules.
// Framework-free (no React, no Supabase types leak): runs in Node tests and Deno edge functions.
export * from './types'
export {
  LIBRARY, buildLibrary, validateLibrary, taskType, isHardNature, saidAsOf,
} from './library'
export { BRIEFS, briefOf, type Brief as AuthoredBrief } from './briefs'
export {
  instantiate, stackToGeometry, buildAdjacency, emptyState, CycleError,
} from './instantiate'
// THE identity (one node_key, every reader) and THE project door (one geometry, every caller).
export { nodeKey, nodeKeyOf, unitKeyOf, zoneIdOf } from './identity'
export { stageOfFloorless, placeOf, STAGE_LABEL, FOUNDATION_TYPES, type StageKey } from './stages'
export { geometryOf, geometryOptionsOf, loadProjectRow, GEOMETRY_COLUMNS, type ProjectRow, type LoadedProject } from './project'
export {
  Evaluator, evaluate, stateOf,
} from './evaluate'
export {
  classifyUserTask, validateClassification, buildClassifierPrompt, slugifyTaskId,
  type ClassifyContext, type ClassifierLLM, type ClassifierLLMOutput, type ClassifiedTask,
} from './classify'
export {
  reconcile, toPersistRows, persistGraph, fanOutQc,
  type ExistingRow, type PersistRow, type ReconcilePlan, type WriteResult,
} from './persist'
export {
  buildProjectVM, type BuildVMOptions,
} from './viewModel'
