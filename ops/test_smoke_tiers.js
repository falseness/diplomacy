'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const T=require('./review_smoke_tiers'),A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const plan=A.read('/root/diplomacy/artifacts/TASK-225/smoke-158/run-03/provider/verification-plan.json');
test('retained lookup is source-only and protocol cases are network-only',()=>assert.equal(T.classification(plan).length,14));
for(const [name,edit,re]of [
 ['source-as-network',p=>p.cases.find(c=>c.id==='lookup-boundary').tier='real HTTPS/Socket.IO/MongoDB',/case tier/],
 ['network-as-source',p=>p.cases[0].tier='production-source',/case tier/],
 ['omitted-boundary',p=>p.cases.pop(),/complete selected cases/],
 ['UI-claim',p=>p.exclusions=[],/UI exclusion/]
])test('reject '+name,()=>{const p=structuredClone(plan);edit(p);assert.throws(()=>T.classification(p),re);});
