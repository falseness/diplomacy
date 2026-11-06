function drawMain() {
    // TASK-1513: the sprites queued by the frame before are drawn into their atlas, before this frame reads it.
    if (typeof SpriteCache !== 'undefined' && typeof mainCtx !== 'undefined')
        SpriteCache.beginFrame(mainCtx)
    // TASK-1495: a step-by-step playback of AI turns applies its next step before the frame (options/turnPlayback.js).
    if (typeof turnPlaybackView !== 'undefined')
        turnPlaybackView.tick()
    // TASK-1498: the next queued game:diff of other players once the last one played (options/onlineLogic.js).
    if (typeof gameDiffQueue !== 'undefined')
        gameDiffQueue.tick()
    // Attack animations (render/attackFx.js): waiting effects start and finished ones end before the board is drawn, so
    // the units an effect draws are left out of this frame's unit passes (Grid.getStillUnit).
    if (typeof attackFx !== 'undefined')
        attackFx.prune()
    // Heal animations (render/healFx.js), likewise: their units are left out of this frame's unit passes.
    if (typeof healFx !== 'undefined')
        healFx.prune()
    // TASK-1499: the board is drawn with the cells of an own kill not landed yet in their state before it (attackFx.withHeldCells).
    // A zoom gesture's frame (drawBoard true) has no selection overlay of its own.
    if (!(typeof attackFx !== 'undefined' ? attackFx.withHeldCells(drawBoard) : drawBoard()))
        SelectionOverlay.drawSelection(mainCtx)
    drawAttackFx()
    // TASK-1450: the target icons and marks over the effects' units.
    SelectionOverlay.drawSelectionIcons(mainCtx)
}

