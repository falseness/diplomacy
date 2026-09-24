'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createFixture} = require('./test-coop-harness');
const {verifyValley, neighbours, bfs} = require('./test-coop-valley-contract');
const {expectation} = require('./test-task236-capacity');
const {getCoopMapScalingFromMetadata} = require('./coop-map-scaling');
const CATEGORIES = ['melee','ranged','siege','heavy','support','chaos'];
const inputs = ['tiny','normal','big'].flatMap(size=>Array.from({length:12},(_,i)=>({size,h:i+1,seed:1})));
for (const seed of [0,4294967295]) inputs.push({size:'tiny',h:1,seed},{size:'big',h:12,seed});
const idOf = ({size,h,seed})=>`${size}-H${h}-seed${seed}`;
module.exports = {inputs,idOf};
if (require.main === module) {
  const out = process.argv[process.argv.indexOf('--output-dir')+1];
  fs.mkdirSync(out,{recursive:true});
  const write = (name,data)=>fs.writeFileSync(path.join(out,name),JSON.stringify(data,null,2)+'\n');
  const f = createFixture(undefined,()=>{}), checkpoints=[], maps=[];
  const check = (id,observed,expected) => {
    const pass = JSON.stringify(observed)===JSON.stringify(expected);
    checkpoints.push({id,expected,observed,pass}); assert.deepEqual(observed,expected,id);
  };
  // Read-only recording of successful generation plans, including explicit production retries.
  f.evaluate(`globalThis.planTrace=[]; const originalPlan236=planDividedValley;
    planDividedValley=function(...args){const p=originalPlan236(...args);planTrace.push(p);return p}; undefined`);
  try {
    for (const input of inputs) {
      assert.ok(Date.now()<Number(process.env.TASK236_STOP_AT),'cumulative deadline');
      const {size,h,seed}=input, id=idOf(input);
      const result = f.evaluate(`(()=>{planTrace=[];const first=generateCoopGame(${h},{size:'${size}',seed:${seed}});
        const trace=planTrace.slice(); const second=generateCoopGame(${h},{size:'${size}',seed:${seed}});
        return {first:JSON.stringify(first),second:JSON.stringify(second),trace};})()`);
      const map=JSON.parse(result.first), p=result.trace.at(-1);
      check(id+'-repeat',result.second,result.first);
      const oracle=expectation(h,size), base=oracle.base;
      const rejected=oracle.rejected;
      check(id+'-first-feasible',p.side,oracle.side);
      check(id+'-strict-plan',p.capacity.estimateMisses,0);
      check(id+'-base-side-retained',p.side>=base,true);
      check(id+'-seed-independent-side',result.trace.every(q=>q.side===p.side),true);
      check(id+'-dimensions',map.mapSize,{x:oracle.side,y:oracle.side});
      check(id+'-categories',Object.fromEntries(CATEGORIES.map(c=>[c,map.portals.filter(p=>p.category===c).length])),Object.fromEntries(CATEGORIES.map(c=>[c,h])));
      check(id+'-total',map.portals.length,6*h);
      check(id+'-initial-humans',getCoopMapScalingFromMetadata({...map.coop,humanSlots:[],survivingPlayers:0}).counts.portals,6*h);
      const expected={side:oracle.side,humanTowns:h,neutralTowns:h*{tiny:1,normal:2,big:3}[size],goldmines:h*{tiny:1,normal:2,big:3}[size],portals:6*h,portalDistance:{tiny:6,normal:10,big:14}[size]};
      const decorated={...map,size,valley:p.valley};
      const contract=verifyValley(decorated,expected);
      for(const r of contract.results) check(id+'-'+r.name,r.pass,true);
      const fronts={west:0,east:0,outside:0};
      for(const q of map.portals) fronts[p.grid[q.y][q.x]==='W'?'west':p.grid[q.y][q.x]==='E'?'east':'outside']++;
      check(id+'-two-fronts',fronts,{west:3*h,east:3*h,outside:0});
      // Independent second path model: mines are endpoints as well as neutral towns/portals.
      const key=c=>`${c.x},${c.y}`, towns=map.players.slice(1,1+h).map(p=>p.towns[0]);
      const endpointResults=towns.map((t,i)=>{
        const distances=bfs(map,[t],{blocked:new Set([...map.mountains,...map.lakes,...towns.filter((_,j)=>i!==j)].map(key)),
          endpoints:new Set([...map.players[0].towns,...map.portals,...map.goldmines].map(key))});
        const occupied=new Set([...map.players.flatMap(p=>p.towns),...map.portals,...map.goldmines,...map.mountains,...map.lakes].map(key));
        return {allReached:map.portals.every(p=>distances.has(key(p))),nearest:Math.min(...map.portals.map(p=>distances.get(key(p))??Infinity)),
          approaches:map.portals.map(p=>neighbours(p).filter(n=>!occupied.has(key(n))&&distances.has(key(n))).length)};
      });
      check(id+'-mine-endpoint-reach',endpointResults.every(r=>r.allReached&&r.approaches.every(n=>n>=2)),true);
      check(id+'-mine-endpoint-fairness',Math.max(...endpointResults.map(r=>r.nearest))-Math.min(...endpointResults.map(r=>r.nearest))<=4,true);
      const dropped=structuredClone(decorated);dropped.portals.pop();
      check(id+'-negative-dropped-portal',verifyValley(dropped,expected).results.find(r=>r.name==='counts').pass,false);
      const blocked=structuredClone(decorated);
      blocked.mountains.push(...neighbours(blocked.portals[0]).filter(c=>c.x>=0&&c.y>=0&&c.x<p.side&&c.y<p.side));
      check(id+'-negative-blocked-approach',verifyValley(blocked,expected).results.find(r=>r.name==='portal-approach').pass,false);
      maps.push({id,input,map,plan:p,oracle,rejectedSides:rejected,attemptSeeds:result.trace.map(p=>p.seed),contract,endpointResults,fronts,identical:true});
      fs.appendFileSync(path.join(out,'progress.log'),`PASS ${id} side=${p.side} portals=${map.portals.length}\n`);
      console.log(`PASS ${id} side=${p.side} base=${base} portals=${map.portals.length} categories=6 repeat=identical fairness=pass reachability=pass negative-controls=2`);
    }
  } finally {write('maps.json',maps);write('checkpoints.json',{checkpoints,pass:maps.length===40&&checkpoints.every(c=>c.pass)});}
  assert.equal(maps.length,40);console.log(`PASS maps=40/40 assertions=${checkpoints.length} negative-controls=80`);
}
