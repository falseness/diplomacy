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
        // TASK-1375: whether the frame being drawn is a level-of-detail frame (Grid.lodTransform), its recording
        // (beginLodFrame), the last such frame on the main canvas (key, calls, drawSerial) and the frames it held.
        this.lod = false
        // TASK-1395: the zoom raster's board render under way (renderZoomBoard: its level of detail and lit cells' outline)
        // and the renders made.
        this.zoomBoardPass = undefined
        this.zoomBoardRenders = 0
        // TASK-1396: the zoom rasters copied from the held frame (copyZoomBoard) and the slab's footprint they are cut to
        // (zoomSlabPath: per board outline).
        this.zoomBoardCopies = 0
        this.zoomSlab = undefined
        this.lodRecorder = undefined
        this.lodFrame = undefined
        this.lodHolds = 0
        // TASK-1376: the same recording and hold for still frames at any scale (stillFrameCandidate): whether the frame
        // being drawn is recorded as one, the frames held, and the held frame's refreshes (a steady frame made on the
        // canvas, whose calls the next frames repeat).
        this.stillRecording = false
        this.stillHolds = 0
        this.stillRefreshes = 0
        // Lit tiles and the rest snapshot above the surface cache's scale (drawLitView): the view,
        // the snapshot's canvas, spare tile canvases and what the frame drew.
        this.litView = undefined
        this.litRestCanvas = undefined
        this.litTilePool = []
        // TASK-1377: drawLitEdges' last runs and how often they were found.
        this.litEdgeRuns = undefined
        this.litWork = {edgeRuns: 0}
        this.litTilesQueued = false
        this.litFrame = undefined
        // Patches of the rest snapshot (patchLitView): its buffer, patches made, the last one's region, refusals by reason.
        this.litPatchBuffer = undefined
        this.litPatches = 0
        this.lastLitPatch = undefined
        this.litPatchRefusals = {}
        // The cell layers of the surface cache and the lit view's rest snapshot with Grid.liveCellLayer (splitCellLayer),
        // a canvas whose context places their masks, the canvas the frames draw for a cache with its layer, and how many
        // splits, composites, sprites taken (from a split raster or a render), sprites drawn into a layer, refreshes of a
        // layer for a board change (refreshCellLayer) and variants rendered for them were made.
        this.surfaceCellLayer = undefined
        this.litCellLayer = undefined
        this.cellMaskCanvas = undefined
        this.surfaceCacheShown = undefined
        // TASK-1372: the split under way of the surface cache into its cell layer (startCellSplit; the lit view's is
        // view.splitJob) and splits finished in steps.
        this.surfaceSplitJob = undefined
        this.cellSplitSteps = 0
        // TASK-1316: the lit view's rest snapshot with its cell layer composed (prepareLitCellLayer), drawn in one drawImage.
        this.litCellShown = undefined
        this.cellLayerSplits = 0
        this.cellLayerComposites = 0
        this.cellSpriteRenders = 0
        this.cellSpriteDraws = 0
        this.cellLayerRefreshes = 0
        this.cellLayerVariantRenders = 0
        // TASK-1361: sprite canvases the layers let go of, for the next variants (cellSpriteCanvas), and sprites let go of.
        this.cellSpritePool = []
        this.cellSpritesPruned = 0
        // Refreshes that changed a layer (overlayCompositeKey).
        this.cellLayerRevision = 0
        // Caches or lit views dropped as their cell layer could not be brought up to the board (followCellLayer).
        this.cellLayerFollowDrops = 0
        // TASK-1316: lit layer jobs started and finished (startLitLayerJob: new variants rendered a step a frame).
        this.cellLayerJobs = 0
        this.cellLayerJobsDone = 0
        // TASK-1360: the surface cell layer's job under way (startSurfaceLayerJob), whether one failed for the board's states
        // now (they are then drawn at once), its steps run, jobs started and finished, the last one's plan and its stage canvas.
        this.surfaceLayerJob = undefined
        this.surfaceLayerJobFailed = false
        this.surfaceLayerSteps = 0
        this.surfaceLayerJobs = 0
        this.surfaceLayerJobsDone = 0
        this.lastSurfaceLayerJob = undefined
        this.surfaceLayerStage = undefined
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
    // part {k, n}: only the grout (k 0) and the k-th of n equal runs of the tiles, the calls the whole draw makes there in
    // its order (the rest snapshot draws them a task each, LIT_REST_BASE); part.grout: the grout or not whatever k, n 0: no
    // tiles (TASK-1316, LIT_LAYER_PARTS).
    drawHexagons(ctx, part) {
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
        if (otherSettings.atmosphericVisuals && (!part || (part.grout ?? part.k === 0)))
            atmosphericLighting.drawGrout(ctx, hexagons)
        if (part && !part.n)
            return
        const from = part ? Math.floor(part.k * tiles.length / part.n) : 0
        const to = part ? Math.floor((part.k + 1) * tiles.length / part.n) : tiles.length
        for (let k = from; k < to; ++k)
            tiles[k].draw(ctx, atmosphericTransform)
    }
    // Cell texts are set while their cells are drawn (production previews), within the same
    // drawn range, so the range also holds every text to draw and clear.
    drawCellText(ctx) {
        const range = this.drawRange(ctx)
        // A level-of-detail frame has no logic text to draw (lodTransform).
        if (!debug && (!this.drawLogicText || this.lod)) {
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
            // A level-of-detail frame draws no cell text (TASK-1375); it is cleared as a drawn one is.
            if (cell.infoText.text != '' && !this.lod)
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
                    if (units && cell.building.hasBar && !this.lod) tmpBuildings.push(cell.building)
                    if (units && !this.lod) this.drawProductionSilhouette(ctx, cell.building)
                }
                const unit = units && this.getStillUnit(cell)
                // A level-of-detail frame (TASK-1375): the unit's cached body, no bars.
                if (unit && this.lod) this.drawEntityBody(ctx, unit)
                else if (unit) unit.draw(ctx)
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
    // The cell's unit as drawn in place: none while it is tweening (moveTween draws it) or attacking (attackFx draws it).
    getStillUnit(cell) {
        if (typeof onlineObservation !== 'undefined' && onlineObservation.hidesUnit(cell)) return undefined
        return cell.unit.notEmpty() && !moveTween.isActive(cell.unit) &&
            !(typeof attackFx !== 'undefined' && attackFx.hidesUnit(cell.unit)) ? cell.unit : undefined
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
        // A level-of-detail frame (TASK-1375) draws the buildings under construction only: no production silhouettes or
        // bars, so no unit body repainted over them.
        const lod = this.lod
        const range = this.forEachDrawnCell(ctx, cells, (cell, i, j) => {
            if (isFogOfWar && !this.fogOfWar[i][j]) {
                if (this.fogPortalPreview(cell) && !lod)
                    cell.building.drawNextProduction(ctx)
                return
            }
            const building = cell.building
            const observed = this.observedBuilding(cell)
            let silhouette = false
            if (!observed) {
                if (building.isBuildingProduction()) building.draw(ctx)
                else if (lod) {}
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
            const unit = !lod && this.getStillUnit(cell)
            if (unit)
                unit.drawBars(ctx)
            if (unit && (silhouette || shouldShowMovesBar(unit)))
                this.drawEntityBody(ctx, unit)
            if (!observed && building.hasBar && !lod)
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
    // The cell index range whose drawing can reach ctx's canvas: with an axis-aligned transform, the
    // cells centred within a margin of the canvas that holds any hexagon, sprite, shadow, silhouette or
    // bar drawn for a cell; the whole board otherwise (and for the surface cache, whose raster holds the
    // whole board). Per-frame loops skip the other cells, so a zoomed-in large board does not walk every
    // cell every frame. TASK-1376: simple visuals too (they drew the whole board at any zoom).
    // fullWidth keeps every column (whole rows).
    // A lit tile's canvas (buildLitTile) has a window, its part of the camera's canvas: whole rows
    // (fullWidth) and the cells of windowed ranges are those of the window, so the board's union
    // paths (grout, fog, the shadows' clip) hold the cells they hold on the camera's canvas.
    // During a patch's clipped redraw only the cells that can draw into its clip window.
    drawRange(ctx, fullWidth = false, windowed = false) {
        const all = {i0: 0, i1: this.arr.length, j0: 0, j1: this.arr.length ? this.arr[0].length : 0}
        if (!otherSettings.atmosphericVisuals && !Grid.simpleCulling)
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
    // Whether this board's surface cache and lit view rest snapshot are drawn with the cell layer (Grid.liveCellLayer):
    // atmospheric visuals, no online observation (its hexagons and buildings replace the board's).
    cellLayerOn() {
        return Grid.liveCellLayer === true && otherSettings.atmosphericVisuals && !this.isObserving()
    }
    // TASK-1313 (Grid.liveCellLayer): the surface cache or the lit view's rest snapshot (canvas, drawn whole as without the
    // layer) split by its cells' mask (cellLayerCells: every pixel nearer one cell's centre than any other's, that is the
    // cell's hexagon, map edge cells too, and off the board the side cells' nearest pixels; geometric, the same whatever a
    // cell's owner or fog) into the canvas, black at the mask's pixels (their alpha kept), so it holds no tile, owner colour or fog, and the cell layer (layer, a canvas of its
    // size): per cell a sprite of that cell's mask pixels (cellSprite), kept by the cell's variant (cellLayerKey: its owner
    // colour, suburb and fog state, its building's image, and its neighbours' states, whose tiles' edges and fog reach it),
    // drawn into the layer by drawImage (drawCellSprites). The two added ('lighter', each pixel in one of them) are the
    // canvas as drawn, to the bit. A cell whose variant changes then needs only its sprite drawn again (refreshCellLayer,
    // the sprite kept or rendered once for the variant), never the cache built or patched. place sets the canvas's
    // transform on a context. layer.cellBox: the pixel rectangle the cells' boxes span, all a frame need draw of it.
    splitCellLayer(canvas, layer, place) {
        return this.withCellReach(() => this.splitCellLayerNow(canvas, layer, place))
    }
    splitCellLayerNow(canvas, layer, place) {
        const W = canvas.width, H = canvas.height
        if (layer.width !== W || layer.height !== H) {
            layer.width = W
            layer.height = H
        }
        const mask = layer.mask ||= document.createElement('canvas')
        mask.width = W
        mask.height = H
        const {cells, box, path} = this.cellLayerCells(W, H, place)
        fillCellMask(mask.getContext('2d'), path)
        Object.assign(layer, {cells, cellBox: box, sprites: new Map(), stale: null, byIndex: new Map(cells.map(c => [c.index, c])),
            place, states: this.cellLayerStates()})
        for (const cell of cells)
            this.cellSprite(layer, cell, canvas)
        const whole = {x: 0, y: 0, w: W, h: H}
        this.drawCellSprites(layer, whole)
        this.cutCellLayer(canvas, layer, whole)
        ++this.cellLayerSplits
        return layer
    }
    // TASK-1372 (Grid.cellLayerSplitJobs): splitCellLayer's work in steps (cellSplitStep, CELL_SPLIT_CELLS cells' sprites a
    // step, those nearest centre, canvas's pixel the camera's view is centred on, first), so no frame makes every cell's
    // sprite. Until the last step canvas is left whole and the layer holds no cells (nothing draws it or brings it up,
    // followCellLayer): the frames draw canvas uncut, which is the canvas and the layer added. Each cell's variant and the
    // cell states are taken now, the states of canvas's board (a step finding the board's states changed ends the job,
    // its owner drops it, holds). The last step cuts canvas and makes the layer the split one, as splitCellLayer leaves it
    // (each sprite drawn into the cleared layer as made: their pixels are disjoint, so the layer is the one drawCellSprites
    // draws), then runs finish(layer).
    startCellSplit(canvas, layer, place, centre, finish) {
        return this.withCellReach(() => {
            const W = canvas.width, H = canvas.height
            if (layer.width !== W || layer.height !== H) {
                layer.width = W
                layer.height = H
            }
            const g = layer.getContext('2d')
            g.save()
            g.setTransform(1, 0, 0, 1, 0, 0)
            g.clearRect(0, 0, W, H)
            g.restore()
            const mask = layer.mask ||= document.createElement('canvas')
            mask.width = W
            mask.height = H
            const {cells, box, path} = this.cellLayerCells(W, H, place)
            fillCellMask(mask.getContext('2d'), path)
            for (const cell of cells)
                cell.key = this.cellLayerKey(cell.i, cell.j)
            const far = ({box}) => Math.hypot(box.x + box.w / 2 - centre.x, box.y + box.h / 2 - centre.y)
            Object.assign(layer, {cells: undefined, cellBox: undefined, sprites: new Map(), stale: null, byIndex: undefined, place,
                states: undefined})
            return {canvas, layer, place, cells, box, states: this.cellLayerStates(), next: 0, finish,
                order: cells.map(cell => [far(cell), cell]).sort((a, b) => a[0] - b[0]).map(([, cell]) => cell)}
        })
    }
    // One step of a split job (startCellSplit). Returns whether the split is finished.
    cellSplitStep(job) {
        const {layer, canvas, order} = job
        ++this.cellSplitSteps
        const g = layer.getContext('2d')
        g.save()
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.globalCompositeOperation = 'lighter'
        for (const end = Math.min(job.next + CELL_SPLIT_CELLS, order.length); job.next < end; ++job.next) {
            const cell = order[job.next]
            g.drawImage(this.cellSprite(layer, cell, canvas, cell.key), cell.box.x, cell.box.y)
            ++this.cellSpriteDraws
        }
        g.restore()
        if (job.next < order.length)
            return false
        Object.assign(layer, {cells: job.cells, cellBox: job.box, byIndex: new Map(job.cells.map(c => [c.index, c])),
            states: job.states})
        this.cutCellLayer(canvas, layer, {x: 0, y: 0, w: canvas.width, h: canvas.height})
        ++this.cellLayerSplits
        job.finish(layer)
        return true
    }
    // The surface cache's split job (prepareSurfaceCellLayer): one step a task between frames (prepareSurfaceCache), none
    // while a patch of the cache is under way (its end splits the cache again). A job whose cache or layer is no longer the
    // drawn one is dropped; one whose board states changed drops the cache too (rebuilt between frames), as its uncut
    // canvas shows the cells as they were.
    surfaceSplitStep() {
        const job = this.surfaceSplitJob
        if (!job || this.surfacePatchJob)
            return
        if (!this.surfaceSplitHolds(job))
            return
        if (this.cellSplitStep(job))
            this.surfaceSplitJob = undefined
    }
    surfaceSplitHolds(job) {
        if (job.canvas !== this.surfaceCache || job.layer !== this.surfaceCellLayer || this.surfaceCacheBuild) {
            this.surfaceSplitJob = undefined
            return false
        }
        if (this.cellLayerStatesAre(job.states))
            return true
        this.surfaceSplitJob = undefined
        this.surfaceCache = undefined
        this.surfaceCacheDirty = true
        return false
    }
    // A patch of canvas's pixel rectangle rect (copy draws it, from the patch buffer) with the canvas split (splitCellLayer):
    // the rectangle grown to the boxes of the cells meeting it (region) put back whole (the cut canvas with its layer added),
    // copy run, those cells' sprites taken again from the canvas (their variants now), the layer drawn there from the
    // sprites and the canvas cut there again. Returns the region.
    resplitCellLayer(canvas, layer, rect, copy) {
        return this.withCellReach(() => this.resplitCellLayerNow(canvas, layer, rect, copy))
    }
    resplitCellLayerNow(canvas, layer, rect, copy) {
        const meets = (b, r) => b.x < r.x + r.w && r.x < b.x + b.w && b.y < r.y + r.h && r.y < b.y + b.h
        const touched = layer.cells.filter(c => meets(c.box, rect))
        let x0 = rect.x, y0 = rect.y, x1 = rect.x + rect.w, y1 = rect.y + rect.h
        for (const {box} of touched) {
            x0 = Math.min(x0, box.x); y0 = Math.min(y0, box.y)
            x1 = Math.max(x1, box.x + box.w); y1 = Math.max(y1, box.y + box.h)
        }
        const region = pixelRect(x0, y0, x1, y1, canvas.width, canvas.height)
        this.composeCellLayer(canvas, canvas, layer, region)
        copy()
        for (const cell of touched)
            this.cellSprite(layer, cell, canvas)
        this.drawCellSprites(layer, region)
        this.cutCellLayer(canvas, layer, region)
        ++this.cellLayerSplits
        return region
    }
    // The mask of a W x H canvas at the transform place sets (splitCellLayer): each cell's pixels (centre nearer its centre
    // than any other cell's, the one of lower index on a tie: cells' hexagons, disjoint, map edge cells included), and
    // (TASK-1315) for a cell at the board's side, the pixels off the board nearer its centre than any other side cell's
    // within CELL_LAYER_EDGE_REACH of it (the slab's side and shadow, the outline's antialiasing: they follow its fog and
    // tile). {cells: per cell {index, i, j, box (its pixels' rectangle grown by a pixel, cut to the canvas), alpha (per box
    // pixel 255 when the cell's, else 0; path: those pixels as rectangles in the box, maskPath), key}, box: the rectangle the
    // boxes span or null, path: the mask's pixels as rectangles (maskPath; filled black, fillCellMask, the mask: opaque at the
    // cells' pixels, transparent elsewhere)}. TASK-1371: it depends on the geometry and scale only (not on the board's state),
    // so it is kept by them (cellMaskCache; the cells' alpha and paths and the whole path are shared, read only).
    cellLayerCells(W, H, place) {
        const g = (this.cellMaskCanvas ||= document.createElement('canvas')).getContext('2d')
        g.save()
        g.setTransform(1, 0, 0, 1, 0, 0)
        place(g)
        const t = g.getTransform()
        g.restore()
        const {a, d, e, f} = t, w = this.arr.length, h = this.arr[0].length
        const reach = CELL_LAYER_EDGE_REACH * basis.r + (mapDepth.depth || 0) + (mapDepth.shadowOffset || 0) + 2 * (mapDepth.shadowBlur || 0)
        const key = [W, H, a, d, e, f, basis.offset.x, basis.offset.y, basis.r, w, h, reach].join()
        let mask = cellMaskCache.get(key)
        cellMaskCache.delete(key)
        if (mask)
            ++Grid.cellMaskWork.hits
        else
            mask = this.buildCellMask(W, H, a, d, e, f, reach)
        cellMaskCache.set(key, mask)
        if (cellMaskCache.size > CELL_MASK_CACHE)
            cellMaskCache.delete(cellMaskCache.keys().next().value)
        return {cells: mask.cells.map(c => ({...c})), box: mask.box, path: mask.path}
    }
    // cellLayerCells's mask built (x' = a x + e, y' = d y + f). Each row of a cell's box splits by the bisectors with the
    // cells round it: the run surely the cell's (every bisector at least CELL_MASK_MARGIN pixels away on the cell's side),
    // filled; the pixels surely another board cell's (or, for a side cell, surely beyond its reach), skipped; and the rest
    // (near a bisector, and a side cell's pixels off the board) tested against the neighbours' centres as before, so the
    // bits are the same as testing every pixel of the box. Grid.cellMaskWork counts the builds, tested pixels and distances.
    buildCellMask(W, H, a, d, e, f, reach) {
        const ox = basis.offset.x, oy = basis.offset.y, rx = basis.r, w = this.arr.length, h = this.arr[0].length
        // Per pixel its cell (board index + 1, 0: none) and, off the board, its squared distance to that cell's centre.
        const owner = new Int32Array(W * H), far = new Float32Array(W * H)
        const centre = (i, j) => [i * ox, (2 * j + (i & 1)) * oy]
        const boxOf = (cx, cy, rx0, ry0) => pixelRect(Math.floor((cx - rx0) * a + e) - 1, Math.floor((cy - ry0) * d + f) - 1,
            Math.ceil((cx + rx0) * a + e) + 1, Math.ceil((cy + ry0) * d + f) + 1, W, H)
        // Per cell the rectangle its pixels were given in (x1 < 0: none).
        const x0 = new Int32Array(w * h).fill(W), y0 = new Int32Array(w * h).fill(H), x1 = new Int32Array(w * h).fill(-1), y1 = new Int32Array(w * h).fill(-1)
        // A pixel's side of a bisector is sure margin (world units) off it (rounding is far smaller); with no positive scale
        // every pixel of a box is tested.
        const sure = a > 0 && d > 0 && Number.isFinite(a + d + e + f), margin = CELL_MASK_MARGIN / Math.min(a, d)
        // The world x range of the row at wy surely nearer (cx, cy) than every site [x, y, t] (sign 1), or not surely nearer
        // one of them (sign -1). Along the row a site's squared distance minus the centre's is k - 2 dx wx, and it is t (twice
        // the sites' distance times the margin) where the pixel is the margin off their bisector.
        const range = (cx, cy, sites, wy, sign) => {
            let lo = -Infinity, hi = Infinity
            for (const [nx, ny, t] of sites) {
                const dx = nx - cx, k = nx * nx - cx * cx + (wy - ny) * (wy - ny) - (wy - cy) * (wy - cy), c = sign * t
                if (dx > 0)
                    hi = Math.min(hi, (k - c) / (2 * dx))
                else if (dx < 0)
                    lo = Math.max(lo, (k - c) / (2 * dx))
                else if (k <= c)
                    lo = Infinity
            }
            return [lo, hi]
        }
        const site = (cx, cy, nx, ny) => [nx, ny, 2 * Math.hypot(nx - cx, ny - cy) * margin]
        const R = rx + reach, far2 = 2 * (R + margin) + oy, ki = Math.ceil(far2 / ox), kj = Math.ceil(far2 / (2 * oy)) + 1
        const sides = []
        let tests = 0, distances = 0
        for (let i = 0; i < w; ++i) {
            for (let j = 0; j < h; ++j) {
                // Centres as calcPos (biasToTransition), the candidates' those of the cells round it (on the board or not).
                const [cx, cy] = centre(i, j), near = [], sites = [], blockers = [], own = i * 100000 + j, id = i * h + j + 1
                let side = false
                for (let di = -1; di <= 1; ++di)
                    for (let dj = -1; dj <= 1; ++dj)
                        if (di || dj) {
                            const [nx, ny] = centre(i + di, j + dj)
                            near.push([nx, ny, (i + di) * 100000 + j + dj])
                            sites.push(site(cx, cy, nx, ny))
                            if (i + di < 0 || i + di >= w || j + dj < 0 || j + dj >= h)
                                side = true
                            else
                                blockers.push(site(cx, cy, nx, ny))
                        }
                const box = side ? boxOf(cx, cy, R, oy + reach) : boxOf(cx, cy, rx, oy)
                if (!box)
                    continue
                // A side cell's rivals off the board: every board cell whose centre is near enough to be nearer a pixel within
                // the reach (whichever of them takes it, the nearest does).
                const rivals = []
                if (side) {
                    sides.push(id - 1)
                    for (let di = -ki; di <= ki; ++di)
                        for (let dj = -kj; dj <= kj; ++dj) {
                            const [nx, ny] = centre(i + di, j + dj)
                            if ((di || dj) && i + di >= 0 && i + di < w && j + dj >= 0 && j + dj < h && Math.hypot(nx - cx, ny - cy) <= far2)
                                rivals.push(site(cx, cy, nx, ny))
                        }
                }
                const give = (x, y, p, d0) => {
                    owner[p] = id
                    far[p] = d0
                    if (x < x0[id - 1]) x0[id - 1] = x
                    if (x > x1[id - 1]) x1[id - 1] = x
                    if (y < y0[id - 1]) y0[id - 1] = y
                    if (y > y1[id - 1]) y1[id - 1] = y
                }
                for (let y = box.y; y < box.y + box.h; ++y) {
                    const wy = (y + 0.5 - f) / d, dy2 = (wy - cy) * (wy - cy)
                    // As pixel columns of the row: the run surely in the cell's hexagon (inner), a side cell's run surely its
                    // off the board (off) and the pixels not surely another board cell's or (a side cell) beyond the reach (out).
                    let in0 = Infinity, in1 = -Infinity, of0 = Infinity, of1 = -Infinity, out0 = box.x, out1 = box.x + box.w
                    if (sure) {
                        const cols = ([lo, hi]) => [Math.max(box.x, Math.ceil(lo * a + e - 0.5)), Math.min(box.x + box.w, Math.floor(hi * a + e - 0.5) + 1)]
                        ;[in0, in1] = cols(range(cx, cy, sites, wy, 1))
                        let [olo, ohi] = range(cx, cy, blockers, wy, -1)
                        // A side cell's pixels off the board within its reach (its own hexagon lies within rx of the centre).
                        if (side) {
                            const q = (R + margin) * (R + margin) - dy2, q1 = (R - margin) * (R - margin) - dy2
                            olo = q < 0 ? Infinity : Math.max(olo, cx - Math.sqrt(q))
                            ohi = Math.min(ohi, cx + Math.sqrt(Math.max(q, 0)))
                            if (q1 > 0) {
                                const [lo, hi] = range(cx, cy, rivals, wy, 1)
                                ;[of0, of1] = cols([Math.max(lo, cx - Math.sqrt(q1)), Math.min(hi, cx + Math.sqrt(q1))])
                            }
                        }
                        ;[out0, out1] = cols([olo, ohi])
                    }
                    const inner = in0 < in1, off = of0 < of1
                    if (inner) {
                        owner.fill(id, y * W + in0, y * W + in1)
                        far.fill(0, y * W + in0, y * W + in1)
                        give(in0, y, y * W + in0, 0)
                        give(in1 - 1, y, y * W + in1 - 1, 0)
                    }
                    // Nearer the cell than any board cell that could take it: the cell's, whatever the order (its distance kept).
                    for (let x = of0; off && x < of1; ++x) {
                        if (inner && x >= in0 && x < in1) {
                            x = in1 - 1
                            continue
                        }
                        const wx = (x + 0.5 - e) / a
                        ++distances
                        give(x, y, y * W + x, (wx - cx) * (wx - cx) + dy2)
                    }
                    for (let x = out0; x < out1; ++x) {
                        const done = inner && x >= in0 && x < in1 ? in1 : off && x >= of0 && x < of1 ? of1 : 0
                        if (done) {
                            x = done - 1
                            continue
                        }
                        ++tests
                        const wx = (x + 0.5 - e) / a, p = y * W + x
                        const d0 = (wx - cx) * (wx - cx) + (wy - cy) * (wy - cy)
                        let mine = true, offBoard = false
                        ++distances
                        for (const [nx, ny, n] of near) {
                            ++distances
                            const dn = (wx - nx) * (wx - nx) + (wy - ny) * (wy - ny)
                            if (dn < d0 || dn === d0 && n < own) {
                                const ni = Math.floor(n / 100000 + 0.5), nj = n - ni * 100000
                                if (ni >= 0 && ni < w && nj >= 0 && nj < h) {
                                    mine = false
                                    break
                                }
                                offBoard = true
                            }
                        }
                        if (!mine)
                            continue
                        if (!offBoard)
                            give(x, y, p, 0)
                        // Off the board: the nearest side cell's within the reach (a pixel of a cell's own stays its).
                        else if (side && d0 <= (rx + reach) * (rx + reach) && (!owner[p] || far[p] > d0 || far[p] === d0 && owner[p] > id)) {
                            if (owner[p] && !far[p])
                                continue
                            give(x, y, p, d0)
                        }
                    }
                }
            }
        }
        // A side cell's pixels off the board may have gone to another side cell since: its rectangle shrunk to those left.
        for (const index of sides) {
            if (x1[index] < 0)
                continue
            let sx0 = W, sy0 = H, sx1 = -1, sy1 = -1
            for (let y = y0[index]; y <= y1[index]; ++y)
                for (let x = x0[index], p = y * W + x; x <= x1[index]; ++x, ++p)
                    if (owner[p] === index + 1) {
                        if (x < sx0) sx0 = x
                        if (x > sx1) sx1 = x
                        if (y < sy0) sy0 = y
                        if (y > sy1) sy1 = y
                    }
            x0[index] = sx0; y0[index] = sy0; x1[index] = sx1; y1[index] = sy1
        }
        // The cells' boxes, alpha and paths, and the whole mask (out: 255 at a cell's pixel), from the owners.
        const out = new Uint8Array(W * H)
        const cells = []
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity
        for (let index = 0; index < w * h; ++index) {
            if (x1[index] < 0)
                continue
            const box = pixelRect(x0[index] - 1, y0[index] - 1, x1[index] + 2, y1[index] + 2, W, H)
            const alpha = new Uint8Array(box.w * box.h)
            for (let y = 0; y < box.h; ++y)
                for (let x = 0, p = (box.y + y) * W + box.x; x < box.w; ++x, ++p)
                    if (owner[p] === index + 1) {
                        alpha[y * box.w + x] = 255
                        out[p] = 255
                    }
            const i = Math.floor(index / h)
            cells.push({index, i, j: index - i * h, box, alpha, path: maskPath(alpha, box.w, box.h), key: undefined})
            bx0 = Math.min(bx0, box.x); by0 = Math.min(by0, box.y)
            bx1 = Math.max(bx1, box.x + box.w); by1 = Math.max(by1, box.y + box.h)
        }
        const work = Grid.cellMaskWork
        ++work.builds
        work.tests += tests
        work.distances += distances
        return {cells, path: maskPath(out, W, H), box: cells.length ? pixelRect(bx0, by0, bx1, by1, W, H) : null}
    }
    // A cell's variant in the cell layer: its surface state (owner colour, suburb, fog), its building's cached image, the
    // surface states of the cells round it (their tiles' antialiased edges and their fog reach its pixels), and (TASK-1314)
    // the owners whose territory glow reaches it (cellGlowCells: the light map's owners there, atmosphericLighting.ownerValue,
    // the cool spill's only for an owner bluer than red), so a capture gives every cell its glow reaches a new variant.
    cellLayerKey(i, j) {
        const cell = this.arr[i][j], building = this.isCacheableBuilding(cell.building) ? cell.building : undefined
        let key = this.getSurfaceStateValue(i, j, false) + ':' + (building ? this.getEntityBodyImageName(building) : '')
        for (const [di, dj] of neighborhood[i & 1]) {
            const row = this.arr[i + di], other = row && row[j + dj]
            key += ',' + (other ? this.getSurfaceStateValue(i + di, j + dj, false) : '-')
        }
        const L = atmosphericLighting, near = this.cellGlowCells(), h = this.arr[0].length, index = i * h + j
        // TASK-1315: whether each building whose sprite or shadow reaches the cell is in view (cellBuildingReach).
        key += '|'
        for (const k of (this.cellReachPass || this.cellBuildingReach())[index]) {
            const q = Math.floor(k / h)
            key += isFogOfWar && !this.fogOfWar[q][k - q * h] ? 0 : 1
        }
        key += '|'
        for (const [list, cool] of [[near.warm[index], false], [near.cool[index], true]]) {
            for (const k of list) {
                const q = Math.floor(k / h), owner = L.ownerValue(this, this.arr[q][k - q * h])
                if (owner && (!cool || L.glowReach(owner) > near.warmReach))
                    key += k + ':' + owner + ';'
            }
        }
        return key
    }
    // Per cell (board index) the cells whose territory glow can reach its hexagon (centres within the glow's reach plus a
    // hexagon and CELL_GLOW_MARGIN radii, for the light map's sampling): warm, within TERRITORY's reach; cool, beyond it within
    // the cool spill's. Kept for the board's size and hex radius.
    cellGlowCells() {
        const w = this.arr.length, h = this.arr[0].length, r = basis.r, {reach, cool} = atmosphericLighting.TERRITORY
        const id = w + 'x' + h + ',' + r + ',' + basis.offset.x + ',' + basis.offset.y
        if (this.cellGlowNear?.id === id)
            return this.cellGlowNear
        const warmReach = reach * r, coolReach = Math.max(reach, cool && (cool.map || cool.gain) ? cool.reach : 0) * r
        const warmR = warmReach + (1 + CELL_GLOW_MARGIN) * r, coolR = coolReach + (1 + CELL_GLOW_MARGIN) * r
        const ox = basis.offset.x, oy = basis.offset.y, di = Math.ceil(coolR / ox), dj = Math.ceil(coolR / (2 * oy)) + 1
        const warm = [], coolCells = []
        for (let i = 0; i < w; ++i) {
            for (let j = 0; j < h; ++j) {
                const cx = i * ox, cy = (2 * j + (i & 1)) * oy, near = [], far = []
                for (let a = Math.max(0, i - di); a < Math.min(w, i + di + 1); ++a) {
                    for (let b = Math.max(0, j - dj); b < Math.min(h, j + dj + 1); ++b) {
                        if (a === i && b === j)
                            continue
                        const d = Math.hypot(a * ox - cx, (2 * b + (a & 1)) * oy - cy)
                        if (d <= warmR)
                            near.push(a * h + b)
                        else if (d <= coolR)
                            far.push(a * h + b)
                    }
                }
                warm.push(near)
                coolCells.push(far)
            }
        }
        return this.cellGlowNear = {id, warm, cool: coolCells, warmReach}
    }
    // TASK-1315: per cell (board index) the other cells whose building's sprite (as drawn in view and as a fog landmark) or
    // shadow (atmosphericLighting.shadowBounds, its lamps the board's now) reaches the cell's hexagon: fog a move uncovers
    // or hides there draws or hides them (drawEntityBodies, drawShadows), so the cell's sprite variant holds it. Kept for
    // the board's size, hex radius, buildings and lamps.
    cellBuildingReach() {
        const w = this.arr.length, h = this.arr[0].length, L = atmosphericLighting, {sources} = L.collect(this, false, false)
        let id = w + 'x' + h + ',' + basis.r + ',' + basis.offset.x + ',' + basis.offset.y + '|' +
            sources.map(s => s.x + ',' + s.y + s.name).join(';') + '|'
        const casters = []
        for (let i = 0; i < w; ++i) {
            for (let j = 0; j < h; ++j) {
                const building = this.arr[i][j].building
                if (!building.notEmpty() || building.isMapEdge || !building.pos)
                    continue
                const images = [...new Set([cachedImages[this.getEntityBodyImageName(building)], cachedImages[building.bodyImageName]])]
                    .filter(image => image && image.width)
                if (!images.length)
                    continue
                id += i * h + j + ':' + this.getEntityBodyImageName(building) + ':' + building.pos.x + ',' + building.pos.y + ';'
                casters.push({i, j, building, images})
            }
        }
        if (this.cellReach?.id === id)
            return this.cellReach.cells
        const cells = Array.from({length: w * h}, () => [])
        const ox = basis.offset.x, oy = basis.offset.y, hex = 1.1 * basis.r
        for (const {i, j, building, images} of casters) {
            const pos = this.arr[i][j].hexagon.calcPos(), box = {x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity}
            const add = q => {
                box.x0 = Math.min(box.x0, q.x0); box.y0 = Math.min(box.y0, q.y0); box.x1 = Math.max(box.x1, q.x1); box.y1 = Math.max(box.y1, q.y1)
            }
            for (const image of images) {
                add({x0: building.pos.x, y0: building.pos.y, x1: building.pos.x + image.width, y1: building.pos.y + image.height})
                if (L.castsShadow(this, i, j, building, true))
                    add(L.shadowBounds(building, image, pos, sources))
            }
            const a0 = Math.max(0, Math.floor((box.x0 - hex) / ox)), a1 = Math.min(w - 1, Math.ceil((box.x1 + hex) / ox))
            for (let a = a0; a <= a1; ++a) {
                const b0 = Math.max(0, Math.floor(((box.y0 - hex) / oy - (a & 1)) / 2)), b1 = Math.min(h - 1, Math.ceil(((box.y1 + hex) / oy - (a & 1)) / 2))
                for (let b = b0; b <= b1; ++b) {
                    const cx = a * ox, cy = (2 * b + (a & 1)) * oy
                    if ((a !== i || b !== j) && cx + hex > box.x0 && cx - hex < box.x1 && cy + hex > box.y0 && cy - hex < box.y1)
                        cells[a * h + b].push(i * h + j)
                }
            }
        }
        this.cellReach = {id, cells}
        return cells
    }
    // The surface states (getSurfaceStateValue, not observed) of the board's cells now, in board order: a cell layer's
    // sprites are those of its states (layer.states), followCellLayer compares them.
    // fn run with the cells' building reach found once (cellBuildingReach), for its many cellLayerKey calls.
    withCellReach(fn) {
        if (this.cellReachPass)
            return fn()
        this.cellReachPass = this.cellBuildingReach()
        try {
            return fn()
        } finally {
            this.cellReachPass = undefined
        }
    }
    cellLayerStates() {
        const h = this.arr[0].length, states = new Uint16Array(this.arr.length * h)
        for (let i = 0, index = 0; i < this.arr.length; ++i)
            for (let j = 0; j < h; ++j, ++index)
                states[index] = this.getSurfaceStateValue(i, j, false)
        return states
    }
    // TASK-1316: whether states (cellLayerStates' array) are the board's cell states now, read in place (no array made, no
    // call a cell: followCellLayer and litLayerBehind ask it every frame).
    cellLayerStatesAre(states) {
        const arr = this.arr, h = arr[0].length, fog = isFogOfWar ? this.fogOfWar : null
        if (!states || states.length !== arr.length * h)
            return false
        for (let i = 0, index = 0; i < arr.length; ++i) {
            const row = arr[i], fogRow = fog && fog[i]
            for (let j = 0; j < h; ++j, ++index) {
                const hexagon = row[j].hexagon
                if (states[index] !== (((hexagon.unknown ? 0 : hexagon.playerColor + 1) << 2) | (hexagon.isSuburb ? 2 : 0) |
                        (!fogRow || fogRow[j] ? 1 : 0)))
                    return false
            }
        }
        return true
    }
    // TASK-1315 (Grid.liveCellLayer): a frame drawing the surface cache (which 'surface') or the lit view's rest snapshot
    // ('lit') with its cell layer (each matching the board but in its cells' owner colour, suburb and fog,
    // surfaceStateMatches) first brings the layer up to the board when a cell's surface state is not the one the layer was
    // drawn for (layer.states): refreshCellLayer draws the changed variants' sprites (kept, or rendered once), never a
    // cache or snapshot build or patch. A layer brought up takes the board's states; so does its raster's captured state
    // (the cache's, or the lit view's, whose tiles, drawn for its old state, are released and whose lit edges are found
    // again), so the exact comparisons of a build, patch or rest snapshot under way hold. During a patch the layer waits
    // (the patch draws every changed cell, patchSurfaceCache); a layer that cannot be brought up otherwise (a light map at
    // another scale) has its cache dropped (rebuilt between frames) or its view dropped. Returns whether the frame can draw it.
    // TASK-1316: on the lit view (ctx and t, the frame's canvas and transform) with the camera resting on its finished rest
    // snapshot, new variants are rendered a step a frame (startLitLayerJob) while the frames draw the changed cells over
    // the snapshot (drawPatchCells), instead of all in the frame that found the change.
    // TASK-1360: so are the surface cache's (startSurfaceLayerJob) when the frame drawing it is the frame's surface (main:
    // drawMapSurface's, not a stand-in's or the overlay snapshot's, which draw the change as the job's frames do).
    followCellLayer(which, ctx, t, main = false) {
        if (!this.cellLayerOn())
            return true
        const view = this.litView, layer = which === 'surface' ? this.surfaceCellLayer : this.litCellLayer
        if (which === 'surface' ? !layer?.cells || layer.raster !== this.surfaceCache || !this.surfaceCache?.cellLayered :
                !layer?.cells || !view?.rest || view.rest.cellLayer !== layer || layer.raster !== view.rest.canvas)
            return true
        const pending = which === 'lit' ? view.layerJob : this.surfaceLayerJob
        if (this.cellLayerStatesAre(layer.states)) {
            if (pending)
                which === 'lit' ? view.layerJob = undefined : this.dropSurfaceLayerJob()
            this.surfaceLayerJobFailed = false
            return true
        }
        const states = this.cellLayerStates()
        const same = (a, b) => a && a.length === b.length && a.every((v, k) => v === b[k])
        const job = which === 'surface' ? this.surfacePatchJob || this.surfaceCacheBuild : view.patch
        if (job) {
            // The patch draws every changed cell (the layer follows after it).
            if (which === 'surface' && pending)
                this.dropSurfaceLayerJob()
            return true
        }
        if (which === 'surface' && Grid.surfaceLayerJobs) {
            if (pending && same(pending.states, states))
                return true
            if (pending)
                this.dropSurfaceLayerJob()
            if (main && !this.surfaceLayerJobFailed && this.startSurfaceLayerJob(states))
                return true
        }
        if (which === 'lit' && ctx) {
            const patchable = this.litPatchable(ctx, view, t)
            if (pending && patchable && same(pending.states, states))
                return true
            view.layerJob = undefined
            if (patchable && !view.layerJobFailed && this.startLitLayerJob(view, states))
                return true
        }
        const {failed} = this.refreshCellLayer(which)
        if (failed.length) {
            if (which === 'surface') {
                this.surfaceCache = undefined
                this.surfaceCacheDirty = true
            }
            else
                this.dropLitView()
            ++this.cellLayerFollowDrops
            return false
        }
        this.followedCellLayer(which, layer, states)
        this.surfaceLayerJobFailed = false
        return true
    }
    // A layer brought up to the board's states (followCellLayer, a lit layer job's last step): it takes them, and so does its
    // raster's captured state (the cache's, or the lit view's, whose lit edges are found again and whose tiles, drawn for its old
    // state, are released: those meeting region, the layer's pixel rectangle the change was drawn in, else all).
    followedCellLayer(which, layer, states, region) {
        const view = this.litView
        layer.states = states
        this.pruneCellSprites(layer)
        const overlayCells = this.surfaceOverlayCells
        if (which === 'surface') {
            this.surfaceOverlayCells = []
            try {
                this.captureSurfaceState()
            } finally {
                this.surfaceOverlayCells = overlayCells
            }
            return
        }
        this.withLitState(view, () => this.captureSurfaceState())
        Object.assign(view, this.litEdges(view))
        if (!region) {
            for (const tile of view.tiles.values())
                this.releaseLitTile(tile)
            view.tiles.clear()
            return
        }
        this.releaseLitTilesIn(view, view.rest, region)
    }
    // The tiles of view whose squares meet the rest snapshot's pixel rectangle r grown by the edge runs' reach (a run joins
    // blocks up to 3 apart), released (built again one a task, LIT_TILE_PATCHED_BUDGET).
    releaseLitTilesIn(view, rest, r) {
        const grow = 4 * LIT_EDGE_BLOCK, ox = Math.round(rest.e - view.e), oy = Math.round(rest.f - view.f)
        for (const [key, tile] of view.tiles) {
            const [u, v] = key.split(',').map(Number), x = u * LIT_TILE + ox, y = v * LIT_TILE + oy
            if (x < r.x + r.w + grow && x + LIT_TILE > r.x - grow && y < r.y + r.h + grow && y + LIT_TILE > r.y - grow) {
                view.tiles.delete(key)
                this.releaseLitTile(tile)
                view.patchedTiles = true
            }
        }
    }
    // TASK-1316: the lit view's cell layer brought up to the board's states (followCellLayer) when variants of changed
    // cells have no sprite yet, a step a frame (litLayerStep, none in the frame that found the change), the snapshot and its
    // state left as they are (planLitLayerJob): the light map's owners synced quietly (as a variant render's,
    // withHeldLightMap); the change's region (a lit view patch's, patchRegion) drawn on the lit patch buffer in
    // LIT_LAYER_PARTS and the light, a band of at most LIT_LAYER_STEP of the canvas at a time, with the light map as it is,
    // and the new variants' sprites made from it there and from their cells' sprites before elsewhere (cellSpriteIn, in
    // groups); then the changed cells' sprites composed on a canvas of the region (composeCellSprites, in chunks) and the
    // region copied into the shown snapshot, the layer taking the board's states (followedCellLayer). Until then the
    // frames draw the changed cells over the shown snapshot in the board's state (drawPatchCells), so the change shows from
    // the frame that found it; each step draws about its part of the region once, and only the last changes a canvas of
    // 1 MP or more a frame draws. Returns false when the change is drawn at once
    // instead (refreshCellLayer): no cell state changed, a lamp or portal among the cells; a job whose cells span too much
    // fails in its first step, and the view's changes are then drawn at once (layerJobFailed).
    // The frame that finds the change only finds what drawPatchCells draws (as a lit view patch does, startLitPatch); the
    // job's second step plans the rest (planLitLayerJob).
    startLitLayerJob(view, states) {
        const changes = []
        const found = this.withLitState(view, () => {
            const overlayCells = this.surfaceOverlayCells
            this.surfaceOverlayCells = []
            try {
                return this.surfaceStateMatches(undefined, changes, true) && changes.length && this.surfaceCacheChangeRects(changes)
            } finally {
                this.surfaceOverlayCells = overlayCells
            }
        })
        if (!found)
            return false
        const job = view.layerJob = {rest: view.rest, light: found.light, boxes: found.cells, changed: changes.slice(),
            sprites: found.sprites, states, steps: [], step: 0, ran: null}
        // First the light map's owners synced (none to sync: nothing drawn), as a lit view patch's first step brings its light
        // map region up; then the plan (planLitLayerJob).
        job.steps.push(() => {
            if (!this.withHeldLightMap(undefined, () => atmosphericLighting.lightMap(this)))
                job.failed = true
        }, () => this.withCellReach(() => this.planLitLayerJob(view, job)))
        ++this.cellLayerJobs
        return true
    }
    // A lit layer job's second step: the changed cells' variants now (cellLayerKey, found once: the board's states are the
    // job's while it runs) and the job's other steps.
    planLitLayerJob(view, job) {
        const layer = this.litCellLayer, rest = view.rest, states = job.states
        const keys = new Map()
        for (const c of layer.cells) {
            const key = this.cellLayerKey(c.i, c.j)
            if (key !== c.key)
                keys.set(c, key)
        }
        const cells = job.cells = [...keys.keys()], missing = cells.filter(c => !layer.sprites.has(c.index + '|' + keys.get(c)))
        if (!cells.length) {
            view.layerJob = undefined
            this.followedCellLayer('lit', layer, states)
            return
        }
        const cw = rest.canvas.width, ch = rest.canvas.height, m = LIT_PATCH_MARGIN, budget = LIT_LAYER_STEP * cw * ch
        const span = list => list.reduce((r, {box}) => pixelRect(Math.min(r.x, box.x), Math.min(r.y, box.y),
            Math.max(r.x + r.w, box.x + box.w), Math.max(r.y + r.h, box.y + box.h), cw, ch), list[0].box)
        const inner = span(cells)
        const fail = () => { job.failed = true }
        if (!inner || inner.w * inner.h > LIT_PATCH_MAX_AREA * cw * ch)
            return fail()
        // The new variants are drawn only within the change's region, the pixel rectangle the changed cells draw on (as a
        // lit view patch's, patchRegion: their hexagons and sprites, the light rectangles, the territory glow's reach of an
        // owner changed): elsewhere a new variant's sprite keeps its cell's sprite before (cellSpriteIn), as a patch copies
        // only its region. The region in bands of at most LIT_LAYER_STEP of the canvas, each drawn on the lit patch buffer
        // (with the lit patch margin) and taken into the sprites before the next band is drawn.
        const at = (x, y) => ({x: x * view.a + rest.e, y: y * view.d + rest.f})
        const region = this.patchRegion({cells: job.boxes, light: job.light}, atmosphericLighting.mapPixel(), at, cw, ch)
        if (region && region.w * region.h > LIT_PATCH_MAX_AREA * cw * ch)
            return fail()
        const n = !region || !missing.length ? 0 : Math.ceil(region.w * region.h / budget)
        const bands = Array.from({length: n}, (_, k) => {
            const y0 = region.y + Math.floor(k * region.h / n), y1 = region.y + Math.floor((k + 1) * region.h / n)
            return {x: region.x, y: y0, w: region.w, h: y1 - y0}
        }).filter(r => r.h > 0)
        // Each new variant's sprite, made from its cell's sprite before and the bands' renders.
        const made = new Map(missing.map(c => [c, layer.sprites.get(c.index + '|' + c.key)]))
        // The view's lit edges found a step of their own (litEdges keeps them; the last step's followedCellLayer finds them
        // again unless the lit cells changed meanwhile).
        job.steps.push(() => this.litEdges(view))
        // The light map's canvases, changed by the owner sync, each read once in a step of its own (one pixel drawn on a
        // kept 1 x 1 canvas): a canvas drawn from after a change is copied whole at its next draw, so the light's steps,
        // which draw them over the band, do not also pay for that copy.
        for (const name of ['map', 'gain'])
            job.steps.push(() => {
                const source = atmosphericLighting[name]
                if (source?.width && source.height)
                    (this.litLightTouch ||= Object.assign(document.createElement('canvas'), {width: 1, height: 1}))
                        .getContext('2d').drawImage(source, 0, 0, 1, 1, 0, 0, 1, 1)
            })

        // Each step draws about its band's area once (LIT_LAYER_PARTS; the sprites made about their boxes' four times, in
        // groups of a sixth of the budget).
        for (const band of bands) {
            const outer = pixelRect(band.x - m, band.y - m, band.x + band.w + m, band.y + band.h + m, cw, ch)
            const part = {rest, outer, light: job.light, window: clipWindowOf(outer, cw, ch, -rest.e / view.a, -rest.f / view.d, view.a, 1.05 * basis.r)}
            for (const draws of LIT_LAYER_PARTS)
                job.steps.push(() => this.withHeldLightMap(undefined, () => {
                    for (const draw of draws)
                        this.drawLitPatch(part, view, g => draw(this, g, part))
                    return true
                }) || fail())
            // The light map's multiply, then its color-dodge and the bloom, in LIT_LAYER_LIGHT_BANDS bands of rows each
            // (as the rest snapshot's bands: each clipped to its rows, the clip's bounds the canvas's, drawLitPatch).
            for (const light of ['map', 'gain'])
                for (let k = 0; k < LIT_LAYER_LIGHT_BANDS; ++k) {
                    const y0 = outer.y + Math.floor(k * outer.h / LIT_LAYER_LIGHT_BANDS)
                    const y1 = outer.y + Math.floor((k + 1) * outer.h / LIT_LAYER_LIGHT_BANDS)
                    const rows = {...part, outer: {x: outer.x, y: y0, w: outer.w, h: y1 - y0}}
                    job.steps.push(() => this.withHeldLightMap(undefined, () => {
                        this.drawLitPatch(rows, view, g => atmosphericLighting.drawRows(g, this, y0, y1, light))
                        return true
                    }) || fail())
                }
            const meets = missing.filter(({box}) => box.x < band.x + band.w && band.x < box.x + box.w && box.y < band.y + band.h && band.y < box.y + box.h)
            for (const group of this.layerGroups(meets, budget / 6))
                job.steps.push(() => {
                    for (const cell of group)
                        made.set(cell, this.cellSpriteIn(cell, this.litPatchBuffer, band, made.get(cell)))
                })
        }
        job.steps.push(() => {
            for (const cell of missing) {
                const sprite = made.get(cell)
                if (!sprite)
                    return fail()
                layer.sprites.set(cell.index + '|' + keys.get(cell), sprite)
            }
            this.cellSpriteRenders += missing.length
            this.cellLayerVariantRenders += missing.length
        })
        // The changed cells' sprites composed on a canvas of the change's region (the shown snapshot's pixels there first; a
        // sprite differs from its cell's before only there), in chunks, then the region copied into the shown snapshot in one
        // step: a canvas the size of the camera's changed in several frames running and drawn in each was rasterized whole
        // in one of them (about 400 ms a frame on this host). The layer canvas itself is drawn when next read
        // (staleCellLayer).
        const area = region && pixelRect(Math.max(region.x, inner.x), Math.max(region.y, inner.y),
            Math.min(region.x + region.w, inner.x + inner.w), Math.min(region.y + region.h, inner.y + inner.h), cw, ch)
        const stage = this.litLayerStage ||= document.createElement('canvas')
        const finish = () => {
            for (const cell of cells)
                cell.key = keys.get(cell)
            if (area)
                this.staleCellLayer(layer, area)
            ++this.cellLayerRefreshes
            ++this.cellLayerRevision
            ++this.cellLayerJobsDone
            view.layerJob = undefined
            this.followedCellLayer('lit', layer, states, area || inner)
        }
        if (!area) {
            job.steps.push(finish)
            this.lastLitLayerJob = {cells: cells.length, missing: missing.length, changes: job.changed.length, inner, region, bands: 0,
                steps: job.steps.length}
            return
        }
        job.steps.push(() => {
            if (stage.width < area.w || stage.height < area.h) {
                stage.width = Math.max(stage.width, area.w)
                stage.height = Math.max(stage.height, area.h)
            }
            const g = stage.getContext('2d')
            g.save()
            g.setTransform(1, 0, 0, 1, 0, 0)
            g.globalCompositeOperation = 'copy'
            g.drawImage(rest.shown, area.x, area.y, area.w, area.h, 0, 0, area.w, area.h)
            g.restore()
        })
        const meetsArea = ({box}) => box.x < area.x + area.w && area.x < box.x + box.w && box.y < area.y + area.h && area.y < box.y + box.h
        for (const chunk of this.layerChunks(cells.filter(meetsArea), budget / 3, cw, ch)) {
            const rect = pixelRect(Math.max(area.x, chunk.rect.x), Math.max(area.y, chunk.rect.y), Math.min(area.x + area.w,
                chunk.rect.x + chunk.rect.w), Math.min(area.y + area.h, chunk.rect.y + chunk.rect.h), cw, ch)
            job.steps.push(() => {
                if (chunk.cells.some(c => !layer.sprites.has(c.index + '|' + keys.get(c))))
                    return fail()
                for (const cell of chunk.cells)
                    cell.key = keys.get(cell)
                this.composeCellSprites(stage, layer, rect, area.x, area.y)
            })
        }
        job.steps.push(() => {
            const g = rest.shown.getContext('2d')
            g.save()
            g.setTransform(1, 0, 0, 1, 0, 0)
            g.globalCompositeOperation = 'copy'
            g.beginPath()
            g.rect(area.x, area.y, area.w, area.h)
            g.clip()
            g.drawImage(stage, 0, 0, area.w, area.h, area.x, area.y, area.w, area.h)
            g.restore()
            finish()
        })
        this.lastLitLayerJob = {cells: cells.length, missing: missing.length, changes: job.changed.length, inner, region, bands: bands.length,
            steps: job.steps.length, boxArea: missing.reduce((a, {box}) => a + box.w * box.h, 0)}
    }
    // cells in chunks of neighbours, each {cells, rect: their boxes' span}, the span at most budget pixels unless one cell's
    // box is larger: the cells halved along their span's longer side (by their boxes' centres) until each half fits.
    layerChunks(cells, budget, W, H) {
        const span = list => list.reduce((r, {box}) => pixelRect(Math.min(r.x, box.x), Math.min(r.y, box.y),
            Math.max(r.x + r.w, box.x + box.w), Math.max(r.y + r.h, box.y + box.h), W, H), list[0].box)
        const rect = span(cells)
        if (cells.length === 1 || rect.w * rect.h <= budget)
            return [{cells, rect}]
        const along = rect.w >= rect.h ? c => c.box.x + c.box.w / 2 : c => c.box.y + c.box.h / 2
        const sorted = [...cells].sort((p, q) => along(p) - along(q)), half = sorted.length >> 1
        return [...this.layerChunks(sorted.slice(0, half), budget, W, H), ...this.layerChunks(sorted.slice(half), budget, W, H)]
    }
    // TASK-1316: the layer's pixel rectangle rect left to be drawn from its cells' sprites when the layer is next read
    // (flushCellLayer: composeCellLayer, refreshCellLayer); its shown canvas already has them (composeCellSprites).
    staleCellLayer(layer, rect) {
        const r = layer.stale
        layer.stale = !r ? rect : pixelRect(Math.min(r.x, rect.x), Math.min(r.y, rect.y), Math.max(r.x + r.w, rect.x + rect.w),
            Math.max(r.y + r.h, rect.y + rect.h), layer.width, layer.height)
    }
    flushCellLayer(layer) {
        const r = layer?.stale
        if (!r)
            return
        layer.stale = null
        if (layer.cells)
            this.drawCellSprites(layer, r)
    }
    // cells in groups in their order, each group's boxes at most budget pixels together (at least one cell a group).
    layerGroups(cells, budget) {
        const groups = []
        let area = Infinity
        for (const cell of cells) {
            const a = cell.box.w * cell.box.h
            if (area + a > budget) {
                groups.push([])
                area = 0
            }
            groups.at(-1).push(cell)
            area += a
        }
        return groups
    }
    // One step of view's lit layer job (startLitLayerJob) in a frame drawing the shown snapshot: at most one a frame, none in
    // the frame that started it. A step that fails ends it; the layer is then brought up at once (refreshCellLayer).
    litLayerStep(view) {
        const job = view.layerJob
        if (job.ran === null || job.ran === this.drawSerial) {
            job.ran ??= this.drawSerial
            return
        }
        job.ran = this.drawSerial
        if (view.rest !== job.rest || job.rest.cellLayer !== this.litCellLayer)
            job.failed = true
        else
            job.steps[job.step++]()
        if (job.failed) {
            view.layerJob = undefined
            view.layerJobFailed = true
        }
    }
    // TASK-1360: the surface cache's cell layer brought up to the board's states (followCellLayer, a frame drawing the cache
    // as its surface) when variants of changed cells have no sprite yet, a step a frame (surfaceLayerStep, none in the frame
    // that found the change), as the lit view's layer job does (startLitLayerJob), instead of all in that frame
    // (refreshCellLayer): each of SURFACE_CACHE_STAGES drawn on the patch buffer over the missing cells' region, as
    // renderSurfaceCellSprites draws them all at once (with the light map as it is, withHeldLightMap; its owners synced a step
    // before the bake's); the new variants'
    // sprites made from it, SURFACE_LAYER_SPRITES a step (cellSprite); the changed cells' sprites drawn into the layer
    // (drawCellSprites) and composed on a canvas of their region (the shown canvas's pixels there first, composeCellSprites,
    // in bands of rows: disjoint, so each pixel is composed once, as in one call); then the region copied into the shown
    // canvas and the layer taking the board's states (followedCellLayer). So the shown canvas ends as refreshCellLayer draws
    // it, to the bit. Until then the frames draw the cells whose variants change (the changed cells and the neighbours their
    // glow reaches) over it in the board's state (drawPatchCells), and the
    // cells keep their variants (cell.key) until the last step, so a job dropped (another board change, a patch or build,
    // another cache) leaves the layer as it was (the layer canvas drawn again from them when next read, staleCellLayer).
    // Returns false when the change is drawn at once instead: every changed variant has its sprite (an undo, a capture taken
    // back), no cell state changed for the cache, a lamp or portal among the cells (surfaceCacheChangeRects), no patch buffer.
    startSurfaceLayerJob(states) {
        const layer = this.surfaceCellLayer, canvas = this.surfaceCache, shown = this.surfaceCacheShown, buffer = this.surfacePatchBuffer
        if (!shown || !buffer || buffer.width !== canvas.width || buffer.height !== canvas.height ||
                buffer.gradientSource !== canvas.getContext('2d'))
            return false
        return this.withCellReach(() => {
            const keys = new Map()
            for (const c of layer.cells) {
                const key = this.cellLayerKey(c.i, c.j)
                if (key !== c.key)
                    keys.set(c, key)
            }
            const cells = [...keys.keys()], missing = cells.filter(c => !layer.sprites.has(c.index + '|' + keys.get(c)))
            if (!missing.length)
                return false
            const changes = [], overlayCells = this.surfaceOverlayCells
            this.surfaceOverlayCells = []
            let found
            try {
                found = this.surfaceStateMatches(undefined, changes, true) && changes.length && this.surfaceCacheChangeRects(changes)
            } finally {
                this.surfaceOverlayCells = overlayCells
            }
            if (!found)
                return false
            const W = layer.width, H = layer.height
            const span = list => list.reduce((r, {box}) => pixelRect(Math.min(r.x, box.x), Math.min(r.y, box.y),
                Math.max(r.x + r.w, box.x + box.w), Math.max(r.y + r.h, box.y + box.h), W, H), list[0].box)
            const region = span(cells), rendered = span(missing)
            // The frames draw every cell whose variant changes (a changed cell's neighbours too: their glow and edges), not
            // only the cells whose state changed, so none shows its old variant until the last step.
            const drawn = [...new Set([...changes, ...cells.map(c => c.index)])]
            const job = this.surfaceLayerJob = {cache: canvas, layer, states, boxes: found.cells, light: found.light, sprites: found.sprites,
                changed: drawn, cells, region, steps: [], step: 0, ran: null, drawn: false}
            const fail = () => { job.failed = true }
            // The stages over the missing cells' region on the patch buffer (renderSurfaceCellSprites' drawing, a stage a step).
            const scale = this.surfaceCacheScale, b = this.surfaceCacheBounds
            const m = CELL_RENDER_MARGIN * Math.max(SURFACE_PATCH_MARGIN_MIN, Math.ceil(SURFACE_PATCH_MARGIN * scale))
            const outer = pixelRect(rendered.x - m, rendered.y - m, rendered.x + rendered.w + m, rendered.y + rendered.h + m, W, H)
            const render = {outer, scale, left: b.left, top: b.top, window: clipWindowOf(outer, W, H, b.left, b.top, scale, 1.05 * basis.r),
                build: {canvas: buffer, ctx: buffer.getContext('2d'), geometry: {scale, cacheWidth: b.width, cacheHeight: b.height},
                    left: b.left, top: b.top, stage: 0, lit: false, atmospheric: true, state: [], overlayCells: []}}
            // First the light map's owners synced in steps of their own (atmosphericLighting.startOwnerSync, up to
            // SURFACE_LAYER_SYNC_STEPS of updateMapRegion's a step, the step run again until the sync ends; only the bake of
            // the stages draws from the map, and its lightMap then finds them synced), so frames lighting the changed cells
            // from the map (drawSurfaceCache) soon have the new owners' glow.
            job.steps.push(() => {
                const L = atmosphericLighting
                if (job.sync && L.regionStaged !== job.sync)
                    return fail()
                const step = this.withHeldLightMap(scale, () => {
                    job.sync ||= L.startOwnerSync(this, scale)
                    let step
                    for (let k = 0; k < SURFACE_LAYER_SYNC_STEPS && !(step = job.sync.next()).done; ++k);
                    return step
                })
                if (!step || step.done && !step.value)
                    return fail()
                if (!step.done)
                    --job.step
                else if (L.regionStaged === job.sync)
                    L.regionStaged = null
            })
            for (const stage of SURFACE_CACHE_STAGES)
                job.steps.push(() => this.withHeldLightMap(scale, () => {
                    this.drawSurfacePatchStage(render, stage)
                    return true
                }) || fail())
            for (let k = 0; k < missing.length; k += SURFACE_LAYER_SPRITES)
                job.steps.push(() => {
                    if (!render.build.lit)
                        return fail()
                    for (const cell of missing.slice(k, k + SURFACE_LAYER_SPRITES)) {
                        const key = cell.key
                        this.cellSprite(layer, cell, buffer, keys.get(cell))
                        cell.key = key
                    }
                    this.cellLayerVariantRenders += Math.min(SURFACE_LAYER_SPRITES, missing.length - k)
                })
            // fn with the changed cells at their variants now (taken for good by the last step).
            const atKeys = fn => {
                const kept = cells.map(c => c.key)
                cells.forEach(c => { c.key = keys.get(c) })
                try {
                    fn()
                } finally {
                    cells.forEach((c, k) => { c.key = kept[k] })
                }
            }
            job.steps.push(() => {
                if (cells.some(c => !layer.sprites.has(c.index + '|' + keys.get(c))))
                    return fail()
                this.flushCellLayer(layer)
                job.drawn = true
                atKeys(() => this.drawCellSprites(layer, region))
            })
            const stage = this.surfaceLayerStage ||= document.createElement('canvas')
            job.steps.push(() => {
                if (stage.width < region.w || stage.height < region.h) {
                    stage.width = Math.max(stage.width, region.w)
                    stage.height = Math.max(stage.height, region.h)
                }
                const g = stage.getContext('2d')
                g.save()
                g.setTransform(1, 0, 0, 1, 0, 0)
                g.globalCompositeOperation = 'copy'
                g.drawImage(shown, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h)
                g.restore()
            })
            const n = Math.ceil(region.w * region.h / (SURFACE_LAYER_COMPOSE * W * H))
            for (let k = 0; k < n; ++k) {
                const y0 = region.y + Math.floor(k * region.h / n), y1 = region.y + Math.floor((k + 1) * region.h / n)
                if (y1 > y0)
                    job.steps.push(() => atKeys(() => this.composeCellSprites(stage, layer, {x: region.x, y: y0, w: region.w, h: y1 - y0},
                        region.x, region.y)))
            }
            job.steps.push(() => {
                const g = shown.getContext('2d')
                g.save()
                g.setTransform(1, 0, 0, 1, 0, 0)
                g.globalCompositeOperation = 'copy'
                g.beginPath()
                g.rect(region.x, region.y, region.w, region.h)
                g.clip()
                g.drawImage(stage, 0, 0, region.w, region.h, region.x, region.y, region.w, region.h)
                g.restore()
                for (const cell of cells)
                    cell.key = keys.get(cell)
                this.surfaceLayerJob = undefined
                ++this.cellLayerRefreshes
                ++this.cellLayerRevision
                ++this.surfaceLayerJobsDone
                this.followedCellLayer('surface', layer, states)
            })
            ++this.surfaceLayerJobs
            this.lastSurfaceLayerJob = {cells: cells.length, missing: missing.length, changes: changes.length, region, rendered: outer,
                bands: n, steps: job.steps.length}
            return true
        })
    }
    // One step of the surface layer job (startSurfaceLayerJob) in a frame drawing the cache as its surface: at most one a
    // frame, none in the frame that started it. A job whose cache, layer or board state is no longer its own, or a patch or
    // build under way, is dropped; a step that fails drops it too, and the change is then drawn at once (refreshCellLayer).
    surfaceLayerStep() {
        const job = this.surfaceLayerJob
        if (job.ran === null || job.ran === this.drawSerial) {
            job.ran ??= this.drawSerial
            return
        }
        job.ran = this.drawSerial
        if (job.cache !== this.surfaceCache || job.layer !== this.surfaceCellLayer || this.surfacePatchJob || this.surfaceCacheBuild ||
                !this.cellLayerStatesAre(job.states))
            return this.dropSurfaceLayerJob()
        ++this.surfaceLayerSteps
        job.steps[job.step++]()
        if (job.failed) {
            this.dropSurfaceLayerJob()
            this.surfaceLayerJobFailed = true
        }
    }
    // The surface layer job ended before its last step: the layer canvas, if its step drew the new sprites, drawn again from
    // the cells' variants when next read.
    dropSurfaceLayerJob() {
        const job = this.surfaceLayerJob
        this.surfaceLayerJob = undefined
        if (job?.sync && atmosphericLighting.regionStaged === job.sync)
            atmosphericLighting.endRegionSteps()
        if (job?.drawn && job.layer === this.surfaceCellLayer)
            this.staleCellLayer(job.layer, job.region)
    }
    // The sprite of cell for its variant now (cellLayerKey), its mask pixels taken from source (the split canvas, drawn
    // whole there, or a render of the variant, renderCellSprites), kept in layer.sprites; the cell takes the variant.
    // key: the cell's variant now when known (a lit layer job's).
    cellSprite(layer, cell, source, key = this.cellLayerKey(cell.i, cell.j)) {
        const {box} = cell
        const sprite = this.cellSpriteCanvas(box)
        const g = sprite.getContext('2d')
        fillCellMask(g, cell.path)
        g.globalCompositeOperation = 'source-in'
        g.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h)
        layer.sprites.set(cell.index + '|' + key, sprite)
        cell.key = key
        ++this.cellSpriteRenders
        return sprite
    }
    // TASK-1316: a sprite of cell whose mask pixels within the pixel rectangle rect are source's (a render of the board now
    // there, as cellSprite takes them) and elsewhere base's (the cell's sprite before: a change draws nothing outside its
    // region, as a patch copies only its region; none: transparent there).
    cellSpriteIn(cell, source, rect, base) {
        const {box} = cell, sprite = this.cellSpriteCanvas(box)
        const g = sprite.getContext('2d')
        if (base)
            g.drawImage(base, 0, 0)
        const x0 = Math.max(rect.x, box.x) - box.x, y0 = Math.max(rect.y, box.y) - box.y
        const x1 = Math.min(rect.x + rect.w, box.x + box.w) - box.x, y1 = Math.min(rect.y + rect.h, box.y + box.h) - box.y
        if (x0 >= x1 || y0 >= y1)
            return sprite
        const alpha = this.cellAlphaCanvas ||= document.createElement('canvas')
        alpha.width = box.w
        alpha.height = box.h
        const a = alpha.getContext('2d')
        fillCellMask(a, cell.path)
        g.save()
        g.beginPath()
        g.rect(x0, y0, x1 - x0, y1 - y0)
        g.clip()
        g.clearRect(x0, y0, x1 - x0, y1 - y0)
        g.drawImage(alpha, 0, 0)
        g.globalCompositeOperation = 'source-in'
        g.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h)
        g.restore()
        return sprite
    }
    // TASK-1361: a cleared box.w x box.h canvas for a sprite, one a layer let go of (pruneCellSprites) when there is one, so the
    // variants rendered move after move make no new canvas once the layers hold their cap.
    cellSpriteCanvas(box) {
        const sprite = this.cellSpritePool.pop() || document.createElement('canvas')
        // Set even when equal: that clears the canvas and resets its context's state.
        sprite.width = box.w
        sprite.height = box.h
        return sprite
    }
    // TASK-1361: the layer's sprites cut to CELL_LAYER_VARIANTS a cell, those its cells took last kept (each cell's variant
    // now first, then the one before it, so an undo still draws a kept sprite); the others' canvases go to the pool
    // (cellSpriteCanvas, at most CELL_SPRITE_POOL). Not while a layer job is under way on the layer (its sprites made
    // before its last step are not yet any cell's variant).
    pruneCellSprites(layer) {
        const sprites = layer.sprites
        if (!sprites || this.surfaceLayerJob?.layer === layer || this.litView?.layerJob && layer === this.litCellLayer)
            return
        // The variants the cells hold now are the latest taken (a Map keeps its keys in the order set).
        for (const {index, key} of layer.cells) {
            const k = index + '|' + key, sprite = sprites.get(k)
            if (sprite) {
                sprites.delete(k)
                sprites.set(k, sprite)
            }
        }
        const kept = new Map(), pool = this.cellSpritePool
        for (const k of [...sprites.keys()].reverse()) {
            const index = k.slice(0, k.indexOf('|')), n = (kept.get(index) || 0) + 1
            kept.set(index, n)
            if (n > CELL_LAYER_VARIANTS) {
                if (pool.length < CELL_SPRITE_POOL)
                    pool.push(sprites.get(k))
                sprites.delete(k)
                ++this.cellSpritesPruned
            }
        }
    }
    // The layer's pixel rectangle rect drawn from its cells' sprites (each cell's for its variant, cell.key): cleared, then
    // every cell meeting it drawn (drawImage, clipped to rect; the cells' pixels are disjoint, so each is its sprite's).
    drawCellSprites(layer, rect) {
        const g = layer.getContext('2d')
        g.save()
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.clearRect(rect.x, rect.y, rect.w, rect.h)
        g.beginPath()
        g.rect(rect.x, rect.y, rect.w, rect.h)
        g.clip()
        g.globalCompositeOperation = 'lighter'
        for (const {index, box, key} of layer.cells) {
            if (box.x >= rect.x + rect.w || rect.x >= box.x + box.w || box.y >= rect.y + rect.h || rect.y >= box.y + box.h)
                continue
            g.drawImage(layer.sprites.get(index + '|' + key), box.x, box.y)
            ++this.cellSpriteDraws
        }
        g.restore()
    }
    // canvas black at the layer's mask pixels within rect, their alpha kept (under the layer, it covers what the canvas
    // covered and adds nothing).
    cutCellLayer(canvas, layer, rect) {
        const c = canvas.getContext('2d'), {x, y, w, h} = rect
        c.save()
        c.setTransform(1, 0, 0, 1, 0, 0)
        c.globalCompositeOperation = 'source-atop'
        c.drawImage(layer.mask, x, y, w, h, x, y, w, h)
        c.restore()
    }
    // target's pixel rectangle rect: the cut canvas there without the mask's pixels (its black taken out: added, its alpha
    // would add to the layer's) and the layer added, so each pixel is the canvas as drawn whole (target the canvas itself:
    // put back before a patch, resplitCellLayer; the shown canvas, prepareSurfaceCellLayer).
    composeCellLayer(target, canvas, layer, rect) {
        this.flushCellLayer(layer)
        const g = target.getContext('2d'), {x, y, w, h} = rect
        g.save()
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.beginPath()
        g.rect(x, y, w, h)
        g.clip()
        if (target !== canvas) {
            g.clearRect(x, y, w, h)
            g.drawImage(canvas, x, y, w, h, x, y, w, h)
        }
        g.globalCompositeOperation = 'destination-out'
        g.drawImage(layer.mask, x, y, w, h, x, y, w, h)
        g.globalCompositeOperation = 'lighter'
        g.drawImage(layer, x, y, w, h, x, y, w, h)
        g.restore()
    }
    // TASK-1316: target (a composed canvas: the shown cache or snapshot, composeCellLayer) brought up within the pixel
    // rectangle rect to its layer's cells' sprites (each cell's for its variant, cell.key): the mask's pixels taken out and
    // the sprites added there, as composeCellLayer adds the layer (its pixels there are the sums of those sprites,
    // drawCellSprites), but drawn from the sprites, not from the layer canvas changed in the frame.
    // ox, oy: target's pixel (0, 0) at the layer's (ox, oy) (a canvas of a region of it).
    composeCellSprites(target, layer, rect, ox = 0, oy = 0) {
        const g = target.getContext('2d'), {x, y, w, h} = rect
        g.save()
        g.setTransform(1, 0, 0, 1, -ox, -oy)
        g.beginPath()
        g.rect(x, y, w, h)
        g.clip()
        g.globalCompositeOperation = 'destination-out'
        g.drawImage(layer.mask, x, y, w, h, x, y, w, h)
        g.globalCompositeOperation = 'lighter'
        for (const {index, box, key} of layer.cells) {
            if (box.x >= x + w || x >= box.x + box.w || box.y >= y + h || y >= box.y + box.h)
                continue
            g.drawImage(layer.sprites.get(index + '|' + key), box.x, box.y)
        }
        g.restore()
        ++this.cellLayerComposites
    }
    // The surface cache's cell layer (splitCellLayer) after a build, or after a patch of rect (copy: the patch's region
    // copied into the cache, resplitCellLayer), or none (no cell layer). The frames draw the cache scaled: its layer is added
    // to it at the cache's own resolution, on the canvas they draw (surfaceCacheShown), where each pixel is the sum of the
    // two, to the bit (adding the layer after the scaled cache, each scaled on its own, rounds a level or so apart at a
    // fifth of a frame's pixels: TASK-1313 design.md, test-cell-layer's scaledAddAlternative).
    prepareSurfaceCellLayer(canvas, geometry, left, top, rect, copy) {
        if (!canvas.cellLayered) {
            copy?.()
            this.surfaceCellLayer = this.surfaceCacheShown = this.surfaceSplitJob = undefined
            return
        }
        const place = g => {
            g.scale(geometry.scale, geometry.scale)
            g.translate(-left, -top)
        }
        let layer = this.surfaceCellLayer
        if (rect && layer?.cells && layer.width === canvas.width && layer.height === canvas.height && layer.raster === canvas)
            rect = this.resplitCellLayer(canvas, layer, rect, copy)
        else {
            copy?.()
            this.surfaceSplitJob = undefined
            if (Grid.cellLayerSplitJobs) {
                // TASK-1372: split in steps (startCellSplit); the frames draw the cache uncut meanwhile.
                layer = this.surfaceCellLayer = layer || document.createElement('canvas')
                layer.raster = canvas
                const centre = this.cameraCentreAt(geometry.scale, left, top)
                this.surfaceSplitJob = this.startCellSplit(canvas, layer, place, centre,
                    layer => this.composeSurfaceCellLayer(canvas, layer, {x: 0, y: 0, w: canvas.width, h: canvas.height}))
                return
            }
            layer = this.surfaceCellLayer = this.splitCellLayer(canvas, layer || document.createElement('canvas'), place)
            layer.raster = canvas
            rect = {x: 0, y: 0, w: canvas.width, h: canvas.height}
        }
        this.composeSurfaceCellLayer(canvas, layer, rect)
    }
    // The camera view's centre in the pixels of a raster of the world at scale whose pixel (0, 0) is world (left, top).
    cameraCentreAt(scale, left, top) {
        return {x: (canvas.offset.x + width / 2 - left) * scale, y: (canvas.offset.y + height / 2 - top) * scale}
    }
    // The surface cache's shown canvas composed within rect (prepareSurfaceCellLayer).
    composeSurfaceCellLayer(canvas, layer, rect) {
        const shown = this.surfaceCacheShown ||= document.createElement('canvas')
        if (shown.width !== canvas.width || shown.height !== canvas.height) {
            shown.width = canvas.width
            shown.height = canvas.height
        }
        this.composeCellLayer(shown, canvas, layer, rect)
        ++this.cellLayerComposites
    }
    // The lit view's rest snapshot's cell layer (splitCellLayer) when finished, or after a patch of rect (copy, as
    // prepareSurfaceCellLayer's), or none.
    prepareLitCellLayer(view, rest, rect, copy) {
        if (!rest.canvas.cellLayered) {
            copy?.()
            rest.cellLayer = undefined
            return
        }
        const layer = this.litCellLayer ||= document.createElement('canvas')
        if (rect && rest.cellLayer === layer && layer.raster === rest.canvas && layer.cells && rest.shown)
            rect = this.resplitCellLayer(rest.canvas, layer, rect, copy)
        else {
            copy?.()
            view.splitJob = undefined
            if (Grid.cellLayerSplitJobs) {
                // TASK-1372: split in steps (startCellSplit, a step a task, queueLitTiles); the frames draw the snapshot
                // uncut meanwhile (rest.cellLayer none).
                rest.cellLayer = undefined
                layer.raster = rest.canvas
                const whole = {x: 0, y: 0, w: rest.canvas.width, h: rest.canvas.height}
                view.splitJob = this.startCellSplit(rest.canvas, layer, g => this.setLitRestTransform(g, view, rest),
                    {x: whole.w / 2, y: whole.h / 2}, layer => {
                        rest.cellLayer = layer
                        this.composeLitCellLayer(rest, layer, whole)
                    })
                view.splitJob.rest = rest
                return
            }
            rest.cellLayer = this.splitCellLayer(rest.canvas, layer, g => this.setLitRestTransform(g, view, rest))
            layer.raster = rest.canvas
            rect = {x: 0, y: 0, w: rest.canvas.width, h: rest.canvas.height}
        }
        this.composeLitCellLayer(rest, layer, rect)
    }
    composeLitCellLayer(rest, layer, rect) {
        // TASK-1316: the snapshot with its layer composed (composeCellLayer, as the cache's shown canvas), which the frames
        // draw in one drawImage instead of the snapshot and its layer added over it.
        const shown = this.litCellShown ||= document.createElement('canvas')
        if (shown.width !== rest.canvas.width || shown.height !== rest.canvas.height) {
            shown.width = rest.canvas.width
            shown.height = rest.canvas.height
        }
        this.composeCellLayer(shown, rest.canvas, layer, rect)
        rest.shown = shown
        ++this.cellLayerComposites
    }
    // A board change seen by the cell layers (Grid.liveCellLayer): each split cell whose variant (cellLayerKey) is no longer
    // its sprite's gets the sprite of its variant now drawn into the layer (drawCellSprites, the region its box and its
    // neighbours'), the one kept from before (an undo, a capture taken back) or rendered once (renderCellSprites, on a patch
    // buffer: never the cache or the snapshot built or patched); the surface cache's shown canvas is composed there again.
    // The cache and the snapshot themselves and their state are left as they are; a variant rendered draws with the light
    // map brought up to the owners now where they differ (atmosphericLighting.syncOwners, in its lightMap: the territory
    // glow, TASK-1314), which no frame draws from. Returns {cells: the cells redrawn, rendered: sprites rendered, failed:
    // layers whose variants could not be rendered (a patch under way, a light map not the raster's)}. TASK-1315: each frame
    // drawing a layer calls it for a board change (followCellLayer); its key also holds the fog of the buildings reaching the
    // cell (cellBuildingReach).
    // which: only that layer ('surface' or 'lit'), else both.
    refreshCellLayer(which) {
        return this.withCellReach(() => this.refreshCellLayerNow(which))
    }
    refreshCellLayerNow(which) {
        const result = {cells: 0, rendered: 0, failed: []}
        const layers = []
        const surface = this.surfaceCellLayer
        if (which !== 'lit' && surface?.cells && this.surfaceCache === surface.raster && this.surfaceCache.cellLayered)
            layers.push(['surface', surface, region => this.renderSurfaceCellSprites(region)])
        const view = this.litView, lit = this.litCellLayer
        if (which !== 'surface' && lit?.cells && view?.rest && view.rest.cellLayer === lit && lit.raster === view.rest.canvas)
            layers.push(['lit', lit, region => this.renderLitCellSprites(view, region)])
        for (const [name, layer, render] of layers) {
            this.flushCellLayer(layer)
            const changed = layer.cells.filter(c => c.key !== this.cellLayerKey(c.i, c.j))
            if (!changed.length)
                continue
            const region = changed.reduce((r, {box}) => !r ? box : pixelRect(Math.min(r.x, box.x), Math.min(r.y, box.y),
                Math.max(r.x + r.w, box.x + box.w), Math.max(r.y + r.h, box.y + box.h), layer.width, layer.height), null)
            const missing = changed.filter(c => !layer.sprites.has(c.index + '|' + this.cellLayerKey(c.i, c.j)))
            if (missing.length) {
                const buffer = render(missing.reduce((r, {box}) => pixelRect(Math.min(r.x, box.x), Math.min(r.y, box.y),
                    Math.max(r.x + r.w, box.x + box.w), Math.max(r.y + r.h, box.y + box.h), layer.width, layer.height), missing[0].box))
                if (!buffer) {
                    result.failed.push(name)
                    continue
                }
                for (const cell of missing)
                    this.cellSprite(layer, cell, buffer)
                result.rendered += missing.length
                this.cellLayerVariantRenders += missing.length
            }
            for (const cell of changed)
                cell.key = this.cellLayerKey(cell.i, cell.j)
            this.drawCellSprites(layer, region)
            // TASK-1316: the shown canvas from the sprites (composeCellSprites: no draw from the layer just changed).
            this.composeCellSprites(name === 'surface' ? this.surfaceCacheShown : view.rest.shown, layer, region)
            result.cells += changed.length
            ++this.cellLayerRefreshes
            // What the frames draw under the overlays changed (overlayCompositeKey).
            ++this.cellLayerRevision
        }
        return result
    }
    // The light map as it is (the raster's; with the cell layer its light state holds no owner, and lightMap brings its
    // territory glow up to the owners now, syncOwners) for fn's drawing of the board now, when it is the map
    // lightMap(board, cap) gives at this resolution; else null.
    withHeldLightMap(cap, fn) {
        const L = atmosphericLighting, bounds = mapDepth.surfaceBounds
        if (!L.map || !bounds || L.mapKey !== JSON.stringify(bounds) || L.mapScale !== L.resolution(bounds, cap))
            return null
        const kept = L.mapState
        L.mapState = L.lightState(this).slice()
        try {
            return fn()
        } finally {
            L.mapState = kept
        }
    }
    // The board now drawn on the surface cache's patch buffer within the pixel rectangle rect (grown by CELL_RENDER_MARGIN
    // patch margins), as a patch draws it (drawSurfacePatchStage: SURFACE_CACHE_STAGES clipped, at the cache's transform)
    // with the light map as it is (withHeldLightMap): the buffer, or null when no patch buffer is free.
    renderSurfaceCellSprites(rect) {
        const canvas = this.surfaceCache, buffer = this.surfacePatchBuffer, b = this.surfaceCacheBounds
        if (this.surfacePatchJob || this.surfaceCacheBuild || !buffer || buffer.width !== canvas.width ||
                buffer.height !== canvas.height || buffer.gradientSource !== canvas.getContext('2d'))
            return null
        const scale = this.surfaceCacheScale, W = canvas.width, H = canvas.height
        const m = CELL_RENDER_MARGIN * Math.max(SURFACE_PATCH_MARGIN_MIN, Math.ceil(SURFACE_PATCH_MARGIN * scale))
        const outer = pixelRect(rect.x - m, rect.y - m, rect.x + rect.w + m, rect.y + rect.h + m, W, H)
        const geometry = {scale, cacheWidth: b.width, cacheHeight: b.height}
        const job = {outer, scale, left: b.left, top: b.top, window: clipWindowOf(outer, W, H, b.left, b.top, scale, 1.05 * basis.r),
            build: {canvas: buffer, ctx: buffer.getContext('2d'), geometry, left: b.left, top: b.top, stage: 0, lit: false,
                atmospheric: true, state: [], overlayCells: []}}
        const lit = this.withHeldLightMap(scale, () => {
            for (const stage of SURFACE_CACHE_STAGES)
                this.drawSurfacePatchStage(job, stage)
            return job.build.lit
        })
        return lit ? buffer : null
    }
    // The board now drawn on the lit patch buffer within rect (grown by the lit patch margin), as a lit view patch draws it
    // (LIT_PATCH_STEPS' drawing, drawLitPatch) with the light map as it is: the buffer, or null.
    renderLitCellSprites(view, rect) {
        const rest = view.rest, buffer = this.litPatchBuffer
        if (view.patch || !buffer || buffer.width !== rest.canvas.width || buffer.height !== rest.canvas.height ||
                buffer.gradientSource !== litGradientSource() || view.mapScale !== atmosphericLighting.mapScale)
            return null
        const cw = buffer.width, ch = buffer.height, m = LIT_PATCH_MARGIN
        const outer = pixelRect(rect.x - m, rect.y - m, rect.x + rect.w + m, rect.y + rect.h + m, cw, ch)
        const job = {rest, outer, window: clipWindowOf(outer, cw, ch, -rest.e / view.a, -rest.f / view.d, view.a, 1.05 * basis.r)}
        const drawn = this.withHeldLightMap(undefined, () => {
            for (const step of LIT_PATCH_STEPS.slice(1, -1))
                step(this, job, view)
            return true
        })
        return drawn ? buffer : null
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
    // TASK-1315: a cache drawn with the cell layer (surfaceCacheLayered, Grid.liveCellLayer) holds no owner colour, suburb or
    // fog of a known cell (its sprites do, followCellLayer): only whether each cell is known is compared of its surface
    // state (a hidden-information reveal), so a move, undo, capture or suburb purchase matches. exact: the whole state
    // compared all the same (a build or patch under way, or a lit view still drawing, reads the board as it draws).
    surfaceStateMatches(ctx, changes, exact = false) {
        // The light state (atmosphericLighting.lightState) is compared cell by cell in the same pass.
        const lighting = this.surfaceCacheLighting
        if (!lighting || lighting.length != this.arr.length * this.arr[0].length + 1 ||
            lighting[0] !== (otherSettings.atmosphericVisuals ? basis.r : 0) ||
            this.surfaceCacheAtmospheric !== otherSettings.atmosphericVisuals ||
            !!this.surfaceCacheLayered !== this.cellLayerOn() ||
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
        // With the cell layer the light values hold no owner (atmosphericLighting.ownerFree).
        const ownerFree = atmosphericLighting.ownerFree(this)
        const states = this.surfaceCacheState, buildings = this.surfaceCacheBuildings, units = this.surfaceCacheUnits
        const buildingImages = this.surfaceCacheBuildingImages, unitImages = this.surfaceCacheUnitImages
        const inert = this.surfaceCacheInert, inertUnits = this.surfaceCacheInertUnits, inertBuildings = this.surfaceCacheInertBuildings
        const natureNames = this.surfaceCacheNatureNames
        const range = observing || changes ? this.checkRange() : this.checkRange(ctx), h = this.arr[0].length
        // With the cell layer only a cell's being known (its state's colour part not 0) is compared (sameState).
        const masked = !exact && !!this.surfaceCacheLayered
        const sameState = masked ? (a, b) => !(a >> 2) === !(b >> 2) : (a, b) => a == b
        // Visibility is compared on the whole board all the same (each cell's fog bit, a typed
        // array read): a cell hidden or uncovered anywhere rebuilds the cache, as it always has
        // (with the cell layer fog is its sprites').
        if (isFogOfWar && !masked && (range.i0 > 0 || range.i1 < this.arr.length || range.j0 > 0 || range.j1 < h)) {
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
                    if (!sameState(states[index], this.surfaceStateOf(hexagon, shown)) ||
                        lighting[index + 1] !== (!atmospheric || !shown && !ownerFree || kind === 2 || hexagon.unknown ? 0 :
                            1 + atmosphericLighting.ownerLight(hexagon, ownerFree)) ||
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
                    if (!sameState(states[index], this.surfaceStateOf(hexagon, shown)) ||
                        lighting[index + 1] !== (!atmospheric || !shown && !ownerFree || hexagon.unknown ? 0 :
                            atmosphericLighting.shownLightValue(hexagon, cell.building, ownerFree)) ||
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
                    !sameState(states[index], this.getSurfaceStateValue(i, j, observing)) ||
                    lighting[index + 1] !== atmosphericLighting.lightValue(this, cell, observing, ownerFree) ||
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
        this.surfaceCacheLayered = this.cellLayerOn()
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
        // With the cell layer (Grid.liveCellLayer) the finished raster is split (prepareSurfaceCellLayer).
        canvas.cellLayered = this.cellLayerOn()
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
        this.prepareSurfaceCellLayer(build.canvas, build.geometry, build.left, build.top)
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
        if (!otherSettings.atmosphericVisuals || !screen || screen.surfaceMoving || this.surfaceCacheQueued || this.litView?.unbuilt)
            return
        // TASK-1372: the cache's split, a step a task (surfaceSplitStep).
        if (this.surfaceSplitJob) {
            this.surfaceCacheQueued = true
            setTimeout(() => {
                this.surfaceCacheQueued = false
                if (this === grid && otherSettings.atmosphericVisuals && !gameEvent.screen.surfaceMoving)
                    this.surfaceSplitStep()
            })
            return
        }
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
            this.withLitState(build, () => this.surfaceStateMatches(undefined, undefined, true))
    }
    // Whether the surface cache matches the whole board (not only a view's cells).
    // exact: as surfaceStateMatches'.
    wholeSurfaceMatches(exact = false) {
        const overlayCells = this.surfaceOverlayCells
        this.surfaceOverlayCells = []
        try {
            return this.surfaceStateMatches(undefined, undefined, exact)
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
            if (job.canvas === this.surfaceCache && this.withLitState(job, () => this.wholeSurfaceMatches(true)))
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
            // With the cell layer a patch (a hidden-information reveal, a lamp, a building) also redraws the cells only its
            // layer would (owner colour, suburb, fog: the whole state compared), so its frames draw them all new.
            if (matches && changes.length && this.surfaceCacheLayered) {
                changes.length = 0
                matches = this.surfaceStateMatches(undefined, changes, true)
            }
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
        if (job.canvas !== this.surfaceCache || this.surfaceCacheBuild || !this.withLitState(job, () => this.wholeSurfaceMatches(true))) {
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
        // The region copied (with the cell layer, as its cells' variants are taken again: prepareSurfaceCellLayer).
        this.prepareSurfaceCellLayer(job.canvas, job.geometry, job.left, job.top, job.inner,
            () => copyCanvasRect(job.buffer, job.canvas, job.inner))
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
    // With the cell layer (light states without owners) a capture's glow is brought up as its owners (syncOwners).
    patchLightMap(rects, stored, cap) {
        const L = atmosphericLighting
        if (L.map && L.sameLightState(this, L.mapState))
            return L.syncOwners(this, cap)
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
        // With the cell layer the light values hold no owner (atmosphericLighting.ownerFree): a cell's owner then and now
        // (its surface state's colour, as collect lists it: in view and known; ownerValue) gives its glow's reach.
        const ownerFree = atmosphericLighting.ownerFree(this), states = this.surfaceCacheState
        const ownerOf = v => (v & 1) && (v >> 2) > 1 ? (v >> 2) - 1 : 0
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
            if (ownerFree) {
                const before = ownerOf(states[index]), after = atmosphericLighting.ownerValue(this, cell)
                if (was === now && before === after)
                    continue
                const reach = Math.max(hex, atmosphericLighting.glowReach(before), atmosphericLighting.glowReach(after))
                light.push({x0: c.x - reach, y0: c.y - reach, x1: c.x + reach, y1: c.y + reach})
                continue
            }
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
    // main: the frame's surface (drawMapSurface), which runs the surface layer job's steps (TASK-1360).
    drawSurfaceCache(ctx, main = false) {
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
        // Its cell layer brought up to the board's owner colours, suburbs and fog (TASK-1315), in a job's steps (TASK-1360).
        if (!this.followCellLayer('surface', undefined, undefined, main))
            return false
        // TASK-1372: uncut while split, the cache shows the cells as the split found them.
        if (this.surfaceSplitJob && !this.surfaceSplitHolds(this.surfaceSplitJob))
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
        const draw = image => ctx.drawImage(
            image,
            (visibleLeft - this.surfaceCacheBounds.left) * sourceScaleX,
            (visibleTop - this.surfaceCacheBounds.top) * sourceScaleY,
            (visibleRight - visibleLeft) * sourceScaleX,
            (visibleBottom - visibleTop) * sourceScaleY,
            visibleLeft,
            visibleTop,
            visibleRight - visibleLeft,
            visibleBottom - visibleTop
        )
        // With its cell layer, the two added (prepareSurfaceCellLayer).
        draw(this.surfaceCache.cellLayered && !this.surfaceSplitJob && this.surfaceCacheShown || this.surfaceCache)
        if (this.surfacePatchJob)
            this.drawPatchCells(ctx, this.surfacePatchJob, 'cache')
        else if (this.surfaceLayerJob) {
            const job = this.surfaceLayerJob
            for (const part of job.parts ||= this.surfaceLayerParts(job))
                this.drawPatchCells(ctx, part, 'cache')
            if (main)
                this.surfaceLayerStep()
        }
        return true
    }
    // TASK-1360: the surface layer job's changed cells as drawPatchCells draws them, with their light (the changed light's
    // part, atmosphericLighting.regionLight, found by the job's first frame): the job itself, or, for cells spanning more than
    // one such part draws (REGION_LIGHT_MAX map pixels a side), clusters of them each with its own part (on canvases of its
    // own slot), the sprites' rectangles with the cluster nearest them; a cluster whose part cannot be drawn is lit by the
    // light map as it is (its owners brought up by the job's first steps).
    surfaceLayerParts(job) {
        const L = atmosphericLighting
        if (!job.light.length || (job.regionLight = L.regionLight(this, this.patchCellsAreas(job), 'cache')))
            return [job]
        const h = this.arr[0].length, r = 1.05 * basis.r, limit = (L.REGION_LIGHT_MAX - 2 * L.MAP_GROW - 2) / (L.mapScale || 1)
        const clusters = []
        for (const index of job.changed) {
            const c = this.arr[Math.floor(index / h)][index % h].hexagon.calcPos()
            const box = {x0: c.x - r, y0: c.y - r, x1: c.x + r, y1: c.y + r}
            const join = (q, b) => ({x0: Math.min(q.x0, b.x0), y0: Math.min(q.y0, b.y0), x1: Math.max(q.x1, b.x1), y1: Math.max(q.y1, b.y1)})
            const fits = q => q.x1 - q.x0 <= limit && q.y1 - q.y0 <= limit
            const cluster = clusters.find(k => fits(join(k.span, box)))
            if (cluster) {
                cluster.span = join(cluster.span, box)
                cluster.changed.push(index)
            }
            else
                clusters.push({span: box, changed: [index], sprites: []})
        }
        const centre = q => ({x: (q.x0 + q.x1) / 2, y: (q.y0 + q.y1) / 2})
        for (const q of job.sprites) {
            const p = centre(q), d = k => {
                const c = centre(k.span)
                return Math.hypot(c.x - p.x, c.y - p.y)
            }
            clusters.reduce((a, k) => d(k) < d(a) ? k : a).sprites.push(q)
        }
        return clusters.map((k, n) => {
            const part = {boxes: job.boxes, changed: k.changed, sprites: k.sprites, light: job.light}
            part.regionLight = L.regionLight(this, this.patchCellsAreas(part), 'surface-layer-' + n)
            if (!part.regionLight)
                part.light = []
            return part
        })
    }
    // Whether the cache, patched or being patched to the board (patchSurfaceCache), is drawn on ctx: during a patch the
    // board matches the patch's state, and this frame's overlay cells are listed from it (surfaceOverlayCells).
    surfacePatchShows(ctx) {
        const job = this.surfacePatchJob
        if (!job)
            return this.surfaceStateMatches(ctx)
        if (!this.withLitState(job, () => this.surfaceStateMatches(ctx, undefined, true)))
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
        if (!gameEvent.screen.surfaceMoving || debug || this.drawLogicText || this.lod || typeof createImageBitmap !== 'function' ||
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
    // lies under the overlays (overlayCompositeKey: transform, canvas, sky, slab shadow, surface cache and its cell layer,
    // refreshCellLayer) are those of an earlier frame with a snapshot, the frame draws the snapshot's rectangles over the
    // overlays' pixels (the very pixels the calls drew there, with one drawImage a rectangle in place of every unit's
    // bars and bodies), then the calls after the overlays. Otherwise it makes every call in order (the direct
    // draw), and a frame whose calls and key repeat the previous frame's queues the snapshot
    // (queueOverlaySnapshot, drawn in a task after the frame).
    // Frames drawing a cache whose patch is under way (patchSurfaceCache) draw their overlays directly: the
    // patch's last step changes what lies under them, so a snapshot of them would be made for a few frames only.
    // Returns the recorder, or null when the frame draws its overlays directly.
    beginOverlayComposite(ctx) {
        const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
        const t = ctx.getTransform()
        // Not inside a recorded still frame (stillFrameCandidate): that recording stands for the frame's calls.
        if (typeof Proxy !== 'function' || debug || this.lod || this.stillRecording || !screen || screen.surfaceMoving || !this.surfaceCacheLit || this.surfacePatchJob || this.litView?.layerJob ||
                this.surfaceLayerJob ||
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
            this.surfaceCache, this.surfaceCacheRevision, b.left, b.top, b.width, b.height, this.cellLayerRevision]
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
            if (this.overlayComposite !== composite || now.some((v, k) => v !== key[k]) || this.surfacePatchJob || this.litView?.layerJob || this.surfaceLayerJob ||
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
        // As atmosphericBackground.draw and MapDepth.drawAtmosphericShadow draw them (the key holds their rasters).
        const sky = atmosphericBackground.raster, shadow = mapDepth.atmosphericShadow
        // TASK-1361: clipped to one rectangle at a time (disjoint, so each pixel is drawn once, in the same order), not
        // to one path of all of them: a whole-pixel rectangle clip is a scissor on the GPU, a path of many a clip mask
        // rasterized over the canvas before the draws (the stall after the frames that queue the snapshot).
        for (const r of disjointDeviceRects(composite.rects)) {
            g.save()
            clipToDeviceRects(g, [r])
            // The clip's rectangle leaves the current path; the drawing that follows starts without one.
            g.beginPath()
            applyCanvasState(g, composite.state)
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
        }
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
        if (plan.cache)
            return this.drawSurfaceCache(ctx, true) ? 'cache' : false
        const cw = ctx.canvas.width, ch = ctx.canvas.height
        const {view, rest} = plan
        if (rest) {
            ctx.save()
            ctx.setTransform(1, 0, 0, 1, 0, 0)
            // With its cell layer (splitCellLayer) the snapshot with the layer composed (TASK-1316, prepareLitCellLayer).
            ctx.drawImage(rest.canvas.cellLayered && rest.cellLayer && rest.shown || rest.canvas, 0, 0)
            ctx.restore()
            // job: the frame drew a patch's or layer job's cells over the snapshot (not a still frame, stillFrameSteady).
            this.litFrame = {view, rest: true, job: !!(view.patch || view.layerJob)}
            if (view.patch) {
                this.drawPatchCells(ctx, view.patch, 'lit')
                this.litPatchStep(view)
            }
            else if (view.layerJob) {
                this.drawPatchCells(ctx, view.layerJob, 'lit')
                this.litLayerStep(view)
            }
            else
                this.queueLitTiles(view, t, cw, ch)
            return true
        }
        const ox = Math.round(t.e - view.e), oy = Math.round(t.f - view.f)
        const range = this.litTileRange(cw, ch, ox, oy, 0)
        // A tile not built yet is drawn from the stand-in (the tasks build it, queueLitTiles); without one it is built now.
        let standIn, missing = null
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        for (let v = range.v0; v <= range.v1; ++v) {
            for (let u = range.u0; u <= range.u1; ++u) {
                if (!view.tiles.has(u + ',' + v) && (standIn ??= this.litStandIn(ctx))) {
                    (missing ||= new Set()).add(u + ',' + v)
                    continue
                }
                const tile = this.litTile(view, u, v)
                if (tile)
                    ctx.drawImage(tile, LIT_TILE_PAD, LIT_TILE_PAD, LIT_TILE, LIT_TILE,
                        u * LIT_TILE + ox, v * LIT_TILE + oy, LIT_TILE, LIT_TILE)
            }
        }
        ctx.restore()
        if (missing) {
            ctx.save()
            clipToDeviceRects(ctx, [...missing].map(key => {
                const [u, v] = key.split(',').map(Number)
                const x0 = Math.max(0, u * LIT_TILE + ox), y0 = Math.max(0, v * LIT_TILE + oy)
                return {x: x0, y: y0, w: Math.min(cw, (u + 1) * LIT_TILE + ox) - x0, h: Math.min(ch, (v + 1) * LIT_TILE + oy) - y0}
            }))
            ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f)
            this.drawSurfaceCache(ctx)
            ctx.restore()
        }
        // Tiles more than a tile off the canvas go back to the pool.
        for (const [key, tile] of view.tiles) {
            const [u, v] = key.split(',').map(Number)
            if (u < range.u0 - 1 || u > range.u1 + 1 || v < range.v0 - 1 || v > range.v1 + 1) {
                view.tiles.delete(key)
                this.releaseLitTile(tile)
            }
        }
        this.litFrame = {view, ox, oy, rest: false, missing}
        this.queueLitTiles(view, t, cw, ch)
        return true
    }
    // Whether the surface cache can stand in for the lit view on ctx's canvas (drawn magnified: lit, its state the board's,
    // no build or patch under way), so no frame builds the lit view's light map or tiles (Grid.litStandIns).
    // TASK-1316: exactly (surfaceStateMatches exact): with the cell layer a stand-in cache not drawn since a cell's owner, suburb
    // or fog changed (its layer not brought up, followCellLayer) stands in no more, as without the layer.
    litStandIn(ctx) {
        return Grid.litStandIns && !!this.surfaceCache && !!this.surfaceCacheLit && !this.surfaceCacheBuild && !this.surfacePatchJob &&
            this.surfaceStateMatches(ctx, undefined, true)
    }
    // Whether ctx's frame draws lit images, and which: false (the live light), else {t, view, rest}
    // with view the lit view at ctx's transform t (made now if it does not hold) and rest its
    // finished rest snapshot (null: the frame draws the tiles).
    planLitView(ctx) {
        const t = ctx.getTransform()
        // TASK-1377: the light map is vouched for by a view that holds exactly in this frame only (below).
        atmosphericLighting.trust = null
        const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
        const zooming = screen && screen.surfaceZooming
        if (!otherSettings.atmosphericVisuals || !screen || zooming ||
                t.b !== 0 || t.c !== 0 || t.a <= 0 || t.d <= 0 || this.constructionInView(ctx)) {
            if (this.litView && (this.litView.a !== t.a || this.litView.d !== t.d))
                this.dropLitView()
            // On a phone a zoom gesture draws the surface cache magnified where it can (Grid.litStandIns), not the direct draw.
            return zooming && typeof mobilePhone !== 'undefined' && mobilePhone && this.litStandIn(ctx) ? {t, cache: true} : false
        }
        const cw = ctx.canvas.width, ch = ctx.canvas.height
        let view = this.litView
        // A view being patched holds while its patch does (patchLitView).
        const holds = !!view && !view.patch && this.litViewHolds(ctx, view, t) ? view : null
        if (!view || !(holds || this.patchLitView(ctx, view, t))) {
            this.dropLitView()
            // The light map at the camera's scale is built a step a task (queueLitTiles) while the surface cache stands in.
            if (!atmosphericLighting.lightMapReady(this) && this.litStandIn(ctx)) {
                this.queueLitTiles(null, t, cw, ch)
                return {t, cache: true}
            }
            view = this.litView = this.newLitView(t, ctx.canvas)
        }
        // The rest snapshot's cell layer brought up to the board (TASK-1315); a view dropped for it is made again.
        // TASK-1372: so is one whose snapshot's split is behind the board.
        if (!this.followCellLayer('lit', ctx, t) || !this.litSplitHolds(view))
            view = this.litView = this.newLitView(t, ctx.canvas)
        // TASK-1377: a view that held and is still the one drawn vouches for the light map (atmosphericLighting.trust): the
        // frame's lightMap calls (the tiles, the lit edges) and the tasks building its tiles skip the whole board's light
        // state. exact: its whole state compared (litViewHolds' exact, not the rest snapshot's cell layer compare).
        if (Grid.litTrust && holds && view === holds)
            atmosphericLighting.trust = {board: this, view, rebuilds: view.rebuilds, exact: !view.rest || view.rest.done !== LIT_REST_BANDS}
        const rest = screen.surfaceMoving ? null : this.litRest(ctx, view, t, cw, ch)
        // TASK-1372 (Grid.litFirstViewSteps): a view with more than LIT_FRAME_TILES of the tiles on the canvas not built and
        // no stand-in for them (no surface cache yet: a new game's first frames) is not drawn: the frame draws the board
        // live, as a zoom gesture's frames do, while the tasks build those tiles, LIT_FIRST_TILE_BUDGET a task, nearest the
        // canvas's centre first (queueLitTiles), and no surface cache build starts (prepareSurfaceCache) until they are.
        if (!(rest && rest.done === LIT_REST_BANDS) && this.litTilesUnbuilt(ctx, view, t)) {
            this.queueLitTiles(view, t, cw, ch)
            return false
        }
        return {t, view, rest: rest && rest.done === LIT_REST_BANDS ? rest : null}
    }
    // Whether view at transform t of ctx's canvas has more than LIT_FRAME_TILES tiles on the canvas not built and no stand-in
    // (planLitView); view.unbuilt keeps the answer for queueLitTiles and prepareSurfaceCache.
    litTilesUnbuilt(ctx, view, t) {
        view.unbuilt = false
        if (!Grid.litFirstViewSteps)
            return false
        const cw = ctx.canvas.width, ch = ctx.canvas.height
        const range = this.litTileRange(cw, ch, Math.round(t.e - view.e), Math.round(t.f - view.f), 0)
        let missing = 0
        for (let v = range.v0; v <= range.v1; ++v)
            for (let u = range.u0; u <= range.u1; ++u)
                if (!view.tiles.has(u + ',' + v))
                    ++missing
        return view.unbuilt = missing > LIT_FRAME_TILES && !this.litStandIn(ctx)
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
        if (!this.litPatchable(ctx, view, t)) {
            view.patch = undefined
            return false
        }
        const job = view.patch
        if (job && this.withLitState(job, () => this.surfaceStateMatches(ctx, undefined, true)))
            return true
        view.patch = undefined
        return this.startLitPatch(view, view.rest)
    }
    // Whether view's finished rest snapshot can be patched at transform t of ctx's canvas (patchLitView; TASK-1316: its cell
    // layer's variants rendered a step a frame, startLitLayerJob): the camera resting on it at its transform, its sky and
    // light map the current ones, the lit patch buffer its size, drawing with the lit canvases' gradients.
    litPatchable(ctx, view, t) {
        const screen = gameEvent.screen, rest = view.rest, cw = ctx.canvas.width, ch = ctx.canvas.height
        const buffer = this.litPatchBuffer
        return !(!Grid.surfacePatching || screen.surfaceMoving || this.isObserving() || view.a !== t.a || view.d !== t.d ||
                !rest || rest.done !== LIT_REST_BANDS || rest.e !== t.e || rest.f !== t.f || rest.canvas.width !== cw ||
                rest.canvas.height !== ch || rest.sky !== atmosphericBackground.raster ||
                view.mapScale !== atmosphericLighting.mapScale || !buffer || buffer.width !== cw || buffer.height !== ch ||
                buffer.gradientSource !== litGradientSource())
    }
    // The patch of view's snapshot rest to the board now (patchLitView): view.patch, or the view brought up at once when no
    // pixel of the canvas changes. Returns false when the view is to be dropped instead.
    startLitPatch(view, rest) {
        const L = atmosphericLighting, changes = []
        const matches = this.withLitState(view, () => {
            const overlayCells = this.surfaceOverlayCells
            this.surfaceOverlayCells = []
            try {
                // With the cell layer, as patchSurfaceCache: a patch redraws every changed cell.
                const matches = this.surfaceStateMatches(undefined, changes)
                if (!matches || !changes.length || !this.surfaceCacheLayered)
                    return matches
                changes.length = 0
                return this.surfaceStateMatches(undefined, changes, true)
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
        // A patch draws every changed cell (a lit layer job under way ends: the layer follows after it, followCellLayer).
        view.layerJob = undefined
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
            this.prepareLitCellLayer(view, job.rest, job.inner, () => copyCanvasRect(this.litPatchBuffer, job.rest.canvas, job.inner))
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
        if (!plan || plan.cache)
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
            this.withLitState(view, () => this.surfaceStateMatches(ctx, undefined, !view.rest || view.rest.done !== LIT_REST_BANDS))
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
    // TASK-1316: the last result kept for its lit cells, hex radius, transform and margin (litEdgesKept): a lit layer
    // job takes it in a step before its last (planLitLayerJob), whose followedCellLayer then only finds it again.
    litEdges(view) {
        const cells = atmosphericLighting.collect(this, false).cells
        const margin = (atmosphericLighting.MAP_GROW + 1) * view.a / atmosphericLighting.mapScale + 2
        let key = basis.r + ',' + view.a + ',' + view.d + ',' + view.e + ',' + view.f + ',' + margin + '|'
        for (const {x, y} of cells)
            key += x + ',' + y + ';'
        if (this.litEdgesKept?.key === key)
            return this.litEdgesKept.edges
        const sides = new Map()
        for (const {pos} of cells) {
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
        this.litEdgesKept = {key, edges: {edges, outline}}
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
        const camera = typeof cameraTransform !== 'undefined' && typeof mainCtx !== 'undefined' &&
            (ctx === mainCtx || ctx === this.lodRecorder?.context) ? cameraTransform.capture(t) : null
        // With the cell layer (Grid.liveCellLayer, the view's state) the finished snapshot is split (prepareLitCellLayer).
        canvas.cellLayered = this.withLitState(view, () => !!this.surfaceCacheLayered)
        return view.rest = {e: t.e, f: t.f, canvas, sky: atmosphericBackground.raster, done: 0, base: 0, camera}
    }
    // Step k of view's rest snapshot: first the canvas as drawMain and draw() leave it before the
    // light (sky, slab shadow, surface and buildings; drawn whole, as a clip changes how paths
    // are rasterized), then band k of rows lit: draw()'s multiply, color-dodge and bloom
    // (drawRows). The first is LIT_REST_BASE's steps, one a call (rest.base of them done), the
    // calls a single draw would make in its order, its save left open from one to the next.
    buildLitRestBand(view, rest, k) {
        const canvas = rest.canvas, g = canvas.getContext('2d'), cw = canvas.width, ch = canvas.height
        if (k === 0 && rest.base < LIT_REST_BASE.length) {
            if (rest.base === 0) {
                // A snapshot dropped part way (the canvas is shared) leaves its save open.
                if (canvas.restOpen)
                    g.restore()
                g.save()
                canvas.restOpen = true
            }
            LIT_REST_BASE[rest.base++](this, g, view, rest)
            if (rest.base < LIT_REST_BASE.length)
                return
        }
        else
            g.save()
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
        if (k === 0)
            canvas.restOpen = false
        if (++rest.done === LIT_REST_BANDS) {
            this.prepareLitPatchBuffer(rest)
            this.prepareLitCellLayer(view, rest)
        }
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
        const snapshots = this.overlaySnapshots
        // No view yet: a step of the light map at the camera's scale (atmosphericLighting.stepLightMap).
        if (!view) {
            this.litTilesQueued = true
            setTimeout(() => {
                this.litTilesQueued = false
                if (this === grid && otherSettings.atmosphericVisuals && !this.litView && !gameEvent.screen.surfaceZooming &&
                        !this.litTaskDefers(snapshots))
                    atmosphericLighting.stepLightMap(this)
            })
            return
        }
        const ox = Math.round(t.e - view.e), oy = Math.round(t.f - view.f)
        const range = this.litTileRange(cw, ch, ox, oy, 1), missing = []
        const cu = (cw / 2 - ox) / LIT_TILE - 0.5, cv = (ch / 2 - oy) / LIT_TILE - 0.5
        for (let v = range.v0; v <= range.v1; ++v)
            for (let u = range.u0; u <= range.u1; ++u)
                if (!view.tiles.has(u + ',' + v)) missing.push({u, v, far: Math.hypot(u - cu, v - cv),
                    shown: u > range.u0 && u < range.u1 && v > range.v0 && v < range.v1})
        const rest = view.rest
        const banding = rest && rest.done < LIT_REST_BANDS && rest.e === t.e && rest.f === t.f
        // TASK-1372: the snapshot's split, a step a task (cellSplitStep), not during its patch.
        if (view.splitJob && !banding && !view.patch) {
            this.litTilesQueued = true
            setTimeout(() => {
                this.litTilesQueued = false
                if (view !== this.litView || !view.splitJob || view.patch || gameEvent.screen.surfaceZooming || this.litTaskDefers(snapshots) ||
                        !this.litSplitHolds(view))
                    return
                if (this.cellSplitStep(view.splitJob))
                    view.splitJob = undefined
            })
            return
        }
        if (!banding && !missing.length) {
            view.patchedTiles = false
            return
        }
        missing.sort((a, b) => a.far - b.far)
        this.litTilesQueued = true
        setTimeout(() => {
            this.litTilesQueued = false
            // Nothing is built inside a zoom gesture (its frames keep their live light), nor (TASK-1316) for a board the
            // view's cell layer is behind (the next frame brings it up, followCellLayer; a tile built now would also bring
            // the light map's owners up in the task drawing from it).
            if (view !== this.litView || gameEvent.screen.surfaceZooming || this.litTaskDefers(snapshots) || this.litLayerBehind(view))
                return
            if (banding && !gameEvent.screen.surfaceMoving) {
                // The tiles on the canvas the frames draw from the stand-in first (at most LIT_TILE_BUDGET a task, a view
                // the frames draw live LIT_FIRST_TILE_BUDGET), then the bands.
                const shown = missing.filter(m => m.shown && !view.tiles.has(m.u + ',' + m.v))
                if (shown.length) {
                    // TASK-1377: the task's tiles compare the board's light state once (atmosphericLighting.checkedOnce).
                    atmosphericLighting.checkedOnce(this, () => {
                        for (const {u, v} of shown.slice(0, view.unbuilt ? LIT_FIRST_TILE_BUDGET : LIT_TILE_BUDGET))
                            this.litTile(view, u, v)
                    })
                }
                else if (view.rest === rest && rest.done < LIT_REST_BANDS)
                    this.buildLitRestBand(view, rest, rest.done)
                return
            }
            // After a patch dropped some, one a task while the camera rests.
            const budget = view.unbuilt ? LIT_FIRST_TILE_BUDGET :
                view.patchedTiles && !gameEvent.screen.surfaceMoving ? LIT_TILE_PATCHED_BUDGET : LIT_TILE_BUDGET
            atmosphericLighting.checkedOnce(this, () => {
                for (const {u, v} of missing.slice(0, budget))
                    this.litTile(view, u, v)
            })
        })
    }
    // TASK-1372: whether view's split job (prepareLitCellLayer) still splits its rest snapshot: else it is dropped, and so is
    // the view when the board's cell states changed (the uncut snapshot shows the cells as the split found them).
    litSplitHolds(view) {
        const job = view.splitJob
        if (!job)
            return true
        if (job.rest !== view.rest || job.layer !== this.litCellLayer || job.canvas !== view.rest.canvas) {
            view.splitJob = undefined
            return true
        }
        if (this.cellLayerStatesAre(job.states))
            return true
        view.splitJob = undefined
        this.dropLitView()
        return false
    }
    // TASK-1316: whether view's rest snapshot has a cell layer drawn for other cell states than the board's now.
    litLayerBehind(view) {
        const states = this.cellLayerOn() && view.rest?.cellLayer?.states
        if (!states)
            return false
        return !this.cellLayerStatesAre(states)
    }
    // Whether a lit task leaves its turn to another task of the same pause between frames (the next frame queues it again),
    // so their drawing does not add up: a surface cache stage or check queued, or an overlay snapshot queued or made since
    // the frame that queued the lit task (snapshots: overlaySnapshots then).
    litTaskDefers(snapshots) {
        return Grid.litStandIns && (this.surfaceCacheQueued || !!this.overlayComposite?.queued || this.overlaySnapshots !== snapshots)
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
    // TASK-1377: the runs kept (litEdgeRuns) for the view's edges, its offset on the canvas, the canvas size and the squares
    // the stand-in drew; found again (litWork.edgeRuns) only when one of them changed.
    drawLitEdges(ctx) {
        const {view, ox, oy, rest, missing} = this.litFrame
        if (rest)
            return
        const cw = ctx.canvas.width, ch = ctx.canvas.height, squares = missing ? [...missing].join(';') : ''
        const kept = this.litEdgeRuns
        if (Grid.litTrust && kept && kept.view === view && kept.edges === view.edges && kept.ox === ox && kept.oy === oy && kept.cw === cw &&
                kept.ch === ch && kept.squares === squares) {
            atmosphericLighting.drawEdges(ctx, this, kept.runs)
            return
        }
        ++this.litWork.edgeRuns
        const runs = []
        const add = (x0, y0, x1, y1) => {
            x0 = Math.max(x0 + ox, 0); y0 = Math.max(y0 + oy, 0)
            x1 = Math.min(x1 + ox, cw); y1 = Math.min(y1 + oy, ch)
            if (x0 < x1 && y0 < y1) runs.push({x: x0, y: y0, w: x1 - x0, h: y1 - y0})
        }
        for (const run of view.edges) {
            const u0 = Math.floor(run.x / LIT_TILE), u1 = Math.floor((run.x + run.w - 1) / LIT_TILE)
            const v0 = Math.floor(run.y / LIT_TILE), v1 = Math.floor((run.y + run.h - 1) / LIT_TILE)
            let crossed = false
            if (missing)
                for (let v = v0; v <= v1 && !crossed; ++v)
                    for (let u = u0; u <= u1 && !crossed; ++u) crossed = missing.has(u + ',' + v)
            // A run reaching a square the stand-in drew (already lit) is lit only over the tiles.
            if (!crossed) {
                add(run.x, run.y, run.x + run.w, run.y + run.h)
                continue
            }
            for (let v = v0; v <= v1; ++v)
                for (let u = u0; u <= u1; ++u)
                    if (!missing.has(u + ',' + v))
                        add(Math.max(run.x, u * LIT_TILE), Math.max(run.y, v * LIT_TILE),
                            Math.min(run.x + run.w, (u + 1) * LIT_TILE), Math.min(run.y + run.h, (v + 1) * LIT_TILE))
        }
        this.litEdgeRuns = {view, edges: view.edges, ox, oy, cw, ch, squares, runs}
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
        this.litEdgeRuns = undefined
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
        if (this.litCellLayer)
            this.litCellLayer.width = this.litCellLayer.height = 0
        this.litCellLayer = undefined
        if (this.litCellShown)
            this.litCellShown.width = this.litCellShown.height = 0
        this.litCellShown = undefined
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
        // TASK-1395: the zoom raster's board (renderZoomBoard) is drawn directly: the surface cache and the lit view's
        // snapshots are not touched (the lit rest snapshot holds the sky).
        if (this.zoomBoardPass) {
            mapDepth.drawUnderlay(ctx, this)
            mapDepth.renderAtmosphericSides(ctx)
            this.drawHexagons(ctx)
            atmosphericLighting.drawShadows(ctx, this)
            if (isFogOfWar)
                this.drawFogOfWar(ctx)
            mapDepth.drawRim(ctx, this)
            return false
        }
        // At or below the cache's scale a frame without the cache draws directly.
        const cached = this.canUseSurfaceCache()
        if (cached && this.drawSurfaceCache(ctx, true)) {
            if (this.litView || this.litRestCanvas)
                this.releaseLitCanvases()
            return true
        }
        const lit = !cached && this.drawLitView(ctx)
        if (lit === 'cache')
            return true
        if (lit)
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
        const pass = this.zoomBoardPass
        ++this.drawSerial
        this.lod = pass ? pass.lod : this.lodTransform(ctx)
        // The slab's soft drop shadow on the sky, under the board (not in the zoom raster's board: the gesture's frames
        // draw it with the sky, drawZoomRaster).
        if (!pass)
            this.drawSlabShadow(ctx)
        const surface = this.drawMapSurface(ctx)
        this.frameSurface = surface
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
            // The light map's multiply would paint the transparent canvas off the board (as on a lit tile): clipped to
            // the lit cells as a lit tile's light is.
            else if (pass)
                atmosphericLighting.lightTile(ctx, this, pass.outline)
            else
                atmosphericLighting.draw(ctx, this, cachedScene && this.surfaceCacheLit)
            layered = cachedScene && this.drawOverlayLayer(ctx)
            if (!cachedScene) {
                if (!pass)
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
        // TASK-1412: drawMain and the zoom raster draw the marks after the selection overlay (SelectionOverlay.drawSelection).
        if (typeof gameEvent !== 'undefined' && !SelectionOverlay.deferred && !this.zoomBoardPass)
            gameEvent.selected?.drawSelectionMarks?.(ctx)
        if (composite)
            this.drawOverlayComposite(main, composite)
        this.lod = false
        if (pass)
            return
        this.prepareSurfaceCache()
        if (typeof mainCtx !== 'undefined' && (main === mainCtx || main === this.lodRecorder?.context)) {
            const t = main.getTransform()
            this.zoomRasterSource = {a: t.a, b: t.b, c: t.c, d: t.d, e: t.e, f: t.f, width: main.canvas.width, height: main.canvas.height}
        }
        this.countGestureFrame()
    }
    // One of the frames that follow a zoom input as part of its gesture (Screen.surfaceZooming, Screen.zoomGesture),
    // or a camera move (Screen.surfaceMoving).
    countGestureFrame() {
        const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
        if (screen?.surfaceZoomFrames > 0)
            --screen.surfaceZoomFrames
        if (screen?.surfacePanFrames > 0)
            --screen.surfacePanFrames
        if (screen?.zoomGestureFrames > 0)
            --screen.zoomGestureFrames
    }
    // TASK-1374: a zoom gesture's frames (wheel, pinch, the +/- keys: Screen.zoomBy) draw the board of the frame before the
    // gesture scaled to the camera (the zoom raster, captureZoomRaster). Nothing of the board is built or drawn at the
    // gesture's scales (no lit view, tile, light map, cache build or overlay layer: a zoom frame used to draw the whole view
    // directly). When the gesture ends (Screen.zoomGesture: 160 ms and four frames after its last input) the raster is
    // dropped and the next frame draws the board as any frame does: the lit view or surface cache rebuilt once at the new
    // scale, in its steps (TASK-1372). Grid.zoomRasters false: zoom frames as before.
    // TASK-1395: the raster is the board only, rendered once at the gesture's first input (renderZoomBoard: Grid.draw's board
    // at the camera of the last frame into a transparent canvas of the main canvas's size, no sky, slab shadow or interface).
    // It used to be a copy of the main canvas, which holds the last frame's interface (drawInterface draws on it after
    // drawMain: the HUD showed twice) and its sky (stretched with the board, while the sky does not scale with the camera).
    // The board's own canvas is drawn from, so no snapshot is closed under it (the held frame's bitmap holds the sky). No
    // raster when a move tween runs (it would hold the unit still) or the canvas, camera or board cannot be drawn so: that
    // gesture's frames are normal frames, as before TASK-1374.
    // TASK-1396: rendering the board at the gesture's first input took a frame of 100-1066 ms (189-8593 calls). With the
    // camera at rest the last frame is a held frame (TASK-1375/1376), whose bitmap is the main canvas as drawMain left it:
    // the sky and the board, no interface. The raster is that bitmap cut to the slab's footprint (copyZoomBoard: one
    // drawImage), the board rendered (renderZoomBoard, zoomBoardRenders) only when there is no such bitmap.
    captureZoomRaster() {
        if (!Grid.zoomRasters || this !== grid || this.zoomRaster || typeof mainCanvas === 'undefined' || typeof mainCtx === 'undefined' ||
                !this.zoomRasterSource || zoomRasterTweens())
            return
        const t = mainCtx.getTransform(), cw = mainCanvas.width, ch = mainCanvas.height
        if (t.b !== 0 || t.c !== 0 || t.a <= 0 || t.d <= 0 || !cw || !ch)
            return
        let canvas = this.zoomRasterCanvas
        if (!canvas || canvas.width !== cw || canvas.height !== ch) {
            canvas = this.zoomRasterCanvas = document.createElement('canvas')
            canvas.width = cw
            canvas.height = ch
        }
        // The raster's part a frame draws (box, device pixels): a copy holds nothing past the slab's band (copyZoomBoard).
        let box = this.copyZoomBoard(canvas, t)
        if (box)
            ++this.zoomBoardCopies
        else if (this.renderZoomBoard(canvas, t)) {
            box = {x: 0, y: 0, w: cw, h: ch}
            ++this.zoomBoardRenders
        }
        else
            return
        this.zoomRaster = {canvas, box, a: t.a, d: t.d, e: t.e, f: t.f}
    }
    // Draws the held frame's bitmap (captureHeldFrame: the last frame's sky and board, no interface) on canvas, cleared, but
    // where the slab is (zoomSlabPath): the board as the main canvas's frame at camera t drew it, without the sky, the
    // background hints or the slab shadow (but a band around it: copyZoomBoard's margin). False (nothing drawn)
    // when the last frame is not a held frame with its bitmap ready at camera t, else the device rectangle ({x, y, w, h})
    // past which the canvas holds nothing.
    copyZoomBoard(canvas, t) {
        const frame = this.lodFrame, bitmap = frame?.bitmap, key = frame?.key
        if (!bitmap || frame.serial !== this.drawSerial || bitmap.width !== canvas.width || bitmap.height !== canvas.height ||
                !key || key[0] !== t.a || key[1] !== t.d || key[2] !== t.e || key[3] !== t.f)
            return false
        // The slab, grown by Grid.ZOOM_SLAB_MARGIN (the rim and the edge cells' strokes reach past the outline), clips the
        // bitmap. With simple visuals the board's underlay casts its own soft shadow past the slab (MapDepth.renderUnderlay)
        // on a sky that is the cleared canvas: the clip holds it too; without the background hints that sky is all the
        // bitmap holds off the board, so it is copied whole. (A clip: a mask composited over the whole canvas, source-in or
        // destination-in, took 20 ms more at 1920x1080 in software.)
        const atmo = otherSettings.atmosphericVisuals, b = mapDepth.surfaceBounds
        const hints = typeof backgroundHintsShown === 'function' && backgroundHintsShown()
        let margin = Grid.ZOOM_SLAB_MARGIN * basis.r
        if (!atmo)
            margin += 2 * mapDepth.shadowBlur + mapDepth.shadowOffset
        let slab
        if (!b || (atmo || hints) && !(slab = this.zoomSlabPath(margin)))
            return false
        const x0 = Math.max(0, Math.floor(t.a * (b.left - margin) + t.e)), y0 = Math.max(0, Math.floor(t.d * (b.top - margin) + t.f))
        const x1 = Math.min(canvas.width, Math.ceil(t.a * (b.right + margin) + t.e))
        const y1 = Math.min(canvas.height, Math.ceil(t.d * (b.bottom + mapDepth.depth + margin) + t.f))
        const g = canvas.getContext('2d')
        g.save()
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.globalAlpha = 1
        if (slab) {
            g.globalCompositeOperation = 'source-over'
            g.clearRect(0, 0, canvas.width, canvas.height)
            g.setTransform(t.a, t.b, t.c, t.d, t.e, t.f)
            g.clip(slab)
            g.setTransform(1, 0, 0, 1, 0, 0)
        }
        else
            g.globalCompositeOperation = 'copy'
        g.drawImage(bitmap, 0, 0)
        g.restore()
        return {x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0)}
    }
    // The slab's footprint in world space grown by margin: its top face (mapDepth's outline), that face moved down by the
    // side depth, the side faces between them and, around the top and bottom outlines and the slab's vertical edges at the
    // outline's points, bands margin wide with round ends; each wound as the outline is, so that the path clipped (nonzero)
    // is their union. Kept per outline and margin. Undefined without an outline.
    zoomSlabPath(margin) {
        const loop = mapDepth.outlineLoop
        if (!mapDepth.outline || !loop || loop.length < 3)
            return undefined
        if (this.zoomSlab?.outline === mapDepth.outline && this.zoomSlab.margin === margin)
            return this.zoomSlab.path
        const area = points => {
            let a = 0
            for (let i = 0; i < points.length; ++i) {
                const p = points[i], q = points[(i + 1) % points.length]
                a += p.x * q.y - q.x * p.y
            }
            return a
        }
        const path = new Path2D(), depth = mapDepth.depth, wound = area(loop) > 0
        const add = points => {
            const a = area(points)
            if (!a)
                return
            if (a > 0 !== wound)
                points = points.slice().reverse()
            path.moveTo(points[0].x, points[0].y)
            for (let i = 1; i < points.length; ++i)
                path.lineTo(points[i].x, points[i].y)
            path.closePath()
        }
        const bottom = loop.map(p => ({x: p.x, y: p.y + depth}))
        add(loop)
        add(bottom)
        for (const face of mapDepth.faces)
            add([face.begin, face.end, face.bottomEnd, face.bottomBegin])
        if (margin > 0) {
            const band = (a, b) => {
                const dx = b.x - a.x, dy = b.y - a.y, k = margin / Math.hypot(dx, dy)
                if (!Number.isFinite(k))
                    return
                const nx = -dy * k, ny = dx * k
                add([{x: a.x + nx, y: a.y + ny}, {x: b.x + nx, y: b.y + ny}, {x: b.x - nx, y: b.y - ny}, {x: a.x - nx, y: a.y - ny}])
            }
            for (let i = 0; i + 1 < loop.length; ++i) {
                band(loop[i], loop[i + 1])
                band(bottom[i], bottom[i + 1])
                band(loop[i], bottom[i])
            }
            for (const p of [...loop, ...bottom]) {
                path.moveTo(p.x + margin, p.y)
                path.arc(p.x, p.y, margin, 0, 2 * Math.PI, !wound)
                path.closePath()
            }
        }
        this.zoomSlab = {outline: mapDepth.outline, margin, path}
        return path
    }
    // Draws the board as the main canvas's frame at camera t draws it (its level of detail; directly: drawMapSurface) on
    // canvas, cleared, without the sky, the background hints, the slab shadow or the interface; the light clipped to the lit
    // cells (lightTile). Grid.draw's state of the frame (its serial, surface, lit frame and plan, overlay layer and the jobs
    // it steps) is left as it was. False when it could not be drawn.
    renderZoomBoard(canvas, t) {
        const g = canvas.getContext('2d')
        canvas.gradientSource = litGradientSource()
        const lod = this.lodTransform(mainCtx)
        const kept = {drawSerial: this.drawSerial, frameSurface: this.frameSurface, litFrame: this.litFrame, litPlan: this.litPlan,
            coverOpen: this.coverOpen, litEdgesKept: this.litEdgesKept, litEdgeRuns: this.litEdgeRuns}
        let drawn = false
        g.save()
        try {
            g.setTransform(1, 0, 0, 1, 0, 0)
            g.globalCompositeOperation = 'source-over'
            g.globalAlpha = 1
            g.clearRect(0, 0, canvas.width, canvas.height)
            // As drawMain gives the main canvas its transform and line state before the board.
            if (typeof cameraTransform !== 'undefined')
                cameraTransform.apply(g, cameraTransform.capture(t))
            else
                g.setTransform(t.a, t.b, t.c, t.d, t.e, t.f)
            g.lineJoin = 'round'
            g.lineCap = 'round'
            const outline = otherSettings.atmosphericVisuals ? this.litEdges({a: t.a, d: t.d, e: t.e, f: t.f}).outline : []
            this.zoomBoardPass = {lod, outline}
            this.draw(g)
            drawn = true
        } catch (e) {
            console.error('zoom raster', e)
        } finally {
            this.zoomBoardPass = undefined
            g.restore()
            Object.assign(this, kept)
        }
        return drawn
    }
    // Draws a zoom gesture's frame on ctx (the main canvas, drawMain): the sky and the background hints as drawMain draws
    // them now (the sky does not scale with the camera; the hints are in world space), the slab shadow, where the gesture
    // opened the canvas past the raster the surface cache as it is (drawZoomUnderlay), then the zoom raster's board
    // (captureZoomRaster) scaled to the camera, nothing else of the old frame. False (the raster dropped) when the gesture
    // is over or the raster cannot stand for the frame.
    drawZoomRaster(ctx) {
        const raster = this.zoomRaster
        if (!raster)
            return false
        const t = ctx.getTransform(), cw = ctx.canvas.width, ch = ctx.canvas.height
        if (!Grid.zoomRasters || this !== grid || !gameEvent.screen.zoomGesture || zoomRasterTweens() ||
                raster.canvas.width !== cw || raster.canvas.height !== ch || t.b !== 0 || t.c !== 0 || t.a <= 0 || t.d <= 0) {
            this.zoomRaster = undefined
            return false
        }
        // A world point at device x in the raster is at device t.e + kx (x - raster.e) now.
        const kx = t.a / raster.a, ky = t.d / raster.d
        const x = t.e - kx * raster.e, y = t.f - ky * raster.f, w = kx * cw, h = ky * ch
        if (!atmosphericBackground.opaqueOver(ctx))
            ctx.clearRect(canvas.offset.x, canvas.offset.y, width, height)
        atmosphericBackground.draw(ctx)
        drawBackgroundHints(ctx)
        this.coverOpen = undefined
        this.drawSlabShadow(ctx)
        if (x > 0 || y > 0 || x + w < cw || y + h < ch)
            this.drawZoomUnderlay(ctx)
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        // Only the raster's box: the rest of it is transparent (a copy's sky is cut out), drawn for nothing.
        const box = raster.box
        if (box.w && box.h)
            ctx.drawImage(raster.canvas, box.x, box.y, box.w, box.h, x + kx * box.x, y + ky * box.y, kx * box.w, ky * box.h)
        ctx.restore()
        // TASK-1411: the selection overlay's raster scaled to the camera (the zoom raster's board has none).
        SelectionOverlay.drawSelection(ctx)
        this.dropHeldFrame()
        this.prepareSurfaceCache()
        this.countGestureFrame()
        return true
    }
    // The surface cache's raster (with its cell layer as drawSurfaceCache shows it) where it meets the view, as it is.
    drawZoomUnderlay(ctx) {
        const cache = this.surfaceCache, b = this.surfaceCacheBounds
        if (!cache || !b || this.surfaceSplitJob)
            return
        const left = Math.max(b.left, canvas.offset.x), top = Math.max(b.top, canvas.offset.y)
        const right = Math.min(b.left + b.width, canvas.offset.x + width), bottom = Math.min(b.top + b.height, canvas.offset.y + height)
        if (left >= right || top >= bottom)
            return
        const sx = cache.width / b.width, sy = cache.height / b.height
        ctx.drawImage(cache.cellLayered && this.surfaceCacheShown || cache, (left - b.left) * sx, (top - b.top) * sy,
            (right - left) * sx, (bottom - top) * sy, left, top, right - left, bottom - top)
    }
    // Whether a logic text has something to draw (a production's costs; a unit's search turns them on, all empty).
    logicTextShown() {
        if (!this.logicTextCells)
            return true
        for (const cell of this.logicTextCells)
            if (cell._logicText && cell._logicText.text != '')
                return true
        return false
    }
    // TASK-1375: level of detail when cells are tiny. Below Grid.LOD_RADIUS (a hexagon's on-screen radius, CSS pixels) a
    // frame of the main canvas is a level-of-detail frame: no cell texts (drawInfoTexts), hp and moves bars, production
    // silhouettes (a training unit, a portal's next demon and its rounds) or overlay composite and layer; the board's
    // surface, buildings, nature and towns come from the surface cache (one image) and the units from their cached body
    // images, as at any scale on that path. At or above it every frame draws as before. Not with debug or logic texts.
    lodTransform(ctx) {
        // TASK-1411: a selected unit's search turns the logic texts on with none set (Way.initialization): a level-of-detail
        // frame still, as without the selection (its overlay is blitted after the frame).
        if (!Grid.lodFrames || this !== grid || debug || this.drawLogicText && this.logicTextShown() || typeof mainCanvas === 'undefined' ||
                ctx.canvas !== mainCanvas)
            return false
        const t = ctx.getTransform()
        return t.b === 0 && t.c === 0 && t.a > 0 && t.a === t.d &&
            t.a * basis.r < Grid.LOD_RADIUS * (typeof window !== 'undefined' && window.devicePixelRatio || 1)
    }
    // A level-of-detail frame is recorded (CanvasCallRecorder: drawMain's calls on ctx, the main canvas, without drawing) and
    // made on ctx at its end (endLodFrame), unless it is steady (lodFrameSteady) and its calls and key (lodFrameKey: the
    // rasters it draws from) repeat those of the frame before it, which was such a frame made on ctx: the frame draws that
    // frame's board back in one drawImage (drawHeldFrame; a still board seen whole). Returns the recorder, or null when the
    // frame draws directly (not a level-of-detail frame).
    // TASK-1376: so is a still frame candidate above the threshold (stillFrameCandidate), held by stillFrameSteady's rules.
    beginLodFrame(ctx) {
        this.stillRecording = false
        if (typeof Proxy !== 'function' || !this.lodTransform(ctx) && !(this.stillRecording = this.stillFrameCandidate(ctx))) {
            this.dropHeldFrame()
            return null
        }
        const recorder = this.lodRecorder ||= new CanvasCallRecorder()
        recorder.begin(ctx, null)
        // Bounds are kept for an overlay snapshot only; none is made from this recording.
        recorder.endOverlays()
        return recorder
    }
    // The rasters a level-of-detail frame's calls draw from that change in place, by identity and revision.
    lodFrameKey(ctx) {
        const t = ctx.getTransform(), b = this.surfaceCacheBounds
        return [t.a, t.d, t.e, t.f, ctx.canvas.width, ctx.canvas.height, otherSettings.atmosphericVisuals, atmosphericBackground.raster,
            mapDepth.atmosphericShadow, this.surfaceCache, this.surfaceCacheShown, this.surfaceCacheRevision, this.cellLayerRevision,
            b?.left, b?.top, b?.width, b?.height,
            // TASK-1376: a still frame on the lit view's rest snapshot (changed in place by patches, layer jobs and splits).
            this.litView, this.litView?.rest, this.litView?.rest?.canvas, this.litView?.rest?.shown, this.litView?.rest?.cellLayer,
            this.cellLayerComposites, this.cellLayerRefreshes, this.litPatches, mapDepth.outline, mapDepth.rim]
    }
    // Whether a frame's calls can stand for the next frame's: drawn from the surface cache (not lit tiles or directly), no
    // camera move or zoom gesture, move tween, surface cache job
    // or lit layer job (they draw from buffers changed in place), and the light baked into the cache (else the light map,
    // patched in place, is drawn over it).
    lodFrameSteady(recorder) {
        const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
        if (this.frameSurface !== true || !screen || screen.surfaceMoving || screen.zoomGesture || zoomRasterTweens() || this.surfaceCacheBuild || this.surfacePatchJob ||
                this.surfaceLayerJob || this.surfaceSplitJob || this.litView?.layerJob || otherSettings.atmosphericVisuals && !this.surfaceCacheLit)
            return false
        return this.recordingSteady(recorder)
    }
    // Whether a recording's calls draw from nothing that can change unseen: a path object can change after it is
    // drawn (but the board's outline and rim, made once per geometry: the key holds them), an image still loading
    // draws nothing now and its pixels later.
    recordingSteady(recorder) {
        for (const c of recorder.calls) {
            if (!c.args)
                continue
            for (const a of c.args) {
                if (!a || typeof a !== 'object')
                    continue
                if (typeof Path2D !== 'undefined' && a instanceof Path2D && a !== mapDepth.outline && a !== mapDepth.rim)
                    return false
                if (typeof HTMLImageElement !== 'undefined' && a instanceof HTMLImageElement && !(a.complete && a.naturalWidth > 0))
                    return false
            }
        }
        return true
    }
    // TASK-1376: still frames above the level-of-detail threshold. A frame of the main canvas with the camera at rest (no
    // pan, zoom gesture or move tween) is recorded as a level-of-detail frame is (beginLodFrame) and made on the canvas
    // only when it is not steady (stillFrameSteady) or its calls or rasters (the key) differ from the frame before: a still
    // board is one drawImage of the held frame's board (drawHeldFrame), where it drew every sprite, bar, production
    // preview and cell text again each frame (and on the surface-cache path the overlay composite's snapshot, which a
    // recorded frame does not make: beginOverlayComposite). Its side effects (texts set and cleared, panels refreshed)
    // are those of the drawing code, which runs as before.
    stillFrameCandidate(ctx) {
        // Logic texts (a selected unit's) are recorded calls as any other; debug draws are not held.
        if (!Grid.stillFrames || this !== grid || debug || typeof mainCanvas === 'undefined' || ctx.canvas !== mainCanvas)
            return false
        const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
        const t = ctx.getTransform()
        return !!screen && !screen.surfaceMoving && !screen.zoomGesture && !zoomRasterTweens() &&
            t.b === 0 && t.c === 0 && t.a > 0 && t.d > 0
    }
    // Whether a recorded still frame (stillFrameCandidate) can stand for the next: the camera still at rest, and drawn from
    // the surface cache as a steady level-of-detail frame is (lodFrameSteady), or from the lit view's finished rest snapshot
    // drawn whole (no patch's or layer job's cells over it, no split or patch under way: they change it in place), or with
    // simple visuals the board drawn directly (its sprites and hexagon images do not change).
    stillFrameSteady(recorder) {
        const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
        if (!screen || screen.surfaceMoving || screen.zoomGesture || zoomRasterTweens())
            return false
        if (this.frameSurface === true)
            return this.lodFrameSteady(recorder)
        if (otherSettings.atmosphericVisuals) {
            const frame = this.litFrame, view = this.litView
            if (this.frameSurface !== 'lit' || !frame || !frame.rest || frame.job || frame.view !== view || !view ||
                    view.patch || view.layerJob || view.splitJob)
                return false
        }
        else if (this.frameSurface !== false)
            return false
        return this.recordingSteady(recorder)
    }
    // Ends a level-of-detail frame (beginLodFrame): its calls made on ctx, or, when they repeat the frame before, the board
    // as that frame left it (its snapshot, captureHeldFrame) drawn back in one drawImage. Returns whether the frame was held.
    // TASK-1376: the interface is drawn on the same canvas after drawMain (interfaceCtx is mainCtx), so the canvas does not
    // keep the board's pixels from one frame to the next: a steady frame made on the canvas is snapshot (the board without
    // the interface) and a held frame draws that snapshot, then leaves ctx's state as the frame's calls left it, so the
    // interface draws over the same pixels in the same state. Until the snapshot is ready (createImageBitmap resolves after
    // the frame) the frames repeating it are made again; they are not new held frames (stillRefreshes).
    endLodFrame(ctx, recorder) {
        const still = this.stillRecording
        this.stillRecording = false
        recorder.key = this.lodFrameKey(ctx)
        const last = this.lodFrame, steady = still ? this.stillFrameSteady(recorder) : this.lodFrameSteady(recorder)
        if (steady && last && last.serial === this.drawSerial - 1 && recorder.repeats(last)) {
            last.serial = this.drawSerial
            if (this.drawHeldFrame(ctx, last)) {
                if (still) ++this.stillHolds
                else ++this.lodHolds
                return true
            }
            recorder.replay(ctx, true)
            return false
        }
        recorder.replay(ctx, true)
        this.dropHeldFrame()
        this.lodFrame = steady ? {key: recorder.key, calls: recorder.calls, serial: this.drawSerial, state: canvasStateOf(ctx), bitmap: null} : undefined
        if (this.lodFrame) {
            this.captureHeldFrame(ctx, this.lodFrame)
            if (still)
                ++this.stillRefreshes
        }
        return false
    }
    // No held frame (its snapshot let go of).
    dropHeldFrame() {
        this.lodFrame?.bitmap?.close?.()
        this.lodFrame = undefined
    }
    // Snapshots ctx's canvas (the board as drawMain left it, before the interface) for frame: an image bitmap of its
    // pixels now, no drawing (none without createImageBitmap: the frames are then made, never held).
    captureHeldFrame(ctx, frame) {
        if (typeof createImageBitmap !== 'function')
            return
        let snapshot
        try {
            snapshot = createImageBitmap(ctx.canvas)
        } catch (e) {
            return
        }
        snapshot.then(bitmap => {
            if (this.lodFrame === frame)
                frame.bitmap = bitmap
            else
                bitmap.close?.()
        }, () => {})
    }
    // Draws the held frame's snapshot (captureHeldFrame) over ctx's canvas, its pixels replaced, and gives ctx the state the
    // frame's calls left it in. False when the snapshot is not ready.
    drawHeldFrame(ctx, frame) {
        const bitmap = frame.bitmap
        if (!bitmap || bitmap.width !== ctx.canvas.width || bitmap.height !== ctx.canvas.height)
            return false
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.globalCompositeOperation = 'copy'
        ctx.drawImage(bitmap, 0, 0)
        ctx.restore()
        const state = frame.state
        for (const name of CANVAS_STATE)
            if (name in state && ctx[name] !== state[name]) ctx[name] = state[name]
        if (state.lineDash) ctx.setLineDash(state.lineDash)
        return true
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

// Whether a move tween runs: the zoom raster (Grid.drawZoomRaster) and a held frame would hold the unit still. Attack
// animations (attackFx) draw over the frame, held or not (drawMain), and keep no frame live.
function zoomRasterTweens() {
    return typeof moveTween !== 'undefined' && moveTween.tweens.size > 0
}

// Clips ctx to rects (whole device pixel rectangles {x, y, w, h}); leaves the identity transform.
function clipToDeviceRects(ctx, rects) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.beginPath()
    for (const r of rects)
        ctx.rect(r.x, r.y, r.w, r.h)
    ctx.clip()
}

// The same pixels as rects (whole device pixel rectangles {x, y, w, h}, which may overlap) in disjoint rectangles: rows
// of the rectangles' edges, each the spans covering it, and a row the same spans as the row above joined to it.
function disjointDeviceRects(rects) {
    const ys = [...new Set(rects.flatMap(r => [r.y, r.y + r.h]))].sort((a, b) => a - b)
    const out = []
    let open = []
    for (let k = 0; k + 1 < ys.length; ++k) {
        const y0 = ys[k], y1 = ys[k + 1]
        const spans = []
        for (const r of rects.filter(r => r.y <= y0 && r.y + r.h >= y1).sort((p, q) => p.x - q.x)) {
            const last = spans[spans.length - 1]
            if (last && r.x <= last.x1) last.x1 = Math.max(last.x1, r.x + r.w)
            else spans.push({x0: r.x, x1: r.x + r.w})
        }
        const next = []
        for (const s of spans) {
            const above = open.find(o => o.x === s.x0 && o.x + o.w === s.x1 && o.y + o.h === y0)
            if (above) {
                above.h = y1 - above.y
                next.push(above)
            }
            else {
                const r = {x: s.x0, y: y0, w: s.x1 - s.x0, h: y1 - y0}
                out.push(r)
                next.push(r)
            }
        }
        open = next
    }
    return out
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
        // TASK-1376: whether a recorded call changed the transform (with the saves made since, as save and restore keep
        // it): until one does, getTransform answers the real context's. The scratch context keeps it in single precision
        // (0.13729862868785858 for the camera's 0.13729863013467103), which code reading it then draws with (a lit rest
        // snapshot made in a recorded frame was set up a hair off the camera, a level or two of its light off).
        this.ownTransform = false
        this.ownTransforms = []
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
        if (name === 'getTransform' && !this.ownTransform)
            return this.target.getTransform()
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
        if (name === 'save')
            this.ownTransforms.push(this.ownTransform)
        else if (name === 'restore') {
            if (this.ownTransforms.length)
                this.ownTransform = this.ownTransforms.pop()
        }
        else if (name === 'reset') {
            this.ownTransforms.length = 0
            this.ownTransform = true
        }
        else if (name === 'translate' || name === 'scale' || name === 'rotate' || name === 'transform' || name === 'setTransform' ||
                name === 'resetTransform')
            this.ownTransform = true
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
// ctx's state properties and line dash (not its transform), as applyCanvasState and Grid.drawHeldFrame set them.
function canvasStateOf(ctx) {
    const state = {}
    for (const name of CANVAS_STATE)
        if (name in ctx) state[name] = ctx[name]
    if (typeof ctx.getLineDash === 'function') state.lineDash = ctx.getLineDash()
    return state
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
// TASK-1313 (on since TASK-1316, with atmospheric visuals): true keeps the cells' tiles, owner colours and fog out of the
// surface cache and the lit view's rest snapshot, in a cell layer of per-cell variant sprites added over them
// (Grid.splitCellLayer, refreshCellLayer). With it the light state holds no owner (TASK-1314,
// atmosphericLighting.ownerFree): the sprites hold the territory glow.
Grid.liveCellLayer = true
// TASK-1360: true brings the surface cache's cell layer up to a board change needing new variants in a job, a step a frame
// (Grid.startSurfaceLayerJob); false draws them all in the frame that found the change (refreshCellLayer).
Grid.surfaceLayerJobs = true
// TASK-1372: true splits a raster into its cell layer in steps, CELL_SPLIT_CELLS cells a task (Grid.startCellSplit), and a
// lit view without a stand-in has its tiles built in tasks while the frames draw the board live (Grid.litTilesUnbuilt); false
// does each in the frame or task that needs it, as before.
Grid.cellLayerSplitJobs = true
Grid.litFirstViewSteps = true
const CELL_SPLIT_CELLS = 400
// TASK-1361: variants a cell layer keeps a cell (the cell's now and the one before, for an undo; Grid.pruneCellSprites) and
// sprite canvases kept for reuse (Grid.cellSpriteCanvas).
const CELL_LAYER_VARIANTS = 2
const CELL_SPRITE_POOL = 128
// Variant sprites a surface layer job makes a step (Grid.startSurfaceLayerJob).
const SURFACE_LAYER_SPRITES = 8
// Light map owner sync steps (atmosphericLighting.startOwnerSync: the rings kept or put back, a build step) a surface layer
// job's step runs (Grid.startSurfaceLayerJob).
const SURFACE_LAYER_SYNC_STEPS = 4
// The largest part of the cache's pixels a surface layer job's step composes (Grid.startSurfaceLayerJob: bands of rows).
const SURFACE_LAYER_COMPOSE = 0.15
// TASK-1315: how far off the board (hex radii, plus the slab's depth and shadow) the cells at its side hold the pixels
// nearest them in the cell layer (Grid.cellLayerCells).
const CELL_LAYER_EDGE_REACH = 0.5
// TASK-1371: pixels a pixel's centre keeps off a bisector of two cells' centres for the cell mask to take its side without
// testing it (Grid.buildCellMask), masks kept by geometry and scale (cellMaskCache, the least recently used dropped) and the
// work of building them (builds, pixels tested, centre distances; hits: masks served from the cache).
const CELL_MASK_MARGIN = 0.25
const CELL_MASK_CACHE = 2
const cellMaskCache = new Map()
// TASK-1373: a mask's pixels (alpha: w x h, non-zero at them) as a path of whole-pixel rectangles (each row's runs, rows
// with the same runs as one rectangle). Filled black (fillCellMask) on a cleared canvas with the identity
// transform, it is the mask to the bit (opaque there, transparent elsewhere: whole pixels, no partial coverage), with no
// ImageData put.
function maskPath(alpha, w, h) {
    const path = new Path2D()
    let open = [], top = 0
    for (let y = 0; y <= h; ++y) {
        const runs = []
        for (let x = 0, p = y * w; y < h && x < w; ++x)
            if (alpha[p + x]) {
                const x0 = x
                while (x < w && alpha[p + x]) ++x
                runs.push(x0, x)
            }
        if (runs.length === open.length && runs.every((v, k) => v === open[k]))
            continue
        for (let k = 0; k < open.length; k += 2)
            path.rect(open[k], top, open[k + 1] - open[k], y - top)
        open = runs
        top = y
    }
    return path
}
function fillCellMask(g, path) {
    g.save()
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.globalCompositeOperation = 'source-over'
    g.globalAlpha = 1
    g.fillStyle = '#000'
    g.fill(path)
    g.restore()
}
Grid.cellMaskWork = {builds: 0, hits: 0, tests: 0, distances: 0}
// Hex radii beyond a hexagon and the glow's reach within which an owner's glow counts in a cell's variant (Grid.cellGlowCells).
const CELL_GLOW_MARGIN = 0.5
// Patch margins round a surface cache variant render (Grid.renderSurfaceCellSprites): with one, the fog's edge where it meets
// a rendered cell's corner came out up to 26 levels off the whole build at the fogged hot-seat board's opening fit (scale
// 0.24, test-cell-layer glow: 2 pixels at 12 and 15 levels in the frame); with four, at most 3 (TASK-1314).
const CELL_RENDER_MARGIN = 4
// Whether the surface cache stands in for the lit view's light map and tiles while they are built over frames
// (Grid.litStandIn): drawn magnified until the light map is built (and on a phone in a zoom gesture, where the direct draw
// costs about three times a cached frame), and over a tile not built yet. False: a frame builds what it draws (the light
// map and the visible tiles), as a whole rebuild does.
Grid.litStandIns = true
// TASK-1374: true draws a zoom gesture's frames from the zoom raster, the board rebuilt once when it ends (Grid.drawZoomRaster);
// false draws them as any frame (the board directly above the surface cache's scale on a desktop).
Grid.zoomRasters = true
// TASK-1396: the band around the slab (in basis.r) a zoom raster copied from the held frame keeps (Grid.copyZoomBoard): the rim and
// the edge cells' strokes, half outside the outline.
Grid.ZOOM_SLAB_MARGIN = 0.12
// TASK-1375: level-of-detail frames (Grid.lodTransform) below this hexagon radius on screen, in CSS pixels (12 device pixels at
// the user's DPR 1.5): the hp and moves bars are then about a pixel high and the cell texts 3-4 pixels, unreadable. False:
// every frame draws as above it.
Grid.LOD_RADIUS = 8
Grid.lodFrames = true
// TASK-1376: simple visuals' frames walk the cells reaching the canvas only (drawRange); still frames above the
// level-of-detail threshold are held (Grid.stillFrameCandidate).
Grid.simpleCulling = true
Grid.stillFrames = true
// TASK-1377: a lit view holding exactly vouches for the light map (atmosphericLighting.trust) and drawLitEdges keeps its runs
// (litEdgeRuns). False: every frame compares the whole board's light state and finds the runs again.
Grid.litTrust = true
// How often (ms) an idle frame compares the surface cache with the whole board (Grid.prepareSurfaceCache).
const SURFACE_CACHE_CHECK_MS = 500
// The surface cache's captured state (captureSurfaceState), swapped for a lit view's copy (withLitState).
const SURFACE_STATE_FIELDS = ['surfaceCacheLighting', 'surfaceCacheAtmospheric', 'surfaceCacheLayered', 'surfaceCacheState',
    'surfaceCacheBuildings', 'surfaceCacheUnits', 'surfaceCacheBuildingImages', 'surfaceCacheUnitImages',
    'surfaceCacheInert', 'surfaceCacheInertUnits', 'surfaceCacheInertBuildings', 'surfaceCacheNatureNames']
// Lit tiles (Grid.drawLitView): side in device pixels (and the margin round it), tiles built
// between two frames, spare canvases kept, the side of the edge blocks the frame lights and the
// rest snapshot's bands.
const LIT_TILE = 256
const LIT_TILE_PAD = 8
const LIT_TILE_BUDGET = 5
// TASK-1372: tiles a frame without a stand-in builds itself (drawLitView; more and it draws the board live, planLitView), and
// tiles a task builds meanwhile (queueLitTiles).
const LIT_FRAME_TILES = 8
const LIT_FIRST_TILE_BUDGET = 16
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
// The rest snapshot's steps before its first band of light (Grid.buildLitRestBand), one a task between frames: the sky,
// the slab shadow, then the scene's parts, its cells' tiles in LIT_REST_HEX_STEPS runs. Each draws at most about two of the
// camera canvas's area (drawn megapixels by visualsPerf's count), so no task with its frame draws much more than a frame.
const LIT_REST_HEX_STEPS = 3
const LIT_REST_BASE = [
    (grid, g) => {
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.clearRect(0, 0, g.canvas.width, g.canvas.height)
        atmosphericBackground.draw(g)
    },
    (grid, g, view, rest) => {
        g.lineJoin = 'round'
        g.lineCap = 'round'
        grid.setLitRestTransform(g, view, rest)
        drawBackgroundHints(g)
        mapDepth.drawAtmosphericShadow(g, grid)
    },
    // The parts as drawLitScene(g) draws them (no underlay rectangle: the camera's view).
    (grid, g) => LIT_SCENE_PARTS[0](grid, g),
    ...Array.from({length: LIT_REST_HEX_STEPS}, (_, k) => (grid, g) => grid.drawHexagons(g, {k, n: LIT_REST_HEX_STEPS})),
    ...LIT_SCENE_PARTS.slice(2).map(part => (grid, g) => part(grid, g))
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
// TASK-1316: the largest part of the canvas a band of a lit layer job's region spans (Grid.planLitLayerJob); each of its
// steps draws about that area once (LIT_LAYER_PARTS), so no frame of the job draws much more than one with a lit view
// patch's step; the sprites made and composed are in groups and chunks of a sixth and a third of it. The light in
// LIT_LAYER_LIGHT_BANDS bands of rows of a band (each light's step about half the lit patch's).
const LIT_LAYER_STEP = 0.2
const LIT_LAYER_LIGHT_BANDS = 2
// TASK-1316: a lit layer job's drawing of a band on the lit patch buffer (Grid.planLitLayerJob: each list a step, each
// part in Grid.drawLitPatch): LIT_PATCH_STEPS' drawing up to the light with its first step's clear, sky and slab shadow
// apart and the grout and the tiles in LIT_REST_HEX_STEPS runs apart (the calls drawHexagons makes), each step about the
// band's area once; the light follows in LIT_LAYER_LIGHT_BANDS bands (planLitLayerJob).
const LIT_LAYER_PARTS = [
    // The clear of the band's outer rectangle only (the clip's; the canvas whole cost a frame its size).
    [(grid, g, part) => {
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.clearRect(part.outer.x, part.outer.y, part.outer.w, part.outer.h)
    }],
    [(grid, g) => {
        g.setTransform(1, 0, 0, 1, 0, 0)
        atmosphericBackground.draw(g)
    }],
    [(grid, g) => {
        drawBackgroundHints(g)
        mapDepth.drawAtmosphericShadow(g, grid)
    }],
    [(grid, g) => LIT_SCENE_PARTS[0](grid, g)],
    [(grid, g) => grid.drawHexagons(g, {grout: true, n: 0})],
    // A run of the tiles draws about a third of the area: two runs a step; the last with the shadows, fog and rim, which
    // draw little there.
    [0, 1].map(k => (grid, g) => grid.drawHexagons(g, {k, n: LIT_REST_HEX_STEPS, grout: false})),
    [(grid, g) => grid.drawHexagons(g, {k: 2, n: LIT_REST_HEX_STEPS, grout: false}), LIT_SCENE_PARTS[2]],
    [LIT_SCENE_PARTS[3]],
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
