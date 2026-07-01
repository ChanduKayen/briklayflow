// Aggregator — import every *.test module (they register via the harness) then run.
import './refreshPolicy.test';
import { runAll } from './harness';

await runAll();
