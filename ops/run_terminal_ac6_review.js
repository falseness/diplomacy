'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const F=require('./review_terminal_outcomes_v2'),T=require('./review_terminal_tiers'),C=require('./evidence_terminal_ac6_selection');
const out=path.resolve(process.argv[2]),prior='/root/diplomacy/artifacts/TASK-225/ac1-148/run-02';
const save=(n,x)=>fs.writeFileSync(path.join(out,n),JSON.stringify(x,null,2)+'\n');
const tasks=A.read('/root/diplomacy/artifacts/tasks.json'),retained=A.read(path.join(prior,'reviewed-crosswalk.json'));
const original=retained.ac1Selection.original,checks=[],controls=[];
const ck=(id,expected,observed)=>{assert.deepEqual(observed,expected,id);checks.push({id,expected,observed,pass:true});};
function reject(id,fn,re){let error;try{fn();}catch(e){error=e;}assert(error&&re.test(error.message),id+': '+error?.message);controls.push({id,expected:String(re),observed:error.message,pass:true});console.log('PASS reject '+id);}
const before=A.read(path.join(prior,'after-consumer.json'));
const freeze=A.read('/root/diplomacy/artifacts/TASK-225/work-order-151/source-freeze.json');
for(const f of freeze.files)ck('frozen/'+f.group+'/'+f.path,f.originalSha256,A.hash(f.path));
const originalManifest=F.manifest(original);save('original-hashes.json',originalManifest);
const selected=C.prepare(tasks,original,path.join(out,'selected-221-ac6'),retained.ac1Selection.receipt);
const ready=C.preflight(tasks,selected);ck('AC6-current',true,ready.run.currentSourceValid);
const admitted=require('./evidence_selection').transaction(()=>require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews').reviewedClause(
 {...selected.row.clauses[0],runTask:'TASK-221'},{...ready.run,task:'TASK-221'}));
ck('real-row-admission','covered-current',admitted.result);
console.log('PASS actual consumer row admission AC6 covered-current');
for(const c of ready.report.checks)ck('serialized/'+c.id,c.expected,c.observed);
save('ac6-selection.json',selected);save('clause-map.json',ready.report.clauses);
for(const [id,mutate,re] of [
 ['wrong-row-owner',x=>{x.row.id='TASK-221/AC2';},/complete row/],
 ['partial-row-credit',x=>{x.row.clauses[0].assertions.pop();},/complete row/],
 ['wrong-run',x=>{x.originalFiles['source-identities.json']='0'.repeat(64);},/changed original/],
 ['changed-review-tool',x=>{x.toolHashes['review_terminal_tiers.js']='0'.repeat(64);},/tool binding/],
 ['unbound-oracle',x=>{x.report.oracleGroups[0].sha256='0'.repeat(64);},/recomputed report/],
 ['rewritten-receipt',x=>{x.receipt.sha256='0'.repeat(64);},/provider-receipt-binding/]
]){const x=structuredClone(selected);mutate(x);reject(id,()=>C.preflight(tasks,x),re);}
const scratch=path.join(out,'negative-copy');fs.cpSync(original,scratch,{recursive:true});
try {
 const proof=path.join(scratch,'terminal-to-coop/network-traces.jsonl'),trace=fs.readFileSync(proof);
 fs.appendFileSync(proof,' ');reject('tampered-proof',()=>T.review(scratch,selected.receipt,originalManifest),/hash/);
 fs.unlinkSync(proof);reject('missing-proof',()=>T.review(scratch,selected.receipt,originalManifest),/ENOENT/);
 const corrupt=(id,mutate,re)=>{
  const rows=trace.toString().trim().split('\n').map(JSON.parse);mutate(rows);
  fs.writeFileSync(proof,rows.map(JSON.stringify).join('\n')+'\n');
  reject(id,()=>T.review(scratch,selected.receipt,F.manifest(scratch)),re);
  fs.writeFileSync(proof,trace);
 };
 corrupt('source-callback-as-network',rows=>{rows.find(r=>r.kind==='invoked').tier='real-network';},/source callback mislabeled/);
 corrupt('wrong-context',rows=>{const a=rows.filter(r=>r.stage==='ac2-passive'&&r.boundary==='reconnect-before'&&r.kind==='page');a[1].session=a[0].session;},/distinct-page-sessions/);
 corrupt('manufactured-replay',rows=>{rows.find(r=>r.stage==='late-active-receipt-replayed').packet='42["playYourTurn","fake"]';},/actual received packet/);
} finally {fs.rmSync(scratch,{recursive:true,force:true});}
save('negative-control-results.json',{fullInvocation:false,controls,scopePass:true});
if(process.env.AC6_REVIEW_ONLY==='1') {
 save('checkpoints.json',{fullInvocation:false,checkpoints:checks});
 console.log('PASS AC6 review-only clauses=4 controls='+controls.length+' no-consumer=true');
 process.exit(0);
}
const G=require('./evidence_terminal_ac6_gate');
for(let g=G;g;g=g.previous)g.onPhase=m=>console.log(m);
const Hist=require('./historical_source_binding');
process.on('exit',()=>{save('historical-source-observations.json',[...Hist.observations.values()]);save('historical-oracle-executions.json',Hist.oracleExecutions);});
const selection={...retained,ac6Selection:selected};
const research=A.read('/root/diplomacy/artifacts/TASK-225/review-114/research-input.json');
const after=A.inventory(tasks,research,selection),result=G.last;
save('before-consumer.json',result.before);save('after-consumer.json',after);save('ac6-transition.json',result.transition);
ck('whole-AC6-target-current','covered-current',result.transition.status);
ck('exact-target-closure',result.transition.before-1,result.transition.after);
ck('eight-self-owners',8,after.selfChecks.length);ck('unchanged-self-owners',result.before.selfChecks,after.selfChecks);
ck('no-input-issues',[],after.inputIssues);ck('no-unexplained-gaps',[],after.unexplainedGaps);
ck('immutable-provider',originalManifest,F.manifest(original));
ck('provider-current',[],A.compareSources(A.read(path.join(original,'source-identities.json'))));
const changes=before.criteria.filter(r=>r.status!==result.before.criteria.find(n=>n.id===r.id)?.status).map(r=>({id:r.id,before:r.status,now:result.before.criteria.find(n=>n.id===r.id)?.status}));
save('baseline-changes.json',{priorRequired:before.unresolvedPriorArchives.length,currentRequired:result.before.unresolvedPriorArchives.length,changes});
save('checkpoints.json',{fullInvocation:false,checkpoints:checks});
save('source-identities.json',{fullInvocation:false,provider:A.read(path.join(original,'source-identities.json')),reviewTools:C.toolHashes(),receipt:selected.receipt});
save('scoped-result.json',{fullInvocation:false,scopePass:true,overallPass:false,transition:result.transition,remainingPrior:after.unresolvedPriorArchives.length,selfOwners:8,assertions:checks.length,controls:controls.length});
save('reviewed-crosswalk.json',selection);
console.log('PASS actual cumulative AC6 '+JSON.stringify(result.transition)+' selfOwners=8 overallPass=false');
