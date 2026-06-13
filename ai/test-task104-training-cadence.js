const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function check(condition, message, details) {
  if (condition) {
    return;
  }
  const suffix = details ? ': ' + JSON.stringify(details, null, 2) : '';
  throw new Error(message + suffix);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonLines(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function runTraining(storageDir, runId, games, extraArgs, extraEnv = {}) {
  const env = {
    ...process.env,
    ...extraEnv,
    PATH: `${node20BinDir()}:${process.env.PATH || ''}`
  };
  execFileSync(
    'bash',
    [
      './train.sh',
      '--storage-dir', storageDir,
      '--run-id', runId,
      '--games', String(games),
      '--epochs', '1',
      '--seed', '104104',
      '--checkpoint-interval', '1',
      '--old-vs-new-games', '1',
      '--plateau-window', '1',
      '--plateau-min-delta', '2',
      '--plateau-patience', '1',
      '--curriculum-simple-winrate', '0.85',
      '--curriculum-lr-reduction-attempted',
      ...extraArgs
    ],
    { cwd: path.resolve(__dirname, '..'), env, stdio: 'pipe' }
  );
}

function runInvariantTraining(storageDir, runId, legacyMetricLoop) {
  runTraining(
    storageDir,
    runId,
    6,
    ['--evaluation-cadence', '1'],
    {
      DIPLOMACY_TASK104_DETERMINISTIC_INVARIANT: '1',
      DIPLOMACY_TASK104_LEGACY_METRIC_LOOP: legacyMetricLoop ? '1' : '0'
    }
  );
}

function node20BinDir() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) {
    return path.dirname(process.execPath);
  }
  const output = execFileSync(
    'npx',
    ['-y', '-p', 'node@20', 'node', '-e', 'console.log(require("path").dirname(process.execPath))'],
    { encoding: 'utf8' }
  );
  return output.trim();
}

function summarizeGameRecords(records) {
  const wins = { red: 0, blue: 0, draw: 0 };
  let lossTotal = 0;
  let episodeLengthTotal = 0;
  for (const record of records) {
    wins[record.winner] += 1;
    lossTotal += record.loss;
    episodeLengthTotal += record.episodeLength;
  }
  return {
    gamesPlayed: records.length,
    averageLoss: lossTotal / records.length,
    averageEpisodeLength: episodeLengthTotal / records.length,
    wins
  };
}

