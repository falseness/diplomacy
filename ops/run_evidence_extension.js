'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const G=require('./evidence_selection_gate'),E=require('./evidence_selection_extensions'),S=require('./evidence_selection');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const kinds=process.argv[3]?process.argv[3].split(','):['asset-records'];
const out=path.resolve(process.argv[2]),start=Date.now(),deadline=start+3300000;process.env.EVIDENCE_AUDIT_DEADLINE_MS=String(deadline);
assert(!fs.existsSync(out),'fresh directory required');fs.mkdirSync(out,{recursive:true});
const save=(n,x)=>fs.writeFileSync(path.join(out,n),JSON.stringify(x,null,2)+'\n');
const log=s=>{console.log(s);fs.appendFileSync(path.join(out,'verification.log'),s+'\n');};
G.onPhase=log;
const commands=[],controls=[],checks=[];
function run(cwd,args){log('COMMAND '+JSON.stringify(args)+' CWD='+cwd);const r=spawnSync(args[0],args.slice(1),{cwd,encoding:'utf8',timeout:Math.max(1,deadline-Date.now()),maxBuffer:32*1024*1024});log((r.stdout||'')+(r.stderr||''));log('ACTUAL_EXIT='+r.status);commands.push({cwd,args,actualExit:r.status,signal:r.signal});assert.equal(r.status,0);}
function check(id,expected,observed){assert.deepEqual(observed,expected,id);checks.push({id,expected,observed,pass:true});log('PASS '+id);}
save('verification-plan.json',{fullInvocation:false,estimateMs:1200000,budgetMs:3600000,stopWorkMs:3300000,selectedExtensions:kinds,cases:['retained-selection',...kinds.map(k=>'complete/'+k),'independent-without-with-transitions','all-other-dispositions-retained','eight-self-checks','cache-mutation','canonical-containment','omitted-command','truncated-output','wrong-runtime','credential-leak','false-checkpoint','missing-capture','timeout','unexpected-browser-error','wrong-negative-reason','fake-tier','one-context','substituted-ai','elapsed-reset','live-owned-process','missing-required-case','deleted-proof','tampered-proof','wrong-owner','wrong-parent-receipt'],commands:['node --test ops/test_evidence_selection.js ops/test_review_asset_records.js ops/test_review_asset_requirements.js','actual A.inventory boundary with explicit complete extension','git diff --check (both repositories)','proof/source/assertion audit'],tiers:['source-executed record review','retained browser/network evidence; no new journeys'],exclusions:['full gate gated on zero remaining local targets','no provider refresh or services']});
let pass=false;
process.on('SIGTERM',()=>{save('signal-receipt.json',{signal:'SIGTERM',elapsedMs:Date.now()-start,pass:false});process.exit(143);});
try{
 log('COMMAND '+JSON.stringify([process.execPath,...process.argv.slice(1)])+' CWD='+process.cwd()+' NODE='+process.version);
 run(A.client,[process.execPath,'--test','ops/test_evidence_selection.js','ops/test_review_asset_records.js','ops/test_review_asset_requirements.js']);
 const tasks=A.read(path.join(A.client,'artifacts/tasks.json')),research=A.read(path.join(S.BASE,'research-input.json'));
 save('task-input.json',tasks);save('research-input.json',research);
 const input=E.prepare(tasks,research,path.join(out,'prepared'),kinds);save('reviewed-crosswalk.json',input);
 for(const [id,mutate,pattern] of [
  ['deleted-proof',s=>fs.unlinkSync(path.join(s.extensions.prepared,'selected-211/persistence-checkpoints.json')),/ENOENT/],
  ['tampered-proof',s=>fs.appendFileSync(path.join(s.extensions.prepared,'selected-211/asset-events.jsonl'),'{}\n'),/evidence-hash-mismatch/],
  ['wrong-owner',s=>{s.extensions.reviews[0].id='TASK-211/AC5';},/wrong-extension-owner-or-receipt/],
  ['wrong-parent-receipt',s=>{s.extensions.reviews[0].receipt.sha256='0'.repeat(64);},/wrong-extension-owner-or-receipt/]
 ]){
  assert(Date.now()<deadline,'cumulative deadline');const copy=path.join(out,'control-'+id);fs.cpSync(input.evidenceSelection.extensions.prepared,copy,{recursive:true});
  const x=structuredClone(input);x.evidenceSelection.extensions.prepared=copy;mutate(x.evidenceSelection);
  const began=Date.now();let reason;try{A.inventory(tasks,research,x);}catch(e){reason=e.message;}
  assert(reason&&pattern.test(reason),id+': '+reason);controls.push({id,pass:true,reason:reason.split('\n')[0],elapsedMs:Date.now()-began});log('PASS rejects '+id+' '+reason.split('\n')[0]);
 }
 log('BEGIN actual gate inventory with complete '+kinds.join(','));const report=A.inventory(tasks,research,input),meta=G.last;
 save('current-inventory.json',report);save('before-inventory.json',meta.before);save('phase-times.json',{phases:meta.phases,metrics:meta.metrics});save('criterion-transitions.json',meta.transitions);
 check('without-with-complete-criteria',[133,133-kinds.length],[meta.before.unresolvedPriorArchives.length,report.unresolvedPriorArchives.length]);
 for(const row of input.evidenceSelection.extensions.reviews)check('complete-'+row.id+'-covered-current','covered-current',report.criteria.find(r=>r.id===row.id).status);
 check('AC4-transition',[133,132],[meta.transitions[0].before,meta.transitions[0].after]);
 check('self-checks',8,report.selfChecks.length);check('zero-input-issues',[],report.inputIssues);check('zero-unexplained',[],report.unexplainedGaps);
 check('retained-AC1-AC2-AC3-AC7',['covered-current','covered-current','covered-current','covered-current'],[1,2,3,7].map(n=>report.criteria.find(r=>r.id==='TASK-211/AC'+n).status));
 for(const c of meta.reports.flatMap(r=>r.checks))check(c.id,c.expected,c.observed);
 save('checkpoints.json',{checks});save('negative-control-results.json',{controls,semanticTests:15,proof:'verification.log'});
 save('source-identities.json',A.read(path.join(input.evidenceSelection.extensions.prepared,'selected-211/source-identities.json')));
 save('remaining-clause-plan.json',{requiredPrior:report.unresolvedPriorArchives,selfChecks:report.selfChecks,followUps:report.followUps,historicalObligations:report.historicalAnnex.retainedObligations,fullAuditReady:false,selection:path.join(out,'reviewed-crosswalk.json'),preload:path.join(A.client,'ops/evidence_selection_gate.js')});
 run(A.client,[process.execPath,'ops/inspect_evidence_remaining.js',path.join(out,'current-inventory.json'),path.join(out,'remaining-inspection.json')]);
 for(const cwd of [A.client,A.root])run(cwd,['git','diff','--check']);
 const tools=['evidence_selection.js','evidence_selection_extensions.js','evidence_selection_gate.js','review_asset_records.js','run_evidence_extension.js','test_evidence_selection.js','test_review_asset_records.js','review_asset_requirements.js','test_review_asset_requirements.js','inspect_evidence_remaining.js'];
 save('coverage-results.json',{fullInvocation:false,passScoped:true,requiredPriorBefore:133,requiredPriorAfter:133-kinds.length,cases:checks.map(c=>({id:c.id,pass:c.pass,proof:'checkpoints.json'})),toolHashes:Object.fromEntries(tools.map(n=>['ops/'+n,A.hash(path.join(__dirname,n))]))});
 log('PASS complete '+kinds.join(',')+' requiredPrior=133->'+(133-kinds.length)+' retainedAC1/2/3/7=covered-current selfChecks=8 controls=4');log('INCOMPLETE TASK-225 full gate prerequisite-gated; '+(133-kinds.length)+' prior targets unresolved');pass=true;
}catch(e){log(e.stack);process.exitCode=1;}
finally{save('verification-budget.json',{fullInvocation:false,startedMs:start,finishedMs:Date.now(),elapsedMs:Date.now()-start,passScoped:pass&&Date.now()<deadline,cleanup:true,commands});if(!pass||Date.now()>=deadline)process.exitCode=1;log('PARENT_ACTUAL_EXIT='+(process.exitCode||0));}
