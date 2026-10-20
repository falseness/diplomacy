// Public fog landmarks: goldmines, live demon portals and neutral towns.
// A town owned by a player or by the demons is not public.
function isFogLandmark(building) {
    if (!building || building.killed)
        return false
    if (building.name === 'goldmine' || building.isDemonPortal)
        return true
    return building.name === 'town' && building.player?.isNeutral === true
}
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
    get playerColor() {
        return this.hexagon.playerColor
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
        this.surfaceCacheBuildings = undefined
        this.surfaceCacheUnits = undefined
        this.surfaceCacheBuildingImages = undefined
        this.surfaceCacheUnitImages = undefined
        // Per cell, unobserved and inert when captured (isInertBuilding, no unit): 1 an Empty
        // building, 2 a map edge; unobserved with no unit and a cached nature building (bush,
        // hill, mountain, lake, sea) whose image key is its name: 3, 4 when an overlay cell; 0
        // otherwise. With the unit and building objects it had then, and the nature's name.
        this.surfaceCacheInert = undefined
        this.surfaceCacheInertUnits = undefined
        this.surfaceCacheInertBuildings = undefined
        this.surfaceCacheNatureNames = undefined
        this.surfaceCacheRevision = 0
        // Cells of the surface-cache frame that drawStillUnits and drawEntityOverlays may draw on
        // (see isOverlayCell), and the cells whose infoText may hold a text (setInfoText).
        this.surfaceOverlayCells = []
        this.infoTextCells = new Set()
        // Raster of the overlays during a zoom gesture (drawOverlayLayer).
        this.overlayLayer = undefined
        this.overlayLayerCanvas = undefined
        this.overlayLayerQueued = false
        // Lit tiles and the rest snapshot above the surface cache's scale (drawLitView): the view,
        // the snapshot's canvas, spare tile canvases and what the frame drew.
        this.litView = undefined
        this.litRestCanvas = undefined
        this.litTilePool = []
        this.litTilesQueued = false
        this.litFrame = undefined

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
        this.infoTextCells.clear()
        for (let i = 0; i < n; ++i) {
            for (let j = 0; j < m; ++j) {
                this.arr[i][j] = new Cell(new Hexagon(i, j, 0), new Empty(), new Empty(),
                    new CoordText(i, j, i + ' ' + j), new CoordText(i, j, ''))
            }
        }
        this.showChanceOfWinning = false
        this.chanceOfWinning = []
        this.createArr(n, this.chanceOfWinning)
        for (let i = 0; i < n; ++i) {
            for (let j = 0; j < m; ++j) {
                this.chanceOfWinning[i][j] = new CoordText(i, j, '')
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
    // Debug 'chance of winning' overlay (I key). Client-only UI state: it is
    // not part of gameSettings, so it is never saved or sent with the board.
    clearChancesOfWinning() {
        this.showChanceOfWinning = false
        this.clearChanceOfWinningText()
    }
    clearChanceOfWinningText() {
        for (let i = 0; i < this.chanceOfWinning.length; ++i) {
            for (let j = 0; j < this.chanceOfWinning[i].length; ++j) {
                this.chanceOfWinning[i][j].text = ''
            }
        }
    }
    fillChancesOfWinning(entity) {
        if (!entity.isUnit) {
            console.log(entity.toJSON())
            return
        }
        this.clearChanceOfWinningText()
        // getAvailableCommands asserts isMyTurn: other players' units have none.
        if (!entity.isMyTurn)
            return
        let commands = entity.getAvailableCommands()
        console.log(commands)
        for (let i = 0; i < commands.length; ++i) {
            let coord = commands[i].destinationCoord
            this.chanceOfWinning[coord.x][coord.y].text = '1'
        }
    }
    //todo: refactor
    // The grout path holds whole rows of cells across the canvas (atmosphericLighting.onCanvas);
    // the tiles drawn are those of the drawn range (each also culls itself).
    drawHexagons(ctx) {
        const atmosphericTransform = otherSettings.atmosphericVisuals ? ctx.getTransform() : undefined
        const hexagons = [], tiles = []
        const range = this.drawRange(ctx, true), drawn = this.drawRange(ctx)
        for (let i = range.i0; i < range.i1; ++i) {
            for (let j = range.j0; j < range.j1; ++j) {
                if (this.arr[i][j].building.isMapEdge)
                    continue
                const observed = this.observedHexagon(this.arr[i][j])
                if (isFogOfWar && !this.fogOfWar[i][j] && !observed)
                    continue
                const hexagon = observed || this.arr[i][j].hexagon
                hexagons.push(hexagon)
                if (i >= drawn.i0 && i < drawn.i1)
                    tiles.push(hexagon)
            }
        }
        // Grout under the drawn cells only: hidden cells keep their fog tile.
        if (otherSettings.atmosphericVisuals)
            atmosphericLighting.drawGrout(ctx, hexagons)
        for (const hexagon of tiles)
            hexagon.draw(ctx, atmosphericTransform)
    }
    // Cell texts are set while their cells are drawn (production previews), within the same
    // drawn range, so the range also holds every text to draw and clear.
    drawCellText(ctx) {
        const range = this.drawRange(ctx)
        if (!debug && !this.drawLogicText) {
            this.drawInfoTexts(ctx, range)
            return
        }
        for (let i = range.i0; i < range.i1; ++i) {
            for (let j = range.j0; j < range.j1; ++j) {
                let cell = this.arr[i][j]
                if (cell.building.isMapEdge)
                    continue
                
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
    // drawCellText without debug or logic texts: only infoTexts draw, and only setInfoText sets
    // one, so the cells it noted are the only ones to visit (in the same order, same rules).
    drawInfoTexts(ctx, range) {
        if (!this.infoTextCells.size)
            return
        const h = this.arr[0].length
        for (const index of [...this.infoTextCells].sort((a, b) => a - b)) {
            const i = Math.floor(index / h), j = index % h
            if (i < range.i0 || i >= range.i1 || j < range.j0 || j >= range.j1)
                continue
            const cell = this.arr[i][j]
            if (cell.building.isMapEdge || (isFogOfWar && !this.fogOfWar[i][j]))
                continue
            if (cell.infoText.text != '')
                cell.infoText.draw(ctx)
            cell.infoText.text = ''
            this.infoTextCells.delete(index)
        }
    }
    setInfoText(coord, infoText) {
        this.arr[coord.x][coord.y].infoText = infoText
        this.infoTextCells.add(coord.x * this.arr[0].length + coord.y)
    }
    drawChanceOfWinningText(ctx) {
        for (let i = 0; i < this.chanceOfWinning.length; ++i) {
            for (let j = 0; j < this.chanceOfWinning[i].length; ++j) {
                if (isFogOfWar && !this.fogOfWar[i][j])
                    continue
                this.chanceOfWinning[i][j].draw(ctx)
            }
        }
    }
    drawTextLogic(ctx) {
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                if (this.arr[i][j].building.isMapEdge)
                    continue
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
                if (this.arr[i][j].building.isMapEdge)
                    continue
                if (isFogOfWar && !this.fogOfWar[i][j])
                    continue
                let cell = this.arr[i][j]
                if (cell.infoText.text != '')
                    cell.infoText.draw(ctx)
                cell.infoText.text = ''
            }
        }
    }
    // Public landmarks reveal only their artwork, never an occupying unit or
    // overlays. Fog/vision state remains authoritative for everything else.
    drawFogLandmark(ctx, building) {
        if (gameSettings.drawFogLandmarks !== true)
            return
        if (isFogLandmark(building))
            drawCachedImage(ctx, cachedImages[this.getEntityBodyImageName(building)], building.pos)
    }
    // layer: undefined draws everything in place; atmospheric lighting draws the
    // 'buildings' before its light map and the 'units' (with silhouettes and bars) after.
    drawOther(ctx, layer) {
        const buildings = layer !== 'units', units = layer !== 'buildings'
        let tmpBuildings = []
        const range = this.drawRange(ctx)
        for (let i = range.i0; i < range.i1; ++i) {
            for (let j = range.j0; j < range.j1; ++j) {
                if (isFogOfWar && !this.fogOfWar[i][j]) {
                    if (buildings) this.drawFogLandmark(ctx, this.arr[i][j].building)
                    continue
                }
                let cell = this.arr[i][j]

                if (!this.observedBuilding(cell)) {
                    if (buildings) cell.building.draw(ctx)
                    if (units && cell.building.hasBar) tmpBuildings.push(cell.building)
                    if (units) this.drawProductionSilhouette(ctx, cell.building)
                }
                const unit = units && this.getStillUnit(cell)
                if (unit) unit.draw(ctx)
            }
        }
        for (let i = 0; i < tmpBuildings.length; ++i) {
            tmpBuildings[i].drawBars(ctx)
        }
        if (units)
            this.refreshCulledPortal(range)
    }
    drawProductionSilhouette(ctx, building) {
        if (building.isPreparingManufacture)
            building.unitProduction.draw(ctx)
        else if (building.isDemonPortal)
            building.drawNextProduction(ctx)
    }
    isCacheableBuilding(building) {
        return building.notEmpty() && !building.isInvisible && !building.isBuildingProduction() &&
            !this.observedBuilding(this.getCell(building.coord))
    }
    observedBuilding(cell) {
        return typeof onlineObservation !== 'undefined' && onlineObservation.hidesBuilding(cell)
    }
    getEntityBodyImageName(entity) {
        if (entity.isDemonPortal)
            return entity.imageName
        return entity.bodyImageName
    }
    drawEntityBody(ctx, entity) {
        if (entity.isDemonPortal) {
            entity.draw(ctx)
            return
        }
        drawCachedImage(ctx, cachedImages[this.getEntityBodyImageName(entity)], entity.pos)
    }
    // The cell's unit as drawn in place: none while it is tweening (moveTween draws it).
    getStillUnit(cell) {
        if (typeof onlineObservation !== 'undefined' && onlineObservation.hidesUnit(cell)) return undefined
        return cell.unit.notEmpty() && !moveTween.isActive(cell.unit) ? cell.unit : undefined
    }
    drawEntityBodies(ctx) {
        const range = this.drawRange(ctx)
        for (let i = range.i0; i < range.i1; ++i) {
            for (let j = range.j0; j < range.j1; ++j) {
                if (isFogOfWar && !this.fogOfWar[i][j]) {
                    this.drawFogLandmark(ctx, this.arr[i][j].building)
                    continue
                }
                const cell = this.arr[i][j]
                if (this.isCacheableBuilding(cell.building))
                    this.drawEntityBody(ctx, cell.building)
                // Atmospheric units are drawn after the light map (drawStillUnits).
                if (this.getStillUnit(cell) && !otherSettings.atmosphericVisuals)
                    this.drawEntityBody(ctx, cell.unit)
            }
        }
    }
    // cells: the frame's surfaceOverlayCells (indices in board order), else every cell in range.
    drawStillUnits(ctx, cells) {
        this.forEachDrawnCell(ctx, cells, (cell, i, j) => {
            if (isFogOfWar && !this.fogOfWar[i][j])
                return
            const unit = this.getStillUnit(cell)
            if (unit)
                this.drawEntityBody(ctx, unit)
        })
    }
    drawEntityOverlays(ctx, cells) {
        const buildingBars = []
        const range = this.forEachDrawnCell(ctx, cells, (cell, i, j) => {
            if (isFogOfWar && !this.fogOfWar[i][j])
                return
            const building = cell.building
            const observed = this.observedBuilding(cell)
            let silhouette = false
            if (!observed) {
                if (building.isBuildingProduction()) building.draw(ctx)
                else if (building.isPreparingManufacture) {
                    silhouette = building.unitProduction.notEmpty()
                    building.unitProduction.draw(ctx)
                } else if (building.isDemonPortal) {
                    silhouette = !!building.nextProduction
                    building.drawNextProduction(ctx)
                }
            }
            // The cached unit sits under the silhouette; repaint it on top.
            const unit = this.getStillUnit(cell)
            if (silhouette && unit)
                this.drawEntityBody(ctx, unit)
            if (!observed && building.hasBar)
                buildingBars.push(building)
            if (unit)
                unit.drawBars(ctx)
        })
        for (let i = 0; i < buildingBars.length; ++i)
            buildingBars[i].drawBars(ctx)
        this.refreshCulledPortal(range)
    }
    // Calls visit(cell, i, j) for the cells of the drawn range in board order: those listed in
    // cells (board indices, ascending) when given, else all of them. Returns the range.
    forEachDrawnCell(ctx, cells, visit) {
        const range = this.drawRange(ctx)
        if (cells) {
            const h = this.arr[0].length
            for (let k = 0; k < cells.length; ++k) {
                const i = Math.floor(cells[k] / h), j = cells[k] - i * h
                if (i >= range.i0 && i < range.i1 && j >= range.j0 && j < range.j1)
                    visit(this.arr[i][j], i, j)
            }
            return range
        }
        for (let i = range.i0; i < range.i1; ++i)
            for (let j = range.j0; j < range.j1; ++j)
                visit(this.arr[i][j], i, j)
        return range
    }
    // Whether drawStillUnits or drawEntityOverlays can draw anything on the cell: a unit, a
    // production, a demon portal or a building with bars. Every other cell is skipped by them.
    isOverlayCell(cell) {
        const building = cell.building
        return cell.unit.notEmpty() || !!building.hasBar || !!building.isPreparingManufacture ||
            !!building.isDemonPortal || building.isBuildingProduction()
    }
    // The cell index range whose drawing can reach ctx's canvas: with atmospheric visuals and an
    // axis-aligned transform, the cells centred within a margin of the canvas that holds any
    // hexagon, sprite, shadow, silhouette or bar drawn for a cell; the whole board otherwise
    // (and for the surface cache, whose raster holds the whole board). Per-frame loops skip the
    // other cells, so a zoomed-in large board does not walk every cell every frame.
    // fullWidth keeps every column (whole rows).
    // A lit tile's canvas (buildLitTile) has a window, its part of the camera's canvas: whole rows
    // (fullWidth) and the cells of windowed ranges are those of the window, so the board's union
    // paths (grout, fog, the shadows' clip) hold the cells they hold on the camera's canvas.
    drawRange(ctx, fullWidth = false, windowed = false) {
        const all = {i0: 0, i1: this.arr.length, j0: 0, j1: this.arr.length ? this.arr[0].length : 0}
        if (!otherSettings.atmosphericVisuals)
            return all
        const t = ctx.getTransform()
        if (t.b !== 0 || t.c !== 0 || t.a <= 0 || t.d <= 0)
            return all
        const margin = 4 * basis.r + assets.size
        const w = (fullWidth || windowed) && ctx.canvas.litWindow
        const left = ((w ? w.left : 0) - t.e) / t.a - margin, right = ((w ? w.right : ctx.canvas.width) - t.e) / t.a + margin
        const top = ((w ? w.top : 0) - t.f) / t.d - margin, bottom = ((w ? w.bottom : ctx.canvas.height) - t.f) / t.d + margin
        // Cell centres: x = i * offset.x, y = (2 * j + (i & 1)) * offset.y.
        return {
            i0: fullWidth ? 0 : Math.max(0, Math.floor(left / basis.offset.x)),
            i1: fullWidth ? all.i1 : Math.min(all.i1, Math.ceil(right / basis.offset.x) + 1),
            j0: Math.max(0, Math.floor((top / basis.offset.y - 1) / 2)),
            j1: Math.min(all.j1, Math.ceil(bottom / basis.offset.y / 2) + 1)
        }
    }
    // A demon portal's drawNextProduction also keeps its information panel current while it
    // is selected; a selected portal outside the drawn range still gets that refresh.
    refreshCulledPortal(range) {
        const portal = gameEvent.selected
        if (!portal?.isDemonPortal || portal.killed || !portal.nextProduction)
            return
        const {x, y} = portal.coord
        if (x >= range.i0 && x < range.i1 && y >= range.j0 && y < range.j1)
            return
        if (!this.arr[x] || this.arr[x][y]?.building !== portal ||
                (isFogOfWar && !this.fogOfWar[x][y]) || this.observedBuilding(this.arr[x][y]))
            return
        entityInterface.refreshPortal(portal)
    }
    drawFogOfWar(ctx) {
        const range = this.drawRange(ctx, false, true)
        const fogged = []
        for (let i = range.i0; i < Math.min(range.i1, this.fogOfWar.length); ++i) {
            for (let j = range.j0; j < Math.min(range.j1, this.fogOfWar[i].length); ++j) {
                if (this.arr[i][j].building.isMapEdge)
                    continue
                if (!this.fogOfWar[i][j] && !this.observedHexagon(this.arr[i][j])) {
                    let hexagon = new FogOfWarHexagon(i, j)
                    if (otherSettings.atmosphericVisuals)
                        fogged.push(hexagon)
                    else
                        hexagon.draw(ctx)
                }
            }
        }
        // Atmospheric fog: all fogged cells in one pass (one grout fill under their variants).
        if (fogged.length)
            atmosphericLighting.drawFog(ctx, fogged)
    }
    // Two layers on a hidden-information board (PRD 7.3-7.4): the fog (visible now) and the
    // known contents (cells whose colour is known). A loading cell is uncovered by the local
    // fog but its contents have not arrived: drawn as fog plus a glyph, and unplannable like
    // any unknown cell (Player.ignoresCell) until markCellsKnown fills it.
    isLoadingCell(x, y) {
        return hiddenInfo && isFogOfWar && this.fogOfWar[x][y] > 0 && this.arr[x][y].hexagon.unknown
    }
    getLoadingCells() {
        let cells = []
        if (!hiddenInfo || !isFogOfWar)
            return cells
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                const observed = this.observedHexagon(this.arr[i][j])
                if (this.isLoadingCell(i, j) && (!observed || observed.unknown))
                    cells.push({x: i, y: j})
            }
        }
        return cells
    }
    // Asks onLoadingCellsNeeded once for each cell that became loading since the last call.
    reportLoadingCells() {
        if (!hiddenInfo || !isFogOfWar)
            return
        if (!this.requestedLoadingCells)
            this.requestedLoadingCells = new Set()
        let cells = this.getLoadingCells().filter(cell =>
            !this.requestedLoadingCells.has(cell.x + ',' + cell.y))
        if (!cells.length)
            return
        for (const cell of cells)
            this.requestedLoadingCells.add(cell.x + ',' + cell.y)
        onLoadingCellsNeeded(cells)
    }
    drawLoadingGlyph(ctx, pos) {
        const r = basis.r * 0.3
        ctx.save()
        ctx.lineWidth = Math.max(1, basis.r * 0.08)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, r, -Math.PI / 2, Math.PI)
        ctx.stroke()
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
        for (let k = -1; k <= 1; ++k) {
            ctx.beginPath()
            ctx.arc(pos.x + k * r * 0.45, pos.y, ctx.lineWidth * 0.7, 0, 2 * Math.PI)
            ctx.fill()
        }
        ctx.restore()
    }
    drawLoadingCells(ctx) {
        if (!hiddenInfo || !isFogOfWar)
            return
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                if (this.isLoadingCell(i, j))
                    this.drawLoadingGlyph(ctx, this.arr[i][j].hexagon.calcPos())
            }
        }
    }
    // observing: false when isObserving() is (no observed hexagon then).
    getSurfaceStateValue(x, y, observing = true) {
        const observed = observing ? this.observedHexagon(this.arr[x][y]) : null
        const hexagon = observed || this.arr[x][y].hexagon
        const fogVisible = observed ? (observed.unknown ? 0 : 1) : !isFogOfWar || this.fogOfWar[x][y] ? 1 : 0
        return this.surfaceStateOf(hexagon, fogVisible)
    }
    surfaceStateOf(hexagon, fogVisible) {
        // Unknown cells (playerColor null) get their own value, apart from colour 0.
        return ((hexagon.unknown ? 0 : hexagon.playerColor + 1) << 2) |
            (hexagon.isSuburb ? 2 : 0) | fogVisible
    }
    // No building (Empty) or a map edge (InvisibleMountain): never cached (isCacheableBuilding) nor
    // drawn by the overlays (isOverlayCell), whatever its state.
    isInertBuilding(building) {
        return building.constructor === Empty || building.constructor === InvisibleMountain
    }
    // Whether an online observation can hide or replace anything on this board: when it cannot,
    // observedHexagon and observedBuilding are null and getStillUnit hides no unit.
    isObserving() {
        return typeof onlineObservation !== 'undefined' && onlineObservation.board === grid
    }
    observedHexagon(cell) {
        return typeof onlineObservation !== 'undefined' ? onlineObservation.hexagonFor(cell) : null
    }
    // ctx: the canvas the cache is drawn on. With atmospheric visuals, its axis-aligned transform
    // and no online observation, only the cells that can change its pixels are compared in full
    // (checkRange), and the others' visibility; otherwise every cell.
    surfaceStateMatches(ctx) {
        // The light state (atmosphericLighting.lightState) is compared cell by cell in the same pass.
        const lighting = this.surfaceCacheLighting
        if (!lighting || lighting.length != this.arr.length * this.arr[0].length + 1 ||
            lighting[0] !== (otherSettings.atmosphericVisuals ? basis.r : 0) ||
            this.surfaceCacheAtmospheric !== otherSettings.atmosphericVisuals ||
            !this.surfaceCacheState ||
            !this.surfaceCacheBuildings ||
            !this.surfaceCacheUnits ||
            !this.surfaceCacheBuildingImages ||
            !this.surfaceCacheUnitImages ||
            this.surfaceCacheState.length != this.arr.length * this.arr[0].length ||
            this.surfaceCacheBuildings.length != this.surfaceCacheState.length ||
            this.surfaceCacheUnits.length != this.surfaceCacheState.length ||
            this.surfaceCacheBuildingImages.length != this.surfaceCacheState.length ||
            this.surfaceCacheUnitImages.length != this.surfaceCacheState.length ||
            !this.surfaceCacheInert ||
            this.surfaceCacheInert.length != this.surfaceCacheState.length)
            return false

        // The same pass lists this frame's overlay cells (surfaceOverlayCells). An unobserved cell
        // with no unit and an inert building (isInertBuilding) has no cached or overlay entity
        // (captureSurfaceState stored none, and no images), so only its state and light values are compared.
        // Its state and light values are getSurfaceStateValue's and lightValue's for an unobserved cell.
        const overlayCells = this.surfaceOverlayCells
        overlayCells.length = 0
        const observing = this.isObserving(), atmospheric = otherSettings.atmosphericVisuals
        const states = this.surfaceCacheState, buildings = this.surfaceCacheBuildings, units = this.surfaceCacheUnits
        const buildingImages = this.surfaceCacheBuildingImages, unitImages = this.surfaceCacheUnitImages
        const inert = this.surfaceCacheInert, inertUnits = this.surfaceCacheInertUnits, inertBuildings = this.surfaceCacheInertBuildings
        const natureNames = this.surfaceCacheNatureNames
        const range = observing ? this.checkRange() : this.checkRange(ctx), h = this.arr[0].length
        // Visibility is compared on the whole board all the same (each cell's fog bit, a typed
        // array read): a cell hidden or uncovered anywhere rebuilds the cache, as it always has.
        if (isFogOfWar && (range.i0 > 0 || range.i1 < this.arr.length || range.j0 > 0 || range.j1 < h)) {
            for (let i = 0; i < this.arr.length; ++i) {
                const fogRow = this.fogOfWar[i], inside = i >= range.i0 && i < range.i1
                for (let j = 0, index = i * h; j < h; ++j, ++index) {
                    if (inside && j >= range.j0 && j < range.j1)
                        continue
                    if ((states[index] & 1) !== (fogRow[j] ? 1 : 0))
                        return false
                }
            }
        }
        for (let i = range.i0; i < range.i1; ++i) {
            const row = this.arr[i], fogRow = isFogOfWar ? this.fogOfWar[i] : undefined
            let index = i * h + range.j0
            for (let j = range.j0; j < range.j1; ++j) {
                const cell = row[j]
                // Most cells of a large board: inert when captured and still holding the same unit
                // and building objects, so still inert (an Empty or map-edge building's light value
                // is shownLightValue's: 0 for a map edge, 1 plus the owner's light for Empty). Object
                // identity spares the per-class property reads of the general inert check below.
                // A nature building (kinds 3 and 4) still of the same name is still cached with the
                // image of its name, holds no lamp (lightValue 1 plus the owner's light) and is an
                // overlay cell or not by its class alone (hasBar), as captureSurfaceState found it.
                const kind = inert[index]
                if (kind !== 0 && !observing && cell.unit === inertUnits[index] && cell.building === inertBuildings[index] &&
                        (kind < 3 || cell.building.name === natureNames[index])) {
                    const hexagon = cell.hexagon, shown = !fogRow || fogRow[j] ? 1 : 0
                    if (states[index] != this.surfaceStateOf(hexagon, shown) ||
                        lighting[index + 1] !== (!atmospheric || !shown || kind === 2 || hexagon.unknown ? 0 :
                            1 + atmosphericLighting.ownerLight(hexagon)))
                        return false
                    if (kind >= 3) {
                        if (buildingImages[index] != cachedImages[natureNames[index]])
                            return false
                        if (kind === 4)
                            overlayCells.push(index)
                    }
                    ++index
                    continue
                }
                if (!observing && cell.unit.constructor === Empty && this.isInertBuilding(cell.building)) {
                    const hexagon = cell.hexagon, shown = !fogRow || fogRow[j] ? 1 : 0
                    if (states[index] != this.surfaceStateOf(hexagon, shown) ||
                        lighting[index + 1] !== (!atmospheric || !shown || hexagon.unknown ? 0 :
                            atmosphericLighting.shownLightValue(hexagon, cell.building)) ||
                        buildings[index] !== undefined || units[index] !== undefined)
                        return false
                    ++index
                    continue
                }
                if (this.isOverlayCell(cell))
                    overlayCells.push(index)
                const building = this.isCacheableBuilding(cell.building) ?
                    cell.building : undefined
                const unit = this.getStillUnit(cell)
                if (buildings[index] != building || units[index] != unit ||
                    states[index] != this.getSurfaceStateValue(i, j, observing) ||
                    lighting[index + 1] !== atmosphericLighting.lightValue(this, cell, observing) ||
                    buildingImages[index] != (building ?
                        cachedImages[this.getEntityBodyImageName(building)] : undefined) ||
                    unitImages[index] != (unit ?
                        cachedImages[this.getEntityBodyImageName(unit)] : undefined))
                    return false
                ++index
            }
        }
        return true
    }
    // The cells surfaceStateMatches compares in full for a cache drawn on ctx: those within reach
    // of the canvas, reach the farther of drawRange's margin (a cell's hexagon, sprite, shadow and
    // bars) and SURFACE_CHECK_REACH hex radii (the farthest a cell's state reaches into the
    // cache's pixels: a blue tile's cool spill 5, a lamp's pool about 4.2 radii); during a zoom
    // gesture or a pan (Screen.surfaceMoving) also those whose overlays reach the overlay layer,
    // a quarter of the canvas beyond each side (its overlays come from the same pass's
    // surfaceOverlayCells). A cell outside may differ from the cache unseen (except in
    // visibility, compared on the whole board); once its pixels can show it is compared, and a
    // difference rebuilds the cache from the whole board. Every cell without ctx, with classic
    // visuals (whose overlays and cache are the whole board's) or a rotated transform.
    checkRange(ctx) {
        const all = {i0: 0, i1: this.arr.length, j0: 0, j1: this.arr[0].length}
        if (!ctx || !otherSettings.atmosphericVisuals)
            return all
        const t = ctx.getTransform(), a = t.a, d = t.d, e = t.e, f = t.f
        if (t.b !== 0 || t.c !== 0 || a <= 0 || d <= 0)
            return all
        const W = ctx.canvas.width, H = ctx.canvas.height
        const drawn = 4 * basis.r + assets.size, reach = Math.max(drawn, SURFACE_CHECK_REACH * basis.r)
        const layered = typeof gameEvent !== 'undefined' && gameEvent.screen?.surfaceMoving
        const reachX = Math.max(reach, layered ? drawn + W / 4 / a : 0)
        const reachY = Math.max(reach, layered ? drawn + H / 4 / d : 0)
        const left = -e / a - reachX, right = (W - e) / a + reachX
        const top = -f / d - reachY, bottom = (H - f) / d + reachY
        // Cell centres: x = i * offset.x, y = (2 * j + (i & 1)) * offset.y (as drawRange).
        return {
            i0: Math.max(0, Math.floor(left / basis.offset.x)),
            i1: Math.min(all.i1, Math.ceil(right / basis.offset.x) + 1),
            j0: Math.max(0, Math.floor((top / basis.offset.y - 1) / 2)),
            j1: Math.min(all.j1, Math.ceil(bottom / basis.offset.y / 2) + 1)
        }
    }
    captureSurfaceState() {
        const state = new Uint16Array(this.arr.length * this.arr[0].length)
        const buildings = new Array(state.length)
        const units = new Array(state.length)
        const buildingImages = new Array(state.length)
        const unitImages = new Array(state.length)
        const inert = new Uint8Array(state.length)
        const inertUnits = new Array(state.length), inertBuildings = new Array(state.length)
        const natureNames = new Array(state.length)
        const observing = this.isObserving()
        const overlayCells = this.surfaceOverlayCells
        overlayCells.length = 0
        let index = 0
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                const cell = this.arr[i][j]
                if (!observing && cell.unit.constructor === Empty && this.isInertBuilding(cell.building)) {
                    inert[index] = cell.building.constructor === Empty ? 1 : 2
                    inertUnits[index] = cell.unit
                    inertBuildings[index] = cell.building
                }
                else if (!observing && cell.unit.constructor === Empty && cell.building instanceof Nature &&
                        this.isCacheableBuilding(cell.building) &&
                        this.getEntityBodyImageName(cell.building) === cell.building.name &&
                        !atmosphericLighting.emitsLight(cell.building)) {
                    inert[index] = this.isOverlayCell(cell) ? 4 : 3
                    inertUnits[index] = cell.unit
                    inertBuildings[index] = cell.building
                    natureNames[index] = cell.building.name
                }
                if (this.isOverlayCell(cell))
                    overlayCells.push(index)
                const building = this.isCacheableBuilding(cell.building) ?
                    cell.building : undefined
                const unit = this.getStillUnit(cell)
                state[index] = this.getSurfaceStateValue(i, j)
                buildings[index] = building
                units[index] = unit
                buildingImages[index] = building ?
                    cachedImages[this.getEntityBodyImageName(building)] : undefined
                unitImages[index] = unit ?
                    cachedImages[this.getEntityBodyImageName(unit)] : undefined
                ++index
            }
        }
        this.surfaceCacheLighting = atmosphericLighting.lightState(this).slice()
        this.surfaceCacheAtmospheric = otherSettings.atmosphericVisuals
        this.surfaceCacheState = state
        this.surfaceCacheBuildings = buildings
        this.surfaceCacheUnits = units
        this.surfaceCacheBuildingImages = buildingImages
        this.surfaceCacheUnitImages = unitImages
        this.surfaceCacheInert = inert
        this.surfaceCacheInertUnits = inertUnits
        this.surfaceCacheInertBuildings = inertBuildings
        this.surfaceCacheNatureNames = natureNames
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
        mapDepth.renderAtmosphericSides(cacheCtx)
        this.drawHexagons(cacheCtx)
        atmosphericLighting.drawShadows(cacheCtx, this)
        if (isFogOfWar)
            this.drawFogOfWar(cacheCtx)
        mapDepth.renderRim(cacheCtx)
        this.drawEntityBodies(cacheCtx)
        this.surfaceCacheLit = atmosphericLighting.bake(cacheCtx, this, geometry.scale)

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
        // Above the raster's native scale, briefly transform the warmed texture
        // through a gesture instead of redrawing every tile and asset. Settled
        // frames return to the original sharp path. drawSurfaceCache still checks
        // the complete fog/source/entity state before submitting any cached pixels.
        const scaling = otherSettings.atmosphericVisuals && this.surfaceCache &&
            gameEvent.screen.surfaceZooming
        return canvas.scale <= cacheScale || !!scaling
    }
    drawSurfaceCache(ctx) {
        if ((!this.surfaceCache || !this.surfaceStateMatches(ctx)) &&
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
    // During a zoom gesture or a camera pan on the surface-cache path (Screen.surfaceMoving), the
    // overlays drawn after the light map (still units, bars, production previews and production
    // texts) come from a raster of them, the overlay layer, drawn scaled like the surface cache
    // under it (at its own scale, its pixels copied whole at the nearest whole-pixel shift). A
    // frame without a usable layer draws them directly and queues one: a task after the frame
    // draws them at that frame's transform for the canvas and a quarter of it on each side, and
    // has the drawing rasterized there (between frames, where the canvas itself is rasterized),
    // not inside a later frame. A layer is used while the surface cache is unchanged, the zoom
    // within 2x of its scale, the view inside it and for at most a second; the next one is queued
    // ahead, once the zoom is 1.25x from its scale, the layer 750 ms old or the view within a tenth
    // of its size of the layer's edge. Frames outside a gesture or pan and its hold always draw the
    // overlays directly (a settled frame is unchanged), and so do frames whose layer would exceed
    // OVERLAY_LAYER_MAX_PIXELS: drawing a raster that large from a canvas costs more per frame
    // than the overlays (a desktop canvas zoomed in). Outside a zoom gesture (a pan, or the hold
    // after either) a frame with fewer than OVERLAY_LAYER_MIN_CELLS overlay cells draws them
    // directly and queues nothing, and in a zoom gesture such a frame queues no layer ahead for its
    // age: there the direct overlays cost less than building layers in tasks between the frames
    // (a small board).
    // Returns whether it drew the overlays.
    drawOverlayLayer(ctx) {
        const layer = this.overlayLayer
        const t = ctx.getTransform()
        if (!gameEvent.screen.surfaceMoving || debug || this.drawLogicText || typeof createImageBitmap !== 'function' ||
                t.b !== 0 || t.c !== 0 || t.a <= 0 || t.d <= 0) {
            this.dropOverlayLayer()
            return false
        }
        // The part of the view the overlays can reach (the board and their margin around it).
        const margin = 4 * basis.r + assets.size, b = this.surfaceCacheBounds
        const viewLeft = Math.max(-t.e / t.a, b.left - margin), viewTop = Math.max(-t.f / t.d, b.top - margin)
        const viewRight = Math.min((ctx.canvas.width - t.e) / t.a, b.left + b.width + margin)
        const viewBottom = Math.min((ctx.canvas.height - t.f) / t.d, b.top + b.height + margin)
        const rect = this.overlayLayerRect(ctx.canvas.width, ctx.canvas.height, t)
        if (rect.width * rect.height > OVERLAY_LAYER_MAX_PIXELS) {
            this.dropOverlayLayer()
            return false
        }
        const few = this.surfaceOverlayCells.length < OVERLAY_LAYER_MIN_CELLS
        if (few && !gameEvent.screen.surfaceZooming)
            return false
        const drift = Math.max(t.a / layer?.a, layer?.a / t.a, t.d / layer?.d, layer?.d / t.d)
        if (!layer || layer.revision !== this.surfaceCacheRevision ||
                performance.now() - layer.time > 1000 || !(drift <= 2) ||
                viewLeft < layer.left || viewTop < layer.top || viewRight > layer.right || viewBottom > layer.bottom) {
            this.queueOverlayLayer(ctx, t)
            return false
        }
        // The view grown by a tenth of its size each way, within the board and margin.
        const nearX = (viewRight - viewLeft) / 10, nearY = (viewBottom - viewTop) / 10
        if (drift > 1.25 || (!few && performance.now() - layer.time > 750) || Math.max(viewLeft - nearX, b.left - margin) < layer.left ||
                Math.max(viewTop - nearY, b.top - margin) < layer.top ||
                Math.min(viewRight + nearX, b.left + b.width + margin) > layer.right ||
                Math.min(viewBottom + nearY, b.top + b.height + margin) > layer.bottom)
            this.queueOverlayLayer(ctx, t)
        if (t.a === layer.a && t.d === layer.d) {
            // At the layer's scale (a pan, or a zoom held at its limit): its pixels copied whole, moved
            // by the camera's shift rounded to whole pixels (under half a pixel off while moving).
            ctx.save()
            ctx.setTransform(1, 0, 0, 1, 0, 0)
            ctx.drawImage(layer.canvas, 0, 0, layer.width, layer.height,
                layer.x0 + Math.round(t.e - layer.e), layer.y0 + Math.round(t.f - layer.f), layer.width, layer.height)
            ctx.restore()
        }
        else if (viewLeft < viewRight && viewTop < viewBottom)
            ctx.drawImage(layer.canvas,
                (viewLeft - layer.left) * layer.a, (viewTop - layer.top) * layer.d,
                (viewRight - viewLeft) * layer.a, (viewBottom - viewTop) * layer.d,
                viewLeft, viewTop, viewRight - viewLeft, viewBottom - viewTop)
        return true
    }
    dropOverlayLayer() {
        this.overlayLayer = undefined
    }
    // Queues the overlay layer for transform t of ctx (one at a time). It is not built if the
    // surface cache changed or the gesture ended before the task runs.
    queueOverlayLayer(ctx, t) {
        if (this.overlayLayerQueued)
            return
        this.overlayLayerQueued = true
        const cw = ctx.canvas.width, ch = ctx.canvas.height, revision = this.surfaceCacheRevision
        setTimeout(() => {
            this.overlayLayerQueued = false
            if (revision !== this.surfaceCacheRevision || !gameEvent.screen.surfaceMoving)
                return
            const layer = this.drawOverlayLayerRaster(cw, ch, t)
            // A one-pixel read rasterizes the recorded drawing now, in this task between frames (an
            // image-bitmap snapshot left it to the first frame drawing the canvas: a 20-55 ms frame
            // on a throttled phone); the frames then draw the canvas.
            layer.canvas.getContext('2d').getImageData(0, 0, 1, 1)
            this.overlayLayer = {...layer.bounds, canvas: layer.canvas, a: t.a, d: t.d, e: t.e, f: t.f,
                x0: layer.x0, y0: layer.y0, width: layer.width, height: layer.height, revision, time: performance.now()}
        })
    }
    // The device-pixel rectangle of the overlay layer for a cw x ch canvas at transform t: that
    // canvas and a quarter of it on each side, within the board and the overlays' margin around it.
    overlayLayerRect(cw, ch, t) {
        const margin = 4 * basis.r + assets.size, b = this.surfaceCacheBounds
        const x0 = Math.floor(Math.max(-cw / 4, t.a * (b.left - margin) + t.e))
        const y0 = Math.floor(Math.max(-ch / 4, t.d * (b.top - margin) + t.f))
        const x1 = Math.ceil(Math.min(cw * 1.25, t.a * (b.left + b.width + margin) + t.e))
        const y1 = Math.ceil(Math.min(ch * 1.25, t.d * (b.top + b.height + margin) + t.f))
        return {x0, y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0)}
    }
    // The overlays as the overlay pass draws them on a cw x ch canvas at transform t, within
    // overlayLayerRect and on the same pixel grid; drawn into a reused canvas, its corner of
    // width x height.
    drawOverlayLayerRaster(cw, ch, t) {
        const {x0, y0, width, height} = this.overlayLayerRect(cw, ch, t)
        let canvas = this.overlayLayerCanvas
        if (!canvas || canvas.width < width || canvas.height < height) {
            // A quarter more room, up to the largest layer of this canvas, so a zoom does not
            // allocate one at every step; the canvas stays near the size it is drawn at.
            canvas = this.overlayLayerCanvas = document.createElement('canvas')
            canvas.width = Math.max(width, Math.min(Math.ceil(width * 1.25), Math.ceil(cw * 1.5)))
            canvas.height = Math.max(height, Math.min(Math.ceil(height * 1.25), Math.ceil(ch * 1.5)))
        }
        const lctx = canvas.getContext('2d')
        // Only the width x height corner is drawn (clipped) and read.
        lctx.setTransform(1, 0, 0, 1, 0, 0)
        lctx.clearRect(0, 0, width, height)
        lctx.save()
        lctx.beginPath()
        lctx.rect(0, 0, width, height)
        lctx.clip()
        lctx.setTransform(t.a, 0, 0, t.d, t.e - x0, t.f - y0)
        // As drawMain sets them on the main canvas.
        lctx.lineJoin = 'round'
        lctx.lineCap = 'round'
        this.drawStillUnits(lctx, this.surfaceOverlayCells)
        this.drawEntityOverlays(lctx, this.surfaceOverlayCells)
        this.drawInfoTexts(lctx, this.drawRange(lctx))
        lctx.restore()
        return {canvas, width, height, x0, y0, bounds: {left: (x0 - t.e) / t.a, top: (y0 - t.f) / t.d,
            right: (x0 + width - t.e) / t.a, bottom: (y0 + height - t.f) / t.d}}
    }
    // Above the surface cache's scale, pan frames and frames with the camera at rest draw the
    // board's surface, its buildings and the light over them (atmosphericLighting.draw's
    // multiply, color-dodge and bloom) already lit, at the camera's own scale (full resolution).
    // With the camera at rest (not Screen.surfaceMoving) that is the rest snapshot: the canvas
    // as the direct draw leaves it before the units (sky, slab shadow, surface, buildings and
    // light), drawn at the camera's exact transform into a canvas of its size, its light in
    // LIT_REST_BANDS bands of rows one task between frames each, then drawn whole while the
    // camera stays. A pan draws lit tiles: LIT_TILE device-pixel squares on a grid fixed to the
    // transform their view was made at, moved by the camera's shift rounded to whole pixels,
    // built in a task between frames, at most LIT_TILE_BUDGET a frame (those within a tile of the
    // canvas, nearest first; a visible one still missing is built in the frame; none while the
    // snapshot's bands are built). Tiles hold no sky: where the board's
    // lit cells end (the antialiased edge, the light map's spill onto the sky and the fog) they
    // are left unlit in whole LIT_EDGE_BLOCK blocks, which the frame lights over its own pixels
    // (drawLitEdges). A zoom gesture keeps its live light (the direct draw or the surface cache)
    // and builds nothing; the first frame after it at a new scale builds the visible tiles of a
    // view at that scale. A view holds while the board state the surface cache checks is
    // unchanged (its own captured copy, surfaceStateMatches) and the light map raster is the
    // same; a building under construction in view (drawn with its production preview and text)
    // keeps the direct draw.
    // Returns whether it drew the surface; the frame then draws drawLitEdges and the units.
    drawLitView(ctx) {
        const t = ctx.getTransform()
        const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
        if (!otherSettings.atmosphericVisuals || !screen || screen.surfaceZooming ||
                t.b !== 0 || t.c !== 0 || t.a <= 0 || t.d <= 0 || this.constructionInView(ctx)) {
            if (this.litView && (this.litView.a !== t.a || this.litView.d !== t.d))
                this.dropLitView()
            return false
        }
        const cw = ctx.canvas.width, ch = ctx.canvas.height
        let view = this.litView
        if (!view || !this.litViewHolds(ctx, view, t)) {
            this.dropLitView()
            view = this.litView = this.newLitView(t, ctx.canvas)
        }
        const rest = screen.surfaceMoving ? null : this.litRest(view, t, cw, ch)
        if (rest && rest.done === LIT_REST_BANDS) {
            ctx.save()
            ctx.setTransform(1, 0, 0, 1, 0, 0)
            ctx.drawImage(rest.canvas, 0, 0)
            ctx.restore()
            this.litFrame = {view, rest: true}
            this.queueLitTiles(view, t, cw, ch)
            return true
        }
        const ox = Math.round(t.e - view.e), oy = Math.round(t.f - view.f)
        const range = this.litTileRange(cw, ch, ox, oy, 0)
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        for (let v = range.v0; v <= range.v1; ++v) {
            for (let u = range.u0; u <= range.u1; ++u) {
                const tile = this.litTile(view, u, v)
                if (tile)
                    ctx.drawImage(tile, LIT_TILE_PAD, LIT_TILE_PAD, LIT_TILE, LIT_TILE,
                        u * LIT_TILE + ox, v * LIT_TILE + oy, LIT_TILE, LIT_TILE)
            }
        }
        ctx.restore()
        // Tiles more than a tile off the canvas go back to the pool.
        for (const [key, tile] of view.tiles) {
            const [u, v] = key.split(',').map(Number)
            if (u < range.u0 - 1 || u > range.u1 + 1 || v < range.v0 - 1 || v > range.v1 + 1) {
                view.tiles.delete(key)
                this.releaseLitTile(tile)
            }
        }
        this.litFrame = {view, ox, oy, rest: false}
        this.queueLitTiles(view, t, cw, ch)
        return true
    }
    // Whether view still draws this board at transform t's scale: the same scale, light map
    // raster and board state (its own captured copy, compared as the surface cache's).
    litViewHolds(ctx, view, t) {
        return view.a === t.a && view.d === t.d && view.rebuilds === atmosphericLighting.rebuilds &&
            view.mapScale === atmosphericLighting.mapScale &&
            this.withLitState(view, () => this.surfaceStateMatches(ctx))
    }
    // A building under construction drawn on ctx's canvas (not fogged, not observed).
    constructionInView(ctx) {
        const range = this.drawRange(ctx)
        for (let i = range.i0; i < range.i1; ++i) {
            for (let j = range.j0; j < range.j1; ++j) {
                const cell = this.arr[i][j]
                if (cell.building.isBuildingProduction() && (!isFogOfWar || this.fogOfWar[i][j]) &&
                        !this.observedBuilding(cell))
                    return true
            }
        }
        return false
    }
    // Runs fn with view's copy of the surface state in the surface cache's fields.
    withLitState(view, fn) {
        const saved = SURFACE_STATE_FIELDS.map(name => this[name]), overlayCells = this.surfaceOverlayCells
        SURFACE_STATE_FIELDS.forEach((name, k) => { this[name] = view.state[k] })
        this.surfaceOverlayCells = view.overlayCells
        try {
            return fn()
        } finally {
            SURFACE_STATE_FIELDS.forEach((name, k) => {
                view.state[k] = this[name]
                this[name] = saved[k]
            })
            this.surfaceOverlayCells = overlayCells
        }
    }
    // A view at transform t of the camera's canvas main (no tiles yet): the board state now, the
    // light map at the camera's scale and the edge of its lit cells.
    newLitView(t, main) {
        mapDepth.ensureGeometry(this)
        atmosphericLighting.lightMap(this)
        const view = {a: t.a, d: t.d, e: t.e, f: t.f, cw: main.width, ch: main.height, tiles: new Map(),
            rest: null, state: [], overlayCells: [], rebuilds: atmosphericLighting.rebuilds,
            mapScale: atmosphericLighting.mapScale}
        this.withLitState(view, () => this.captureSurfaceState())
        Object.assign(view, this.litEdges(view))
        return view
    }
    // The edge of the board's lit cells: the hexagon sides with a lit cell on one side only, as
    // closed outlines (world points, filled even-odd: the lit cells without the sides and
    // vertices they share inside) and in view's tile pixels as whole LIT_EDGE_BLOCK blocks within
    // the light map's reach (MAP_GROW plus one of its pixels, plus 2 device pixels of
    // antialiasing) of those sides; blocks of a row less than three blocks apart joined, and
    // equal runs of consecutive rows merged (the runs do not overlap).
    litEdges(view) {
        const sides = new Map()
        for (const {pos} of atmosphericLighting.collect(this, false).cells) {
            const points = mapDepth.getVertices(pos)
            for (let k = 0; k < 6; ++k) {
                const p = points[k], q = points[(k + 1) % 6]
                const a = mapDepth.pointKey(p), b = mapDepth.pointKey(q)
                const key = a < b ? a + '|' + b : b + '|' + a
                const side = sides.get(key)
                if (side) ++side.n
                else sides.set(key, {p, q, a, b, n: 1})
            }
        }
        // Outlines: the sides chained end to end (even-odd needs only closed loops of them).
        const ends = new Map(), outline = []
        for (const side of sides.values()) {
            if (side.n !== 1) continue
            for (const key of [side.a, side.b]) {
                if (!ends.has(key)) ends.set(key, [])
                ends.get(key).push(side)
            }
        }
        for (const first of sides.values()) {
            if (first.n !== 1 || first.used) continue
            const loop = [first.p]
            let side = first, at = first.b
            while (side && !side.used) {
                side.used = true
                loop.push(side.a === at ? side.p : side.q)
                side = ends.get(at).find(other => !other.used)
                if (side) at = side.a === at ? side.b : side.a
            }
            outline.push(loop)
        }
        const B = LIT_EDGE_BLOCK
        const margin = (atmosphericLighting.MAP_GROW + 1) * view.a / atmosphericLighting.mapScale + 2
        const rows = new Map()
        for (const {p, q, n} of sides.values()) {
            if (n !== 1) continue
            const x0 = Math.floor((Math.min(p.x, q.x) * view.a + view.e - margin) / B)
            const x1 = Math.floor((Math.max(p.x, q.x) * view.a + view.e + margin) / B)
            const y0 = Math.floor((Math.min(p.y, q.y) * view.d + view.f - margin) / B)
            const y1 = Math.floor((Math.max(p.y, q.y) * view.d + view.f + margin) / B)
            for (let y = y0; y <= y1; ++y) {
                let row = rows.get(y)
                if (!row) rows.set(y, row = new Set())
                for (let x = x0; x <= x1; ++x) row.add(x)
            }
        }
        const edges = [], open = new Map()
        for (const y of [...rows.keys()].sort((a, b) => a - b)) {
            const spans = []
            for (const x of [...rows.get(y)].sort((a, b) => a - b)) {
                const last = spans[spans.length - 1]
                if (last && x - last[1] <= 3) last[1] = x
                else spans.push([x, x])
            }
            const still = new Map()
            for (const [x0, x1] of spans) {
                const key = x0 + ',' + x1, run = open.get(key)
                if (run && run.y + run.h === y * B) {
                    run.h += B
                    still.set(key, run)
                } else {
                    const fresh = {x: x0 * B, y: y * B, w: (x1 - x0 + 1) * B, h: B}
                    edges.push(fresh)
                    still.set(key, fresh)
                }
            }
            open.clear()
            for (const [key, run] of still) open.set(key, run)
        }
        return {edges, outline}
    }
    // view's rest snapshot at transform t for a cw x ch canvas: kept while the camera stays at t
    // and the sky raster is the same, else a fresh one (its canvas reused).
    litRest(view, t, cw, ch) {
        const rest = view.rest
        if (rest && rest.e === t.e && rest.f === t.f && rest.canvas.width === cw && rest.canvas.height === ch &&
                rest.sky === atmosphericBackground.raster)
            return rest
        const canvas = this.litRestCanvas ||= document.createElement('canvas')
        if (canvas.width !== cw || canvas.height !== ch) {
            canvas.width = cw
            canvas.height = ch
        }
        return view.rest = {e: t.e, f: t.f, canvas, sky: atmosphericBackground.raster, done: 0}
    }
    // Step k of view's rest snapshot: first the canvas as drawMain and draw() leave it before the
    // light (sky, slab shadow, surface and buildings; drawn whole, as a clip changes how paths
    // are rasterized), then band k of rows lit: draw()'s multiply, color-dodge and bloom
    // (drawRows).
    buildLitRestBand(view, rest, k) {
        const canvas = rest.canvas, g = canvas.getContext('2d'), cw = canvas.width, ch = canvas.height
        g.save()
        if (k === 0) {
            g.setTransform(1, 0, 0, 1, 0, 0)
            g.clearRect(0, 0, cw, ch)
            atmosphericBackground.draw(g)
            g.lineJoin = 'round'
            g.lineCap = 'round'
            g.setTransform(view.a, 0, 0, view.d, rest.e, rest.f)
            mapDepth.drawAtmosphericShadow(g, this)
            this.drawLitScene(g)
        }
        // The band's rows, and two pixels off the canvas: the clip's bounds stay the canvas's, so
        // the light map's quad is not cut to the band (a cut quad samples the map a hair apart
        // from the direct draw's whole quad, which color-dodge shows as steps of a few levels).
        // Clipped (or on another canvas than the camera's) the blends still round apart from the
        // direct draw's at an odd pixel by up to a few levels; only one unclipped draw over the
        // whole camera canvas, the cost this snapshot saves, matches it at every pixel.
        const y0 = Math.floor(k * ch / LIT_REST_BANDS), y1 = Math.floor((k + 1) * ch / LIT_REST_BANDS)
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.beginPath()
        g.rect(0, y0, cw, y1 - y0)
        g.rect(-2, -2, 1, 1)
        g.rect(cw + 1, ch + 1, 1, 1)
        g.clip()
        g.setTransform(view.a, 0, 0, view.d, rest.e, rest.f)
        atmosphericLighting.drawRows(g, this, y0, y1)
        g.restore()
        ++rest.done
    }
    // The direct draw's surface and buildings on g (before the light). underlay: the world
    // rectangle of the underlay cache drawn (the camera's view by default).
    drawLitScene(g, underlay) {
        mapDepth.drawUnderlay(g, this, underlay)
        mapDepth.renderAtmosphericSides(g)
        this.drawHexagons(g)
        atmosphericLighting.drawShadows(g, this)
        if (isFogOfWar)
            this.drawFogOfWar(g)
        mapDepth.drawRim(g, this)
        this.drawOther(g, 'buildings')
    }
    // The tile index range covering a cw x ch canvas drawn with tiles moved by (ox, oy), grown
    // by ring tiles each way.
    litTileRange(cw, ch, ox, oy, ring) {
        return {u0: Math.floor(-ox / LIT_TILE) - ring, u1: Math.floor((cw - 1 - ox) / LIT_TILE) + ring,
            v0: Math.floor(-oy / LIT_TILE) - ring, v1: Math.floor((ch - 1 - oy) / LIT_TILE) + ring}
    }
    // Tile (u, v) of view, built now if missing; null when the board does not reach it.
    litTile(view, u, v) {
        const key = u + ',' + v
        if (!view.tiles.has(key))
            view.tiles.set(key, this.buildLitTile(view, u, v))
        return view.tiles.get(key)
    }
    // One task between frames: a band of the rest snapshot while the camera is at rest, else up
    // to LIT_TILE_BUDGET of the tiles within a tile of the canvas, nearest its centre first.
    queueLitTiles(view, t, cw, ch) {
        if (this.litTilesQueued)
            return
        const ox = Math.round(t.e - view.e), oy = Math.round(t.f - view.f)
        const range = this.litTileRange(cw, ch, ox, oy, 1), missing = []
        const cu = (cw / 2 - ox) / LIT_TILE - 0.5, cv = (ch / 2 - oy) / LIT_TILE - 0.5
        for (let v = range.v0; v <= range.v1; ++v)
            for (let u = range.u0; u <= range.u1; ++u)
                if (!view.tiles.has(u + ',' + v)) missing.push({u, v, far: Math.hypot(u - cu, v - cv)})
        const rest = view.rest
        const banding = rest && rest.done < LIT_REST_BANDS && rest.e === t.e && rest.f === t.f
        if (!banding && !missing.length)
            return
        missing.sort((a, b) => a.far - b.far)
        this.litTilesQueued = true
        setTimeout(() => {
            this.litTilesQueued = false
            // Nothing is built inside a zoom gesture (its frames keep their live light).
            if (view !== this.litView || gameEvent.screen.surfaceZooming)
                return
            if (banding && !gameEvent.screen.surfaceMoving) {
                if (view.rest === rest && rest.done < LIT_REST_BANDS)
                    this.buildLitRestBand(view, rest, rest.done)
                return
            }
            for (const {u, v} of missing.slice(0, LIT_TILE_BUDGET))
                this.litTile(view, u, v)
        })
    }
    // Draws tile (u, v) of view as the direct draw draws the canvas there, without the sky: the
    // surface, the buildings and the light but in view's edge runs (drawLitEdges lights them in
    // the frame). Its canvas holds LIT_TILE_PAD more pixels each way, never drawn: rasterized
    // paths and samples next to a canvas's edge are not quite those of the same place inside it.
    buildLitTile(view, u, v) {
        const P = LIT_TILE_PAD, S = LIT_TILE + 2 * P, b = mapDepth.bounds
        const x = u * LIT_TILE - P, y = v * LIT_TILE - P
        const left = (x - view.e) / view.a, top = (y - view.f) / view.d
        const right = (x + S - view.e) / view.a, bottom = (y + S - view.f) / view.d
        if (right < b.left || left > b.right || bottom < b.top || top > b.bottom)
            return null
        const canvas = this.litTilePool.pop() || document.createElement('canvas')
        if (canvas.width !== S || canvas.height !== S) {
            canvas.width = S
            canvas.height = S
        }
        canvas.litWindow = {left: Math.min(0, -x), top: Math.min(0, -y),
            right: Math.max(S, view.cw - x), bottom: Math.max(S, view.ch - y)}
        const g = canvas.getContext('2d')
        g.save()
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.clearRect(0, 0, S, S)
        // As drawMain leaves the main canvas before the board.
        g.lineJoin = 'round'
        g.lineCap = 'round'
        g.setTransform(view.a, 0, 0, view.d, view.e - x, view.f - y)
        // The underlay cache's part grown by two of its pixels, so the tile's edge pixels sample
        // it as one draw over the canvas does.
        const cache = mapDepth.underlayCache, grow = cache ? 2 * mapDepth.cacheBounds.width / cache.width : 0
        this.drawLitScene(g, {left: left - grow, top: top - grow, right: right + grow, bottom: bottom + grow})
        // The light everywhere on the tile but in the edge runs (even-odd: they do not overlap).
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.beginPath()
        g.rect(0, 0, S, S)
        for (const run of view.edges) {
            const x0 = Math.max(run.x - x, 0), y0 = Math.max(run.y - y, 0)
            const x1 = Math.min(run.x + run.w - x, S), y1 = Math.min(run.y + run.h - y, S)
            if (x0 < x1 && y0 < y1) g.rect(x0, y0, x1 - x0, y1 - y0)
        }
        g.clip('evenodd')
        g.setTransform(view.a, 0, 0, view.d, view.e - x, view.f - y)
        atmosphericLighting.lightTile(g, this, view.outline)
        g.restore()
        return canvas
    }
    // The frame's light where the lit tiles left the board's edge unlit (litEdges), after the
    // tiles and before the units; none over the rest snapshot.
    drawLitEdges(ctx) {
        const {view, ox, oy, rest} = this.litFrame
        if (rest)
            return
        const cw = ctx.canvas.width, ch = ctx.canvas.height, runs = []
        for (const run of view.edges) {
            const x0 = Math.max(run.x + ox, 0), y0 = Math.max(run.y + oy, 0)
            const x1 = Math.min(run.x + run.w + ox, cw), y1 = Math.min(run.y + run.h + oy, ch)
            if (x0 < x1 && y0 < y1) runs.push({x: x0, y: y0, w: x1 - x0, h: y1 - y0})
        }
        atmosphericLighting.drawEdges(ctx, this, runs)
    }
    releaseLitTile(tile) {
        if (tile && this.litTilePool.length < LIT_TILE_POOL)
            this.litTilePool.push(tile)
    }
    dropLitView() {
        if (this.litView)
            for (const tile of this.litView.tiles.values())
                this.releaseLitTile(tile)
        this.litView = undefined
    }
    // Releases every lit canvas (the surface cache draws the board).
    releaseLitCanvases() {
        this.dropLitView()
        this.litTilePool.length = 0
        if (this.litRestCanvas)
            this.litRestCanvas.width = this.litRestCanvas.height = 0
        this.litRestCanvas = undefined
    }
    // Bytes of the lit canvases: the view's tiles, the pool and the rest snapshot.
    litTileBytes() {
        let tiles = this.litTilePool.length
        if (this.litView)
            for (const tile of this.litView.tiles.values()) if (tile) ++tiles
        const rest = this.litRestCanvas ? this.litRestCanvas.width * this.litRestCanvas.height * 4 : 0
        return tiles * (LIT_TILE + 2 * LIT_TILE_PAD) ** 2 * 4 + rest
    }
    drawMapSurface(ctx) {
        if (this.canUseSurfaceCache() && this.drawSurfaceCache(ctx)) {
            if (this.litView || this.litRestCanvas)
                this.releaseLitCanvases()
            return true
        }
        if (this.drawLitView(ctx))
            return 'lit'

        mapDepth.drawUnderlay(ctx, this)
        mapDepth.renderAtmosphericSides(ctx)
        this.drawHexagons(ctx)
        atmosphericLighting.drawShadows(ctx, this)
        if (isFogOfWar)
            this.drawFogOfWar(ctx)
        mapDepth.drawRim(ctx, this)
        return false
    }
    draw(ctx) {
        // The slab's soft drop shadow on the sky, under the board.
        mapDepth.drawAtmosphericShadow(ctx, this)
        const surface = this.drawMapSurface(ctx)
        // Lit tiles (drawLitView) hold the buildings and the light but for the board's edge.
        const lit = surface === 'lit', cachedScene = surface === true
        // The overlay layer holds the production texts too (drawInfoTexts).
        let layered = false
        if (otherSettings.atmosphericVisuals) {
            // The light map lights terrain and buildings; units, silhouettes and
            // bars come after it, so the multiply never darkens them.
            if (!cachedScene && !lit)
                this.drawOther(ctx, 'buildings')
            if (lit)
                this.drawLitEdges(ctx)
            else
                atmosphericLighting.draw(ctx, this, cachedScene && this.surfaceCacheLit)
            layered = cachedScene && this.drawOverlayLayer(ctx)
            if (!cachedScene) {
                this.dropOverlayLayer()
                this.drawOther(ctx, 'units')
            }
            else if (!layered) {
                this.drawStillUnits(ctx, this.surfaceOverlayCells)
                this.drawEntityOverlays(ctx, this.surfaceOverlayCells)
            }
        }
        else if (cachedScene)
            this.drawEntityOverlays(ctx, this.surfaceOverlayCells)
        else
            this.drawOther(ctx)
        moveTween.draw(ctx)
        if (typeof onlineObservation !== 'undefined')
            onlineObservation.draw(ctx)
        if (typeof remoteEffects !== 'undefined')
            remoteEffects.draw(ctx)
        this.drawLoadingCells(ctx)

        if (this.showChanceOfWinning) {
            this.drawChanceOfWinningText(ctx)
        }

        if (!layered)
            this.drawCellText(ctx)

        attackBorder.draw(ctx)
        border.draw(ctx)
        // One of the frames that follow a zoom input as part of its gesture (Screen.surfaceZooming),
        // or a camera move (Screen.surfaceMoving).
        if (typeof gameEvent !== 'undefined' && gameEvent.screen?.surfaceZoomFrames > 0)
            --gameEvent.screen.surfaceZoomFrames
        if (typeof gameEvent !== 'undefined' && gameEvent.screen?.surfacePanFrames > 0)
            --gameEvent.screen.surfacePanFrames
    }
}

