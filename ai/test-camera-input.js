'use strict';
// Production-source regressions for desktop camera keyboard/mouse arbitration.
// Loads events/screen.js and events/events.js into a VM and drives the real
// Events/ComputerScreen/MobileScreen classes frame by frame.
// Usage: node ai/test-camera-input.js --case arbitration|direction|short-press --output-dir <fresh> [--source-dir <repo>]
// short-press uses deterministic event/frame timestamps (production-source logic, not browser timing).
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), crypto = require('node:crypto')

const CASES = ['arbitration', 'direction', 'short-press']
const FRAMES = 60
const SIZE = 1000
const SPEED = 0.04 * SIZE // ComputerScreen speed configured by Events
const KEY = { left: 37, right: 39, up: 38, down: 40, a: 65, d: 68, w: 87, s: 83 }
const CENTER = { x: SIZE / 2, y: SIZE / 2 }
const EDGE = { left: { x: 0, y: SIZE / 2 }, right: { x: SIZE - 1, y: SIZE / 2 },
    top: { x: SIZE / 2, y: 0 }, bottom: { x: SIZE / 2, y: SIZE - 1 } }

function parseArgs(argv) {
    const args = { case: null, outputDir: null, sourceDir: path.join(__dirname, '..') }
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--case') args.case = argv[++i]
        else if (argv[i] === '--output-dir') args.outputDir = argv[++i]
        else if (argv[i] === '--source-dir') args.sourceDir = argv[++i]
        else throw Error('unknown argument ' + argv[i])
    }
    if (!CASES.includes(args.case)) throw Error('--case must be one of ' + CASES.join(','))
    if (!args.outputDir) throw Error('--output-dir is required')
    return args
}

const SOURCES = ['events/screen.js', 'events/events.js']

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function createWorld(sourceDir, { mobile = false, border = 1e6 } = {}) {
    const code = SOURCES.map(f => fs.readFileSync(path.join(sourceDir, f), 'utf8')).join('\n')
    const env = {
        mobilePhone: mobile, debug: false, HEIGHT: SIZE, WIDTH: SIZE, width: SIZE, height: SIZE,
        canvas: { offset: { x: 0, y: 0 }, scale: 1 },
        mapBorder: { left: -border, right: border, top: -border, bottom: border, scale: { min: 0.5, max: 2 } },
        mapBorderMargin: 0,
        mainCtx: { translate() {}, scale() {} },
        document: { addEventListener() {} },
        Empty: class { removeSelect() {} },
        pointPythagorean: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
        getAveragePoint: p => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }),
        Math,
    }
    vm.createContext(env)
    vm.runInContext(code + '\nthis.Events = Events', env)
    const events = new env.Events()
    return {
        env, events,
        offset: () => ({ x: env.canvas.offset.x, y: env.canvas.offset.y }),
        frames(n = FRAMES) {
            const start = this.offset(), perFrame = []
            for (let i = 0; i < n; i++) {
                const before = this.offset()
                events.moveScreen(1000 / 60)
                const after = this.offset()
                perFrame.push({ x: after.x - before.x, y: after.y - before.y })
            }
            const end = this.offset()
            return { delta: { x: end.x - start.x, y: end.y - start.y }, perFrame }
        },
    }
}

const sign = v => (v > 0 ? 1 : v < 0 ? -1 : 0)

function summarize(result) {
    const dirs = new Set(result.perFrame.map(d => sign(d.x) + ',' + sign(d.y)))
    return {
        direction: { x: sign(result.delta.x), y: sign(result.delta.y) },
        delta: { x: Math.round(result.delta.x), y: Math.round(result.delta.y) },
        consistentEveryFrame: dirs.size === 1,
    }
}

function expectMove(dx, dy) {
    return { direction: { x: sign(dx), y: sign(dy) }, delta: { x: dx * SPEED * FRAMES, y: dy * SPEED * FRAMES },
        consistentEveryFrame: true }
}

