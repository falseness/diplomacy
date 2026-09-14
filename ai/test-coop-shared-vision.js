const assert = require('assert').strict;
const {createFixture, defaultFixture} = require('./test-coop-harness');
const config = defaultFixture();
config.coop = true;
config.size = {x:13,y:9};
config.actors[0].towns = [{x:6,y:7}];
config.actors[1].towns = [{x:2,y:6}];
config.actors[2].towns = [{x:9,y:6}];
config.actors[1].units = [{x:2,y:2,hp:2}];
config.actors[2].units = [{x:9,y:2,hp:2}];
config.actors[3].units = [{x:6,y:4,hp:2}];
// A one-edge unit radius makes the expected cells reviewable literals. Suburbs
// use their unmodified production radius; the default unit radius is tested below.
const setup = `
    isFogOfWar = true;
    grid.visionUsed=[]; grid.visionDistance=[];
    grid.fullInitArr(13,9,grid.visionUsed,0); grid.fullInitArr(13,9,grid.visionDistance,0);
    grid.newVisionUsedValue=0; grid.visionWay=new VisionWay();
    Noob.visionRange=1;
    for (const col of grid.arr) for (const c of col) c.hexagon.isSuburb=false;
    for (const p of players) for (const t of p.towns) {
      t.suburbs=[grid.getHexagon(t.coord)]; t.suburbs[0].isSuburb=true;
    }
    for (const p of players) for (const u of [...p.units])
      if (u.coord.y===6 || u.coord.y===7) u.kill();
    globalThis.left=grid.getUnit({x:2,y:2});
    globalThis.right=grid.getUnit({x:9,y:2});
    globalThis.leftTown=grid.getBuilding({x:2,y:6});
    globalThis.rightTown=grid.getBuilding({x:9,y:6});
    whooseTurn=1; players[1].changeFogOfWarByVision();
`;
const mask = `grid.fogOfWar.flatMap((col,x)=>col.flatMap((v,y)=>v ? [x+','+y] : [])).sort()`;
const rings = {
  left: ['1,1','1,2','2,1','2,2','2,3','3,1','3,2'],
  right: ['8,2','8,3','9,1','9,2','9,3','10,2','10,3'],
  leftTown: ['1,5','1,6','2,5','2,6','2,7','3,5','3,6'],
  rightTown: ['8,6','8,7','9,5','9,6','9,7','10,6','10,7'],
  moved: ['1,2','1,3','2,2','2,3','2,4','3,2','3,3'],
  overlap: ['2,2','2,3','3,1','3,2','3,3','4,2','4,3'],
  grown: ['10,6','10,7','11,5','11,6','11,7','12,6','12,7']
};
const union = (...names) => [...new Set(names.flatMap(n => rings[n]))].sort();
function compare(name,observed,expected) {
  console.log(JSON.stringify({scenario:name,expected,observed}));
  assert.deepEqual(observed,expected,name); console.log('PASS '+name);
}
function run() {
  const f=createFixture(config,()=>{}); const e=s=>f.evaluate(s);
  e(setup);
  e('globalThis.clears=0; globalThis.clearFog=grid.clearFogOfWarArr; grid.clearFogOfWarArr=function(){clears++;return clearFog.call(this)}; players[1].changeFogOfWarByVision(); grid.clearFogOfWarArr=clearFog; void 0');
  compare('clear-once-accumulate-allies',e('clears'),1);
  const check=(name,...parts)=>compare(name,e(mask),union(...parts));
  check('disjoint-human-units-and-suburbs','left','right','leftTown','rightTown');
  compare('hidden-demon-and-neutral',e('[grid.fogOfWar[6][4],grid.fogOfWar[6][7]]'),[0,0]);
  e('globalThis.firstMask=JSON.stringify(grid.fogOfWar); whooseTurn=2; players[2].changeFogOfWarByVision()');
  compare('identical-counted-masks-across-human-turns',e('JSON.stringify(grid.fogOfWar)===firstMask'),true);
  e('whooseTurn=1; left.select(); left.sendInstructions(grid.getCell({x:2,y:3}))');
  compare('real-move-coordinate',e('left.coord'),{x:2,y:3});
  check('movement-removes-old-sight','moved','right','leftTown','rightTown');
  e('actionManager.undo()');
  check('undo-restores-sight','left','right','leftTown','rightTown');
  e('globalThis.left=grid.getUnit({x:2,y:2}); left.kill()');
  check('death-removes-old-sight','right','leftTown','rightTown');
  e('grid.getHexagon({x:2,y:6}).repaint(0,false); leftTown.updatePlayer()');
  check('town-capture-removes-human-sight','right','rightTown');
  e('whooseTurn=2; players[2].changeFogOfWarByVision()');
  check('survivor-turn-after-ally-elimination','right','rightTown');
  compare('first-human-eliminated',e('players[1].isLost'),true);
  e('grid.getHexagon({x:2,y:6}).repaint(2,false); leftTown.updatePlayer()');
  check('human-town-capture-adds-sight','right','leftTown','rightTown');
  e('grid.getHexagon({x:2,y:6}).repaint(0,false); leftTown.updatePlayer()');
  e('grid.getHexagon({x:11,y:6}).repaint(2,false); new SuburbProduction().create({x:11,y:6},rightTown)');
  check('suburb-growth','right','rightTown','grown');
  e('grid.getHexagon({x:11,y:6}).repaint(0,false)');
  check('suburb-capture-removes-stale-list-entry','right','rightTown');
  e('rightTown.kill()');
  check('surviving-unit-after-town-death','right');
  e('right.kill()');
  check('elimination-removes-final-sight');
  compare('humans-eliminated',e('[players[1].isLost,players[2].isLost]'),[true,true]);

  const g=createFixture(config,()=>{}); const ge=s=>g.evaluate(s); ge(setup);
  ge('right.kill(); grid.getHexagon({x:3,y:2}).repaint(2,false); globalThis.right=new Noob(3,2)');
  compare('overlapping-sight-union',ge(mask),union('left','overlap','leftTown','rightTown'));
  ge('left.kill()');
  compare('overlap-survives-one-source-death',ge(mask),union('overlap','leftTown','rightTown'));
  ge('whooseTurn=3; grid.getHexagon({x:6,y:3}).repaint(3,false); new Noob(6,3)');
  compare('demon-phase-never-adds-demon-vision',ge(mask),union('overlap','leftTown','rightTown'));
  ge('globalThis.coopSettings=gameSettings.coop; gameSettings.coop=null; whooseTurn=2; players[2].updateUnits(); players[2].changeFogOfWarByVision()');
  compare('competitive-individual-control',ge(mask),union('overlap','rightTown'));
  ge('gameSettings.coop=coopSettings; isFogOfWar=false; globalThis.before=JSON.stringify(grid.fogOfWar); right.kill(); refreshCoopVision()');
  compare('fog-off-preserves-mask',ge('JSON.stringify(grid.fogOfWar)===before'),true);

  const solo=JSON.parse(JSON.stringify(config)); solo.actors.splice(2,1);
  const h=createFixture(solo,()=>{}); const he=s=>h.evaluate(s);
  // Compare the unmodified three-edge Noob radius to an ordinary solo control.
  he('isFogOfWar=true; grid.visionUsed=[];grid.visionDistance=[];grid.fullInitArr(13,9,grid.visionUsed,0);grid.fullInitArr(13,9,grid.visionDistance,0);grid.newVisionUsedValue=0;grid.visionWay=new VisionWay();players[1].changeFogOfWarByVision();globalThis.shared=JSON.stringify(grid.fogOfWar);gameSettings.coop=null;players[1].changeFogOfWarByVision()');
  compare('solo-default-radius-matches-individual',he('[Noob.visionRange,JSON.stringify(grid.fogOfWar)===shared]'),[3,true]);
  console.log('PASS co-op shared vision');
}
if (require.main===module) run();
module.exports={config,setup,mask,union,compare};
