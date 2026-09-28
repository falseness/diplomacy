'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs');
const {createHash}=require('node:crypto');
const J=require('./review_terminal_ac2_join');
const F=require('./review_terminal_outcomes');
const results=[];
function record(id,e,o){assert.deepEqual(o,e,id);results.push({id,expected:e,observed:o,pass:true});}
// Explicit synthetic contract: serialized historical fixtures supply shapes;
// page captures are fabricated here only to exercise the new joined reader.
// These records never leave the source-test output or enter a coverage consumer.
function contract(caseId='terminal-to-coop') {
    const dir='/root/diplomacy/artifacts/TASK-221/green-12/'+caseId;
    const fixtureBytes=fs.readFileSync(dir+'/declared-fixture.json');
    const original=fs.readFileSync(dir+'/network-traces.jsonl','utf8').trim().split('\n').map(JSON.parse);
    const terminal=structuredClone(original.find(r=>r.stage==='mongo-terminal').stored);
    const b=terminal.rounds.at(-1)[0].parallelTurnResult;
    const raw=slot=>{
        let serial=0; const id=()=>++serial;
        const list=items=>({identity:id(),items});
        const row=e=>({identity:id(),...structuredClone(e),killed:!!e.killed,
            moves:e.moves??{absent:true},wasHitted:e.wasHitted??{absent:true},id:e.id??{absent:true}});
        const players=list(b.players.map(p=>({identity:id(),gold:p.gold,units:list(p.units.map(row)),towns:list(p.towns.map(row))})));
        const grid=list(b.grid.map((c,x)=>list(c.map((owner,y)=>{
            const at=key=>players.items.flatMap(p=>p[key].items).find(e=>e.coord.x===x&&e.coord.y===y);
            const empty=()=>({identity:id(),coord:{x,y},name:{absent:true},hp:{absent:true},killed:{absent:true}});
            return {identity:id(),hexagon:{playerColor:owner,isSuburb:false},unit:at('units')||empty(),building:at('towns')||empty()};
        }))));
        return {schema:'terminal-page-v1',state:{schema:'terminal-passive-v1',players,grid,
            result:b.gameSettings.coop.result,waiting:true,next:{canClick:false,unactive:true},undo:{canClick:false},
            timer:{identity:id(),isTick:false,time:0},socket:{identity:id(),connected:true,id:'socket'},
            oldSocket:null,oldTimer:null,timerStorage:[null,null,null,null],whooseTurn:slot,gameRound:b.gameRound,
            gameSlot:0,undoLength:0,commit:{gameID:terminal.gameID,revision:terminal.coopRevision}},
            extended:{towns:list([list([]),list([]),list([]),list([])]),external:list(b.external.map(row)),
                externalProduction:list([]),nature:list([]),goldmines:list([])},ui:{menu:false,pause:false}};
    };
    const trace=original.filter(r=>['api-join','admission-assignments','captured-real-receipt'].includes(r.stage));
    let sequence=0;
    const capture=(boundary,data)=>trace.push({stage:'ac2-passive',schema:'terminal-ac2-capture-v1',sequence:++sequence,
        caseId,fixtureSha256:createHash('sha256').update(fixtureBytes).digest('hex'),gameId:terminal.gameID,boundary,...data});
    const page=(p,boundary,session)=>capture(boundary,{kind:'page',participant:'p'+p,recipientSlot:p,session,raw:raw(p)});
    const db=boundary=>capture(boundary,{kind:'persistence',stored:structuredClone(terminal)});
    for(const p of [1,2]){page(p,'reconnect-before','before'+p);db('reconnect-before');page(p,'reconnect-after','after'+p);db('reconnect-after');}
    if(caseId.startsWith('terminal-to-')){
        for(const p of [1,2])page(p,'replay-before','after'+p);db('replay-before');
        trace.push(...original.filter(r=>['late-active-receipt-replayed','late-active-receipt-dispatched'].includes(r.stage)));
        for(const p of [1,2])page(p,'replay-after','after'+p);db('replay-after');
    }
    trace.push(...original.filter(r=>r.stage==='terminal-ui'));
    return {caseId,fixtureBytes,trace,terminal};
}
const page=(x,boundary='replay-after')=>x.trace.find(r=>r.stage==='ac2-passive'&&r.kind==='page'&&r.boundary===boundary);
function rehashFixture(x,edit){const f=JSON.parse(x.fixtureBytes);edit(f);x.fixtureBytes=Buffer.from(JSON.stringify(f));for(const r of x.trace.filter(r=>r.stage==='ac2-passive'))r.fixtureSha256=createHash('sha256').update(x.fixtureBytes).digest('hex');}
test('joined synthetic contract covers all four shapes without issuing gameplay credit',()=>{
    for(const id of F.CASES){const r=J.reviewJoin(contract(id));record(id+'/credit',false,r.wholeCriterionCredit);for(const c of r.checks)results.push(c);}
});
for(const [id,mutate,pattern] of [
    ['rehashed-wrong-policy',x=>rehashFixture(x,f=>{f.b.gameSettings.coop.demonSlot=2;}),/fixture policy/],
    ['wrong-recipient',x=>{page(x).recipientSlot=2;},/recipient/],
    ['omitted-participant',x=>{x.trace=x.trace.filter(r=>!(r.stage==='ac2-passive'&&r.participant==='p2'));},/capture-count/],
    ['omitted-boundary',x=>{x.trace=x.trace.filter(r=>r.boundary!=='reconnect-before');},/capture-count/],
    ['extra-income',x=>{page(x).raw.state.players.items[1].gold++;},/terminal-board/],
    ['resumed-turn',x=>{page(x).raw.state.gameRound++;},/terminal-board/],
    ['resurrected-player',x=>{page(x).raw.state.players.items[1].units.items.push(structuredClone(page(x).raw.state.players.items[3].units.items[0]));},/terminal condition not reached/],
    ['changed-database',x=>{x.trace.find(r=>r.kind==='persistence').stored.rounds.at(-1)[0].parallelTurnResult.players[1].gold++;},/unchanged-database/],
    ['changed-session',x=>{page(x).session='other';},/replay-session/],
    ['swapped-sequence',x=>{page(x).sequence=1;},/ordered-capture-sequences/],
    ['wrong-packet-game',x=>{const r=x.trace.find(r=>r.stage==='late-active-receipt-replayed');const a=JSON.parse(r.packet.slice(2)),b=JSON.parse(a[1]);b.coopCommit.gameID='wrong';a[1]=JSON.stringify(b);r.packet='42'+JSON.stringify(a);r.body=r.packet;for(const c of x.trace.filter(v=>v.stage==='captured-real-receipt'&&v.player===r.player))c.packet=r.packet;},/packet-game-recipient/],
    ['omitted-dispatch',x=>{x.trace=x.trace.filter(r=>r.stage!=='late-active-receipt-dispatched');},/dispatch count/],
    ['unordered-dispatch',x=>{const i=x.trace.findIndex(r=>r.stage==='late-active-receipt-dispatched');x.trace.push(...x.trace.splice(i,1));},/ordered authenticated dispatch/],
    ['enabled-action',x=>{page(x).raw.state.next.canClick=true;},/next disabled/],
    ['missing-winner-ui',x=>{x.trace.find(r=>r.stage==='terminal-ui').state.text='';},/winner-text/],
    ['wrong-admission',x=>{x.trace.find(r=>r.stage==='admission-assignments').gameId='wrong';},/mongo-admission-identity/]
])test('joined reader rejects '+id,()=>{const x=contract();mutate(x);assert.throws(()=>J.reviewJoin(x),pattern);record('reject/'+id,String(pattern),String(pattern));});
test('serialize joined contract evidence',()=>{
    if(process.env.AC2_JOIN_OUTPUT)fs.writeFileSync(process.env.AC2_JOIN_OUTPUT,JSON.stringify({tier:'synthetic source contract only',wholeCriterionCredit:false,checkpoints:results},null,2)+'\n');
});
module.exports={contract};
