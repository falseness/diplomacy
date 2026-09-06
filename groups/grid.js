class Cell {
    constructor(hexagon, unit, building, coordText, logicText) {
        this.hexagon = hexagon
        this.unit = unit
        this.building = building
        // for escape menu. it writes coords of cells
        this.coordText = coordText
        // for suburbs 
        this.logicText = logicText
        
        // for now for texts of production 
        this.infoText = new CoordText(hexagon.coord.x, hexagon.coord.y, '')
    }
    get coord() {
        return this.hexagon.coord
    }
    get pos() {
        return this.hexagon.calcPos()
    }
    get hexColor() {
        return this.hexagon.player.hexColor
    }
}
class Grid extends SpritesGroup {
    drawLogicText = false
    constructor(x, y, size) {
        super(x, y)

        this.surfaceCache = undefined
        this.surfaceCacheBounds = undefined
        this.surfaceCacheScale = 0
        this.surfaceCacheState = undefined
        this.surfaceCacheRevision = 0

        if (size) 
            this.fill(size.x, size.y)
    }
    toJSON() {
        let _grid = []
        for (let i = 0; i < this.arr.length; ++i) {
            _grid.push([])
            for (let j = 0; j < this.arr[i].length; ++j) {
                _grid[i].push(this.arr[i][j].hexagon.playerColor)
            }
        }
        return _grid
    }
    get bottom() {
        return this.arr[0][this.arr[0].length - 1].hexagon.pos.y //+ basis.r * Math.sin(Math.PI / 3) * 2
    }
    get right() {
        return this.arr[this.arr.length - 1][0].hexagon.pos.x //+ basis.r * 2
    }
    get center() {
        return {
            x: this.right / 2,
            y: this.bottom / 2
        }
    }
    getCell(coord) {
        return this.arr[coord.x][coord.y]
    }
    getBuilding(coord) {
        return this.arr[coord.x][coord.y].building
    }
    getUnit(coord) {
        return this.arr[coord.x][coord.y].unit
    }
    getHexagon(coord) {
        return this.arr[coord.x][coord.y].hexagon
    }
    setBuilding(building, coord) {
        this.arr[coord.x][coord.y].building = building
    }
    setUnit(unit, coord) {
        this.arr[coord.x][coord.y].unit = unit
    }
    cleanLogicText() {
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                this.arr[i][j].logicText.text = ''
            }
        }
    }
    newLogicText() {
        this.cleanLogicText()
        this.drawLogicText = true
    }
    clearFogOfWarArr() {
        let n = this.arr.length
        let m = this.arr[0].length
        this.fogOfWar = []
        this.fullInitArr(n, m, this.fogOfWar, 0)

        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                if (this.arr[i][j].building.isAlwaysVisible) {
                    this.fogOfWar[i][j] += 1
                }
            }
        }
    }
    fill(n, m) {
        this.createArr(n, this.arr)
        for (let i = 0; i < n; ++i) {
            for (let j = 0; j < m; ++j) {
                this.arr[i][j] = new Cell(new Hexagon(i, j, 0), new Empty(), new Empty(),
                    new CoordText(i, j, i + ' ' + j), new CoordText(i, j, ''))
            }
        }
        if (isFogOfWar) {
            this.fogOfWar = [] 
            this.visionUsed = []
            this.visionDistance = []
            
            this.clearFogOfWarArr()

            this.fullInitArr(n, m, this.visionUsed, 0)
            this.fullInitArr(n, m, this.visionDistance, 0)

            this.newVisionUsedValue = 0

            this.visionWay = new VisionWay()
        }
    }
    //todo: refactor
    drawHexagons(ctx) {
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                if (isFogOfWar && !this.fogOfWar[i][j])
                    continue
                let cell = this.arr[i][j]
                cell.hexagon.draw(ctx)
            }
        }
    }
    drawCellText(ctx) {
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                let cell = this.arr[i][j]
                
                if (isFogOfWar && !this.fogOfWar[i][j]) {
                    if (debug) {
                        cell.coordText.draw(ctx)
                    }
                    continue;
                }

                if (this.drawLogicText && cell.logicText.text != '') {
                    cell.logicText.draw(ctx)
                }
                else if (debug) {
                    cell.coordText.draw(ctx)
                }
                else if (cell.infoText.text != '') {
                    cell.infoText.draw(ctx)
                }
                cell.infoText.text = ''
            }
        }
    }
    drawTextLogic(ctx) {
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                if (isFogOfWar && !this.fogOfWar[i][j])
                    continue
                let cell = this.arr[i][j]
                cell.logicText.draw(ctx)
            }
        }
    }
    drawTextInfo(ctx) {
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                if (isFogOfWar && !this.fogOfWar[i][j])
                    continue
                let cell = this.arr[i][j]
                if (cell.infoText.text != '')
                    cell.infoText.draw(ctx)
                cell.infoText.text = ''
            }
        }
    }
    drawOther(ctx) {
        let tmpBuildings = []
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                if (isFogOfWar && !this.fogOfWar[i][j])
                    continue
                let cell = this.arr[i][j]

                cell.building.draw(ctx)
                if (cell.building.hasBar)
                    tmpBuildings.push(cell.building)
                cell.unit.draw(ctx)
            }
        }
        for (let i = 0; i < tmpBuildings.length; ++i) {
            tmpBuildings[i].drawBars(ctx)
        }
    }
    drawFogOfWar(ctx) {
        for (let i = 0; i < this.fogOfWar.length; ++i) {
            for (let j = 0; j < this.fogOfWar[i].length; ++j) {
                if (!this.fogOfWar[i][j]) {
                    let hexagon = new FogOfWarHexagon(i, j)
                    hexagon.draw(ctx)
                }
            }
        }
    }
    getSurfaceStateValue(x, y) {
        const hexagon = this.arr[x][y].hexagon
        const fogVisible = !isFogOfWar || this.fogOfWar[x][y] ? 1 : 0
        return ((hexagon.playerColor + 1) << 2) |
            (hexagon.isSuburb ? 2 : 0) | fogVisible
    }
    surfaceStateMatches() {
        if (!this.surfaceCacheState ||
            this.surfaceCacheState.length != this.arr.length * this.arr[0].length)
            return false

        let index = 0
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                if (this.surfaceCacheState[index++] != this.getSurfaceStateValue(i, j))
                    return false
            }
        }
        return true
    }
    captureSurfaceState() {
        const state = new Uint16Array(this.arr.length * this.arr[0].length)
        let index = 0
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j)
                state[index++] = this.getSurfaceStateValue(i, j)
        }
        this.surfaceCacheState = state
    }
    getSurfaceCacheGeometry() {
        const cacheWidth = mapDepth.bounds.right - mapDepth.bounds.left
        const cacheHeight = mapDepth.bounds.bottom - mapDepth.bounds.top
        const maxCacheDimension = 4096
        const maxCachePixels = 12 * 1024 * 1024
        const scale = Math.min(
            1,
            maxCacheDimension / cacheWidth,
            maxCacheDimension / cacheHeight,
            Math.sqrt(maxCachePixels / (cacheWidth * cacheHeight))
        )
        return {cacheWidth, cacheHeight, scale}
    }
    createSurfaceCache() {
        mapDepth.ensureGeometry(this)
        const geometry = this.getSurfaceCacheGeometry()
        if (geometry.cacheWidth <= 0 || geometry.cacheHeight <= 0)
            return false

        const rasterWidth = Math.max(1, Math.ceil(geometry.cacheWidth * geometry.scale))
        const rasterHeight = Math.max(1, Math.ceil(geometry.cacheHeight * geometry.scale))
        let cache = this.surfaceCache
        if (!cache || cache.width != rasterWidth || cache.height != rasterHeight) {
            cache = document.createElement('canvas')
            cache.width = rasterWidth
            cache.height = rasterHeight
        }
        const cacheCtx = cache.getContext('2d')
        if (!cacheCtx)
            return false

        cacheCtx.setTransform(1, 0, 0, 1, 0, 0)
        cacheCtx.clearRect(0, 0, cache.width, cache.height)
        cacheCtx.scale(geometry.scale, geometry.scale)
        cacheCtx.translate(-mapDepth.bounds.left, -mapDepth.bounds.top)
        mapDepth.renderUnderlay(cacheCtx, geometry.scale)
        this.drawHexagons(cacheCtx)
        if (isFogOfWar)
            this.drawFogOfWar(cacheCtx)
        mapDepth.renderRim(cacheCtx)

        this.surfaceCache = cache
        this.surfaceCacheScale = geometry.scale
        this.surfaceCacheBounds = {
            left: mapDepth.bounds.left,
            top: mapDepth.bounds.top,
            width: geometry.cacheWidth,
            height: geometry.cacheHeight
        }
        this.captureSurfaceState()
        ++this.surfaceCacheRevision
        return true
    }
    canUseSurfaceCache() {
        mapDepth.ensureGeometry(this)
        const cacheScale = this.surfaceCache ? this.surfaceCacheScale :
            this.getSurfaceCacheGeometry().scale
        return canvas.scale <= cacheScale
    }
    drawSurfaceCache(ctx) {
        if ((!this.surfaceCache || !this.surfaceStateMatches()) &&
            !this.createSurfaceCache())
            return false

        const visibleLeft = Math.max(this.surfaceCacheBounds.left, canvas.offset.x)
        const visibleTop = Math.max(this.surfaceCacheBounds.top, canvas.offset.y)
        const visibleRight = Math.min(
            this.surfaceCacheBounds.left + this.surfaceCacheBounds.width,
            canvas.offset.x + width
        )
        const visibleBottom = Math.min(
            this.surfaceCacheBounds.top + this.surfaceCacheBounds.height,
            canvas.offset.y + height
        )
        if (visibleLeft >= visibleRight || visibleTop >= visibleBottom)
            return true

        const sourceScaleX = this.surfaceCache.width / this.surfaceCacheBounds.width
        const sourceScaleY = this.surfaceCache.height / this.surfaceCacheBounds.height
        ctx.drawImage(
            this.surfaceCache,
            (visibleLeft - this.surfaceCacheBounds.left) * sourceScaleX,
            (visibleTop - this.surfaceCacheBounds.top) * sourceScaleY,
            (visibleRight - visibleLeft) * sourceScaleX,
            (visibleBottom - visibleTop) * sourceScaleY,
            visibleLeft,
            visibleTop,
            visibleRight - visibleLeft,
            visibleBottom - visibleTop
        )
        return true
    }
    drawMapSurface(ctx) {
        if (this.canUseSurfaceCache() && this.drawSurfaceCache(ctx))
            return

        mapDepth.drawUnderlay(ctx, this)
        this.drawHexagons(ctx)
        if (isFogOfWar)
            this.drawFogOfWar(ctx)
        mapDepth.drawRim(ctx, this)
    }
    draw(ctx) {
        this.drawMapSurface(ctx)
        this.drawOther(ctx)


        this.drawCellText(ctx)

        attackBorder.draw(ctx)
        border.draw(ctx)
    }
}

function isCoordNotOnMap(coord, xLengthOfMapArray, yLengthOfMapArray) {
    return coord.x < 0 || coord.y < 0 || coord.x >= xLengthOfMapArray || coord.y >= yLengthOfMapArray
}

function coordsEqually(coordOne, coordTwo) {
    return coordOne.x == coordTwo.x && coordOne.y == coordTwo.y
}

function hexagonsEqually(hexagonOne, hexagonTwo) {
    return coordsEqually(hexagonOne.coord, hexagonTwo.coord)
}
