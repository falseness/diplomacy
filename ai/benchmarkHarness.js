const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadPlayerClasses() {
  const context = vm.createContext({
    console,
    Math,
    Player: class Player {
      constructor(color, gold = 90) {
        this.color = color;
        this.gold = gold;
        this.units = [];
      }
    },
    BestEnemyTargetForAI: class BestEnemyTargetForAI {},
    assert(condition) {
      if (!condition) {
        throw new Error('assertion failed');
      }
    },
    gameSettings: { testAI: false }
  });
  const source = fs.readFileSync(path.join(__dirname, 'players.js'), 'utf8');
  new vm.Script(source, { filename: 'ai/players.js' }).runInContext(context);
  return new vm.Script(`({
    SimpleAiPlayer,
    SimpleAiPlayerWithEconomy,
    AIPlayer,
    AIPlayerWithEconomy
  })`).runInContext(context);
}

const PLAYER_CLASSES = loadPlayerClasses();

const BENCHMARK_MAPS = {
  'tiny-duel': {
    width: 9,
    height: 7,
    suddenDeathRound: 16,
    blocked: [{ x: 4, y: 2 }, { x: 4, y: 4 }],
    players: [
      {
        town: { x: 1, y: 3 },
        units: [{ x: 2, y: 2 }, { x: 2, y: 4 }]
      },
      {
        town: { x: 7, y: 3 },
        units: [{ x: 6, y: 2 }, { x: 6, y: 4 }]
      }
    ]
  },
  'big-open-field': {
    width: 21,
    height: 21,
    suddenDeathRound: 45,
    blocked: [
      { x: 10, y: 7 },
      { x: 10, y: 8 },
      { x: 10, y: 12 },
      { x: 10, y: 13 }
    ],
    players: [
      {
        town: { x: 3, y: 10 },
        units: [{ x: 4, y: 8 }, { x: 4, y: 10 }, { x: 4, y: 12 }]
      },
      {
        town: { x: 17, y: 10 },
        units: [{ x: 16, y: 8 }, { x: 16, y: 10 }, { x: 16, y: 12 }]
      }
    ]
  }
};

