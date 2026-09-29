'use strict';
// TASK-225-16: one bounded online-zoom provider refresh, then re-consumption
// of the retained, already-reviewed TASK-213/AC1..AC8 rows through the root
// cumulative consumer (reconcile_evidence_catalog.inventory -> consume_historical_catalog.consume).
//   provider <out>                  one bounded provider run; OS receipt and finalized parent receipt
//   consume <refresh> <work> <evidence>  fresh projection, retained rows rebuilt, before/after
//   control <id> <work>             deleted/tampered copy of the consumed proof; must exit 1
// Clause texts, partitions, tiers, cases, reasons and derivations are the retained
// rows' own; only proof hashes and oracle-recomputed expected values are rebound.
// The consumption is cumulative: the TASK-225-14 (TASK-211) and TASK-225-15
// (TASK-212) fresh selections are part of both sides, so only the TASK-213 run
// and its eight rows differ.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const C=require('./reconcile_evidence_catalog'),H=require('./consume_historical_catalog');
const F=require('./review_camera_evidence'),FS=require('./evidence_camera_selection');
const FROZEN=path.join(A.client,'artifacts/TASK-225/review-75');
const RETAINED=path.join(A.client,'artifacts/TASK-225/review-92');
const RETAINED_RUN=path.join(RETAINED,'prepared/selected-213');
const PRIORS=[{task:'TASK-211',file:path.join(A.client,'artifacts/TASK-225-14/consume/selection.json')},
 {task:'TASK-212',file:path.join(A.client,'artifacts/TASK-225-15/consume/selection.json')}];
const FREEZE=path.join(A.client,'artifacts/TASK-225-13/frozen-sources.json');
const OBSERVER=path.join(A.client,'ops/camera_wheel_observer.js');
const ids=task=>[1,2,3,4,5,6,7,8].map(n=>task+'/AC'+n),IDS=ids('TASK-213');
const TARGET_MS=1500000,STOP_MS=3300000,BUDGET_MS=3600000;
const ENV={...process.env,PYTHONDONTWRITEBYTECODE:'1',NODE_PATH:'/opt/diplomacy/node_modules'};
const save=(dir,n,x)=>fs.writeFileSync(path.join(dir,n),JSON.stringify(x,null,2)+'\n');
const rows=r=>[...r.criteria,...r.researchGaps];
const inputs=()=>({tasks:A.read(path.join(FROZEN,'task-input.json')),research:A.read(path.join(FROZEN,'research-input.json'))});
const retainedRows=()=>{const cw=A.read(path.join(RETAINED,'reviewed-crosswalk.json'));return IDS.map(id=>cw.reviews.find(r=>r.id===id));};

