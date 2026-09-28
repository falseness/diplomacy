'use strict';
// TASK-223/AC6 only. The source lookup check is never network/UI evidence.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
const S=require('./review_smoke_capture'),P=require('./smoke_capture_provider');
const F=require('./review_terminal_outcomes_v2');
const policy=require('./smoke_tiers_policy.json');
const CLAUSES=require('./review_terminal_tiers').CLAUSES;
const CASES=require('/root/diplomacy_server/tests/reliability/helpers/smoke-isolation-plan').CASES;
function classification(plan){
 assert.deepEqual(plan.cases.map(c=>c.id),CASES,'complete selected cases');
 for(const c of plan.cases)assert.equal(c.tier,c.id==='lookup-boundary'?'production-source':'real HTTPS/Socket.IO/MongoDB','case tier '+c.id);
 assert(plan.exclusions.includes('browser UI: no UI changes or UI claims'),'explicit UI exclusion');
 return plan.cases;
}
function review(dir,receipt,bound=F.manifest(dir)){
 const base=S.review(dir,receipt,bound),checks=[...base.checks];
 const ck=(id,e,o)=>{assert.deepEqual(o,e,'AC6/'+id);checks.push({id:'smoke/AC6/'+id,expected:e,observed:o,pass:true});};
 const read=n=>{A.proofKey(dir,n,bound);return A.read(path.join(dir,n));};
 const ids=read('source-identities.json');
 for(const [file,hash]of Object.entries(policy.files)){
  ck('policy/'+file,hash,A.hash(file));
  if(file.startsWith(A.root+'/'))for(const phase of ['before','after'])ck(phase+'/'+file,hash,ids[phase].server.files[path.relative(A.root,file)]);
 }
 const plan=read('verification-plan.json'),tiers=classification(plan);
 ck('tiers',CASES.map(id=>({id,tier:id==='lookup-boundary'?'production-source':'real HTTPS/Socket.IO/MongoDB'})),tiers);
 const child=read('child-results.json');ck('fault',null,child.selection.fault);ck('unfiltered-cases',{cases:[{}]},child.childConfig);
 const source=fs.readFileSync(P.FILE,'utf8'),transformed=P.instrument(source);
 const originalAssertions=source.split('\n').filter(l=>l.includes('check(')||l.includes('assert.')).flatMap(l=>l.match(/(?:assert\.\w+|check)\([^;]+/g)||[]);
 ck('original-assertions-preserved',originalAssertions.length,originalAssertions.filter(s=>transformed.includes(s)).length);
 const {createPolicy}=require('/root/diplomacy_server/server/smokeIsolation');
 const lookup=createPolicy([]);let denied=0;
 for(const [g,run]of [[{smokeRun:'run-a'},null],[{smokeRun:'run-a'},'run-b'],[{},'run-a']]){
  assert.throws(()=>lookup.assertGame(g,run),e=>e.code==='SMOKE_ISOLATION_DENIED');denied++;
 }
 ck('independent-source-lookup',3,denied);
 const raw=read('smoke-observations.json'),life=raw.lifecycle;
 ck('actual-websocket','websocket',life.readiness.socketIo.transport);ck('authenticated-tls',true,life.certificateTrust.rejectUnauthorized);
 ck('mongo-ping',1,life.readiness.database.ping);ck('distinct-processes',2,new Set(life.processes.map(p=>p.pid)).size);
 ck('no-service-restart',2,life.processes.length);
 const scopes=[['ordinary-match',[0,2]],['run-a-match',[1,3]],['run-b-match',[4,5]],['forged-namespace',[6]],['authorized-turn',[7]],['cross-run-socket',[8]],['ordinary-socket-switch',[9]],['expired-credential',[10]],['live-expiry',[11,12]],['ordinary-cleanup-denied',[13]],['scoped-cleanup',[14]],['sentinels-preserved',[14]],['revoked-run',[15]]];
 ck('network-boundaries',CASES.filter(c=>c!=='lookup-boundary').sort(),scopes.map(c=>c[0]).sort());
 for(const [id,indices]of scopes)ck('observed/'+id,indices,indices.map(i=>raw.requests[i].sequence));
 return {criteria:[6],wholeCriterionCredit:true,checks,tiers,workflows:scopes,clauses:CLAUSES.map(text=>({text,pass:true})),
  derivation:'Pinned original test and transformed observer preserve every assertion. Real TLS, Socket.IO sessions and Mongo inventories independently establish all selected protocol boundaries through the recomputed smoke semantic oracle. The lookup policy check executes production source only; no browser behavior is claimed. Pinned acquisition review confirms real timers, no retries or handler substitution, and fixtures authored before admission.'};
}
function rowFor(tasks,report,m){
 const text=tasks.find(t=>t.id==='TASK-223').acceptance_criteria[5],ref=file=>({file,sha256:m[file]});
 assert.equal(text,CLAUSES.join(' '));assert.deepEqual(report.criteria,[6]);assert.equal(report.wholeCriterionCredit,true);
 assert.deepEqual(report.clauses,CLAUSES.map(text=>({text,pass:true})),'whole AC6 clauses');
 return {id:'TASK-223/AC6',targetSha256:R.digest(text),reviewer:'Independent smoke tier and acquisition review',clauses:[{
  text,disposition:'reviewed',runTask:'TASK-223-TIERS',tier:'real-network',caseIds:CASES.filter(c=>c!=='lookup-boundary'),
  sourceIdentity:ref('source-identities.json'),traces:[ref('smoke-observations.json')],milestoneIds:['smoke/distinct-games','smoke/exact-cleanup-inventory'],
  proofs:['smoke-tier-review.json','smoke-observations.json','smoke-install.json','child-results.json','verification-plan.json'].map(ref),
  assertions:report.checks.map(c=>({id:c.id,expected:c.expected,proof:ref('smoke-tier-review.json')})),derivation:report.derivation,
  reason:'Only AC6; source lookup remains source-only and UI is explicitly excluded. No acquisition-location credit.',
  followUp:{scope:'Revalidate exact smoke tiers and source closure after changes.',acceptance:'Independent complete AC6 proof with genuine network observations.',targetMs:1800000,stopWorkMs:3300000,budgetMs:3600000}
 }]};
}
module.exports={classification,review,rowFor};
