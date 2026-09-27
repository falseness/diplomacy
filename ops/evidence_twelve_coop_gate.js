'use strict';
// Retain the complete ten-client ancestry; one rehashed transaction encloses
// this additional twelve-client review and every earlier criterion consumer.
const previous=require('./evidence_ten_coop_gate');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const S=require('./evidence_selection'),F=require('./evidence_twelve_coop_selection'),original=A.inventory;
A.inventory=(tasks,research,input)=>{
 if(!input?.twelveSelection)return original(tasks,research,input);
 const tx=S.transaction(()=>F.inventory(tasks,research,input,original,{onPhase:m=>module.exports.onPhase?.(m)}));
 module.exports.last={...tx.result,cacheMetrics:tx.metrics};
 module.exports.onPhase?.('PASS twelve-transaction-rehashed '+JSON.stringify(tx.metrics));
 return tx.result.report;
};
module.exports.previous=previous;
