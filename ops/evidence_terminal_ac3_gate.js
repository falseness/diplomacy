'use strict';
const previous=require('./evidence_terminal_ac2_gate');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const C=require('./evidence_terminal_ac3_selection'),S=require('./evidence_selection'),original=A.inventory;
A.inventory=(tasks,research,input)=>{
 if(!input?.ac3Selection)return original(tasks,research,input);
 const tx=S.transaction(()=>{
  const baseline=original(tasks,research,{ac2Selection:input.ac2Selection});
  return C.consume(tasks,research,input.ac3Selection,baseline,input.ac2Selection);
 });
 module.exports.last=tx.result;return tx.result.after;
};
module.exports.previous=previous;
