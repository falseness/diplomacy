const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture, defaultFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');

function run(fault) {
  let count = 0;
  for (const coop of [true, false]) {
    for (const [kind, ranged, owner, health] of [
      ['unit', false, 2, 5], ['unit', true, 2, 5],
      ['wall', false, 2, 5], ['wall', true, 2, 5],
      ['town', false, 2, 10], ['town', true, 2, 10],
      ['town', false, 2, 0], ['town', true, 2, 0],
      ['unit', false, 3, 5], ['unit', true, 3, 5],
      ['town', false, 0, 0]
    ]) {
      const label = `${coop?'coop':'competitive'}-${ranged?'ranged':'melee'}-${kind}-owner${owner}-hp${health}`;
      const config = defaultFixture();
      config.coop = coop;
      config.actors[1].units = [];
      const f = createFixture(config);
      f.evaluate(`grid.getHexagon({x:5,y:3}).playerColor=1;
        globalThis.attacker=new ${ranged?'Archer':'Noob'}(5,3);
        grid.getHexagon({x:6,y:3}).playerColor=${owner};
        globalThis.target=new ${kind==='unit'?'Normchel':kind==='wall'?'Wall':'Town'}(6,3,true);
        target.hp=${health}; undefined`);
      const initial = [
        ['neutral-town','town',0,4,5,'town'], ['human-one-town','town',1,1,1,'town'],
        ['human-two-town','town',2,7,1,'town'], ['garrison-one','unit',1,1,1,'noob'],
        ['garrison-two','unit',2,7,1,'noob'], ['demon','unit',3,7,5,'noob'],
        ['attacker','unit',1,5,3,ranged?'archer':'noob'],
        ['target',kind==='wall'?'building':kind,owner,6,3,kind==='unit'?'normchel':kind]
      ].map(([id,kind,owner,x,y,name])=>({id,kind,owner,x,y,name}));
      const entities = createEntityLedger(f, initial);
      const economy = createEconomyLedger(f, config.actors.map(({role,gold})=>({role,gold})), {});
      const turns = createTurnLedger([1,2]);
      function check(stage) {
        entities.check(label+'-'+stage+'-entities');
        economy.check(label+'-'+stage+'-economy');
        turns.check(label+'-'+stage+'-turn', f.evaluate(`({round:gameRound,terminal:gameExit,
          events:[{type:'human',round:gameRound,player:whooseTurn}]})`), 0);
      }
      const rejected = coop && owner===2;
      // Legacy ranged commands mark a ruined town but do not move/capture it.
      const capture = !rejected && !ranged && kind==='town' && health===0;
      f.evaluate('attacker.select(); attacker.getAvailableCommands(); undefined');
      f.compare(label+'-targeting', f.evaluate(`({canHit:!!attacker.canHitSomethingOnCell(grid.getCell({x:6,y:3})),
        listed:attacker.getAvailableCommands().some(c=>c.destinationCoord.x===6&&c.destinationCoord.y===3)})`),
        {canHit:!rejected && !(ranged && health===0),listed:!rejected});
      check('initial');
      const before = f.snapshot();
      const undoBefore = f.evaluate('actionManager.arr.length');
      console.log(JSON.stringify({scenario:label,submitted:'attacker.sendInstructions(grid.getCell({x:6,y:3}))'}));
      f.evaluate('attacker.sendInstructions(grid.getCell({x:6,y:3})); undefined');
      if (fault==='health' && rejected) f.evaluate('target.hp--');
      if (capture) {
        entities.record({type:'capture',id:'target',owner:1});
        entities.record({type:'move',id:'attacker',destination:{x:6,y:3}});
      }
      f.compare(label+'-outcome', f.evaluate(`({hp:target.hp,owner:target.playerColor,killed:target.killed,
        targetCoord:target.coord,attackerCoord:attacker.coord,attackerHP:attacker.hp,moves:attacker.moves,
        gold:players.map(p=>p.gold)})`),
        {hp:rejected||health===0?health:health-(ranged?2:1),owner:capture?1:owner,killed:false,
          targetCoord:{x:6,y:3},attackerCoord:{x:capture?6:5,y:3},attackerHP:ranged?1:2,
          moves:rejected?2:0,gold:[0,100,75,0]});
      if (rejected) {
        f.compare(label+'-unchanged-full-state', f.snapshot(), before);
        f.compare(label+'-no-undo-added', f.evaluate('actionManager.arr.length'), undoBefore);
        // Even a path ending beyond a damaged allied town must not capture it.
        f.compare(label+'-path-excludes-teammate', f.evaluate(`attacker.interaction.way.getDistance({x:6,y:3})>attacker.moves`), true);
      }
      check('after-command');
      count++;
    }
  }
  console.log('INAPPLICABLE income/expense events: isolated combat/capture commands; starting balances plus zero events checked separately for each human.');
  console.log('INAPPLICABLE completed round/wave/demon phase counts: no rounds advanced; shared turn ledger checks human cursor and round 0 after every command.');
  console.log('INAPPLICABLE online convergence: offline fixtures have no online committed revisions. Competitive slot 3 is a legacy player with economy disabled.');
  console.log(`PASS alliances scenarios=${count} allied_rejections=8 competitive_hostile=8 demon_attacks=4 neutral_captures=2`);
}
if (require.main === module) {
  if (process.argv[2]==='--fault') run('health');
  else {
    run();
    const child=spawnSync(process.execPath,[__filename,'--fault'],{encoding:'utf8'});
    process.stdout.write(child.stdout); process.stderr.write(child.stderr);
    assert.equal(child.status,1);
    assert.ok(child.stderr.includes('AssertionError') && child.stderr.includes('coop-melee-unit-owner2-hp5-outcome'));
    console.log('PASS rejects-allied-health-corruption expected_exit=1 observed_exit=1');
  }
}
