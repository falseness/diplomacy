const fs = require('fs');
const path = require('path');
const {isDeepStrictEqual} = require('util');
const {createFixture, defaultFixture} = require('./test-coop-harness');

// Demons capture an hp-0 human town exactly like a human: the town joins the
// demon registry and its suburbs turn to the demon slot. Usage:
//   node ai/test-coop-demon-town-capture.js [--output-dir <dir>] [--fault raze]
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const output = arg('--output-dir');
const fault = arg('--fault');
if (fault && fault !== 'raze') throw new Error('unknown fault ' + fault);

const TOWN = {x:6, y:3};
const SUBURBS = [{x:6,y:3},{x:6,y:4},{x:7,y:3},{x:7,y:4}];

// owner: slot whose hexes hold the town; attacker: [className, slot] next to it at (5,3).
function scene({owner, townHP, attacker, defenderHP = null}) {
  const config = defaultFixture(); config.coop = true;
  const f = createFixture(config, () => {});
  if (fault === 'raze') {
    // Restore the pre-TASK-409 demon raze rule in this process only.
    f.evaluate(`DemonPlayer.prototype.shouldRazeBuilding = function(building) {
      return building.notEmpty() && building.isTown() && !building.killed &&
        building.player.role === 'HUMAN' }; undefined`);
  }
  f.evaluate(`grid.getHexagon({x:5,y:3}).firstpaint(${attacker[1]});
    globalThis.attacker=new ${attacker[0]}(5,3);
    for(const c of ${JSON.stringify(SUBURBS)}) grid.getHexagon(c).firstpaint(${owner});
    globalThis.target=new Town(${TOWN.x},${TOWN.y},true); target.hp=${townHP};
    for(const c of ${JSON.stringify(SUBURBS)}) { const h=grid.getHexagon(c); h.isSuburb=true;
      if(!target.suburbs.includes(h)) target.suburbs.push(h); }
    globalThis.farm=new Farm(6,4,target); target.buildings.push(farm);
    globalThis.defender=${defenderHP === null ? 'null' : 'new Noob(6,3)'};
    ${defenderHP === null ? '' : `defender.hp=${defenderHP};`}
    gameSettings.isOnline=false; actionManager.clear(); undefined`);
  return f;
}
function observe(f) {
  return f.evaluate(`({town:target.coord, townHP:target.hp, townKilled:target.killed,
    townOwner:target.playerColor, onGrid:grid.getBuilding(target.coord)===target,
    demonTowns:players[3].towns.filter(t=>!t.killed).length,
    humanTowns:players[1].towns.filter(t=>!t.killed).length,
    inDemonTowns:players[3].towns.includes(target), inHumanTowns:players[1].towns.includes(target),
    suburbOwners:${JSON.stringify(SUBURBS)}.map(c=>({coord:c,owner:grid.getHexagon(c).playerColor})),
    attacker:attacker.coord, attackerMoves:attacker.moves,
    defenderHP:defender?defender.hp:null, defenderKilled:defender?defender.killed:null})`);
}
function act(f, slot) {
  f.evaluate(`whooseTurn=${slot}; attacker.select();
    globalThis.legal=attacker.getAvailableCommands().some(c=>coordsEqually(c.destinationCoord,${JSON.stringify(TOWN)}));
    attacker.sendInstructions(grid.getCell(${JSON.stringify(TOWN)})); undefined`);
  return f.evaluate('legal');
}
const owners = slot => SUBURBS.map(c => ({coord:c, owner:slot}));

