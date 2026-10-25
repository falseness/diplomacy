function drawMain() {
    // An opaque sky raster covers the whole canvas, so it needs no clear under it; the board's lit
    // images may hide most of the canvas (Grid.frameCover): then the sky is drawn only where they
    // leave it open.
    const cover = grid.frameCover(mainCtx)
    if (!cover) {
        if (!atmosphericBackground.opaqueOver(mainCtx))
            mainCtx.clearRect(canvas.offset.x, canvas.offset.y,
                width, height)
        atmosphericBackground.draw(mainCtx)
    }
    else if (cover.open.length) {
        mainCtx.save()
        clipToDeviceRects(mainCtx, cover.open)
        atmosphericBackground.draw(mainCtx)
        mainCtx.restore()
    }

    // Border.draw sets round joins/caps and never restores them, so every frame after the first strokes
    // text and bars with them. Start each frame in that state, so the first frame draws the same.
    mainCtx.lineJoin = 'round'
    mainCtx.lineCap = 'round'
    grid.draw(mainCtx)
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
// in drawTutorialHints.arrow (null when none is drawn).
function drawTutorialHints(ctx) {
    drawTutorialHints.boxes = []
    drawTutorialHints.arrow = null
    if (!gameSettings.tutorial || gameSettings.tutorial.id !== 'tutorial-0')
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
    if (gameSettings.tutorial)
        tutorialResultInterface.draw(interfaceCtx)
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
