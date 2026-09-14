'use strict';
const assert = require('node:assert/strict');
const {createFixture, defaultFixture} = require('./test-coop-harness');

// Independent design data and integer interval oracle. No production config,
// selection function, floating point tickets or historical tuning data is used.
const unlocks = {imp:1,clawling:3,hound:6,brute:10,bulwark:20,spitter:6,
  emberArcher:15,hexcaster:24,ravager:30,demonLord:35};
const weights = {imp:1,clawling:2,hound:3,brute:5,bulwark:7,spitter:2,
  emberArcher:4,hexcaster:6,ravager:8,demonLord:12};
const health = {imp:1,clawling:2,hound:2,brute:5,bulwark:8,spitter:1,
  emberArcher:2,hexcaster:3,ravager:4,demonLord:10};
const portals = [{x:9,y:2},{x:12,y:6}];
const seed = 6; // Fixed fixture: (9,2) constructs Demon Lord at round 35.
function oracle(round, available = portals) {
  const pool = Object.keys(unlocks).filter(id => unlocks[id] <= round);
  const total = pool.reduce((sum,id) => sum + weights[id], 0);
  return available.flatMap(({x,y}) => {
    const modulus = 2n ** 32n;
    let value = BigInt(seed) ^ (BigInt(round) * 2654435761n % modulus);
    for (const coordinate of [x,y]) value = ((value ^ BigInt(coordinate)) * 1664525n + 1013904223n) % modulus;
    let cumulative = 0;
    const type = pool.find(id => {
      cumulative += weights[id];
      return value * BigInt(total) < BigInt(cumulative) * modulus;
    });
    return type ? [{type,x,y}] : [];
  });
}
module.exports = function run(compare) {
  function setup(saved) {
    const c = defaultFixture(); c.coop = true; c.size = {x:15,y:9};
    c.actors.forEach(a => {a.towns=[];a.units=[];});
    c.actors[1].units=[{x:1,y:1,hp:2}]; c.actors[1].gold=1000;
    c.actors[2].units=[{x:1,y:7,hp:2}]; c.actors[2].gold=1000;
    const f = createFixture(c, () => {});
    if (saved) {
      f.context.savedInput = saved;
      f.evaluate('loadFromJson(savedInput)');
    } else f.evaluate(`new DemonPortal(9,2); new DemonPortal(12,6);
      gameSettings.coop.waveGeneration={version:1,seed:${seed},lastRound:0}; undefined`);
    // Isolate wave/persistence rules from combat. Real dispatcher, demon refresh,
    // human upkeep, construction and serialization still execute.
    f.evaluate(`AiRuntime.trainFromHumanCommands=()=>{}; gameEvent.nextTurn=()=>{};
      nextTurnPauseInterface={visible:false}; menuBack=()=>{gameExit=true};
      timer.pauseAndSaveTime=()=>{}; timer.setNextTurnTime=()=>{};
      globalThis.saveManager={save(){}}; players[3].play=()=>{}; undefined`);
    return f;
  }
  const state = f => f.evaluate('JSON.parse(JSON.stringify(getGameObject()))');
  const units = f => f.evaluate(`players[3].units.filter(u=>!u.killed).map(u=>({type:u.name,
    x:u.coord.x,y:u.coord.y,hp:u.hp,owner:u.playerColor,registered:players[3].units.includes(u)}))`);
  const expectedUnits = rows => rows.map(r => ({...r,hp:health[r.type],owner:3,registered:true}));
  const clear = f => f.evaluate('players[3].units.slice().forEach(u=>u.kill()); undefined');
  function run(saved, label) {
    const f = setup(saved), snapshots = {}, waves = [];
    if (saved) {
      compare(`${label}-loaded-exact-state`, state(f), JSON.parse(saved));
      const packed = JSON.parse(saved);
      compare(`${label}-saved-markers`, f.evaluate('({version:gameSettings.coop.balanceVersion,seed:gameSettings.coop.waveGeneration.seed,round:gameRound,phase:gameSettings.coop.localPhase})'),
        {version:2,seed,round:34,phase:{round:35,stage:packed.gameSettings.coop.localPhase.stage}});
    }
    f.context.recordWave = (round, rawWave) => {
      const wave = JSON.parse(JSON.stringify(rawWave));
      const expected = oracle(round);
      compare(`${label}-round-${round}-spawn`, wave, {spawned:expected,skipped:0});
      compare(`${label}-round-${round}-constructed`, units(f), expectedUnits(expected));
      compare(`${label}-round-${round}-no-early-demon`, wave.spawned.every(row => unlocks[row.type] <= round), true);
      waves.push({round,wave});
    };
    f.context.capturePhase = () => {
      if (!saved && f.evaluate('gameSettings.coop.localPhase.round') === 35) {
        const stage = f.evaluate('gameSettings.coop.localPhase.stage');
        snapshots[stage] = JSON.stringify(state(f));
      }
    };
    f.evaluate(`const originalSpawn=spawnCoopWave;
      spawnCoopWave=(r,s)=>{const result=originalSpawn(r,s);recordWave(r,result);return result};
      const originalStep=advanceCoopLocalPhase;
      advanceCoopLocalPhase=()=>{capturePhase();originalStep();capturePhase()}; undefined`);
    if (!saved) {
      compare('local-round-0-no-dispatched-wave', {round:f.evaluate('gameRound'),waves,units:units(f)}, {round:0,waves:[],units:[]});
      compare('local-round-0-selection', f.evaluate(`composeCoopWave(${seed},0,2,${JSON.stringify(portals)},2)`), {round:0,types:[],selections:[]});
      compare('local-round-0-spawn', f.evaluate('spawnCoopWave(0)'), {spawned:[],skipped:0});
      waves.length=0;
    } else {
      f.evaluate('nextTurn()');
      compare(`${label}-resumed-round-35-units`, units(f), expectedUnits(oracle(35)));
      clear(f);
    }
    while (f.evaluate('gameRound') < 40) {
      const round = f.evaluate('gameRound') + 1;
      compare(`${label}-round-${round}-selection`, f.evaluate(`composeCoopWave(${seed},${round},2,${JSON.stringify(portals)},2)`),
        {round,types:oracle(round).map(r=>r.type),selections:oracle(round)});
      f.evaluate('nextTurn(); nextTurn()');
      compare(`${label}-round-${round}-completed`, f.evaluate('({round:gameRound,turn:whooseTurn,phase:gameSettings.coop.localPhase||null,lastRound:gameSettings.coop.waveGeneration.lastRound})'),
        {round,turn:1,phase:null,lastRound:round});
      if (round < 40) clear(f);
    }
    return {snapshots,waves,final:state(f)};
  }
  const baseline = run(null,'uninterrupted');
  for (const stage of ['wave','demon','complete']) {
    assert.ok(baseline.snapshots[stage]);
    const resumed = run(baseline.snapshots[stage], `reload-${stage}`);
    compare(`save-load-${stage}-subsequent-selections-spawns`, resumed.waves,
      baseline.waves.filter(w => w.round >= (stage === 'wave' ? 35 : 36)));
    compare(`save-load-${stage}-full-final-state`, resumed.final, baseline.final);
  }
  const f = setup();
  compare('demon-lord-ineligible-34', f.evaluate('getUnlockedCoopDemonTypes(34,2).includes("demonLord")'), false);
  compare('demon-lord-eligible-35', f.evaluate('getUnlockedCoopDemonTypes(35,2).includes("demonLord")'), true);
  compare('demon-lord-fixed-fixture-35', oracle(35)[0], {type:'demonLord',x:9,y:2});
  compare('demon-lord-actual-construction-35', f.evaluate('spawnCoopWave(35)').spawned, oracle(35));
  compare('demon-lord-instance-35', f.evaluate('grid.getUnit({x:9,y:2}) instanceof DemonLord'), true);
  for (const round of [36,37,38]) compare(`occupied-portals-round-${round}`, f.evaluate(`spawnCoopWave(${round})`), {spawned:[],skipped:0});
  f.evaluate('grid.getBuilding({x:12,y:6}).destroy(); undefined');
  clear(f);
  compare('released-current-round-39-no-backlog-destroyed-suppressed', f.evaluate('spawnCoopWave(39)'), {spawned:oracle(39,[portals[0]]),skipped:0});
  compare('released-constructed-one-per-available-portal', units(f), expectedUnits(oracle(39,[portals[0]])));
  compare('no-backlog-saved-generation', f.evaluate('gameSettings.coop.waveGeneration'), {version:1,seed,lastRound:39});
  clear(f);
  compare('destroyed-portal-still-suppressed-40', f.evaluate('spawnCoopWave(40)'), {spawned:oracle(40,[portals[0]]),skipped:0});
  console.log('PASS local-progression rounds=0..40 oracle=independent-bigint round1=imp demonLord35=constructed blocked=3 destroyed=suppressed backlog=none saved-phases=3 continuation=identical');
};
