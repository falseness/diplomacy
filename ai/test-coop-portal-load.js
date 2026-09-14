const assert = require('assert').strict;
const {createFixture, defaultFixture} = require('./test-coop-harness');

function run() {
  for (const color of [0, 1, 3]) for (const occupied of [false, true]) {
    const config = defaultFixture(); config.coop = true; config.actors[3].units = [];
    const f = createFixture(config, () => {});
    f.evaluate(`new DemonPortal(3,3); external[0].id='portal-id'; external[0].hit(13);
      ${occupied ? "new Imp(3,3); players[3].units[0].id='imp-id'; players[3].units[0].moves=0;" : ''}
      actionManager.startAction('load-control'); undefined`);
    const packed = JSON.parse(f.evaluate('JSON.stringify(getGameObject())'));
    packed.grid[3][3] = color;
    if (color === 1) packed.players[1].towns[0].suburbs.push({x:3,y:3,isSuburb:true});
    const expected = JSON.parse(JSON.stringify(packed)); expected.grid[3][3] = 3;
    if (color === 1) expected.players[1].towns[0].suburbs.at(-1).isSuburb = false;
    const undo = f.evaluate('JSON.stringify(actionManager.arr)');
    f.context.saved = JSON.stringify(packed);
    f.evaluate(`globalThis.boundary=[];
      const original=unpacker.unpackUnit;
      unpacker.unpackUnit=function(p,c) {
        const unit=original.call(this,p,c);
        if(p.coord.x===3 && p.coord.y===3) boundary.push({tile:unit.playerColor,
          registries:players.map(p=>p.units.filter(u=>u===unit).length)});
        return unit;
      };
      loadFromJson(saved); undefined`);
    f.compare(`load-color-${color}-occupied-${occupied}-exact-state`,
      JSON.parse(f.evaluate('JSON.stringify(getGameObject())')), expected);
    assert.equal(f.evaluate('JSON.stringify(actionManager.arr)'), undo);
    assert.deepEqual(f.evaluate('boundary'), occupied ? [{tile:3,registries:[0,0,0,1]}] : []);
    assert.deepEqual(f.evaluate(`({tile:grid.getHexagon({x:3,y:3}).playerColor,
      portal:external[0].playerColor, suburb:grid.getHexagon({x:3,y:3}).isSuburb,
      inheritance:Imp.prototype instanceof Noob && Hound.prototype instanceof KOHb &&
        Brute.prototype instanceof Normchel && Spitter.prototype instanceof Archer,
      speed:Imp.speed})`), {tile:3,portal:3,suburb:false,inheritance:true,speed:1});
    console.log(`PASS load color=${color} occupied=${occupied} exact-state IDs HP moves gold balance unrelated-state undo preserved; insertion=${JSON.stringify(f.evaluate('boundary'))}`);
  }
  // Registry identity, not unit class or stale terrain, determines whether an
  // occupant is human. Include a human-owned Imp and an already demon-colored tile.
  for (const name of ['noob', 'imp']) for (const color of [0, 1, 3]) {
    const config=defaultFixture(); config.coop=true;
    const f=createFixture(config,()=>{});
    f.evaluate('new DemonPortal(3,3); undefined');
    const packed=JSON.parse(f.evaluate('JSON.stringify(getGameObject())'));
    packed.grid[3][3]=color;
    packed.players[1].units.push({name,coord:{x:3,y:3},hp:1,moves:0,wasHitted:false,id:'human-occupant'});
    f.context.saved=JSON.stringify(packed);
    assert.throws(()=>f.evaluate('loadFromJson(saved)'), /portal requires empty or demon-occupied unit cell/);
    assert.equal(f.evaluate('players[3].units.some(u=>u.id==="human-occupant")'),false);
    assert.equal(f.evaluate('grid.getHexagon({x:3,y:3}).playerColor'),color);
    console.log(`PASS rejects human registry occupant=${name} color=${color} without conversion`);
  }
  console.log('PASS portal load compatibility controls=12');
}
if (require.main === module) run();
module.exports = {run};
