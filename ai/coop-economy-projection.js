'use strict';
// Offline scenario accounting. Never imported by game code.
const fs = require('fs'), path = require('path'), assert = require('assert').strict;
const crypto = require('crypto');
const {createFixture} = require('./test-coop-harness');
const {neighbours} = require('./test-coop-terrain-audit');
const {getCoopMapScaling} = require('./coop-map-scaling');
const {buildReport} = require('./coop-army-valuation');
const key = c => `${c.x},${c.y}`;
const POLICIES = {
  conservative: {travelRate:1, departure:4, captureDelay:12, farmEvery:8, farmLimit:2, suburbEvery:8, reserve:40, recruitEvery:2},
  typical: {travelRate:2, departure:2, captureDelay:8, farmEvery:4, farmLimit:5, suburbEvery:4, reserve:20, recruitEvery:1},
  expansion: {travelRate:2, departure:1, captureDelay:6, farmEvery:2, farmLimit:8, suburbEvery:2, reserve:10, recruitEvery:1}
};
function readRules(f = createFixture(undefined,()=>{})) {
  const rules = f.evaluate(`({town:Town.income, farm:Farm.income, mineOpen:Goldmine.roundsToOpen,
    suburbPrices:[1,2,3].map(d=>new SuburbProduction().suburbsCostformula(d)),
    products:Object.fromEntries(['noob','archer','farm'].map(k=>[k,{cost:production[k].cost,delay:production[k].turns,salary:production[k].class.salary||0}]))})`);
  assert.deepEqual(rules, {town:4,farm:4,mineOpen:20,suburbPrices:[1,3,5],products:{noob:{cost:20,delay:1,salary:1},archer:{cost:40,delay:2,salary:2},farm:{cost:32,delay:1,salary:0}}}, 'actual economy rules drift');
  const valuation=buildReport();
  rules.values=Object.fromEntries(valuation.anchors.map(a=>[a.name.toLowerCase(),a.value]));
  return rules;
}
// BFS blocks mountains/lakes and non-destination towns/portals. Bushes are
// passable; rate=1 is a conservative sensitivity to action/terrain friction.
function distances(map, origin) {
  const blocked = new Set([...map.mountains,...map.lakes].map(key));
  const endpoints = new Set([...map.players.flatMap(p=>p.towns),...map.portals].map(key));
  const result = new Map([[key(origin),0]]), queue=[origin];
  for(let i=0;i<queue.length;i++) {
    const c=queue[i];
    if(i && endpoints.has(key(c))) continue;
    for(const n of neighbours(c)) {
      if(n.x<0||n.y<0||n.x>=map.mapSize.x||n.y>=map.mapSize.y||blocked.has(key(n))||result.has(key(n))) continue;
      result.set(key(n),result.get(key(c))+1); queue.push(n);
    }
  }
  return result;
}
function calibrate(map) {
  const starts=map.players.slice(1,-1).map(p=>p.towns[0]);
  const ds=starts.map(t=>distances(map,t));
  function assign(targets) {
    const unused=new Set(targets.map((_,i)=>i));
    return starts.map((_,i)=>{
      const j=[...unused].sort((a,b)=>(ds[i].get(key(targets[a]))??Infinity)-(ds[i].get(key(targets[b]))??Infinity)||a-b)[0];
      unused.delete(j); const distance=ds[i].get(key(targets[j]));
      assert(Number.isFinite(distance),'reachable assigned objective');
      return {target:targets[j],distance};
    });
  }
  const mines=assign(map.goldmines), towns=assign(map.players[0].towns);
  const occupied=new Set([...map.players.flatMap(p=>p.towns),...map.goldmines,...map.portals,...map.mountains,...map.lakes,...map.bushes,...map.hills].map(key));
  // Reserve distinct connected empty second-ring sites, adjacent to an initial
  // suburb. Each costs 3 gold, plus a separate one-turn land-claim allowance.
  const reserved=new Set(starts.flatMap(t=>[t,...neighbours(t)]).map(key));
  return starts.map((t,i)=>{
    const ring=new Map();
    for(const n of neighbours(t)) for(const c of neighbours(n))
      if(c.x>=0&&c.y>=0&&c.x<map.mapSize.x&&c.y<map.mapSize.y&&!occupied.has(key(c))&&!reserved.has(key(c))) ring.set(key(c),c);
    const sites=[...ring.values()].sort((a,b)=>a.x-b.x||a.y-b.y).slice(0,6);
    sites.forEach(c=>reserved.add(key(c)));
    return {availableObjectives:{towns:map.players[0].towns.length,mines:map.goldmines.length}, policyObjectiveLimit:1, human:i+1,start:t,startingGold:map.players[i+1].gold,mine:mines[i],town:towns[i],sites,
      initialFarmSites:neighbours(t).filter(c=>c.x>=0&&c.y>=0&&c.x<map.mapSize.x&&c.y<map.mapSize.y&&!occupied.has(key(c))).length};
  });
}
function project(access, policyName, rounds, rules, options={}) {
  const p=POLICIES[policyName]; assert(p,'policy');
  let gold=access.startingGold, farms=0, suburbs=7, captured=false, squadDeparture=null;
  let produced=rules.values.noob, serial=0;
  const units=[{id:'initial',kind:'noob'}], queues=[], builds=[], events=[], ledger=[];
  const mineCapture=p.departure+Math.ceil(access.mine.distance/p.travelRate);
  const farmSites=access.initialFarmSites;
  function event(round,type,data) {const e={id:++serial,round,type,...data};events.push(e);return e;}
  function spend(round,type,kind,cost,extra={}) {assert(gold>=cost,'overspending');gold-=cost;return event(round,type,{kind,cost,...extra});}
  for(let round=0;round<=rounds;round++) {
    const openingGold=gold, aliveBefore=units.length;
    const income={town:round?(captured?2:1)*rules.town:0,suburb:round?suburbs:0,
      farm:round?farms*rules.farm:0,mine:round>rules.mineOpen&&round>mineCapture?access.mine.target.income:0};
    const salary=round?units.reduce((s,u)=>s+rules.products[u.kind].salary,0):0;
    gold+=Object.values(income).reduce((a,b)=>a+b,0)-salary;
    assert(gold>=0,'solvent salary');
    const completed=[];
    for(let i=queues.length-1;i>=0;i--) if(queues[i].due<=round && !(options.blockedRounds||[]).includes(round)) {
      const q=queues.splice(i,1)[0];units.push({id:q.id,kind:q.kind});produced+=rules.values[q.kind];
      completed.push(event(round,'complete',{order:q.id,kind:q.kind,town:q.town}));
    }
    for(let i=builds.length-1;i>=0;i--) if(builds[i].due<=round) {builds.splice(i,1);farms++;}
    for(const id of (options.casualties||{})[round]||[]) {
      const i=units.findIndex(u=>u.id===id);assert(i>=0,'existing casualty');units.splice(i,1);event(round,'casualty',{unit:id});
    }
    // Initial scout claims a mine; a separate four-recruit squad is required
    // before the town expedition. No shared objective is counted twice.
    if(squadDeparture===null && units.filter(u=>u.id!=='initial').length>=4) squadDeparture=round+p.departure;
    const captureRound=squadDeparture===null?Infinity:squadDeparture+Math.ceil(access.town.distance/p.travelRate)+p.captureDelay;
    if(!captured && round>=captureRound) {captured=true;suburbs++;event(round,'capture',{target:access.town.target});}
    const before=events.length;
    if(!options.noInvestment && round>0 && round%p.suburbEvery===0 && suburbs-7-(captured?1:0)<access.sites.length && gold>=3+p.reserve+units.length) {
      const site=access.sites[suburbs-7-(captured?1:0)];
      spend(round,'invest','suburb',3,{site,claimAllowance:1});suburbs++;
    }
    const expanded=suburbs-7-(captured?1:0);
    if(!options.noInvestment && round>0 && round%p.farmEvery===0 && farms+builds.length<Math.min(p.farmLimit,farmSites+expanded) && gold>=32+p.reserve+units.length) {
      const e=spend(round,'invest','farm',rules.products.farm.cost);builds.push({id:e.id,due:round+rules.products.farm.delay});
    }
    const capacity=captured?2:1;
    if(round%p.recruitEvery===0) for(let town=0;town<capacity;town++) {
      const kind=options.kind||'noob', rule=rules.products[kind];
      const gross=capacity*rules.town+suburbs+farms*rules.farm+(round>rules.mineOpen&&round>mineCapture?access.mine.target.income:0);
      if(queues.some(q=>q.town===town)||units.reduce((s,u)=>s+rules.products[u.kind].salary,0)+queues.reduce((s,q)=>s+rules.products[q.kind].salary,0)+rule.salary>gross||gold<rule.cost+p.reserve+units.length+queues.length)continue;
      const e=spend(round,'recruit',kind,rule.cost,{town,due:round+rule.delay});queues.push({...e});
    }
    const spending=events.slice(before).filter(e=>e.cost);
    ledger.push({round,openingGold,income,salary,aliveBefore,investment:spending.filter(e=>e.type==='invest').reduce((s,e)=>s+e.cost,0),
      recruitment:spending.filter(e=>e.type==='recruit').reduce((s,e)=>s+e.cost,0),gold,farms,suburbs,towns:capacity,
      capacity,queued:queues.map(q=>({id:q.id,town:q.town,due:q.due})),completed:completed.map(e=>e.order),
      alive:units.length,armyValue:produced});
  }
  const result={policy:policyName,access,mineCapture,squadDeparture,ledger,events}; audit(result,rules);return result;
}
// Reconstruct financial/production identities from the event stream, not totals.
function audit(result,rules) {
  const orders=new Map(), finished=new Set();let previousValue=rules.values.noob,previousGold=result.access.startingGold;
  for(const row of result.ledger) {
    const es=result.events.filter(e=>e.round===row.round), costs=es.filter(e=>e.cost).reduce((s,e)=>s+e.cost,0);
    assert.equal(row.openingGold,previousGold,'gold continuity');
    assert.equal(row.gold,previousGold+Object.values(row.income).reduce((a,b)=>a+b,0)-row.salary-costs,'gold accounting');
    assert(row.gold>=0,'overspending');
    assert.equal(row.income.mine,row.round>rules.mineOpen&&row.round>result.mineCapture?result.access.mine.target.income:0,'premature goldmine income');
    for(const e of es) {
      if(e.type==='recruit') {
        assert(!orders.has(e.id),'duplicate order');
        assert(![...orders.values()].some(q=>q.town===e.town&&!finished.has(q.id)),'production capacity');
        assert.equal(e.cost,rules.products[e.kind].cost,'recruit price');orders.set(e.id,e);
      }
      if(e.type==='complete') {
        const q=orders.get(e.order);assert(q,'ordered recruitment');
        assert(!finished.has(e.order),'duplicate recruitment');
        assert(row.round>=q.round+rules.products[q.kind].delay,'training delay');
        finished.add(e.order);previousValue+=rules.values[q.kind];
      }
    }
    assert.equal(row.armyValue,previousValue,'cumulative produced value');previousGold=row.gold;
  }
  return true;
}
function main() {
  const args=process.argv.slice(2), get=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
  const seeds=get('--seeds','0:31').split(':').map(Number), rounds=Number(get('--rounds','40'));
  assert(seeds.length===2&&seeds.every(Number.isInteger)&&seeds[0]>=0&&seeds[1]>=seeds[0]&&seeds[1]<=31);
  assert(Number.isInteger(rounds)&&rounds>=0&&rounds<=40);
  const out=path.resolve(get('--output-dir','artifacts/TASK-126'));fs.mkdirSync(out,{recursive:true});
  const f=createFixture(undefined,()=>{}),rules=readRules(f), index=[], accessRows=[];
  const stream=fs.openSync(path.join(out,'ledgers.jsonl'),'w');
  try {
    for(const size of ['tiny','normal','big']) for(let humans=1;humans<=12;humans++) for(let seed=seeds[0];seed<=seeds[1];seed++) {
      const started=Date.now();const map=f.evaluate(`JSON.parse(JSON.stringify(generateCoopGame(${humans},{size:'${size}',seed:${seed}})))`);
      const scaling=getCoopMapScaling(humans,size);
      assert.deepEqual(map.mapSize,scaling.mapSize,'formula-derived dimensions');
      const observed={humanTowns:map.players.slice(1,-1).reduce((n,p)=>n+p.towns.length,0),neutralTowns:map.players[0].towns.length,goldmines:map.goldmines.length,portals:map.portals.length,mountains:map.mountains.length,lakes:map.lakes.length,bushes:map.bushes.length};
      assert.deepEqual(observed,scaling.counts,'formula-derived object counts');
      const access=calibrate(map); const id=`${size}-H${humans}-seed${seed}`;
      assert(access.every(a=>a.startingGold===100),'starting gold');
      accessRows.push({id,size,humans,seed,scaling,observedCounts:observed,mapHash:crypto.createHash('sha256').update(JSON.stringify(map)).digest('hex'),access});
      for(const policy of Object.keys(POLICIES)) {
        const projections=access.map(a=>project(a,policy,rounds,rules));
        for(const projection of projections) fs.writeSync(stream,JSON.stringify({id,...projection})+'\n');
        index.push({id,size,humans,seed,policy,armyValueByRound:Array.from({length:rounds+1},(_,r)=>projections.reduce((s,p)=>s+p.ledger[r].armyValue,0))});
      }
      console.log(`PASS generated-access ${id} humans=${access.length} policies=3 rounds=0..${rounds} elapsed_ms=${Date.now()-started}`);
    }
  } finally {fs.closeSync(stream);}
  fs.writeFileSync(path.join(out,'access.json'),JSON.stringify(accessRows,null,2)+'\n');
  fs.writeFileSync(path.join(out,'projection.json'),JSON.stringify({model:'offline-economy-v2-scaled',targetPolicy:'typical',rules,policies:POLICIES,scenarios:index},null,2)+'\n');
  const summary=[];
  for(const size of ['tiny','normal','big'])for(let h=1;h<=12;h++)for(const policy of Object.keys(POLICIES)) {
    const rows=index.filter(r=>r.size===size&&r.humans===h&&r.policy===policy),vs=rows.map(r=>r.armyValueByRound[rounds]);
    const accesses=accessRows.filter(r=>r.size===size&&r.humans===h).flatMap(r=>r.access);
    const range=k=>{const v=accesses.map(a=>a[k].distance);return `${Math.min(...v)}–${Math.max(...v)}`;};
    summary.push(`| ${size} | ${h} | ${policy} | ${range('mine')} | ${range('town')} | ${Math.min(...vs)} | ${(vs.reduce((a,b)=>a+b,0)/vs.length).toFixed(2)} | ${Math.max(...vs)} |`);
  }
  fs.writeFileSync(path.join(out,'economy-report.md'),`# Offline human production projection\n\nTypical is the future tuning target. Initial army is one Noob (20) per human plus 100 gold. Army value = 20 + completed recruit values; spending and unspent gold are never army value. No casualties by default; explicit casualty events reduce future salary only.\n\nAll 3 sizes, H1–12, seeds ${seeds.join('–')}, rounds 0–${rounds}. Policy constants and every individual income, investment, salary, queue, completion and gold balance are in projection.json and ledgers.jsonl. Access.json retains unique objective assignments, actual map hashes, independent BFS edge distances and distinct second-ring sites. Scaled dimensions and every object count are checked against the area formula for each generated map. Before: fixed sides 15/25/39 and H1–4; after: max(minimum, ceil(baseSide * sqrt(H/4))) and H1–12. The original scenario policies deliberately attempt one unique mine and one unique neutral town per human, even when Normal/Big provide two/three; surplus objectives are retained in access records but confer no unearned income or production. Each assigned distance and empty farm/expansion site is recalculated, never extrapolated from H4. Assignment is greedy in human order, so reports retain actual per-human variation rather than assuming equal access.\n\nTiming: round 0 allows spending but no income. Later turns credit pre-completion town (4), suburb (1 each), farm (4), and mine (20) income, then charge living-unit salary, complete queues/builds, acquire assets and spend. Mines first pay at max(21, capture+1). Farms cost 32, complete next turn and first pay the following turn. One queue per town; Noob costs 20 and trains one turn; Archer costs 40 and trains two. Default policies recruit Noobs only, a transparent valuation anchor. No barracks or higher-tier production investment is assumed. Reserve and sustainable salary cap can idle queues; queues are not inferred from available gold.\n\nPolicy assumptions: travel at the declared 1 or 2 edges/round, departure delays 4/2/1. Initial scout claims assigned mine. A separate four-recruit expedition departs after assembling, then travels and spends 12/8/6 additional turns on neutral-town assault, capture and recovery. These are declared scenario allowances, not simulated victories; healing, enemy interference, casualties and path congestion can invalidate acquisition forecasts. Neutral town adds only its central suburb and one queue, earns income next turn. No neutral town or mine is allocated twice. Farm limits 2/5/8 use empty initial-ring sites plus purchased second-ring sites. One expansion per declared interval includes a land-claim allowance; each adjacent second-ring suburb costs 3, earns next turn. Empty sites exclude all nature/buildings and overlap. Existing six starting suburbs earn income even if not farmable. Expansion claims and garrison evacuation are assumed feasible with available recruits; actual long-game action replay is not claimed.\n\nRepresentative real-engine comparisons in tests.log cover spending, salary ordering, two-turn training, blocked output, farm completion/income and round-20/21 mine opening. These validate local accounting rules, not the speculative conquest schedule. Economic projections are offline fixed policies, never adaptive difficulty.\n\n| Size | Humans | Policy | Mine edges range | Town edges range | Final value min | Mean | Max |\n|---|---:|---|---:|---:|---:|---:|---:|\n${summary.join('\n')}\n`);
  const sourceFiles=require('child_process').execFileSync('git',['ls-files','*.js','index.html'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'}).trim().split('\n');
  fs.writeFileSync(path.join(out,'projection-source-identity.json'),JSON.stringify({sha256:Object.fromEntries(sourceFiles.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'..',file))).digest('hex')]))},null,2)+'\n');
  console.log(`PASS economy projection maps=${accessRows.length} policy_scenarios=${index.length} individual_ledgers=${accessRows.reduce((s,r)=>s+r.humans*3,0)} target=typical rounds=0..${rounds}`);
}
if(require.main===module)main();
module.exports={POLICIES,readRules,distances,calibrate,project,audit};
