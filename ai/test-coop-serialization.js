const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger, committedSnapshot, compareCommitted} = require('./test-coop-turn-ledger');

// Independent literal fixture, including damaged health for every demon class.
const demons = [
  ['imp', 'Imp', 1], ['clawling', 'Clawling', 2], ['hound', 'Hound', 3],
  ['brute', 'Brute', 9], ['bulwark', 'Bulwark', 15], ['spitter', 'Spitter', 1],
  ['emberArcher', 'EmberArcher', 3], ['hexcaster', 'Hexcaster', 4],
  ['ravager', 'Ravager', 7], ['demonLord', 'DemonLord', 19]
];
function setup(count, coop = true) {
  const config = {coop, size: {x:23, y:9}, actors: [
    {role:'neutral', rgb:{r:100,g:100,b:100}, gold:0, towns:[], units:[]},
    ...Array.from({length:count}, (_, i) => ({role:'human', rgb:{r:200-i*30,g:30+i*30,b:40},
      gold:101+i*37, towns:[], units:[{x:1+i*2,y:1,hp:2}]})),
    ...(coop ? [{role:'demon',rgb:{r:160,g:40,b:180},gold:0,economyEnabled:false,towns:[],units:[]}] : [])
  ]};
  const f = createFixture(config);
  f.evaluate('globalThis.turnEvents = [];');
  const initial = Array.from({length:count}, (_, i) =>
    ({id:`human-${i+1}`,kind:'unit',name:'noob',owner:i+1,x:1+i*2,y:1}));
  let entities = createEntityLedger(f, initial);
  const economy = createEconomyLedger(f, config.actors.map(({role,gold}) => ({role,gold})), {});
  const turns = createTurnLedger(Array.from({length:count}, (_,i) => i+1));
  function check(label) {
    entities.check(label+'-entities');
    economy.check(label+'-economy');
    turns.check(label+'-turn', f.evaluate(`({round:gameRound,terminal:gameExit,
      events:[{type:'human',round:gameRound,player:whooseTurn}]})`), 0);
  }
  function reload(json, expected = entities.expected()) {
    // Expectations replay declared events, never the loaded runtime.
    f.context.saveInput = json;
    f.evaluate('loadFromJson(saveInput);');
    entities = createEntityLedger(f, expected);
  }
  return {f, check, reload, get entities() {return entities;}};
}
function runCoop(count, fault) {
  const s = setup(count), {f, check} = s;
  const prefix = `coop-${count}`;
  const expectedUnits = Array.from({length:count}, (_, i) => ({id:i === 0 ? 0 : `human-${i+1}`,
    name:'noob', className:'Noob', owner:i+1, x:1+i*2,y:1,hp:2,moves:2,wasHitted:false}));
  f.context.unitIdentities = expectedUnits;
  f.evaluate('for (const u of unitIdentities) { grid.getUnit(u).id = u.id; grid.getUnit(u).wasHitted = false; }');
  check(prefix+'-initial');
  for (const [i, [name, className, hp]] of demons.entries()) {
    const row = {id:`demon-${name}`,kind:'unit',name,owner:count+1,x:1+i*2,y:4};
    f.evaluate(`globalThis.born = new ${className}(${row.x},4); born.id = '${row.id}';
      born.hp = ${hp}; born.moves = 0; born.wasHitted = true; born.updateHPBar(); undefined`);
    s.entities.record({type:'spawn',entity:row}); s.entities.bind(row.id, 'born');
    expectedUnits.push({id:row.id,name,className,owner:count+1,x:row.x,y:4,hp,moves:0,wasHitted:true});
    check(prefix+'-spawn-'+name);
  }
  for (const [x,hp] of [[5,17],[15,1]]) {
    f.evaluate(`globalThis.born = new DemonPortal(${x},7); born.hit(${30-hp}); undefined`);
    const row = {id:`portal-${x}`,kind:'portal',name:'demonPortal',owner:count+1,x,y:7};
    s.entities.record({type:'spawn',entity:row}); s.entities.bind(row.id,'born');
    check(prefix+'-portal-'+x);
  }
  function identity(label) {
    f.compare(label+'-identity', f.evaluate(`({coop:gameSettings.coop,
      roles:players.map(p=>p.role), teams:players.map(p=>p.team),
      neutral:players[0] instanceof NeutralPlayer, demon:players[${count+1}] instanceof DemonPlayer,
      gold:players.map(p=>p.gold),
      units:players.flatMap(p=>p.units.map(u=>({id:u.id,name:u.name,className:u.constructor.name,
        owner:u.playerColor,x:u.coord.x,y:u.coord.y,hp:u.hp,moves:u.moves,wasHitted:u.wasHitted}))),
      portals:external.map(p=>({name:p.name,owner:p.playerColor,x:p.coord.x,y:p.coord.y,hp:p.hp,wasHitted:p.wasHitted}))})`),
    {coop:{initialHumanCount:count,humanSlots:Array.from({length:count},(_,i)=>i+1),humanTeam:'HUMANS',demonSlot:count+1},
      roles:['NEUTRAL',...Array(count).fill('HUMAN'),'DEMONS'], teams:[0,...Array(count).fill('HUMANS'),'DEMONS'],
      neutral:true,demon:true,gold:[0,...Array.from({length:count},(_,i)=>101+i*37),0], units:expectedUnits,
      portals:[{name:'demonPortal',owner:count+1,x:5,y:7,hp:17,wasHitted:true},
        {name:'demonPortal',owner:count+1,x:15,y:7,hp:1,wasHitted:true}]});
    f.compare(label+'-unique-persisted-ids',f.evaluate('new Set(players.flatMap(p=>p.units.map(u=>u.id))).size'),count+10);
  }
  identity(prefix+'-before');
  f.submit({type:'move',source:{x:1,y:1},destination:{x:1,y:2}},[{x:1,y:2,hp:2,moves:1}],state=>state.players[1].units);
  s.entities.record({type:'move',id:'human-1',destination:{x:1,y:2}});
  Object.assign(expectedUnits[0],{y:2,moves:1}); check(prefix+'-move');
  f.evaluate('grid.getUnit({x:1,y:2}).hit(1);');
  Object.assign(expectedUnits[0],{hp:1,wasHitted:true}); check(prefix+'-damage');
  for (let revision=1; revision<=2; revision++) {
    const before = committedSnapshot(f, revision);
    let json = f.evaluate('JSON.stringify(getGameObject())');
    if (fault) {
      const packed = JSON.parse(json);
      if (fault === 'id') delete packed.players[1].units[0].id;
      if (fault === 'health') packed.players[count+1].units[9].hp--;
      if (fault === 'portal') packed.external[0].hp--;
      json = JSON.stringify(packed);
    }
    // First load into a separately initialized browser runtime, then repeat.
    const peer = setup(count);
    peer.reload(json, s.entities.expected());
    peer.check(prefix+'-peer-restored-'+revision);
    s.reload(json); check(prefix+'-roundtrip-'+revision);
    identity(prefix+'-roundtrip-'+revision);
    compareCommitted(prefix+'-saved-restored-'+revision,before,committedSnapshot(f,revision));
    compareCommitted(prefix+'-peer-'+revision,committedSnapshot(f,revision),committedSnapshot(peer.f,revision));
    f.compare(prefix+'-wire-stable-'+revision,JSON.parse(f.evaluate('JSON.stringify(getGameObject())')),JSON.parse(json));
  }
  console.log(`PASS ${prefix}-roundtrips types=10 portals=2 ids=${count+10} rounds=0 loads=4`);
}
function runLegacy() {
  const s = setup(2,false), {f,check} = s;
  check('legacy-initial');
  const json = f.evaluate('JSON.stringify(getGameObject())');
  const saved = JSON.parse(json);
  assert.ok(saved.players.every(p=>p.units.every(u=>!Object.prototype.hasOwnProperty.call(u,'id'))));
  s.reload(json); check('legacy-restored');
  f.compare('legacy-competitive-unchanged',JSON.parse(f.evaluate('JSON.stringify(getGameObject())')),saved);
  // Older format omits settings entirely. Load over co-op state to prove reset.
  delete saved.gameSettings;
  f.evaluate("gameSettings.coop = {humanSlots:[1,2],humanTeam:'HUMANS',demonSlot:3};");
  s.reload(JSON.stringify(saved)); check('legacy-no-settings');
  f.compare('legacy-default-settings',f.evaluate('gameSettings'),{isOnline:false});
  f.compare('legacy-no-settings-unchanged',f.evaluate(`(() => {const g=JSON.parse(JSON.stringify(getGameObject()));delete g.gameSettings;return g})()`),saved);
  f.compare('legacy-competitive-identity',f.evaluate(`({roles:players.map(p=>p.role),teams:players.map(p=>p.team),
    allied:players[1].isAlliedWith(players[2]),demon:players.some(p=>p instanceof DemonPlayer)})`),
    {roles:['NEUTRAL','HUMAN','HUMAN'],teams:[0,1,2],allied:false,demon:false});
}
if (process.argv[2] === '--fault') runCoop(2,process.argv[3]);
else {
  runCoop(2); runCoop(4); runLegacy();
  console.log('INAPPLICABLE online transport: matching fixture revisions compare full saved/restored and independent peer state; no network commits occur. No rounds advance: human order/round remain 1/0 with zero completed phases. No income, salary, purchases or production occur; independent balances and zero demon assets checked after each mutation/load. IDs are optional existing identities; ID-less legacy units stay ID-less.');
  for (const fault of ['id','health','portal']) {
    const child = spawnSync(process.execPath,[__filename,'--fault',fault],{encoding:'utf8',maxBuffer:16*1024*1024});
    process.stdout.write(child.stdout); process.stderr.write(child.stderr);
    assert.equal(child.status,1); assert.match(child.stderr,/AssertionError/);
    assert.match(child.stderr,/coop-2-roundtrip-1-identity/);
    console.log(`PASS rejects-${fault}-corruption expected_exit=1 observed_exit=${child.status}`);
  }
  console.log('PASS co-op serialization counts=2,4 types=10 legacy=2 fault_probes=3');
}
