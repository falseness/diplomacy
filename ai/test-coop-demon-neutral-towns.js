const fs = require('fs');
const path = require('path');
const {isDeepStrictEqual} = require('util');
const {createFixture, defaultFixture} = require('./test-coop-harness');

// Demons treat neutral towns as objectives: they target, hit and capture them,
// and humans can take a demon-captured town back. Usage:
//   node ai/test-coop-demon-neutral-towns.js [--output-dir <dir>]
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const output = arg('--output-dir');

const TOWN = {x:6, y:3};
const SUBURBS = [{x:6,y:3},{x:6,y:4},{x:7,y:3},{x:7,y:4}];

// A town owned by `owner` (0 = neutral) at TOWN, attacker [className, slot] at (5,3).
function scene({owner, townHP, attacker, lone = false}) {
  const config = defaultFixture(); config.coop = true;
  const f = createFixture(config, () => {});
  if (lone) {
    // Remove every other non-nature building so the neutral town is the nearest objective.
    f.evaluate(`for(const row of grid.arr) for(const cell of row) {
      const b=cell.building; if(b.notEmpty() && !b.isNature) b.destroy ? b.destroy() : b.kill() }
      for(const p of players) for(const u of [...p.units]) u.kill(); undefined`);
  }
  f.evaluate(`grid.getHexagon({x:5,y:3}).firstpaint(${attacker[1]});
    globalThis.attacker=new ${attacker[0]}(5,3);
    for(const c of ${JSON.stringify(SUBURBS)}) grid.getHexagon(c).firstpaint(${owner});
    globalThis.target=new Town(${TOWN.x},${TOWN.y},true); target.hp=${townHP};
    for(const c of ${JSON.stringify(SUBURBS)}) { const h=grid.getHexagon(c); h.isSuburb=true;
      if(!target.suburbs.includes(h)) target.suburbs.push(h); }
    gameSettings.isOnline=false; actionManager.clear(); undefined`);
  return f;
}
function observe(f) {
  return f.evaluate(`({townHP:target.hp, townKilled:target.killed, townOwner:target.playerColor,
    onGrid:grid.getBuilding(target.coord)===target,
    cellOwner:grid.getHexagon(target.coord).playerColor,
    inDemonTowns:players[3].towns.includes(target), inHumanTowns:players[1].towns.includes(target),
    suburbOwners:${JSON.stringify(SUBURBS)}.map(c=>grid.getHexagon(c).playerColor),
    attacker:attacker.coord})`);
}
function act(f, slot) {
  f.evaluate(`whooseTurn=${slot}; attacker.select();
    globalThis.legal=attacker.getAvailableCommands().some(c=>coordsEqually(c.destinationCoord,${JSON.stringify(TOWN)}));
    attacker.sendInstructions(grid.getCell(${JSON.stringify(TOWN)})); undefined`);
  return f.evaluate('legal');
}

const cases = {
  'target': () => {
    const f = scene({owner:0, townHP:10, attacker:['Noob', 3], lone:true});
    return {
      observed:{neutralOwner:f.evaluate('target.player.role'),
        ignored:f.evaluate('players[3].ignoresObjective(grid.getCell(target.coord))'),
        best:f.evaluate('new BestEnemyTargetForAI().calculateBestEnemyTarget(attacker.coord,grid.arr,3)')},
      expected:{neutralOwner:'NEUTRAL', ignored:false, best:TOWN}};
  },
  'hit': () => {
    const f = scene({owner:0, townHP:3, attacker:['Noob', 3]});
    const legal = act(f, 3);
    const o = observe(f);
    return {
      observed:{legal, townHP:o.townHP, attacker:o.attacker, townOwner:o.townOwner, inDemonTowns:o.inDemonTowns},
      expected:{legal:true, townHP:2, attacker:{x:5,y:3}, townOwner:0, inDemonTowns:false}};
  },
  'capture': () => {
    const f = scene({owner:0, townHP:0, attacker:['Noob', 3]});
    const legal = act(f, 3);
    const o = observe(f);
    return {
      observed:{legal, attacker:o.attacker, townOwner:o.townOwner, cellOwner:o.cellOwner,
        inDemonTowns:o.inDemonTowns, townKilled:o.townKilled, onGrid:o.onGrid},
      expected:{legal:true, attacker:TOWN, townOwner:3, cellOwner:3,
        inDemonTowns:true, townKilled:false, onGrid:true}};
  },
  'human-recapture': () => {
    // Demon captures the neutral town, then a human noob takes it back.
    const f = scene({owner:0, townHP:0, attacker:['Noob', 3]});
    act(f, 3);
    const captured = observe(f).inDemonTowns;
    f.evaluate(`attacker.kill(); target.hp=0;
      grid.getHexagon({x:5,y:3}).firstpaint(1); globalThis.attacker=new Noob(5,3); undefined`);
    const legal = act(f, 1);
    const o = observe(f);
    return {
      observed:{captured, legal, attacker:o.attacker, townOwner:o.townOwner, cellOwner:o.cellOwner,
        inDemonTowns:o.inDemonTowns, inHumanTowns:o.inHumanTowns, townKilled:o.townKilled},
      expected:{captured:true, legal:true, attacker:TOWN, townOwner:1, cellOwner:1,
        inDemonTowns:false, inHumanTowns:true, townKilled:false}};
  },
};

const results = [];
let failed = 0;
for (const [name, run] of Object.entries(cases)) {
  let row;
  try {
    row = run();
  } catch (error) {
    row = {observed:{error:String(error && error.stack || error)}, expected:'no exception'};
  }
  row.pass = isDeepStrictEqual(row.observed, row.expected);
  results.push({case:name, ...row});
  if (!row.pass) failed++;
  console.log(`${row.pass ? 'PASS' : 'FAIL'} ${name}` +
    (row.pass ? '' : ` observed=${JSON.stringify(row.observed)} expected=${JSON.stringify(row.expected)}`));
}
if (output) {
  fs.mkdirSync(output, {recursive:true});
  fs.writeFileSync(path.join(output, 'cases.json'), JSON.stringify(results, null, 2) + '\n');
}
console.log(`SUMMARY demon-neutral-towns pass=${results.length - failed} fail=${failed}`);
process.exit(failed ? 1 : 0);
