// Diagnostic only: production loaders never install this source intervention.
const assert = require('assert');
const vm = require('vm');

function transform(source, audit = false) {
  const allocation = '    let result = new Array(CELL_VECTOR_SIZE)\n    result = result.fill(0)';
  assert.equal(source.split(allocation).length, 3, 'two vector constructors');
  let candidate = source.replaceAll(allocation, '    let result = task102ZeroVector()');
  candidate += `
var task102Zeros;
function task102ZeroVector() {
    if (!task102Zeros || task102Zeros.length !== CELL_VECTOR_SIZE) {
        task102Zeros = [];
        for (let i = 0; i < CELL_VECTOR_SIZE; ++i) task102Zeros.push(0);
    }
    return task102Zeros.slice();
}
`;
  if (audit) {
    // Evaluate the original function bodies in the same realm and state. Neither
    // computes mutations; each produces its own fresh vector for exact comparison.
    for (const name of ['computeGlobalVectorChannels', 'vectorizeCellLocal']) {
      const start = source.indexOf('function ' + name + '(');
      const end = source.indexOf('\n}', start) + 2;
      assert(start >= 0 && end > start, name);
      candidate += `
;(() => {
  const original = ${source.slice(start, end)};
  const optimized = ${name};
  ${name} = function(...args) {
    const expected = original(...args), actual = optimized(...args);
    if (expected.length !== actual.length ||
        !expected.every((value, i) => Object.is(value, actual[i]))) {
      throw new Error('dense vector oracle mismatch: ${name}');
    }
    __task102DenseChecked('${name}');
    return actual;
  };
})();
`;
    }
  }
  return candidate;
}

function install(audit = false) {
  const OriginalScript = vm.Script;
  const counts = {};
  vm.Script = class DenseVectorScript extends OriginalScript {
    constructor(source, options) {
      super(options && options.filename === 'ai/vectorizeContent.js'
        ? transform(source, audit) : source, options);
    }
    runInContext(context, options) {
      if (audit) context.__task102DenseChecked = name => {
        counts[name] = (counts[name] || 0) + 1;
      };
      return super.runInContext(context, options);
    }
  };
  return counts;
}

module.exports = {transform, install};
