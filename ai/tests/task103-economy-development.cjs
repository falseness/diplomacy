// A single predeclared development fit, never acceptance-checkpoint selection.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const tf = require('@tensorflow/tfjs-node');
const { createTrainingBatch, createModel, saveCheckpoint } = require('../economy-training');

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const plan = {
  trainingSeeds: Array.from({ length: 8 }, (_, i) => 1039100 + i),
  validationSeeds: [1039200, 1039201],
  developmentSeeds: [1039300, 1039301, 1039302, 1039303],
  excludedAcceptanceSeeds: [156022, 156023, 63900, 63901, 63902, 63903],
  mapSource: 'stage-2-native', shape: [9, 7, 82], epochs: 12,
  batchSize: 32, shuffle: false,
  selection: 'only final epoch; no checkpoint search, early stopping or acceptance evaluation',
  hypothesis: 'more native generated-state fitting improves held-out teacher error and development play over the same initial weights',
  labels: 'existing heuristic teacher and per-decision normalization; not terminal-outcome supervision',
  limitations: 'collector plays one teacher action per candidate turn; opponent advances by nextTurn; training covers four rounds only',
  controls: ['untrained', 'zero', 'trained'],
  gameplay: { mapOffset: 18, seedsPerSlot: 2, roundLimit: 1200, suddenDeath: 500,
    candidate: 'AIPlayerWithEconomy', opponent: 'SimpleAiPlayerWithEconomy' },
  claim: 'development only, not an independent final holdout or TASK-103 acceptance pass'
};

async function main() {
  assert(process.argv[2], 'provide a fresh output directory');
  const output = path.resolve(process.argv[2]);
  fs.mkdirSync(output); // Refuse to overwrite any prior result.
  const write = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
  const seeds = [...plan.trainingSeeds, ...plan.validationSeeds,
    ...plan.developmentSeeds, ...plan.excludedAcceptanceSeeds];
  assert.equal(new Set(seeds).size, seeds.length, 'seed sets overlap');
  write('plan.json', plan);
  console.log('FROZEN_PLAN: ' + JSON.stringify(plan));
  function collect(seedList, label) {
    const batches = seedList.map(seed => {
      const batch = createTrainingBatch(seed, [2], plan.mapSource);
      assert.deepStrictEqual(batch.players, ['AIPlayerWithEconomy', 'SimpleAiPlayerWithEconomy']);
      assert(batch.labels.length > 0);
      for (const board of batch.boards) {
        assert.equal(board.length, 9);
        for (const column of board) {
          assert.equal(column.length, 7);
          for (const cell of column) assert.equal(cell.length, 82);
        }
      }
      assert(batch.labels.every(Number.isFinite));
      const data = JSON.stringify(batch);
      fs.writeFileSync(path.join(output, `${label}-${seed}.json`), data);
      console.log('DATA: ' + JSON.stringify({ label, seed, examples: batch.labels.length, sha256: hash(data) }));
      return batch;
    });
    const boards = batches.flatMap(batch => batch.boards);
    const labels = batches.flatMap(batch => batch.labels);
    return {
      x: [tf.tensor4d(boards.flat(3), [boards.length, ...plan.shape]),
        tf.tensor2d(batches.flatMap(batch => batch.globals), [boards.length, 1])],
      y: tf.tensor2d(labels, [labels.length, 1]), count: labels.length
    };
  }
  const training = collect(plan.trainingSeeds, 'training');
  const validation = collect(plan.validationSeeds, 'validation');
  const model = createModel(9, 7);
  const metadata = { ...plan, labelScale: 1, featureFusionWeight: 0 };
  await saveCheckpoint(model, path.join(output, 'untrained'), metadata);
  const validationLoss = () => tf.tidy(() => Number(model.evaluate(validation.x, validation.y).dataSync()[0]));
  const before = validationLoss();
  const history = await model.fit(training.x, training.y, {
    epochs: plan.epochs, batchSize: plan.batchSize, shuffle: plan.shuffle, verbose: 0,
    validationData: [validation.x, validation.y],
    callbacks: { onEpochEnd: (epoch, logs) => console.log('EPOCH: ' + JSON.stringify({ epoch: epoch + 1, ...logs })) }
  });
  const after = validationLoss();
  assert(Number.isFinite(before) && Number.isFinite(after));
  await saveCheckpoint(model, path.join(output, 'trained'), { ...metadata, before, after, history: history.history });
  const zeroWeights = model.getWeights().map(weight => tf.zerosLike(weight));
  model.setWeights(zeroWeights);
  zeroWeights.forEach(weight => weight.dispose());
  await saveCheckpoint(model, path.join(output, 'zero'), metadata);
  model.dispose();
  [...training.x, training.y, ...validation.x, validation.y].forEach(tensor => tensor.dispose());
  const frozen = {};
  for (const arm of plan.controls) {
    frozen[arm] = Object.fromEntries(fs.readdirSync(path.join(output, arm)).map(name =>
      [name, hash(fs.readFileSync(path.join(output, arm, name)))]));
  }
  write('checkpoint-freeze.json', frozen);
  console.log('VALIDATION: ' + JSON.stringify({ before, after, improved: after < before }));
  const results = [];
  for (const arm of plan.controls) {
    const reportPath = path.join(output, `${arm}-report.json`);
    const args = [path.resolve(__dirname, '../benchmark-gamestart-all-slots.js'),
      '--checkpoint', path.join(output, arm), '--candidate-slot-policy', 'task156',
      '--map-offset', '18', '--map-limit', '1', '--seeds', '2', '--seed', '1039300',
      '--round-limit', '1200', '--sudden-death', '500', '--output', reportPath,
      '--failure-dir', path.join(output, `${arm}-failures`)];
    const log = fs.openSync(path.join(output, `${arm}-gameplay.log`), 'wx');
    fs.writeSync(log, 'COMMAND: ' + JSON.stringify([process.execPath, ...args]) + '\n');
    const started = Date.now();
    const result = spawnSync(process.execPath, args, { stdio: ['ignore', log, log], timeout: 600000 });
    fs.writeSync(log, `EXIT_CODE: ${result.status}\nSIGNAL: ${result.signal}\nSECONDS: ${(Date.now() - started) / 1000}\n`);
    fs.closeSync(log);
    assert.equal(result.status, 0, `${arm} development benchmark did not complete; preserve its non-result`);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(report.games.length, 4);
    assert.deepStrictEqual(report.games.map(game => game.seed), plan.developmentSeeds);
    assert.equal(report.summary.classAssignmentFailures, 0);
    for (const [name, digest] of Object.entries(frozen[arm])) {
      assert.equal(hash(fs.readFileSync(path.join(output, arm, name))), digest);
    }
    results.push({ arm, summary: report.summary, inference: report.checkpoint.gameplayInference });
    console.log('DEVELOPMENT_RESULT: ' + JSON.stringify(results[results.length - 1]));
  }
  write('result.json', { before, after, results, claim: plan.claim });
  console.log('DEVELOPMENT_COMPLETE: all three frozen arms accounted for; no acceptance conclusion');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
