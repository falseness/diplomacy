// Test-only re-derivation of the co-op Circle retry sequence, shared by the stage
// suites: attempt 0 uses the seed, attempt k uses seed ^ imul(k, 0x9e3779b9), the
// same derivation as coopCircleAttemptSeed (ai/generateMap.js), and the first of
// eight attempts that builds wins. Random starts (TASK-334) can leave a seed with
// no fair expansion layout; generateCoopGame then moves on to the next attempt.
'use strict';
const CIRCLE_TEST_ATTEMPTS = 8;
const circleTestAttemptSeed = (seed, attempt) => attempt ? (seed ^ Math.imul(attempt, 0x9e3779b9)) >>> 0 : seed;

// build(attemptSeed) -> object; returns it with {attempt, attemptSeed}, or rethrows the last error.
function withCircleTestAttempts(seed, build) {
    const errors = [];
    for (let attempt = 0; attempt < CIRCLE_TEST_ATTEMPTS; attempt++) {
        const attemptSeed = circleTestAttemptSeed(seed, attempt);
        try { return {...build(attemptSeed), attempt, attemptSeed}; }
        catch (error) { errors.push(`${attempt}: ${error.message}`); }
    }
    throw new Error(`all ${CIRCLE_TEST_ATTEMPTS} attempts failed: ${errors.join(' | ')}`);
}

module.exports = {CIRCLE_TEST_ATTEMPTS, circleTestAttemptSeed, withCircleTestAttempts};
