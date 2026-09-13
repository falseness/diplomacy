const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture, defaultFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');

// Literal expectations deliberately independent of DEMON_TYPES and runtime deltas.
const cases = [['Brute', 'brute', 10, 1, 3], ['Bulwark', 'bulwark', 16, 1, 2]];
const DEMON_NAMES = {"brute": "Brute", "bulwark": "Bulwark", "ravager": "Ravager", "demonLord": "Demon Lord"};
const DEMON_ROLES = {"brute": "slow high-health melee", "bulwark": "very durable slow melee", "ravager": "fast strong late-game melee", "demonLord": "durable powerful late-game melee"};
function run(fault, testCases = cases, summary) {
  if (!fault) require('./test-coop-melee-parents').run(testCases);
  for (const [klass, name, hp, speed, damage] of testCases) {
    for (const mode of ['combat', 'movement', 'durability']) {
      const config = defaultFixture();
      config.coop = true;
      config.size = {x:15, y:15};
      config.actors[1].units = [{x:7,y:3,hp:2}];
      config.actors[3].units = [{x:5,y:2,hp:2}];
      const f = createFixture(config);
      // Controlled initial entities: no economic purchase or round hook.
      f.evaluate(`grid.getHexagon({x:6,y:3}).playerColor = 1;
        globalThis.victim = new Normchel(6,3);
        grid.getHexagon({x:5,y:3}).repaint(3, false);
        globalThis.demon = new ${klass}(5,3); undefined`);
      const initial = [
        ['neutral-town','town',0,4,5,'town'], ['human-one-town','town',1,1,1,'town'],
        ['human-two-town','town',2,7,1,'town'], ['remote','unit',1,7,3,'noob'],
        ['garrison-one','unit',1,1,1,'noob'], ['garrison-two','unit',2,7,1,'noob'],
        ['ally','unit',3,5,2,'noob'], ['victim','unit',1,6,3,'normchel'], ['demon','unit',3,5,3,name]
      ].map(([id,kind,owner,x,y,name]) => ({id,kind,owner,x,y,name}));
      const entities = createEntityLedger(f, initial);
      const economy = createEconomyLedger(f, config.actors.map(({role,gold}) => ({role,gold})), {});
      const turns = createTurnLedger([1,2]);
      const prefix = name + '-' + mode;
      function check(label) {
        entities.check(prefix + '-' + label + '-entities');
        economy.check(prefix + '-' + label + '-economy');
        turns.check(prefix + '-' + label + '-turn', f.evaluate(`({round:gameRound, terminal:gameExit,
          events:[{type:'human',round:gameRound,player:whooseTurn}]})`), 0);
      }
      function action(label, code, expected, events = []) {
        console.log(JSON.stringify({scenario:prefix+'-'+label, submitted:code}));
        const observed = f.evaluate(code);
        events.forEach(entities.record);
        f.compare(prefix+'-'+label, observed, expected);
        check(label);
      }
      if (fault === 'health') f.evaluate('demon.hp--');
      f.compare(prefix+'-exact-config-and-identity', f.evaluate(`({name:demon.name, className:demon.constructor.name,
        hp:demon.hp, maxHP:demon.maxHP, speed:demon.speed, moves:demon.moves, damage:demon.dmg,
        combatConfig:DEMON_TYPES[demon.name],healSpeed:demon.constructor.healSpeed,salary:demon.salary, owner:demon.playerColor, role:demon.player.role,
        registered:getClass(demon.name) === demon.constructor, wire:demon.toJSON()})`),
      {name,className:klass,hp,maxHP:hp,speed,moves:speed,damage,combatConfig:{name:DEMON_NAMES[name],role:DEMON_ROLES[name],health:hp,damage,movement:speed,melee:true,ranged:false,range:1},healSpeed:0,salary:0,owner:3,role:'DEMONS',registered:true,
        wire:{name,coord:{x:5,y:3},hp,wasHitted:false,moves:speed}});
      check('initial');
      // Execute individual demon commands in an explicit fixture phase and restore
      // the human cursor; this is not a completed round or a wave controller.
      const command = (x,y) => `whooseTurn=3; demon.getAvailableCommands(); demon.sendInstructions(grid.getCell({x:${x},y:${y}})); whooseTurn=1;`;
      if (mode === 'movement') {
        action('movement-boundary', `whooseTurn=3;
          const destinations=demon.getAvailableMoveCommands().map(c=>c.destinationCoord);
          whooseTurn=1;
          ({atLimit:destinations.some(c=>c.x===5&&c.y===${3+speed}),
            beyond:destinations.some(c=>c.x===5&&c.y===${4+speed})})`, {atLimit:true,beyond:false});
        action('reject-over-limit', command(5,4+speed)+ '({coord:demon.coord,moves:demon.moves})', {coord:{x:5,y:3},moves:speed});
        action('move-exact-limit', command(5,3+speed)+ '({coord:demon.coord,moves:demon.moves})',
          {coord:{x:5,y:3+speed},moves:0}, [{type:'move',id:'demon',destination:{x:5,y:3+speed}}]);
        action('reject-exhausted', command(5,4+speed)+ '({coord:demon.coord,moves:demon.moves})', {coord:{x:5,y:3+speed},moves:0});
      } else if (mode === 'durability') {
        // Real adjacent human attacks, one damage each; independent literal HP
        // determines the hit count, with conservation checked after every hit.
        for (let hit=1; hit<=hp; hit++) {
          if (hit>1) action('fixture-replenish-human-'+hit, 'victim.moves=2', 2);
          const lethal = hit === hp;
          action((lethal?'lethal':'nonlethal')+'-incoming-hit-'+hit,
            `victim.getAvailableCommands(); victim.sendInstructions(grid.getCell({x:5,y:3}));
              ({hp:demon.hp,killed:demon.killed,victimCoord:victim.coord,victimMoves:victim.moves})`,
            {hp:hp-hit,killed:lethal,victimCoord:{x:lethal?5:6,y:3},victimMoves:0},
            lethal?[{type:'death',id:'demon'},{type:'move',id:'victim',destination:{x:5,y:3}}]:[]);
        }
      } else {
        action('legal-melee-targets', `whooseTurn=3; demon.getAvailableCommands();
          const result={adjacent:demon.canHitSomethingOnCell(grid.getCell({x:6,y:3})),
            ally:demon.canHitSomethingOnCell(grid.getCell({x:5,y:2})),
            empty:demon.canHitSomethingOnCell(grid.getCell({x:5,y:4})),
            remote:demon.canHitSomethingOnCell(grid.getCell({x:7,y:3})),
            remoteCommand:demon.getAvailableCommands().some(c=>c.destinationCoord.x===7&&c.destinationCoord.y===3)};
          whooseTurn=1; result`, {adjacent:true,ally:false,empty:false,remote:speed>=2,remoteCommand:speed>=2});
        action('reject-ally', command(5,2)+'({hp:grid.getUnit({x:5,y:2}).hp,coord:demon.coord,moves:demon.moves})',
          {hp:2,coord:{x:5,y:3},moves:speed});
        const hits = Math.ceil(5/damage);
        for (let hit=1; hit<=hits; hit++) {
          if (hit>1) action('fixture-replenish-'+hit, `demon.moves=${speed}`, speed);
          const lethal = hit===hits;
          action((lethal?'lethal':'nonlethal')+'-hit-'+hit,
            command(6,3)+'({hp:victim.hp,killed:victim.killed,coord:demon.coord,moves:demon.moves,name:demon.name})',
            {hp:5-hit*damage,killed:lethal,coord:{x:lethal?6:5,y:3},moves:0,name},
            lethal?[{type:'death',id:'victim'},{type:'move',id:'demon',destination:{x:6,y:3}}]:[]);
        }
        action('fixture-damage-for-persistence', 'demon.hit(1); ({hp:demon.hp,hit:demon.wasHitted})', {hp:hp-1,hit:true});
        action('serialize-and-remove', 'globalThis.packed=demon.toJSON(); demon.kill(); demon.killed', true, [{type:'death',id:'demon'}]);
        f.evaluate('unpacker.fullUnpackUnit(packed); globalThis.restored=grid.getUnit(packed.coord); undefined');
        entities.record({type:'spawn',entity:{id:'restored',kind:'unit',owner:3,x:6,y:3,name}});
        entities.bind('restored','restored');
        f.compare(prefix+'-restored-identity', f.evaluate('({className:restored.constructor.name,owner:restored.playerColor,wire:restored.toJSON()})'),
          {className:klass,owner:3,wire:{name,coord:{x:6,y:3},hp:hp-1,wasHitted:true,moves:0}});
        check('restored');
      }
    }
  }
  console.log('INAPPLICABLE completed round/wave/demon phase counts: isolated commands in a fixture demon phase; no round advancement. Human cursor and round 0 checked after every action.');
  console.log('INAPPLICABLE online convergence: offline fixtures have no online committed revisions.');
  console.log(summary || 'PASS co-op heavy melee types=2 movement_limits=1,1 health=10,16 damage=3,2 outgoing_lethal=2 incoming_lethal=2 incoming_nonlethal=24 persistence=2');
}
if (require.main === module) {
  if (process.argv[2] === '--fault') run(process.argv[3]);
  else {
    run();
    const child = spawnSync(process.execPath,[__filename,'--fault','health'],{encoding:'utf8'});
    process.stdout.write(child.stdout); process.stderr.write(child.stderr);
    assert.equal(child.status,1);
    assert.ok(child.stderr.includes('AssertionError') && child.stderr.includes('brute-combat-exact-config-and-identity'));
    console.log('PASS rejects-health-corruption expected_exit=1 observed_exit='+child.status);
  }
}

module.exports = {run};
