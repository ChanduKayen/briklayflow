// Resolution path trace — dev-only debugging artefact attached to each line
// item so we can inspect how a SKU was resolved. Never shown to the user;
// the only consumer is logTrace() below (or a future devtools panel).

export type ResolutionStage =
  | 'regex'
  | 'alias_index'
  | 'token_match'
  | 'tree_walk'
  | 'ai'
  | 'db_re_search'
  | 'commit';

export interface ResolutionStep {
  stage:       ResolutionStage;
  input:       string;
  result:      string;
  confidence?: number;
  timestamp:   number;
}

export type ResolutionStatus =
  | 'auto_linked'
  | 'needs_input'
  | 'committed'
  | 'dismissed'
  | 'pending';

export interface ResolutionTrace {
  steps:        ResolutionStep[];
  finalStatus:  ResolutionStatus;
}

export function createTrace(): ResolutionTrace {
  return { steps: [], finalStatus: 'pending' };
}

export function addStep(trace: ResolutionTrace, step: Omit<ResolutionStep, 'timestamp'>): void {
  trace.steps.push({ ...step, timestamp: Date.now() });
}

export function setStatus(trace: ResolutionTrace, status: ResolutionStatus): void {
  trace.finalStatus = status;
}

export function logTrace(label: string, trace: ResolutionTrace): void {
  if (!import.meta.env.DEV || trace.steps.length === 0) return;
  // eslint-disable-next-line no-console
  console.group(`SKU Resolution: ${label}`);
  for (const s of trace.steps) {
    const conf = typeof s.confidence === 'number' ? ` (${Math.round(s.confidence * 100)}%)` : '';
    // eslint-disable-next-line no-console
    console.log(`[${s.stage}]${conf} ${s.input} → ${s.result}`);
  }
  // eslint-disable-next-line no-console
  console.log(`final: ${trace.finalStatus}`);
  // eslint-disable-next-line no-console
  console.groupEnd();
}
