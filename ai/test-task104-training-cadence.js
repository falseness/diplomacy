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

function main() {
  const storageDir = path.join('/mnt/storage/diplomacy', `task104-cadence-${process.pid}`);
  const runId = 'task104-cadence';
  fs.rmSync(storageDir, { recursive: true, force: true });
  try {
    const env = {
      ...process.env,
      PATH: `${node20BinDir()}:${process.env.PATH || ''}`
    };
    execFileSync(
      'bash',
      [
        './train.sh',
        '--storage-dir', storageDir,
        '--run-id', runId,
        '--games', '5',
        '--epochs', '1',
        '--seed', '104104',
        '--checkpoint-interval', '1',
        '--old-vs-new-games', '1',
        '--evaluation-cadence', '2',
        '--plateau-window', '1',
        '--plateau-min-delta', '2',
        '--plateau-patience', '1',
        '--curriculum-simple-winrate', '0.85',
        '--curriculum-lr-reduction-attempted'
      ],
      { cwd: path.resolve(__dirname, '..'), env, stdio: 'pipe' }
    );

    const metricsPath = path.join(storageDir, 'metrics', `${runId}.jsonl`);
    const progressPath = path.join(storageDir, 'progress', `${runId}.jsonl`);
    const summaryPath = path.join(storageDir, 'metrics', `${runId}.summary.json`);
    const statePath = path.join(storageDir, 'runs', runId, 'state.json');
    const manifestPath = path.join(storageDir, 'runs', runId, 'manifest.json');

    const gameRecords = readJsonLines(metricsPath)
      .filter((record) => record.type === 'game');
    const progressRecords = readJsonLines(progressPath);
    check(gameRecords.length === 5, 'metrics rows should equal games');
    check(progressRecords.length === 5, 'progress rows should equal games');

    const expectedEvaluations = Math.ceil(5 / 2);
    const oldVsNewEvaluations = gameRecords.filter((record) =>
      record.oldVsNewEvaluation.reason !== 'deferred until the configured evaluation cadence');
    check(oldVsNewEvaluations.length === expectedEvaluations,
      'old-vs-new evaluation cadence count mismatch',
      oldVsNewEvaluations.map((record) => record.game));

    const state = readJson(statePath);
    check(state.curriculum.gateHistory.length === expectedEvaluations,
      'curriculum gate cadence count mismatch',
      state.curriculum.gateHistory.map((record) => record.trainingStep));
    check(progressRecords.filter((record) =>
      record.simpleAiPlayerWinrate.reason === 'deferred until the configured evaluation cadence'
    ).length === 5 - expectedEvaluations,
    'non-cadence progress rows should defer curriculum benchmark work');

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
    check(manifest.configuration.evaluationCadence === 2,
      'manifest did not record evaluation cadence');
  } finally {
    fs.rmSync(storageDir, { recursive: true, force: true });
  }

  console.log('TASK-104 training cadence smoke passed');
}

main();