function arbitration(sourceDir) {
    const checks = []
    const check = (id, description, observed, expected) => {
        const pass = JSON.stringify(observed) === JSON.stringify(expected)
        checks.push({ id, description, expected, observed, pass })
        console.log((pass ? 'PASS ' : 'FAIL ') + id + ' expected=' + JSON.stringify(expected) + ' observed=' + JSON.stringify(observed))
    }
    const phase = (id, description, world, expected) => check(id, description, summarize(world.frames()), expected)

    // Horizontal key held, mouse moves into the central board area.
    let w = createWorld(sourceDir)
    w.events.keyboard(KEY.right, false)
    phase('horizontal/right-held', 'Right held, no mouse movement', w, expectMove(1, 0))
    w.events.mousemove(CENTER, CENTER)
    phase('horizontal/right-held-central-mouse', 'Right held, mouse moved to center', w, expectMove(1, 0))
    w.events.keyup(KEY.right)
    phase('horizontal/release-central', 'Right released with mouse central', w, expectMove(0, 0))

    // Vertical key held (WASD), central mouse movement.
    w = createWorld(sourceDir)
    w.events.keyboard(KEY.w, false)
    w.events.mousemove(CENTER, CENTER)
    phase('vertical/up-held-central-mouse', 'W held, mouse moved to center', w, expectMove(0, -1))
    w.events.keyup(KEY.w)
    phase('vertical/release-central', 'W released with mouse central', w, expectMove(0, 0))

    // Key held while the mouse moves between opposite edges of the same axis.
    w = createWorld(sourceDir)
    w.events.keyboard(KEY.left, false)
    w.events.mousemove(EDGE.right, EDGE.right)
    phase('opposite-edges/left-held-mouse-right-edge', 'Left held, mouse at right edge', w, expectMove(-1, 0))
    w.events.mousemove(EDGE.left, EDGE.left)
    phase('opposite-edges/left-held-mouse-left-edge', 'Left held, mouse at left edge', w, expectMove(-1, 0))
    w.events.mousemove(EDGE.right, EDGE.right)
    phase('opposite-edges/left-held-mouse-back-right-edge', 'Left held, mouse back at right edge', w, expectMove(-1, 0))
    // Release at an edge: the edge direction for that axis takes over.
    w.events.keyup(KEY.left)
    phase('release-at-edge/left-released-mouse-right-edge', 'Left released, mouse still at right edge', w, expectMove(1, 0))
    w.events.mousemove(CENTER, CENTER)
    phase('release-at-edge/mouse-to-center', 'No key, mouse moved to center', w, expectMove(0, 0))

    // Vertical release at an edge.
    w = createWorld(sourceDir)
    w.events.mousemove(EDGE.top, EDGE.top)
    w.events.keyboard(KEY.s, false)
    phase('release-at-edge/s-held-mouse-top-edge', 'S held, mouse at top edge', w, expectMove(0, 1))
    w.events.keyup(KEY.s)
    phase('release-at-edge/s-released-mouse-top-edge', 'S released, mouse still at top edge', w, expectMove(0, -1))

    // Simultaneous perpendicular inputs: keyboard on one axis, mouse edge on the other.
    w = createWorld(sourceDir)
    w.events.keyboard(KEY.right, false)
    w.events.mousemove(EDGE.bottom, EDGE.bottom)
    phase('perpendicular/right-key-bottom-edge', 'Right held, mouse at bottom edge', w, expectMove(1, 1))
    w.events.mousemove(CENTER, CENTER)
    phase('perpendicular/right-key-mouse-center', 'Right held, mouse moved to center', w, expectMove(1, 0))
    w.events.mousemove(EDGE.top, EDGE.top)
    phase('perpendicular/right-key-top-edge', 'Right held, mouse at top edge', w, expectMove(1, -1))
    w.events.keyup(KEY.right)
    phase('perpendicular/right-released-top-edge', 'Right released, mouse at top edge', w, expectMove(0, -1))

    // Simultaneous perpendicular keys, then complete release with cursor central.
    w = createWorld(sourceDir)
    w.events.keyboard(KEY.d, false)
    w.events.keyboard(KEY.down, false)
    w.events.mousemove(CENTER, CENTER)
    phase('perpendicular/d-and-down-held-central-mouse', 'D and Down held, mouse central', w, expectMove(1, 1))
    w.events.keyup(KEY.d)
    phase('complete-release/d-released', 'D released, Down still held, mouse central', w, expectMove(0, 1))
    w.events.keyup(KEY.down)
    phase('complete-release/all-released-central', 'All keys released, mouse central', w, expectMove(0, 0))
    phase('complete-release/still-stopped', 'No input for another 60 frames', w, expectMove(0, 0))

    // Two keys on the same axis: the most recent held key wins, release falls back to the other.
    w = createWorld(sourceDir)
    w.events.keyboard(KEY.left, false)
    w.events.keyboard(KEY.right, false)
    phase('same-axis/left-then-right', 'Left then Right held', w, expectMove(1, 0))
    w.events.keyup(KEY.right)
    phase('same-axis/right-released-left-held', 'Right released, Left still held', w, expectMove(-1, 0))
    w.events.keyup(KEY.left)
    phase('same-axis/all-released', 'Both released', w, expectMove(0, 0))

    // Mouse-only edge scrolling still works.
    w = createWorld(sourceDir)
    w.events.mousemove(EDGE.left, EDGE.left)
    phase('mouse-only/left-edge', 'Mouse at left edge only', w, expectMove(-1, 0))
    w.events.mousemove(CENTER, CENTER)
    phase('mouse-only/center', 'Mouse at center only', w, expectMove(0, 0))

    // Map-boundary clamping.
    w = createWorld(sourceDir, { border: 1500 })
    w.events.keyboard(KEY.right, false)
    w.frames(FRAMES)
    const right = w.env.canvas.offset.x
    check('boundary/right-clamp', 'Right held for 60 frames on a small map clamps to getScreenRight',
        { offsetX: right, frameDelta: summarize(w.frames()).delta.x },
        { offsetX: w.events.screen.getScreenRight(), frameDelta: 0 })

    // Zoom behavior (wheel) unchanged; keyboard still moves after zoom.
    w = createWorld(sourceDir)
    w.events.mousewheel(CENTER, 1e6)
    const zoomed = { scale: w.env.canvas.scale }
    w.events.mousewheel(CENTER, -1e6)
    zoomed.scaleAfterOut = w.env.canvas.scale
    w.events.keyboard(KEY.up, false)
    zoomed.move = summarize(w.frames()).direction
    check('zoom/clamped-and-movement', 'Wheel zoom clamps to max/min and keyboard still moves',
        zoomed, { scale: 2, scaleAfterOut: 0.5, move: { x: 0, y: -1 } })

    // Touch behavior: single-finger drag moves once then stops.
    w = createWorld(sourceDir, { mobile: true })
    w.events.touchstart({ x: 500, y: 500 }, 1)
    w.events.touchend({ x: 500, y: 500 }, 0)
    w.events.touchstart({ x: 500, y: 500 }, 1)
    w.events.touchmove({ x: 450, y: 530 }, 1)
    const touch1 = w.frames(1).delta
    const touchRest = w.frames().delta
    check('touch/drag-moves-once', 'Touch drag of (-50,+30) moves offset by (+50,-30) then stops',
        { first: touch1, rest: touchRest }, { first: { x: 50, y: -30 }, rest: { x: 0, y: 0 } })

    return checks
}

