const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture, defaultFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');

// Independent literal expectations: class, key, health, movement, damage, range.
const cases = [['Spitter','spitter',2,2,1,2], ['EmberArcher','emberArcher',4,3,2,3]];
function run(fault) {
  for (const [klass,name,hp,speed,damage,range] of cases) {
    for (const mode of ['inside','at','outside','obstruction','restrictions','movement','durability']) {
      const distance = mode === 'outside' ? range+1 : mode === 'inside' ? 1 : range;
      const vx = mode === 'durability' ? 6 : 5;
      const vy = mode === 'durability' ? 3 : 3+distance;
      const config = defaultFixture();
      config.coop = true;
      config.size = {x:15,y:15};
      config.actors[1].units = [];
      config.actors[3].units = [{x:3,y:2,hp:2}];
      const f = createFixture(config);
      f.evaluate(`grid.getHexagon({x:${vx},y:${vy}}).playerColor=1;
        globalThis.victim=new Normchel(${vx},${vy}); globalThis.demon=new ${klass}(5,3); undefined`);
      const initial = [
        ['neutral-town','town',0,4,5,'town'], ['human-one-town','town',1,1,1,'town'],
        ['human-two-town','town',2,7,1,'town'], ['garrison-one','unit',1,1,1,'noob'],
        ['garrison-two','unit',2,7,1,'noob'], ['ally','unit',3,3,2,'noob'],
        ['victim','unit',1,vx,vy,'normchel'], ['demon','unit',3,5,3,name]
      ].map(([id,kind,owner,x,y,name]) => ({id,kind,owner,x,y,name}));
      if (mode === 'obstruction') {
        // A complete mountain ring prevents alternative hex paths around one obstacle.
        const ring = [{x:5,y:4},{x:6,y:3},{x:6,y:2},{x:5,y:2},{x:4,y:2},{x:4,y:3}];
        for (const [i,c] of ring.entries()) {
          f.evaluate(`grid.getHexagon(${JSON.stringify(c)}).playerColor=0; new Mountain(${c.x},${c.y}); undefined`);
          initial.push({id:'mountain-'+i,kind:'nature',owner:0,...c,name:'mountain'});
        }
      }
      const entities = createEntityLedger(f, initial);
      const economy = createEconomyLedger(f, config.actors.map(({role,gold})=>({role,gold})), {});
      const turns = createTurnLedger([1,2]);
      const prefix = name+'-'+mode;
      function check(label) {
        entities.check(prefix+'-'+label+'-entities');
        economy.check(prefix+'-'+label+'-economy');
        turns.check(prefix+'-'+label+'-turn', f.evaluate(`({round:gameRound,terminal:gameExit,
          events:[{type:'human',round:gameRound,player:whooseTurn}]})`), 0);
      }
      function action(label,code,expected,events=[]) {
        console.log(JSON.stringify({scenario:prefix+'-'+label,submitted:code}));
        const observed = f.evaluate(code);
        events.forEach(entities.record);
        f.compare(prefix+'-'+label,observed,expected);
        check(label);
      }
      if (fault === 'health') f.evaluate('demon.hp--');
      f.compare(prefix+'-exact-config-and-identity', f.evaluate(`({name:demon.name,className:demon.constructor.name,
        hp:demon.hp,maxHP:demon.maxHP,speed:demon.speed,moves:demon.moves,damage:demon.dmg,range:demon.range,
        salary:demon.salary,owner:demon.playerColor,role:demon.player.role,
        registered:getClass(demon.name)===demon.constructor,archerRules:demon.interaction instanceof InteractionWithArcher,
        wire:demon.toJSON()})`),
        {name,className:klass,hp,maxHP:hp,speed,moves:speed,damage,range,salary:0,owner:3,role:'DEMONS',
          registered:true,archerRules:true,wire:{name,coord:{x:5,y:3},hp,wasHitted:false,moves:speed}});
      check('initial');
      // As in the browser, select/recompute commands before submitting instructions.
      // Isolated fixture phases preserve the human cursor and do not complete a round.
      const command = (x,y) => `whooseTurn=3; demon.select(); demon.getAvailableCommands();
        demon.sendInstructions(grid.getCell({x:${x},y:${y}})); whooseTurn=1;`;
      const combatState = '({hp:victim.hp,killed:victim.killed,coord:demon.coord,moves:demon.moves})';
      if (['inside','at','outside','obstruction'].includes(mode)) {
        const legal = mode === 'inside' || mode === 'at';
        action('range-boundary', `whooseTurn=3; demon.select();
          const commands=demon.getAvailableCommands();
          const result={canHit:demon.canHitSomethingOnCell(grid.getCell({x:${vx},y:${vy}})),
            listed:commands.some(c=>c.destinationCoord.x===${vx}&&c.destinationCoord.y===${vy})};
          whooseTurn=1; result`, {canHit:legal,listed:legal});
        if (!legal) {
          action('reject-shot',command(vx,vy)+combatState,{hp:5,killed:false,coord:{x:5,y:3},moves:speed});
          if (mode === 'obstruction') action('reject-static-nature', command(5,4)+
            '({name:grid.getBuilding({x:5,y:4}).name,coord:demon.coord,moves:demon.moves})',
            {name:'mountain',coord:{x:5,y:3},moves:speed});
        } else {
          const hits = Math.ceil(5/damage);
          for (let hit=1;hit<=hits;hit++) {
            if (hit>1) action('fixture-replenish-'+hit,`demon.moves=${speed}`,speed);
            const lethal = hit===hits;
            action((lethal?'lethal':'nonlethal')+'-shot-'+hit,command(vx,vy)+combatState,
              {hp:5-hit*damage,killed:lethal,coord:{x:5,y:3},moves:0},lethal?[{type:'death',id:'victim'}]:[]);
          }
          action('fixture-damage-for-persistence','demon.hit(1); ({hp:demon.hp,hit:demon.wasHitted})',{hp:hp-1,hit:true});
          action('serialize-and-remove','globalThis.packed=demon.toJSON(); demon.kill(); demon.killed',true,[{type:'death',id:'demon'}]);
          f.evaluate('unpacker.fullUnpackUnit(packed); globalThis.restored=grid.getUnit(packed.coord); undefined');
          entities.record({type:'spawn',entity:{id:'restored',kind:'unit',owner:3,x:5,y:3,name}});
          entities.bind('restored','restored');
          f.compare(prefix+'-restored-identity',f.evaluate('({className:restored.constructor.name,owner:restored.playerColor,range:restored.range,wire:restored.toJSON()})'),
            {className:klass,owner:3,range,wire:{name,coord:{x:5,y:3},hp:hp-1,wasHitted:true,moves:0}});
          check('restored');
        }
      } else if (mode === 'restrictions') {
        action('target-restrictions',`whooseTurn=3; demon.select(); demon.getAvailableCommands();
          const result={ally:demon.canHitSomethingOnCell(grid.getCell({x:3,y:2})),
            self:demon.canHitSomethingOnCell(grid.getCell({x:5,y:3})),
            empty:demon.canHitSomethingOnCell(grid.getCell({x:6,y:3}))}; whooseTurn=1; result`,
          {ally:false,self:false,empty:false});
        action('reject-ally',command(3,2)+'({allyHP:grid.getUnit({x:3,y:2}).hp,coord:demon.coord,moves:demon.moves})',
          {allyHP:2,coord:{x:5,y:3},moves:speed});
        action('reject-self',command(5,3)+'({hp:demon.hp,coord:demon.coord,moves:demon.moves})',
          {hp,coord:{x:5,y:3},moves:speed});
      } else if (mode === 'movement') {
        action('movement-boundary',`whooseTurn=3; const moves=demon.getAvailableMoveCommands(); whooseTurn=1;
          ({atLimit:moves.some(c=>c.destinationCoord.x===6&&c.destinationCoord.y===${3+speed-1}),
            beyond:moves.some(c=>c.destinationCoord.x===5&&c.destinationCoord.y===${4+speed}),
            enemy:moves.some(c=>c.destinationCoord.x===${vx}&&c.destinationCoord.y===${vy})})`,
          {atLimit:true,beyond:false,enemy:false});
        // Horizontal hex paths are less obvious; use a clear vertical lane at x=6 after a first step.
        action('move-one',command(6,3)+'({coord:demon.coord,moves:demon.moves})',
          {coord:{x:6,y:3},moves:speed-1},[{type:'move',id:'demon',destination:{x:6,y:3}}]);
        action('move-remaining',command(6,3+speed-1)+'({coord:demon.coord,moves:demon.moves})',
          {coord:{x:6,y:3+speed-1},moves:0},[{type:'move',id:'demon',destination:{x:6,y:3+speed-1}}]);
        action('reject-exhausted-move',command(6,3+speed)+'({coord:demon.coord,moves:demon.moves})',
          {coord:{x:6,y:3+speed-1},moves:0});
      } else {
        for (let hit=1;hit<=hp;hit++) {
          if (hit>1) action('fixture-replenish-human-'+hit,'victim.moves=2',2);
          const lethal = hit===hp;
          action((lethal?'lethal':'nonlethal')+'-incoming-hit-'+hit,
            `victim.getAvailableCommands(); victim.sendInstructions(grid.getCell({x:5,y:3}));
              ({hp:demon.hp,killed:demon.killed,victimCoord:victim.coord,victimMoves:victim.moves})`,
            {hp:hp-hit,killed:lethal,victimCoord:{x:lethal?5:6,y:3},victimMoves:0},
            lethal?[{type:'death',id:'demon'},{type:'move',id:'victim',destination:{x:5,y:3}}]:[]);
        }
      }
    }
  }
  console.log('INAPPLICABLE completed round/wave/demon phase counts: isolated fixture commands; human order and round 0 checked after every action. No round advancement.');
  console.log('INAPPLICABLE online convergence: offline fixtures have no online committed revisions.');
  console.log('PASS co-op early ranged types=2 health=2,4 movement=2,3 damage=1,2 ranges=2,3 boundary=inside,at,outside obstruction=mountain target_restrictions=ally,self,empty,static-nature persistence=4 incoming_lethal=2,4');
}
if (require.main === module) {
  if (process.argv[2]==='--fault') run(process.argv[3]);
  else {
    run();
    const child=spawnSync(process.execPath,[__filename,'--fault','health'],{encoding:'utf8'});
    process.stdout.write(child.stdout); process.stderr.write(child.stderr);
    assert.equal(child.status,1);
    assert.ok(child.stderr.includes('AssertionError') && child.stderr.includes('spitter-inside-exact-config-and-identity'));
    console.log('PASS rejects-health-corruption expected_exit=1 observed_exit='+child.status);
  }
}
