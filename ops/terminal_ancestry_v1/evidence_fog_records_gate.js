// Versioned historical ancestry; original reader/tool pins remain unchanged.
'use strict';
const previous=require('./evidence_fog_gate');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit'),P=require('./evidence_fog_records');
const original=A.inventory;
A.inventory=(tasks,research,input)=>{
 if(!input?.fogRecords)return original(tasks,research,input);
 const result=P.inventory(tasks,research,input,original,{onPhase:m=>module.exports.onPhase?.(m)});
 module.exports.last=result;return result.report;
};
module.exports.previous=previous;
