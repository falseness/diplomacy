// Diagnostic only. Each fresh VM owns its own cache; production never imports it.
const assert = require('assert');
const vm = require('vm');

function transform(source, audit = false) {
  const anchor = '    cloneMutableVectorGridForPrediction(mutableGrid) {';
  assert.equal(source.split(anchor).length, 2, 'unique prediction snapshot method');
  return source + `
;(() => {
    const reference = AIPlayer.prototype.cloneMutableVectorGridForPrediction;
    const previousCells = new WeakMap();
    AIPlayer.prototype.cloneMutableVectorGridForPrediction = function(mutableGrid) {
        const cells = mutableGrid.cells;
        const result = new Array(cells.length);
        for (let x = 0; x < cells.length; ++x) {
            result[x] = new Array(cells[x].length);
            for (let y = 0; y < cells[x].length; ++y) {
                const source = cells[x][y];
                let copy = previousCells.get(source);
                let equal = copy && copy.length === source.length;
                for (let channel = 0; equal && channel < source.length; ++channel) {
                    equal = Object.is(copy[channel], source[channel]);
                }
                if (!equal) {
                    copy = Object.freeze(source.slice());
                    previousCells.set(source, copy);
                }
                result[x][y] = copy;
            }
        }
        const snapshot = [result, mutableGrid.suddenDeathMetric];
        ${audit ? `const expected = reference.call(this, mutableGrid);
        for (let x = 0; x < cells.length; ++x) {
            for (let y = 0; y < cells[x].length; ++y) {
                if (!expected[0][x][y].every((value, i) =>
                    Object.is(value, snapshot[0][x][y][i]))) {
                    throw new Error('snapshot oracle mismatch');
                }
            }
        }
        __task102SnapshotChecked();` : ''}
        return snapshot;
    };
})();
`;
}

function install(audit = false) {
  const OriginalScript = vm.Script;
  const counts = {snapshots: 0};
  vm.Script = class SnapshotScript extends OriginalScript {
    constructor(source, options) {
      super(options && options.filename === 'ai/players.js'
        ? transform(source, audit) : source, options);
    }
    runInContext(context, options) {
      if (audit) context.__task102SnapshotChecked = () => { counts.snapshots += 1; };
      return super.runInContext(context, options);
    }
  };
  return counts;
}

module.exports = {transform, install};
