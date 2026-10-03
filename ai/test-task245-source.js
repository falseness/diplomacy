'use strict';
// Focused production-source checks; literals/oracles reused from TASK-232..244.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
// The bombard scripts (TASK-448) and test-coop-demon-config (TASK-450) moved to diplomacy_server tests/client.
const SERVER_CLIENT_TESTS=path.resolve(__dirname,'../../diplomacy_server/tests/client');
const out=process.argv[2],checks=[],details=[];
const write=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2)+'\n');
const check=(id,observed,expected)=>{assert.deepEqual(observed,expected,id);checks.push({id,observed,expected,pass:true});console.log('PASS '+id);};
function child(file,args=[],input){
 const stop=Number(process.env.TASK244_STOP_AT);assert(Date.now()<stop);
 console.log(`COMMAND ${process.execPath} ${file} ${args.join(' ')}\nCWD=${process.cwd()}`);
 const r=spawnSync(process.execPath,[file,...args],{input,encoding:'utf8',timeout:stop-Date.now(),maxBuffer:64*1024*1024});
 console.log(r.stdout||'');console.log(r.stderr||'');console.log('ACTUAL_EXIT_STATUS='+r.status);assert.equal(r.status,0);return r.stdout;
}
function result(file,marker){const local=JSON.parse(child(path.join(SERVER_CLIENT_TESTS,file)).split('\n').find(s=>s.startsWith(marker)).slice(marker.length));
 const server=JSON.parse(child(path.join(SERVER_CLIENT_TESTS,file),['--server'],JSON.stringify(local.input)).split('\n').find(s=>s.startsWith(marker)).slice(marker.length));return [local,server];}
const config=require('../../diplomacy_server/tests/client/test-coop-demon-config');
const local=config.browserSource();
const server=JSON.parse(child(path.join(SERVER_CLIENT_TESTS,'test-coop-demon-config.js'),['--server'],JSON.stringify(local.inputs)).split('\n').find(s=>s.startsWith('TASK232_SERVER_RESULTS=')).slice('TASK232_SERVER_RESULTS='.length));
for(const rows of [local.observations,server])for(const group of rows)for(const row of group.rows)assert.deepEqual(row,config.expectedUnit(row.id));
details.push({id:'demon-stats',local:local.observations,server});check('source/current-demon-stats',true,true);
const bombard=require(path.join(SERVER_CLIENT_TESTS,'test-bombard'));
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
const Grid=require('node:vm').runInNewContext(source+';Grid',{SpritesGroup:class {},gameSettings:{drawFogLandmarks:true},cachedImages:{goldmine:'gold',portal:'portal'},drawCachedImage:(_ctx,img)=>calls.push(img)});
const grid=new Grid();
for(const props of [{name:'goldmine'},{name:'demonPortal',isDemonPortal:true,imageName:'portal'},{name:'town'},{name:'demonPortal',isDemonPortal:true,imageName:'portal',killed:true}])grid.drawFogLandmark({},{...props,pos:{x:0,y:0},get unit(){throw Error('occupant accessed');},draw(){throw Error('indirect draw');}});
check('source/non-coop-landmarks',calls,['gold','portal']);
// TASK-239: category portraits stay distinct; rendering is checked by the real browser.
const artSpec=require('../../diplomacy_server/tests/client/test-coop-harness').defaultFixture();artSpec.coop=true;
const artFixture=require('../../diplomacy_server/tests/client/test-coop-harness').createFixture(artSpec,()=>{});
const categories=['melee','ranged','siege','heavy','support','chaos','mage'];
const images=categories.map(category=>'demonPortal'+category[0].toUpperCase()+category.slice(1));
const actualArt=artFixture.evaluate(`(() => {whooseTurn=3;grid.getHexagon({x:5,y:4}).firstpaint(3);return ${JSON.stringify(categories)}.map(category=>{const p=new DemonPortal(5,4,category);const image=p.imageName;p.kill();return image;});})()`);
check('source/portal-artwork',actualArt,images);
const artwork=images.map(image=>fs.readFileSync(path.join(__dirname,'../assets/sprites',image+'.svg'),'utf8'));
assert.equal(new Set(artwork).size,7);for(const svg of artwork)assert(svg.includes('<svg'));
// task244-network.js used the removed password protocol (historical since TASK-311);
// the current account/lobby protocol is covered by the co-op online suites below.
const protocol=path.join(out,'protocol'),serverRoot=path.resolve(__dirname,'../../diplomacy_server');fs.mkdirSync(protocol);
const suites=['unit-demon-combat-coop','ai-full-game-coop','ai-full-game-reconnect'],suiteResults=[];
for(const suite of suites){
 const stop=Number(process.env.TASK244_STOP_AT);assert(Date.now()<stop);
 const args=['--test','--test-concurrency=1','--test-reporter=tap','tests/online/'+suite+'.test.js'],evidence=path.join(protocol,suite);fs.mkdirSync(evidence);
 const env={...process.env,ONLINE_EVIDENCE_DIR:evidence};if(fs.existsSync('/opt/diplomacy/node_modules'))env.NODE_PATH='/opt/diplomacy/node_modules';
 console.log(`COMMAND ${process.execPath} ${args.join(' ')}\nCWD=${serverRoot}`);
 const r=spawnSync(process.execPath,args,{cwd:serverRoot,env,encoding:'utf8',timeout:stop-Date.now(),maxBuffer:64*1024*1024});
 console.log(r.stdout||'');console.log(r.stderr||'');console.log('ACTUAL_EXIT_STATUS='+r.status);
 const count=k=>Number(((r.stdout||'').match(new RegExp('^# '+k+' (\\d+)$','m'))||[])[1]);
 suiteResults.push({suite,exit:r.status,pass:count('pass'),fail:count('fail')});
}
details.push({id:'current-protocol',suites:suiteResults});
check('server/current-protocol',suiteResults.map(r=>({suite:r.suite,exit:r.exit,fail:r.fail,ran:r.pass>0})),suites.map(suite=>({suite,exit:0,fail:0,ran:true})));
write('integrated-source.json',{checkpoints:checks,details,pass:true});
