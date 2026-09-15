const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture} = require('./test-coop-harness');

// Literal public contract, independent of production preset/placement helpers.
const dimensions = {tiny:15, normal:25, big:39};
const minimum = {tiny:11, normal:15, big:21}, multiplier = {tiny:1, normal:2, big:3};
// Divided Valley terrain follows 8/6/10% density within 2 points of area.
const terrainWithin = (actual, area, percent) => Math.abs(actual - Math.round(area*percent/100)) <= area*0.02;
const f = createFixture(undefined, () => {});
function compare(label, observed, expected) {
  assert.deepEqual(observed, expected, label);
  console.log(JSON.stringify({scenario:label, expected, observed}));
  console.log('PASS '+label);
}
const hash = value => require('crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex');
for (const [size, base] of Object.entries(dimensions)) {
  for (let count=1; count<=4; count++) for (let seed=0; seed<32; seed++) {
    const label = `${size}-humans-${count}-seed-${seed}`;
    const side = Math.max(minimum[size], Math.ceil(base*Math.sqrt(count/4))), area = side*side, resources = count*multiplier[size];
    f.evaluate(`globalThis.generated=generateCoopGame(${count},{size:'${size}',seed:${seed}});`);
    const map = f.evaluate('JSON.parse(JSON.stringify(generated))');
    if (process.argv.includes('--corrupt')) map.mapSize.x++;
    compare(label+'-dimensions', map.mapSize, {x:side,y:side});
    compare(label+'-metadata', map.coop.generation,
      {version:4,playerCount:count,seed,size,options:{seed,size}});
    compare(label+'-deterministic-replay', f.evaluate(`JSON.stringify(generated) === JSON.stringify(generateCoopGame(${count}, {size:'${size}',seed:${seed}})) && JSON.stringify(generated) === JSON.stringify(generateCoopGame(generated.coop.generation.playerCount, generated.coop.generation.options))`), true);
    const towns = map.players.flatMap(p=>p.towns);
    const objects = [...towns,...map.goldmines,...map.portals,...map.lakes,...map.mountains,...map.bushes,...map.hills];
    compare(label+'-in-bounds-disjoint', {
      inBounds:objects.every(c=>Number.isInteger(c.x)&&Number.isInteger(c.y)&&c.x>=0&&c.y>=0&&c.x<side&&c.y<side),
      unique:new Set(objects.map(c=>`${c.x},${c.y}`)).size,
      counts:[towns.length,map.goldmines.length,map.portals.length],
      terrain:[terrainWithin(map.lakes.length,area,6),terrainWithin(map.mountains.length,area,8),terrainWithin(map.bushes.length,area,10),map.hills.length],
      reserved:objects.slice(towns.length).every(c=>towns.every(t=>Math.abs(c.x-t.x)>1||Math.abs(c.y-t.y)>1)),
      starts:map.players.slice(1,count+1).map(p=>[p.gold,p.towns.length,p.units.length])
    }, {inBounds:true,unique:objects.length,counts:[count+resources,resources,resources],terrain:[true,true,true,0],reserved:true,
      starts:Array.from({length:count},()=>[100,1,0])});
    f.evaluate(`generated.start({clearValues() {external=[];externalProduction=[];nature=[];goldmines=[];gameRound=0;gameExit=false;},updateCameraBorders() {}}, false); whooseTurn=1;actionManager.clear();globalThis.saved=JSON.stringify(getGameObject());loadFromJson(saved);`);
    compare(label+'-saved-metadata', f.evaluate('gameSettings.coop.generation'),
      {version:4,playerCount:count,seed,size,options:{seed,size}});
    compare(label+'-runtime-dimensions', f.evaluate('[grid.arr.length, ...new Set(grid.arr.map(column=>column.length))]'), [side,side]);
    compare(label+'-exact-save-load',f.evaluate('JSON.stringify(getGameObject()) === saved'),true);
    console.log(JSON.stringify({scenario:label+'-placements',towns,portals:map.portals,mapHash:hash(map),savedHash:hash(f.evaluate('JSON.parse(saved)'))}));
  }
}
compare('default-normal',f.evaluate('JSON.parse(JSON.stringify(generateCoopGame(1)))'),
  f.evaluate('JSON.parse(JSON.stringify(generateCoopGame(1,{size:"normal",seed:1})))'));
for (const size of ['null','false','0','15','[]','{}','""','"Tiny"','"medium"','"huge"','"constructor"','"__proto__"']) {
  compare('reject-size-'+size,f.evaluate(`(()=>{const before=JSON.stringify(getGameObject());let rejected=false;try{generateCoopGame(2,{size:${size}})}catch(e){rejected=/Co-op size must be/.test(e.message)}return {rejected,unchanged:JSON.stringify(getGameObject())===before}})()`),{rejected:true,unchanged:true});
}
// Old co-op wire data has a rectangular stored grid, no generation metadata.
// Make generation throw: a successful exact restoration proves it was not used.
const legacy = createFixture({coop:true,size:{x:11,y:9},actors:[
  {role:'neutral',rgb:{r:100,g:100,b:100},gold:0,towns:[],units:[]},
  {role:'human',rgb:{r:255,g:0,b:0},gold:123,towns:[],units:[{x:8,y:6,hp:2}]},
  {role:'demon',rgb:{r:160,g:40,b:180},gold:0,economyEnabled:false,towns:[],units:[]}
]},()=>{});
legacy.evaluate(`globalThis.oldSave=JSON.stringify(getGameObject());generateCoopGame=()=>{throw new Error('unexpected regeneration')};loadFromJson(oldSave);`);
compare('legacy-coop-no-regeneration',legacy.evaluate(`({exact:oldSave===JSON.stringify(getGameObject()),dimensions:[grid.arr.length,grid.arr[0].length],metadataAbsent:!gameSettings.coop.generation,unit:[players[1].units[0].coord.x,players[1].units[0].coord.y]})`),{exact:true,dimensions:[11,9],metadataAbsent:true,unit:[8,6]});
const probe=spawnSync(process.execPath,[__filename,'--corrupt'],{encoding:'utf8'});
process.stdout.write(probe.stdout); process.stderr.write(probe.stderr);
assert.equal(probe.status,1); assert.match(probe.stderr,/tiny-humans-1-seed-0-dimensions/);
console.log('PASS size-corruption-probe expected_exit=1 observed_exit=1 marker=tiny-humans-1-seed-0-dimensions');
console.log('PASS co-op map sizes combinations=384 sizes=tiny,normal,big humans=1..4 seeds=0..31 save_load=384 legacy=passed');
