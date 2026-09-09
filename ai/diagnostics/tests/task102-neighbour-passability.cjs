const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {transform} = require('../task102-neighbour-passability.cjs');
const source = fs.readFileSync('sprites/entities/units/unit/interactionWithUnit.js', 'utf8');
const way = source.slice(source.indexOf('class Way {'), source.indexOf('class VisionWay {'));
function create(code) {
  return vm.runInNewContext(code + '; new Way()', {
    isCoordNotOnMap: coord => coord.x < 0
  });
}
const original = create(way);
const candidate = create(transform(way, false));
let originalChecks = 0, candidateChecks = 0;
original.isCellImpassable = coord => { originalChecks += 1; return coord.blocked; };
candidate.isCellImpassable = coord => { candidateChecks += 1; return coord.blocked; };
function evaluate(instance, pattern) {
  const neighbours = [], arr = [], lines = [];
  for (let side = 0; side < 6; side += 1) {
    const state = (pattern >> (2 * side)) & 3;
    neighbours.push({x: state === 3 ? -1 : side, y: 0, blocked: state === 2});
    arr.push([{hexagon: {playerColor: state === 0 ? 1 : 2,
      coord: {x: side, y: 0}, calcPos: () => ({x: 10, y: 20})}}]);
  }
  const result = instance.sortNeighbours({x: 0, y: 0}, {x: 0, y: 0},
    neighbours, arr, 1, {createLine: (pos, side) => lines.push([pos, side])});
  return JSON.stringify({result: result.map(item => [item.hexagon.coord, item.side]), lines});
}
for (let pattern = 0; pattern < 4096; pattern += 1) {
  assert.equal(evaluate(candidate, pattern), evaluate(original, pattern), 'pattern ' + pattern);
}
assert.equal(candidateChecks * 2, originalChecks);
const exhaustiveOriginalChecks = originalChecks;
// Deliberately omit the second blocked callback; the oracle must detect it.
const broken = create(transform(way, false).replace(
  'if ((blockedSides & (1 << i))) {',
  'if ((blockedSides & (1 << i))) { continue;'));
broken.isCellImpassable = coord => coord.blocked;
assert.notEqual(evaluate(broken, 2), evaluate(original, 2));
assert.throws(() => transform('class Way {}', false), /boundaries/);
console.log('NEIGHBOUR_PATTERNS: PASS 4096 exhaustive patterns; same order and duplicate border callbacks');
console.log('PASSABILITY_CHECKS: PASS ' + candidateChecks + ' candidate versus ' +
  exhaustiveOriginalChecks + ' original checks across exhaustive patterns');
console.log('NEGATIVE_CONTROLS: PASS omitted callback and wrong source rejected');
