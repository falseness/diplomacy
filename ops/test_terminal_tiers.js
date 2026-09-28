'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {classification,rowFor,CLAUSES}=require('./review_terminal_tiers');
test('retained callbacks cannot acquire network credit',()=>{
 const r={stage:'ac3-passive',kind:'invoked',tier:'source-executed-callbacks'};
 assert.equal(classification(r),'source-executed-callbacks');
 assert.throws(()=>classification({...r,tier:'received-network-packet'}),/mislabeled/);
 assert.equal(classification({stage:'captured-real-receipt'}),'received-network-packet');
 assert.equal(classification({stage:'late-active-receipt-replayed'}),'replayed-received-network-packet');
});
test('whole-row construction rejects a partial clause map',()=>{
 const tasks=[{id:'TASK-221',acceptance_criteria:[null,null,null,null,null,CLAUSES.join(' ')]}];
 assert.throws(()=>rowFor(tasks,{criteria:[6],wholeCriterionCredit:true,clauses:CLAUSES.slice(1).map(text=>({text,pass:true}))},{}),/partial AC6 row/);
});
