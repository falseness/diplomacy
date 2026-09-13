'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {spawnSync} = require('child_process');
const api = require('./wave-config');
const demonTypes = require('./demon-config');

// Independent design snapshot; none of these expectations read production values.
const expectedTypes = {
  imp: {weight: 1, unlockRound: 1},
  clawling: {weight: 2, unlockRound: 2},
  hound: {weight: 3, unlockRound: 3},
  brute: {weight: 5, unlockRound: 4},
  bulwark: {weight: 7, unlockRound: 6},
  spitter: {weight: 2, unlockRound: 3},
  emberArcher: {weight: 4, unlockRound: 5},
  hexcaster: {weight: 6, unlockRound: 7},
  ravager: {weight: 8, unlockRound: 9},
  demonLord: {weight: 12, unlockRound: 12}
};
// Hand calculated from 2 initial strength points per human, +1 per elapsed
// round, and an additional +2 per human at each of rounds 5, 9 and 13.
// Columns are round, 2-human strength, 3-human strength, 4-human strength.
const strengths = [
  [0, 0, 0, 0], [1, 4, 6, 8], [2, 6, 9, 12], [3, 8, 12, 16],
  [4, 10, 15, 20], [5, 16, 24, 32], [6, 18, 27, 36], [7, 20, 30, 40],
  [8, 22, 33, 44], [9, 28, 42, 56], [10, 30, 45, 60], [11, 32, 48, 64],
  [12, 34, 51, 68], [13, 40, 60, 80], [14, 42, 63, 84],
  [17, 48, 72, 96], [100, 214, 321, 428]
];
function compare(scenario, observed, expected) {
  console.log(JSON.stringify({scenario, expected, observed}));
  assert.deepEqual(observed, expected, scenario);
  console.log(`PASS ${scenario}`);
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function deeplyFrozen(value) {
  return Object.isFrozen(value) && Object.values(value).every(v =>
    !v || typeof v !== 'object' || deeplyFrozen(v));
}
function checkConfig(a, runtime) {
  compare(`${runtime}-literal-configuration`, plain(a.COOP_WAVE_CONFIG), {
    portalHealth: 30, spawnRadius: {min: 1, max: 2}, minInitialHumans: 2,
    maxInitialHumans: 4, baseStrength: 4, strengthPerRound: 2, referenceHumanCount: 2,
    escalations: [{round: 5, bonus: 4}, {round: 9, bonus: 8}, {round: 13, bonus: 12}],
    types: expectedTypes
  });
  compare(`${runtime}-all-ten-demon-types`, Object.keys(a.COOP_WAVE_CONFIG.types), Object.keys(demonTypes));
  for (const [id, rule] of Object.entries(a.COOP_WAVE_CONFIG.types)) {
    compare(`${runtime}-positive-weight-${id}`, Number.isInteger(rule.weight) && rule.weight > 0, true);
  }
  compare(`${runtime}-deeply-frozen`, deeplyFrozen(a.COOP_WAVE_CONFIG), true);
}
function checkProgression(a, runtime) {
  for (const [round, ...expected] of strengths) {
    for (const humans of [2, 3, 4]) {
      compare(`${runtime}-strength-round-${round}-humans-${humans}`,
        a.getCoopWaveStrength(round, humans), expected[humans - 2]);
      compare(`${runtime}-unlocks-round-${round}-humans-${humans}`,
        plain(a.getUnlockedCoopDemonTypes(round)),
        Object.keys(expectedTypes).filter(id => expectedTypes[id].unlockRound <= round));
    }
  }
  // Explicitly enumerate before/at/after every declared unlock and escalation.
  for (const boundary of [1, 2, 3, 4, 5, 6, 7, 9, 12, 13]) {
    compare(`${runtime}-boundary-${boundary}-coverage`,
      [boundary - 1, boundary, boundary + 1].every(r => strengths.some(row => row[0] === r)), true);
  }
  const first = a.getUnlockedCoopDemonTypes(13);
  first.length = 0;
  compare(`${runtime}-unlocks-detached`, plain(a.getUnlockedCoopDemonTypes(13)), Object.keys(expectedTypes));
}
function checkInvalid(a, runtime) {
  // Error names work across VM realms, unlike instanceof against Node's class.
  for (const round of [-1, 1.5, NaN, Infinity, '1', null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => a.getCoopWaveStrength(round, 2), {name: 'RangeError'});
    assert.throws(() => a.getUnlockedCoopDemonTypes(round), {name: 'RangeError'});
  }
  for (const humans of [0, 1, 5, 2.5, NaN, Infinity, '2', null, undefined]) {
    assert.throws(() => a.getCoopWaveStrength(0, humans), {name: 'RangeError'});
    assert.throws(() => a.getCoopWaveStrength(5, humans), {name: 'RangeError'});
  }
  assert.throws(() => a.getCoopWaveStrength(Number.MAX_SAFE_INTEGER, 4), {name: 'RangeError'});
  console.log(`PASS ${runtime}-invalid-inputs expected=RangeError observed=RangeError rounds=8 counts=9 overflow=1`);
}
function runTests() {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const script = "<script src='ai/wave-config.js'></script>";
  compare('browser-script-loaded-once', html.split(script).length - 1, 1);
  compare('browser-config-load-order', html.indexOf("<script src='ai/demon-config.js'>") < html.indexOf(script) &&
    html.indexOf(script) < html.indexOf("<script src='player.js'>"), true);
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'wave-config.js'), 'utf8'), context);
  const browser = vm.runInContext('({COOP_WAVE_CONFIG, getCoopWaveStrength, getUnlockedCoopDemonTypes})', context);
  for (const [runtime, a] of [['node', api], ['browser', browser]]) {
    checkConfig(a, runtime);
    checkProgression(a, runtime);
    checkInvalid(a, runtime);
    assert.throws(() => { a.COOP_WAVE_CONFIG.types.imp.weight = 99; }, TypeError);
    assert.throws(() => { a.COOP_WAVE_CONFIG.escalations[0].bonus = 99; }, TypeError);
    assert.throws(() => { a.COOP_WAVE_CONFIG.spawnRadius.max = 99; }, TypeError);
    console.log(`PASS ${runtime}-rejects-mutation expected=TypeError observed=TypeError`);
  }
  for (const [fault, marker] of [['strength', 'node-strength-round-5-humans-3'],
    ['unlock', 'node-unlocks-round-3-humans-2']]) {
    const child = spawnSync(process.execPath, [__filename, '--fault', fault], {encoding: 'utf8'});
    process.stdout.write(child.stdout); process.stderr.write(child.stderr);
    assert.equal(child.status, 1);
    assert.match(child.stderr, /AssertionError/);
    assert.ok(child.stderr.includes(marker));
    console.log(`PASS rejects-${fault}-corruption expected_exit=1 observed_exit=${child.status} marker=${marker}`);
  }
  console.log('INAPPLICABLE entity/economy invariants: pure configuration queries; no game actions, live-entity changes, IDs, occupied unit positions, map/ownership/serialization references, human income/expenses or demon gold/assets.');
  console.log('INAPPLICABLE turn/round/phase invariants: round numbers are function inputs; no game round or action executes, so shared invariant helpers have no checkpoints.');
  console.log('INAPPLICABLE committed-client convergence: no online games or committed revisions; both runtimes checked against independent literals.');
  console.log('PASS co-op wave config types=10 humans=2,3,4 boundaries=10 strength_checks=102 fault_probes=2');
}
if (require.main === module) {
  const fault = process.argv.indexOf('--fault');
  if (fault === -1) runTests();
  else {
    const corrupted = {...api};
    if (process.argv[fault + 1] === 'strength') {
      corrupted.getCoopWaveStrength = (r, h) => api.getCoopWaveStrength(r, h) + (r === 5 && h === 3 ? 1 : 0);
    } else {
      corrupted.getUnlockedCoopDemonTypes = r => api.getUnlockedCoopDemonTypes(r === 3 ? 2 : r);
    }
    checkProgression(corrupted, 'node');
  }
}
