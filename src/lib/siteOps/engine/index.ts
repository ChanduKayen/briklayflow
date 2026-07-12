// SiteOps constraint engine — public barrel. Import from here, not the individual modules.
// Framework-free (no React, no Supabase types leak): runs in Node tests and Deno edge functions.
export * from './types'
export {
  LIBRARY, buildLibrary, validateLibrary, taskType, isHardNature,
} from './library'
export {
  instantiate, stackToGeometry, buildAdjacency, emptyState, CycleError,
} from './instantiate'
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
