'use strict';
const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {valueUnit, validateAnchors, buildReport, markdown, PARAMETERS} = require('./coop-army-valuation');
function compare(name, observed, expected) {
  console.log(JSON.stringify({scenario:name, expected, observed}));
  if (typeof expected === 'number') assert.ok(Math.abs(observed - expected) < 1e-9, name);
  else assert.deepEqual(observed, expected, name);
  console.log(`PASS ${name}`);
}
const report = buildReport();
if (process.argv[2] === '--corrupt-price') {
  report.anchors[0].price = 21;
  validateAnchors(report.anchors);
  throw new Error('Corruption unexpectedly accepted');
}
if (process.argv[2] === '--corrupt-stat') {
  report.anchors[0].health = 3;
  validateAnchors(report.anchors);
  throw new Error('Corruption unexpectedly accepted');
}
// Literal production expectations and hand-calculated fractions, not generated
// from model coefficients, demon-config, parent price, or report output.
const anchors = [
  ['Noob',2,1,2,1,1,1,20], ['Archer',1,2,2,2,1,2,40],
  ['KOHb',3,1,4,1,2,2,40], ['Normchel',5,1,2,1,3,2,40],
  ['Catapult',1,4,2,5,1,2,60]
];
compare('production-anchor-characteristics', report.anchors.map(a =>
  [a.name,a.health,a.damage,a.movement,a.range,a.healSpeed,a.salary,a.price]), anchors);
for (const a of report.anchors) {
  compare(`anchor-${a.name}`, a.value, anchors.find(row => row[0] === a.name)[7]);
  compare(`residual-${a.name}`, a.residual, 0);
}
const expected = [
  ['imp','Noob',2,1,2,1,'melee',20],
  ['clawling','Noob',1,2,2,1,'melee',70/3],
  ['hound','KOHb',2,1,5,1,'melee',40],
  ['brute','Normchel',3,2,2,1,'melee',110/3],
  ['bulwark','Normchel',7,1,2,1,'melee',160/3],
  ['spitter','Archer',2,1,2,1,'archer',20],
  ['emberArcher','Archer',1,1,2,3,'archer',140/3],
  ['hexcaster','Archer',1,3,1,2,'archer',130/3],
  ['ravager','KOHb',4,1,3,1,'melee',40],
  ['demonLord','Normchel',5,3,2,1,'melee',60]
];
compare('ten-current-demon-characteristics', report.demons.map(d =>
  [d.id,d.parent,d.health,d.damage,d.movement,d.range,d.profile]), expected.map(row => row.slice(0,7)));
for (const d of report.demons) {
  compare(`value-${d.id}`,d.value,expected.find(row => row[0] === d.id)[7]);
  compare(`configured-runtime-${d.id}`, [d.health,d.damage,d.movement,d.range],
    [d.configured.health,d.configured.damage,d.configured.movement,d.configured.range]);
  compare(`demon-no-heal-or-salary-${d.id}`, [d.healSpeed,d.salary], [0,0]);
}
compare('unchanged-Noob-equivalent-Imp',report.demons[0].value,20);
compare('same-parent-different-stats-different-value',report.demons[0].value !== report.demons[1].value,true);
let improvements = 0;
for (const unit of [...report.anchors,...report.demons]) {
  const original = JSON.stringify(unit);
  for (const [key,delta] of [['health',20/3],['damage',10],['movement',20/3],
    ...(unit.profile === 'melee' ? [] : [['range',unit.profile === 'siege' ? 25/6 : 50/3]])]) {
    compare(`isolated-improvement-${unit.name}-${key}`,
      valueUnit({...unit,[key]:unit[key]+1}).value - valueUnit(unit).value,delta);
    improvements++;
  }
  compare(`pure-input-${unit.name}`,JSON.stringify(unit),original);
  compare(`zero-horizon-healing-salary-${unit.name}`,
    valueUnit({...unit,healSpeed:99,salary:99}).value,unit.value);
}
const spitter = report.demons.find(d => d.id === 'spitter');
// Spitter has Imp's stats at range 1; one more range point is the whole ranged premium.
compare('range-advantage-vs-otherwise-identical-Imp',valueUnit({...spitter,range:2}).value-report.demons[0].value,50/3);
const siege = report.anchors.find(a => a.name === 'Catapult');
compare('siege-limitation-discount',valueUnit({...siege,profile:'archer'}).value-siege.value,50);
compare('catapult-ordinary-damage-distinct-from-effective-damage',[siege.ordinaryDamage,siege.damage],[0,4]);
compare('fixed-parameters-frozen',Object.isFrozen(PARAMETERS),true);
compare('deterministic-production-report',buildReport(),report);
for (const patch of [{health:NaN},{damage:-1},{movement:Infinity},{range:0},{profile:'invented'}, {range:2}]) {
  assert.throws(() => valueUnit({...report.demons[0],...patch}), /Invalid|Unknown|Melee/);
  console.log(`PASS invalid-input-rejected ${JSON.stringify(patch)}`);
}
for (const fault of ['price','stat']) {
  console.log(`EXPECTED corruption-probe ${fault} BEGIN`);
  const child = spawnSync(process.execPath,[__filename,`--corrupt-${fault}`],{encoding:'utf8'});
  process.stdout.write(child.stdout); process.stderr.write(child.stderr);
  compare(`corrupt-${fault}-exit`,child.status,1);
  assert.match(child.stderr, fault === 'price' ? /Recruit price mismatch: Noob/ : /Calibration drift: Noob/);
  console.log(`EXPECTED corruption-probe ${fault} END actual_exit_status=${child.status}`);
}
assert.match(markdown(report),/Healing\/salary:/);
assert.match(markdown(report),/Calibration residuals/);
console.log(`PASS army valuation anchors=5 demons=10 isolated_improvements=${improvements} corruption_probes=2`);
