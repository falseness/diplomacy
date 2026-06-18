const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  DEFAULT_CHECKPOINT,
  runSymmetrical9x9AllUnitsGate
} = require('./benchmark-symmetrical-9x9-all-units-gate');
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
  const gateSource = read('ai/benchmark-symmetrical-9x9-all-units-gate.js');
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
  check(!/gold\s*:\s*999|candidateGoldBonus|simpleHandicap|artificialAdvantage\s*:\s*true/.test(gateSource),
    'TASK-152 gate appears to grant an artificial advantage');
}

function assertGateMapShape(seed) {
  const api = loadAiScripts().context;
  const gameMap = api.generateSymmetricalEconomy9v9AllUnitMap({ seed });
  check(gameMap.mapSize.x === 9 && gameMap.mapSize.y === 9,
    'TASK-152 map is not 9x9', gameMap.mapSize);
  check(gameMap.players[1].playerType === 'AIPlayerWithEconomy',
    'candidate player class is wrong', gameMap.players[1].playerType);
  check(gameMap.players[2].playerType === 'SimpleAiPlayerWithEconomy',
    'opponent player class is wrong', gameMap.players[2].playerType);
  for (const playerIndex of [1, 2]) {
    const player = gameMap.players[playerIndex];
    const unitTypes = new Set(player.units.map((unit) => unit.type.name));
    for (const type of ['Noob', 'Archer', 'KOHb', 'Normchel', 'Catapult']) {
      check(unitTypes.has(type), 'TASK-152 map is missing unit type ' + type, {
        playerIndex,
        unitTypes: Array.from(unitTypes)
      });
    }
    check(player.towers.length >= 1, 'TASK-152 map is missing towers', { playerIndex });
    check(player.bastions.length >= 1, 'TASK-152 map is missing bastions', { playerIndex });
  }
  check(gameMap.economyGenerator.benchmarkSpecificAdvantage === false,
    'TASK-152 map declares benchmark-specific advantage');
}

(async () => {
  check(fs.existsSync(path.join(DEFAULT_CHECKPOINT, 'model.json')),
    'TASK-152 default checkpoint is unavailable; set TASK152_CHECKPOINT for this test');
  assertNoComparisonCheats();
  assertGateMapShape(152000);

  const smoke = await runSymmetrical9x9AllUnitsGate({
    games: 2,
    seed: 152000,
    roundLimit: 40,
    suddenDeathRound: 40,
    actionLimit: 8,
    commandLimit: 48,
    minNoLossRate: 0,
    minWinRate: 0,
    checkpoint: process.env.TASK152_CHECKPOINT || DEFAULT_CHECKPOINT
  });
  check(smoke.games.length === 2, 'smoke gate did not run two games');
  check(smoke.config.playerClasses.ai === 'AIPlayerWithEconomy',
    'gate did not use AIPlayerWithEconomy');
  check(smoke.config.playerClasses.opponent === 'SimpleAiPlayerWithEconomy',
    'gate did not use SimpleAiPlayerWithEconomy');
  check(smoke.config.mapGenerator === 'generateSymmetricalEconomy9v9AllUnitMap',
    'gate did not use the symmetrical all-unit 9x9 generator');
  check(smoke.config.requiredMap.unitTypes.length === 5,
    'gate did not record all required unit types');
  check(smoke.config.requiredMap.buildingTypes.includes('tower') &&
      smoke.config.requiredMap.buildingTypes.includes('bastion'),
    'gate did not record tower and bastion requirements');
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
    check(game.mapStage === 'symmetrical-9v9-all-unit',
      'game used the wrong map stage');
  }

  const reportPath = path.join(
    '/mnt',
    'storage',
    'diplomacy',
    'benchmarks',
    `task152-smoke-${process.pid}.json`);
  try {
    execFileSync(process.execPath, [
      'ai/benchmark-symmetrical-9x9-all-units-gate.js',
      '--games', '1',
      '--seed', '152010',
      '--round-limit', '40',
      '--sudden-death-round', '40',
      '--min-no-loss-rate', '0',
      '--min-win-rate', '0',
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
  } finally {
    if (fs.existsSync(reportPath)) {
      fs.unlinkSync(reportPath);
    }
  }

  console.log('TASK-152 symmetrical 9x9 all-units benchmark gate smoke passed');
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
