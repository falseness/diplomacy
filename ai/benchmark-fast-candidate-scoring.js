const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function numericArg(index, fallback) {
  const value = Number(process.argv[index]);
  return Number.isFinite(value) ? value : fallback;
}

const iterations = numericArg(2, 200);
const candidateCount = numericArg(3, 120);
const width = numericArg(4, 40);
const height = numericArg(5, 40);
const repeats = numericArg(6, 3);

function createContext() {
  const undoStack = [];
  const state = {
    score: 0,
    normalApplications: 0,
    vectoriseCalls: 0,
    vectorizeCellCalls: 0
  };
  const cells = new Array(width);
  for (let x = 0; x < width; ++x) {
    cells[x] = new Array(height);
    for (let y = 0; y < height; ++y) {
      cells[x][y] = {
        coord: {x, y},
        playerColor: 0,
        hexagon: {neighbours: []},
        unit: {isEmpty() { return true; }},
        building: {isEmpty() { return true; }, isTown() { return false; }}
      };
    }
  }
  const unit = {
    coord: {x: 0, y: 0},
    moves: 1,
    hp: 10,
    killed: false,
    isEmpty() { return false; },
    getAvailableCommands() { return []; }
  };
  cells[0][0].unit = unit;
  cells[0][0].playerColor = 1;

  function makeVector(cell) {
    state.vectorizeCellCalls += 1;
    const vector = Array(78).fill(0);
    vector[0] = cell.coord.x / width;
    vector[1] = cell.coord.y / height;
    vector[2] = cell.unit && !cell.unit.isEmpty() ? 1 : 0;
    vector[3] = state.score;
    vector[4] = state.normalApplications;
    return vector;
  }

  const context = {
    console: {log() {}, error: console.error},
    Math,
    JSON,
    Array,
    Object,
    Number,
    String,
    Boolean,
    Error,
    TypeError,
    process: {hrtime: process.hrtime},
    state,
    undoStack,
    unit,
    ai_model: {},
    whooseTurn: 1,
    gameSettings: {aiCommandLimit: candidateCount},
    production: {},
    players: [],
    assert(condition) {
      if (!condition) {
        throw new Error('assertion failed');
      }
    },
    Player: class Player {
      constructor(color, gold) {
        this.color = color;
        this.gold = gold || 90;
        this.units = [];
        this.towns = [];
      }
      nextTurn() {}
      updateUnits() {}
    },
    BestEnemyTargetForAI: class BestEnemyTargetForAI {},
    vectorizeCell: makeVector,
    vectoriseGrid() {
      state.vectoriseCalls += 1;
      const result = new Array(width);
      for (let x = 0; x < width; ++x) {
        result[x] = new Array(height);
        for (let y = 0; y < height; ++y) {
          result[x][y] = makeVector(cells[x][y]);
        }
      }
      return [result, 0];
    },
    predict(model, inputs) {
      return inputs.map(input => [input[0][0][0][3]]);
    },
    actionManager: {
      undo() {
        const snapshot = undoStack.pop();
        if (!snapshot) {
          throw new Error('missing undo snapshot');
        }
        state.score = snapshot.score;
        state.normalApplications = snapshot.normalApplications;
        unit.moves = snapshot.moves;
        unit.coord = {x: 0, y: 0};
      }
    },
    grid: {
      arr: cells,
      getCell(coord) {
        return cells[coord.x][coord.y];
      }
    }
  };
  context.window = context;
  context.globalThis = context;
  return vm.createContext(context);
}

function runOnce() {
  const context = createContext();
  new vm.Script(read('ai/mutableVectorGrid.js'), {
    filename: 'ai/mutableVectorGrid.js'
  }).runInContext(context);
  new vm.Script(read('ai/players.js'), {
    filename: 'ai/players.js'
  }).runInContext(context);

  return new vm.Script(`
    const player = new AIPlayer({r: 255, g: 0, b: 0}, 90);
    player.units = [unit];
    players = [null, player, {isNeutral: false, isLost: false, units: [], towns: []}];
    const commands = [];
    for (let i = 0; i < ${candidateCount}; ++i) {
      commands.push({
        type: 'unit',
        whoDoCommandCoord: {x: 0, y: 0},
        destinationCoord: {x: 0, y: (i % (${height} - 1)) + 1}
      });
    }
    const started = process.hrtime.bigint();
    for (let i = 0; i < ${iterations}; ++i) {
      const scored = player.scoreActionCommandsWithFastVectorGrid(
        commands,
        function(command) {
          undoStack.push({
            score: state.score,
            moves: unit.moves,
            normalApplications: state.normalApplications
          });
          state.score = command.destinationCoord.y;
          state.normalApplications += 1;
          unit.moves = 0;
          unit.coord = {
            x: command.destinationCoord.x,
            y: command.destinationCoord.y
          };
          return true;
        });
      if (scored.commands.length !== commands.length) {
        throw new Error('unexpected scored command count ' + scored.commands.length);
      }
    }
    Number(process.hrtime.bigint() - started) / 1e9;
  `, {filename: 'benchmark-fast-candidate-scoring-run.js'}).runInContext(context);
}

const times = [];
for (let repeat = 0; repeat < repeats; ++repeat) {
  times.push(runOnce());
}
const sorted = times.slice().sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
console.log(JSON.stringify({
  command: `node ai/benchmark-fast-candidate-scoring.js ${iterations} ${candidateCount} ${width} ${height} ${repeats}`,
  iterations,
  candidateCount,
  width,
  height,
  repeats,
  times,
  median
}, null, 2));
