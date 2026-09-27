'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit'),S=require('./evidence_selection'),P=require('./review_asset_requirements');
for(const [number,id,name,mutate,pattern] of [
 [5,'timeout','child-results.json',x=>{x.children[0].timedOut=true;},/child-no-timeouts/],
 [5,'unexpected-browser-error','cold-warm-delay/browser-errors.json',x=>{x.push({text:'unexpected error'});},/browser-errors/],
 [5,'wrong-negative-reason','failed-recovery/induced-errors.json',x=>{x[0].text='unrelated fault';},/intended-asset-failure/],
 [6,'fake-tier','verification-plan.json',x=>{x.cases[0].tier='source-only';},/declared-real-tiers/],
 [6,'one-context','checkpoints.json',x=>{x.checkpoints.find(c=>c.id==='cold-warm-delay/participants').observed.contexts=1;},/connected-contexts|two-contexts/],
 [6,'substituted-ai','cold-warm-delay/declared-fixture.json',x=>{x.board.gameSettings.withAI=true;},/no-ai/],
 [8,'elapsed-reset','verification-budget.json',x=>{x.elapsedMs=1;},/elapsed-wall-clock/],
 [8,'live-owned-process','old-server/cleanup.json',x=>{x.processes[0].aliveAfter=true;},/dead-owned-processes/],
 [8,'missing-required-case','coverage-results.json',x=>{x.cases.pop();},/exact-cases/]
])test('AC'+number+' rejects '+id+' after local hash rebinding',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'asset-requirements-'));
 try{fs.cpSync(path.join(S.BASE,'prepared'),dir,{recursive:true});const f=path.join(dir,'selected-211',name),x=A.read(f);mutate(x);fs.writeFileSync(f,JSON.stringify(x));
  const mf=path.join(dir,'selected-211/evidence-hashes.json'),m=A.read(mf);m[name]=A.hash(f);fs.writeFileSync(mf,JSON.stringify(m));
  const r=P.reader(number);assert.throws(()=>S.transaction(()=>r.review(dir,r.RECEIPT)),pattern);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
