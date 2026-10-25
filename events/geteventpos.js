// The canvas keeps its load-time backing store (WIDTH x HEIGHT, the game's logical pixels) and fitCanvasToWindow
// scales its CSS box to the window, so a client point maps to canvas pixels through the canvas's own CSS box,
// not through the current devicePixelRatio (which browser zoom changes).
function clientToCanvas(clientX, clientY) {
    const rect = typeof mainCanvas != 'undefined' && mainCanvas.getBoundingClientRect?.()
    if (!rect || !rect.width || !rect.height) {
        return {
            x: clientX * window.devicePixelRatio,
            y: clientY * window.devicePixelRatio
        }
    }
    return {
        x: (clientX - rect.left) * mainCanvas.width / rect.width,
        y: (clientY - rect.top) * mainCanvas.height / rect.height
    }
}
function getEventPos(event) {
    if (typeof event.changedTouches != 'undefined')
        return clientToCanvas(event.changedTouches[0].clientX, event.changedTouches[0].clientY)
    return clientToCanvas(event.clientX, event.clientY)
}
// canvas positions of a list of touches (the handlers pass its length as the count)
function getTouchesPos(touches) {
    let pos = []
    for (let i = 0; i < touches.length; ++i)
        pos.push(clientToCanvas(touches[i].clientX, touches[i].clientY))
    if (pos.length == 1)
        return pos[0]
    return pos
}
function getRealEventPos(event) {
    let pos = getEventPos(event)

    return {
        x: pos.x / canvas.scale + canvas.offset.x,
        y: pos.y / canvas.scale + canvas.offset.y
    }
}
