'use strict';
// Production-source regressions for keyboard camera zoom (+ / numpad Add, - / numpad Subtract).
// Loads events/screen.js, events/events.js and events/geteventpos.js into a VM (via the
// test-camera-input.js fixture) and drives the real document-level keydown/keyup/mousemove/
// blur handlers and ComputerScreen scaling. Expected values are independent constants and
// formulas below. This proves input/scaling logic only, not real browser behavior.
// Usage: node ai/test-camera-keyboard-zoom.js --output-dir <fresh> [--source-dir <repo>]
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path')
const { createWorld, sha256, KEY, SPEED } = require('./test-camera-input')

const SIZE = 1000 // createWorld WIDTH/HEIGHT (device px)
const STEP = 1.1
const MIN = 0.5, MAX = 2 // createWorld mapBorder.scale limits
const TOLERANCE = 1e-9 // predeclared, scale and px
const CENTER = { x: SIZE / 2, y: SIZE / 2 }
const KEYCODE = { Equal: 187, Minus: 189, NumpadAdd: 107, NumpadSubtract: 109 }
const FORMS = {
    plus: { key: '+', code: 'Equal', shiftKey: true },
    numpadAdd: { key: '+', code: 'NumpadAdd' },
    minus: { key: '-', code: 'Minus' },
    numpadSubtract: { key: '-', code: 'NumpadSubtract' },
    equal: { key: '=', code: 'Equal' },
}

function parseArgs(argv) {
    const args = { outputDir: null, sourceDir: path.join(__dirname, '..') }
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--output-dir') args.outputDir = argv[++i]
        else if (argv[i] === '--source-dir') args.sourceDir = argv[++i]
        else throw Error('unknown argument ' + argv[i])
    }
    if (!args.outputDir) throw Error('--output-dir is required')
    return args
}

function zoomWorld(sourceDir, { dpr = 1, scale = 1, offset = { x: 0, y: 0 } } = {}) {
    const w = createWorld(sourceDir)
    Object.assign(w.env, {
        window: { devicePixelRatio: dpr }, menu: { visible: false }, gameEvent: w.events,
        mainCanvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    })
    vm.runInContext(fs.readFileSync(path.join(sourceDir, 'events/geteventpos.js'), 'utf8'), w.env)
    w.env.canvas.scale = scale
    w.env.canvas.offset = { ...offset }
    let time = 0
    const event = (form, extra = {}) => {
        const e = { keyCode: KEYCODE[form.code] ?? 0, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
            repeat: false, target: { tagName: 'BODY' }, timeStamp: time += 10, prevented: 0, ...form, ...extra }
        e.preventDefault = () => { e.prevented++ }
        return e
    }
    w.down = (form, extra) => { const e = event(form, extra); w.env.keydown(e); return e }
    w.up = (form, extra) => { const e = event(form, extra); w.env.keyup(e); return e }
    w.move = (clientX, clientY, tagName = 'CANVAS') =>
        w.env.mousemove({ clientX, clientY, target: { tagName }, timeStamp: time += 10 })
    w.state = () => ({ scale: w.env.canvas.scale, offset: { ...w.env.canvas.offset } })
    // world point (canvas.offset units) under a device-pixel screen position
    w.worldAt = pos => ({ x: pos.x / w.env.canvas.scale + w.env.canvas.offset.x,
        y: pos.y / w.env.canvas.scale + w.env.canvas.offset.y })
    return w
}

// independent expectation: offset after zooming from (scale, offset) to newScale around anchor
const expectedOffset = (scale, offset, newScale, anchor) => ({
    x: offset.x + anchor.x / scale - anchor.x / newScale,
    y: offset.y + anchor.y / scale - anchor.y / newScale,
})

