// Isolated allocation intervention, loaded explicitly with node -r.
const assert = require('assert');
const vm = require('vm');
const original = `            if (!isLiveTownSuburb(town, suburb) || !suburb.neighbours) {
                continue
            }
            for (let k = 0; k < suburb.neighbours.length; ++k) {
                if (coordsMatch(suburb.neighbours[k], cell.coord)) {`;
const replacement = `            if (!isLiveTownSuburb(town, suburb)) {
                continue
            }
            let neighbours = suburb.neighbours
            if (!neighbours) {
                continue
            }
            for (let k = 0; k < neighbours.length; ++k) {
                if (coordsMatch(neighbours[k], cell.coord)) {`;
const OriginalScript = vm.Script;
vm.Script = class NeighboursPrototypeScript extends OriginalScript {
  constructor(source, options) {
    if (options && options.filename === 'ai/vectorizeContent.js') {
      assert.equal(source.split(original).length, 2, 'exact frozen suburb loop');
      source = source.replace(original, replacement);
    }
    super(source, options);
  }
};
