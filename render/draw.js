function drawAll() {
    ctx.clearRect(-basis.offset.x, -basis.offset.y * 2, width, height)

    grid.draw()

    border.draw()

    townInterface.draw()

    nextTurnButton.draw()
        //hexag.draw()
}