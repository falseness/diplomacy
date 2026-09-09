// Diagnostic-only source instrumentation: capture candidate public after-states.
// Runtime command selection, classes, budgets, opponents and result accounting are retained.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const crypto = require('crypto');
const { material, normalize } = require('./task103-exact-collector-target.cjs');
const { scoreFinalEconomyVector } = require('../benchmark-final-symmetrical-economy-gate');
const cache = require('../browserScriptCache');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const publicState = `players.map(p => ({lost:p.isLost, gold:p.gold, income:p.income,
  towns:p.towns.filter(t=>!t.killed).length, units:p.units.filter(u=>!u.killed).length}))`;
function main() {
  const output = path.resolve(process.argv[2]);
  fs.mkdirSync(output);
  const write = (name, data) => fs.writeFileSync(path.join(output, name), JSON.stringify(data, null, 2) + '\n');
  const equality = JSON.parse(fs.readFileSync(process.argv[3]));
  assert.equal(equality.length, 2);
  assert(equality.every(r => r.exactLabels && r.observerNeutral && !r.undoFailures));
  const plan = { layoutSeeds: [1039600, 1039601], slots: [1, 2], arms: ['vector', 'full'],
    options: { roundLimit: 1200, suddenDeathRound: 500, actionLimit: 30, commandLimit: 60 },
    claim: 'heuristic diagnostic, not learned acceptance; same native generated maps and both sides',
    decision: 'if both arms fail or rankings coincide, close missing-material explanation on these cases; stop unchanged teacher fitting',
    target: 'full = tactical/240000 + public material*.25, normalized per batch; vector = tactical normalized per batch' };
  write('plan.json', plan);
  let active, context, records, snapshots;
  const filename = require.resolve('../benchmark-gamestart-all-slots');
  let source = fs.readFileSync(filename, 'utf8');
  const from = 'const predictor = createPredictor(checkpoint.model, checkpoint.inference,\n    observer && observer.prediction);';
  assert.equal(source.split(from).length, 2);
  source = source.replace(from, 'const predictor = module.exports.targetPredict;');
  fs.writeFileSync(path.join(output, 'instrumented-benchmark.js'), source);
  const diagnostic = new Module(filename, module);
  diagnostic.filename = filename;
  diagnostic.paths = module.paths;
  const originalRequire = diagnostic.require.bind(diagnostic);
  const playerSource = fs.readFileSync(require.resolve('../players'), 'utf8');
  const captureFrom = `return [
            cloneVectorGridCells(mutableGrid.cells),
            mutableGrid.suddenDeathMetric
        ]`;
  assert.equal(playerSource.split(captureFrom).length, 2);
  let capturedSource = playerSource.replace(captureFrom, `return __targetCapture([
            cloneVectorGridCells(mutableGrid.cells),
            mutableGrid.suddenDeathMetric
        ], JSON.stringify(${publicState}), whooseTurn)`);
  capturedSource = capturedSource.replace('validCommands.push(commands[i])', 'validCommands.push(commands[i]); globalThis.__targetCommand = JSON.stringify(commands[i])');
  fs.writeFileSync(path.join(output, 'instrumented-players.js'), capturedSource);
  diagnostic.require = name => name === './gamestart-simple-economy-completion' ? {
    ...originalRequire(name), loadBrowserScripts(ctx) {
      context = ctx;
      ctx.__targetCapture = (vector, json, side) => {
        snapshots.set(vector, { state: JSON.parse(json), side, command: ctx.__targetCommand ? JSON.parse(ctx.__targetCommand) : null });
        return vector;
      };
      for (const file of cache.getBrowserScriptCacheStats().sources) {
        if (file === 'ai/players.js') new vm.Script(capturedSource, { filename: file }).runInContext(ctx);
        else cache.loadBrowserScript(ctx, file);
      }
      new vm.Script(`globalThis.__targetFactory = function() {
        return generateEconomyStage2TrainingMap({seed:${active.seed}})
      }; globalThis.__targetState = function() { return JSON.stringify({state:${publicState}, side:whooseTurn}) }`).runInContext(ctx);
    }
  } : originalRequire(name);
  diagnostic._compile(source, filename);
  diagnostic.exports.targetPredict = (model, vectors) => {
    if (!vectors.length) return [];
    const rows = vectors.map(vector => {
      const captured = snapshots.get(vector) || JSON.parse(context.__targetState());
      const tactical = scoreFinalEconomyVector(vector);
      const m = material(captured.state, captured.side);
      return { vectorHash: hash(JSON.stringify(vector)), state: captured.state, side: captured.side, command: captured.command || null,
        tactical, material: m, raw: tactical / 240000 + m * .25 };
    });
    const vectorScores = normalize(rows.map(r => r.tactical));
    const fullScores = normalize(rows.map(r => r.raw));
    const values = active.arm === 'vector' ? vectorScores : fullScores;
    records.push({ rows, vectorScores, fullScores, selected: values.indexOf(Math.max(...values)),
      vectorSelected: vectorScores.indexOf(Math.max(...vectorScores)),
      fullSelected: fullScores.indexOf(Math.max(...fullScores)) });
    return values.map(v => [v]);
  };
  const hashes = Object.fromEntries([...new Set([...cache.getBrowserScriptCacheStats().sources,
    'ai/benchmark-gamestart-all-slots.js', 'ai/economy-training.js',
    'ai/benchmark-final-symmetrical-economy-gate.js', 'ai/tests/task103-full-target-gameplay.cjs',
    'ai/tests/task103-exact-collector-target.cjs'])].map(file => [file, hash(fs.readFileSync(file))]));
  write('source-hashes.json', hashes);
  const results = [], layoutHashes = new Map();
  // Materialize both maps before outcomes; different seeds alone are insufficient.
  for (const seed of plan.layoutSeeds) {
    active = {seed}; snapshots = new WeakMap();
    // Reuse the collector's deterministic runtime and generator without running turns.
    const trainingFile = require.resolve('../economy-training');
    const training = new Module(trainingFile, module);
    training.filename = trainingFile; training.paths = module.paths;
    training._compile(fs.readFileSync(trainingFile, 'utf8') + '\nmodule.exports.context = getTrainingRuntimeContext;', trainingFile);
    const ctx = training.exports.context(seed);
    ctx.__seed = seed;
    const layout = new vm.Script('JSON.stringify(generateEconomyStage2TrainingMap({seed:__seed}))').runInContext(ctx);
    fs.writeFileSync(path.join(output, `layout-${seed}.json`), layout);
    const structure = JSON.parse(layout); delete structure.testName;
    layoutHashes.set(seed, hash(JSON.stringify(structure)));
  }
  assert.equal(new Set(layoutHashes.values()).size, 2);
  write('layout-hashes.json', Object.fromEntries(layoutHashes));
  for (const arm of plan.arms) for (const seed of plan.layoutSeeds) for (const side of plan.slots) {
    active = { arm, seed }; snapshots = new WeakMap(); records = [];
    let game, error;
    try {
      game = diagnostic.exports.runRuntimeScenario({ name: `native-stage-2-${seed}`,
        sourceType: 'standalone-factory', sourceName: '__targetFactory', nonNeutralPlayerCount: 2 },
      side, seed, {...diagnostic.exports.parseArgs([]), ...plan.options}, { model: {}, inference: {} });
      assert(game.exactClassAssignment);
    } catch (e) { error = e.stack; }
    const result = { arm, seed, side, game, error,
      won: !!(game && game.candidateWon && !game.timeout && !game.suddenDeath),
      batches: records.length, materialSelectionDifferences: records.filter(r => r.vectorSelected !== r.fullSelected).length };
    write(`${arm}-${seed}-${side}.json`, { ...result, records });
    results.push(result);
    write('result.json', results);
    console.log('FULL_TARGET_GAME: ' + JSON.stringify(result));
  }
  for (const [file, expected] of Object.entries(hashes)) assert.equal(hash(fs.readFileSync(file)), expected);
  assert(results.every(r => !r.error), 'diagnostic errors retained; no completion claim');
  console.log('DIAGNOSTIC_COMPLETE: eight outcomes retained; no acceptance pass');
}
try { main(); } catch (e) { console.error(e.stack); process.exitCode = 1; }
