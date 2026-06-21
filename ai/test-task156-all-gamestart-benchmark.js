const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  enumerateGamestartMapCoverage
} = require('./gamestart-map-coverage');

const repoRoot = path.resolve(__dirname, '..');

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    if (details) {
      error.details = details;
    }
    throw error;
  }
}

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function extractBlock(source, marker) {
  const start = source.indexOf(marker);
  assert(start !== -1, 'missing source marker ' + marker);
  const brace = source.indexOf('{', start);
  assert(brace !== -1, 'missing opening brace for ' + marker);
  let depth = 0;
  for (let index = brace; index < source.length; ++index) {
    if (source[index] === '{') {
      ++depth;
    } else if (source[index] === '}') {
      --depth;
      if (depth === 0) {
        return source.slice(brace + 1, index);
      }
    }
  }
  throw new Error('unterminated source block for ' + marker);
}

function assertNoTask156ComparisonShortcuts() {
  const playersSource = readRepoFile('ai/players.js');
  const economyPlayerSource = extractBlock(
    playersSource, 'class AIPlayerWithEconomy');
  const benchmarkSource = readRepoFile('ai/benchmark-gamestart-all-slots.js');
  const runtimeScenarioSource = extractBlock(
    benchmarkSource, 'function runRuntimeScenario');

  const forbiddenPlayerPatterns = [
    { pattern: /grid\s*\.\s*arr\s*\.\s*length\s*(?:={2,3}|[<>]=?)\s*\d+/, label: 'grid width special case' },
    { pattern: /grid\s*\.\s*arr\s*\[\s*0\s*\]\s*\.\s*length\s*(?:={2,3}|[<>]=?)\s*\d+/, label: 'grid height special case' },
    { pattern: /open field|tiny economy|strategic war|rush or defend|two rivers|tower defense/i, label: 'gamestart map-name branch' },
    { pattern: /candidateGoldBonus|simpleHandicap|artificialAdvantage/i, label: 'named artificial advantage hook' },
    { pattern: /isClosedNoObjectiveDuel|hasBalancedResourceTerrain|hasMixedTerrainObstacles|hasGoldmineObjectives|startedWithNeutralTowns/, label: 'comparison-shaped objective branch' }
  ];
  const playerOffenders = forbiddenPlayerPatterns.filter(entry =>
    entry.pattern.test(economyPlayerSource)).map(entry => entry.label);
  assert(
    playerOffenders.length === 0,
    'AIPlayerWithEconomy contains TASK-156 comparison shortcuts',
    playerOffenders
  );

  const forbiddenRuntimePatterns = [
    { pattern: /\.concede\s*\(/, label: 'forced player concession' },
    { pattern: /\.gold\s*[+\-*/]?=/, label: 'runtime gold mutation' },
    { pattern: /\.hp\s*[+\-*/]?=/, label: 'runtime HP mutation' },
    { pattern: /\.units\s*\.push\s*\(/, label: 'runtime unit injection' },
    { pattern: /candidateGoldBonus|simpleHandicap|artificialAdvantage/i, label: 'named artificial advantage hook' }
  ];
  const runtimeOffenders = forbiddenRuntimePatterns.filter(entry =>
    entry.pattern.test(runtimeScenarioSource)).map(entry => entry.label);
  assert(
    runtimeOffenders.length === 0,
    'TASK-156 benchmark grants an artificial comparison advantage',
    runtimeOffenders
  );

  const modelSource = readRepoFile('ai/model.js');
  const modelOffenders = [
    { pattern: /open field|tiny economy|strategic war|rush or defend|two rivers|tower defense/i, label: 'gamestart map-name branch' },
    { pattern: /grid\s*\.\s*arr\s*\.\s*length\s*(?:={2,3}|[<>]=?)\s*\d+/, label: 'grid width special case' },
    { pattern: /grid\s*\.\s*arr\s*\[\s*0\s*\]\s*\.\s*length\s*(?:={2,3}|[<>]=?)\s*\d+/, label: 'grid height special case' },
    { pattern: /candidateGoldBonus|simpleHandicap|artificialAdvantage/i, label: 'named artificial advantage hook' }
  ].filter(entry => entry.pattern.test(modelSource)).map(entry => entry.label);
  assert(
    modelOffenders.length === 0,
    'TASK-156 model-side objective policy contains comparison shortcuts',
    modelOffenders
  );
}

assertNoTask156ComparisonShortcuts();

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'diplomacy-task156-'));
const reportPath = path.join(temporary, 'report.json');
const failureDir = path.join(temporary, 'failures');
const command = [
  path.join(__dirname, 'benchmark-gamestart-all-slots.js'),
  '--candidate-slot-policy', 'task156',
  '--sudden-death', '500',
  '--map-offset', '18',
  '--map-limit', '1',
  '--seeds', '1',
  '--seed', '156022',
  '--round-limit', '1200',
  '--output', reportPath,
  '--failure-dir', failureDir
];
const run = spawnSync(process.execPath, command, {
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 40
});
if (run.status !== 0) {
  process.stdout.write(run.stdout || '');
  process.stderr.write(run.stderr || '');
}
assert(run.status === 0, 'TASK-156 benchmark smoke failed');
assert(fs.existsSync(reportPath), 'TASK-156 smoke report was not written');

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const coverage = enumerateGamestartMapCoverage();
assert(
  report.config.candidateSlotPolicy === 'task156',
  'TASK-156 candidate slot policy was not recorded'
);
assert(report.config.suddenDeathRound === 500, 'TASK-156 sudden-death bound changed');
assert(
  report.mapCoverage.totalMaps === coverage.totalMaps,
  'report did not record full gamestart map count'
);
assert(report.mapCoverage.selectedMaps.length === 1, 'smoke selected wrong map count');

