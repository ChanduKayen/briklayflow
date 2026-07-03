// Aggregator — import every *.test module (they register via the harness) then run.
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
import { runAll } from './harness';

await runAll();
