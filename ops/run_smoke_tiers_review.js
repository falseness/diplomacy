'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit'),C=require('./evidence_smoke_tiers_selection');
const out=path.resolve(process.argv[2]),save=(n,x)=>fs.writeFileSync(path.join(out,n),JSON.stringify(x,null,2)+'\n');
const base='/root/diplomacy/artifacts/TASK-225/smoke-158/run-03',tasks=A.read('/root/diplomacy/artifacts/tasks.json');
const retained=A.read(path.join(base,'reviewed-crosswalk.json'));
const receipt={file:path.join(base,'provider-exit.json'),sha256:A.hash(path.join(base,'provider-exit.json'))};
const selected=C.prepare(tasks,path.join(base,'provider'),path.join(out,'projection'),receipt);C.preflight(tasks,selected);
const controls=[];
for(const [id,mutate,re]of [
 ['wrong-run',x=>x.original=out,/original smoke proof binding/],
 ['missing-proof',x=>delete x.originalFiles['smoke-observations.json'],/original smoke proof binding/],
 ['changed-proof',x=>x.originalFiles['smoke-observations.json']='0'.repeat(64),/original smoke proof binding/],
 ['partial-row',x=>x.row.clauses[0].assertions.pop(),/whole tier row/],
 ['changed-report',x=>x.report.clauses.pop(),/recomputed tier report/],
 ['changed-receipt',x=>x.receipt.sha256='0'.repeat(64),/receipt-hash/],
 ['unreviewed-tool',x=>x.toolHashes['review_smoke_tiers.js']='0'.repeat(64),/tier tool binding/]
]){const x=structuredClone(selected);mutate(x);let error;try{C.preflight(tasks,x);}catch(e){error=e;}assert(error&&re.test(error.message),id+': '+error?.message);controls.push({id,pass:true,expected:String(re),observed:error.message});console.log('PASS reject '+id);}
controls.push(...A.negativeControls());save('negative-control-results.json',{fullInvocation:false,pass:true,controls});save('checkpoints.json',{fullInvocation:false,checks:selected.report.checks});save('tier-selection.json',selected);
console.log('PASS independent tier review checks='+selected.report.checks.length+' controls='+controls.length);
const G=require('./evidence_smoke_tiers_gate');for(let g=G;g;g=g.previous)g.onPhase=m=>console.log(m);
const Hist=require('./historical_source_binding');process.on('exit',()=>{save('historical-source-observations.json',[...Hist.observations.values()]);save('historical-oracle-executions.json',Hist.oracleExecutions);});
const selection={...retained,smokeTiersSelection:selected};
const after=A.inventory(tasks,A.read('/root/diplomacy/artifacts/TASK-225/review-114/research-input.json'),selection),result=G.last;
save('before-consumer.json',result.before);save('after-consumer.json',after);save('tier-transition.json',result.transition);
const old=A.read(path.join(base,'after-consumer.json'));
save('freshness-changes.json',{priorRequired:old.unresolvedPriorArchives.length,currentBaselineRequired:result.before.unresolvedPriorArchives.length,changes:old.criteria.filter(r=>r.status!==result.before.criteria.find(n=>n.id===r.id)?.status).map(r=>({id:r.id,before:r.status,now:result.before.criteria.find(n=>n.id===r.id)?.status}))});
assert.deepEqual(after.inputIssues,[]);assert.deepEqual(after.unexplainedGaps,[]);
save('reviewed-crosswalk.json',selection);save('scoped-result.json',{scopePass:true,overallPass:false,transition:result.transition,remainingPrior:after.unresolvedPriorArchives.length,selfOwners:after.selfChecks.length});
console.log('PASS actual cumulative smoke tier '+JSON.stringify(result.transition)+' FULL_TASK_PASS=false');
