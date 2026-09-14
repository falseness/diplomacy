const assert=require('assert').strict;
const fs=require('fs');
const path=require('path');
const {createFixture}=require('./test-coop-harness');
const {routes}=require('./test-coop-terrain-audit');
const f=createFixture(undefined,()=>{}),rows=[];
const index=process.argv.indexOf('--output-dir');
const out=path.resolve(index<0?'artifacts/TASK-084':process.argv[index+1]);
fs.mkdirSync(out,{recursive:true});
for(const size of ['tiny','normal','big']) for(let count=1;count<=4;count++) for(let seed=0;seed<32;seed++) {
  const label=`${size}-humans-${count}-seed-${seed}`;
  f.evaluate(`globalThis.generated=generateCoopGame(${count},{size:'${size}',seed:${seed}})`);
  const map=f.evaluate('JSON.parse(JSON.stringify(generated))');
  const expected=Array.from({length:count},()=>Array(count*({tiny:1,normal:2,big:3}[size]+2)).fill(true)),observed=routes(map);
  assert.deepEqual(observed,expected,label);
  const row={scenario:label,expected,observed};
  if(seed===0) {
    f.evaluate('generated.start({clearValues(){external=[];externalProduction=[];nature=[];goldmines=[];gameRound=0;gameExit=false;},updateCameraBorders(){}},false)');
    row.runtimeObserved=f.evaluate(`(() => {
      const targets=[...generated.portals,...generated.players[0].towns,...generated.goldmines];
      const terminal=new Set([...generated.portals,...generated.players[0].towns].map(c=>c.x+','+c.y));
      return players.slice(1,${count+1}).map(p=>{
        const start=p.units[0].coord,way=new Way(),seen=new Set([start.x+','+start.y]),queue=[start];
        for(let i=0;i<queue.length;i++) {
          const c=queue[i];if(terminal.has(c.x+','+c.y))continue;
          for(const n of grid.getHexagon(c).neighbours) {
            if(isCoordNotOnMap(n,grid.arr.length,grid.arr[0].length)||way.isCellImpassable(n,start,grid.arr,p.units[0].playerColor))continue;
            const id=n.x+','+n.y;if(!seen.has(id)){seen.add(id);queue.push(n);}
          }
        }
        return targets.map(c=>seen.has(c.x+','+c.y));
      });
    })()`);
    assert.deepEqual(row.runtimeObserved,expected,label+' runtime-Way');
  }
  rows.push(row);console.log(JSON.stringify(row));console.log('PASS connectivity '+label);
}
// Deliberately isolated endpoint: independent traversal must detect it, and
// finite production repair must reconnect without deleting terrain/resources.
f.evaluate("globalThis.generated=generateCoopGame(1,{size:'tiny',seed:0});generated.lakes.push(...neighborhood[generated.players[1].towns[0].x&1].map(([dx,dy])=>({x:generated.players[1].towns[0].x+dx,y:generated.players[1].towns[0].y+dy})))");
assert.equal(routes(f.evaluate('JSON.parse(JSON.stringify(generated))')).flat().every(Boolean),false);
const repair=f.evaluate('repairCoopConnectivity(generated)');
assert.equal(repair.status,'connected');
const repaired=f.evaluate('JSON.parse(JSON.stringify(generated))');
require('./test-coop-terrain-audit').audit(repaired,'isolated-start-repair');
assert(routes(repaired).flat().every(Boolean));
console.log(JSON.stringify({scenario:'isolated-start-repair',expected:{connected:true,densityBounds:true},observed:{connected:true,densityBounds:true},repair}));
console.log('PASS isolated-start-repair');
fs.writeFileSync(path.join(out,'connectivity-matrix.json'),JSON.stringify(rows,null,2)+'\n');
console.log('PASS connectivity matrix=384 sizes=tiny,normal,big humans=1..4 seeds=0..31 runtime_Way=12 isolated_repair=passed');
