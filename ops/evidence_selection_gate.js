'use strict';
// Load via NODE_OPTIONS for the gate and its owned child. Raw review fixtures
// in checker tests deliberately keep the unmodified inventory behavior.
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const original=A.inventory;
A.inventory=(tasks,research,reviews)=>{
 if(!reviews?.evidenceSelection)return original(tasks,research,reviews);
 const deadline=Number(process.env.EVIDENCE_AUDIT_DEADLINE_MS)||Date.now()+3300000;
 const adapter=reviews.evidenceSelection.extensions?require('./evidence_selection_extensions'):require('./evidence_selection');
 const result=adapter.inventory(tasks,research,reviews,{deadline,onPhase:message=>{if(module.exports.onPhase)module.exports.onPhase(message);else if(process.env.EVIDENCE_SELECTION_PROGRESS==='1')console.log(message);}});
 module.exports.last=result;return result.report;
};
