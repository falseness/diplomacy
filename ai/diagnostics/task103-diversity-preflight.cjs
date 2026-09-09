// Read-only data diagnosis. Deliberately imports no model/trainer/benchmark.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {createRuntimeContext, loadBrowserScripts} = require('../gamestart-simple-economy-completion');

const ROOT = path.resolve('artifacts/TASK-103');
const FIELDS = ['mapSize', 'players', 'goldmines', 'lakes', 'mountains', 'bushes', 'hills', 'suddenDeathRound'];
const EXCLUDED = new Set(['node_modules', '.git', 'before-source', 'after-source', 'parent-runtime']);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) :
  value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const identity = (map, physicalOnly = false) => hash(JSON.stringify(canonical(Object.fromEntries(
  FIELDS.filter(field => !physicalOnly || field !== 'suddenDeathRound').map(field => [field, map[field]])))));

function main() {
  assert(process.argv[2], 'fresh output directory required');
  const output = path.resolve(process.argv[2]);
  assert(output.startsWith(ROOT + path.sep), 'evidence must stay under TASK-103');
  fs.mkdirSync(output); // Never overwrite an earlier run.
  const write = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
  const plan = {
    hypothesis: 'physical repetition invalidates numeric seed separation, including inherited weights',
    construction: 'stage2 seed10311000 plus one boundary hill, all other physical inputs fixed',
    entries: Array.from({length:12}, (_, index) => ({index,
      split:index < 8 ? 'training' : index < 10 ? 'validation' : 'development',
      hill:index < 9 ? {x:index,y:0} : {x:index-9,y:6}})),
    minimumSplitSizes:{training:8, validation:2, development:2}, sides:[1,2],
    budgets:{action:30,command:60,round:1200,suddenDeath:500}, startingGold:110,
    decision:'unknown provenance or collision => stop; no games, fit, model load or replacements'
  };
  write('plan.json', plan);
  console.log('PLAN_FROZEN: ' + hash(fs.readFileSync(path.join(output,'plan.json'))));
  const inputs = [], maps = [], excluded = [], errors = [];
  function visit(value, file, pointer) {
    if (!value || typeof value !== 'object') return;
    if (value.mapSize && Number.isInteger(value.mapSize.x) && Number.isInteger(value.mapSize.y) &&
        Array.isArray(value.players) && value.players.every(player => player && Array.isArray(player.towns))) {
      const missingTypes = [];
      value.players.forEach((player, p) => (player.units || []).forEach((unit, u) => {
        if (typeof unit.type !== 'string' || !unit.type) missingTypes.push(`/players/${p}/units/${u}/type`);
      }));
      maps.push({file,pointer,map:value,missingTypes});
      return;
    }
    // Numeric tensor leaves cannot contain GameMap inputs.
    if (Array.isArray(value) && typeof value[0] === 'number') return;
    for (const [key, child] of Object.entries(value)) visit(child,file,`${pointer}/${key}`);
  }
  function scan(directory) {
    for (const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      const file = path.join(directory,entry.name);
      if (file === output || entry.isSymbolicLink() || EXCLUDED.has(entry.name)) {excluded.push(file);continue;}
      if (entry.isDirectory()) scan(file);
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        const bytes = fs.readFileSync(file);
        inputs.push({file,bytes:bytes.length,sha256:hash(bytes)});
        try {visit(JSON.parse(bytes),file,'');} catch (error) {errors.push({file,error:error.message});}
      }
    }
  }
  scan(ROOT);
  write('input-files.json',inputs); write('excluded.json',excluded); write('parse-errors.json',errors);

  const frozen = JSON.parse(fs.readFileSync(path.join(ROOT,'economy-development/source-sha256.json')));
  const generator = 'ai/generateMap.js';
  assert.equal(hash(fs.readFileSync(generator)),frozen[generator], 'inherited generator differs from frozen source');
  const context = createRuntimeContext(10311000);
  loadBrowserScripts(context);
  function generate(seed) {
    context.__seed = seed;
    return JSON.parse(new vm.Script(`JSON.stringify(generateEconomyStage2TrainingMap({seed:__seed}),
      (key,value) => typeof value === 'function' ? value.name : value)`).runInContext(context));
  }
  const recovered = [];
  for (const row of maps) {
    const seed = row.map.economyGenerator && row.map.economyGenerator.seed;
    if (!Number.isInteger(seed) || row.map.economyGenerator.stage !== 2) continue;
    const regenerated = generate(seed);
    // Compare the complete saved object to the same lossy serialization;
    // never recover merely because its seed or metadata matches.
    const lossy = JSON.parse(JSON.stringify(regenerated));
    lossy.players.forEach(player => (player.units || []).forEach(unit => delete unit.type));
    if (JSON.stringify(canonical(lossy)) !== JSON.stringify(canonical(row.map))) continue;
    row.map = regenerated; row.missingTypes = []; row.recovered = 'frozen stage2 generator, exact saved-object equality';
    recovered.push({file:row.file,pointer:row.pointer,seed,sha256:identity(regenerated)});
  }
  const ancestryPlan = JSON.parse(fs.readFileSync(path.join(ROOT,'economy-development/experiment/plan.json')));
  const ancestry = [];
  for (const split of ['training','validation']) for (const seed of ancestryPlan[split+'Seeds']) {
    const map = generate(seed);
    ancestry.push({split,seed,map,sha256:identity(map)});
    maps.push({file:'reconstructed economy-development '+split,pointer:String(seed),map,missingTypes:[],
      recovered:'generator input recovery only; training startup overrides require separate validation'});
  }
  write('ancestry-startup-candidates.json',ancestry); write('recovered.json',recovered);
  const groups = {};
  for (const row of maps) {
    row.inputHash = identity(row.map); row.geometryHash = identity(row.map,true);
    (groups[row.geometryHash] ||= []).push({file:row.file,pointer:row.pointer,incomplete:!!row.missingTypes.length});
  }
  write('maps.json',maps); write('physical-groups.json',groups);
  const base = generate(10311000);
  const metadata = JSON.parse(JSON.stringify(base)); metadata.testName = 'metadata-control'; metadata.economyGenerator.seed++;
  assert.equal(identity(base),identity(metadata));
  assert.equal(identity(base),identity(Object.fromEntries(Object.entries(base).reverse())));
  const order = JSON.parse(JSON.stringify(base)); order.players[1].units.reverse();
  assert.notEqual(identity(base),identity(order));
  const type = JSON.parse(JSON.stringify(base)); type.players[1].units[0].type = 'Archer';
  assert.notEqual(identity(base),identity(type));
  console.log('IDENTITY_CONTROLS: PASS metadata/key order ignored; entity order and explicit unit type retained');
  console.log('RECOVERY: ' + JSON.stringify({savedMaps:recovered.length,inheritedGeneratorInputs:ancestry.length,generatorSha256:frozen[generator]}));
  console.log('CORPUS: ' + JSON.stringify({jsonFiles:inputs.length,mapRecords:maps.length,
    distinctGeometryHashes:Object.keys(groups).length,duplicateGroups:Object.values(groups).filter(rows=>rows.length>1).length,
    incompleteTypeRecords:maps.filter(row=>row.missingTypes.length).length,parseErrors:errors.length}));
  console.log('CAPACITY: FAIL old stage2 fixed geometry has at most 2 types x 4 HP = 8 physical maps; minimum required12');
  const missing = [
    'No complete prior-exposure manifest: JSON scan cannot cover compressed trajectories, external storage or unrecorded acceptance inputs.',
    'Inherited generator inputs recovered, but full frozen collector startup and runtime round-trip equality are not established.',
    'Prior benchmark class/slot and sudden-death overrides are not bound to every saved map object.',
    ...maps.filter(row=>row.missingTypes.length).map(row=>`${row.file}#${row.pointer}: missing runtime types ${row.missingTypes.join(',')}`),
    ...errors.map(row=>`${row.file}: parse error ${row.error}`)
  ];
  write('missing-provenance.json',missing);
  write('decision.json',{eligible:false,missing,proposedRuntimeValidation:'NOT RUN: incomplete prior provenance',
    modelLoads:0,games:0,fits:0,taskStatus:'pending'});
  console.log('PREFLIGHT: FAIL incomplete exposure/startup provenance; details in missing-provenance.json');
  console.log('NO_FIT: PASS modelLoads=0 games=0 fits=0; no training continuation exists');
  process.exitCode = 2;
}
main();
