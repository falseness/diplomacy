const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture, defaultFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');

function run(eliminated = false, auditUndo = null) {
  const c = defaultFixture(); c.coop = true; c.size = {x:15,y:9};
  c.actors[0].towns = []; c.actors[1].units = [{x:5,y:3,hp:2}];
  c.actors[2].towns = [{x:1,y:7}]; c.actors[3].units = [{x:4,y:3,hp:2}];
  const f = createFixture(c);
  const initial = [
    {id:'t1',kind:'town',name:'town',owner:1,x:1,y:1},
    {id:'g1',kind:'unit',name:'noob',owner:1,x:1,y:1},
    {id:'t2',kind:'town',name:'town',owner:2,x:1,y:7},
    {id:'g2',kind:'unit',name:'noob',owner:2,x:1,y:7},
    {id:'target',kind:'unit',name:'noob',owner:1,x:5,y:3},
    {id:'attacker',kind:'unit',name:'noob',owner:3,x:4,y:3}
  ];
  // A remote portal with exactly one vacant radius cell. Its spawned units
  // cannot affect the one-action combat budget, consumed by the first demon.
  f.evaluate('new DemonPortal(12,4); undefined');
  initial.push({id:'portal',kind:'portal',name:'demonPortal',owner:3,x:12,y:4});
  function distance(x,y) {
    const z=y-(x-(x&1))/2, pz=4-6;
    return (Math.abs(x-12)+Math.abs(z-pz)+Math.abs(x+z-12-pz))/2;
  }
  for(let x=0;x<15;x++) for(let y=0;y<9;y++) {
    if(distance(x,y)>=1 && distance(x,y)<=2 && !(x===10&&y===3)) {
      f.evaluate(`new Mountain(${x},${y}); undefined`);
      initial.push({id:`m${x}-${y}`,kind:'nature',name:'mountain',owner:0,x,y});
    }
  }
  const entities = createEntityLedger(f,initial);
  const economy = createEconomyLedger(f,c.actors.map(({role,gold})=>({role,gold})),
    {income:{town:4,suburb:1},salary:{noob:1}});
  const turns = createTurnLedger([1,2]);
  let round=0, prefix=1, hits=0, incomeSerial=0;
  function check(label, skipUndoAudit = false) {
    entities.check(label+'-entities'); economy.check(label+'-economy');
    turns.check(label+'-turn',f.evaluate('({round:gameRound,terminal:gameExit,events:trace})'),round,false,prefix);
    if (auditUndo && !skipUndoAudit) auditUndo(f,label, suffix => check(label+suffix,true));
  }
  f.context.afterIncome = owner => {
    if (!(eliminated && owner===2)) {
      const id='income'+incomeSerial++;
      economy.record({id:id+'t',owner,type:'income',rule:'town',count:1});
      economy.record({id:id+'s',owner,type:'income',rule:'suburb',count:7});
      economy.record({id:id+'w',owner,type:'salary',rule:'noob',count:owner===1 && hits<2?2:1});
    }
    check('human-refresh-'+owner);
  };
  f.context.afterWave = result => {
    f.compare('wave-result-'+round,JSON.parse(JSON.stringify(result)),round===0 ?
      {spawned:[{type:'imp',x:10,y:3}],skipped:3} : {spawned:[],skipped:4});
    if(round===0) {
      entities.record({type:'spawn',entity:{id:'spawn',kind:'unit',name:'imp',owner:3,x:10,y:3}});
      entities.bind('spawn','grid.getUnit({x:10,y:3})');
    }
    prefix++; check('wave-'+round);
  };
  f.context.demonStarted = () => {prefix++; check('demon-start-'+round);};
  f.context.afterAction = () => {
    hits++;
    if(hits===2) {
      entities.record({type:'death',id:'target'});
      entities.record({type:'move',id:'attacker',destination:{x:5,y:3}});
    }
    f.compare('combat-hp-'+hits,f.evaluate('grid.getUnit({x:5,y:3}).playerColor === 3 ? 0 : grid.getUnit({x:5,y:3}).hp'),2-hits);
    check('combat-'+hits);
  };
  f.context.completed = () => {round++; prefix=turns.expected(round).length-1; check('neutral-round-'+round);};
  f.context.saved = () => {prefix++; check('human-ready-'+round);};
  f.evaluate(`globalThis.trace=[{type:'human',round:0,player:1}];
    gameSettings.isOnline=false; gameSettings.aiActionLimit=1;
    AiRuntime.trainFromHumanCommands=()=>{};
    gameEvent.nextTurn=()=>{offlineNextTurn()};
    timer={pauseAndSaveTime(){},setNextTurnTime(){}};
    nextTurnPauseInterface={visible:false};
    globalThis.saveManager={save(){trace.push({type:'human',round:gameRound,player:whooseTurn}); saved(); offlineNextTurn()}};
    for(const owner of [1,2]) {
      const next=players[owner].nextTurn.bind(players[owner]);
      players[owner].nextTurn=()=>{next();afterIncome(owner)};
    }
    const spawn=spawnCoopWave;
    spawnCoopWave=(r)=>{trace.push({type:'wave',round:gameRound}); const result=spawn(r); afterWave(result); offlineNextTurn(); return result};
    const play=players[3].play.bind(players[3]);
    players[3].play=()=>{trace.push({type:'demon',round:gameRound}); demonStarted(); offlineNextTurn(); play()};
    const send=players[3].units[0].sendInstructions;
    players[3].units[0].sendInstructions=function(cell){
      if(cell.coord.x!==5 || cell.coord.y!==3 || !this.canHitSomethingOnCell(cell)) throw Error('unexpected combat');
      send.call(this,cell); afterAction(); offlineNextTurn();
    };
    const neutral=players[0].nextTurn.bind(players[0]);
    players[0].nextTurn=()=>{neutral(); trace.push({type:'complete',round:gameRound-1});completed()}; undefined`);
  check('initial');
  if(eliminated) {
    f.evaluate('players[2].units[0].kill(); undefined'); entities.record({type:'death',id:'g2'}); check('eliminate-unit');
    f.evaluate('players[2].towns[0].destroy(); undefined'); entities.record({type:'death',id:'t2'});
    turns.eliminate(2,0); check('eliminate-town');
  }
  for(let r=0;r<2;r++) {
    if(!eliminated) {
      f.evaluate('nextTurn()');
      f.compare('partial-no-phases-'+r,f.evaluate('({turn:whooseTurn,round:gameRound,waves:trace.filter(e=>e.type==="wave").length})'),{turn:2,round:r,waves:r});
      check('partial-'+r);
    }
    f.evaluate('nextTurn()');
    if(process.argv.includes('--fault')) f.evaluate('trace.push({type:"wave",round:0})');
    check('completed-'+r);
    f.compare('human-schedule-'+r,f.evaluate('whooseTurn'),1);
    f.compare('actual-ai-'+r,f.evaluate('players[3].combatAI instanceof SimpleAiPlayer'),true);
  }
  const before=f.evaluate('({round:gameRound,trace,gold:players.map(p=>p.gold)})');
  f.evaluate('gameExit=true; nextTurn(); nextTurn()');
  f.compare('terminal-no-advance',f.evaluate('({round:gameRound,trace,gold:players.map(p=>p.gold)})'),before);
  console.log(`PASS local-round eliminated=${eliminated} completed=2 waves=2 demon_phases=2 combat_actions=2 reentrant_callbacks=ignored`);
}
if (require.main === module) {
run(false); run(true);
console.log('INAPPLICABLE online committed convergence: local offline rounds have no online committed revisions. Entity helper checks serialization at every action/phase/round. No purchases or production occur; income and salary events are independently declared.');
if(!process.argv.includes('--fault')) {
  const child=spawnSync(process.execPath,[__filename,'--fault'],{encoding:'utf8',maxBuffer:32*1024*1024});
  process.stderr.write(child.stderr);
  assert.equal(child.status,1); assert.match(child.stderr,/AssertionError/);
  assert.match(child.stderr,/exactly one wave phase/);
  console.log('PASS rejects-duplicate-phase expected_exit=1 observed_exit=1');
}

}
module.exports = {run};
