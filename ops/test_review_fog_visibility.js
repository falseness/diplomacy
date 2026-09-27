'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const F=require('./review_fog_visibility');
const dir='/root/diplomacy/artifacts/TASK-212/green-11';
function data(){const read=n=>JSON.parse(fs.readFileSync(path.join(dir,n))),lines=n=>fs.readFileSync(path.join(dir,n),'utf8').trim().split('\n').map(JSON.parse);return [read('visibility-checkpoints.json'),read('checkpoints.json').checkpoints,Object.fromEntries(F.BROWSER.map(id=>[id,lines(id+'/network-traces.jsonl')])),Object.fromEntries(F.BROWSER.map(id=>[id,lines(id+'/input-trace.jsonl')]))];}
test('independent reader accepts retained fog observations',()=>assert.deepEqual(F.analyze(...data()).criteria,[1,2,3]));
for(const [name,mutate,pattern] of [
 ['omitted recipient',d=>d[0].splice(1,1),/exact-recipient-observations/],
 ['duplicate recipient',d=>d[0][1]=structuredClone(d[0][0]),/exact-recipient-observations/],
 ['wrong viewer',d=>d[0][0].world.viewer=2,/recipient-contract/],
 ['wrong fog',d=>d[0][2].world.fog=false,/recipient-contract/],
 ['wrong coop',d=>d[0][2].world.coop=true,/recipient-contract/],
 ['forged matching mask',d=>{const r=d[0][2];r.world.visible[0][0]=false;r.observed[0][0]=false;r.expected[0][0]=false;},/source-competitive-fog.*world/],
 ['wrong movement fact',d=>{d[0].find(r=>r.case==='competitive-clear'&&r.label==='movement').world.cells[1][6].unit='noob';},/movement\/1,6\/unit/],
 ['missing lethal input',d=>{d[3]['coop-fog']=d[3]['coop-fog'].filter(r=>r.label!=='lethal combat');},/mouse\/lethal combat/],
 ['missing durable commit',d=>{d[2]['coop-fog']=d[2]['coop-fog'].filter(r=>r.stage!=='durable-round');},/one-durable-round/],
 ['wrong context count',d=>{d[1].find(r=>r.id==='coop-fog/participants').observed=1;},/participants/],
 ['stale not delivered',d=>{d[2]['coop-fog'].find(r=>r.stage==='stale-receipt-delivered').after=3;},/actual-stale-delivery/],
 ['hidden enemy selectable',d=>{d[1].find(r=>r.id==='coop-fog/hidden-enemy-not-selectable').observed=false;},/hidden-enemy-not-selectable/],
 ['stale selection retained',d=>{d[0].find(r=>r.case==='coop-fog'&&r.label==='stale').world.selection={x:3,y:4,killed:false,onGrid:true};},/live-selection/]
])test('rejects '+name,()=>{const d=data();mutate(d);assert.throws(()=>F.analyze(...d),pattern);});
