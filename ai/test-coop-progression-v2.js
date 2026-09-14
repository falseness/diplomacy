'use strict';
const assert = require('node:assert/strict');
const {getCoopWaveConfig, getUnlockedCoopDemonTypes} = require('./wave-config');
const {createFixture, defaultFixture} = require('./test-coop-harness');

function compare(name, observed, expected) {
  console.log(`${name} expected=${JSON.stringify(expected)} observed=${JSON.stringify(observed)}`);
  assert.deepEqual(observed, expected, name);
  console.log(`PASS ${name}`);
}
const schedule = {imp:1, clawling:3, hound:6, brute:10, bulwark:20,
  spitter:6, emberArcher:15, hexcaster:24, ravager:30, demonLord:35};
// Literal sets, including both sides of every distinct boundary. Preserve
// production ordering as well as membership because selection depends on it.
const boundaries = [
  [0, ''], [1, 'imp'], [2, 'imp'], [3, 'imp clawling'],
  [5, 'imp clawling'], [6, 'imp clawling hound spitter'],
  [9, 'imp clawling hound spitter'], [10, 'imp clawling hound brute spitter'],
  [14, 'imp clawling hound brute spitter'], [15, 'imp clawling hound brute spitter emberArcher'],
  [19, 'imp clawling hound brute spitter emberArcher'], [20, 'imp clawling hound brute bulwark spitter emberArcher'],
  [23, 'imp clawling hound brute bulwark spitter emberArcher'], [24, 'imp clawling hound brute bulwark spitter emberArcher hexcaster'],
  [29, 'imp clawling hound brute bulwark spitter emberArcher hexcaster'], [30, 'imp clawling hound brute bulwark spitter emberArcher hexcaster ravager'],
  [34, 'imp clawling hound brute bulwark spitter emberArcher hexcaster ravager'],
  [35, 'imp clawling hound brute bulwark spitter emberArcher hexcaster ravager demonLord'],
  [40, 'imp clawling hound brute bulwark spitter emberArcher hexcaster ravager demonLord']
];
const weights = {imp:1, clawling:2, hound:3, brute:5, bulwark:7,
  spitter:2, emberArcher:4, hexcaster:6, ravager:8, demonLord:12};
// health, damage, movement, range, salary, healing: independent installed v2 rows.
const stats = [[1,1,1,1,0,0], [2,1,2,1,0,0], [2,1,2,1,0,0],
  [5,2,1,1,0,0], [8,1,1,1,0,0], [1,1,1,1,0,0], [2,1,2,2,0,0],
  [3,2,1,2,0,0], [4,3,2,1,0,0], [10,3,1,1,0,0]];
const rules = getCoopWaveConfig(2).types;
compare('v2-exact-schedule', Object.fromEntries(Object.entries(rules).map(([id,r])=>[id,r.unlockRound])), schedule);
compare('v2-weights', Object.fromEntries(Object.entries(rules).map(([id,r])=>[id,r.weight])), weights);
for (const [round, names] of boundaries) {
  compare(`node-boundary-${round}`, getUnlockedCoopDemonTypes(round,2), names ? names.split(' ') : []);
}
const config = defaultFixture(); config.coop = true;
const fixture = createFixture(config);
compare('new-game-balance-version', fixture.evaluate('gameSettings.coop.balanceVersion'), 2);
for (const mode of ['new-game', 'loaded-v2']) {
  if (mode === 'loaded-v2') fixture.evaluate('loadFromJson(JSON.stringify(getGameObject()))');
  compare(`${mode}-balance-version`, fixture.evaluate('gameSettings.coop.balanceVersion'), 2);
  for (const [round, names] of boundaries) {
    compare(`${mode}-boundary-${round}`, fixture.evaluate(`getUnlockedCoopDemonTypes(${round},gameSettings.coop.balanceVersion)`), names ? names.split(' ') : []);
  }
  compare(`${mode}-combat-stats`, fixture.evaluate('[Imp,Clawling,Hound,Brute,Bulwark,Spitter,EmberArcher,Hexcaster,Ravager,DemonLord].map(C=>[C.maxHP,C.dmg,C.speed,C.range || 1,C.salary,C.healSpeed])'), stats);
  compare(`${mode}-weights`, fixture.evaluate('Object.fromEntries(Object.entries(getCoopWaveConfig(gameSettings.coop.balanceVersion).types).map(([id,r])=>[id,r.weight]))'), weights);
}
console.log('PASS progression-v2 boundaries=19 contexts=3 types=10 round0=empty all-eligible=35,40 stats=unchanged weights=unchanged');