function assertCadenceRun(storageDir, runId, games, cadence, expectedEvaluations) {
  const metricsPath = path.join(storageDir, 'metrics', `${runId}.jsonl`);
  const progressPath = path.join(storageDir, 'progress', `${runId}.jsonl`);
  const summaryPath = path.join(storageDir, 'metrics', `${runId}.summary.json`);
  const statePath = path.join(storageDir, 'runs', runId, 'state.json');
  const manifestPath = path.join(storageDir, 'runs', runId, 'manifest.json');

  const gameRecords = readJsonLines(metricsPath)
    .filter((record) => record.type === 'game');
  const progressRecords = readJsonLines(progressPath);
  check(gameRecords.length === games, 'metrics rows should equal games');
  check(progressRecords.length === games, 'progress rows should equal games');
  check(gameRecords.every((record, index) => record.game === index + 1),
    'metrics rows should preserve one row per completed game');
  check(progressRecords.every((record, index) => record.game === index + 1),
    'progress rows should preserve one row per completed game');

  const oldVsNewEvaluations = gameRecords.filter((record) =>
    record.oldVsNewEvaluation.reason !== 'deferred until the configured evaluation cadence');
  check(oldVsNewEvaluations.length === expectedEvaluations,
    'old-vs-new evaluation cadence count mismatch',
    oldVsNewEvaluations.map((record) => record.game));

  const state = readJson(statePath);
  check(state.curriculum.gateHistory.length === expectedEvaluations,
    'curriculum gate cadence count mismatch',
    state.curriculum.gateHistory.map((record) => record.trainingStep));

  const deferredProgressRows = progressRecords.filter((record) =>
    record.simpleAiPlayerWinrate.reason === 'deferred until the configured evaluation cadence'
  ).length;
  check(deferredProgressRows === games - expectedEvaluations,
    'non-cadence progress rows should defer curriculum benchmark work');

  if (cadence === 1) {
    check(oldVsNewEvaluations.length === gameRecords.length,
      'cadence 1 must preserve the legacy every-game old-vs-new evaluation path');
    check(state.curriculum.gateHistory.length === gameRecords.length,
      'cadence 1 must preserve the legacy every-game curriculum gate path');
    check(deferredProgressRows === 0,
      'cadence 1 should not emit cadence-deferred progress rows');
    for (const record of progressRecords) {
      check(record.oldVsNewWinrate.reason !== 'deferred until the configured evaluation cadence',
        'cadence 1 progress should never defer old-vs-new evaluation',
        { game: record.game, oldVsNewWinrate: record.oldVsNewWinrate });
      check(record.simpleAiPlayerWinrate.source !== 'deferred-until-curriculum-gate-can-advance' ||
          record.simpleAiPlayerWinrate.reason !== 'deferred until the configured evaluation cadence',
        'cadence 1 progress should never defer curriculum evaluation because of cadence',
        { game: record.game, simpleAiPlayerWinrate: record.simpleAiPlayerWinrate });
      check(record.curriculum.gateHistory.length === record.game,
        'cadence 1 progress should include the legacy gate decision for every game',
        { game: record.game, gateHistory: record.curriculum.gateHistory });
      check(record.curriculum.gateHistory[record.curriculum.gateHistory.length - 1].trainingStep === record.game,
        'cadence 1 gate history should end at the current game',
        { game: record.game, gateHistory: record.curriculum.gateHistory });
    }
  } else {
    for (const record of progressRecords) {
      const shouldEvaluate = record.game % cadence === 0 || record.game === gameRecords.length;
      const expectedGateCount = progressRecords
        .slice(0, record.game)
        .filter((candidate) => candidate.game % cadence === 0 ||
          candidate.game === gameRecords.length)
        .length;
      check(record.curriculum.gateHistory.length === expectedGateCount,
        'cadence K progress should only add gate decisions on evaluation games',
        { game: record.game, cadence, gateHistory: record.curriculum.gateHistory });
      if (!shouldEvaluate) {
        check(record.oldVsNewWinrate.reason === 'deferred until the configured evaluation cadence',
          'non-cadence progress rows should defer old-vs-new evaluation');
      }
    }
  }

  const summary = readJson(summaryPath);
  const expectedSummary = summarizeGameRecords(gameRecords);
  check(summary.gamesPlayed === expectedSummary.gamesPlayed,
    'summary gamesPlayed does not match parsed JSONL');
  check(Math.abs(summary.averageLoss - expectedSummary.averageLoss) < 1e-12,
    'summary averageLoss does not match parsed JSONL');
  check(Math.abs(summary.averageEpisodeLength - expectedSummary.averageEpisodeLength) < 1e-12,
    'summary averageEpisodeLength does not match parsed JSONL');
  check(JSON.stringify(summary.wins) === JSON.stringify(expectedSummary.wins),
    'summary wins do not match parsed JSONL');

  const manifest = readJson(manifestPath);
  check(manifest.configuration.evaluationCadence === cadence,
    'manifest did not record evaluation cadence');
}

