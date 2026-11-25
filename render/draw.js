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
    // A zoom gesture's frame: the board of the frame before it, scaled (TASK-1374); TASK-1562: from the unit sectors of the
    // levels kept (Grid.drawZoomSectors).
    if (grid.drawZoomSectors(mainCtx) || grid.drawZoomRaster(mainCtx)) {
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
// switches tutorials (TutorialManager.switching). TASK-1679: until red's first unit selection in the game
// only the 'click to control' hint to a red unit is drawn (drawTutorialClickHint; TASK-1681 M1 spotlight style).
function drawTutorialHints(ctx) {
    drawTutorialHints.boxes = []
    drawTutorialHints.texts = []
    drawTutorialHints.arrow = null
    drawTutorialHints.paint = null
    if (!gameSettings.tutorial || gameSettings.tutorial.id !== 'tutorial-0' || TutorialManager.switching)
        return
    const unit = Math.min(WIDTH, HEIGHT)
    const gap = unit * 0.012
    // TASK-1682: the hints in the M1 style, no boxes: a box keeps its layout (drawTutorialHints.boxes) and paints only a
    // soft dark shade under its text (tutorialHintShade); drawLine sets the text in the menu title font (tutorialHintText).
    const box = (name, x, y, width, height, lines) => {
        tutorialHintShade(ctx, x, y, width, height, Math.min(width, height) * 0.5)
        drawTutorialHints.boxes.push({name, x, y, width, height, lines})
    }
    // Each line is a list of [text, colour] parts, drawn centred on x at the Arial layout's size (ctx.font) and fitted to
    // the width the Arial text took ('white' parts get the cream-to-gold fill, other colours are kept).
    const drawLine = (parts, x, y) => tutorialHintText(ctx, parts, x, y)
    ctx.save()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'

    // TASK-1679: until red's first unit selection in this game (TutorialManager.clickHint, set by
    // TutorialManager.start) only the 'click to control' hint to a red unit is drawn. TASK-1681: laid out here, painted
    // by drawInterfaceTo after the HUD (drawTutorialHints.paint) so its darkness covers the HUD too.
    if (TutorialManager.clickHint) {
        const selected = gameEvent.selected
        if (selected && selected.isUnit && selected.playerColor === TUTORIAL_HUMAN_SLOT)
            TutorialManager.clickHint = false
        else {
            if (whooseTurn === TUTORIAL_HUMAN_SLOT && !gameEvent.waitingMode && !tutorialResultInterface.visible)
                drawTutorialHints.paint = drawTutorialClickHint(ctx, unit, gap)
            ctx.restore()
            return
        }
    }

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

// TASK-1682: tutorial 0's hints after the click in the M1 style of the click hint (TASK-1681): the menu title font 800 with a
// cream-to-gold fill (red and blue words keep their player colours), a dark brown outline and a gold glow, over a soft dark
// shade instead of a box; the next-turn arrow and its ring gold with the same glow.
const TUTORIAL_HINT_STYLE = {
    gold: 'rgb(255, 210, 63)', glow: 'rgb(255, 207, 58)', outline: 'rgb(36, 19, 0)', top: 'rgb(255, 251, 230)', bottom: 'rgb(255, 194, 26)',
    // In font sizes (F): the outline width, the glow blur; the menu font's size vs the Arial layout size (fitted down to the
    // Arial text's width); the shade's colour, spread beyond its box and blur.
    stroke: 5 / 70, glowBlur: 9 / 70, scale: 1.2, shade: 'rgba(3, 2, 8, 0.96)', shadeSpread: 0.5, shadeBlur: 0.7,
}
// A soft dark shade round the box x, y, width, height (sized in ctx.font's size F): only the blurred shadow of a rounded rect drawn off screen, clipped off
// the HUD buttons so they keep their look.
function tutorialHintShade(ctx, x, y, width, height, radius) {
    const S = TUTORIAL_HINT_STYLE, F = parseFloat(/([\d.]+)px/.exec(ctx.font)[1]), spread = S.shadeSpread * F
    const off = WIDTH + width + 4 * F + Math.max(0, x)
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, WIDTH, HEIGHT)
    for (const button of [backToMenuButton, iButton, undoButton, nextTurnButton]) {
        const r = button.rect
        ctx.rect(r.x, r.y, r.width, r.height)
    }
    ctx.clip('evenodd')
    ctx.shadowColor = S.shade
    ctx.shadowBlur = S.shadeBlur * F
    ctx.shadowOffsetX = off
    ctx.fillStyle = 'black'
    roundedRectPath(ctx, x - spread - off, y - spread, width + 2 * spread, height + 2 * spread, radius + spread)
    ctx.fill()
    ctx.restore()
}
// One hint line (a list of [text, colour] parts) centred on x, y (middle baseline): the menu title font at TUTORIAL_HINT_STYLE.scale
// times ctx.font's size, made smaller when wider than the parts in ctx.font; outline with the gold glow, then the fill. Each part
// drawn is kept in drawTutorialHints.texts (text, x, y, font, fill, outline width, glow blur).
function tutorialHintText(ctx, parts, x, y) {
    const S = TUTORIAL_HINT_STYLE
    const layoutWidth = parts.reduce((sum, [text]) => sum + ctx.measureText(text).width, 0)
    const layoutSize = parseFloat(/([\d.]+)px/.exec(ctx.font)[1])
    ctx.save()
    let F = layoutSize * S.scale
    ctx.font = clickHintFont(F)
    const width = () => parts.reduce((sum, [text]) => sum + ctx.measureText(text).width, 0)
    const w = width()
    if (w > layoutWidth) {
        F *= layoutWidth / w
        ctx.font = clickHintFont(F)
    }
    const widths = parts.map(([text]) => ctx.measureText(text).width)
    const metrics = ctx.measureText(parts.map(([text]) => text).join(''))
    const ascent = metrics.actualBoundingBoxAscent || F * 0.35, descent = metrics.actualBoundingBoxDescent || F * 0.35
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.lineWidth = S.stroke * F
    ctx.strokeStyle = S.outline
    const left = x - widths.reduce((a, b) => a + b, 0) / 2
    ctx.shadowColor = S.glow
    ctx.shadowBlur = S.glowBlur * F
    let at = left
    parts.forEach(([text], i) => {
        ctx.strokeText(text, at, y)
        at += widths[i]
    })
    ctx.shadowColor = 'rgba(0, 0, 0, 0)'
    ctx.shadowBlur = 0
    const fill = ctx.createLinearGradient(0, y - ascent, 0, y + descent)
    fill.addColorStop(0, S.top)
    fill.addColorStop(1, S.bottom)
    at = left
    parts.forEach(([text, color], i) => {
        ctx.fillStyle = color === 'white' ? fill : color
        ctx.fillText(text, at, y)
        if (drawTutorialHints.texts)
            drawTutorialHints.texts.push({text, x: at, y, font: ctx.font, fill: color === 'white' ? [S.top, S.bottom] : color,
                stroke: S.stroke * F, glow: S.glowBlur * F})
        at += widths[i]
    })
    ctx.restore()
}

// A big arrow (TASK-1682: gold, dark brown outline, gold glow) from up-left whose tip touches nextTurnButton.rect's
// left border, a gold glow ring around the button and a caption above the arrow's tail.
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
    // TASK-1682: the glow ring and the arrow in the M1 gold with its gold glow; the arrow outlined in dark brown.
    const ring = {x: rect.centerX, y: rect.centerY, radius: rect.width * 0.55}
    ctx.strokeStyle = TUTORIAL_HINT_STYLE.gold
    ctx.shadowColor = TUTORIAL_HINT_STYLE.glow
    ctx.shadowBlur = unit * 0.03
    ctx.lineWidth = Math.max(2, unit * 0.006)
    ctx.beginPath()
    ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.stroke()
    ctx.beginPath()
    arrow.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))
    ctx.closePath()
    ctx.lineJoin = 'round'
    ctx.lineWidth = lineWidth
    ctx.strokeStyle = TUTORIAL_HINT_STYLE.outline
    ctx.shadowBlur = unit * 0.025
    ctx.stroke()
    ctx.shadowColor = 'transparent'
    ctx.fillStyle = TUTORIAL_HINT_STYLE.gold
    ctx.fill()
    ctx.stroke()
    ctx.restore()
    // The caption: the hint text style, no box.
    const {x, y, width, height} = arrow.caption
    box('arrowCaption', x, y, width, height, [[{text, color: 'white'}]])
    drawLine([[text, 'white']], x + width / 2, y + height / 2)
    drawTutorialHints.arrow = {tip: arrow.tip, tail: arrow.tail, points: arrow.points, bounds: arrow.bounds,
        caption: arrow.caption, ring, size: arrow.size, angle: arrow.angle, fits: arrow.fits, target: {
            x: rect.x, y: rect.y, width: rect.width, height: rect.height}}
}

