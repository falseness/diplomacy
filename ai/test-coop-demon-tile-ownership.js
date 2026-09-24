const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {createFixture, defaultFixture} = require('./test-coop-harness');
const {assertDemonTileOwnership} = require('./test-coop-demon-ownership-assertions');

function run(fault) {
  const config = defaultFixture(); config.coop = true;
  config.actors[3].units = [];
  const f = createFixture(config);
  f.evaluate(`globalThis.town=grid.getBuilding({x:1,y:1});
    globalThis.tile=grid.getHexagon({x:3,y:3});
    tile.firstpaint(1); tile.isSuburb=true; town.suburbs.push(tile);
    grid.getHexagon({x:4,y:3}).firstpaint(1); actionManager.clear(); undefined`);
  const land = () => f.evaluate(`({owner:tile.playerColor,suburb:tile.isSuburb,
    counted:town.suburbs.filter(h=>h.isSuburb && h.playerColor===town.playerColor && h===tile).length,
    unitEmpty:grid.getUnit({x:3,y:3}).isEmpty(),demonUnits:players[3].units.length})`);
  f.compare('human-suburb-before-portal', land(),
    {owner:1,suburb:true,counted:1,unitEmpty:true,demonUnits:0});
  f.evaluate('new DemonPortal(3,3,"melee"); undefined');
  f.compare('ownership-corrected-before-demon-exists', land(),
    {owner:3,suburb:false,counted:0,unitEmpty:true,demonUnits:0});
  // Simulate stale terrain at an existing portal to exercise the independent
  // wave-placement repaint, not just the portal constructor's earlier repaint.
  f.evaluate('tile.firstpaint(1); tile.isSuburb=true; undefined');
  f.compare('stale-human-suburb-before-wave', land(),
    {owner:1,suburb:true,counted:1,unitEmpty:true,demonUnits:0});
  // Observe the real Unit registry insertion: ownership must already be fixed
  // when construction reaches it, before the new unit enters the registry.
  f.evaluate(`globalThis.spawnBoundary=null;
    const originalPush=players[3].units.push;
    players[3].units.push=function(u) {
      spawnBoundary={owner:tile.playerColor,suburb:tile.isSuburb,
        counted:town.suburbs.filter(h=>h===tile && h.isSuburb && h.playerColor===1).length,
        registeredBefore:this.length};
      return originalPush.call(this,u);
    }; undefined`);
  f.compare('spawn-imp',f.evaluate('placeCoopWave({selections:[{type:"imp",x:3,y:3}]})'),
    {spawned:[{type:'imp',x:3,y:3}],skipped:0});
  f.compare('repaint-before-unit-registration',f.evaluate('spawnBoundary'),
    {owner:3,suburb:false,counted:0,registeredBefore:0});
  f.evaluate('delete players[3].units.push; grid.getUnit({x:3,y:3}).id="suburb-imp"; undefined');
  f.compare('human-suburb-after-spawn',land(),
    {owner:3,suburb:false,counted:0,unitEmpty:false,demonUnits:1});
  assertDemonTileOwnership(f,'after-spawn');
  const before = f.evaluate('JSON.stringify(getGameObject())');
  f.compare('empty-human-destination-before-move',f.evaluate('grid.getHexagon({x:4,y:3}).playerColor'),1);
  f.evaluate('whooseTurn=3; grid.getUnit({x:3,y:3}).select(); grid.getUnit({x:3,y:3}).sendInstructions(grid.getCell({x:4,y:3})); whooseTurn=1; undefined');
  f.compare('empty-human-destination-after-move',f.evaluate(`({coord:players[3].units[0].coord,
    owner:grid.getHexagon({x:4,y:3}).playerColor,suburb:grid.getHexagon({x:4,y:3}).isSuburb})`),
    {coord:{x:4,y:3},owner:3,suburb:false});
  if(fault==='tile') f.evaluate('grid.getHexagon({x:4,y:3}).firstpaint(1)');
  if(fault==='registry') f.evaluate('players[1].units.push(players[3].units[0])');
  assertDemonTileOwnership(f,'after-movement');
  f.evaluate('actionManager.undo(); undefined');
  assertDemonTileOwnership(f,'after-undo');
  f.compare('undo-exact-save',f.evaluate('JSON.stringify(getGameObject())'),before);
  f.compare('undo-restores-human-destination',f.evaluate('grid.getHexagon({x:4,y:3}).playerColor'),1);
  f.context.saveInput=before;
  f.evaluate('loadFromJson(saveInput); undefined');
  assertDemonTileOwnership(f,'after-load');
  f.compare('load-exact-save',f.evaluate('JSON.stringify(getGameObject())'),before);
  // A human town cannot be replaced by a portal or accepted as a spawn site.
  f.compare('reject-human-economic-building-portal',f.evaluate(`(() => {
    try {new DemonPortal(1,1,"melee")} catch(e) {return e.message}
  })()`),'portal requires empty building cell');
  f.compare('reject-human-economic-building-spawn',f.evaluate('placeCoopWave({selections:[{type:"imp",x:1,y:1}]})'),
    {spawned:[],skipped:1});
  f.compare('economic-ownership-preserved',f.evaluate(`({towns:players.map(p=>p.towns.length),
    humanTownOwner:grid.getBuilding({x:1,y:1}).playerColor,
    humanTileOwner:grid.getHexagon({x:1,y:1}).playerColor,demonGold:players[3].gold,
    demonEconomicExternal:external.filter(b=>!b.isDemonPortal && b.playerColor===3).length,
    demonProduction:externalProduction.filter(b=>b.playerColor===3).length})`),
    {towns:[1,1,1,0],humanTownOwner:1,humanTileOwner:1,demonGold:0,demonEconomicExternal:0,demonProduction:0});
  assertDemonTileOwnership(f,'after-rejected-economic-spawn');
  console.log('PASS demon-tile-ownership spawn movement undo load suburb-regression economic-assets=0');
}
if(process.argv[2]==='--fault') run(process.argv[3]);
else {
  run();
  for(const fault of ['tile','registry']) {
    console.log(`EXPECTED FAILURE probe=${fault}`);
    const child=spawnSync(process.execPath,[__filename,'--fault',fault],{encoding:'utf8',maxBuffer:16*1024*1024});
    process.stdout.write(child.stdout); process.stderr.write(child.stderr);
    assert.equal(child.status,1); assert.match(child.stderr,/AssertionError/);
    assert.ok(child.stderr.includes('demon-tile-ownership unit=imp id=suburb-imp coord=(4,3)'));
    console.log(`PASS rejects-${fault}-corruption expected_exit=1 observed_exit=${child.status} unit=imp coord=(4,3)`);
  }
}
