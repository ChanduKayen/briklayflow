// Aggregator — import every *.test module (they register via the harness) then run.
import './library.test'
import './instantiate.test'
import './evaluate.test'
import './classify.test'
import './persist.test'
import './viewModel.test'
import { runAll } from './harness'

await runAll()