function run(sourceDir) {
    const checks = []
    const check = (id, description, observed, expected) => {
        const same = (o, e) => typeof e === 'number' ? typeof o === 'number' && Math.abs(o - e) <= TOLERANCE
            : e && typeof e === 'object' ? Object.keys(e).every(k => same(o?.[k], e[k])) : o === e
        const pass = same(observed, expected)
        checks.push({ id, description, expected, observed, tolerance: TOLERANCE, pass })
        console.log((pass ? 'PASS ' : 'FAIL ') + id + ' expected=' + JSON.stringify(expected) + ' observed=' + JSON.stringify(observed))
    }

    // Exact ratios for every supported key form, center anchor (no pointer yet).
    for (const [name, scale] of [['plus', STEP], ['numpadAdd', STEP], ['minus', 1 / STEP], ['numpadSubtract', 1 / STEP]]) {
        const w = zoomWorld(sourceDir)
        const e = w.down(FORMS[name])
        w.up(FORMS[name])
        check(`ratio/${name}`, `${name} (${FORMS[name].code}, key ${FORMS[name].key}) from scale 1, no pointer yet`,
            { ...w.state(), prevented: e.prevented },
            { scale, offset: expectedOffset(1, { x: 0, y: 0 }, scale, CENTER), prevented: 1 })
    }
    {
        const w = zoomWorld(sourceDir, { scale: 1.3, offset: { x: 40, y: -70 } })
        w.down(FORMS.plus), w.up(FORMS.plus)
        const afterIn = w.state()
        w.down(FORMS.minus), w.up(FORMS.minus)
        check('ratio/scale-times-1.1-from-1.3', 'plus from scale 1.3 gives 1.43', afterIn.scale, 1.43)
        check('ratio/reciprocal-plus-minus', 'plus then minus restores scale and offset', w.state(),
            { scale: 1.3, offset: { x: 40, y: -70 } })
        w.down(FORMS.numpadSubtract), w.up(FORMS.numpadSubtract)
        const afterOut = w.state()
        w.down(FORMS.numpadAdd), w.up(FORMS.numpadAdd)
        check('ratio/scale-div-1.1-from-1.3', 'numpad Subtract from 1.3 gives 1.3 / 1.1', afterOut.scale, 1.3 / 1.1)
        check('ratio/reciprocal-numpad', 'numpad Subtract then Add restores scale and offset', w.state(),
            { scale: 1.3, offset: { x: 40, y: -70 } })
    }

    // Plain = (the +/= key without Shift) zooms in exactly like +.
    {
        const w = zoomWorld(sourceDir)
        const e = w.down(FORMS.equal)
        const ref = zoomWorld(sourceDir)
        ref.down(FORMS.plus)
        check('keys/plain-equal-zooms-in', 'plain = (Equal without Shift) zooms in like + and prevents default',
            { ...w.state(), prevented: e.prevented }, { ...ref.state(), prevented: 1 })
        check('keys/plain-equal-step', 'plain = multiplies scale by the keyboard step', w.env.canvas.scale, STEP)
    }

    // Pointer anchor: the world point under the last canvas pointer stays at the same screen position.
    {
        const w = zoomWorld(sourceDir, { scale: 1.2, offset: { x: 100, y: 50 } })
        const anchor = { x: 300, y: 700 }
        w.move(anchor.x, anchor.y)
        const worldBefore = w.worldAt(anchor)
        w.down(FORMS.plus), w.up(FORMS.plus)
        const centerAnchored = expectedOffset(1.2, { x: 100, y: 50 }, 1.32, CENTER)
        check('anchor/not-screen-center', 'with a known pointer the result is not the screen-center zoom',
            { differsFromCenterAnchor: Math.abs(w.env.canvas.offset.x - centerAnchored.x) > 1 &&
                Math.abs(w.env.canvas.offset.y - centerAnchored.y) > 1 }, { differsFromCenterAnchor: true })
        check('anchor/pointer-plus', 'plus keeps the world point under the pointer (300,700)',
            { ...w.state(), worldUnderPointer: w.worldAt(anchor) },
            { scale: 1.32, offset: expectedOffset(1.2, { x: 100, y: 50 }, 1.32, anchor), worldUnderPointer: worldBefore })
        const s = w.env.canvas.scale, o = { ...w.env.canvas.offset }
        w.down(FORMS.numpadSubtract), w.up(FORMS.numpadSubtract)
        check('anchor/pointer-numpad-subtract', 'numpad Subtract keeps the same world point under the pointer',
            { ...w.state(), worldUnderPointer: w.worldAt(anchor) },
            { scale: 1.2, offset: expectedOffset(s, o, 1.2, anchor), worldUnderPointer: worldBefore })
        // pointer over a non-canvas element does not replace the last canvas position
        w.move(900, 10, 'DIV')
        const before = w.worldAt(anchor)
        w.down(FORMS.plus), w.up(FORMS.plus)
        check('anchor/non-canvas-move-keeps-last-canvas-pointer', 'mousemove over a DIV keeps (300,700) as anchor',
            w.worldAt(anchor), before)
    }
    {
        const w = zoomWorld(sourceDir, { scale: 0.8, offset: { x: -20, y: 30 } })
        const worldBefore = w.worldAt(CENTER)
        w.down(FORMS.minus), w.up(FORMS.minus)
        check('anchor/center-fallback', 'no pointer yet: minus keeps the canvas-center world point',
            { ...w.state(), worldUnderCenter: w.worldAt(CENTER) },
            { scale: 0.8 / STEP, offset: expectedOffset(0.8, { x: -20, y: 30 }, 0.8 / STEP, CENTER), worldUnderCenter: worldBefore })
    }
    {
        // devicePixelRatio 2: clientX/Y (150,100) CSS px is device (300,200); canvas coordinates are device px.
        const w = zoomWorld(sourceDir, { dpr: 2 })
        w.move(150, 100)
        const device = { x: 300, y: 200 }
        const worldBefore = w.worldAt(device)
        w.down(FORMS.plus), w.up(FORMS.plus)
        check('anchor/device-pixel-ratio-2', 'dpr 2: pointer client (150,100) anchors at device (300,200)',
            { anchor: w.events.getZoomAnchor(), ...w.state(), worldUnderPointer: w.worldAt(device) },
            { anchor: device, scale: STEP, offset: expectedOffset(1, { x: 0, y: 0 }, STEP, device), worldUnderPointer: worldBefore })
    }

    // Map-specific limits through the shared scaling function.
    {
        const w = zoomWorld(sourceDir, { scale: 1.95 })
        w.down(FORMS.plus), w.up(FORMS.plus)
        const first = w.env.canvas.scale
        w.down(FORMS.numpadAdd), w.up(FORMS.numpadAdd)
        check('limits/max', 'plus from 1.95 clamps to max 2, a further numpad Add stays at 2',
            { first, second: w.env.canvas.scale }, { first: MAX, second: MAX })
        const v = zoomWorld(sourceDir, { scale: 0.52 })
        v.down(FORMS.minus), v.up(FORMS.minus)
        const firstMin = v.env.canvas.scale
        v.down(FORMS.numpadSubtract), v.up(FORMS.numpadSubtract)
        check('limits/min', 'minus from 0.52 clamps to min 0.5, a further numpad Subtract stays at 0.5',
            { first: firstMin, second: v.env.canvas.scale }, { first: MIN, second: MIN })
        check('limits/width-height', 'width/height follow the clamped scale', { width: v.env.width, height: v.env.height },
            { width: SIZE / MIN, height: SIZE / MIN })
    }

    // One step per physical press.
    {
        const w = zoomWorld(sourceDir)
        w.down(FORMS.plus)
        const repeats = [1, 2, 3, 4, 5].map(() => w.down(FORMS.plus, { repeat: true }).prevented)
        const dupNonRepeat = w.down(FORMS.plus).prevented // a second keydown without keyup (no repeat flag)
        check('press/repeat-ignored', 'held plus with 5 auto-repeat keydowns and a duplicate keydown zooms once',
            { scale: w.env.canvas.scale, repeatsPrevented: repeats, dupNonRepeatPrevented: dupNonRepeat },
            { scale: STEP, repeatsPrevented: [1, 1, 1, 1, 1], dupNonRepeatPrevented: 1 })
        w.up(FORMS.plus)
        w.down(FORMS.plus)
        w.down(FORMS.plus, { repeat: true })
        check('press/release-repress', 'release and re-press zooms exactly one more step', w.env.canvas.scale, STEP * STEP)
        // Shift released before Equal: keyup reports key '=' but the same physical code releases the latch
        w.up({ key: '=', code: 'Equal' })
        w.down(FORMS.plus)
        check('press/release-by-code-after-shift-up', 'keyup of Equal with key "=" releases the + latch',
            w.env.canvas.scale, STEP ** 3)
        w.up(FORMS.plus)
        // numpad Add and main plus are independent physical keys
        w.down(FORMS.numpadAdd), w.down(FORMS.plus)
        check('press/two-physical-keys', 'numpad Add then main plus both held: two steps', w.env.canvas.scale,
            STEP ** 5)
    }
    {
        const w = zoomWorld(sourceDir)
        w.down(FORMS.minus)
        w.env.windowBlur() // keyup lost while unfocused
        w.down(FORMS.minus)
        check('press/focus-loss-reset', 'minus held, window blur without keyup, next press zooms again',
            w.env.canvas.scale, 1 / STEP / STEP)
        w.env.windowBlur()
        w.down(FORMS.minus, { repeat: true })
        check('press/repeat-after-blur-ignored', 'auto-repeat after blur is not a new press', w.env.canvas.scale, 1 / STEP / STEP)
    }
    {
        const w = zoomWorld(sourceDir)
        w.down(FORMS.plus) // held when leaving gameplay; keyup never delivered
        w.env.menu.visible = true
        const inMenu = w.down(FORMS.plus)
        w.env.menu.visible = false
        w.down(FORMS.plus)
        check('press/leave-gameplay-reset', 'plus held into the menu, back to gameplay: next press zooms',
            { scale: w.env.canvas.scale, menuPrevented: inMenu.prevented }, { scale: STEP * STEP, menuPrevented: 0 })
        const v = zoomWorld(sourceDir)
        v.down(FORMS.numpadAdd)
        v.events.resetKeyboardZoom() // GameStart.clearBasisValues on a new game
        v.down(FORMS.numpadAdd)
        check('press/new-game-reset', 'resetKeyboardZoom (called on game start) clears a stale latch',
            v.env.canvas.scale, STEP * STEP)
    }

    // Ignored contexts and modifiers: no zoom, default not prevented.
    const ignored = [
        ['menu', w => { w.env.menu.visible = true }, {}],
        ['input-target', () => {}, { target: { tagName: 'INPUT' } }],
        ['textarea-target', () => {}, { target: { tagName: 'TEXTAREA' } }],
        ['select-target', () => {}, { target: { tagName: 'SELECT' } }],
        ['contenteditable-target', () => {}, { target: { tagName: 'DIV', isContentEditable: true } }],
        ['ctrl', () => {}, { ctrlKey: true }],
        ['meta', () => {}, { metaKey: true }],
        ['alt', () => {}, { altKey: true }],
    ]
    for (const [name, setup, extra] of ignored)
        for (const form of ['plus', 'numpadSubtract']) {
            const w = zoomWorld(sourceDir)
            setup(w)
            const e = w.down(FORMS[form], extra)
            check(`ignored/${name}/${form}`, `${form} in ${name} context is not handled`,
                { scale: w.env.canvas.scale, prevented: e.prevented }, { scale: 1, prevented: 0 })
        }
    {
        const w = zoomWorld(sourceDir)
        w.down(FORMS.plus, { ctrlKey: true })
        w.down(FORMS.plus) // Ctrl combination did not latch the key
        check('ignored/ctrl-does-not-latch', 'Ctrl+plus ignored, then plain plus zooms once', w.env.canvas.scale, STEP)
    }
    {
        const w = zoomWorld(sourceDir)
        w.events.waitingMode = true
        const e = w.down(FORMS.plus)
        check('gameplay/waiting-for-turn', 'plus zooms while waiting for the turn (waitingMode)',
            { scale: w.env.canvas.scale, prevented: e.prevented }, { scale: STEP, prevented: 1 })
    }

    // Preserved behavior: wheel zoom, movement keys, arbitration with zoom keys.
    {
        const w = zoomWorld(sourceDir)
        w.move(250, 250)
        const worldBefore = w.worldAt({ x: 250, y: 250 })
        w.env.mousewheel({ clientX: 250, clientY: 250, wheelDelta: 0 })
        const wheel0 = w.env.canvas.scale
        w.env.mousewheel({ clientX: 250, clientY: 250, wheelDelta: 1000 * Math.log(1.25) })
        check('preserve/wheel-zoom', 'wheel delta 1000*ln(1.25) zooms by 1.25 at the wheel position',
            { unchangedAtZero: wheel0, scale: w.env.canvas.scale, world: w.worldAt({ x: 250, y: 250 }) },
            { unchangedAtZero: 1, scale: 1.25, world: worldBefore })
        w.env.mousewheel({ clientX: 250, clientY: 250, wheelDelta: 1e6 })
        check('preserve/wheel-max', 'large wheel delta clamps to max', w.env.canvas.scale, MAX)
    }
    {
        const w = zoomWorld(sourceDir)
        const e = w.down({ key: 'ArrowRight', code: 'ArrowRight', keyCode: KEY.right })
        w.down(FORMS.plus)
        w.up(FORMS.plus)
        const start = w.offset()
        for (let i = 0; i < 60; i++) w.events.moveScreen(1000 / 60)
        const moved = w.offset().x - start.x
        w.up({ key: 'ArrowRight', code: 'ArrowRight', keyCode: KEY.right })
        const s2 = w.offset()
        for (let i = 0; i < 60; i++) w.events.moveScreen(1000 / 60)
        check('preserve/arrow-movement-with-zoom-key', 'Right held after a plus tap: moves right 60 frames, not prevented, stops on release',
            { moved, prevented: e.prevented, scale: w.env.canvas.scale, afterRelease: w.offset().x - s2.x },
            { moved: SPEED * 60, prevented: 0, scale: STEP, afterRelease: 0 })
        w.down({ key: '-', code: 'Minus' })
        check('preserve/zoom-key-not-movement', 'zoom keys do not change camera speed',
            { speedX: w.events.screen.speedX, speedY: w.events.screen.speedY }, { speedX: 0, speedY: 0 })
    }
    // Holding a zoom key: one step now, nothing more during the 300 ms delay, then 2x per second until the limit.
    {
        const HOLD_DELAY = 300, HOLD_RATE = 2, FRAME = 1000 / 60
        const w = zoomWorld(sourceDir)
        w.down(FORMS.plus)
        for (let i = 0; i < 18; i++) w.events.moveScreen(FRAME) // 300 ms
        const afterDelay = w.env.canvas.scale
        for (let i = 0; i < 42; i++) w.events.moveScreen(FRAME) // up to 1000 ms held
        check('hold/plus-delay-then-continuous', 'holding + zooms one step, waits 300 ms, then 2x per second',
            { afterDelay, afterSecond: w.env.canvas.scale },
            { afterDelay: STEP, afterSecond: STEP * Math.pow(HOLD_RATE, (1000 - HOLD_DELAY) / 1000) })
        for (let i = 0; i < 120; i++) w.events.moveScreen(FRAME)
        check('hold/plus-clamps-at-max', 'holding + stops at the max scale', w.env.canvas.scale, MAX)
        w.up(FORMS.plus)
        const released = w.env.canvas.scale
        w.down(FORMS.numpadSubtract)
        for (let i = 0; i < 18; i++) w.events.moveScreen(FRAME)
        const afterMinusDelay = w.env.canvas.scale
        for (let i = 0; i < 42; i++) w.events.moveScreen(FRAME)
        check('hold/minus-after-release', 'after release + stops; holding numpad - zooms out the same way',
            { released, afterMinusDelay, afterSecond: w.env.canvas.scale },
            { released: MAX, afterMinusDelay: MAX / STEP,
                afterSecond: MAX / STEP / Math.pow(HOLD_RATE, (1000 - HOLD_DELAY) / 1000) })
        w.up(FORMS.numpadSubtract)
        const stopped = w.env.canvas.scale
        for (let i = 0; i < 60; i++) w.events.moveScreen(FRAME)
        check('hold/stops-on-release', 'no zoom after the key is released', w.env.canvas.scale, stopped)
    }
    {
        const w = zoomWorld(sourceDir)
        w.down(FORMS.plus)
        w.env.windowBlur()
        for (let i = 0; i < 60; i++) w.events.moveScreen(1000 / 60)
        check('hold/blur-stops', 'window blur ends a held zoom', w.env.canvas.scale, STEP)
    }
    return checks
}

