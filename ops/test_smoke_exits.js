'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const T=require('./review_smoke_exits');
test('original exits, complete TAP and intended rejection reasons pass',()=>assert(T.semantic(T.inputs()).length>100));
for(const [id,edit,re]of [
 ['nonzero-receipt',x=>x.receipts.provider.actualExit=1,/receipt\/provider/],
 ['missing-receipt',x=>delete x.receipts.provider,/receipt\/provider/],
 ['wrong-run',x=>x.child.outputDir='/other-run',/provider-run/],
 ['omitted-case',x=>x.plan.cases.pop(),/selected-cases/],
 ['skipped-case',x=>x.child.children[0].tap.summary.skipped=1,/tap-summary/],
 ['timeout',x=>x.child.children[0].timedOut=true,/child-timeout/],
 ['service-error',x=>x.server+='\nError handling game event: unexpected',/unexpected-server-errors/],
 ['mongo-error',x=>x.mongo+=JSON.stringify({s:'E',msg:'unexpected'})+'\n',/mongo-errors/],
 ['wrong-negative-reason',x=>x.raw.requests[8].response.body='OTHER_ERROR',/negative-reason/],
 ['missing-milestone',x=>x.checkpoints.checkpoints.pop(),/all-milestones/],
 ['missing-tap-milestone',x=>x.tap=x.tap.replace('# PASS authorized-turn',''),/tap-milestone/],
 ['stderr-error',x=>x.stderr='unexpected',/child-stderr/],
 ['failed-parent',x=>x.supervisor.actualRunnerExit=1,/supervisor-exit/],
 ['outer-timeout',x=>x.supervisor.timedOut=true,/supervisor-timeout/]
])test('reject '+id,()=>{const x=T.inputs();edit(x);assert.throws(()=>T.semantic(x),re);});
test('reject altered failure provenance policy',()=>{const p=structuredClone(require('./smoke_exits_policy.json'));delete p.evidence[Object.keys(p.evidence)[0]];assert.throws(()=>T.provenance(p),/failure provenance policy/);});

test('reject stale tested source',()=>{const ids=require('/root/diplomacy/artifacts/TASK-225/smoke-158/run-03/provider/source-identities.json');const x=structuredClone(ids);x.after.server.files['server/index.js']='0'.repeat(64);assert.throws(()=>T.currentSources(x),/AC5 stale source/);});
