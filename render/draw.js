function drawMain() {
    // Attack animations (render/attackFx.js): waiting effects start and finished ones end before the board is drawn, so
    // the units an effect draws are left out of this frame's unit passes (Grid.getStillUnit).
    if (typeof attackFx !== 'undefined')
        attackFx.prune()
    // Heal animations (render/healFx.js), likewise: their units are left out of this frame's unit passes.
    if (typeof healFx !== 'undefined')
        healFx.prune()
    // A zoom gesture's frame: the board of the frame before it, scaled (TASK-1374).
    if (grid.drawZoomRaster(mainCtx)) {
        if (typeof attackFx !== 'undefined')
            attackFx.rasterFrame = true
        drawAttackFx()
        return
    }
    // Cells too small for their details: a level-of-detail frame, recorded and made at the end unless it repeats the
    // frame before, whose board is then drawn back (TASK-1375, Grid.beginLodFrame); so is a still frame at any scale
    // (TASK-1376, Grid.stillFrameCandidate).
    const lod = grid.beginLodFrame(mainCtx)
    const ctx = lod ? lod.context : mainCtx
    // An opaque sky raster covers the whole canvas, so it needs no clear under it; the board's lit
    // images may hide most of the canvas (Grid.frameCover): then the sky is drawn only where they
    // leave it open.
    const cover = grid.frameCover(ctx)
    if (!cover) {
        if (!atmosphericBackground.opaqueOver(ctx))
            ctx.clearRect(canvas.offset.x, canvas.offset.y,
                width, height)
        atmosphericBackground.draw(ctx)
        drawBackgroundHints(ctx)
    }
    else if (cover.open.length) {
        // clipToDeviceRects leaves the identity transform; the hints are in world space (the camera's).
        const camera = ctx.getTransform()
        ctx.save()
        clipToDeviceRects(ctx, cover.open)
        atmosphericBackground.draw(ctx)
        ctx.setTransform(camera.a, camera.b, camera.c, camera.d, camera.e, camera.f)
        drawBackgroundHints(ctx)
        ctx.restore()
    }

    // Border.draw sets round joins/caps and never restores them, so every frame after the first strokes
    // text and bars with them. Start each frame in that state, so the first frame draws the same.
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    // TASK-1411: the selected unit's overlay is blitted from its raster after the board (made, held or recorded), so it
    // is never part of a held frame's snapshot (SelectionOverlay.drawSelection).
    SelectionOverlay.deferred = true
    try {
        grid.draw(ctx)
    } finally {
        SelectionOverlay.deferred = false
    }
    if (lod)
        grid.endLodFrame(mainCtx, lod)
    SelectionOverlay.drawSelection(mainCtx)
    drawAttackFx()
}

// Attack animations over the board's frame on the main canvas, whether drawn, held (its snapshot is taken before them:
// Grid.endLodFrame) or a zoom gesture's raster: an effect never makes the board draw live (TASK-1425, render/attackFx.js).
function drawAttackFx() {
    if (typeof attackFx !== 'undefined')
        attackFx.draw(mainCtx)
    // (heal animations over them the same way: render/healFx.js)
    if (typeof healFx !== 'undefined')
        healFx.draw(mainCtx)
}

