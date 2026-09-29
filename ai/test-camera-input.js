'use strict';
// Production-source regressions for desktop camera keyboard/mouse arbitration.
// Loads events/screen.js and events/events.js into a VM and drives the real
// Events/ComputerScreen/MobileScreen classes frame by frame.
// Usage: node ai/test-camera-input.js --case arbitration --output-dir <fresh> [--source-dir <repo>]
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), crypto = require('node:crypto')

const CASES = ['arbitration']
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

function main() {
    const args = parseArgs(process.argv.slice(2))
    fs.mkdirSync(args.outputDir, { recursive: true })
    const started = Date.now()
    const checks = arbitration(args.sourceDir)
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
module.exports = { arbitration, CASES }
