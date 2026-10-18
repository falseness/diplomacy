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
        this.surfaceCacheRevision = 0
        // Cells of the surface-cache frame that drawStillUnits and drawEntityOverlays may draw on
        // (see isOverlayCell), and the cells whose infoText may hold a text (setInfoText).
        this.surfaceOverlayCells = []
        this.infoTextCells = new Set()

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
    drawRange(ctx, fullWidth = false) {
        const all = {i0: 0, i1: this.arr.length, j0: 0, j1: this.arr.length ? this.arr[0].length : 0}
        if (!otherSettings.atmosphericVisuals)
            return all
        const t = ctx.getTransform()
        if (t.b !== 0 || t.c !== 0 || t.a <= 0 || t.d <= 0)
            return all
        const margin = 4 * basis.r + assets.size
        const left = -t.e / t.a - margin, right = (ctx.canvas.width - t.e) / t.a + margin
        const top = -t.f / t.d - margin, bottom = (ctx.canvas.height - t.f) / t.d + margin
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
        const range = this.drawRange(ctx)
        for (let i = range.i0; i < Math.min(range.i1, this.fogOfWar.length); ++i) {
            for (let j = range.j0; j < Math.min(range.j1, this.fogOfWar[i].length); ++j) {
                if (this.arr[i][j].building.isMapEdge)
                    continue
                if (!this.fogOfWar[i][j] && !this.observedHexagon(this.arr[i][j])) {
                    let hexagon = new FogOfWarHexagon(i, j)
                    hexagon.draw(ctx)
                }
            }
        }
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
    surfaceStateMatches() {
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
            this.surfaceCacheUnitImages.length != this.surfaceCacheState.length)
            return false

        // The same pass lists this frame's overlay cells (surfaceOverlayCells). An unobserved cell
        // with no unit and an inert building (isInertBuilding) has no cached or overlay entity
        // (captureSurfaceState stored none, and no images), so only its state and light values are compared.
        const overlayCells = this.surfaceOverlayCells
        overlayCells.length = 0
        const observing = this.isObserving()
        let index = 0
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                const cell = this.arr[i][j]
                if (!observing && cell.unit.constructor === Empty && this.isInertBuilding(cell.building)) {
                    if (this.surfaceCacheState[index] != this.getSurfaceStateValue(i, j, false) ||
                        lighting[index + 1] !== atmosphericLighting.lightValue(this, cell, false) ||
                        this.surfaceCacheBuildings[index] !== undefined ||
                        this.surfaceCacheUnits[index] !== undefined)
                        return false
                    ++index
                    continue
                }
                if (this.isOverlayCell(cell))
                    overlayCells.push(index)
                const building = this.isCacheableBuilding(cell.building) ?
                    cell.building : undefined
                const unit = this.getStillUnit(cell)
                if (this.surfaceCacheState[index] != this.getSurfaceStateValue(i, j, observing) ||
                    lighting[index + 1] !== atmosphericLighting.lightValue(this, cell, observing) ||
                    this.surfaceCacheBuildings[index] != building ||
                    this.surfaceCacheUnits[index] != unit ||
                    this.surfaceCacheBuildingImages[index] != (building ?
                        cachedImages[this.getEntityBodyImageName(building)] : undefined) ||
                    this.surfaceCacheUnitImages[index] != (unit ?
                        cachedImages[this.getEntityBodyImageName(unit)] : undefined))
                    return false
                ++index
            }
        }
        return true
    }
    captureSurfaceState() {
        const state = new Uint16Array(this.arr.length * this.arr[0].length)
        const buildings = new Array(state.length)
        const units = new Array(state.length)
        const buildingImages = new Array(state.length)
        const unitImages = new Array(state.length)
        const overlayCells = this.surfaceOverlayCells
        overlayCells.length = 0
        let index = 0
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                const cell = this.arr[i][j]
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
            return true

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
        const cachedScene = this.drawMapSurface(ctx)
        if (otherSettings.atmosphericVisuals) {
            // The light map lights terrain and buildings; units, silhouettes and
            // bars come after it, so the multiply never darkens them.
            if (!cachedScene)
                this.drawOther(ctx, 'buildings')
            atmosphericLighting.draw(ctx, this, cachedScene && this.surfaceCacheLit)
            if (cachedScene) {
                this.drawStillUnits(ctx, this.surfaceOverlayCells)
                this.drawEntityOverlays(ctx, this.surfaceOverlayCells)
            }
            else
                this.drawOther(ctx, 'units')
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

        this.drawCellText(ctx)

        attackBorder.draw(ctx)
        border.draw(ctx)
        // One of the frames that follow a zoom input as part of its gesture (Screen.surfaceZooming).
        if (typeof gameEvent !== 'undefined' && gameEvent.screen?.surfaceZoomFrames > 0)
            --gameEvent.screen.surfaceZoomFrames
    }
}

// Hook for a cell-contents request (PRD 7.4): the cells the local fog just uncovered on a
// hidden-information board without contents. No network yet; markCellsKnown answers it.
function onLoadingCellsNeeded(cells) {}

function isCoordNotOnMap(coord, xLengthOfMapArray, yLengthOfMapArray) {
    return coord.x < 0 || coord.y < 0 || coord.x >= xLengthOfMapArray || coord.y >= yLengthOfMapArray
}

function coordsEqually(coordOne, coordTwo) {
    return coordOne.x == coordTwo.x && coordOne.y == coordTwo.y
}

function hexagonsEqually(hexagonOne, hexagonTwo) {
    return coordsEqually(hexagonOne.coord, hexagonTwo.coord)
}
