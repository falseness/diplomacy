'use strict';
// Focused production-source checks; literals/oracles reused from TASK-232..244.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const out=process.argv[2],checks=[],details=[];
const write=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2)+'\n');
const check=(id,observed,expected)=>{assert.deepEqual(observed,expected,id);checks.push({id,observed,expected,pass:true});console.log('PASS '+id);};
function child(file,args=[],input){
 const stop=Number(process.env.TASK244_STOP_AT);assert(Date.now()<stop);
 console.log(`COMMAND ${process.execPath} ${file} ${args.join(' ')}\nCWD=${process.cwd()}`);
 const r=spawnSync(process.execPath,[file,...args],{input,encoding:'utf8',timeout:stop-Date.now(),maxBuffer:64*1024*1024});
 console.log(r.stdout||'');console.log(r.stderr||'');console.log('ACTUAL_EXIT_STATUS='+r.status);assert.equal(r.status,0);return r.stdout;
}
function result(file,marker){const local=JSON.parse(child(path.join(__dirname,file)).split('\n').find(s=>s.startsWith(marker)).slice(marker.length));
 const server=JSON.parse(child(path.join(__dirname,file),['--server'],JSON.stringify(local.input)).split('\n').find(s=>s.startsWith(marker)).slice(marker.length));return [local,server];}
const config=require('./test-coop-demon-config');
const local=config.browserSource();
const server=JSON.parse(child(path.join(__dirname,'test-coop-demon-config.js'),['--server'],JSON.stringify(local.inputs)).split('\n').find(s=>s.startsWith('TASK232_SERVER_RESULTS=')).slice('TASK232_SERVER_RESULTS='.length));
for(const rows of [local.observations,server])for(const group of rows)for(const row of group.rows)assert.deepEqual(row,config.expectedUnit(row.id));
details.push({id:'demon-stats',local:local.observations,server});check('source/current-demon-stats',true,true);
const bombard=require('./test-bombard');
const attacks=result('test-bombard.js','TASK233_RESULTS=');
for(const observed of attacks){assert.deepEqual(observed.rows.map(r=>r.id),bombard.cases.map(c=>c.id));for(const [i,row]of observed.rows.entries()){
 const expected=bombard.expected(row,bombard.cases[i]);assert.deepEqual({before:row.before,after:row.after,command:row.command,incoming:row.incoming},expected);details.push({id:'bombard/'+row.id,observed:row,expected});}}
assert.deepEqual(attacks[0].roundtrip,{name:'bombard',hp:4,moves:2,range:2,owner:3,interaction:true});
check('source/bombard-contract',true,true);
const integration=result('test-bombard-integration.js','TASK234_RESULTS=');
const identity={name:'bombard',className:'Bombard',id:'siege-234',owner:3,hp:3,coord:{x:4,y:6},moves:1,wasHitted:true,interaction:true};
const trace=[{from:{x:4,y:6},to:{x:4,y:5},legal:true,attack:false,before:{coord:{x:4,y:6},moves:2,hp:5},after:{coord:{x:4,y:5},moves:1,hp:5},result:false},{from:{x:4,y:5},to:{x:4,y:3},legal:true,attack:true,before:{coord:{x:4,y:5},moves:1,hp:5},after:{coord:{x:4,y:5},moves:0,hp:1},result:true}];
for(const r of integration){assert.deepEqual([r.roundtrip.before,r.roundtrip.after],[identity,identity]);assert.deepEqual(r.rows,[{target:'building',trace,observed:{hp:1,coord:{x:4,y:5},moves:0}},{target:'unit-only',trace:[],observed:{hp:5,coord:{x:4,y:6},moves:0}}]);assert.deepEqual(r.factory,{result:{spawned:[{type:'bombard',x:2,y:4}],skipped:0},className:'Bombard'});}
details.push({id:'bombard-integration',observed:integration,expected:{identity,trace}});check('source/bombard-integration',true,true);
child(path.join(__dirname,'test-coop-typed-wave-config.js'),['--output-dir',path.join(out,'schedule')]);
const schedule=JSON.parse(fs.readFileSync(path.join(out,'schedule/checkpoints.json')));
for(const c of schedule.checkpoints){assert(c.pass,c.id);assert.deepEqual(c.observed,c.expected,c.id);}check('source/current-schedule',true,true);
const source=fs.readFileSync(path.join(__dirname,'../groups/grid.js'),'utf8'),calls=[];
const Grid=require('node:vm').runInNewContext(source+';Grid',{SpritesGroup:class {},cachedImages:{goldmine:'gold',portal:'portal'},drawCachedImage:(_ctx,img)=>calls.push(img)});
const grid=new Grid();
for(const props of [{name:'goldmine'},{name:'demonPortal',isDemonPortal:true,imageName:'portal'},{name:'town'},{name:'demonPortal',isDemonPortal:true,imageName:'portal',killed:true}])grid.drawFogLandmark({},{...props,pos:{x:0,y:0},get unit(){throw Error('occupant accessed');},draw(){throw Error('indirect draw');}});
check('source/non-coop-landmarks',calls,['gold','portal']);
// TASK-239: category portraits stay distinct; rendering is checked by the real browser.
const artSpec=require('./test-coop-harness').defaultFixture();artSpec.coop=true;
const artFixture=require('./test-coop-harness').createFixture(artSpec,()=>{});
const categories=['melee','ranged','siege','heavy','support','chaos'];
const images=categories.map(category=>'demonPortal'+category[0].toUpperCase()+category.slice(1));
const actualArt=artFixture.evaluate(`(() => {whooseTurn=3;grid.getHexagon({x:5,y:4}).firstpaint(3);return ${JSON.stringify(categories)}.map(category=>{const p=new DemonPortal(5,4,category);const image=p.imageName;p.kill();return image;});})()`);
check('source/portal-artwork',actualArt,images);
const artwork=images.map(image=>fs.readFileSync(path.join(__dirname,'../assets/sprites',image+'.svg'),'utf8'));
assert.equal(new Set(artwork).size,6);for(const svg of artwork)assert(svg.includes('<svg'));
const protocol=path.join(out,'protocol');fs.mkdirSync(protocol);
child(path.resolve(__dirname,'../../diplomacy_server/tests/coop/task244-network.js'),[protocol]);
const protocolChecks=JSON.parse(fs.readFileSync(path.join(protocol,'checkpoints.json'))).checks;
assert.deepEqual(protocolChecks.map(c=>c.id).sort(),require('../../diplomacy_server/tests/coop/task244-network').caseIDs.slice().sort());
for(const c of protocolChecks){assert(c.pass,c.id);assert.deepEqual(c.observed,c.expected,c.id);}check('server/current-protocol',true,true);
write('integrated-source.json',{checkpoints:checks,details,pass:true});