// Per-axis directional key priority: newest physical press wins, release restores
// the newest still-held key, auto-repeat never reorders presses.
function direction(sourceDir) {
    const checks = []
    const check = (id, description, observed, expected) => {
        const pass = JSON.stringify(observed) === JSON.stringify(expected)
        checks.push({ id, description, expected, observed, pass })
        console.log((pass ? 'PASS ' : 'FAIL ') + id + ' expected=' + JSON.stringify(expected) + ' observed=' + JSON.stringify(observed))
    }
    const phase = (id, description, world, expected) => check(id, description, summarize(world.frames()), expected)
    const press = (w, key) => w.events.keyboard(key, false, false)
    const repeat = (w, key) => w.events.keyboard(key, false, true)

    // Opposite keys on each axis, both press orders; release the newer then the older key.
    const pairs = [
        ['horizontal', 'right', 'left', 1, 0], ['horizontal', 'left', 'right', -1, 0],
        ['vertical', 'down', 'up', 0, 1], ['vertical', 'up', 'down', 0, -1],
        ['wasd-horizontal', 'd', 'a', 1, 0], ['wasd-vertical', 'w', 's', 0, -1],
        ['mixed-horizontal', 'right', 'a', 1, 0], ['mixed-vertical', 's', 'up', 0, 1],
    ]
    for (const [axis, older, newer, dx, dy] of pairs) {
        const w = createWorld(sourceDir)
        press(w, KEY[older])
        phase(`${axis}/${older}-${newer}/${older}-held`, `${older} held`, w, expectMove(dx, dy))
        press(w, KEY[newer])
        phase(`${axis}/${older}-${newer}/${newer}-pressed`, `${older} held, ${newer} pressed`, w, expectMove(-dx, -dy))
        w.events.keyup(KEY[newer])
        phase(`${axis}/${older}-${newer}/${newer}-released`, `${newer} released, ${older} still held`, w, expectMove(dx, dy))
        w.events.keyup(KEY[older])
        phase(`${axis}/${older}-${newer}/all-released`, 'all keys released, no mouse edge', w, expectMove(0, 0))
    }

    // Releasing the inactive (older) key keeps the newer direction.
    let w = createWorld(sourceDir)
    press(w, KEY.right)
    press(w, KEY.left)
    w.events.keyup(KEY.right)
    phase('inactive-release/right-released-left-held', 'Right then Left, Right released', w, expectMove(-1, 0))
    w.events.keyup(KEY.left)
    phase('inactive-release/all-released', 'Left released', w, expectMove(0, 0))

    // Two aliases for the same direction plus an opposite key.
    w = createWorld(sourceDir)
    press(w, KEY.right)
    press(w, KEY.d)
    press(w, KEY.left)
    phase('aliases/right-d-then-left', 'Right and D held, Left pressed', w, expectMove(-1, 0))
    w.events.keyup(KEY.left)
    phase('aliases/left-released', 'Left released, Right and D held', w, expectMove(1, 0))
    w.events.keyup(KEY.d)
    phase('aliases/d-released', 'D released, Right held', w, expectMove(1, 0))
    press(w, KEY.a)
    w.events.keyup(KEY.right)
    phase('aliases/a-pressed-right-released', 'A pressed, Right released', w, expectMove(-1, 0))
    w.events.keyup(KEY.a)
    phase('aliases/all-released', 'all released', w, expectMove(0, 0))

    // Auto-repeat of an older held key must not take priority over a newer press.
    w = createWorld(sourceDir)
    press(w, KEY.right)
    repeat(w, KEY.right)
    press(w, KEY.left)
    repeat(w, KEY.left)
    repeat(w, KEY.right)
    phase('auto-repeat/older-right-repeats', 'Right then Left held, Right auto-repeats', w, expectMove(-1, 0))
    repeat(w, KEY.right)
    phase('auto-repeat/older-right-repeats-again', 'Right auto-repeats again', w, expectMove(-1, 0))
    w.events.keyup(KEY.left)
    phase('auto-repeat/newer-left-released', 'Left released, Right still held', w, expectMove(1, 0))
    w.events.keyup(KEY.right)
    phase('auto-repeat/all-released', 'all released', w, expectMove(0, 0))
    w = createWorld(sourceDir)
    press(w, KEY.w)
    press(w, KEY.down)
    repeat(w, KEY.w)
    phase('auto-repeat/older-w-repeats', 'W then Down held, W auto-repeats', w, expectMove(0, 1))
    w.events.keyup(KEY.down)
    phase('auto-repeat/down-released', 'Down released, W still held', w, expectMove(0, -1))
    w.events.keyup(KEY.w)
    phase('auto-repeat/vertical-all-released', 'all released', w, expectMove(0, 0))
    // A fresh physical re-press (after release) does reorder.
    w = createWorld(sourceDir)
    press(w, KEY.right)
    press(w, KEY.left)
    w.events.keyup(KEY.right)
    press(w, KEY.right)
    phase('re-press/right-re-pressed', 'Right re-pressed after release while Left held', w, expectMove(1, 0))
    w.events.keyup(KEY.right)
    phase('re-press/right-released', 'Right released, Left held', w, expectMove(-1, 0))
    w.events.keyup(KEY.left)

    // Both axes together, independent per axis.
    w = createWorld(sourceDir)
    press(w, KEY.right)
    press(w, KEY.up)
    press(w, KEY.a)
    press(w, KEY.s)
    phase('both-axes/newer-a-and-s', 'Right, Up, A, S held', w, expectMove(-1, 1))
    repeat(w, KEY.right)
    repeat(w, KEY.up)
    phase('both-axes/older-keys-repeat', 'Right and Up auto-repeat', w, expectMove(-1, 1))
    w.events.keyup(KEY.a)
    phase('both-axes/a-released', 'A released', w, expectMove(1, 1))
    w.events.keyup(KEY.s)
    phase('both-axes/s-released', 'S released', w, expectMove(1, -1))
    w.events.keyup(KEY.up)
    phase('both-axes/up-released', 'Up released', w, expectMove(1, 0))
    w.events.keyup(KEY.right)
    phase('both-axes/all-released', 'all released', w, expectMove(0, 0))
    phase('both-axes/still-stopped', 'no stuck movement after another 60 frames', w, expectMove(0, 0))

    // Final release falls back to mouse-edge input.
    w = createWorld(sourceDir)
    w.events.mousemove(EDGE.bottom, EDGE.bottom)
    press(w, KEY.left)
    press(w, KEY.right)
    press(w, KEY.up)
    phase('mouse-fallback/keys-override', 'Left, Right, Up held, mouse at bottom edge', w, expectMove(1, -1))
    w.events.keyup(KEY.right)
    phase('mouse-fallback/right-released', 'Right released', w, expectMove(-1, -1))
    w.events.keyup(KEY.left)
    w.events.keyup(KEY.up)
    phase('mouse-fallback/all-released', 'all keys released, mouse at bottom edge', w, expectMove(0, 1))
    w.events.mousemove(CENTER, CENTER)
    phase('mouse-fallback/mouse-center', 'mouse moved to center', w, expectMove(0, 0))

    return checks
}

