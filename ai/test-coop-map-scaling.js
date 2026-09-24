const assert = require('assert').strict;
const {getCoopMapScaling, getCoopMapScalingFromMetadata} = require('./coop-map-scaling');
const {createFixture} = require('./test-coop-harness');
const {spawnSync} = require('child_process');
const sides = {
  tiny: [11,11,13,15,17,19,20,22,23,24,25,26],
  normal: [15,18,22,25,28,31,34,36,38,40,42,44],
  big: [21,28,34,39,44,48,52,56,59,62,65,68]
};
function compare(name, observed, expected) {
  console.log(JSON.stringify({name, expected, observed}));
  assert.deepEqual(observed, expected, name);
  console.log('PASS '+name);
}
const smoke = require('./smokeHarness').loadAiScripts();
compare('smoke-shared-source',require('vm').runInContext('getCoopMapScaling(12).side',smoke.context),44);
const f = createFixture(undefined, () => {});
for (const [size, table] of Object.entries(sides)) {
  const multiplier = {tiny:1,normal:2,big:3}[size];
  const base = {tiny:15,normal:25,big:39}[size];
  const minimum = {tiny:11,normal:15,big:21}[size];
  let previousArea = 0;
  for (let h=1;h<=12;h++) {
    const side=table[h-1], area=side*side;
    // Independent integer rounding, with no sqrt or production constants.
    // Three melee/ranged and one siege/heavy/support/chaos portal per human.
    const expected={size,initialHumanCount:h,side,mapSize:{x:side,y:side},area,
      counts:{humanTowns:h,neutralTowns:h*multiplier,goldmines:h*multiplier,portals:10*h,
        portalCategories:{melee:3*h,ranged:3*h,siege:h,heavy:h,support:h,chaos:h},
        mountains:Math.floor((area*8+50)/100),lakes:Math.floor((area*6+50)/100),bushes:Math.floor((area*10+50)/100)},
      startingAssets:{gold:100,towns:1,units:1}};
    if (process.argv.includes('--corrupt')) expected.side++;
    const actual=getCoopMapScaling(h,size);
    compare(`${size}-H${h}-independent-table`,actual,expected);
    compare(`${size}-H${h}-monotonic-rounding-minimum`, {
      monotonic:actual.area>=previousArea, minimum:actual.side>=minimum,
      upper:4*actual.side**2>=base**2*h,
      lower:actual.side===minimum || 4*(actual.side-1)**2<base**2*h
    }, {monotonic:true,minimum:true,upper:true,lower:true});
    previousArea=actual.area;
    compare(`${size}-H${h}-browser-shared-source`,f.evaluate(`getCoopMapScaling(${h},'${size}')`),expected);
    const coop={initialHumanCount:h,humanSlots:[],survivingHumanCount:0,
      generation:{version:4,playerCount:h,seed:4294967295,size,options:{seed:4294967295,size}}};
    const snapshot=JSON.stringify(coop);
    compare(`${size}-H${h}-initial-roster-only`,getCoopMapScalingFromMetadata(coop),expected);
    compare(`${size}-H${h}-pure-metadata`,JSON.stringify(coop),snapshot);
    actual.counts.portals=-1; actual.mapSize.x=0;
    compare(`${size}-H${h}-detached-result`,getCoopMapScaling(h,size),expected);
  }
}
compare('default-normal',getCoopMapScaling(1),getCoopMapScaling(1,'normal'));
for (const count of [undefined,null,0,13,-1,1.5,'2',NaN,Infinity,-Infinity,{},[],true,2n]) {
  assert.throws(()=>getCoopMapScaling(count),/integer from 1 to 12/);
  console.log(`PASS reject-count ${String(count)} type=${typeof count}`);
}
for (const size of [null,false,0,[],{},'', 'Tiny','Normal','medium','huge','constructor','__proto__']) {
  assert.throws(()=>getCoopMapScaling(4,size),/Co-op size must be/);
  console.log(`PASS reject-preset ${JSON.stringify(size)}`);
}
for (const coop of [null,{}, {initialHumanCount:2,generation:{}},
  ...[{seed:-1},{seed:1.5},{seed:4294967296},{version:0},{version:1.5},{playerCount:1},{size:undefined}]
    .map(change=>({initialHumanCount:2,generation:{version:4,seed:1,playerCount:2,size:'normal',...change}}))]) {
  assert.throws(()=>getCoopMapScalingFromMetadata(coop),/original generation metadata/);
}
console.log('PASS invalid-generation-metadata rejected=10');
// Exercise existing metadata storage, including seed zero, through real start/load.
for (const size of ['tiny','normal','big']) {
  f.evaluate(`globalThis.generated=generateCoopGame(2,{size:'${size}',seed:0});
    generated.start({clearValues(){external=[];externalProduction=[];nature=[];goldmines=[];gameRound=0;gameExit=false;},updateCameraBorders(){}},false);
    whooseTurn=1;actionManager.clear();
    gameSettings.coop.humanSlots=[1];
    globalThis.saved=JSON.stringify(getGameObject());loadFromJson(saved);`);
  compare(`${size}-saved-replay-inputs`,f.evaluate('gameSettings.coop.generation'),
    {version:4,playerCount:2,seed:0,size,options:{seed:0,size}});
  compare(`${size}-saved-initial-count`,f.evaluate('getCoopMapScalingFromMetadata(gameSettings.coop)'),getCoopMapScaling(2,size));
  compare(`${size}-exact-save-load`,f.evaluate('JSON.stringify(getGameObject())===saved'),true);
}
const probe=spawnSync(process.execPath,[__filename,'--corrupt'],{encoding:'utf8'});
console.log('BEGIN deliberate corruption probe');
process.stdout.write(probe.stdout);process.stderr.write(probe.stderr);
console.log('END deliberate corruption probe actual_exit_status='+probe.status);
assert.equal(probe.status,1);assert.match(probe.stderr,/tiny-H1-independent-table/);
console.log('PASS corruption-probe expected_exit=1 observed_exit=1 marker=tiny-H1-independent-table');
console.log('PASS co-op map scaling presets=3 humans=1..12 independent_cases=36 metadata_save_load=3');
