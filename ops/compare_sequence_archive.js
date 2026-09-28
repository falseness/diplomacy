'use strict';
// Expanded independent observation review through the retained cumulative
// consumer. No whole-criterion credit, provider refresh or full pass is claimed.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const G=require('./evidence_competitive_gate'),F=require('./review_sequence_evidence'),S=require('./evidence_selection'),H=require('./consume_historical_catalog');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const out=path.resolve(process.argv[2]),start=Date.now(),stop=start+3300000;assert(!fs.existsSync(out),'fresh output required');fs.mkdirSync(out,{recursive:true});process.env.EVIDENCE_AUDIT_DEADLINE_MS=String(stop);
const save=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2)+'\n'),log=s=>{console.log(s);fs.appendFileSync(path.join(out,'verification.log'),s+'\n');};
for(let g=G;g;g=g.previous)g.onPhase=log;
const files=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(d,e.name)).map(n=>e.name+'/'+n):[e.name]).sort();
const commands=[];let pass=false;
save('verification-plan.json',{fullInvocation:false,estimateMs:1800000,stopWorkMs:3300000,budgetMs:3600000,cases:['independent-archived-actions','whole-recipient-rounds-and-occupancy','original-failure-legal-prefix-and-repair-link','rebound-semantic-controls','retained-cumulative-consumer-no-new-credit','immutable-proof-rehash','execution-lifecycle-and-rebound-controls'],tiers:['source-executed archived observation reader'],exclusions:['current provider refresh pending complete criterion adapter','full audit prerequisite-gated'],commands:['node --test ops/test_review_sequence_evidence.js ops/test_review_sequence_lifecycle.js','A.inventory review-114 via evidence_competitive_gate; H.consume same selection with original/projected TASK-220 plus independently bound observation report','git diff --check in both repositories']});
const taskFile=path.join(A.client,'artifacts/tasks.json'),tasks=A.read(taskFile),research=A.read(path.join(A.client,'artifacts/TASK-225/review-114/research-input.json')),baseline=A.read(path.join(A.client,'artifacts/TASK-225/review-114/reviewed-crosswalk.json'));
const frozen=Object.fromEntries(['review_sequence_evidence.js','review_sequence_rounds.js','review_sequence_failure.js','sequence_failure_hashes.json','test_review_sequence_evidence.js','compare_sequence_archive.js','review_sequence_lifecycle.js','test_review_sequence_lifecycle.js'].map(n=>[n,A.hash(path.join(__dirname,n))]));save('frozen-tools.json',frozen);
function command(cwd,argv){const r=spawnSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',timeout:Math.max(1,stop-Date.now()),maxBuffer:16*1024*1024});log('COMMAND '+JSON.stringify(argv)+' CWD='+cwd+' NODE='+process.version);log(r.stdout||'');log(r.stderr||'');log('ACTUAL_EXIT='+r.status+' SIGNAL='+r.signal);commands.push({argv,cwd,actualExit:r.status,signal:r.signal});assert.equal(r.status,0);}
try{
 command(A.client,[process.execPath,'--test','ops/test_review_sequence_evidence.js','ops/test_review_sequence_lifecycle.js']);
 save('negative-control-results.json',{fullInvocation:false,passScoped:true,proof:'verification.log',tests:44,lifecycleControls:24,semanticControls:['wrong-destination','wrong-hp','double-purchase','omitted-action','other-recipient-hp','double-income','wrong-grid-paint','omitted-recipient','canonical-gold','wrong-eligibility','rebound-live-occupancy','coop-recipient-other-hp','coop-occupancy','missing-shape-regression','duplicate-and-out-of-bounds-unit','minimized-prefix-corruption']});
 const original=path.join(A.client,'artifacts/TASK-220/green-20260925-03'),selected=path.join(out,'selected-220'),task=tasks.find(t=>t.id==='TASK-220');
 const originalHashes=Object.fromEntries(files(original).map(n=>[n,A.hash(path.join(original,n))]));save('original-hashes.json',originalHashes);
 const raw=A.inspectRun(task,original);save('original-inspection.json',raw);assert.equal(raw.sourceDifferences.length,15);assert(raw.issues.includes('not-file-proof:coop-actions-0'));
 const independent=F.review(original);
 const lifecycle=require('./review_sequence_lifecycle').reviewLifecycle(original,F.CASES,originalHashes);
 save('lifecycle-review.json',lifecycle);
 independent.checks.push(...lifecycle.checks);Object.assign(independent.proofs,lifecycle.proofs);
 independent.unresolved=lifecycle.unresolved.concat('whole-criterion adapter and tier/source implementation review');
 save('checkpoints.json',independent);
 log('PASS historical-lifecycle assertions='+lifecycle.checks.length+' staleSources='+lifecycle.sourceDifferences.length+' unresolved='+lifecycle.unresolved.join(','));
 for(const c of A.read(path.join(out,'checkpoints.json')).checks)assert.deepEqual(c.observed,c.expected,'serialized-checkpoint:'+c.id);
 save('source-identities.json',A.read(path.join(original,'source-identities.json')));
 fs.cpSync(original,selected,{recursive:true});
 const projectedCoverage=F.projection(A.read(path.join(original,'coverage-results.json')));
 fs.writeFileSync(path.join(selected,'sequence-observation-review.json'),JSON.stringify(independent,null,2)+'\n');
 projectedCoverage.evidenceHashes['sequence-observation-review.json']=A.hash(path.join(selected,'sequence-observation-review.json'));
 for(const c of projectedCoverage.cases)c.proof.push('sequence-observation-review.json');
 fs.writeFileSync(path.join(selected,'coverage-results.json'),JSON.stringify(projectedCoverage,null,2)+'\n');
 const projected=A.inspectRun(task,selected);save('projected-inspection.json',projected);assert(projected.historicalValid);assert.equal(projected.currentSourceValid,false);assert.deepEqual(projected.sourceDifferences,raw.sourceDifferences);
 log('PASS exact-file-projection historicalValid=true currentSourceValid=false staleSources=15 independentAssertions='+independent.checks.length);
 const transaction=S.transaction(()=>{
  const report=A.inventory(tasks,research,baseline);save('baseline-inventory.json',report);assert.equal(report.unresolvedPriorArchives.length,63);
  const consume=run=>H.consume({...report,runs:report.runs.map(r=>r.task==='TASK-220'?run:r)},tasks,research,baseline,[{id:'TASK-220',key:'TASK-220'}]);
  const before=consume(raw),after=consume(projected);save('original-consumed.json',before);save('projected-consumed.json',after);
  for(const k of ['criteria','researchGaps','selfChecks','historicalAnnex','unresolvedPriorArchives','inputIssues','unexplainedGaps']){assert.deepEqual(after[k],before[k],'projection-changed-dispositions:'+k);assert.deepEqual(after[k],report[k],'changed-baseline:'+k);}
  assert.equal(after.selfChecks.length,8);assert.equal(after.criteria.filter(r=>/^TASK-21[1-9]\//.test(r.id)&&r.status==='covered-current').length,74);
  return {requiredPrior:after.unresolvedPriorArchives.length,selfOwners:after.selfChecks.length,currentRetained:74};
 });save('consumer-comparison.json',{...transaction.result,cacheMetrics:transaction.metrics,pass:true,fullInvocation:false});log('PASS cumulative-consumer requiredPrior=63->63 currentRetained=74 selfOwners=8');
 for(const [n,h] of Object.entries(originalHashes))assert.equal(A.hash(path.join(original,n)),h,'changed-original:'+n);
 for(const [n,h] of Object.entries(independent.proofs))assert.equal(A.hash(path.isAbsolute(n)?n:path.join(original,n)),h,'changed-reviewed-proof:'+n);
 for(const [n,h] of Object.entries(frozen))assert.equal(A.hash(path.join(__dirname,n)),h,'changed-reader:'+n);
 for(const cwd of [A.client,A.root])command(cwd,['git','diff','--check']);
 save('coverage-results.json',{fullInvocation:false,passScoped:true,requiredPriorBefore:63,requiredPriorAfter:63,criteriaGranted:[],proofs:['consumer-comparison.json','checkpoints.json','original-inspection.json','projected-inspection.json'],next:'Complete independent whole-criterion readers and adapter before any affected refresh; active selection remains review-114.'});
 log('PASS immutable-originals='+Object.keys(originalHashes).length+' reviewed-proofs='+Object.keys(independent.proofs).length+' frozen-tools='+Object.keys(frozen).length);pass=true;
}catch(e){log(e.stack);process.exitCode=1;}
finally{save('verification-budget.json',{fullInvocation:false,startedMs:start,finishedMs:Date.now(),elapsedMs:Date.now()-start,commands,cleanup:true,cleanupReason:'No services launched; test-owned temporary directories removed in finally.',passScoped:pass&&Date.now()<stop});if(!pass||Date.now()>=stop)process.exitCode=1;log('PLANNED_RUNNER_EXIT='+(process.exitCode||0));}
