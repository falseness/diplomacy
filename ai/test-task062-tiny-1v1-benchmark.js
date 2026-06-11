const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    if (details) {
      error.details = details;
    }
    throw error;
  }
}

const outputPath =
  '/mnt/storage/diplomacy/benchmarks/task062-tiny-1v1.json';
const failureDir =
  '/mnt/storage/diplomacy/benchmarks/task062-tiny-1v1-failures';

function removeDirectory(directory) {
  if (!fs.existsSync(directory)) {
    return;
  }
  for (const entry of fs.readdirSync(directory)) {
    const entryPath = path.join(directory, entry);
    if (fs.statSync(entryPath).isDirectory()) {
      removeDirectory(entryPath);
    } else {
      fs.unlinkSync(entryPath);
    }
  }
  fs.rmdirSync(directory);
}

removeDirectory(failureDir);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });

const command = [
  path.join(__dirname, 'benchmark-gamestart-trained-model.js'),
  '--map-offset', '1',
  '--map-limit', '1',
  '--seeds', '1',
  '--seed', '62000',
  '--round-limit', '1200',
  '--output', outputPath,
  '--failure-dir', failureDir,
  '--no-followups'
];

const run = spawnSync(process.execPath, command, {
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20
});

if (run.status !== 0) {
  process.stdout.write(run.stdout || '');
  process.stderr.write(run.stderr || '');
}
assert(run.status === 0, 'tiny 1v1 benchmark command failed');
assert(fs.existsSync(outputPath), 'tiny 1v1 benchmark report was not written');

const report = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
const coveredMaps = report.mapCoverage.oneVOneMaps.map(map => map.name);
assert(
  coveredMaps.length === 1 && coveredMaps[0] === 'tiny deathmatch #1',
  'tiny 1v1 benchmark covered the wrong map set',
  coveredMaps
);
assert(
  report.config.checkpoint ===
    '/mnt/storage/diplomacy/checkpoints/task045-replay-corrected/step-00000005',
  'benchmark did not load the current selected AIPlayerWithEconomy checkpoint',
  report.config
);
assert(report.config.seed === 62000, 'benchmark seed is not deterministic');
assert(report.summary.attemptedGames === 2, 'benchmark did not cover both candidate sides');
assert(report.summary.completedGames === 2, 'tiny games did not both complete');
assert(report.summary.candidateWins === 2, 'AIPlayerWithEconomy did not win both tiny games');
assert(report.summary.candidateWinRate === 1, 'candidate win rate was not 100 percent');
assert(report.summary.nonWins === 0, 'tiny benchmark produced non-wins');
assert(report.summary.losses === 0, 'tiny benchmark produced losses');
assert(report.summary.nonResults === 0, 'tiny benchmark produced non-results');
assert(report.summary.suddenDeathGames === 0, 'tiny benchmark reached sudden death');
assert(report.summary.timeouts === 0, 'tiny benchmark timed out');
assert(report.summary.crashes === 0, 'tiny benchmark crashed');

const sides = report.games.map(game => game.candidateSide).sort();
assert(
  JSON.stringify(sides) === JSON.stringify([1, 2]),
  'benchmark did not cover candidate sides 1 and 2',
  sides
);

for (const game of report.games) {
  const candidate = game.players.find(player => player.side === game.candidateSide);
  const opponent = game.players.find(player => player.side !== game.candidateSide);
  assert(candidate, 'candidate player was not reported', game);
  assert(opponent, 'opponent player was not reported', game);
  assert(
    candidate.type === 'AIPlayerWithEconomy',
    'candidate side did not use AIPlayerWithEconomy',
    game
  );
  assert(
    opponent.type === 'SimpleAiPlayerWithEconomy',
    'opponent side did not use SimpleAiPlayerWithEconomy',
    game
  );
  assert(game.candidateWon === true, 'candidate did not win tiny game', game);
}

assert(
  report.checkpoint.gameplayInference.positions > 0,
  'checkpoint-backed inference was not exercised'
);

console.log(
  'TASK-062 tiny 1v1 benchmark passed: ' +
    report.summary.candidateWins + '/' + report.summary.completedGames +
    ' candidate wins, report ' + outputPath
);
