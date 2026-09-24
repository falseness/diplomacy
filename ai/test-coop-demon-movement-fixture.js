'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createFixture, defaultFixture} = require('./test-coop-harness');
module.exports = function run(kind) {
  const outputDir = path.resolve(process.env.COOP_EVIDENCE_DIR || 'artifacts/TASK-132');
  fs.mkdirSync(outputDir, {recursive:true});
  const file = path.join(outputDir, 'checkpoints.json');
  const rows = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];
  function check(name, observed, expected) {
    const row = {run:process.env.COOP_TEST_RUN || 'corrected', name:`${kind}-${name}`, expected, observed};
    rows.push(row);
    fs.writeFileSync(file, JSON.stringify(rows,null,2)+'\n');
    console.log(JSON.stringify(row));
    assert.deepEqual(observed,expected,row.name);
    console.log('PASS '+row.name);
  }
  function scenario(fog) {
    const c=defaultFixture(); c.coop=true; c.size={x:15,y:12};
    c.actors.forEach(a=>{a.units=[];a.towns=[];});
    c.actors[1].towns=[{x:7,y:1}]; c.actors[2].towns=[{x:1,y:1}];
    const f=createFixture(c,()=>{}), e=s=>f.evaluate(s);
    // A one-cell corridor gives the real combat AI a unique pursuit step.
    e(`for(let x=0;x<15;x++) for(let y=4;y<12;y++)
      if(x!==7) new Mountain(x,y);
      ${kind==='bush' ? 'new Bush(7,9);' : ''}
      new DemonPortal(7,10,"melee");
      gameRound=COOP_TYPED_WAVE_SCHEDULE.categories.melee[0].round;
      globalThis.wave=spawnCoopWave(gameRound);
      globalThis.imp=players[3].units[0];
      isFogOfWar=${fog};
      grid.visionUsed=[];grid.visionDistance=[];
      grid.fullInitArr(15,12,grid.visionUsed,0);grid.fullInitArr(15,12,grid.visionDistance,0);
      grid.newVisionUsedValue=0;grid.visionWay=new VisionWay();
      players[1].changeFogOfWarByVision(); undefined`);
    const label=fog?'fog-on':'fog-off';
    check(label+'-production-spawn',e('({wave,imp:imp instanceof Imp,coord:imp.coord,moves:imp.moves})'),
      {wave:{spawned:[{type:'imp',x:7,y:10}],skipped:0},imp:true,coord:{x:7,y:10},moves:2});
    if(fog) check(label+'-unseen-start-and-path',e('[grid.fogOfWar[7][10],grid.fogOfWar[7][9],grid.fogOfWar[7][8]]'),[0,0,0]);
    const vision=e('grid.fogOfWar');
    e(`globalThis.actions=[]; const send=imp.sendInstructions;
      imp.sendInstructions=function(cell){const before={coord:{...this.coord},moves:this.moves};
        const result=send.call(this,cell);actions.push({before,destination:{...cell.coord},after:{coord:{...this.coord},moves:this.moves}});return result;};
      whooseTurn=3; players[3].play(); undefined`);
    // Persist the attempted command even when the baseline position assertion fails.
    const observation={run:process.env.COOP_TEST_RUN || 'corrected',name:`${kind}-${label}-action-observation`,observed:e('actions')};
    rows.push(observation); fs.writeFileSync(file,JSON.stringify(rows,null,2)+'\n');
    console.log(JSON.stringify(observation));
    check(label+'-immediate-entry',e('({coord:imp.coord,moves:imp.moves})'),{coord:{x:7,y:8},moves:0});
    e('players[3].nextTurn(); players[3].play(); undefined');
    check(label+'-next-turn-pursuit',e('({coord:imp.coord,moves:imp.moves})'),{coord:{x:7,y:6},moves:0});
    check(label+'-exact-actions',e('actions'),[
      {before:{coord:{x:7,y:10},moves:2},destination:{x:7,y:9},after:{coord:{x:7,y:9},moves:1}},
      {before:{coord:{x:7,y:9},moves:1},destination:{x:7,y:8},after:{coord:{x:7,y:8},moves:0}},
      {before:{coord:{x:7,y:8},moves:2},destination:{x:7,y:7},after:{coord:{x:7,y:7},moves:1}},
      {before:{coord:{x:7,y:7},moves:1},destination:{x:7,y:6},after:{coord:{x:7,y:6},moves:0}}]);
    check(label+'-real-combat-controller',e('players[3].combatAI instanceof SimpleAiPlayer'),true);
    if(fog) {
      check(label+'-human-visibility-unchanged',e('grid.fogOfWar'),vision);
      check('human-fog-restriction',e('new Way().isCellImpassable({x:7,y:9},{x:7,y:1},grid.arr,1)'),true);
    }
    check(label+'-mountain-blocked',e('new Way().isCellImpassable({x:6,y:8},imp.coord,grid.arr,3)'),true);
    e('new Town(3,2); new Goldmine(4,2,50); new Lake(5,2); undefined');
    check(label+'-neutral-town-excluded',e('new Way().isCellImpassable({x:3,y:2},imp.coord,grid.arr,3)'),true);
    check(label+'-economic-capture-blocked',e('Boolean(players[3].canEnterBuilding(grid.getBuilding({x:4,y:2})))'),false);
    check(label+'-lake-blocked',e('new Way().isCellImpassable({x:5,y:2},imp.coord,grid.arr,3)'),true);
    check(label+'-allied-town-blocked',e('new Way().isCellImpassable({x:1,y:1},{x:7,y:1},grid.arr,1)'),true);
    check(label+'-demon-economy-unchanged',e('({gold:players[3].gold,towns:players[3].towns.length,goldmines:players[3].goldmines.length})'),{gold:0,towns:0,goldmines:0});
    return e('actions');
  }
  const off=scenario(false);
  if(kind==='fog') check('equal-pursuit',scenario(true),off);
  console.log(`PASS demon-${kind}-movement`);
};
