// Bounded dependency-only diagnostic. All TASK-086 assertions remain verbatim.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const root = path.resolve(__dirname, '../..');
const fixture = path.join(root, 'ai/test-ai-command-source-validation.js');
const options = require('util').parseArgs({options: {
  'players-source': {type: 'string', default: path.join(root, 'ai/players.js')},
  'original-dependencies': {type: 'boolean', default: false}
}}).values;
let source = fs.readFileSync(fixture, 'utf8');
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
// Compile at the original filename so all relative dependency paths are unchanged.
const diagnostic = new Module(fixture, module);
diagnostic.filename = fixture;
diagnostic.paths = Module._nodeModulePaths(path.dirname(fixture));
console.log(options['original-dependencies'] ?
  'DEPENDENCY CONTROL: original fixture (includes its existing vector stub); unchanged 75-case scenario matrix and assertions' :
  'DEPENDENCY CONTROL: real vectorizeContent/mutableVectorGrid, native Grid/Cell/Hexagon/Empty; unchanged 75-case scenario matrix and assertions');
diagnostic._compile(source, fixture);
