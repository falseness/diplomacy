const fs = require('fs');
const path = require('path');
const {isDeepStrictEqual} = require('util');
const {createFixture, defaultFixture} = require('./test-coop-harness');

// The demon slot has a human-like economy: towns, suburbs and open goldmines pay
// income, ordinary units cost salary, portal variants cost nothing and survive a
// crisis, gold survives save/load and demon towns may buy units. Usage:
//   node ai/test-coop-demon-economy.js [--output-dir <dir>] [--fault no-economy]
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const output = arg('--output-dir');
const fault = arg('--fault');
if (fault && fault !== 'no-economy') throw new Error('unknown fault ' + fault);

const TOWN = {x:6, y:3};
const SUBURBS = [{x:6,y:3},{x:6,y:4},{x:7,y:3},{x:7,y:4}];
const MINE = {x:4, y:3};
const MINE_INCOME = 50;
const PORTAL_DEMONS = [['Imp',{x:2,y:5}],['Clawling',{x:3,y:5}],['Hound',{x:2,y:4}],
  ['Brute',{x:3,y:4}],['Spitter',{x:5,y:5}]];

// Coop fixture without the default demon Noob; the demon owns one town with its
// suburbs and one goldmine, opened long ago so it pays income this turn.
function scene() {
  const config = defaultFixture(); config.coop = true; config.actors[3].units = [];
  const f = createFixture(config, () => {});
  if (fault === 'no-economy') {
    // Restore the pre-TASK-412 demon overrides in this process only.
    f.evaluate(`for (const key of ['gold','income','armySalary','goldminesIncome'])
      Object.defineProperty(DemonPlayer.prototype, key, {configurable:true,
        get() { return 0 }, set(value) {}});
      DemonPlayer.prototype.correctGoldminesIncome = function() {};
      for (const p of players) if (p instanceof DemonPlayer) { delete p.gold; p.economyEnabled = false }
      undefined`);
  }
  f.evaluate(`gameRound=25;
    for(const c of ${JSON.stringify(SUBURBS)}) grid.getHexagon(c).firstpaint(3);
    globalThis.town=new Town(${TOWN.x},${TOWN.y},true);
    for(const c of ${JSON.stringify(SUBURBS)}) { const h=grid.getHexagon(c); h.isSuburb=true;
      if(!town.suburbs.includes(h)) town.suburbs.push(h); }
    if(!players[3].towns.includes(town)) players[3].towns.push(town);
    grid.getHexagon(${JSON.stringify(MINE)}).firstpaint(3);
    globalThis.mine=new Goldmine(${MINE.x},${MINE.y},${MINE_INCOME});
    gameSettings.isOnline=false; actionManager.clear(); undefined`);
  return f;
}
function addPortalDemons(f) {
  f.evaluate(`globalThis.portalDemons=${JSON.stringify(PORTAL_DEMONS)}.map(([name,c])=>{
    grid.getHexagon(c).firstpaint(3); return new ({Imp,Clawling,Hound,Brute,Spitter})[name](c.x,c.y) }); undefined`);
}
const gold = f => f.evaluate('players[3].gold');

