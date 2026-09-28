'use strict';
// Extend the genuinely consumed historical ancestry with only complete AC2.
const previous=require('./evidence_terminal_gate');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const C=require('./evidence_terminal_ac2_selection'),S=require('./evidence_selection'),original=A.inventory;
A.inventory=(tasks,research,input)=>{
    if(!input?.ac2Selection)return original(tasks,research,input);
    const tx=S.transaction(()=>{
        const baseline=original(tasks,research,A.read(C.BASE));
        return C.consume(tasks,research,input.ac2Selection,baseline);
    });
    module.exports.last=tx.result;
    return tx.result.after;
};
module.exports.previous=previous;
