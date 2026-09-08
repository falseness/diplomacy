// Observe real invariant fixtures and compare every cached lookup to the old scan.
const assert = require('assert');
const vm = require('vm');
const OriginalScript = vm.Script;
let checks = 0;
vm.Script = class LookupOracleScript extends OriginalScript {
  constructor(source, options) {
    const observer = options && options.filename === 'ai/vectorizeContent.js' ? `
;(() => {
  const original = vectorizeSuburb;
  vectorizeSuburb = function(cell, result, lookup) {
    if (lookup) {
      if (lookupSuburbExpansionCell(cell, lookup) !== isSuburbExpansionCell(cell)) {
        throw new Error('suburb lookup differs from original scan at ' + JSON.stringify(cell.coord));
      }
      __task102LookupCheck();
    }
    return original(cell, result, lookup);
  };
})();` : '';
    super(source + observer, options);
  }
  runInContext(context, options) {
    context.__task102LookupCheck = () => { checks += 1; };
    return super.runInContext(context, options);
  }
};
process.on('exit', code => {
  if (code === 0) {
    assert(checks > 0, 'real cached vectorization paths exercised');
    console.log('SUBURB_LOOKUP_ORACLE: PASS ' + checks + ' real cell comparisons against original scan');
  }
});
