// Aggregator — import every src/lib suite here, then run.
import './payeeSearch.test'
import './partyLedger.test'
import { runAll } from './harness'

await runAll()
