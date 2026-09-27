'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const G=require('./evidence_camera_gate'),F=require('./evidence_camera_selection'),R=require('./review_camera_evidence');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const out=path.resolve(process.argv[2]),start=Date.now(),stop=start+3300000;
assert(!fs.existsSync(out),'fresh camera run required');fs.mkdirSync(out,{recursive:true});process.env.EVIDENCE_AUDIT_DEADLINE_MS=String(stop);
const save=(n,x)=>fs.writeFileSync(path.join(out,n),JSON.stringify(x,null,2)+'\n');
const log=s=>{console.log(s);fs.appendFileSync(path.join(out,'verification.log'),s+'\n');};
for(let gate=G;gate;gate=gate.previous)gate.onPhase=log;
const tools=['review_camera_evidence.js','test_review_camera_evidence.js','evidence_camera_selection.js','evidence_camera_gate.js','run_camera_review.js','camera_wheel_observer.js'];
const hashes=()=>Object.fromEntries(tools.map(n=>['ops/'+n,A.hash(path.join(__dirname,n))])),frozen=hashes();
const tasks=A.read(path.join(A.client,'artifacts/tasks.json')),research=A.read(path.join(A.client,'artifacts/TASK-225/review-81/research-input.json'));
const commands=[],controls=[];let pass=false,cleanup=true;
function run(cwd,argv,nodeOptions=null){assert(Date.now()<stop,'cumulative deadline');log('COMMAND '+JSON.stringify(argv)+' CWD='+cwd);const began=Date.now(),r=spawnSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',timeout:Math.max(1,stop-Date.now()),maxBuffer:32*1024*1024,env:{...process.env,...(nodeOptions?{NODE_OPTIONS:nodeOptions}:{})}});log(r.stdout||'');log(r.stderr||'');log('ACTUAL_EXIT='+r.status+' SIGNAL='+r.signal);const receipt={argv,cwd,startedMs:began,finishedMs:Date.now(),actualExit:r.status,signal:r.signal,nodeOptions};commands.push(receipt);return receipt;}
function required(cwd,argv){const r=run(cwd,argv);assert.equal(r.actualExit,0,'required command failed');return r;}
function inventory(input,prefix){const report=A.inventory(tasks,research,input),meta=G.last;save(prefix+'-inventory.json',report);save(prefix+'-transitions.json',meta.transitions);save(prefix+'-phases.json',meta.phases);assert.deepEqual(report.inputIssues,[]);assert.deepEqual(report.unexplainedGaps,[]);assert.equal(report.selfChecks.length,8);return {report,meta};}
save('task-input.json',tasks);save('research-input.json',research);save('frozen-tools.json',frozen);
save('verification-plan.json',{fullInvocation:false,estimateMs:2100000,stopWorkMs:3300000,budgetMs:3600000,cases:['historical-original-vs-file-projection','historical-AC1-AC2-AC3-AC7','semantic-tests','eight-consumer-controls','source-10','source-12','coop-zoom','current-AC1-through-AC8','retained-selection-and-self-ownership','final-source-proof-audit'],tiers:['source-executed 10/12 rendering inputs','one four-human shipped-browser HTTPS/Socket.IO/MongoDB journey','independent persisted camera observations'],exclusions:['no high-count live browsers','no later camera ticket prerequisites','no asset/fog provider refresh','full audit gated on zero prior gaps'],commands:['node --test ops/test_review_camera_evidence.js','same A.inventory with historical original and projected file proofs','node tests/reliability/run.js --suite online-zoom --output-dir <provider>','same A.inventory with each current complete criterion','git diff --check in both repositories','final proof/source audit'],reason:'17 stale camera source hashes and not-file-proof:screenshots/. Retain failed review-83: legacy mousewheel observer timed out; physical output path also misclassified owned evidence. This fresh attempt observes standard wheel without changing input, drawing, clocks or assertions; lexical root path preserves the existing archive guard. Finalized reports are bound through the complete original-file manifest. Retain review-84 finite-clock expiry: open the same four initial menu pages concurrently before sequential rejoin inputs; retain the ten-minute bank, real clocks, all actions and assertions. Retain failed review-86 touch-slot no-effect. Use the existing alreadyAtMenu option for initial desktop joins only; preserve initial touch reload and capture failure state before teardown; retain the actual post-gameplay reload. If a historical comparison reference is supplied, freshly recompute its identical independent report instead of replaying completed historical inventory; current inventory remains fully recomputed. Freeze all readers before this affected refresh.'});
try{
 log('COMMAND '+JSON.stringify([process.execPath,...process.argv.slice(1)])+' CWD='+process.cwd()+' NODE='+process.version);
 required(A.client,[process.execPath,'--test','ops/test_review_camera_evidence.js']);
 const original=path.join(A.client,'artifacts/TASK-213/green-09'),raw=A.inspectRun(tasks.find(t=>t.id==='TASK-213'),original);save('historical-original-inspection.json',raw);
 assert.equal(raw.sourceDifferences.length,17);assert(raw.issues.some(s=>s.includes('not-file-proof:screenshots/')));
 const historical=F.prepare(tasks,original,path.join(out,'historical'));save('historical-selection.json',historical);
 const ready=F.preflight(tasks,historical);save('historical-projected-inspection.json',ready.run);assert(ready.run.historicalValid&&!ready.run.currentSourceValid);assert.equal(ready.run.sourceDifferences.length,17);
 if(process.argv[3]){
  const prior=path.resolve(process.argv[3]),priorInput=A.read(path.join(prior,'historical-selection.json'));
  const oldReportFile=path.join(priorInput.cameraSelection.selected,'camera-independent-review.json');
  assert.deepEqual(ready.report,A.read(oldReportFile),'changed-historical-semantics');
  const oldInventory=path.join(prior,'historical-inventory.json'),old=A.read(oldInventory);
  assert.equal(old.unresolvedPriorArchives.length,121);assert.deepEqual(old.inputIssues,[]);assert.deepEqual(old.unexplainedGaps,[]);
  for(const n of R.HISTORICAL)assert.equal(old.criteria.find(r=>r.id==='TASK-213/AC'+n).status,'reviewed-historical');
  assert.equal(A.hash(priorInput.cameraSelection.baseline.file),priorInput.cameraSelection.baseline.sha256);
  const oldReader=path.join(prior,'frozen-source/review_camera_evidence.js');assert.equal(A.hash(oldReader),priorInput.cameraSelection.readerSha256);
  save('historical-reference.json',{fullInvocation:false,freshHistoricalReaderIdentical:true,inventory:{file:oldInventory,sha256:A.hash(oldInventory)},reader:{file:oldReader,sha256:A.hash(oldReader)},independent:{file:oldReportFile,sha256:A.hash(oldReportFile)},priorOuterExit:A.read(path.join(prior,'process-exit.json')).actualRunnerExit,reason:'Retained actual historical consumer comparison; its 608 independent assertions are freshly recomputed and identical. No old verdict certifies current proof. Current A.inventory will freshly validate the complete baseline and all current transitions.'});
  log('PASS retained historical consumer comparison; freshly recomputed 608 assertions identical; prior outer run remains failed');
 }else{const old=inventory(historical,'historical');assert.deepEqual([old.meta.before.unresolvedPriorArchives.length,old.report.unresolvedPriorArchives.length],[121,121]);}
 log('PASS historical format-only projection historicalValid=true sourceDifferences=17 requiredPrior=121->121');
 for(const [id,mutate,pattern] of [
  ['deleted-proof',s=>fs.unlinkSync(path.join(s.selected,'scale-checkpoints.json')),/ENOENT/],
  ['tampered-proof',s=>fs.appendFileSync(path.join(s.selected,'scale-checkpoints.json'),' '),/evidence-hash-mismatch/],
  ['wrong-owner',s=>s.criteria=[1,2,4],/wrong-camera-owner/],
  ['wrong-release',s=>s.coverageSha256='0'.repeat(64),/wrong-camera-release/],
  ['escaped-provider',s=>s.original='/tmp',/escaped-camera-provider/],
  ['wrong-annex',(_,x)=>x.evidenceSelection.annex.sha256='0'.repeat(64),/omitted-or-changed-camera-retained-row/],
  ['omitted-retained-row',(_,x)=>x.reviews=x.reviews.filter(r=>r.id!=='TASK-211/AC4'),/omitted-or-changed-camera-retained-row/],
  ['rebound-wrong-semantics',s=>{
   const provider=path.join(out,'control-semantic-original');fs.cpSync(s.original,provider,{recursive:true});s.original=provider;
   const scales=A.read(path.join(provider,'scale-checkpoints.json'));scales[0].observed.scale=scales[0].expected.scale=0.5;
   const bytes=JSON.stringify(scales,null,2)+'\n';for(const d of [provider,s.selected])fs.writeFileSync(path.join(d,'scale-checkpoints.json'),bytes);
   const coverage=A.read(path.join(provider,'coverage-results.json'));coverage.evidenceHashes['scale-checkpoints.json']=A.hash(path.join(provider,'scale-checkpoints.json'));
   fs.writeFileSync(path.join(provider,'coverage-results.json'),JSON.stringify(coverage,null,2)+'\n');
   fs.copyFileSync(path.join(provider,'coverage-results.json'),path.join(s.selected,'original-coverage.json'));
   fs.writeFileSync(path.join(s.selected,'coverage-results.json'),JSON.stringify(F.projection(coverage),null,2)+'\n');
   s.coverageSha256=A.hash(path.join(provider,'coverage-results.json'));s.originalFiles['coverage-results.json']=s.coverageSha256;s.originalFiles['scale-checkpoints.json']=coverage.evidenceHashes['scale-checkpoints.json'];
   const m=A.read(path.join(s.selected,'evidence-hashes.json'));for(const n of ['scale-checkpoints.json','original-coverage.json','coverage-results.json'])m[n]=A.hash(path.join(s.selected,n));fs.writeFileSync(path.join(s.selected,'evidence-hashes.json'),JSON.stringify(m,null,2)+'\n');
  },/camera\/load\/p1\/min\/observed\/scale/]
 ]){
  assert(Date.now()<stop,'control deadline');const x=structuredClone(historical),copy=path.join(out,'control-'+id);fs.cpSync(x.cameraSelection.selected,copy,{recursive:true});x.cameraSelection.selected=copy;mutate(x.cameraSelection,x);let reason;try{A.inventory(tasks,research,x);}catch(e){reason=e.message;}assert(reason&&pattern.test(reason),id+': '+reason);controls.push({id,pass:true,reason:reason.split('\n')[0]});log('PASS consumer rejects '+id+' '+reason.split('\n')[0]);
 }
 save('negative-control-results.json',{controls});
 assert.deepEqual(hashes(),frozen,'changed frozen camera tools');
 cleanup=false;const provider=path.join(out,'provider'),argv=[process.execPath,path.join(A.root,'tests/reliability/run.js'),'--suite','online-zoom','--output-dir',provider];
 const nodeOptions='--require '+path.join(A.client,'ops/camera_wheel_observer.js');log('PROVIDER_NODE_OPTIONS='+nodeOptions);const receipt=run(A.root,argv,nodeOptions);save('provider-process-exit.json',receipt);if(fs.existsSync(path.join(provider,'verification-budget.json')))cleanup=A.read(path.join(provider,'verification-budget.json')).cleanup===true;assert.equal(receipt.actualExit,0,'camera provider failed');assert(cleanup,'camera cleanup incomplete');
 const binding={file:path.join(out,'provider-process-exit.json'),sha256:A.hash(path.join(out,'provider-process-exit.json'))};
 assert.deepEqual(hashes(),frozen,'changed tools during provider');const input=F.prepare(tasks,provider,path.join(out,'prepared'),R.CURRENT,binding);save('reviewed-crosswalk.json',input);
 const current=inventory(input,'current');assert.deepEqual([current.meta.before.unresolvedPriorArchives.length,current.report.unresolvedPriorArchives.length],[121,113]);
 save('checkpoints.json',{checks:current.meta.independent.checks});save('source-identities.json',A.read(path.join(provider,'source-identities.json')));
 save('remaining-clause-plan.json',{requiredPrior:current.report.unresolvedPriorArchives,selfChecks:current.report.selfChecks,followUps:current.report.followUps,historicalObligations:current.report.historicalAnnex.retainedObligations,fullAuditReady:false,selection:path.join(out,'reviewed-crosswalk.json'),preload:path.join(A.client,'ops/evidence_camera_gate.js')});
 for(const cwd of [A.client,A.root])required(cwd,['git','diff','--check']);
 assert(F.preflight(tasks,input).run.currentSourceValid);assert.deepEqual(hashes(),frozen);
 for(const cwd of [A.client,A.root]){const r=required(cwd,['git','diff','--cached','--name-only']);const names=spawnSync('git',['diff','--cached','--name-only'],{cwd,encoding:'utf8'});assert(!names.stdout.split('\n').some(n=>n.startsWith('artifacts/')));log('PASS artifacts-unstaged:'+cwd);}
 save('coverage-results.json',{fullInvocation:false,passScoped:true,requiredPriorBefore:121,requiredPriorAfter:113,toolHashes:frozen,cases:current.meta.transitions.map(r=>({...r,pass:true,proof:'current-transitions.json'}))});
 log('PASS camera complete AC1-through-AC8 requiredPrior=121->113 selfChecks=8 controls=8');log('INCOMPLETE TASK-225 full invocation remains prerequisite-gated');pass=true;
}catch(e){log(e.stack);process.exitCode=1;}
finally{
 const p=path.join(out,'provider/verification-budget.json');if(fs.existsSync(p))cleanup=A.read(p).cleanup===true;
 save('verification-budget.json',{fullInvocation:false,startedMs:start,finishedMs:Date.now(),elapsedMs:Date.now()-start,commands,cleanup,passScoped:pass&&cleanup&&Date.now()<stop});
 if(!pass||!cleanup||Date.now()>=stop)process.exitCode=1;log('PLANNED_RUNNER_EXIT='+(process.exitCode||0));
}
