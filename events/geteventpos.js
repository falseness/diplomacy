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
// TASK-1539: the touches actually down. A browser can keep listing an ended touch in event.touches (Android Chrome:
// a pinch finger's touchend, then the same bit-identical point in every later event and never a 0-touch event), so the
// game trusts only identifiers it saw start (touchstart changedTouches) and not yet end (touchend/touchcancel
// changedTouches). Registered at load on window capture, so it also sees touches while the game's listeners are removed
// (menu shown); the rotate overlay's earlier window-capture swallow hides events from it, so an id that is no longer in
// event.touches is dropped on every touch event (a touch that ended unseen).
const liveTouchIds = new Set()
function trackLiveTouches(event) {
    const listed = new Set(Array.from(event.touches || [], touch => touch.identifier))
    for (const id of liveTouchIds)
        if (!listed.has(id))
            liveTouchIds.delete(id)
    const changed = Array.from(event.changedTouches || [], touch => touch.identifier)
    if (event.type === 'touchstart')
        for (const id of changed)
            liveTouchIds.add(id)
    else if (event.type === 'touchend' || event.type === 'touchcancel')
        for (const id of changed)
            liveTouchIds.delete(id)
}
// event.touches filtered to the touches seen starting and not yet ended (same order)
function liveTouches(event) {
    return Array.from(event.touches || []).filter(touch => liveTouchIds.has(touch.identifier))
}
if (typeof window != 'undefined' && window.addEventListener)
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel'])
        window.addEventListener(type, trackLiveTouches, {capture: true, passive: true})
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
