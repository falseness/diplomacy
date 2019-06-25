function drawAll() {
    ctx.clearRect(-basis.offset.x, -basis.offset.y * 2, width, height)

    grid.draw()

    border.draw()

    entityInterface.draw()
    townInterface.draw()

    nextTurnButton.draw()

    gameEvent.draw()
        //hexag.draw()
}