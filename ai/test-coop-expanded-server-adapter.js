'use strict';
// Reversible sibling fixture updates: keep changes reviewable in this repository.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const dir=path.resolve(__dirname,'../../diplomacy_server');
const arg=process.argv.indexOf('--output-dir');
const out=path.resolve(arg<0?'artifacts/TASK-125/server':process.argv[arg+1]);
fs.mkdirSync(out,{recursive:true});
const files=['phase-idempotence.test.js','shared-vision.test.js','browser-reconnect.test.js','helpers/browser-local-server.js'];
const originals=files.map(f=>fs.readFileSync(path.join(dir,'tests/coop',f),'utf8'));
function replace(s,a,b){assert(s.includes(a),'missing adaptation anchor: '+a);return s.replace(a,b)}
const hash=s=>createHash('sha256').update(s).digest('hex');
let status=1;
try{
 for(const [i,file] of files.entries()){
  let s=originals[i];
  if(i===0){
   s=replace(s,'for(const count of [2,4])','for(const count of [2,4,12])');
   s=replace(s,'{x:49,y:11}','{x:${Math.max(49,6+count*spacing)},y:11}');
   s=replace(s,"await check('initial',0);",`await check('initial',0);
            await h.api.getTurnGameObjectForEmit(h.game.gameID,1,initial[1].componentResult);
            global.scheduleBoard=initial[1].componentResult;evaluate('loadFromJson(JSON.stringify(scheduleBoard));whooseTurn=1;players[1].nextTurn()');
            const forged=evaluate('getGameObject()');forged.players[count+1].units[0].coord.y++;
            const beforeForgery=hash(h.game);
            await assert.rejects(h.api.handleNextTurn(h.digest(h.passwords[0]),forged),/co-op authority:/);
            compare(label+'-client-demon-action-rejected',hash(h.game),beforeForgery);`);
   s=replace(s,'Object.entries(COOP_WAVE_CONFIG.types)','Object.entries(getCoopWaveConfig(2).types)');
   s=replace(s,'{imp:3,clawling:4,hound:5,brute:6,bulwark:8,spitter:5,emberArcher:7,hexcaster:9,ravager:11,demonLord:14}',
    '{imp:3,clawling:36,hound:37,brute:38,bulwark:40,spitter:37,emberArcher:39,hexcaster:41,ravager:43,demonLord:46}');
   s=replace(s,'{timeout:30000}','{timeout:120000}');
   const boundary=s.indexOf("test('revised authoritative waves:");
   let waves=s.slice(boundary).replace('configuration(2,2)','configuration(12,2)')
     .replaceAll('players[3]','players[13]').replaceAll('owner:3,tile:3','owner:13,tile:13')
     .replace('for(const player of [1,2])','for(const player of Array.from({length:12},(_,i)=>i+1))');
   s=s.slice(0,boundary)+waves;
  }
  if(i===1){
   s=replace(s,'{timeout:180000}','{timeout:300000}');
   s=replace(s,'page.setDefaultTimeout(12000)','page.setDefaultTimeout(45000)');
   s=replace(s,"const out=path.resolve(process.env.COOP_OUTPUT_DIR||path.join(root,'artifacts/TASK-091'));",`const out=${JSON.stringify(path.join(out,'shared-vision'))};`);
   s=replace(s,'const f=createFixture(c,()=>{});',`if(!solo){c.size.x=45;c.actors.splice(3,0,...Array.from({length:10},(_,i)=>({role:'human',rgb:{r:20+i*15,g:70,b:90},gold:100,towns:[],units:[{x:16+(i%5)*4,y:2+Math.floor(i/5)*3,hp:2}]})));}\n    const f=createFixture(c,()=>{});`);
   s=replace(s,'f.evaluate(setup);',"f.evaluate(setup.replaceAll('fullInitArr(13,9','fullInitArr(45,9'));");
   s=replace(s,"function fullMask(cells){return Array.from({length:13}","function fullMask(cells,expanded=true){if(expanded)cells=[...cells,...Array.from({length:10},(_,i)=>{const x=16+(i%5)*4,y=2+Math.floor(i/5)*3;return [[x-1,y-1],[x-1,y],[x,y-1],[x,y],[x,y+1],[x+1,y-1],[x+1,y]].map(p=>p.join(','))}).flat()];return Array.from({length:expanded?45:13}");
   s=replace(s,"mask:fullMask(union('left'))","mask:fullMask(union('left'),false)");
   s=replace(s,"compare('browser-console-errors',errors,[]);",`compare('H12-initial-versus-surviving',fixture().gameSettings.coop.initialHumanCount,12);\n        compare('browser-console-errors',errors,[]);`);
   s=replace(s,'townOwner:players.indexOf(grid.getBuilding({x:2,y:6}).player),lost:players[1].isLost',
    "townOwner:players.indexOf(grid.getBuilding({x:2,y:6}).player),lost:players[1].isLost,initial:gameSettings.coop.initialHumanCount,surviving:players.filter(p=>p.role==='HUMAN'&&!p.isLost).length");
   s=replace(s,'{revision:0,leftAlive:true,townOwner:1,lost:false}', '{revision:0,leftAlive:true,townOwner:1,lost:false,initial:12,surviving:12}');
   s=replace(s,'{revision:1,leftAlive:scenario.leftAlive,townOwner:scenario.townOwner,lost:scenario.lost}', '{revision:1,leftAlive:scenario.leftAlive,townOwner:scenario.townOwner,lost:scenario.lost,initial:12,surviving:scenario.lost?11:12}');
   s=replace(s,"console.log('PASS online-shared-vision", "console.log('PASS H12-online-shared-vision");
  }
  if(i===2){
   s=replace(s,'{timeout:240000}','{timeout:300000}');
   s=replace(s,'230000','290000');
   s=replace(s,'page.setDefaultTimeout(15000)','page.setDefaultTimeout(45000)');
   s=replace(s,"const out=path.join(root,'artifacts/TASK-056');",`const out=${JSON.stringify(path.join(out,'browser-reconnect'))};`);
   s=replace(s,"const passwords=['reconnect-human-1','reconnect-human-2'];","const passwords=board.gameSettings.coop.humanSlots.map(i=>'reconnect-human-'+i);");
   s=replace(s,'const f=createFixture(config,()=>{});',`config.actors.splice(3,0,...Array.from({length:10},(_,i)=>({role:'human',rgb:{r:20+i*15,g:70,b:90},gold:100,towns:[],units:[{x:20+i*2,y:8,hp:2}]})));\n    const f=createFixture(config,()=>{});`);
   s=replace(s,'new Imp(2,4);', 'grid.getHexagon({x:2,y:4}).repaint(13,false);new Imp(2,4);');
   s=s.replaceAll('players[3]','players[13]').replaceAll('players.slice(1,3)','players.slice(1,13)');
   s=replace(s,"console.log('PASS browser-reconnect checkpoints='", "console.log('PASS H12-browser-reconnect checkpoints='");
  }
  if(i===3)s=replace(s,"const passwords=['reconnect-human-1','reconnect-human-2'];","const passwords=board.gameSettings.coop.humanSlots.map(i=>'reconnect-human-'+i);");
  fs.writeFileSync(path.join(out,file.replaceAll('/','-')),s);
  fs.writeFileSync(path.join(dir,'tests/coop',file),s);
 }
 const args=['--test','--test-concurrency=3',...files.slice(0,3).map(f=>'tests/coop/'+f)];
 console.log('CWD='+dir+'\nCOMMAND='+process.execPath+' '+args.join(' ')+'\nRUNTIME='+process.version);
 const result=spawnSync(process.execPath,args,{cwd:dir,stdio:'inherit'});status=result.status??1;
 console.log('SERVER_EXIT_STATUS='+status);
}finally{
 const identities=files.map((file,i)=>{
  const adapted=fs.readFileSync(path.join(dir,'tests/coop',file));
  fs.writeFileSync(path.join(dir,'tests/coop',file),originals[i]);
  const after=fs.readFileSync(path.join(dir,'tests/coop',file));assert.equal(hash(after),hash(originals[i]));
  return {file,before:hash(originals[i]),adapted:hash(adapted),after:hash(after)};
 });
 fs.writeFileSync(path.join(out,'fixture-identities.json'),JSON.stringify(identities,null,2)+'\n');
 console.log('PASS sibling fixtures restored byte-for-byte files=4');
}
process.exitCode=status;