const cases = {
  income: () => {
    const f = scene();
    // Same rule the human Town/Goldmine use: Town.income + 1 per owned suburb + open mine income.
    const parts = f.evaluate(`({townBase:Town.income, suburbs:town.suburbsCount,
      suburbIncome:1, mine:mine.potentialIncome, mineOpen:mine.isLongOpened, salary:players[3].armySalary})`);
    const expectedGain = parts.townBase + parts.suburbs * parts.suburbIncome + parts.mine - parts.salary;
    const before = gold(f);
    f.evaluate('players[3].nextTurn(); undefined');
    const after = gold(f);
    return {observed:{goldBefore:before, goldAfter:after, gain:after - before, parts},
      expected:{goldBefore:0, goldAfter:expectedGain, gain:expectedGain,
        parts:{townBase:4, suburbs:SUBURBS.length, suburbIncome:1, mine:MINE_INCOME, mineOpen:true, salary:0}},
      formula:'Town.income + suburbsCount*1 + goldmine.income - armySalary = 4 + 4*1 + 50 - 0 = 58'};
  },
  'portal-salary': () => {
    const f = scene();
    const before = f.evaluate('players[3].armySalary');
    addPortalDemons(f);
    const o = f.evaluate(`({salary:players[3].armySalary, units:players[3].units.length,
      classSalaries:portalDemons.map(u=>u.constructor.salary)})`);
    return {observed:{salaryBefore:before, salaryAfter:o.salary, units:o.units, classSalaries:o.classSalaries},
      expected:{salaryBefore:0, salaryAfter:0, units:5, classSalaries:[0,0,0,0,0]}};
  },
  'noob-salary': () => {
    const f = scene();
    addPortalDemons(f);
    const before = f.evaluate('players[3].armySalary');
    f.evaluate('grid.getHexagon({x:5,y:3}).firstpaint(3); globalThis.noob=new Noob(5,3); undefined');
    const o = f.evaluate(`({salary:players[3].armySalary, noobSalary:Noob.salary,
      owner:noob.player===players[3], humanNoob:players[1].units.find(u=>u.constructor===Noob).salary})`);
    return {observed:{salaryBefore:before, salaryAfter:o.salary, owner:o.owner, humanNoobSalary:o.humanNoob},
      expected:{salaryBefore:0, salaryAfter:o.noobSalary, owner:true, humanNoobSalary:1}};
  },
  crisis: () => {
    const f = scene();
    addPortalDemons(f);
    f.evaluate('grid.getHexagon({x:5,y:3}).firstpaint(3); globalThis.noob=new Noob(5,3); players[3].gold=-1000; undefined');
    const before = f.evaluate('players[3].units.length');
    f.evaluate('players[3].nextTurn(); undefined');
    const o = f.evaluate(`({goldAfter:players[3].gold, units:players[3].units.length,
      portalKilled:portalDemons.filter(u=>u.killed).length,
      portalRegistered:portalDemons.every(u=>players[3].units.includes(u)),
      portalOnGrid:portalDemons.every(u=>grid.getUnit(u.coord)===u),
      noobKilled:noob.killed, lost:players[3].isLost})`);
    return {observed:{unitsBefore:before, ...o},
      // The crisis penalty is skipped for the demon slot: nothing dies, gold is reset to 0.
      expected:{unitsBefore:6, goldAfter:0, units:6, portalKilled:0, portalRegistered:true,
        portalOnGrid:true, noobKilled:false, lost:false}};
  },
  'save-roundtrip': () => {
    const f = scene();
    f.evaluate('players[3].nextTurn(); players[3].gold=137; undefined');
    const view = () => f.evaluate(`({gold:players[3].gold, demon:players[3] instanceof DemonPlayer,
      towns:players[3].towns.filter(t=>!t.killed).map(t=>t.coord),
      suburbs:grid.getBuilding(${JSON.stringify(TOWN)}).suburbsCount,
      mineOwner:grid.getHexagon(${JSON.stringify(MINE)}).playerColor})`);
    const before = view();
    const json = f.evaluate('JSON.stringify(getGameObject())');
    f.context.saveInput = json;
    f.evaluate('loadFromJson(saveInput); undefined');
    const after = view();
    return {observed:{before, after, savedGold:JSON.parse(json).players[3].gold},
      expected:{before:{gold:137, demon:true, towns:[TOWN], suburbs:4, mineOwner:3},
        after:{gold:137, demon:true, towns:[TOWN], suburbs:4, mineOwner:3}, savedGold:137}};
  },
  'purchase-allowed': () => {
    const f = scene();
    f.evaluate('players[3].gold=100; undefined');
    const o = f.evaluate(`({cost:production.noob.cost, started:town.prepare('noob'),
      gold:players[3].gold, preparing:town.isPreparingUnit,
      queued:town.isPreparingUnit ? town.unitProduction.name : null})`);
    return {observed:{started:o.started, gold:o.gold, preparing:o.preparing, queued:o.queued},
      expected:{started:true, gold:100 - o.cost, preparing:true, queued:'noob'}, cost:o.cost};
  },
};

if (output) fs.mkdirSync(output, {recursive: true});
let failed = 0;
for (const [name, run] of Object.entries(cases)) {
  let result;
  try { result = run(); } catch (error) { result = {error: error.stack}; }
  const pass = !result.error && isDeepStrictEqual(result.observed, result.expected);
  if (output) fs.writeFileSync(path.join(output, name + '.json'),
    JSON.stringify({case: name, fault, pass, ...result}, null, 2) + '\n');
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(result.error ? {error: result.error} :
    {observed: result.observed, expected: result.expected})}`);
}
process.exitCode = failed ? 1 : 0;
