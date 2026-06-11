#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  enumerateGamestartMapCoverage
} = require('./gamestart-map-coverage');

const repoRoot = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT =
  '/mnt/storage/diplomacy/benchmarks/task055-simple-economy-gamestart.json';
const DEFAULT_FAILURE_DIR =
  '/mnt/storage/diplomacy/benchmarks/task055-simple-economy-failures';
const DEFAULT_FIRST_SEED = 55000;
const DEFAULT_SEEDS = 1;
const FORCED_SUDDEN_DEATH_ROUND = 500;

function usage() {
  return [
    'Usage: node ai/gamestart-simple-economy-completion.js [options]',
    '',
    'Options:',
    '  --seed NUMBER             First deterministic seed (default: ' + DEFAULT_FIRST_SEED + ')',
    '  --seeds NUMBER            Seeds per map (default: ' + DEFAULT_SEEDS + ')',
    '  --round-limit NUMBER      Max nextTurn calls per scenario (default: 500)',
    '  --output PATH             JSON report path',
    '  --failure-dir PATH        Directory for failure state JSON files',
    '  --map-limit NUMBER        Limit selected maps for smoke tests',
    '  --map-offset NUMBER       Skip maps before applying --map-limit',
    '  --player-group NAME       Select all maps for one player group, e.g. 1v1',
    '  --sample-player-groups CSV  Select the first map for each group, e.g. 1v1,3-player,4-player',
    '  --require-complete        Exit nonzero unless every selected game has a pre-sudden-death winner',
    '  --help                    Show this help'
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    seed: DEFAULT_FIRST_SEED,
    seeds: DEFAULT_SEEDS,
    roundLimit: FORCED_SUDDEN_DEATH_ROUND,
    output: DEFAULT_OUTPUT,
    failureDir: DEFAULT_FAILURE_DIR,
    mapLimit: undefined,
    mapOffset: 0,
    playerGroup: null,
    requireComplete: false,
    samplePlayerGroups: null
  };
  const names = {
    '--seed': 'seed',
    '--seeds': 'seeds',
    '--round-limit': 'roundLimit',
    '--output': 'output',
    '--failure-dir': 'failureDir',
    '--map-limit': 'mapLimit',
    '--map-offset': 'mapOffset',
    '--player-group': 'playerGroup',
    '--sample-player-groups': 'samplePlayerGroups'
  };
  for (let index = 0; index < argv.length; ++index) {
    const argument = argv[index];
    if (argument === '--help') {
      options.help = true;
      continue;
    }
    if (argument === '--require-complete') {
      options.requireComplete = true;
      continue;
    }
    const name = names[argument];
    if (!name || index + 1 >= argv.length) {
      throw new Error('Unknown or incomplete argument: ' + argument);
    }
    options[name] = argv[++index];
  }
  for (const name of ['seed', 'seeds', 'roundLimit', 'mapLimit', 'mapOffset']) {
    if (options[name] === undefined) {
      continue;
    }
    options[name] = Number(options[name]);
    if (!Number.isFinite(options[name])) {
      throw new Error(name + ' must be numeric');
    }
  }
  if (!Number.isInteger(options.seed)) {
    throw new Error('seed must be an integer');
  }
  if (!Number.isInteger(options.seeds) || options.seeds <= 0) {
    throw new Error('seeds must be a positive integer');
  }
  if (!Number.isInteger(options.roundLimit) || options.roundLimit <= 0) {
    throw new Error('round-limit must be a positive integer');
  }
  if (options.mapLimit !== undefined &&
      (!Number.isInteger(options.mapLimit) || options.mapLimit <= 0)) {
    throw new Error('map-limit must be a positive integer');
  }
  if (!Number.isInteger(options.mapOffset) || options.mapOffset < 0) {
    throw new Error('map-offset must be a non-negative integer');
  }
  if (options.samplePlayerGroups) {
    options.samplePlayerGroups = options.samplePlayerGroups
      .split(',')
      .map(group => group.trim())
      .filter(Boolean);
    if (!options.samplePlayerGroups.length) {
      throw new Error('sample-player-groups must include at least one group');
    }
  }
  if (options.playerGroup !== null && String(options.playerGroup).trim() === '') {
    throw new Error('player-group must not be empty');
  }
  return options;
}

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function createCanvasContext() {
  return new Proxy({
    canvas: { width: 800, height: 600 },
    measureText(text) {
      return { width: String(text).length * 8 };
    }
  }, {
    get(target, property) {
      return property in target ? target[property] : function() {};
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    }
  });
}

