const fs = require('fs');
const path = require('path');
const {isDeepStrictEqual} = require('util');
const {createFixture, defaultFixture} = require('./test-coop-harness');

// Demons treat goldmines as objectives: they walk toward them and capture them
// by stepping on (the hex colour is the owner); humans can take them back. Usage:
//   node ai/test-coop-demon-neutral-goldmines.js [--output-dir <dir>]
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const output = arg('--output-dir');

const MINE = {x:6, y:3};

// A goldmine owned by `owner` (0 = neutral) at MINE, attacker [className, slot] at `from`.
function scene({owner, attacker, from = {x:5, y:3}, lone = false}) {
  const config = defaultFixture(); config.coop = true;
  const f = createFixture(config, () => {});
  if (lone) {
    // Remove every other non-nature building and unit so the mine is the only objective.
    f.evaluate(`for(const row of grid.arr) for(const cell of row) {
      const b=cell.building; if(b.notEmpty() && !b.isNature) b.destroy ? b.destroy() : b.kill() }
      for(const p of players) for(const u of [...p.units]) u.kill(); undefined`);
  }
  f.evaluate(`grid.getHexagon(${JSON.stringify(from)}).firstpaint(${attacker[1]});
    globalThis.attacker=new ${attacker[0]}(${from.x},${from.y});
    grid.getHexagon(${JSON.stringify(MINE)}).firstpaint(${owner});
    globalThis.mine=new Goldmine(${MINE.x},${MINE.y},50);
    gameSettings.isOnline=false; actionManager.clear(); undefined`);
  return f;
}
function observe(f) {
  return f.evaluate(`({gridOwner:grid.getHexagon(mine.coord).playerColor, mineOwner:mine.playerColor,
    onGrid:grid.getBuilding(mine.coord)===mine, hitable:mine.isHitable,
    demonOwns:players[3].isOurGoldmine(mine), attacker:attacker.coord})`);
}
function act(f, slot) {
  f.evaluate(`whooseTurn=${slot}; attacker.select();
    globalThis.legal=attacker.getAvailableCommands().some(c=>coordsEqually(c.destinationCoord,${JSON.stringify(MINE)}));
    attacker.sendInstructions(grid.getCell(${JSON.stringify(MINE)})); undefined`);
  return f.evaluate('legal');
}
const distanceToMine = f => f.evaluate(`(() => { const b=new BestEnemyTargetForAI();
  b.create(mine.coord, BestEnemyTargetForAI.unreachableDistance, grid.arr, 3, border);
  return b.distance[attacker.coord.x][attacker.coord.y] })()`);

const cases = {
  'target': () => {
    const f = scene({owner:0, attacker:['Noob', 3], from:{x:3, y:3}, lone:true});
    const before = observe(f), distanceBefore = distanceToMine(f);
    const best = f.evaluate('new BestEnemyTargetForAI().calculateBestEnemyTarget(attacker.coord,grid.arr,3)');
    const command = f.evaluate(`(() => { whooseTurn=3; attacker.select();
      const c=new BestEnemyTargetForAI().GetCommandNearestToBestTarget(attacker.getAvailableCommands(),
        attacker.coord,grid.arr,3); if(c) attacker.sendInstructions(grid.getCell(c.destinationCoord));
      return c && c.destinationCoord })()`);
    const after = observe(f), distanceAfter = distanceToMine(f);
    return {mine:MINE, before, after,
      observed:{mineRole:f.evaluate('mine.player.role'), hitable:before.hitable,
        ignored:f.evaluate('players[3].ignoresObjective(grid.getCell(mine.coord))'), best,
        moved:!!command && isDeepStrictEqual(after.attacker, command),
        closer:distanceAfter < distanceBefore, gridOwner:after.gridOwner},
      expected:{mineRole:'NEUTRAL', hitable:false, ignored:false, best:MINE,
        moved:true, closer:true, gridOwner:0}};
  },
  'capture': () => {
    const f = scene({owner:0, attacker:['Noob', 3]});
    const before = observe(f), legal = act(f, 3), after = observe(f);
    return {mine:MINE, before, after,
      observed:{legal, before:before.gridOwner, attacker:after.attacker, gridOwner:after.gridOwner,
        mineOwner:after.mineOwner, demonOwns:after.demonOwns, onGrid:after.onGrid},
      expected:{legal:true, before:0, attacker:MINE, gridOwner:3, mineOwner:3, demonOwns:true, onGrid:true}};
  },
  'capture-from-human': () => {
    const f = scene({owner:1, attacker:['Noob', 3]});
    const before = observe(f), legal = act(f, 3), after = observe(f);
    return {mine:MINE, before, after,
      observed:{legal, before:before.gridOwner, attacker:after.attacker, gridOwner:after.gridOwner,
        mineOwner:after.mineOwner, demonOwns:after.demonOwns,
        humanOwns:f.evaluate('players[1].isOurGoldmine(mine)'), onGrid:after.onGrid},
      expected:{legal:true, before:1, attacker:MINE, gridOwner:3, mineOwner:3, demonOwns:true,
        humanOwns:false, onGrid:true}};
  },
  'human-recapture': () => {
    // Demon captures the neutral mine, then a human noob takes it back.
    const f = scene({owner:0, attacker:['Noob', 3]});
    const before = observe(f);
    act(f, 3);
    const captured = observe(f);
    f.evaluate(`attacker.kill(); grid.getHexagon({x:5,y:3}).firstpaint(1);
      globalThis.attacker=new Noob(5,3); actionManager.clear(); undefined`);
    const legal = act(f, 1), after = observe(f);
    return {mine:MINE, before, captured, after,
      observed:{capturedOwner:captured.gridOwner, legal, attacker:after.attacker, gridOwner:after.gridOwner,
        demonOwns:after.demonOwns, humanOwns:f.evaluate('players[1].isOurGoldmine(mine)'), onGrid:after.onGrid},
      expected:{capturedOwner:3, legal:true, attacker:MINE, gridOwner:1, demonOwns:false,
        humanOwns:true, onGrid:true}};
  },
};

const results = [];
let failed = 0;
if (output) fs.mkdirSync(output, {recursive:true});
for (const [name, run] of Object.entries(cases)) {
  let row;
  try {
    row = run();
  } catch (error) {
    row = {observed:{error:String(error && error.stack || error)}, expected:'no exception'};
  }
  row.pass = isDeepStrictEqual(row.observed, row.expected);
  results.push({case:name, ...row});
  if (output) fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify({case:name, ...row}, null, 2) + '\n');
  if (!row.pass) failed++;
  console.log(`${row.pass ? 'PASS' : 'FAIL'} ${name}` +
    (row.pass ? '' : ` observed=${JSON.stringify(row.observed)} expected=${JSON.stringify(row.expected)}`));
}
if (output) fs.writeFileSync(path.join(output, 'cases.json'), JSON.stringify(results, null, 2) + '\n');
console.log(`SUMMARY demon-neutral-goldmines pass=${results.length - failed} fail=${failed}`);
process.exit(failed ? 1 : 0);
