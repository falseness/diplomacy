'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {chromium} = require('/opt/diplomacy/node_modules/playwright');
const {createTerminalCapture} = require('./terminal_passive_capture');
const {installTerminalPageCapture} = require('./terminal_page_capture');
const {reviewBoundary} = require('./review_terminal_boundary');
const dir = process.env.TERMINAL_ADAPTER_OUTPUT;
const records = [];
function check(id, expected, observed) {
    records.push({id, expected, observed});
    if (dir) fs.writeFileSync(path.join(dir, 'checkpoints.json'), JSON.stringify(records, null, 2) + '\n');
    assert.deepEqual(observed, expected, id);
}
const files = ['player.js', 'sprites/sprite.js', 'sprites/entities/entity.js',
    'sprites/entities/units/unit/unit.js', 'sprites/empty.js', 'options/timer.js'];
const privateFiles = ['sprites/entities/buildings/manufactures/preparingManufacture/preparingManufacture.js',
    'sprites/entities/buildings/manufactures/preparingManufacture/production.js'];
// Rendering superclass stub only; private brands and getters are production definitions.
const source = files.map(f => fs.readFileSync(f, 'utf8')).join('\n') + '\nclass Manufacture {}\n' +
    privateFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');
const legacyFile = '/root/diplomacy_server/tests/reliability/helpers/observation-game.js';
const legacyText = fs.readFileSync(legacyFile, 'utf8');
const start = legacyText.indexOf('const OBSERVE = () => {');
const end = legacyText.indexOf('\n};', start);
assert(start > 0 && end > start);
const legacy = legacyText.slice(start, end + 3);
const fixture = `
const unit = Object.assign(Object.create(Unit.prototype), {name:'noob', hp:0, killed:true,
    wasHitted:true, coord:{x:0,y:0}, interaction:{moves:0}});
const town = {name:'town',hp:0,killed:true,coord:{x:0,y:0},suburbs:[],buildings:[],
    buildingProduction:[],activeProduction:new Empty(),unitProduction:new Empty()};
const human=Object.assign(Object.create(Player.prototype),{gold:17,units:[unit],towns:[town]});
const neutral=Object.assign(Object.create(NeutralPlayer.prototype),{gold:0,units:[],towns:[]});
let players=[neutral,human], whooseTurn=1, gameRound=2, gameSlot='fixture',
    gameSettings={coop:{result:'defeat',humanSlots:[1],humanTeam:'HUMANS',demonSlot:2}},
    grid={arr:[[{hexagon:{playerColor:1,isSuburb:true},unit,building:town}]],getUnit:()=>unit},
    onlineCommit={gameID:1,revision:3}, onlineLobby=null, isFogOfWar=false,
    gameEvent={waitingMode:true,selected:null}, nextTurnButton={canClick:false,unactive:false},
    undoButton={canClick:false},actionManager={arr:[]},menu={visible:false},nextTurnPauseInterface={visible:false},
    external=[],externalProduction=[],nature=[],goldmines=[],
    timer=Object.assign(Object.create(Timer.prototype),{time:900,lastPause:123,isTick:false}),
    onlineSocket={id:'old',connected:true,listeners(event){return [body=>calls.push({event,body})];}},
    calls=[],unpacker={getPlayerTimerByIndex:i=>localStorage.getItem(gameSlot+'timer'+i)};
localStorage.setItem('fixturetimer0','{"time":900}');
localStorage.setItem('fixturetimer1','{"time":900}');
// Independent recursive own-descriptor/reference baseline; no capture helper.
function rawBaseline(extra=[]){
    const graph=new Map();
    function walk(value){
        if(!value || typeof value!=='object' || graph.has(value))return;
        const descriptors=Object.getOwnPropertyDescriptors(value);graph.set(value,descriptors);
        for(const d of Object.values(descriptors))if('value' in d)walk(d.value);
    }
    for(const value of [players,grid,gameSettings,gameEvent,nextTurnButton,undoButton,actionManager,
        timer,onlineSocket,external,externalProduction,nature,goldmines,menu,nextTurnPauseInterface,...extra])walk(value);
    return graph;
}
function sameBaseline(a,b){
    if(a.size!==b.size)return false;
    for(const [object,ds] of a){
        const other=b.get(object);if(!other)return false;
        if(Reflect.ownKeys(ds).length!==Reflect.ownKeys(other).length)return false;
        for(const key of Reflect.ownKeys(ds)){
            if(!other[key])return false;
            for(const field of Reflect.ownKeys(ds[key]))if(ds[key][field]!==other[key][field])return false;
        }
    }return true;
}
`;

