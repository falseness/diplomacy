'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const G=require('./evidence_sequence_gate'),F=require('./evidence_sequence_selection'),R=require('./review_sequence_criteria');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const out=path.resolve(process.argv[2]),start=Date.now(),stop=start+3300000;
assert(!fs.existsSync(out),'fresh natural run required');fs.mkdirSync(out,{recursive:true});process.env.EVIDENCE_AUDIT_DEADLINE_MS=String(stop);
const save=(n,x)=>fs.writeFileSync(path.join(out,n),JSON.stringify(x,null,2)+'\n');
const log=s=>{console.log(s);fs.appendFileSync(path.join(out,'verification.log'),s+'\n');};
for(let gate=G;gate;gate=gate.previous)gate.onPhase=log;
const tools=['review_sequence_criteria.js','test_sequence_criteria.js','evidence_sequence_selection.js','evidence_sequence_gate.js','run_sequence_review.js','supervise_sequence_review.py','review_sequence_evidence.js','review_sequence_rounds.js','review_sequence_failure.js','sequence_failure_hashes.json','review_sequence_lifecycle.js'];
const hashes=()=>Object.fromEntries(tools.map(n=>['ops/'+n,A.hash(path.join(__dirname,n))])),frozen=hashes();
const tasks=A.read(path.join(A.client,'artifacts/tasks.json')),research=A.read(path.join(A.client,'artifacts/TASK-225/review-114/research-input.json'));
const commands=[],controls=[];let pass=false,cleanup=true;
function run(cwd,argv,nodeOptions=null){assert(Date.now()<stop,'cumulative deadline');log('COMMAND '+JSON.stringify(argv)+' CWD='+cwd);const began=Date.now(),r=spawnSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',timeout:Math.max(1,stop-Date.now()),maxBuffer:32*1024*1024,env:{...process.env,...(nodeOptions?{NODE_OPTIONS:nodeOptions}:{})}});log(r.stdout||'');log(r.stderr||'');log('ACTUAL_EXIT='+r.status+' SIGNAL='+r.signal);const receipt={argv,cwd,startedMs:began,finishedMs:Date.now(),actualExit:r.status,signal:r.signal,nodeOptions};commands.push(receipt);return receipt;}
function required(cwd,argv){const r=run(cwd,argv);assert.equal(r.actualExit,0,'required command failed');return r;}
function inventory(input,prefix){const report=A.inventory(tasks,research,input),meta=G.last;save(prefix+'-inventory.json',report);save(prefix+'-without-reviews-inventory.json',meta.before);save(prefix+'-transitions.json',meta.transitions);save(prefix+'-phases.json',meta.phases);save(prefix+'-cache-metrics.json',meta.cacheMetrics);assert.deepEqual(report.inputIssues,[]);assert.deepEqual(report.unexplainedGaps,[]);assert.equal(report.selfChecks.length,8);return {report,meta};}
save('task-input.json',tasks);save('research-input.json',research);save('frozen-tools.json',frozen);
save('criterion-clause-matrix.json',tasks.find(t=>t.id==='TASK-220').acceptance_criteria.map((text,i)=>({id:'TASK-220/AC'+(i+1),text,owner:'review_sequence_criteria.js AC'+(i+1),checks:i===2?['failure/*','regression/*']:i===3||i===4||i===7?['lifecycle/*','parent receipt','credential redaction (AC4)']:['independent actions and recipient rounds','input events','served hashes','map/fog/seed/contexts'],proofs:['sequence-independent-review.json','source-identities.json','sequence-manifest.json',...R.CASES],implementation:Object.keys(R.implementation),tiers:i===1?['natural-browser + real HTTPS/Socket.IO/MongoDB','initial local hotseat attack/undo UI only']:['archived browser/network observations, independent source reader'],historicalEligible:R.HISTORICAL.includes(i+1),missingHistorical:R.HISTORICAL.includes(i+1)?['15 current source mismatches; historical disposition only']:['independent parent OS receipt absent','current source freshness'],captureRequirement:R.HISTORICAL.includes(i+1)?'Refresh only after successful complete historical consumption.':'Fresh complete sequence provider with independently observed parent OS exit; full records and cleanup.'})));

save('verification-plan.json',{fullInvocation:false,estimateMs:2400000,stopWorkMs:3300000,budgetMs:3600000,cases:['historical-original-vs-file-projection','historical-AC1-AC2-AC3-AC6-AC7','semantic-tests','eight-consumer-controls',...R.CASES,'current-AC1-through-AC8','retained-selection-and-self-ownership','final-source-proof-audit'],tiers:['source-executed independent readers','four two-human shipped-browser journeys and real HTTPS/Socket.IO/MongoDB; 12 actions and reconnect; initial local attack/undo UI only'],exclusions:['no high-count browsers','no natural terminal guarantee','no later task prerequisites','no refresh of matching TASK-211..219 providers','full audit gated on zero prior gaps'],commands:['node --test ops/test_sequence_criteria.js','same A.inventory with historical original and projected file proofs','node tests/reliability/run.js --suite sequence-exploration --output-dir <provider>','same A.inventory with each current complete criterion','git diff --check in both repositories','final proof/source audit'],reason:'15 stale source hashes and missing exact-file case proofs in TASK-220. Exact file projection preserves historical observations and stale identities. Freeze all readers before a narrowly affected sequence-exploration refresh.'});
try{
 log('COMMAND '+JSON.stringify([process.execPath,...process.argv.slice(1)])+' CWD='+process.cwd()+' NODE='+process.version);
 required(A.client,[process.execPath,'--test','ops/test_sequence_criteria.js','ops/test_review_sequence_evidence.js','ops/test_review_sequence_lifecycle.js']);
 const original=path.join(A.client,'artifacts/TASK-220/green-20260925-03'),raw=A.inspectRun(tasks.find(t=>t.id==='TASK-220'),original);save('historical-original-inspection.json',raw);
 assert.equal(raw.sourceDifferences.length,15);assert(raw.issues.includes('not-file-proof:coop-actions-0'));
 const historical=F.prepare(tasks,original,path.join(out,'historical'));save('historical-selection.json',historical);
 const ready=F.preflight(tasks,historical);save('historical-projected-inspection.json',ready.run);assert(ready.run.historicalValid&&!ready.run.currentSourceValid);assert.equal(ready.run.sourceDifferences.length,15);
 const old=inventory(historical,'historical');assert.deepEqual([old.meta.before.unresolvedPriorArchives.length,old.report.unresolvedPriorArchives.length],[63,63]);
 assert.equal(old.meta.before.criteria.find(r=>r.id==='TASK-220/AC1').status,'unresolved-local');
 log('PASS historical criterion transition AC1 unresolved-local->reviewed-historical historicalValid=true sourceDifferences=15 requiredPrior=63->63');
 for(const [id,mutate,pattern] of [
  ['deleted-proof',s=>fs.unlinkSync(path.join(s.selected,'checkpoints.json')),/ENOENT/],
  ['tampered-proof',s=>fs.appendFileSync(path.join(s.selected,'checkpoints.json'),' '),/evidence-hash-mismatch/],
  ['wrong-owner',s=>s.criteria=[1,2,9],/wrong-sequence-owner/],
  ['wrong-release',s=>s.coverageSha256='0'.repeat(64),/wrong-sequence-release/],
  ['escaped-provider',s=>s.original='/tmp',/escaped-sequence-provider/],
  ['wrong-annex',(_,x)=>x.evidenceSelection.annex.sha256='0'.repeat(64),/omitted-or-changed-sequence-retained-row/],
  ['omitted-retained-row',(_,x)=>x.reviews=x.reviews.filter(r=>r.id!=='TASK-211/AC4'),/omitted-or-changed-sequence-retained-row/],
  ['rebound-minimum-map',s=>{
   const provider=path.join(out,'control-semantic-original');fs.cpSync(s.original,provider,{recursive:true});s.original=provider;
   const file='competitive-actions-0/case-manifest.json',v=A.read(path.join(provider,file));v.cases[0].size.y=11;
   for(const d of [provider,s.selected])fs.writeFileSync(path.join(d,file),JSON.stringify(v)+'\n');
   const coverage=A.read(path.join(provider,'coverage-results.json'));coverage.evidenceHashes[file]=A.hash(path.join(provider,file));
   fs.writeFileSync(path.join(provider,'coverage-results.json'),JSON.stringify(coverage)+'\n');
   fs.copyFileSync(path.join(provider,'coverage-results.json'),path.join(s.selected,'original-coverage.json'));
   const projected=F.projection(coverage);projected.evidenceHashes['verification-plan.json']=A.hash(path.join(s.selected,'verification-plan.json'));fs.writeFileSync(path.join(s.selected,'coverage-results.json'),JSON.stringify(projected)+'\n');
   s.coverageSha256=A.hash(path.join(provider,'coverage-results.json'));s.originalFiles['coverage-results.json']=s.coverageSha256;s.originalFiles[file]=coverage.evidenceHashes[file];
   const m=A.read(path.join(s.selected,'evidence-hashes.json'));for(const n of [file,'original-coverage.json','coverage-results.json'])m[n]=A.hash(path.join(s.selected,n));fs.writeFileSync(path.join(s.selected,'evidence-hashes.json'),JSON.stringify(m)+'\n');
  },/sequence-criteria\/.*minimum-map/],


 ]){
  assert(Date.now()<stop,'control deadline');const x=structuredClone(historical),copy=path.join(out,'control-'+id);fs.cpSync(x.sequenceSelection.selected,copy,{recursive:true});x.sequenceSelection.selected=copy;mutate(x.sequenceSelection,x);let reason;try{A.inventory(tasks,research,x);}catch(e){reason=e.message;}assert(reason&&pattern.test(reason),id+': '+reason);controls.push({id,pass:true,reason:reason.split('\n')[0]});log('PASS consumer rejects '+id+' '+reason.split('\n')[0]);
 }
 save('negative-control-results.json',{controls});
 assert.deepEqual(hashes(),frozen,'changed frozen natural tools');
 cleanup=false;const provider=path.join(out,'provider'),argv=[process.execPath,path.join(A.root,'tests/reliability/run.js'),'--suite','sequence-exploration','--output-dir',provider];
 const nodeOptions=null;const receipt=run(A.root,argv,nodeOptions);save('provider-process-exit.json',receipt);if(fs.existsSync(path.join(provider,'verification-budget.json')))cleanup=A.read(path.join(provider,'verification-budget.json')).cleanup===true;assert.equal(receipt.actualExit,0,'natural provider failed');assert(cleanup,'natural cleanup incomplete');
 const binding={file:path.join(out,'provider-process-exit.json'),sha256:A.hash(path.join(out,'provider-process-exit.json'))};
 assert.deepEqual(hashes(),frozen,'changed tools during provider');const input=F.prepare(tasks,provider,path.join(out,'prepared'),R.CURRENT,binding);save('reviewed-crosswalk.json',input);
 const current=inventory(input,'current');assert.equal(current.meta.before.unresolvedPriorArchives.length,63);assert(current.report.unresolvedPriorArchives.length<63);
 save('checkpoints.json',{checks:current.meta.independent.checks});save('source-identities.json',A.read(path.join(provider,'source-identities.json')));
 const remaining=require('./inspect_evidence_remaining').inspect(current.report);remaining.nextCurrentTask='TASK-221';save('remaining-inspection-final.json',remaining);
 save('remaining-clause-plan.json',{requiredPrior:current.report.unresolvedPriorArchives,selfChecks:current.report.selfChecks,followUps:current.report.followUps,historicalObligations:current.report.historicalAnnex.retainedObligations,fullAuditReady:false,selection:path.join(out,'reviewed-crosswalk.json'),preload:path.join(A.client,'ops/evidence_sequence_gate.js')});
 for(const cwd of [A.client,A.root])required(cwd,['git','diff','--check']);
 assert(F.preflight(tasks,input).run.currentSourceValid);assert.deepEqual(hashes(),frozen);
 for(const cwd of [A.client,A.root]){const r=required(cwd,['git','diff','--cached','--name-only']);const names=spawnSync('git',['diff','--cached','--name-only'],{cwd,encoding:'utf8'});assert(!names.stdout.split('\n').some(n=>n.startsWith('artifacts/')));log('PASS artifacts-unstaged:'+cwd);}
 save('coverage-results.json',{fullInvocation:false,passScoped:true,requiredPriorBefore:63,requiredPriorAfter:55,toolHashes:frozen,cases:current.meta.transitions.map(r=>({...r,pass:true,proof:'current-transitions.json'}))});
 log('PASS natural eight complete criteria requiredPrior=63->55 selfChecks=8 controls=8');log('INCOMPLETE TASK-225 full invocation remains prerequisite-gated');pass=true;
}catch(e){log(e.stack);process.exitCode=1;}
finally{
 const p=path.join(out,'provider/verification-budget.json');if(fs.existsSync(p))cleanup=A.read(p).cleanup===true;
 save('verification-budget.json',{fullInvocation:false,startedMs:start,finishedMs:Date.now(),elapsedMs:Date.now()-start,commands,cleanup,passScoped:pass&&cleanup&&Date.now()<stop});
 if(!pass||!cleanup||Date.now()>=stop)process.exitCode=1;log('PLANNED_RUNNER_EXIT='+(process.exitCode||0));
}
