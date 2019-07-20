function gameLoop() {
    gameEvent.moveScreen()
    drawAll()
    requestAnimationFrame(gameLoop)
}