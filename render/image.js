function drawImage(ctx, img, pos, w = assets.size, h = assets.size) {
    ctx.drawImage(assets[img], pos.x - w / 2, pos.y - h / 2, w, h)
}

function drawImageWithOpacity(ctx, img, pos, opactity, w = assets.size, h = assets.size) {
    ctx.globalAlpha = opactity
    drawImage(ctx, img, pos, w, h)
    ctx.globalAlpha = 1.0
}
function drawCachedImage(ctx, cachedImage, pos) {
    ctx.drawImage(cachedImage, pos.x, pos.y)
}
function drawCachedImageWithOpacity(ctx, cachedImage, pos, opacity = 0.5) {
    ctx.globalAlpha = opacity
    drawCachedImage(ctx, cachedImage, pos)
    ctx.globalAlpha = 1.0
}