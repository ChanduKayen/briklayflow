// Aggregator — import every *.test module (they register via the harness) then run.
import './library.test'
import './instantiate.test'
import './evaluate.test'
import './classify.test'
import './persist.test'
import './viewModel.test'
import './one_door.test';
import './plan_truth.test';
import './stages.test';
import './binding_refresh.test';
import './identity.test'
import { runAll } from './harness'

await runAll()
