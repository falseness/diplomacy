// Usage: node ai/test-coop-map-sizes.js [--output-dir DIR] [--seeds N] [--humans 1,2,4,12] [--matrix] [--corrupt]
// --output-dir writes runtime-matrix.json (seed 0, humans 1/4/12 per size) and save-roundtrip.txt.
// --matrix runs only those matrix cases. Big/12 generation takes ~10-25 s here, so the
// default case set is seeds 0..1 at humans 1,2,4,12 rather than every seed and count.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');
const {createFixture} = require('./test-coop-harness');

const option = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const outputDir = option('--output-dir');
const matrixOnly = process.argv.includes('--matrix');
const seedCount = Number(option('--seeds') || 2);
const humanCounts = matrixOnly ? [1, 4, 12] : (option('--humans') || '1,2,4,12').split(',').map(Number);
const MATRIX_HUMANS = [1, 4, 12];
// Literal public contract, independent of production preset/placement helpers.
// Baseline radius: smallest R >= min with R*R >= scale*scale*humans; growth adds at most 8.
const radiusPreset = {tiny:{min:10, scale:8}, normal:{min:13, scale:11}, big:{min:16, scale:14}};
const baselineFor = (size, count) => { const p = radiusPreset[size]; let R = p.min; while (R*R < p.scale*p.scale*count) R++; return R; };
const multiplier = {tiny:1, normal:2, big:3};
const layerOf = (c, R) => { const q = c.x - R, r = c.y - Math.floor(c.x/2) - Math.ceil(R/2);
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)); };
// Circle terrain follows 8/6/10% density within 2 points of the playable hex area.
const terrainWithin = (actual, area, percent) => Math.abs(actual - Math.round(area*percent/100)) <= area*0.02;
const f = createFixture(undefined, () => {});
function compare(label, observed, expected) {
  assert.deepEqual(observed, expected, label);
  console.log(JSON.stringify({scenario:label, expected, observed}));
  console.log('PASS '+label);
}
const sha = text => require('crypto').createHash('sha256').update(text).digest('hex');
const hash = value => sha(JSON.stringify(value));
// Runs in the vm: mask membership, playable cells and portal cells of the live grid.
const scanGrid = `(() => {
  const s = gameSettings.mapShape; let maskCells = 0, playableCells = 0, maskMismatches = 0;
  for (let x = 0; x < grid.arr.length; x++) for (let y = 0; y < grid.arr[x].length; y++) {
    const edge = grid.arr[x][y].building.isMapEdge === true, outside = coopHexLayer(x, y, s.center) > s.radius;
    if (edge !== outside) maskMismatches++;
    edge ? maskCells++ : playableCells++;
  }
  const portals = external.filter(p => p.isDemonPortal);
  return {maskCells, playableCells, maskMismatches, portals: portals.length,
    portalsOnMaskedCells: portals.filter(p => grid.arr[p.coord.x][p.coord.y].building !== p ||
      coopHexLayer(p.coord.x, p.coord.y, s.center) > s.radius).length};
})()`;
const matrix = [], roundtrips = [];
let cases = 0;
for (const size of Object.keys(radiusPreset)) {
  for (const count of humanCounts) for (let seed=0; seed<(matrixOnly ? 1 : seedCount); seed++) {
    cases++;
    const label = `${size}-humans-${count}-seed-${seed}`, resources = count*multiplier[size];
    f.evaluate(`globalThis.generated=generateCoopGame(${count},{size:'${size}',seed:${seed}});`);
    const map = f.evaluate('JSON.parse(JSON.stringify(generated))');
    if (process.argv.includes('--corrupt')) map.mapSize.x++;
    const R = map.mapShape.radius, side = 2*R+1, area = 3*R*R+3*R+1, baseline = baselineFor(size, count);
    compare(label+'-radius-shape', {growthOk: Number.isInteger(R) && R >= baseline && R <= baseline+8, shape: map.mapShape},
      {growthOk: true, shape: {type:'hexagonal', center:{q:R, r:Math.ceil(R/2)}, radius:R, offset:{x:0, y:0}}});
    compare(label+'-dimensions', map.mapSize, {x:side,y:side});
    compare(label+'-metadata', map.coop.generation,
      {version:5,playerCount:count,seed,size,options:{seed,size}});
    // One replay from stored metadata; the metadata check above pins it to these inputs.
    compare(label+'-deterministic-replay', f.evaluate('JSON.stringify(generated) === JSON.stringify(generateCoopGame(generated.coop.generation.playerCount, generated.coop.generation.options))'), true);
    const towns = map.players.flatMap(p=>p.towns), humanTowns = map.players.slice(1,count+1).flatMap(p=>p.towns);
    const objects = [...towns,...map.goldmines,...map.portals,...map.lakes,...map.mountains,...map.bushes,...map.hills];
    compare(label+'-in-bounds-disjoint', {
      inBounds:objects.every(c=>Number.isInteger(c.x)&&Number.isInteger(c.y)&&c.x>=0&&c.y>=0&&c.x<side&&c.y<side&&layerOf(c,R)<=R),
      unique:new Set(objects.map(c=>`${c.x},${c.y}`)).size,
      counts:[towns.length,map.goldmines.length,map.portals.length],
      terrain:[terrainWithin(map.lakes.length,area,6),terrainWithin(map.mountains.length,area,8),terrainWithin(map.bushes.length,area,10),map.hills.length],
      reserved:objects.slice(towns.length).every(c=>towns.every(t=>Math.abs(c.x-t.x)>1||Math.abs(c.y-t.y)>1)),
      humanTownLayers:[...new Set(humanTowns.map(t=>layerOf(t,R)))],
      starts:map.players.slice(1,count+1).map(p=>[p.gold,p.towns.length,p.units.length])
    // TASK-151/269: ten typed portals per human; towns and goldmines keep the size multiplier.
    }, {inBounds:true,unique:objects.length,counts:[count+resources,resources,10*count],terrain:[true,true,true,0],reserved:true,
      humanTownLayers:[R-3], starts:Array.from({length:count},()=>[100,1,0])});
    const start = f.evaluate(`(() => { try {
      generated.start({clearValues() {external=[];externalProduction=[];nature=[];goldmines=[];gameRound=0;gameExit=false;},updateCameraBorders() {}}, false);
      return {threw:false, message:null};
    } catch (e) { return {threw:true, message:String(e && e.message)}; } })()`);
    compare(label+'-start-no-edge-overlap', start, {threw:false, message:null});
    const started = f.evaluate(scanGrid);
    f.evaluate(`whooseTurn=1;actionManager.clear();globalThis.saved=JSON.stringify(getGameObject());globalThis.savedShape=JSON.stringify(gameSettings.mapShape);loadFromJson(saved);`);
    const loaded = f.evaluate(scanGrid);
    const expectedScan = {maskCells:R*R+R, playableCells:area, maskMismatches:0, portals:10*count, portalsOnMaskedCells:0};
    compare(label+'-runtime-mask-started', started, expectedScan);
    compare(label+'-runtime-mask-loaded', loaded, expectedScan);
    compare(label+'-saved-metadata', f.evaluate('gameSettings.coop.generation'),
      {version:5,playerCount:count,seed,size,options:{seed,size}});
    compare(label+'-runtime-dimensions', f.evaluate('[grid.arr.length, ...new Set(grid.arr.map(column=>column.length))]'), [side,side]);
    const shapes = f.evaluate('({generated:JSON.stringify(generated.mapShape), saved:savedShape, stored:JSON.stringify(JSON.parse(saved).gameSettings.mapShape), loaded:JSON.stringify(gameSettings.mapShape)})');
    compare(label+'-map-shape-save-load', shapes, {generated:JSON.stringify(map.mapShape), saved:JSON.stringify(map.mapShape),
      stored:JSON.stringify(map.mapShape), loaded:JSON.stringify(map.mapShape)});
    const after = f.evaluate('JSON.stringify(getGameObject())'), saved = f.evaluate('saved');
    compare(label+'-exact-save-load', after === saved, true);
    console.log(JSON.stringify({scenario:label+'-placements',towns,portals:map.portals,mapHash:hash(map),savedHash:hash(JSON.parse(saved))}));
    if (seed === 0 && MATRIX_HUMANS.includes(count)) {
      matrix.push({size, humans:count, seed, gridDims:[side,side], maskCells:loaded.maskCells, expectedMask:R*R+R,
        maskMismatches:started.maskMismatches+loaded.maskMismatches, playableCells:loaded.playableCells, expectedPlayable:area,
        portalsOnMaskedCells:started.portalsOnMaskedCells+loaded.portalsOnMaskedCells, startThrew:start.threw, exactSaveLoad:after === saved});
      roundtrips.push(`${label} radius=${R}\n  before sha256=${sha(saved)}\n  after  sha256=${sha(after)}\n  equal=${sha(saved) === sha(after)}\n  gameSettings.mapShape=${shapes.stored}\n`);
    }
  }
}
if (outputDir) {
  fs.mkdirSync(outputDir, {recursive:true});
  fs.writeFileSync(path.join(outputDir, 'runtime-matrix.json'), JSON.stringify(matrix, null, 1) + '\n');
  fs.writeFileSync(path.join(outputDir, 'save-roundtrip.txt'),
    'sha256 of JSON.stringify(getGameObject()) after GameMap.start (before) and after loadFromJson(before) (after)\n' + roundtrips.join(''));
}
if (matrixOnly) {
  console.log(`PASS co-op runtime matrix cases=${cases}`);
  process.exit(0);
}
compare('default-normal',f.evaluate('JSON.parse(JSON.stringify(generateCoopGame(1)))'),
  f.evaluate('JSON.parse(JSON.stringify(generateCoopGame(1,{size:"normal",seed:1})))'));
