// Structural scheduling controls only: evaluator bodies are intercepted in an
// isolated module, never in production or in gameplay/performance measurements.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const os = require('os');

async function inspect(file, cadences = [1, 2, 3]) {
  let source = fs.readFileSync(file, 'utf8');
  const loop = source.slice(source.indexOf('        const shouldEvaluate ='),
    source.indexOf('        const summary = summarizeMetrics(previousRecords.concat(metric));'));
  assert(loop.includes('await evaluateNewVsOld('));
  source = source.replace('async function evaluateNewVsOld(options, state, newModel, oldPointer) {',
    'async function evaluateNewVsOld(options, state, newModel, oldPointer) { calls.old.push(state.completedGames);');
  source = source.replace('  const oldCheckpointPath = path.join(options.storageDir, oldPointer.path);',
    `  calls.matches.push(state.completedGames);
    return { evaluated: true, winrate: 0.5, games: 1 };
    const oldCheckpointPath = path.join(options.storageDir, oldPointer.path);`);
  source = source.replace('async function evaluateCurriculumSimpleAiWinrate(options, state, model) {',
    `async function evaluateCurriculumSimpleAiWinrate(options, state, model) {
      calls.curriculum.push(state.completedGames);
      return { evaluated: true, value: 0.5, games: 1, source: 'structural-entry-spy' };`);
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded._compile(source + `
    let calls;
    module.exports.cache = { metricRecords, assertMetricRecordsMatchFile };
    module.exports.probe = async function(fixture, cadence, storageDir) {
      calls = { old: [], matches: [], curriculum: [] };
      readOldEpochPointer = () => fixture.missing ? null : { path: 'structural-checkpoint' };
      const options = { storageDir, runId: 'structural', oldVsNewGames: 1,
        evaluationCadence: cadence, plateauWindow: fixture.window || 2,
        plateauMinDelta: fixture.noPlateau ? 0 : 2, plateauPatience: 1,
        curriculumSimpleWinrate: -1, curriculumSimpleWinrateThreshold: 0.8,
        curriculumBaselineWinrateThreshold: 0,
        curriculumLearningRateReductionAttempted: !fixture.noAttempt,
        curriculumLearningRateReductionImproved: !!fixture.improved };
      const state = { seed: 104104, totalGames: 5, epochs: 1,
        curriculum: initialCurriculumState(), updatedAt: 'fixed-structural-input' };
      if (fixture.final) state.curriculum.currentStageIndex = CURRICULUM_FINAL_STAGE_INDEX;
      const model = null;
      const previousRecords = [0, 1].map(game => ({ game, winner: 'draw', loss: 0,
        episodeLength: 1, oldVsNewEvaluation: { evaluated: true, winrate: 0.5 } }));
      const rows = [];
      for (let game = 1; game <= 5; game++) {
        state.completedGames = game;
        const metric = { game, winner: 'draw', loss: 0, episodeLength: 1 };
        ${loop}
        rows.push(JSON.parse(JSON.stringify(await progressRecord(options, state,
          metric, previousRecords, model, shouldEvaluate))));
        previousRecords.push(metric);
      }
      return { calls, rows, gates: state.curriculum.gateHistory };
    };`, file);
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'task104-scheduling-'));
  const results = [];
  try {
    for (const fixture of [
      { name: 'eligible' }, { name: 'window-one', window: 1 },
      { name: 'missing-checkpoint', missing: true },
      { name: 'no-plateau', noPlateau: true },
      { name: 'lr-improved', improved: true },
      { name: 'lr-not-attempted', noAttempt: true },
      { name: 'final-stage', final: true }
    ]) {
      for (const cadence of cadences) {
        const result = await loaded.exports.probe(fixture, cadence, storage);
        const scheduled = [1, 2, 3, 4, 5].filter(n => n % cadence === 0 || n === 5);
        const eligible = !fixture.window && !fixture.noPlateau && !fixture.improved &&
          !fixture.noAttempt && !fixture.final;
        assert.deepStrictEqual(result.calls.old, scheduled);
        assert.deepStrictEqual(result.calls.matches, fixture.missing ? [] : scheduled);
        assert.deepStrictEqual(result.calls.curriculum, eligible ? scheduled : []);
        assert.strictEqual(result.rows.length, 5);
        assert.deepStrictEqual(result.gates.map(row => row.trainingStep), scheduled);
        results.push({ fixture: fixture.name, cadence, ...result });
        console.log('SCHEDULING: PASS ' + JSON.stringify({ fixture: fixture.name,
          cadence, scheduled, ...result.calls, progressRows: result.rows.length,
          gateRows: result.gates.length }));
      }
    }
    const metrics = path.join(storage, 'metrics.jsonl');
    const record = { type: 'game', game: 1, loss: 0.5 };
    fs.writeFileSync(metrics, JSON.stringify(record) + '\n');
    process.env.DIPLOMACY_ASSERT_METRIC_RECORDS = '1';
    const cache = loaded.exports.cache;
    cache.assertMetricRecordsMatchFile(cache.metricRecords(metrics), metrics);
    assert.throws(() => cache.assertMetricRecordsMatchFile([{ ...record, loss: 99 }], metrics),
      /in-memory metric records diverged/);
    delete process.env.DIPLOMACY_ASSERT_METRIC_RECORDS;
    cache.assertMetricRecordsMatchFile([], path.join(storage, 'does-not-exist'));
    console.log('CACHE_CONTROLS: PASS rehydrated-cache, corruption rejected, production assertion performs no file read');
  } finally {
    fs.rmSync(storage, { recursive: true, force: true });
  }
  return results;
}

async function main() {
  const current = await inspect(path.join(__dirname, 'cloud-train-runner.js'));
  if (process.env.TASK104_REFERENCE_RUNNER) {
    // The reference always evaluates; only cadence=1 is an equality contract.
    const reference = await inspect(process.env.TASK104_REFERENCE_RUNNER, [1]);
    assert.deepStrictEqual(current.filter(row => row.cadence === 1), reference);
    console.log('SCHEDULING_REFERENCE_PARITY: PASS identical fixed inputs and progress/gates');
  }
  console.log('TASK-104 scheduling controls passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
