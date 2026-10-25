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
// buttons. The boxes drawn last are kept in drawTutorialHints.boxes.
function drawTutorialHints(ctx) {
    drawTutorialHints.boxes = []
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
    for (const [name, text, rect] of [['undo', 'Undo move', undoButton.rect],
                                      ['nextTurn', 'Next turn', nextTurnButton.rect]]) {
        const width = ctx.measureText(text).width + font * 0.8
        const height = font * 1.5
        const x = Math.max(gap, Math.min(WIDTH - gap - width, rect.centerX - width / 2))
        const y = Math.max(gap, rect.y - gap - height)
        box(name, x, y, width, height, [[{text, color: 'white'}]])
        drawLine([[text, 'white']], x + width / 2, y + height / 2)
    }
    ctx.restore()
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