// Hook for a cell-contents request (PRD 7.4): the cells the local fog just uncovered on a
// hidden-information board without contents. No network yet; markCellsKnown answers it.
function onLoadingCellsNeeded(cells) {}

// How far (hex radii) a cell's state reaches into the surface cache's pixels, beyond its drawn
// sprite (Grid.checkRange).
const SURFACE_CHECK_REACH = 8
// The surface cache's captured state (captureSurfaceState), swapped for a lit view's copy (withLitState).
const SURFACE_STATE_FIELDS = ['surfaceCacheLighting', 'surfaceCacheAtmospheric', 'surfaceCacheState',
    'surfaceCacheBuildings', 'surfaceCacheUnits', 'surfaceCacheBuildingImages', 'surfaceCacheUnitImages',
    'surfaceCacheInert', 'surfaceCacheInertUnits', 'surfaceCacheInertBuildings', 'surfaceCacheNatureNames']
// Lit tiles (Grid.drawLitView): side in device pixels (and the margin round it), tiles built
// between two frames, spare canvases kept, the side of the edge blocks the frame lights and the
// rest snapshot's bands.
const LIT_TILE = 256
const LIT_TILE_PAD = 8
const LIT_TILE_BUDGET = 5
const LIT_TILE_POOL = 16
const LIT_EDGE_BLOCK = 16
const LIT_REST_BANDS = 12

// Largest overlay layer (device pixels) a zoom gesture draws its overlays from (Grid.drawOverlayLayer).
const OVERLAY_LAYER_MAX_PIXELS = 1024 * 1024
// Fewest overlay cells in a frame for which a pan draws its overlays from the layer (Grid.drawOverlayLayer).
const OVERLAY_LAYER_MIN_CELLS = 64

function isCoordNotOnMap(coord, xLengthOfMapArray, yLengthOfMapArray) {
    return coord.x < 0 || coord.y < 0 || coord.x >= xLengthOfMapArray || coord.y >= yLengthOfMapArray
}

function coordsEqually(coordOne, coordTwo) {
    return coordOne.x == coordTwo.x && coordOne.y == coordTwo.y
}

function hexagonsEqually(hexagonOne, hexagonTwo) {
    return coordsEqually(hexagonOne.coord, hexagonTwo.coord)
}
