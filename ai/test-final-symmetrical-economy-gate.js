const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const tf = require('@tensorflow/tfjs-node');
const {
  runFinalSymmetricalEconomyGate,
  summarizeGames
} = require('./benchmark-final-symmetrical-economy-gate');

function check(condition, message, details) {
  if (condition) {
    return;
  }
  const suffix = details ? ': ' + JSON.stringify(details, null, 2) : '';
  throw new Error(message + suffix);
}

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runCli(args) {
  return execFileSync(
    process.execPath,
    ['ai/benchmark-final-symmetrical-economy-gate.js'].concat(args),
    {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
}

function expectCliFailure(args) {
  let failed = false;
  try {
    runCli(args);
  } catch (error) {
    failed = error.status !== 0;
  }
  check(failed, 'final symmetrical economy gate did not fail below threshold');
}

function removePath(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmdirSync(filePath, { recursive: true });
  }
}

async function createSmokeCheckpoint(checkpointDir) {
  removePath(checkpointDir);
  fs.mkdirSync(checkpointDir, { recursive: true });
  const boardInput = tf.input({ shape: [7, 7, 78], name: 'board' });
  const globalInput = tf.input({ shape: [1], name: 'global_variables' });
  const flat = tf.layers.flatten().apply(boardInput);
  const merged = tf.layers.concatenate().apply([flat, globalInput]);
  const output = tf.layers.dense({
    units: 1,
    activation: 'tanh',
    name: 'value_output'
  }).apply(merged);
  const model = tf.model({ inputs: [boardInput, globalInput], outputs: output });
  await model.save('file://' + checkpointDir);
  model.dispose();
  fs.writeFileSync(path.join(checkpointDir, 'metadata.json'), JSON.stringify({
    trainer: 'AIPlayerWithEconomy',
    dataSource: 'test-trained-economy-checkpoint',
    cellVectorSize: 78,
    game: 1,
    valueFunction: 'final-symmetrical-economy-v1'
  }, null, 2) + '\n');
}

function assertNoCheatingSources() {
  const playersSource = read('ai/players.js');
  const gateSource = read('ai/benchmark-final-symmetrical-economy-gate.js');
  const aiStart = playersSource.indexOf('class AIPlayer extends Player');
  const aiEnd = playersSource.indexOf('class AIPlayerWithEconomy', aiStart);
  check(aiStart !== -1 && aiEnd !== -1,
    'could not extract AIPlayer source');
  const aiPlayerSource = playersSource.slice(aiStart, aiEnd);
  const economySource = playersSource.slice(aiEnd);
  check(!/\bSimpleAiPlayer(?:WithEconomy)?\b/.test(aiPlayerSource),
    'AIPlayer contains SimpleAiPlayer comparison logic');
  check(!/grid\s*\.\s*arr\s*(?:\[\s*0\s*\])?\s*\.\s*length\s*(?:={2,3}|!==?|[<>]=?)\s*\d+/.test(aiPlayerSource),
    'AIPlayer contains exact grid-size special cases');
  const oldImmediateAttackFlags = new RegExp(
    'aiModelRankImmediate' + 'Attacks|modelRankImmediate' + 'Attacks');
  check(!oldImmediateAttackFlags.test(playersSource + gateSource),
    'final economy gate uses benchmark-specific immediate-attack player logic');
  check(!/grid\s*\.\s*arr\s*(?:\[\s*0\s*\])?\s*\.\s*length\s*(?:={2,3}|!==?|[<>]=?)\s*\d+/.test(economySource),
    'AIPlayerWithEconomy contains exact grid-size special cases');
  check(!/concede\s*\(/.test(gateSource),
    'final economy gate forces concessions');
  check(!/gold\s*:\s*999|candidateGoldBonus|simpleHandicap|artificialAdvantage\s*:\s*true/.test(gateSource),
    'final economy gate appears to grant an artificial advantage');
  check(!/grid\.arr(?:\[0\])?\.length\s*(?:={2,3}|!==?|[<>]=?)\s*\d+/.test(gateSource),
    'final economy gate branches on exact grid dimensions');
}

const reportPath = path.join(
  '/mnt',
  'storage',
  'diplomacy',
  'benchmarks',
  `task136-final-symmetrical-economy-smoke-${process.pid}.json`);
const failureReportPath = path.join(
  '/mnt',
  'storage',
  'diplomacy',
  'benchmarks',
  `task136-final-symmetrical-economy-fail-${process.pid}.json`);
const checkpointDir = path.join(
  '/mnt',
  'storage',
  'diplomacy',
  'checkpoints',
  `task137-economy-gate-smoke-${process.pid}`,
  'step-00000001');

(async () => {
try {
  await createSmokeCheckpoint(checkpointDir);
  const smoke = await runFinalSymmetricalEconomyGate({
    games: 2,
    seed: 136000,
    roundLimit: 40,
    suddenDeathRound: 40,
    actionLimit: 8,
    commandLimit: 48,
    minNoLossRate: 0,
    minWinRate: 0,
    checkpoint: checkpointDir
  });
  check(smoke.games.length === 2, 'smoke did not run configured game count');
  check(smoke.summary.requiredGames === 2,
    'smoke did not record required game count');
  check(smoke.summary.gate === 'passed',
    'zero-threshold smoke should pass');
  for (const key of ['wins', 'draws', 'losses', 'noLossRate', 'winrate']) {
    check(Object.prototype.hasOwnProperty.call(smoke.summary, key),
      'summary missing ' + key);
  }
  check(smoke.config.playerClasses.ai === 'AIPlayerWithEconomy',
    'AI economy class missing from config');
  check(smoke.config.playerClasses.opponent === 'SimpleAiPlayerWithEconomy',
    'Simple economy class missing from config');
  check(smoke.config.mapGenerator === 'generateSymmetricalEconomy9v9AllUnitMap',
    'gate used the wrong map generator');
  check(smoke.config.candidateStarts.A === 2 && smoke.config.candidateStarts.B === 0,
    'gate did not record the native symmetrical-map candidate side');
  check(smoke.checkpoint.path === checkpointDir,
    'gate did not record the loaded checkpoint path');
  check(smoke.checkpoint.signature.inputs[0][3] === 78,
    'gate did not record the checkpoint vector shape');
  check(smoke.checkpoint.gameplayInference.calls > 0,
    'loaded checkpoint was not used for gameplay inference');
  check(smoke.checkpoint.gameplayInference.positions >
      smoke.checkpoint.gameplayInference.calls,
    'loaded checkpoint did not score competing gameplay actions');
  check(smoke.checkpoint.gameplayInference.metadataValueFunction ===
      'final-symmetrical-economy-v1',
    'gate did not use the checkpoint-declared value function');
  for (const game of smoke.games) {
    check(game.classCheck.runtimeAIPlayer === 'AIPlayerWithEconomy',
      'runtime AIPlayerWithEconomy class changed');
    check(game.classCheck.runtimeOpponentPlayer === 'SimpleAiPlayerWithEconomy',
      'runtime SimpleAiPlayerWithEconomy class changed');
    check(game.symmetricalMap === true,
      'game did not record symmetrical map use');
    check(game.comparison && game.comparison.artificialAdvantage === false,
      'game comparison did not record fair setup');
    check(game.inference && game.inference.calls > 0,
      'AIPlayerWithEconomy did not exercise model inference');
    check(game.modelCheckpoint === checkpointDir,
      'game did not record the loaded checkpoint path');
  }

  const summary = summarizeGames([
    { aiResult: 'win', seed: 1 },
    { aiResult: 'draw', seed: 2 },
    { aiResult: 'loss', seed: 3 }
  ], {
    games: 3,
    minNoLossRate: 1,
    minWinRate: 0.95
  });
  check(summary.wins === 1, 'summary wins count wrong');
  check(summary.draws === 1, 'summary draws count wrong');
  check(summary.losses === 1, 'summary losses count wrong');
  check(summary.noLossRate === 2 / 3, 'summary no-loss rate wrong');
  check(summary.winrate === 1 / 3, 'summary winrate wrong');
  check(summary.gate === 'failed',
    'summary should fail when no-loss and winrate thresholds are missed');

  runCli([
    '--games', '1',
    '--seed', '136010',
    '--round-limit', '40',
    '--sudden-death-round', '40',
    '--min-no-loss-rate', '0',
    '--min-win-rate', '0',
    '--checkpoint', checkpointDir,
    '--output', reportPath
  ]);
  const cliReport = readJson(reportPath);
  check(cliReport.games.length === 1,
    'CLI smoke did not write per-game results');
  check(cliReport.summary.gate === 'passed',
    'CLI zero-threshold smoke did not pass');
  check(cliReport.summary.requiredGames === 1,
    'CLI report did not record requested game count');
  check(cliReport.checkpoint.gameplayInference.calls > 0,
    'CLI gate did not use the loaded checkpoint');

  expectCliFailure([
    '--games', '1',
    '--seed', '136012',
    '--round-limit', '40',
    '--sudden-death-round', '40',
    '--min-no-loss-rate', '0',
    '--min-win-rate', '0',
    '--checkpoint', path.join(checkpointDir, '..', 'missing-checkpoint'),
    '--output', failureReportPath
  ]);

  expectCliFailure([
    '--games', '1',
    '--seed', '136011',
    '--round-limit', '1',
    '--sudden-death-round', '40',
    '--min-no-loss-rate', '1',
    '--min-win-rate', '1',
    '--checkpoint', checkpointDir,
    '--output', failureReportPath
  ]);
  const failureReport = readJson(failureReportPath);
  check(failureReport.summary.gate === 'failed',
    'failure report did not record failed gate');
  check(failureReport.summary.minNoLossRate === 1,
    'failure report did not record no-loss threshold');
  check(failureReport.summary.minWinRate === 1,
    'failure report did not record winrate threshold');

  assertNoCheatingSources();
} finally {
  for (const filePath of [reportPath, failureReportPath]) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
  removePath(path.join(checkpointDir, '..'));
}

console.log('Final symmetrical economy gate smoke passed');
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