// TASK-1681: tutorial 0's first hint in the M1 style (the 'click to control' spotlight): the whole screen darkened except
// a soft light beam falling straight down from the top screen edge onto the hex of red's unit nearest the screen centre
// (kept while its hex stays on screen) and the hex itself; warm dust specks drifting down the beam, a warm light pool
// and a pulsing glowing gold hex outline; the caption 'Click to' / 'Control' in the menu title font (cream-to-gold fill,
// dark brown outline, gold glow) right of the unit with a gold arrow into the hex, flipped to the left or below the unit
// when it would leave the screen or cover a HUD button (smaller sizes tried last). drawTutorialClickHint lays it out
// (drawTutorialHints.arrow, kind 'click'; box 'clickCaption') and returns its painter, run by drawInterfaceTo after the
// HUD so the darkness covers it. The darkness, beam light, pool, caption and arrow are built into one reused offscreen
// canvas (clickHintOverlay) only when the screen size, camera, target unit, layout or font state changes; a frame
// draws it (fading in over CLICK_HINT.fadeMs of the hint's own clock), the dust and the outline.
const CLICK_HINT = {
    fadeMs: 400, pulseMs: 1200, darkness: 'rgba(3, 3, 10, 0.86)',
    // In hex radii (r): the beam's half width at the top screen edge and at the hex centre, the mask's blur
    // (beam / hex rim), the light pool, the gold outline, the arrow tip's distance beyond the hex.
    beamTop: 26 / 60, beamBottom: 0.95, beamBlur: 14 / 60, rimBlur: 6 / 60, rim: 6 / 60,
    pool: {dy: 20 / 60, rx: 80 / 60, ry: 0.55, blur: 14 / 60}, outline: {r: 62 / 60, width: 5 / 60, glow: 16 / 60},
    tipGap: 12 / 60,
    // In caption font sizes (F): the arrow's length, shaft width, head length and half height, the gap to the caption,
    // the text outline width and glow, the line height.
    arrow: {length: 104 / 70, shaft: 8 / 70, head: 30 / 70, halfHead: 19 / 70, gap: 24 / 70},
    text: {stroke: 5 / 70, glow: 16 / 70, line: 1, spacing: 2 / 70}, font: 0.078, dust: 38,
    lines: ['Click to', 'Control'],
}
let clickHintOverlay = null
function clickHintFont(size) {
    return '800 ' + size + 'px ' + MENU_TITLE_FONT_FAMILY
}
function clickHintFontLoaded() {
    try {
        return typeof document !== 'undefined' && !!document.fonts && typeof document.fonts.check === 'function' &&
            document.fonts.check('800 40px "Alegreya Sans SC"')
    } catch (error) {
        return false
    }
}
function clickHintHexPath(ctx, x, y, r) {
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3
        i ? ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)) : ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a))
    }
    ctx.closePath()
}
function drawTutorialClickHint(ctx, unit, gap) {
    const units = players[TUTORIAL_HUMAN_SLOT].units.filter(u => !u.killed && u.coord)
    if (!units.length)
        return null
    const hexOf = u => {
        const t = biasToTransition(u.coord.x, u.coord.y)
        const x = (t.x * basis.offset.x - canvas.offset.x) * canvas.scale
        const y = (t.y * basis.offset.y - canvas.offset.y) * canvas.scale
        const r = basis.r * canvas.scale, apothem = r * Math.sqrt(3) / 2
        return {unit: u, x, y, r, apothem, bounds: {x: x - r, y: y - apothem, width: 2 * r, height: 2 * apothem}}
    }
    // The unit pointed at last frame while its hex stays on screen, else the one nearest the screen centre.
    const distance = h => Math.hypot(h.x - WIDTH / 2, h.y - HEIGHT / 2)
    const kept = units.includes(TutorialManager.clickHintUnit) && hexOf(TutorialManager.clickHintUnit)
    const hex = kept && kept.bounds.x >= 0 && kept.bounds.y >= 0 && kept.bounds.x + kept.bounds.width <= WIDTH &&
        kept.bounds.y + kept.bounds.height <= HEIGHT ? kept :
        units.map(hexOf).reduce((best, h) => distance(h) < distance(best) ? h : best)
    TutorialManager.clickHintUnit = hex.unit
    const fontLoaded = clickHintFontLoaded()
    const buttons = [backToMenuButton, iButton, undoButton, nextTurnButton].map(button => button.rect)
    const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    const onScreen = a => a.x >= gap && a.y >= gap && a.x + a.width <= WIDTH - gap && a.y + a.height <= HEIGHT - gap
    const C = CLICK_HINT
    // The caption at font size F: its line widths and the box round the drawn glyphs (outline included).
    const measure = F => {
        ctx.save()
        ctx.font = clickHintFont(F)
        if ('letterSpacing' in ctx)
            ctx.letterSpacing = C.text.spacing * F + 'px'
        const metrics = C.lines.map(line => ctx.measureText(line))
        ctx.restore()
        const ascent = Math.max(...metrics.map(m => m.actualBoundingBoxAscent || F * 0.7))
        const descent = Math.max(...metrics.map(m => m.actualBoundingBoxDescent || F * 0.05))
        const widths = metrics.map(m => m.width)
        const pad = C.text.stroke * F / 2
        return {widths, width: Math.max(...widths) + 2 * pad, height: ascent + C.text.line * F * (C.lines.length - 1) + descent + 2 * pad,
            ascent, pad}
    }
    // A layout: 'right' / 'left' (a horizontal arrow at the hex centre's height, the caption beyond its tail, centred on
    // it) or 'below' (an arrow pointing up into the hex's bottom edge, the caption centred under its tail).
    const layOut = (F, side, obstacles) => {
        const m = measure(F), A = C.arrow
        const length = A.length * F, shaft = A.shaft * F, head = A.head * F, halfHead = A.halfHead * F
        const angle = side === 'right' ? Math.PI : side === 'left' ? 0 : -Math.PI / 2
        const cos = Math.cos(angle), sin = Math.sin(angle)
        const reach = side === 'below' ? hex.apothem : hex.r
        const tip = {x: hex.x - cos * (reach + C.tipGap * hex.r), y: hex.y - sin * (reach + C.tipGap * hex.r)}
        const tail = {x: tip.x - cos * length, y: tip.y - sin * length}
        const points = [[0, 0], [-head, halfHead], [-head, shaft / 2], [-length, shaft / 2], [-length, -shaft / 2],
            [-head, -shaft / 2], [-head, -halfHead]]
            .map(([x, y]) => ({x: tip.x + x * cos - y * sin, y: tip.y + x * sin + y * cos}))
        const xs = points.map(p => p.x), ys = points.map(p => p.y)
        const bounds = {x: Math.min(...xs) - shaft / 2, y: Math.min(...ys) - shaft / 2}
        bounds.width = Math.max(...xs) + shaft / 2 - bounds.x
        bounds.height = Math.max(...ys) + shaft / 2 - bounds.y
        const g = A.gap * F
        const caption = {width: m.width, height: m.height}
        if (side === 'below') {
            caption.x = tail.x - m.width / 2
            caption.y = tail.y + g
        }
        else {
            caption.x = side === 'right' ? tail.x + g : tail.x - g - m.width
            caption.y = tip.y - m.height / 2
        }
        const fits = [bounds, caption].every(part => onScreen(part) && !obstacles.some(o => overlaps(part, o))) &&
            !overlaps(caption, hex.bounds) && !overlaps(caption, bounds)
        return {side, F, measure: m, tip, tail, points, bounds, caption, angle, lineWidth: shaft, fits}
    }
    const base = unit * C.font
    let layout = null
    search:
    for (const obstacles of [buttons, []])
        for (const scale of [1, 0.85, 0.7, 0.55, 0.4])
            for (const side of ['right', 'left', 'below']) {
                const candidate = layOut(base * scale, side, obstacles)
                layout = layout || candidate
                if (candidate.fits) {
                    layout = candidate
                    break search
                }
            }
    const beam = {topY: 0, topLeft: hex.x - C.beamTop * hex.r, topRight: hex.x + C.beamTop * hex.r,
        bottomY: hex.y, bottomLeft: hex.x - C.beamBottom * hex.r, bottomRight: hex.x + C.beamBottom * hex.r, centreX: hex.x}
    const key = [WIDTH, HEIGHT, hex.x, hex.y, hex.r, layout.side, layout.F, fontLoaded].join(',')
    const {x, y, width, height} = layout.caption
    drawTutorialHints.boxes.push({name: 'clickCaption', x, y, width, height, lines: C.lines.map(text => [{text, color: 'gold'}])})
    drawTutorialHints.arrow = {kind: 'click', tip: layout.tip, tail: layout.tail, points: layout.points,
        bounds: layout.bounds, caption: layout.caption, size: layout.F, angle: layout.angle, fits: layout.fits,
        lineWidth: layout.lineWidth, side: layout.side, font: clickHintFont(layout.F), fontLoaded, beam,
        target: {coord: {x: hex.unit.coord.x, y: hex.unit.coord.y}, x: hex.x, y: hex.y, r: hex.r,
            apothem: hex.apothem, bounds: hex.bounds}}
    return paintCtx => paintTutorialClickHint(paintCtx, hex, layout, beam, key)
}
// The cached overlay: darkness with the beam and hex cut out, the beam light, the light pool, the arrow and the caption.
function buildClickHintOverlay(hex, layout, beam, key) {
    const C = CLICK_HINT
    let overlay = clickHintOverlay
    if (!overlay) {
        const canvas = document.createElement('canvas')
        overlay = clickHintOverlay = {canvas, ctx: canvas.getContext('2d'), key: null, builds: 0}
    }
    const {canvas, ctx} = overlay
    if (canvas.width !== WIDTH || canvas.height !== HEIGHT) {
        canvas.width = WIDTH
        canvas.height = HEIGHT
    }
    const r = hex.r
    const filters = 'filter' in ctx
    const blur = px => { if (filters) ctx.filter = px > 0 ? 'blur(' + px + 'px)' : 'none' }
    const beamPath = () => {
        ctx.beginPath()
        ctx.moveTo(beam.topLeft, beam.topY)
        ctx.lineTo(beam.topRight, beam.topY)
        ctx.lineTo(beam.bottomRight, beam.bottomY)
        ctx.lineTo(beam.bottomLeft, beam.bottomY)
        ctx.closePath()
    }
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, WIDTH, HEIGHT)
    ctx.fillStyle = C.darkness
    ctx.fillRect(0, 0, WIDTH, HEIGHT)
    // The mask: the beam lightens the darkness to 0.45 of it (soft edge), the hex is cut out (a soft rim, then solid).
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    blur(C.beamBlur * r)
    beamPath()
    ctx.fill()
    ctx.fillStyle = 'black'
    blur(C.rimBlur * r)
    clickHintHexPath(ctx, hex.x, hex.y, r * (1 + C.rim))
    ctx.fill()
    blur(0)
    clickHintHexPath(ctx, hex.x, hex.y, r)
    ctx.fill()
    // The beam's light, fading in towards the hex, and the warm pool on the hex.
    ctx.globalCompositeOperation = 'source-over'
    const light = ctx.createLinearGradient(0, beam.topY, 0, beam.bottomY)
    light.addColorStop(0, 'rgba(255, 243, 196, 0.05)')
    light.addColorStop(1, 'rgba(255, 243, 196, 0.5)')
    ctx.fillStyle = light
    blur(C.rimBlur * r)
    beamPath()
    ctx.fill()
    blur(C.pool.blur * r)
    ctx.fillStyle = 'rgba(255, 240, 176, 0.28)'
    ctx.beginPath()
    ctx.ellipse(hex.x, hex.y + C.pool.dy * r, C.pool.rx * r, C.pool.ry * r, 0, 0, Math.PI * 2)
    ctx.fill()
    blur(0)
    // The arrow: a round-capped shaft and a head, gold with a gold glow.
    const F = layout.F, A = C.arrow, cos = Math.cos(layout.angle), sin = Math.sin(layout.angle)
    ctx.shadowColor = 'rgb(255, 207, 58)'
    ctx.shadowBlur = C.text.glow * F
    ctx.strokeStyle = ctx.fillStyle = 'rgb(255, 210, 63)'
    ctx.lineWidth = A.shaft * F
    ctx.lineCap = 'round'
    const shaftEnd = A.head * F * 0.6
    ctx.beginPath()
    ctx.moveTo(layout.tail.x, layout.tail.y)
    ctx.lineTo(layout.tip.x - cos * shaftEnd, layout.tip.y - sin * shaftEnd)
    ctx.stroke()
    ctx.beginPath()
    const [t, h1, , , , , h2] = layout.points
    ctx.moveTo(t.x, t.y)
    ctx.lineTo(h1.x, h1.y)
    ctx.lineTo(h2.x, h2.y)
    ctx.closePath()
    ctx.fill()
    // The caption: outlined in dark brown with the gold glow, then the cream-to-gold fill, each line its own gradient.
    const m = layout.measure
    ctx.font = clickHintFont(F)
    if ('letterSpacing' in ctx)
        ctx.letterSpacing = C.text.spacing * F + 'px'
    overlay.font = ctx.font
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    ctx.lineJoin = 'round'
    ctx.lineWidth = C.text.stroke * F
    ctx.strokeStyle = 'rgb(36, 19, 0)'
    const box = layout.caption
    C.lines.forEach((line, i) => {
        const baseline = box.y + m.pad + m.ascent + i * C.text.line * F
        const lineX = layout.side === 'right' ? box.x + m.pad : layout.side === 'left' ? box.x + box.width - m.pad - m.widths[i] :
            box.x + (box.width - m.widths[i]) / 2
        ctx.shadowColor = 'rgb(255, 207, 58)'
        ctx.shadowBlur = C.text.glow * F
        ctx.strokeText(line, lineX, baseline)
        ctx.shadowColor = 'rgba(0, 0, 0, 0)'
        ctx.shadowBlur = 0
        const fill = ctx.createLinearGradient(0, baseline - m.ascent, 0, baseline)
        fill.addColorStop(0, 'rgb(255, 251, 230)')
        fill.addColorStop(1, 'rgb(255, 194, 26)')
        ctx.fillStyle = fill
        ctx.fillText(line, lineX, baseline)
    })
    ctx.restore()
    overlay.key = key
    overlay.builds++
    overlay.captionFont = clickHintFont(F)
}
// A frame of the click hint: the overlay (fading in), the dust specks drifting down the beam, the pulsing gold outline.
function paintTutorialClickHint(ctx, hex, layout, beam, key) {
    const C = CLICK_HINT
    // The hint's clock runs from its first painted frame, at most 50 ms a frame: a long frame (the game's first frames
    // build its caches) does not skip the fade-in.
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const clock = TutorialManager.clickHintClock ||= {last: now, elapsed: 0}
    clock.elapsed += Math.max(0, Math.min(50, now - clock.last))
    clock.last = now
    const elapsed = clock.elapsed
    const fade = Math.max(0, Math.min(1, elapsed / C.fadeMs))
    if (!clickHintOverlay || clickHintOverlay.key !== key || clickHintOverlay.canvas.width !== WIDTH ||
        clickHintOverlay.canvas.height !== HEIGHT)
        buildClickHintOverlay(hex, layout, beam, key)
    const r = hex.r
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = fade
    ctx.drawImage(clickHintOverlay.canvas, 0, 0)
    // Dust: seeded specks, each sliding down the beam at its own speed, fading in at the top and out at the hex.
    const specks = paintTutorialClickHint.specks ||= (() => {
        let seed = 1681
        const random = () => (seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296
        return Array.from({length: C.dust}, () => ({t: random(), u: random() * 2 - 1, size: 0.017 + random() * 0.027,
            alpha: 0.25 + random() * 0.55, speed: 1 / (7000 + random() * 7000)}))
    })()
    ctx.fillStyle = 'rgb(255, 246, 208)'
    for (const s of specks) {
        const t = (s.t + elapsed * s.speed) % 1
        const half = (beam.topRight - beam.topLeft) / 2 + ((beam.bottomRight - beam.bottomLeft) - (beam.topRight - beam.topLeft)) / 2 * t
        const x = beam.centreX + s.u * half * 0.9, y = beam.topY + (beam.bottomY - beam.topY) * t
        ctx.globalAlpha = fade * s.alpha * Math.min(1, t * 8, (1 - t) * 8)
        ctx.beginPath()
        ctx.arc(x, y, Math.max(0.6, s.size * r), 0, Math.PI * 2)
        ctx.fill()
    }
    // The gold outline, its glow and brightness pulsing once per C.pulseMs.
    const pulse = 0.5 - 0.5 * Math.cos(elapsed / C.pulseMs * Math.PI * 2)
    ctx.globalAlpha = fade * (0.75 + 0.25 * pulse)
    ctx.strokeStyle = 'rgb(255, 210, 63)'
    ctx.shadowColor = 'rgb(255, 207, 58)'
    ctx.shadowBlur = C.outline.glow * r * (0.6 + 0.8 * pulse)
    ctx.lineWidth = C.outline.width * r
    ctx.lineJoin = 'round'
    clickHintHexPath(ctx, hex.x, hex.y, r * C.outline.r)
    ctx.stroke()
    ctx.restore()
    drawTutorialHints.clickPaint = {elapsed, fade, pulse, builds: clickHintOverlay.builds, key, font: clickHintOverlay.captionFont}
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
    // TASK-1704: a game entry's 'Loading…' over the frames before its board is settled (render/loadassets.js
    // drawGameEntryLoading), drawn over the cached interface, as the FPS counter.
    if (typeof drawGameEntryLoading === 'function')
        drawGameEntryLoading(interfaceCtx)
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
    // TASK-1681: tutorial 0's click hint darkens everything drawn so far (drawTutorialHints laid it out).
    if (typeof drawTutorialHints.paint === 'function')
        drawTutorialHints.paint(interfaceCtx)

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
    // TASK-1562: the frame's number (the work tasks between two frames may do: Grid.levelWorkLeft).
    if (typeof Grid !== 'undefined') {
        ++Grid.frameNo
        // TASK-1565: the frame's own draw calls counted (Grid.lastFrameCalls: the build-ahead budget).
        Grid.frameBegin?.()
    }
    // TASK-1517: a zoom gesture whose raster is still made keeps the frame on screen (Grid.holdZoomFrame).
    if (typeof grid !== 'undefined' && grid?.holdZoomFrame?.())
        return
    // TASK-1518: a new board's first frame is held while its lit tiles are built (Grid.holdStartFrame).
    if (typeof grid !== 'undefined' && grid?.holdStartFrame?.())
        return
    // TASK-1633: after it, a frame that would draw the board partial is held till its builds are done (Grid.holdLoadFrame).
    if (typeof grid !== 'undefined' && grid?.holdLoadFrame?.())
        return
    // TASK-1519: a turn playback's start is held while its board's surface cache is finished (turnPlaybackView.holdFrame).
    if (typeof turnPlaybackView !== 'undefined' && turnPlaybackView.holdFrame())
        return
    // TASK-1520: a frame drawn directly for want of the surface cache is kept on screen while the cache is built (Grid.holdCacheFrame).
    if (typeof grid !== 'undefined' && grid?.holdCacheFrame?.())
        return
    drawMain()
    drawInterface()
    if (typeof Grid !== 'undefined')
        Grid.frameFinish?.()
        //mainCtx.clearRect(-basis.offset.x, -basis.offset.y * 2, width, height)

    //grid.draw(mainCtx)

    //border.draw()

    //entityInterface.draw()
    //townInterface.draw()


}
