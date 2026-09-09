// Measure model authority on complete development trajectories with frozen weights.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const tf = require('@tensorflow/tfjs-node');
const { createPredictor, runRuntimeScenario, parseArgs } =
  require('../benchmark-gamestart-all-slots');
const { enumerateGamestartMapCoverage } = require('../gamestart-map-coverage');
const { scoreFinalEconomyVector } = require('../benchmark-final-symmetrical-economy-gate');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function observerControls() {
  const model = { inputs: [{ shape: [null, 1, 1, 1] }],
    predict: tensors => tensors[0].reshape([1, 1]).add(tensors[1]) };
  const input = [[[[[2]]], 3]];
  const baseline = tf.memory().numTensors;
  const plain = createPredictor(model, { calls: 0, positions: 0 })(model, input);
  let calls = 0;
  const observed = createPredictor(model, { calls: 0, positions: 0 }, record => {
    calls++;
    record.vectors[0][0][0][0][0] = -100;
    record.values[0] = -100;
  })(model, input);
  assert.deepStrictEqual(observed, plain);
  assert.deepStrictEqual(plain, [[5]]);
  assert.equal(input[0][0][0][0][0], 2);
  assert.equal(calls, 1);
  assert.throws(() => createPredictor(model, { calls: 0, positions: 0 }, () => {
    throw new Error('observer control');
  })(model, input), /observer control/);
  assert.equal(tf.memory().numTensors, baseline);
  console.log('OBSERVER_CONTROLS: PASS detached inputs/scores, equal prediction, error cleanup');
}

async function main() {
  observerControls();
  if (process.argv[2] === '--controls-only') return;
  assert(process.argv[2] && process.argv[3], 'provide archived experiment and fresh output directory');
  const source = path.resolve(process.argv[2]);
  const output = path.resolve(process.argv[3]);
  fs.mkdirSync(output);
  const write = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
  const prior = JSON.parse(fs.readFileSync(path.join(source, 'plan.json')));
  const freeze = JSON.parse(fs.readFileSync(path.join(source, 'checkpoint-freeze.json')));
  const plan = {
    seeds: [1039400, 1039401, 1039402, 1039403], slots: [1, 1, 2, 2],
    controls: prior.controls, training: prior.trainingSeeds, validation: prior.validationSeeds,
    previousDevelopment: prior.developmentSeeds, excludedAcceptance: prior.excludedAcceptanceSeeds,
    hypothesis: 'opening-state training may not cover the decisions the model actually controls',
    checkpointSelection: 'all three previously frozen arms; no fit or promotion',
    claim: 'runtime coverage and causal diagnosis only; known map family, no acceptance claim',
    options: { roundLimit: 1200, suddenDeathRound: 500, actionLimit: 30, commandLimit: 60 }
  };
  const allSeeds = [...plan.seeds, ...plan.training, ...plan.validation,
    ...plan.previousDevelopment, ...plan.excludedAcceptance];
  assert.equal(new Set(allSeeds).size, allSeeds.length);
  const provenance = {};
  for (const arm of plan.controls) {
    for (const [file, expected] of Object.entries(freeze[arm])) {
      const fullPath = path.join(source, arm, file);
      assert.equal(hash(fullPath), expected);
      provenance[fullPath] = expected;
    }
  }
  write('plan.json', plan);
  write('checkpoint-freeze.json', provenance);
  console.log('RUNTIME_PLAN: ' + JSON.stringify(plan));
  console.log('CHECKPOINT_FREEZE: PASS all archived arms; seed intersections empty');
  const entry = enumerateGamestartMapCoverage().maps[18];
  assert.equal(entry.name, 'tiny economy ai duel');
  const options = { ...parseArgs([]), ...plan.options };
  const summaries = [];
  for (const arm of plan.controls) {
    const model = await tf.loadLayersModel('file://' + path.join(source, arm, 'model.json'));
    try {
      assert.deepStrictEqual(model.inputs[0].shape, [null, 9, 7, 82]);
      for (const [index, seed] of plan.seeds.entries()) {
        const turns = [], batches = [];
        const inference = { calls: 0, positions: 0 };
        const file = fs.openSync(path.join(output, `${arm}-${seed}-vectors.jsonl.gz`), 'wx');
        let game;
        try {
          game = runRuntimeScenario(entry, plan.slots[index], seed, options, { model, inference }, {
            prediction(record) {
              const teacher = record.vectors.map(scoreFinalEconomyVector);
              const best = Math.max(...record.values);
              batches.push({ call: batches.length + 1, afterTurn: turns.length,
                candidates: record.values.length, values: record.values, teacher,
                maxima: record.values.map((value, i) => value === best ? i : -1).filter(i => i >= 0) });
              fs.writeSync(file, zlib.gzipSync(JSON.stringify(record) + '\n'));
            },
            turn(record) { turns.push(record); }
          });
        } catch (error) {
          write(`${arm}-${seed}-failure.json`, { seed, arm, error: error.stack, turns, batches });
          throw error; // Preserve non-result; never count it as a win.
        } finally { fs.closeSync(file); }
        assert(game.exactClassAssignment);
        assert.equal(inference.calls, batches.length);
        assert.equal(turns.length, game.turnCount);
        const summary = { arm, seed, slot: plan.slots[index], winner: game.winner,
          won: game.candidateWon, rounds: game.roundCount, inference,
          multiCandidateBatches: batches.filter(b => b.candidates > 1).length,
          distinctScoreChoices: batches.filter(b => b.candidates > 1 && b.maxima.length < b.candidates).length,
          actionCounters: turns[turns.length - 1] };
        write(`${arm}-${seed}.json`, { summary, game, turns, batches });
        summaries.push(summary);
        console.log('RUNTIME_GAME: ' + JSON.stringify(summary));
      }
    } finally { model.dispose(); }
  }
  for (const [file, expected] of Object.entries(provenance)) assert.equal(hash(file), expected);
  write('result.json', summaries);
  console.log('RUNTIME_COMPLETE: all 12 development games accounted for; no acceptance conclusion');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
