// Explicit diagnostic only: reuse pure passability checks within one sort call.
const assert = require('assert');
const vm = require('vm');

function transform(source, audit) {
  const start = source.indexOf('    sortNeighbours(');
  const end = source.indexOf('    cellHasEnemyEntity(', start);
  assert(start >= 0 && end > start, 'Way method boundaries');
  const original = source.slice(start, end);
  const condition = 'isCoordNotOnMap(neighbours[i], arr.length, arr[0].length) || this.isCellImpassable(neighbours[i], v0, arr, player)';
  assert.equal(original.split(condition).length, 3, 'exact two original checks');
  let candidate = original.replace('let sortedHexagonNeighbours = []',
    'let sortedHexagonNeighbours = []; let blockedSides = 0');
  candidate = candidate.replace('bord.createLine', 'blockedSides |= 1 << i; bord.createLine');
  const last = candidate.lastIndexOf(condition);
  candidate = candidate.slice(0, last) + '(blockedSides & (1 << i))' +
    candidate.slice(last + condition.length);
  if (!audit) return source.slice(0, start) + candidate + source.slice(end);
  const asFunction = method => method.trim().replace('sortNeighbours(', 'function(');
  return source + `\n;(() => {
    const reference = ${asFunction(original)};
    const candidate = ${asFunction(candidate)};
    Way.prototype.sortNeighbours = function(...args) {
      if (args[2].length > 30) throw new Error('unexpected neighbour count');
      const expectedLines = [], actualLines = [];
      const expectedArgs = args.slice(), actualArgs = args.slice();
      expectedArgs[5] = {createLine: (pos, side) => expectedLines.push([pos, side])};
      actualArgs[5] = {createLine: (pos, side) => actualLines.push([pos, side])};
      const expected = reference.apply(this, expectedArgs);
      const actual = candidate.apply(this, actualArgs);
      if (actual.length !== expected.length || actual.some((item, i) =>
          item.hexagon !== expected[i].hexagon || item.side !== expected[i].side) ||
          JSON.stringify(actualLines) !== JSON.stringify(expectedLines)) {
        throw new Error('neighbour order or border callbacks changed');
      }
      __task102NeighbourChecked(this.constructor.name);
      return candidate.apply(this, args);
    };
  })();`;
}

function install(audit = false) {
  const OriginalScript = vm.Script;
  const counts = {};
  vm.Script = class NeighbourPassabilityScript extends OriginalScript {
    constructor(source, options) {
      super(options && options.filename === 'sprites/entities/units/unit/interactionWithUnit.js'
        ? transform(source, audit) : source, options);
    }
    runInContext(context, options) {
      if (audit) context.__task102NeighbourChecked = name => {
        counts[name] = (counts[name] || 0) + 1;
      };
      return super.runInContext(context, options);
    }
  };
  return counts;
}

module.exports = {transform, install};
