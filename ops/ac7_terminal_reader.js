'use strict';
// Independent read-only reader for TASK-225 AC7 (bounded coverage) over one terminal
// acquisition run directory. Every expected value is recomputed from shipped source or
// from the raw traces; no stored pass boolean is consulted.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CLIENT = '/root/diplomacy';
const SERVER = '/root/diplomacy_server';
const CHECKPOINT_FILES = ['contract-checkpoints.json', 'ac3-contract-checkpoints.json',
    'command-boundary-checkpoints.json', 'page-source/checkpoints.json', 'provider/checkpoints.json'];
const EXIT_FILES = ['source-exit.json', 'shutdown-source-exit.json', 'provider-exit.json',
    'diff-check-0-exit.json', 'diff-check-1-exit.json'];
const SOURCES = {client: ['ai/coop-map-scaling.js', 'options/gamestart.js'], server: ['server/matchmakingSlots.js']};
const TAPS = ['source.log', 'provider/children/001-reliability_terminal-flow/stdout.log'];

// AC7 as written in artifacts/tasks.json TASK-225, one entry per clause.
const CLAUSES = [
    ['retain-behaviors-tiered', 'retain each distinct behavior and boundary below, but test class/seed/count combinations with broad production-source checks and focused real network cases'],
    ['browser-journeys', 'Use at most four browser journeys'],
    ['two-humans', 'two humans by default (four only when required to prove independent components)'],
    ['smallest-maps', 'smallest supported maps'],
    ['seed-1', 'and seed 1'],
    ['fog-join-spread', 'Cover fog and join modes across journeys rather than their Cartesian product.'],
    ['declared-fixtures', 'Use declared valid initial fixtures for focused mechanics.'],
    ['diagnostics-excluded', 'Full browser cross-products, repeated long natural games and high-count rendering stress are optional diagnostics, explicitly excluded from this green gate.'],
    ['exact-assertions', 'Exact assertions remain required within every selected case.'],
];

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const jsonl = bytes => bytes.toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

function load(runDir, roots = {client: CLIENT, server: SERVER}) {
    const files = {};
    const read = (key, abs) => { files[key] = {path: abs, bytes: fs.readFileSync(abs)}; };
    const run = rel => read(rel, path.join(runDir, rel));
    ['verification-plan.json', 'provider/coverage-results.json', 'provider/source-identities.json',
        'provider/terminal-inventory.json', 'page-source/page-observations.json',
        ...CHECKPOINT_FILES, ...EXIT_FILES, ...TAPS].forEach(run);
    // Browser journeys are whatever the plan selected, so a fifth selected journey is observable.
    const plan = JSON.parse(files['verification-plan.json'].bytes);
    for (const j of plan.cases.filter(c => c.startsWith('terminal-'))) {
        for (const f of ['declared-fixture.json', 'network-traces.jsonl', 'input-trace.jsonl', 'cleanup.json']) run(`provider/${j}/${f}`);
    }
    for (const [side, list] of Object.entries(SOURCES)) {
        for (const rel of list) read(`${side}:${rel}`, path.join(roots[side], rel));
    }
    return {runDir, files};
}

