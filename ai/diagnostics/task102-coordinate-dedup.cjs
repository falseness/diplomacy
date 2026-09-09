// Diagnostic only. Production loaders never install this intervention.
const assert = require('assert');
const vm = require('vm');

function transform(source, audit = false) {
  const original = `    let key = fastActionCoordKey(coord)
    if (seen[key]) {
        return
    }
    seen[key] = true`;
  assert.equal(source.split(original).length, 2, 'unique coordinate deduplication');
  let candidate = source.replace(original, `    let column = seen[coord.x]
    if (!column) {
        column = seen[coord.x] = Object.create(null)
    }
    if (column[coord.y]) {
        return
    }
    column[coord.y] = true`);
  if (audit) {
    const start = source.indexOf('function addFastActionCoord(');
    const end = source.indexOf('\n}', start) + 2;
    assert(start >= 0 && end > start, 'coordinate function boundaries');
    candidate += `
;(() => {
    const reference = ${source.slice(start, end)};
    const optimized = addFastActionCoord;
    for (const name of ['collectFastActionChangedCoords', 'collectUnitFastActionCoords']) {
        const collect = globalThis[name];
        globalThis[name] = function(...args) {
            let expected;
            try {
                addFastActionCoord = reference;
                expected = collect(...args);
            } finally {
                addFastActionCoord = optimized;
            }
            const actual = collect(...args);
            if (JSON.stringify(expected) !== JSON.stringify(actual)) {
                throw new Error('coordinate deduplication order/value mismatch');
            }
            __task102CoordinateChecked(name, actual.length);
            return actual;
        };
    }
})();
`;
  }
  return candidate;
}

function install(audit = false) {
  const OriginalScript = vm.Script;
  const counts = {};
  vm.Script = class CoordinateDedupScript extends OriginalScript {
    constructor(source, options) {
      super(options && options.filename === 'ai/mutableVectorGrid.js'
        ? transform(source, audit) : source, options);
    }
    runInContext(context, options) {
      if (audit) context.__task102CoordinateChecked = (name, size) => {
        counts[name] = (counts[name] || 0) + 1;
        counts.coordinates = (counts.coordinates || 0) + size;
      };
      return super.runInContext(context, options);
    }
  };
  return counts;
}

module.exports = {transform, install};
