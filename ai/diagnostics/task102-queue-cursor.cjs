// Explicit diagnostic only; production loaders never import this intervention.
const assert = require('assert');
const vm = require('vm');

function transform(source, audit = false) {
  const start = source.indexOf('    create(v0, moves, arr, player, bord,');
  const end = source.indexOf('\n}\nclass VisionWay', start);
  assert(start >= 0 && end > start, 'Way.create boundaries');
  const original = source.slice(start, end);
  function replaceOnce(text, before, after) {
    assert.equal(text.split(before).length, 2, 'unique queue expression: ' + before);
    return text.replace(before, after);
  }
  let candidate = replaceOnce(original, 'let Q = []', 'let Q = []\n        let head = 0, enemyHead = 0');
  candidate = replaceOnce(candidate,
    'while (Q.length > 0 || enemyEntityQ.length > 0)',
    'while (head < Q.length || enemyHead < enemyEntityQ.length)');
  candidate = replaceOnce(candidate, 'if (Q.length)', 'if (head < Q.length)');
  candidate = replaceOnce(candidate, 'v = Q.shift()', 'v = Q[head++]');
  candidate = replaceOnce(candidate, 'v = enemyEntityQ.shift()', 'v = enemyEntityQ[enemyHead++]');
  if (!audit) return source.slice(0, start) + candidate + source.slice(end);
  const asFunction = method => method.trim().replace('create(', 'function(');
  // Reference and candidate run on the same instance and real grid. Initialization
  // resets all search state. Forward the real drawing callbacks only on the final
  // candidate call, after comparing complete ordered callback streams and state.
  return source + `\n;(() => {
    const reference = ${asFunction(original)};
    const candidate = ${asFunction(candidate)};
    Way.prototype.create = function(...args) {
      const collect = fn => {
        const lines = [], local = args.slice();
        local[4] = {createLine: (pos, side) => lines.push([pos, side])};
        const visited = fn.apply(this, local);
        return JSON.stringify({visited, distance: this.distance, parent: this.parent, lines});
      };
      if (collect(reference) !== collect(candidate)) {
        throw new Error('queue traversal, distance, parent or border mismatch');
      }
      __task102QueueChecked(this.constructor.name);
      return candidate.apply(this, args);
    };
  })();`;
}

function install(audit = false) {
  const OriginalScript = vm.Script;
  const counts = {};
  vm.Script = class QueueCursorScript extends OriginalScript {
    constructor(source, options) {
      super(options && options.filename === 'sprites/entities/units/unit/interactionWithUnit.js'
        ? transform(source, audit) : source, options);
    }
    runInContext(context, options) {
      if (audit) context.__task102QueueChecked = name => {
        counts[name] = (counts[name] || 0) + 1;
      };
      return super.runInContext(context, options);
    }
  };
  return counts;
}

module.exports = {transform, install};