test('integrated adapter: native Storage, passive UI, identities, legacy mutation and callback receipts', async () => {
    const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
    const context = await browser.newContext();
    const errors = [];
    try {
        const pages = [];
        for (let i = 0; i < 2; i++) {
            const p = await context.newPage();
            p.on('pageerror', e => errors.push(e.message));
            // Source fixture on a routed isolated origin, not shipped gameplay or a server journey.
            await p.route('http://terminal-fixture.test/**', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>source fixture</title>'}));
            await p.goto('http://terminal-fixture.test/');
            await p.addScriptTag({content: source + '\n' + legacy + '\n' + fixture});
            await p.addScriptTag({content: `(${installTerminalPageCapture.toString()})(${createTerminalCapture.toString()});`});
            pages.push(p);
        }
        const observations = [];
        for (const p of pages) {
            observations.push(await p.evaluate(() => {
                const before = rawBaseline();
                const first = __terminalPassive.read(), second = __terminalPassive.read();
                const unchanged = sameBaseline(before, rawBaseline());
                const held = __terminalPassive.retain();
                onlineSocket.connected = false;
                onlineSocket = {id: 'new', connected: true};
                timer = Object.assign(Object.create(Timer.prototype), {time: 900, lastPause: 123, isTick: false});
                const pre = __terminalPassive.read();
                const invoked = __terminalPassive.invoke('source-payload');
                const post = __terminalPassive.read();
                return {first, second, unchanged, held, invoked, pre, post, calls};
            }));
        }
        for (const [i, r] of observations.entries()) {
            check('participant-' + i + '/raw-descriptors-unchanged', true, r.unchanged);
            check('participant-' + i + '/identity-continuity', r.first, r.second);
            check('participant-' + i + '/native-timer-storage', ['{"time":900}', '{"time":900}'], r.first.state.timerStorage);
            check('participant-' + i + '/passive-ui', {menu: false, pause: false}, r.first.ui);
            check('participant-' + i + '/raw-killed-town-retained', 1, r.first.state.players.items[1].towns.items.length);
            check('participant-' + i + '/registry-preserved', 'defeat', r.first.state.result);
            const replay = {tier:'captured-network-replay',session:'p'+i,beforeSession:'p'+i,afterSession:'p'+i,
                before:r.first,after:r.second,captured:{packet:'42["playYourTurn","fixture"]'},
                dispatch:{confirmed:true,packet:'42["playYourTurn","fixture"]'}};
            // Synthetic checker input only: this does not establish a real packet receipt.
            check('participant-' + i + '/synthetic-replay-reader',true,reviewBoundary(replay).pass);
            const badReplay=structuredClone(replay);badReplay.dispatch.packet+='changed';
            assert.throws(()=>reviewBoundary(badReplay));
            check('participant-' + i + '/replay-byte-change-rejected',true,true);
            check('participant-' + i + '/named-invocations', ['gameStarted', 'playYourTurn', 'waitYouTurn'], r.calls.map(x => x.event));
            // This fixture has own production storage; actual private production is tested below.
            const record = {tier: 'source-executed-callbacks', session: 'p' + i, beforeSession: 'p' + i,
                afterSession: 'p' + i, before: r.pre, after: r.post, retained: r.held, invoked: r.invoked};
            check('participant-' + i + '/callback-boundary', true, reviewBoundary(record, {callbacks: true}).pass);
            for (const [name, mutate] of [
                ['omitted-receipt', x => x.invoked.pop()],
                ['vacuous-list', x => {x.invoked=[];x.retained=[];}],
                ['wrong-session', x => x.afterSession='reconnect'],
                ['income', x => x.after.state.players.items[1].gold++],
                ['resurrection', x => x.after.state.players.items[1].units.items[0].killed=false],
                ['ownership', x => x.after.state.grid.items[0].items[0].hexagon.playerColor=0],
                ['unit-identity', x => x.after.state.players.items[1].units.items[0].identity++],
                ['hp', x => x.after.state.players.items[1].units.items[0].hp++],
                ['moves', x => x.after.state.players.items[1].units.items[0].moves++],
                ['commit', x => x.after.state.commit.revision++],
                ['timer', x => x.after.state.oldTimer.isTick=true],
                ['town-production', x => x.after.extended.towns.items[1].items[0].buildingProduction.items.push({turns:1})],
                ['registry-omission', x => {delete x.before.extended.external;delete x.after.extended.external;}],
            ]) {
                const bad=structuredClone(record);mutate(bad);
                // Rebind integrity to corrupted bytes: semantic rejection must still occur.
                const digest=crypto.createHash('sha256').update(JSON.stringify(bad)).digest('hex');
                assert.equal(digest.length,64);
                let rejected=false;try{reviewBoundary(bad,{callbacks:true});}catch{rejected=true;}
                check('participant-'+i+'/rebound-reject-'+name,true,rejected);
            }
        }
        const legacyResult = await pages[0].evaluate(() => {
            const before=rawBaseline(); const pre={units:human.units.length,towns:human.towns.length,result:gameSettings.coop.result};
            OBSERVE();
            return {pre,post:{units:human.units.length,towns:human.towns.length,result:gameSettings.coop.result},unchanged:sameBaseline(before,rawBaseline())};
        });
        check('legacy-counterexample', {pre:{units:1,towns:1,result:'defeat'},post:{units:0,towns:0,result:'draw'},unchanged:false}, legacyResult);
        const privateResult = await pages[1].evaluate(() => {
            // Declared production-source fixture, not a live game mutation.
            grid.getCell = () => ({pos:{x:100,y:100}});
            globalThis.assets = {size:10};
            const actualPrivate = new PreparingManufacture();
            const {unitProduction:ignored, ...ownTown} = town;
            Object.assign(actualPrivate,ownTown);
            const unitQueue = new UnitProduction(3,7,Empty,'noob');
            actualPrivate.unitProduction = unitQueue;
            const buildingQueue = new ManufactureProduction(4,9,Empty,'farm');
            const buildingCoord = {x:0,y:0}; buildingQueue.coord=buildingCoord; buildingQueue.town=actualPrivate;
            const externalQueue = new ExternalProduction(5,11,Empty,'tower');
            const externalCoord = {x:0,y:0}; externalQueue.coord=externalCoord;
            const activeQueue = new SuburbProduction(6,13,Empty,'suburb'); // Not placed: #coord is {}.
            actualPrivate.activeProduction=activeQueue;
            actualPrivate.buildingProduction=[buildingQueue];
            const suburb={coord:{x:0,y:0},playerColor:1,isSuburb:true};
            actualPrivate.suburbs=[suburb,suburb];
            human.towns[0]=actualPrivate;
            grid.arr[0][0].building=buildingQueue;
            externalProduction.push(externalQueue);
            const privateGet=Object.getOwnPropertyDescriptor(PreparingManufacture.prototype,'unitProduction').get;
            const coordGet=Object.getOwnPropertyDescriptor(Production.prototype,'coord').get;
            const activeCoord=coordGet.call(activeQueue);
            const townGet=Object.getOwnPropertyDescriptor(ManufactureProduction.prototype,'town').get;
            const privateRefs=()=>townGet.call(buildingQueue)===actualPrivate && privateGet.call(actualPrivate)===unitQueue &&
                coordGet.call(unitQueue)===actualPrivate.coord && coordGet.call(buildingQueue)===buildingCoord &&
                coordGet.call(externalQueue)===externalCoord && coordGet.call(activeQueue)===activeCoord;
            const privateRoots=[unitQueue,actualPrivate.coord,buildingCoord,externalCoord,activeCoord];
            const baseline=rawBaseline(privateRoots);
            const before=__terminalPassive.read(),after=__terminalPassive.read();
            // Private values are independently checked against retained fixture references.
            const references=privateRefs();
            const unchanged=sameBaseline(baseline,rawBaseline(privateRoots));
            // Override accessors after installation: the pinned functions must stay in use.
            Object.defineProperty(PreparingManufacture.prototype,'unitProduction',{get(){throw Error('dynamic getter called');},configurable:true});
            Object.defineProperty(Production.prototype,'coord',{get(){throw Error('dynamic coord called');},configurable:true});
            const pinned=__terminalPassive.read();
            return {before,after,unchanged,references,pinned};
        });
        check('private-branded-raw-descriptors-unchanged',true,privateResult.unchanged);
        check('private-branded-reference-baseline',true,privateResult.references);
        check('private-branded-stable-capture',privateResult.before,privateResult.after);
        check('private-getters-pinned-against-replacement',privateResult.before,privateResult.pinned);
        const capturedTown=privateResult.before.extended.towns.items[1].items[0];
        for(const [name,row,expected] of [
            ['unit',capturedTown.unitProduction,{name:'noob',turns:3,cost:7,coord:{x:0,y:0}}],
            ['building',capturedTown.buildingProduction.items[0],{name:'farm',turns:4,cost:9,coord:{x:0,y:0}}],
            ['external',privateResult.before.extended.externalProduction.items[0],{name:'tower',turns:5,cost:11,coord:{x:0,y:0}}],
            ['active-unplaced',capturedTown.activeProduction,{name:'suburb',turns:6,cost:13,coord:{x:{absent:true},y:{absent:true}}}],
        ]) check('private-production-'+name,expected,{name:row.name,turns:row.turns,cost:row.cost,coord:row.coord});
        check('private-production-owner-town-reference',capturedTown.ref,capturedTown.buildingProduction.items[0].townRef);
        check('private-grid-production-coordinate',{x:0,y:0},privateResult.before.state.grid.items[0].items[0].building.coord);
        check('suburb-reference-and-ownership',true,capturedTown.suburbs.items[0].ref===capturedTown.suburbs.items[1].ref &&
            capturedTown.suburbs.items.every(x=>x.playerColor===1 && x.isSuburb===true));
        const privateRecord={tier:'source-executed-callbacks',session:'p1',beforeSession:'p1',afterSession:'p1',
            before:privateResult.before,after:privateResult.after,retained:observations[1].held,invoked:observations[1].invoked};
        check('private-branded-boundary-reader',true,reviewBoundary(privateRecord,{callbacks:true}).pass);
        for(const key of ['suburbs','buildingProduction','activeProduction','unitProduction']) {
            const bad=structuredClone(privateRecord);
            for(const side of ['before','after']) delete bad[side].extended.towns.items[1].items[0][key];
            assert.throws(()=>reviewBoundary(bad,{callbacks:true}),/missing/);
            check('private-rebound-reject-omitted-'+key,true,true);
        }
        for(const [name, mutate] of [
            ['production-coordinate',x=>delete x.unitProduction.coord.x],
            ['production-turns',x=>delete x.unitProduction.turns],
            ['production-owner',x=>delete x.buildingProduction.items[0].townRef],
            ['suburb-owner',x=>delete x.suburbs.items[0].playerColor],
        ]) {
            const bad=structuredClone(privateRecord);
            for(const side of ['before','after'])mutate(bad[side].extended.towns.items[1].items[0]);
            const rebound=crypto.createHash('sha256').update(JSON.stringify(bad)).digest('hex');
            assert.equal(rebound.length,64);
            assert.throws(()=>reviewBoundary(bad,{callbacks:true}),/missing/);
            check('private-rebound-reject-'+name,true,true);
        }
        const corrupt=structuredClone(privateRecord);
        corrupt.after.extended.towns.items[1].items[0].unitProduction.turns++;
        assert.throws(()=>reviewBoundary(corrupt,{callbacks:true}),/raw boundary state changed/);
        check('private-rebound-reject-changed-turns',true,true);
        const getterControl=await pages[1].evaluate(()=>{
            const original=Object.getOwnPropertyDescriptor(menu,'visible');
            Object.defineProperty(menu,'visible',{get(){throw Error('UI getter executed');},configurable:true});
            let error;try{__terminalPassive.read();}catch(e){error=e.message;}
            Object.defineProperty(menu,'visible',original);
            localStorage.getItem=()=>{throw Error('overridden storage getter');};
            const slots=__terminalPassive.read().state.timerStorage;
            return {error,slots};
        });
        check('UI-accessor-refused','accessor refused: visible',getterControl.error);
        check('native-storage-method-bound',['{"time":900}','{"time":900}'],getterControl.slots);
        // Fresh document verifies installation refuses an altered getter before any read.
        const pinPage=await context.newPage();
        await pinPage.addScriptTag({content:source});
        const pinFailure=await pinPage.evaluate(({install,create})=>{
            Object.defineProperty(Production.prototype,'coord',{get(){return {};},configurable:true});
            try{(0,eval)('('+install+')')( (0,eval)('('+create+')') );return 'accepted';}
            catch(e){return e.message;}
        },{install:installTerminalPageCapture.toString(),create:createTerminalCapture.toString()});
        const brandFailure=await pages[1].evaluate(()=>{
            externalProduction.push({name:'forged',turns:3,cost:7});
            try{__terminalPassive.read();return false;}catch(e){return e instanceof TypeError;}
            finally{externalProduction.pop();}
        });
        check('private-unbranded-production-rejected',true,brandFailure);
        check('private-unreviewed-getter-rejected','unreviewed private getter: coord',pinFailure);
        check('unexpected-page-errors',[],errors);
        if(dir) {
            fs.writeFileSync(path.join(dir,'page-observations.json'),JSON.stringify({tier:'source-executed fixture in Chromium; no game/network claim',observations,legacyResult,privateResult},null,2)+'\n');
            fs.writeFileSync(path.join(dir,'browser-version.json'),JSON.stringify({version:browser.version()})+'\n');
        }
    } finally {
        await context.close(); await browser.close();
        if(dir) fs.writeFileSync(path.join(dir,'cleanup.json'),JSON.stringify({browserClosed:!browser.isConnected(),ownedServices:0})+'\n');
    }
});