// Tutorial 1 ('Moving Around') shows the keyboard controls on the sky beside the board, on a desktop only:
// a 'Camera' panel left of the board and a 'Turn' panel right of it, in world space (they pan and zoom
// with the board). They are part of the background: drawn right after the sky (drawMain and the lit
// rest snapshot, lit patch and overlay snapshot, which hold the sky), so the board, its shadow and the
// units draw over them. Each panel is rendered once per scale step into an offscreen canvas
// (backgroundHintCanvas) and drawn with one drawImage a frame. In r (basis.r) units: panel rects from
// the board's top face, the keys, the mouse icon (as high as a key) and texts from the panel's top left; captions
// start at textX, words ('or') are left-aligned and vertically centred at y.
// The gap between a panel and the board's top face, the keys' height, the canvas margin (r units).
const BACKGROUND_HINT_GAP = 0.8
const BACKGROUND_HINT_KEY = 0.98
const BACKGROUND_HINT_PAD = 0.1
const BACKGROUND_HINT_PANELS = [
    {name: 'camera', heading: 'Camera', side: -1, width: 4.55, height: 6.1, textX: 0.47,
        mouse: {x: 0.47, y: 0.88, width: 0.62}, words: [{text: 'or', x: 1.2, y: 0.88 + BACKGROUND_HINT_KEY / 2}], keys: [
        {text: '+', x: 1.75, y: 0.88, width: 0.98},
        {text: '−', x: 2.88, y: 0.88, width: 0.98},
        {text: '↑', x: 1.6, y: 3.15, width: 0.98},
        {text: '←', x: 0.47, y: 4.3, width: 0.98},
        {text: '↓', x: 1.6, y: 4.3, width: 0.98},
        {text: '→', x: 2.73, y: 4.3, width: 0.98},
    ], captions: [{text: 'scale camera', y: 2.3}, {text: 'move camera', y: 5.74}]},
    {name: 'turn', heading: 'Turn', side: 1, width: 4.6, height: 5.35, textX: 0.41, keys: [
        {text: 'Backspace', x: 0.41, y: 0.88, width: 3.06},
        {text: 'Enter', x: 0.41, y: 3.15, width: 2.24},
    ], captions: [{text: 'undo move', y: 2.3}, {text: 'go to next unit /', y: 4.55}, {text: 'confirm next turn', y: 5.02}]},
]

// Whether the page is used with a mouse: a hovering fine pointer, and no touch seen in this page
// (false from the first touchstart on). No matchMedia (an old browser) counts as no.
let pageTouched = false
let desktopPointerQuery
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function')
    window.addEventListener('touchstart', () => {
        if (pageTouched)
            return
        pageTouched = true
        // The lit snapshots and the overlay snapshot hold the hints drawn with the sky.
        if (typeof grid !== 'undefined' && grid) {
            grid.releaseLitCanvases()
            grid.overlayComposite = undefined
        }
    }, {capture: true, passive: true})
function isDesktopPointer() {
    if (pageTouched || typeof window === 'undefined' || typeof window.matchMedia !== 'function')
        return false
    desktopPointerQuery ||= window.matchMedia('(hover: hover) and (pointer: fine)')
    return !!desktopPointerQuery.matches
}

function backgroundHintsShown() {
    return !!gameSettings.tutorial && gameSettings.tutorial.id === 'tutorial-16' && isDesktopPointer()
}

// The panels' world rects: beside the board's top face, centred on it vertically.
function backgroundHintRects() {
    mapDepth.ensureGeometry(grid)
    const b = mapDepth.surfaceBounds, r = basis.r, middle = (b.top + b.bottom) / 2
    const top = middle - BACKGROUND_HINT_PANELS[0].height * r / 2
    return BACKGROUND_HINT_PANELS.map(panel => ({name: panel.name, panel,
        x: panel.side < 0 ? b.left - (BACKGROUND_HINT_GAP + panel.width) * r : b.right + BACKGROUND_HINT_GAP * r,
        y: top, width: panel.width * r, height: panel.height * r}))
}

function drawBackgroundHints(ctx) {
    backgroundHintState.rects = null
    if (!backgroundHintsShown())
        return
    const t = ctx.getTransform()
    // The scale step at or above the transform's scale (quarter octaves): zooming re-renders at most
    // once a step, panning never.
    const scale = Math.pow(2, Math.ceil(Math.log2(Math.max(t.a, 1e-3)) * 4) / 4)
    const rects = backgroundHintState.rects = backgroundHintRects()
    const pad = BACKGROUND_HINT_PAD * basis.r
    for (const rect of rects) {
        const image = backgroundHintCanvas(rect.panel, scale)
        ctx.drawImage(image, rect.x - pad, rect.y - pad, image.width / image.hintScale, image.height / image.hintScale)
    }
}
// The rects drawn last (null when none), the panel renders so far and the rendered panels by panel and scale.
const backgroundHintState = {rects: null, renders: 0, canvases: new Map()}

