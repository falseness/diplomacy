// Opt-in diagnostic preload. The archived runtime files remain unmodified.
const fs = require('fs');
const Module = require('module');
const assert = require('assert');
const {performance, PerformanceObserver} = require('perf_hooks');
const root = process.env.TASK102_PHASE_OUTPUT;
const enabled = process.env.TASK102_PHASE_MODE === 'on';
const active = root && process.argv[1] && process.argv[1].endsWith('/ai/cloud-train-runner.js');

if (active) {
  const events = [], stack = [], gc = [];
  let step = 0, teacherGames = 0, teacherExamples = 0;
  const append = (file, data) => fs.appendFileSync(`${root}/${file}.jsonl`, JSON.stringify(data) + '\n');
  const counts = () => ({step, teacherGames, teacherExamples});
  function enter(name, detail) {
    if (!enabled) return null;
    const event = {name, detail, ...counts(), start: performance.now(), memoryBefore: process.memoryUsage(), childrenMs: 0};
    stack.push(event);
    return event;
  }
  function leave(event) {
    if (!event) return;
    event.end = performance.now();
    event.memoryAfter = process.memoryUsage();
    event.countsAfter = counts();
    assert.strictEqual(stack.pop(), event, 'phases must nest on the single-worker command');
    event.exclusiveMs = event.end - event.start - event.childrenMs;
    if (stack.length) stack[stack.length - 1].childrenMs += event.end - event.start;
    events.push(event);
  }
  function wrap(name, fn, capture) {
    return function(...args) {
      const event = enter(name);
      const finish = result => {
        leave(event);
        if (capture) capture(result, args);
        return result;
      };
      let result;
      try { result = fn.apply(this, args); }
      catch (error) { leave(event); throw error; }
      if (result && typeof result.then === 'function') {
        return result.then(finish, error => { leave(event); throw error; });
      }
      return finish(result);
    };
  }
  const observer = enabled ? new PerformanceObserver(list => {
    for (const event of list.getEntries()) gc.push({start: event.startTime, end: event.startTime + event.duration});
  }) : null;
  if (observer) observer.observe({entryTypes: ['gc']});
  const api = {
    wrap,
    started() {
      if (enabled) {
        const end = performance.now();
        events.push({name: 'startup', start: 0, end, childrenMs: 0, exclusiveMs: end});
      }
    },
    teacher(result) {
      teacherGames++;
      teacherExamples += result.examples.length;
      append('teachers', result);
    },
    retention(results) {
      if (enabled) append('retention', {...counts(), time: performance.now(),
        retainedResults: results.length, retainedExamples: results.reduce((sum, r) => sum + r.examples.length, 0),
        memory: process.memoryUsage()});
    },
    step(value, records) {
      step = value;
      if (enabled) append('retention', {...counts(), time: performance.now(), retainedMetricRecords: records,
        memory: process.memoryUsage()});
    },
    fit(name, model, ...args) {
      return wrap(name, model.fit, history => append('losses', {name, ...counts(), history: history.history})).apply(model, args);
    },
    load(tf, ...args) { return wrap('model-load', tf.loadLayersModel).apply(tf, args); },
    dispose(model) { return wrap('model-dispose', model.dispose).call(model); }
  };
  global.__task102Phases = api;
  const extension = Module._extensions['.js'];
  Module._extensions['.js'] = function(module, filename) {
    if (!filename.endsWith('/ai/cloud-train-runner.js')) return extension(module, filename);
    let source = fs.readFileSync(filename, 'utf8');
    const replacements = [
      ['ranker.fit(', '__task102Phases.fit("ranking-fit", ranker,'],
      ['pretrainer.fit(', '__task102Phases.fit("pretrain-fit", pretrainer,'],
      ['model.fit(', '__task102Phases.fit("synthetic-fit", model,'],
      ['runtimeValueTrainer(model).fit(', '__task102Phases.fit("value-fit", runtimeValueTrainer(model),'],
      ['tf.loadLayersModel(', '__task102Phases.load(tf,'],
      ['gameMetricRecords.push(metric);', 'gameMetricRecords.push(metric); __task102Phases.step(game, gameMetricRecords.length);'],
      ['const game = state.completedGames + 1;', 'const game = state.completedGames + 1; __task102Phases.step(game, gameMetricRecords.length);'],
      ['async function trainRuntimeCombatRanking(model, gameResults, epochs) {',
        'async function trainRuntimeCombatRanking(model, gameResults, epochs) { __task102Phases.retention(gameResults);']
    ];
    for (const [from, to] of replacements) {
      assert(source.includes(from), `missing diagnostic boundary: ${from}`);
      source = source.split(from).join(to);
    }
    source = source.replace(/\b(model|oldModel|baselineModel|evaluationModel)\.dispose\(\)/g, '__task102Phases.dispose($1)');
    const phases = {
      collectRuntimeCombatTeacherGame: 'teacher-rollout',
      trainRuntimeCombatRanking: 'ranking-preparation-cleanup',
      pretrainCombatValueModel: 'pretrain-preparation-cleanup',
      evaluateNewVsOld: 'evaluation-old-new',
      evaluateCurriculumSimpleAiWinrate: 'evaluation-simple',
      evaluateCurriculumBaselineAiWinrate: 'evaluation-baseline',
      saveCheckpoint: 'checkpoint-io', saveModelAtomically: 'checkpoint-io'
    };
    const boundary = 'if (require.main === module && isMainThread) {';
    assert.strictEqual(source.split(boundary).length, 2);
    const wrappers = Object.entries(phases).map(([fn, phase]) =>
      `${fn} = __task102Phases.wrap(${JSON.stringify(phase)}, ${fn}${fn === 'collectRuntimeCombatTeacherGame' ? ', __task102Phases.teacher' : ''});`).join('\n');
    source = source.replace(boundary, wrappers + '\n' + boundary + '\n __task102Phases.started();');
    fs.writeFileSync(`${root}/observed-runner.js`, source);
    module._compile(source, filename);
  };
  const load = Module._load;
  const seen = new WeakSet();
  Module._load = function(...args) {
    const value = load.apply(this, args);
    if (args[0].endsWith('benchmarkHarness') && value.runGame && !seen.has(value)) {
      seen.add(value);
      const run = value.runGame;
      value.runGame = function(options) {
        const scenario = {...options};
        delete scenario.predictFunction;
        append('outcomes', {event: 'start', scenario});
        try {
          const game = run.apply(this, arguments);
          append('outcomes', {event: 'result', game});
          return game;
        } catch (error) {
          append('outcomes', {event: 'crash', error: String(error.stack)});
          throw error;
        }
      };
    }
    return value;
  };
  process.on('exit', code => {
    if (observer) { for (const event of observer.takeRecords()) gc.push({start: event.startTime, end: event.startTime + event.duration}); observer.disconnect(); }
    fs.writeFileSync(`${root}/phases.json`, JSON.stringify({mode: enabled ? 'on' : 'off', code,
      totalMs: performance.now(), events, gc, unfinished: stack, counts: counts(), finalMemory: process.memoryUsage()}, null, 2));
  });
}
