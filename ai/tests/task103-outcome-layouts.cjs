const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {outcomeLayoutHash, assertDisjointOutcomeLayouts} = require('../economy-outcome-data');

const root = path.resolve(process.argv[2]);
const plan = JSON.parse(fs.readFileSync(path.join(root,'plan.json')));
const layouts = [];
for (const split of ['training','validation','development']) {
  for (const seed of plan[split+'Seeds']) {
    layouts.push({seed,split,map:JSON.parse(fs.readFileSync(path.join(root,`layout-${seed}.json`)))});
  }
}
const groups = new Map();
for (const layout of layouts) {
  const hash = outcomeLayoutHash(layout.map);
  if (!groups.has(hash)) groups.set(hash,[]);
  groups.get(hash).push({seed:layout.seed,split:layout.split});
}
console.log('PHYSICAL_LAYOUT_GROUPS: '+JSON.stringify([...groups]));
assert.throws(()=>assertDisjointOutcomeLayouts(layouts), /physical layout overlap/);
const trainingHashes = new Set(layouts.filter(row=>row.split==='training').map(row=>outcomeLayoutHash(row.map)));
assert(layouts.filter(row=>row.split!=='training').every(row=>trainingHashes.has(outcomeLayoutHash(row.map))));
const first = layouts[0];
const metadataOnly = JSON.parse(JSON.stringify(first));
metadataOnly.seed += 1;
metadataOnly.map.testName = 'changed diagnostic name';
metadataOnly.map.economyGenerator.seed += 1;
assert.equal(outcomeLayoutHash(first.map),outcomeLayoutHash(metadataOnly.map));
assert.throws(()=>assertDisjointOutcomeLayouts([first,metadataOnly]),/physical layout overlap/);
const different = layouts.find(layout=>outcomeLayoutHash(layout.map)!==outcomeLayoutHash(first.map));
assert(different);
assertDisjointOutcomeLayouts([first,different]);
const reordered = Object.fromEntries(Object.entries(first.map).reverse());
assert.equal(outcomeLayoutHash(first.map),outcomeLayoutHash(reordered));
console.log('LAYOUT_CONTROLS: PASS physical overlap rejected; seed/name metadata and object key order ignored; distinct generated physical states accepted');
console.log('PILOT_VALIDITY: FAIL all four validation/development layouts overlap training; archived 3/4 is not unseen-layout improvement');
