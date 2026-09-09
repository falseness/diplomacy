// Read-only switch/oracle/ownership checks on each real archived factorial arm.
const assert = require('assert');
const vm = require('vm');
const arm = process.env.TASK102_ARM;
assert(['A', 'B', 'C', 'D'].includes(arm));
const expectedLookup = arm === 'A' || arm === 'C';
const expectedCopy = arm === 'A' || arm === 'B';
const counts = {builds: 0, scans: 0, oracle: 0, captures: 0};
const OriginalScript = vm.Script;
vm.Script = class FactorialControlScript extends OriginalScript {
  constructor(source, options) {
    const file = options && options.filename;
    if (file === 'ai/vectorizeContent.js') source += `
;(() => {
    const build = createSuburbExpansionLookup;
    createSuburbExpansionLookup = function() { __task102Count('builds'); return build(); };
    const scan = isSuburbExpansionCell;
    isSuburbExpansionCell = function(cell) { __task102Count('scans'); return scan(cell); };
    const suburb = vectorizeSuburb;
    vectorizeSuburb = function(cell, result, lookup) {
        if (Boolean(lookup) !== ${expectedLookup}) throw new Error('incorrect lookup switch');
        const oracle = scan(cell);
        if (lookup && lookupSuburbExpansionCell(cell, lookup) !== oracle) throw new Error('lookup/scan drift');
        __task102Count('oracle');
        return suburb(cell, result, lookup);
    };
})();`;
    if (file === 'ai/mutableVectorGrid.js') source += `
;(() => {
    const apply = applyChangedCellFastAction;
    applyChangedCellFastAction = function(grid, command) {
        const original = grid.cells.map(column => column.slice());
        const token = apply(grid, command);
        for (const entry of token.previous) {
            const retainedOriginal = entry.vector === original[entry.coord.x][entry.coord.y];
            if (retainedOriginal === ${expectedCopy}) throw new Error('incorrect capture switch');
            __task102Count('captures');
        }
        return token;
    };
})();`;
    super(source, options);
  }
  runInContext(context, options) {
    context.__task102Count = name => counts[name]++;
    return super.runInContext(context, options);
  }
};
process.on('exit', code => {
  if (code !== 0) return;
  assert(counts.oracle > 0 && counts.captures > 0);
  assert(expectedLookup ? counts.builds > 0 : counts.builds === 0 && counts.scans > 0);
  console.log('FACTORIAL_RUNTIME_SWITCH: PASS ' + arm + ' ' + JSON.stringify(counts));
});