// Timestamped input timelines: a press released between camera updates still moves the camera
// by speed * pressDuration / (1000 / 60); frequent and delayed frame partitions agree.
const MS_SPEED = SPEED / (1000 / 60) // camera offset per ms of held key
const TOLERANCE = 1e-6 // px, predeclared

// Plays timeline events and frames (both by timestamp, events first on ties) through the
// real Events/Screen, returning per-frame offset deltas.
function playTimeline(sourceDir, timeline, frameTimes, worldOptions) {
    const w = createWorld(sourceDir, worldOptions)
    if (timeline.start) w.env.canvas.offset.x = timeline.start.x, w.env.canvas.offset.y = timeline.start.y
    const start = w.offset(), perFrame = []
    const input = timeline.events.map(e => ({ ...e, order: 0 }))
    const frames = frameTimes.map((t, i) => ({ t, type: 'frame', order: 1,
        duration: i ? t - frameTimes[i - 1] : 1000 / 60 }))
    for (const item of [...input, ...frames].sort((a, b) => a.t - b.t || a.order - b.order)) {
        if (item.type === 'down') w.events.keyboard(KEY[item.key], false, false, item.t)
        else if (item.type === 'up') w.events.keyup(KEY[item.key], item.t)
        else if (item.type === 'mouse') w.events.mousemove(EDGE[item.edge] ?? CENTER, EDGE[item.edge] ?? CENTER, item.t)
        else {
            const before = w.offset()
            w.events.moveScreen(item.duration, item.t)
            const after = w.offset()
            perFrame.push({ t: item.t, x: after.x - before.x, y: after.y - before.y })
        }
    }
    const end = w.offset()
    return { world: w, delta: { x: end.x - start.x, y: end.y - start.y }, perFrame }
}

