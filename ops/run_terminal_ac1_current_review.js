'use strict';
// Offline AC1 comparison on immutable join-143 proof; no provider acquisition.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const F=require('./review_terminal_outcomes_v2'),C=require('./evidence_terminal_ac1_current_selection_v2');
const out=path.resolve(process.argv[2]),prior='/root/diplomacy/artifacts/TASK-225/ancestry-147/run-01';
const save=(n,x)=>fs.writeFileSync(path.join(out,n),JSON.stringify(x,null,2)+'\n');
const tasks=A.read('/root/diplomacy/artifacts/tasks.json'),retained=A.read(path.join(prior,'reviewed-crosswalk.json'));
const original=retained.ac3Selection.original,checks=[],controls=[];
const ck=(id,expected,observed)=>{assert.deepEqual(observed,expected,id);checks.push({id,expected,observed,pass:true});};
function reject(id,fn,re){let error;try{fn();}catch(e){error=e;}assert(error&&re.test(error.message),id+': '+error?.message);controls.push({id,expected:String(re),observed:error.message,pass:true});console.log('PASS reject '+id);}
const before=A.read(path.join(prior,'after-consumer.json'));
save('inspection.json',{fullInvocation:false,selectedTarget:'TASK-221/AC1',reason:'Existing current provider contains complete independent outcome proof; cumulative row still selects historical provider.',remainingPrior:before.unresolvedPriorArchives,sourceDifferences:before.runs.map(r=>({task:r.task,directory:r.directory,differences:r.sourceDifferences})),priorSelection:path.join(prior,'reviewed-crosswalk.json')});
const ids=A.read(path.join(original,'source-identities.json')),outer=A.read(path.join(path.dirname(original),'source-identities.json'));
ck('all-provider-dependencies-current',[],A.compareSources(ids));
for(const [file,h] of Object.entries(outer.after))ck('outer/'+file,h,A.hash(file));
const map=A.read('/root/diplomacy/artifacts/TASK-225/ancestry-147/reachable-binding-map.json');
for(const [file,binding] of Object.entries(map.modules))ck('retained-module/'+file,binding.sha256,A.hash(file));
for(const [name,key] of [['ac2','ac2Selection'],['ac3','ac3Selection']]) {
 const ready=require('./evidence_terminal_'+name+'_selection_v2').preflight(tasks,retained[key]);
 ck('retained-'+name+'-current',true,ready.run.currentSourceValid);
}
console.log('PASS retained provider and versioned reader bindings');
const originalManifest=F.manifest(original);save('original-hashes.json',originalManifest);
const selected=C.prepare(tasks,original,path.join(out,'selected-221-ac1'),retained.ac3Selection.receipt);
const ready=C.preflight(tasks,selected);ck('AC1-current',true,ready.run.currentSourceValid);
for(const c of ready.report.checks)ck('serialized/'+c.id,c.expected,c.observed);
save('ac1-selection.json',selected);
for(const [id,mutate,re] of [
 ['wrong-row-owner',x=>{x.row.id='TASK-221/AC2';},/complete row/],
 ['omitted-check',x=>{x.row.clauses[0].assertions.pop();},/complete row/],
 ['wrong-ancestry',x=>{x.baseline.sha256='0'.repeat(64);},/ancestry/],
 ['changed-review-tool',x=>{x.toolHashes['review_terminal_outcomes_v2.js']='0'.repeat(64);},/tool binding/],
 ['rewritten-receipt',x=>{x.receipt.sha256='0'.repeat(64);},/receipt hash/]
]){const x=structuredClone(selected);mutate(x);reject(id,()=>C.preflight(tasks,x),re);}
const scratch=path.join(out,'negative-copy');fs.cpSync(original,scratch,{recursive:true});
try {
 const file=path.join(scratch,'source-identities.json'),bytes=fs.readFileSync(file),bad=JSON.parse(bytes);
 bad.after.client.files['player.js']='0'.repeat(64);fs.writeFileSync(file,JSON.stringify(bad));
 reject('unknown-implementation-even-rebound',()=>F.review(scratch,[1],null,F.manifest(scratch)),/implementation\/client\/player.js/);
 fs.writeFileSync(file,bytes);
 const proof=path.join(scratch,'terminal-victory/network-traces.jsonl'),trace=fs.readFileSync(proof);
 fs.appendFileSync(proof,' ');reject('tampered-proof',()=>F.review(scratch,[1],null,originalManifest),/hash/);
 fs.unlinkSync(proof);reject('missing-proof',()=>F.review(scratch,[1],null,originalManifest),/ENOENT/);
 fs.writeFileSync(proof,trace);
 const rows=trace.toString().trim().split('\n').map(JSON.parse);
 rows.find(r=>r.stage==='mongo-terminal').stored.rounds.at(-1)[0].parallelTurnResult.players[1].gold++;
 fs.writeFileSync(proof,rows.map(JSON.stringify).join('\n')+'\n');
 reject('rebound-semantic-corruption',()=>F.review(scratch,[1],null,F.manifest(scratch)),/terminal-state/);
} finally {fs.rmSync(scratch,{recursive:true,force:true});}
save('negative-control-results.json',{fullInvocation:false,controls,scopePass:true});
const G=require('./evidence_terminal_ac1_current_gate_v2');
for(let g=G;g;g=g.previous)g.onPhase=m=>console.log(m);
const Hist=require('./historical_source_binding');
process.on('exit',()=>{save('historical-source-observations.json',[...Hist.observations.values()]);save('historical-oracle-executions.json',Hist.oracleExecutions);});
const selection={...retained,ac1Selection:selected};
const research=A.read('/root/diplomacy/artifacts/TASK-225/review-114/research-input.json');
const after=A.inventory(tasks,research,selection),result=G.last;
save('before-consumer.json',result.before);save('after-consumer.json',after);save('ac1-transition.json',result.transition);
ck('whole-AC1-target-current','covered-current',result.transition.status);
ck('exact-target-closure',result.transition.before-1,result.transition.after);
ck('eight-self-owners',8,after.selfChecks.length);ck('unchanged-self-owners',result.before.selfChecks,after.selfChecks);
ck('no-input-issues',[],after.inputIssues);ck('no-unexplained-gaps',[],after.unexplainedGaps);
ck('immutable-provider',originalManifest,F.manifest(original));ck('provider-still-current',[],A.compareSources(ids));
const changes=before.criteria.filter(r=>r.status!==result.before.criteria.find(n=>n.id===r.id)?.status).map(r=>({id:r.id,before:r.status,now:result.before.criteria.find(n=>n.id===r.id)?.status}));
save('baseline-changes.json',{priorRequired:before.unresolvedPriorArchives.length,currentRequired:result.before.unresolvedPriorArchives.length,changes});
save('checkpoints.json',{fullInvocation:false,checkpoints:checks});
save('source-identities.json',{fullInvocation:false,provider:ids,outer,receipt:selected.receipt});
save('scoped-result.json',{fullInvocation:false,scopePass:true,overallPass:false,transition:result.transition,remainingPrior:after.unresolvedPriorArchives.length,selfOwners:8,assertions:checks.length,controls:controls.length});
// Publish a successor only after genuine cumulative consumption.
save('reviewed-crosswalk.json',selection);
console.log('PASS actual cumulative AC1 '+JSON.stringify(result.transition)+' selfOwners=8 overallPass=false');
