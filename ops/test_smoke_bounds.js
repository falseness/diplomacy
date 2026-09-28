'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const T=require('./review_smoke_bounds'),A=require('/root/diplomacy_server/tests/reliability/helpers/evidence-audit');
const dir='/root/diplomacy/artifacts/TASK-225/smoke-158/run-03/provider';
const read=n=>A.read(dir+'/'+n);
function inputs(){return [read('verification-plan.json'),read('declared-fixture.json'),read('smoke-observations.json'),read('coverage-results.json'),read('child-results.json')];}
test('bounded protocol proof derives Tiny seed-1 fixture and actual admission',()=>assert(T.bounded(...inputs()).length>60));
for(const [name,edit,re]of [
 ['wrong-seed',x=>x[1].spec.seed=2,/AC7\/seed/],
 ['extra-human',x=>x[1].spec.humans=4,/AC7\/humans/],
 ['larger-map',x=>x[1].board.grid.push([]),/grid-width/],
 ['undeclared-fixture',x=>x[1].spec.generation.testFixture.generated=true,/generation/],
 ['admitted-wrong-fixture',x=>{let r=x[2].requests[0].response;r.body=r.body.replace('"seed":1','"seed":2');},/admitted\/0\/generation/],
 ['omitted-case',x=>x[3].cases.pop(),/complete-selected-cases/],
 ['failed-case',x=>x[3].cases[0].pass=false,/selected\/ordinary-match/],
 ['extra-browser',x=>x[4].children.push({file:'browser.test.js'}),/one-protocol-suite/],
 ['filtered-selection',x=>x[4].childConfig.cases=[{id:'only-one'}],/unfiltered-cases/],
 ['missing-exclusion',x=>x[0].exclusions.pop(),/exclusions/],
 ['third-participant',x=>x[2].inventories.matched.collections.games[0].playerIndexToUserIndex.push('extra'),/actual-participants/],
 ['wrong-fog',x=>x[1].board.isFogOfWar=true,/AC7\/fog/]
])test('reject '+name,()=>{const x=inputs();edit(x);assert.throws(()=>T.bounded(...x),re);});
