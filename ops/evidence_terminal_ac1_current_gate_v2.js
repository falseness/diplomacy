'use strict';
// Add one independently reviewed outcome row after retained AC2/AC3 consumption.
const previous=require('./evidence_terminal_ac3_gate_v2');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const C=require('./evidence_terminal_ac1_current_selection_v2'),S=require('./evidence_selection'),original=A.inventory;
A.inventory=(tasks,research,input)=>{
 if(!input?.ac1Selection)return original(tasks,research,input);
 const tx=S.transaction(()=>{
  const baseline=original(tasks,research,{ac2Selection:input.ac2Selection,ac3Selection:input.ac3Selection});
  return C.consume(tasks,research,input.ac1Selection,baseline,input);
 });
 module.exports.last=tx.result;return tx.result.after;
};
module.exports.previous=previous;
