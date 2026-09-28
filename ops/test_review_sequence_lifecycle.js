'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit'),{CASES}=require('./review_sequence_evidence'),{reviewLifecycle}=require('./review_sequence_lifecycle');
const original=path.resolve('artifacts/TASK-220/green-20260925-03');
const manifest={...A.read(original+'/coverage-results.json').evidenceHashes};
for(const n of ['verification-budget.json','child-results.json','verification.log'])manifest[n]=A.hash(path.join(original,n));
test('historical execution passes but preserves stale sources and missing independent parent receipt',()=>{
 const r=reviewLifecycle(original,CASES,manifest);assert.equal(r.checks.length,1408);assert.deepEqual(r.unresolved,['current-source-mismatch','independent-parent-OS-receipt-missing']);assert.equal(r.sourceDifferences.length,15);assert.equal(r.fullCriterionReview,false);
 for(const c of JSON.parse(JSON.stringify(r)).checks)assert.deepEqual(c.observed,c.expected,c.id);
});
for(const [name,n,mutate,pattern] of [
 ['surviving-process','coop-actions-0/cleanup.json',v=>{v.processes[0].aliveAfter=true;},/cleanup-dead/],
 ['wrong-process-owner','coop-actions-0/cleanup.json',v=>{v.processes[0].pid++;},/cleanup-identities/],
 ['wrong-directory-owner','coop-actions-0/cleanup.json',v=>{v.directories[0].path='/tmp/unrelated';},/directory-identities/],
 ['remaining-directory','coop-actions-0/cleanup.json',v=>{v.directories[0].existsAfter=true;},/cleanup-directories/],
 ['late-cleanup','coop-actions-0/cleanup.json',v=>{v.finishedAt='2026-09-26T00:00:00Z';},/cleanup-envelope/],
 ['fake-ready','coop-actions-0/lifecycle.json',v=>{v.readiness.socketIo.connected=false;},/ready/],
 ['public-endpoint','coop-actions-0/lifecycle.json',v=>{v.endpoints.https='https://example.com';},/isolated-endpoints/],
 ['served-source','coop-actions-0/served-sources.json',v=>{v['index.html']='0'.repeat(64);},/served\/index.html/],
 ['omitted-served-source-identity','source-identities.json',v=>{delete v.before.client.files['index.html'];delete v.after.client.files['index.html'];},/unidentified-served-source/],
 ['skipped-child','child-results.json',v=>{v.children[0].tap.summary.skipped=1;},/child-tap/],
 ['signalled-child','child-results.json',v=>{v.children[0].signal='SIGTERM';},/child-exit/],
 ['false-elapsed','verification-budget.json',v=>{v.elapsedMs=1;},/elapsed/],
 ['false-cleanup','verification-budget.json',v=>{v.cleanup=false;},/budget-outcome/],
 ['unexpected-navigation-error','coop-actions-0/navigation-errors.json',v=>{v.push({type:'requestfailed',text:'net::ERR_FAILED',url:'https://127.0.0.1:44719/socket.io/',expectedCancellation:true});},/navigation-errors/],
 ['ui-tier-inflation','verification-plan.json',v=>{v.focusedCase='attack network proof';},/focused-tier/],
 ['unequal-persisted-checkpoint','checkpoints.json',v=>{v.checkpoints[0].observed=null;},/persisted/]
])test('rebound '+name+' fails execution semantics',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sequence-lifecycle-'));
 try{fs.cpSync(original,dir,{recursive:true});const p=path.join(dir,n),v=A.read(p);mutate(v);fs.writeFileSync(p,JSON.stringify(v));assert.throws(()=>reviewLifecycle(dir,CASES,{...manifest,[n]:A.hash(p)}),pattern);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
});
for(const kind of ['missing','tampered','escaped'])test(kind+' proof fails closed',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sequence-lifecycle-'));
 try{fs.cpSync(original,dir,{recursive:true});const m={...manifest},n='verification-plan.json',p=path.join(dir,n);
 if(kind==='missing')fs.unlinkSync(p);else if(kind==='tampered')fs.appendFileSync(p,' ');else{fs.unlinkSync(p);fs.symlinkSync(path.join(original,n),p);}
 assert.throws(()=>reviewLifecycle(dir,CASES,m));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
// Synthetic receipt parser controls establish format validation only, never archived OS proof.
for(const [name,mutate,pattern] of [
 ['exit',r=>{r.actualExit=1;},/parent-os-exit/],
 ['signal',r=>{r.signal='SIGTERM';},/parent-os-exit/],
 ['command',r=>{r.argv=['unrelated'];},/parent-argv/],
 ['cwd',r=>{r.cwd='/tmp';},/parent-cwd/],
 ['envelope',r=>{r.finishedMs=r.startedMs;},/parent-envelope/]
])test('synthetic receipt '+name+' corruption fails after rebinding',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sequence-receipt-'));
 try{
  const child=A.read(original+'/child-results.json'),budget=A.read(original+'/verification-budget.json');
  const record={actualExit:0,signal:null,argv:child.invocation.argv,cwd:child.invocation.cwd,startedMs:Date.parse(budget.startedAt)-1,finishedMs:Date.parse(budget.finishedAt)+1};
  mutate(record);const file=path.join(dir,'receipt.json');fs.writeFileSync(file,JSON.stringify(record));
  assert.throws(()=>reviewLifecycle(original,CASES,manifest,{file,sha256:A.hash(file)}),pattern);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
