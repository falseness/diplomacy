const assert=require('assert').strict;
const fs=require('fs');
const path=require('path');
const {spawnSync}=require('child_process');
const {createFixture}=require('./test-coop-harness');
const {initialEntities}=require('./test-coop-generation-fixtures');
const {createEntityLedger}=require('./test-coop-entity-ledger');
const {createEconomyLedger}=require('./test-coop-economy-ledger');
const {audit,neighbours}=require('./test-coop-terrain-audit');
const index=process.argv.indexOf('--output-dir');
const out=path.resolve(index<0?'artifacts/TASK-121':process.argv[index+1]);
fs.mkdirSync(out,{recursive:true});
const f=createFixture(undefined,()=>{}), rows=[];
for(const size of ['tiny','normal','big']) for(let count=1;count<=12;count++) for(let seed=0;seed<32;seed++) {
  const label=`${size}-humans-${count}-seed-${seed}`;
  f.evaluate(`globalThis.generated=generateCoopGame(${count},{size:'${size}',seed:${seed}})`);
  const map=f.evaluate('JSON.parse(JSON.stringify(generated))');
  if(process.argv.includes('--missing')) map.lakes=[];
  if(process.argv.includes('--overlap')) map.bushes[0]={...map.mountains[0]};
  if(process.argv.includes('--unclustered')) {
    const wanted=map.bushes.length, key=c=>`${c.x},${c.y}`;
    const occupied=new Set([...map.mountains,...map.lakes,...map.portals,...map.goldmines].map(key));
    map.bushes=[];
    for(let x=0;x<map.mapSize.x&&map.bushes.length<wanted;x++) for(let y=0;y<map.mapSize.y&&map.bushes.length<wanted;y++) {
      const c={x,y};
      if(occupied.has(key(c))||map.players.flatMap(p=>p.towns).some(t=>Math.abs(t.x-x)<=1&&Math.abs(t.y-y)<=1)||map.bushes.some(b=>neighbours(b).some(n=>key(n)===key(c))))continue;
      map.bushes.push(c);
    }
    assert.equal(map.bushes.length,wanted,'probe preserves density');
  }
  const row=audit(map,label);
  // Independent seeded roster: repair may move resources and portals but must
  // preserve every starting town and all starting assets.
  const side=Math.max({tiny:11,normal:15,big:21}[size],Math.ceil({tiny:15,normal:25,big:39}[size]*Math.sqrt(count/4)));
  assert.deepEqual(map.mapSize,{x:side,y:side},label+' formula-dimensions');
  const expectedCount=count*{tiny:1,normal:2,big:3}[size];
  const observedCounts={neutralTowns:map.players[0].towns.length,goldmines:map.goldmines.length,portals:map.portals.length};
  assert.deepEqual(observedCounts,{neutralTowns:expectedCount,goldmines:expectedCount,portals:expectedCount},label+' exact-counts');
  assert(map.goldmines.every(m=>m.owner===0&&m.income===20),label+' unchanged-mine-rules');
  assert(map.players.slice(1,count+1).every(p=>p.gold===100&&p.towns.length===1&&p.units.length===0),label+' equal-start-assets');
  const hash=value=>require('crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const repeated=f.evaluate(`JSON.parse(JSON.stringify(generateCoopGame(${count},{size:'${size}',seed:${seed}})))`);
  row.replayHashes={expected:hash(map),observed:hash(repeated)};
  assert.equal(row.replayHashes.observed,row.replayHashes.expected,label+' seeded-replay');
  row.dimensions={expected:{x:side,y:side},observed:map.mapSize};
  row.counts={expected:expectedCount,observed:observedCounts};
  row.startingRosterPreserved=true;row.seededReplay=true;
  if(seed===0) {
    f.context.fixtureConfig={actors:[{role:'neutral'},...Array.from({length:count},()=>({role:'human'})),{role:'demon'}]};
    f.evaluate(`generated.start({clearValues(){external=[];externalProduction=[];nature=[];goldmines=[];gameRound=0;gameExit=false;},updateCameraBorders(){}},false);whooseTurn=1;actionManager.clear()`);
    const initial=initialEntities(map), entities=createEntityLedger(f,initial);
    const economy=createEconomyLedger(f,[{role:'neutral',gold:0},...Array.from({length:count},()=>({role:'human',gold:100})),{role:'demon',gold:0}],{income:{town:4},salary:{noob:1},purchase:{},production:{}});
    entities.check(label+'-started');economy.check(label+'-started');
    f.evaluate('globalThis.savedTerrain=JSON.stringify(getGameObject());loadFromJson(savedTerrain)');
    assert.equal(f.evaluate('JSON.stringify(getGameObject())===savedTerrain'),true);
    row.runtimeStartAndExactRestore=true;
  }
  rows.push(row);console.log(JSON.stringify(row));console.log('PASS terrain '+label);
}
for(const [arg,marker] of [['--missing','density-lakes'],['--overlap','disjoint'],['--unclustered','clustered-bushes']]) {
  const result=spawnSync(process.execPath,[__filename,arg,'--output-dir',out],{encoding:'utf8',timeout:30000});
  console.log(`DELIBERATE CORRUPTION ${arg}\n${result.stdout}${result.stderr}`);
  assert.equal(result.status,1);assert(result.stderr.includes(marker));
  console.log(`PASS corruption-probe ${arg} expected_exit=1 observed_exit=${result.status} marker=${marker}`);
}
fs.writeFileSync(path.join(out,'terrain-matrix.json'),JSON.stringify(rows,null,2)+'\n');
console.log('PASS terrain matrix=1152 sizes=tiny,normal,big humans=1..12 seeds=0..31 density=8/6/10+/-2 clustered>=80% preserved_rosters=1152 seeded_replays=1152 start_restore=36');
