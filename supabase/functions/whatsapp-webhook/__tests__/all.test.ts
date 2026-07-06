// Aggregator — import every *.test module (they register via the harness) then run.
import './check_enforcement.test';
import './extract.characterization.test';
import './candidates.test';
import './assoc.test';
import './attach.test';
import './reanalyze.test';
import './message_map.test';
import './correct.test';
import './verbs.test';
import './lateanswer.test';
import './batch_reply.test';
import './batch_journey.test';
import './resolution.test';
import './resolution_llm.test';
import './resolution_executor.test';
import './resolution_undo.test';
import './adoption.test';
import './singular_unit.test';
import './image_batch.test';
import './guardrail.test';
import './convo_sweep.test';
import { runAll } from './harness';

await runAll();
