const fs = require('fs');
const path = require('path');
const {
  generatedCombatGameMap
} = require('./benchmark-combat-model');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function check(condition, message, details) {
  if (condition) {
    return;
  }
  const suffix = details ? ': ' + JSON.stringify(details, null, 2) : '';
  throw new Error(message + suffix);
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function extractBlock(source, marker) {
  const start = source.indexOf(marker);
  check(start !== -1, 'missing source marker ' + marker);
  const brace = source.indexOf('{', start);
  check(brace !== -1, 'missing opening brace for ' + marker);
  let depth = 0;
  for (let index = brace; index < source.length; ++index) {
    if (source[index] === '{') {
      ++depth;
    }
    else if (source[index] === '}') {
      --depth;
      if (depth === 0) {
        return source.slice(brace + 1, index);
      }
    }
  }
  throw new Error('unterminated block for ' + marker);
}

function extractFunction(source, name) {
  const declaration = 'function ' + name + '(';
  return extractBlock(source, declaration);
}

function extractClass(source, className) {
  return extractBlock(source, 'class ' + className);
}

function extractNewGameMapSetup(source) {
  const start = source.indexOf('let map = new GameMap(');
  check(start !== -1, 'missing benchmark GameMap setup');
  const end = source.indexOf('map.suddenDeathRound', start);
  check(end !== -1, 'missing benchmark suddenDeathRound assignment');
  return source.slice(start, end);
}

function conditionalHeaders(source) {
  const headers = [];
  const pattern = /\b(?:if|else\s+if)\s*\(([^)]*)\)/g;
  let match;
  while ((match = pattern.exec(source))) {
    headers.push(match[1]);
  }
  return headers;
}

function assertNoGridSizeBranches(aiPlayerSource) {
  const headers = conditionalHeaders(aiPlayerSource);
  const offenders = headers.filter(function(header) {
    return /grid\s*\.\s*arr\s*(?:\[\s*0\s*\])?\s*\.\s*length/.test(header);
  });
  check(offenders.length === 0,
    'AIPlayer contains ad-hoc grid.arr length comparison branches',
    offenders);

  const ternaryLines = aiPlayerSource.split('\n').filter(function(line) {
    return /grid\s*\.\s*arr\s*(?:\[\s*0\s*\])?\s*\.\s*length/.test(line) &&
      /\?/.test(line);
  });
  check(ternaryLines.length === 0,
    'AIPlayer contains ad-hoc grid.arr length ternaries',
    ternaryLines);
}

function assertNoSimpleComparisonLogic(aiPlayerSource) {
  const forbidden = [
    /\bSimpleAiPlayer\b/,
    /\bSimpleAiPlayerWithEconomy\b/,
    /\bbenchmark\b/i,
    /\bcurriculumSimpleWinrate\b/,
    /\bbaseline\b/i,
    /\bcandidate\b/i,
    /\bsimpleHandicap\b/,
    /\bcandidateGoldBonus\b/,
    /\bartificialAdvantage\b/
  ];
  const offenders = forbidden.filter(function(pattern) {
    return pattern.test(aiPlayerSource);
  }).map(String);
  check(offenders.length === 0,
    'AIPlayer contains SimpleAiPlayer-comparison-specific logic',
    offenders);
}

function methodSummaries(classSource) {
  const summaries = [];
  const source = stripComments(classSource);
  const methodPattern = /(^|\n)\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
  let match;
  while ((match = methodPattern.exec(source))) {
    const name = match[2];
    const bodyStart = source.indexOf('{', match.index);
    let depth = 0;
    for (let index = bodyStart; index < source.length; ++index) {
      if (source[index] === '{') {
        ++depth;
      }
      else if (source[index] === '}') {
        --depth;
        if (depth === 0) {
          const body = source.slice(bodyStart + 1, index);
          summaries.push({
            name: name,
            lines: body.split('\n').filter(function(line) {
              return line.trim();
            }).length,
            body: body
          });
          methodPattern.lastIndex = index + 1;
          break;
        }
      }
    }
  }
  return summaries;
}

