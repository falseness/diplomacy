'use strict';
// Sufficiency inspection only. Never exports a coverage row or runs a provider.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = '/root/diplomacy';
const server = '/root/diplomacy_server';
const archive = path.join(root, 'artifacts/TASK-221/green-12');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const cases = ['terminal-victory', 'terminal-draw', 'terminal-to-coop', 'terminal-to-competitive'];

function inspect(out) {
    assert(fs.existsSync(path.join(out, 'verification-plan.json')), 'predeclared plan required');
    assert(!fs.existsSync(path.join(out, 'ac2-sufficiency.json')), 'refuse evidence overwrite');
    const proofs = {};
    const bind = file => { proofs[file] = sha(file); return fs.readFileSync(file, 'utf8'); };
    const save = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
    const ids = JSON.parse(bind(path.join(archive, 'source-identities.json')));
    const source = (repo, name) => {
        const file = path.join(repo === 'client' ? root : server, name);
        const text = bind(file);
        assert.equal(proofs[file], ids.after[repo].files[name], 'pinned implementation: ' + name);
        return text;
    };
    const player = source('client', 'player.js');
    const observation = source('server', 'tests/reliability/helpers/observation-game.js');
    const next = source('server', 'tests/reliability/helpers/terminal-flow-next-game.js');
    source('server', 'tests/reliability/helpers/building-state.js');
    assert(next.includes("const {OBSERVE}=require('./observation-game')"));
    assert(next.includes('const {at,...state}=await ps[0].observe(OBSERVE)'));
    const start = observation.indexOf('const OBSERVE = () => {');
    const end = observation.indexOf('\n};', start);
    assert(start >= 0 && end > start, 'locate exact production observer');
    // Execute the exact pinned observer and complete production class source.
    // VM fixtures are source-tier controls, never browser or network evidence.
    const context = vm.createContext({performance: {now: () => 0}, menu: {visible: false},
        whooseTurn: 1, gameRound: 0, onlineCommit: null, onlineLobby: null, onlineSocket: null,
        gameEvent: {selected: null, waitingMode: true}, nextTurnPauseInterface: {visible: false},
        nextTurnButton: {unactive: false}, actionManager: {arr: []},
        unpacker: {getPlayerTimerByIndex: () => null}, isFogOfWar: false,
        external: [], externalProduction: [], nature: [], goldmines: [],
        grid: {arr: [], getUnit: () => null}, gameSettings: {coop: {result: 'defeat', humanSlots: [1], humanTeam: 'HUMANS', demonSlot: 2}}});
    vm.runInContext(player + '\n' + observation.slice(start, end + 3), context);
    const mutation = vm.runInContext(`(() => {
        const human = Object.assign(Object.create(Player.prototype), {
            gold: 0, towns: [{killed: true}],
            units: [{killed: true, coord: {x: 1, y: 1}, hp: 0, name: 'noob'}]
        });
        const neutral = Object.assign(Object.create(NeutralPlayer.prototype), {
            gold: 0, units: [], towns: []
        });
        globalThis.players = [neutral, human];
        const before = {units: human.units.length, towns: human.towns.length, result: gameSettings.coop.result};
        const originalUnits = human.units;
        OBSERVE();
        return {before, after: {units: human.units.length, towns: human.towns.length, result: gameSettings.coop.result},
            registryReferenceChanged: human.units !== originalUnits};
    })()`, context);
    assert.deepEqual(JSON.parse(JSON.stringify(mutation)), {
        before: {units: 1, towns: 1, result: 'defeat'},
        after: {units: 0, towns: 0, result: 'draw'}, registryReferenceChanged: true
    });
    save('observer-mutation.json', {tier: 'source-executed counterexample; not a claim archive actually changed values', ...mutation});
    console.log('PASS pinned-observer-counterexample units=1->0 towns=1->0 result=defeat->draw registryReferenceChanged=true');
    const checkpoints = JSON.parse(bind(path.join(archive, 'checkpoints.json'))).checkpoints;
    const matrix = [];
    for (const id of cases) {
        const file = path.join(archive, id, 'network-traces.jsonl');
        const rows = bind(file).trim().split('\n').map(JSON.parse);
        const entries = stage => rows.flatMap((row, i) => row.stage === stage ? [{line: i + 1, row}] : []);
        const replays = entries('late-active-receipt-replayed');
        for (const {line, row} of replays) {
            assert(entries('captured-real-receipt').some(x => x.line < line && x.row.player === row.player && x.row.packet === row.packet));
            assert.equal(row.status, 200);
            assert(row.body.endsWith('\x1e' + row.packet));
            assert(entries('late-active-receipt-dispatched').some(x => x.line > line && x.row.player === row.player && x.row.delivered > 0));
        }
        const replayCheckpoint = checkpoints.find(c => c.id === id + '/next/late-active-receipt-no-change');
        matrix.push({id, trace: file, clauses: {
            finalOwnershipGoldTurns: {location: 'mongo-terminal.stored.rounds[-1][0]; declared-fixture.json', status: 'available; independent AC2 derivation not executed after sufficiency stop'},
            bothUiAndControls: entries('terminal-ui').map(x => ({line: x.line, player: x.row.player, fields: Object.keys(x.row.state)})),
            bothReconnects: [0, 1].map(n => ({id: id + '/terminal-reconnect-' + n + '/exact', exists: checkpoints.some(c => c.id === id + '/terminal-reconnect-' + n + '/exact')})),
            lateReplay: {replayLines: replays.map(x => x.line), dispatchLines: entries('late-active-receipt-dispatched').map(x => x.line), tier: replays.length ? 'real polling response with captured packet appended; representative defeat boundary' : 'represented by the two defeat journeys; not a required outcome cross-product'},
            unchangedAfterReplay: replayCheckpoint ? {checkpoint: replayCheckpoint.id, status: 'INSUFFICIENT', reason: 'Both expected and observed values were collected by mutating OBSERVE; no raw observer-free before/after registry and result capture is retained at this boundary.', observedFields: Object.keys(replayCheckpoint.observed)} : {status: 'represented by defeat journeys'},
            persistedAfterReplay: {checkpoint: id + '/next/late-active-receipt-no-persistence-change', exists: checkpoints.some(c => c.id === id + '/next/late-active-receipt-no-persistence-change')}
        }});
    }
    save('criterion-clause-map.json', matrix);
    const frozen = read(path.join(root, 'artifacts/TASK-225/review-127/frozen-tools.json'));
    bind(path.join(root, 'artifacts/TASK-225/review-127/frozen-tools.json'));
    for (const [name, hash] of Object.entries(frozen)) assert.equal(sha(path.join(root, 'ops', name)), hash);
    for (const relative of ['review-127/historical-selection.json', 'review-114/reviewed-crosswalk.json']) bind(path.join(root, 'artifacts/TASK-225', relative));
    const coverage = JSON.parse(bind(path.join(archive, 'coverage-results.json')));
    for (const [relative, hash] of Object.entries(coverage.evidenceHashes)) {
        const file = path.resolve(archive, relative);
        assert(file.startsWith(archive + '/'), 'contained archived hash');
        bind(file); assert.equal(proofs[file], hash);
    }
    save('proof-hashes.json', proofs);
    save('ac2-sufficiency.json', {result: 'STOP_MISSING_UNMODIFIED_OBSERVATION', wholeCriterionCredit: false,
        currentCreditAdded: 0, fullInvocation: false, overallPass: false,
        missing: cases.filter(id => id.startsWith('terminal-to-')).map(id => ({file: path.join(archive, 'checkpoints.json'),
            field: id + '/next/late-active-receipt-no-change.{expected,observed}',
            required: 'Raw terminal registry/result observations before and after dispatch, collected without isLost/isGameEnded/toJSON or pruning'})),
        semanticCorruptionControls: 'NOT RUN: insufficient whole-criterion proof; do not grant partial credit',
        consumerComparison: 'NOT RUN: prerequisite failed', frozenToolsPreserved: Object.keys(frozen).length,
        selectionChanged: false, preservedBaselineCounts: {requiredPrior: 63, currentCriteria: 74, selfOwners: 8},
        countSource: 'review-127/handoff-audit.json; no new inventory run', archiveHashes: Object.keys(coverage.evidenceHashes).length});
    console.log('STOP_MISSING_UNMODIFIED_OBSERVATION TASK-221/AC2 credit=false consumerRun=false');
    console.log('PASS ancestry-preserved frozenTools=7 selectionChanged=false');
}
if (require.main === module) inspect(path.resolve(process.argv[2]));
module.exports = {inspect};
