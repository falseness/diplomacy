const assert = require('assert/strict');
const fs = require('fs');

function verifyPretrainingOverlap(filename, workers, seed) {
  const events = fs.readFileSync(filename, 'utf8').trim().split('\n').map(JSON.parse);
  const fitStarts = events.filter(event => event.event === 'fit-start');
  const syntheticFit = fitStarts[0];
  assert.equal(syntheticFit.options.epochs, 20);
  assert.equal(syntheticFit.options.batchSize, 512);
  const syntheticEnd = events.find(event =>
    event.event === 'fit-result' && event.id === syntheticFit.id);
  assert.equal(syntheticEnd.epochs, 20);
  const starts = events.filter(event => event.event === 'start' &&
    event.scenario.inferenceSource === 'expert rollout with expert-ranked candidate labels' &&
    event.scenario.seed > seed + 50000 && event.scenario.seed <= seed + 50020);
  assert.equal(starts.length, 20);
  assert.equal(new Set(starts.map(event => event.scenario.seed)).size, 20);
  const teacherFit = fitStarts[1];
  assert.equal(teacherFit.options.epochs, 20);
  let overlaps = 0;
  for (const start of starts) {
    const end = events.find(event => event.event === 'result' && event.id === start.id);
    assert(end, `missing teacher result: ${start.id}`);
    assert(BigInt(end.monotonicNs) < BigInt(teacherFit.monotonicNs));
    assert.equal(start.threadId === 0, workers === 1);
    if (BigInt(start.monotonicNs) < BigInt(syntheticEnd.monotonicNs) &&
        BigInt(end.monotonicNs) > BigInt(syntheticFit.monotonicNs)) overlaps += 1;
  }
  assert(BigInt(syntheticEnd.monotonicNs) < BigInt(teacherFit.monotonicNs));
  assert.equal(overlaps > 0, workers > 1);
  console.log(`Pretraining overlap passed: workers=${workers} initialTeacherGames=20 ` +
    `overlappingGames=${overlaps} syntheticEpochs=20 teacherEpochs=20 events=${filename}`);
}

module.exports = { verifyPretrainingOverlap };
