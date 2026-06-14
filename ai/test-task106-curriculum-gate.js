const { curriculumGateDecision, initialCurriculumState } =
  require('./cloud-train-runner');

function check(condition, message, details) {
  if (condition) {
    return;
  }
  const suffix = details ? ': ' + JSON.stringify(details, null, 2) : '';
  throw new Error(message + suffix);
}

function gateFor(simpleAiPlayerWinrate, baselineAiPlayerWinrate) {
  return curriculumGateDecision(
    { curriculum: initialCurriculumState() },
    { status: 'plateau' },
    {
      evaluated: true,
      value: simpleAiPlayerWinrate,
      source: 'measured-model-vs-SimpleAiPlayer-benchmark',
      artificialAdvantage: false,
      benchmarkPolicy: 'real GameMap runtime with unchanged AIPlayer versus unchanged SimpleAiPlayer'
    },
    { attempted: true, improved: false },
    { curriculumSimpleWinrateThreshold: 0.8 },
    {
      evaluated: true,
      value: baselineAiPlayerWinrate,
      source: 'measured-model-vs-baseline-AIPlayer-benchmark',
      artificialAdvantage: false,
      benchmarkPolicy: 'real GameMap runtime with unchanged AIPlayer versus unchanged baseline AIPlayer'
    }
  );
}

const passingGate = gateFor(0.85, 0.85);
check(passingGate.requiredSimpleAiPlayerWinrate === 0.8,
  'passing gate did not carry the 80 percent threshold',
  passingGate);
check(passingGate.requiredBaselineAiPlayerWinrate === 0.8,
  'passing gate did not carry the 80 percent baseline AIPlayer threshold',
  passingGate);
check(passingGate.decision === 'advance' && passingGate.eligible === true,
  'above-80 SimpleAiPlayer and baseline AIPlayer winrates did not advance',
  passingGate);

const blockedGate = gateFor(0.79, 0.85);
check(blockedGate.requiredSimpleAiPlayerWinrate === 0.8,
  'blocked gate did not carry the 80 percent threshold',
  blockedGate);
check(blockedGate.decision === 'hold' && blockedGate.eligible === false,
  'below-80 SimpleAiPlayer winrate did not block advancement',
  blockedGate);
check(blockedGate.reason.includes('greater than 0.8'),
  'blocked gate did not record a clear 80 percent threshold reason',
  blockedGate);

const baselineBlockedGate = gateFor(0.85, 0.79);
check(baselineBlockedGate.requiredBaselineAiPlayerWinrate === 0.8,
  'baseline-blocked gate did not carry the 80 percent baseline threshold',
  baselineBlockedGate);
check(baselineBlockedGate.decision === 'hold' && baselineBlockedGate.eligible === false,
  'below-80 baseline AIPlayer winrate did not block advancement',
  baselineBlockedGate);
check(baselineBlockedGate.reason.includes('baseline AIPlayer winrate must be greater than 0.8'),
  'baseline-blocked gate did not record a clear 80 percent threshold reason',
  baselineBlockedGate);

console.log('TASK-106 curriculum gate smoke passed');
