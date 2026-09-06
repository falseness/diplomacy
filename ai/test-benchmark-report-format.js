const { buildReportFormatTestResult } = require('./benchmarkHarness');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Synthetic outcomes belong only in this report-format test. They never enter
// runGame/runBenchmark and must never be cited as evidence of AI play quality.
const report = buildReportFormatTestResult({
  playerA: 'SimpleAiPlayer',
  playerB: 'SimpleAiPlayer'
}, [{
  seed: 777,
  winnerSide: 'A',
  crash: false,
  timeout: false,
  nonResult: false
}, {
  seed: 778,
  winnerSide: null,
  crash: true,
  timeout: false,
  nonResult: true,
  message: 'simulated report-format crash'
}]);

assert(report.summary.crashCount === 1, 'simulated crash was not counted');
assert(report.crashes[0].seed === 778, 'simulated crash seed missing');
assert(report.crashes[0].reportFormatOnlySimulation === true,
  'simulated crash row was not labeled as report-format-only');
assert(report.summary.failedSeeds.includes(778), 'crash seed was not marked failed');
assert(report.summary.playerAWinRate === 0.5,
  'report accounting did not count the crashed attempt in the denominator');
assert(report.config.benchmarkPolicy === 'REPORT-FORMAT-TEST-ONLY-NOT-AI-QUALITY',
  'report-format simulation was not clearly labeled');

console.log('Report-format-only benchmark simulation passed (not AI quality evidence)');
