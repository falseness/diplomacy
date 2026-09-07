function drawMain() {
    mainCtx.clearRect(canvas.offset.x, canvas.offset.y,
        width, height)

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

let renderedProductionInterface = undefined
let renderedEntityInterface = false
function drawEntityInterface() {
    if (!entityInterface.visible) {
        entityInterfaceCanvas.style.display = 'none'
        renderedEntityInterface = false
        return
    }

    if (renderedEntityInterface && !entityInterface.renderCacheDirty)
        return
    if (!entityInterface.createRenderCache())
        return

    const bounds = entityInterface.renderCacheBounds
    if (entityInterfaceCanvas.width != entityInterface.renderCache.width ||
        entityInterfaceCanvas.height != entityInterface.renderCache.height) {
        entityInterfaceCanvas.width = entityInterface.renderCache.width
        entityInterfaceCanvas.height = entityInterface.renderCache.height
    }
    entityInterfaceCanvas.style.left = bounds.left / window.devicePixelRatio + 'px'
    entityInterfaceCanvas.style.top = bounds.top / window.devicePixelRatio + 'px'
    entityInterfaceCanvas.style.width = bounds.width / window.devicePixelRatio + 'px'
    entityInterfaceCanvas.style.height = bounds.height / window.devicePixelRatio + 'px'

    entityInterfaceCtx.setTransform(1, 0, 0, 1, 0, 0)
    entityInterfaceCtx.clearRect(0, 0, entityInterfaceCanvas.width,
        entityInterfaceCanvas.height)
    entityInterfaceCtx.drawImage(entityInterface.renderCache, 0, 0)
    entityInterfaceCanvas.style.display = 'block'
    renderedEntityInterface = true
}
function drawProductionInterface() {
    const activeInterface = townInterface.visible ? townInterface :
        (barrackInterface.visible ? barrackInterface : undefined)
    if (!activeInterface) {
        productionInterfaceCanvas.style.display = 'none'
        renderedProductionInterface = undefined
        return
    }

    const cacheNeedsUpdate = renderedProductionInterface != activeInterface ||
        activeInterface.renderCacheDirty || !activeInterface.renderCache
    if (!cacheNeedsUpdate)
        return
    if (!activeInterface.createRenderCache())
        return

    const bounds = activeInterface.renderCacheBounds
    if (productionInterfaceCanvas.width != activeInterface.renderCache.width ||
        productionInterfaceCanvas.height != activeInterface.renderCache.height) {
        productionInterfaceCanvas.width = activeInterface.renderCache.width
        productionInterfaceCanvas.height = activeInterface.renderCache.height
    }
    productionInterfaceCanvas.style.left = bounds.left / window.devicePixelRatio + 'px'
    productionInterfaceCanvas.style.top = bounds.top / window.devicePixelRatio + 'px'
    productionInterfaceCanvas.style.width = bounds.width / window.devicePixelRatio + 'px'
    productionInterfaceCanvas.style.height = bounds.height / window.devicePixelRatio + 'px'

    productionInterfaceCtx.setTransform(1, 0, 0, 1, 0, 0)
    productionInterfaceCtx.clearRect(0, 0, productionInterfaceCanvas.width,
        productionInterfaceCanvas.height)
    productionInterfaceCtx.drawImage(activeInterface.renderCache, 0, 0)
    productionInterfaceCanvas.style.display = 'block'
    renderedProductionInterface = activeInterface
}
function drawInterface() {
    drawEntityInterface()
    drawProductionInterface()

    interfaceCtx.clearRect(0, 0, width, height)

    nextTurnButton.draw(interfaceCtx)

    iButton.draw(interfaceCtx)

    statisticsInterface.draw(interfaceCtx)

    backToMenuButton.draw(interfaceCtx)
    undoButton.draw(interfaceCtx)
    gameEvent.draw(interfaceCtx)

    timer.draw(interfaceCtx)

    nextTurnPauseInterface.draw(interfaceCtx)
    errorWindow.draw(interfaceCtx)
    drawDebugFps(interfaceCtx)
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