const frameGrid = (step, until) => {
    const times = []
    for (let t = 0; t <= until + 1e-9; t += step) times.push(t)
    return times
}

function shortPress(sourceDir) {
    const checks = []
    const check = (id, description, observed, expected) => {
        const pass = Object.keys(expected).every(k => typeof expected[k] === 'number'
            ? Math.abs(observed[k] - expected[k]) <= TOLERANCE : JSON.stringify(observed[k]) === JSON.stringify(expected[k]))
        checks.push({ id, description, expected, observed, tolerancePx: TOLERANCE, pass })
        console.log((pass ? 'PASS ' : 'FAIL ') + id + ' expected=' + JSON.stringify(expected) + ' observed=' + JSON.stringify(observed))
    }
    const near = v => Math.abs(v) <= TOLERANCE
    // expectedMs: independently declared signed held duration per axis (+ right/down).
    const timelines = [
        { id: 'down-30ms-between-frames', description: 'Down pressed 10 ms, released 40 ms, frames at 0 and 50 ms (delayed) / 16.7 ms grid (frequent)',
            events: [{ t: 10, type: 'down', key: 'down' }, { t: 40, type: 'up', key: 'down' }],
            expectedMs: { x: 0, y: 30 }, lastInputT: 40 },
        { id: 'down-78ms-between-frames', description: 'Down held 78 ms (archived browser pan) between two delayed frames',
            events: [{ t: 5, type: 'down', key: 'down' }, { t: 83, type: 'up', key: 'down' }],
            expectedMs: { x: 0, y: 78 }, lastInputT: 83, delayedStep: 90 },
        { id: 'left-30ms-between-frames', description: 'Left (horizontal axis) held 30 ms between frames',
            events: [{ t: 3, type: 'down', key: 'left' }, { t: 33, type: 'up', key: 'left' }],
            expectedMs: { x: -30, y: 0 }, lastInputT: 33 },
        { id: 'w-30ms-up', description: 'W (up) held 30 ms between frames',
            events: [{ t: 20, type: 'down', key: 'w' }, { t: 50, type: 'up', key: 'w' }],
            expectedMs: { x: 0, y: -30 }, lastInputT: 50, delayedStep: 60 },
        { id: 'press-spans-frames', description: 'D held 5..145 ms across several frames, no duplicate movement',
            events: [{ t: 5, type: 'down', key: 'd' }, { t: 145, type: 'up', key: 'd' }],
            expectedMs: { x: 140, y: 0 }, lastInputT: 145 },
        { id: 'mixed-held-and-short', description: 'Right held 0..300 ms, Up tapped 60..90 ms',
            events: [{ t: 0, type: 'down', key: 'right' }, { t: 60, type: 'down', key: 'up' },
                { t: 90, type: 'up', key: 'up' }, { t: 300, type: 'up', key: 'right' }],
            expectedMs: { x: 300, y: -30 }, lastInputT: 300 },
        { id: 'short-opposite-over-held', description: 'Right held 0..300 ms, Left tapped 100..130 ms overrides then releases',
            events: [{ t: 0, type: 'down', key: 'right' }, { t: 100, type: 'down', key: 'left' },
                { t: 130, type: 'up', key: 'left' }, { t: 300, type: 'up', key: 'right' }],
            expectedMs: { x: 270 - 30, y: 0 }, lastInputT: 300 },
        { id: 'both-axes-short', description: 'S tapped 10..40 ms and A tapped 20..98 ms between frames',
            events: [{ t: 10, type: 'down', key: 's' }, { t: 20, type: 'down', key: 'a' },
                { t: 40, type: 'up', key: 's' }, { t: 98, type: 'up', key: 'a' }],
            expectedMs: { x: -78, y: 30 }, lastInputT: 98 },
        { id: 'normal-hold', description: 'Down held 0..1000 ms (normal hold)',
            events: [{ t: 0, type: 'down', key: 'down' }, { t: 1000, type: 'up', key: 'down' }],
            expectedMs: { x: 0, y: 1000 }, lastInputT: 1000 },
    ]
    for (const tl of timelines) {
        const until = tl.lastInputT + 400 // idle frames after release
        const partitions = {
            frequent: frameGrid(1000 / 60, until),
            delayed: frameGrid(tl.delayedStep ?? 50, until),
        }
        const expected = { x: tl.expectedMs.x * MS_SPEED, y: tl.expectedMs.y * MS_SPEED }
        const observed = {}
        for (const [name, times] of Object.entries(partitions)) {
            const r = playTimeline(sourceDir, tl, times)
            const firstAfter = r.perFrame.find(f => f.t >= tl.lastInputT)
            const idle = r.perFrame.filter(f => f.t > firstAfter.t)
            observed[name] = r.delta
            check(`${tl.id}/${name}/displacement`, `${tl.description}; ${name} frames every ${(times[1] - times[0]).toFixed(2)} ms`,
                { x: r.delta.x, y: r.delta.y, direction: { x: sign(r.delta.x), y: sign(r.delta.y) } },
                { x: expected.x, y: expected.y, direction: { x: sign(expected.x), y: sign(expected.y) } })
            check(`${tl.id}/${name}/applied-by-next-frame`, 'full movement applied by the first frame at/after the last input',
                { remainingAfterFrameX: near(idle.reduce((a, f) => a + f.x, 0)), remainingAfterFrameY: near(idle.reduce((a, f) => a + f.y, 0)) },
                { remainingAfterFrameX: true, remainingAfterFrameY: true })
            check(`${tl.id}/${name}/idle-frames-still`, 'no displacement on subsequent idle frames',
                { idleFrames: idle.length > 0, moving: idle.filter(f => !near(f.x) || !near(f.y)).length },
                { idleFrames: true, moving: 0 })
        }
        check(`${tl.id}/frequent-vs-delayed`, 'frequent and delayed partitions of the same timeline agree',
            { dx: observed.frequent.x - observed.delayed.x, dy: observed.frequent.y - observed.delayed.y }, { dx: 0, dy: 0 })
    }

    // Boundary clamping: a short press toward a nearby limit stops at the limit and never overshoots.
    const border = 1500 // getScreenRight() = 500 with SIZE 1000
    const clampTl = { start: { x: 480, y: 0 },
        events: [{ t: 10, type: 'down', key: 'right' }, { t: 40, type: 'up', key: 'right' }] }
    for (const [name, times] of Object.entries({ frequent: frameGrid(1000 / 60, 300), delayed: frameGrid(50, 300) })) {
        const r = playTimeline(sourceDir, clampTl, times, { border })
        const limit = r.world.events.screen.getScreenRight()
        check(`boundary/${name}/clamped-short-press`, 'Right tapped 30 ms (72 px) 20 px from right limit clamps to the limit',
            { offsetX: r.world.env.canvas.offset.x, offsetY: r.world.env.canvas.offset.y, maxOffsetX: Math.max(...r.perFrame.map((f, i) => clampTl.start.x + r.perFrame.slice(0, i + 1).reduce((a, g) => a + g.x, 0))) },
            { offsetX: limit, offsetY: 0, maxOffsetX: 500 })
        // Pressing back after clamping moves away by exactly the press duration (no banked overshoot).
        const back = playTimeline(sourceDir, { start: clampTl.start, events: [...clampTl.events,
            { t: 200, type: 'down', key: 'left' }, { t: 230, type: 'up', key: 'left' }] }, times, { border })
        check(`boundary/${name}/no-banked-overshoot`, 'Left tapped 30 ms after clamp moves 72 px left of the limit',
            { offsetX: back.world.env.canvas.offset.x }, { offsetX: limit - 30 * MS_SPEED })
    }
    return checks
}

