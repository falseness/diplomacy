function gameLoop() {
    gameEvent.moveScreen()
    drawAll()
    if (gameExit) {
        gameExit = false
        return
    }
    requestAnimationFrame(gameLoop)
}