function assertSourceUsesInMemoryMetrics() {
  const source = fs.readFileSync(
    path.join(__dirname, 'cloud-train-runner.js'),
    'utf8'
  );
  check(source.includes(': gameMetricRecords.slice();'),
    'training loop should summarize from the in-memory metric cache');
  check(!source.includes('const previousRecords = metricRecords(metricsPath);'),
    'training loop should not re-read the full metrics JSONL per game');
  check(source.includes('assertMetricRecordsMatchFile(gameMetricRecords, metricsPath);'),
    'training loop should assert in-memory metric records match the JSONL file');
  check(source.includes('DIPLOMACY_TASK104_LEGACY_METRIC_LOOP'),
    'training cadence test should be able to exercise the legacy file-backed metric loop');
  check(source.includes('DIPLOMACY_TASK104_DETERMINISTIC_INVARIANT'),
    'training cadence test should have deterministic invariant controls');
  check(source.includes('function deterministicTrainingMode(options, state)'),
    'cadence=1 fixed-seed runs should use deterministic training mode');
  check(source.includes('return options && options.evaluationCadence === 1;'),
    'cadence=1 should enable the deterministic output-identical invariant by default');
  check(source.includes('function cadenceSpeedMode(options)'),
    'cadence K should have an explicit training-throughput mode');
  check(source.includes('cadenceSpeedMode(options) ? 1 : 8'),
    'cadence K should reduce synthetic fit work without changing cadence=1 behavior');
  check(source.includes('if (!cadenceSpeedMode(options) || shouldEvaluateGameNow)'),
    'cadence K should skip runtime teacher fit work on non-evaluation games');
  check(source.includes('function shouldEvaluateGame(game, totalGames, cadence)'),
    'cadence K runtime teacher fit should use the same evaluation schedule as gate work');
  check(source.includes('shouldEvaluateCurriculum = true'),
    'progressRecord should default to legacy every-game curriculum evaluation');
  check(source.includes('shuffle: !deterministicTrainingMode(options, state)'),
    'cadence=1 should use unshuffled deterministic fitting for the output-identical invariant');
  check(source.includes('model = createModel(deterministicTrainingMode(options, state) ? state.seed : undefined);'),
    'cadence=1 should seed model construction for the output-identical invariant');
  check(source.includes('durationMs: deterministicTrainingMode(options, state) ? 0 : Date.now() - started'),
    'cadence=1 should not write volatile duration fields');
}

function assertCadenceOneMatchesLegacy(storageDir) {
  const legacyRunId = 'task104-legacy-cadence-one';
  const currentRunId = 'task104-current-cadence-one';
  runInvariantTraining(storageDir, legacyRunId, true);
  runInvariantTraining(storageDir, currentRunId, false);

  const readRun = (runId) => ({
    metrics: readJsonLines(path.join(storageDir, 'metrics', `${runId}.jsonl`)),
    progress: readJsonLines(path.join(storageDir, 'progress', `${runId}.jsonl`)),
    gateHistory: readJson(path.join(storageDir, 'runs', runId, 'state.json'))
      .curriculum.gateHistory
  });
  const normalize = (value, runId) =>
    JSON.parse(JSON.stringify(value).replace(new RegExp(runId, 'g'), '<run-id>'));
  const legacy = normalize(readRun(legacyRunId), legacyRunId);
  const current = normalize(readRun(currentRunId), currentRunId);
  check(
    JSON.stringify(current.metrics) === JSON.stringify(legacy.metrics),
    'cadence=1 metrics JSONL should match the legacy file-backed loop exactly'
  );
  check(
    JSON.stringify(current.progress) === JSON.stringify(legacy.progress),
    'cadence=1 progress JSONL should match the legacy file-backed loop exactly'
  );
  check(
    JSON.stringify(current.gateHistory) === JSON.stringify(legacy.gateHistory),
    'cadence=1 curriculum gate history should match the legacy file-backed loop exactly'
  );
}

function main() {
  const storageDir = path.join('/mnt/storage/diplomacy', `task104-cadence-${process.pid}`);
  fs.rmSync(storageDir, { recursive: true, force: true });
  try {
    assertSourceUsesInMemoryMetrics();
    assertCadenceOneMatchesLegacy(storageDir);

    const cadenceOneRunId = 'task104-cadence-one';
    runTraining(storageDir, cadenceOneRunId, 6, ['--evaluation-cadence', '1']);
    assertCadenceRun(storageDir, cadenceOneRunId, 6, 1, 6);

    const cadenceTwoRunId = 'task104-cadence-two';
    runTraining(storageDir, cadenceTwoRunId, 5, ['--evaluation-cadence', '2']);
    assertCadenceRun(storageDir, cadenceTwoRunId, 5, 2, Math.ceil(5 / 2));
  } finally {
    fs.rmSync(storageDir, { recursive: true, force: true });
  }

  console.log('TASK-104 training cadence smoke passed');
}

main();
