const assert = require('assert').strict;
const {createFixture, defaultFixture} = require('./test-coop-harness');
// Literal independent expected runs: healthy big/small, missing small/big.
const cases = [
  [30,0,[0,0,0,3]], [30,1,[0,1,9,2]], [30,6,[0,6,4,2]],
  [30,9,[0,9,1,2]], [30,10,[1,0,0,2]], [30,11,[1,1,9,1]],
  [30,19,[1,9,1,1]], [30,20,[2,0,0,1]], [30,27,[2,7,3,0]],
  [30,30,[3,0,0,0]], [27,0,[0,0,7,2]], [27,6,[0,6,1,2]],
  [27,10,[1,0,7,1]], [27,19,[1,9,8,0]], [27,27,[2,7,0,0]]
];
const readBar = `(b => ({pos:b.pos,r:basis.r,rects:b.rects.map(q=>({x:q.x,y:q.y,w:q.width,h:q.height,color:q.color})),green:b.healthColor,gray:b.dmgColor}))`;
function checkBar(label, bar, hp, max, counts) {
  const expected = counts.flatMap((n,i)=>Array(n).fill(['GB','GS','MS','MB'][i]));
  const small = bar.r * .15, gap = bar.r * .05;
  const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${label}: ${a} != ${b}`);
  const observed=bar.rects.map(q=>{
    assert.ok(q.color===bar.green || q.color===bar.gray);
    assert.ok(Math.abs(q.w-small)<1e-7 || Math.abs(q.w-2*small)<1e-7);
    near(q.w,q.h);
    near(q.y+q.h/2,bar.pos.y-bar.r*.9+small/2);
    return (q.color===bar.green?'G':'M')+(q.w>small*1.5?'B':'S');
  });
  assert.deepEqual(observed,expected,label);
  const value = color => observed.filter(s=>s[0]===color).reduce((sum,s)=>sum+(s[1]==='B'?10:1),0);
  assert.equal(value('G'),hp); assert.equal(value('M'),max-hp);
  if(bar.rects.length) {
    const first=bar.rects[0],last=bar.rects.at(-1);
    near((first.x+last.x+last.w)/2,bar.pos.x);
    bar.rects.slice(1).forEach((q,i)=>near(q.x-(bar.rects[i].x+bar.rects[i].w),gap));
  }
  console.log(`PASS ${label} expected=${expected.join(',')} observed=${observed.join(',')} represented=${hp}+${max-hp}=${max} centered=true nonoverlap=true sizes=1:2`);
}
function main() {
  const config=defaultFixture(); config.coop=true;
  const f=createFixture(config);
  for(const [max,hp,counts] of cases) {
    f.evaluate(`globalThis.bar=new HealthBar({x:123,y:87},${max});bar.repaintRects(${hp});`);
    checkBar(`literal-${hp}/${max}`,f.evaluate(`${readBar}(bar)`),hp,max,counts);
    f.evaluate('bar.pos={x:411,y:203};');
    checkBar(`reposition-${hp}/${max}`,f.evaluate(`${readBar}(bar)`),hp,max,counts);
  }
  f.evaluate('globalThis.portal=new DemonPortal(3,2);');
  let before=30;
  for(const hp of [30,27,20,9,0]) {
    f.evaluate(`portal.hit(${before-hp});`); before=hp;
    checkBar(`damage-${hp}`,f.evaluate(`${readBar}(portal.hpBar)`),hp,30,cases.find(c=>c[0]===30&&c[1]===hp)[2]);
  }
  assert.equal(f.evaluate('portal.killed && grid.getBuilding({x:3,y:2}).isEmpty()'),true);
  assert.equal(f.evaluate('(()=>{let calls=0;portal.hpBar.draw=()=>calls++;portal.drawBars({});return calls})()'),0);
  console.log('PASS killed-portal-hidden draw_calls=0');
  // Fixture-only max/regen allow the real ordinary-unit lifecycle to cross tens.
  f.evaluate('Normchel.maxHP=30; Normchel.healSpeed=1; grid.getUnit({x:1,y:1}).kill(); players[1].updateUnits(); globalThis.unit=new Normchel(1,1);');
  for(const [hp,after] of [[9,10],[19,20]]) {
    f.evaluate(`unit.hp=${hp};unit.wasHitted=false;unit.updateHPBar();unit.nextTurn();`);
    assert.equal(f.evaluate('unit.hp'),after);
    checkBar(`healing-${hp}->${after}`,f.evaluate(`${readBar}(unit.hpBar)`),after,30,cases.find(c=>c[0]===30&&c[1]===after)[2]);
  }
  f.evaluate('unit.hp=27;unit.updateHPBar();globalThis.saved=JSON.stringify(getGameObject());loadFromJson(saved);globalThis.unit=grid.getUnit({x:1,y:1});');
  checkBar('save-load-27',f.evaluate(`${readBar}(unit.hpBar)`),27,30,[2,7,3,0]);
  assert.deepEqual(f.evaluate('JSON.parse(JSON.stringify(getGameObject()))'),f.evaluate('JSON.parse(saved)'));
  console.log('PASS save-load gameplay-state=unchanged');
  f.evaluate('actionManager.clear();unit.select();unit.sendInstructions(grid.getCell({x:1,y:2}));');
  assert.equal(f.evaluate('actionManager.arr.length'),1);
  f.evaluate('actionManager.undo();globalThis.unit=grid.getUnit({x:1,y:1});');
  checkBar('permitted-movement-undo-27',f.evaluate(`${readBar}(unit.hpBar)`),27,30,[2,7,3,0]);
  f.evaluate('globalThis.oldRadius=basis.r;basis.r*=1.5;unit.hpBar.draw(document.createElement("canvas").getContext("2d"));');
  checkBar('basis-resize-27',f.evaluate(`${readBar}(unit.hpBar)`),27,30,[2,7,3,0]);
  f.evaluate('basis.r=oldRadius;globalThis.moves=new Bar({x:100,y:200},2,"#ffa500",undefined,basis.r*.4,basis.r*.225);moves.repaintRects(1);');
  const movement=f.evaluate('({r:basis.r,rects:moves.rects.map(q=>({x:q.x,y:q.y,w:q.width,h:q.height,color:q.color}))})');
  const r=movement.r;
  assert.deepEqual(movement.rects,[{x:100-r*.425,y:200-r*.9,w:r*.4,h:r*.225,color:'#ffa500'},
    {x:100-r*.425+r*.4+r*.05,y:200-r*.9,w:r*.4,h:r*.225,color:'#b3b3b3'}]);
  console.log('PASS movement-control expected=2 boxes orange,gray width=.4r height=.225r gap=.05r observed='+JSON.stringify(movement));
  console.log('PASS compact-health-bars literal_cases=15 transitions=5 healing=2 load=1 undo=1');
}
if(require.main===module) main();
module.exports={checkBar,readBar};