let expectedGames = 0;
for (const map of report.mapCoverage.selectedMaps) {
  if (map.playerCount === 2) {
    assert(
      map.candidateSlots.length === 2 &&
        map.candidateSlots[0] === 1 &&
        map.candidateSlots[1] === 2,
      '1v1 maps should evaluate both candidate sides when practical',
      map
    );
  } else {
    assert(
      map.candidateSlots.length === 1 &&
        map.candidateSlots[0] === Math.ceil(map.playerCount / 2),
      'multiplayer maps should evaluate exactly one middle candidate slot',
      map
    );
  }
  expectedGames += map.candidateSlots.length;
}
assert(report.mapCoverage.expectedGames === expectedGames, 'expected game count mismatch');
assert(report.summary.attemptedGames === expectedGames, 'attempted game count mismatch');
assert(report.summary.nonWins === 0, 'TASK-156 smoke should pass tiny economy', report.summary);
assert(report.summary.candidateWinRate === 1, 'tiny economy candidate win rate changed');
assert(report.summary.classAssignmentFailures === 0, 'runtime class assignment failed');
assert(
  report.checkpoint.gameplayInference.positions > 0,
  'checkpoint-backed AIPlayerWithEconomy inference was not exercised'
);

for (const game of report.games) {
  const candidates = game.players.filter(player =>
    player.type === 'AIPlayerWithEconomy');
  const opponents = game.players.filter(player =>
    player.type === 'SimpleAiPlayerWithEconomy');
  assert(candidates.length === 1, 'expected exactly one AIPlayerWithEconomy', game);
  assert(candidates[0].side === game.candidateSlot, 'candidate side mismatch', game);
  assert(opponents.length === game.playerCount - 1, 'opponent count mismatch', game);
  if (game.playerCount >= 3) {
    assert(
      game.candidateSlot === Math.ceil(game.playerCount / 2),
      'multiplayer candidate slot did not follow TASK-156 policy',
      game
    );
  }
  assert(game.mapName === 'tiny economy ai duel', 'smoke should focus the standalone tiny economy duel');
  assert(game.candidateWon === true, 'tiny economy should pass for each candidate side', game);
}

console.log(
  'TASK-156 tiny-economy win smoke passed: ' +
    report.summary.candidateWins + '/' + report.summary.attemptedGames +
    ' candidate wins recorded'
);
