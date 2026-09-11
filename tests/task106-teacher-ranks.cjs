const assert = require('assert/strict');

function verifyTeacherRanks(results) {
  let candidates = 0;
  let tiedCandidates = 0;
  for (const result of results) {
    const choices = new Map();
    for (const example of result.examples) {
      if (!choices.has(example.choiceSet)) choices.set(example.choiceSet, []);
      choices.get(example.choiceSet).push(example);
    }
    for (const examples of choices.values()) {
      const scores = examples.map(example => example.demonstrationScore)
        .sort((left, right) => left - right);
      for (const example of examples) {
        const legacyRank = scores.lastIndexOf(example.demonstrationScore);
        assert.equal(example.label, legacyRank);
        candidates += 1;
        if (scores.indexOf(example.demonstrationScore) !== legacyRank) {
          tiedCandidates += 1;
        }
      }
    }
  }
  assert(candidates > 0);
  assert(tiedCandidates > 0);
  console.log(`Legacy teacher rank parity passed: candidates=${candidates} tiedCandidates=${tiedCandidates}`);
}

module.exports = { verifyTeacherRanks };
