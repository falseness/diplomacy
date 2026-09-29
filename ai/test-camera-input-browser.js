'use strict';
// Real-Chromium camera input journey against the shipped client: isolated
// HTTPS/Socket.IO/MongoDB services, a Tiny H2 seed-1 co-op board, normal
// Playwright mouse/keyboard input. Page evaluation only observes (window
// listeners registered after the game's document listeners, and a separate
// requestAnimationFrame observer); camera state is never written.
// Expected displacements come from declared rules below, not from camera state.
// Usage: node ai/test-camera-input-browser.js --output-dir <fresh>
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {chromium} = require('playwright');
const helpers = '../../diplomacy_server/tests/reliability/helpers/';
const {withServices} = require(helpers + 'services');
const {BrowserPlayer, startClientServer} = require(helpers + 'browser-driver');
const {reconnect} = require(helpers + 'movement-identity-reconnect');
const {remoteTransportFixtureSpec, buildCurrentCoopBoardInVm} = require('../../diplomacy_server/tests/coop/helpers/current-coop-fixture');

const VIEWPORT = {width: 1280, height: 900};
// Declared rules (ComputerScreen(0.002 * HEIGHT, 0.04 * HEIGHT), dpr 1):
const SPEED = 0.04 * VIEWPORT.height;       // px of offset per 1000/60 ms
const FRAME = 1000 / 60;
const SEGMENT_CAP = 100;                    // ms, per integrated segment (gameLoop frame cap)
const CENTER = {x: 640, y: 450};
const LEFT_EDGE = {x: 0, y: 450}, TOP_EDGE = {x: 640, y: 0};
const KEY = {ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, ArrowDown: 40};
const THROTTLE_RATE = 20;                   // Emulation.setCPUThrottlingRate, fixed
const LOW_FPS_PRESSES = 8;                  // declared 30 ms presses under throttling, all asserted
const TOLERANCE = 1e-6;                     // px
const CASES = ['central-mouse-hold', 'release-resumes-edge', 'opposite-release', 'short-press-30', 'short-press-78',
    'low-fps-short-press', 'map-edge', 'idle-final'];
module.exports = {CASES, THROTTLE_RATE, SPEED};

function parseArgs(argv) {
    let outputDir = null;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--output-dir') outputDir = argv[++i];
        else throw Error('unknown argument ' + argv[i]);
    }
    if (!outputDir) throw Error('--output-dir is required');
    if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length) throw Error('output dir not fresh: ' + outputDir);
    return {outputDir: path.resolve(outputDir)};
}

// Declared camera model: horizontal/vertical direction from held keys (latest
// press wins per axis), else from the mouse edge; right/down (+1) raise offset.
function direction(state) {
    const axis = (held, neg) => held.length ? (neg.includes(held[held.length - 1]) ? -1 : 1) : null;
    const edge = {x: state.mouse.x < 1.8 ? -1 : state.mouse.x > VIEWPORT.width - 1.8 ? 1 : 0,
        y: state.mouse.y < 1.8 ? -1 : state.mouse.y > VIEWPORT.height - 1.8 ? 1 : 0};
    return {x: axis(state.h, [KEY.ArrowLeft]) ?? edge.x, y: axis(state.v, [KEY.ArrowUp]) ?? edge.y};
}
function applyInput(state, e) {
    if (e.type === 'mousemove') state.mouse = {x: e.clientX, y: e.clientY};
    const code = e.keyCode, list = code === KEY.ArrowLeft || code === KEY.ArrowRight ? state.h : code === KEY.ArrowUp || code === KEY.ArrowDown ? state.v : null;
    if (!list) return;
    const at = list.indexOf(code);
    if (e.type === 'keydown') { if (at >= 0 && !e.repeat) list.splice(at, 1); if (!list.includes(code)) list.push(code); }
    if (e.type === 'keyup' && at >= 0) list.splice(at, 1);
}
// Expected offset change between two observed frames: every observed point
// (frames and inputs, in handling order) advances a monotonic clock; each
// segment moves SPEED * direction * min(dt, cap) / FRAME.
function expectedDisplacement(points, fromFrame, toFrame, initialState) {
    const state = JSON.parse(JSON.stringify(initialState));
    let clock = fromFrame.t, dx = 0, dy = 0;
    for (const p of points) {
        if (p.handledAt <= fromFrame.handledAt || p.handledAt > toFrame.handledAt) continue;
        const t = p.kind === 'frame' ? p.t : p.timeStamp;
        const dt = Math.min(Math.max(t - clock, 0), SEGMENT_CAP), d = direction(state);
        dx += SPEED * d.x * dt / FRAME; dy += SPEED * d.y * dt / FRAME;
        clock = Math.max(clock, t);
        if (p.kind === 'input') applyInput(state, p);
    }
    return {x: dx, y: dy, finalState: state};
}

