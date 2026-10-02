const fs = require('fs');
const path = require('path');
const {createFixture, defaultFixture} = require('./test-coop-harness');

// The demon slot spends its gold like the economy AI: its towns buy noobs,
// suburbs, farms and barracks, its barracks buy archer/KOHb/normchel/catapult,
// it never overspends and the combat step moves the produced units. Usage:
//   node ai/test-coop-demon-production.js [--output-dir <dir>]
// The fixture is fixed (no random map), so every run is identical.
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const output = arg('--output-dir');

const TOWN = {x:6, y:3};
const SUBURBS = [{x:6,y:3},{x:6,y:4},{x:7,y:3},{x:7,y:4}];
const MINES = [{x:4, y:3}, {x:5, y:5}];
const MINE_INCOME = 50;
const ROUNDS = 30;
const BARRACK_UNITS = ['Archer', 'KOHb', 'Normchel', 'Catapult'];

// Coop fixture without the default demon Noob; the demon owns one town with its
// suburbs and the given goldmines. Every successful demon purchase is traced.
function scene(mines) {
  const config = defaultFixture(); config.coop = true; config.actors[3].units = [];
  const f = createFixture(config, () => {});
  f.evaluate(`gameRound=25;
    for(const c of ${JSON.stringify(SUBURBS)}) grid.getHexagon(c).firstpaint(3);
    globalThis.town=new Town(${TOWN.x},${TOWN.y},true);
    for(const c of ${JSON.stringify(SUBURBS)}) { const h=grid.getHexagon(c); h.isSuburb=true;
      if(!town.suburbs.includes(h)) town.suburbs.push(h); }
    if(!players[3].towns.includes(town)) players[3].towns.push(town);
    globalThis.mines=${JSON.stringify(mines)}.map(c=>{ grid.getHexagon(c).firstpaint(3);
      return new Goldmine(c.x,c.y,${MINE_INCOME}) });
    globalThis.purchases=[];
    (()=>{ const start=SimpleAiPlayerWithEconomy.prototype.startEconomyProduction;
    SimpleAiPlayerWithEconomy.prototype.startEconomyProduction=function(choice) {
      const goldBefore=this.gold, ok=start.call(this,choice);
      if(ok) purchases.push({player:this.getPlayerIndex(), producer:choice.producer.name,
        at:{...choice.producer.coord}, product:choice.product, goldBefore, goldAfter:this.gold});
      return ok };
    globalThis.crisisCalls=0;
    const crisis=players[3].crisisPenalty;
    players[3].crisisPenalty=function() { ++crisisCalls; return crisis.call(this) } })();
    gameSettings.isOnline=false; actionManager.clear(); undefined`);
  return f;
}
const demonStage = f => f.evaluate('whooseTurn=3; players[3].play(); whooseTurn=1; undefined');
const economy = f => f.evaluate(`(()=>{ const p=players[3], salary=p.armySalary, net=p.income;
  return {gold:p.gold, income:net+salary, netIncome:net, salary, projected:p.gold+net,
    towns:p.towns.filter(t=>!t.killed).length} })()`);

const cases = {
  'first-buy': () => {
    const f = scene([MINES[0]]);
    f.evaluate('players[3].gold=100; undefined');
    demonStage(f);
    const o = f.evaluate(`({purchases:purchases.filter(p=>p.player===3), preparing:town.isPreparingUnit,
      queued:town.isPreparingUnit ? town.unitProduction.name : null})`);
    const e = economy(f);
    return {observed:o, economy:e,
      pass:o.purchases.length >= 1 && o.purchases.every(p => p.goldAfter >= 0) && e.gold >= 0 && e.projected >= 0};
  },
  'unit-appears': () => {
    const f = scene([MINES[0]]);
    f.evaluate('players[3].gold=100; undefined');
    demonStage(f);
    f.evaluate('players[3].nextTurn(); undefined');
    const o = f.evaluate(`(()=>{ const near=[town.coord,...grid.getNeighbours?grid.getNeighbours(town.coord):[]];
      const noobs=players[3].units.filter(u=>!u.killed && u.constructor===Noob);
      return {noobs:noobs.map(u=>({cls:u.constructor.name, at:{...u.coord}, owner:u.playerColor,
        registered:players[3].units.includes(u), demonVariant:!!u.constructor.type,
        distance:Math.max(Math.abs(u.coord.x-town.coord.x),Math.abs(u.coord.y-town.coord.y),
          Math.abs(u.coord.x+u.coord.y-town.coord.x-town.coord.y))})), purchases} })()`);
    return {observed:o, pass:o.noobs.length >= 1 && o.noobs.every(u => u.cls === 'Noob' &&
      u.owner === 3 && u.registered && !u.demonVariant && u.distance <= 1)};
  },
};