// The panel rendered at scale (device pixels a world unit), kept for the last two scale steps.
function backgroundHintCanvas(panel, scale) {
    const cache = backgroundHintState.canvases
    const key = panel.name + ':' + scale
    let image = cache.get(key)
    if (image)
        return image
    for (const old of [...cache.keys()].filter(k => k.startsWith(panel.name + ':')).slice(0, -1)) {
        cache.get(old).width = 0
        cache.delete(old)
    }
    // A world unit at most 4096 device pixels a panel side.
    const k0 = scale * basis.r, side = (Math.max(panel.width, panel.height) + 2 * BACKGROUND_HINT_PAD) * k0
    const k = side > 4096 ? k0 * 4096 / side : k0
    image = document.createElement('canvas')
    image.width = Math.ceil((panel.width + 2 * BACKGROUND_HINT_PAD) * k)
    image.height = Math.ceil((panel.height + 2 * BACKGROUND_HINT_PAD) * k)
    image.hintScale = k / basis.r
    const g = image.getContext('2d')
    g.translate(BACKGROUND_HINT_PAD * k, BACKGROUND_HINT_PAD * k)
    renderBackgroundHintPanel(g, panel, k)
    cache.set(key, image)
    ++backgroundHintState.renders
    return image
}

// Style of the menu's cards: the panel and keys as MENU_THEME's panel and plain controls (gold rim),
// the heading in the heading gold between gold lines fading outwards, cream serif texts. k: pixels an r.
function renderBackgroundHintPanel(g, panel, k) {
    const rim = Math.max(1, 0.035 * k), family = Text.defaultFamily
    const plate = (x, y, width, height, radius, style) => {
        roundedRectPath(g, x + rim / 2, y + rim / 2, width - rim, height - rim, radius)
        g.globalAlpha = style.alpha
        g.fillStyle = style.fill
        g.fill()
        g.globalAlpha = 1
        g.strokeStyle = style.rim
        g.lineWidth = rim
        g.stroke()
    }
    plate(0, 0, panel.width * k, panel.height * k, 0.2 * k, MENU_THEME.panel)
    g.textBaseline = 'middle'
    g.textAlign = 'center'
    // The heading between two gold lines that fade towards the panel's sides.
    const middle = panel.width * k / 2, headingY = 0.43 * k
    g.font = `800 ${0.4 * k}px ${family}`
    g.fillStyle = MENU_THEME.heading
    g.fillText(panel.heading, middle, headingY)
    const half = g.measureText(panel.heading).width / 2
    for (const side of [-1, 1]) {
        const inner = middle + side * (half + 0.2 * k), outer = middle + side * (panel.width / 2 - 0.2) * k
        const line = g.createLinearGradient(outer, 0, inner, 0)
        line.addColorStop(0, MENU_THEME.plain.rim + '00')
        line.addColorStop(1, MENU_THEME.plain.rim)
        g.fillStyle = line
        g.fillRect(Math.min(inner, outer), Math.round(headingY), Math.abs(outer - inner), Math.max(1, 0.025 * k))
    }
    for (const key of panel.keys) {
        plate(key.x * k, key.y * k, key.width * k, BACKGROUND_HINT_KEY * k, 0.18 * k, MENU_THEME.plain)
        g.font = `700 ${(key.text.length > 1 ? 0.4 : 0.48) * k}px ${family}`
        g.fillStyle = MENU_THEME.plain.text
        g.fillText(key.text, (key.x + key.width / 2) * k, (key.y + BACKGROUND_HINT_KEY / 2) * k)
    }
    if (panel.mouse)
        renderBackgroundHintMouse(g, panel.mouse.x * k, panel.mouse.y * k, panel.mouse.width * k, BACKGROUND_HINT_KEY * k, rim, k)
    g.textAlign = 'left'
    g.font = `${MENU_THEME.fontWeight} ${0.35 * k}px ${family}`
    g.fillStyle = MENU_THEME.text
    for (const word of panel.words || [])
        g.fillText(word.text, word.x * k, word.y * k)
    for (const caption of panel.captions)
        g.fillText(caption.text, panel.textX * k, caption.y * k)
}

