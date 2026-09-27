'use strict';
// Optional cumulative camera adapter at the same actual inventory boundary.
const previous=require('./evidence_fog_records_gate');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const original=A.inventory,F=require('./evidence_camera_selection');
A.inventory=(tasks,research,input)=>{
 if(!input?.cameraSelection)return original(tasks,research,input);
 const result=F.inventory(tasks,research,input,original,{onPhase:m=>module.exports.onPhase?.(m)});
 module.exports.last=result;return result.report;
};
module.exports.previous=previous;
