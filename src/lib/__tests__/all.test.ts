// Aggregator — import every src/lib suite here, then run.
import './payeeSearch.test'
import './partyLedger.test'
import './projectSearch.test'
import './importParse.test'
import './importResolve.test'
import './importClassify.test'
import './importSheet.test'
import './importCommit.test'
import { runAll } from './harness'

await runAll()