// The mouse in the box x, y, width, height (pixels): an egg-shaped navy body (narrower at the top) with a gold rim,
// a gold seam across it at 0.4 of its height, a gold split from the top to the seam and a plain glowing gold wheel
// on the split. k: pixels an r.
function renderBackgroundHintMouse(g, x, y, width, height, rim, k) {
    const cx = x + width / 2, w = width / 2 - rim, top = y + rim, bottom = y + height - rim, h = bottom - top
    const body = () => {
        g.beginPath()
        g.moveTo(cx, top)
        g.bezierCurveTo(cx + 0.8 * w, top, cx + w, top + 0.28 * h, cx + w, top + 0.55 * h)
        g.bezierCurveTo(cx + w, top + 0.88 * h, cx + 0.6 * w, bottom, cx, bottom)
        g.bezierCurveTo(cx - 0.6 * w, bottom, cx - w, top + 0.88 * h, cx - w, top + 0.55 * h)
        g.bezierCurveTo(cx - w, top + 0.28 * h, cx - 0.8 * w, top, cx, top)
        g.closePath()
    }
    g.save()
    body()
    const fill = g.createLinearGradient(0, top, 0, bottom)
    fill.addColorStop(0, '#2b3766')
    fill.addColorStop(1, MENU_THEME.plain.fill)
    g.fillStyle = fill
    g.fill()
    g.clip()
    const seam = top + 0.4 * h, line = Math.max(1, 0.6 * rim)
    g.strokeStyle = MENU_THEME.plain.rim
    g.lineWidth = line
    g.beginPath()
    g.moveTo(cx - w - rim, seam - 0.04 * h)
    g.quadraticCurveTo(cx, seam + 0.08 * h, cx + w + rim, seam - 0.04 * h)
    g.moveTo(cx, top)
    g.lineTo(cx, seam + 0.02 * h)
    g.stroke()
    g.restore()
    body()
    g.strokeStyle = MENU_THEME.plain.rim
    g.lineWidth = 1.2 * rim
    g.stroke()
    // The wheel: a plain gold pill with a gold glow.
    const ww = 0.14 * k, wh = 0.26 * k
    g.save()
    g.shadowColor = MENU_THEME.plain.rim
    g.shadowBlur = 0.15 * k
    roundedRectPath(g, cx - ww / 2, top + 0.1 * h, ww, wh, ww / 2)
    g.fillStyle = MENU_THEME.heading
    g.fill()
    g.restore()
}

function drawDebugFps(ctx) {
    if (!debug)
        return

    const fontSize = Math.max(14 * window.devicePixelRatio, 0.025 * HEIGHT)
    const padding = 0.008 * HEIGHT
    const text = 'FPS: ' + Math.round(framesPerSecond)

    ctx.save()
    ctx.font = fontSize + 'px monospace'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    const textWidth = ctx.measureText(text).width
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)'
    ctx.fillRect(padding, padding, textWidth + padding * 2, fontSize + padding * 2)
    ctx.fillStyle = framesPerSecond >= 50 ? '#7CFC00' :
        (framesPerSecond >= 30 ? '#ffd54f' : '#ff5252')
    ctx.fillText(text, padding * 2, padding * 2)
    ctx.restore()
}

