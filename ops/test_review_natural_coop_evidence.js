'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit'),F=require('./review_natural_coop_evidence');
const original=path.join(A.client,'artifacts/TASK-215/green-20260925T031737Z');
function changed(file,mutate,pattern){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'natural-reader-'));try{fs.cpSync(original,dir,{recursive:true});const value=A.read(path.join(dir,file));mutate(value);fs.writeFileSync(path.join(dir,file),JSON.stringify(value));const coverage=A.read(path.join(dir,'coverage-results.json'));coverage.evidenceHashes[file]=A.hash(path.join(dir,file));fs.writeFileSync(path.join(dir,'coverage-results.json'),JSON.stringify(coverage));assert.throws(()=>F.review(dir),pattern);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
test('historical complete AC1/2/3/8 independently derived',()=>{const r=F.review(original);assert.equal(r.checks.length,232);assert.deepEqual(r.criteria,[1,2,3,8]);});
const actions='browser/per-action-checkpoints.json',net='network/network-tiny-h2-s1-fog-on-simultaneous/persistence.json';
for(const [id,file,mutate,pattern] of [
 ['wrong seed','verification-plan.json',v=>v.cases[0].seed=2,/natural\/network\/manifest/],
 ['wrong fog','verification-plan.json',v=>v.cases[1].fog=true,/natural\/browser\/manifest/],
 ['wrong humans','verification-plan.json',v=>v.cases[0].humans=4,/natural\/network\/manifest/],
 ['wrong contexts','checkpoints.json',v=>{const r=v.checkpoints.find(c=>c.id==='browser/coop:distinct-browser-contexts');r.expected=r.observed=1;},/natural\/browser\/distinct-browser-contexts/],
 ['omitted case','coverage-results.json',v=>v.cases.pop(),/natural\/case-ids/],
 ['duplicate checkpoint','checkpoints.json',v=>v.checkpoints.push(v.checkpoints.find(c=>c.id==='browser/coop:participants')),/duplicate-natural-checkpoint/],
 ['no-ID teleport',actions,v=>v[0].actions[0].after.game.players[1].units[0].x++,/derived-move/],
 ['duplicate unit',actions,v=>v[0].actions[0].after.game.players[1].units.push(v[0].actions[0].after.game.players[1].units[0]),/derived-move/],
 ['swapped unit owner',actions,v=>{const g=v[0].actions[0].after.game;[g.players[1].units,g.players[2].units]=[g.players[2].units,g.players[1].units];},/derived-move/],
 ['wrong HP',actions,v=>v[0].actions[0].after.game.players[1].units[0].hp++,/derived-move/],
 ['wrong moves',actions,v=>v[0].actions[0].after.game.players[1].units[0].moves++,/derived-move/],
 ['double income',net,v=>v.canonical.players[1].gold+=10,/canonical-income/],
 ['wrong expected flag',actions,v=>v[0].actions[0].expected.players[1].gold++,/archived-oracle/],
 ['omitted action',actions,v=>v[0].actions.pop(),/action-tags/],
 ['missing participant',net,v=>v.participants=1,/persisted-counts/]
])test(id+' after hash rebinding',()=>changed(file,mutate,pattern));
test('complete historical rows pass real disposition',()=>{
 const S=require('./evidence_natural_coop_selection'),R=require('/root/diplomacy_server/tests/reliability/helpers/evidence-reviews');
 const parent=fs.mkdtempSync(path.join(A.client,'artifacts/TASK-225/natural-disposition-test-'));
 try{const tasks=A.read(path.join(A.client,'artifacts/tasks.json')),input=S.prepare(tasks,original,path.join(parent,'prepared')),ready=S.preflight(tasks,input);
  assert.equal(ready.run.sourceDifferences.length,18);assert(ready.run.historicalValid&&!ready.run.currentSourceValid);
  for(const n of F.HISTORICAL){const row=input.reviews.find(r=>r.id==='TASK-215/AC'+n),target=R.targets(tasks,[]).find(t=>t.id===row.id),result=R.disposition(target,row,[ready.run],tasks);assert.equal(result.status,'reviewed-historical',JSON.stringify(result));assert.equal(result.covered,false);}
 }finally{fs.rmSync(parent,{recursive:true,force:true});}
});