function main() {
    const args = parseArgs(process.argv.slice(2))
    fs.mkdirSync(args.outputDir, { recursive: true })
    const started = Date.now()
    const checks = run(args.sourceDir)
    const failed = checks.filter(c => !c.pass)
    const pass = failed.length === 0
    const out = f => path.join(args.outputDir, f)
    fs.writeFileSync(out('checkpoints.json'), JSON.stringify({ case: 'keyboard-zoom', pass, total: checks.length,
        failed: failed.map(c => c.id), checkpoints: checks }, null, 2))
    const identities = {}
    for (const f of ['events/screen.js', 'events/events.js', 'events/geteventpos.js'])
        identities[f] = sha256(path.join(args.sourceDir, f))
    identities['ai/test-camera-keyboard-zoom.js'] = sha256(__filename)
    identities['ai/test-camera-input.js'] = sha256(path.join(__dirname, 'test-camera-input.js'))
    fs.writeFileSync(out('source-identities.json'), JSON.stringify({ sourceDir: path.resolve(args.sourceDir),
        algorithm: 'sha256', files: identities }, null, 2))
    fs.writeFileSync(out('coverage-results.json'), JSON.stringify({ case: 'keyboard-zoom', pass, elapsedMs: Date.now() - started,
        results: checks.map(c => ({ id: c.id, pass: c.pass, proof: out('checkpoints.json') })) }, null, 2))
    console.log(`SUMMARY case=keyboard-zoom checks=${checks.length} passed=${checks.length - failed.length} failed=${failed.length}`)
    process.exit(pass ? 0 : 1)
}

main()