// Tutorial 0 tells a first-time player the goal and names the two turn buttons: a goal box at
// the top centre between the menu and i buttons, and a label just above the undo and next-turn
// buttons. When red has no moves left on its own turn, a big red arrow points at the next-turn
// button (drawTutorialArrow). The boxes drawn last are kept in drawTutorialHints.boxes, the arrow
// in drawTutorialHints.arrow (null when none is drawn). Nothing is drawn while Retry or Next tutorial
// switches tutorials (TutorialManager.switching).
function drawTutorialHints(ctx) {
    drawTutorialHints.boxes = []
    drawTutorialHints.arrow = null
    if (!gameSettings.tutorial || gameSettings.tutorial.id !== 'tutorial-0' || TutorialManager.switching)
        return
    const unit = Math.min(WIDTH, HEIGHT)
    const gap = unit * 0.012
    const box = (name, x, y, width, height, lines) => {
        ctx.fillStyle = 'rgba(10, 18, 40, 0.75)'
        roundedRectPath(ctx, x, y, width, height, Math.min(width, height) * 0.15)
        ctx.fill()
        ctx.strokeStyle = 'white'
        ctx.lineWidth = Math.max(1, unit * 0.0025)
        ctx.stroke()
        drawTutorialHints.boxes.push({name, x, y, width, height, lines})
    }
    // Each line is a list of [text, colour] parts, drawn centred on x.
    const drawLine = (parts, x, y) => {
        let left = x - parts.reduce((sum, [text]) => sum + ctx.measureText(text).width, 0) / 2
        for (const [text, color] of parts) {
            ctx.fillStyle = color
            ctx.fillText(text, left, y)
            left += ctx.measureText(text).width
        }
    }
    ctx.save()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'

    // The goal box, shrunk if needed to fit between the menu and i buttons.
    const goal = [
        [['You control ', 'white'], ['red', 'rgb(' + players[1].textColor + ')']],
        [['Kill ', 'white'], ['blue', 'rgb(' + players[2].textColor + ')']]]
    const left = backToMenuButton.rect.x + backToMenuButton.rect.width + gap
    const right = iButton.rect.x - gap
    let font = unit * 0.042
    ctx.font = 'bold ' + font + 'px Arial'
    const textWidth = () => Math.max(...goal.map(parts =>
        parts.reduce((sum, [text]) => sum + ctx.measureText(text).width, 0)))
    const fit = (right - left) / (textWidth() + font * 1.2)
    if (fit < 1) {
        font *= fit
        ctx.font = 'bold ' + font + 'px Arial'
    }
    const goalWidth = textWidth() + font * 1.2
    const goalHeight = font * 2.9
    const goalX = Math.max(left, Math.min(right - goalWidth, WIDTH / 2 - goalWidth / 2))
    const goalY = Math.max(gap, unit * 0.02)
    box('goal', goalX, goalY, goalWidth, goalHeight, goal.map(parts => parts.map(([text, color]) => ({text, color}))))
    drawLine(goal[0], goalX + goalWidth / 2, goalY + font * 0.95)
    drawLine(goal[1], goalX + goalWidth / 2, goalY + font * 1.95)

    // A label centred above each button, kept on screen.
    font = unit * 0.03
    ctx.font = 'bold ' + font + 'px Arial'
    const labels = [['undo', 'Undo move', undoButton.rect], ['nextTurn', 'Next turn', nextTurnButton.rect]]
        .map(([name, text, rect]) => {
            const width = ctx.measureText(text).width + font * 0.8
            const height = font * 1.5
            const x = Math.max(gap, Math.min(WIDTH - gap - width, rect.centerX - width / 2))
            const y = Math.max(gap, rect.y - gap - height)
            return {name, text, x, y, width, height}
        })
    // '0 moves in total' is the check the Enter key uses; no arrow while the AI plays or the
    // result screen is up.
    if (whooseTurn === 1 && !gameEvent.waitingMode && !players[1].findIdleUnit() &&
        !tutorialResultInterface.visible) {
        const goalBox = drawTutorialHints.boxes[0]
        drawTutorialArrow(ctx, unit, gap, font, [goalBox, ...labels,
            ...[backToMenuButton, iButton, undoButton].map(button => button.rect)], labels[1], box, drawLine)
    }
    for (const {name, text, x, y, width, height} of labels) {
        box(name, x, y, width, height, [[{text, color: 'white'}]])
        drawLine([[text, 'white']], x + width / 2, y + height / 2)
    }
    ctx.restore()
}

