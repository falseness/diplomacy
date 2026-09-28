'use strict';
const previous=require('./evidence_smoke_gate');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit'),C=require('./evidence_smoke_tiers_selection'),S=require('./evidence_selection'),original=A.inventory;
A.inventory=(tasks,research,input)=>{
 if(!input?.smokeTiersSelection)return original(tasks,research,input);
 const tx=S.transaction(()=>{const prior={...input};delete prior.smokeTiersSelection;return C.consume(tasks,research,input.smokeTiersSelection,original(tasks,research,prior));});
 module.exports.last=tx.result;return tx.result.after;
};
module.exports.previous=previous;
