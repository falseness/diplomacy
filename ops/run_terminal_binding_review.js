'use strict';
// Offline review only. Launched by the receipt/deadline supervisor below.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const out=path.resolve(process.argv[2]),original='/root/diplomacy/artifacts/TASK-225/join-143/run-01/provider';
const save=(n,x)=>fs.writeFileSync(path.join(out,n),JSON.stringify(x,null,2)+'\n');
const receiptFile=path.join(path.dirname(original),'provider-exit.json');
const receipt={file:receiptFile,sha256:A.hash(receiptFile)};
const tasks=A.read('/root/diplomacy/artifacts/tasks.json');
if(process.argv[3]==='old') {
 require('./evidence_terminal_ac2_selection').prepare(tasks,original,path.join(out,'old-projection'),receipt);
 throw new Error('old reader unexpectedly accepted');
}
const G=require('./evidence_terminal_ac3_gate_v2'),C=require('./evidence_terminal_ac3_selection_v2'),C2=require('./evidence_terminal_ac2_selection_v2');
const T=require('./evidence_terminal_selection_v2'),F=require('./review_terminal_outcomes_v2');
for(let g=G;g;g=g.previous)g.onPhase=m=>console.log(m);
const Hist=require('./historical_source_binding');Hist.toolIdentities();
process.on('exit',()=>{save('historical-source-observations.json',[...Hist.observations.values()]);save('historical-oracle-executions.json',Hist.oracleExecutions);});
const checks=[],ck=(id,e,o)=>{assert.deepEqual(o,e,id);checks.push({id,expected:e,observed:o,pass:true});};
const controls=[];
function reject(id,fn,re){let error;try{fn();}catch(e){error=e;}assert(error&&re.test(error.message),id+': '+error?.message);controls.push({id,expected:'rejection '+re,observed:error.message,pass:true});console.log('PASS reject '+id);}
const ids=A.read(path.join(original,'source-identities.json'));
ck('all-recorded-provider-dependencies-current',[],A.compareSources(ids));
const outer=A.read(path.join(path.dirname(original),'source-identities.json'));
for(const [file,h] of Object.entries(outer.after))ck('outer/'+file,h,A.hash(file));
const originalManifest=F.manifest(original);save('original-hashes.json',originalManifest);
const historical=A.read(C.BASE),ready=T.preflight(tasks,historical);
ck('historical-ancestry-valid',true,ready.run.historicalValid);
ck('historical-ancestry-stays-stale',false,ready.run.currentSourceValid);
save('historical-inspection.json',ready.run);
console.log('PASS immutable historical ancestry assertions='+ready.report.checks.length+' sourceDifferences='+ready.run.sourceDifferences.length);
const ac2Selection=C2.prepare(tasks,original,path.join(out,'selected-221-ac2'),receipt);
const ac3Selection=C.prepare(tasks,original,path.join(out,'selected-221-ac3'),receipt);
ck('AC2-current',true,C2.preflight(tasks,ac2Selection).run.currentSourceValid);
ck('AC3-current',true,C.preflight(tasks,ac3Selection).run.currentSourceValid);
console.log('PASS whole AC2 assertions='+ac2Selection.report.checks.length);
console.log('PASS whole AC3 assertions='+ac3Selection.report.checks.length);
save('ac2-selection.json',ac2Selection);save('ac3-selection.json',ac3Selection);
const histBad=structuredClone(historical);histBad.terminalSelection.originalFiles['source-identities.json']='0'.repeat(64);
reject('rewritten-historical-binding',()=>T.preflight(tasks,histBad),/rewritten historical binding/);
for(const [id,mutate,re] of [
 ['wrong-row-owner',x=>{x.row.id='TASK-221/AC2';},/complete row/],
 ['omitted-check',x=>{x.row.clauses[0].assertions.pop();},/complete row/],
 ['wrong-ancestry',x=>{x.baseline.sha256='0'.repeat(64);},/ancestry/],
 ['changed-review-tool',x=>{x.toolHashes['review_terminal_outcomes_v2.js']='0'.repeat(64);},/tool binding/]
]){const x=structuredClone(ac3Selection);mutate(x);reject(id,()=>C.preflight(tasks,x),re);}
// Corrupt only disposable copies, never the immutable provider or projections.
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
save('negative-control-results.json',{fullInvocation:false,controls,passScoped:true});
const selected={ac2Selection,ac3Selection};save('reviewed-crosswalk.json',selected);
const research=A.read('/root/diplomacy/artifacts/TASK-225/review-114/research-input.json');
const after=A.inventory(tasks,research,selected),result=G.last;
save('before-consumer.json',result.before);save('after-consumer.json',after);save('ac3-transition.json',result.transition);
save('ac2-transition.json',G.previous.last.transition);
ck('whole-AC3-target-current','covered-current',result.transition.status);
ck('exact-target-closure',result.transition.before-1,result.transition.after);
ck('eight-self-owners',8,after.selfChecks.length);
ck('unchanged-self-owners',result.before.selfChecks,after.selfChecks);
ck('no-input-issues',[],after.inputIssues);ck('no-unexplained-gaps',[],after.unexplainedGaps);
const prior=A.read('/root/diplomacy/artifacts/TASK-225/join-139/run-01/after-consumer.json');
const recalculated=G.previous.last.before;
const downgrades=prior.criteria.filter(r=>r.status==='covered-current').flatMap(r=>{
 const now=recalculated.criteria.find(n=>n.id===r.id);return now.status==='covered-current'?[]:[{id:r.id,before:r.status,after:now.status,current:now}];
});
save('source-driven-downgrades.json',{previousRequired:prior.unresolvedPriorArchives.length,recalculatedRequired:recalculated.unresolvedPriorArchives.length,downgrades,runs:recalculated.runs.filter(r=>r.sourceDifferences?.length).map(r=>({task:r.task,directory:r.directory,sourceDifferences:r.sourceDifferences}))});
ck('immutable-original-proof',originalManifest,F.manifest(original));
ck('provider-still-current',[],A.compareSources(ids));
for(const c of [...ac2Selection.report.checks,...ac3Selection.report.checks,...ready.report.checks])ck('serialized/'+c.id,c.expected,c.observed);
save('checkpoints.json',{fullInvocation:false,checkpoints:checks});
save('source-identities.json',{fullInvocation:false,provider:ids,outer,originalReceipt:receipt});
save('scoped-result.json',{fullInvocation:false,scopePass:true,overallPass:false,remainingPrior:after.unresolvedPriorArchives.length,selfOwners:after.selfChecks.length,ac2:G.previous.last.transition,ac3:result.transition,controls:controls.length,assertions:checks.length,providerSourceCount:Object.values(ids.after).reduce((n,r)=>n+Object.keys(r.files).length,0),outerSourceCount:Object.keys(outer.after).length});
console.log('PASS actual cumulative AC3 '+JSON.stringify(result.transition)+' selfOwners=8 overallPass=false');
