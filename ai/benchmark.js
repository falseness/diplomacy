#!/usr/bin/env node

const path = require('path');
const {
  BENCHMARK_MAPS,
  PLAYER_CLASSES,
  runBenchmark,
  writeResult
} = require('./benchmarkHarness');

function usage() {
  return [
    'Usage: node ai/benchmark.js [options]',
    '',
    'Options:',
    '  --player-a CLASS       First player class (default: SimpleAiPlayer)',
    '  --player-b CLASS       Second player class (default: SimpleAiPlayer)',
    '  --map NAME             Fixed benchmark map (default: tiny-duel)',
    '  --seed NUMBER          First deterministic seed (default: 1)',
    '  --repeat NUMBER        Number of games (default: 1)',
    '  --round-limit NUMBER   Maximum rounds per game (default: 40)',
    '  --min-win-rate NUMBER  Required player A win rate, from 0 to 1',
    '  --output PATH          JSON report path',
    '  --list                 List player classes and maps',
    '  --help                 Show this help'
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    playerA: 'SimpleAiPlayer',
    playerB: 'SimpleAiPlayer',
    mapName: 'tiny-duel',
    seed: 1,
    repeat: 1,
    roundLimit: 40,
    output: path.join('artifacts', 'benchmarks', 'benchmark.json')
  };
  const names = {
    '--player-a': 'playerA',
    '--player-b': 'playerB',
    '--map': 'mapName',
    '--seed': 'seed',
    '--repeat': 'repeat',
    '--round-limit': 'roundLimit',
    '--min-win-rate': 'minWinRate',
    '--output': 'output'
  };
  for (let index = 0; index < argv.length; ++index) {
    const argument = argv[index];
    if (argument === '--help' || argument === '--list') {
      options[argument.slice(2)] = true;
      continue;
    }
    const name = names[argument];
    if (!name || index + 1 >= argv.length) {
      throw new Error('Unknown or incomplete argument: ' + argument);
    }
    options[name] = argv[++index];
  }
  for (const name of ['seed', 'repeat', 'roundLimit', 'minWinRate']) {
    if (options[name] !== undefined) {
      options[name] = Number(options[name]);
      if (!Number.isFinite(options[name])) {
        throw new Error(name + ' must be numeric');
      }
    }
  }
  if (options.minWinRate !== undefined &&
      (options.minWinRate < 0 || options.minWinRate > 1)) {
    throw new Error('minWinRate must be between 0 and 1');
  }
  return options;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    if (options.list) {
      console.log('Player classes: ' + Object.keys(PLAYER_CLASSES).join(', '));
      console.log('Maps: ' + Object.keys(BENCHMARK_MAPS).join(', '));
      return;
    }
    const result = runBenchmark(options);
    const outputPath = writeResult(result, options.output);
    console.log(JSON.stringify(result.summary));
    console.log('Benchmark report: ' + outputPath);
    if (options.minWinRate !== undefined &&
        result.summary.playerAWinRate < options.minWinRate) {
      console.error(
        'Player A win rate ' + result.summary.playerAWinRate.toFixed(3) +
        ' is below required threshold ' + options.minWinRate.toFixed(3)
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

main();