for (const size of ['null','false','0','15','[]','{}','""','"Tiny"','"medium"','"huge"','"constructor"','"__proto__"']) {
  compare('reject-size-'+size,f.evaluate(`(()=>{const before=JSON.stringify(getGameObject());let rejected=false;try{generateCoopGame(2,{size:${size}})}catch(e){rejected=/Co-op size must be/.test(e.message)}return {rejected,unchanged:JSON.stringify(getGameObject())===before}})()`),{rejected:true,unchanged:true});
}
// Old co-op wire data has a rectangular stored grid and no generation metadata. Since TASK-120
// the loader rejects it before touching the board; generation throws, so it cannot regenerate.
const legacy = createFixture({coop:true,size:{x:11,y:9},actors:[
  {role:'neutral',rgb:{r:100,g:100,b:100},gold:0,towns:[],units:[]},
  {role:'human',rgb:{r:255,g:0,b:0},gold:123,towns:[],units:[{x:8,y:6,hp:2}]},
  {role:'demon',rgb:{r:160,g:40,b:180},gold:0,economyEnabled:false,towns:[],units:[]}
]},()=>{});
// The harness declares fixture generation metadata (TASK-243); strip it to model old wire data.
compare('legacy-coop-rejected-no-regeneration',legacy.evaluate(`(()=>{const before=JSON.stringify(getGameObject());
  const game=JSON.parse(before);delete game.gameSettings.coop.generation;
  let regenerated=false;generateCoopGame=()=>{regenerated=true;throw new Error('unexpected regeneration')};
  let message=null;try{loadFromJson(JSON.stringify(game))}catch(e){message=e.message}
  return {message,regenerated,unchanged:JSON.stringify(getGameObject())===before,dimensions:[grid.arr.length,grid.arr[0].length],unit:[players[1].units[0].coord.x,players[1].units[0].coord.y]}})()`),
  {message:'Co-op scaling requires original generation metadata',regenerated:false,unchanged:true,dimensions:[11,9],unit:[8,6]});
const probe=spawnSync(process.execPath,[__filename,'--corrupt','--seeds','1','--humans','1'],{encoding:'utf8'});
process.stdout.write(probe.stdout); process.stderr.write(probe.stderr);
assert.equal(probe.status,1); assert.match(probe.stderr,/tiny-humans-1-seed-0-dimensions/);
console.log('PASS size-corruption-probe expected_exit=1 observed_exit=1 marker=tiny-humans-1-seed-0-dimensions');
console.log(`PASS co-op map sizes combinations=${cases} sizes=tiny,normal,big humans=${humanCounts} seeds=0..${seedCount-1} save_load=${cases} runtime_mask=${cases} legacy=rejected`);
