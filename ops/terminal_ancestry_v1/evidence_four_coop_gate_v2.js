// Versioned historical ancestry; original reader/tool pins remain unchanged.
'use strict';
// Bound the complete synchronous consumer, not just individual preflights, with
// the existing read/proof transaction. Every consumed file is rehashed on exit;
// no verdict or cache survives an invocation, and all criterion readers still run.
const previous=require('./evidence_four_coop_gate');
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const S=require('./evidence_selection'),original=A.inventory;
A.inventory=(tasks,research,input)=>{
 if(!input?.fourSelection)return original(tasks,research,input);
 const tx=S.transaction(()=>original(tasks,research,input));
 module.exports.last={...previous.last,cacheMetrics:tx.metrics};
 module.exports.onPhase?.('PASS four-transaction-rehashed '+JSON.stringify(tx.metrics));
 return tx.result;
};
module.exports.previous=previous;