const cases = {
  'melee-capture': () => {
    const f = scene({owner:1, townHP:0, attacker:['Noob', 3]});
    const before = observe(f);
    const legal = act(f, 3);
    const after = observe(f);
    // Control: a town with hp > 0 is only hit, never entered.
    const g = scene({owner:1, townHP:3, attacker:['Noob', 3]});
    act(g, 3);
    const healthy = observe(g);
    return {
      observed:{town:after.town, legal, demonTownsBefore:before.demonTowns, demonTownsAfter:after.demonTowns,
        humanTownsBefore:before.humanTowns, humanTownsAfter:after.humanTowns,
        inDemonTowns:after.inDemonTowns, inHumanTowns:after.inHumanTowns, townKilled:after.townKilled,
        onGrid:after.onGrid, townOwner:after.townOwner, attacker:after.attacker, suburbOwners:after.suburbOwners,
        healthyControl:{townHP:healthy.townHP, attacker:healthy.attacker, inDemonTowns:healthy.inDemonTowns,
          townOwner:healthy.townOwner}},
      expected:{town:TOWN, legal:true, demonTownsBefore:0, demonTownsAfter:1,
        humanTownsBefore:before.humanTowns, humanTownsAfter:before.humanTowns - 1,
        inDemonTowns:true, inHumanTowns:false, townKilled:false, onGrid:true, townOwner:3,
        attacker:TOWN, suburbOwners:owners(3),
        healthyControl:{townHP:2, attacker:{x:5,y:3}, inDemonTowns:false, townOwner:1}}};
  },
  'ranged-no-enter': () => {
    const f = scene({owner:1, townHP:2, attacker:['Archer', 3]});
    act(f, 3);
    const o = observe(f);
    return {
      observed:{townHP:o.townHP, attacker:o.attacker, townOwner:o.townOwner, inDemonTowns:o.inDemonTowns,
        inHumanTowns:o.inHumanTowns, townKilled:o.townKilled, suburbOwners:o.suburbOwners},
      expected:{townHP:0, attacker:{x:5,y:3}, townOwner:1, inDemonTowns:false, inHumanTowns:true,
        townKilled:false, suburbOwners:owners(1)}};
  },
  'defended': () => {
    const f = scene({owner:1, townHP:0, attacker:['Noob', 3], defenderHP:2});
    act(f, 3);
    const o = observe(f);
    return {
      observed:{defenderHP:o.defenderHP, defenderKilled:o.defenderKilled, attacker:o.attacker,
        townOwner:o.townOwner, inDemonTowns:o.inDemonTowns, inHumanTowns:o.inHumanTowns,
        suburbOwners:o.suburbOwners},
      expected:{defenderHP:1, defenderKilled:false, attacker:{x:5,y:3}, townOwner:1, inDemonTowns:false,
        inHumanTowns:true, suburbOwners:owners(1)}};
  },
  'human-recapture': () => {
    const f = scene({owner:3, townHP:0, attacker:['Noob', 1]});
    const before = observe(f);
    const legal = act(f, 1);
    const o = observe(f);
    return {
      observed:{demonOwnedBefore:before.inDemonTowns, legal, attacker:o.attacker, townOwner:o.townOwner,
        inDemonTowns:o.inDemonTowns, inHumanTowns:o.inHumanTowns, townKilled:o.townKilled,
        demonTowns:o.demonTowns, suburbOwners:o.suburbOwners},
      expected:{demonOwnedBefore:true, legal:true, attacker:TOWN, townOwner:1, inDemonTowns:false,
        inHumanTowns:true, townKilled:false, demonTowns:0, suburbOwners:owners(1)}};
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
  results.push({case:name, fault:fault || null, ...row});
  if (!row.pass) failed++;
  console.log(`${row.pass ? 'PASS' : 'FAIL'} ${name}` +
    (row.pass ? '' : ` observed=${JSON.stringify(row.observed)} expected=${JSON.stringify(row.expected)}`));
}
if (output) {
  fs.mkdirSync(output, {recursive:true});
  fs.writeFileSync(path.join(output, 'cases.json'), JSON.stringify(results, null, 2) + '\n');
}
console.log(`SUMMARY demon-town-capture pass=${results.length - failed} fail=${failed}${fault ? ' fault=' + fault : ''}`);
process.exit(failed ? 1 : 0);
