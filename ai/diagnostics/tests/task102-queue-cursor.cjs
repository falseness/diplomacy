const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {transform} = require('../task102-queue-cursor.cjs');
const source = fs.readFileSync('sprites/entities/units/unit/interactionWithUnit.js', 'utf8');
const way = source.slice(source.indexOf('class Way {'), source.indexOf('class VisionWay {'));
// Keep the boundary marker required by the frozen-source transform.
const candidate = transform(way + 'class VisionWay {}');
const broken = candidate.replace('if (head < Q.length)',
  'if (head < Q.length && enemyHead >= enemyEntityQ.length)');
let negativeDetected = 0, cases = 0;
function evaluate(code, pattern, moves) {
  const arr = Array.from({length: 8}, (_, x) => [{
    coord: {x, y: 0}, logicText: {},
    unit: {notEmpty: () => !!(pattern & (1 << x)), playerColor: 2},
    building: {isPassable: true},
    hexagon: {coord: {x, y: 0}, calcPos: () => ({x, y: 0})}
  }]);
  // Diamond/cycle graph exercises FIFO ties and new ordinary work discovered
  // while consuming deferred enemy work, including exhausted queues.
  const edges = [[1, 2], [3, 4], [4, 5], [6], [6, 7], [7], [0], [1]];
  for (let x = 0; x < arr.length; x++) {
    arr[x][0].hexagon.neighbours = edges[x].map(n => ({x: n, y: 0}));
  }
  const instance = vm.runInNewContext(code + '; new Way()', {
    grid: {arr, newLogicText() {}},
  });
  instance.sortNeighbours = (v0, v, neighbours) => neighbours.map((coord, side) =>
    ({hexagon: arr[coord.x][0].hexagon, side}));
  const lines = [];
  const visited = instance.create({x: 0, y: 0}, moves, arr, 1,
    {createLine: (pos, side) => lines.push([pos, side])}, true);
  return JSON.stringify({visited, distance: instance.distance, parent: instance.parent,
    lines, text: arr.map(column => column[0].logicText)});
}
for (let pattern = 0; pattern < 256; pattern++) {
  for (const moves of [0, 1, 3, 99]) {
    const expected = evaluate(way, pattern, moves);
    assert.equal(evaluate(candidate, pattern, moves), expected, `${pattern}/${moves}`);
    negativeDetected += evaluate(broken, pattern, moves) !== expected;
    cases++;
  }
}
assert(negativeDetected > 0, 'reversed queue priority must fail');
assert.throws(() => transform(source.replace('v = Q.shift()', 'v = null')), /unique queue/);
assert.throws(() => transform('class Way {}'), /boundaries/);
console.log('QUEUE_CASES: PASS ' + cases + ' enemy layouts/move limits; exact traversal, distances, parents, borders and text');
console.log('NEGATIVE_CONTROLS: PASS ' + negativeDetected + ' wrong-priority cases rejected; malformed sources rejected');