function createCanvas() {
  return {
    width: 800,
    height: 600,
    clientWidth: 800,
    clientHeight: 600,
    style: {},
    getContext() {
      return createCanvasContext();
    },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 600 };
    }
  };
}

function createRuntimeContext(seed) {
  const storage = {};
  const seededMath = Object.create(Math);
  let randomState = seed >>> 0;
  seededMath.random = function() {
    randomState = (randomState * 1664525 + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };

  const context = {
    console: Object.assign({}, console, { log() {} }),
    Math: seededMath,
    Date,
    JSON,
    Array,
    Object,
    Number,
    String,
    Boolean,
    Error,
    TypeError,
    Map,
    Set,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    Infinity,
    NaN,
    setTimeout,
    clearTimeout,
    requestAnimationFrame() { return 0; },
    cancelAnimationFrame() {},
    Image: class Image {},
    navigator: { userAgent: 'node' },
    innerWidth: 800,
    innerHeight: 600,
    document: {
      createElement() { return createCanvas(); },
      getElementById() { return createCanvas(); },
      querySelector() { return createCanvas(); },
      addEventListener() {}
    },
    localStorage: {
      setItem(key, value) { storage[key] = String(value); },
      getItem(key) { return storage[key] || null; },
      removeItem(key) { delete storage[key]; }
    },
    io() { return {}; },
    tf: {
      loadLayersModel() {
        throw new Error('SimpleAiPlayerWithEconomy completion harness must not load a model');
      }
    },
    saveAs() {}
  };
  context.window = context;
  context.globalThis = context;
  return vm.createContext(context);
}

function loadBrowserScripts(context) {
  const html = readRepoFile('index.html');
  const scriptPattern = /<script[^>]+src=['"]([^'"]+)['"]/g;
  let match;
  while ((match = scriptPattern.exec(html))) {
    const source = match[1];
    if (/^https?:/.test(source)) {
      continue;
    }
    new vm.Script(readRepoFile(source), { filename: source }).runInContext(context);
  }
}

function disableHeadlessBorderDrawing(context) {
  new vm.Script(`(() => {
    class HeadlessBorder {
      constructor() {
        this.lines = []
        this.visible = false
      }
      clean() {
        this.lines = []
      }
      isCleaned() {
        return true
      }
      createLine() {}
      newBrokenLine() {
        this.clean()
        this.visible = false
      }
      draw() {}
    }
    Border = HeadlessBorder
    border = new HeadlessBorder()
    attackBorder = new HeadlessBorder()
  })()`, { filename: 'task055-headless-border.js' }).runInContext(context);
}

function selectMaps(coverage, options) {
  let maps = coverage.maps.slice();
  if (options.playerGroup) {
    maps = maps.filter(candidate => candidate.playerGroup === options.playerGroup);
    if (!maps.length) {
      throw new Error('No gamestart maps found for player group ' + options.playerGroup);
    }
  }
  maps = maps.slice(options.mapOffset);
  if (options.samplePlayerGroups) {
    const selected = [];
    for (const group of options.samplePlayerGroups) {
      const entry = maps.find(candidate => candidate.playerGroup === group);
      if (!entry) {
        throw new Error('No gamestart map found for player group ' + group);
      }
      selected.push(entry);
    }
    maps = selected;
  }
  if (options.mapLimit) {
    maps = maps.slice(0, options.mapLimit);
  }
  return maps;
}

function safeFilePart(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, '-');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function runRuntimeScenario(mapEntry, seed, options) {
  const context = createRuntimeContext(seed);
  loadBrowserScripts(context);
  disableHeadlessBorderDrawing(context);
  context.__task055MapEntry = mapEntry;
  context.__task055Seed = seed;
  context.__task055RoundLimit = options.roundLimit;
  context.__task055ForcedSuddenDeathRound = FORCED_SUDDEN_DEATH_ROUND;
  return new vm.Script(`(() => {
    isFogOfWar = false
    gameSettings.testAI = true
    gameSettings.isOnline = false
    entityInterface = {change() {}, hide() {}}
    townInterface = {change() {}, hide() {}}
    barrackInterface = {change() {}, hide() {}}
    statisticsInterface = {}
    gameEvent = {
      nextTurn() {},
      selected: new Empty(),
      hideAll() {},
      removeSelection() { this.selected = new Empty() },
      screen: {moveTo() {}, moveToPlayer() {}, stop() {}}
    }
    nextTurnButton = {
      setNextPlayerColor() {},
      highlightButton: false,
      enableClick() {},
      disableClick() {}
    }
    nextTurnPauseInterface = {visible: false}
    saveManager = {save() {}}
    AiRuntime.trainFromHumanCommands = function() {}
    border = new Border()
    attackBorder = new Border()
    let manager = {
      clearValues() {
        external = []
        externalProduction = []
        nature = []
        goldmines = []
        gameRound = 0
        gameExit = false
      }
    }
    let map = __task055MapEntry.sourceType == 'standalone-factory' ?
      globalThis[__task055MapEntry.sourceName]() :
      maps[__task055MapEntry.groupName][__task055MapEntry.variantIndex]
    for (let index = 1; index < map.players.length; ++index) {
      map.players[index].playerType = 'SimpleAiPlayerWithEconomy'
    }
    map.suddenDeathRound = __task055ForcedSuddenDeathRound
    map.start(manager, false)
    suddenDeathRound = __task055ForcedSuddenDeathRound
    whooseTurn = 0

    function activeNonNeutralPlayers() {
      return players.slice(1).filter(function(player) {
        return !player.isLost
      })
    }
    let turnCount = 0
    while (turnCount < __task055RoundLimit &&
        gameRound < suddenDeathRound &&
        activeNonNeutralPlayers().length > 1) {
      nextTurn()
      ++turnCount
    }
    let activePlayers = activeNonNeutralPlayers()
    let winner = activePlayers.length == 1 ? players.indexOf(activePlayers[0]) : null
    let runtimePlayers = players.slice(1).map(function(player, index) {
      return {
        side: index + 1,
        type: player.constructor.name,
        lost: player.isLost,
        gold: player.gold,
        income: player.income,
        towns: player.towns.filter(function(town) { return !town.killed }).length,
        units: player.units.filter(function(unit) { return !unit.killed }).length,
        townCoords: player.towns.filter(function(town) {
          return !town.killed
        }).map(function(town) {
          return {x: town.coord.x, y: town.coord.y}
        }),
        unitCoords: player.units.filter(function(unit) {
          return !unit.killed
        }).map(function(unit) {
          return {
            type: unit.constructor.name,
            x: unit.coord.x,
            y: unit.coord.y,
            moves: unit.moves
          }
        })
      }
    })
    return {
      mapName: __task055MapEntry.name,
      groupName: __task055MapEntry.groupName,
      variantIndex: __task055MapEntry.variantIndex,
      sourceType: __task055MapEntry.sourceType,
      sourceName: __task055MapEntry.sourceName,
      playerGroup: __task055MapEntry.playerGroup,
      playerCount: __task055MapEntry.nonNeutralPlayerCount,
      seed: __task055Seed,
      winner,
      roundCount: gameRound,
      turnCount,
      crash: null,
      timeout: winner == null && turnCount >= __task055RoundLimit,
      suddenDeath: winner == null && gameRound >= suddenDeathRound,
      suddenDeathRound,
      forcedSuddenDeathRound: __task055ForcedSuddenDeathRound,
      runtimeLoop: 'GameMap.start + nextTurn',
      requiredPlayerClass: 'SimpleAiPlayerWithEconomy',
      allNonNeutralPlayersUseRequiredClass: runtimePlayers.every(function(player) {
        return player.type == 'SimpleAiPlayerWithEconomy'
      }),
      players: runtimePlayers
    }
  })()`, { filename: 'task055-runtime-scenario.js' }).runInContext(context);
}

function conciseGame(game) {
  const copy = Object.assign({}, game);
  if (copy.winner !== null && !copy.timeout && !copy.suddenDeath) {
    copy.players = copy.players.map(player => {
      const playerCopy = Object.assign({}, player);
      delete playerCopy.townCoords;
      delete playerCopy.unitCoords;
      return playerCopy;
    });
  }
  return copy;
}

function summarize(games, crashes) {
  return {
    attemptedScenarios: games.length + crashes.length,
    completedScenarios: games.filter(game => game.winner !== null).length,
    winners: games.filter(game => game.winner !== null).length,
    nonResults: games.filter(game => game.winner === null).length,
    timeouts: games.filter(game => game.timeout).length,
    suddenDeathNonResults: games.filter(game => game.suddenDeath).length,
    crashes: crashes.length,
    requiredClassMismatches: games.filter(game =>
      !game.allNonNeutralPlayersUseRequiredClass
    ).length
  };
}

function runHarness(options) {
  const coverage = enumerateGamestartMapCoverage();
  const maps = selectMaps(coverage, options);
  const games = [];
  const crashes = [];
  let nextSeed = options.seed;

  for (const mapEntry of maps) {
    for (let seedIndex = 0; seedIndex < options.seeds; ++seedIndex) {
      const seed = nextSeed++;
      try {
        const game = runRuntimeScenario(mapEntry, seed, options);
        games.push(game);
        console.error(
          'TASK-055 scenario ' + (games.length + crashes.length) + ': ' +
          game.mapName + ' seed ' + seed + ' winner=' + game.winner +
          ' round=' + game.roundCount + ' timeout=' + game.timeout
        );
        if (game.winner === null || game.timeout || game.suddenDeath ||
            !game.allNonNeutralPlayersUseRequiredClass) {
          const failurePath = path.join(
            options.failureDir,
            safeFilePart(game.mapName) + '-seed-' + seed + '.json'
          );
          game.failurePath = failurePath;
          writeJson(failurePath, game);
        }
      } catch (error) {
        const crash = {
          mapName: mapEntry.name,
          groupName: mapEntry.groupName,
          variantIndex: mapEntry.variantIndex,
          playerGroup: mapEntry.playerGroup,
          playerCount: mapEntry.nonNeutralPlayerCount,
          seed,
          winner: null,
          roundCount: null,
          crash: {
            message: error.message,
            stack: error.stack
          },
          timeout: false,
          suddenDeath: false,
          suddenDeathRound: FORCED_SUDDEN_DEATH_ROUND,
          forcedSuddenDeathRound: FORCED_SUDDEN_DEATH_ROUND,
          runtimeLoop: 'GameMap.start + nextTurn',
          requiredPlayerClass: 'SimpleAiPlayerWithEconomy'
        };
        const failurePath = path.join(
          options.failureDir,
          safeFilePart(mapEntry.name) + '-seed-' + seed + '-crash.json'
        );
        crash.failurePath = failurePath;
        writeJson(failurePath, crash);
        crashes.push(crash);
        console.error(
          'TASK-055 crash ' + (games.length + crashes.length) + ': ' +
          mapEntry.name + ' seed ' + seed + ' message=' + error.message
        );
      }
    }
  }

  const summary = summarize(games, crashes);
  const report = {
    config: {
      seed: options.seed,
      seedsPerMap: options.seeds,
      roundLimit: options.roundLimit,
      forcedSuddenDeathRound: FORCED_SUDDEN_DEATH_ROUND,
      mapOffset: options.mapOffset,
      mapLimit: options.mapLimit,
      playerGroup: options.playerGroup,
      requireComplete: options.requireComplete,
      samplePlayerGroups: options.samplePlayerGroups
    },
    mapCoverage: {
      source: coverage.source,
      totalMaps: coverage.totalMaps,
      selectedMaps: maps.map(map => ({
        name: map.name,
        groupName: map.groupName,
        variantIndex: map.variantIndex,
        playerGroup: map.playerGroup,
        playerCount: map.nonNeutralPlayerCount,
        sourceType: map.sourceType,
        sourceName: map.sourceName
      }))
    },
    benchmarkPolicy:
      'real runtime GameMap.start and nextTurn with all non-neutral players set to SimpleAiPlayerWithEconomy',
    summary,
    failedGames: games.filter(game =>
      game.winner === null ||
      game.timeout ||
      game.suddenDeath ||
      !game.allNonNeutralPlayersUseRequiredClass
    ),
    crashes,
    games: games.map(conciseGame)
  };
  writeJson(options.output, report);
  return report;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const report = runHarness(options);
  console.log(JSON.stringify(report.summary));
  console.log('Simple economy gamestart report: ' + path.resolve(options.output));
  if (report.summary.crashes > 0 || report.summary.requiredClassMismatches > 0 ||
      (options.requireComplete && report.summary.nonResults > 0)) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

module.exports = {
  FORCED_SUDDEN_DEATH_ROUND,
  parseArgs,
  runHarness,
  runRuntimeScenario,
  selectMaps
};
