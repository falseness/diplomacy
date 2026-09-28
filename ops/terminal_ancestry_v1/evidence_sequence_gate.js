// Versioned historical ancestry; original reader/tool pins remain unchanged.
'use strict';
// Retain the complete twelve-client ancestry; one rehashed transaction encloses
// this additional competitive review and every earlier criterion consumer.
const previous=require('./evidence_competitive_gate');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const S=require('./evidence_selection'),F=require('./evidence_sequence_selection'),original=A.inventory;
A.inventory=(tasks,research,input)=>{
 if(!input?.sequenceSelection)return original(tasks,research,input);
 const tx=S.transaction(()=>F.inventory(tasks,research,input,original,{onPhase:m=>module.exports.onPhase?.(m)}));
 module.exports.last={...tx.result,cacheMetrics:tx.metrics};
 module.exports.onPhase?.('PASS sequence-transaction-rehashed '+JSON.stringify(tx.metrics));
 return tx.result.report;
};
module.exports.previous=previous;