function main() {
    const args = parseArgs(process.argv.slice(2))
    fs.mkdirSync(args.outputDir, { recursive: true })
    const started = Date.now()
    const checks = { arbitration, direction, 'short-press': shortPress }[args.case](args.sourceDir)
    const failed = checks.filter(c => !c.pass)
    const pass = failed.length === 0
    const out = f => path.join(args.outputDir, f)
    fs.writeFileSync(out('checkpoints.json'), JSON.stringify({ case: args.case, pass, total: checks.length,
        failed: failed.map(c => c.id), checkpoints: checks }, null, 2))
    const identities = {}
    for (const f of SOURCES) identities[f] = sha256(path.join(args.sourceDir, f))
    identities['ai/test-camera-input.js'] = sha256(__filename)
    fs.writeFileSync(out('source-identities.json'), JSON.stringify({ sourceDir: path.resolve(args.sourceDir),
        algorithm: 'sha256', files: identities }, null, 2))
    fs.writeFileSync(out('coverage-results.json'), JSON.stringify({ case: args.case, pass, elapsedMs: Date.now() - started,
        results: checks.map(c => ({ id: c.id, pass: c.pass, proof: out('checkpoints.json') })) }, null, 2))
    console.log(`SUMMARY case=${args.case} checks=${checks.length} passed=${checks.length - failed.length} failed=${failed.length}`)
    process.exit(pass ? 0 : 1)
}

if (require.main === module) main()
module.exports = { arbitration, direction, shortPress, playTimeline, frameGrid, createWorld, sha256, CASES, KEY, SPEED }
