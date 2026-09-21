'use strict';
// TASK-180 supplemental client regression, extending the registered server
// opening-controls scenario with ownership, indicators and real waiting joins.
// Kept client-side with the delivery fix; prerequisite service/browser helpers
// come from the sibling server repository.
// Natural menu-generated games; real HTTPS, Socket.IO, MongoDB and shipped clients.
// Evaluation only observes. Declared HTTPS replay repeats exact captured server packets.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {chromium} = require('playwright');
const {withServices} = require('../../diplomacy_server/tests/reliability/helpers/services');
const {BrowserPlayer, startClientServer} = require('../../diplomacy_server/tests/reliability/helpers/browser-driver');
const {sourceSnapshot, LEGAL} = require('../../diplomacy_server/tests/reliability/helpers/browser-game');
const {OPENING} = require('../../diplomacy_server/tests/reliability/helpers/first-connection-game');
const {OBSERVE} = require('../../diplomacy_server/tests/reliability/helpers/observation-game');
const obs = require('../../diplomacy_server/tests/reliability/helpers/observations');
const out = process.env.ONLINE_EVIDENCE_DIR;
const {suburbCells, MODES} = require('../../diplomacy_server/tests/reliability/helpers/first-connection');
const checks = [], records = [], wire = [], errors = [], secrets = [];
const json = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(obs.redact(data, secrets), null, 2) + '\n');
const check = (id, expected, observed) => {
    checks.push({id, expected, observed, pass: JSON.stringify(expected) === JSON.stringify(observed)});
    console.log(`${checks.at(-1).pass ? 'PASS' : 'FAIL'} ${id}`);
    // Accumulate oracle failures so both modes retain their real reproduction.

};
const wait = async (label, probe, ms = 60000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { const result = await probe(); if (result) return result; await new Promise(r => setTimeout(r, 100)); }
    throw new Error(`timeout: ${label}`);
};
const password = () => Array.from({length: 12}, () => crypto.randomInt(0, 10)).join('');
const state = async p => ({opening: await p.observe(OPENING), game: obs.localGameplay(await p.observe(OBSERVE)), controls: await p.observe(() => ({tick: timer.isTick, undo: undoButton.canClick, enabled: nextTurnButton.canClick, waiting: gameEvent.waitingMode, slot: whooseTurn}))});
const pause = async p => { if (await p.observe(() => nextTurnPauseInterface.visible)) await p.tap({x: 640, y: 450}, 'dismiss turn overlay', '!nextTurnPauseInterface.visible'); };
const submit = async p => {
    await pause(p);
    await p.page.waitForFunction(() => nextTurnButton.canClick && !nextTurnButton.unactive, null, {timeout: 8000});
    const round = await p.observe(() => gameRound);
    await p.tapControl('nextTurnButton', 'end turn', `gameEvent.waitingMode || gameRound > ${round}`);
};
async function join(p, mode, secret) {
    await p.tapControl('menu.main.buttons[1]', 'online menu', 'menu.selectedTree === menu.online');
    if (mode === 'coop') {
        await p.tapControl('menu.online.modeButton', 'co-op mode', 'menu.online.isCoop');
        await p.tapControl('menu.online.sizeSlider.leftButton', 'tiny map', "menu.online.sizeSlider.realValue === 'Tiny'");
    }
    for (const [i, digit] of [...secret].entries())
        await p.tapControl(`menu.online.passwordButtons[${digit}]`, 'password digit [redacted]', `menu.online.currentPassword.length === ${i + 1}`);
    await p.tapControl('menu.online.playButton', 'start menu', 'menu.selectedTree === menu.startGame');
    await p.tapControl('menu.startGame.buttons[0].movingForm.elements[0].rect', 'join slot', '!menu.visible');
    await p.page.waitForFunction(() => onlineSocket.connected && onlineLobby?.occupiedHumans > 0 && whooseTurn > 0, null, {timeout: 60000});
}
async function move(p, index) {
    await pause(p);
    const s = await p.observe(OPENING), u = s.players[s.whooseTurn].units[0];
    const source = {x: u.x, y: u.y};
    await p.tapCell(source, 'select own unit', 'gameEvent.selected.isUnit === true');
    const legal = await p.observe(LEGAL, source);
    assert(legal.moves.length > index, 'legal destination available');
    const target = legal.moves.sort((a, b) => a.x - b.x || a.y - b.y)[index];
    await p.tapCell(target, 'unsubmitted local move', `grid.arr[${target.x}][${target.y}].unit.notEmpty()`);
    return {source, target, state: await state(p)};
}