const INSTRUMENT = ({keys}) => {
    if (window.__cameraProbe) return;
    const probe = window.__cameraProbe = {points: []};
    const camera = () => ({offset: {...canvas.offset}, speed: {x: gameEvent.screen.speedX, y: gameEvent.screen.speedY},
        held: {h: [...gameEvent.pressed_horizontal_keys], v: [...gameEvent.pressed_vertical_keys]},
        mouseEdge: {...gameEvent.mouseEdgeDirection},
        bounds: {left: gameEvent.screen.getScreenLeft(), right: gameEvent.screen.getScreenRight(), top: gameEvent.screen.getScreenTop(), bottom: gameEvent.screen.getScreenBottom()}});
    // window bubble listeners run after the game's document listeners
    for (const type of ['keydown', 'keyup', 'mousemove'])
        window.addEventListener(type, e => {
            if (type !== 'mousemove' && !keys.includes(e.keyCode)) return;
            probe.points.push({kind: 'input', type, keyCode: e.keyCode, key: e.key, repeat: e.repeat, clientX: e.clientX, clientY: e.clientY,
                timeStamp: e.timeStamp, handledAt: performance.now(), after: camera()});
        });
    const frame = t => {
        probe.points.push({kind: 'frame', t, handledAt: performance.now(), gameRan: lastGameFrameTime === t, after: camera(),
            visibility: document.visibilityState, connected: onlineSocket.connected});
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
};

async function main() {
    const {outputDir: out} = parseArgs(process.argv.slice(2));
    const started = Date.now();
    fs.mkdirSync(path.join(out, 'screenshots'), {recursive: true});
    const write = (n, v) => fs.writeFileSync(path.join(out, n), JSON.stringify(v, null, 2) + '\n');
    const append = (n, v) => fs.appendFileSync(path.join(out, n), JSON.stringify(v) + '\n');
    for (const n of ['input-trace.jsonl', 'camera-observations.jsonl']) fs.writeFileSync(path.join(out, n), '');
    const checks = [], results = {}, errors = [], secrets = [0, 1].map(() => String(crypto.randomInt(100000000, 999999999)));
    let browser, client, p, cdp, throttled = false, currentCase = 'setup', failure = null, cleanup = null;
    const cleanupSteps = [];
    const check = (id, expected, observed, pass = JSON.stringify(expected) === JSON.stringify(observed)) => {
        checks.push({case: currentCase, id, expected, observed, pass});
        write('browser-checkpoints.json', {checkpoints: checks});
        console.log((pass ? 'PASS ' : 'FAIL ') + currentCase + '/' + id + ' ' + JSON.stringify({expected, observed}));
        if (!pass) throw Error(`check failed: ${currentCase}/${id}`);
    };
    const near = (id, expected, observed, tol = TOLERANCE) =>
        check(id, expected, observed, Math.abs(expected.x - observed.x) <= tol && Math.abs(expected.y - observed.y) <= tol);

    try {
        const result = await withServices({evidenceDir: out, bounds: {scenarioMs: 900000}}, async service => {
            client = await startClientServer(undefined, {emptyFavicon: true});
            const spki = crypto.createHash('sha256').update(new crypto.X509Certificate(service.certificate.pem).publicKey.export({type: 'spki', format: 'der'})).digest('base64');
            browser = await chromium.launch({headless: true, args: [`--ignore-certificate-errors-spki-list=${spki}`]});
            const runtime = {node: process.version, chromium: browser.version(), playwright: require('playwright/package.json').version, services: service.lifecycle.runtime};
            console.log('RUNTIME ' + JSON.stringify(runtime));
            const spec = remoteTransportFixtureSpec();
            const board = buildCurrentCoopBoardInVm(spec);
            write('declared-fixture.json', {purpose: 'existing remote-transport Tiny H2 seed-1 co-op fixture (14x14); camera verification only', spec});
            check('fixture', {size: 'tiny', humans: 2, seed: 1, side: 14}, {size: spec.size, humans: spec.humans, seed: spec.seed, side: board.grid.length});
            // Both humans are admitted over Socket.IO; the browser reconnects as human 1 through the menu.
            const sockets = [], joined = [];
            for (let i = 0; i < 2; i++) {
                const s = await service.connectSocket(); sockets.push(s);
                const response = new Promise((resolve, reject) => {
                    const timer = setTimeout(() => reject(Error('join timeout')), 30000);
                    for (const e of ['gameStarted', 'playYourTurn', 'waitYouTurn']) s.client.once(e, b => { clearTimeout(timer); resolve(JSON.parse(b)); });
                    s.client.once('error', e => { clearTimeout(timer); reject(Error(String(e))); });
                });
                s.client.emit('startGameOrConnect', JSON.stringify({password: secrets[i], game: board}));
                joined.push(await response);
            }
            check('network-participants', [1, 2], joined.map(b => b.whooseTurn).sort());
            const events = {write: s => fs.appendFileSync(path.join(out, 'network-trace.jsonl'), s)};
            const inputs = {write: s => { const r = JSON.parse(s); delete r.until; if (/password/.test(r.label || '')) { delete r.x; delete r.y; } append('input-trace.jsonl', {source: 'driver', case: currentCase, ...r}); }};
            p = await BrowserPlayer.open(browser, {name: 'p1', input: 'mouse', endpoint: service.endpoint, clientUrl: client.url, errors, events, inputs, screenshotDir: path.join(out, 'screenshots'), viewport: VIEWPORT});
            const slot = joined[0].whooseTurn === 1 ? 0 : 1;
            await reconnect(p, {password: secrets[slot], coop: true, fog: false});
            await p.page.waitForFunction(() => onlineSocket.connected && !menu.visible && whooseTurn > 0, null, {timeout: 60000});
            if (await p.observe(() => nextTurnPauseInterface.visible)) await p.tap(CENTER, 'dismiss overlay', '!nextTurnPauseInterface.visible');
            for (const s of sockets.slice(1)) void s; // human 2 stays connected through the journey
            await p.page.mouse.move(CENTER.x, CENTER.y);
            await p.observe(INSTRUMENT, {keys: Object.values(KEY)});
            cdp = await p.page.context().newCDPSession(p.page);

            const settle = async (frames = 6) => p.observe(n => new Promise(resolve => {
                let left = n; const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step)); requestAnimationFrame(step);
            }), frames);
            const drain = async () => {
                const points = await p.observe(() => window.__cameraProbe.points.splice(0));
                for (const pt of points) append(pt.kind === 'input' ? 'input-trace.jsonl' : 'camera-observations.jsonl', {source: 'page', case: currentCase, ...pt});
                return points;
            };
            const state0 = async () => {
                const s = await p.observe(() => ({h: [...gameEvent.pressed_horizontal_keys], v: [...gameEvent.pressed_vertical_keys]}));
                return {...s, mouse: {...lastMouse}};
            };
            let lastMouse = {...CENTER};
            const mouse = async (pt, label) => { p.trace({action: 'mouse.move', label, x: pt.x, y: pt.y}); await p.page.mouse.move(pt.x, pt.y); lastMouse = {...pt}; };
            const down = async (key, label) => { p.trace({action: 'keyboard.down', label, key}); await p.page.keyboard.down(key); };
            const up = async (key, label) => { p.trace({action: 'keyboard.up', label, key}); await p.page.keyboard.up(key); };
            const wait = ms => p.page.waitForTimeout(ms);
            // Short press: keyup is issued ms after keydown is issued, without waiting
            // for the keydown round trip, so the browser sees a press close to ms.
            // Issues each input at its declared ms from the start, in order, without
            // waiting for earlier round trips; Playwright keeps the order.
            const schedule = async steps => {
                const start = Date.now(), sent = [];
                for (const [at, fn] of steps) {
                    const delay = start + at - Date.now();
                    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
                    sent.push(fn());
                }
                await Promise.all(sent);
            };
            const issue = {down: (k, l) => () => { p.trace({action: 'keyboard.down', label: l, key: k}); return p.page.keyboard.down(k); },
                up: (k, l) => () => { p.trace({action: 'keyboard.up', label: l, key: k}); return p.page.keyboard.up(k); },
                move: (pt, l) => () => { p.trace({action: 'mouse.move', label: l, x: pt.x, y: pt.y}); lastMouse = {...pt}; return p.page.mouse.move(pt.x, pt.y); }};
            const press = async (key, ms, label) => {
                p.trace({action: 'keyboard.down', label, key, pressMs: ms});
                const pressed = p.page.keyboard.down(key);
                await new Promise(resolve => setTimeout(resolve, ms));
                p.trace({action: 'keyboard.up', label, key});
                await Promise.all([pressed, p.page.keyboard.up(key)]);
            };
            const inputsOf = pts => pts.filter(x => x.kind === 'input');
            const framesOf = pts => pts.filter(x => x.kind === 'frame');
            // One measured case: baseline frame, normal inputs, then settled frames.
            const measure = async (name, act, {allowBounds = false} = {}) => {
                currentCase = name;
                await drain();
                await settle(4);
                const initial = await state0();
                const before = await drain();
                const baseline = framesOf(before).pop();
                if (!baseline) throw Error('no baseline frame');
                append('camera-observations.jsonl', {source: 'harness', case: name, baseline: baseline.after, initialState: initial});
                await act();
                await settle(12);
                const pts = await drain();
                const all = [baseline, ...pts];
                const frames = framesOf(pts), last = frames[frames.length - 1];
                const exp = expectedDisplacement(all, baseline, last, initial);
                const observed = {x: last.after.offset.x - baseline.after.offset.x, y: last.after.offset.y - baseline.after.offset.y};
                const b = last.after.bounds, o = last.after.offset;
                // any observed frame at a bound invalidates the unclamped expectation
                const touching = [0, 1, 2, 3].map(k => [baseline, ...frames].some(f => {
                    const fo = f.after.offset, fb = f.after.bounds;
                    return [fo.x <= fb.left, fo.x >= fb.right, fo.y <= fb.top, fo.y >= fb.bottom][k];
                }));
                append('camera-observations.jsonl', {source: 'harness', case: name, expected: exp, observed, bounds: b, final: last.after, touching});
                if (!allowBounds) check('inside-bounds', [false, false, false, false], touching);
                return {pts: all, frames: [baseline, ...frames], inputs: inputsOf(pts), exp, observed, last, baseline};
            };
            const stable = (id, frames) => check(id, true, frames.every(f => f.after.offset.x === frames[0].after.offset.x && f.after.offset.y === frames[0].after.offset.y));
            const afterRelease = (r, key) => r.frames.filter(f => f.handledAt > r.inputs.filter(i => i.type === 'keyup' && i.keyCode === KEY[key]).pop().handledAt);
            const summary = (name, r, extra = {}) => {
                results[name] = {pass: true, expected: {x: r.exp.x, y: r.exp.y}, observed: r.observed, inputs: r.inputs.length, frames: r.frames.length, ...extra};
                write('coverage-results.partial.json', results);
            };

            // Position the camera near the centre of its bounds with normal key holds.
            currentCase = 'position';
            await settle(4);
            const view = framesOf(await drain()).pop().after;
            append('camera-observations.jsonl', {source: 'harness', case: 'position', view});
            const span = {x: view.bounds.right - view.bounds.left, y: view.bounds.bottom - view.bounds.top};
            check('bounds-room', true, span.x > 1000 && span.y > 900);
            const mid = {x: (view.bounds.left + view.bounds.right) / 2, y: (view.bounds.top + view.bounds.bottom) / 2};
            // 'left' leaves room for rightward holds on a contended host.
            const centre = async (label, where = 'mid') => {
                const goal = where === 'left' ? {x: view.bounds.left + 200, y: mid.y} : mid;
                currentCase = 'position-' + label;
                for (let step = 0; step < 8; step++) {
                    await settle(3);
                    const now = framesOf(await drain()).pop().after.offset;
                    const d = {x: goal.x - now.x, y: goal.y - now.y};
                    if (Math.abs(d.x) < 150 && Math.abs(d.y) < 150) break;
                    const keys = [];
                    if (Math.abs(d.x) >= 150) keys.push([d.x > 0 ? 'ArrowRight' : 'ArrowLeft', Math.abs(d.x)]);
                    if (Math.abs(d.y) >= 150) keys.push([d.y > 0 ? 'ArrowDown' : 'ArrowUp', Math.abs(d.y)]);
                    for (const [k, dist] of keys) { await down(k, 'position'); await wait(Math.min(1500, 0.7 * dist / SPEED * FRAME)); await up(k, 'position'); }
                }
                await settle(3);
                const centred = framesOf(await drain()).pop().after.offset;
                check('camera-positioned-' + where, true, Math.abs(centred.x - goal.x) < 150 && Math.abs(centred.y - goal.y) < 150 && centred.x > view.bounds.left + 20);
            };
            await centre('initial', 'left');
            await p.screenshot('positioned');

            {   // central mouse movement while a key is held
                const r = await measure('central-mouse-hold', () => schedule([[0, issue.down('ArrowRight', 'hold right')],
                    [30, issue.move({x: CENTER.x - 120, y: CENTER.y - 30}, 'central mouse')], [90, issue.move({x: CENTER.x + 80, y: CENTER.y + 20}, 'central mouse')],
                    [150, issue.move({x: CENTER.x + 160, y: CENTER.y + 40}, 'central mouse')], [200, issue.up('ArrowRight', 'release right')]]));
                const moves = r.inputs.filter(i => i.type === 'mousemove');
                // Chromium coalesces mousemoves within a frame; moves are spaced ~60 ms apart
                check('central-mousemoves-observed', true, moves.length >= 2);
                check('held-key-kept-after-each-mousemove', moves.map(() => ({h: [KEY.ArrowRight], speedX: -SPEED})), moves.map(m => ({h: m.after.held.h, speedX: m.after.speed.x})));
                near('displacement', r.exp, r.observed);
                check('moved-right', true, r.observed.x > 100);
                stable('no-motion-after-release', afterRelease(r, 'ArrowRight'));
                summary('central-mouse-hold', r, {mousemoves: moves.length});
            }
            await centre('release-resumes-edge', 'left');
            {   // key release resumes mouse-edge scrolling
                const r = await measure('release-resumes-edge', () => schedule([[0, issue.down('ArrowRight', 'hold right')],
                    [30, issue.move(LEFT_EDGE, 'mouse to left edge')], [150, issue.up('ArrowRight', 'release right')],
                    [330, issue.move(CENTER, 'mouse back to centre')]]));
                const edge = r.inputs.find(i => i.type === 'mousemove' && i.clientX === 0), rel = r.inputs.find(i => i.type === 'keyup');
                check('key-wins-over-edge', {mouseEdgeX: -1, speedX: -SPEED}, {mouseEdgeX: edge.after.mouseEdge.x, speedX: edge.after.speed.x});
                check('edge-resumes-on-release', {h: [], speedX: SPEED}, {h: rel.after.held.h, speedX: rel.after.speed.x});
                const back = r.inputs[r.inputs.length - 1];
                const leftFrames = r.frames.filter(f => f.handledAt > rel.handledAt && f.handledAt < back.handledAt).concat(r.frames.filter(f => f.handledAt > back.handledAt).slice(0, 1));
                check('edge-scroll-moves-left', true, leftFrames.length >= 2 && leftFrames[leftFrames.length - 1].after.offset.x < leftFrames[0].after.offset.x);
                near('displacement', r.exp, r.observed);
                summary('release-resumes-edge', r);
            }
            await centre('opposite-release', 'left');
            {   // opposite key release restores the remaining direction
                const r = await measure('opposite-release', () => schedule([[0, issue.down('ArrowRight', 'hold right')],
                    [100, issue.down('ArrowLeft', 'hold left')], [200, issue.up('ArrowLeft', 'release left')], [300, issue.up('ArrowRight', 'release right')]]));
                const seq = r.inputs.map(i => ({type: i.type, keyCode: i.keyCode, speedX: i.after.speed.x}));
                check('speed-sequence', [{type: 'keydown', keyCode: KEY.ArrowRight, speedX: -SPEED}, {type: 'keydown', keyCode: KEY.ArrowLeft, speedX: SPEED},
                    {type: 'keyup', keyCode: KEY.ArrowLeft, speedX: -SPEED}, {type: 'keyup', keyCode: KEY.ArrowRight, speedX: 0}], seq);
                near('displacement', r.exp, r.observed);
                stable('no-motion-after-release', afterRelease(r, 'ArrowRight'));
                summary('opposite-release', r);
            }
            await centre('short-press');
            for (const [name, ms, key] of [['short-press-30', 30, 'ArrowDown'], ['short-press-78', 78, 'ArrowUp']]) {
                const r = await measure(name, () => press(key, ms, name));
                const keys = r.inputs.filter(i => i.type !== 'mousemove');
                check('single-press', [['keydown', KEY[key], false], ['keyup', KEY[key], false]], keys.map(i => [i.type, i.keyCode, i.repeat]));
                const held = keys[1].timeStamp - keys[0].timeStamp;
                // the browser timestamps delivery; a loaded 2-CPU host shifts either event by tens of ms
                check('press-duration-ms', true, Math.abs(held - ms) <= 25);
                const sign = key === 'ArrowDown' ? 1 : -1;
                const independent = {x: 0, y: sign * SPEED * held / FRAME};
                near('displacement-vs-timestamps', independent, r.observed);
                near('displacement-vs-model', r.exp, r.observed);
                const post = afterRelease(r, key);
                check('frames-after-release', true, post.length >= 10);
                stable('no-continuing-motion', post);
                const between = r.frames.filter(f => f.handledAt > keys[0].handledAt && f.handledAt < keys[1].handledAt).length;
                summary(name, r, {heldMs: held, framesDuringPress: between});
            }
            currentCase = 'short-press-78';
            check('78ms-press-longer-than-30ms', true, results['short-press-78'].heldMs > results['short-press-30'].heldMs);
            {   // bounded low-frame-rate case under fixed CPU throttling
                currentCase = 'low-fps-short-press';
                const rows = [];
                cleanupSteps.push('throttle-set');
                await cdp.send('Emulation.setCPUThrottlingRate', {rate: THROTTLE_RATE}); throttled = true;
                append('camera-observations.jsonl', {source: 'harness', case: currentCase, throttle: {rate: THROTTLE_RATE}});
                try {
                    await centre('low-fps');
                    for (let i = 0; i < LOW_FPS_PRESSES; i++) {
                        const key = i % 2 ? 'ArrowLeft' : 'ArrowRight';
                        const r = await measure('low-fps-short-press', () => press(key, 30, 'low-fps 30 ms'));
                        const keys = r.inputs.filter(i => i.type !== 'mousemove');
                        check('single-press-' + i, [['keydown', KEY[key], false], ['keyup', KEY[key], false]], keys.map(k => [k.type, k.keyCode, k.repeat]));
                        const before = r.frames.filter(f => f.handledAt < keys[0].handledAt).pop();
                        const after = r.frames.find(f => f.handledAt > keys[1].handledAt);
                        const betweenFrames = !!before && !!after && !r.frames.some(f => f.handledAt > keys[0].handledAt && f.handledAt < keys[1].handledAt) &&
                            before.t < keys[0].timeStamp && keys[1].timeStamp < after.t;
                        const intervals = r.frames.slice(1).map((f, j) => f.t - r.frames[j].t);
                        near('displacement-' + i, r.exp, r.observed);
                        check('moved-' + i, true, Math.abs(r.observed.x) > 0);
                        stable('no-continuing-motion-' + i, afterRelease(r, key));
                        rows.push({press: i, key, heldMs: keys[1].timeStamp - keys[0].timeStamp, betweenFrames, frameBefore: before?.t, frameAfter: after?.t,
                            keydown: {timeStamp: keys[0].timeStamp, handledAt: keys[0].handledAt}, keyup: {timeStamp: keys[1].timeStamp, handledAt: keys[1].handledAt},
                            medianFrameMs: intervals.sort((a, b) => a - b)[intervals.length >> 1], maxFrameMs: Math.max(...intervals), expected: r.exp, observed: r.observed});
                        append('camera-observations.jsonl', {source: 'harness', case: currentCase, press: rows[rows.length - 1]});
                    }
                } finally {
                    await cdp.send('Emulation.setCPUThrottlingRate', {rate: 1}); throttled = false; cleanupSteps.push('throttle-restored');
                }
                currentCase = 'low-fps-short-press';
                check('press-between-frames-exercised', true, rows.some(r => r.betweenFrames));
                results['low-fps-short-press'] = {pass: true, throttleRate: THROTTLE_RATE, presses: rows, betweenFramePresses: rows.filter(r => r.betweenFrames).length};
                write('coverage-results.partial.json', results);
            }
            {   // map edge: keyboard to the left bound, mouse edge to the top bound
                const r = await measure('map-edge', async () => {
                    await down('ArrowLeft', 'hold left to bound'); await wait(1500); await up('ArrowLeft', 'release left');
                    await mouse(TOP_EDGE, 'mouse to top edge'); await wait(1500); await mouse(CENTER, 'mouse back to centre');
                }, {allowBounds: true});
                const b = r.last.after.bounds, o = r.last.after.offset;
                check('clamped-at-left-and-top', {x: b.left, y: b.top}, {x: o.x, y: o.y});
                check('model-predicts-overshoot', true, r.baseline.after.offset.x + r.exp.x < b.left && r.baseline.after.offset.y + r.exp.y < b.top);
                const leftUp = r.inputs.find(i => i.type === 'keyup');
                check('no-motion-past-left-bound', true, r.frames.filter(f => f.handledAt > leftUp.handledAt).every(f => f.after.offset.x === b.left));
                stable('no-motion-after-centre', r.frames.filter(f => f.handledAt > r.inputs[r.inputs.length - 1].handledAt));
                await p.screenshot('map-edge');
                summary('map-edge', r, {bounds: b, final: o});
            }
            {   // final idle state
                currentCase = 'idle-final';
                await drain(); await settle(20);
                const frames = framesOf(await drain());
                const last = frames[frames.length - 1].after;
                check('idle-state', {h: [], v: [], speed: {x: 0, y: 0}, mouseEdge: {x: 0, y: 0}}, {h: last.held.h, v: last.held.v, speed: last.speed, mouseEdge: last.mouseEdge});
                check('idle-frames', true, frames.length >= 15);
                stable('idle-offset-stable', frames);
                check('page-visible-connected', true, frames.every(f => f.visibility === 'visible' && f.connected && f.gameRan));
                results['idle-final'] = {pass: true, frames: frames.length, final: last};
                await p.screenshot('idle-final');
            }
            currentCase = 'errors';
            check('browser-errors', [], errors);
            check('server-errors', [], fs.readFileSync(path.join(service.logDir, 'server.log'), 'utf8').split('\n').filter(l => /Error handling|Unhandled|TypeError|ReferenceError|RangeError/.test(l)));
            write('served-sources.json', Object.fromEntries(client.served));
            write('runtime.json', runtime);
            for (const s of sockets) await s.close();
            await browser.close(); browser = null; cleanupSteps.push('browser-closed');
            await client.close(); client = null; cleanupSteps.push('client-closed');
        });
        cleanup = result.cleanup;
    } catch (error) {
        failure = error; cleanup = error.cleanup || null;
        console.error('FAILURE in ' + currentCase + ': ' + (error.stack || error));
        if (p && browser) {
            try { await p.screenshot('failure-' + currentCase); } catch (e) { console.error('failure screenshot: ' + e.message); }
        }
    } finally {
        if (throttled && cdp) { try { await cdp.send('Emulation.setCPUThrottlingRate', {rate: 1}); cleanupSteps.push('throttle-restored-finally'); } catch (e) { cleanupSteps.push('throttle-restore-failed: ' + e.message); } }
        if (p && browser) { for (const k of Object.keys(KEY)) await p.page.keyboard.up(k).catch(() => {}); cleanupSteps.push('keys-released'); }
        if (browser) { await browser.close().catch(() => {}); cleanupSteps.push('browser-closed-finally'); }
        if (client) { await client.close().catch(() => {}); cleanupSteps.push('client-closed-finally'); }
        const servicesClean = !!cleanup && cleanup.processes.every(x => !x.aliveAfter) && cleanup.directories.every(d => !d.existsAfter);
        write('cleanup.json', {steps: cleanupSteps, throttledAtEnd: throttled, services: cleanup, servicesClean});
        write('browser-errors.json', errors);
        const pass = !failure && servicesClean && CASES.every(c => results[c]?.pass);
        write('browser-results.json', {pass, cases: CASES.map(c => ({id: c, pass: !!results[c]?.pass})), results, failure: failure ? String(failure.message) : null, elapsedMs: Date.now() - started});
        for (const file of fs.readdirSync(out, {recursive: true})) {
            const full = path.join(out, file);
            if (fs.statSync(full).isFile() && !file.endsWith('.png')) { let s = fs.readFileSync(full, 'utf8'); for (const secret of secrets) s = s.split(secret).join('[redacted]'); fs.writeFileSync(full, s); }
        }
        console.log((pass ? 'PASS' : 'FAIL') + ' camera-input-browser cases=' + CASES.filter(c => results[c]?.pass).length + '/' + CASES.length + ' cleanup=' + (servicesClean ? 'pass' : 'fail'));
        process.exitCode = pass ? 0 : 1;
    }
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
