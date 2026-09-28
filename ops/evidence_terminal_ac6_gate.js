'use strict';
const previous=require('./evidence_terminal_ac1_current_gate_v2');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const C=require('./evidence_terminal_ac6_selection'),S=require('./evidence_selection'),original=A.inventory;
A.inventory=(tasks,research,input)=>{
 if(!input?.ac6Selection)return original(tasks,research,input);
 const tx=S.transaction(()=>{
  const baseline=original(tasks,research,{ac1Selection:input.ac1Selection,ac2Selection:input.ac2Selection,ac3Selection:input.ac3Selection});
  return C.consume(tasks,research,input.ac6Selection,baseline,input);
 });
 module.exports.last=tx.result;return tx.result.after;
};
module.exports.previous=previous;
