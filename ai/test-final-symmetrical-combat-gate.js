const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  runFinalSymmetricalCombatGate,
  summarizeGames
} = require('./benchmark-final-symmetrical-combat-gate');

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
    ['ai/benchmark-final-symmetrical-combat-gate.js'].concat(args),
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
  check(failed, 'final symmetrical combat gate did not fail below threshold');
}

function assertNoCheatingSources() {
  const playersSource = read('ai/players.js');
  const gateSource = read('ai/benchmark-final-symmetrical-combat-gate.js');
  const aiPlayerStart = playersSource.indexOf('class AIPlayer extends Player');
  const aiPlayerEnd = playersSource.indexOf('class AIPlayerWithEconomy', aiPlayerStart);
  check(aiPlayerStart !== -1 && aiPlayerEnd !== -1, 'could not extract AIPlayer source');
  const aiPlayerSource = playersSource.slice(aiPlayerStart, aiPlayerEnd);
  check(!/grid\s*\.\s*arr\s*(?:\[\s*0\s*\])?\s*\.\s*length\s*(?:={2,3}|!==?|[<>]=?)\s*\d+/.test(aiPlayerSource),
    'AIPlayer contains ad-hoc exact grid size logic');
  check(!/\bSimpleAiPlayer\b/.test(aiPlayerSource),
    'AIPlayer contains SimpleAiPlayer-specific comparison logic');
  check(!/concede\s*\(/.test(gateSource),
    'final gate forces concessions');
  check(!/gold\s*:\s*999|candidateGoldBonus|simpleHandicap|artificialAdvantage\s*:\s*true/.test(gateSource),
    'final gate appears to grant an artificial advantage');
  check(!/grid\.arr(?:\[0\])?\.length\s*(?:={2,3}|!==?|[<>]=?)\s*\d+/.test(gateSource),
    'final gate branches on exact grid dimensions');
}

const reportPath = path.join(
  '/mnt',
  'storage',
  'diplomacy',
  'benchmarks',
  `task110-final-symmetrical-smoke-${process.pid}.json`);
const failureReportPath = path.join(
  '/mnt',
  'storage',
  'diplomacy',
  'benchmarks',
  `task110-final-symmetrical-fail-${process.pid}.json`);

try {
  const smoke = runFinalSymmetricalCombatGate({
    games: 2,
    seed: 110000,
    roundLimit: 80,
    actionLimit: 30,
    commandLimit: 60,
    minNoLossRate: 0,
    minWinRate: 0,
    checkpoint: 'task110-smoke-model'
  });
  check(smoke.games.length === 2, 'smoke did not run configured game count');
  check(smoke.summary.requiredGames === 2, 'smoke did not record required game count');
  check(smoke.summary.gate === 'passed', 'zero-threshold smoke should pass');
  check(Object.prototype.hasOwnProperty.call(smoke.summary, 'wins'), 'wins missing');
  check(Object.prototype.hasOwnProperty.call(smoke.summary, 'draws'), 'draws missing');
  check(Object.prototype.hasOwnProperty.call(smoke.summary, 'losses'), 'losses missing');
  check(Object.prototype.hasOwnProperty.call(smoke.summary, 'noLossRate'), 'no-loss rate missing');
  check(Object.prototype.hasOwnProperty.call(smoke.summary, 'winrate'), 'winrate missing');
  check(smoke.config.playerClasses.ai === 'AIPlayer', 'AI class missing from config');
  check(smoke.config.playerClasses.opponent === 'SimpleAiPlayer',
    'Simple class missing from config');
  check(smoke.config.candidateStarts.A === 1 && smoke.config.candidateStarts.B === 1,
    'smoke did not balance AI starts across sides');
  check(smoke.config.suddenDeathRound === 80,
    'smoke did not record the final gate sudden-death budget');
  for (const game of smoke.games) {
    check(game.classCheck.runtimeAIPlayer === 'AIPlayer',
      'runtime AIPlayer class changed');
    check(game.classCheck.runtimeOpponentPlayer === 'SimpleAiPlayer',
      'runtime SimpleAiPlayer class changed');
    check(game.symmetricalMap === true, 'game did not record symmetrical map use');
    check(game.suddenDeathRound === 80,
      'game did not use the final gate sudden-death budget');
    check(game.inference && game.inference.calls > 0,
      'AIPlayer did not exercise model inference');
  }

  const perfectSummary = summarizeGames([
    { aiResult: 'win', seed: 1 },
    { aiResult: 'draw', seed: 2 },
    { aiResult: 'loss', seed: 3 }
  ], {
    games: 3,
    minNoLossRate: 1,
    minWinRate: 0.95
  });
  check(perfectSummary.wins === 1, 'summary wins count wrong');
  check(perfectSummary.draws === 1, 'summary draws count wrong');
  check(perfectSummary.losses === 1, 'summary losses count wrong');
  check(perfectSummary.noLossRate === 2 / 3, 'summary no-loss rate wrong');
  check(perfectSummary.winrate === 1 / 3, 'summary winrate wrong');
  check(perfectSummary.gate === 'failed',
    'summary should fail when no-loss and winrate thresholds are missed');

  runCli([
    '--games', '1',
    '--seed', '110010',
    '--round-limit', '80',
    '--min-no-loss-rate', '0',
    '--min-win-rate', '0',
    '--checkpoint', 'task110-cli-smoke-model',
    '--output', reportPath
  ]);
  const cliReport = readJson(reportPath);
  check(cliReport.games.length === 2, 'CLI smoke did not write both per-game results');
  check(cliReport.summary.gate === 'passed', 'CLI zero-threshold smoke did not pass');
  check(cliReport.gates.simple, 'CLI default report missing SimpleAiPlayer gate');
  check(cliReport.gates.baselineAiPlayer, 'CLI default report missing baseline AIPlayer gate');
  check(cliReport.gates.simple.games.length === 1,
    'CLI SimpleAiPlayer gate did not run configured game count');
  check(cliReport.gates.baselineAiPlayer.games.length === 1,
    'CLI baseline AIPlayer gate did not run configured game count');
  check(cliReport.gates.baselineAiPlayer.config.playerClasses.opponent === 'AIPlayer',
    'CLI baseline opponent did not use AIPlayer');
  check(cliReport.gates.baselineAiPlayer.config.candidateStarts.A === 1 &&
      cliReport.gates.baselineAiPlayer.config.candidateStarts.B === 0,
    'CLI baseline gate did not use the measured current-side-A convention');
  check(cliReport.gates.baselineAiPlayer.config.baselineCheckpoint,
    'CLI baseline gate did not record checkpoint path');
  check(cliReport.gates.baselineAiPlayer.config.baselineInferenceStats &&
      cliReport.gates.baselineAiPlayer.config.baselineInferenceStats.calls > 0,
    'CLI baseline gate did not exercise the saved baseline AIPlayer checkpoint');
  check(cliReport.gates.baselineAiPlayer.config.baselineInferenceStats.positions > 0,
    'CLI baseline gate did not score any positions with the baseline checkpoint');
  check(cliReport.gates.baselineAiPlayer.config.baselineInferenceStats.modelProbe &&
      cliReport.gates.baselineAiPlayer.config.baselineInferenceStats.modelProbe.length > 0,
    'CLI baseline gate did not record baseline checkpoint output evidence');
  check(cliReport.config.suddenDeathRound === 80,
    'CLI report did not record default sudden-death round');

  expectCliFailure([
    '--games', '1',
    '--seed', '110011',
    '--round-limit', '1',
    '--min-no-loss-rate', '1',
    '--min-win-rate', '1',
    '--checkpoint', 'task110-cli-smoke-model',
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
}

console.log('Final symmetrical combat gate smoke passed');
