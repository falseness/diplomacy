const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadCheckpoint } = require('./benchmark-gamestart-trained-model');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function checkTrainingEvidenceReport() {
  const checkpoint = await loadCheckpoint(
    '/mnt/storage/diplomacy/checkpoints/task045-replay-corrected/step-00000005'
  );
  try {
    assert(
      checkpoint.report.trainingEvidence &&
        checkpoint.report.trainingEvidence.dataSource === 'real-runtime-self-play',
      'trained checkpoint evidence was not reported'
    );
    assert(
      checkpoint.report.trainingEvidence.plateau &&
        checkpoint.report.trainingEvidence.plateau.evidence === true,
      'trained checkpoint plateau evidence was not reported'
    );
    assert(
      checkpoint.report.trainingEvidence.progression &&
        checkpoint.report.trainingEvidence.progression.status ===
          'historical-only-not-used-as-current-run-evidence',
      'historical progression was not isolated from current-run evidence'
    );
    assert(checkpoint.report.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256)),
      'checkpoint hashes were not reported');
  } finally {
    checkpoint.model.dispose();
  }
}

async function main() {
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'diplomacy-task037-'));
const reportPath = path.join(temporary, 'report.json');
const tasksPath = path.join(temporary, 'tasks.json');
fs.writeFileSync(tasksPath, JSON.stringify([
  {
    id: 'TASK-037',
    category: 'test',
    priority: 'critical',
    description: 'Benchmark AIPlayerWithEconomy against SimpleAiPlayerWithEconomy.',
    acceptance_criteria: [],
    test_steps: [],
    status: 'pending'
  }
], null, 2) + '\n');

const command = [
  path.join(__dirname, 'benchmark-gamestart-trained-model.js'),
  '--checkpoint',
  '/mnt/storage/diplomacy/task036-incremental-long/final/task036-long',
  '--seeds',
  '1',
  '--round-limit',
  '1',
  '--map-limit',
  '1',
  '--output',
  reportPath,
  '--failure-dir',
  path.join(temporary, 'failures'),
  '--tasks',
  tasksPath
];
const run = spawnSync(process.execPath, command, {
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20
});
assert(run.status === 1, 'limited benchmark should fail the 100 percent threshold');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
assert(report.mapCoverage.oneVOneMaps.length > 0, 'no 1v1 gamestart maps were covered');
assert(
  report.mapCoverage.oneVOneMaps.every(map => map.category !== 'generated'),
  'benchmark must not inject generated maps into gamestart coverage'
);
assert(
  report.mapCoverage.oneVOneMaps.some(map => map.name === 'open field #1'),
  'real gamestart map coverage was not reported'
);
assert(report.summary.attemptedGames > 0, 'benchmark did not attempt games');
assert(report.summary.skippedMultiplayerMaps > 0, 'multiplayer map skips were not reported');
assert(report.checkpoint.signature.inputs[0][3] === 78, 'checkpoint signature was not recorded');
assert(
  report.checkpoint.gameplayInference.positions > 0,
  'checkpoint-backed prediction path was not exercised'
);
assert(report.summary.nonWins > 0, 'non-wins were not counted');
assert(report.failedGames.length + report.crashes.length > 0, 'non-wins were not retained');
assert(report.repository.commit, 'repository commit was not recorded');
assert(report.invocation.argv.some(value =>
  /benchmark-gamestart-trained-model\.js$/.test(value)),
  'exact benchmark invocation was not recorded');
assert(report.games.every(game => game.terminationReason),
  'termination reasons were not reported');
assert(report.games.every(game => game.exactClassAssignment),
  'runtime class assignment was not exact');
assert(report.games.every(game => game.candidateWon ===
  (game.exactClassAssignment && game.genuineOpponentElimination)),
  'candidate wins were not restricted to exact-class genuine eliminations');
assert(report.summary.candidateWinRate ===
  report.summary.candidateWins / report.summary.attemptedGames,
  'win rate did not count every attempted game');
assert(report.seedEvidence.intersections.trainingTest.length === 0,
  'training and test seeds overlap');
const updatedTasks = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
assert(updatedTasks.length === 2, 'follow-up ticket was not created');
assert(updatedTasks[1].status === 'pending', 'follow-up ticket must be pending');

await checkTrainingEvidenceReport();

console.log('Gamestart trained benchmark smoke passed');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