function provider(out){
 const start=Date.now(),stop=start+STOP_MS,commands=[];
 assert(!fs.existsSync(out),'fresh refresh directory required');fs.mkdirSync(out,{recursive:true});
 const log=line=>{fs.appendFileSync(path.join(out,'verification.log'),line+'\n');console.log(line);};
 function run(cwd,argv,{allow=[0],nodeOptions=null}={}){
  assert(Date.now()<stop,'cumulative stop-work deadline');
  log('COMMAND '+JSON.stringify(argv)+' CWD='+cwd+(nodeOptions?' NODE_OPTIONS='+nodeOptions:''));
  const began=Date.now(),r=spawnSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',env:{...ENV,...(nodeOptions?{NODE_OPTIONS:nodeOptions}:{})},maxBuffer:64*1024*1024,timeout:Math.max(1,stop-Date.now())});
  const finished=Date.now();
  log('--- STDOUT ---\n'+(r.stdout||'')+'--- STDERR ---\n'+(r.stderr||'')+'--- END STREAMS ---');
  log('ACTUAL_EXIT='+r.status+' SIGNAL='+r.signal+' ELAPSED_MS='+(finished-began));
  const receipt={argv,cwd,startedMs:began,finishedMs:finished,actualExit:r.status,signal:r.signal,nodeOptions};
  commands.push({...receipt,elapsedMs:finished-began});
  assert(allow.includes(r.status),'required command failed: '+argv.join(' '));return {r,receipt};
 }
 const dir=path.join(out,'provider');let pass=false,cleanup=false;
 try{
  log('PARENT_COMMAND '+JSON.stringify([process.execPath,...process.argv.slice(1)])+' CWD='+process.cwd());
  log('RUNTIME node='+process.version+' platform='+process.platform+' started='+new Date(start).toISOString());
  process.env.PLAYWRIGHT_BROWSERS_PATH??='0'; // same default as the server browser helpers
  const exe=require('/opt/diplomacy/node_modules/playwright').chromium.executablePath();
  const browser=run(A.client,[exe,'--version']).r;log('BROWSER '+exe+' '+browser.stdout.trim());
  run(A.client,['mongod','--version']);
  run(A.client,['python3','-B','ops/freeze_source_set.py','drift',FREEZE,'TASK-225-16']);
  for(const repo of [A.client,A.root])run(repo,['git','status','--porcelain']);
  log('TARGET_MS='+TARGET_MS+' STOP_WORK_MS='+STOP_MS+' BUDGET_MS='+BUDGET_MS);
  // Same invocation shape as the retained review-92 provider: absolute runner and
  // the retained standard-wheel observer, whose receipt the camera reader binds.
  const nodeOptions='--require '+OBSERVER;
  const {r,receipt}=run(A.root,[process.execPath,path.join(A.root,'tests/reliability/run.js'),'--suite','online-zoom','--output-dir',dir],{nodeOptions});
  save(out,'provider-process-exit.json',receipt);
  for(const line of (r.stdout||'').split('\n').filter(l=>l.startsWith('# runtime ')))log('PROVIDER_RUNTIME '+line.slice(10));
  const budget=A.read(path.join(dir,'verification-budget.json'));
  log('PROVIDER_BUDGET '+JSON.stringify(budget)+' withinTarget='+(budget.elapsedMs<=TARGET_MS));
  assert.equal(budget.pass,true,'provider-pass');assert.equal(budget.cleanup,true,'provider-cleanup');cleanup=true;
  for(const repo of [A.client,A.root])run(repo,['git','diff','--check']);
  for(const repo of [A.client,A.root])run(repo,['git','status','--porcelain']);
  const binding={original:dir,coverageSha256:A.hash(path.join(dir,'coverage-results.json')),
   receipt:{file:path.join(out,'provider-process-exit.json'),sha256:A.hash(path.join(out,'provider-process-exit.json'))}};
  save(out,'provider-binding.json',binding);
  save(out,'source-identities.json',identities(dir));
  const current=A.compareSources(A.read(path.join(dir,'source-identities.json')));
  log('SOURCE_DIFFERENCES_NOW '+JSON.stringify(current));assert.deepEqual(current,[],'fresh provider not current');
  pass=true;log('PASS one bounded online-zoom provider refresh binding='+JSON.stringify(binding));
 }catch(e){log(e.stack);process.exitCode=1;}
 finally{
  const finished=Date.now();
  save(out,'verification-budget.json',{startedMs:start,finishedMs:finished,elapsedMs:finished-start,targetMs:TARGET_MS,
   budgetMs:BUDGET_MS,stopWorkMs:STOP_MS,fullInvocation:false,passScoped:pass&&cleanup&&finished<stop,cleanup,commands});
  if(!pass||!cleanup||finished>=stop)process.exitCode=1;
  log('PARENT_ACTUAL_EXIT='+(process.exitCode||0)+' ELAPSED_MS='+(finished-start));
 }
}
// Retained vs fresh source manifests: the stale paths must now match, and every
// added path must be explained by git history or a recorded dirty/untracked state.
function identities(dir){
 const old=A.read(path.join(RETAINED_RUN,'source-identities.json')).after,now=A.read(path.join(dir,'source-identities.json')).after;
 const git=(repo,...a)=>spawnSync('git',a,{cwd:repo,encoding:'utf8'}).stdout.trim();
 const stale=A.compareSources({after:old}).map(d=>({...d,freshRecorded:now[d.role]?.files[d.file]??null,
  matchesCurrent:now[d.role]?.files[d.file]===d.observed}));
 const additions=[],removals=[],otherChanged=[];
 for(const role of ['client','server']){
  const o=old[role].files,n=now[role].files,repo=now[role].repo;
  for(const file of Object.keys(n).filter(f=>!(f in o))){
   const commit=git(repo,'log','--diff-filter=A','--format=%H %s','-1','--',file),status=git(repo,'status','--porcelain','--',file);
   const after=commit?spawnSync('git',['merge-base','--is-ancestor',commit.split(' ')[0],old[role].head],{cwd:repo}).status!==0:null;
   additions.push({role,file,sha256:n[file],addedByCommit:commit||null,addedAfterRetainedHead:after,workingTreeStatus:status||null,
    explanation:commit?(after?'added by a commit after the retained head':'committed before the retained head'):status?'uncommitted working-tree file ('+status+')':'unexplained',
    explained:(!!commit&&after)||!!status});
  }
  for(const file of Object.keys(o).filter(f=>!(f in n)))removals.push({role,file,existsNow:fs.existsSync(path.join(repo,file))});
  for(const file of Object.keys(o).filter(f=>f in n&&o[f]!==n[f]))
   otherChanged.push({role,file,retained:o[file],fresh:n[file],previouslyStale:stale.some(s=>s.role===role&&s.file===file)});
 }
 return {retained:{file:path.join(RETAINED_RUN,'source-identities.json'),sha256:A.hash(path.join(RETAINED_RUN,'source-identities.json')),heads:{client:old.client.head,server:old.server.head}},
  fresh:{file:path.join(dir,'source-identities.json'),sha256:A.hash(path.join(dir,'source-identities.json')),heads:{client:now.client.head,server:now.server.head}},
  counts:{retained:{client:Object.keys(old.client.files).length,server:Object.keys(old.server.files).length},fresh:{client:Object.keys(now.client.files).length,server:Object.keys(now.server.files).length}},
  previouslyStale:stale,allPreviouslyStaleMatchCurrent:stale.length>0&&stale.every(s=>s.matchesCurrent),
  freshDifferencesNow:A.compareSources({after:now}),additions,unexplainedAdditions:additions.filter(a=>!a.explained).map(a=>a.role+'/'+a.file),
  removals,changedBetweenRuns:otherChanged,changedNotPreviouslyStale:otherChanged.filter(c=>!c.previouslyStale).map(c=>c.role+'/'+c.file)};
}