// One 30-round campaign backs barrack-chain, no-overspend and moves.
function campaign() {
  const f = scene(MINES);
  const rounds = [];
  for (let round = 1; round <= ROUNDS; ++round) {
    const before = f.evaluate(`(()=>{ globalThis.produced=globalThis.produced||new Map(); purchases.length=0;
      globalThis.stageStart=new Map(players[3].units.filter(u=>produced.has(u)).map(u=>[u,{x:u.coord.x,y:u.coord.y,moves:u.moves}]));
      return players[3].gold })()`);
    demonStage(f);
    const afterPlay = economy(f);
    const stage = f.evaluate(`({purchases:purchases.filter(p=>p.player===3),
      acted:[...stageStart].filter(([u,s])=>u.killed||u.coord.x!==s.x||u.coord.y!==s.y||u.moves<s.moves)
        .map(([u,s])=>({cls:u.constructor.name, id:produced.get(u).id, from:{x:s.x,y:s.y},
          to:u.killed?null:{...u.coord}, movesBefore:s.moves, movesAfter:u.moves, killed:u.killed}))})`);
    f.evaluate(`(()=>{ const known=new Set(players[3].units); players[3].nextTurn(); ++gameRound;
      for(const u of players[3].units) if(!known.has(u) && !produced.has(u))
        produced.set(u,{id:produced.size, round:${round}, cls:u.constructor.name}) })()`);
    const afterTurn = economy(f);
    const units = f.evaluate(`(()=>{ const r={}; for(const u of players[3].units) if(!u.killed)
      r[u.constructor.name]=(r[u.constructor.name]||0)+1; return r })()`);
    const state = f.evaluate(`({crisisCalls, barracks:players[3].towns.flatMap(t=>t.buildings)
        .filter(b=>!b.killed&&b.name==='barrack').length,
      suburbs:players[3].towns.reduce((n,t)=>n+t.suburbsCount,0),
      newUnits:[...produced.values()].filter(p=>p.round===${round})})`);
    rounds.push({round, goldBeforePlay:before, afterPlay, afterTurn,
      productionsStarted:stage.purchases, producedUnitsActed:stage.acted,
      newUnits:state.newUnits, unitsByClass:units, barracks:state.barracks,
      suburbs:state.suburbs, crisisCalls:state.crisisCalls});
  }
  return rounds;
}

let rounds;
const campaignCases = {
  'barrack-chain': () => {
    const started = rounds.flatMap(r => r.productionsStarted);
    const barrackUnits = started.filter(p => p.producer === 'barrack' &&
      ['archer', 'KOHb', 'normchel', 'catapult'].includes(p.product));
    const barrackUnitsOnMap = rounds.flatMap(r => r.newUnits).filter(u => BARRACK_UNITS.includes(u.cls));
    const o = {suburbs:started.filter(p => p.product === 'suburb').length,
      barracks:started.filter(p => p.product === 'barrack').length,
      farms:started.filter(p => p.product === 'farm').length,
      barrackUnitPurchases:barrackUnits.map(p => p.product), barrackUnitsOnMap};
    return {observed:o, pass:o.suburbs >= 1 && o.barracks >= 1 && barrackUnits.length >= 1 &&
      barrackUnitsOnMap.length >= 1};
  },
  'no-overspend': () => {
    const golds = rounds.flatMap(r => [r.goldBeforePlay, r.afterPlay.gold, r.afterTurn.gold,
      ...r.productionsStarted.map(p => p.goldAfter)]);
    const o = {minGold:Math.min(...golds),
      minProjectedAfterPlay:Math.min(...rounds.map(r => r.afterPlay.projected)),
      crisisCalls:rounds[rounds.length - 1].crisisCalls,
      producedUnitsKilled:rounds.flatMap(r => r.producedUnitsActed).filter(u => u.killed).length};
    return {observed:o, pass:o.minGold >= 0 && o.minProjectedAfterPlay >= 0 && o.crisisCalls === 0};
  },
  moves: () => {
    const acted = rounds.flatMap(r => r.producedUnitsActed.map(u => ({round:r.round, ...u})));
    return {observed:{acted:acted.slice(0, 10), total:acted.length}, pass:acted.length >= 1};
  },
};

if (output) fs.mkdirSync(output, {recursive: true});
let failed = 0;
function report(name, run) {
  let result;
  try { result = run(); } catch (error) { result = {error: error.stack, pass: false}; }
  if (output) fs.writeFileSync(path.join(output, name + '.json'),
    JSON.stringify({case: name, ...result}, null, 2) + '\n');
  if (!result.pass) failed++;
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(result.error ? {error: result.error} :
    {observed: result.observed})}`);
}
for (const [name, run] of Object.entries(cases)) report(name, run);
try { rounds = campaign(); } catch (error) { rounds = []; console.log('campaign error ' + error.stack); }
if (output) fs.writeFileSync(path.join(output, 'rounds.json'), JSON.stringify({rounds:ROUNDS, mines:MINES,
  minGold:rounds.length ? Math.min(...rounds.flatMap(r => [r.goldBeforePlay, r.afterPlay.gold, r.afterTurn.gold])) : null,
  perRound:rounds}, null, 2) + '\n');
for (const [name, run] of Object.entries(campaignCases)) report(name, rounds.length === ROUNDS ? run : () => ({pass:false, error:'campaign incomplete'}));
process.exitCode = failed ? 1 : 0;
