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
    const kAllProductionStrokeWidth = CoordText.defaultFontSize / 5
    // we set text here and after each draw of cell it sets to empty text
    // a bit stupid, but we dont have destructors in js so...
    const cell = grid.getCell(coord)
    cell.infoText = new CoordText(coord.x, coord.y, turns,
        cell.hexColor, CoordText.defaultFontSize, 'white', kAllProductionStrokeWidth)
}

function addProductionPreviewInfo(info, name, turns) {
    info.train = name
    info.turns = turns
    return info
}
