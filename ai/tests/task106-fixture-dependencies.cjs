// Bounded dependency-only diagnostic. All TASK-086 assertions remain verbatim.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const root = path.resolve(__dirname, '../..');
const fixture = path.join(root, 'ai/test-ai-command-source-validation.js');
const options = require('util').parseArgs({options: {
  'undo-only': {type: 'boolean', default: false},
  'real-action-manager': {type: 'boolean', default: false},
  'players-source': {type: 'string', default: path.join(root, 'ai/players.js')},
  'original-dependencies': {type: 'boolean', default: false},
  'trace-contract': {type: 'boolean', default: false},
  'inventory-contract': {type: 'boolean', default: false}
}}).values;
// Preserve the pre-migration diagnostic, including its failing original inputs.
let source = fs.readFileSync(path.join(__dirname, 'fixtures/task086-original-source-validation.js'), 'utf8');
function replaceOnce(before, after) {
  assert.strictEqual(source.split(before).length, 2, 'unique fixture anchor');
  source = source.replace(before, () => after);
}

// Load a frozen scorer without checking out or modifying production source.
// The scenario matrix, invalidation timing, and assertions stay untouched.
const playersSourcePath = path.resolve(options['players-source']);
const playersSource = fs.readFileSync(playersSourcePath, 'utf8');
replaceOnce("fs.readFileSync(path.join(__dirname, 'players.js'), 'utf8')",
  JSON.stringify(playersSource));
console.log('SCORER SOURCE:', playersSourcePath);
console.log('SCORER SHA256:', require('crypto').createHash('sha256')
  .update(playersSource).digest('hex'));

