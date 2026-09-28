'use strict';
// Cross-record semantics only. The file reader authenticates these inputs and
// independently derives the terminal board before calling this join. A direct
// call is a contract check and deliberately cannot issue a coverage row.
const assert = require('node:assert/strict');
const {reviewTerminalState} = require('./review_terminal_semantics');
const {reviewBoundary, complete} = require('./review_terminal_boundary');
const {createHash} = require('node:crypto');
const hash = x => createHash('sha256').update(x).digest('hex');

function policyFor(fixture, caseId) {
    const {spec, b} = fixture, c = b.gameSettings.coop;
    assert.deepEqual([spec.label, spec.humans, spec.size, spec.seed, b.players.length],
        [caseId, 2, 'tiny', 1, 4], 'fixture identity and dimensions');
    assert.deepEqual([c.initialHumanCount, c.humanSlots, c.demonSlot], [2, [1, 2], 3], 'fixture policy');
    assert.deepEqual(c.generation, spec.generation, 'fixture generation binding');
    assert.deepEqual([c.generation.testFixture.label, c.generation.testFixture.generated], [caseId, false], 'declared fixture');
    assert.equal(b.gameSettings.isOnline, true, 'online fixture');
    assert.equal(b.gameSettings.withAI, false, 'human fixture');
    return {mode: 'coop', neutralSlot: 0, demonSlot: c.demonSlot};
}

const items = x => { assert(Array.isArray(x?.items), 'required raw list'); return x.items; };
const scalar = x => x && x.absent === true ? null : x;
const entity = e => ({name: e.name, coord: e.coord, hp: scalar(e.hp),
    ...(typeof e.moves === 'number' ? {moves:e.moves} : {})});