// A big red arrow (white outline, soft shadow) from up-left whose tip touches nextTurnButton.rect's
// left border, a red glow ring around the button and a red caption box above the arrow's tail.
// Every arrow part stays left of the button, so it never covers the button's click area. The first
// angle, tip height and size (largest first) whose arrow and caption are on screen and clear of the
// other hints and buttons (obstacles) is drawn.
function drawTutorialArrow(ctx, unit, gap, font, obstacles, label, box, drawLine) {
    const rect = nextTurnButton.rect
    const lineWidth = Math.max(2, unit * 0.006)
    const text = 'No moves left: end your turn'
    const captionWidth = ctx.measureText(text).width + font * 0.8
    const captionHeight = font * 1.5
    const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    const onScreen = a => a.x >= gap && a.y >= gap && a.x + a.width <= WIDTH - gap && a.y + a.height <= HEIGHT - gap
    const layOut = (size, angle, tipFraction) => {
        // The arrow pointing along +x with its tip at the origin, then turned by angle.
        const length = size * 1.6, head = size * 0.5, halfHead = size * 0.33, halfShaft = size * 0.12
        const cos = Math.cos(angle), sin = Math.sin(angle)
        // The outline's round join reaches lineWidth / 2 past the tip, onto the button's border.
        const tip = {x: rect.x, y: rect.y + rect.height * tipFraction}
        const origin = {x: tip.x - lineWidth / 2, y: tip.y}
        const points = [[0, 0], [-head, halfHead], [-head, halfShaft], [-length, halfShaft],
            [-length, -halfShaft], [-head, -halfShaft], [-head, -halfHead]]
            .map(([x, y]) => ({x: origin.x + x * cos - y * sin, y: origin.y + x * sin + y * cos}))
        const xs = points.map(p => p.x), ys = points.map(p => p.y)
        const bounds = {x: Math.min(...xs) - lineWidth / 2, y: Math.min(...ys) - lineWidth / 2}
        bounds.width = Math.max(...xs) + lineWidth / 2 - bounds.x
        bounds.height = Math.max(...ys) + lineWidth / 2 - bounds.y
        const tail = {x: origin.x - length * cos, y: origin.y - length * sin}
        const caption = {x: Math.max(gap, Math.min(WIDTH - gap - captionWidth, tail.x - captionWidth / 2)),
            y: bounds.y - gap - captionHeight, width: captionWidth, height: captionHeight}
        if (overlaps(caption, label))
            caption.x = Math.max(gap, label.x - gap - captionWidth)
        const fits = [bounds, caption].every(part => onScreen(part) && !obstacles.some(o => overlaps(part, o))) &&
            !overlaps(bounds, caption)
        return {tip, tail, points, bounds, caption, size, angle, fits}
    }
    const base = Math.max(rect.width, unit * 0.16)
    let arrow = null
    search:
    for (const scale of [1, 0.85, 0.7, 0.55, 0.4])
        for (const degrees of [40, 30, 20, 10, 0])
            for (const tipFraction of [0.35, 0.5, 0.65, 0.8]) {
                arrow = layOut(base * scale, degrees * Math.PI / 180, tipFraction)
                if (arrow.fits)
                    break search
            }

    ctx.save()
    // The glow ring.
    const ring = {x: rect.centerX, y: rect.centerY, radius: rect.width * 0.55}
    ctx.strokeStyle = 'rgba(255, 40, 40, 0.85)'
    ctx.shadowColor = 'rgba(255, 0, 0, 0.9)'
    ctx.shadowBlur = unit * 0.03
    ctx.lineWidth = Math.max(2, unit * 0.006)
    ctx.beginPath()
    ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.stroke()
    // The arrow, outlined in white, with a soft shadow.
    ctx.beginPath()
    arrow.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))
    ctx.closePath()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
    ctx.shadowBlur = unit * 0.015
    ctx.shadowOffsetY = unit * 0.006
    ctx.fillStyle = 'rgb(230, 20, 20)'
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.lineJoin = 'round'
    ctx.lineWidth = lineWidth
    ctx.strokeStyle = 'white'
    ctx.stroke()
    ctx.restore()
    // The caption, in the hint box style but red.
    const {x, y, width, height} = arrow.caption
    box('arrowCaption', x, y, width, height, [[{text, color: 'white'}]])
    ctx.fillStyle = 'rgb(220, 25, 25)'
    roundedRectPath(ctx, x, y, width, height, Math.min(width, height) * 0.15)
    ctx.fill()
    ctx.stroke()
    drawLine([[text, 'white']], x + width / 2, y + height / 2)
    drawTutorialHints.arrow = {tip: arrow.tip, tail: arrow.tail, points: arrow.points, bounds: arrow.bounds,
        caption: arrow.caption, ring, size: arrow.size, angle: arrow.angle, fits: arrow.fits, target: {
            x: rect.x, y: rect.y, width: rect.width, height: rect.height}}
}

