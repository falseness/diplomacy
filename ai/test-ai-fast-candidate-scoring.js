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
  'scoring should only vectorise a standalone selector baseline');
check(fastScoringBody.includes('this.candidateScoringGrid ||'),
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
    undoStack,
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
      get lastAction() { return undoStack[undoStack.length - 1]; },
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

function runEconomyCategoryScenario() {
  const context = createContext();
  new vm.Script(read('ai/mutableVectorGrid.js'), {
    filename: 'ai/mutableVectorGrid.js'
  }).runInContext(context);
  new vm.Script(playersSource, {
    filename: 'ai/players.js'
  }).runInContext(context);

  return new vm.Script(`
    let originalApplyFastAction = applyFastAction
    let originalUndoFastAction = undoFastAction
    let fastAppliedCategories = []
    let fastUndoneCategories = []
    applyFastAction = function(mutableGrid, command) {
      fastAppliedCategories.push(command.category || command.type)
      return originalApplyFastAction(mutableGrid, command)
    }
    undoFastAction = function(mutableGrid, appliedAction) {
      fastUndoneCategories.push(appliedAction.category)
      return originalUndoFastAction(mutableGrid, appliedAction)
    }

    production = {
      noob: {
        cost: 10,
        production: { isUnitProduction: function() { return true } }
      },
      suburb: {
        cost: 20,
        production: { isUnitProduction: function() { return false } }
      },
      farm: {
        cost: 15,
        production: { isUnitProduction: function() { return false } }
      },
      barrack: {
        cost: 30,
        production: { isUnitProduction: function() { return false } }
      },
      tower: {
        cost: 35,
        production: { isUnitProduction: function() { return false } }
      }
    }

    state.vectoriseCalls = 0
    state.score = 0
    state.normalApplications = 0
    let player = new AIPlayerWithEconomy({ r: 255, g: 0, b: 0 }, 200)
    player.units = [unit]
    player.towns = []
    players = [null, player, { isNeutral: false, isLost: false, units: [], towns: [] }]

    let commands = [
      {
        type: 'unit',
        whoDoCommandCoord: { x: 0, y: 0 },
        destinationCoord: { x: 0, y: 1 }
      },
      {
        type: 'economy',
        category: 'unit-training',
        product: 'noob',
        producerCoord: { x: 0, y: 0 }
      },
      {
        type: 'economy',
        category: 'suburb-expansion',
        product: 'suburb',
        producerCoord: { x: 0, y: 0 },
        destinationCoord: { x: 0, y: 1 }
      },
      {
        type: 'economy',
        category: 'building-placement',
        product: 'farm',
        producerCoord: { x: 0, y: 0 },
        destinationCoord: { x: 0, y: 1 }
      },
      {
        type: 'economy',
        category: 'building-placement',
        product: 'barrack',
        producerCoord: { x: 0, y: 0 },
        destinationCoord: { x: 0, y: 1 }
      },
      {
        type: 'economy',
        category: 'building-placement',
        product: 'tower',
        producerCoord: { x: 0, y: 0 },
        destinationCoord: { x: 0, y: 1 }
      }
    ]
    let scoreByCategory = {
      unit: 1,
      'unit-training': 2,
      'suburb-expansion': 3,
      'noob': 2,
      'suburb': 3,
      'farm': 4,
      'barrack': 5,
      'tower': 6
    }
    let normalCategories = []
    let scored = player.scoreActionCommandsWithFastVectorGrid(
      commands,
      function(command) {
        let category = command.category || command.type
        let key = command.product || category
        undoStack.push({
          score: state.score,
          moves: unit.moves,
          normalApplications: state.normalApplications
        })
        state.score = scoreByCategory[key]
        state.normalApplications += 1
        if (category == 'unit') {
          unit.moves = 0
        }
        normalCategories.push(category + ':' + (command.product || 'command'))
        return true
      })
    ;({
      vectoriseCalls: state.vectoriseCalls,
      score: state.score,
      normalApplications: state.normalApplications,
      validCount: scored.commands.length,
      chanceValues: scored.chances.slice(),
      fastAppliedCategories: fastAppliedCategories,
      fastUndoneCategories: fastUndoneCategories,
      normalCategories: normalCategories
    })
  `, { filename: 'ai-fast-candidate-economy-categories.js' }).runInContext(context);
}

const economyCategoryResult = runEconomyCategoryScenario();
check(economyCategoryResult.vectoriseCalls === 1,
  'AIPlayerWithEconomy economy-category scoring should seed one vector grid',
  economyCategoryResult);
check(economyCategoryResult.score === 0 &&
    economyCategoryResult.normalApplications === 0,
  'AIPlayerWithEconomy economy-category scoring did not undo normal trials',
  economyCategoryResult);
check(economyCategoryResult.validCount === 6,
  'AIPlayerWithEconomy economy-category scoring skipped candidates',
  economyCategoryResult);
for (const category of [
  'unit',
  'unit-training',
  'suburb-expansion',
  'building-placement'
]) {
  check(economyCategoryResult.fastAppliedCategories.includes(category),
    'AIPlayerWithEconomy did not fast-apply category ' + category,
    economyCategoryResult);
  check(economyCategoryResult.fastUndoneCategories.includes(category),
    'AIPlayerWithEconomy did not fast-undo category ' + category,
    economyCategoryResult);
}
for (const product of ['farm', 'barrack', 'tower']) {
  check(economyCategoryResult.normalCategories.includes(
      'building-placement:' + product),
    'AIPlayerWithEconomy did not score building product ' + product,
    economyCategoryResult);
}

function runWholeTurnScenario(throwDuringPrediction = false, className = 'AIPlayer') {
  const context = createContext();
  new vm.Script(read('ai/mutableVectorGrid.js')).runInContext(context);
  new vm.Script(playersSource).runInContext(context);
  context.throwDuringPrediction = throwDuringPrediction;
  const result = new vm.Script(`
    let player = new ${className}({r: 255, g: 0, b: 0}, 90)
    player.units = [unit]
    players = [null, player, {isNeutral: false, isLost: false, units: [], towns: []}]
    // Two legal actions from the same unit require multiple selector calls.
    unit.moves = 2
    let originalSend = unit.sendInstructions
    unit.sendInstructions = function(destination) {
      let moves = this.moves
      if (moves === 1 && destination.coord.y === 1) return
      originalSend.call(this, destination)
      this.moves = moves - 1
    }
    let grids = new Set()
    let apply = applyFastAction
    let applies = 0
    let undoes = 0
    let undo = undoFastAction
    applyFastAction = function(mutable, command) {
      grids.add(mutable)
      ++applies
      return apply(mutable, command)
    }
    undoFastAction = function(mutable, action) {
      ++undoes
      return undo(mutable, action)
    }
    let prediction = predict
    predict = function(model, inputs) {
      if (throwDuringPrediction) throw new Error('prediction control')
      return prediction(model, inputs)
    }
    let error = null
    try { player.${className === 'AIPlayer' ? 'doActions' : 'doLearnedCombatOnlyActions'}() } catch (caught) { error = caught.message }
    let firstTurn = {
      className: '${className}',
      vectoriseCalls: state.vectoriseCalls,
      gridCount: grids.size, applies, undoes,
      normalApplications: state.normalApplications,
      history: player.chosenGrids.map(value => value[0][0][0].slice(0, 2)),
      cacheCleared: player.candidateScoringGrid === null, error
    }
    if (!throwDuringPrediction) {
      unit.moves = 2
      player.${className === 'AIPlayer' ? 'doActions' : 'doLearnedCombatOnlyActions'}()
    }
    ;({firstTurn, totalGrids: grids.size, totalVectoriseCalls: state.vectoriseCalls})
  `).runInContext(context);
  const turn = result.firstTurn;
  check(turn.cacheCleared, 'turn cache leaked after exit', result);
  if (throwDuringPrediction) {
    check(turn.error === 'prediction control', 'exception control did not fire', result);
  } else {
    check(!turn.error && turn.vectoriseCalls === 1 && turn.gridCount === 1,
      'whole turn must reuse one baseline and mutable grid', result);
    check(turn.normalApplications === 2 && turn.applies - turn.undoes === 2,
      'selected actions must commit normally and retain fast updates', result);
    check(JSON.stringify(turn.history) === '[[0,0],[2,1],[2,2]]',
      'history must preserve separate snapshots across selected actions', result);
    check(result.totalGrids === 2 && result.totalVectoriseCalls === 2,
      'second turn must start from a fresh grid', result);
  }
  console.log('Whole-turn scoring probe passed ' + JSON.stringify(result));
}
runWholeTurnScenario();
runWholeTurnScenario(true);
runWholeTurnScenario(false, 'AIPlayerWithEconomy');
runWholeTurnScenario(true, 'AIPlayerWithEconomy');
console.log('AI fast candidate scoring smoke passed');
