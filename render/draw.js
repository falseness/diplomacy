function drawMain() {
    mainCtx.clearRect(canvas.offset.x, canvas.offset.y,
        width, height)

    grid.draw(mainCtx)
}

// Read the saved shared result only: drawing must never resolve a game while
// an action (such as simultaneous flooding) is still in progress.
function drawCoopStatus(ctx, terminal = false) {
    if (!gameSettings.coop) return
    const result = gameSettings.coop.result
    if (terminal && !result) return
    const outcomes = {
        victory: 'Shared victory — all humans win',
        defeat: 'Shared defeat — all humans lose',
        draw: 'Shared draw — both sides eliminated'
    }
    const lines = terminal ? [outcomes[result], 'Round ' + gameRound] :
        ['Co-op: destroy all portals and demons', 'Round ' + gameRound]
    const size = Math.min(22 * window.devicePixelRatio, WIDTH / 27)
    ctx.save()
    ctx.font = size + 'px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const padding = size * 0.5
    const w = Math.max(...lines.map(line => ctx.measureText(line).width)) + padding * 2
    const y = terminal ? HEIGHT * 0.02 : HEIGHT * 0.12
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)'
    ctx.fillRect((WIDTH - w) / 2, y, w, size * 3)
    ctx.fillStyle = 'white'
    lines.forEach((line, i) => ctx.fillText(line, WIDTH / 2, y + padding + i * size * 1.2))
    ctx.restore()
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

function drawInterface() {
    interfaceCtx.save()
    interfaceCtx.setTransform(1, 0, 0, 1, 0, 0)

    nextTurnButton.draw(interfaceCtx)

    iButton.draw(interfaceCtx)

    drawCoopStatus(interfaceCtx)
    const lobbyText = onlineLobbyText()
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
    gameEvent.draw(interfaceCtx)

    timer.draw(interfaceCtx)

    nextTurnPauseInterface.draw(interfaceCtx)
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
