// Versioned historical ancestry; original reader/tool pins remain unchanged.
'use strict';
// Optional cumulative four-client co-op adapter at the same actual inventory boundary.
const previous=require('./evidence_natural_coop_gate');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const original=A.inventory,F=require('./evidence_four_coop_selection');
A.inventory=(tasks,research,input)=>{
 if(!input?.fourSelection)return original(tasks,research,input);
 const result=F.inventory(tasks,research,input,original,{onPhase:m=>module.exports.onPhase?.(m)});
 module.exports.last=result;return result.report;
};
module.exports.previous=previous;
