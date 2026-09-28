'use strict';
const previous=require('./evidence_smoke_bounds_gate');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit'),C=require('./evidence_smoke_exits_selection'),S=require('./evidence_selection'),original=A.inventory;
A.inventory=(tasks,research,input)=>{
 if(!input?.smokeExitsSelection)return original(tasks,research,input);
 const tx=S.transaction(()=>{const prior={...input};delete prior.smokeExitsSelection;return C.consume(tasks,research,input.smokeExitsSelection,original(tasks,research,prior));});
 module.exports.last=tx.result;return tx.result.after;
};
module.exports.previous=previous;
