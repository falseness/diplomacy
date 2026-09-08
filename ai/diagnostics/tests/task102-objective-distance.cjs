const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const OriginalScript = vm.Script;
require('../task102-objective-distance-prototype.cjs');
const source = fs.readFileSync(path.resolve(__dirname, '../../vectorizeContent.js'), 'utf8');
const filename = 'ai/vectorizeContent.js';
const scripts = [new OriginalScript(source, {filename}), new vm.Script(source, {filename})];
const player = (units = [], towns = [], isNeutral = false) => ({units, towns, isNeutral});
const entity = (x, y, killed = false) => ({coord: {x, y}, killed});
const fixtures = [
  [null, player(), player()],
  [null, player(), player([], [entity(1, 0)])],
  [null, player(), player([entity(9, 0)], [entity(1, 0)])],
  [null, player(), player([entity(9, 0, true)], [entity(1, 0)])],
  [null, player(), player([entity(9, 0, true)], [entity(1, 0, true)])],
  [null, player([entity(0, 0)]), player([entity(3, 2)]), player([entity(0, 0)], [], true)],
  [null, player(), undefined, player([entity(3, 2)]), player([entity(2, 0)])],
  [null, player(), player([entity(NaN, 0)], [entity(1, 0)])],
  [null, player(), player([entity(Infinity, 0)])]
];
let checks = 0;
for (const players of fixtures) {
  for (const whooseTurn of [1, 2]) {
    for (const playerColor of [0, 1, 2]) {
      const cell = {coord: {x: 0, y: 0}, playerColor};
      const contexts = scripts.map(script => {
        const context = vm.createContext({players, whooseTurn, grid: {arr: [Array(10)]}, cell});
        script.runInContext(context);
        return context;
      });
      const values = contexts.map(context => vm.runInContext('relativeUnitObjectiveDistance(cell)', context));
      assert(Object.is(values[0], values[1]), 'exact distance including NaN and signed zero');
      checks += 1;
    }
  }
}
// Concrete priority control: a farther unit wins over a closer town.
const context = vm.createContext({players: fixtures[2], whooseTurn: 1,
  grid: {arr: [Array(10)]}, cell: {coord: {x: 0, y: 0}, playerColor: 1}});
scripts[1].runInContext(context);
assert.equal(vm.runInContext('relativeUnitObjectiveDistance(cell)', context), -0.9);
console.log(`OBJECTIVE_DISTANCE: PASS ${checks} exact comparisons; unit priority, town fallback, killed/neutral/own exclusions, perspectives and nonfinite values`);
console.log('PRIORITY_CONTROL: PASS farther unit distance -0.9 overrides closer town -0.1');