function drawInterface() {
    interfaceCtx.save()
    interfaceCtx.setTransform(1, 0, 0, 1, 0, 0)
    // A replay has no turn controls of its own: its controls are DOM, its status is drawn here.
    if (typeof replayViewer != 'undefined' && replayViewer) {
        replayViewer.drawOverlay(interfaceCtx)
        errorWindow.draw(interfaceCtx)
        interfaceCtx.restore()
        return
    }

    nextTurnButton.draw(interfaceCtx)

    iButton.draw(interfaceCtx)

    // A full lobby needs no banner; it reappears if a human drops out.
    const lobbyFull = onlineLobby && onlineLobby.occupiedHumans !== null &&
        onlineLobby.occupiedHumans === onlineLobby.humanCapacity
    const lobbyText = lobbyFull ? '' : onlineLobbyText()
    if (lobbyText) {
        interfaceCtx.save()
        interfaceCtx.font = Math.min(20 * window.devicePixelRatio, WIDTH / 30) + 'px Arial'
        interfaceCtx.textAlign = 'center'
        interfaceCtx.fillStyle = 'black'
        interfaceCtx.fillText(lobbyText, WIDTH / 2, HEIGHT * 0.25)
        interfaceCtx.restore()
    }

    entityInterface.draw(interfaceCtx)
    barrackInterface.draw(interfaceCtx)
    townInterface.draw(interfaceCtx)

    statisticsInterface.draw(interfaceCtx)

    backToMenuButton.draw(interfaceCtx)
    undoButton.draw(interfaceCtx)
    drawTutorialHints(interfaceCtx)
    gameEvent.draw(interfaceCtx)

    timer.draw(interfaceCtx)

    nextTurnPauseInterface.draw(interfaceCtx)
    if (gameSettings.tutorial) {
        tutorialResultInterface.draw(interfaceCtx)
        tutorialPauseInterface.draw(interfaceCtx)
    }
    const onlineResult = typeof onlineResultInterface !== 'undefined' ? onlineResultInterface : null
    onlineResult?.update()
    const outcome = gameSettings.coop && gameSettings.coop.result || hiddenGameEndText()
    if (outcome && !onlineResult?.visible) {
        const labels = {victory: 'Victory — humans win', defeat: 'Defeat — demons win', draw: 'Draw — all sides eliminated'}
        interfaceCtx.save()
        interfaceCtx.font = Math.min(28 * window.devicePixelRatio, WIDTH / 24) + 'px Arial'
        interfaceCtx.textAlign = 'center'
        interfaceCtx.fillStyle = 'white'
        interfaceCtx.fillRect(WIDTH * 0.1, HEIGHT * 0.31, WIDTH * 0.8, HEIGHT * 0.09)
        interfaceCtx.fillStyle = 'black'
        interfaceCtx.fillText(labels[outcome] || outcome, WIDTH / 2, HEIGHT * 0.37)
        interfaceCtx.restore()
    }
    onlineResult?.draw(interfaceCtx)
    errorWindow.draw(interfaceCtx)
    drawDebugFps(interfaceCtx)
    interfaceCtx.restore()
}

function drawAll() {
    drawMain()
    drawInterface()
        //mainCtx.clearRect(-basis.offset.x, -basis.offset.y * 2, width, height)

    //grid.draw(mainCtx)

    //border.draw()

    //entityInterface.draw()
    //townInterface.draw()


}
