// Aggregator — import every *.test module (they register via the harness) then run.
import './extract.characterization.test';
import './candidates.test';
import './assoc.test';
import { runAll } from './harness';

await runAll();