function evaluate(input) {
    const f = input.files;
    const text = k => f[k].bytes.toString('utf8');
    const json = k => JSON.parse(text(k));
    const proof = keys => keys.map(k => ({path: f[k].path, sha256: sha(f[k].bytes)}));
    const results = [];
    const clause = (id, keys, fn) => {
        const [, written] = CLAUSES.find(c => c[0] === id);
        let r;
        try { r = fn(); } catch (e) { r = {pass: false, failures: [e.message]}; }
        results.push({id, clause: written, result: r.failures.length ? 'FAIL' : 'PASS',
            expected: r.expected, observed: r.observed, failures: r.failures, proofs: proof(keys)});
    };
    const failures = () => { const list = []; list.check = (cond, msg) => { if (!cond) list.push(msg); }; return list; };
    const deepEqual = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch { return false; } };

    const plan = json('verification-plan.json');
    const JOURNEYS = plan.cases.filter(c => c.startsWith('terminal-'));
    const net = Object.fromEntries(JOURNEYS.map(j => [j, jsonl(f[`provider/${j}/network-traces.jsonl`].bytes)]));
    const inputs = Object.fromEntries(JOURNEYS.map(j => [j, jsonl(f[`provider/${j}/input-trace.jsonl`].bytes)]));
    const fixtures = Object.fromEntries(JOURNEYS.map(j => [j, json(`provider/${j}/declared-fixture.json`)]));
    const started = Object.fromEntries(JOURNEYS.map(j => [j, net[j].find(r => r.stage === 'api-join' && r.event === 'gameStarted')]));
    const menus = j => net[j].filter(r => r.stage === 'ac7-menu-selected');
    const journeyKeys = file => JOURNEYS.map(j => `provider/${j}/${file}`);

    // Expected source facts are read from the tested bytes, bound to the run's source identities.
    const identities = json('provider/source-identities.json');
    const sourceFailures = [];
    for (const [side, list] of Object.entries(SOURCES)) {
        for (const rel of list) {
            const recorded = identities.before[side].files[rel];
            if (recorded !== sha(f[`${side}:${rel}`].bytes)) sourceFailures.push(`${side}:${rel} differs from tested bytes ${recorded}`);
        }
    }
    const sandbox = {module: {exports: {}}};
    vm.runInNewContext(text('client:ai/coop-map-scaling.js'), sandbox);
    const scaling = sandbox.module.exports.getCoopMapScaling;
    const sizes = JSON.parse('[' + /\[('tiny'[^\]]*)\]\.includes\(size\)/.exec(text('server:server/matchmakingSlots.js'))[1].replace(/'/g, '"') + ']');
    const maps = [...text('client:options/gamestart.js').matchAll(/"([a-z ]+)":\s*\[\s*new GameMap\(\s*\{x: (\d+), y: (\d+)\}/g)]
        .map(m => ({name: m[1], x: +m[2], y: +m[3]}));

    clause('retain-behaviors-tiered', ['verification-plan.json', 'provider/terminal-inventory.json', 'provider/checkpoints.json', ...journeyKeys('network-traces.jsonl')], () => {
        const l = failures();
        const rules = json('provider/terminal-inventory.json').rules;
        const ids = json('provider/checkpoints.json').checkpoints.map(c => c.id);
        const sourceCases = plan.sourceCases.map(id => {
            const rule = rules.find(r => r.id === id);
            return {id, tier: rule && rule.tier, checkpoints: ids.filter(c => c.startsWith(`source/${id}/`)).length};
        });
        for (const s of sourceCases) {
            l.check(s.tier === 'shipped source execution', `source case ${s.id} tier ${s.tier}`);
            l.check(s.checkpoints > 0, `source case ${s.id} has no checkpoints`);
        }
        const network = JOURNEYS.map(j => ({journey: j, apiJoin: net[j].filter(r => r.stage === 'api-join').length,
            mongoCommit: net[j].filter(r => r.stage === 'mongo-commit').length,
            realReceipts: net[j].filter(r => r.stage === 'captured-real-receipt').length}));
        for (const n of network) l.check(n.apiJoin > 0 && n.mongoCommit > 0 && n.realReceipts > 0, `${n.journey} lacks real HTTPS/Socket.IO/MongoDB observations`);
        return {expected: {sourceTier: 'shipped source execution', perSourceCase: 'checkpoints>0', perJourney: 'api-join, mongo-commit, captured-real-receipt > 0'},
            observed: {sourceCases, network, scopeNote: 'This acquisition covers the terminal-outcome and next-game behaviors only; behaviors listed elsewhere in AC7 scope are not observed here.'},
            failures: l};
    });

    clause('browser-journeys', ['verification-plan.json', 'provider/coverage-results.json', 'page-source/page-observations.json', ...journeyKeys('input-trace.jsonl')], () => {
        const l = failures();
        const withBrowserInput = JOURNEYS.filter(j => inputs[j].some(r => r.device && r.action));
        const covered = json('provider/coverage-results.json').cases.map(c => c.id);
        const planned = plan.cases.filter(c => c.startsWith('terminal-'));
        const games = JOURNEYS.map(j => started[j] && net[j].find(r => r.stage === 'admission-assignments').gameId);
        const pageTier = json('page-source/page-observations.json').tier;
        l.check(withBrowserInput.length <= 4, `${withBrowserInput.length} browser journeys`);
        l.check(deepEqual(covered, withBrowserInput) && deepEqual(planned, withBrowserInput), 'selected journeys differ from browser-driven journeys');
        l.check(new Set(games).size === games.length, 'journeys share a game');
        l.check(/no game\/network claim/.test(pageTier), `page-source Chromium capture claims a journey: ${pageTier}`);
        return {expected: {maxBrowserJourneys: 4}, observed: {browserJourneys: withBrowserInput, count: withBrowserInput.length,
            coverageCases: covered, plannedJourneyCases: planned, distinctGameIds: games,
            pageSourceCaptureTier: pageTier}, failures: l};
    });

    clause('two-humans', [...journeyKeys('declared-fixture.json'), ...journeyKeys('network-traces.jsonl'), ...journeyKeys('input-trace.jsonl')], () => {
        const l = failures();
        const observed = JOURNEYS.map(j => ({journey: j, declared: fixtures[j].spec.humans,
            initialHumanCount: started[j].board.gameSettings.coop.initialHumanCount,
            admitted: net[j].find(r => r.stage === 'admission-assignments').assignments.length,
            browserPlayers: [...new Set(inputs[j].map(r => r.player))].sort(),
            nextGameMenuHumans: menus(j).map(m => m.state.humans)}));
        for (const o of observed) {
            const counts = [o.declared, o.initialHumanCount, o.admitted, o.browserPlayers.length, ...o.nextGameMenuHumans];
            l.check(counts.every(n => n === 2), `${o.journey} human counts ${JSON.stringify(counts)} (four needs an independent-component justification; none recorded)`);
        }
        return {expected: {humansPerJourney: 2, fourHumanJourneys: 0}, observed, failures: l};
    });

    clause('smallest-maps', ['client:ai/coop-map-scaling.js', 'client:options/gamestart.js', 'server:server/matchmakingSlots.js',
        'provider/source-identities.json', ...journeyKeys('declared-fixture.json'), ...journeyKeys('network-traces.jsonl')], () => {
        const l = failures();
        sourceFailures.forEach(m => l.push(m));
        const sides = Object.fromEntries(sizes.map(s => [s, scaling(2, s).side]));
        const coopSmallest = sizes.reduce((a, b) => (sides[b] < sides[a] ? b : a));
        const area = m => m.x * m.y;
        const competitiveSmallest = maps.reduce((a, b) => (area(b) < area(a) ? b : a));
        const observed = JOURNEYS.map(j => {
            const generation = started[j].board.gameSettings.coop.generation;
            const next = net[j].find(r => r.stage === 'next-game');
            return {journey: j, coopSize: generation.size, gridSide: started[j].board.grid.length,
                nextGame: menus(j).map(m => ({mode: m.state.mode, size: m.state.size, map: m.state.map, catalog: m.state.catalog})),
                nextGameBoard: next ? [next.before.ownership.length, next.before.ownership[0].length] : null};
        });
        const nextSide = Math.min(...sizes.filter(s => s !== coopSmallest).map(s => sides[s]));
        for (const o of observed) {
            l.check(o.coopSize === coopSmallest, `${o.journey} size ${o.coopSize}`);
            l.check(o.gridSide < nextSide, `${o.journey} side ${o.gridSide} not below next size side ${nextSide}`);
            for (const m of o.nextGame) {
                if (m.mode === 'coop') l.check(m.size.toLowerCase() === coopSmallest, `${o.journey} next co-op size ${m.size}`);
                if (m.mode === 'competitive') {
                    l.check(m.map === competitiveSmallest.name, `${o.journey} next competitive map ${m.map}`);
                    l.check(deepEqual(m.catalog.map(c => ({name: c.name, x: c.size.x, y: c.size.y})), maps), `${o.journey} page catalog differs from shipped source`);
                    l.check(deepEqual(o.nextGameBoard, [competitiveSmallest.x, competitiveSmallest.y]), `${o.journey} next board ${o.nextGameBoard}`);
                }
            }
        }
        l.check(observed.some(o => o.nextGame.some(m => m.mode === 'competitive')), 'no competitive map selection observed');
        observed.forEach(o => o.nextGame.forEach(m => { delete m.catalog; }));
        return {expected: {supportedCoopSizes: sizes, sidesFor2Humans: sides, coopSmallest, competitiveCatalogFromSource: maps.length,
            competitiveSmallest}, observed, failures: l};
    });

    clause('seed-1', [...journeyKeys('declared-fixture.json'), ...journeyKeys('network-traces.jsonl')], () => {
        const l = failures();
        const observed = JOURNEYS.map(j => {
            const g = started[j].board.gameSettings.coop.generation;
            return {journey: j, declared: fixtures[j].spec.seed, generation: g.seed, options: g.options.seed,
                nextCoopMenuSeed: menus(j).filter(m => m.state.mode === 'coop').map(m => Number(m.state.map))};
        });
        for (const o of observed) {
            l.check([o.declared, o.generation, o.options, ...o.nextCoopMenuSeed].every(s => s === 1), `${o.journey} seeds ${JSON.stringify(o)}`);
        }
        return {expected: {seed: 1, note: 'competitive fixed maps carry no seed'}, observed, failures: l};
    });

    clause('fog-join-spread', journeyKeys('network-traces.jsonl'), () => {
        const l = failures();
        const observed = JOURNEYS.map(j => ({journey: j, fog: started[j].board.isFogOfWar,
            join: [...new Set(net[j].filter(r => r.join).map(r => r.join))]}));
        for (const o of observed) l.check(o.join.length === 1, `${o.journey} mixes join modes ${o.join}`);
        const fogs = [...new Set(observed.map(o => o.fog))].sort();
        const joins = [...new Set(observed.map(o => o.join[0]))].sort();
        const pairs = [...new Set(observed.map(o => `${o.fog}/${o.join[0]}`))].sort();
        l.check(deepEqual(fogs, [false, true]), `fog modes ${fogs}`);
        l.check(deepEqual(joins, ['sequential', 'simultaneous']), `join modes ${joins}`);
        if (fogs.length > 1 && joins.length > 1) l.check(pairs.length < fogs.length * joins.length, `pairs ${pairs} form the Cartesian product`);
        return {expected: {fogModes: [false, true], joinModes: ['sequential', 'simultaneous'], maxDistinctPairs: 3},
            observed: {perJourney: observed, fogModes: fogs, joinModes: joins, distinctPairs: pairs}, failures: l};
    });

    clause('declared-fixtures', ['client:ai/coop-map-scaling.js', 'server:server/matchmakingSlots.js', ...journeyKeys('declared-fixture.json'), ...journeyKeys('network-traces.jsonl')], () => {
        const l = failures();
        sourceFailures.forEach(m => l.push(m));
        const observed = JOURNEYS.map(j => {
            const {spec, b} = fixtures[j];
            const g = b.gameSettings.coop.generation;
            const bound = net[j].filter(r => r.fixtureSha256).map(r => r.fixtureSha256);
            const categories = {};
            spec.portals.forEach(p => { categories[p.category] = (categories[p.category] || 0) + 1; });
            const expected = sizes.includes(g.size) ? JSON.parse(JSON.stringify(scaling(g.playerCount, g.size))) : null;
            const board = started[j].board;
            const towns = players => players.map(p => (p.towns || []).map(t => t.coord ? [t.coord.x, t.coord.y] : [t.x, t.y]));
            return {journey: j, kind: g.testFixture.kind, generated: g.testFixture.generated, purpose: g.testFixture.purpose,
                fileSha256: sha(f[`provider/${j}/declared-fixture.json`].bytes), boundTraceRows: bound.length,
                boundMatches: bound.every(h => h === sha(f[`provider/${j}/declared-fixture.json`].bytes)),
                size: g.size, playerCount: g.playerCount, humans: spec.humans, withAI: b.gameSettings.withAI,
                gridSquare: b.grid.length === spec.side && b.grid.every(r => r.length === spec.side),
                portals: categories, expectedPortals: expected && expected.counts.portalCategories,
                deliveredGridMatches: deepEqual(board.grid, b.grid), deliveredRound: [b.gameRound, board.gameRound],
                deliveredFog: [b.isFogOfWar, board.isFogOfWar],
                deliveredTownsMatch: deepEqual(towns(board.players), towns(b.players))};
        });
        for (const o of observed) {
            l.check(o.kind === 'declared-local-fixture' && o.generated === false && o.purpose.length > 0, `${o.journey} not a declared fixture`);
            l.check(o.boundTraceRows > 0 && o.boundMatches, `${o.journey} fixture bytes not bound by traces`);
            l.check(sizes.includes(o.size) && o.playerCount === o.humans && o.withAI === false, `${o.journey} invalid generation metadata`);
            l.check(o.gridSquare, `${o.journey} grid is not ${o.journey} side x side`);
            l.check(deepEqual(o.portals, o.expectedPortals), `${o.journey} portal categories ${JSON.stringify(o.portals)}`);
            l.check(o.deliveredGridMatches && o.deliveredRound[0] === o.deliveredRound[1] && o.deliveredFog[0] === o.deliveredFog[1] && o.deliveredTownsMatch,
                `${o.journey} delivered initial board differs from declared fixture`);
        }
        return {expected: {kind: 'declared-local-fixture', generated: false, portalsFromSource: JSON.parse(JSON.stringify(scaling(2, sizes[0]).counts.portalCategories)),
            deliveredInitialBoard: 'grid, round, fog and town coordinates equal the declared fixture'}, observed, failures: l};
    });

    clause('diagnostics-excluded', ['verification-plan.json', ...journeyKeys('declared-fixture.json')], () => {
        const l = failures();
        const diagnostic = /cross-?product|natural|stress|render/i;
        const selected = [...plan.cases, ...plan.newCases, ...plan.sourceCases];
        const flagged = selected.filter(c => diagnostic.test(c));
        const starts = JOURNEYS.map(j => ({journey: j, fixtureSha256: sha(f[`provider/${j}/declared-fixture.json`].bytes),
            generated: fixtures[j].b.gameSettings.coop.generation.testFixture.generated, fixtureRound: fixtures[j].b.gameRound}));
        const repeated = starts.filter((s, i) => starts.findIndex(t => t.fixtureSha256 === s.fixtureSha256) !== i).map(s => s.journey);
        l.check(flagged.length === 0, `diagnostic cases selected: ${flagged}`);
        l.check(starts.every(s => s.generated === false), 'a journey starts from a generated natural game');
        l.check(repeated.length === 0, `repeated games: ${repeated}`);
        return {expected: {diagnosticCasesSelected: [], naturalGameStarts: 0, repeatedFixtures: []},
            observed: {selectedCases: selected, flagged, journeyStarts: starts, repeated,
                crossProduct: 'judged by fog-join-spread; journey count by browser-journeys'}, failures: l};
    });

    clause('exact-assertions', ['verification-plan.json', ...CHECKPOINT_FILES, ...EXIT_FILES, ...TAPS, ...journeyKeys('cleanup.json')], () => {
        const l = failures();
        const rows = {};
        for (const k of CHECKPOINT_FILES) {
            const d = json(k);
            rows[k] = Array.isArray(d) ? d : d.checkpoints;
        }
        const recomputed = {};
        for (const [k, list] of Object.entries(rows)) {
            const inexact = list.filter(r => !('expected' in r) || !('observed' in r)).map(r => r.id);
            const unequal = list.filter(r => 'expected' in r && 'observed' in r && !deepEqual(r.expected, r.observed)).map(r => r.id);
            recomputed[k] = {rows: list.length, inexact, unequal};
            l.check(inexact.length === 0 && unequal.length === 0 && list.length > 0, `${k}: inexact ${inexact} unequal ${unequal}`);
        }
        const provider = rows['provider/checkpoints.json'].map(r => r.id);
        const count = (list, pred) => list.filter(pred).length;
        const exits = EXIT_FILES.map(k => ({file: k, actualExit: json(k).actualExit, signal: json(k).signal}));
        const cleanups = JOURNEYS.map(j => ({journey: j, cleanup: json(`provider/${j}/cleanup.json`)}));
        const cases = {
            'joined-reader-contract': ['contract-checkpoints.json', 'ac3-contract-checkpoints.json', 'command-boundary-checkpoints.json', 'page-source/checkpoints.json']
                .reduce((n, k) => n + rows[k].length, 0),
            'source-provider-wiring': plan.sourceCases.map(s => count(provider, id => id.startsWith(`source/${s}/`))),
            'hash-exit-cleanup-audit': count(provider, id => id === 'required-checkpoints' || id.endsWith('/cleanup')) + exits.length,
        };
        for (const j of JOURNEYS) cases[j] = count(provider, id => id.startsWith(`${j}/`));
        for (const c of plan.cases) {
            const n = cases[c];
            l.check(n !== undefined && [].concat(n).every(x => x > 0), `selected case ${c} has no exact assertion`);
        }
        for (const e of exits) l.check(e.actualExit === 0 && e.signal === null, `${e.file} exit ${e.actualExit}`);
        const cleanupRows = cleanups.map(c => ({journey: c.journey, row: rows['provider/checkpoints.json'].find(r => r.id === `${c.journey}/cleanup`)}));
        for (const c of cleanupRows) l.check(c.row && deepEqual(c.row.expected, c.row.observed), `${c.journey} cleanup assertion missing`);
        const taps = TAPS.map(k => ({file: k, notOk: (text(k).match(/^\s*not ok /mg) || []).length,
            fail: (/^# fail (\d+)$/m.exec(text(k)) || [])[1], ok: (text(k).match(/^\s*ok /mg) || []).length}));
        for (const t of taps) l.check(t.notOk === 0 && t.fail === '0' && t.ok > 0, `${t.file} TAP not clean`);
        return {expected: {everyRow: 'expected deep-equals observed (recomputed)', perSelectedCase: '>0 exact rows', exits: 0, tapNotOk: 0},
            observed: {selectedCases: plan.cases, rowsPerCase: cases, recomputed, exits, taps}, failures: l};
    });

    return {reader: 'ops/ac7_terminal_reader.js', runDir: input.runDir, clauseCount: results.length,
        pass: results.every(r => r.result === 'PASS'), results};
}

module.exports = {CLAUSES, load, evaluate};

if (require.main === module) {
    const [runDir, out] = process.argv.slice(2);
    const report = evaluate(load(path.resolve(runDir)));
    const body = JSON.stringify(report, null, 2) + '\n';
    if (out) fs.writeFileSync(out, body, {flag: 'wx'});
    for (const r of report.results) console.log(`${r.result} ${r.id}${r.failures.length ? ': ' + r.failures.join('; ') : ''}`);
    console.log(`clauses ${report.clauseCount} pass ${report.pass}`);
    process.exitCode = report.pass ? 0 : 1;
}
