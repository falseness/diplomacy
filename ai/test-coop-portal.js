const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture, defaultFixture} = require('./test-coop-harness');
const {createEntityLedger} = require('./test-coop-entity-ledger');
const {createEconomyLedger} = require('./test-coop-economy-ledger');
const {createTurnLedger} = require('./test-coop-turn-ledger');

function run(fault) {
  const config = defaultFixture();
  config.coop = true;
  const f = createFixture(config);
  const initial = [
    ['neutral-town', 'town', 0, 4, 5], ['human-one-town', 'town', 1, 1, 1],
    ['human-two-town', 'town', 2, 7, 1], ['human-one-unit', 'unit', 1, 2, 2],
    ['human-one-garrison', 'unit', 1, 1, 1], ['human-two-garrison', 'unit', 2, 7, 1],
    ['demon-unit', 'unit', 3, 7, 5]
  ].map(([id, kind, owner, x, y]) => ({id, kind, owner, x, y, name: kind === 'unit' ? 'noob' : 'town'}));
  const entities = createEntityLedger(f, initial);
  const economy = createEconomyLedger(f, config.actors.map(({role, gold}) => ({role, gold})), {});
  const turns = createTurnLedger([1, 2]);
  function check(label) {
    entities.check(label + '-entities');
    economy.check(label + '-economy');
    turns.check(label + '-turn', f.evaluate(`({round: gameRound, terminal: gameExit,
      events: [{type: 'human', round: gameRound, player: whooseTurn}]})`), 0);
  }
  function action(label, code, expected, event) {
    console.log(JSON.stringify({scenario: label, submitted: code}));
    const observed = f.evaluate(code);
    if (event) (Array.isArray(event) ? event : [event]).forEach(e => entities.record(e));
    f.compare(label, observed, expected);
    check(label);
  }
  check('initial');
  f.evaluate('globalThis.portal = new DemonPortal(3,2); undefined');
  entities.record({type: 'spawn', entity: {id: 'portal', kind: 'portal', name: 'demonPortal', owner: 3, x: 3, y: 2}});
  entities.bind('portal', 'portal');
  if (fault === 'health') f.evaluate('portal.hp--');
  f.compare('demon-ownership-visible-health', f.evaluate(`({owner: portal.playerColor, role: portal.player.role,
    hp: portal.hp, max: portal.maxHP, bar: Boolean(portal.hpBar), info: portal.info.info.hp,
    wire: portal.toJSON(), standable: portal.isStandable, product: Object.prototype.hasOwnProperty.call(production, 'demonPortal')})`),
  {owner: 3, role: 'DEMONS', hp: 30, max: 30, bar: true, info: '30 / 30',
    wire: {name: 'demonPortal', coord: {x: 3, y: 2}, hp: 30, wasHitted: false, ownerSlot: 3}, standable: false, product: false});
  if (fault === 'ownership') f.evaluate('external.push(portal)');
  check('spawn');
  action('portal-draw-and-health-bar', `(() => {
    let ellipses = 0, bars = 0;
    const ctx = {save(){}, restore(){}, beginPath(){}, ellipse(){ellipses++}, fill(){}, stroke(){}};
    const previous = otherSettings.alwaysDisplayHPBar;
    portal.hpBar.draw = () => bars++;
    otherSettings.alwaysDisplayHPBar = true;
    portal.draw(ctx); portal.drawBars(ctx);
    delete portal.hpBar.draw; otherSettings.alwaysDisplayHPBar = previous;
    return {ellipses, bars};
  })()`, {ellipses:1, bars:1});
  action('non-coop-creation-rejected', `(() => {
    const coop = gameSettings.coop;
    try {gameSettings.coop = null; new DemonPortal(3,3)}
    catch(e) {return e.message}
    finally {gameSettings.coop = coop}
  })()`, 'portal requires demon ownership');
  action('town-purchase-rejected', `grid.getBuilding({x:1,y:1}).prepare('demonPortal')`, false);
  f.evaluate('Object.setPrototypeOf(players[1], AIPlayerWithEconomy.prototype); undefined');
  action('command-purchase-rejected', `AIPlayerWithEconomy.prototype.applyEconomyCommand.call(players[1],
    {product:'demonPortal', producerCoord:{x:1,y:1}, destinationCoord:{x:3,y:3}})`, false);
  action('occupied-creation-rejected', `(() => {try {new DemonPortal(3,2)} catch(e) {return e.message}})()`,
    'portal requires empty building cell');
  action('human-occupied-creation-rejected', `(() => {try {new DemonPortal(2,2)} catch(e) {return e.message}})()`,
    'portal requires empty or demon-occupied unit cell');
  action('territory-cannot-transfer-portal', `actionManager.startAction('territory'); grid.getHexagon({x:3,y:2}).repaint(1); portal.updatePlayer(); portal.playerColor`, 3);
  action('melee-capture-attempt-damages-only', `(() => {const u = grid.getUnit({x:2,y:2});
    u.select(); u.sendInstructions(grid.getCell({x:3,y:2}));
    return {hp:portal.hp, owner:portal.playerColor, attacker:u.coord, live:external.length}})()`,
    {hp:29, owner:3, attacker:{x:2,y:2}, live:1});
  action('damage-visible-in-state', `portal.hit(28); ({hp:portal.hp, info:portal.info.info.hp, wireHP:portal.toJSON().hp})`,
    {hp:1, info:'1 / 30', wireHP:1});
  // Replenish the test attacker's movement explicitly; this fixture does not advance rounds.
  action('fixture-replenish-moves', 'grid.getUnit({x:2,y:2}).moves = 2', 2);
  action('lethal-melee-removes-portal', `(() => {const u = grid.getUnit({x:2,y:2});
    gameEvent.selected = portal; u.select(); u.sendInstructions(grid.getCell({x:3,y:2}));
    return {hp:portal.hp, killed:portal.killed, empty:grid.getBuilding({x:3,y:2}).isEmpty(),
      external:external.length, selected:gameEvent.selected.isEmpty(), attacker:u.coord}})()`,
    {hp:0, killed:true, empty:true, external:0, selected:true, attacker:{x:3,y:2}},
    [{type:'death', id:'portal'}, {type:'move', id:'human-one-unit', destination:{x:3,y:2}}]);
  action('repeated-lethal-hit-idempotent', 'portal.hit(99); portal.kill(); ({hp:portal.hp, external:external.length})', {hp:0, external:0});
  action('fixture-clear-destroyed-portal-tile', `(() => {const u=grid.getUnit({x:3,y:2}); u.moves=2;
    u.select(); u.sendInstructions(grid.getCell({x:2,y:2})); return u.coord})()`,
    {x:2,y:2}, {type:'move',id:'human-one-unit',destination:{x:2,y:2}});
  f.evaluate(`globalThis.restored = unpacker.fullUnpackBuilding({name:'demonPortal', coord:{x:3,y:2}, hp:17, wasHitted:true, ownerSlot:3}); undefined`);
  entities.record({type:'spawn', entity:{id:'restored', kind:'portal', name:'demonPortal', owner:3, x:3, y:2}});
  entities.bind('restored', 'restored');
  f.compare('deserialize-visible-health', f.evaluate('({hp:restored.hp, owner:restored.playerColor, info:restored.info.info.hp})'), {hp:17, owner:3, info:'17 / 30'});
  check('deserialized');
  action('stale-kill-preserves-replacement', 'portal.kill(); grid.getBuilding({x:3,y:2}) === restored', true);
  action('invalid-damage-rejected', `(() => {try {restored.hit(-1)} catch(e) {return e.message}})()`, 'invalid portal damage');
  console.log('INAPPLICABLE online convergence: offline fixture has no online committed revisions.');
  console.log('INAPPLICABLE completed round/wave/demon phase counts: no round advancement; shared turn helper verifies unchanged round 0 and first human after every action.');
  console.log('PASS co-op portal lifecycle health=30 damage=29,1,0 live_portals=1,0,1 demon_assets=0');
}

