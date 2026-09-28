'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit'),F=require('./review_competitive_evidence');
const original=path.join(A.client,'artifacts/TASK-219/green-20260925-02');
function changed(file,mutate,pattern){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'competitive-reader-'));try{fs.cpSync(original,dir,{recursive:true});const value=A.read(path.join(dir,file));mutate(value);fs.writeFileSync(path.join(dir,file),JSON.stringify(value));const coverage=A.read(path.join(dir,'coverage-results.json'));coverage.evidenceHashes[file]=A.hash(path.join(dir,file));fs.writeFileSync(path.join(dir,'coverage-results.json'),JSON.stringify(coverage));assert.throws(()=>F.review(dir),pattern);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
test('historical complete AC1/2/3/7 independently derived',()=>{const r=F.review(original);assert.equal(r.checks.length,349);assert.deepEqual(r.criteria,[1,2,3,7]);});
const journal=F.CASES[0]+'/journal.json',move=v=>v.find(r=>r.stage==='move');
for(const [id,file,mutate,pattern] of [
 ['wrong seed','verification-plan.json',v=>v.cases[0].seed=2,/planned-cases/],
 ['wrong fog','verification-plan.json',v=>v.cases[1].fog=false,/planned-cases/],
 ['wrong humans','verification-plan.json',v=>v.cases[0].humans=4,/planned-cases/],
 ['wrong variant index','inventory.json',v=>v.inventory[2].index=1,/inventory-indices/],
 ['wrong inventory','inventory.json',v=>v.inventory.pop(),/competitive\/inventory/],
 ['wrong contexts','checkpoints.json',v=>{const r=v.checkpoints.find(c=>c.id===F.CASES[0]+':r-1:distinct-contexts');r.expected=r.observed=1;},/contexts/],
 ['omitted case','coverage-results.json',v=>v.cases.pop(),/case-ids/],
 ['no-ID teleport',journal,v=>move(v).after.players[1].units[0].x++,/derived-move/],
 ['duplicate unit',journal,v=>move(v).after.players[1].units.push(move(v).after.players[1].units[0]),/derived-move/],
 ['swapped unit owner',journal,v=>{const g=move(v).after;[g.players[1].units,g.players[2].units]=[g.players[2].units,g.players[1].units];},/derived-move/],
 ['wrong HP',journal,v=>move(v).after.players[1].units[0].hp++,/derived-move/],
 ['wrong moves',journal,v=>move(v).after.players[1].units[0].moves++,/derived-move/],
 ['double income',journal,v=>move(v).before.players[1].gold+=20,/active-income/],
 ['wrong stored state',journal,v=>v.find(r=>r.stage==='commit').stored.gameObject.players[1].gold++,/stored\/0/],
 ['wrong receipt',journal,v=>v.find(r=>r.stage==='round-received').state.players[2].gold++,/receipt/],
 ['wrong expected flag',journal,v=>move(v).expected.players[1].gold++,/archived-oracle/],
 ['omitted action',journal,v=>v.splice(v.findIndex(r=>r.stage==='move'),1),/actions/],
 ['omitted reconnect',journal,v=>v.splice(v.findIndex(r=>r.stage==='reconnected'),1),/duplicate-competitive-record:reconnect/],
 ['wrong components',journal,v=>v.find(r=>r.stage==='round-persisted').stored.rounds[1][1].turns[0].playerIndex=99,/next-components/]
])test(id+' after hash rebinding',()=>changed(file,mutate,pattern));
test('complete historical rows pass real disposition',()=>{
 const S=require('./evidence_competitive_selection'),R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
 const parent=fs.mkdtempSync(path.join(A.client,'artifacts/TASK-225/competitive-disposition-test-'));
 try{const tasks=A.read(path.join(A.client,'artifacts/tasks.json')),input=S.prepare(tasks,original,path.join(parent,'prepared')),ready=S.preflight(tasks,input);
  assert.equal(ready.run.sourceDifferences.length,17);assert(ready.run.historicalValid&&!ready.run.currentSourceValid);
  for(const n of F.HISTORICAL){const row=input.reviews.find(r=>r.id==='TASK-219/AC'+n),target=R.targets(tasks,[]).find(t=>t.id===row.id),result=R.disposition(target,row,[ready.run],tasks);assert.equal(result.status,'reviewed-historical',JSON.stringify(result));assert.equal(result.covered,false);}
 }finally{fs.rmSync(parent,{recursive:true,force:true});}
});
