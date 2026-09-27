'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const G=require('./evidence_fog_records_gate'),E=require('./evidence_fog_records');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const baseline=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]),start=Date.now(),stop=start+3300000;
assert(!fs.existsSync(out),'fresh-directory-required');fs.mkdirSync(out,{recursive:true});process.env.EVIDENCE_AUDIT_DEADLINE_MS=String(stop);
const save=(n,x)=>fs.writeFileSync(path.join(out,n),JSON.stringify(x,null,2)+'\n');
const log=s=>{console.log(s);fs.appendFileSync(path.join(out,'verification.log'),s+'\n');};
G.onPhase=log;G.previous.onPhase=log;G.previous.previous.onPhase=log;
const commands=[],controls=[],criteria=[4,5,6,7,8];let pass=false;
function run(cwd,argv){assert(Date.now()<stop,'deadline');log('COMMAND '+JSON.stringify(argv)+' CWD='+cwd);const r=spawnSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',timeout:Math.max(1,stop-Date.now()),maxBuffer:32*1024*1024});log(r.stdout||'');log(r.stderr||'');log('ACTUAL_EXIT='+r.status+' SIGNAL='+r.signal);commands.push({cwd,argv,actualExit:r.status,signal:r.signal});assert.equal(r.status,0);}
try{
 log('COMMAND '+JSON.stringify([process.execPath,...process.argv.slice(1)])+' CWD='+process.cwd()+' NODE='+process.version);
 save('verification-plan.json',{fullInvocation:false,estimateMs:1500000,stopWorkMs:3300000,budgetMs:3600000,baseline:{file:baseline,sha256:A.hash(baseline)},criteria:criteria.map(n=>'TASK-212/AC'+n),cases:['18-semantic-rejections','seven-consumer-rejections','five-complete-criteria','non-target-and-self-invariance','source-proof-audit','paired-diff-checks'],commands:['node --test ops/test_review_fog_records.js','A.inventory using evidence_fog_records_gate.js','git diff --check in both repositories','final fresh proof/source audit'],tiers:['source-executed independent record review of original real browser/network evidence'],exclusions:['no services or provider refresh','full TASK-225 gate prohibited until zero unresolved local targets']});
 const tasks=A.read(path.join(A.client,'artifacts/tasks.json')),research=A.read(path.join(A.client,'artifacts/TASK-225/review-78/research-input.json'));save('task-input.json',tasks);save('research-input.json',research);
 run(A.client,[process.execPath,'--test','ops/test_review_fog_records.js']);
 const input=E.prepare(tasks,baseline,path.join(out,'selected-212'),criteria);save('reviewed-crosswalk.json',input);
 for(const [id,mutate,pattern] of [
  ['deleted-proof',s=>fs.unlinkSync(path.join(s.selected,'visibility-checkpoints.json')),/ENOENT/],
  ['tampered-proof',s=>fs.appendFileSync(path.join(s.selected,'checkpoints.json'),' '),/evidence-hash-mismatch/],
  ['wrong-owner',s=>s.criteria=[4,4],/wrong-fog-record-owner/],
  ['wrong-receipt',s=>s.receipt.sha256='0'.repeat(64),/wrong-fog-record-receipt/],
  ['wrong-release',s=>s.baseline.sha256='0'.repeat(64),/changed-fog-record-baseline/],
  ['omitted-retained-row',(_,x)=>x.reviews=x.reviews.filter(r=>r.id!=='TASK-211/AC4'),/changed-fog-record-retained-selection/],
  ['wrong-annex',(_,x)=>x.evidenceSelection.annex.sha256='0'.repeat(64),/changed-fog-record-retained-selection/]
 ]){assert(Date.now()<stop,'control-deadline');const x=structuredClone(input),copy=path.join(out,'control-'+id);fs.cpSync(x.fogRecords.selected,copy,{recursive:true});x.fogRecords.selected=copy;mutate(x.fogRecords,x);let reason;try{A.inventory(tasks,research,x);}catch(e){reason=e.message;}assert(reason&&pattern.test(reason),id+': '+reason);controls.push({id,pass:true,reason:reason.split('\n')[0]});log('PASS rejects '+id+' '+reason.split('\n')[0]);}
 save('negative-control-results.json',{controls});
 const report=A.inventory(tasks,research,input),meta=G.last;
 assert.deepEqual([meta.before.unresolvedPriorArchives.length,report.unresolvedPriorArchives.length],[126,121]);assert.equal(report.selfChecks.length,8);
 for(const t of meta.transitions)assert.equal(t.status,'covered-current');
 save('current-inventory.json',report);save('before-inventory.json',meta.before);save('criterion-transitions.json',meta.transitions);save('phase-times.json',meta.phases);save('checkpoints.json',{checks:meta.reports.flatMap(r=>r.checks)});
 save('source-identities.json',A.read(path.join(input.fogRecords.selected,'source-identities.json')));
 save('remaining-clause-plan.json',{requiredPrior:report.unresolvedPriorArchives,selfChecks:report.selfChecks,followUps:report.followUps,historicalObligations:report.historicalAnnex.retainedObligations,fullAuditReady:false,selection:path.join(out,'reviewed-crosswalk.json'),preload:path.join(A.client,'ops/evidence_fog_records_gate.js')});
 for(const cwd of [A.client,A.root])run(cwd,['git','diff','--check']);
 E.preflight(tasks,input);assert.deepEqual(A.compareSources(A.read(path.join(input.fogRecords.selected,'source-identities.json'))),[]);
 const names=['review_fog_records.js','test_review_fog_records.js','evidence_fog_records.js','evidence_fog_records_gate.js','run_fog_records.js'];
 const toolHashes=Object.fromEntries(names.map(n=>['ops/'+n,A.hash(path.join(__dirname,n))]));save('frozen-tools.json',toolHashes);
 save('coverage-results.json',{fullInvocation:false,passScoped:true,requiredPriorBefore:126,requiredPriorAfter:121,toolHashes,cases:meta.transitions.map(t=>({...t,pass:true,proof:'criterion-transitions.json'}))});
 log('PASS fog complete AC4/5/6/7/8 requiredPrior=126->121 selfChecks=8 controls=7');log('INCOMPLETE TASK-225 full gate prerequisite-gated requiredPrior=121');pass=true;
}catch(e){log(e.stack);process.exitCode=1;}
finally{save('verification-budget.json',{fullInvocation:false,startedMs:start,finishedMs:Date.now(),elapsedMs:Date.now()-start,commands,cleanup:true,passScoped:pass&&Date.now()<stop});if(!pass||Date.now()>=stop)process.exitCode=1;log('PLANNED_RUNNER_EXIT='+(process.exitCode||0));}