// Revised portal ownership and movement rules, isolated from combat fixtures.
function runOwnershipAndMovement() {
  for (const stale of [false, true]) {
    const config = defaultFixture(); config.coop = true;
    const f = createFixture(config);
    f.evaluate(`globalThis.tile = grid.getHexagon({x:3,y:3});
      globalThis.town = grid.getBuilding({x:1,y:1});
      tile.firstpaint(${stale ? 1 : 0}); tile.isSuburb = ${stale};
      ${stale ? 'town.suburbs.push(tile);' : ''}
      actionManager.clear();
      globalThis.portal = new DemonPortal(3,3); undefined`);
    const label = stale ? 'stale-human-suburb' : 'neutral-cell';
    f.compare(label+'-portal-setup', f.evaluate(`({tile:tile.playerColor,
      owner:portal.playerColor, suburb:tile.isSuburb,
      counted:town.suburbs.filter(h=>h.coord.x===3 && h.coord.y===3 &&
        h.isSuburb && h.playerColor===town.playerColor).length,
      undo:actionManager.arr.length, economicAssets:players[3].towns.length})`),
      {tile:3,owner:3,suburb:false,counted:0,undo:0,economicAssets:0});
    const emptySave = JSON.parse(f.evaluate('JSON.stringify(getGameObject())'));
    emptySave.grid[3][3] = 1;
    const normalizedEmpty = JSON.parse(JSON.stringify(emptySave)); normalizedEmpty.grid[3][3] = 3;
    f.context.emptyPortalSave = JSON.stringify(emptySave);
    f.evaluate('loadFromJson(emptyPortalSave); globalThis.tile=grid.getHexagon({x:3,y:3}); globalThis.portal=grid.getBuilding({x:3,y:3}); undefined');
    f.compare(label+'-empty-legacy-load-normalizes-only-tile',
      JSON.parse(f.evaluate('JSON.stringify(getGameObject())')), normalizedEmpty);
    f.compare(label+'-spawn', f.evaluate(`spawnCoopWave(3,0).spawned`),
      [{type:'imp',x:3,y:3}]);
    f.evaluate(`globalThis.walker=grid.getUnit({x:3,y:3}); whooseTurn=3; undefined`);
    f.compare(label+'-owner-registry', f.evaluate(`({tile:tile.playerColor,
      portal:portal.playerColor,unit:walker.playerColor,registered:players[3].units.includes(walker),
      entry:players[3].canEnterBuilding(portal), obstacle:portal.isObstacle(3)})`),
      {tile:3,portal:3,unit:3,registered:true,entry:true,obstacle:false});
    const before = f.evaluate('JSON.stringify(getGameObject())');
    f.evaluate('walker.select(); walker.sendInstructions(grid.getCell({x:4,y:3})); undefined');
    f.compare(label+'-leave-portal', f.evaluate(`({coord:walker.coord,moves:walker.moves,
      tile:tile.playerColor,owner:portal.playerColor,suburb:tile.isSuburb,hp:portal.hp})`),
      {coord:{x:4,y:3},moves:1,tile:3,owner:3,suburb:false,hp:30});
    f.evaluate('actionManager.undo(); globalThis.walker=grid.getUnit({x:3,y:3}); undefined');
    f.compare(label+'-undo-exact', f.evaluate('JSON.stringify(getGameObject())'), before);
    f.evaluate('walker.select(); walker.sendInstructions(grid.getCell({x:4,y:3})); walker.select(); walker.sendInstructions(grid.getCell({x:3,y:3})); undefined');
    f.compare(label+'-enter-own-portal', f.evaluate(`({coord:walker.coord,moves:walker.moves,
      tile:tile.playerColor,owner:portal.playerColor,hp:portal.hp,gold:players[3].gold})`),
      {coord:{x:3,y:3},moves:0,tile:3,owner:3,hp:30,gold:0});
    // An older save has a human-colored portal tile. Only that grid entry may change.
    const packed = JSON.parse(f.evaluate('JSON.stringify(getGameObject())'));
    packed.grid[3][3] = 1;
    const expected = JSON.parse(JSON.stringify(packed)); expected.grid[3][3] = 3;
    f.context.savedPortal = JSON.stringify(packed);
    f.evaluate('loadFromJson(savedPortal); undefined');
    f.compare(label+'-legacy-load-normalizes-only-tile',
      JSON.parse(f.evaluate('JSON.stringify(getGameObject())')), expected);
    f.compare(label+'-loaded-registry', f.evaluate(`({tile:grid.getHexagon({x:3,y:3}).playerColor,
      owner:grid.getBuilding({x:3,y:3}).playerColor,unit:grid.getUnit({x:3,y:3}).playerColor,
      registered:players[3].units.includes(grid.getUnit({x:3,y:3})),
      size:[grid.arr.length,grid.arr[0].length]})`),
      {tile:3,owner:3,unit:3,registered:true,size:[9,7]});
    console.log('PASS '+label+' setup spawn leave enter undo legacy-load ownership=3 suburb=false');
  }
}

if (require.main === module) {
  if (process.argv[2] === '--fault') run(process.argv[3]);
  else {
    run();
    runOwnershipAndMovement();
    for (const [fault, marker] of [['health', 'demon-ownership-visible-health'], ['ownership', 'ownership live entities']]) {
      const child = spawnSync(process.execPath, [__filename, '--fault', fault], {encoding:'utf8'});
      process.stdout.write(child.stdout);
      process.stderr.write(child.stderr);
      assert.equal(child.status, 1);
      assert.ok(child.stderr.includes('AssertionError') && child.stderr.includes(marker));
      console.log(`PASS rejects-${fault}-corruption expected_exit=1 observed_exit=${child.status} marker=${marker}`);
    }
    console.log('PASS co-op portal fault_probes=2');
  }
}
