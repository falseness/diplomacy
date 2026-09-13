'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {spawnSync} = require('child_process');
const config = require('./demon-config');

// Independent design snapshot: never generate this data from the production table.
const expectedRows = [
  ['imp', 'Imp', 'fragile basic melee', 2, 1, 2, true, false, 1],
  ['clawling', 'Clawling', 'quick light melee', 3, 1, 3, true, false, 1],
  ['hound', 'Hound', 'fast melee pursuit', 4, 2, 4, true, false, 1],
  ['brute', 'Brute', 'slow high-health melee', 10, 3, 1, true, false, 1],
  ['bulwark', 'Bulwark', 'very durable slow melee', 16, 2, 1, true, false, 1],
  ['spitter', 'Spitter', 'fragile short-range attacker', 2, 1, 2, true, true, 2],
  ['emberArcher', 'Ember Archer', 'mobile ranged attacker', 4, 2, 3, true, true, 3],
  ['hexcaster', 'Hexcaster', 'slow stronger ranged attacker', 5, 4, 1, true, true, 3],
  ['ravager', 'Ravager', 'fast strong late-game melee', 8, 5, 4, true, false, 1],
  ['demonLord', 'Demon Lord', 'durable powerful late-game melee', 20, 6, 2, true, false, 1]
];
function compare(scenario, observed, expected) {
  console.log(JSON.stringify({scenario, expected, observed}));
  assert.deepEqual(observed, expected, scenario);
  console.log(`PASS ${scenario}`);
}
function snapshot(c, runtime) {
  compare(`${runtime}-ten-types`, Object.keys(c), expectedRows.map(row => row[0]));
  for (const [id, name, role, health, damage, movement, melee, ranged, range] of expectedRows) {
    compare(`${runtime}-exact-${id}`, c[id], {name, role, health, damage, movement, melee, ranged, range});
  }
}
function roles(c) {
  const {imp: i, clawling: c1, hound: h, brute: b, bulwark: w,
    spitter: s, emberArcher: e, hexcaster: x, ravager: r, demonLord: l} = c;
  const checks = {
    'imp-fragile-basic-melee': i.health < c1.health && i.damage === 1 && i.melee && !i.ranged,
    'clawling-quick-light-melee': c1.movement > i.movement && c1.health < h.health && c1.damage < h.damage && c1.melee && !c1.ranged,
    'hound-fast-pursuit': h.movement > c1.movement && h.melee && !h.ranged,
    'brute-slow-high-health': b.movement < i.movement && b.health > h.health && b.melee && !b.ranged,
    'bulwark-very-durable-slow': w.health > b.health && w.movement === b.movement && w.melee && !w.ranged,
    'spitter-fragile-short-range': s.health === i.health && s.health < e.health && s.ranged && s.range > 1 && s.range < e.range,
    'ember-archer-mobile-ranged': e.ranged && e.movement > s.movement && e.movement > x.movement,
    'hexcaster-slow-stronger-ranged': x.ranged && x.movement < s.movement && x.damage > e.damage && x.damage > s.damage,
    'ravager-fast-strong-melee': r.melee && !r.ranged && r.movement === h.movement && r.damage > b.damage && r.damage > h.damage,
    'demon-lord-durable-powerful-melee': l.melee && !l.ranged && l.health > w.health && l.damage > r.damage
  };
  for (const [name, observed] of Object.entries(checks)) compare(`role-${name}`, observed, true);
  for (const [id, type] of Object.entries(c)) {
    compare(`valid-stats-${id}`, ['health', 'damage', 'movement', 'range'].every(key =>
      Number.isInteger(type[key]) && type[key] > 0) && type.melee &&
      (type.ranged ? type.range > 1 : type.range === 1), true);
  }
}
function runTests() {
  snapshot(config, 'node');
  roles(config);
  // Load the exact script referenced by the browser, without starting a game.
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const script = "<script src='ai/demon-config.js'></script>";
  compare('browser-script-loaded-once', html.split(script).length - 1, 1);
  compare('browser-config-before-players', html.indexOf(script) < html.indexOf("<script src='player.js'>"), true);
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'demon-config.js'), 'utf8'), context);
  snapshot(JSON.parse(vm.runInContext('JSON.stringify(DEMON_TYPES)', context)), 'browser');
  compare('browser-deeply-frozen', vm.runInContext('Object.isFrozen(DEMON_TYPES) && Object.values(DEMON_TYPES).every(Object.isFrozen)', context), true);
  compare('node-deeply-frozen', Object.isFrozen(config) && Object.values(config).every(Object.isFrozen), true);
  assert.throws(() => { config.imp.health = 99; }, TypeError);
  assert.throws(() => { config.extra = {}; }, TypeError);
  console.log('PASS rejects-config-mutation expected=TypeError observed=TypeError');
  for (const [fault, marker] of [['stat', 'node-exact-imp'], ['role', 'role-hound-fast-pursuit']]) {
    const child = spawnSync(process.execPath, [__filename, '--fault', fault], {encoding: 'utf8'});
    process.stdout.write(child.stdout); process.stderr.write(child.stderr);
    assert.equal(child.status, 1);
    assert.match(child.stderr, /AssertionError/);
    assert.ok(child.stderr.includes(marker));
    console.log(`PASS rejects-${fault}-corruption expected_exit=1 observed_exit=${child.status} marker=${marker}`);
  }
  console.log('INAPPLICABLE entity/economy invariants: static configuration only; no entities, IDs, occupied positions, map/ownership/serialization references, human income/expenses or demon gold/assets are created or changed.');
  console.log('INAPPLICABLE turn/round/phase invariants: no game actions or rounds execute, so shared action/round invariant helpers have no checkpoints.');
  console.log('INAPPLICABLE committed-client convergence: no online games or committed revisions; browser and Node configurations are each compared with independent expected data.');
  console.log('PASS co-op demon config types=10 role_checks=10 fault_probes=2');
}
if (require.main === module) {
  const fault = process.argv.indexOf('--fault');
  if (fault !== -1) {
    const corrupted = JSON.parse(JSON.stringify(config));
    if (process.argv[fault + 1] === 'stat') {
      corrupted.imp.health++;
      snapshot(corrupted, 'node');
    } else {
      corrupted.hound.movement = 1;
      roles(corrupted);
    }
  } else runTests();
}
