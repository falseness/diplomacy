// Development control: can the existing vector teacher win when used directly?
// This is deliberately not a trained checkpoint or an acceptance benchmark.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const tf = require('@tensorflow/tfjs-node');
const { createPredictor, runRuntimeScenario, parseArgs } = require('../benchmark-gamestart-all-slots');
const { enumerateGamestartMapCoverage } = require('../gamestart-map-coverage');
const { scoreFinalEconomyVector } = require('../benchmark-final-symmetrical-economy-gate');

function teacherModel(direction) {
  assert([1, -1].includes(direction));
  return {
    inputs: [{ shape: [null, 9, 7, 82] }],
    predict([boards, globals]) {
      const globalValues = globals.arraySync();
      const scores = boards.arraySync().map((board, i) => {
        const value = direction * scoreFinalEconomyVector([board, globalValues[i][0]]);
        assert(Number.isFinite(value));
        return [value];
      });
      return tf.tensor2d(scores, [scores.length, 1]);
    }
  };
}

function controls() {
  const board = Array.from({ length: 9 }, () =>
    Array.from({ length: 7 }, () => Array(82).fill(0)));
  const alternate = JSON.parse(JSON.stringify(board));
  alternate[0][0][1] = 1;
  const vectors = [[board, 0], [alternate, 1]];
  const expected = vectors.map(v => [Math.fround(scoreFinalEconomyVector(v))]);
  assert.notEqual(expected[0][0], expected[1][0], 'control must distinguish candidate order');
  const baseline = tf.memory().numTensors;
  for (const direction of [1, -1]) {
    const model = teacherModel(direction);
    const predict = createPredictor(model, { calls: 0, positions: 0 });
    assert.deepStrictEqual(predict(model, vectors), expected.map(([v]) => [Math.fround(direction * v)]));
    assert.deepStrictEqual(predict(model, vectors.slice().reverse()),
      expected.slice().reverse().map(([v]) => [Math.fround(direction * v)]));
    assert.deepStrictEqual(predict(model, []), []);
  }
  assert.equal(tf.memory().numTensors, baseline);
  console.log('TEACHER_CONTROLS: PASS direct-score equality, reversed order, negated scores, empty input, tensor cleanup');
}

function main() {
  controls();
  if (process.argv[2] === '--controls-only') return;
  assert(process.argv[2], 'provide a fresh output directory');
  const output = path.resolve(process.argv[2]);
  fs.mkdirSync(output);
  const write = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
  const prior = JSON.parse(fs.readFileSync('artifacts/TASK-103/economy-development/experiment/plan.json'));
  const plan = {
    seeds: [1039500, 1039501, 1039502, 1039503], slots: [1, 1, 2, 2],
    arms: { teacher: 1, reversedTeacher: -1 },
    excludedSeeds: [...prior.trainingSeeds, ...prior.validationSeeds, ...prior.developmentSeeds,
      ...prior.excludedAcceptanceSeeds, 1039400, 1039401, 1039402, 1039403],
    options: { roundLimit: 1200, suddenDeathRound: 500, actionLimit: 30, commandLimit: 60 },
    hypothesis: 'direct vector-teacher attack ranking may itself be insufficient for winning',
    claim: 'heuristic-only development control; no trained-model, acceptance, or independent-map claim',
    limitations: 'same fixed map; teacher excludes collector material term; movement and purchases remain runtime policy'
  };
  assert.equal(new Set([...plan.seeds, ...plan.excludedSeeds]).size, plan.seeds.length + plan.excludedSeeds.length);
  write('plan.json', plan); // Freeze both arms and all seeds before any gameplay.
  const files = [__filename, require.resolve('../benchmark-final-symmetrical-economy-gate'),
    require.resolve('../benchmark-gamestart-all-slots'), require.resolve('../economy-training')];
  const hashes = Object.fromEntries(files.map(file => [file,
    crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
  write('source-hashes.json', hashes);
  console.log('TEACHER_PLAN: ' + JSON.stringify(plan));
  const entry = enumerateGamestartMapCoverage().maps[18];
  assert.equal(entry.name, 'tiny economy ai duel');
  const results = [];
  for (const [arm, direction] of Object.entries(plan.arms)) {
    for (const [i, seed] of plan.seeds.entries()) {
      const inference = { calls: 0, positions: 0 }, turns = [], batches = [];
      let game, error;
      try {
        game = runRuntimeScenario(entry, plan.slots[i], seed,
          { ...parseArgs([]), ...plan.options }, { model: teacherModel(direction), inference }, {
            prediction(record) { batches.push({ values: record.values,
              teacher: record.vectors.map(scoreFinalEconomyVector) }); },
            turn(record) { turns.push(record); }
          });
        assert(game.exactClassAssignment);
        assert.equal(inference.calls, batches.length);
      } catch (failure) { error = failure.stack; }
      const result = { arm, seed, slot: plan.slots[i],
        won: !!(game && game.candidateWon && !game.timeout && !game.suddenDeath && !game.nonResult),
        game, error, inference, turns, batches };
      write(`${arm}-${seed}.json`, result);
      results.push(result);
      console.log('TEACHER_GAME: ' + JSON.stringify({ arm, seed, slot: result.slot,
        won: result.won, winner: game && game.winner, error: error || null, inference }));
    }
  }
  write('result.json', Object.keys(plan.arms).map(arm => ({ arm,
    attempts: results.filter(r => r.arm === arm).length,
    wins: results.filter(r => r.arm === arm && r.won).length,
    errors: results.filter(r => r.arm === arm && r.error).length })));
  assert(results.every(r => !r.error), 'development crash retained; experiment incomplete');
  console.log('TEACHER_COMPLETE: all eight development outcomes recorded; not an acceptance pass');
}
try { main(); } catch (error) { console.error(error.stack); process.exitCode = 1; }
