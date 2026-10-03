// Co-op fog games show every ally's statistics; competitive fog keeps them hidden.
// Fixture games are built with createFixture and the real StatisticsInterface
// renders labels through updateSizes() + updatePlayersInfo().
//   --output-dir DIR   evidence directory (cases.json)
//   --fault old-mask   negative control: restores the pre-TASK-373 fog mask
//                      (`isFogOfWar && i != whooseTurn`); must exit 1 on coop-fog-seat1
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');

// options/save.js uses optional chaining; node <14 cannot load the browser scripts.
if (Number(process.versions.node.split('.')[0]) < 16) {
  const result = spawnSync('/usr/local/bin/node20', [__filename, ...process.argv.slice(2)], {stdio: 'inherit'});
  process.exit(result.status === null ? 1 : result.status);
}

const {createFixture, defaultFixture} = require('../../diplomacy_server/tests/client/test-coop-harness');

const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const out = path.resolve(arg('--output-dir', path.join(root, 'artifacts/TASK-373')));
const fault = arg('--fault', null);
assert.ok(fault === null || fault === 'old-mask', 'unknown fault ' + fault);

// Default fixture: neutral 0, humans 1 and 2, then slot 3 (demon in co-op, a
// third player in competitive games).
function config(coop) {
  const c = defaultFixture();
  c.coop = coop;
  return c;
}

function render({coop, fog, turn, lost = []}) {
  const f = createFixture(config(coop), () => {});
  if (fault === 'old-mask') {
    f.evaluate(`(() => {
      const source = StatisticsInterface.prototype.updatePlayersInfo.toString()
      const patched = source.replace('isFogOfWar && !gameSettings.coop && i != whooseTurn',
        'isFogOfWar && i != whooseTurn')
      if (patched === source) throw new Error('old-mask fault: condition not found')
      StatisticsInterface.prototype.updatePlayersInfo = eval('(function ' + patched + ')')
    })()`);
  }
  f.evaluate(`(() => {
    // index.html creates the rendering context inline; Text.width only needs measureText.
    mainCtx = {measureText: text => ({width: String(text).length * 8}), save() {}, restore() {}}
    statisticsInterface = new StatisticsInterface()
    isFogOfWar = ${fog}
    whooseTurn = ${turn}
    // Player.isLost is a getter over live towns/units; shadow it on the instance.
    for (const i of ${JSON.stringify(lost)}) Object.defineProperty(players[i], 'isLost', {value: true})
    statisticsInterface.updateSizes()
    statisticsInterface.updatePlayersInfo()
  })()`);
  return f.evaluate(`({
    gameSettings: {coop: !!gameSettings.coop},
    isFogOfWar, whooseTurn,
    players: statisticsInterface.playersInfo.map((label, k) => ({
      index: k + 1, kind: players[k + 1].constructor.name,
      human: !!(gameSettings.coop ? gameSettings.coop.humanSlots.includes(k + 1) : true),
      label: label.text.text, info: players[k + 1].info, isLost: !!players[k + 1].isLost}))
  })`);
}

// Expected label per player index for each mode.
const coopExpected = p => p.isLost ? 'Lost' : p.info;
const CASES = [
  {name: 'coop-fog-seat1', coop: true, fog: true, turn: 1, expected: coopExpected},
  {name: 'coop-fog-seat2', coop: true, fog: true, turn: 2, expected: coopExpected},
  {name: 'coop-fog-lost', coop: true, fog: true, turn: 1, lost: [2], expected: coopExpected},
  {name: 'competitive-fog', coop: false, fog: true, turn: 1,
    expected: (p, turn) => p.isLost ? 'Lost' : p.index === turn ? p.info : '???'},
  {name: 'competitive-nofog', coop: false, fog: false, turn: 1, expected: coopExpected},
];

const results = [];
let failed = 0;
for (const c of CASES) {
  const observed = render(c);
  for (const p of observed.players) {
    p.expected = c.expected(p, c.turn);
    p.match = p.label === p.expected;
  }
  const record = {case: c.name, ...observed};
  results.push(record);
  try {
    assert.equal(observed.gameSettings.coop, c.coop, `${c.name}: gameSettings.coop`);
    assert.equal(observed.isFogOfWar, c.fog, `${c.name}: isFogOfWar`);
    assert.equal(observed.whooseTurn, c.turn, `${c.name}: whooseTurn`);
    for (const i of c.lost || []) assert.equal(observed.players[i - 1].label, 'Lost', `${c.name}: player ${i} Lost`);
    if (c.coop) {
      const humans = observed.players.filter(p => p.human && !p.isLost);
      if (!(c.lost || []).length) assert.ok(humans.some(p => p.index !== c.turn),
        `${c.name}: needs a live non-current ally`);
      for (const p of humans) assert.notEqual(p.label, '???',
        `${c.name}: player ${p.index} (whooseTurn ${c.turn}) shows '???' instead of its info`);
    }
    for (const p of observed.players) assert.ok(p.match,
      `${c.name}: player ${p.index} label ${JSON.stringify(p.label)} expected ${JSON.stringify(p.expected)}`);
    record.passed = true;
    console.log(`PASS ${c.name}`);
  } catch (error) {
    record.passed = false;
    record.error = error.message;
    failed++;
    console.log(`FAIL ${c.name}: ${error.message}`);
  }
}

fs.mkdirSync(out, {recursive: true});
fs.writeFileSync(path.join(out, 'cases.json'), JSON.stringify({fault, cases: results}, null, 2) + '\n');
console.log(`${CASES.length - failed} passed, ${failed} failed${fault ? ' (fault ' + fault + ')' : ''}`);
process.exit(failed ? 1 : 0);
