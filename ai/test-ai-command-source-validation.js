const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Fault-injection unit tests: no model quality or gameplay outcome claims.
const source = fs.readFileSync(path.join(__dirname, 'players.js'), 'utf8');
const scenarios = ['non-unit', 'duck-typed', 'empty', 'building', 'killed',
  'removed', 'moved-away', 'replaced-friendly', 'wrong-turn', 'enemy',
  'missing-destination'];
const results = [];
for (const phase of ['simulation', 'execution', 'undo-reconstruction']) {
  for (const scenario of (phase === 'undo-reconstruction' ? ['valid'] : scenarios)) {
    const context = vm.createContext({ assert, scenario, phase, console });
    vm.runInContext(`
      class Player { constructor() { this.units = [] } updateUnits() {} }
      const gameSettings = {aiActionLimit: 1};
      const ai_model = {};
      const vectoriseGrid = () => [];
      const areCoordsEqual = (a, b) => a.x === b.x && a.y === b.y;
      let sends = 0, selects = 0, predictions = 0;
      const command = {type: 'unit', whoDoCommandCoord: {x: 0, y: 0},
        destinationCoord: {x: 1, y: 0}};
      const unit = {coord: {x: 0, y: 0}, moves: 1, killed: false,
        isMyTurn: true, playerColor: 1,
        select() { selects++ }, skipMoves() { this.moves = 0 },
        sendInstructions() { sends++; this.moves = 0 },
        getAvailableCommands() {
          if (phase === 'simulation') invalidate();
          return [command];
        }};
      const replacement = {...unit, getAvailableCommands() { return [] }};
      const cells = [{unit}, {unit: {coord: {x: -1, y: -1}}}];
      const grid = {getCell(coord) { return cells[coord.x] }};
      const actionManager = {undo() {
        unit.moves = 1;
        if (phase === 'undo-reconstruction') {
          cells[0].unit = {...unit};
          player.units = [cells[0].unit];
        }
      }};
      function invalidate() {
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
    `, context);
    results.push({phase, scenario, status: 'PASS'});
  }
}
console.log(JSON.stringify({status: 'passed', scenarios: results,
  marker: 'TASK-086 SOURCE VALIDATION PASSED', count: results.length}, null, 2));