// The fresh row comes from the retained builder (review_camera_evidence.rowFor)
// over the fresh report. Everything except the proof bindings must equal the retained row.
const BINDINGS=['sourceIdentity','traces','proofs','assertions'];
const strip=x=>JSON.parse(JSON.stringify(x,(k,v)=>BINDINGS.includes(k)?undefined:v));
function rebind(row,fresh,manifest,checks){
 assert.equal(row.clauses.length,1,'retained single-clause row:'+row.id);assert.equal(fresh.id,row.id);
 for(const k of checks){assert.equal(k.pass,true,'fresh-check-failed:'+k.id);assert.deepEqual(k.observed,k.expected,'fresh-check-observed:'+k.id);}
 const c=fresh.clauses[0];
 for(const ref of [c.sourceIdentity,...(c.traces||[]),...c.proofs,...c.assertions.map(a=>a.proof)])
  assert(Object.hasOwn(manifest,ref.file)&&manifest[ref.file]===ref.sha256,'fresh-manifest-binding:'+ref.file);
 for(const id of [...(c.contextIds||[]),...(c.milestoneIds||[])])assert(c.assertions.some(a=>a.id===id),'fresh-report-lacks:'+id);
 assert.deepEqual(strip(fresh),strip(row),'retained-row-changed-beyond-bindings:'+row.id);
 const old=new Map(row.clauses[0].assertions.map(a=>[a.id,a.expected])),now=new Map(c.assertions.map(a=>[a.id,a.expected]));
 const oldProofs=row.clauses[0].proofs.map(p=>p.file),newProofs=c.proofs.map(p=>p.file);
 return {row:fresh,summary:{id:row.id,report:c.assertions[0].proof.file,retainedAssertions:old.size,freshAssertions:now.size,
  assertionIdsAdded:[...now.keys()].filter(i=>!old.has(i)),assertionIdsRemoved:[...old.keys()].filter(i=>!now.has(i)),
  expectedChanged:[...now.keys()].filter(i=>old.has(i)&&JSON.stringify(old.get(i))!==JSON.stringify(now.get(i))).map(i=>({id:i,retained:old.get(i),fresh:now.get(i)})),
  proofFilesAdded:newProofs.filter(f=>!oldProofs.includes(f)),proofFilesRemoved:oldProofs.filter(f=>!newProofs.includes(f)),
  proofHashesChanged:row.clauses[0].proofs.filter(p=>newProofs.includes(p.file)&&manifest[p.file]!==p.sha256).map(p=>p.file).length}};
}
function preflight(sel,task){
 // Exact per-file reasons: a deleted or altered consumed proof fails closed by name.
 for(const [name,sha] of Object.entries(sel.manifest)){
  const file=path.join(sel.selected,name);assert(fs.existsSync(file),'deleted-proof:'+name);assert.equal(A.hash(file),sha,'tampered-proof:'+name);
 }
 assert.deepEqual(A.read(path.join(sel.selected,'evidence-hashes.json')),sel.manifest,'changed-projection-manifest');
 const run=A.inspectRun(task,sel.selected);
 assert(run.historicalValid&&run.currentSourceValid,'fresh selected-213 not current: '+run.issues.join(','));
 return run;
}
// TASK-225-14's fresh TASK-211 and TASK-225-15's fresh TASK-212 selections, hash-bound and still current.
function priors(){
 return PRIORS.map(({task,file})=>{
  const sel=A.read(file),run=A.inspectRun({id:task},sel.selected);
  assert.deepEqual(sel.rows.map(r=>r.id),ids(task),'prior-rows:'+task);
  assert(run.historicalValid&&run.currentSourceValid,task+' prior selection not current: '+run.issues.join(','));
  return {task,file,sha256:A.hash(file),rows:sel.rows,run};
 });
}
function totals(r){
 const statusCounts={};for(const x of rows(r))statusCounts[x.status]=(statusCounts[x.status]||0)+1;
 return {rows:rows(r).length,criteria:r.criteria.length,researchGaps:r.researchGaps.length,statusCounts,covered:rows(r).filter(x=>x.covered).length,
  unresolvedPriorArchives:r.unresolvedPriorArchives.length,unresolvedRequiredLocal:r.unresolvedRequiredLocal.length,selfChecks:r.selfChecks.length,
  followUps:r.followUps.length,pass:r.pass,auditComplete:r.auditComplete,priorArchivesComplete:r.priorArchivesComplete};
}
function consumeBoth(tasks,research,prior,retained,retainedRun,fresh,freshRun){
 const prepared=C.prepare(tasks,research),base=C.inventory(tasks,research,prepared.candidate,prepared.annex);
 const owners=[...prior.map(p=>p.task),'TASK-213'],aliases=owners.map(id=>({id,key:id}));
 for(const id of owners)assert(base.runs.some(r=>r.task===id),id+' run slot absent from catalog');
 const side=(rowsIn,run)=>{const cand=structuredClone(prepared.candidate),runs=new Map(prior.map(p=>[p.task,p.run]));runs.set('TASK-213',run);
  for(const r of [...prior.flatMap(p=>p.rows),...rowsIn])cand.reviews[cand.reviews.findIndex(x=>x.id===r.id)]=r;
  return H.consume({...base,runs:base.runs.map(r=>runs.has(r.task)?{...runs.get(r.task),task:r.task}:r)},tasks,research,cand,aliases);};
 return {base,before:side(retained,retainedRun),after:side(fresh,freshRun)};
}
function consume(refresh,work,evidence){
 const start=Date.now();assert(!fs.existsSync(work),'fresh consume directory required');fs.mkdirSync(work,{recursive:true});fs.mkdirSync(evidence,{recursive:true});
 const log=line=>{fs.appendFileSync(path.join(work,'consume.log'),line+'\n');console.log(line);};
 const {tasks,research}=inputs(),task=tasks.find(t=>t.id==='TASK-213'),retained=retainedRows();
 log('INPUTS tasks='+A.hash(path.join(FROZEN,'task-input.json'))+' research='+A.hash(path.join(FROZEN,'research-input.json'))+' crosswalk='+A.hash(path.join(RETAINED,'reviewed-crosswalk.json')));
 assert.deepEqual(A.read(path.join(RETAINED,'task-input.json')).find(t=>t.id==='TASK-213').acceptance_criteria,task.acceptance_criteria,'review-92 TASK-213 criteria differ');
 assert.equal(A.hash(path.join(RETAINED,'research-input.json')),A.hash(path.join(FROZEN,'research-input.json')),'review-92 research input differs');
 retained.forEach((row,i)=>{const text=task.acceptance_criteria[i];assert(row,'missing-retained-row:'+IDS[i]);
  assert.equal(row.targetSha256,R.digest(text),'retained-target:'+row.id);assert.equal(row.clauses.map(c=>c.text).join(''),text,'retained-partition:'+row.id);});
 log('PASS retained partitions concatenate exactly to the eight TASK-213 criterion texts (identical in review-75 and review-92 task inputs)');
 // Finalized parent receipt, OS provider receipt and provider binding of the single refresh invocation.
 const parentReceipt={file:path.join(refresh,'verification-budget.json'),sha256:A.hash(path.join(refresh,'verification-budget.json'))};
 const parent=A.read(parentReceipt.file),binding=A.read(path.join(refresh,'provider-binding.json'));
 const providerCommands=parent.commands.filter(c=>c.argv.includes('--suite')&&c.argv.includes('online-zoom'));
 assert.equal(providerCommands.length,1,'exactly one provider command');assert.equal(providerCommands[0].actualExit,0);
 assert(parent.passScoped===true&&parent.cleanup===true,'refresh receipt not finalized green');
 assert.equal(fs.realpathSync(providerCommands[0].argv.at(-1)),fs.realpathSync(binding.original),'receipt-provider-binding');
 assert.equal(A.hash(path.join(binding.original,'coverage-results.json')),binding.coverageSha256,'changed-provider-coverage');
 const receipt=binding.receipt;assert.equal(A.hash(receipt.file),receipt.sha256,'changed-provider-receipt');
 const {elapsedMs,...os}=providerCommands[0];assert.deepEqual(A.read(receipt.file),os,'os-receipt-differs-from-parent-command');
 log('RECEIPT '+JSON.stringify(parentReceipt)+' BINDING '+JSON.stringify(binding));
 // Fresh projection and report with the retained camera reader (evidence_camera_selection.prepare).
 const prepared=path.join(work,'prepared'),input=FS.prepare(tasks,binding.original,prepared,F.CURRENT,receipt);
 const selected=path.join(prepared,'selected-213'),manifest=A.read(path.join(selected,'evidence-hashes.json'));
 const report=A.read(path.join(selected,'camera-independent-review.json'));
 assert.deepEqual(report,F.review(binding.original,F.CURRENT,receipt,input.cameraSelection.originalFiles),'camera report recomputes');
 log('PASS reader review_camera_evidence.js checks='+report.checks.length+' criteria='+JSON.stringify(report.criteria));
 const built=IDS.map(id=>input.reviews.find(r=>r.id===id));
 built.forEach((row,i)=>assert.deepEqual(row,F.rowFor(tasks,report,manifest,i+1),'builder-row:'+IDS[i]));
 const rebound=retained.map((row,i)=>rebind(row,built[i],manifest,report.checks.filter(c=>c.owner===i+1)));
 for(const r of rebound)log('REBIND '+JSON.stringify({...r.summary,expectedChanged:r.summary.expectedChanged.length}));
 log('PASS all eight fresh builder rows equal the retained rows except proof bindings');
 const sel={selected,manifest,rows:rebound.map(r=>r.row),receipt,parentReceipt,binding};
 save(work,'selection.json',sel);
 const freshRun=preflight(sel,task);log('PASS fresh selected-213 historicalValid='+freshRun.historicalValid+' currentSourceValid='+freshRun.currentSourceValid);
 const retainedRun=A.inspectRun(task,RETAINED_RUN);
 assert(retainedRun.historicalValid&&!retainedRun.currentSourceValid,'retained run must be historical-only');
 log('RETAINED selected-213 historicalValid=true currentSourceValid=false sourceDifferences='+JSON.stringify(retainedRun.sourceDifferences));
 const prior=priors();for(const p of prior)log('CUMULATIVE '+p.task+' selection '+JSON.stringify({file:p.file,sha256:p.sha256})+' currentSourceValid='+p.run.currentSourceValid);
 const {base,before,after}=consumeBoth(tasks,research,prior,retained,retainedRun,sel.rows,freshRun);
 save(work,'before-consumer.json',before);save(work,'after-consumer.json',after);
 const old=new Map(rows(before).map(r=>[r.id,r])),differences=[];
 for(const r of rows(after))if(JSON.stringify(r)!==JSON.stringify(old.get(r.id)))differences.push({id:r.id,beforeStatus:old.get(r.id)?.status,afterStatus:r.status});
 const nonTarget=differences.filter(d=>!IDS.includes(d.id));
 const owners=before.selfChecks.map(s=>{const n=after.selfChecks.find(x=>x.id===s.id);
  return {id:s.id,status:s.status,afterStatus:n?.status,checkpointIds:(s.clauses||[]).flatMap(c=>c.checkpointIds||[]),afterCheckpointIds:(n?.clauses||[]).flatMap(c=>c.checkpointIds||[]),unchanged:JSON.stringify(s)===JSON.stringify(n)};});
 const catalog=R.targets(tasks,research);
 const transitions=IDS.map((id,i)=>{const b=before.criteria.find(r=>r.id===id),a=after.criteria.find(r=>r.id===id);
  return {id,beforeStatus:b.status,afterStatus:a.status,beforeCovered:b.covered,afterCovered:a.covered,beforeClauseStatuses:b.clauses.map(c=>c.status),afterClauseStatuses:a.clauses.map(c=>c.status),
   clauseCount:a.clauses.length,clauseTextsUnchanged:JSON.stringify(a.clauses.map(c=>c.text))===JSON.stringify(retained[i].clauses.map(c=>c.text)),
   rebinding:rebound[i].summary};});
 const hashed=f=>({file:f,sha256:A.hash(f)});
 const result={task:'TASK-225-16',owner:'TASK-213',consumer:['ops/reconcile_evidence_catalog.js#inventory','ops/consume_historical_catalog.js#consume'],
  identicalInputs:{tasks:hashed(path.join(FROZEN,'task-input.json')),research:hashed(path.join(FROZEN,'research-input.json')),
   retainedCrosswalk:hashed(path.join(RETAINED,'reviewed-crosswalk.json')),cumulativeSelections:prior.map(p=>({task:p.task,file:p.file,sha256:p.sha256})),
   note:'Both sides share one C.prepare/C.inventory base, the same tasks, research, candidate, provider aliases and the TASK-225-14/15 fresh TASK-211/212 selections; only the TASK-213 run and the eight TASK-213 rows (rebound) differ.'},
  catalog:{targets:catalog.length,criteria:catalog.filter(t=>t.task).length,researchGaps:catalog.filter(t=>!t.task).length,laterTaskRows:catalog.filter(t=>R.laterTask(t.task)).length},
  retainedRun:{directory:RETAINED_RUN,historicalValid:retainedRun.historicalValid,currentSourceValid:retainedRun.currentSourceValid,issues:retainedRun.issues,sourceDifferences:retainedRun.sourceDifferences},
  freshRun:{directory:selected,historicalValid:freshRun.historicalValid,currentSourceValid:freshRun.currentSourceValid,issues:freshRun.issues,sourceDifferences:freshRun.sourceDifferences,receipt,parentReceipt,binding},
  transitions,allEightMoved:transitions.every(t=>t.beforeStatus==='reviewed-historical'&&t.afterStatus==='covered-current'),
  before:totals(before),after:totals(after),
  delta:{unresolvedPriorArchives:after.unresolvedPriorArchives.length-before.unresolvedPriorArchives.length,covered:totals(after).covered-totals(before).covered},
  removedFromUnresolved:before.unresolvedPriorArchives.filter(id=>!after.unresolvedPriorArchives.includes(id)),
  nonTarget:{comparedRows:rows(after).length,differences:nonTarget,unchanged:nonTarget.length===0,researchGapsUnchanged:JSON.stringify(before.researchGaps)===JSON.stringify(after.researchGaps),
   cumulative:prior.flatMap(p=>ids(p.task)).map(id=>({id,before:before.criteria.find(r=>r.id===id).status,after:after.criteria.find(r=>r.id===id).status}))},
  selfOwners:owners,selfOwnerCount:owners.length,allSelfOwnersUnchanged:owners.length===8&&owners.every(o=>o.unchanged),
  baseTASK213Status:IDS.map(id=>({id,status:base.criteria.find(r=>r.id===id).status})),
  inputIssues:after.inputIssues,unexplainedGaps:after.unexplainedGaps,fullTaskPass:false,elapsedMs:Date.now()-start};
 save(evidence,'transition.json',result);
 assert(result.allEightMoved,'not all eight moved: '+JSON.stringify(transitions.map(t=>[t.id,t.beforeStatus,t.afterStatus])));
 assert(result.nonTarget.unchanged,'non-target rows changed: '+JSON.stringify(nonTarget));assert(result.allSelfOwnersUnchanged,'self owners changed');
 assert.deepEqual(after.inputIssues,[]);assert.deepEqual(after.unexplainedGaps,[]);
 assert.deepEqual(result.removedFromUnresolved.sort(),[...IDS].sort(),'exactly the eight targets leave unresolved');
 log('PASS actual cumulative consumer '+JSON.stringify(transitions.map(t=>t.id+':'+t.beforeStatus+'->'+t.afterStatus))+' unresolvedPrior='+result.before.unresolvedPriorArchives+'->'+result.after.unresolvedPriorArchives+' selfOwners='+owners.length+' nonTargetDifferences=0 FULL_TASK_PASS=false');
}
const CONTROLS={
 'deleted-proof':{file:'scale-checkpoints.json',mutate:f=>fs.rmSync(f),reason:/^deleted-proof:scale-checkpoints\.json$/},
 'tampered-proof':{file:'checkpoints.json',mutate:f=>fs.appendFileSync(f,' '),reason:/^tampered-proof:checkpoints\.json/},
};
function control(id,work){
 const spec=CONTROLS[id];assert(spec,'unknown control');const sel=A.read(path.join(work,'selection.json')),copy=path.join(work,'controls',id);
 assert(!fs.existsSync(copy),'fresh control');fs.cpSync(sel.selected,copy,{recursive:true});spec.mutate(path.join(copy,spec.file));
 console.log('CONTROL '+id+' mutated '+path.join(copy,spec.file));
 const {tasks,research}=inputs(),task=tasks.find(t=>t.id==='TASK-213');
 // Layer 1: the consumer preflight rejects before any inventory is produced.
 let error;try{preflight({...sel,selected:copy},task);}catch(e){error=e;}
 if(!error||!spec.reason.test(error.message)){console.log('UNEXPECTED '+(error?error.message:'ACCEPT'));process.exit(3);}
 console.log('REJECT consumer-preflight reason='+error.message.split('\n')[0]);
 // Layer 2: bypass preflight; the root cumulative consumer must refuse all eight.
 const run=A.inspectRun(task,copy);
 const {after}=consumeBoth(tasks,research,priors(),retainedRows(),A.inspectRun(task,RETAINED_RUN),sel.rows,run);
 const out=IDS.map(i=>after.criteria.find(r=>r.id===i));
 console.log('REJECT root-consumer runHistoricalValid='+run.historicalValid+' runIssues='+JSON.stringify(run.issues));
 for(const r of out)console.log('REJECT root-consumer '+r.id+' status='+r.status+' covered='+r.covered+' reason='+r.reason);
 if(out.some(r=>r.covered||r.status==='covered-current')){console.log('UNEXPECTED root-consumer covered');process.exit(3);}
 process.exit(1);
}
if(require.main===module){
 const [mode,...args]=process.argv.slice(2);
 if(mode==='provider')provider(path.resolve(args[0]));
 else if(mode==='consume')consume(...args.map(a=>path.resolve(a)));
 else if(mode==='control')control(args[0],path.resolve(args[1]));
 else throw new Error('usage: provider <out> | consume <refresh> <work> <evidence> | control <id> <work>');
}
module.exports={provider,consume,control,rebind,identities,preflight,consumeBoth,IDS,RETAINED,RETAINED_RUN};
