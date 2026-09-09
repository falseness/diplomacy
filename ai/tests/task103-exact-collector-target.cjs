// Read-only diagnostic instrumentation of the actual collector. No fitting or policy edits.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const { createTrainingBatch } = require('../economy-training');
const { scoreFinalEconomyVector } = require('../benchmark-final-symmetrical-economy-gate');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function material(state, index) {
  const self = state[index];
  if (self.lost) return -1;
  const opponents = state.filter((p, i) => i > 0 && i !== index && !p.lost);
  if (!opponents.length) return 1;
  const mean = key => opponents.reduce((sum, p) => sum + p[key], 0) / opponents.length;
  return Math.max(-1, Math.min(1, (self.towns - mean('towns')) * .45 +
    (self.units - mean('units')) * .14 + (self.gold - mean('gold')) / 800 +
    (self.income - mean('income')) / 80));
}
function normalize(values) {
  const min = Math.min(...values), range = Math.max(...values) - min;
  return values.map(value => range > 0 ? (value - min) / range : .5);
}
function instrument(observe, output) {
  const filename = require.resolve('../economy-training');
  let source = fs.readFileSync(filename, 'utf8');
  const replacements = [
    ['context.__trainingSeed = seed;', 'context.__targetObserve = module.exports.targetObserve;\n  context.__trainingSeed = seed;'],
    ['    function liveUnits(player) {', `    function publicMaterial() {
      return players.map(function(p) { return {
        lost: p.isLost, gold: p.gold, income: p.income,
        towns: p.towns.filter(function(t) { return !t.killed }).length,
        units: p.units.filter(function(u) { return !u.killed }).length
      } })
    }
    function liveUnits(player) {`],
    ['          if (!player.applyActionCommand(commands[index])) {', `          let targetBefore = JSON.stringify([vectoriseGrid(), publicMaterial()])
          let targetCommand = JSON.parse(JSON.stringify(commands[index]))
          if (!player.applyActionCommand(commands[index])) {`],
    ['          let category = commandCategory(commands[index])', `          __targetObserve(JSON.stringify({kind: 'label', playerIndex, turn: turnsPlayed + 1,
            index, command: targetCommand, state: publicMaterial(), vector, raw: label}))
          let category = commandCategory(commands[index])`],
    ['          actionManager.undo()\n', `          actionManager.undo()
          __targetObserve(JSON.stringify({kind: 'undo', playerIndex, turn: turnsPlayed + 1,
            index, before: JSON.parse(targetBefore), after: [vectoriseGrid(), publicMaterial()]}))
`]
  ];
  for (const [from, to] of replacements) {
    assert.equal(source.split(from).length, 2, 'instrumentation anchor must be unique');
    source = source.replace(from, to);
  }
  fs.writeFileSync(path.join(output, 'instrumented-collector.js'), source);
  const instrumented = new Module(filename, module);
  instrumented.filename = filename;
  instrumented.paths = module.paths;
  instrumented._compile(source, filename);
  instrumented.exports.targetObserve = json => observe(JSON.parse(json));
  return instrumented.exports.createTrainingBatch;
}
function main() {
  const output = path.resolve(process.argv[2]);
  fs.mkdirSync(output);
  const write = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
  const seeds = [1039200, 1039201]; // Reconstruct both archived validation inputs, never a holdout claim.
  write('plan.json', { seeds, hypothesis: 'omitted public material changes the collector target',
    decision: 'stop before gameplay if exact labels, candidate identity, or undo equality fails',
    claim: 'reconstruction only; no fit, checkpoint selection or acceptance evaluation' });
  assert.deepStrictEqual(normalize([3, 3]), [.5, .5]);
  assert.deepStrictEqual(normalize([4, 2, 3]), [1, 0, .5]);
  let records = [];
  const collect = instrument(record => records.push(record), output);
  const results = [];
  for (const seed of seeds) {
    records = [];
    const actual = collect(seed, [2], 'stage-2-native');
    const plain = createTrainingBatch(seed, [2], 'stage-2-native');
    assert.deepStrictEqual(actual, plain, 'instrumentation altered collector result');
    const archivePath = `artifacts/TASK-103/economy-development/experiment/validation-${seed}.json`;
    const archived = JSON.parse(fs.readFileSync(archivePath));
    assert.deepStrictEqual(actual, archived, 'reconstruction differs from archived batch');
    const labels = records.filter(r => r.kind === 'label');
    assert.equal(labels.length, actual.labels.length);
    const groups = new Map();
    labels.forEach((r, i) => {
      assert.deepStrictEqual(r.vector, [actual.boards[i], actual.globals[i]]);
      r.tactical = scoreFinalEconomyVector(r.vector);
      r.material = material(r.state, r.playerIndex);
      r.reconstructedRaw = r.tactical / 240000 + r.material * .25;
      assert.equal(r.raw, r.reconstructedRaw, 'raw collector label mismatch');
      r.normalized = actual.labels[i];
      r.vectorHash = hash(JSON.stringify(r.vector));
      delete r.vector;
      const key = `${r.playerIndex}:${r.turn}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
    const decisions = [...groups].map(([key, rows]) => {
      assert.deepStrictEqual(normalize(rows.map(r => r.raw)), rows.map(r => r.normalized));
      const ties = field => rows.filter(r => r[field] === Math.max(...rows.map(v => v[field]))).map(r => r.index);
      return { key, vectorBest: ties('tactical'), fullBest: ties('raw'), normalizedBest: ties('normalized') };
    });
    const undoFailures = records.filter(r => r.kind === 'undo' && JSON.stringify(r.before) !== JSON.stringify(r.after));
    write(`${seed}-labels.json`, labels);
    write(`${seed}-decisions.json`, decisions);
    write(`${seed}-undo-failures.json`, undoFailures);
    const result = { seed, candidates: labels.length, decisions: decisions.length,
      archiveHash: hash(fs.readFileSync(archivePath)), observerNeutral: true, exactLabels: true,
      undoFailures: undoFailures.length,
      changedBestSets: decisions.filter(r => JSON.stringify(r.vectorBest) !== JSON.stringify(r.fullBest)).length };
    results.push(result);
    console.log('TARGET_EQUALITY: ' + JSON.stringify(result));
  }
  write('result.json', results);
  assert(results.every(r => r.undoFailures === 0), 'collector undo mismatch: isolate before diagnostic gameplay');
  console.log('EQUALITY_GATE: PASS exact archived labels, order, ties, public material and undo');
}
module.exports = { material, normalize };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
