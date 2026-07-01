// Aggregator — import every *.test module (they register via the harness) then run.
import './extract.characterization.test';
import { runAll } from './harness';

await runAll();
