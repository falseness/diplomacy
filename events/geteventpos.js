function getEventPos(event) {
    let pos
    if (typeof event.changedTouches != 'undefined') {
        pos = {
            x: event.changedTouches[0].clientX * window.devicePixelRatio,
            y: event.changedTouches[0].clientY * window.devicePixelRatio
        }
    } else {
        pos = {
            x: event.clientX * window.devicePixelRatio,
            y: event.clientY * window.devicePixelRatio
        }
    }
    return pos
}
function getTouchesPos(event) {
    let pos = []
    for (let i = 0; i < event.targetTouches.length; ++i) {
        pos.push({x: event.touches[i].clientX * window.devicePixelRatio, 
                  y: event.touches[i].clientY * window.devicePixelRatio})
    }
    if (pos.length == 1)
        return pos[0]
    return pos
}
function getRealEventPos(event) {
    let rect = mainCanvas.getBoundingClientRect()

    let pos = getEventPos(event)

    return {
        x: pos.x / canvas.scale + canvas.offset.x - rect.left,
        y: pos.y / canvas.scale + canvas.offset.y - rect.top
    }
}