function createSeededRandom(seed) {
  let state = Number(seed) >>> 0;
  if (!state) {
    state = 0x9e3779b9;
  }
  return function random() {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function coordKey(coord) {
  return coord.x + ':' + coord.y;
}

function distance(left, right) {
  return Math.max(
    Math.abs(left.x - right.x),
    Math.abs(left.y - right.y),
    Math.abs((left.x + left.y) - (right.x + right.y))
  );
}

function neighbours(coord) {
  return [
    { x: coord.x + 1, y: coord.y },
    { x: coord.x - 1, y: coord.y },
    { x: coord.x, y: coord.y + 1 },
    { x: coord.x, y: coord.y - 1 },
    { x: coord.x + 1, y: coord.y - 1 },
    { x: coord.x - 1, y: coord.y + 1 }
  ];
}

function validatePlayerClass(playerClass) {
  if (!PLAYER_CLASSES[playerClass]) {
    throw new Error(
      'Unknown player class "' + playerClass + '". Expected one of: ' +
      Object.keys(PLAYER_CLASSES).join(', ')
    );
  }
}

function makePlayer(index, playerClass, definition) {
  const RuntimePlayerClass = PLAYER_CLASSES[playerClass];
  return {
    index,
    playerClass,
    runtimePlayer: new RuntimePlayerClass(
      index === 0 ? { r: 255, g: 0, b: 0 } : { r: 98, g: 168, b: 222 }
    ),
    town: {
      x: definition.town.x,
      y: definition.town.y,
      hp: 8
    },
    units: definition.units.map(function(unit, unitIndex) {
      return {
        id: index + '-' + unitIndex,
        x: unit.x,
        y: unit.y,
        hp: 3,
        attack: 1
      };
    })
  };
}

function isInside(map, coord) {
  return coord.x >= 0 && coord.y >= 0 &&
    coord.x < map.width && coord.y < map.height;
}

function occupiedKeys(state, ignoredUnit) {
  const occupied = new Set(state.map.blocked.map(coordKey));
  for (const player of state.players) {
    if (player.town.hp > 0) {
      occupied.add(coordKey(player.town));
    }
    for (const unit of player.units) {
      if (unit.hp > 0 && unit !== ignoredUnit) {
        occupied.add(coordKey(unit));
      }
    }
  }
  return occupied;
}

function livingUnits(player) {
  return player.units.filter(function(unit) {
    return unit.hp > 0;
  });
}

function chooseTarget(state, player, unit) {
  const enemy = state.players[1 - player.index];
  const targets = livingUnits(enemy).map(function(enemyUnit) {
    return {
      kind: 'unit',
      target: enemyUnit,
      distance: distance(unit, enemyUnit),
      key: coordKey(enemyUnit)
    };
  });
  if (enemy.town.hp > 0) {
    targets.push({
      kind: 'town',
      target: enemy.town,
      distance: distance(unit, enemy.town),
      key: coordKey(enemy.town)
    });
  }
  return player.runtimePlayer.chooseBenchmarkTarget(targets);
}

function chooseMove(state, unit, target) {
  const occupied = occupiedKeys(state, unit);
  const choices = neighbours(unit).filter(function(coord) {
    return isInside(state.map, coord) && !occupied.has(coordKey(coord));
  });
  choices.sort(function(left, right) {
    return distance(left, target) - distance(right, target) ||
      coordKey(left).localeCompare(coordKey(right));
  });
  return choices[0];
}

function takeUnitTurn(state, player, unit) {
  const targetChoice = chooseTarget(state, player, unit);
  if (!targetChoice) {
    return;
  }
  if (distance(unit, targetChoice.target) <= 1) {
    targetChoice.target.hp -= unit.attack;
    return;
  }
  const destination = chooseMove(state, unit, targetChoice.target);
  if (destination) {
    unit.x = destination.x;
    unit.y = destination.y;
  }
}

function applyEconomy(state, player) {
  if (player.town.hp <= 0 ||
      !player.runtimePlayer.shouldBenchmarkReinforce(
        state.round,
        livingUnits(player).length
      )) {
    return;
  }
  const occupied = occupiedKeys(state);
  const spawn = neighbours(player.town).find(function(coord) {
    return isInside(state.map, coord) && !occupied.has(coordKey(coord));
  });
  if (spawn) {
    player.units.push({
      id: player.index + '-reinforcement-' + state.round,
      x: spawn.x,
      y: spawn.y,
      hp: 3,
      attack: 1
    });
  }
}

function scorePlayer(player) {
  const unitScore = livingUnits(player).reduce(function(total, unit) {
    return total + unit.hp;
  }, 0);
  return unitScore + Math.max(0, player.town.hp) * 2;
}

function winnerIndex(state) {
  const alive = state.players.map(function(player) {
    return player.town.hp > 0 || livingUnits(player).length > 0;
  });
  if (alive[0] !== alive[1]) {
    return alive[0] ? 0 : 1;
  }
  return null;
}

function runGame(options) {
  const mapName = options.mapName || 'tiny-duel';
  const map = BENCHMARK_MAPS[mapName];
  if (!map) {
    throw new Error('Unknown benchmark map "' + mapName + '"');
  }
  validatePlayerClass(options.playerA);
  validatePlayerClass(options.playerB);

  const seed = Number(options.seed);
  const random = createSeededRandom(seed);
  const roundLimit = Number(options.roundLimit || 40);
  const state = {
    map: clone(map),
    players: [
      makePlayer(0, options.playerA, map.players[0]),
      makePlayer(1, options.playerB, map.players[1])
    ],
    round: 0
  };
  let winner = null;
  let suddenDeath = false;

  for (let round = 1; round <= roundLimit; ++round) {
    state.round = round;
    const firstPlayer = random() < 0.5 ? 0 : 1;
    for (let offset = 0; offset < 2; ++offset) {
      const player = state.players[(firstPlayer + offset) % 2];
      applyEconomy(state, player);
      const units = livingUnits(player).slice().sort(function(left, right) {
        return left.id.localeCompare(right.id);
      });
      for (const unit of units) {
        takeUnitTurn(state, player, unit);
        winner = winnerIndex(state);
        if (winner !== null) {
          break;
        }
      }
      if (winner !== null) {
        break;
      }
    }
    if (winner !== null) {
      break;
    }
    if (round >= map.suddenDeathRound) {
      suddenDeath = true;
      for (const player of state.players) {
        if (player.town.hp > 0) {
          player.town.hp -= 1;
        }
      }
      winner = winnerIndex(state);
      if (winner !== null) {
        break;
      }
    }
  }

  const timeout = winner === null;
  if (timeout) {
    const scores = state.players.map(scorePlayer);
    if (scores[0] !== scores[1]) {
      winner = scores[0] > scores[1] ? 0 : 1;
    }
  }

  return {
    winner: winner === null ? null : state.players[winner].playerClass,
    winnerSide: winner === null ? null : winner === 0 ? 'A' : 'B',
    roundCount: state.round,
    timeout,
    suddenDeath,
    mapName,
    playerA: options.playerA,
    playerB: options.playerB,
    runtimePlayerA: state.players[0].runtimePlayer.constructor.name,
    runtimePlayerB: state.players[1].runtimePlayer.constructor.name,
    seed
  };
}

function runBenchmark(options) {
  const repeat = Number(options.repeat || 1);
  const baseSeed = Number(options.seed || 1);
  if (!Number.isInteger(repeat) || repeat <= 0) {
    throw new Error('repeat must be a positive integer');
  }
  const games = [];
  for (let index = 0; index < repeat; ++index) {
    games.push(runGame({
      mapName: options.mapName,
      playerA: options.playerA,
      playerB: options.playerB,
      roundLimit: options.roundLimit,
      seed: baseSeed + index
    }));
  }
  const playerAWins = games.filter(function(game) {
    return game.winnerSide === 'A';
  }).length;
  const completedGames = games.filter(function(game) {
    return game.winnerSide !== null;
  }).length;
  return {
    config: {
      mapName: options.mapName || 'tiny-duel',
      playerA: options.playerA,
      playerB: options.playerB,
      seed: baseSeed,
      repeat,
      roundLimit: Number(options.roundLimit || 40)
    },
    summary: {
      games: games.length,
      completedGames,
      playerAWins,
      playerAWinRate: completedGames ? playerAWins / completedGames : 0,
      timeouts: games.filter(game => game.timeout).length,
      suddenDeathGames: games.filter(game => game.suddenDeath).length
    },
    games
  };
}

function writeResult(result, outputPath) {
  const absolutePath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, JSON.stringify(result, null, 2) + '\n');
  return absolutePath;
}

module.exports = {
  BENCHMARK_MAPS,
  PLAYER_CLASSES,
  runBenchmark,
  runGame,
  writeResult
};
