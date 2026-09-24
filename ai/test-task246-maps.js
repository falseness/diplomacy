'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createFixture} = require('./test-coop-harness');
const {verifyValley, neighbours, bfs} = require('./test-coop-valley-contract');
const {expectation} = require('./test-task236-capacity');
const {getCoopMapScalingFromMetadata} = require('./coop-map-scaling');
const sha = value => require('node:crypto').createHash('sha256').update(value).digest('hex');
const categoryCounts = map => Object.fromEntries(CATEGORIES.map(c=>[c,map.portals.filter(p=>p.category===c).length]));
const CATEGORIES = ['melee','ranged','siege','heavy','support','chaos'];
const inputs = ['tiny','normal','big'].flatMap(size=>Array.from({length:12},(_,i)=>({size,h:i+1,seed:1})));
for (const seed of [0,4294967295]) inputs.push({size:'tiny',h:1,seed},{size:'big',h:12,seed});
const idOf = ({size,h,seed})=>`${size}-H${h}-seed${seed}`;
module.exports = {inputs,idOf};
if (require.main === module) {
  const out = process.argv[process.argv.indexOf('--output-dir')+1];
  fs.mkdirSync(out,{recursive:true});
  const write = (name,data)=>fs.writeFileSync(path.join(out,name),JSON.stringify(data,null,2)+'\n');
  const f = createFixture(undefined,()=>{}), checkpoints=[], maps=[], negatives=[];
  const check = (id,observed,expected) => {
    const pass = JSON.stringify(observed)===JSON.stringify(expected);
    checkpoints.push({id,expected,observed,pass}); assert.deepEqual(observed,expected,id);
  };
  // Read-only recording of successful generation plans, including explicit production retries.
  f.evaluate(`globalThis.planTrace=[]; const originalPlan246=planDividedValley;
    planDividedValley=function(...args){const p=originalPlan246(...args);planTrace.push(p);return p}; undefined`);
  try {
    for (const input of inputs) {
      assert.ok(Date.now()<Number(process.env.TASK246_STOP_AT),'cumulative deadline');
      const {size,h,seed}=input, id=idOf(input);
      const result = f.evaluate(`(()=>{planTrace=[];const first=generateCoopGame(${h},{size:'${size}',seed:${seed}});
        const trace=planTrace.slice(); const second=generateCoopGame(${h},{size:'${size}',seed:${seed}});
        return {first:JSON.stringify(first),second:JSON.stringify(second),trace};})()`);
      const map=JSON.parse(result.first), p=result.trace.at(-1);
      check(id+'-repeat',result.second,result.first);
      const oracle=expectation(h,size,5), base=oracle.base;
      const rejected=oracle.rejected;
      check(id+'-first-feasible',p.side,oracle.side);
      check(id+'-strict-plan',p.capacity.estimateMisses,0);
      check(id+'-base-side-retained',p.side>=base,true);
      check(id+'-seed-independent-side',result.trace.every(q=>q.side===p.side),true);
      check(id+'-dimensions',map.mapSize,{x:oracle.side,y:oracle.side});
      check(id+'-categories',Object.fromEntries(CATEGORIES.map(c=>[c,map.portals.filter(p=>p.category===c).length])),Object.fromEntries(CATEGORIES.map(c=>[c,h*(c==='melee'||c==='ranged'?3:1)])));
      check(id+'-total',map.portals.length,10*h);
      check(id+'-initial-humans',getCoopMapScalingFromMetadata({...map.coop,humanSlots:[],survivingPlayers:0}).counts.portals,10*h);
      const expected={side:oracle.side,humanTowns:h,neutralTowns:h*{tiny:1,normal:2,big:3}[size],goldmines:h*{tiny:1,normal:2,big:3}[size],portals:10*h,portalDistance:{tiny:6,normal:10,big:14}[size]};
      const decorated={...map,size,valley:p.valley};
      const contract=verifyValley(decorated,expected);
      for(const r of contract.results) check(id+'-'+r.name,r.pass,true);
      const fronts={west:0,east:0,outside:0};
      for(const q of map.portals) fronts[p.grid[q.y][q.x]==='W'?'west':p.grid[q.y][q.x]==='E'?'east':'outside']++;
      check(id+'-two-fronts',fronts,{west:5*h,east:5*h,outside:0});
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
      const swapped=structuredClone(decorated);swapped.portals[0].category=swapped.portals[0].category==='melee'?'ranged':'melee';
      const blocked=structuredClone(decorated);
      blocked.mountains.push(...neighbours(blocked.portals[0]).filter(c=>c.x>=0&&c.y>=0&&c.x<p.side&&c.y<p.side));
      for (const [type, observation, reason] of [['dropped-portal',dropped,'counts'],['wrong-category',swapped,'categories'],['blocked-approach',blocked,'portal-approach']]) {
        const result=reason==='categories'
          ? {name:reason,expected:{melee:3*h,ranged:3*h,siege:h,heavy:h,support:h,chaos:h},observed:categoryCounts(observation)}
          : verifyValley(observation,expected).results.find(r=>r.name===reason);
        if(reason==='categories')result.pass=JSON.stringify(result.expected)===JSON.stringify(result.observed);
        check(id+'-negative-'+type,result.pass,false);
        if(type==='wrong-category')check(id+'-negative-unchanged-total',observation.portals.length,10*h);
        negatives.push({id:id+'-'+type,input,observation,reason,expectedRejection:reason,observedRejection:result.pass?null:reason,result,pass:!result.pass});
      }
      maps.push({id,input,map,plan:p,oracle,rejectedSides:rejected,attemptSeeds:result.trace.map(p=>p.seed),contract,endpointResults,fronts,duplicateHashes:[sha(result.first),sha(result.second)],identical:true});
      fs.appendFileSync(path.join(out,'progress.log'),`PASS ${id} side=${p.side} portals=${map.portals.length}\n`);
      console.log(`PASS ${id} side=${p.side} base=${base} portals=${map.portals.length} categories=6 repeat=identical fairness=pass reachability=pass negative-controls=3`);
    }
  } finally {write('maps.json',maps);write('negative-controls.json',negatives);write('checkpoints.json',{checkpoints,pass:maps.length===40&&checkpoints.every(c=>c.pass)});}
  assert.equal(maps.length,40);console.log(`PASS maps=40/40 assertions=${checkpoints.length} negative-controls=120`);
}
