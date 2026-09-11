const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Fault-injection unit tests: no model quality or gameplay outcome claims.
const source = fs.readFileSync(path.join(__dirname, 'players.js'), 'utf8');
const scenarios = ['non-unit', 'duck-typed', 'empty', 'building', 'killed',
  'removed', 'moved-away', 'replaced-friendly', 'wrong-turn', 'enemy',
  'missing-destination'];
const invalidCoords = [null, undefined, {}, {x: -1, y: 0}, {x: 2, y: 0},
  {x: 0, y: -1}, {x: 0, y: 1}, {x: 0.5, y: 0}, {x: 0, y: 0.5},
  {x: '0', y: 0}, {x: 0, y: '0'}, {x: NaN, y: 0}, {x: Infinity, y: 0}];
for (const field of ['whoDoCommandCoord', 'destinationCoord']) {
  invalidCoords.forEach((coord, index) => scenarios.push(field + ':' + index));
}
const EXPECTED_ORIGINAL_CASES = 75;
const malformedScenarios = ['non-unit', 'empty', 'building', 'missing-destination'];
const results = [];
// All original simulation assertions run on native-grid equivalents after the
// malformed values are checked at the direct application boundary.
// Execution invalidation still runs with every original injected value.
for (const phase of ['simulation', 'execution', 'undo-reconstruction']) {
  for (const scenario of (phase === 'undo-reconstruction' ? ['valid'] : scenarios)) {
    console.log('SCENARIO:', phase, scenario);
    const context = vm.createContext({
      assert, scenario, phase, console, invalidCoords, malformedScenarios,
      navigator: {userAgent: 'node'},
      window: {innerWidth: 800, innerHeight: 600, devicePixelRatio: 1} });
    for (const file of ['options/gameCoords.js', 'sprites/sprite.js',
      'sprites/empty.js', 'sprites/elements/text.js', 'sprites/hexagon.js',
      'groups/spritesGroup.js', 'groups/grid.js', 'ai/vectorizeContent.js',
      'ai/mutableVectorGrid.js', 'options/actionManager.js']) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
    }
    vm.runInContext(`
      class Player { constructor() { this.units = [] } updateUnits() {} }
      const gameSettings = {aiActionLimit: 1};
      const ai_model = {};
      const whooseTurn = 1, gameRound = 0, suddenDeathRound = 100;
      const areCoordsEqual = (a, b) => a.x === b.x && a.y === b.y;
      let sends = 0, selects = 0, predictions = 0;
      const command = {type: 'unit', whoDoCommandCoord: {x: 0, y: 0},
        destinationCoord: {x: 1, y: 0}};
      let unit = {isEmpty: Sprite.prototype.isEmpty,
        notEmpty: Sprite.prototype.notEmpty,
        coord: {x: 0, y: 0}, moves: 1, killed: false,
        isMyTurn: true, playerColor: 1,
        select() { selects++ }, skipMoves() { this.moves = 0 },
        sendInstructions() {
          actionManager.startAction('unit');
          actionManager.lastAction.units.push({...this});
          sends++; this.moves = 0;
        },
        getAvailableCommands() {
          if (phase === 'simulation') {
            invalidate();
            if (malformedScenarios.includes(scenario)) validateMalformedBoundary();
          }
          return [command];
        }};
      const replacement = {...unit, getAvailableCommands() { return [] }};
      const cells = [
        new Cell(new Hexagon(0, 0, 1), unit, new Empty()),
        new Cell(new Hexagon(1, 0, 0), new Empty(), new Empty())
      ];
      const grid = new Grid(0, 0);
      grid.arr = [0, 1].map(index => {
        const row = [];
        Object.defineProperty(row, 0, {get() { return cells[index] }});
        return row;
      });

      const actionManager = new ActionManager();
      const gameEvent = {selected: new Empty(), hideAll() {}, removeSelection() {}};
      const nextTurnButton = {}, otherSettings = {moveCameraToUndoTarget: false};
      // Only serialization of the original plain unit and browser UI are doubles.
      // The real manager owns action records, popping, and player-list restoration.
      const unpacker = {fullUnpackUnit(snapshot) {
        const restored = {...snapshot};
        cells[0].unit = restored;
        // Execution faults must target the live reconstructed authority. The
        // dedicated reconstruction case keeps the original identity for assertion.
        if (phase !== 'undo-reconstruction') unit = restored;
        return restored;
      }};
      function invalidate() {
        if (scenario.includes(':')) {
          const [field, index] = scenario.split(':');
          command[field] = invalidCoords[Number(index)];
        }
        if (scenario === 'non-unit') cells[0].unit = {};
        if (scenario === 'duck-typed') cells[0].unit = {...unit};
        if (scenario === 'empty') cells[0].unit = null;
        if (scenario === 'building') cells[0].unit = {sendInstructions() {
          throw Error('building received unit command');
        }};
        if (scenario === 'killed') unit.killed = true;
        if (scenario === 'removed') player.units = [];
        if (scenario === 'moved-away') unit.coord = {x: 2, y: 0};
        if (scenario === 'replaced-friendly') {
          unit.coord = {x: 2, y: 0};
          cells[0].unit = replacement;
          player.units.push(replacement);
        }
        if (scenario === 'wrong-turn') unit.isMyTurn = false;
        if (scenario === 'enemy') unit.playerColor = 2;
        if (scenario === 'missing-destination') cells[1] = null;
      }
      function validateMalformedBoundary() {
        const before = {cells: cells.slice(), source: {...cells[0]},
          unit: {...unit}, units: player.units.slice(),
          actions: actionManager.arr.slice(), command: {...command},
          serialized: JSON.stringify({cells, unit, units: player.units,
            actions: actionManager.arr, command})};
        // The source resolver does not validate the destination; application does.
        assert.strictEqual(resolveLiveAiCommandUnit(player, command),
          scenario === 'missing-destination' ? unit : null);
        assert.strictEqual(applyLiveAiCommandUnit(player, command), false);
        assert.strictEqual(sends, 0);
        assert.strictEqual(selects, 0);
        assert.deepStrictEqual(cells, before.cells);
        assert.deepStrictEqual({...cells[0]}, before.source);
        assert.deepStrictEqual({...unit}, before.unit);
        assert.deepStrictEqual(player.units, before.units);
        assert.deepStrictEqual(actionManager.arr, before.actions);
        assert.deepStrictEqual(command, before.command);
        assert.strictEqual(JSON.stringify({cells, unit, units: player.units,
          actions: actionManager.arr, command}), before.serialized);
        console.log('MALFORMED DIRECT REJECTION: PASS', scenario);
        // Explicit domain migration, not a claim that malformed grids vectorize.
        if (scenario === 'missing-destination') {
          cells[1] = new Cell(new Hexagon(1, 0, 0), new Empty(), new Empty());
          command.destinationCoord = {x: 2, y: 0};
        } else {
          cells[0].unit = new Empty();
        }
        assert(vectoriseGrid()[0].every(row => row.every(cell =>
          cell.length === CELL_VECTOR_SIZE && cell.every(Number.isFinite))));
      }
      function predict(model, inputs) {
        predictions++;
        if (phase === 'execution' && predictions === 2) invalidate();
        return inputs.map(() => [0.5]);
      }
    `, context);
    vm.runInContext(source, context, {filename: 'ai/players.js'});
    vm.runInContext(`
      const player = new AIPlayer();
      player.units = [unit];
      const players = [null, player];
      actionManager.startAction('unit');
      const priorAction = actionManager.lastAction;
      const priorUnits = player.units.slice();
      const rejected = {...command, destinationCoord: {x: -1, y: 0}};
      const rejectedScores = player.scoreActionCommandsWithFastVectorGrid([rejected],
        function(candidate) { return applyLiveAiCommandUnit(this, candidate); });
      assert.strictEqual(rejectedScores.commands.length, 0);
      assert.strictEqual(actionManager.lastAction, priorAction);
      assert.strictEqual(actionManager.arr.length, 1);
      assert.deepStrictEqual(player.units, priorUnits);
      assert.strictEqual(unit.moves, 1);
      assert.strictEqual(sends, 0);
      assert.strictEqual(selects, 0);
      console.log('REJECTED PRIOR ACTION PRESERVED: PASS');
      const initialVectors = vectoriseGrid();
      assert.strictEqual(initialVectors[0].length, 2);
      assert(initialVectors[0].every(row => row.length === 1 &&
        row[0].length === CELL_VECTOR_SIZE && row[0].every(Number.isFinite)));
      assert.strictEqual(initialVectors[0][0][0][CELL_VECTOR_INDEX.unitMoves], 1);
      assert.strictEqual(initialVectors[0][1][0][CELL_VECTOR_INDEX.unitMoves], 0);
      console.log('INITIAL NATIVE GRID: PASS; 2 cells, 82 finite channels each');
      if (phase === 'simulation') {
        assert.strictEqual(player.selectBestCommand()[0], null);
        assert.strictEqual(sends, 0);
        assert.strictEqual(selects, 0);
      } else if (phase === 'undo-reconstruction') {
        player.doActions();
        assert.notStrictEqual(cells[0].unit, unit);
        assert.strictEqual(sends, 2);
        assert.strictEqual(selects, 2);
        assert.strictEqual(player.winningChances.length, 2);
      } else {
        player.doActions();
        // One valid reversible simulation; the stale authoritative action is rejected.
        assert.strictEqual(sends, 1);
        assert.strictEqual(selects, 1);
        assert.strictEqual(player.winningChances.length, 1);
      }
      assert.strictEqual(actionManager.arr[0], priorAction);
      assert.strictEqual(actionManager.arr.length, phase === 'undo-reconstruction' ? 2 : 1);
    `, context);
    results.push({phase, scenario, status: 'PASS',
      coverage: phase === 'simulation' && malformedScenarios.includes(scenario) ?
        'original malformed direct rejection/no-side-effects + native integration; original assertions retained' :
        'original integration assertions with real vectors and ActionManager'});
  }
}
assert.strictEqual(results.length, EXPECTED_ORIGINAL_CASES);
assert.strictEqual(new Set(results.map(row => row.phase + ':' + row.scenario)).size,
  EXPECTED_ORIGINAL_CASES);
console.log('MAPPED SOURCE VALIDATION: PASS originalCases=75 malformedDirect=4 nativeEquivalents=4');
console.log(JSON.stringify({status: 'passed', scenarios: results,
  marker: 'TASK-106 MAPPED SOURCE VALIDATION PASSED', count: results.length}, null, 2));
