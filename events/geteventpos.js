function getEventPos(event) {
    let pos
    if (typeof event.changedTouches != 'undefined') {
        pos = {
            x: event.changedTouches[0].clientX,
            y: event.changedTouches[0].clientY
        }
    } else {
        pos = {
            x: event.clientX,
            y: event.clientY
        }
    }
    return pos
}
function getTouchesPos(event) {
    let pos = []
    for (let i = 0; i < event.targetTouches.length; ++i) {
        pos.push({x: event.targetTouches[i].clientX, y: event.targetTouches[i].clientY})
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