// Explicit diagnostic replay. Never imported by production or used as a speed gate.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const vm = require('vm');
const zlib = require('zlib');
const {performance, PerformanceObserver} = require('perf_hooks');
const [manifestPath, variant, mode, output] = process.argv.slice(2);
const pre = JSON.parse(fs.readFileSync(manifestPath));
assert(['control', 'scan'].includes(variant));
assert(['off', 'counts', 'trace'].includes(mode));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
for (const [file, expected] of Object.entries(pre.hashes)) {
  assert.equal(hash(fs.readFileSync(file)), expected, file);
}
const replaceOnce = (source, before, after) => {
  assert.equal(source.split(before).length, 2, before);
  return source.replace(before, after);
};
const patches = {
  'ai/vectorizeContent.js': ['let expansionLookup = createSuburbExpansionLookup()', 'let expansionLookup = undefined'],
  'ai/mutableVectorGrid.js': ["let expansionLookup = typeof createSuburbExpansionLookup == 'undefined' ?\n        undefined : createSuburbExpansionLookup()", 'let expansionLookup = undefined']
};
let trace = [], snapshots = new Map(), counts = {}, observedGames = [];
const sink = (kind, encoded, meta) => {
  const digest = hash(encoded);
  if (kind === 'snapshot') snapshots.set(meta.id, digest);
  if (kind === 'inputs') JSON.parse(encoded).forEach((input, index) => {
    if (meta[index] !== null) assert.equal(hash(JSON.stringify(input)), snapshots.get(meta[index]), 'snapshot lifetime');
  });
  trace.push({kind, hash: digest, bytes: Buffer.byteLength(encoded), meta});
};
const countHooks = String.raw`
;(() => {
    const count = globalThis.__task102LookupCount;
    const build = createSuburbExpansionLookup;
    createSuburbExpansionLookup = function() { count('builds'); return build(); };
    const local = vectorizeSuburb;
    vectorizeSuburb = function(cell, result, lookup) {
        count('cells');
        if (cell && cell.hexagon && !cell.hexagon.isSuburb && cell.playerColor != 0 && cell.coord) count('eligibleCells');
        return local(cell, result, lookup);
    };
})();
`;
const OriginalScript = vm.Script;
vm.Script = class LookupReplayScript extends OriginalScript {
  constructor(source, options) {
    const file = options && options.filename;
    if (variant === 'scan' && patches[file]) source = replaceOnce(source, ...patches[file]);
    if (mode === 'counts' && file === 'ai/vectorizeContent.js') {
      source = replaceOnce(source, 'let adjacent = new Set()', "globalThis.__task102LookupCount('sets'); let adjacent = new Set()");
      source = replaceOnce(source, "adjacent.add(neighbour.x + ':' + neighbour.y)", "globalThis.__task102LookupCount('buildStrings'); adjacent.add(neighbour.x + ':' + neighbour.y)");
      source = replaceOnce(source, "let adjacent = expansionLookup[cell.playerColor]", "globalThis.__task102LookupCount('queryStrings'); let adjacent = expansionLookup[cell.playerColor]");
      source = source.replaceAll('if (!isLiveTownSuburb(town, suburb)) {', "globalThis.__task102LookupCount('suburbVisits'); if (!isLiveTownSuburb(town, suburb)) {");
      source += countHooks;
    }
    if (mode === 'trace' && file === 'ai/players.js') source += require('./task102-allocation-hooks.cjs');
    super(source, options);
  }
  runInContext(context, options) {
    context.__task102AllocationSink = sink;
    context.__task102LookupCount = name => { counts[name] = (counts[name] || 0) + 1; };
    return super.runInContext(context, options);
  }
};
const write = (suffix, value) => fs.writeFileSync(output + suffix, JSON.stringify(value) + '\n', {flag: 'wx'});
async function main() {
  const harness = require('../benchmarkHarness');
  const originalRun = harness.runGame;
  // Capture complete teacher outcomes, not just the teacher API's reduced summary.
  harness.runGame = options => { const result = originalRun(options); observedGames.push(result); return result; };
  const trainer = require('../cloud-train-runner');
  const api = require('../benchmark-gamestart-trained-model');
  const models = new Map();
  for (const item of pre.scenarios) for (const checkpoint of item.checkpoints || []) {
    if (!models.has(checkpoint)) models.set(checkpoint, item.group === 'component'
      ? await api.loadCheckpoint(checkpoint)
      : {model: await require('@tensorflow/tfjs-node').loadLayersModel('file://' + path.join(checkpoint, 'model.json'))});
  }
  const gc = [];
  const observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) gc.push({start: entry.startTime, duration: entry.duration, kind: entry.detail.kind});
  });
  observer.observe({entryTypes: ['gc']});
  const results = [], records = [];
  for (const item of pre.scenarios) {
    trace = []; snapshots = new Map(); counts = {}; observedGames = [];
    const scenario = item.scenario;
    const predictors = (item.checkpoints || []).map(checkpoint => item.group === 'component'
      ? api.createPredictor(models.get(checkpoint).model, {calls: 0, positions: 0, resizedInputs: 0, channelAdaptations: 0})
      : trainer.createRuntimeModelPredict(models.get(checkpoint).model));
    const memoryBefore = process.memoryUsage();
    const begin = performance.now();
    let result;
    if (item.group === 'teacher') {
      const id = scenario.modelIdentifier;
      result = trainer.collectRuntimeCombatTeacherGame(id.seed, id.stageIndex, scenario.seed - id.seed - id.stageIndex * 997);
    } else {
      result = harness.runGame({...scenario, modelIdentifier: item.group === 'component' ? models.get(item.checkpoints[0]).model : scenario.modelIdentifier,
        predictFunction: (id, grids, metadata) => predictors[predictors.length === 2 && metadata.activeSide !== item.modelSide ? 1 : 0](id, grids)});
    }
    const end = performance.now();
    const memoryAfter = process.memoryUsage();
    results.push({result, games: observedGames});
    const record = {id: item.id, group: item.group, pair: item.pair, seed: scenario.seed, begin, end, ms: end - begin,
      memoryBefore, memoryAfter, counts, resultHash: hash(JSON.stringify(results.at(-1))), traceHash: hash(JSON.stringify(trace)), traceCount: trace.length};
    records.push(record);
    if (mode === 'trace') write('.' + item.id + '.trace.json', trace);
    console.log('REPLAY_GAME: ' + JSON.stringify(record));
    await new Promise(resolve => setImmediate(resolve));
  }
  await new Promise(resolve => setImmediate(resolve));
  observer.disconnect();
  fs.writeFileSync(output + '.results.json.gz', zlib.gzipSync(JSON.stringify(results)), {flag: 'wx'});
  write('.json', {variant, mode, records, gc, node: process.version, execArgv: process.execArgv});
  for (const checkpoint of models.values()) checkpoint.model.dispose();
  console.log('LOOKUP_REPLAY: PASS ' + results.length + ' complete scenarios; ' + variant + ' ' + mode);
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
