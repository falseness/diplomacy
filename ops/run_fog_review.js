'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const G=require('./evidence_fog_gate'),F=require('./evidence_fog_selection');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const out=path.resolve(process.argv[2]),start=Date.now(),stop=start+3300000;
assert(!fs.existsSync(out),'fresh run required');fs.mkdirSync(out,{recursive:true});
process.env.EVIDENCE_AUDIT_DEADLINE_MS=String(stop);
const save=(n,x)=>fs.writeFileSync(path.join(out,n),JSON.stringify(x,null,2)+'\n');
const log=s=>{console.log(s);fs.appendFileSync(path.join(out,'verification.log'),s+'\n');};
G.onPhase=log;G.previous.onPhase=log;
const commands=[],controls=[],toolNames=['review_fog_visibility.js','test_review_fog_visibility.js','evidence_fog_selection.js','evidence_fog_gate.js','run_fog_review.js'];
const toolHashes=()=>Object.fromEntries(toolNames.map(n=>['ops/'+n,A.hash(path.join(__dirname,n))]));
const frozen=toolHashes();let pass=false,cleanup=true;
function run(cwd,argv){
 assert(Date.now()<stop,'cumulative deadline');log('COMMAND '+JSON.stringify(argv)+' CWD='+cwd);
 const began=Date.now(),r=spawnSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',timeout:Math.max(1,stop-Date.now()),maxBuffer:32*1024*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 log(r.stdout||'');log(r.stderr||'');log('ACTUAL_EXIT='+r.status+' SIGNAL='+r.signal);
 commands.push({cwd,argv,startedMs:began,finishedMs:Date.now(),actualExit:r.status,signal:r.signal,error:r.error?.message});assert.equal(r.status,0,'required command failed');
}
const tasks=A.read(path.join(A.client,'artifacts/tasks.json')),research=A.read(path.join(A.client,'artifacts/TASK-225/review-75/research-input.json'));
save('task-input.json',tasks);save('research-input.json',research);save('frozen-tools.json',frozen);
save('verification-plan.json',{fullInvocation:false,estimateMs:1500000,stopWorkMs:3300000,budgetMs:3600000,cases:['source-competitive-clear','source-competitive-fog','source-coop-clear','source-coop-fog','coop-fog','competitive-clear','retained-historical-reader','complete-AC1','complete-AC2','complete-AC3','consumer-controls'],tiers:['shipped source independent visibility','two shipped-browser HTTPS/Socket.IO/MongoDB journeys','independent persisted proof review'],exclusions:['full audit remains gated on all required local targets','no new class/fog/browser Cartesian matrix','no G18 whole-match closure'],commands:['independent reader semantic controls','old provider inspection and explicit proof projection','one affected fog-recovery provider refresh','same inventory-boundary cumulative selection and rejection controls','paired diff and source/proof audit'],reason:'TASK-212 archive has 18 current-source mismatches and missing per-case proof references. Freeze reader and syntax-only projection before this bounded affected refresh; retain immutable historical evidence.'});
try{
 log('COMMAND '+JSON.stringify([process.execPath,...process.argv.slice(1)])+' CWD='+process.cwd()+' NODE='+process.version);
 run(A.client,[process.execPath,'--test','ops/test_review_fog_visibility.js']);
 const historical=F.prepare(tasks,path.join(A.client,'artifacts/TASK-212/green-11'),path.join(out,'historical'));
 const old=F.preflight(tasks,historical);assert.equal(old.run.currentSourceValid,false);save('historical-inspection.json',old.run);save('historical-selection.json',historical);
 log('PASS historical fog projection historicalValid=true currentSourceValid=false sourceDifferences='+old.run.sourceDifferences.length);
 const provider=path.join(out,'provider');cleanup=false;
 run(A.root,[process.execPath,'tests/reliability/run.js','--suite','fog-recovery','--output-dir',provider]);
 const budget=A.read(path.join(provider,'verification-budget.json'));cleanup=budget.cleanup===true;assert(budget.pass&&cleanup,'fog provider failed');
 assert.deepEqual(toolHashes(),frozen,'changed-reader-during-refresh');
 const input=F.prepare(tasks,provider,path.join(out,'prepared'));save('reviewed-crosswalk.json',input);
 const mutations=[
 ['deleted-proof',s=>fs.unlinkSync(path.join(s.selected,'visibility-checkpoints.json')),/ENOENT/],
 ['tampered-proof',s=>fs.appendFileSync(path.join(s.selected,'checkpoints.json'),' '),/evidence-hash-mismatch/],
 ['wrong-owner',s=>s.criteria=[1,2,4],/wrong-fog-owner/],
 ['wrong-release',s=>s.coverageSha256='0'.repeat(64),/wrong-fog-release/],
 ['escaped-provider',s=>s.original='/tmp',/escaped-fog-provider/],
 ['wrong-annex',(_,x)=>x.evidenceSelection.annex.sha256='0'.repeat(64),/omitted-or-changed-fog-retained-row/],
 ['omitted-retained-row',(_,x)=>x.reviews=x.reviews.filter(r=>r.id!=='TASK-211/AC4'),/omitted-or-changed-fog-retained-row/]
 ];
 for(const [id,mutate,pattern] of mutations){
  assert(Date.now()<stop,'control deadline');const x=structuredClone(input),copy=path.join(out,'control-'+id);fs.cpSync(x.fogSelection.selected,copy,{recursive:true});x.fogSelection.selected=copy;mutate(x.fogSelection,x);
  let reason;try{A.inventory(tasks,research,x);}catch(e){reason=e.message;}
  assert(reason&&pattern.test(reason),id+': '+reason);controls.push({id,pass:true,reason:reason.split('\n')[0]});log('PASS rejects '+id+' '+reason.split('\n')[0]);
 }
 save('negative-control-results.json',{controls,semanticTests:'verification.log'});
 const report=A.inventory(tasks,research,input),meta=G.last;
 save('current-inventory.json',report);save('before-inventory.json',meta.before);save('criterion-transitions.json',meta.transitions);save('phase-times.json',meta.phases);
 assert.deepEqual([meta.before.unresolvedPriorArchives.length,report.unresolvedPriorArchives.length],[129,126]);
 save('checkpoints.json',{checks:meta.independent.checks});
 save('remaining-clause-plan.json',{requiredPrior:report.unresolvedPriorArchives,selfChecks:report.selfChecks,followUps:report.followUps,historicalObligations:report.historicalAnnex.retainedObligations,fullAuditReady:false,selection:path.join(out,'reviewed-crosswalk.json'),preload:path.join(A.client,'ops/evidence_fog_gate.js')});
 save('source-identities.json',A.read(path.join(provider,'source-identities.json')));
 for(const cwd of [A.client,A.root])run(cwd,['git','diff','--check']);
 const ready=F.preflight(tasks,input);assert(ready.run.currentSourceValid);assert.deepEqual(toolHashes(),frozen);
 for(const cwd of [A.client,A.root]){const r=spawnSync('git',['diff','--cached','--name-only'],{cwd,encoding:'utf8'});assert.equal(r.status,0);assert(!r.stdout.split('\n').some(n=>n==='artifacts'||n.startsWith('artifacts/')));log('PASS artifacts-unstaged:'+cwd);}
 save('coverage-results.json',{fullInvocation:false,passScoped:true,requiredPriorBefore:129,requiredPriorAfter:126,toolHashes:frozen,cases:meta.transitions.map(t=>({...t,pass:true,proof:'criterion-transitions.json'})),sourceHashCount:Object.values(A.read(path.join(provider,'source-identities.json')).after).reduce((n,r)=>n+Object.keys(r.files).length,0)});
 log('PASS fog complete AC1/2/3 requiredPrior=129->126 selfChecks=8 controls=7');
 log('INCOMPLETE TASK-225: 126 required prior targets remain; full test steps 3/4/5/7 prerequisite-gated');pass=true;
}catch(e){log(e.stack);process.exitCode=1;}
finally{
 const provider=path.join(out,'provider/verification-budget.json');if(fs.existsSync(provider))cleanup=A.read(provider).cleanup===true;
 save('verification-budget.json',{fullInvocation:false,startedMs:start,finishedMs:Date.now(),elapsedMs:Date.now()-start,commands,cleanup,passScoped:pass&&cleanup&&Date.now()<stop});
 if(!pass||!cleanup||Date.now()>=stop)process.exitCode=1;log('PARENT_ACTUAL_EXIT='+(process.exitCode||0));
}