const beforeSources = sourceSnapshot();
if (!out) throw new Error('explicit evidence directory required');
fs.mkdirSync(path.join(out, 'screenshots'), {recursive: true});
for (const f of ['control-checkpoints.json', 'opening-event-ledger.json'])
    if (fs.existsSync(path.join(out, f))) throw new Error(`refusing historical overwrite: ${f}`);
const turns = d => d.rounds[0].slice(1).flatMap(c => c.turns);
const stable = s => ({game: s.game, controls: s.controls, undo: s.opening.undoLength});
function save() {
    json('control-checkpoints.json', records);
    json('opening-event-ledger.json', wire);
    json('checkpoints.json', {passed: checks.filter(c => c.pass).length, failed: checks.filter(c => !c.pass).length,
        checkpoints: checks, failures: records.filter(r => r.failure).map(r => ({mode: r.mode, failure: r.failure}))});
}
for (const mode of ['coop', 'competitive']) test(`opening controls: ${mode}`, {timeout: 900000}, async () => {
    const record = {mode, fixtures: 'none; natural games created through shipped menus', observations: [], replays: [], actions: [], failure: null};
    records.push(record);
    const passwords = {host: password(), peer: password()}; secrets.push(...Object.values(passwords));
    let browser, client, logDir, stopping = false;
    const localErrors = [], captured = {}, queued = {};
    try {
        await withServices({evidenceDir: path.join(out, mode), label: 'services', pollingOnly: true}, async service => {
            logDir = service.logDir; client = await startClientServer();
            const spki = crypto.createHash('sha256').update(new crypto.X509Certificate(service.certificate.pem).publicKey.export({type: 'spki', format: 'der'})).digest('base64');
            browser = await chromium.launch({headless: true, args: [`--ignore-certificate-errors-spki-list=${spki}`]});
            record.runtime = {node: process.version, chromium: browser.version(), playwright: require('playwright/package.json').version, services: service.lifecycle.runtime};
            console.log('runtime ' + JSON.stringify(record.runtime));
            const open = name => BrowserPlayer.open(browser, {name, input: 'mouse', endpoint: service.endpoint, clientUrl: client.url,
                screenshotDir: path.join(out, 'screenshots'), errors: localErrors, events: {write() {}},
                inputs: {write(line) {const r = JSON.parse(line); delete r.until;
                    fs.appendFileSync(path.join(out, 'input-traces.jsonl'), JSON.stringify({mode, ...r}) + '\n');}},
                wire: r => wire.push({mode, at: Date.now(), player: r.player, direction: r.direction, ...obs.sanitizePacket(r.text, secrets)}),
                beforeNavigate: async p => {
                    captured[name] = [];
                    // Replay exact real server packets at the HTTPS transport boundary.
                    // No browser state mutation, fake Socket.IO handlers or synthetic boards.
                    await p.page.route('**/socket.io/**', async route => {
                        if (route.request().method() !== 'GET') return route.continue();
                        try {
                        const response = await new Promise((resolve, reject) => {
                            const request = require('node:https').get(route.request().url(), {
                                ca: service.certificate.pem, headers: route.request().headers(), timeout: 60000,
                            }, res => {
                                const chunks = []; res.on('data', c => chunks.push(c));
                                res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString()}));
                                res.on('error', reject);
                            });
                            request.on('error', reject); request.on('timeout', () => request.destroy(new Error('replay transport timeout')));
                        });
                        let body = response.body;
                        for (const packet of body.split('\x1e')) if (/^42\["(gameStarted|playYourTurn|waitYouTurn)"/.test(packet)) captured[name].push(packet);
                        const injection = queued[name];
                        if (injection) { body += '\x1e' + injection.packet; delete queued[name]; }
                        await route.fulfill({status: response.status, headers: response.headers, body});
                        if (injection) injection.delivered = true;
                        } catch (e) {
                            // Closing a browser cancels its outstanding long poll.
                            if (!stopping) localErrors.push({player: name, type: 'replay-transport', text: e.message});
                            await route.abort().catch(() => {});
                        }
                    });
                }});
            const games = service.mongo.db(service.databaseName).collection('games');
            const find = () => games.findOne({playerIndexToUserIndex: obs.sha256(passwords.host)});
            const host = await open('host'); await join(host, mode, passwords.host);
            const peer = await open('peer'); await join(peer, mode, passwords.peer);
            for (const p of [host, peer]) await p.page.waitForFunction(() => onlineLobby.occupiedHumans === 2);
            const initial = await find();
            record.initialComponents = initial.rounds[0].slice(1).map(c => ({next: c.nextTurnIndex, slots: c.turns.map(t => t.playerIndex)}));
            check(`${mode}:initial-independent-components`, [[1], [2]], record.initialComponents.map(c => c.slots));
            check(`${mode}:participants`, 2, initial.playerIndexToUserIndex.filter(Boolean).length);
            async function controls(p, stage, eligible) {
                const s = await state(p); record.observations.push({player: p.name, stage, state: s});
                check(`${mode}:${p.name}:${stage}:controls`, {tick: eligible, undo: eligible, enabled: eligible, waiting: !eligible, slot: p.name === 'peer' ? 2 : 1}, s.controls);
                check(`${mode}:${p.name}:${stage}:player-count`, mode === 'coop' ? 4 : 3, s.opening.players.length);
                check(`${mode}:${p.name}:${stage}:colors`, ['#ff0000', '#62a8de'], s.opening.players.slice(1, 3).map(x => x.color));
                check(`${mode}:${p.name}:${stage}:controller-exclusion`, eligible ? [1, 2] : [2], obs.storedEligible((await find()).rounds.at(-1)));
                check(`${mode}:${p.name}:${stage}:turn-indicator`, {color: p.name === 'peer' ? '#62a8de' : '#ff0000', drawn: eligible, highlighted: false},
                    await p.observe(() => ({color: nextTurnButton.img.color, drawn: nextTurnButton.canClick, highlighted: nextTurnButton.highlightButton})));
                return s;
            }
            for (const p of [host, peer]) {
                await pause(p);
                const s = await controls(p, 'initial', true);
                check(`${mode}:${p.name}:starting-assets`, [{units: ['noob'], towns: 1}, {units: ['noob'], towns: 1}], s.opening.players.slice(1, 3).map(x => ({units: x.units.map(u => u.name), towns: x.towns.length})));
                check(`${mode}:${p.name}:no-selected-unit`, false, s.opening.selectedUnit);
                check(`${mode}:${p.name}:opening-gold`, mode === 'coop' ? [110, 110] : [1010, 1010], s.game.players.slice(1, 3).map(x => x.gold));
                for (const slot of [1, 2]) {
                    const anchor = MODES[mode].towns?.[slot] || s.opening.players[slot].towns[0];
                    const sort = rows => [...rows].sort((a, b) => a.x - b.x || a.y - b.y);
                    check(`${mode}:${p.name}:ownership-${slot}`, sort(suburbCells(anchor, MODES[mode].dims)), sort(s.opening.owned[slot]));
                    check(`${mode}:${p.name}:starting-unit-${slot}`, [{name: 'noob', x: anchor.x, y: anchor.y, moves: 2}], s.opening.players[slot].units);
                }
                await p.screenshot(`${mode}-initial`);
            }
            async function replay(p, stage, packet) {
                assert(packet, 'real captured packet required');
                const r = {player: p.name, stage, packet: obs.sanitizePacket(packet, secrets), before: stable(await state(p))};
                record.replays.push(r);
                const injection = queued[p.name] = {packet, delivered: false};
                await wait('replayed HTTPS packet delivered', () => injection.delivered, 60000);
                await p.page.waitForTimeout(500);
                r.after = stable(await state(p));
                check(`${mode}:${stage}:preserve-local-state`, r.before, r.after);
                save();
            }
            const openingPacket = captured.host[0];
            record.actions.push(await move(host, 0));
            const town = (await host.observe(OPENING)).players[1].towns[0];
            await host.tapCell(town, 'select town for purchase', 'townInterface.visible');
            const gold = (await state(host)).game.players[1].gold;
            await host.tapControl('townInterface.trainInterfaces.unit.normchel.button', 'purchase normchel', `players[whooseTurn].gold === ${gold - 40}`);
            check(`${mode}:purchase-recorded`, [{name: 'normchel', turns: 2}], (await state(host)).game.players[1].towns.filter(t => t.production).map(t => t.production));
            await replay(host, 'duplicate-initial-after-move-and-purchase', openingPacket);
            await replay(host, 'equal-initial-delivery', openingPacket);
            const submitted = (await state(host)).game;
            await submit(host);
            await wait('Mongo accepted host', async () => turns(await find()).some(t => t.playerIndex === 1 && t.gameObject));
            await host.page.waitForFunction(() => gameEvent.waitingMode);
            if (mode === 'coop') await peer.page.waitForFunction(() => onlineCommit.revision === 1);
            const before = stable(await state(host));
            const sent = () => wire.filter(r => r.mode === mode && r.player === 'host' && r.direction === 'sent' && r.event === 'nextTurn').length;
            const count = sent();
            await host.tapCell(town, 'waiting town click');
            await host.tapControl('nextTurnButton', 'waiting end-turn click');
            await host.tapControl('undoButton', 'waiting undo click');
            await host.page.waitForTimeout(500);
            check(`${mode}:waiting-clicks-no-mutation`, before, stable(await state(host)));
            check(`${mode}:waiting-clicks-no-command`, count, sent());
            check(`${mode}:waiting-controls`, {tick: false, undo: false, enabled: false, waiting: true, slot: 1}, (await state(host)).controls);
            check(`${mode}:only-peer-eligible`, [2], obs.storedEligible((await find()).rounds[0]));
            check(`${mode}:committed-host`, submitted.players[1], obs.sharedGameplay(turns(await find()).find(t => t.playerIndex === 1).gameObject).players[1]);
            await host.screenshot(`${mode}-waiting`);
            // A new shipped browser joins the already submitted identity through
            // its menu: an actual waiting delivery, including competitive mode.
            const waiting = await open('waiting'); await join(waiting, mode, passwords.host);
            await waiting.page.waitForFunction(() => gameEvent.waitingMode);
            assert(captured.waiting.some(packet => packet.startsWith('42["waitYouTurn"')), 'real waiting packet');
            await controls(waiting, 'waiting-delivery', false);
            const waitingBefore = stable(await state(waiting));
            const waitingSent = wire.filter(r => r.player === 'waiting' && r.direction === 'sent' && r.event === 'nextTurn').length;
            await waiting.tapCell(town, 'waiting delivery town click');
            await waiting.tapControl('nextTurnButton', 'waiting delivery end turn');
            await waiting.tapControl('undoButton', 'waiting delivery undo');
            check(`${mode}:waiting-delivery-clicks-no-mutation`, waitingBefore, stable(await state(waiting)));
            check(`${mode}:waiting-delivery-no-command`, waitingSent, wire.filter(r => r.player === 'waiting' && r.direction === 'sent' && r.event === 'nextTurn').length);
            await replay(waiting, 'duplicate-waiting-delivery', captured.waiting.find(packet => packet.startsWith('42["waitYouTurn"')));
            await waiting.screenshot(`${mode}-waiting-delivery`);
            record.actions.push(await move(peer, 0)); await submit(peer);
            await wait('both submissions accepted', async () => turns(await find()).filter(t => t.gameObject).length === 2);
            for (const p of [host, peer, waiting]) {
                await p.page.waitForFunction(() => gameRound === 1);
                await pause(p); await controls(p, 'round-one', true);
            }
            await replay(host, 'stale-opening-after-round-advance', openingPacket);
            await host.screenshot(`${mode}-after-stale`);
            record.accepted = turns(await find()).filter(t => t.gameObject).map(t => t.playerIndex);
            check(`${mode}:exactly-two-commits`, [1, 2], record.accepted.sort());
            stopping = true; await browser.close(); browser = null;
            check(`${mode}:browser-errors`, [], localErrors); errors.push(...localErrors);
            check(`${mode}:server-errors`, [], fs.readFileSync(path.join(logDir, 'server.log'), 'utf8').split('\n').filter(l => /Error handling|Unhandled|TypeError|AssertionError|ReferenceError|RangeError/.test(l)));
        });
    } catch (e) {record.failure = e.stack; throw e;}
    finally {
        stopping = true; if (browser) await browser.close(); if (client) await client.close();
        if (logDir) for (const name of fs.readdirSync(logDir)) {
            const f = path.join(logDir, name); if (fs.statSync(f).isFile()) fs.writeFileSync(f, obs.redactText(fs.readFileSync(f, 'utf8'), secrets));
        }
        const after = sourceSnapshot(), stale = [];
        for (const role of ['client', 'server']) for (const f of new Set([...Object.keys(beforeSources[role].files), ...Object.keys(after[role].files)]))
            if (beforeSources[role].files[f] !== after[role].files[f]) stale.push(`${role}:${f}`);
        json('source-identities.json', {before: beforeSources, after, stale});
        check(`${mode}:source-hashes`, [], stale); json('browser-errors.json', errors); save();
    }
    assert.equal(checks.filter(c => c.id.startsWith(mode + ':') && !c.pass).length, 0, 'all opening control assertions must pass');
});
test('opening-controls oracle negative controls', () => {
    const base = records[0]?.replays[0]; assert(base?.after, 'real replay required');
    const variants = [
        ['reset-moves', r => r.game.players[1].units[0].moves++],
        ['lost-purchase', r => r.game.players[1].towns[0].production = null],
        ['extra-refresh', r => r.game.players[1].gold += 10],
        ['wrong-eligibility', r => r.controls.waiting = !r.controls.waiting],
    ];
    const negatives = variants.map(([name, mutate]) => {
        const changed = structuredClone(base.before); mutate(changed);
        assert.throws(() => assert.deepEqual(changed, base.before), {code: 'ERR_ASSERTION'});
        return {name, pass: true, reason: 'independent state-equality oracle rejected changed field'};
    });
    json('negative-controls.json', negatives); console.log(`PASS opening-controls negative controls rejected=${negatives.length}`);
});
