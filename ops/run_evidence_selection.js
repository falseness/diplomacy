'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
require('./evidence_selection_preload');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit'),S=require('./evidence_selection');
const out=path.resolve(process.argv[2]),start=Date.now(),deadline=start+3300000;
assert(!fs.existsSync(out),'fresh directory required');fs.mkdirSync(out,{recursive:true});
const save=(n,x)=>fs.writeFileSync(path.join(out,n),JSON.stringify(x,null,2)+'\n');
const log=s=>{console.log(s);fs.appendFileSync(path.join(out,'verification.log'),s+'\n');};
const commands=[],checks=[],controls=[];
const check=(id,expected,observed)=>{assert.deepEqual(observed,expected,id);checks.push({id,expected,observed,pass:true});log('PASS '+id);};
const run=(cwd,args)=>{log('COMMAND '+JSON.stringify(args)+' CWD='+cwd);const r=spawnSync(args[0],args.slice(1),{cwd,encoding:'utf8',timeout:Math.max(1,deadline-Date.now()),maxBuffer:32*1024*1024});log((r.stdout||'')+(r.stderr||''));log('ACTUAL_EXIT='+r.status);commands.push({cwd,args,actualExit:r.status,signal:r.signal});assert.equal(r.status,0);};
save('verification-plan.json',{fullInvocation:false,estimateMs:1200000,budgetMs:3600000,stopWorkMs:3300000,
 cases:['frozen-reference-bindings','fresh-inventory-equivalence','actual-gate-inventory-boundary','deleted-proof','tampered-proof','wrong-owner','wrong-release','omitted-retained-row','wrong-annex'],
 tiers:['production-source consumer','retained browser/network proof; no new browser claims'],commands:['node ops/run_evidence_selection.js <fresh>','git diff --check (both repositories)'],exclusions:['full gate prerequisite-gated by unresolved local proof','no provider refresh or services']});
let pass=false;
try{
 log('COMMAND '+JSON.stringify([process.execPath,...process.argv.slice(1)])+' CWD='+process.cwd()+' NODE='+process.version);
 const tasks=A.read(path.join(A.client,'artifacts/tasks.json')),research=A.read(path.join(S.BASE,'research-input.json'));
 save('task-input.json',tasks);save('research-input.json',research);
 const input=S.selection(tasks,research);save('reviewed-crosswalk.json',input);
 const {report,phases,metrics}=S.inventory(tasks,research,input,{deadline,onPhase:log});
 save('phase-times.json',{phases,metrics});save('current-inventory.json',report);
 const reference=A.read(path.join(S.BASE,'current-inventory.json'));
 check('exact-disposition-equivalence',reference,report);
 check('required-prior-targets',133,report.unresolvedPriorArchives.length);
 check('self-checks',8,report.selfChecks.length);
 check('retained-AC1-AC2-AC3-AC7',['covered-current','covered-current','covered-current','covered-current'],[1,2,3,7].map(n=>report.criteria.find(r=>r.id==='TASK-211/AC'+n).status));
 // Exercise the exact export called by evidence-audit-gate, including controls.
 for(const [id,mutate,pattern] of [
  ['deleted-proof',s=>fs.unlinkSync(path.join(s.prepared,'selected-211/persistence-checkpoints.json')),/ENOENT/],
  ['tampered-proof',s=>fs.appendFileSync(path.join(s.prepared,'selected-211/asset-events.jsonl'),'{}\n'),/evidence-hash-mismatch/],
  ['wrong-owner',(s,x)=>{x.reviews.find(r=>r.id==='TASK-211/AC7').clauses[0].runTask='TASK-212';},/omitted-or-changed-retained-row/],
  ['wrong-release',s=>{s.provider.coverageSha256='0'.repeat(64);},/wrong-selection-provider/],
  ['omitted-retained-row',(s,x)=>{x.reviews=x.reviews.filter(r=>r.id!=='TASK-211/AC3');},/omitted-or-changed-retained-row/],
  ['wrong-annex',s=>{s.annex.providers[0].id='TASK-999';},/wrong-selection-annex/]
 ]){
  assert(Date.now()<deadline,'cumulative deadline');const copy=path.join(out,'control-'+id);fs.cpSync(input.evidenceSelection.prepared,copy,{recursive:true});
  const x=structuredClone(input);x.evidenceSelection.prepared=copy;mutate(x.evidenceSelection,x);
  const began=Date.now();let reason;try{A.inventory(tasks,research,x);}catch(e){reason=e.message;}
  assert(reason&&pattern.test(reason),id+': '+reason);controls.push({id,pass:true,reason:reason.split('\n')[0],elapsedMs:Date.now()-began});log('PASS rejects '+id+' '+reason.split('\n')[0]);
 }
 // Positive through the same gate boundary, with a fresh transaction (no cache survives).
 const began=Date.now();check('actual-gate-inventory-boundary',report,A.inventory(tasks,research,input));
 save('boundary-time.json',{elapsedMs:Date.now()-began});
 for(const cwd of [A.client,A.root])run(cwd,['git','diff','--check']);
 save('source-identities.json',A.read(path.join(input.evidenceSelection.prepared,'selected-211/source-identities.json')));
 save('negative-control-results.json',{controls});save('checkpoints.json',{checks});
 save('coverage-results.json',{fullInvocation:false,passScoped:true,requiredPrior:133,semanticReviewsAdded:0,
  cases:checks.map(c=>({id:c.id,pass:c.pass,proof:'checkpoints.json'})),toolHashes:Object.fromEntries(['evidence_selection.js','evidence_selection_preload.js','run_evidence_selection.js'].map(n=>['ops/'+n,A.hash(path.join(__dirname,n))]))});
 log('PASS selection equivalence requiredPrior=133 retainedAC1/2/3/7=covered-current selfChecks=8 controls=6');
 log('INCOMPLETE TASK-225: full invocation prerequisite-gated; equivalence adds no coverage');pass=true;
}catch(e){log(e.stack);process.exitCode=1;}
finally{save('verification-budget.json',{fullInvocation:false,startedMs:start,finishedMs:Date.now(),elapsedMs:Date.now()-start,passScoped:pass&&Date.now()<deadline,cleanup:true,commands});if(!pass||Date.now()>=deadline)process.exitCode=1;log('PARENT_ACTUAL_EXIT='+(process.exitCode||0));}
