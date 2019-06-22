function getEventPos(event)
{
    let pos
    if (typeof event.changedTouches != 'undefined')
    {
        pos =
        {
            x: event.changedTouches[0].clientX,
            y: event.changedTouches[0].clientY
        }
    }
    else
    {
        pos =
        {
            x: event.clientX,
            y: event.clientY
        }
    }
    return pos
}
function getRealEventPos(event)
{
    let rect = canvas.getBoundingClientRect()

    let pos = getEventPos(event)

    return {x: pos.x - rect.left - canvasOffset.x, y: pos.y - rect.top - canvasOffset.y}
}