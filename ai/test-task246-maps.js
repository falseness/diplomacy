'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createFixture} = require('./test-coop-harness');
const {checkGeneratedMap, portalChecks, neighbours, bfs} = require('./test-coop-current-generation');
const {getCoopMapScalingFromMetadata} = require('./coop-map-scaling');
const sha = value => require('node:crypto').createHash('sha256').update(value).digest('hex');
const inputs = ['tiny','normal','big'].flatMap(size=>Array.from({length:12},(_,i)=>({size,h:i+1,seed:1})));
for (const seed of [0,4294967295]) inputs.push({size:'tiny',h:1,seed},{size:'big',h:12,seed});
const idOf = ({size,h,seed})=>`${size}-H${h}-seed${seed}`;
// --cases id,id,... runs only the named inputs (default: all 40).
function selectInputs(argv) {
  const i = argv.indexOf('--cases');
  if (i<0) return inputs;
  const ids = argv[i+1].split(','), unknown = ids.filter(id=>!inputs.some(x=>idOf(x)===id));
  assert.deepEqual(unknown,[],'unknown --cases ids');
  return inputs.filter(x=>ids.includes(idOf(x)));
}
module.exports = {inputs,idOf,selectInputs};
if (require.main === module) {
  const out = process.argv[process.argv.indexOf('--output-dir')+1];
  const selected = selectInputs(process.argv);
  fs.mkdirSync(out,{recursive:true});
  const write = (name,data)=>fs.writeFileSync(path.join(out,name),JSON.stringify(data,null,2)+'\n');
  const f = createFixture(undefined,()=>{}), checkpoints=[], maps=[], negatives=[];
  const check = (id,observed,expected) => {
    const pass = JSON.stringify(observed)===JSON.stringify(expected);
    checkpoints.push({id,expected,observed,pass}); assert.deepEqual(observed,expected,id);
  };
  const key=c=>`${c.x},${c.y}`;
  // Path model: mountains, lakes and other humans' towns are solid; neutral towns, portals and mines are endpoints.
  const endpointResults=(map,h)=>{
    const towns=map.players.slice(1,1+h).map(p=>p.towns[0]);
    const occupied=new Set([...map.players.flatMap(p=>p.towns),...map.portals,...map.goldmines,...map.mountains,...map.lakes].map(key));
    return towns.map((t,i)=>{
      const distances=bfs(map,[t],{blocked:new Set([...map.mountains,...map.lakes,...towns.filter((_,j)=>i!==j)].map(key)),
        endpoints:new Set([...map.players[0].towns,...map.portals,...map.goldmines].map(key))});
      return {allReached:map.portals.every(p=>distances.has(key(p))),nearest:Math.min(...map.portals.map(p=>distances.get(key(p))??Infinity)),
        approaches:map.portals.map(p=>neighbours(p).filter(n=>!occupied.has(key(n))&&distances.has(key(n))).length)};
    });
  };
  const approachesOk=results=>results.every(r=>r.allReached&&r.approaches.every(n=>n>=2));
  try {
    for (const input of selected) {
      assert.ok(Date.now()<Number(process.env.TASK246_STOP_AT),'cumulative deadline');
      const {size,h,seed}=input, id=idOf(input);
      const result = f.evaluate(`(()=>{const first=generateCoopGame(${h},{size:'${size}',seed:${seed}});
        const second=generateCoopGame(${h},{size:'${size}',seed:${seed}});
        return {first:JSON.stringify(first),second:JSON.stringify(second)};})()`);
      const map=JSON.parse(result.first);
      check(id+'-repeat',result.second,result.first);
      checkGeneratedMap(map,h,seed,size);
      check(id+'-dimensions',[map.mapSize.x,map.mapSize.y].every(n=>Number.isInteger(n)&&n>0),true);
      const contract=portalChecks(map,h);
      for(const r of contract) check(id+'-'+r.name,r.pass,true);
      check(id+'-initial-humans',getCoopMapScalingFromMetadata({...map.coop,humanSlots:[],survivingPlayers:0}).counts.portals,10*h);
      const reach=endpointResults(map,h);
      check(id+'-mine-endpoint-reach',approachesOk(reach),true);
      check(id+'-mine-endpoint-fairness',Math.max(...reach.map(r=>r.nearest))-Math.min(...reach.map(r=>r.nearest))<=4,true);
      const dropped=structuredClone(map);dropped.portals.pop();
      const swapped=structuredClone(map);swapped.portals[0].category=swapped.portals[0].category==='melee'?'ranged':'melee';
      const blocked=structuredClone(map);
      blocked.mountains.push(...neighbours(blocked.portals[0]).filter(c=>c.x>=0&&c.y>=0&&c.x<map.mapSize.x&&c.y<map.mapSize.y));
      for (const [type, observation, reason] of [['dropped-portal',dropped,'counts'],['wrong-category',swapped,'categories'],['blocked-approach',blocked,'portal-approach']]) {
        const result=reason==='portal-approach'
          ? {name:reason,pass:approachesOk(endpointResults(observation,h))}
          : portalChecks(observation,h).find(r=>r.name===reason);
        check(id+'-negative-'+type,result.pass,false);
        if(type==='wrong-category')check(id+'-negative-unchanged-total',observation.portals.length,10*h);
        negatives.push({id:id+'-'+type,input,reason,expectedRejection:reason,observedRejection:result.pass?null:reason,result,pass:!result.pass});
      }
      maps.push({id,input,map,contract,endpointResults:reach,duplicateHashes:[sha(result.first),sha(result.second)],identical:true});
      fs.appendFileSync(path.join(out,'progress.log'),`PASS ${id} size=${map.mapSize.x}x${map.mapSize.y} portals=${map.portals.length}\n`);
      console.log(`PASS ${id} size=${map.mapSize.x}x${map.mapSize.y} portals=${map.portals.length} categories=6 repeat=identical fairness=pass reachability=pass negative-controls=3`);
    }
  } finally {write('maps.json',maps);write('negative-controls.json',negatives);write('checkpoints.json',{cases:selected.map(idOf),checkpoints,pass:maps.length===selected.length&&checkpoints.every(c=>c.pass)});}
  assert.equal(maps.length,selected.length);console.log(`PASS maps=${maps.length}/${selected.length} assertions=${checkpoints.length} negative-controls=${negatives.length}`);
}
