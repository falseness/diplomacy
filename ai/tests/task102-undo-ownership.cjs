// Run the real movement/combat invariants with retained undo-vector checks.
const assert = require('assert');
const vm = require('vm');
const OriginalScript = vm.Script;
let checkedVectors = 0;
const hooks = `
(() => {
    const apply = applyChangedCellFastAction;
    const undo = undoChangedCellFastAction;
    const retained = new WeakMap();
    applyChangedCellFastAction = function(mutableGrid, command) {
        const token = apply(mutableGrid, command);
        retained.set(token, JSON.stringify(token.previous));
        for (const entry of token.previous) {
            if (entry.vector === mutableGrid.cells[entry.coord.x][entry.coord.y]) {
                throw new Error('undo vector must be detached after apply');
            }
        }
        return token;
    };
    undoChangedCellFastAction = function(mutableGrid, token) {
        if (JSON.stringify(token.previous) !== retained.get(token)) {
            throw new Error('detached undo vectors changed before restoration');
        }
        undo(mutableGrid, token);
        for (const entry of token.previous) {
            if (entry.vector === mutableGrid.cells[entry.coord.x][entry.coord.y]) {
                throw new Error('restoration must preserve independent undo storage');
            }
        }
        __task102UndoChecked(token.previous.length);
    };
})();
`;
vm.Script = class UndoOwnershipCheckScript extends OriginalScript {
  constructor(source, options) {
    super(source + (options && options.filename === 'ai/mutableVectorGrid.js' ? hooks : ''), options);
  }
  runInContext(context, options) {
    context.__task102UndoChecked = count => { checkedVectors += count; };
    return super.runInContext(context, options);
  }
};
require('../test-fast-unit-actions');
assert(checkedVectors > 0, 'real apply/undo vectors exercised');
console.log('UNDO_OWNERSHIP: PASS ' + checkedVectors + ' detached vectors and independent restorations');