function assertAiPlayerMethodsStaySimple(aiPlayerSource) {
  const methods = methodSummaries(aiPlayerSource);
  check(methods.length >= 10, 'AIPlayer method parser found too few methods');

  const longMethods = methods.filter(function(method) {
    return method.lines > 80;
  }).map(function(method) {
    return { name: method.name, lines: method.lines };
  });
  check(longMethods.length === 0,
    'AIPlayer methods are too large for the no-cheating comparison boundary',
    longMethods);

  const getWinningChances = methods.filter(function(method) {
    return method.name === 'getWinningChances';
  })[0];
  check(getWinningChances && /\bpredict\s*\(\s*ai_model\s*,\s*vectorisedGrids\s*\)/.test(getWinningChances.body),
    'AIPlayer.getWinningChances must delegate scoring to model inference');

  const selectBestCommand = methods.filter(function(method) {
    return method.name === 'selectBestCommand';
  })[0];
  check(selectBestCommand &&
      /scoreActionCommandsWithFastVectorGrid\s*\(/.test(selectBestCommand.body),
    'AIPlayer.selectBestCommand must score candidates through the model-scoring path');
  check(!/grid\s*\.\s*arr\s*(?:\[\s*0\s*\])?\s*\.\s*length/.test(selectBestCommand.body),
    'AIPlayer.selectBestCommand must not branch on map dimensions');
}

function assertBenchmarkSetupIsFair(source, label) {
  const setup = extractNewGameMapSetup(source);
  const forbiddenSetupPatterns = [
    { pattern: /\bgold\s*:/, label: 'gold override' },
    { pattern: /\bhp\s*:/, label: 'hp override' },
    { pattern: /\.gold\s*=/, label: 'gold mutation' },
    { pattern: /\.hp\s*=/, label: 'hp mutation' },
    { pattern: /\.units\s*\.push\s*\(/, label: 'unit injection' },
    { pattern: /candidateGoldBonus|simpleHandicap|artificialAdvantage/,
      label: 'named artificial advantage hook' }
  ];
  const offenders = forbiddenSetupPatterns.filter(function(entry) {
    return entry.pattern.test(setup);
  }).map(function(entry) {
    return entry.label;
  });
  check(offenders.length === 0,
    label + ' benchmark setup grants artificial resources, units, or HP',
    offenders);
  check(/\bwhooseTurn\s*=\s*0\b/.test(source),
    label + ' benchmark must start from the normal neutral turn handoff');
}

function assertBalancedCandidateStarts(source) {
  check(/function\s+gameCandidateSide\s*\([^)]*\)\s*\{[\s\S]*?index\s*<\s*options\.games\s*\/\s*2\s*\?\s*'A'\s*:\s*'B'/.test(source),
    'trained benchmark must balance candidate starts across both sides');
  check(/games\s*%\s*2\s*!==\s*0/.test(source),
    'trained benchmark must reject odd game counts');
  check(/candidateStarts\s*:\s*\{[\s\S]*?A\s*:\s*gamesPerSide[\s\S]*?B\s*:\s*gamesPerSide/.test(source),
    'trained benchmark must report balanced candidate starts');
}

function assertGeneratedCombatMapsAreSymmetric() {
  for (let seed = 1050; seed < 1056; ++seed) {
    const map = generatedCombatGameMap(seed, 'task105-guard');
    check(map.players.length === 3,
      'generated combat benchmark must use neutral plus two players');
    const left = map.players[1];
    const right = map.players[2];
    check(left.units.length === right.units.length,
      'generated combat benchmark gives one side extra units', {
        seed: seed,
        leftUnits: left.units.length,
        rightUnits: right.units.length
      });
    check(!('gold' in left) && !('gold' in right),
      'generated combat benchmark gives one side configured gold', seed);
    check(left.units.every(function(unit) { return !('hp' in unit); }) &&
        right.units.every(function(unit) { return !('hp' in unit); }),
      'generated combat benchmark gives one side configured unit HP', seed);
  }
}

function assertNoForcedSimpleConcessions(sources) {
  const combined = sources.join('\n');
  check(!/\bSimpleAiPlayer(?:WithEconomy)?\b[\s\S]{0,300}\bconcede\s*\(/.test(combined),
    'benchmark setup forces SimpleAiPlayer concessions');
}

function auditSources(sources) {
  const playersSource = sources.playersSource;
  const baseAiPlayer = extractClass(playersSource, 'AIPlayer');
  assertNoGridSizeBranches(baseAiPlayer);
  assertNoSimpleComparisonLogic(baseAiPlayer);
  assertAiPlayerMethodsStaySimple(baseAiPlayer);

  assertBenchmarkSetupIsFair(
    sources.trainedBenchmarkSource,
    'benchmark-trained-model');
  assertBenchmarkSetupIsFair(
    sources.benchmarkHarnessSource,
    'benchmarkHarness');
  assertBalancedCandidateStarts(sources.trainedBenchmarkSource);
  assertNoForcedSimpleConcessions([
    sources.trainedBenchmarkSource,
    sources.combatBenchmarkSource,
    sources.benchmarkHarnessSource
  ]);
  assertGeneratedCombatMapsAreSymmetric();

  return {
    checkedFiles: [
      'ai/players.js',
      'ai/benchmark-trained-model.js',
      'ai/benchmark-combat-model.js',
      'ai/benchmarkHarness.js'
    ],
    command: 'npm run test-no-cheating-guard'
  };
}

function loadSources() {
  return {
    playersSource: read('ai/players.js'),
    trainedBenchmarkSource: read('ai/benchmark-trained-model.js'),
    combatBenchmarkSource: read('ai/benchmark-combat-model.js'),
    benchmarkHarnessSource: read('ai/benchmarkHarness.js')
  };
}

function expectAuditFailure(label, sources, expectedPattern) {
  let failed = false;
  try {
    auditSources(sources);
  } catch (error) {
    failed = true;
    check(expectedPattern.test(error.message),
      'fixture failed for the wrong reason: ' + label,
      { message: error.message });
  }
  check(failed, 'fixture did not fail guard: ' + label);
}

function runSelfTest(cleanSources) {
  const gridBranch = Object.assign({}, cleanSources, {
    playersSource: cleanSources.playersSource.replace(
      'class AIPlayer extends Player {',
      'class AIPlayer extends Player {\n    forbiddenGridBranch() {\n        if (grid.arr.length === 21 || grid.arr[0].length === 21) return true\n        return false\n    }\n'
    )
  });
  expectAuditFailure('AIPlayer grid-size branch', gridBranch, /grid\.arr length/);

  const comparisonLogic = Object.assign({}, cleanSources, {
    playersSource: cleanSources.playersSource.replace(
      'class AIPlayer extends Player {',
      'class AIPlayer extends Player {\n    forbiddenSimpleComparison(opponent) {\n        if (opponent instanceof SimpleAiPlayer) return 1\n        return 0\n    }\n'
    )
  });
  expectAuditFailure(
    'AIPlayer SimpleAiPlayer comparison logic',
    comparisonLogic,
    /SimpleAiPlayer-comparison-specific/);

  const artificialGold = Object.assign({}, cleanSources, {
    trainedBenchmarkSource: cleanSources.trainedBenchmarkSource.replace(
      'playerType: __candidateSide == \'A\' ? __candidateClass : __baselineClass',
      'gold: 999,\n          playerType: __candidateSide == \'A\' ? __candidateClass : __baselineClass'
    )
  });
  expectAuditFailure(
    'candidate artificial gold',
    artificialGold,
    /artificial resources/);

  const artificialTurn = Object.assign({}, cleanSources, {
    trainedBenchmarkSource: cleanSources.trainedBenchmarkSource.replace(
      'whooseTurn = 0',
      'whooseTurn = 1'
    )
  });
  expectAuditFailure(
    'candidate turn-order advantage',
    artificialTurn,
    /neutral turn handoff/);

  const forcedConcession = Object.assign({}, cleanSources, {
    combatBenchmarkSource: cleanSources.combatBenchmarkSource +
      '\nfunction forbidden(simple) { if (simple instanceof SimpleAiPlayer) simple.concede() }\n'
  });
  expectAuditFailure(
    'forced SimpleAiPlayer concession',
    forcedConcession,
    /concessions/);
}

const cleanSources = loadSources();
const report = auditSources(cleanSources);
runSelfTest(cleanSources);

console.log('No-cheating guard passed');
console.log(JSON.stringify(report));
