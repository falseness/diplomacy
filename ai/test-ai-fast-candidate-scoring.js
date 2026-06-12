const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

function methodBody(source, methodName) {
  const marker = methodName + '(';
  const start = source.indexOf(marker);
  check(start !== -1, 'missing method ' + methodName);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; ++i) {
    if (source[i] === '{') {
      ++depth;
    }
    else if (source[i] === '}') {
      --depth;
      if (depth === 0) {
        return source.slice(brace + 1, i);
      }
    }
  }
  throw new Error('unterminated method ' + methodName);
}

const playersSource = read('ai/players.js');
const fastScoringBody = methodBody(
  playersSource,
  'scoreActionCommandsWithFastVectorGrid'
);
check((fastScoringBody.match(/vectoriseGrid\s*\(/g) || []).length === 1,
  'fast candidate scoring should seed from exactly one vectoriseGrid call');
check(fastScoringBody.includes('createMutableVectorGrid(baselineVectorGrid)'),
  'fast candidate scoring does not create one mutable grid from a fresh vector');
check(fastScoringBody.includes('applyFastAction(mutableGrid, commands[i])'),
  'fast candidate scoring does not use fast apply');
check(fastScoringBody.includes('undoFastAction(mutableGrid, applied)'),
  'fast candidate scoring does not use fast undo');
for (const methodName of [
  'selectBestCommand',
  'getBestActionCommand',
  'applyModelRankedImmediateAttack'
]) {
  const body = methodBody(playersSource, methodName);
  check(!/vectoriseGrid\s*\(/.test(body),
    methodName + ' should not rebuild full vectors inside candidate scoring');
}

function createContext() {
  const undoStack = [];
  const state = {
    score: 0,
    vectoriseCalls: 0,
    normalApplications: 0
  };
  const cells = {};

  function cell(x, y) {
    const key = x + ':' + y;
    if (!cells[key]) {
      cells[key] = {
        coord: { x, y },
        unit: null,
        building: null
      };
    }
    return cells[key];
  }

  const unit = {
    killed: false,
    moves: 1,
    coord: { x: 0, y: 0 },
    isMyTurn: true,
    playerColor: 1,
    getAvailableCommands() {
      return [
        {
          type: 'unit',
          whoDoCommandCoord: { x: 0, y: 0 },
          destinationCoord: { x: 0, y: 1 }
        },
        {
          type: 'unit',
          whoDoCommandCoord: { x: 0, y: 0 },
          destinationCoord: { x: 0, y: 2 }
        }
      ];
    },
    select() {},
    sendInstructions(destination) {
      undoStack.push({
        score: state.score,
        moves: this.moves,
        normalApplications: state.normalApplications
      });
      state.score = destination.coord.y;
      state.normalApplications += 1;
      this.moves = 0;
    },
    skipMoves() {
      undoStack.push({
        score: state.score,
        moves: this.moves,
        normalApplications: state.normalApplications
      });
      state.score = 0;
      state.normalApplications += 1;
      this.moves = 0;
    }
  };
  cell(0, 0).unit = unit;
  cell(0, 1);
  cell(0, 2);

  function makeVector() {
    const vector = Array(78).fill(0);
    vector[0] = state.score;
    vector[1] = state.normalApplications;
    return vector;
  }

  const context = {
    console,
    Math,
    JSON,
    state,
    unit,
    ai_model: {},
    whooseTurn: 1,
    gameSettings: { testAI: false, aiCommandLimit: 20 },
    production: {},
    Player: class Player {
      constructor(color, gold = 90) {
        this.color = color;
        this.gold = gold;
        this.units = [];
        this.towns = [];
      }
      nextTurn() {}
      updateUnits() {}
    },
    BestEnemyTargetForAI: class BestEnemyTargetForAI {},
    assert(condition) {
      if (!condition) {
        throw new Error('assertion failed');
      }
    },
    areCoordsEqual(left, right) {
      return left.x === right.x && left.y === right.y;
    },
    vectorizeCell: makeVector,
    vectoriseGrid() {
      state.vectoriseCalls += 1;
      return [[
        [makeVector(cell(0, 0)),
          makeVector(cell(0, 1)),
          makeVector(cell(0, 2))]
      ], 0];
    },
    predict(model, inputs) {
      return inputs.map(input => [input[0][0][0][0]]);
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
      }
    },
    grid: {
      arr: [[cell(0, 0), cell(0, 1), cell(0, 2)]],
      getCell(coord) {
        return cell(coord.x, coord.y);
      }
    }
  };
  context.window = context;
  context.globalThis = context;
  return vm.createContext(context);
}

function runScenario(className, selectorName) {
  const context = createContext();
  new vm.Script(read('ai/mutableVectorGrid.js'), {
    filename: 'ai/mutableVectorGrid.js'
  }).runInContext(context);
  new vm.Script(playersSource, {
    filename: 'ai/players.js'
  }).runInContext(context);

  return new vm.Script(`
    state.vectoriseCalls = 0
    state.score = 0
    state.normalApplications = 0
    unit.moves = 1
    let player = new ${className}({ r: 255, g: 0, b: 0 }, 90)
    player.units = [unit]
    players = [null, player, { isNeutral: false, isLost: false, units: [], towns: [] }]
    let beforeApplications = state.normalApplications
    let selected = player.${selectorName}()
    let command = Array.isArray(selected) ? selected[0] : selected
    let chance = Array.isArray(selected) ? selected[1] : null
    let afterScoring = {
      vectoriseCalls: state.vectoriseCalls,
      score: state.score,
      normalApplications: state.normalApplications,
      appliedFastActions: typeof createMutableVectorGrid == 'function'
    }
    let appliedNormally = player.applyActionCommand ?
      player.applyActionCommand(command) :
      applyLiveAiCommandUnit(player, command)
    ;({
      className: '${className}',
      selectorName: '${selectorName}',
      selectedDestinationY: command.destinationCoord.y,
      chance: chance,
      afterScoring: afterScoring,
      appliedNormally: appliedNormally,
      finalScore: state.score,
      finalApplications: state.normalApplications,
      scoringApplications: afterScoring.normalApplications - beforeApplications
    })
  `, { filename: 'ai-fast-candidate-scoring-scenario.js' }).runInContext(context);
}

const baseResult = runScenario('AIPlayer', 'selectBestCommand');
const economyResult = runScenario('AIPlayerWithEconomy', 'getBestActionCommand');

for (const result of [baseResult, economyResult]) {
  check(result.selectedDestinationY === 2,
    'model scoring did not choose the highest-scored command', result);
  check(result.afterScoring.vectoriseCalls === 1,
    'candidate scoring should call vectoriseGrid exactly once', result);
  check(result.afterScoring.score === 0,
    'candidate scoring did not restore authoritative state', result);
  check(result.scoringApplications === 0,
    'normal trial actions were not undone during scoring', result);
  check(result.appliedNormally,
    'selected command did not apply through the normal action path', result);
  check(result.finalScore === 2,
    'selected command did not mutate real state through normal action logic',
    result);
  check(result.finalApplications === 1,
    'selected command was not applied exactly once after scoring', result);
}

console.log('AI fast candidate scoring smoke passed');
