const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {transform} = require('../task102-coordinate-dedup.cjs');
const source = fs.readFileSync('ai/mutableVectorGrid.js', 'utf8');
const candidate = transform(source);
function evaluate(code, inputs) {
  const context = vm.createContext({inputs});
  return vm.runInContext(code + `
    (() => {
      const coords = [], seen = {};
      for (const coord of inputs) addFastActionCoord(coords, seen, coord);
      // Returned coordinates must be copies, including duplicates of one object.
      for (const result of coords) {
        if (inputs.includes(result)) throw new Error('aliased input coordinate');
      }
      return JSON.stringify(coords);
    })()`, context);
}
let cases = 0;
for (const width of [1, 2, 9, 20, 101]) {
  for (const height of [1, 3, 20]) {
    const inputs = [null, undefined];
    for (let x = -1; x <= width; x++) {
      for (let y = -1; y <= height; y++) {
        inputs.push({x, y}, {x, y}, {x: y, y: x});
      }
    }
    inputs.push({x: 1.5, y: 2}, {x: 1, y: 0.5}, {x: -0, y: 0});
    assert.equal(evaluate(candidate, inputs), evaluate(source, inputs));
    cases++;
  }
}
const broken = candidate.replace('column[coord.y] = true', 'column[0] = true');
const inputs = [{x: 1, y: 2}, {x: 1, y: 2}, {x: 1, y: 0}];
assert.notEqual(evaluate(broken, inputs), evaluate(source, inputs));
assert.throws(() => transform(source.replace('seen[key] = true', 'seen[key] = false')),
  /unique coordinate deduplication/);
console.log('COORDINATE_CONTROLS: PASS ' + cases + ' rectangular/edge/fractional cases; exact order, duplicates and independent coordinate copies');
console.log('NEGATIVE_CONTROLS: PASS incorrect row key and malformed source rejected');
