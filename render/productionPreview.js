// Translucent preview of what a building produces next, with its train/turns
// information. Shared by barracks (unit orders) and demon portals (scheduled
// waves) so portals need no economic manufacture inheritance. View-only: it
// never creates, registers or moves an entity.
const PRODUCTION_PREVIEW_OPACITY = 0.5

function drawProductionPreview(ctx, imageName, pos, coord, turns) {
    const previousAlpha = ctx.globalAlpha
    ctx.globalAlpha = PRODUCTION_PREVIEW_OPACITY
    drawCachedImage(ctx, cachedImages[imageName], pos)
    ctx.globalAlpha = previousAlpha
    if (!coord)
        return
    const fontSize = CoordText.defaultFontSize, kAllProductionStrokeWidth = fontSize / 5
    // we set text here and after each draw of cell it sets to empty text
    // a bit stupid, but we dont have destructors in js so...
    // TASK-1513: the cell's own production text is kept and its turns set every frame (it was a new CoordText every
    // frame), so its sprite (SpriteCache) is found again.
    const cell = grid.getCell(coord), color = cell.hexColor
    let text = cell.productionText
    if (!text || text.color !== color || text.fontSize !== fontSize || text.strokeWidth !== kAllProductionStrokeWidth ||
            text.coord.x !== coord.x || text.coord.y !== coord.y)
        text = cell.productionText = new CoordText(coord.x, coord.y, turns, color, fontSize, 'white', kAllProductionStrokeWidth)
    text.text = turns
    grid.setInfoText(coord, text)
}

function addProductionPreviewInfo(info, name, turns) {
    info.train = name
    info.turns = turns
    return info
}
