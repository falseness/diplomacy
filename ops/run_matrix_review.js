'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const G=require('./evidence_matrix_gate'),F=require('./evidence_matrix_selection'),R=require('./review_matrix_evidence');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const out=path.resolve(process.argv[2]),start=Date.now(),stop=start+3300000;
assert(!fs.existsSync(out),'fresh matrix run required');fs.mkdirSync(out,{recursive:true});process.env.EVIDENCE_AUDIT_DEADLINE_MS=String(stop);
const save=(n,x)=>fs.writeFileSync(path.join(out,n),JSON.stringify(x,null,2)+'\n');
const log=s=>{console.log(s);fs.appendFileSync(path.join(out,'verification.log'),s+'\n');};
for(let gate=G;gate;gate=gate.previous)gate.onPhase=log;
const tools=['review_matrix_evidence.js','test_review_matrix_evidence.js','evidence_matrix_selection.js','evidence_matrix_gate.js','run_matrix_review.js','matrix_observer.js'];
const hashes=()=>Object.fromEntries(tools.map(n=>['ops/'+n,A.hash(path.join(__dirname,n))])),frozen=hashes();
const tasks=A.read(path.join(A.client,'artifacts/tasks.json')),research=A.read(path.join(A.client,'artifacts/TASK-225/review-92/research-input.json'));
const commands=[],controls=[];let pass=false,cleanup=true;
function run(cwd,argv,nodeOptions=null){assert(Date.now()<stop,'cumulative deadline');log('COMMAND '+JSON.stringify(argv)+' CWD='+cwd);const began=Date.now(),r=spawnSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',timeout:Math.max(1,stop-Date.now()),maxBuffer:32*1024*1024,env:{...process.env,...(nodeOptions?{NODE_OPTIONS:nodeOptions}:{})}});log(r.stdout||'');log(r.stderr||'');log('ACTUAL_EXIT='+r.status+' SIGNAL='+r.signal);const receipt={argv,cwd,startedMs:began,finishedMs:Date.now(),actualExit:r.status,signal:r.signal,nodeOptions};commands.push(receipt);return receipt;}
function required(cwd,argv){const r=run(cwd,argv);assert.equal(r.actualExit,0,'required command failed');return r;}
function inventory(input,prefix){const report=A.inventory(tasks,research,input),meta=G.last;save(prefix+'-inventory.json',report);save(prefix+'-transitions.json',meta.transitions);save(prefix+'-phases.json',meta.phases);assert.deepEqual(report.inputIssues,[]);assert.deepEqual(report.unexplainedGaps,[]);assert.equal(report.selfChecks.length,8);return {report,meta};}
save('task-input.json',tasks);save('research-input.json',research);save('frozen-tools.json',frozen);
save('verification-plan.json',{fullInvocation:false,estimateMs:2100000,stopWorkMs:3300000,budgetMs:3600000,cases:['historical-original-vs-file-projection','historical-AC1-AC7','semantic-tests','eight-consumer-controls','chromium-coop-desktop','firefox-competitive-desktop','webkit-coop-mobile','chromium-attack-fixture','current-AC1-through-AC8','retained-selection-and-self-ownership','final-source-proof-audit'],tiers:['source-executed touch regressions','four two-human shipped-browser HTTPS/Socket.IO/MongoDB journeys','independent raw admission/action/scale observations'],exclusions:['no high-count live browsers','no later matrix ticket prerequisites','no asset/fog provider refresh','full audit gated on zero prior gaps'],commands:['node --test ops/test_review_matrix_evidence.js','same A.inventory with historical original and projected file proofs','node tests/reliability/run.js --suite browser-matrix --output-dir <provider>','same A.inventory with each current complete criterion','git diff --check in both repositories','final proof/source audit'],reason:'15 stale source hashes and four directory-proof references. Historical AC1/7 retain old hashes, no current credit. Current numeric scale/gold observations are captured by an explicit read-only preload. Freeze reader and selection before narrowly affected matrix refresh; preserve every retained asset/fog/camera row.'});
try{
 log('COMMAND '+JSON.stringify([process.execPath,...process.argv.slice(1)])+' CWD='+process.cwd()+' NODE='+process.version);
 required(A.client,[process.execPath,'--test','ops/test_review_matrix_evidence.js']);
 const original=path.join(A.client,'artifacts/TASK-214/green-20260925T025827Z'),raw=A.inspectRun(tasks.find(t=>t.id==='TASK-213'),original);save('historical-original-inspection.json',raw);
 assert.equal(raw.sourceDifferences.length,15);assert(raw.issues.some(s=>s.includes('not-file-proof:')));
 const historical=F.prepare(tasks,original,path.join(out,'historical'));save('historical-selection.json',historical);
 const ready=F.preflight(tasks,historical);save('historical-projected-inspection.json',ready.run);assert(ready.run.historicalValid&&!ready.run.currentSourceValid);assert.equal(ready.run.sourceDifferences.length,15);
 const old=inventory(historical,'historical');assert.deepEqual([old.meta.before.unresolvedPriorArchives.length,old.report.unresolvedPriorArchives.length],[113,113]);
 log('PASS historical format-only projection historicalValid=true sourceDifferences=15 requiredPrior=113->113');
 for(const [id,mutate,pattern] of [
  ['deleted-proof',s=>fs.unlinkSync(path.join(s.selected,'checkpoints.json')),/ENOENT/],
  ['tampered-proof',s=>fs.appendFileSync(path.join(s.selected,'checkpoints.json'),' '),/evidence-hash-mismatch/],
  ['wrong-owner',s=>s.criteria=[1,2,4],/wrong-matrix-owner/],
  ['wrong-release',s=>s.coverageSha256='0'.repeat(64),/wrong-matrix-release/],
  ['escaped-provider',s=>s.original='/tmp',/escaped-matrix-provider/],
  ['wrong-annex',(_,x)=>x.evidenceSelection.annex.sha256='0'.repeat(64),/omitted-or-changed-matrix-retained-row/],
  ['omitted-retained-row',(_,x)=>x.reviews=x.reviews.filter(r=>r.id!=='TASK-211/AC4'),/omitted-or-changed-matrix-retained-row/],
  ['rebound-wrong-semantics',s=>{
   const provider=path.join(out,'control-semantic-original');fs.cpSync(s.original,provider,{recursive:true});s.original=provider;
   const cp=A.read(path.join(provider,'checkpoints.json')),r=cp.checkpoints.find(c=>c.id==='chromium-coop-desktop/participants');r.expected=r.observed=1;
   const bytes=JSON.stringify(cp,null,2)+'\n';for(const d of [provider,s.selected])fs.writeFileSync(path.join(d,'checkpoints.json'),bytes);
   const coverage=A.read(path.join(provider,'coverage-results.json'));coverage.evidenceHashes['checkpoints.json']=A.hash(path.join(provider,'checkpoints.json'));
   fs.writeFileSync(path.join(provider,'coverage-results.json'),JSON.stringify(coverage,null,2)+'\n');
   fs.copyFileSync(path.join(provider,'coverage-results.json'),path.join(s.selected,'original-coverage.json'));
   fs.writeFileSync(path.join(s.selected,'coverage-results.json'),JSON.stringify(F.projection(coverage),null,2)+'\n');
   s.coverageSha256=A.hash(path.join(provider,'coverage-results.json'));s.originalFiles['coverage-results.json']=s.coverageSha256;s.originalFiles['checkpoints.json']=coverage.evidenceHashes['checkpoints.json'];
   const m=A.read(path.join(s.selected,'evidence-hashes.json'));for(const n of ['checkpoints.json','original-coverage.json','coverage-results.json'])m[n]=A.hash(path.join(s.selected,n));fs.writeFileSync(path.join(s.selected,'evidence-hashes.json'),JSON.stringify(m,null,2)+'\n');
  },/matrix\/chromium-coop-desktop\/participants/]
 ]){
  assert(Date.now()<stop,'control deadline');const x=structuredClone(historical),copy=path.join(out,'control-'+id);fs.cpSync(x.matrixSelection.selected,copy,{recursive:true});x.matrixSelection.selected=copy;mutate(x.matrixSelection,x);let reason;try{A.inventory(tasks,research,x);}catch(e){reason=e.message;}assert(reason&&pattern.test(reason),id+': '+reason);controls.push({id,pass:true,reason:reason.split('\n')[0]});log('PASS consumer rejects '+id+' '+reason.split('\n')[0]);
 }
 save('negative-control-results.json',{controls});
 assert.deepEqual(hashes(),frozen,'changed frozen matrix tools');
 cleanup=false;const provider=path.join(out,'provider'),argv=[process.execPath,path.join(A.root,'tests/reliability/run.js'),'--suite','browser-matrix','--output-dir',provider];
 const nodeOptions='--require '+path.join(A.client,'ops/matrix_observer.js');log('PROVIDER_NODE_OPTIONS='+nodeOptions);const receipt=run(A.root,argv,nodeOptions);save('provider-process-exit.json',receipt);if(fs.existsSync(path.join(provider,'verification-budget.json')))cleanup=A.read(path.join(provider,'verification-budget.json')).cleanup===true;assert.equal(receipt.actualExit,0,'matrix provider failed');assert(cleanup,'matrix cleanup incomplete');
 const binding={file:path.join(out,'provider-process-exit.json'),sha256:A.hash(path.join(out,'provider-process-exit.json'))};
 assert.deepEqual(hashes(),frozen,'changed tools during provider');const input=F.prepare(tasks,provider,path.join(out,'prepared'),R.CURRENT,binding);save('reviewed-crosswalk.json',input);
 const current=inventory(input,'current');assert.deepEqual([current.meta.before.unresolvedPriorArchives.length,current.report.unresolvedPriorArchives.length],[113,105]);
 save('checkpoints.json',{checks:current.meta.independent.checks});save('source-identities.json',A.read(path.join(provider,'source-identities.json')));
 save('remaining-clause-plan.json',{requiredPrior:current.report.unresolvedPriorArchives,selfChecks:current.report.selfChecks,followUps:current.report.followUps,historicalObligations:current.report.historicalAnnex.retainedObligations,fullAuditReady:false,selection:path.join(out,'reviewed-crosswalk.json'),preload:path.join(A.client,'ops/evidence_matrix_gate.js')});
 for(const cwd of [A.client,A.root])required(cwd,['git','diff','--check']);
 assert(F.preflight(tasks,input).run.currentSourceValid);assert.deepEqual(hashes(),frozen);
 for(const cwd of [A.client,A.root]){const r=required(cwd,['git','diff','--cached','--name-only']);const names=spawnSync('git',['diff','--cached','--name-only'],{cwd,encoding:'utf8'});assert(!names.stdout.split('\n').some(n=>n.startsWith('artifacts/')));log('PASS artifacts-unstaged:'+cwd);}
 save('coverage-results.json',{fullInvocation:false,passScoped:true,requiredPriorBefore:113,requiredPriorAfter:105,toolHashes:frozen,cases:current.meta.transitions.map(r=>({...r,pass:true,proof:'current-transitions.json'}))});
 log('PASS matrix complete AC1-through-AC8 requiredPrior=113->105 selfChecks=8 controls=8');log('INCOMPLETE TASK-225 full invocation remains prerequisite-gated');pass=true;
}catch(e){log(e.stack);process.exitCode=1;}
finally{
 const p=path.join(out,'provider/verification-budget.json');if(fs.existsSync(p))cleanup=A.read(p).cleanup===true;
 save('verification-budget.json',{fullInvocation:false,startedMs:start,finishedMs:Date.now(),elapsedMs:Date.now()-start,commands,cleanup,passScoped:pass&&cleanup&&Date.now()<stop});
 if(!pass||!cleanup||Date.now()>=stop)process.exitCode=1;log('PLANNED_RUNNER_EXIT='+(process.exitCode||0));
}
