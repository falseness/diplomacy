// Public fog landmarks: goldmines, live demon portals and neutral towns.
// A town owned by a player or by the demons is not public.
function isFogLandmark(building) {
    if (!building || building.killed)
        return false
    if (building.name === 'goldmine' || building.isDemonPortal)
        return true
    return building.name === 'town' && building.player?.isNeutral === true
}
// A live demon portal drawn above the fog (drawFogLandmark) also shows its next demon and the
// rounds left (drawNextProduction) there, as on a visible cell. Nothing else of a fogged cell is.
function fogShowsPortalPreview(building) {
    return !!building?.isDemonPortal && isFogLandmark(building) && gameSettings.drawFogLandmarks === true
}
class Cell {
    // The texts are made when first read: loading a board builds every cell, and the server's rules
    // contexts and replays load many boards they never draw.
    constructor(hexagon, unit, building, coordText, logicText) {
        this.hexagon = hexagon
        this.unit = unit
        this.building = building
        this._coordText = coordText
        this._logicText = logicText
        this._infoText = undefined
    }
    // for escape menu. it writes coords of cells
    get coordText() {
        return this._coordText ??= new CoordText(this.coord.x, this.coord.y, this.coord.x + ' ' + this.coord.y)
    }
    set coordText(text) {
        this._coordText = text
    }
    // for suburbs
    get logicText() {
        if (this._logicText == null) {
            this._logicText = new CoordText(this.coord.x, this.coord.y, '')
            this.logicTextCells?.push(this)
        }
        return this._logicText
    }
    set logicText(text) {
        this._logicText = text
        if (text) this.logicTextCells?.push(this)
    }
    // for now for texts of production
    get infoText() {
        return this._infoText ??= new CoordText(this.coord.x, this.coord.y, '')
    }
    set infoText(text) {
        this._infoText = text
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
        // The overlays' composite on rest frames of the surface-cache path (drawOverlayComposite):
        // the last frame's calls and key, the canvas of its snapshot and the frames drawn.
        this.overlayComposite = undefined
        this.overlaySnapshotCanvas = undefined
        this.overlaySnapshotPacked = undefined
        this.overlaySnapshots = 0
        this.drawSerial = 0
        // Lit tiles and the rest snapshot above the surface cache's scale (drawLitView): the view,
        // the snapshot's canvas, spare tile canvases and what the frame drew.
        this.litView = undefined
        this.litRestCanvas = undefined
        this.litTilePool = []
        this.litTilesQueued = false
        this.litFrame = undefined
        // Patches of the rest snapshot (patchLitView): its buffer, patches made, the last one's region, refusals by reason.
        this.litPatchBuffer = undefined
        this.litPatches = 0
        this.lastLitPatch = undefined
        this.litPatchRefusals = {}
        // The surface cache built between frames (prepareSurfaceCache): the build in progress,
        // whether a stage is queued, when the cache was last compared with the whole board,
        // whether a frame found it not matching, stages run (a count) and a 1x1 canvas the
        // stages draw the raster on.
        this.surfaceCacheBuild = undefined
        this.surfaceCacheQueued = false
        this.surfaceCacheChecked = 0
        this.surfaceCacheDirty = false
        this.surfaceCacheStages = 0
        this.surfaceCacheFlush = undefined
        // Patches of the cache (patchSurfaceCache), the cache pixels they redrew, the last one's region, and the changes
        // rebuilt whole instead, by reason.
        this.surfaceCachePatches = 0
        this.surfaceCachePatchPixels = 0
        this.lastSurfacePatch = undefined
        this.surfacePatchRefusals = {}
        // The patch under way (patchSurfaceCache, one step a frame) and its buffer.
        this.surfacePatchJob = undefined
        this.surfacePatchBuffer = undefined
        // Frames that drew a patch's changed cells over its old picture (drawPatchCells), and its window while it draws.
        this.patchCellFrames = 0
        this.patchCellsWindow = null

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
        // The cells of fill() list themselves once they have a logic text (each unit search cleans it).
        if (this.logicTextCells) {
            for (const cell of this.logicTextCells) {
                const text = cell._logicText
                if (text)
                    text.text = ''
            }
            return
        }
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0; j < this.arr[i].length; ++j) {
                // A text not made yet is empty.
                const text = this.arr[i][j]._logicText
                if (text)
                    text.text = ''
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
    }
    fill(n, m) {
        this.createArr(n, this.arr)
        this.infoTextCells.clear()
        this.logicTextCells = []
        for (let i = 0; i < n; ++i) {
            for (let j = 0; j < m; ++j) {
                this.arr[i][j] = new Cell(new Hexagon(i, j, 0), new Empty(), new Empty())
                this.arr[i][j].logicTextCells = this.logicTextCells
            }
        }
        this.showChanceOfWinning = false
        // Per cell, its text once fillChancesOfWinning set one (a missing text is empty).
        this.chanceOfWinning = []
        this.createArr(n, this.chanceOfWinning)
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
                if (this.chanceOfWinning[i][j])
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
            this.chanceOfWinning[coord.x][coord.y] ??= new CoordText(coord.x, coord.y, '')
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
        // A patch's clipped redraw draws the tiles of the cells reaching its clip (atmosphericLighting.clipWindow).
        const clip = atmosphericLighting.clipWindow
        for (let i = range.i0; i < range.i1; ++i) {
            for (let j = range.j0; j < range.j1; ++j) {
                if (this.arr[i][j].building.isMapEdge)
                    continue
                const observed = this.observedHexagon(this.arr[i][j])
                if (isFogOfWar && !this.fogOfWar[i][j] && !observed)
                    continue
                const hexagon = observed || this.arr[i][j].hexagon
                hexagons.push(hexagon)
                if (i >= drawn.i0 && i < drawn.i1 && (!clip || atmosphericLighting.inClipWindow([{pos: hexagon.calcPos()}]).length))
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
                    else if (fogShowsPortalPreview(cell.building) && cell.infoText.text != '') {
                        cell.infoText.draw(ctx)
                        cell.infoText.text = ''
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
            if (cell.building.isMapEdge || (isFogOfWar && !this.fogOfWar[i][j] && !fogShowsPortalPreview(cell.building)))
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
                if (isFogOfWar && !this.fogOfWar[i][j] || !this.chanceOfWinning[i][j])
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
    // Lake, sea and mountain art is map layout: drawn above the fog too (TASK-1160).
    drawFogLandmark(ctx, building) {
        if (typeof StaticNature !== 'undefined' && building instanceof StaticNature) {
            if (!building.isMapEdge)
                drawCachedImage(ctx, cachedImages[building.bodyImageName], building.pos)
            return
        }
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
                    if (buildings && this.spriteInPatchCells(this.arr[i][j].building))
                        this.drawFogLandmark(ctx, this.arr[i][j].building)
                    if (units && this.fogPortalPreview(this.arr[i][j]))
                        this.arr[i][j].building.drawNextProduction(ctx)
                    continue
                }
                let cell = this.arr[i][j]

                if (!this.observedBuilding(cell)) {
                    if (buildings && this.spriteInPatchCells(cell.building)) cell.building.draw(ctx)
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
    // A fogged cell's live, not observed demon portal whose next demon and rounds left draw (fogShowsPortalPreview).
    fogPortalPreview(cell) {
        return fogShowsPortalPreview(cell.building) && !this.observedBuilding(cell)
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
                    if (this.spriteInPatchCells(this.arr[i][j].building))
                        this.drawFogLandmark(ctx, this.arr[i][j].building)
                    continue
                }
                const cell = this.arr[i][j]
                if (this.isCacheableBuilding(cell.building) && this.spriteInPatchCells(cell.building))
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
            if (isFogOfWar && !this.fogOfWar[i][j]) {
                if (this.fogPortalPreview(cell))
                    cell.building.drawNextProduction(ctx)
                return
            }
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
            // Same order as Unit.draw: the unit's bars, then its body. The cached body sits
            // under the silhouette and under its own moves bar; repaint it on top of both.
            const unit = this.getStillUnit(cell)
            if (unit)
                unit.drawBars(ctx)
            if (unit && (silhouette || shouldShowMovesBar(unit)))
                this.drawEntityBody(ctx, unit)
            if (!observed && building.hasBar)
                buildingBars.push(building)
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
    // During a patch's clipped redraw only the cells that can draw into its clip window.
    drawRange(ctx, fullWidth = false, windowed = false) {
        const all = {i0: 0, i1: this.arr.length, j0: 0, j1: this.arr.length ? this.arr[0].length : 0}
        if (!otherSettings.atmosphericVisuals)
            return all
        const t = ctx.getTransform()
        if (t.b !== 0 || t.c !== 0 || t.a <= 0 || t.d <= 0)
            return all
        const margin = 4 * basis.r + assets.size
        const w = (fullWidth || windowed) && ctx.canvas.litWindow
        let left = ((w ? w.left : 0) - t.e) / t.a - margin, right = ((w ? w.right : ctx.canvas.width) - t.e) / t.a + margin
        let top = ((w ? w.top : 0) - t.f) / t.d - margin, bottom = ((w ? w.bottom : ctx.canvas.height) - t.f) / t.d + margin
        // A patch's clipped redraw (atmosphericLighting.clipWindow): the cells that can draw into its clip.
        const clip = atmosphericLighting.clipWindow
        if (clip) {
            left = Math.max(left, clip.x0 - margin)
            right = Math.min(right, clip.x1 + margin)
            top = Math.max(top, clip.y0 - margin)
            bottom = Math.min(bottom, clip.y1 + margin)
        }
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
                (isFogOfWar && !this.fogOfWar[x][y] && !fogShowsPortalPreview(portal)) || this.observedBuilding(this.arr[x][y]))
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
    // (checkRange), and the others' visibility; otherwise every cell. With atmospheric visuals the
    // units are not compared: they are drawn after the light map (drawStillUnits), never into the
    // cache (drawEntityBodies), so a unit moving or selected leaves its pixels as they are.
    // changes (an array, ctx undefined): every cell is compared and the index of each cell that
    // differs is pushed on it instead of returning false at the first (patchSurfaceCache); false
    // then only for a difference of the whole board (size, visuals, hex radius).
    surfaceStateMatches(ctx, changes) {
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
        const range = observing || changes ? this.checkRange() : this.checkRange(ctx), h = this.arr[0].length
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
        // A differing cell: listed (changes), else the cache does not match.
        const differs = index => {
            if (!changes)
                return true
            changes.push(index)
            return false
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
                // With atmospheric visuals another unit (or one now) on such a cell changes only
                // whether it is an overlay cell.
                const kind = inert[index], sameUnit = cell.unit === inertUnits[index]
                if (kind !== 0 && !observing && (sameUnit || atmospheric) && cell.building === inertBuildings[index] &&
                        (kind < 3 || cell.building.name === natureNames[index])) {
                    const hexagon = cell.hexagon, shown = !fogRow || fogRow[j] ? 1 : 0
                    if (states[index] != this.surfaceStateOf(hexagon, shown) ||
                        lighting[index + 1] !== (!atmospheric || !shown || kind === 2 || hexagon.unknown ? 0 :
                            1 + atmosphericLighting.ownerLight(hexagon)) ||
                        kind >= 3 && buildingImages[index] != cachedImages[natureNames[index]]) {
                        if (differs(index))
                            return false
                    }
                    if (sameUnit ? kind === 4 : this.isOverlayCell(cell))
                        overlayCells.push(index)
                    ++index
                    continue
                }
                if (!observing && cell.unit.constructor === Empty && this.isInertBuilding(cell.building)) {
                    const hexagon = cell.hexagon, shown = !fogRow || fogRow[j] ? 1 : 0
                    if (states[index] != this.surfaceStateOf(hexagon, shown) ||
                        lighting[index + 1] !== (!atmospheric || !shown || hexagon.unknown ? 0 :
                            atmosphericLighting.shownLightValue(hexagon, cell.building)) ||
                        buildings[index] !== undefined || !atmospheric && units[index] !== undefined) {
                        if (differs(index))
                            return false
                    }
                    ++index
                    continue
                }
                if (this.isOverlayCell(cell))
                    overlayCells.push(index)
                const building = this.isCacheableBuilding(cell.building) ?
                    cell.building : undefined
                const unit = atmospheric ? undefined : this.getStillUnit(cell)
                if (buildings[index] != building || !atmospheric && units[index] != unit ||
                    states[index] != this.getSurfaceStateValue(i, j, observing) ||
                    lighting[index + 1] !== atmosphericLighting.lightValue(this, cell, observing) ||
                    buildingImages[index] != (building ?
                        cachedImages[this.getEntityBodyImageName(building)] : undefined) ||
                    !atmospheric && unitImages[index] != (unit ?
                        cachedImages[this.getEntityBodyImageName(unit)] : undefined)) {
                    if (differs(index))
                        return false
                }
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
        // With atmospheric visuals the raster is at most the screen's device-pixel area (WIDTH x HEIGHT): every
        // rebuild, patch and upload of it scales with its area, and frames magnifying it draw the board directly
        // (canUseSurfaceCache).
        const maxCachePixels = otherSettings.atmosphericVisuals ?
            Math.min(12 * 1024 * 1024, WIDTH * HEIGHT) : 12 * 1024 * 1024
        let scale = Math.min(
            1,
            maxCacheDimension / cacheWidth,
            maxCacheDimension / cacheHeight,
            Math.sqrt(maxCachePixels / (cacheWidth * cacheHeight))
        )
        // The raster's whole pixels (startSurfaceCacheBuild rounds its size up) within the screen's area too.
        if (otherSettings.atmosphericVisuals)
            while (scale > 0 && Math.ceil(cacheWidth * scale) * Math.ceil(cacheHeight * scale) > maxCachePixels)
                scale *= 0.999
        return {cacheWidth, cacheHeight, scale}
    }
    // The surface cache's raster, drawn by SURFACE_CACHE_STAGES in order: every stage at once in a
    // frame (createSurfaceCache, classic visuals), or one stage a task between frames with the
    // camera idle (prepareSurfaceCache, atmospheric visuals).
    createSurfaceCache() {
        const build = this.startSurfaceCacheBuild(this.surfaceCache)
        if (!build)
            return false
        for (const stage of SURFACE_CACHE_STAGES)
            stage(this, build)
        this.finishSurfaceCacheBuild(build)
        this.captureSurfaceState()
        return true
    }
    // A build of the cache raster into canvas (reused at the same size) at the board's geometry now.
    startSurfaceCacheBuild(canvas) {
        mapDepth.ensureGeometry(this)
        const geometry = this.getSurfaceCacheGeometry()
        if (geometry.cacheWidth <= 0 || geometry.cacheHeight <= 0)
            return null

        const rasterWidth = Math.max(1, Math.ceil(geometry.cacheWidth * geometry.scale))
        const rasterHeight = Math.max(1, Math.ceil(geometry.cacheHeight * geometry.scale))
        let fresh = false
        if (!canvas || canvas.width != rasterWidth || canvas.height != rasterHeight) {
            canvas = document.createElement('canvas')
            canvas.width = rasterWidth
            canvas.height = rasterHeight
            fresh = true
        }
        const ctx = canvas.getContext('2d')
        if (!ctx)
            return null
        const build = {canvas, ctx, geometry, left: mapDepth.bounds.left, top: mapDepth.bounds.top, stage: 0, lit: false,
            atmospheric: otherSettings.atmosphericVisuals, state: [], overlayCells: []}
        // A cache canvas's first build draws the slab's edge (MapDepth.renderUnderlay's shadow) a little unlike every
        // later build on it, which starts from the context state the first stage leaves (TASK-1280 tools/idem.js):
        // with atmospheric visuals a new canvas runs the first stage once ahead (the build's first stage clears it),
        // so its first build draws what every later build on it draws.
        if (fresh && otherSettings.atmosphericVisuals)
            SURFACE_CACHE_STAGES[0](this, build)
        return build
    }
    finishSurfaceCacheBuild(build) {
        this.surfacePatchJob = undefined
        this.prepareSurfacePatchBuffer(build)
        this.surfaceCacheLit = build.lit
        this.surfaceCache = build.canvas
        this.surfaceCacheScale = build.geometry.scale
        this.surfaceCacheBounds = {
            left: build.left,
            top: build.top,
            width: build.geometry.cacheWidth,
            height: build.geometry.cacheHeight
        }
        ++this.surfaceCacheRevision
    }
    // With atmospheric visuals no frame builds the surface cache: a frame that finds it missing or
    // not matching the board draws the board directly (full resolution, live light) and the cache
    // is built one SURFACE_CACHE_STAGES stage a task between frames while the camera is idle (no
    // zoom gesture or pan, Screen.surfaceMoving), beside the lit view's rest snapshot and tiles.
    // So it is ready before a zoom gesture crosses below its scale and nothing is built, resized or
    // first drawn inside one (its raster's GPU work is flushed in the stage tasks). An idle
    // frame also compares the cache with the whole board every SURFACE_CACHE_CHECK_MS (a frame
    // compares only the cells its view can show), so a change anywhere rebuilds it then. A build
    // draws into the stale cache's canvas (dropped from use at its start) and holds its own
    // copy of the board state, compared with the whole board before each stage (any change
    // starts it over), which becomes the cache's at its end.
    prepareSurfaceCache() {
        const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
        // A patch under way: its next step (patchSurfaceCache), and nothing queued.
        if (this.surfacePatchJob) {
            this.surfacePatchStep()
            return
        }
        if (!otherSettings.atmosphericVisuals || !screen || screen.surfaceMoving || this.surfaceCacheQueued)
            return
        if (!this.surfaceCacheBuild && this.surfaceCache && !this.surfaceCacheDirty &&
                performance.now() - this.surfaceCacheChecked < SURFACE_CACHE_CHECK_MS)
            return
        this.surfaceCacheQueued = true
        setTimeout(() => {
            this.surfaceCacheQueued = false
            // A board replaced meanwhile (another game or tutorial started) builds nothing: its units read the new grid.
            if (this === grid && otherSettings.atmosphericVisuals && !gameEvent.screen.surfaceMoving)
                this.surfaceCacheBuildStep()
        })
    }
    surfaceCacheBuildStep() {
        let build = this.surfaceCacheBuild
        if (!build) {
            this.surfaceCacheChecked = performance.now()
            this.surfaceCacheDirty = false
            if (this.surfaceCache && (this.wholeSurfaceMatches() || this.patchSurfaceCache()))
                return
            build = this.startSurfaceCacheBuild(this.surfaceCache)
            if (!build)
                return
            // The stale raster is no longer drawn; its canvas is drawn over.
            this.surfaceCache = undefined
            this.surfaceCacheBuild = build
            this.withLitState(build, () => this.captureSurfaceState())
        }
        else if (!this.surfaceCacheBuildHolds(build)) {
            this.surfaceCacheBuild = undefined
            this.surfaceCacheBuildStep()
            return
        }
        ++this.surfaceCacheStages
        SURFACE_CACHE_STAGES[build.stage++](this, build)
        // Drawing the canvas has its recorded drawing rasterized now, in this task.
        // A 1x1 canvas made once (assigning its size again would reallocate and clear it every stage).
        let flush = this.surfaceCacheFlush
        if (!flush) {
            flush = this.surfaceCacheFlush = document.createElement('canvas')
            flush.width = flush.height = 1
        }
        flush.getContext('2d').drawImage(build.canvas, 0, 0, 1, 1, 0, 0, 1, 1)
        if (build.stage < SURFACE_CACHE_STAGES.length)
            return
        this.surfaceCacheBuild = undefined
        this.finishSurfaceCacheBuild(build)
        SURFACE_STATE_FIELDS.forEach((name, k) => { this[name] = build.state[k] })
    }
    // Whether build still draws this board: the same geometry, visuals and board state (its copy).
    surfaceCacheBuildHolds(build) {
        mapDepth.ensureGeometry(this)
        const geometry = this.getSurfaceCacheGeometry()
        return build.atmospheric === otherSettings.atmosphericVisuals && build.left === mapDepth.bounds.left &&
            build.top === mapDepth.bounds.top && geometry.scale === build.geometry.scale &&
            geometry.cacheWidth === build.geometry.cacheWidth && geometry.cacheHeight === build.geometry.cacheHeight &&
            this.withLitState(build, () => this.surfaceStateMatches())
    }
    // Whether the surface cache matches the whole board (not only a view's cells).
    wholeSurfaceMatches() {
        const overlayCells = this.surfaceOverlayCells
        this.surfaceOverlayCells = []
        try {
            return this.surfaceStateMatches()
        } finally {
            this.surfaceOverlayCells = overlayCells
        }
    }
    // With atmospheric visuals a cache that differs from the board in some cells (the fog a move uncovers or hides, a
    // capture, a suburb bought, a building or unit gone) is redrawn where those cells change its pixels instead of being
    // dropped and rebuilt in SURFACE_CACHE_STAGES tasks (frames meanwhile drawing the whole board directly). The region:
    // one rectangle of whole cache pixels holding every world rectangle the changed cells draw on
    // (surfaceCacheChangeRects), the light's grown by a light map pixel. The patch runs as SURFACE_PATCH_STEPS, one step
    // a frame (surfacePatchStep, from prepareSurfaceCache; none while the lit view is patched, startLitPatch, and none in
    // the frame that found the change), so no frame does the patch's work at once: the light map's region first
    // (atmosphericLighting.updateMapRegion), then each stage as a build draws it, on the patch buffer (a canvas of the
    // cache's size kept for patches, made with the cache: its contexts' gradients are the cache's, gradientContext) at the
    // cache's transform, clipped to the region grown by SURFACE_PATCH_MARGIN pixels (at scale 1), its clip paths and drawn
    // cells those reaching that (atmosphericLighting.clipWindow, drawRange); then the region is copied into the cache, so
    // the clip's edge, where Chromium draws clip paths, strokes and blurs a little unlike a whole build (TASK-1280
    // tools/cliptest.js), stays in the buffer's margin. Until then frames draw the cache as it was with the changed cells
    // drawn over it in their new state (drawPatchCells), from the frame that found the change. The result is not
    // pixel-identical to a whole build but shows no difference
    // (TASK-1288 tests/client/test-move-work.js --tolerance: at most 0.05% of a frame's pixels, a few levels, after every
    // change and cumulatively). The whole cache is rebuilt instead (refusals counted by reason) for: no cache or one being
    // built, an observed board, another cache size or scale, a whole-board difference (visuals, hex radius, size), a lamp
    // or demon portal shown, hidden or replaced (its light and shadows reach far off; a captured lamp keeps them), a region
    // over SURFACE_PATCH_MAX_AREA of the cache, or a light map no longer that of the cache's state; a board change during a
    // patch starts it over. Grid.surfacePatching false turns patches off. Returns whether the cache is patched to the
    // board (a patch under way, surfacePatchJob, or nothing to patch).
    patchSurfaceCache() {
        if (!Grid.surfacePatching || !otherSettings.atmosphericVisuals || !this.surfaceCache || this.surfaceCacheBuild || !this.surfaceCacheLit ||
                this.isObserving())
            return false
        const job = this.surfacePatchJob
        if (job) {
            if (job.canvas === this.surfaceCache && this.withLitState(job, () => this.wholeSurfaceMatches()))
                return true
            // The board changed again: started over from the cache's own state.
            this.surfacePatchJob = undefined
        }
        // Why a cache is rebuilt whole instead (counted by reason).
        const refuse = reason => {
            this.surfacePatchRefusals[reason] = (this.surfacePatchRefusals[reason] || 0) + 1
            return false
        }
        mapDepth.ensureGeometry(this)
        const geometry = this.getSurfaceCacheGeometry(), b = this.surfaceCacheBounds, canvas = this.surfaceCache
        const scale = geometry.scale, W = canvas.width, H = canvas.height
        if (scale !== this.surfaceCacheScale || mapDepth.bounds.left !== b.left || mapDepth.bounds.top !== b.top ||
                geometry.cacheWidth !== b.width || geometry.cacheHeight !== b.height ||
                W !== Math.max(1, Math.ceil(b.width * scale)) || H !== Math.max(1, Math.ceil(b.height * scale)) || !mapDepth.outline)
            return refuse('geometry')
        const changes = [], overlayCells = this.surfaceOverlayCells
        this.surfaceOverlayCells = []
        let matches
        try {
            matches = this.surfaceStateMatches(undefined, changes)
        } finally {
            this.surfaceOverlayCells = overlayCells
        }
        if (!matches)
            return refuse('board')
        if (!changes.length)
            return true
        const found = this.surfaceCacheChangeRects(changes)
        if (!found)
            return refuse('lamp or portal')
        const inner = this.patchRegion(found, atmosphericLighting.mapPixel(scale), (x, y) => ({x: (x - b.left) * scale, y: (y - b.top) * scale}), W, H)
        if (!inner || inner.w * inner.h > SURFACE_PATCH_MAX_AREA * W * H)
            return refuse('area')
        if (found.light.length && !atmosphericLighting.canUpdateMapRegion(this, scale, this.surfaceCacheLighting))
            return refuse('light map')
        const m = Math.max(SURFACE_PATCH_MARGIN_MIN, Math.ceil(SURFACE_PATCH_MARGIN * scale))
        const outer = pixelRect(inner.x - m, inner.y - m, inner.x + inner.w + m, inner.y + inner.h + m, W, H)
        const buffer = this.surfacePatchBuffer
        if (!buffer || buffer.width !== W || buffer.height !== H || buffer.gradientSource !== canvas.getContext('2d'))
            return refuse('buffer')
        const next = this.surfacePatchJob = {canvas, buffer, geometry, left: b.left, top: b.top, scale, inner, outer,
            window: clipWindowOf(outer, W, H, b.left, b.top, scale, 1.05 * basis.r), light: found.light, boxes: found.cells,
            changed: changes.slice(), sprites: found.sprites, lighting: this.surfaceCacheLighting, cells: changes.length,
            step: 0, ran: null, state: [], overlayCells: [],
            build: {canvas: buffer, ctx: buffer.getContext('2d'), geometry, left: b.left, top: b.top, stage: 0, lit: false,
                atmospheric: true, state: [], overlayCells: []}}
        // The board state the patch draws (each step checks the board still has it).
        this.withLitState(next, () => this.captureSurfaceState())
        return true
    }
    // The pixel rectangle (of a W x H canvas) holding the world rectangles found (surfaceCacheChangeRects: the cells', and
    // the light's grown by texel, a light map pixel), at = world point -> canvas pixels, grown by 2 pixels; null when off it
    // (W Infinity: not cut to a canvas).
    patchRegion(found, texel, at, W, H) {
        const boxes = [...found.cells, ...found.light.map(r => ({x0: r.x0 - texel, y0: r.y0 - texel, x1: r.x1 + texel, y1: r.y1 + texel}))]
        const p0 = at(Math.min(...boxes.map(r => r.x0)), Math.min(...boxes.map(r => r.y0)))
        const p1 = at(Math.max(...boxes.map(r => r.x1)), Math.max(...boxes.map(r => r.y1)))
        const x0 = Math.floor(p0.x) - 2, y0 = Math.floor(p0.y) - 2, x1 = Math.ceil(p1.x) + 2, y1 = Math.ceil(p1.y) + 2
        return W === Infinity ? {x: x0, y: y0, w: x1 - x0, h: y1 - y0} : pixelRect(x0, y0, x1, y1, W, H)
    }
    // The patch buffer of the surface cache (patchSurfaceCache): a canvas of the cache's size drawing with its gradients,
    // made (or resized) with the cache between frames, with the first stage run once ahead as on a new cache canvas
    // (startSurfaceCacheBuild), so no patch makes a canvas or gradients.
    prepareSurfacePatchBuffer(build) {
        if (!otherSettings.atmosphericVisuals || !Grid.surfacePatching)
            return
        let buffer = this.surfacePatchBuffer
        const fresh = !buffer || buffer.width !== build.canvas.width || buffer.height !== build.canvas.height
        if (!buffer)
            buffer = this.surfacePatchBuffer = document.createElement('canvas')
        if (fresh) {
            buffer.width = build.canvas.width
            buffer.height = build.canvas.height
        }
        buffer.gradientSource = build.ctx
        if (fresh)
            SURFACE_CACHE_STAGES[0](this, {...build, canvas: buffer, ctx: buffer.getContext('2d')})
    }
    // One step of the surface cache patch under way (patchSurfaceCache), at most one a frame, not in the frame it was
    // found in, none while the lit view is patched. A board changed since (another state than the patch's), another cache
    // or a build drops the patch, and the next check patches again or rebuilds.
    surfacePatchStep() {
        const job = this.surfacePatchJob
        if (!job || this.litView?.patch)
            return
        if (job.ran === null) {
            job.ran = this.drawSerial
            return
        }
        if (job.ran === this.drawSerial)
            return
        job.ran = this.drawSerial
        if (job.canvas !== this.surfaceCache || this.surfaceCacheBuild || !this.withLitState(job, () => this.wholeSurfaceMatches())) {
            this.surfacePatchJob = undefined
            this.surfaceCacheDirty = true
            return
        }
        SURFACE_PATCH_STEPS[job.step++](this, job)
        if (job.failed) {
            this.surfacePatchJob = undefined
            this.surfaceCacheDirty = true
        }
    }
    // A stage of the patch on its buffer, clipped to the region with its margin, at the cache's transform (the first stage
    // sets it as a build's does; the others get the same calls).
    drawSurfacePatchStage(job, stage) {
        const ctx = job.build.ctx, {outer, scale} = job
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.beginPath()
        ctx.rect(outer.x, outer.y, outer.w, outer.h)
        ctx.clip()
        ctx.beginPath()
        if (stage !== SURFACE_CACHE_STAGES[0]) {
            ctx.scale(scale, scale)
            ctx.translate(-job.left, -job.top)
        }
        atmosphericLighting.clipWindow = job.window
        try {
            stage(this, job.build)
        } finally {
            atmosphericLighting.clipWindow = null
            ctx.restore()
        }
    }
    // The patch's last step: its region copied from the buffer into the cache, which now holds the patch's board state.
    finishSurfacePatch(job) {
        copyCanvasRect(job.buffer, job.canvas, job.inner)
        this.surfaceCacheLit = job.build.lit
        SURFACE_STATE_FIELDS.forEach((name, k) => { this[name] = job.state[k] })
        this.surfacePatchJob = undefined
        ++this.surfaceCacheRevision
        ++this.surfaceCachePatches
        this.surfaceCachePatchPixels += job.inner.w * job.inner.h
        this.lastSurfacePatch = {inner: job.inner, outer: job.outer, cells: job.cells, light: job.light.length}
        this.surfaceCacheChecked = performance.now()
        this.surfaceCacheDirty = false
    }
    // The light map brought up to the board's light state for a patch whose changed cells' light rectangles are rects,
    // found against the light state stored (atmosphericLighting.updateMapRegion at cap's resolution), unless it has it
    // already (another patch brought it). Returns whether the map now has the board's light state.
    patchLightMap(rects, stored, cap) {
        const L = atmosphericLighting
        if (L.map && L.sameLightState(this, L.mapState))
            return true
        return L.updateMapRegion(this, cap, rects, stored)
    }
    // The world rectangles {x0, y0, x1, y1} the cells changes (board indices) draw on in the surface cache, as captured
    // and as now: cells (each its hexagon, with its tile, grout and fog variant, and the sprites of its building then and
    // now with their shadows) and light (the cells whose light value changed: the hexagon, or the territory glow of an
    // owned one); sprites: the rectangles of those sprites and shadows alone for the cells whose sprite changed (another
    // image or none; Grid.drawPatchCells). null when a lamp or a portal is among them.
    surfaceCacheChangeRects(changes) {
        const h = this.arr[0].length, r = basis.r, hex = 1.1 * r
        const {sources} = atmosphericLighting.collect(this, false, false)
        const lighting = this.surfaceCacheLighting, buildings = this.surfaceCacheBuildings, images = this.surfaceCacheBuildingImages
        const inertBuildings = this.surfaceCacheInertBuildings, natureNames = this.surfaceCacheNatureNames
        // A light value's lamp kind (shownLightValue: 1 + 2 x lamp kind + 8 x (owner colour + 1)); the reach of an owned
        // value's territory glow (territoryGlow: the cool spill only for an owner bluer than red).
        const lampKind = v => v > 0 ? ((v - 1) % 8) >> 1 : 0
        const {reach: warm, cool} = atmosphericLighting.TERRITORY
        const glow = v => {
            if (v < 8)
                return 0
            const owner = typeof players !== 'undefined' ? players[(v >> 3) - 1]?.color : null
            return Math.max(warm, !owner || cool && (cool.map || cool.gain) && owner.b > owner.r ? cool.reach : 0) * r
        }
        const cells = [], light = [], sprites = []
        for (const index of changes) {
            const i = Math.floor(index / h), j = index - i * h, cell = this.arr[i][j], c = cell.hexagon.calcPos()
            const box = {x0: c.x - hex, y0: c.y - hex, x1: c.x + hex, y1: c.y + hex}
            const mine = []
            const add = q => {
                mine.push(q)
                box.x0 = Math.min(box.x0, q.x0); box.y0 = Math.min(box.y0, q.y0); box.x1 = Math.max(box.x1, q.x1); box.y1 = Math.max(box.y1, q.y1)
            }
            // A lamp in view before and after with only its owner changed (a capture) keeps every source (collect's sources
            // have no owner: spills, shadows and blooms stay); a lamp shown, hidden or replaced does not.
            const was = lighting[index + 1], now = atmosphericLighting.lightValue(this, cell), keptLamp = lampKind(was)
            if (keptLamp !== lampKind(now))
                return null
            const before = buildings[index] || inertBuildings[index]
            for (const [building, shown] of [[before, [images[index], natureNames[index] && cachedImages[natureNames[index]]]],
                    [cell.building, []]]) {
                if (!building || !building.notEmpty())
                    continue
                if (building.isDemonPortal || atmosphericLighting.emitsLight(building) && !keptLamp)
                    return null
                // Its sprite as cached, as a fog landmark and as drawn now, with its shadow.
                for (const image of new Set([...shown, cachedImages[this.getEntityBodyImageName(building)], cachedImages[building.bodyImageName]])) {
                    if (!image || !image.width)
                        continue
                    add({x0: building.pos.x, y0: building.pos.y, x1: building.pos.x + image.width, y1: building.pos.y + image.height})
                    if (atmosphericLighting.castsShadow(this, i, j, building, building === before))
                        add(atmosphericLighting.shadowBounds(building, image, c, sources))
                }
            }
            cells.push(box)
            // The sprites' rectangles for drawPatchCells only when the cell's sprite changed (another image or none).
            const image = b => b && b.notEmpty() ? cachedImages[this.getEntityBodyImageName(b)] || null : null
            const shownBefore = before && before.notEmpty() ?
                images[index] || natureNames[index] && cachedImages[natureNames[index]] || image(before) : null
            if (shownBefore !== image(cell.building))
                sprites.push(...mine)
            if (was === now)
                continue
            const reach = Math.max(hex, glow(was), glow(now))
            light.push({x0: c.x - reach, y0: c.y - reach, x1: c.x + reach, y1: c.y + reach})
        }
        return {cells, light, sprites}
    }
    canUseSurfaceCache() {
        mapDepth.ensureGeometry(this)
        const cacheScale = this.surfaceCache ? this.surfaceCacheScale :
            this.getSurfaceCacheGeometry().scale
        // Never above the raster's own scale (it would be drawn magnified, below full resolution).
        return canvas.scale <= cacheScale
    }
    drawSurfaceCache(ctx) {
        if (!this.surfaceCache || !this.surfaceStateMatches(ctx)) {
            // With atmospheric visuals no frame builds it (prepareSurfaceCache); a frame with the camera at
            // rest starts the patch of a cache that differs in a few cells (patchSurfaceCache), and the frames
            // until it is done draw the cache as it was (surfacePatchShows).
            if (otherSettings.atmosphericVisuals) {
                if (!this.surfaceCache || typeof gameEvent === 'undefined' || gameEvent.screen?.surfaceMoving && !this.surfacePatchJob ||
                        !this.patchSurfaceCache() || !this.surfacePatchShows(ctx)) {
                    this.surfaceCacheDirty = true
                    return false
                }
            }
            else if (!this.createSurfaceCache())
                return false
        }

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
        if (this.surfacePatchJob)
            this.drawPatchCells(ctx, this.surfacePatchJob, 'cache')
        return true
    }
    // Whether the cache, patched or being patched to the board (patchSurfaceCache), is drawn on ctx: during a patch the
    // board matches the patch's state, and this frame's overlay cells are listed from it (surfaceOverlayCells).
    surfacePatchShows(ctx) {
        const job = this.surfacePatchJob
        if (!job)
            return this.surfaceStateMatches(ctx)
        if (!this.withLitState(job, () => this.surfaceStateMatches(ctx)))
            return false
        this.surfaceOverlayCells.length = 0
        this.surfaceOverlayCells.push(...job.overlayCells)
        return true
    }
    // The world rectangles drawPatchCells draws on (each changed hexagon's box and the sprites' rectangles), whose light
    // atmosphericLighting.regionLight draws.
    patchCellsAreas(job) {
        const h = this.arr[0].length, r = 1.05 * basis.r
        return [...job.changed.map(index => {
            const c = this.arr[Math.floor(index / h)][index % h].hexagon.calcPos()
            return {x0: c.x - r, y0: c.y - r, x1: c.x + r, y1: c.y + r}
        }), ...job.sprites]
    }
    // While drawPatchCells draws: whether entity's sprite reaches its window (one that does not draws nothing in its clip).
    spriteInPatchCells(entity) {
        const w = this.patchCellsWindow
        if (!w)
            return true
        const image = cachedImages[this.getEntityBodyImageName(entity)]
        return !image || !entity.pos || entity.pos.x <= w.x1 && entity.pos.x + image.width >= w.x0 &&
            entity.pos.y <= w.y1 && entity.pos.y + image.height >= w.y0
    }
    // While a patch of the surface cache or of the lit view's rest snapshot is under way (its old picture drawn), the
    // frame draws the changed cells over it in the board's state, as the direct draw does, clipped to their hexagons and,
    // where a building's sprite changed, its sprites and shadows then and now (job.sprites, surfaceCacheChangeRects): the
    // tiles and grout of the cells reaching them, the shadows, the fog, the buildings (path: 'cache' its bodies, as the
    // cache holds them; 'lit' drawOther's, as the snapshot does; only the sprites and shadows reaching them), then the
    // light's multiply and color-dodge clipped to those hexagons (as bake): the light state's part the first frame drawing
    // them drew (job.regionLight: atmosphericLighting.regionLight, small canvases, the light map itself brought up by the
    // patch a frame later), else (no light changed) the light map; then the lamps' bloom there. So the new owner colour,
    // fog variant, building and light show from the frame that found the change, no frame shows the old state again, and
    // the finished patch draws the same cells. Only those cells: no gradient made (the frame's own cached ones), no canvas
    // of 1 MP or more, no light map canvas drawn from in the frame that changed it.
    drawPatchCells(ctx, job, path) {
        const boxes = job.boxes, L = atmosphericLighting
        if (!boxes || !boxes.length || !otherSettings.atmosphericVisuals)
            return
        const areas = this.patchCellsAreas(job), window = patchCellsWindow(areas), h = this.arr[0].length
        // Their rectangles (patchCellsAreas), then the changed hexagons (with the fog's grout reach) and the changed sprites
        // and shadows within them.
        ctx.save()
        ctx.beginPath()
        for (const b of areas)
            ctx.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0)
        ctx.clip()
        ctx.beginPath()
        for (const index of job.changed) {
            const c = this.arr[Math.floor(index / h)][index % h].hexagon.calcPos()
            L.hexagonPath(ctx, c.x, c.y, 1.02 * basis.r)
        }
        for (const b of job.sprites)
            ctx.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0)
        ctx.clip()
        ctx.beginPath()
        const clip = L.clipWindow
        L.clipWindow = window
        // Only the sprites and shadows reaching the window are drawn (spriteInPatchCells, drawShadows).
        this.patchCellsWindow = window
        try {
            this.drawHexagons(ctx)
            L.drawShadows(ctx, this)
            if (isFogOfWar)
                this.drawFogOfWar(ctx)
            if (path === 'lit')
                this.drawOther(ctx, 'buildings')
            else
                this.drawEntityBodies(ctx)
            // The light: the changed light state's part, drawn for the patch by the first frame drawing it (a patch found
            // between frames draws nothing there), else the light map (unchanged).
            if (job.light.length && job.regionLight === undefined)
                job.regionLight = L.regionLight(this, areas, path)
            const map = L.map, bounds = mapDepth.surfaceBounds, light = job.regionLight
            if (map && L.gain && bounds && (light || !job.light.length)) {
                ctx.save()
                L.hexPath(ctx, L.inClipWindow(L.collect(this, false).cells))
                ctx.clip()
                if (light) {
                    for (const [name, op] of [['map', 'multiply'], ['gain', 'color-dodge']]) {
                        ctx.globalCompositeOperation = op
                        ctx.drawImage(light[name], 0, 0, light.w, light.h, light.left, light.top,
                            light.w / light.scale, light.h / light.scale)
                    }
                }
                else
                    L.drawMapPart(ctx, map, window.x0, window.y0, window.x1, window.y1)
                ctx.restore()
                const t = ctx.getTransform()
                L.bloom(ctx, this, {runs: areas.map(b => ({x: b.x0 * t.a + t.e, y: b.y0 * t.d + t.f,
                    w: (b.x1 - b.x0) * t.a, h: (b.y1 - b.y0) * t.d}))})
            }
        } finally {
            L.clipWindow = clip
            this.patchCellsWindow = null
            ctx.restore()
        }
        ++this.patchCellFrames
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
    // Rest frames on the surface-cache path (no zoom gesture or pan, the light baked into the cache, the
    // opaque sky) draw the same pixels frame after frame. Such a frame records its overlays (still units,
    // bars, production previews) and everything drawn after them (moving units, texts, borders) instead of
    // drawing them (CanvasCallRecorder), and drawOverlayComposite then draws them. When the calls and what
    // lies under the overlays (overlayCompositeKey: transform, canvas, sky, slab shadow, surface cache) are
    // those of an earlier frame with a snapshot, the frame draws the snapshot's rectangles over the overlays'
    // pixels (the very pixels the calls drew there, with one drawImage a rectangle in place of every unit's
    // bars and bodies), then the calls after the overlays. Otherwise it makes every call in order (the direct
    // draw), and a frame whose calls and key repeat the previous frame's queues the snapshot
    // (queueOverlaySnapshot, drawn in a task after the frame).
    // Frames drawing a cache whose patch is under way (patchSurfaceCache) draw their overlays directly: the
    // patch's last step changes what lies under them, so a snapshot of them would be made for a few frames only.
    // Returns the recorder, or null when the frame draws its overlays directly.
    beginOverlayComposite(ctx) {
        const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
        const t = ctx.getTransform()
        if (typeof Proxy !== 'function' || debug || !screen || screen.surfaceMoving || !this.surfaceCacheLit || this.surfacePatchJob ||
                t.b !== 0 || t.c !== 0 || t.a <= 0 || t.d <= 0 || !atmosphericBackground.opaqueOver(ctx))
            return null
        const recorder = this.overlayRecorder ||= new CanvasCallRecorder()
        recorder.begin(ctx, this.overlayCompositeKey(ctx, t))
        return recorder
    }
    // What the frame drew under the overlays (drawMain's sky, drawSlabShadow, drawSurfaceCache; the light is
    // in the cache): the same key and calls draw the same pixels.
    overlayCompositeKey(ctx, t) {
        const b = this.surfaceCacheBounds
        return [t.a, t.d, t.e, t.f, ctx.canvas.width, ctx.canvas.height, atmosphericBackground.raster, mapDepth.atmosphericShadow,
            this.surfaceCache, this.surfaceCacheRevision, b.left, b.top, b.width, b.height]
    }
    drawOverlayComposite(ctx, recorder) {
        const last = this.overlayComposite
        if (last && recorder.repeats(last)) {
            if (last.snapshot) {
                // The overlays' state and path calls, their snapshot, then everything drawn after them.
                recorder.replay(ctx, false, 0, recorder.overlayEnd)
                this.drawOverlaySnapshot(ctx, last)
                recorder.replay(ctx, true, recorder.overlayEnd)
                return
            }
            recorder.replay(ctx, true)
            this.queueOverlaySnapshot(ctx.canvas, last)
            return
        }
        recorder.replay(ctx, true)
        const rects = recorder.overlayRects(ctx.canvas.width, ctx.canvas.height)
        this.overlayComposite = rects && {key: recorder.key, calls: recorder.calls, rects, snapshot: null, queued: false,
            overlayEnd: recorder.overlayEnd, state: recorder.state}
    }
    // The snapshot is drawn in a task after the frame, not copied from the main canvas (a readback of the frame):
    // into a canvas of the main canvas's size, at the same pixels, what the frame drew in the rectangles before the
    // overlays' end: the sky (drawMain), the slab shadow and the surface cache (draw, drawMapSurface) under the key's
    // transform, clipped to the rectangles (images, drawn alike clipped), then the overlays' recorded calls in the
    // state they began with, not clipped (a clip changes how Chromium antialiases a path's edges; every pixel they
    // draw is in the rectangles). The same calls on the same pixel grid draw the same pixels (an opaque sky first, so
    // nothing under it shows). Frames draw it before the calls that follow the overlays (drawOverlayComposite). It is
    // not drawn if another frame's calls replaced the composite, or what lies under the overlays changed (the key).
    queueOverlaySnapshot(source, composite) {
        if (composite.queued)
            return
        composite.queued = true
        setTimeout(() => {
            composite.queued = false
            const t = source.getContext('2d').getTransform(), key = composite.key, b = this.surfaceCacheBounds
            const now = [t.a, t.d, t.e, t.f, source.width, source.height, atmosphericBackground.raster, mapDepth.atmosphericShadow,
                this.surfaceCache, this.surfaceCacheRevision, b?.left, b?.top, b?.width, b?.height]
            // Nor while a patch is under way: frames then draw their overlays directly (beginOverlayComposite).
            if (this.overlayComposite !== composite || now.some((v, k) => v !== key[k]) || this.surfacePatchJob ||
                    !atmosphericBackground.opaqueOver(source.getContext('2d')))
                return
            this.renderOverlaySnapshot(source, composite)
        })
    }
    renderOverlaySnapshot(source, composite) {
        let canvas = this.overlaySnapshotCanvas
        if (!canvas) {
            canvas = this.overlaySnapshotCanvas = document.createElement('canvas')
            // A lost backing store loses the snapshot.
            if (typeof canvas.addEventListener === 'function')
                canvas.addEventListener('contextlost', () => { this.overlayComposite = undefined })
        }
        if (canvas.width !== source.width || canvas.height !== source.height) {
            canvas.width = source.width
            canvas.height = source.height
        }
        const g = canvas.getContext('2d'), key = composite.key
        g.save()
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.beginPath()
        for (const r of composite.rects)
            g.rect(r.x, r.y, r.w, r.h)
        g.clip()
        // The clip's rectangles leave the current path; the drawing that follows starts without one.
        g.beginPath()
        applyCanvasState(g, composite.state)
        // As atmosphericBackground.draw and MapDepth.drawAtmosphericShadow draw them (the key holds their rasters).
        const sky = atmosphericBackground.raster, shadow = mapDepth.atmosphericShadow
        g.setTransform(1, 0, 0, 1, 0, 0)
        if (sky.width === source.width) g.drawImage(sky, 0, 0)
        else g.drawImage(sky, 0, 0, source.width, source.height)
        g.setTransform(key[0], 0, 0, key[1], key[2], key[3])
        drawBackgroundHints(g)
        if (shadow) g.drawImage(shadow.canvas, shadow.left, shadow.top, shadow.width, shadow.height)
        // A board changed since the frame (its cache no longer matching) draws no snapshot.
        const drawn = this.drawSurfaceCache(g)
        g.restore()
        if (!drawn)
            return
        g.save()
        g.beginPath()
        applyCanvasState(g, composite.state)
        replayCanvasCalls(g, composite.calls, null, composite.overlayEnd, true, 0, composite.overlayEnd)
        g.restore()
        // Frames draw the rectangles from a small canvas they are packed in (rows, tallest first), copied pixel for
        // pixel: Chromium rasterizes a frame that draws from a canvas the size of the main canvas in the frame itself
        // (about 40 ms a rest frame of the escort recording on this host) and one drawing from a small canvas not.
        const rects = composite.rects.slice().sort((p, q) => q.h - p.h || q.w - p.w)
        const rowWidth = Math.max(OVERLAY_SNAPSHOT_ROW, ...rects.map(r => r.w))
        let x = 0, y = 0, row = 0, width = 0
        for (const r of rects) {
            if (x + r.w > rowWidth) {
                y += row
                x = row = 0
            }
            r.ax = x
            r.ay = y
            x += r.w
            row = Math.max(row, r.h)
            width = Math.max(width, x)
        }
        const height = y + row
        if (!width || !height)
            return
        let packed = this.overlaySnapshotPacked
        if (!packed) {
            packed = this.overlaySnapshotPacked = document.createElement('canvas')
            if (typeof packed.addEventListener === 'function')
                packed.addEventListener('contextlost', () => { this.overlayComposite = undefined })
        }
        if (packed.width < width || packed.height < height) {
            packed.width = Math.max(width, packed.width)
            packed.height = Math.max(height, packed.height)
        }
        const k = packed.getContext('2d')
        k.setTransform(1, 0, 0, 1, 0, 0)
        k.clearRect(0, 0, width, height)
        for (const r of rects)
            k.drawImage(canvas, r.x, r.y, r.w, r.h, r.ax, r.ay, r.w, r.h)
        composite.snapshot = packed
        ++this.overlaySnapshots
    }
    // The snapshot's rectangles over the main canvas, pixel for pixel (opaque, so source-over copies them).
    drawOverlaySnapshot(ctx, composite) {
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
        ctx.filter = 'none'
        ctx.shadowColor = 'rgba(0,0,0,0)'
        for (const r of composite.rects)
            ctx.drawImage(composite.snapshot, r.ax, r.ay, r.w, r.h, r.x, r.y, r.w, r.h)
        ctx.restore()
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
        // The plan frameCover made for this frame at this transform, else a new one.
        const t = ctx.getTransform()
        let plan = this.litPlan
        this.litPlan = undefined
        if (plan === undefined || plan && (plan.t.a !== t.a || plan.t.d !== t.d || plan.t.e !== t.e || plan.t.f !== t.f ||
                plan.t.b !== t.b || plan.t.c !== t.c))
            plan = this.planLitView(ctx)
        if (!plan)
            return false
        const cw = ctx.canvas.width, ch = ctx.canvas.height
        const {view, rest} = plan
        if (rest) {
            ctx.save()
            ctx.setTransform(1, 0, 0, 1, 0, 0)
            ctx.drawImage(rest.canvas, 0, 0)
            ctx.restore()
            this.litFrame = {view, rest: true}
            if (view.patch) {
                this.drawPatchCells(ctx, view.patch, 'lit')
                this.litPatchStep(view)
            }
            else
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
    // Whether ctx's frame draws lit images, and which: false (the live light), else {t, view, rest}
    // with view the lit view at ctx's transform t (made now if it does not hold) and rest its
    // finished rest snapshot (null: the frame draws the tiles).
    planLitView(ctx) {
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
        // A view being patched holds while its patch does (patchLitView).
        if (!view || !(view.patch ? this.patchLitView(ctx, view, t) : this.litViewHolds(ctx, view, t) || this.patchLitView(ctx, view, t))) {
            this.dropLitView()
            view = this.litView = this.newLitView(t, ctx.canvas)
        }
        const rest = screen.surfaceMoving ? null : this.litRest(ctx, view, t, cw, ch)
        return {t, view, rest: rest && rest.done === LIT_REST_BANDS ? rest : null}
    }
    // A board change while the camera rests on the lit view's finished rest snapshot (drawLitView): instead of the view
    // being dropped (a new light map, every visible tile built in the frame, then the snapshot's bands), the snapshot is
    // patched where the changed cells draw, as the surface cache is (patchSurfaceCache). The region: the world rectangles
    // the changed cells draw on (surfaceCacheChangeRects, against the view's own state) at the camera's transform. The
    // patch runs as LIT_PATCH_STEPS, one step a frame (litPatchStep, not in the frame that found the change): the light
    // map's region (atmosphericLighting.updateMapRegion), then the snapshot's drawing (the sky and the slab shadow, each
    // part of drawLitScene, the light map's multiply, its color-dodge with the bloom) on the lit patch buffer (a canvas of
    // the snapshot's size made when a snapshot is finished, drawing with the lit canvases' gradients, litGradientSource) at the
    // camera's transform, clipped to the region grown by LIT_PATCH_MARGIN device pixels (the clip's bounds kept the
    // canvas's, as the snapshot's bands keep them, so scaled images are sampled as unclipped) with the cells reaching it
    // (atmosphericLighting.clipWindow, drawRange); then the region is copied into the snapshot and the view takes the
    // board's state (finishLitPatch). Until then frames draw the snapshot as it was with the changed cells drawn over it in
    // their new state (drawPatchCells), the units live over it (a move's tween runs meanwhile). The view is dropped as
    // before for a lamp or portal change, an observed board, a region over LIT_PATCH_MAX_AREA of the canvas, a light map
    // that cannot be brought up, or a camera moving; a board change during the patch starts it over. Grid.surfacePatching
    // false turns it off.
    // Returns whether view holds: patched now, or a patch under way (view.patch).
    patchLitView(ctx, view, t) {
        const screen = gameEvent.screen, rest = view.rest, cw = ctx.canvas.width, ch = ctx.canvas.height
        const buffer = this.litPatchBuffer
        if (!Grid.surfacePatching || screen.surfaceMoving || this.isObserving() || view.a !== t.a || view.d !== t.d ||
                !rest || rest.done !== LIT_REST_BANDS || rest.e !== t.e || rest.f !== t.f || rest.canvas.width !== cw ||
                rest.canvas.height !== ch || rest.sky !== atmosphericBackground.raster ||
                view.mapScale !== atmosphericLighting.mapScale || !buffer || buffer.width !== cw || buffer.height !== ch ||
                buffer.gradientSource !== litGradientSource()) {
            view.patch = undefined
            return false
        }
        const job = view.patch
        if (job && this.withLitState(job, () => this.surfaceStateMatches(ctx)))
            return true
        view.patch = undefined
        return this.startLitPatch(view, rest)
    }
    // The patch of view's snapshot rest to the board now (patchLitView): view.patch, or the view brought up at once when no
    // pixel of the canvas changes. Returns false when the view is to be dropped instead.
    startLitPatch(view, rest) {
        const L = atmosphericLighting, changes = []
        const matches = this.withLitState(view, () => {
            const overlayCells = this.surfaceOverlayCells
            this.surfaceOverlayCells = []
            try {
                return this.surfaceStateMatches(undefined, changes)
            } finally {
                this.surfaceOverlayCells = overlayCells
            }
        })
        const refuse = reason => {
            this.litPatchRefusals[reason] = (this.litPatchRefusals[reason] || 0) + 1
            return false
        }
        if (!matches)
            return refuse('board')
        const found = changes.length ? this.withLitState(view, () => this.surfaceCacheChangeRects(changes)) : {cells: [], light: []}
        if (!found)
            return refuse('lamp or portal')
        const cw = rest.canvas.width, ch = rest.canvas.height, lighting = view.state[0]
        const at = (x, y) => ({x: x * view.a + rest.e, y: y * view.d + rest.f})
        const region = changes.length ? this.patchRegion(found, L.mapPixel(), at, Infinity, Infinity) : null
        const inner = region && pixelRect(region.x, region.y, region.x + region.w, region.y + region.h, cw, ch)
        if (inner && inner.w * inner.h > LIT_PATCH_MAX_AREA * cw * ch)
            return refuse('area')
        if (found.light.length && !L.canUpdateMapRegion(this, undefined, lighting))
            return refuse('light map')
        const m = LIT_PATCH_MARGIN
        const outer = inner && pixelRect(inner.x - m, inner.y - m, inner.x + inner.w + m, inner.y + inner.h + m, cw, ch)
        const job = {rest, region, inner, outer, light: found.light, boxes: found.cells, changed: changes.slice(),
            sprites: found.sprites, lighting, cells: changes.length, step: 0, ran: null,
            state: [], overlayCells: [], window: outer && clipWindowOf(outer, cw, ch, -rest.e / view.a, -rest.f / view.d, view.a, 1.05 * basis.r)}
        this.withLitState(job, () => this.captureSurfaceState())
        if (inner) {
            view.patch = job
            return true
        }
        // Nothing on the canvas changes: the light map brought up now (its region off the canvas), the view's state taken.
        if (found.light.length && !this.patchLightMap(found.light, lighting))
            return refuse('light map')
        this.finishLitPatch(view, job)
        return true
    }
    // One step of view's snapshot patch (patchLitView) in the frame drawing the snapshot: at most one a frame, none in the
    // frame that found the change. A light map that cannot be brought up drops the view (the next frame makes a new one).
    litPatchStep(view) {
        const job = view.patch
        if (job.ran === null || job.ran === this.drawSerial) {
            job.ran ??= this.drawSerial
            return
        }
        job.ran = this.drawSerial
        LIT_PATCH_STEPS[job.step++](this, job, view)
        if (job.failed) {
            this.litPatchRefusals['light map'] = (this.litPatchRefusals['light map'] || 0) + 1
            this.dropLitView()
        }
    }
    // A part of the snapshot's drawing on the lit patch buffer: clipped to the patch's region with its margin (and two
    // pixels off the canvas, so the clip's bounds are the canvas's: buildLitRestBand), at the camera's transform as the
    // snapshot's, its clip paths and drawn cells those reaching the region.
    drawLitPatch(job, view, part) {
        const g = this.litPatchBuffer.getContext('2d'), cw = g.canvas.width, ch = g.canvas.height, {outer} = job
        g.save()
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.beginPath()
        g.rect(outer.x, outer.y, outer.w, outer.h)
        g.rect(-2, -2, 1, 1)
        g.rect(cw + 1, ch + 1, 1, 1)
        g.clip()
        g.beginPath()
        g.lineJoin = 'round'
        g.lineCap = 'round'
        this.setLitRestTransform(g, view, job.rest)
        atmosphericLighting.clipWindow = job.window
        try {
            part(g)
        } finally {
            atmosphericLighting.clipWindow = null
            g.restore()
        }
    }
    // The patch's last step: its region copied into the snapshot (none when off the canvas); the view takes the board's
    // state (the patch's), the light map's, the edge of the lit cells; the tiles the change reaches are dropped (built
    // again one a task, LIT_TILE_PATCHED_BUDGET); the surface cache is checked next (its own patch).
    finishLitPatch(view, job) {
        if (job.inner)
            copyCanvasRect(this.litPatchBuffer, job.rest.canvas, job.inner)
        SURFACE_STATE_FIELDS.forEach((name, k) => { view.state[k] = job.state[k] })
        view.rebuilds = atmosphericLighting.rebuilds
        view.mapScale = atmosphericLighting.mapScale
        Object.assign(view, this.litEdges(view))
        const r = job.region
        if (r) {
            // The tiles whose squares meet the region grown by the edge runs' reach (a run joins blocks up to 3 apart).
            const grow = 4 * LIT_EDGE_BLOCK, ox = Math.round(job.rest.e - view.e), oy = Math.round(job.rest.f - view.f)
            for (const [key, tile] of view.tiles) {
                const [u, v] = key.split(',').map(Number), x = u * LIT_TILE + ox, y = v * LIT_TILE + oy
                if (x < r.x + r.w + grow && x + LIT_TILE > r.x - grow && y < r.y + r.h + grow && y + LIT_TILE > r.y - grow) {
                    view.tiles.delete(key)
                    this.releaseLitTile(tile)
                    view.patchedTiles = true
                }
            }
        }
        view.patch = undefined
        ++this.litPatches
        this.lastLitPatch = {inner: job.inner, outer: job.outer, cells: job.cells, light: job.light.length}
        this.surfaceCacheDirty = true
    }
    // The lit patch buffer for the finished snapshot rest (patchLitView): a canvas of its size drawing with the lit canvases'
    // gradients (litGradientSource), made or resized between frames with the snapshot's last band, so no patch makes one.
    prepareLitPatchBuffer(rest) {
        if (!Grid.surfacePatching)
            return
        const buffer = this.litPatchBuffer ||= document.createElement('canvas')
        if (buffer.width !== rest.canvas.width || buffer.height !== rest.canvas.height) {
            buffer.width = rest.canvas.width
            buffer.height = rest.canvas.height
        }
        buffer.gradientSource = litGradientSource()
    }
    // The part of ctx's canvas (the main canvas, at the camera's transform, before drawMain draws
    // anything) that this frame's board images leave uncovered, so the sky is drawn only there and
    // the slab shadow only when it reaches there (they are hidden elsewhere): null when the frame
    // draws the board live or from the surface cache (both drawn whole), else {open}, whole device
    // pixel rectangles. The rest snapshot (sky included) covers the canvas; a lit tile covers its
    // square when it is opaque there (litOpaque), so open is the squares of the other tiles and the
    // canvas the tiles do not reach. Only with the opaque sky raster, which then covers the open
    // part with no clear under it. The lit view plan is kept for drawLitView.
    frameCover(ctx) {
        this.litPlan = undefined
        this.coverOpen = undefined
        // The sky's check first: a sky drawn with another key or board invalidates the light first.
        if (!otherSettings.atmosphericVisuals || !atmosphericBackground.opaqueOver(ctx) || this.canUseSurfaceCache())
            return null
        const plan = this.litPlan = this.planLitView(ctx)
        if (!plan)
            return null
        if (plan.rest)
            return {open: this.coverOpen = []}
        const {t, view} = plan, cw = ctx.canvas.width, ch = ctx.canvas.height
        const ox = Math.round(t.e - view.e), oy = Math.round(t.f - view.f)
        const range = this.litTileRange(cw, ch, ox, oy, 0), open = []
        // Rows of tiles cut to the canvas: the runs of tiles without an opaque square, and the
        // canvas above, below, left and right of the tile range (none: the range covers it).
        for (let v = range.v0; v <= range.v1; ++v) {
            const y0 = Math.max(0, v * LIT_TILE + oy), y1 = Math.min(ch, (v + 1) * LIT_TILE + oy)
            let run = null
            for (let u = range.u0; u <= range.u1; ++u) {
                const tile = view.tiles.get(u + ',' + v)
                if (tile && tile.litOpaque === mapDepth.outline && mapDepth.outline) {
                    run = null
                    continue
                }
                const x0 = Math.max(0, u * LIT_TILE + ox), x1 = Math.min(cw, (u + 1) * LIT_TILE + ox)
                if (run)
                    run.w = x1 - run.x
                else
                    open.push(run = {x: x0, y: y0, w: x1 - x0, h: y1 - y0})
            }
        }
        return {open: this.coverOpen = open}
    }
    // Whether the device rectangle x0..x1 x y0..y1 of view's tile pixels is opaque on a lit tile:
    // inside the board outline's loop (with a margin of two device pixels), where the underlay's
    // opaque fill under the surface has full coverage and every later draw on the tile keeps the
    // alpha (source-over, multiply, color-dodge, screen). A loop side whose bounds meet the
    // rectangle counts as crossing it.
    litSquareOpaque(view, x0, y0, x1, y1) {
        const loop = mapDepth.outlineLoop
        if (!loop || !mapDepth.underlayCache)
            return false
        const m = 2
        const left = (x0 - m - view.e) / view.a, right = (x1 + m - view.e) / view.a
        const top = (y0 - m - view.f) / view.d, bottom = (y1 + m - view.f) / view.d
        const cx = (left + right) / 2, cy = (top + bottom) / 2
        let inside = false
        for (let k = 0; k < loop.length; ++k) {
            const p = loop[k], q = loop[(k + 1) % loop.length]
            if (Math.max(p.x, q.x) >= left && Math.min(p.x, q.x) <= right &&
                    Math.max(p.y, q.y) >= top && Math.min(p.y, q.y) <= bottom)
                return false
            if ((p.y > cy) !== (q.y > cy) && cx < p.x + (cy - p.y) * (q.x - p.x) / (q.y - p.y))
                inside = !inside
        }
        return inside
    }
    // The slab's soft drop shadow on the sky (drawn before the surface): skipped when frameCover
    // left no open part of the canvas over it this frame (none over the rest snapshot), else drawn
    // whole, since a clipped scaled draw samples its raster a level apart from the whole one.
    drawSlabShadow(ctx) {
        const open = this.coverOpen
        this.coverOpen = undefined
        if (open)
            mapDepth.ensureGeometry(this)
        const shadow = mapDepth.atmosphericShadow
        if (open && shadow) {
            const t = ctx.getTransform()
            const x0 = t.a * shadow.left + t.e, x1 = x0 + t.a * shadow.width
            const y0 = t.d * shadow.top + t.f, y1 = y0 + t.d * shadow.height
            if (!open.some(r => r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0))
                return
        }
        mapDepth.drawAtmosphericShadow(ctx, this)
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
    // view's rest snapshot at transform t of ctx (a cw x ch canvas): kept while the camera stays at t
    // and the sky raster is the same, else a fresh one (its canvas reused).
    litRest(ctx, view, t, cw, ch) {
        const rest = view.rest
        if (rest && rest.e === t.e && rest.f === t.f && rest.canvas.width === cw && rest.canvas.height === ch &&
                rest.sky === atmosphericBackground.raster)
            return rest
        const canvas = this.litRestCanvas ||= document.createElement('canvas')
        canvas.gradientSource = litGradientSource()
        if (canvas.width !== cw || canvas.height !== ch) {
            canvas.width = cw
            canvas.height = ch
        }
        const camera = typeof cameraTransform !== 'undefined' && typeof mainCtx !== 'undefined' && ctx === mainCtx ? cameraTransform.capture(t) : null
        return view.rest = {e: t.e, f: t.f, canvas, sky: atmosphericBackground.raster, done: 0, camera}
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
            this.setLitRestTransform(g, view, rest)
            drawBackgroundHints(g)
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
        this.setLitRestTransform(g, view, rest)
        atmosphericLighting.drawRows(g, this, y0, y1)
        g.restore()
        if (++rest.done === LIT_REST_BANDS)
            this.prepareLitPatchBuffer(rest)
    }
    // The camera's transform on the rest snapshot's canvas g, made as the main canvas's was
    // (cameraTransform), so its pixels round as the direct draw's.
    setLitRestTransform(g, view, rest) {
        if (rest.camera)
            cameraTransform.apply(g, rest.camera)
        else
            g.setTransform(view.a, 0, 0, view.d, rest.e, rest.f)
    }
    // The direct draw's surface and buildings on g (before the light). underlay: the world
    // rectangle of the underlay cache drawn (the camera's view by default).
    drawLitScene(g, underlay) {
        for (const part of LIT_SCENE_PARTS)
            part(this, g, underlay)
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
        if (!banding && !missing.length) {
            view.patchedTiles = false
            return
        }
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
            // After a patch dropped some, one a task while the camera rests.
            const budget = view.patchedTiles && !gameEvent.screen.surfaceMoving ? LIT_TILE_PATCHED_BUDGET : LIT_TILE_BUDGET
            for (const {u, v} of missing.slice(0, budget))
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
        canvas.gradientSource = litGradientSource()
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
        // The board outline the tile's drawn square is opaque under (frameCover), if any.
        canvas.litOpaque = this.litSquareOpaque(view, x + P, y + P, x + P + LIT_TILE, y + P + LIT_TILE) ? mapDepth.outline : null
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
        if (this.litPatchBuffer)
            this.litPatchBuffer.width = this.litPatchBuffer.height = 0
        this.litPatchBuffer = undefined
    }
    // Bytes of the lit canvases: the view's tiles, the pool, the rest snapshot and the lit patch buffer.
    litTileBytes() {
        let tiles = this.litTilePool.length
        if (this.litView)
            for (const tile of this.litView.tiles.values()) if (tile) ++tiles
        const rest = this.litRestCanvas ? this.litRestCanvas.width * this.litRestCanvas.height * 4 : 0
        const buffer = this.litPatchBuffer ? this.litPatchBuffer.width * this.litPatchBuffer.height * 4 : 0
        return tiles * (LIT_TILE + 2 * LIT_TILE_PAD) ** 2 * 4 + rest + buffer
    }
    drawMapSurface(ctx) {
        // At or below the cache's scale a frame without the cache draws directly.
        const cached = this.canUseSurfaceCache()
        if (cached && this.drawSurfaceCache(ctx)) {
            if (this.litView || this.litRestCanvas)
                this.releaseLitCanvases()
            return true
        }
        if (!cached && this.drawLitView(ctx))
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
        ++this.drawSerial
        // The slab's soft drop shadow on the sky, under the board.
        this.drawSlabShadow(ctx)
        const surface = this.drawMapSurface(ctx)
        // Lit tiles (drawLitView) hold the buildings and the light but for the board's edge.
        const lit = surface === 'lit', cachedScene = surface === true
        // The overlay layer holds the production texts too (drawInfoTexts).
        let layered = false
        // A rest frame's overlays and everything after them, recorded (drawOverlayComposite).
        let composite = null
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
                composite = this.beginOverlayComposite(ctx)
                const target = composite ? composite.context : ctx
                this.drawStillUnits(target, this.surfaceOverlayCells)
                this.drawEntityOverlays(target, this.surfaceOverlayCells)
            }
        }
        else if (cachedScene)
            this.drawEntityOverlays(ctx, this.surfaceOverlayCells)
        else
            this.drawOther(ctx)
        const main = ctx
        if (composite) {
            composite.endOverlays()
            ctx = composite.context
        }
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
        if (composite)
            this.drawOverlayComposite(main, composite)
        this.prepareSurfaceCache()
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

// The world rectangle a patch's changed cells' boxes (surfaceCacheChangeRects' cells) reach, grown by a hexagon's reach: the
// cells drawn over its old picture (Grid.drawPatchCells) and their light (atmosphericLighting.regionLight).
function patchCellsWindow(boxes) {
    const r = 1.05 * basis.r
    return {x0: Math.min(...boxes.map(b => b.x0)) - r, y0: Math.min(...boxes.map(b => b.y0)) - r,
        x1: Math.max(...boxes.map(b => b.x1)) + r, y1: Math.max(...boxes.map(b => b.y1)) + r}
}

// Clips ctx to rects (whole device pixel rectangles {x, y, w, h}); leaves the identity transform.
function clipToDeviceRects(ctx, rects) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.beginPath()
    for (const r of rects)
        ctx.rect(r.x, r.y, r.w, r.h)
    ctx.clip()
}

// The state properties of a 2D context a recording takes from the real one (CanvasCallRecorder.begin).
const CANVAS_STATE = ['globalAlpha', 'globalCompositeOperation', 'fillStyle', 'strokeStyle', 'lineWidth', 'lineJoin',
    'lineCap', 'miterLimit', 'lineDashOffset', 'font', 'textAlign', 'textBaseline', 'direction', 'filter',
    'imageSmoothingEnabled', 'imageSmoothingQuality', 'shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY']
// Drawing calls of a 2D context; the others change its state or path, or only read it.
const CANVAS_DRAW_CALLS = new Set(['fill', 'stroke', 'drawImage', 'fillRect', 'strokeRect', 'clearRect', 'fillText',
    'strokeText', 'putImageData', 'drawFocusIfNeeded'])
// Calls that return a value and change nothing: answered by the recorder's scratch context, not recorded.
const CANVAS_QUERY_CALLS = new Set(['getTransform', 'measureText', 'getLineDash', 'createLinearGradient',
    'createRadialGradient', 'createConicGradient', 'createPattern', 'createImageData', 'getContextAttributes', 'isContextLost'])
// Calls that read the canvas's pixels: a recorded frame has not drawn them yet.
const CANVAS_READ_CALLS = new Set(['getImageData', 'isPointInPath', 'isPointInStroke'])
// Blends that keep an opaque canvas opaque (so a copy of its pixels drawn back with source-over is the same pixels).
const CANVAS_OPAQUE_BLENDS = new Set(['source-over', 'source-atop', 'destination-over', 'lighter', 'multiply', 'screen',
    'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion',
    'hue', 'saturation', 'color', 'luminosity'])

// A stand-in for a 2D context (its context, an ES Proxy) that records the calls and property sets made
// on it instead of drawing (Grid.beginOverlayComposite). The state, path and query calls also go to a
// 1x1 scratch context set up as the real one, so the drawing code reads the transform and state it
// would read there; drawing calls are only recorded. While the overlays are recorded (before
// endOverlays), each drawing call's device-pixel bounds are kept, for the rectangles a snapshot covers.
// replay makes the recorded calls on the real context, in order, in the visualsPerf layer each was
// recorded in (canvasCallLabels, set by render/visualsPerf.js only).
class CanvasCallRecorder {
    constructor() {
        this.scratchCanvas = document.createElement('canvas')
        this.scratch = this.scratchCanvas.getContext('2d')
        this.methods = new Map()
        const recorder = this
        this.context = new Proxy({}, {
            get(_, name) {
                if (name === 'canvas') return recorder.target.canvas
                const scratch = recorder.scratch
                const value = scratch[name]
                if (typeof value !== 'function') return value
                let method = recorder.methods.get(name)
                if (!method) recorder.methods.set(name, method = (...args) => recorder.call(name, args))
                return method
            },
            set(_, name, value) {
                recorder.record({set: name, value, draw: false})
                recorder.scratch[name] = value
                return true
            }
        })
    }
    // A recording on the real context ctx, whose pixels under the overlays have key.
    begin(ctx, key) {
        this.target = ctx
        this.key = key
        this.calls = []
        this.overlays = true
        this.overlayEnd = -1
        this.boxes = []
        // Bounds of a drawing are unknown (a Path2D, text, a shadow or filter), or a call cannot be cached.
        this.unbounded = false
        this.uncacheable = false
        // reset() (else a width assignment, which reallocates the canvas every frame) clears the scratch
        // context's state and path; then it takes ctx's, also kept (state, applyCanvasState).
        const g = this.scratch
        if (typeof g.reset === 'function') g.reset()
        else this.scratchCanvas.width = 1
        const t = ctx.getTransform(), state = this.state = {transform: t}
        g.setTransform(t.a, t.b, t.c, t.d, t.e, t.f)
        for (const name of CANVAS_STATE)
            if (name in ctx) g[name] = state[name] = ctx[name]
        if (typeof ctx.getLineDash === 'function') g.setLineDash(state.lineDash = ctx.getLineDash())
        this.matrix = t
        this.matrixStale = false
        this.path = null
        const labels = typeof canvasCallLabels !== 'undefined' ? canvasCallLabels : null
        this.labels = labels
    }
    endOverlays() {
        this.overlays = false
        this.overlayEnd = this.calls.length
    }
    record(entry) {
        if (this.labels) entry.label = this.labels.current()
        if (entry.set === 'globalCompositeOperation' && !CANVAS_OPAQUE_BLENDS.has(entry.value))
            this.uncacheable = true
        this.calls.push(entry)
    }
    call(name, args) {
        const g = this.scratch
        if (CANVAS_QUERY_CALLS.has(name))
            return g[name](...args)
        if (CANVAS_READ_CALLS.has(name)) {
            this.uncacheable = true
            return this.target[name](...args)
        }
        const draw = CANVAS_DRAW_CALLS.has(name)
        this.record({name, args, draw})
        if (draw) {
            // A cleared or replaced pixel is no longer opaque.
            if (name === 'clearRect' || name === 'putImageData')
                this.uncacheable = true
            if (this.overlays) this.bound(name, args)
            return undefined
        }
        if (this.overlays) this.trace(name, args)
        const result = g[name](...args)
        if (name === 'save' || name === 'restore' || name === 'translate' || name === 'scale' || name === 'rotate' ||
                name === 'transform' || name === 'setTransform' || name === 'resetTransform' || name === 'reset')
            this.matrixStale = true
        return result
    }
    transform() {
        if (this.matrixStale) {
            this.matrix = this.scratch.getTransform()
            this.matrixStale = false
        }
        return this.matrix
    }
    // Grows box by the device point of (x, y).
    grow(box, x, y) {
        const m = this.transform()
        const dx = m.a * x + m.c * y + m.e, dy = m.b * x + m.d * y + m.f
        if (dx < box[0]) box[0] = dx
        if (dy < box[1]) box[1] = dy
        if (dx > box[2]) box[2] = dx
        if (dy > box[3]) box[3] = dy
    }
    // The current path's device bounds (path calls while the overlays are recorded).
    trace(name, a) {
        if (name === 'beginPath') { this.path = [Infinity, Infinity, -Infinity, -Infinity]; return }
        const box = this.path ||= [Infinity, Infinity, -Infinity, -Infinity]
        switch (name) {
        case 'moveTo': case 'lineTo': this.grow(box, a[0], a[1]); break
        case 'arcTo': this.grow(box, a[0], a[1]); this.grow(box, a[2], a[3]); break
        case 'quadraticCurveTo': this.grow(box, a[0], a[1]); this.grow(box, a[2], a[3]); break
        case 'bezierCurveTo': for (let k = 0; k < 6; k += 2) this.grow(box, a[k], a[k + 1]); break
        case 'rect': case 'roundRect':
            this.grow(box, a[0], a[1]); this.grow(box, a[0] + a[2], a[1] + a[3])
            this.grow(box, a[0] + a[2], a[1]); this.grow(box, a[0], a[1] + a[3]); break
        case 'arc': case 'ellipse': {
            const rx = a[2], ry = name === 'arc' ? a[2] : a[3], r = Math.max(rx, ry)
            this.grow(box, a[0] - r, a[1] - r); this.grow(box, a[0] + r, a[1] + r)
            this.grow(box, a[0] - r, a[1] + r); this.grow(box, a[0] + r, a[1] - r); break
        }
        case 'closePath': case 'clip': case 'setLineDash': break
        default:
            // A call this does not follow (a state call leaves the path; others are unknown).
            if (!['save', 'restore', 'translate', 'scale', 'rotate', 'transform', 'setTransform', 'resetTransform'].includes(name))
                this.unbounded = true
        }
    }
    // The device bounds of an overlay drawing call.
    bound(name, a) {
        const g = this.scratch
        if (g.shadowBlur > 0 || g.shadowOffsetX || g.shadowOffsetY || (g.filter && g.filter !== 'none')) {
            this.unbounded = true
            return
        }
        let box = [Infinity, Infinity, -Infinity, -Infinity], grow = 0
        if (name === 'drawImage') {
            const image = a[0]
            const [x, y, w, h] = a.length >= 9 ? [a[5], a[6], a[7], a[8]] : a.length >= 5 ? [a[1], a[2], a[3], a[4]] :
                [a[1], a[2], image.width, image.height]
            this.grow(box, x, y); this.grow(box, x + w, y + h); this.grow(box, x + w, y); this.grow(box, x, y + h)
        }
        else if (name === 'fillRect' || name === 'strokeRect') {
            this.grow(box, a[0], a[1]); this.grow(box, a[0] + a[2], a[1] + a[3])
            this.grow(box, a[0] + a[2], a[1]); this.grow(box, a[0], a[1] + a[3])
            if (name === 'strokeRect') grow = this.strokeReach()
        }
        else if ((name === 'fill' || name === 'stroke') && !(a[0] && typeof a[0] === 'object') && this.path) {
            box = this.path.slice()
            if (name === 'stroke') grow = this.strokeReach()
        }
        else {
            this.unbounded = true
            return
        }
        if (!(box[0] <= box[2] && box[1] <= box[3]))
            return
        this.boxes.push([box[0] - grow, box[1] - grow, box[2] + grow, box[3] + grow])
    }
    // How far a stroke reaches beyond its path (device pixels): half its width, a miter join's spike.
    strokeReach() {
        const g = this.scratch, m = this.transform()
        const scale = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d))
        return g.lineWidth * scale * (g.lineJoin === 'miter' ? Math.max(1, g.miterLimit) : 1)
    }
    // Whether the recording repeats composite's: the same key and the same calls with the same arguments.
    repeats(composite) {
        const a = this.key, b = composite.key
        if (a.length !== b.length || this.calls.length !== composite.calls.length)
            return false
        for (let k = 0; k < a.length; ++k) if (a[k] !== b[k]) return false
        for (let k = 0; k < this.calls.length; ++k) {
            const x = this.calls[k], y = composite.calls[k]
            if (x.set !== y.set || x.name !== y.name)
                return false
            if (x.set !== undefined) {
                if (x.value !== y.value) return false
                continue
            }
            const p = x.args, q = y.args
            if (p.length !== q.length) return false
            for (let i = 0; i < p.length; ++i) if (p[i] !== q[i]) return false
        }
        return true
    }
    // The whole device-pixel rectangles {x, y, w, h} holding every pixel the overlays drew (a pixel's
    // margin round each call's bounds), cut to the canvas; boxes are joined where that adds no area.
    // null when they cannot be cached.
    overlayRects(cw, ch) {
        if (this.unbounded || this.uncacheable)
            return null
        const rects = []
        for (const b of this.boxes) {
            let r = {x0: Math.max(0, Math.floor(b[0]) - 1), y0: Math.max(0, Math.floor(b[1]) - 1),
                x1: Math.min(cw, Math.ceil(b[2]) + 1), y1: Math.min(ch, Math.ceil(b[3]) + 1)}
            if (r.x0 >= r.x1 || r.y0 >= r.y1) continue
            for (let joined = true; joined;) {
                joined = false
                for (let k = 0; k < rects.length; ++k) {
                    const o = rects[k]
                    const u = {x0: Math.min(r.x0, o.x0), y0: Math.min(r.y0, o.y0), x1: Math.max(r.x1, o.x1), y1: Math.max(r.y1, o.y1)}
                    const area = q => (q.x1 - q.x0) * (q.y1 - q.y0)
                    if (area(u) <= area(r) + area(o)) {
                        r = u
                        rects.splice(k, 1)
                        joined = true
                        break
                    }
                }
            }
            rects.push(r)
        }
        return rects.map(r => ({x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0}))
    }
    // Makes the recorded calls on ctx in order: those from the index from to the index to (all by default);
    // overlays false leaves out the overlays' drawing calls.
    replay(ctx, overlays, from = 0, to = this.calls.length) {
        replayCanvasCalls(ctx, this.calls, this.labels, this.overlayEnd, overlays, from, to)
    }
}
// Sets ctx's transform and the state properties of state (CanvasCallRecorder.begin's copy of a context's).
function applyCanvasState(ctx, state) {
    const t = state.transform
    ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f)
    for (const name of CANVAS_STATE)
        if (name in state) ctx[name] = state[name]
    if (state.lineDash) ctx.setLineDash(state.lineDash)
}
// Makes the recorded calls (CanvasCallRecorder) on ctx in order, from the index from to the index to, each in the
// visualsPerf layer it was recorded in (labels); overlays false leaves out the drawing calls before overlayEnd.
function replayCanvasCalls(ctx, calls, labels, overlayEnd, overlays, from, to) {
    const run = (from, to) => {
        for (let k = from; k < to; ++k) {
            const c = calls[k]
            if (c.set !== undefined) ctx[c.set] = c.value
            else if (overlays || !c.draw || k >= overlayEnd) ctx[c.name](...c.args)
        }
    }
    if (!labels) {
        run(from, to)
        return
    }
    for (let k = from; k < to;) {
        let e = k + 1
        while (e < to && calls[e].label === calls[k].label) ++e
        labels.within(calls[k].label, () => run(k, e))
        k = e
    }
}
// Set by render/visualsPerf.js (diagnostics only): {current(), within(label, fn)} for its drawing layers.
let canvasCallLabels = null

// How far (hex radii) a cell's state reaches into the surface cache's pixels, beyond its drawn
// sprite (Grid.checkRange).
const SURFACE_CHECK_REACH = 8
// The surface cache's raster in stages (Grid.createSurfaceCache, Grid.prepareSurfaceCache): the
// calls of a whole build, in its order, on the cache canvas.
const SURFACE_CACHE_STAGES = [
    (grid, build) => {
        const cacheCtx = build.ctx, scale = build.geometry.scale
        cacheCtx.setTransform(1, 0, 0, 1, 0, 0)
        cacheCtx.clearRect(0, 0, build.canvas.width, build.canvas.height)
        cacheCtx.scale(scale, scale)
        cacheCtx.translate(-build.left, -build.top)
        mapDepth.renderUnderlay(cacheCtx, scale)
        mapDepth.renderAtmosphericSides(cacheCtx)
    },
    (grid, build) => grid.drawHexagons(build.ctx),
    (grid, build) => {
        atmosphericLighting.drawShadows(build.ctx, grid)
        if (isFogOfWar)
            grid.drawFogOfWar(build.ctx)
        mapDepth.renderRim(build.ctx)
    },
    (grid, build) => grid.drawEntityBodies(build.ctx),
    (grid, build) => { build.lit = atmosphericLighting.bake(build.ctx, grid, build.geometry.scale) }
]
// The context whose gradients the lit canvases draw with (gradientContext): the camera canvas's, so a lit tile, the rest
// snapshot or the lit patch buffer makes none the frames or another lit canvas made (a new tile made one for each).
function litGradientSource() {
    return typeof mainCtx !== 'undefined' ? mainCtx : null
}
// The surface cache patch's steps (Grid.patchSurfaceCache), one a frame: the light map's region, each stage on the patch
// buffer, the region copied into the cache.
const SURFACE_PATCH_STEPS = [
    (grid, job) => {
        if (job.light.length && !grid.patchLightMap(job.light, job.lighting, job.scale))
            job.failed = 'light map'
    },
    ...SURFACE_CACHE_STAGES.map(stage => (grid, job) => grid.drawSurfacePatchStage(job, stage)),
    (grid, job) => grid.finishSurfacePatch(job)
]
// The largest part of the surface cache's pixels a patch redraws (Grid.patchSurfaceCache); more is rebuilt.
const SURFACE_PATCH_MAX_AREA = 0.25
// Cache pixels round a patch's region redrawn with it and then put back as they were (Grid.patchSurfaceCache): the clip
// rectangle's edge, where Chromium draws clip paths, strokes and blurs unlike a whole build, kept that far off the region;
// at a cache scale below 1 (a raster capped at the screen's area) the same world distance, at least the minimum.
const SURFACE_PATCH_MARGIN = 128
const SURFACE_PATCH_MARGIN_MIN = 32
// false: every change rebuilds the whole cache, as before patches (tests compare a patched cache with a whole build).
Grid.surfacePatching = true
// How often (ms) an idle frame compares the surface cache with the whole board (Grid.prepareSurfaceCache).
const SURFACE_CACHE_CHECK_MS = 500
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
// Tiles built a task while the camera rests after a patch of the view dropped some (Grid.finishLitPatch).
const LIT_TILE_PATCHED_BUDGET = 1
// The direct draw's surface and buildings in parts (Grid.drawLitScene), a part a step of a lit view patch.
const LIT_SCENE_PARTS = [
    (grid, g, underlay) => {
        mapDepth.drawUnderlay(g, grid, underlay)
        mapDepth.renderAtmosphericSides(g)
    },
    (grid, g) => grid.drawHexagons(g),
    (grid, g) => {
        atmosphericLighting.drawShadows(g, grid)
        if (isFogOfWar)
            grid.drawFogOfWar(g)
        mapDepth.drawRim(g, grid)
    },
    (grid, g) => grid.drawOther(g, 'buildings')
]
// A lit view patch's steps (Grid.patchLitView), one a frame: the light map's region; on the lit patch buffer the sky and
// the slab shadow (as the rest snapshot's first band), each part of the scene, the light map's multiply, its color-dodge
// and the bloom (drawRows of the region's rows); the region copied into the snapshot.
const LIT_PATCH_STEPS = [
    (grid, job) => {
        if (job.light.length && !grid.patchLightMap(job.light, job.lighting))
            job.failed = true
    },
    (grid, job, view) => grid.drawLitPatch(job, view, g => {
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.clearRect(0, 0, g.canvas.width, g.canvas.height)
        atmosphericBackground.draw(g)
        grid.setLitRestTransform(g, view, job.rest)
        drawBackgroundHints(g)
        mapDepth.drawAtmosphericShadow(g, grid)
    }),
    ...LIT_SCENE_PARTS.map(part => (grid, job, view) => grid.drawLitPatch(job, view, g => part(grid, g))),
    ...['map', 'gain'].map(light => (grid, job, view) => grid.drawLitPatch(job, view, g =>
        atmosphericLighting.drawRows(g, grid, job.outer.y, job.outer.y + job.outer.h, light))),
    (grid, job, view) => grid.finishLitPatch(view, job)
]
// The largest part of the canvas a lit view patch redraws (Grid.patchLitView); more drops the view.
const LIT_PATCH_MAX_AREA = 0.25
// Device pixels round a lit view patch's region drawn on its buffer and not copied (Grid.patchLitView): the clip's edge,
// where paths, strokes and images are drawn a little unlike unclipped, kept that far off the region.
const LIT_PATCH_MARGIN = 32

// Largest overlay layer (device pixels) a zoom gesture draws its overlays from (Grid.drawOverlayLayer).
const OVERLAY_LAYER_MAX_PIXELS = 1024 * 1024
// Fewest overlay cells in a frame for which a pan draws its overlays from the layer (Grid.drawOverlayLayer).
const OVERLAY_LAYER_MIN_CELLS = 64
// Width (device pixels) of the rows the overlay snapshot's rectangles are packed in (Grid.renderOverlaySnapshot).
const OVERLAY_SNAPSHOT_ROW = 1024

function isCoordNotOnMap(coord, xLengthOfMapArray, yLengthOfMapArray) {
    return coord.x < 0 || coord.y < 0 || coord.x >= xLengthOfMapArray || coord.y >= yLengthOfMapArray
}

function coordsEqually(coordOne, coordTwo) {
    return coordOne.x == coordTwo.x && coordOne.y == coordTwo.y
}

function hexagonsEqually(hexagonOne, hexagonTwo) {
    return coordsEqually(hexagonOne.coord, hexagonTwo.coord)
}
