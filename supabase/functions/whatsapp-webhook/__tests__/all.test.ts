// Aggregator — import every *.test module (they register via the harness) then run.
import './extract.characterization.test';
import './candidates.test';
import './assoc.test';
import './attach.test';
import './reanalyze.test';
import './message_map.test';
import './correct.test';
import './verbs.test';
import { runAll } from './harness';

await runAll();
