const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  defaultCheckpoint,
  parseArgs,
  runSymmetrical20x20EconomyGate
} = require('./benchmark-symmetrical-20x20-economy-gate');
const { loadAiScripts } = require('./smokeHarness');

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

function assertNoComparisonCheats() {
  const playersSource = read('ai/players.js');
  const gateSource = read('ai/benchmark-symmetrical-20x20-economy-gate.js');
  const finalGateSource = read('ai/benchmark-final-symmetrical-economy-gate.js');
  const aiStart = playersSource.indexOf('class AIPlayer extends Player');
  const aiEconomyStart = playersSource.indexOf('class AIPlayerWithEconomy', aiStart);
  check(aiStart !== -1 && aiEconomyStart !== -1, 'AIPlayer class source not found');
  const aiPlayerSource = playersSource.slice(aiStart, aiEconomyStart);
  const aiEconomySource = playersSource.slice(aiEconomyStart);
  check(!/\bSimpleAiPlayer(?:WithEconomy)?\b/.test(aiPlayerSource),
    'AIPlayer contains SimpleAiPlayer-specific comparison logic');
  check(!/grid\s*\.\s*arr\s*(?:\[\s*0\s*\])?\s*\.\s*length\s*(?:={2,3}|!==?|[<>]=?)\s*\d+/.test(aiPlayerSource),
    'AIPlayer contains exact grid-size special cases');
  check(!/grid\s*\.\s*arr\s*(?:\[\s*0\s*\])?\s*\.\s*length\s*(?:={2,3}|!==?|[<>]=?)\s*\d+/.test(aiEconomySource),
    'AIPlayerWithEconomy contains exact grid-size special cases');
  check(!/gold\s*:\s*999|candidateGoldBonus|simpleHandicap|artificialAdvantage\s*:\s*true/.test(gateSource + finalGateSource),
    'TASK-154 gate appears to grant an artificial advantage');
  check(!/concede\s*\(/.test(gateSource + finalGateSource),
    'TASK-154 gate forces concessions');
  check(!/grid\.arr(?:\[0\])?\.length\s*(?:={2,3}|!==?|[<>]=?)\s*\d+/.test(gateSource + finalGateSource),
    'TASK-154 gate branches on exact grid dimensions');
}

function stage14MapForSeed(seed) {
  const api = loadAiScripts().context;
  return {
    seed,
    gameMap: api.generateAdvancedEconomyStage14TrainingMap({ seed })
  };
}

function assertGateMapShape(seed) {
  const sample = stage14MapForSeed(seed);
  const gameMap = sample.gameMap;
  check(gameMap.mapSize.x === 20 && gameMap.mapSize.y === 20,
    'TASK-154 map is not 20x20', gameMap.mapSize);
  check(gameMap.advancedEconomyStage === 14 &&
      gameMap.economyGenerator.stage === 'advanced-14',
    'TASK-154 map is not the symmetric advanced stage-14 generator',
    gameMap.economyGenerator);
  check(gameMap.symmetry && gameMap.symmetry.axis === 'vertical' &&
      gameMap.economyGenerator.symmetric === true,
    'TASK-154 map is not symmetric', gameMap.symmetry);
  check(gameMap.players[1].playerType === 'AIPlayerWithEconomy',
    'candidate player class is wrong', gameMap.players[1].playerType);
  check(gameMap.players[2].playerType === 'SimpleAiPlayerWithEconomy',
    'opponent player class is wrong', gameMap.players[2].playerType);
  check(gameMap.players[1].gold === gameMap.players[2].gold,
    'TASK-154 map gives unequal starting gold', {
      left: gameMap.players[1].gold,
      right: gameMap.players[2].gold
    });
  check(gameMap.economyGenerator.benchmarkSpecificAdvantage === false,
    'TASK-154 map declares benchmark-specific advantage');
  return sample.seed;
}

(async () => {
  const checkpoint = defaultCheckpoint();
  check(checkpoint && fs.existsSync(path.join(checkpoint, 'model.json')),
    'TASK-154 default checkpoint is unavailable; set TASK154_CHECKPOINT for this test');
  assertNoComparisonCheats();
  assertGateMapShape(154000);
  const defaultOptions = parseArgs([]);
  check(defaultOptions.seed === 154000,
    'TASK-154 CLI default seed should use the canonical TASK-154 sequence');
  check(defaultOptions.games === 100 &&
      defaultOptions.roundLimit === 20 &&
      defaultOptions.suddenDeathRound === 20 &&
      defaultOptions.actionLimit === 4 &&
      defaultOptions.commandLimit === 16 &&
      defaultOptions.minNoLossRate === 1 &&
      defaultOptions.minWinRate === 0.95,
    'TASK-154 CLI defaults should define the full bounded 100-game gate thresholds',
    defaultOptions);

  const smoke = await runSymmetrical20x20EconomyGate({
    games: 2,
    seed: 154000,
    roundLimit: 40,
    suddenDeathRound: 40,
    actionLimit: 8,
    commandLimit: 48,
    minNoLossRate: 0,
    minWinRate: 0,
    checkpoint,
    candidateSideResolver: (_index, seed) => seed % 2 === 0 ? 'A' : 'B'
  });
  check(smoke.games.length === 2, 'smoke gate did not run two games');
  check(smoke.config.playerClasses.ai === 'AIPlayerWithEconomy',
    'gate did not use AIPlayerWithEconomy');
  check(smoke.config.playerClasses.opponent === 'SimpleAiPlayerWithEconomy',
    'gate did not use SimpleAiPlayerWithEconomy');
  check(smoke.config.mapGenerator === 'generateAdvancedEconomyStage14TrainingMap',
    'gate did not use the symmetric advanced 20x20 generator');
  check(smoke.config.requiredMap.mapSize.x === 20 &&
      smoke.config.requiredMap.mapSize.y === 20,
    'gate did not record 20x20 map requirement');
  check(smoke.config.candidateStarts.A === 1 &&
      smoke.config.candidateStarts.B === 1,
    'custom TASK-154 smoke should honor explicit side policy overrides',
    smoke.config.candidateStarts);
  check(smoke.checkpoint.gameplayInference.calls > 0,
    'gate did not use checkpoint-backed inference');
  for (const key of ['wins', 'draws', 'losses', 'noLossRate', 'winrate']) {
    check(Object.prototype.hasOwnProperty.call(smoke.summary, key),
      'summary missing ' + key);
  }
  for (const game of smoke.games) {
    check(game.classCheck.runtimeAIPlayer === 'AIPlayerWithEconomy',
      'runtime candidate class changed');
    check(game.classCheck.runtimeOpponentPlayer === 'SimpleAiPlayerWithEconomy',
      'runtime opponent class changed');
    check(game.comparison && game.comparison.artificialAdvantage === false,
      'game did not record fair comparison');
    check(game.mapStage === 'advanced-14',
      'game used the wrong map stage');
    check(game.seed === 154000 + game.gameIndex,
      'gate did not use the natural stage-14 seed sequence');
    check(game.aiSide === (game.seed % 2 === 0 ? 'A' : 'B'),
      'custom smoke did not use the requested side policy override');
  }

  const nativeSideSmoke = await runSymmetrical20x20EconomyGate({
    games: 2,
    seed: 154000,
    roundLimit: 20,
    suddenDeathRound: 20,
    actionLimit: 4,
    commandLimit: 16,
    minNoLossRate: 0,
    minWinRate: 0,
    checkpoint
  });
  check(nativeSideSmoke.config.candidateStarts.A === 2 &&
      nativeSideSmoke.config.candidateStarts.B === 0,
    'TASK-154 default should use the native stage-14 AI side',
    nativeSideSmoke.config.candidateStarts);
  check(nativeSideSmoke.games.every(game => game.aiSide === 'A'),
    'TASK-154 native side smoke should keep AIPlayerWithEconomy on side A');

  const reportPath = path.join(
    '/mnt',
    'storage',
    'diplomacy',
    'benchmarks',
    `task154-smoke-${process.pid}.json`);
  const failureReportPath = path.join(
    '/mnt',
    'storage',
    'diplomacy',
    'benchmarks',
    `task154-failure-${process.pid}.json`);
  try {
    execFileSync(process.execPath, [
      'ai/benchmark-symmetrical-20x20-economy-gate.js',
      '--games', '1',
      '--seed', '154010',
      '--round-limit', '40',
      '--sudden-death-round', '40',
      '--min-no-loss-rate', '0',
      '--min-win-rate', '0',
      '--checkpoint', checkpoint,
      '--output', reportPath
    ], {
      cwd: path.resolve(__dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const cliReport = readJson(reportPath);
    check(cliReport.summary.requiredGames === 1,
      'CLI smoke did not honor configured lower game count');
    check(cliReport.summary.gate === 'passed',
      'CLI smoke did not pass with zero thresholds');
    check(cliReport.config.mapGenerator === 'generateAdvancedEconomyStage14TrainingMap',
      'CLI report did not record stage-14 generator');

    let failed = false;
    try {
      execFileSync(process.execPath, [
        'ai/benchmark-symmetrical-20x20-economy-gate.js',
        '--games', '1',
        '--seed', '154020',
        '--round-limit', '1',
        '--sudden-death-round', '40',
        '--min-no-loss-rate', '1',
        '--min-win-rate', '1',
        '--checkpoint', checkpoint,
        '--output', failureReportPath
      ], {
        cwd: path.resolve(__dirname, '..'),
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      failed = error.status !== 0;
    }
    check(failed, 'TASK-154 gate did not exit nonzero on threshold failure');
    const failureReport = readJson(failureReportPath);
    check(failureReport.summary.gate === 'failed',
      'failure report did not record failed gate');
    check(failureReport.summary.minNoLossRate === 1 &&
        failureReport.summary.minWinRate === 1,
      'failure report did not record thresholds');
  } finally {
    for (const filePath of [reportPath, failureReportPath]) {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }

  console.log('TASK-154 symmetrical 20x20 economy benchmark gate smoke passed');
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
