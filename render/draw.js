function drawMain() {
    mainCtx.clearRect(canvas.offset.x, canvas.offset.y,
        width, height)

    grid.draw(mainCtx)
}

function drawInterface() {
    interfaceCtx.clearRect(0, 0, width, height)

    nextTurnButton.draw(interfaceCtx)

    entityInterface.draw(interfaceCtx)
    barrackInterface.draw(interfaceCtx)
    townInterface.draw(interfaceCtx)

    backToMenuButton.draw(interfaceCtx)
    undoButton.draw(interfaceCtx)
    gameEvent.draw(interfaceCtx)

    timer.draw(interfaceCtx)

    nextTurnPauseInterface.draw(interfaceCtx)
    errorWindow.draw(interfaceCtx)
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