// The board's frame (drawMain); true for a zoom gesture's frame (the board of the frame before it, scaled).
function drawBoard() {
    // A zoom gesture's frame: the board of the frame before it, scaled (TASK-1374).
    if (grid.drawZoomRaster(mainCtx)) {
        if (typeof attackFx !== 'undefined')
            attackFx.rasterFrame = true
        return true
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
        atmosphericBackground.draw(ctx, cover.sky)
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
    return false
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
// a 'Camera' panel left of the board and a 'Turn' panel right of it; Tutorial 4 ('High Ground') shows a 'Display'
// panel left of the board with the 'always display hp bar' and 'always display moves bar' settings as checkboxes
// (white ticks), on a desktop and on a touch device; Tutorial 8 ('Rotate and Heal') shows an 'animations' panel the same
// way (TASK-1522). The panels are in world space (they pan and zoom
// with the board). They are part of the background: drawn right after the sky (drawMain and the lit
// rest snapshot, lit patch and overlay snapshot, which hold the sky), so the board, its shadow and the
// units draw over them. Each panel is rendered once per scale step (and per state of its settings) into an
// offscreen canvas (backgroundHintCanvas) and drawn with one drawImage a frame. In r (basis.r) units: panel rects from
// the board's top face, the keys, the mouse icon (as high as a key), the checkbox rows and texts from the panel's top
// left; captions start at textX, words ('or') are left-aligned and vertically centred at y; a row's checkbox plate
// is BACKGROUND_HINT_CHECK.size square at (BACKGROUND_HINT_CHECK.x, y), its label left-aligned at labelX and
// vertically centred on the plate.
const BACKGROUND_HINT_GAP = 0.8
const BACKGROUND_HINT_KEY = 0.98
const BACKGROUND_HINT_PAD = 0.1
const BACKGROUND_HINT_CHECK = {x: 0.32, size: 0.62, labelX: 0.32 + 0.62 + 0.25, font: 0.31, hitPad: 0.1}
// The panels by tutorial id; touch: shown on touch devices too (else on a desktop pointer only).
const BACKGROUND_HINT_PANELS = {
    'tutorial-16': {touch: false, panels: [
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
    ]},
    'tutorial-7': {touch: true, panels: [
        {name: 'display', heading: 'Display', side: -1, width: 5.75, height: 3.15, keys: [], captions: [], checks: [
            {text: 'always display hp bar', setting: 'alwaysDisplayHPBar', y: 0.9},
            {text: 'always display moves bar', setting: 'alwaysDisplayMovesBar', y: 0.9 + 0.95},
        ]},
    ]},
    // TASK-1522: Tutorial 8 ('Rotate and Heal'): the Settings menu's 'animations' row (the move slide, the attack effects
    // and the heal effects, all three on: OtherSettingsTree.__updateButtonsByOtherSettings) and its "Replay others'
    // moves" row, greyed (disabled) while Animations is off. Rows with a state getter (no setting) toggle by their
    // toggle(): the Settings menu's rule (options/otherSettings.js applyAnimationSettings, TASK-1523).
    'tutorial-20': {touch: true, panels: [
        {name: 'animations', heading: 'animations', side: -1, width: 5.75, height: 3.15, keys: [], captions: [], checks: [
            {text: 'animations', state: () => animationsSettingOn(), y: 0.9,
                toggle: () => applyAnimationSettings(!animationsSettingOn(), otherSettings.replayOthers)},
            {text: "replay others' moves", state: () => !!otherSettings.replayOthers,
                disabled: () => !animationsSettingOn(), y: 0.9 + 0.95,
                toggle: () => applyAnimationSettings(animationsSettingOn(), !otherSettings.replayOthers)},
        ]},
    ]},
}
// A checkbox row's tick (on) and greying (disabled): its state getter, else its otherSettings flag.
function backgroundHintRowOn(row) {
    return row.state ? row.state() : !!otherSettings[row.setting]
}
function backgroundHintRowDisabled(row) {
    return !!(row.disabled && row.disabled())
}

// Whether the page is used with a mouse: a hovering fine pointer, and no touch seen in this page
// (false from the first touchstart on). No matchMedia (an old browser) counts as no.
let pageTouched = false
let desktopPointerQuery
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function')
    window.addEventListener('touchstart', () => {
        if (pageTouched)
            return
        const shown = typeof gameSettings !== 'undefined' && backgroundHintsShown()
        pageTouched = true
        // The lit snapshots and the overlay snapshot hold the hints drawn with the sky.
        if (shown && !backgroundHintsShown() && typeof grid !== 'undefined' && grid) {
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

// The current tutorial's panel set, or undefined.
function backgroundHintSet() {
    return gameSettings.tutorial ? BACKGROUND_HINT_PANELS[gameSettings.tutorial.id] : undefined
}

function backgroundHintsShown() {
    const set = backgroundHintSet()
    return !!set && (set.touch || isDesktopPointer())
}

// The panels' world rects: beside the board's top face, centred on it vertically.
function backgroundHintRects() {
    mapDepth.ensureGeometry(grid)
    const b = mapDepth.surfaceBounds, r = basis.r, middle = (b.top + b.bottom) / 2
    const panels = backgroundHintSet().panels, top = middle - panels[0].height * r / 2
    return panels.map(panel => ({name: panel.name, panel,
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
// TASK-1536: on-screen minimum of a checkbox row's hit height (CSS px), as the Settings menu's touch targets.
const BACKGROUND_HINT_MIN_HIT_CSS = 44
// Canvas pixels a CSS pixel, as getEventPos maps a client point (the canvas's CSS box; no box: devicePixelRatio).
function backgroundHintCanvasPerCss() {
    const box = typeof mainCanvas !== 'undefined' && mainCanvas && mainCanvas.getBoundingClientRect?.()
    if (box && box.width && box.height)
        return mainCanvas.width / box.width
    return typeof window !== 'undefined' && window.devicePixelRatio || 1
}
// The checkbox rows' hit areas in world coordinates (TASK-1470, TASK-1536): x from the panel's left edge plus the plate's
// inset to its right edge less it (the label's width); y around the row's centre (the plate's centre) up to the midpoint
// to the next row on each side (the same half pitch above the first and below the last row; a lone row: its plate's
// height and BACKGROUND_HINT_CHECK.hitPad), each half grown to at least half of BACKGROUND_HINT_MIN_HIT_CSS on screen at
// the current camera scale. Grown areas may overlap: backgroundHintClick gives a point to the nearer centre.
function backgroundHintHitRows() {
    const rects = backgroundHintRects(), check = BACKGROUND_HINT_CHECK, r = basis.r
    const minHalf = BACKGROUND_HINT_MIN_HIT_CSS * backgroundHintCanvasPerCss() / canvas.scale / 2
    const hits = []
    for (const rect of rects) {
        const rows = rect.panel.checks || []
        const centres = rows.map(row => rect.y + (row.y + check.size / 2) * r)
        const lone = (check.size / 2 + check.hitPad) * r
        rows.forEach((row, i) => {
            const up = i > 0 ? (centres[i] - centres[i - 1]) / 2 : i + 1 < rows.length ? (centres[i + 1] - centres[i]) / 2 : lone
            const down = i + 1 < rows.length ? (centres[i + 1] - centres[i]) / 2 : up
            hits.push({rect, row, cy: centres[i],
                x0: rect.x + check.x * r, x1: rect.x + (rect.panel.width - check.x) * r,
                y0: centres[i] - Math.max(up, minHalf), y1: centres[i] + Math.max(down, minHalf)})
        })
    }
    return hits
}
// TASK-1470: a click or a touch tap at realPos (world coordinates: the event mapped through the camera transform,
// getRealEventPos) in a checkbox row's hit area (backgroundHintHitRows; where two areas overlap, the row whose centre is
// nearer) flips the row's setting and saves it as the Settings menu does (a row with toggle(): that, TASK-1523; a
// disabled row is not hit: the click goes on as one elsewhere). The next frame shows it: the panel's canvas key holds
// the settings' state; the lit snapshots and the overlay composite (they hold the panel drawn with the sky) and the held
// still frame are dropped now, once. Returns whether a row was hit (the click is consumed).
function backgroundHintClick(realPos) {
    if (!backgroundHintsShown())
        return false
    let hit = null
    for (const area of backgroundHintHitRows()) {
        if (realPos.x < area.x0 || realPos.x > area.x1 || realPos.y < area.y0 || realPos.y > area.y1)
            continue
        if (!hit || Math.abs(realPos.y - area.cy) < Math.abs(realPos.y - hit.cy))
            hit = area
    }
    const row = hit && hit.row
    if (!row || !row.setting && !row.toggle || backgroundHintRowDisabled(row))
        return false
    if (row.toggle)
        row.toggle()
    else {
        otherSettings[row.setting] = !otherSettings[row.setting]
        if (typeof saveOtherSettings === 'function')
            saveOtherSettings()
    }
    ++backgroundHintState.toggles
    if (typeof grid !== 'undefined' && grid) {
        grid.releaseLitCanvases()
        grid.overlayComposite = undefined
        grid.dropHeldFrame()
    }
    return true
}
// The rects drawn last (null when none), the panel renders and row toggles (backgroundHintClick) so far and the rendered
// panels by panel and scale.
const backgroundHintState = {rects: null, renders: 0, toggles: 0, canvases: new Map()}

// The panel rendered at scale (device pixels a world unit) and its settings' state, kept for the last two keys.
function backgroundHintCanvas(panel, scale) {
    const cache = backgroundHintState.canvases
    const key = panel.name + ':' + (panel.checks || []).map(row =>
        (backgroundHintRowOn(row) ? 1 : 0) + (backgroundHintRowDisabled(row) ? 'd' : '')).join('') + scale
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
        const alpha = g.globalAlpha
        g.globalAlpha = alpha * style.alpha
        g.fillStyle = style.fill
        g.fill()
        g.globalAlpha = alpha
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
    // The checkbox rows: a plain plate, a white tick in it when the setting is on, the label right of it; a disabled
    // row's plate, tick and label at 0.4 alpha (as the Settings menu's disabled check box).
    const check = BACKGROUND_HINT_CHECK, size = check.size * k
    g.font = `${MENU_THEME.fontWeight} ${check.font * k}px ${family}`
    for (const row of panel.checks || []) {
        const x = check.x * k, y = row.y * k, disabled = backgroundHintRowDisabled(row)
        if (disabled) {
            g.save()
            g.globalAlpha = 0.4
        }
        plate(x, y, size, size, 0.12 * k, MENU_THEME.plain)
        if (backgroundHintRowOn(row)) {
            g.beginPath()
            g.moveTo(x + 0.22 * size, y + 0.52 * size)
            g.lineTo(x + 0.42 * size, y + 0.72 * size)
            g.lineTo(x + 0.78 * size, y + 0.3 * size)
            g.strokeStyle = '#ffffff'
            g.lineWidth = Math.max(2.5, 0.12 * size)
            g.lineCap = 'round'
            g.lineJoin = 'round'
            g.stroke()
        }
        g.fillStyle = MENU_THEME.text
        g.fillText(row.text, check.labelX * k, y + size / 2)
        if (disabled)
            g.restore()
    }
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
    let font = unit * 0.063
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
    font = unit * 0.045
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
// other hints and buttons (obstacles) is drawn. When none fits with the caption just above the arrow (a
// narrow screen whose bottom row of labels leaves no room between them), the search runs again with the
// caption lifted above whatever it overlaps.
function drawTutorialArrow(ctx, unit, gap, font, obstacles, label, box, drawLine) {
    const rect = nextTurnButton.rect
    const lineWidth = Math.max(2, unit * 0.006)
    const text = 'No moves left: end your turn'
    const captionWidth = ctx.measureText(text).width + font * 0.8
    const captionHeight = font * 1.5
    const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    const onScreen = a => a.x >= gap && a.y >= gap && a.x + a.width <= WIDTH - gap && a.y + a.height <= HEIGHT - gap
    const layOut = (size, angle, tipFraction, lift) => {
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
        for (let i = 0; lift && i < 4; i++) {
            const hit = obstacles.filter(o => overlaps(caption, o))
            if (!hit.length)
                break
            caption.y = Math.min(...hit.map(o => o.y)) - gap - captionHeight
        }
        const fits = [bounds, caption].every(part => onScreen(part) && !obstacles.some(o => overlaps(part, o))) &&
            !overlaps(bounds, caption)
        return {tip, tail, points, bounds, caption, size, angle, fits}
    }
    const base = Math.max(rect.width, unit * 0.16)
    let arrow = null
    search:
    for (const lift of [false, true])
        for (const scale of [1, 0.85, 0.7, 0.55, 0.4])
            for (const degrees of [40, 30, 20, 10, 0])
                for (const tipFraction of [0.35, 0.5, 0.65, 0.8]) {
                    arrow = layOut(base * scale, degrees * Math.PI / 180, tipFraction, lift)
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

// TASK-1554: the interface (HUD buttons, timer, panels, hints) is drawn into a cached canvas of the main canvas's size and
// redrawn only when its content changes; a frame draws only the cache's non-transparent parts, its bounding boxes, onto
// the main canvas (a few drawImages instead of the interface's 8-19 calls; a panned frame no longer rasterizes its texts
// and paths again). Every frame still runs the interface's drawing code (the panels' layouts and hit boxes stay current),
// but on a recording context (InterfaceRecorder, the overlays' CanvasCallRecorder with bounds for texts and shadows): when
// its calls, arguments and starting state repeat the cached drawing's, nothing is drawn but the boxes. Content is anything
// the calls draw: a selection, hover, HUD value, panel or resize changes them. Drawn directly as before: a recording the
// cache cannot hold the same (a blend other than source-over, clearRect, putImageData or a pixel read; a drawing whose
// bounds are unknown: a Path2D, a filter), and a recording that changes two frames in a row (an animation: no cache
// redrawn every frame).
class InterfaceLayer {
    static enabled = true
    constructor() {
        this.recorder = null
        this.canvas = null
        this.cached = null       // the recording the cache canvas holds
        this.previous = null     // the last frame's recording
        this.rects = null        // the cache's boxes (device px), cleared before it is redrawn
        this.changedBefore = false
        this.stats = {frames: 0, hits: 0, redraws: 0, direct: 0, blitMegapixels: 0, changes: {}, directWhy: {}}
    }
    // Whether ctx can be recorded and cached (a real 2D context of a canvas; the tests' stand-in contexts are drawn directly).
    static usable(ctx) {
        return InterfaceLayer.enabled && typeof Proxy === 'function' && typeof CanvasCallRecorder === 'function' &&
            typeof CanvasRenderingContext2D === 'function' && ctx instanceof CanvasRenderingContext2D && !!ctx.canvas &&
            ctx.canvas.width > 0 && ctx.canvas.height > 0
    }
    // Draws the interface (draw(ctx): its drawing code) on ctx.
    draw(ctx, draw) {
        if (!InterfaceLayer.usable(ctx)) {
            this.mode = 'off'
            draw(ctx)
            return
        }
        const recorder = this.recorder ||= new InterfaceRecorder()
        const W = ctx.canvas.width, H = ctx.canvas.height
        // Measuring code (Text.width) sets the real context's font while the calls are recorded: kept from the frame's.
        // The interface draws in device pixels (drawInterfaceTo sets the identity transform): recorded from it, so the
        // camera's transform does not make every panned frame's recording new.
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        let recording
        try {
            recorder.begin(ctx, [W, H])
            draw(recorder.context)
        } finally {
            recording = recorder.take()
            ctx.restore()
        }
        this.stats.frames++
        const previous = this.previous
        const same = !!previous && !previous.volatile && InterfaceRecorder.same(previous, recording)
        const changed = !same
        if (changed && previous) {
            // What made the recording new (the first call that differs), counted by kind: informational (stats.changes).
            const why = InterfaceRecorder.difference(previous, recording), changes = this.stats.changes ||= {}
            if (why in changes || Object.keys(changes).length < 40) changes[why] = (changes[why] || 0) + 1
        }
        this.previous = recording
        const direct = recording.uncacheable || recording.unbounded || (changed && this.changedBefore)
        this.changedBefore = changed
        if (direct) {
            const why = recording.uncacheable ? 'uncacheable' : recording.unbounded ? 'unbounded' : 'changed twice'
            this.stats.directWhy[why] = (this.stats.directWhy[why] || 0) + 1
            this.cached = null
            this.mode = 'direct'
            this.stats.direct++
            recorder.replayOn(ctx, recording)
            return
        }
        if (!(same && this.cached && this.cached.canvasKey === previous.canvasKey && this.canvasAlive())) {
            this.redraw(recording, W, H)
            this.mode = 'redraw'
            this.stats.redraws++
        }
        else {
            // The cached drawing repeats: kept as this frame's (its canvas versions are the same).
            recording.canvasKey = this.cached.canvasKey
            this.cached = recording
            this.mode = 'hit'
            this.stats.hits++
        }
        this.blit(ctx)
    }
    canvasAlive() {
        return !!this.canvas && !(typeof this.context.isContextLost === 'function' && this.context.isContextLost())
    }
    // Draws recording into the cache canvas (the old boxes cleared) and keeps its boxes.
    redraw(recording, W, H) {
        let canvas = this.canvas
        if (!canvas || !this.canvasAlive()) {
            canvas = this.canvas = document.createElement('canvas')
            this.context = canvas.getContext('2d')
            this.rects = null
            if (typeof canvas.addEventListener === 'function')
                canvas.addEventListener('contextlost', () => { this.cached = null })
        }
        const g = this.context
        // A change in a few drawing calls' arguments (a timer's text) redraws only the rectangles round their boxes
        // (InterfaceRecorder.dirtyRects): TASK-1561: the calls meeting them made whole on a scratch canvas of the cache's
        // size (the same pixels as a whole redraw there), the rectangles cleared and copied from it.
        InterfaceRecorder.fullWhy = !this.cached ? 'no cache' : canvas.width !== W || canvas.height !== H || !this.rects ? 'canvas' : undefined
        const dirty = this.cached && canvas.width === W && canvas.height === H && this.rects ?
            InterfaceRecorder.dirtyRects(this.cached, recording, W, H) : null
        // TASK-1561 (diagnostic): why a redraw is whole, by the first reason (stats.fullWhy, up to 40 kinds).
        if (!dirty) {
            const why = String(InterfaceRecorder.fullWhy).slice(0, 80), full = this.stats.fullWhy ||= {}
            if (why in full || Object.keys(full).length < 40) full[why] = (full[why] || 0) + 1
        }
        if (dirty) {
            let scratch = this.scratch
            if (!scratch || (typeof this.scratchContext.isContextLost === 'function' && this.scratchContext.isContextLost())) {
                scratch = this.scratch = document.createElement('canvas')
                this.scratchContext = scratch.getContext('2d')
            }
            if (scratch.width !== W || scratch.height !== H) {
                scratch.width = W
                scratch.height = H
            }
            const s = this.scratchContext
            s.setTransform(1, 0, 0, 1, 0, 0)
            for (const r of dirty.rects) s.clearRect(r.x, r.y, r.w, r.h)
            s.save()
            applyCanvasState(s, recording.state)
            s.beginPath()
            this.recorder.replayOn(s, {calls: dirty.calls, labels: recording.labels})
            s.restore()
            g.save()
            g.setTransform(1, 0, 0, 1, 0, 0)
            g.globalAlpha = 1
            g.globalCompositeOperation = 'source-over'
            if ('filter' in g) g.filter = 'none'
            g.shadowBlur = 0
            g.shadowOffsetX = g.shadowOffsetY = 0
            g.shadowColor = 'rgba(0, 0, 0, 0)'
            for (const r of dirty.rects) {
                g.clearRect(r.x, r.y, r.w, r.h)
                g.drawImage(scratch, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h)
            }
            g.restore()
            this.stats.partial = (this.stats.partial || 0) + 1
            recording.canvasKey = this.cached.canvasKey + 1
            this.cached = recording
            this.rects = recording.rects(W, H)
            return
        }
        if (canvas.width !== W || canvas.height !== H) {
            canvas.width = W
            canvas.height = H
            this.rects = null
        }
        else {
            g.setTransform(1, 0, 0, 1, 0, 0)
            if (this.rects)
                for (const r of this.rects) g.clearRect(r.x, r.y, r.w, r.h)
            else
                g.clearRect(0, 0, W, H)
        }
        g.save()
        applyCanvasState(g, recording.state)
        g.beginPath()
        this.recorder.replayOn(g, recording)
        g.restore()
        recording.canvasKey = (this.cached?.canvasKey || 0) + 1
        this.cached = recording
        this.rects = recording.rects(W, H)
    }
    // The cache's boxes drawn on ctx, at the same device pixels.
    blit(ctx) {
        const rects = this.rects
        if (!rects.length)
            return
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
        if ('filter' in ctx) ctx.filter = 'none'
        ctx.shadowBlur = 0
        ctx.shadowOffsetX = ctx.shadowOffsetY = 0
        ctx.shadowColor = 'rgba(0, 0, 0, 0)'
        for (const r of rects) {
            ctx.drawImage(this.canvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h)
            this.stats.blitMegapixels += r.w * r.h / 1e6
        }
        ctx.restore()
    }
}
const interfaceLayer = new InterfaceLayer()

function drawInterface() {
    interfaceLayer.draw(interfaceCtx, drawInterfaceTo)
    // The debug mode's FPS counter, the interface's last drawing, changes every few frames: drawn over the cached
    // interface directly (none in a replay, as before).
    if (typeof replayViewer != 'undefined' && replayViewer)
        return
    interfaceCtx.save()
    interfaceCtx.setTransform(1, 0, 0, 1, 0, 0)
    drawDebugFps(interfaceCtx)
    interfaceCtx.restore()
}

function drawInterfaceTo(interfaceCtx) {
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
    interfaceCtx.restore()
}

function drawAll() {
    // TASK-1517: a zoom gesture whose raster is still made keeps the frame on screen (Grid.holdZoomFrame).
    if (typeof grid !== 'undefined' && grid?.holdZoomFrame?.())
        return
    // TASK-1518: a new board's first frame is held while its lit tiles are built (Grid.holdStartFrame).
    if (typeof grid !== 'undefined' && grid?.holdStartFrame?.())
        return
    // TASK-1519: a turn playback's start is held while its board's surface cache is finished (turnPlaybackView.holdFrame).
    if (typeof turnPlaybackView !== 'undefined' && turnPlaybackView.holdFrame())
        return
    // TASK-1520: a frame drawn directly for want of the surface cache is kept on screen while the cache is built (Grid.holdCacheFrame).
    if (typeof grid !== 'undefined' && grid?.holdCacheFrame?.())
        return
    drawMain()
    drawInterface()
        //mainCtx.clearRect(-basis.offset.x, -basis.offset.y * 2, width, height)

    //grid.draw(mainCtx)

    //border.draw()

    //entityInterface.draw()
    //townInterface.draw()


}
