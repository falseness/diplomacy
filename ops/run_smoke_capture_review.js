'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit'),C=require('./evidence_smoke_selection'),R=require('./review_smoke_capture');
const out=path.resolve(process.argv[2]),save=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2)+'\n');
const tasks=A.read('/root/diplomacy/artifacts/tasks.json'),retained=A.read('/root/diplomacy/artifacts/TASK-225/ac6-154/run-03/reviewed-crosswalk.json');
const receipt={file:path.join(out,'provider-exit.json'),sha256:A.hash(path.join(out,'provider-exit.json'))};
const selected=C.prepare(tasks,path.join(out,'provider'),receipt);C.preflight(tasks,selected);
const controls=[];
const reject=(id,fn,re)=>{let error;try{fn();}catch(e){error=e;}assert(error&&re.test(error.message),id+': '+error?.message);controls.push({id,pass:true,expected:String(re),observed:error.message});console.log('PASS reject '+id);};
for(const [id,mutate,re]of [
 ['wrong-run',x=>{x.directory=out;},/proof binding/],['tampered-proof',x=>{x.manifest['smoke-observations.json']='0'.repeat(64);},/proof binding/],['missing-proof',x=>{delete x.manifest['smoke-observations.json'];},/proof binding/],['partial-row',x=>{x.rows[0].clauses[0].assertions.pop();},/complete rows/],['changed-receipt',x=>{x.receipt.sha256='0'.repeat(64);},/receipt-hash/]
]){const x=structuredClone(selected);mutate(x);reject(id,()=>C.preflight(tasks,x),re);}
const raw=A.read(path.join(out,'provider/smoke-observations.json'));
for(const [id,mutate,re]of [
 ['forged-values',d=>{delete d.requests[1].extra.gameID;},/forged-values/],['wrong-session',d=>{d.requests[8].socketId='different';},/stable-session/],['wrong-expiry',d=>{d.allowlist.find(e=>e.run==='live').expiresAt=0;},/expiry/],['expired-state',d=>{d.expired.after.document.coopRevision=99;},/expired-state/],['omitted-turns',d=>{delete d.inventories['cleanup-before'].collections.turns;},/complete turns/],['changed-sentinel',d=>{d.inventories['cleanup-after'].other[0].value=999;},/other-database/],['orphan-omitted',d=>{d.inventories['cleanup-before'].collections.users=d.inventories['cleanup-before'].collections.users.filter(u=>u.gameID);},/orphan-inventory/],['source-as-network',d=>{d.tier='production-source';},/network-tier/]
]){const x=structuredClone(raw);mutate(x);reject(id,()=>R.semantic(x),re);}
controls.push(...A.negativeControls());save('negative-control-results.json',{fullInvocation:false,controls,pass:true});
save('checkpoints.json',{fullInvocation:false,checks:selected.report.checks});
save('smoke-selection.json',selected);
console.log('PASS smoke independent review assertions='+selected.report.checks.length+' controls='+controls.length);
const G=require('./evidence_smoke_gate');for(let g=G;g;g=g.previous)g.onPhase=m=>console.log(m);
const Hist=require('./historical_source_binding');process.on('exit',()=>{save('historical-source-observations.json',[...Hist.observations.values()]);save('historical-oracle-executions.json',Hist.oracleExecutions);});
const selection={...retained,smokeSelection:selected};
const after=A.inventory(tasks,A.read('/root/diplomacy/artifacts/TASK-225/review-114/research-input.json'),selection),result=G.last;
save('before-consumer.json',result.before);save('after-consumer.json',after);save('smoke-transitions.json',result.transitions);
const old=A.read('/root/diplomacy/artifacts/TASK-225/ac6-154/run-03/after-consumer.json');
save('freshness-changes.json',{priorRequired:old.unresolvedPriorArchives.length,currentBaselineRequired:result.before.unresolvedPriorArchives.length,changes:old.criteria.filter(r=>r.status!==result.before.criteria.find(n=>n.id===r.id)?.status).map(r=>({id:r.id,before:r.status,now:result.before.criteria.find(n=>n.id===r.id)?.status}))});
assert.deepEqual(after.inputIssues,[]);assert.deepEqual(after.unexplainedGaps,[]);
save('reviewed-crosswalk.json',selection);save('scoped-result.json',{scopePass:true,overallPass:false,transitions:result.transitions,remainingPrior:after.unresolvedPriorArchives.length,selfOwners:after.selfChecks.length});
console.log('PASS actual cumulative smoke '+JSON.stringify(result.transitions)+' FULL_TASK_PASS=false');
