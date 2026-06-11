#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');
const GAMESTART_PATH = 'options/gamestart.js';
const VARIABLES_PATH = 'options/gameObjectVariables.js';

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function coordDictionary(pairs) {
  return pairs.map(([x, y]) => ({ x, y }));
}

function createGamestartContext() {
  class StubPlayer {}
  return vm.createContext({
    console,
    coordDictionary,
    Noob: class Noob {},
    Archer: class Archer {},
    KOHb: class KOHb {},
    Normchel: class Normchel {},
    Catapult: class Catapult {},
    Player: StubPlayer,
    NeutralPlayer: class NeutralPlayer extends StubPlayer {},
    SimpleAiPlayer: class SimpleAiPlayer extends StubPlayer {},
    SimpleAiPlayerWithEconomy: class SimpleAiPlayerWithEconomy extends StubPlayer {},
    AIPlayer: class AIPlayer extends StubPlayer {},
    AIPlayerWithEconomy: class AIPlayerWithEconomy extends StubPlayer {},
    assert(condition) {
      if (!condition) {
        throw new Error('assertion failed');
      }
    }
  });
}

function runtimeDefaultSuddenDeathRound() {
  const source = readRepoFile(VARIABLES_PATH);
  const match = source.match(/\blet\s+suddenDeathRound\s*=\s*(\d+)/);
  if (!match) {
    throw new Error('Unable to find runtime suddenDeathRound default');
  }
  return Number(match[1]);
}

function loadGamestartMaps() {
  const context = createGamestartContext();
  context.window = context;
  context.globalThis = context;
  new vm.Script(readRepoFile(GAMESTART_PATH), { filename: GAMESTART_PATH })
    .runInContext(context);
  if (!context.maps || typeof context.maps !== 'object') {
    throw new Error('options/gamestart.js did not define maps');
  }
  return context.maps;
}

function playerGroup(nonNeutralPlayerCount) {
  if (nonNeutralPlayerCount === 2) {
    return '1v1';
  }
  if (nonNeutralPlayerCount === 3) {
    return '3-player';
  }
  if (nonNeutralPlayerCount === 4) {
    return '4-player';
  }
  return nonNeutralPlayerCount + '-player';
}

function matchingBraceEnd(source, startIndex) {
  let depth = 0;
  for (let index = startIndex; index < source.length; ++index) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  throw new Error('Unable to find end of maps object');
}

function manualGamestartMapCount() {
  const source = readRepoFile(GAMESTART_PATH);
  const mapsStart = source.indexOf('maps = {');
  if (mapsStart < 0) {
    throw new Error('Unable to find maps object');
  }
  const braceStart = source.indexOf('{', mapsStart);
  const braceEnd = matchingBraceEnd(source, braceStart);
  const mapsSource = source.slice(braceStart, braceEnd + 1);
  const matches = mapsSource.match(/\bnew\s+GameMap\s*\(/g);
  return matches ? matches.length : 0;
}

function enumerateGamestartMapCoverage() {
  const maps = loadGamestartMaps();
  const defaultSuddenDeathRound = runtimeDefaultSuddenDeathRound();
  const entries = [];

  for (const groupName of Object.keys(maps)) {
    const variants = maps[groupName];
    for (let variantIndex = 0; variantIndex < variants.length; ++variantIndex) {
      const map = variants[variantIndex];
      const nonNeutralPlayerCount = map.players.length - 1;
      const configuredSuddenDeathRound = Number.isFinite(map.suddenDeathRound) ?
        map.suddenDeathRound : null;
      entries.push({
        groupName,
        variantIndex,
        name: groupName + ' #' + (variantIndex + 1),
        mapSize: {
          x: map.mapSize.x,
          y: map.mapSize.y
        },
        nonNeutralPlayerCount,
        playerGroup: playerGroup(nonNeutralPlayerCount),
        configuredSuddenDeathRound,
        suddenDeathRound: configuredSuddenDeathRound || defaultSuddenDeathRound,
        suddenDeathSource: configuredSuddenDeathRound ?
          'configured' : 'runtime-default'
      });
    }
  }

  const groups = Object.keys(maps).map(groupName => {
    const groupEntries = entries.filter(entry => entry.groupName === groupName);
    return {
      name: groupName,
      variantCount: groupEntries.length,
      playerGroups: Array.from(new Set(groupEntries.map(entry => entry.playerGroup)))
    };
  });

  return {
    source: GAMESTART_PATH,
    defaultSuddenDeathRound,
    totalMaps: entries.length,
    manualGameMapCount: manualGamestartMapCount(),
    groups,
    maps: entries
  };
}

function parseArgs(argv) {
  const options = { output: null, pretty: true };
  for (let index = 0; index < argv.length; ++index) {
    const argument = argv[index];
    if (argument === '--output') {
      if (index + 1 >= argv.length) {
        throw new Error('--output requires a path');
      }
      options.output = argv[++index];
    } else if (argument === '--compact') {
      options.pretty = false;
    } else if (argument === '--help') {
      options.help = true;
    } else {
      throw new Error('Unknown argument: ' + argument);
    }
  }
  return options;
}

function usage() {
  return [
    'Usage: node ai/gamestart-map-coverage.js [options]',
    '',
    'Options:',
    '  --output PATH  Save structured JSON coverage metadata',
    '  --compact      Print compact JSON instead of pretty JSON',
    '  --help         Show this help'
  ].join('\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const coverage = enumerateGamestartMapCoverage();
  if (coverage.totalMaps !== coverage.manualGameMapCount) {
    throw new Error(
      'Coverage count ' + coverage.totalMaps +
      ' does not match manual GameMap count ' + coverage.manualGameMapCount
    );
  }
  const json = JSON.stringify(coverage, null, options.pretty ? 2 : 0) + '\n';
  if (options.output) {
    fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
    fs.writeFileSync(options.output, json);
  } else {
    process.stdout.write(json);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  enumerateGamestartMapCoverage,
  loadGamestartMaps,
  manualGamestartMapCount,
  playerGroup,
  runtimeDefaultSuddenDeathRound
};
