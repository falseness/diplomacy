'use strict';
// One bounded historical criterion integration. This does not launch providers
// or authorize the separately prerequisite-gated full TASK-225 audit.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const G=require('./evidence_terminal_gate'),T=require('./evidence_terminal_selection'),F=require('./review_terminal_outcomes'),S=require('./evidence_selection');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const out=path.resolve(process.argv[2]),start=Date.now(),stop=start+3300000;assert(!fs.existsSync(out),'fresh output required');fs.mkdirSync(out,{recursive:true});process.env.EVIDENCE_AUDIT_DEADLINE_MS=String(stop);
const save=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2)+'\n'),log=s=>{console.log(s);fs.appendFileSync(path.join(out,'verification.log'),s+'\n');};
for(let g=G;g;g=g.previous)g.onPhase=log;
const commands=[],controls=[];let pass=false;
const cases=['terminal-independent-outcomes','terminal-consumer-controls','identical-proof-whole-criterion-transition','immutable-hash-and-staging-audit'];
save('verification-plan.json',{fullInvocation:false,estimateMs:1800000,stopWorkMs:3300000,budgetMs:3600000,cases,tiers:['source-executed independent reader of archived browser/network/source observations'],exclusions:['no provider refresh','no native-phase replay','no full evidence-audit: prerequisites open','no current-source credit'],commands:['node20 --test ops/test_terminal_outcomes.js','evidence_terminal_selection.preflight with eight corruption controls','A.inventory with historical selection through evidence_terminal_gate; identical-proof before/after H.consume','git diff --check in both repositories','final hash, assertion, required-artifact and staging audit']});
const tasks=A.read(path.join(A.client,'artifacts/tasks.json')),research=A.read(path.join(A.client,'artifacts/TASK-225/review-114/research-input.json'));
const tools=['review_terminal_outcomes.js','evidence_terminal_selection.js','evidence_terminal_gate.js','test_terminal_outcomes.js','run_terminal_review.js','supervise_terminal_review.py','launch_terminal_review.py'];
const frozen=Object.fromEntries(tools.map(n=>[n,A.hash(path.join(__dirname,n))]));save('frozen-tools.json',frozen);
function command(cwd,argv){assert(Date.now()<stop,'deadline');log('COMMAND '+JSON.stringify(argv)+' CWD='+cwd+' NODE='+process.version+' NODE_PATH='+process.env.NODE_PATH);const r=spawnSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',timeout:Math.max(1,stop-Date.now()),maxBuffer:16*1024*1024});log(r.stdout||'');log(r.stderr||'');log('ACTUAL_EXIT='+r.status+' SIGNAL='+r.signal);commands.push({argv,cwd,actualExit:r.status,signal:r.signal});assert.equal(r.status,0);return r.stdout;}
try{
 command(A.client,[process.execPath,'--test','ops/test_terminal_outcomes.js']);
 const original=path.join(A.client,'artifacts/TASK-221/green-12');
 const input=T.prepare(tasks,original,path.join(out,'projection'));
 save('historical-selection.json',input);save('original-hashes.json',input.terminalSelection.originalFiles);
 const ready=T.preflight(tasks,input);save('checkpoints.json',ready.report);save('source-identities.json',{scope:'historical provider sources; reader identities in frozen-tools.json',provider:A.read(path.join(original,'source-identities.json')),currentDifferences:ready.run.sourceDifferences});
 assert.equal(ready.run.currentSourceValid,false);assert.equal(ready.run.sourceDifferences.length,12);save('provider-inspection.json',ready.run);
 log('PASS terminal-reader assertions='+ready.report.checks.length+' sourceDifferences=12 currentSourceValid=false');
 const control=(id,fn,pattern)=>{assert.throws(fn,pattern,id);controls.push({id,pass:true,expected:'rejection',observed:'rejection',pattern:String(pattern)});log('PASS consumer-reject '+id);};
 for(const [id,mutate,pattern] of [
  ['wrong-owner',v=>{v.terminalSelection.criteria=[2];},/wrong-terminal-owner/],
  ['changed-baseline',v=>{v.terminalSelection.baseline.sha256='0'.repeat(64);},/wrong-terminal-baseline/],
  ['changed-tool',v=>{v.terminalSelection.toolHashes['review_terminal_outcomes.js']='0'.repeat(64);},/changed-terminal-tools/],
  ['changed-assertion',v=>{v.reviews.find(r=>r.id==='TASK-221/AC1').clauses[0].assertions[0].expected='wrong';},/wrong-terminal-row/],
  ['omitted-nontarget',v=>{v.reviews=v.reviews.filter(r=>r.id!=='TASK-211/AC1');},/omitted-or-changed-terminal-retained-row/],
  ['changed-self-owner',v=>{v.reviews.find(r=>r.id==='TASK-225/AC1').clauses[0].checkpointIds.pop();},/changed-current-self-row/]
 ]){const v=structuredClone(input);mutate(v);control(id,()=>T.preflight(tasks,v),pattern);}
 const proof=path.join(input.terminalSelection.selected,'terminal-independent-review.json'),bytes=fs.readFileSync(proof);
 try{fs.appendFileSync(proof,' ');control('tampered-selected-proof',()=>T.preflight(tasks,input),/hash/);}finally{fs.writeFileSync(proof,bytes);}
 try{fs.renameSync(proof,proof+'.held');control('missing-selected-proof',()=>T.preflight(tasks,input),/ENOENT/);}finally{fs.renameSync(proof+'.held',proof);}
 save('negative-control-results.json',{fullInvocation:false,sourceTests:15,readerCorruptionControls:14,consumerControls:controls,passScoped:true});
 log('COMMAND A.inventory(tasks,research,historical-selection.json) via evidence_terminal_gate CWD='+A.client);
 const result=A.inventory(tasks,research,input),last=G.last;save('before-consumer.json',last.before);save('after-consumer.json',result);save('historical-transitions.json',last.transitions);save('cache-metrics.json',last.cacheMetrics);
 assert.deepEqual(last.transitions,[{id:'TASK-221/AC1',before:63,after:63,status:'reviewed-historical'}]);
 assert.equal(result.criteria.filter(r=>r.status==='covered-current').length,74);assert.equal(result.selfChecks.length,8);
 for(const n of [1,2,3,6,7])assert.equal(result.criteria.find(r=>r.id==='TASK-220/AC'+n).status,'reviewed-historical');
 log('PASS real-consumer TASK-221/AC1 unresolved-local->reviewed-historical requiredPrior=63->63 current=74 selfOwners=8 sequenceHistorical=5');
 const report=A.read(path.join(out,'checkpoints.json'));for(const c of report.checks)assert.deepEqual(c.observed,c.expected,'serialized-checkpoint:'+c.id);
 for(const [n,h] of Object.entries(input.terminalSelection.originalFiles))assert.equal(A.hash(path.join(original,n)),h,'original-proof:'+n);
 for(const [n,h] of Object.entries(A.read(path.join(input.terminalSelection.selected,'evidence-hashes.json'))))A.proofKey(input.terminalSelection.selected,n,{[n]:h});
 for(const [n,h] of Object.entries(report.proofs))assert.equal(A.hash(path.isAbsolute(n)?n:path.join(original,n)),h,'review-proof:'+n);
 for(const [n,h] of Object.entries(frozen))assert.equal(A.hash(path.join(__dirname,n)),h,'frozen-tool:'+n);
 for(const [name,cwd] of [['client',A.client],['server',A.root]]){command(cwd,['git','diff','--check']);const staged=command(cwd,['git','diff','--cached','--name-only','--','artifacts']);fs.writeFileSync(path.join(out,name+'-staged-artifacts.txt'),staged);assert.equal(staged,'','staged-artifacts');}
 save('coverage-results.json',{fullInvocation:false,overallPass:false,passScoped:true,cases:cases.map(id=>({id,pass:true,proof:id.includes('controls')?'negative-control-results.json':id.includes('transition')?'historical-transitions.json':id.includes('outcomes')?'checkpoints.json':'verification.log'})),currentCreditAdded:0,requiredPrior:63,currentCriteria:74,selfOwners:8,unresolved:'63 required prior current obligations; full invocation absent; AC2..8 terminal review remains',incompleteTaskSteps:[3,4,5,7]});
 log('PASS scoped-hash-audit originalFiles='+Object.keys(input.terminalSelection.originalFiles).length+' assertions='+report.checks.length+' frozenTools='+tools.length+' cleanup=true');pass=true;
}catch(e){log(e.stack);process.exitCode=1;}
finally{
 save('verification-budget.json',{fullInvocation:false,overallPass:false,passScoped:pass&&Date.now()<stop,startedMs:start,finishedMs:Date.now(),elapsedMs:Date.now()-start,commands,cleanup:true,cleanupReason:'No services/browser launched; synchronous child tests remove owned temporary directories in finally.'});
 const required=['coverage-audit.json','negative-control-results.json','verification.log','checkpoints.json','source-identities.json','verification-budget.json','verification-plan.json','coverage-results.json'];
 save('required-artifact-audit.json',{fullInvocation:false,overallPass:false,artifacts:required.map(n=>({path:path.join(out,n),exists:fs.existsSync(path.join(out,n)),fullCriterionPass:false,reason:n==='coverage-audit.json'?'MISSING: prerequisite-gated full invocation not executed':'Scoped historical review only; cannot satisfy complete current invocation'}))});
 if(!pass||Date.now()>=stop)process.exitCode=1;log('PLANNED_RUNNER_EXIT='+(process.exitCode||0));
}
