// Appended by test-coop-balance-server-adapter to the sibling integration suite.
// Uses that suite's real authoritative checkpoint dispatcher and loopback peers.
test('version 2 authoritative boundary parity and saved-phase reconnect', {timeout:60000}, async()=>{
    const {createFixture,defaultFixture}=require(path.join(runtime.gameDir,'ai/test-coop-harness'));
    const unlocks={imp:1,clawling:3,hound:6,brute:10,bulwark:20,spitter:6,emberArcher:15,hexcaster:24,ravager:30,demonLord:35};
    const weights={imp:1,clawling:2,hound:3,brute:5,bulwark:7,spitter:2,emberArcher:4,hexcaster:6,ravager:8,demonLord:12};
    const portals=[{x:9,y:2},{x:12,y:6}],seed=6,records=[];
    const output=path.resolve(process.env.COOP_EVIDENCE_DIR,'checkpoints.json');
    function check(name,observed,expected) {
        records.push({name,expected:copy(expected),observed:copy(observed)});
        fs.writeFileSync(output,JSON.stringify(records,null,2)+'\n');
        assert.deepEqual(observed,expected,name);
        console.log('PASS '+name+' expected='+JSON.stringify(expected)+' observed='+JSON.stringify(observed));
    }
    function oracle(round) {
        const pool=Object.keys(unlocks).filter(id=>unlocks[id]<=round);
        const total=pool.reduce((sum,id)=>sum+weights[id],0),mod=2n**32n;
        return portals.flatMap(({x,y})=>{
            let v=BigInt(seed)^(BigInt(round)*2654435761n%mod);
            for(const c of [x,y])v=((v^BigInt(c))*1664525n+1013904223n)%mod;
            let sum=0;
            const type=pool.find(id=>{sum+=weights[id];return v*BigInt(total)<BigInt(sum)*mod});
            return type?[{type,x,y}]:[];
        });
    }
    const local=createFixture(defaultFixture(),()=>{});
    const rounds=[...new Set(Object.values(unlocks).flatMap(r=>[r-1,r]))].sort((a,b)=>a-b);
    for(const round of rounds) {
        configuration(2,2);
        evaluate(`gameSettings.coop.balanceVersion=2; players[3].units.slice().forEach(u=>u.kill());
            external.slice().forEach(e=>e.destroy()); new DemonPortal(9,2); new DemonPortal(12,6);
            gameRound=${Math.max(0,round-1)};gameSettings.coop.waveGeneration={version:1,seed:6,lastRound:${Math.max(0,round-1)}};`);
        const board=evaluate('getGameObject()');
        let h=await launch(board);
        try {
            const expectedTypes=Object.keys(unlocks).filter(id=>unlocks[id]<=round);
            check(`round-${round}-eligible`,evaluate(`getUnlockedCoopDemonTypes(${round},2)`),expectedTypes);
            local.context.parityBoard=board;
            local.evaluate('loadFromJson(JSON.stringify(parityBoard))');
            if(round===0) {
                global.scheduleBoard=board;
                evaluate('loadFromJson(JSON.stringify(scheduleBoard))');
                check('round-0-no-wave',evaluate('spawnCoopWave(0)'),{spawned:[],skipped:0});
                local.evaluate('spawnCoopWave(0)');
                check('round-0-complete-local-server-spawned-state',evaluate('getGameObject()'),local.evaluate('JSON.parse(JSON.stringify(getGameObject()))'));
                continue;
            }
            // The saved initial round supplies the boundary offset. Execute
            // the real authoritative generator, with no human actions.
            h.game.coopCheckpoint={round:round-1,stage:'wave',snapshot:copy(board)};
            const steps=h.api.advanceRoundCheckpoints(h.game,h.game.rounds.at(-1));
            check(`round-${round}-wave-yield`,steps.next().done,false);
            check(`round-${round}-phase`,h.game.coopCheckpoint.stage,'demon');
            local.evaluate(`whooseTurn=gameSettings.coop.demonSlot; externalNextTurn();natureNextTurn();spawnCoopWave(${round});`);
            const expected=local.evaluate('JSON.parse(JSON.stringify(getGameObject()))');
            check(`round-${round}-complete-local-server-spawned-state`,h.game.coopCheckpoint.snapshot,expected);
            check(`round-${round}-independent-selection`,expected.players[3].units.map(u=>({type:u.name,x:u.coord.x,y:u.coord.y})),oracle(round));
            if(round!==35)continue;
            check('round-35-actual-demon-lord',evaluate('grid.getUnit({x:9,y:2}) instanceof DemonLord'),true);
            const savedPhases={demon:copy(h.game)};
            check('round-35-combat-yield',steps.next().done,false);
            savedPhases.complete=copy(h.game);
            while(!steps.next().done) {}
            const uninterrupted=copy(h.game);
            for(const stage of ['demon','complete','wave']) {
                const saved=copy(savedPhases[stage==='wave'?'demon':stage]);
                // Legacy wave stage plus committed wave marker and an empty
                // portal exercises the marker guard, independently of occupancy.
                if(stage==='wave')saved.coopCheckpoint.stage='wave';
                const original=copy(saved);
                global.scheduleBoard=saved.coopCheckpoint.snapshot;
                evaluate('loadFromJson(JSON.stringify(scheduleBoard));grid.getUnit({x:12,y:6}).kill();');
                saved.coopCheckpoint.snapshot=evaluate('getGameObject()');
                if(stage!=='wave')saved.coopCheckpoint.snapshot=original.coopCheckpoint.snapshot;
                await h.close(); h=await launch(board,saved);
                check(`reconnect-${stage}-saved-state`,h.game,saved);
                evaluate('scheduleEvents=[]');
                h.api.finishRoundAndAdvanceAutomatedTurns(h.game,h.game.rounds.at(-1));
                check(`reconnect-${stage}-no-wave-replay`,evaluate('scheduleEvents.filter(e=>e.type==="wave")'),[]);
                if(stage==='wave')check('reconnect-wave-empty-portal-retained',h.game.rounds.at(-1)[0].parallelTurnResult.players[3].units.map(u=>u.coord),[{x:9,y:2}]);
                else check(`reconnect-${stage}-complete-state`,h.game,uninterrupted);
                const peers=await Promise.all(h.clients.map(c=>new Promise((resolve,reject)=>
                    c.timeout(5000).emit('authoritySnapshot',(error,value)=>error?reject(error):resolve(value)))));
                for(const [index,peer] of peers.entries())check(`reconnect-${stage}-peer-${index}-full-state`,peer.state,h.game.rounds);
                const committed=copy(h.game);
                check(`reconnect-${stage}-completed-retry`,h.api.finishRoundAndAdvanceAutomatedTurns(h.game,h.game.rounds.at(-2)),false);
                check(`reconnect-${stage}-retry-unchanged`,h.game,committed);
                // Release portals identically in resumed and uninterrupted
                // checkpoints, then execute the subsequent authoritative wave.
                const subsequent=[];
                for(const source of [uninterrupted,h.game]) {
                    const game=copy(source),snapshot=game.rounds.at(-1)[0].parallelTurnResult;
                    global.scheduleBoard=snapshot;
                    evaluate('loadFromJson(JSON.stringify(scheduleBoard));players[3].units.slice().forEach(u=>u.kill());');
                    game.coopCheckpoint={round:35,stage:'wave',snapshot:evaluate('getGameObject()')};
                    const next=h.api.advanceRoundCheckpoints(game,game.rounds.at(-1));next.next();
                    subsequent.push(game.coopCheckpoint.snapshot);
                }
                check(`reconnect-${stage}-subsequent-full-state`,subsequent[1],subsequent[0]);
                check(`reconnect-${stage}-subsequent-selection`,subsequent[1].players[3].units.map(u=>({type:u.name,x:u.coord.x,y:u.coord.y})),oracle(36));
            }
        } finally {await h.close()}
    }
    console.log('PASS authoritative-progression boundaries=18 round1=imp round35=demonLord full-state-parity=true saved-phases=3 no-replay=true subsequent-selection=identical');
});