if (!options['original-dependencies']) {
  replaceOnce('{ assert, scenario, phase, console, invalidCoords }',
    `{ assert, scenario, phase, console, invalidCoords,
      navigator: {userAgent: 'node'},
      window: {innerWidth: 800, innerHeight: 600, devicePixelRatio: 1} }`);
  replaceOnce('const context = vm.createContext(',
    "console.log('SCENARIO:', phase, scenario); const context = vm.createContext(");
  replaceOnce("['sprites/sprite.js', 'groups/spritesGroup.js', 'groups/grid.js']",
    JSON.stringify(['options/gameCoords.js', 'sprites/sprite.js',
      'sprites/empty.js', 'sprites/elements/text.js', 'sprites/hexagon.js',
      'groups/spritesGroup.js', 'groups/grid.js', 'ai/vectorizeContent.js',
      'ai/mutableVectorGrid.js']));
  replaceOnce('const vectoriseGrid = () => [];',
    'const whooseTurn = 1, gameRound = 0, suddenDeathRound = 100;');
  replaceOnce('const unit = {coord:',
    'const unit = {isEmpty: Sprite.prototype.isEmpty, coord:');
  replaceOnce('const cells = [{unit}, {unit: {coord: {x: -1, y: -1}}}];',
    `const cells = [
          new Cell(new Hexagon(0, 0, 1), unit, new Empty()),
          new Cell(new Hexagon(1, 0, 0), new Empty(), new Empty())
        ];`);
  replaceOnce('const grid = Object.create(Grid.prototype);',
    'const grid = new Grid(0, 0);');
  replaceOnce('const players = [null, player];',
    `const players = [null, player];
        const initialVectors = vectoriseGrid();
        assert.strictEqual(initialVectors[0].length, 2);
        assert(initialVectors[0].every(row => row.length === 1 &&
          row[0].length === CELL_VECTOR_SIZE && row[0].every(Number.isFinite)));
        console.log('INITIAL NATIVE GRID: PASS; 2 cells, 82 finite channels each');`);
}
if (options['undo-only']) {
  replaceOnce("['simulation', 'execution', 'undo-reconstruction']", "['undo-reconstruction']");
}
if (options['real-action-manager']) {
  assert(!options['original-dependencies']);
  // Use the actual stack, snapshots, undo dispatch, pop and list restoration.
  replaceOnce('const actionManager = {undo() {\n        unit.moves = 1;\n        if (phase === \'undo-reconstruction\') {\n          cells[0].unit = {...unit};\n          player.units = [cells[0].unit];\n        }\n      }};', `
      const actionManager = new ActionManager();
      const gameEvent = {selected: new Empty(), hideAll() {}, removeSelection() {}};
      const nextTurnButton = {}, otherSettings = {moveCameraToUndoTarget: false};
      const unpacker = {fullUnpackUnit(snapshot) {
        const restored = {...snapshot};
        cells[0].unit = restored;
        return restored;
      }};`);
  replaceOnce('sendInstructions() { sends++; this.moves = 0 },', `sendInstructions() {
        actionManager.startAction('unit');
        actionManager.lastAction.units.push({...this});
        sends++; this.moves = 0;
      },`);
  replaceOnce('isEmpty: Sprite.prototype.isEmpty,',
    'isEmpty: Sprite.prototype.isEmpty, notEmpty: Sprite.prototype.notEmpty,');
  replaceOnce('vm.runInContext(`\n      class Player',
    `vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'options/actionManager.js'), 'utf8'), context);
    vm.runInContext(\`\n      class Player`);
  replaceOnce('const players = [null, player];', `const players = [null, player];
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
      console.log('REJECTED PRIOR ACTION PRESERVED: PASS');`);
}
if (options['trace-contract']) {
  assert(!options['original-dependencies'], 'contract tracing requires real dependencies');
  // Observe the real functions without replacing invalid values, swallowing
  // exceptions, or changing any scenario/assertion. The resolver probe is a
  // read-only observation, not an extra command application.
  replaceOnce("vm.runInContext(source, context, {filename: 'ai/players.js'});",
    `vm.runInContext(source, context, {filename: 'ai/players.js'});
    vm.runInContext(\`
      let contractApplications = 0;
      const originalInvalidate = invalidate;
      invalidate = function() {
        const result = originalInvalidate();
        console.log('CONTRACT INVALIDATED:', phase, scenario,
          'resolverRejects=' + (resolveLiveAiCommandUnit(player, command) === null));
        return result;
      };
      const originalApply = applyLiveAiCommandUnit;
      applyLiveAiCommandUnit = function(...args) {
        contractApplications++;
        return originalApply.apply(this, args);
      };
      const originalVectorise = vectoriseGrid;
      vectoriseGrid = function(...args) {
        try {
          return originalVectorise.apply(this, args);
        } catch (error) {
          console.log('CONTRACT VECTOR FAILURE:', phase, scenario,
            'commandApplications=' + contractApplications,
            error.name + ': ' + error.message);
          throw error;
        }
      };
    \`, context);`);
}
if (options['inventory-contract']) {
  // Each fixture case owns a fresh VM. Collect independent failures to expose
  // the contract's scope, but retain all assertions and fail the entire gate.
  replaceOnce('const results = [];', 'const results = []; const failures = [];');
  const contextAnchor = options['original-dependencies'] ?
    'const context = vm.createContext(' :
    "console.log('SCENARIO:', phase, scenario); const context = vm.createContext(";
  replaceOnce(contextAnchor, 'try { ' + contextAnchor);
  replaceOnce("results.push({phase, scenario, status: 'PASS'});",
    `results.push({phase, scenario, status: 'PASS'});
    } catch (error) {
      const failure = {phase, scenario, status: 'FAIL',
        error: error.name + ': ' + error.message, stack: error.stack};
      results.push(failure);
      failures.push(error);
    }`);
  replaceOnce("console.log(JSON.stringify({status: 'passed', scenarios: results,",
    `console.log('CONTRACT INVENTORY:', JSON.stringify(results));
    assert.strictEqual(results.length, ${options['undo-only'] ? 1 : 75},
      'all selected original fixture cases attempted');
    console.log('CONTRACT INVENTORY COUNTS: attempted=' + results.length +
      ' passed=' + (results.length - failures.length) + ' failed=' + failures.length);
    if (failures.length) {
      throw new AggregateError(failures, 'fixture contract failures; prerequisite remains failed');
    }
    console.log(JSON.stringify({status: 'passed', scenarios: results,`);
}
// Compile at the original filename so all relative dependency paths are unchanged.
const diagnostic = new Module(fixture, module);
diagnostic.filename = fixture;
diagnostic.paths = Module._nodeModulePaths(path.dirname(fixture));
console.log(options['original-dependencies'] ?
  'DEPENDENCY CONTROL: original fixture (includes its existing vector stub); original scenario assertions; undo-only selects one case' :
  'DEPENDENCY CONTROL: real vectorizeContent/mutableVectorGrid, native Grid/Cell/Hexagon/Empty; original scenario assertions; undo-only selects one case');
try {
  diagnostic._compile(source, fixture);
} catch (error) {
  // Keep the original exception and nonzero exit. This diagnostic is a gate,
  // not an expected-failure test: reproducing a known fault is still a failure.
  console.error('TASK-106 FIXTURE PREREQUISITE: FAIL');
  console.error('STOP: investigate the fixture/runtime contract before heap, aggregate, or performance runs.');
  throw error;
}
