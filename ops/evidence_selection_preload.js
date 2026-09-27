'use strict';
// Opt-in hook for the existing gate. Raw crosswalks retain their old behavior;
// only an explicit versioned selection is routed through the adapter.
const A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const original=A.inventory;
A.inventory=(tasks,research,reviews)=>reviews?.evidenceSelection
    ? require('./evidence_selection').inventory(tasks,research,reviews).report
    : original(tasks,research,reviews);
