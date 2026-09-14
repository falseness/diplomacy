'use strict';
// Offline analytical model v1. Coefficients are fixed, never refitted to demons.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const PARAMETERS = Object.freeze({baseline: 20, health: 20 / 3, damage: 10,
  movement: 20 / 3, range: 50 / 3, siegeRangeWeight: 0.25});
const UNIT = 'sprites/entities/units/';
const SOURCES = [
  'ai/demon-config.js', UNIT + 'unit/unit.js', UNIT + 'noob.js', UNIT + 'normchel.js',
  UNIT + 'KOHb/KOHb.js', UNIT + 'range/rangeUnit/rangeUnit.js',
  UNIT + 'range/archer/archer.js', UNIT + 'range/catapult/catapult.js',
  UNIT + 'earlyDemons.js', UNIT + 'heavyDemons.js',
  UNIT + 'range/earlyRangedDemons.js', UNIT + 'lateDemons.js',
  'sprites/entities/buildings/manufactures/preparingManufacture/town.js'
];
const INTERACTIONS = [
  'sprites/entities/entity.js', UNIT + 'unit/interactionWithUnit.js',
  UNIT + 'KOHb/mirroringInteraction.js', UNIT + 'range/rangeUnit/interactionWithRangeUnit.js',
  UNIT + 'range/archer/interactionWithArcher.js', UNIT + 'range/catapult/interactionWithCatapult.js'
];
const PROFILES = Object.freeze({
  melee: 'Adjacent combat and ordinary movement/capture; cavalry mirroring is cosmetic.',
  archer: 'Ordinary movement and adjacent/ranged attacks; ranged attack exhausts moves; terrain barriers constrain base range, elevated buildings extend range and change its path rules.',
  siege: 'Uses buildingDMG for completed buildings and hitUnit, dmg for production; blind area depends on remaining movement/path distance; restrictive target gating, no ordinary adjacent attack. Range premium discounted to one quarter.'
});
function valueUnit(unit) {
  for (const key of ['health', 'damage', 'movement', 'range']) {
    if (!Number.isFinite(unit[key]) || unit[key] < (key === 'damage' ? 0 : 1))
      throw new Error(`Invalid ${key}`);
  }
  if (!Object.hasOwn(PROFILES, unit.profile)) throw new Error('Unknown interaction profile');
  if (unit.profile === 'melee' && unit.range !== 1) throw new Error('Melee range must be 1');
  const p = PARAMETERS;
  const contributions = {baseline: p.baseline, health: (unit.health - 2) * p.health,
    damage: (unit.damage - 1) * p.damage, movement: (unit.movement - 2) * p.movement,
    range: (unit.range - 1) * p.range * (unit.profile === 'siege' ? p.siegeRangeWeight : 1)};
  return {contributions, value: Object.values(contributions).reduce((sum, n) => sum + n, 0)};
}
function validateAnchors(anchors) {
  const prices = {Noob: 20, Archer: 40, KOHb: 40, Normchel: 40, Catapult: 60};
  if (anchors.length !== 5) throw new Error('Expected five recruit anchors');
  for (const [name, price] of Object.entries(prices)) {
    const rows = anchors.filter(a => a.name === name);
    if (rows.length !== 1 || rows[0].price !== price) throw new Error(`Recruit price mismatch: ${name}`);
    if (Math.abs(valueUnit(rows[0]).value - price) > 1e-9)
      throw new Error(`Calibration drift: ${name}; review model version, do not silently refit`);
  }
}
function readProduction() {
  // Evaluate actual class definitions, never construct entities or start a game.
  // Only unused superclass/production references are placeholders.
  const context = vm.createContext({});
  vm.runInContext('class Entity {}\n' + ['UnitProduction', 'SuburbProduction', 'ManufactureProduction',
    'ExternalProduction', 'Empty', 'Farm', 'Barrack', 'Wall', 'Bastion', 'Tower', 'PreparingManufacture']
    .map(name => `class ${name} {}`).join('\n'), context);
  for (const file of SOURCES) vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, {filename: file});
  return JSON.parse(vm.runInContext(`JSON.stringify((() => {
    function describe(C) {
      const profile = C === Catapult ? 'siege' : C.prototype instanceof Archer || C === Archer ? 'archer' : 'melee';
      return {name:C.name, health:C.maxHP, damage:profile === 'siege' ? C.buildingDMG : C.dmg,
        ordinaryDamage:C.dmg, movement:C.speed, range:C.range || 1, profile,
        healSpeed:C.healSpeed, salary:C.salary};
    }
    const anchors = ['noob','archer','KOHb','normchel','catapult'].map(key => ({
      ...describe(production[key].class), price:production[key].cost}));
    const demons = [Imp,Clawling,Hound,Brute,Bulwark,Spitter,EmberArcher,Hexcaster,Ravager,DemonLord]
      .map(C => ({...describe(C), id:C.type, parent:Object.getPrototypeOf(C).name,
        configured:DEMON_TYPES[C.type]}));
    return {anchors, demons};
  })())`, context));
}
function buildReport() {
  const data = readProduction();
  validateAnchors(data.anchors);
  const hashes = {};
  for (const file of [...SOURCES, ...INTERACTIONS, 'ai/coop-army-valuation.js'])
    hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
  return {model: 'gold-equivalent-v1', parameters: PARAMETERS, profiles: PROFILES,
    scope: 'Full-health encounter replacement value; no healing turns, upkeep horizon, terrain bonus or economic capture utility. Analytical only; no purchases or gold.',
    anchors: data.anchors.map(a => ({...a, ...valueUnit(a), residual:valueUnit(a).value - a.price})),
    demons: data.demons.map(d => ({...d, parentPrice:data.anchors.find(a => a.name === d.parent).price, ...valueUnit(d)})),
    sourceHashes: hashes};
}
function markdown(report) {
  return `# Fixed gold-equivalent model v1\n\n` +
    `V = 20 + (H-2)*20/3 + (D-1)*10 + (M-2)*20/3 + (R-1)*50/3*W.\n\n` +
    `H is maximum health, M movement, R base attack range (melee 1). D is ordinary damage except siege uses buildingDMG (4), which also drives its hitUnit method. W is 1 normally and 0.25 for the siege interaction profile. Values are unrounded in JSON; the table rounds to two decimals.\n\n` +
    `Calibration: Noob sets 20. Normchel's extra 3 HP fixes health at 20/3. KOHb's extra 1 HP and 2 movement fixes movement at 20/3. Choose damage = 10 gold per point as an explicit modeling prior; Archer then fixes range at 50/3. Catapult fixes W = 1/4 after substituting H=1,D=4,M=2,R=5. Five prices cannot uniquely identify all tactical effects: this is an exact anchor fit, not empirical combat validation. Siege's discount aggregates blind-area and targeting limits; it is not a universal probability of landing a shot.\n\n` +
    `Healing/salary: record real class rates (demons 0/0, recruits as below), but assign both zero contribution at a zero-turn upkeep/healing horizon. This measures immediate full-health combat capacity, not lifetime ownership cost. Human healing needs a suburb and no recent hit; demons cannot heal. No salary-free bonus is granted and no healing benefit is assumed; hence unchanged Noob-equivalent Imp is exactly 20. Longer campaigns require a separately declared horizon, never a silent change to v1. Demon economic capture restrictions likewise earn no value because capture utility is excluded for every anchor.\n\n` +
    Object.entries(PROFILES).map(([p, text]) => `- ${p}: ${text}`).join('\n') + '\n\n' +
    `Monotonicity: isolated +1 HP, damage, movement increase V by 20/3, 10, 20/3; +1 ranged range increases V by 50/3 (siege 25/6). Profiles held fixed; melee range >1 is invalid and requires an explicit ranged profile. Healing/salary changes are neutral at this horizon. Health/damage synergies, terrain, hit timing and siege movement/blind-area coupling are intentionally unmodeled; actual battle outcomes need not be monotone. Do not interpret these linear extrapolations as win probabilities.\n\n` +
    `## Calibration residuals\n\n| Anchor | H | D | M | R | Heal | Salary | Price | Estimate | Residual |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n` +
    report.anchors.map(a => `| ${a.name} | ${a.health} | ${a.damage} | ${a.movement} | ${a.range} | ${a.healSpeed} | ${a.salary} | ${a.price} | ${a.value.toFixed(2)} | ${a.residual.toFixed(8)} |`).join('\n') +
    `\n\n## Current demon estimates\n\n| Demon | Parent (price) | H | D | M | R | Profile | Heal | Salary | Estimate |\n|---|---|---:|---:|---:|---:|---|---:|---:|---:|\n` +
    report.demons.map(d => `| ${d.id} | ${d.parent} (${d.parentPrice}) | ${d.health} | ${d.damage} | ${d.movement} | ${d.range} | ${d.profile} | ${d.healSpeed} | ${d.salary} | ${d.value.toFixed(2)} |`).join('\n') +
    `\n\nRecompute this report after any stat tuning using the unchanged v1 coefficients. The model reads production classes and validates recruit prices/calibration; labels and parent prices never substitute for configured statistics. JSON retains each arithmetic contribution and source hashes. This offline program is not imported by the game and never adds demon purchases/gold.\n`;
}
if (require.main === module) {
  if (process.argv.length !== 4 || process.argv[2] !== '--report' || !process.argv[3].endsWith('.json'))
    throw new Error('Usage: node ai/coop-army-valuation.js --report path.json');
  const report = buildReport();
  fs.mkdirSync(path.dirname(process.argv[3]), {recursive:true});
  fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(process.argv[3].replace(/\.json$/, '.md'), markdown(report));
  for (const a of report.anchors) console.log(`PASS anchor=${a.name} expected=${a.price} observed=${a.value} residual=${a.residual}`);
  for (const d of report.demons) console.log(`VALUE ${d.id} parent=${d.parent} H=${d.health} D=${d.damage} M=${d.movement} R=${d.range} value=${d.value}`);
  console.log('PASS valuation report anchors=5 demons=10 model=gold-equivalent-v1');
}
module.exports = {PARAMETERS, valueUnit, validateAnchors, readProduction, buildReport, markdown};
