function drawMain() {
    mainCtx.clearRect(canvas.offset.x, canvas.offset.y,
        width, height)

    grid.draw(mainCtx)
    mainCtx.beginPath()

    mainCtx.strokeStyle = 'white'
    mainCtx.lineWidth = 0.001 * height

    mainCtx.closePath()

    attackBorder.draw(mainCtx)
    border.draw(mainCtx)
}

function drawInterface() {
    interfaceCtx.clearRect(0, 0, width, height)

    entityInterface.draw(interfaceCtx)
    townInterface.draw(interfaceCtx)

    nextTurnButton.draw(interfaceCtx)
    gameEvent.draw(interfaceCtx)
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