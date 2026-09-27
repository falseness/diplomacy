'use strict';
// Revalidate an explicit cumulative selection without rerunning its provider.
// The external supervisor, not this program's planned exit log, owns the final
// OS exit receipt. A failed wrapper remains a failed invocation.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const G=require('./evidence_fog_gate'),F=require('./evidence_fog_selection');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const selectionFile=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]),start=Date.now(),stop=start+3300000;
assert(!fs.existsSync(out),'fresh directory required');fs.mkdirSync(out,{recursive:true});process.env.EVIDENCE_AUDIT_DEADLINE_MS=String(stop);
const save=(n,x)=>fs.writeFileSync(path.join(out,n),JSON.stringify(x,null,2)+'\n');
const log=s=>{console.log(s);fs.appendFileSync(path.join(out,'verification.log'),s+'\n');};G.onPhase=log;G.previous.onPhase=log;
const commands=[],controls=[];let pass=false;
function run(cwd,argv){assert(Date.now()<stop,'deadline');log('COMMAND '+JSON.stringify(argv)+' CWD='+cwd);const r=spawnSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',timeout:Math.max(1,stop-Date.now()),maxBuffer:32*1024*1024});log(r.stdout||'');log(r.stderr||'');log('ACTUAL_EXIT='+r.status+' SIGNAL='+r.signal);commands.push({cwd,argv,actualExit:r.status,signal:r.signal});assert.equal(r.status,0);}
try{
 log('COMMAND '+JSON.stringify([process.execPath,...process.argv.slice(1)])+' CWD='+process.cwd()+' NODE='+process.version);
 const input=A.read(selectionFile),tasks=A.read(path.join(A.client,'artifacts/tasks.json')),research=A.read(path.join(A.client,'artifacts/TASK-225/review-75/research-input.json'));
 save('verification-plan.json',{fullInvocation:false,estimateMs:1200000,stopWorkMs:3300000,budgetMs:3600000,selection:{file:selectionFile,sha256:A.hash(selectionFile)},cases:['semantic-tests','seven-consumer-rejections','complete-AC1','complete-AC2','complete-AC3','non-target-and-self-invariance','paired-diff-checks','source-proof-audit'],commands:['node --test ops/test_review_fog_visibility.js','actual inventory-boundary consumer and seven controls','git diff --check in both repositories','final fresh proof/source validation'],tiers:['independent source-executed review of retained real browser/network provider'],exclusions:['no new provider or services','full TASK-225 gate remains prerequisite-gated'],reason:'The previous launch shell exited 143 after finalized reports. Its provider command has a separately observed spawn exit zero. Revalidate the same frozen provider and all transitions; obtain an external OS exit receipt without repeating gameplay.'});
 save('task-input.json',tasks);save('research-input.json',research);save('reviewed-crosswalk.json',input);
 run(A.client,[process.execPath,'--test','ops/test_review_fog_visibility.js']);
 // Bind the actual provider command receipt separately from its failed outer
 // launch. Never accept a provider pass flag in place of the measured exit.
 const provider=input.fogSelection.original,receiptFile=path.join(path.dirname(provider),'verification-budget.json'),receipt=A.read(receiptFile);
 const providerCommands=receipt.commands.filter(c=>c.argv.includes('fog-recovery')&&c.argv.at(-1)===provider);
 assert.equal(providerCommands.length,1);assert.equal(providerCommands[0].actualExit,0);assert.equal(providerCommands[0].signal,null);
 save('provider-command-receipt.json',{file:receiptFile,sha256:A.hash(receiptFile),command:providerCommands[0],outerWrapperPassClaim:false});
 for(const [id,mutate,pattern] of [
  ['deleted-proof',s=>fs.unlinkSync(path.join(s.selected,'visibility-checkpoints.json')),/ENOENT/],
  ['tampered-proof',s=>fs.appendFileSync(path.join(s.selected,'checkpoints.json'),' '),/evidence-hash-mismatch/],
  ['wrong-owner',s=>s.criteria=[1,2,4],/wrong-fog-owner/],
  ['wrong-release',s=>s.coverageSha256='0'.repeat(64),/wrong-fog-release/],
  ['escaped-provider',s=>s.original='/tmp',/escaped-fog-provider/],
  ['wrong-annex',(_,x)=>x.evidenceSelection.annex.sha256='0'.repeat(64),/omitted-or-changed-fog-retained-row/],
  ['omitted-retained-row',(_,x)=>x.reviews=x.reviews.filter(r=>r.id!=='TASK-211/AC4'),/omitted-or-changed-fog-retained-row/]
 ]){assert(Date.now()<stop,'control deadline');const x=structuredClone(input),copy=path.join(out,'control-'+id);fs.cpSync(x.fogSelection.selected,copy,{recursive:true});x.fogSelection.selected=copy;mutate(x.fogSelection,x);let reason;try{A.inventory(tasks,research,x);}catch(e){reason=e.message;}assert(reason&&pattern.test(reason),id+': '+reason);controls.push({id,pass:true,reason:reason.split('\n')[0]});log('PASS rejects '+id+' '+reason.split('\n')[0]);}
 save('negative-control-results.json',{controls});
 const report=A.inventory(tasks,research,input),meta=G.last;assert.deepEqual([meta.before.unresolvedPriorArchives.length,report.unresolvedPriorArchives.length],[129,126]);
 save('current-inventory.json',report);save('before-inventory.json',meta.before);save('criterion-transitions.json',meta.transitions);save('checkpoints.json',{checks:meta.independent.checks});save('phase-times.json',meta.phases);
 save('source-identities.json',A.read(path.join(provider,'source-identities.json')));
 save('remaining-clause-plan.json',{requiredPrior:report.unresolvedPriorArchives,selfChecks:report.selfChecks,followUps:report.followUps,historicalObligations:report.historicalAnnex.retainedObligations,fullAuditReady:false,selection:path.join(out,'reviewed-crosswalk.json'),preload:path.join(A.client,'ops/evidence_fog_gate.js')});
 for(const cwd of [A.client,A.root])run(cwd,['git','diff','--check']);
 assert(F.preflight(tasks,input).run.currentSourceValid);
 const names=['review_fog_visibility.js','test_review_fog_visibility.js','evidence_fog_selection.js','evidence_fog_gate.js','run_fog_review.js','verify_fog_selection.js'];
 const toolHashes=Object.fromEntries(names.map(n=>['ops/'+n,A.hash(path.join(__dirname,n))]));save('frozen-tools.json',toolHashes);
 save('coverage-results.json',{fullInvocation:false,passScoped:true,requiredPriorBefore:129,requiredPriorAfter:126,toolHashes,cases:meta.transitions.map(t=>({...t,pass:true,proof:'criterion-transitions.json'}))});
 log('PASS fog complete AC1/2/3 requiredPrior=129->126 selfChecks=8 controls=7');log('INCOMPLETE TASK-225 full gate prerequisite-gated requiredPrior=126');pass=true;
}catch(e){log(e.stack);process.exitCode=1;}
finally{save('verification-budget.json',{fullInvocation:false,startedMs:start,finishedMs:Date.now(),elapsedMs:Date.now()-start,commands,cleanup:true,passScoped:pass&&Date.now()<stop});if(!pass||Date.now()>=stop)process.exitCode=1;log('PLANNED_RUNNER_EXIT='+(process.exitCode||0));}
