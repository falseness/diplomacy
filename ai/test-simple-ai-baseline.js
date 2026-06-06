const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, label) {
  if (!condition) {
    throw new Error(label || 'assertion failed');
  }
}

function createContext() {
  const context = {
    console,
    assert,
    Math,
    basis: {
      strokeWidth: 1,
      r: 4,
      hexHalfRectWithStrokeOffset: { width: 6, height: 6 }
    },
    document: {
      createElement() {
        return {
          getContext() {
            return {
              beginPath() {},
              moveTo() {},
              lineTo() {},
              fill() {},
              stroke() {},
              closePath() {},
              set fillStyle(value) {},
              set strokeStyle(value) {},
              set lineWidth(value) {}
            };
          }
        };
      }
    },
    rgbToHex(r, g, b) {
      return '#' + [r, g, b].map(value => value.toString(16).padStart(2, '0')).join('');
    },
    BestEnemyTargetForAI: class BestEnemyTargetForAI {
      GetCommandNearestToBestTarget(commands) {
        return commands.length ? commands[0] : null;
      }
    },
    gameSettings: { testAI: false },
    goldmines: [],
    external: [],
    externalProduction: [],
    nature: [],
    gameRound: 0,
    suddenDeathRound: 50,
    whooseTurn: 1,
    isFogOfWar: false,
    localStorage: { setItem() {} },
    unpacker: { setPlayerTimerByIndex() {} },
    LongTimer: class LongTimer {},
    Timer: class Timer {},
    STANDARTTIME: 60,
    requestAnimationFrame() {},
    createEvents() {},
    WIDTH: 800,
    HEIGHT: 600,
    mainCtx: { setTransform() {} },
    gameEvent: {
      screen: {
        stop() {},
        moveToPlayer() {}
      }
    },
    menu: { visible: false },
    canvas: {},
    gameSlot: 0,
    gameExit: false,
    coordDictionary(coords) {
      return coords.map(coord => ({ x: coord[0], y: coord[1] }));
    },
    startTurn() {},
    gameLoop() {},
    SetupServerCommunicationLogic() {},
    grid: null,
    players: [],
    Player: undefined,
    NeutralPlayer: undefined,
    AIPlayer: undefined,
    SimpleAiPlayer: undefined,
    Noob: class Noob {},
    Town: class Town {},
    Goldmine: class Goldmine {},
    Mountain: class Mountain {},
    Lake: class Lake {},
    Bush: class Bush {},
    Hill: class Hill {},
    Grid: class Grid {
      constructor(x, y, mapSize) {
        this.arr = [];
        for (let i = 0; i < mapSize.x; ++i) {
          this.arr[i] = [];
          for (let j = 0; j < mapSize.y; ++j) {
            this.arr[i][j] = {
              hexagon: { firstpaint() {} },
              unit: { isEmpty() { return true; } }
            };
          }
        }
        this.right = mapSize.x;
        this.bottom = mapSize.y;
      }
    }
  };
  return vm.createContext(context);
}

function loadGameApis() {
  const context = createContext();
  new vm.Script(read('player.js'), { filename: 'player.js' }).runInContext(context);
  new vm.Script(read('ai/players.js'), { filename: 'ai/players.js' }).runInContext(context);
  new vm.Script(read('options/gamestart.js'), { filename: 'options/gamestart.js' }).runInContext(context);
  return context;
}

function runScenario(seed) {
  const context = loadGameApis();
  return new vm.Script(`
    function makeCommand(fromX, fromY, toX, toY) {
      return {
        whoDoCommandCoord: { x: fromX, y: fromY },
        destinationCoord: { x: toX, y: toY }
      }
    }

    function makeUnit(id, behavior) {
      return {
        id: id,
        moves: 1,
        killed: false,
        coord: { x: behavior.x, y: behavior.y },
        playerColor: behavior.playerColor,
        actions: [],
        getAvailableCommands: function() {
          return behavior.commands
        },
        getAvailableMoveCommands: function() {
          return behavior.moveCommands
        },
        canHitSomethingOnCell: function(cell) {
          return !!cell.enemy
        },
        sendInstructions: function(cell) {
          this.actions.push(cell.name)
          this.coord = { x: cell.coord.x, y: cell.coord.y }
          this.moves = 0
          if (cell.enemy) {
            cell.enemy.hp -= 1
          }
        }
      }
    }

    grid = {
      arr: [
        [
          { name: 'start-a', coord: { x: 0, y: 0 } },
          { name: 'move-target', coord: { x: 0, y: 1 } }
        ],
        [
          { name: 'attack-target', coord: { x: 1, y: 0 }, enemy: { hp: 2 + ${seed} } },
          { name: 'start-b', coord: { x: 1, y: 1 } }
        ]
      ]
    }

    let simple = new SimpleAiPlayer({ r: 255, g: 0, b: 0 })
    let learned = new AIPlayer({ r: 98, g: 168, b: 222 })

    let attacker = makeUnit('attacker', {
      x: 0,
      y: 0,
      playerColor: 1,
      commands: [
        makeCommand(0, 0, 0, 1),
        makeCommand(0, 0, 1, 0)
      ],
      moveCommands: [makeCommand(0, 0, 0, 1)]
    })
    let mover = makeUnit('mover', {
      x: 1,
      y: 1,
      playerColor: 1,
      commands: [makeCommand(1, 1, 0, 1)],
      moveCommands: [makeCommand(1, 1, 0, 1)]
    })

    simple.units = [attacker, mover]
    simple.play()

    let baselineMap = new GameMap(
      { x: 2, y: 2 },
      [
        { rgb: { r: 208, g: 208, b: 208 }, towns: [] },
        { rgb: { r: 255, g: 0, b: 0 }, towns: [], playerType: 'simple-ai' },
        { rgb: { r: 98, g: 168, b: 222 }, towns: [], ai: true }
      ],
      [],
      [],
      []
    )

    ;({
      simpleIsBaseline: baselineMap.getPlayerType(baselineMap.players[1]) === SimpleAiPlayer,
      learnedStillSelectable: baselineMap.getPlayerType(baselineMap.players[2]) === AIPlayer && learned instanceof AIPlayer,
      simpleSeparateFromLearned: simple instanceof SimpleAiPlayer && !(simple instanceof AIPlayer),
      simpleGold: simple.gold,
      attackAction: attacker.actions[0],
      attackTargetHp: grid.arr[1][0].enemy.hp,
      moveAction: mover.actions[0]
    })
  `, { filename: 'simple-ai-baseline-scenario.js' }).runInContext(context);
}

const first = runScenario(7);
const second = runScenario(7);

assert(first.simpleIsBaseline, 'SimpleAiPlayer is selectable by playerType');
assert(first.learnedStillSelectable, 'AIPlayer remains separately selectable');
assert(first.simpleSeparateFromLearned, 'SimpleAiPlayer does not replace AIPlayer');
assert(first.simpleGold < 9999999999, 'SimpleAiPlayer should not depend on unlimited gold');
assert(first.attackAction === 'attack-target', 'SimpleAiPlayer should attack before moving');
assert(first.attackTargetHp === 8, 'SimpleAiPlayer should damage the attack target');
assert(first.moveAction === 'move-target', 'SimpleAiPlayer should move toward enemy target when no attack is available');
assert(JSON.stringify(first) === JSON.stringify(second), 'fixed-seed SimpleAiPlayer scenario is inconsistent');

console.log('SimpleAiPlayer baseline smoke passed');
