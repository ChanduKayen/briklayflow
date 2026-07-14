// Aggregator — import every Site Desk suite here, then run.
import './add.test'
import './delete.test'
import './gates.test'
import './move.test'
import './derive.test'
import './edit.test'
import './fromDb.test'
import './planRules.test'
import { runAll } from './harness'

await runAll()
