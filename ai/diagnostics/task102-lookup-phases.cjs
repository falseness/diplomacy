// Supplemental observational preload: distinguish eligible changed-cell refreshes.
const vm = require('vm');
const OriginalScript = vm.Script;
vm.Script = class LookupPhaseScript extends OriginalScript {
  constructor(source, options) {
    if (options && options.filename === 'ai/vectorizeContent.js') source += String.raw`
;(() => {
    const full = vectoriseGrid;
    vectoriseGrid = function() {
        const prior = globalThis.__task102LookupPhase;
        globalThis.__task102LookupPhase = 'full';
        try { return full(); } finally { globalThis.__task102LookupPhase = prior; }
    };
    const suburb = vectorizeSuburb;
    vectorizeSuburb = function(cell, result, lookup) {
        const phase = globalThis.__task102LookupPhase || 'other';
        globalThis.__task102LookupCount('phaseCells:' + phase);
        if (cell && cell.hexagon && !cell.hexagon.isSuburb && cell.playerColor != 0 && cell.coord) {
            globalThis.__task102LookupCount('phaseEligible:' + phase);
        }
        return suburb(cell, result, lookup);
    };
})();
`;
    if (options && options.filename === 'ai/mutableVectorGrid.js') source += String.raw`
;(() => {
    const changed = applyChangedCellFastAction;
    applyChangedCellFastAction = function(grid, command) {
        const prior = globalThis.__task102LookupPhase;
        globalThis.__task102LookupPhase = 'changed';
        try { return changed(grid, command); } finally { globalThis.__task102LookupPhase = prior; }
    };
})();
`;
    super(source, options);
  }
};