const order = xs => xs.sort((a,b) => a.coord.x-b.coord.x || a.coord.y-b.coord.y || a.name.localeCompare(b.name));
function packedView(b) {
    const rows = xs => order(xs.filter(e => !e.killed).map(entity));
    return {round:b.gameRound, grid:b.grid, gold:b.players.map(p=>p.gold),
        players:b.players.map(p=>({units:rows(p.units),towns:rows(p.towns)})),
        external:rows(b.external), result:b.gameSettings.coop.result};
}
function rawView(raw) {
    const rows = xs => order(items(xs).filter(e => !e.killed).map(entity));
    return {round:raw.state.gameRound, grid:items(raw.state.grid).map(c=>items(c).map(v=>v.hexagon.playerColor)),
        gold:items(raw.state.players).map(p=>p.gold),
        players:items(raw.state.players).map(p=>({units:rows(p.units),towns:rows(p.towns)})),
        external:rows(raw.extended.external), result:raw.state.result};
}
function objectId(value) {
    if (typeof value === 'string') return value;
    const bytes = value?.buffer;
    assert(bytes && Object.keys(bytes).length === 12, 'stored Mongo identity');
    return Buffer.from(Array.from({length:12}, (_,i)=>bytes[i])).toString('hex');
}
function reviewJoin({caseId, fixtureBytes, trace, terminal}) {
    const fixture = JSON.parse(fixtureBytes), policy = policyFor(fixture, caseId);
    const checks = [], ck = (id,e,o) => {
        assert.deepEqual(o,e,caseId+'/'+id);
        checks.push({id:'terminal/AC2/'+caseId+'/'+id, expected:structuredClone(e), observed:structuredClone(o), pass:true});
    };
    const stages = s => trace.filter(r=>r.stage===s);
    const one = (rows,label) => {assert.equal(rows.length,1,caseId+'/'+label+' count');return rows[0];};
    const admission = one(stages('admission-assignments'),'admission');
    ck('admitted-slots',[1,2],admission.assignments.map(a=>a.slot).sort());
    ck('admitted-identities',[0,1],admission.assignments.map(a=>a.identity).sort());
    ck('assignment-matches',[true,true],admission.assignments.map(a=>a.matches));
    ck('mongo-admission-identity',admission.gameId,objectId(terminal._id));
    for (const a of admission.assignments) {
        ck('credential-slot-'+a.slot,'[user-'+(a.identity+1)+']',terminal.playerIndexToUserIndex[a.slot]);
        const joined=one(stages('api-join').filter(r=>r.identity===a.identity),'join-'+a.identity);
        ck('api-slot-'+a.identity,a.slot,joined.board.whooseTurn);
        ck('api-game-'+a.identity,terminal.gameID,joined.board.coopCommit.gameID);
    }
    const expected = packedView(terminal.rounds.at(-1)[0].parallelTurnResult);
    // These focused terminal fixtures have no surviving towns. Reject a future
    // fixture expansion until production/suburb projections are also reviewed.
    ck('supported-terminal-town-contract',[0,0,0,0],expected.players.map(p=>p.towns.length));
    const captures=stages('ac2-passive');
    const replay=!['terminal-victory','terminal-draw'].includes(caseId);
    ck('capture-count',replay?14:8,captures.length);
    ck('ordered-capture-sequences',captures.map((_,i)=>i+1),captures.map(r=>r.sequence));
    const expectedKinds=['page','persistence','page','persistence','page','persistence','page','persistence'];
    if(replay)expectedKinds.push('page','page','persistence','page','page','persistence');
    ck('capture-kinds',expectedKinds,captures.map(r=>r.kind));
    const boundaries=['reconnect-before','reconnect-before','reconnect-after','reconnect-after',
        'reconnect-before','reconnect-before','reconnect-after','reconnect-after'];
    if(replay)boundaries.push('replay-before','replay-before','replay-before','replay-after','replay-after','replay-after');
    ck('ordered-boundaries',boundaries,captures.map(r=>r.boundary));
    for(const r of captures) {
        const name='capture-'+r.sequence;
        ck(name+'/binding',['terminal-ac2-capture-v1',caseId,hash(fixtureBytes),terminal.gameID],
            [r.schema,r.caseId,r.fixtureSha256,r.gameId]);
        if(r.kind==='persistence') { ck(name+'/unchanged-database',terminal,r.stored); continue; }
        assert(['p1','p2'].includes(r.participant),name+'/participant');
        const slot=Number(r.participant.slice(1));
        ck(name+'/recipient',[slot,slot,terminal.gameID],[r.recipientSlot,r.raw.state.whooseTurn,r.raw.state.commit.gameID]);
        assert(typeof r.session==='string'&&r.session.length>0,name+'/session');
        complete(r.raw);
        const semantic=reviewTerminalState(r.raw,policy);
        ck(name+'/outcome',expected.result,semantic.derived.result);
        ck(name+'/terminal-board',expected,rawView(r.raw));
        ck(name+'/connected',true,r.raw.state.socket.connected);
        ck(name+'/visible',false,r.raw.ui.menu);
        ck(name+'/undo-empty',0,r.raw.state.undoLength);
    }
    for(const participant of ['p1','p2']) {
        const get = boundary => one(captures.filter(r=>r.kind==='page'&&r.participant===participant&&r.boundary===boundary),participant+'/'+boundary);
        const before=get('reconnect-before'),after=get('reconnect-after');
        ck(participant+'/new-document',false,before.session===after.session);
        ck(participant+'/reconnect-board',rawView(before.raw),rawView(after.raw));
        ck(participant+'/reconnect-revision',before.raw.state.commit,after.raw.state.commit);
        // Persistence records must immediately surround the corresponding page
        // records; unrelated DB reads cannot be attached by matching a label.
        for(const r of [before,after]) ck(participant+'/'+r.boundary+'/adjacent-db',
            [r.sequence+1,'persistence',r.boundary],
            [captures[r.sequence]?.sequence,captures[r.sequence]?.kind,captures[r.sequence]?.boundary]);
        if(replay) {
            const pre=get('replay-before'),post=get('replay-after');
            ck(participant+'/continued-session',after.session,pre.session);
            ck(participant+'/replay-session',pre.session,post.session);
            ck(participant+'/late-raw-no-change',pre.raw,post.raw);
        }
    }
    const ui=stages('terminal-ui');
    ck('ui-participants',['p1','p2'],ui.map(r=>r.player));
    for(const r of ui) {
        ck(r.player+'/winner-result',expected.result,r.state.result);
        ck(r.player+'/disabled',{waiting:true,next:false,undo:false,ticking:false},
            {waiting:r.state.waiting,next:r.state.next,undo:r.state.undo,ticking:r.state.ticking});
        ck(r.player+'/winner-text',true,r.state.text.includes({victory:'Victory — humans win',draw:'Draw',defeat:'Defeat — demons win'}[expected.result]));
    }
    if(replay) {
        const sent=one(stages('late-active-receipt-replayed'),'replay'),dispatch=one(stages('late-active-receipt-dispatched'),'dispatch');
        ck('replay-recipient',['p1','p1',200],[sent.player,dispatch.player,sent.status]);
        assert(Number.isSafeInteger(dispatch.delivered)&&dispatch.delivered>0,'actual dispatched receipt');
        const received=stages('captured-real-receipt').find(r=>r.player===sent.player&&r.packet===sent.packet&&trace.indexOf(r)<trace.indexOf(sent));
        assert(received,'original authenticated packet');
        assert(sent.body.split('\x1e').includes(sent.packet),'unaltered replay bytes');
        const [event,body]=JSON.parse(sent.packet.slice(2)),board=JSON.parse(body);
        assert(/^42\[/.test(sent.packet)&&['gameStarted','playYourTurn'].includes(event),'active packet');
        ck('packet-game-recipient',[terminal.gameID,1],[board.coopCommit.gameID,board.whooseTurn]);
        const pre=captures.filter(r=>r.boundary==='replay-before'),post=captures.filter(r=>r.boundary==='replay-after');
        assert(trace.indexOf(received)<trace.indexOf(pre[0]),'packet received before replay boundary');
        assert(trace.indexOf(pre.at(-1))<trace.indexOf(sent)&&trace.indexOf(sent)<trace.indexOf(dispatch)&&
            trace.indexOf(dispatch)<trace.indexOf(post[0]),'ordered authenticated dispatch boundary');
        for(const participant of ['p1','p2']) {
            const a=pre.find(r=>r.participant===participant),b=post.find(r=>r.participant===participant);
            assert(board.coopCommit.revision<a.raw.state.commit.revision,'stale revision required');
            reviewBoundary({tier:'captured-network-replay',session:a.session,beforeSession:a.session,afterSession:b.session,
                before:a.raw,after:b.raw,captured:{packet:received.packet},dispatch:{confirmed:true,packet:sent.packet}});
        }
    } else ck('no-unplanned-replay',0,stages('late-active-receipt-replayed').length);
    return {checks, policy, wholeCriterionCredit:false};
}
module.exports={reviewJoin,policyFor,packedView,rawView};
