const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const tf = require('@tensorflow/tfjs-node');
const { collectOutcomeTrajectory, labelOutcomeTrajectory, outcomeLayoutHash } = require('../economy-outcome-data');
const { runRuntimeScenario, parseArgs } = require('../benchmark-gamestart-all-slots');
const { createRuntimeContext, loadBrowserScripts } = require('../gamestart-simple-economy-completion');

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
// Runtime reports come from separate VM realms; compare their serialized data.
const detached = value => JSON.parse(JSON.stringify(value));
async function main() {
  const root = path.resolve(process.argv[2]);
  const plan = JSON.parse(fs.readFileSync(path.join(root, 'plan.json')));
  const output = path.join(root, 'run');
  fs.mkdirSync(output); // All attempted results are immutable.
  const write = (name, data) => fs.writeFileSync(path.join(output, name), JSON.stringify(data) + '\n');
  const frozen = JSON.parse(fs.readFileSync(path.join(plan.checkpoint, '../checkpoint-freeze.json'))).trained;
  const checkWeights = () => {
    for (const [name, expected] of Object.entries(frozen)) {
      assert.equal(hash(fs.readFileSync(path.join(plan.checkpoint, name))), expected);
    }
  };
  checkWeights();
  write('checkpoint-hashes.json', frozen);
  const layouts = [];
  for (const seed of plan.layoutSeeds) {
    const context = createRuntimeContext(seed);
    loadBrowserScripts(context);
    context.__seed = seed;
    const layout = JSON.parse(new vm.Script(
      'JSON.stringify(generateEconomyStage2TrainingMap({seed:__seed}))').runInContext(context));
    write(`layout-${seed}.json`, layout);
    layouts.push(outcomeLayoutHash(layout));
  }
  assert.equal(new Set(layouts).size, plan.layoutSeeds.length, 'new RNG seeds must produce different layouts');
  write('layout-hashes.json', layouts);
  const options = { ...parseArgs([]), ...plan.budgets };
  const model = await tf.loadLayersModel('file://' + path.resolve(plan.checkpoint, 'model.json'));
  const checkpoint = () => ({ model, inference: { calls: 0, positions: 0 } });
  const tensorBaseline = tf.memory().numTensors;
  const results = [];
  try {
    for (const seed of plan.layoutSeeds) for (const side of plan.sides) {
      const entry = { name: `outcome-stage2-${seed}`, sourceType: 'standalone-factory',
        sourceName: 'generateEconomyStage2TrainingMap', factoryOptions: { seed }, nonNeutralPlayerCount: 2 };
      const plain = runRuntimeScenario(entry, side, seed, options, checkpoint());
      write(`${seed}-${side}-plain.json`, plain);
      const collected = collectOutcomeTrajectory(entry, side, seed, options, checkpoint());
      write(`${seed}-${side}-collected.json`, collected);
      assert.deepStrictEqual(detached(collected.game), detached(plain), 'collection altered gameplay');
      assert(collected.positions.length > 0);
      assert.equal(collected.disposition, 'terminal-outcome');
      assert.equal(collected.labels.length, collected.positions.length);
      assert(collected.labels.every(label => label === (plain.candidateWon ? 1 : 0)));
      for (const example of collected.examples) {
        assert.equal(example.board.length, model.inputs[0].shape[1]);
        for (const column of example.board) {
          assert.equal(column.length, model.inputs[0].shape[2]);
          for (const cell of column) {
            assert.equal(cell.length, model.inputs[0].shape[3]);
            assert(cell.every(Number.isFinite));
          }
        }
        assert(Number.isFinite(example.global));
      }
      // Separate full game: compare fresh post-turn vectors to the last actual
      // scored state, then mutate the detached event. No runtime state is patched.
      if (side === plan.sides[0]) {
        let lastPrediction, checked = 0;
        const observed = runRuntimeScenario(entry, side, seed, options, checkpoint(), {
          prediction(record) { lastPrediction = record.vectors; },
          position(record) {
            assert.equal(lastPrediction.length, 1);
            assert.deepStrictEqual(record.vector, lastPrediction[0]);
            assert.deepStrictEqual(record, collected.positions[checked++]);
            record.vector[0][0][0][0] = -999;
            record.playerIndex = -1;
          }
        });
        write(`${seed}-${side}-mutation-control.json`, { game: observed, checked });
        assert.deepStrictEqual(detached(observed), detached(plain), 'position observer mutation altered gameplay');
        assert.equal(checked, collected.positions.length);
        console.log('POSITION_CONTROL: PASS ' + JSON.stringify({seed, side, checked}));
      }
      for (const flags of [{timeout:true}, {suddenDeath:true}, {winner:null},
        {crash:{message:'negative control'}}, {exactClassAssignment:false}]) {
        const excluded = labelOutcomeTrajectory({...plain, ...flags}, collected.positions);
        assert.equal(excluded.disposition, 'excluded-nonterminal-or-invalid');
        assert.deepStrictEqual(excluded.labels, []);
        assert.deepStrictEqual(excluded.examples, []);
      }
      assert.throws(() => labelOutcomeTrajectory({...plain, candidateWon:!plain.candidateWon}, collected.positions), /disagree/);
      assert.throws(() => labelOutcomeTrajectory(plain,
        [{...collected.positions[0], playerIndex:3-side}]), /perspective/);
      assert.throws(() => labelOutcomeTrajectory(plain,
        [collected.positions[0], collected.positions[0]]), /ordered/);
      const row = {seed, side, winner:plain.winner, won:plain.candidateWon,
        rounds:plain.roundCount, examples:collected.labels.length, pairedEqual:true};
      results.push(row);
      write('results.json', results);
      console.log('OUTCOME_GAME: ' + JSON.stringify(row));
    }
    for (const side of plan.sides) {
      const seed = plan.layoutSeeds[0];
      const entry = {name:`truncation-${seed}`, sourceType:'standalone-factory',
        sourceName:'generateEconomyStage2TrainingMap', factoryOptions:{seed}, nonNeutralPlayerCount:2};
      const truncated = collectOutcomeTrajectory(entry, side, seed, {...options, roundLimit:1}, checkpoint());
      write(`truncated-${side}.json`, truncated);
      assert(truncated.game.timeout);
      assert.equal(truncated.disposition, 'excluded-nonterminal-or-invalid');
      assert.deepStrictEqual(truncated.labels, []);
      console.log('TRUNCATION_CONTROL: PASS ' + JSON.stringify({side, positions:truncated.positions.length, labels:0}));
    }
    const crash = collectOutcomeTrajectory({name:'missing-factory-control', sourceType:'standalone-factory',
      sourceName:'missingFactoryForNegativeControl'}, 1, plan.layoutSeeds[0], options, checkpoint());
    write('crash-control.json', crash);
    assert.equal(crash.disposition, 'excluded-crash');
    assert(crash.error.message.includes('not a function'));
    assert.deepStrictEqual(crash.labels, []);
    checkWeights();
    assert.equal(tf.memory().numTensors, tensorBaseline);
    console.log('ACCOUNTING_CONTROLS: PASS truncation/crash/flags excluded; inconsistent winner, perspective, order rejected; tensor baseline restored');
    console.log('OUTCOME_DATA: PASS ' + JSON.stringify({games:results.length,
      wins:results.filter(r=>r.won).length, losses:results.filter(r=>!r.won).length,
      examples:results.reduce((sum,r)=>sum+r.examples,0), claim:'terminal data correctness only; no strength acceptance'}));
  } finally { model.dispose(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
