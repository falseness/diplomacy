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
// TASK-1499: the grid's deferred cache, layer and light tasks draw the board as its frames do: with the cells of an own
// kill not landed yet in their state before it (attackFx.withHeldCells).
function gridTask(fn) {
    return () => typeof attackFx !== 'undefined' ? attackFx.withHeldCells(fn) : fn()
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
        // The production preview's text (drawProductionPreview), kept across frames.
        this.productionText = undefined
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
            Grid.logicTextChanged()
        }
        return this._logicText
    }
    set logicText(text) {
        this._logicText = text
        if (text) this.logicTextCells?.push(this)
        Grid.logicTextChanged()
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
        // TASK-1474: raster of the slab shadow, surface cache and overlays while the camera moves far out (drawSceneLayer).
        this.sceneLayer = undefined
        this.sceneLayerQueued = false
        this.sceneLayerBuilds = 0
        this.sceneLayerFrames = 0
        // TASK-1515: raster of the units, bars and cell texts while the camera pans on the lit tiles (drawLitLayer).
        this.litLayer = undefined
        this.litLayerQueued = false
        this.litLayerScratch = undefined
        this.litLayerBuilds = 0
        this.litLayerFrames = 0
        // TASK-1546: the lit layer drawn in steps (Grid.litLayerSteps: litLayerRasterSteps), layers given up, tasks per layer.
        this.litLayerJob = undefined
        this.litLayerDrawnSerial = -1
        this.litLayerRedrawn = undefined
        this.litLayerRetired = undefined
        this.litLayerJobsDropped = 0
        this.litLayerTaskCounts = []
        // TASK-1551: the lit layer extended by strips while the camera pans at its scale (queueLitStrips): strip jobs done, strips
        // drawn, full rebuilds queued by cause, and piece canvases a trim let go of while a kept recording listed the layer.
        this.litLayerStripJobs = 0
        this.litLayerStrips = 0
        this.litLayerRebuilds = {}
        this.litPiecesHeld = []
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
        // TASK-1517: the last frame's board calls on the main canvas (keepZoomSource: every frame but a move tween's is
        // recorded), whether the frame being drawn is recorded only for that (zoomSourceCandidate), the zoom rasters replayed
        // from it at once (replayZoomBoard) or from its board snapshot (copyZoomImage), the stepped replay under way
        // (startZoomReplay), its steps, longest step (ms) and finished replays swapped in, and its canvas.
        // The rasters copied from a recording's board snapshot (zoomBitmapCopies, keepZoomBitmap), the snapshots taken, the
        // gestures that held the frame on screen until their stepped raster was swapped in (holdZoomFrame: starts, frames
        // held, given up) and why a recording could not be replayed at once (zoomSourceFor: none, serial, camera, key,
        // layers, over the sync limit). zoomScreenCopies stays 0: the main canvas (with its interface) is never copied.
        this.zoomSource = undefined
        this.zoomRecording = false
        this.zoomBoardReplays = 0
        this.zoomScreenCopies = 0
        this.zoomBitmapCopies = 0
        this.zoomSourceBitmaps = 0
        // TASK-1546: snapshots not taken (keepZoomBitmap: lit-tile frames follow).
        this.zoomBitmapSkips = 0
        this.zoomHoldStarts = 0
        this.zoomHeldFrames = 0
        this.zoomHoldDrops = 0
        this.zoomSourceMisses = {none: 0, serial: 0, camera: 0, key: 0, layers: 0, overSync: 0}
        this.zoomReplayJob = undefined
        this.zoomReplaySteps = 0
        this.zoomReplayMaxStepMs = 0
        this.zoomReplaySwaps = 0
        this.zoomReplayCanvas = undefined
        // TASK-1518: the board's first frame held while what it draws is built in steps (holdStartFrame): the job (null once
        // over), and the frames held, steps run, longest step (ms), the frames' work (ms), and how it ended
        // ('built', 'camera', 'time', 'direct': a drawAll call outside the game loop, 'off').
        // Set by GameManager.start: a board loaded otherwise (a save, an online board, a turn playback's recordings) is not held.
        this.startHoldWanted = false
        this.startRestFirst = false
        // TASK-1543: when the frames after the start hold first called litRestUnderWay (its START_REST_FIRST_MS bound).
        this.startRestFirstAt = undefined
        this.startJob = undefined
        this.startHeldFrames = 0
        this.startSteps = 0
        this.startMaxStepMs = 0
        this.startWorkMs = 0
        this.startEnd = undefined
        // By kind of piece (startBuildSteps' yields): [pieces, ms, longest ms].
        this.startPieces = {}
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
        // TASK-1559 (Grid.litSectors): the lit tiles kept as board-space sectors (render/sectorCache.js; level = the view's
        // device scale, a sector a LIT_TILE square of the board's device grid at that scale), owned by the cache (LRU under
        // SECTOR_CACHE_BYTES; a tile evicted or released leaves the view, close), kept past the view that built them: a view
        // made again at a scale finds them (adoptSectors: the cells changed since the view they were built for, sectorBasis,
        // dirty only the sectors they reach, staleSectors), a pan back finds them.
        // On a phone the budget is LIT_SECTOR_PHONE_BYTES (the browser's canvas memory is a few hundred MB in all).
        this.sectors = typeof SectorCache === 'function' ? new SectorCache({size: LIT_TILE, pad: 0,
            budget: typeof mobilePhone !== 'undefined' && mobilePhone ? LIT_SECTOR_PHONE_BYTES : LIT_SECTOR_BYTES}) : null
        this.sectorBasis = undefined
        this.sectorOutline = undefined
        this.sectorFrame = -1
        this.sectorGen = 0
        this.sectorWork = {stored: 0, pulled: 0, adopted: 0, kept: 0, dirtied: 0, removed: 0, clears: 0, evicted: 0}
        this.sectorClears = []
        // TASK-1560 (Grid.unitSectors): the unit sectors (unitSectorPlan): the ground and the units pass a square of the board's
        // device grid at the camera's scale, LRU under UNIT_SECTOR_BYTES (UNIT_SECTOR_PHONE_BYTES on a phone); the values each
        // cell's units pass drew from (unitCellVals, unitSectorCheck); the frame's live squares (unitFrame, the cache's path).
        this.unitSectors = typeof SectorCache === 'function' ? this.newUnitSectorCache() : null
        // TASK-1561: the unit sectors of the other debug state, kept aside ({cache, key}; Grid.unitSectorDebugSets).
        this.unitSectorAlt = undefined
        this.unitSectorKey = undefined
        this.unitSectorSerial = -1
        this.unitCellVals = new Map()
        this.unitCellScratch = []
        this.unitStandIn = undefined
        this.unitSectorQueued = false
        this.unitSectorWanted = undefined
        this.unitFrame = undefined
        this.unitSectorWork = {built: 0, drawn: 0, live: 0, frames: 0, clears: 0, dirtied: 0, checks: 0, evicted: 0, cut: 0,
            restarts: 0, overlays: 0, overlaysDrawn: 0, bursts: 0, stepCalls: 0, stepCells: 0, swaps: 0}
        // TASK-1562 (Grid.zoomLevels): zoom frames drawn from the unit sectors of the levels kept (drawZoomSectors); the
        // frames after a zoom (levelSettle) until every square on the canvas is drawn at the camera's level, then the frames
        // at rest drawn from the sectors (sectorRest) until the camera pans; the coverage of the last frame drawn
        // (levelCoverage: squares exact / stretched / bare) and the counts (levelWork).
        this.levelSettle = undefined
        this.sectorRest = undefined
        this.levelCoverage = undefined
        // TASK-1574 (ZOOMFADE 1/5, diagnostic counters: render/visualsPerf.js work.swapPops / fades / settleMs /
        // zoomExactCoverage): the main canvas frame's camera (frameView: its level t.a and the sectors' grid at ox, oy) and,
        // for a frame drawn on the levels (a zoom gesture's or a settle's / rest's), its squares and those not drawn exact
        // (squareStates: zoom frames all of them; level frames the stretched and held ones; fading: squares fading in, none
        // yet). No allocation beyond the object: the lists are the frame's own.
        this.frameView = undefined
        this.squareStates = undefined
        // What a unit sector's ground (a lit tile, a stand-in) was drawn from stays the board's while this is the same: one
        // more on a board change the lit sectors were cleared for (clearSectors); a change they were dirtied for dirties the
        // unit sectors there too (staleSectorsIn).
        this.unitGroundEpoch = 0
        this.zoomQuietUntil = 0
        this.levelWork = {zoomFrames: 0, settleFrames: 0, settled: 0, stretchedDrawn: 0, heldFrames: 0, heldSquares: 0,
            budgetStops: 0, quietStops: 0, skippedRasters: 0, restFrames: 0, ends: {}}
        // TASK-1561: a unit sector build the task's draw call budget cut (buildUnitSector), and the count of the cells the
        // unit sector checks found changed (a cut build begins again when it moved).
        this.unitSectorBuilding = undefined
        this.unitCellChanges = 0
        // TASK-1564: builds not started for a full Worker queue (Grid.sectorWorkerBusy).
        this.litWorkerStops = 0
        this.unitWorkerStops = 0
        // TASK-1565 (Grid.sectorAhead): the sectors built ahead of the camera (visualsPerf work.sectorAhead): lit tiles and unit
        // sectors built (tiles, units), queued in a frame's ring (queued: the last frame's list; ring: its squares), builds
        // given up because their square left the ring (cancelled), and the camera's motion (sectorMotion).
        // TASK-1565 rework: tileStepMs (main-thread ms the steps took), and why the builds between two frames stopped: stopSteps
        // (AHEAD_TILE_STEPS), stopCalls (aheadCallsLeft), stopMp (aheadMpLeft), stopTime (AHEAD_WORKER_FRAME_MS), stopQueue (the
        // Worker's queue full); TASK-1565 pass 6: whole (lit tiles recorded whole, Grid.litTileWhole); pass 7: levelSteps, levelStepMs
        // (a settle's lit tile steps with the Worker drawing, bounded by their time).
        this.aheadWork = {tiles: 0, tilesMoving: 0, units: 0, unitsMoving: 0, cancelled: 0, queued: 0, ring: 0, tileSteps: 0, tileStepCalls: 0,
            composed: 0, tileStepMs: 0, stopSteps: 0, stopCalls: 0, stopMp: 0, stopTime: 0, stopQueue: 0, litTasks: 0, litOtherView: 0,
            litZooming: 0, litDefers: 0, litBehind: 0, whole: 0, levelSteps: 0, levelStepMs: 0,
            // TASK-1568: the lit tasks that deferred (litTaskDefers, moving or not) by the condition that held (each true one
            // counted: a deferral can count under more than one).
            litDeferBy: {surfaceQueued: 0, overlayQueued: 0, overlaySnapshot: 0},
            // TASK-1569: the lit tasks that ran though a condition held (litTaskDefers: sharing the pause, Grid.litShareTurns),
            // moving (the frame's time budget bounds them) or at rest after one deferral; and the queued surface cache tasks
            // not waited for as they will draw nothing (a split task in a zoom's quiet, surfaceTaskIdle).
            litShared: {moving: 0, rest: 0}, litIdleSurface: 0,
            // TASK-1570: lit tile tasks queued when a Worker picture came back (Grid.litDrainRefill), and the ring's reach (tiles
            // past LIT_AHEAD_RING on the motion's sides, litAheadRange: x + y) the last lit frame asked for (not a delta).
            litDrainTasks: 0, reach: 0,
            // TASK-1570: lit tile pictures back from the Worker and dropped (litTileArrived), by the first reason that held.
            litDropBy: {other: 0, view: 0, built: 0, edges: 0, outline: 0, rebuilds: 0, mapScale: 0, gen: 0}}
        // TASK-1565: the draw calls a lit tile's steps record (litTileSteps' recorders count them in calls.n while calls is set).
        this.litStepHolder = {calls: null}
        this.aheadUnitRatio = 1
        this.sectorMotion = undefined
        this.unitSectorClears = []
        this.unitSectorRefusals = {}
        // TASK-1546: the lit tile built a step a task (Grid.buildLitTiles: litTileStep), tiles started / given up.
        this.litTileJob = undefined
        this.litTileJobs = 0
        this.litTileJobsDropped = 0
        this.litTileStepsQueued = false
        // TASK-1565 pass 6: the canvas a whole lit tile (Grid.litTileWhole) the worker cannot make is drawn on.
        this.litWholeCanvas = null
        // TASK-1565 pass 7: the lit tiles' shared memo (litStepMemo), the board state it holds for, its hits and resets.
        this.litMemo = new Map()
        this.litMemoSig = null
        this.litMemoEpoch = 0
        this.litMemoHits = 0
        this.litMemoResets = 0
        this.litTileStepTasks = 0
        // TASK-1552: the camera's motion over the lit view (Grid.followLitMotion) and the ahead tasks since the last frame.
        this.litMotion = undefined
        this.litAheadTasks = 0
        // TASK-1546: the lit view made by tasks (Grid.litViewSteps: stepLitView), views started / given up.
        this.litViewJob = undefined
        this.litViewJobs = 0
        this.litViewJobsDropped = 0
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
        // TASK-1519: lit views brought up to a board change with the tiles it reaches made stale (refreshLitTiles), those tiles,
        // and the changes that dropped the view instead, by reason.
        this.litTileRefreshes = 0
        this.litTilesStaled = 0
        this.litRefreshRefusals = {}
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
        // TASK-1570: surface split steps that waited for the camera at rest (Grid.splitCutAtRest)
        this.splitCutWaits = 0
        this.cellLayerComposites = 0
        this.cellSpriteRenders = 0
        this.cellSpriteDraws = 0
        this.cellLayerRefreshes = 0
        this.cellLayerVariantRenders = 0
        // TASK-1361: sprites let go of (their canvases go to Grid.canvasPool, TASK-1550).
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
        // TASK-1569: the kind of the queued surface task ('patch', 'split', 'build': surfaceTaskIdle) and whether a lit task gave up
        // its turn since the last one ran (litTaskDefers)
        this.surfaceQueuedKind = undefined
        this.litDeferred = false
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
        // TASK-1519: surface caches taken over from another board (adoptSurfaceCache) and the last one's cells matched/differing.
        this.surfaceCacheAdoptions = 0
        // TASK-1519: patches started for a lit view waiting for the cache as its stand-in (prepareSurfaceCache's patchOnly).
        this.surfaceStandInPatches = 0
        // TASK-1519: stand-in caches whose cell layer was brought up for the lit view (litStandIn).
        this.standInFollows = 0
        // TASK-1571: phone zoom gesture frames that drew the surface cache magnified (planLitView, Grid.litStandIns false).
        this.gestureStandIns = 0
        // TASK-1571: frames (or level frames) that drew the ground fill for squares without an exact picture (drawGroundFill).
        this.groundFills = 0
        // TASK-1571: drawLitView's squares without a tile (litFrameBuilds): found, built in the frame, filled.
        this.litFrameWork = {missing: 0, built: 0, filled: 0, pending: 0, drawn: 0}
        // TASK-1553: frames whose stand-in squares got no sky (frameCover), and the sky drawn under them after all (coverSkyUnder).
        this.standInCovers = 0
        this.coverSkyUnders = 0
        this.surfaceCacheAdopted = null
        this.surfaceCacheAdoptedFrom = undefined
        // TASK-1519: the board whose surface cache build (or split or patch) under way this board finishes between its frames
        // and then takes over (stepSurfaceDonor), its tasks queued, steps run, ms spent and caches so taken over.
        this.surfaceCacheDonor = undefined
        this.surfaceDonorQueued = false
        this.surfaceDonorSteps = 0
        this.surfaceDonorMs = 0
        this.surfaceDonorAdoptions = 0
        this.surfaceDonorRestarts = 0
        // TASK-1519: the turn playback's start hold this board's frames are under (turnPlaybackView.holdFrame), if any.
        this.playbackHold = undefined
        // TASK-1520: the far-zoom cache hold this board's frames are under (holdCacheFrame), if any; the drawSerial of the last
        // drawn frame a hold ended at (the next hold waits for a drawn frame); holds made, frames held, their work and ends.
        this.cacheHold = undefined
        this.cacheHoldSerial = -1
        this.cacheHeldFrame = false
        this.cacheHolds = 0
        this.cacheHoldFrames = 0
        this.cacheHoldWorkMs = 0
        this.cacheHoldEnds = {}
        // TASK-1543: surface cache tasks queued with the camera moving or the lit view unbuilt (Grid.movingCacheBuilds), and
        // start rest-first waits ended by Grid.START_REST_FIRST_MS.
        this.surfaceMovingQueues = 0
        this.startRestFirstExpired = 0
        // TASK-1544: the stand-in preview (a coarse whole-board raster, standInPreviewStep) and its build under way; previews
        // built from the board's stages, kept from a cache a rebuild drew over, lit after their build; stand-in draws by source.
        this.standInPreview = undefined
        this.standInBuild = undefined
        this.standInQueued = false
        this.standInDrawnAt = -Infinity
        // TASK-1571: when a frame at or below the cache's scale last drew the lit view for want of a cache (drawMapSurface).
        this.cacheWaitedAt = -Infinity
        this.standInBuilds = 0
        this.standInKeeps = 0
        this.standInRelights = 0
        this.standInDraws = {}
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
        Grid.logicTextChanged()
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
        // TASK-1563: a sector recording (SectorRecorder) is told the cell each tile is drawn for.
        const mark = ctx.sectorCell
        let hexagons = [], tiles = [], cells = mark ? [] : null
        const range = this.drawRange(ctx, true), drawn = this.drawRange(ctx)
        // A patch's clipped redraw draws the tiles of the cells reaching its clip (atmosphericLighting.clipWindow).
        const clip = atmosphericLighting.clipWindow
        // TASK-1565 pass 7: while a lit tile is built (atmosphericLighting.pathMemo, kept across the tiles of a board state:
        // Grid.litStepMemo), the walk of the whole rows is made once for the ranges, not once a step and a tile.
        const memo = !clip && atmosphericLighting.pathMemo, memoKey = memo && 'hex|' + [range.i0, range.i1, range.j0, range.j1,
            drawn.i0, drawn.i1].join()
        const kept = memo && memo.get(memoKey), pairs = memo ? [] : cells
        if (kept) {
            hexagons = kept.hexagons
            tiles = kept.tiles
            if (cells)
                cells = kept.cells
            ++this.litMemoHits
        }
        else for (let i = range.i0; i < range.i1; ++i) {
            for (let j = range.j0; j < range.j1; ++j) {
                if (this.arr[i][j].building.isMapEdge)
                    continue
                const observed = this.observedHexagon(this.arr[i][j])
                if (isFogOfWar && !this.fogOfWar[i][j] && !observed)
                    continue
                const hexagon = observed || this.arr[i][j].hexagon
                hexagons.push(hexagon)
                if (i >= drawn.i0 && i < drawn.i1 && (!clip || atmosphericLighting.inClipWindow([{pos: hexagon.calcPos()}]).length)) {
                    tiles.push(hexagon)
                    pairs?.push(i, j)
                }
            }
        }
        if (cells && pairs !== cells)
            cells = pairs
        if (memo && !kept)
            memo.set(memoKey, {hexagons, tiles, cells: pairs})
        // Grout under the drawn cells only: hidden cells keep their fog tile.
        if (otherSettings.atmosphericVisuals && (!part || (part.grout ?? part.k === 0)))
            atmosphericLighting.drawGrout(ctx, hexagons)
        if (part && !part.n)
            return
        const from = part ? Math.floor(part.k * tiles.length / part.n) : 0
        const to = part ? Math.floor((part.k + 1) * tiles.length / part.n) : tiles.length
        for (let k = from; k < to; ++k) {
            mark?.(cells[2 * k], cells[2 * k + 1])
            tiles[k].draw(ctx, atmosphericTransform)
        }
        mark?.(-1)
    }
    // Cell texts are set while their cells are drawn (production previews), within the same
    // drawn range, so the range also holds every text to draw and clear.
    // (TASK-1551: range given: a lit layer strip's cells, the same for drawOther before.)
    drawCellText(ctx, range = this.drawRange(ctx)) {
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
    // TASK-1560: the info texts the units pass set on the cells of range cleared, none drawn (as drawCellText with debug).
    clearInfoTexts(range) {
        if (!this.infoTextCells.size)
            return
        const h = this.arr[0].length
        for (const index of [...this.infoTextCells]) {
            const i = Math.floor(index / h), j = index % h
            if (i < range.i0 || i >= range.i1 || j < range.j0 || j >= range.j1)
                continue
            this.arr[i][j].infoText.text = ''
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
    // TASK-1561: bars given (an array), the building bars are put in it, not drawn, and the culled portal not refreshed: a
    // unit sector build draws a range's columns in steps and the bars after the last (Grid.unitSectorSteps).
    drawOther(ctx, layer, range = this.drawRange(ctx), bars = null) {
        const buildings = layer !== 'units', units = layer !== 'buildings'
        let tmpBuildings = []
        const mark = ctx.sectorCell
        for (let i = range.i0; i < range.i1; ++i) {
            for (let j = range.j0; j < range.j1; ++j) {
                mark?.(i, j)
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
                    if (units && cell.building.hasBar && !this.lod && !this.healBarHidden(cell.building)) tmpBuildings.push(cell.building)
                    if (units && !this.lod) this.drawProductionSilhouette(ctx, cell.building)
                }
                const unit = units && this.getStillUnit(cell)
                // A level-of-detail frame (TASK-1375): the unit's cached body, no bars.
                if (unit && this.lod) this.drawEntityBody(ctx, unit)
                else if (unit) unit.draw(ctx)
            }
        }
        mark?.(-1)
        if (bars) {
            bars.push(...tmpBuildings)
            return
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
    // The cell's unit as drawn in place: none while it is tweening (moveTween draws it), attacking (attackFx draws it) or
    // healing (healFx draws it).
    // (attackFx.hidden is read here, not through a method call: this runs for every unit of every pass, TASK-1425)
    getStillUnit(cell) {
        if (typeof onlineObservation !== 'undefined' && onlineObservation.hidesUnit(cell)) return undefined
        return cell.unit.notEmpty() && !moveTween.isActive(cell.unit) &&
            !(typeof attackFx !== 'undefined' && attackFx.hidden.size > 0 && attackFx.hidden.has(cell.unit)) &&
            !(typeof healFx !== 'undefined' && healFx.hidden.size > 0 && healFx.hidden.has(cell.unit)) ? cell.unit : undefined
    }
    // A building being repaired: healFx draws its bars (TASK-1446).
    healBarHidden(building) {
        return typeof healFx !== 'undefined' && healFx.hidden.size > 0 && healFx.hidden.has(building)
    }
    // TASK-1518: part {k, n}: only the k-th of n runs of the rows (the calls the whole draw makes there, in its order).
    drawEntityBodies(ctx, part) {
        const range = this.drawRange(ctx)
        const i0 = part ? range.i0 + Math.floor(part.k * (range.i1 - range.i0) / part.n) : range.i0
        const i1 = part ? range.i0 + Math.floor((part.k + 1) * (range.i1 - range.i0) / part.n) : range.i1
        for (let i = i0; i < i1; ++i) {
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
    // TASK-1562: bars given, the buildings' bars are left in it for the caller (a unit sector build's chunks: unitSectorSteps).
    drawEntityOverlays(ctx, cells, bars = null) {
        const buildingBars = bars || []
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
            if (!observed && building.hasBar && !lod && !this.healBarHidden(building))
                buildingBars.push(building)
        })
        if (bars)
            return
        for (let i = 0; i < buildingBars.length; ++i)
            buildingBars[i].drawBars(ctx)
        this.refreshCulledPortal(range)
    }
    // Calls visit(cell, i, j) for the cells of the drawn range in board order: those listed in
    // cells (board indices, ascending) when given, else all of them. Returns the range.
    forEachDrawnCell(ctx, cells, visit) {
        const range = this.drawRange(ctx)
        // TASK-1563: a sector recording (SectorRecorder) is told the cell being drawn.
        const mark = ctx.sectorCell
        if (mark) {
            const inner = visit
            visit = (cell, i, j) => {
                mark(i, j)
                inner(cell, i, j)
            }
        }
        if (cells) {
            const h = this.arr[0].length
            for (let k = 0; k < cells.length; ++k) {
                const i = Math.floor(cells[k] / h), j = cells[k] - i * h
                if (i >= range.i0 && i < range.i1 && j >= range.j0 && j < range.j1)
                    visit(this.arr[i][j], i, j)
            }
            mark?.(-1)
            return range
        }
        for (let i = range.i0; i < range.i1; ++i)
            for (let j = range.j0; j < range.j1; ++j)
                visit(this.arr[i][j], i, j)
        mark?.(-1)
        return range
    }
    // TASK-1563: a sector snapshot (render/sectorDraw.js) of kind 'lit' or 'unit' for sector (u, v) at level, range the
    // cells whose drawing reaches it (the sector's and the pad's): their board snapshot rows (sectorCellRow) in board order;
    // and its sink (SectorRecorder's: the sprites by key, the cells' indices).
    sectorSnapshot(kind, level, u, v, range) {
        const snapshot = {v: 1, kind, level, u, v, size: LIT_TILE, range: {i0: range.i0, i1: range.i1, j0: range.j0, j1: range.j1},
            cells: [], targets: [], opaque: 0, reads: 0}
        const h = this.arr[0].length, cellIndex = new Map()
        for (let i = range.i0; i < range.i1; ++i)
            for (let j = range.j0; j < range.j1; ++j) {
                cellIndex.set(i * h + j, snapshot.cells.length)
                snapshot.cells.push(this.sectorCellRow(i, j))
            }
        // freeze: a consumer keeps the snapshot past its build (Grid.onSectorSnapshot, a later Worker), so a sprite redrawn
        // in place (sectorVersion) goes into the map as a copy of the version the recording drew (SectorRecorder.key).
        // TASK-1564: worker: the snapshot's pictures are made in the Worker (SectorWorker; its recorders draw nothing here,
        // sectorSubmit), unless a recorder finds it cannot (mainOnly: a pixel read, an opaque value).
        return {snapshot, sink: {sprites: new Map(), cellIndex, h, cellRow: (i, j) => this.sectorCellRow(i, j),
            freeze: !!Grid.onSectorSnapshot, worker: !this.sectorSync && Grid.sectorWorkerOn(), sync: !!this.sectorSync,
            mainOnly: false, recorders: []}}
    }
    // TASK-1563: a cell's row in a sector snapshot: [i, j, flags (SECTOR_CELL_*), the unit's class or null, the building's
    // class or null, the hexagon's owner colour (null: unknown)].
    sectorCellRow(i, j) {
        const cell = this.arr[i]?.[j]
        if (!cell)
            return [i, j, SECTOR_CELL_EDGE, null, null, null]
        const building = cell.building, unit = cell.unit
        const flags = (isFogOfWar && !this.fogOfWar[i][j] ? SECTOR_CELL_FOG : 0) | (building.isMapEdge ? SECTOR_CELL_EDGE : 0) |
            (this.observedBuilding(cell) ? SECTOR_CELL_OBSERVED : 0) | (cell.infoText?.text ? SECTOR_CELL_TEXT : 0)
        return [i, j, flags, unit.notEmpty() ? unit.constructor.name : null,
            building.notEmpty() && !building.isMapEdge ? building.constructor.name : null, cell.hexagon.playerColor ?? null]
    }
    // Whether drawStillUnits or drawEntityOverlays can draw anything on the cell: a unit, a
    // production, a demon portal or a building that shows its bars (TASK-1513: showsBar; Building.hasBar was a method,
    // so every building counted). Every other cell is skipped by them.
    isOverlayCell(cell) {
        const building = cell.building
        return cell.unit.notEmpty() || !!building.showsBar || !!building.isPreparingManufacture ||
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
        this.releaseCellSprites(layer)
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
            this.releaseCellSprites(layer)
            Object.assign(layer, {cells: undefined, cellBox: undefined, sprites: new Map(), stale: null, byIndex: undefined, place,
                states: undefined})
            const job = {canvas, layer, place, cells: null, box: null, states: this.cellLayerStates(), next: 0, finish, order: null}
            // TASK-1518: the rest of the start (the cells and their mask, their sprite keys, their order) in steps, the split
            // job's first (cellSplitStep, Grid.cellSplitPreps); the keys of the board the states were taken of (a step that
            // finds the board's states changed ends the job, as before).
            const prep = this.cellSplitPrep(job, centre, this.cellReachPass)
            if (Grid.cellSplitPreps)
                job.prep = prep
            else
                while (!prep.next().done);
            return job
        })
    }
    // startCellSplit's preparation of job (a generator, each yield ends a step: the cells and their mask, CELL_SPLIT_KEYS
    // cells' sprite keys, the order), with the cells' building reach found at the start (reach, withCellReach).
    *cellSplitPrep(job, centre, reach) {
        const W = job.canvas.width, H = job.canvas.height
        const mask = job.layer.mask ||= document.createElement('canvas')
        mask.width = W
        mask.height = H
        const {cells, box, path} = this.cellLayerCells(W, H, job.place)
        fillCellMask(mask.getContext('2d'), path)
        yield RASTER_STEP
        for (let k = 0; k < cells.length; k += CELL_SPLIT_KEYS) {
            const outer = this.cellReachPass
            this.cellReachPass = reach
            try {
                for (const cell of cells.slice(k, k + CELL_SPLIT_KEYS))
                    cell.key = this.cellLayerKey(cell.i, cell.j)
            } finally {
                this.cellReachPass = outer
            }
            yield
        }
        const far = ({box}) => Math.hypot(box.x + box.w / 2 - centre.x, box.y + box.h / 2 - centre.y)
        Object.assign(job, {cells, box, order: cells.map(cell => [far(cell), cell]).sort((a, b) => a[0] - b[0]).map(([, cell]) => cell)})
    }
    // One step of a split job (startCellSplit). Returns whether the split is finished. TASK-1473: a step with a budget (ms,
    // the between-frames tasks: SURFACE_STEP_MS) makes sprites while the time spent and the last sprite's time fit in it (at
    // least one), and at most job.cap: the canvas draws are rasterized later in the step (its restore) or after it, so the
    // cap follows the whole steps' time (shrunk to the share of the budget a step over it took, grown after one within it);
    // without a budget, CELL_SPLIT_CELLS. The sprites' pixels are disjoint and added ('lighter'), so the layer is the same
    // however the cells are split into steps.
    cellSplitStep(job, budget = Infinity) {
        // TASK-1518: the job's preparation first (startCellSplit), a step of it a step (all of it without a budget).
        if (job.prep) {
            const done = runSteps(job.prep, budget)
            if (done)
                job.prep = undefined
            if (!done || budget < Infinity)
                return false
        }
        const {layer, canvas, order} = job
        ++this.cellSplitSteps
        const start = performance.now(), first = job.next
        const g = layer.getContext('2d')
        g.save()
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.globalCompositeOperation = 'lighter'
        const cap = budget < Infinity ? job.cap ||= CELL_SPLIT_CELLS : CELL_SPLIT_CELLS
        for (let end = Math.min(first + cap, order.length), piece = 0; job.next < end; ++job.next) {
            if (job.next > first && performance.now() - start + piece >= budget)
                break
            const begin = performance.now(), cell = order[job.next]
            g.drawImage(this.cellSprite(layer, cell, canvas, cell.key), 0, 0, cell.box.w, cell.box.h, cell.box.x, cell.box.y, cell.box.w, cell.box.h)
            ++this.cellSpriteDraws
            piece = performance.now() - begin
        }
        g.restore()
        if (budget < Infinity) {
            const spent = performance.now() - start, made = job.next - first
            job.cap = spent > budget ? Math.max(1, Math.floor(made * budget / spent)) : Math.min(CELL_SPLIT_CELLS, 2 * made)
        }
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
        // TASK-1570 (Grid.splitCutAtRest): the split's last step (cellSplitStep's whole-canvas cut, ~18 MP on the old capture's
        // 0.084 pan, and the end of the job: cacheSectorKey changes, so every cache unit sector on the canvas is drawn live
        // until built again, 2-3 heavy frames) waits while the camera moves over the frames drawn from the cache
        // (frameSurface true), as it waits for a zoom's quiet (TASK-1562), at most SPLIT_CUT_WAIT_MS: the cache draws the
        // same pixels split or not.
        if (Grid.splitCutAtRest && this.frameSurface === true && gameEvent.screen.surfaceMoving && !job.prep &&
                job.next + (job.cap || CELL_SPLIT_CELLS) >= job.order.length) {
            job.cutWait ??= performance.now()
            if (performance.now() - job.cutWait < SPLIT_CUT_WAIT_MS) {
                ++this.splitCutWaits
                return
            }
        }
        if (this.cellSplitStep(job, SURFACE_STEP_MS))
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
        const {key, a, d, e, f, reach} = this.cellMaskKey(W, H, place)
        let mask = cellMaskCache.get(key)
        if (mask)
            ++Grid.cellMaskWork.hits
        else
            mask = this.buildCellMask(W, H, a, d, e, f, reach)
        rememberCellMask(key, mask)
        return {cells: mask.cells.map(c => ({...c})), box: mask.box, path: mask.path}
    }
    // cellLayerCells's cache key and the transform and reach its mask is built at, for a W x H canvas at place's transform.
    cellMaskKey(W, H, place) {
        const g = (this.cellMaskCanvas ||= document.createElement('canvas')).getContext('2d')
        g.save()
        g.setTransform(1, 0, 0, 1, 0, 0)
        place(g)
        const t = g.getTransform()
        g.restore()
        const {a, d, e, f} = t, w = this.arr.length, h = this.arr[0].length
        const reach = CELL_LAYER_EDGE_REACH * basis.r + (mapDepth.depth || 0) + (mapDepth.shadowOffset || 0) + 2 * (mapDepth.shadowBlur || 0)
        return {key: [W, H, a, d, e, f, basis.offset.x, basis.offset.y, basis.r, w, h, reach].join(), a, d, e, f, reach}
    }
    // TASK-1455: the surface cache's cell mask of a board the menu can start (map: a GameMap; its size and shape, which
    // cells are map edge, are all the mask and the cache's geometry take of it) built in steps while the menu is idle
    // (menuPrebuild), as the game's first surface cache split would build it (cellMaskKey, cellMaskSteps), kept in
    // cellMaskCache under its key, so that split finds it. A generator: each yield ends a step; nothing when kept already.
    static *prebuildCellMaskSteps(map) {
        const w = map.mapSize.x, h = map.mapSize.y, shape = map.mapShape
        const board = Object.create(Grid.prototype)
        board.arr = Array.from({length: w}, (_, x) => Array.from({length: h}, (_, y) => ({
            hexagon: {calcPos: () => Hexagon.prototype.calcPos.call({coord: {x, y}})},
            building: {isMapEdge: shape?.type == 'hexagonal' && getHexagonalLayer(x, y, shape.center) > shape.radius}})))
        const {bounds} = mapDepth.boundsOf(board)
        const geometry = board.getSurfaceCacheGeometry(bounds)
        if (geometry.cacheWidth <= 0 || geometry.cacheHeight <= 0)
            return
        const {width: W, height: H} = Grid.surfaceRasterSize(geometry)
        const {key, a, d, e, f, reach} = board.cellMaskKey(W, H, Grid.surfacePlace(geometry.scale, bounds.left, bounds.top))
        if (cellMaskCache.has(key))
            return
        yield
        const mask = yield* board.cellMaskSteps(W, H, a, d, e, f, reach)
        if (!cellMaskCache.has(key))
            rememberCellMask(key, mask)
    }
    // cellLayerCells's mask built (x' = a x + e, y' = d y + f). Each row of a cell's box splits by the bisectors with the
    // cells round it: the run surely the cell's (every bisector at least CELL_MASK_MARGIN pixels away on the cell's side),
    // filled; the pixels surely another board cell's (or, for a side cell, surely beyond its reach), skipped; and the rest
    // (near a bisector, and a side cell's pixels off the board) tested against the neighbours' centres as before, so the
    // bits are the same as testing every pixel of the box. Grid.cellMaskWork counts the builds, tested pixels and distances.
    buildCellMask(W, H, a, d, e, f, reach) {
        const steps = this.cellMaskSteps(W, H, a, d, e, f, reach)
        for (;;) {
            const {done, value} = steps.next()
            if (done)
                return value
        }
    }
    // buildCellMask's work as a generator returning the mask (TASK-1455: a yield after each row of a cell's box and each cell
    // of the last passes, the menu's prebuild runs it a few rows an idle step; buildCellMask runs it through).
    *cellMaskSteps(W, H, a, d, e, f, reach) {
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
                    yield
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
            yield
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
            yield
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
        // TASK-1559: with sectors and no region, the cells changed since the view's state (surfaceStateMatches' list, as
        // refreshLitTiles finds them) and the rectangles they draw on (surfaceCacheChangeRects), found before the view takes
        // the board's state: only the sectors and tiles those reach are released (staleSectors), not every one.
        const found = !region && view.sectorLevel ? this.cellLayerChangeRects(view) : null
        this.withLitState(view, () => this.captureSurfaceState())
        Object.assign(view, this.litEdges(view))
        if (found) {
            const reached = new Set(this.staleSectors(view, found))
            for (const [key, tile] of [...view.tiles]) {
                if (!reached.has(key))
                    continue
                view.tiles.delete(key)
                this.releaseLitTile(tile)
                view.patchedTiles = true
            }
            ++this.sectorWork.dirtied
            return
        }
        if (!region) {
            for (const tile of view.tiles.values())
                this.releaseLitTile(tile)
            view.tiles.clear()
            // TASK-1559: and every sector (drawn for the old states) when the change's cells are not known.
            if (view.sectorLevel)
                this.clearSectors('cell layer')
            return
        }
        this.releaseLitTilesIn(view, view.rest, region)
    }
    // TASK-1559: the change since view's captured state as surfaceCacheChangeRects' {cells, light} (world boxes), null when the
    // board cannot be compared past a cell list (or a lamp or portal changed: their light reaches far), an observed board.
    cellLayerChangeRects(view) {
        if (this.isObserving())
            return null
        const changes = []
        const matches = this.withLitState(view, () => {
            const overlayCells = this.surfaceOverlayCells
            this.surfaceOverlayCells = []
            try {
                return this.surfaceStateMatches(undefined, changes, true)
            } finally {
                this.surfaceOverlayCells = overlayCells
            }
        })
        if (!matches || !changes.length)
            return null
        return this.withLitState(view, () => this.surfaceCacheChangeRects(changes)) || null
    }
    // The tiles of view whose squares meet the rest snapshot's pixel rectangle r grown by the edge runs' reach (a run joins
    // blocks up to 3 apart), released (built again one a task, LIT_TILE_PATCHED_BUDGET).
    releaseLitTilesIn(view, rest, r) {
        const grow = 4 * LIT_EDGE_BLOCK, ox = Math.round(rest.e - view.e), oy = Math.round(rest.f - view.f)
        // TASK-1559: with sectors, those the region (the snapshot's pixels, in world units) reaches at every level (staleSectors).
        const reached = view.sectorLevel ? new Set(this.staleSectorsIn(view,
            {x: (r.x - rest.e) / view.a, y: (r.y - rest.f) / view.d, w: r.w / view.a, h: r.h / view.d})) : null
        for (const [key, tile] of view.tiles) {
            const [u, v] = key.split(',').map(Number), x = u * LIT_TILE + ox, y = v * LIT_TILE + oy
            if (reached ? reached.has(key) : x < r.x + r.w + grow && x + LIT_TILE > r.x - grow && y < r.y + r.h + grow && y + LIT_TILE > r.y - grow) {
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
    // frame, none in the frame that started it. A job whose cache, layer or board state is no longer its own, a layer being
    // split again (no cells: TASK-1504, prepareSurfaceCellLayer drops it there too), or a patch or build under way, is
    // dropped; a step that fails drops it too, and the change is then drawn at once (refreshCellLayer).
    surfaceLayerStep() {
        const job = this.surfaceLayerJob
        if (job.ran === null || job.ran === this.drawSerial) {
            job.ran ??= this.drawSerial
            return
        }
        job.ran = this.drawSerial
        if (job.cache !== this.surfaceCache || job.layer !== this.surfaceCellLayer || !job.layer?.cells || this.surfacePatchJob ||
                this.surfaceCacheBuild || !this.cellLayerStatesAre(job.states))
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
        g.save()
        fillCellMask(g, cell.path)
        g.globalCompositeOperation = 'source-in'
        g.drawImage(source, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h)
        g.restore()
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
            g.drawImage(base, 0, 0, box.w, box.h, 0, 0, box.w, box.h)
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
    // TASK-1361: a cleared canvas for a sprite, one a layer let go of (pruneCellSprites) when there is one, so the
    // variants rendered move after move make no new canvas once the layers hold their cap. TASK-1550: from Grid.canvasPool
    // (at least box.w x box.h, never resized; the sprite is its box.w x box.h corner, drawn with that source rectangle), where
    // the sprites of a layer split again or let go of go too (releaseCellSprites).
    cellSpriteCanvas(box) {
        return Grid.canvasPool.take(box.w, box.h)
    }
    // TASK-1550: the layer's sprites given to Grid.canvasPool (none while a layer job is under way on it: its sprites made
    // or read are its own), its sprite map emptied.
    releaseCellSprites(layer) {
        const sprites = layer?.sprites
        if (!sprites?.size)
            return
        if (this.surfaceLayerJob?.layer !== layer && !(this.litView?.layerJob && layer === this.litCellLayer))
            for (const sprite of sprites.values())
                Grid.canvasPool.give(sprite)
        layer.sprites = new Map()
    }
    // TASK-1361: the layer's sprites cut to CELL_LAYER_VARIANTS a cell, those its cells took last kept (each cell's variant
    // now first, then the one before it, so an undo still draws a kept sprite); the others' canvases go to the pool
    // (Grid.canvasPool, TASK-1550). Not while a layer job is under way on the layer (its sprites made
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
        const kept = new Map()
        for (const k of [...sprites.keys()].reverse()) {
            const index = k.slice(0, k.indexOf('|')), n = (kept.get(index) || 0) + 1
            kept.set(index, n)
            if (n > CELL_LAYER_VARIANTS) {
                Grid.canvasPool.give(sprites.get(k))
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
            g.drawImage(layer.sprites.get(index + '|' + key), 0, 0, box.w, box.h, box.x, box.y, box.w, box.h)
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
            g.drawImage(layer.sprites.get(index + '|' + key), 0, 0, box.w, box.h, box.x, box.y, box.w, box.h)
        }
        g.restore()
        ++this.cellLayerComposites
    }
    // The surface cache's cell layer (splitCellLayer) after a build, or after a patch of rect (copy: the patch's region
    // copied into the cache, resplitCellLayer), or none (no cell layer). The frames draw the cache scaled: its layer is added
    // to it at the cache's own resolution, on the canvas they draw (surfaceCacheShown), where each pixel is the sum of the
    // two, to the bit (adding the layer after the scaled cache, each scaled on its own, rounds a level or so apart at a
    // fifth of a frame's pixels: TASK-1313 design.md, test-cell-layer's scaledAddAlternative).
    // TASK-1504: a surface layer job (startSurfaceLayerJob) under way is dropped before the layer is reset or split again
    // (a same-size rebuild keeps the cache canvas and the layer object, so the job's own checks in surfaceLayerStep pass and
    // its next step would read the reset layer's cells); the split's reset (stale: null) leaves nothing of it behind.
    prepareSurfaceCellLayer(canvas, geometry, left, top, rect, copy) {
        if (!canvas.cellLayered) {
            if (this.surfaceLayerJob)
                this.dropSurfaceLayerJob()
            copy?.()
            this.releaseCellSprites(this.surfaceCellLayer)
            this.surfaceCellLayer = this.surfaceCacheShown = this.surfaceSplitJob = undefined
            return
        }
        const place = Grid.surfacePlace(geometry.scale, left, top)
        let layer = this.surfaceCellLayer
        if (rect && layer?.cells && layer.width === canvas.width && layer.height === canvas.height && layer.raster === canvas)
            rect = this.resplitCellLayer(canvas, layer, rect, copy)
        else {
            if (this.surfaceLayerJob)
                this.dropSurfaceLayerJob()
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
        // TASK-1565 pass 7: the lit tiles' shared memo (litStepMemo) holds for the board as it was.
        ++this.litMemoEpoch
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
    // TASK-1519: this board takes over from's surface cache (a turn playback's loaded board from the computed one, and back
    // at the end, options/turnPlayback.js): its raster, cell layer, shown canvas and patch buffer move over (from has none
    // left), and its captured state is matched by cell value instead of object identity: a captured building or empty unit
    // whose cell here holds one of the same class drawn with the same image (the captured one) is replaced by this board's
    // object, so captureSurfaceState's identity checks hold on this board; any other cell keeps from's object and differs,
    // and the cache is patched there (patchSurfaceCache: only the changed cells), or rebuilt whole when a patch is refused,
    // as for any board change. Nothing moves (false) without atmospheric visuals, for a board of another size, an observed
    // board, from's cache being built, patched, split or its layer job under way, or this board having a cache of its own.
    // TASK-1519 (Grid.donorBuilds): from's build, split or patch under way (its board unchanged meanwhile: the computed board
    // aside during a playback) is finished by this board's tasks instead and its cache taken over then (stepSurfaceDonor).
    adoptSurfaceCache(from) {
        this.surfaceCacheDonor = undefined
        if (this.canTakeSurfaceDonor(from)) {
            this.surfaceCacheDonor = from.surfaceCache || from.surfaceCacheBuild ? from : from.surfaceCacheDonor
            return false
        }
        if (!Grid.surfaceAdoption || !from || from === this || !otherSettings.atmosphericVisuals || !from.surfaceCache ||
                !from.surfaceCacheAtmospheric || from.surfaceCacheBuild || from.surfacePatchJob || from.surfaceSplitJob ||
                from.surfaceLayerJob || this.surfaceCache || this.surfaceCacheBuild || this.surfacePatchJob ||
                from.isObserving() || this.isObserving() || !from.surfaceCacheState ||
                from.arr.length !== this.arr.length || from.arr[0].length !== this.arr[0].length ||
                from.surfaceCacheState.length !== this.arr.length * this.arr[0].length)
            return false
        const h = this.arr[0].length
        const buildings = from.surfaceCacheBuildings.slice(), buildingImages = from.surfaceCacheBuildingImages
        const inert = from.surfaceCacheInert, inertUnits = from.surfaceCacheInertUnits.slice()
        const inertBuildings = from.surfaceCacheInertBuildings.slice(), natureNames = from.surfaceCacheNatureNames
        const units = from.surfaceCacheUnits.slice(), unitImages = from.surfaceCacheUnitImages
        // Drawn the same: the same class with the captured image (its body image now).
        const imageOf = entity => cachedImages[this.getEntityBodyImageName(entity)]
        let matched = 0, differing = 0
        for (let i = 0; i < this.arr.length; ++i) {
            for (let j = 0, index = i * h; j < h; ++j, ++index) {
                const cell = this.arr[i][j]
                let same = true
                const b = buildings[index]
                if (b !== undefined) {
                    if (b.constructor === cell.building.constructor && buildingImages[index] === imageOf(cell.building))
                        buildings[index] = cell.building
                    else
                        same = false
                }
                const u = units[index]
                if (u !== undefined) {
                    if (u.constructor === cell.unit.constructor && unitImages[index] === imageOf(cell.unit))
                        units[index] = cell.unit
                    else
                        same = false
                }
                if (inert[index] !== 0) {
                    const ib = inertBuildings[index], iu = inertUnits[index]
                    if (ib.constructor === cell.building.constructor && (inert[index] < 3 || natureNames[index] === cell.building.name))
                        inertBuildings[index] = cell.building
                    else
                        same = false
                    if (iu.constructor === cell.unit.constructor && iu.constructor === Empty)
                        inertUnits[index] = cell.unit
                }
                same ? ++matched : ++differing
            }
        }
        for (const name of SURFACE_STATE_FIELDS)
            this[name] = from[name]
        this.surfaceCacheBuildings = buildings
        this.surfaceCacheUnits = units
        this.surfaceCacheInertBuildings = inertBuildings
        this.surfaceCacheInertUnits = inertUnits
        for (const name of SURFACE_ADOPTED_FIELDS) {
            this[name] = from[name]
            from[name] = undefined
        }
        for (const name of SURFACE_STATE_FIELDS)
            from[name] = undefined
        from.surfaceCacheDirty = true
        ++from.surfaceCacheRevision
        ++this.surfaceCacheRevision
        // The next check between frames compares the whole board and patches the cells that differ.
        this.surfaceCacheDirty = true
        this.surfaceCacheChecked = 0
        this.surfaceCacheAdopted = {matched, differing}
        // The board bound to the sky and light map before (atmosphericBackground.syncKey keeps the cache for this board).
        this.surfaceCacheAdoptedFrom = from
        ++this.surfaceCacheAdoptions
        return true
    }
    // TASK-1519: whether this board finishes from's surface cache work under way (or that of from's own donor, a board
    // loaded before it) instead of building its own: atmospheric visuals, boards of one size, none observed, this board
    // without a cache or work of its own, from with a build, split or patch under way (not its cell layer's job).
    canTakeSurfaceDonor(from) {
        if (!Grid.surfaceAdoption || !Grid.donorBuilds || !from || from === this || !otherSettings.atmosphericVisuals ||
                this.surfaceCache || this.surfaceCacheBuild || this.surfacePatchJob || this.isObserving() || from.isObserving() ||
                from.arr.length !== this.arr.length || from.arr[0].length !== this.arr[0].length)
            return false
        if (!from.surfaceCache && !from.surfaceCacheBuild)
            return !!from.surfaceCacheDonor && from.surfaceCacheDonor !== this && this.canTakeSurfaceDonor(from.surfaceCacheDonor)
        return !from.surfaceLayerJob && !!(from.surfaceCacheBuild || from.surfaceSplitJob || from.surfacePatchJob)
    }
    // TASK-1519: the donor's work (canTakeSurfaceDonor) run between this board's frames: its build's steps, then its split's,
    // in a task of up to SURFACE_DONOR_TASK_MS while this board's frames draw the board directly (each such frame is far
    // longer, and every one of them waits for a cache to stand in) and queued again at once, else a SURFACE_STEP_MS step a
    // frame; with the global grid set to the donor (its stages read it as when it was shown). The donor's board does not
    // change meanwhile, so its build is not started over. Finished, its cache is taken over (adoptSurfaceCache: patched
    // or followed to this board where it differs). Returns whether the donor still stands for this board's cache (nothing
    // else is prepared then).
    stepSurfaceDonor() {
        const donor = this.surfaceCacheDonor
        if (!donor)
            return false
        if (this !== grid || donor === grid || !otherSettings.atmosphericVisuals || this.surfaceCache || this.surfaceCacheBuild ||
                this.surfacePatchJob || donor.surfaceLayerJob || donor.arr.length !== this.arr.length ||
                donor.arr[0].length !== this.arr[0].length) {
            this.surfaceCacheDonor = undefined
            return false
        }
        if (!donor.surfaceCacheBuild && !donor.surfaceSplitJob && !donor.surfacePatchJob) {
            this.surfaceCacheDonor = undefined
            if (donor.surfaceCache && this.adoptSurfaceCache(donor))
                ++this.surfaceDonorAdoptions
            return !!this.surfaceCache
        }
        if (this.surfaceDonorQueued)
            return true
        this.surfaceDonorQueued = true
        // A playback start's held frames (turnPlaybackView.holdFrame: nothing drawn) leave the main thread to the donor:
        // its tasks of PLAYBACK_HOLD_TASK_MS back to back (a message, not a nested timeout's 4 ms clamp), frames and input
        // between them.
        const holding = !!this.playbackHold
        queueDonorTask(holding, () => {
            this.surfaceDonorQueued = false
            if (this !== grid || this.surfaceCacheDonor !== donor)
                return
            const holding = !!this.playbackHold
            const start = performance.now(), budget = holding ? PLAYBACK_HOLD_TASK_MS : this.frameSurface === false ? Grid.donorTaskMs : SURFACE_STEP_MS
            const stage = donor.surfaceCacheBuild ? donor.surfaceCacheBuild.stage : donor.surfaceSplitJob ? 'split' : 'patch'
            const shown = grid
            grid = donor
            try {
                // A build whose board changed (the AI turn's) is started over at once, not after its stage under way (steps
                // drawing the changed board into a build that is dropped when they end: surfaceCacheBuildStep).
                const build = donor.surfaceCacheBuild
                if (build?.steps && build.steps !== build.maskSteps && !build.staleChecked) {
                    build.staleChecked = true
                    if (!donor.surfaceCacheBuildHolds(build)) {
                        donor.surfaceCacheBuild = undefined
                        ++this.surfaceDonorRestarts
                        donor.surfaceCacheBuildStep(SURFACE_STEP_MS)
                    }
                }
                do {
                    if (donor.surfacePatchJob)
                        donor.surfacePatchStep()
                    else if (donor.surfaceCacheBuild)
                        donor.surfaceCacheBuildStep(SURFACE_STEP_MS)
                    else if (donor.surfaceSplitJob)
                        donor.surfaceSplitStep()
                    else
                        break
                    ++this.surfaceDonorSteps
                    if (Grid.donorLogSteps) {
                        const b = donor.surfaceCacheBuild
                        ;(this.surfaceDonorStepLog ||= []).push([b ? b.stage + (b.steps ? 's' : '') + (b.lamps ? 'L' : '') + (b.masked ? 'M' : '') : donor.surfaceSplitJob ? 'split' + (donor.surfaceSplitJob.prep ? 'P' : '') : 'done', Math.round(performance.now() - start)])
                    }
                } while (performance.now() - start < budget - SURFACE_STEP_MS)
            } finally {
                grid = shown
            }
            this.surfaceDonorMs += performance.now() - start
            ;(this.surfaceDonorLog ||= []).push([Math.round(start), stage, Math.round(performance.now() - start)])
            if (holding)
                this.playbackHold.donorMs += performance.now() - start
            // Held or direct frames: the next task at once (the frames come between tasks).
            if (budget > SURFACE_STEP_MS || holding)
                this.stepSurfaceDonor()
        })
        return true
    }
    getSurfaceCacheGeometry(bounds = mapDepth.bounds) {
        const cacheWidth = bounds.right - bounds.left
        const cacheHeight = bounds.bottom - bounds.top
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
    // The surface cache raster's pixel size at geometry (getSurfaceCacheGeometry).
    static surfaceRasterSize(geometry) {
        return {width: Math.max(1, Math.ceil(geometry.cacheWidth * geometry.scale)),
            height: Math.max(1, Math.ceil(geometry.cacheHeight * geometry.scale))}
    }
    // The surface cache raster's transform (world pixel (left, top) at its pixel (0, 0), at scale) set on a context.
    static surfacePlace(scale, left, top) {
        return g => {
            g.scale(scale, scale)
            g.translate(-left, -top)
        }
    }
    // A build of the cache raster into canvas (reused at the same size) at the board's geometry now.
    startSurfaceCacheBuild(canvas) {
        mapDepth.ensureGeometry(this)
        const geometry = this.getSurfaceCacheGeometry()
        if (geometry.cacheWidth <= 0 || geometry.cacheHeight <= 0)
            return null

        const {width: rasterWidth, height: rasterHeight} = Grid.surfaceRasterSize(geometry)
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
    // TASK-1518: whether the lit view's rest snapshot is being made (its bands, its cell mask, its split) after a start hold
    // (holdStartFrame, startRestFirst: until its first rest snapshot is finished): the surface cache's build and split wait
    // for it (prepareSurfaceCache) as the lit tasks wait for a queued surface cache step (litTaskDefers), so the camera's
    // lighting is complete first (the cache's stages, now in many smaller steps, came first).
    litRestUnderWay() {
        if (!this.startRestFirst)
            return false
        // Only while the frames draw that view (a camera moved off it, to the cache's path, waits for nothing).
        // TASK-1571: a camera on the cache's path drawing the lit view for want of the cache (drawMapSurface) waits for nothing.
        if (this.frameSurface !== 'lit' || this.canUseSurfaceCache()) {
            this.startRestFirst = false
            return false
        }
        // TASK-1543: for at most Grid.START_REST_FIRST_MS from the first frame drawn after the start hold (then the cache's
        // build runs beside the snapshot: a camera moving or zooming out soon after a start has the cache to draw from).
        this.startRestFirstAt ??= performance.now()
        if (performance.now() - this.startRestFirstAt >= Grid.START_REST_FIRST_MS) {
            this.startRestFirst = false
            ++this.startRestFirstExpired
            return false
        }
        const view = this.litView, rest = view?.rest
        if (!!rest && view.rest === rest && (rest.done < LIT_REST_BANDS || !!view.splitJob))
            return true
        if (rest && rest.done === LIT_REST_BANDS)
            this.startRestFirst = false
        return false
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
        // TASK-1519: another board's cache work this board takes over when finished.
        if (this.stepSurfaceDonor())
            return
        // TASK-1519: a cache that the lit view waits for as its stand-in (view.unbuilt: its frames draw the board directly)
        // and differs from the board in a few cells (an adopted one, adoptSurfaceCache, after a turn playback's step) is
        // brought up to it also while the camera moves: its cell layer or a patch (only those: patchOnly, never rebuilt then).
        const patchOnly = Grid.surfaceAdoption && !!this.litView?.unbuilt && !!this.surfaceCache && !this.surfaceCacheBuild &&
            !this.surfaceSplitJob && !this.surfacePatchJob
        if (!otherSettings.atmosphericVisuals || !screen || this.surfaceCacheQueued || this.litRestUnderWay())
            return
        if (patchOnly && (screen.surfaceMoving || this.litView?.unbuilt)) {
            if (performance.now() - this.surfaceCacheChecked < SURFACE_PATCH_CHECK_MS)
                return
            this.surfaceCacheQueued = true
            this.surfaceQueuedKind = 'patch'
            setTimeout(gridTask(() => {
                this.surfaceCacheQueued = false
                if (this === grid && otherSettings.atmosphericVisuals && this.surfaceCache && !this.surfaceCacheBuild &&
                        !this.surfacePatchJob && !gameEvent.screen.surfaceZooming) {
                    this.surfaceCacheChecked = performance.now()
                    // Exactly (as litStandIn compares): with the cell layer an owner, suburb or fog change alone is brought up
                    // by the layer (followCellLayer, in this task), any other by a patch.
                    if (this.wholeSurfaceMatches(true))
                        return
                    if (this.wholeSurfaceMatches())
                        this.followCellLayer('surface')
                    else if (this.patchSurfaceCache())
                        ++this.surfaceStandInPatches
                }
            }))
            return
        }
        // TASK-1543 (Grid.movingCacheBuilds): the cache is in world space (the camera does not change what it draws), so with the
        // camera moving or the lit view waiting for it as its stand-in (litView.unbuilt) a build under way (or none and no
        // cache: the first one) and its split go on between frames; only the check of a finished cache against the board
        // (and its patch or rebuild) waits for the camera at rest. While the frames draw the board directly (frameSurface
        // false: each far longer than a step, every one waiting for the cache) a task runs steps for up to Grid.donorTaskMs
        // (each step SURFACE_STEP_MS, input and frames between the tasks), else one step.
        const moving = screen.surfaceMoving || !!this.litView?.unbuilt
        if (moving && (!Grid.movingCacheBuilds || this.surfaceCache && !this.surfaceCacheBuild && !this.surfaceSplitJob))
            return
        if (moving)
            ++this.surfaceMovingQueues
        const free = () => this === grid && otherSettings.atmosphericVisuals && (Grid.movingCacheBuilds || !gameEvent.screen.surfaceMoving)
        // TASK-1544: also while the frames draw its stand-in (drawStandIn, drawStandInRect within STANDIN_WAIT_MS: coarse until
        // the cache is built), moving or not.
        // TASK-1571: so too while frames at the cache's scale draw the lit view for want of it (drawMapSurface, cacheWaitedAt).
        const waiting = performance.now() - this.standInDrawnAt < STANDIN_WAIT_MS || performance.now() - this.cacheWaitedAt < STANDIN_WAIT_MS
        const budget = moving && this.frameSurface === false || waiting ? Grid.donorTaskMs : SURFACE_STEP_MS
        // TASK-1372: the cache's split, a step a task (surfaceSplitStep).
        if (this.surfaceSplitJob) {
            this.surfaceCacheQueued = true
            this.surfaceQueuedKind = 'split'
            setTimeout(gridTask(() => {
                this.surfaceCacheQueued = false
                // TASK-1562: none after a zoom (Grid.zoomQuiet: its finish composes the whole cache, ~14 MP).
                if (free() && (!Grid.zoomQuiet() || this.cacheUrgent()))
                    this.surfaceSplitStep()
            }))
            return
        }
        if (!this.surfaceCacheBuild && this.surfaceCache && !this.surfaceCacheDirty &&
                performance.now() - this.surfaceCacheChecked < SURFACE_CACHE_CHECK_MS)
            return
        this.surfaceCacheQueued = true
        this.surfaceQueuedKind = 'build'
        setTimeout(gridTask(() => {
            this.surfaceCacheQueued = false
            // A board replaced meanwhile (another game or tutorial started) builds nothing: its units read the new grid.
            if (!free())
                return
            // TASK-1562: after a zoom (Grid.zoomQuiet) one step of ZOOM_QUIET_STEP_MS a frame (an owned tile is pieces:
            // ownedTileSteps); the next frame's call queues it again.
            // TASK-1565: not while there is no cache (cacheUrgent).
            const quiet = Grid.zoomQuiet() && !this.cacheUrgent()
            if (quiet && !Grid.oncePerFrame('surface')) {
                ++this.levelWork.quietStops
                return
            }
            // TASK-1544: with no cache yet the stand-in preview is built first (a few steps of a coarse raster).
            // TASK-1566 (Grid.urgentGestureCalls): a build without a cache (cacheUrgent) during a zoom gesture runs its steps while
            // their real draw calls (Grid.frameCallsNow) stay within the room the frame's own leave under a heavy frame
            // (AHEAD_FRAME_TOTAL less Grid.lastFrameCalls), at least one step (such gesture frames were 600-1600 calls: several
            // stages between two frames).
            const start = performance.now(), calls0 = Grid.frameCallsNow()
            const gesture = Grid.urgentGestureCalls && !quiet && (gameEvent.screen.zoomGesture || gameEvent.screen.surfaceZooming)
            const room = gesture ? AHEAD_FRAME_TOTAL - Grid.lastFrameCalls : Infinity
            do {
                if (!this.standInPreviewStep(quiet ? ZOOM_QUIET_STEP_MS : SURFACE_STEP_MS))
                    this.surfaceCacheBuildStep(quiet ? ZOOM_QUIET_STEP_MS : SURFACE_STEP_MS)
            } while (!quiet && (this.surfaceCacheBuild || this.standInWanted()) && performance.now() - start < budget - SURFACE_STEP_MS &&
                Grid.frameCallsNow() - calls0 < room)
            this.queueStandInTask()
        }))
    }
    // TASK-1565 (Grid.sectorAhead): while the board has no surface cache (its first build, or a rebuild: the frames at the
    // cache's scales draw the stand-in and sectors on it) the build does not wait for a zoom's quiet or the camera at rest
    // (Grid.zoomQuiet, Grid.cameraBusy): its steps run as before TASK-1562, so the sectors there get their exact ground.
    cacheUrgent() {
        return !!Grid.sectorAhead && this === grid && !this.surfaceCache
    }
    // A step of the surface cache's build: a stage, or (TASK-1473, with a budget in ms: the between-frames tasks) a step
    // of the work a stage or the finish would otherwise do at once, while the time spent and the last piece's fit in the
    // budget: the lamps' overlays ahead of the bake (atmosphericLighting.lampOverlaySteps) and the cache's cell mask
    // ahead of the finish (surfaceMaskSteps). They fill caches the stage and the finish then find (the same builders),
    // so the cache is the same. Without a budget (a direct call) they run within the stage or the finish as before.
    surfaceCacheBuildStep(budget = Infinity) {
        let build = this.surfaceCacheBuild
        if (build?.steps) {
            if (!runSteps(build.steps, budget))
                return
            build.steps = undefined
            return
        }
        if (!build) {
            this.surfaceCacheChecked = performance.now()
            this.surfaceCacheDirty = false
            if (this.surfaceCache && (this.wholeSurfaceMatches() || this.patchSurfaceCache()))
                return
            build = this.startSurfaceCacheBuild(this.surfaceCache)
            if (!build)
                return
            // The stale raster is no longer drawn; its canvas is drawn over. TASK-1544: kept, coarser, as the stand-in.
            this.keepStandIn()
            this.surfaceCache = undefined
            this.surfaceCacheBuild = build
            this.withLitState(build, () => this.captureSurfaceState())
        }
        else if (!this.surfaceCacheBuildHolds(build)) {
            this.surfaceCacheBuild = undefined
            this.surfaceCacheBuildStep(budget)
            return
        }
        // TASK-1519: between frames the cell mask (geometry only, kept by its key: surfaceMaskSteps) is made first, so a build
        // started over (a board change: the AI turn's) or finished by a turn playback's board (stepSurfaceDonor) finds it.
        if (budget < Infinity && !build.premasked && Grid.maskFirst) {
            build.premasked = true
            if ((build.steps = this.surfaceMaskSteps(build))) {
                build.maskSteps = build.steps
                return
            }
        }
        if (budget < Infinity && build.stage === SURFACE_CACHE_STAGES.length - 1 && !build.lamps) {
            build.lamps = true
            if (build.atmospheric) {
                build.steps = atmosphericLighting.lampOverlaySteps(this)
                return
            }
        }
        if (build.stage === SURFACE_CACHE_STAGES.length) {
            // TASK-1518: after a last stage drawn in steps, the cell mask's steps as after a whole one (below).
            if (budget < Infinity && !build.masked) {
                build.masked = true
                if ((build.steps = this.surfaceMaskSteps(build)))
                    return
            }
            // TASK-1562: the finish (several MP: the patch buffer, the cell layer) and the whole stages (the bake) wait between
            // frames for the camera at rest and a zoom's quiet over (Grid.cameraBusy).
            if (budget < Infinity && Grid.cameraBusy() && !this.cacheUrgent())
                return
            this.finishSurfaceCacheStep(build)
            return
        }
        if (budget < Infinity && !SURFACE_CACHE_STAGE_STEPS[build.stage] && Grid.cameraBusy() && !this.cacheUrgent())
            return
        ++this.surfaceCacheStages
        // TASK-1518: between frames a stage with steps (SURFACE_CACHE_STAGE_STEPS) runs them.
        const stepped = budget < Infinity && SURFACE_CACHE_STAGE_STEPS[build.stage]
        if (stepped) {
            build.stage++
            build.steps = stepped(this, build)
            if (runSteps(build.steps, budget))
                build.steps = undefined
            return
        }
        SURFACE_CACHE_STAGES[build.stage++](this, build)
        this.flushSurfaceBuild(build)
        if (build.stage < SURFACE_CACHE_STAGES.length)
            return
        build.masked = true
        if (budget < Infinity && (build.steps = this.surfaceMaskSteps(build)))
            return
        this.finishSurfaceCacheStep(build)
    }
    // Drawing the build's canvas has its recorded drawing rasterized now, in this task.
    // A 1x1 canvas made once (assigning its size again would reallocate and clear it every stage).
    flushSurfaceBuild(build) {
        let flush = this.surfaceCacheFlush
        if (!flush) {
            flush = this.surfaceCacheFlush = document.createElement('canvas')
            flush.width = flush.height = 1
        }
        flush.getContext('2d').drawImage(build.canvas, 0, 0, 1, 1, 0, 0, 1, 1)
    }
    finishSurfaceCacheStep(build) {
        this.surfaceCacheBuild = undefined
        this.finishSurfaceCacheBuild(build)
        SURFACE_STATE_FIELDS.forEach((name, k) => { this[name] = build.state[k] })
    }
    // TASK-1473: the steps (a generator) building the cell mask the finished build's split takes (prepareSurfaceCellLayer ->
    // startCellSplit -> cellLayerCells: the same key, builder and cache), or none when it has no cell layer or the mask
    // is kept already.
    surfaceMaskSteps(build) {
        if (!build.canvas.cellLayered)
            return undefined
        const W = build.canvas.width, H = build.canvas.height
        const {key, a, d, e, f, reach} = this.cellMaskKey(W, H, Grid.surfacePlace(build.geometry.scale, build.left, build.top))
        if (cellMaskCache.has(key))
            return undefined
        const board = this
        return (function* () {
            const mask = yield* board.cellMaskSteps(W, H, a, d, e, f, reach)
            if (!cellMaskCache.has(key))
                rememberCellMask(key, mask)
        })()
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

        if (!this.drawSurfaceCacheRect(ctx, canvas.offset.x, canvas.offset.y, canvas.offset.x + width, canvas.offset.y + height))
            return true
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
    // The surface cache's raster (with its cell layer, the two added: prepareSurfaceCellLayer) over the world rectangle
    // left..right x top..bottom cut to the cache's bounds, each pixel sampled through the same world-to-cache mapping
    // whatever the rectangle. Returns whether any of it was drawn.
    drawSurfaceCacheRect(ctx, left, top, right, bottom) {
        const b = this.surfaceCacheBounds
        const visibleLeft = Math.max(b.left, left), visibleTop = Math.max(b.top, top)
        const visibleRight = Math.min(b.left + b.width, right), visibleBottom = Math.min(b.top + b.height, bottom)
        if (visibleLeft >= visibleRight || visibleTop >= visibleBottom)
            return false
        const sourceScaleX = this.surfaceCache.width / b.width
        const sourceScaleY = this.surfaceCache.height / b.height
        ctx.drawImage(this.surfaceCache.cellLayered && !this.surfaceSplitJob && this.surfaceCacheShown || this.surfaceCache,
            (visibleLeft - b.left) * sourceScaleX, (visibleTop - b.top) * sourceScaleY,
            (visibleRight - visibleLeft) * sourceScaleX, (visibleBottom - visibleTop) * sourceScaleY,
            visibleLeft, visibleTop, visibleRight - visibleLeft, visibleBottom - visibleTop)
        return true
    }
    // TASK-1544: STAND-INS. A frame that found no surface cache to draw at or below its scale (none yet, a rebuild under
    // way, or one not matching the board while the camera moves), or a lit view's tiles not built with no cache to stand
    // in for them, drew the whole board directly: on the user's 6-player capture 237-454 ms a frame (5100-7800 calls),
    // the far zoom at 0-3 fps for 25 s. Instead it draws a stand-in: the board's last complete surface raster at the
    // camera's transform, coarse (a little blurred) and possibly a little behind the board, until the cache or the lit
    // view is ready and the exact frame replaces it. Sources, in order (standInSource):
    // - 'cache': the surface cache there is, as it is (stale: drawSurfaceCacheRect, the whole board);
    // - 'preview': the stand-in preview, a whole-board raster at Grid.STANDIN_SCALE of the cache's scale: built from the
    //   cache's own stages (standInPreviewSteps: the underlay and sides, the cells' tiles, fog and rim, the buildings'
    //   bodies; no shadows) between frames ahead of a board's first cache build, a piece a task in the cache's tasks and
    //   its own (queueStandInTask), and lit with the light map there is (atmosphericLighting.bakeStandIn, again later if
    //   there was none), or kept from the cache a rebuild draws over (keepStandIn, one drawImage).
    // Both hold the whole board, so no part of it shows the sky. Over a stand-in the frame draws what it draws over the
    // cache (draw: units, bars, overlays, productions, texts, the selection; not the buildings or the light again). The
    // zoom raster's frames draw the preview where their raster and no cache cover the board (drawZoomUnderlay). Only
    // with the atmospheric visuals, for the board in play (grid). A board's first frames (no preview yet) draw as before.
    // A stand-in never shows a board other than the one in play: the preview holds the board state it was drawn from
    // (as the cache does) and stands in only while that matches the board in view exactly (else it is built again); a
    // cache that does not match stands in only while the camera moves (at rest it is patched or rebuilt, and the frame
    // draws the board as before).
    // TASK-1571 (Grid.standInsInGesture): only in an active zoom gesture (Grid.zoomGestureNow); outside one a frame without a
    // cache at its scale draws the board directly and a lit frame its exact tiles or the ground fill (drawLitView).
    standInSource() {
        if (!Grid.standIns || this !== grid || !otherSettings.atmosphericVisuals || Grid.standInsInGesture && !Grid.zoomGestureNow())
            return null
        if (this.surfaceCache && this.surfaceCacheBounds)
            return typeof gameEvent !== 'undefined' && gameEvent.screen?.surfaceMoving ? 'cache' : null
        return this.standInPreviewFits() ? 'preview' : null
    }
    standInPreviewFits(ctx = typeof mainCtx !== 'undefined' ? mainCtx : undefined) {
        const p = this.standInPreview
        return Grid.standIns && this === grid && !!p && this.standInFits(p) && this.standInMatches(p, ctx)
    }
    // Whether p's board state is the board's (in ctx's view; undefined: the whole board), exactly.
    standInMatches(p, ctx) {
        return !!p.state && this.withLitState(p, () => this.surfaceStateMatches(ctx, undefined, true))
    }
    // Whether p (a preview or its build) is at the board's geometry now.
    standInFits(p) {
        mapDepth.ensureGeometry(this)
        const b = mapDepth.bounds
        return !!b && p.left === b.left && p.top === b.top && p.width === b.right - b.left && p.height === b.bottom - b.top
    }
    // Draws the stand-in over the camera's view on ctx (the camera's world transform); its source or false (none).
    drawStandIn(ctx) {
        const source = this.standInSource()
        if (!source)
            return false
        const left = canvas.offset.x, top = canvas.offset.y
        if (source === 'cache')
            this.drawSurfaceCacheRect(ctx, left, top, left + width, top + height)
        else
            this.drawStandInRect(ctx, left, top, left + width, top + height, source)
        if (source === 'cache')
            this.standInDraws.cache = (this.standInDraws.cache || 0) + 1
        this.standInDrawn = source
        this.standInDrawnAt = performance.now()
        return source
    }
    // The preview over the world rectangle left..right x top..bottom cut to its bounds (as drawSurfaceCacheRect).
    drawStandInRect(ctx, left, top, right, bottom, why) {
        const p = this.standInPreview
        const visibleLeft = Math.max(p.left, left), visibleTop = Math.max(p.top, top)
        const visibleRight = Math.min(p.left + p.width, right), visibleBottom = Math.min(p.top + p.height, bottom)
        this.standInDraws[why] = (this.standInDraws[why] || 0) + 1
        this.standInDrawnAt = performance.now()
        if (visibleLeft >= visibleRight || visibleTop >= visibleBottom)
            return false
        const k = p.scale
        ctx.drawImage(p.canvas, (visibleLeft - p.left) * k, (visibleTop - p.top) * k, (visibleRight - visibleLeft) * k,
            (visibleBottom - visibleTop) * k, visibleLeft, visibleTop, visibleRight - visibleLeft, visibleBottom - visibleTop)
        return true
    }
    // Whether the preview is to be built or lit (no cache: the board's first build, or a rebuild without a kept one).
    // Only ahead of the board's first cache (a rebuild's frames have the one kept from the cache it replaces, while it
    // matches: keepStandIn).
    standInWanted() {
        if (!Grid.standIns || this !== grid || !otherSettings.atmosphericVisuals || this.surfaceCache || this.surfaceCacheRevision > 0)
            return false
        const p = this.standInPreview
        return !p || !this.standInFits(p) || !this.standInMatches(p) || !p.lit && atmosphericLighting.standInLightReady(this)
    }
    // The preview's next step in a task of its own, again after it while wanted: its build does not wait for a drawn frame
    // (a held still frame calls no prepareSurfaceCache), frames and input between its tasks.
    queueStandInTask() {
        if (this.standInQueued || !this.standInWanted())
            return
        this.standInQueued = true
        setTimeout(gridTask(() => {
            this.standInQueued = false
            if (this === grid && !this.surfaceCache && this.standInPreviewStep(SURFACE_STEP_MS))
                this.queueStandInTask()
        }))
    }
    // A step of the preview's build (runStandInSteps within budget) or its light; whether there was one (standInWanted).
    standInPreviewStep(budget) {
        if (!this.standInWanted())
            return false
        const p = this.standInPreview
        if (p && this.standInFits(p) && this.standInMatches(p)) {
            const g = p.ctx
            g.setTransform(1, 0, 0, 1, 0, 0)
            Grid.surfacePlace(p.scale, p.left, p.top)(g)
            p.lit = atmosphericLighting.bakeStandIn(g, this)
            ++this.standInRelights
            return true
        }
        let build = this.standInBuild
        if (build && !(this.standInFits(build) && this.standInMatches(build)))
            build = this.standInBuild = undefined
        if (!build && !(build = this.standInBuild = this.startStandInPreview()))
            return false
        const start = performance.now()
        const done = runStandInSteps(this, build, budget)
        build.ms += performance.now() - start
        ++build.tasks
        if (done) {
            build.steps = undefined
            build.doneAt = performance.now()
            this.standInBuild = undefined
            this.standInPreview = build
            ++this.standInBuilds
        }
        return true
    }
    startStandInPreview() {
        mapDepth.ensureGeometry(this)
        const geometry = this.getSurfaceCacheGeometry(), b = mapDepth.bounds
        if (!b || geometry.cacheWidth <= 0 || geometry.cacheHeight <= 0)
            return null
        const scale = geometry.scale * Grid.STANDIN_SCALE
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.ceil(geometry.cacheWidth * scale))
        canvas.height = Math.max(1, Math.ceil(geometry.cacheHeight * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx)
            return null
        const p = {canvas, ctx, scale, left: b.left, top: b.top, width: geometry.cacheWidth, height: geometry.cacheHeight, lit: false,
            source: 'stages', steps: null, startAt: performance.now(), doneAt: null, ms: 0, tasks: 0, state: [], overlayCells: []}
        this.withLitState(p, () => this.captureSurfaceState())
        p.steps = standInPreviewSteps(this, p)
        return p
    }
    // The cache a rebuild is about to draw over, kept as the preview at Grid.STANDIN_SCALE of its scale (as it shows).
    keepStandIn() {
        const cache = this.surfaceCache, b = this.surfaceCacheBounds
        if (!Grid.standIns || this !== grid || !cache || !b || !otherSettings.atmosphericVisuals)
            return
        const scale = this.surfaceCacheScale * Grid.STANDIN_SCALE
        const w = Math.max(1, Math.ceil(b.width * scale)), h = Math.max(1, Math.ceil(b.height * scale))
        const old = this.standInPreview
        let canvas = old && old.canvas.width === w && old.canvas.height === h ? old.canvas : null
        if (!canvas) {
            canvas = document.createElement('canvas')
            canvas.width = w
            canvas.height = h
        }
        const g = canvas.getContext('2d')
        if (!g)
            return
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.globalCompositeOperation = 'source-over'
        g.globalAlpha = 1
        g.clearRect(0, 0, w, h)
        g.drawImage(cache.cellLayered && !this.surfaceSplitJob && this.surfaceCacheShown || cache, 0, 0, cache.width, cache.height,
            0, 0, b.width * scale, b.height * scale)
        this.standInBuild = undefined
        this.standInPreview = {canvas, ctx: g, scale, left: b.left, top: b.top, width: b.width, height: b.height,
            lit: !!this.surfaceCacheLit, source: 'cache', state: SURFACE_STATE_FIELDS.map(name => this[name]),
            overlayCells: this.surfaceOverlayCells.slice()}
        ++this.standInKeeps
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
    // TASK-1474: during a pan, or the hold after it or a zoom (Screen.surfaceMoving), on the surface-cache path with the
    // light baked into the cache, a frame whose overlay layer would exceed OVERLAY_LAYER_MAX_PIXELS (a desktop canvas zoomed
    // far out: the whole board's units, bars and texts, hundreds of overlay cells), with at least SCENE_LAYER_CELLS_PER_MP
    // overlay cells a megapixel of it, draws the slab shadow, the surface cache and the overlays (still units, entity
    // overlays, production texts) from one raster of them, the scene layer, at its own scale: its pixels copied whole at
    // the camera's shift rounded to whole pixels (under half a pixel off while moving), over the sky. Drawn directly they
    // are the shadow's and the cache's images and a call or more for each unit, bar and text, every frame (about 3000 calls
    // on the user's 55x55 6-player co-op board: renderMs 18-19 ms, 30 fps). The overlay layer (drawOverlayLayer) is not
    // used there: the sky (the canvas's size), the cache and a layer that large in one frame exceed the images a Chromium
    // canvas records before it rasterizes (the whole frame rasterized inside its drawing). The layer is built by a task
    // after a frame that could not use one (queueSceneLayer, as the overlay layer: the rectangle overlayLayerRect, its
    // drawing rasterized there) and used while the surface cache, its cell layer, the board's surface state and the scale
    // are unchanged, no cache job runs, the view is inside it and for at most a second; the next one is queued ahead once
    // it is 750 ms old or the view is within a tenth of its size of its edge. Frames at rest (held or drawn directly) and zoom
    // gestures (the zoom raster) never draw it. TASK-1514: it holds the cell texts (drawCellText: debug's coordinate texts, a
    // selection's logic texts; their state and revision in its key), and a level-of-detail frame draws a level-of-detail
    // layer (lod in the build and the layer; no bars, silhouettes or texts), so the farthest zoom with a selection, debug
    // or nothing selected moves as one image (about 3000 calls with debug, 450 unit bodies a level-of-detail frame). At the layer's
    // own camera its pixels are the direct frame's but for rounding (and a text glyph whose position lies on a sub-pixel
    // bin's edge, which the layer's own offset can put in the next bin).
    // Returns whether it drew the frame's shadow, surface and overlays.
    // TASK-1561: a pan the unit sectors can draw (not a level-of-detail frame, which has no cell texts, nor one with logic texts
    // or an observed board, which they refuse) is drawn from them (drawCacheSectors), not from the scene layer: the layer was
    // made again whole (every unit and cell text: debug's coordinate texts) each second and at its edge.
    sceneYieldsToSectors() {
        return Grid.sceneYieldsToSectors && Grid.unitSectors && !!this.unitSectors && !this.lod && !this.drawLogicText && !this.isObserving()
    }
    drawSceneLayer(ctx) {
        const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
        const t = ctx.getTransform()
        if (!otherSettings.atmosphericVisuals || !Grid.sceneLayers || !screen || !screen.surfaceMoving || screen.zoomGesture ||
                typeof createImageBitmap !== 'function' || typeof mainCanvas === 'undefined' ||
                ctx.canvas !== mainCanvas || t.b !== 0 || t.c !== 0 || t.a <= 0 || t.d <= 0 || !this.surfaceCacheSteady() ||
                this.stillUnitsHidden() || !this.canUseSurfaceCache() || this.sceneYieldsToSectors() ||
                // TASK-1562: after a zoom the levels draw it (levelMode), not a scene layer made for the new scale.
                this.levelMode(ctx)) {
            this.dropSceneLayer()
            return false
        }
        const rect = this.overlayLayerRect(ctx.canvas.width, ctx.canvas.height, t), pixels = rect.width * rect.height
        if (pixels <= OVERLAY_LAYER_MAX_PIXELS || pixels > SCENE_LAYER_MAX_PIXELS ||
                this.surfaceOverlayCells.length < SCENE_LAYER_CELLS_PER_MP * pixels / 1e6) {
            this.dropSceneLayer()
            return false
        }
        const layer = this.sceneLayer
        const margin = 4 * basis.r + assets.size, b = this.surfaceCacheBounds
        const viewLeft = Math.max(-t.e / t.a, b.left - margin), viewTop = Math.max(-t.f / t.d, b.top - margin)
        const viewRight = Math.min((ctx.canvas.width - t.e) / t.a, b.left + b.width + margin)
        const viewBottom = Math.min((ctx.canvas.height - t.f) / t.d, b.top + b.height + margin)
        // The board's surface state as the cache's (it also lists the frame's overlay cells, surfaceOverlayCells), and ctx's
        // state as the layer's drawing began in (the interface, drawn on the same canvas, leaves its state to the next frame:
        // a line dash strokes the cell texts' outlines).
        const state = canvasStateOf(ctx)
        if (!layer || t.a !== layer.a || t.d !== layer.d || layer.lod !== this.lod || !this.sceneLayerKeyHolds(layer) ||
                performance.now() - layer.time > 1000 ||
                !sameCanvasState(state, layer.state) ||
                viewLeft < layer.left || viewTop < layer.top || viewRight > layer.right || viewBottom > layer.bottom ||
                !this.surfaceStateMatches(ctx) || !this.surfaceCellLayerHolds()) {
            this.queueSceneLayer(ctx, t, state, this.lod)
            return false
        }
        const nearX = (viewRight - viewLeft) / 10, nearY = (viewBottom - viewTop) / 10
        if (performance.now() - layer.time > 750 || Math.max(viewLeft - nearX, b.left - margin) < layer.left ||
                Math.max(viewTop - nearY, b.top - margin) < layer.top ||
                Math.min(viewRight + nearX, b.left + b.width + margin) > layer.right ||
                Math.min(viewBottom + nearY, b.top + b.height + margin) > layer.bottom)
            this.queueSceneLayer(ctx, t, state, this.lod)
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.drawImage(layer.canvas, 0, 0, layer.width, layer.height,
            layer.x0 + Math.round(t.e - layer.e), layer.y0 + Math.round(t.f - layer.f), layer.width, layer.height)
        ctx.restore()
        ++this.sceneLayerFrames
        return true
    }
    // Whether a still unit is left out of the unit passes now (getStillUnit: a move tween, an attack or heal effect, another
    // player's replay step not played yet): a layer drawn before or after would hold it, or not, while the frame draws it.
    stillUnitsHidden() {
        return zoomRasterTweens() || typeof attackFx !== 'undefined' && attackFx.hidden.size > 0 ||
            typeof healFx !== 'undefined' && healFx.hidden.size > 0 ||
            typeof onlineObservation !== 'undefined' && onlineObservation.board === grid && onlineObservation.units.size > 0
    }
    // The surface cache drawn whole as a frame draws it, the light baked in: no build, split, patch or cell layer job.
    surfaceCacheSteady() {
        return !!this.surfaceCache && !!this.surfaceCacheLit && !this.surfaceCacheBuild && !this.surfaceSplitJob &&
            !this.surfacePatchJob && !this.surfaceLayerJob && !this.surfaceCacheDirty
    }
    // The cache's cell layer is up to the board's owner colours, suburbs and fog (followCellLayer has nothing to do).
    surfaceCellLayerHolds() {
        const layer = this.surfaceCellLayer
        return !this.cellLayerOn() || !layer?.cells || layer.raster !== this.surfaceCache || !this.surfaceCache?.cellLayered ||
            this.cellLayerStatesAre(layer.states)
    }
    // What the scene layer drew from: the cache, its shown raster and revision, the cell layer's, the shadow and bounds,
    // and the cell texts (drawCellText: debug's coordinate texts, the logic texts on and their revision).
    // (TASK-1561: SCENE_LAYER_KEY_DEBUG is the index of debug in it.)
    sceneLayerKey() {
        const b = this.surfaceCacheBounds
        return [this.surfaceCache, this.surfaceCacheShown, this.surfaceCacheRevision, this.cellLayerRevision, mapDepth.atmosphericShadow,
            b.left, b.top, b.width, b.height, debug, this.drawLogicText, Grid.logicTextRevision]
    }
    sceneLayerKeyHolds(layer) {
        const key = this.sceneLayerKey()
        return key.every((v, k) => v === layer.key[k])
    }
    dropSceneLayer() {
        if (this.sceneLayer) {
            this.sceneLayer.canvas.width = this.sceneLayer.canvas.height = 0
            this.sceneLayer = undefined
        }
    }
    // Queues the scene layer for transform t of ctx, drawn from ctx's state (canvasStateOf) now (one at a time), as a
    // level-of-detail frame draws it when lod (TASK-1514: the task runs after Grid.draw reset this.lod). It is not
    // built if the camera came to rest, a zoom gesture began, or the cache is not steady or no longer matches the board
    // when the task runs.
    queueSceneLayer(ctx, t, state, lod) {
        if (this.sceneLayerQueued)
            return
        this.sceneLayerQueued = true
        const cw = ctx.canvas.width, ch = ctx.canvas.height
        setTimeout(gridTask(() => {
            this.sceneLayerQueued = false
            const screen = gameEvent.screen
            if (!screen.surfaceMoving || screen.zoomGesture || this !== grid || !this.surfaceCacheSteady() || this.stillUnitsHidden())
                return
            const layer = this.drawSceneLayerRaster(cw, ch, t, state, lod)
            if (!layer)
                return
            // A one-pixel read rasterizes the drawing now, in this task between frames (as queueOverlayLayer).
            layer.canvas.getContext('2d').getImageData(0, 0, 1, 1)
            this.dropSceneLayer()
            this.sceneLayer = {...layer.bounds, canvas: layer.canvas, a: t.a, d: t.d, e: t.e, f: t.f, x0: layer.x0, y0: layer.y0,
                width: layer.width, height: layer.height, key: this.sceneLayerKey(), lod: !!lod, state, time: performance.now()}
            ++this.sceneLayerBuilds
        }))
    }
    // The slab shadow (drawSlabShadow's), the surface cache (drawSurfaceCacheRect, the light baked in) and the overlays
    // (drawOverlayLayerRaster's) as a frame on a cw x ch canvas at transform t draws them, within overlayLayerRect and on
    // the same pixel grid, on a canvas of the rectangle's size (no larger: with the sky, the images a frame draws stay
    // within what a Chromium canvas records before it rasterizes). None when the board no longer matches the cache.
    drawSceneLayerRaster(cw, ch, t, state, lod = false) {
        const {x0, y0, width, height} = this.overlayLayerRect(cw, ch, t)
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const lctx = canvas.getContext('2d')
        applyCanvasState(lctx, {...state, transform: {a: t.a, b: 0, c: 0, d: t.d, e: t.e - x0, f: t.f - y0}})
        // The cache's state compared on the layer's cells (surfaceStateMatches lists them as surfaceOverlayCells).
        if (!this.surfaceStateMatches(lctx) || !this.surfaceCellLayerHolds()) {
            canvas.width = canvas.height = 0
            return null
        }
        const bounds = {left: (x0 - t.e) / t.a, top: (y0 - t.f) / t.d, right: (x0 + width - t.e) / t.a, bottom: (y0 + height - t.f) / t.d}
        mapDepth.drawAtmosphericShadow(lctx, this)
        this.drawSurfaceCacheRect(lctx, bounds.left, bounds.top, bounds.right, bounds.bottom)
        // TASK-1514: a level-of-detail layer draws what a level-of-detail frame draws (unit bodies, buildings under
        // construction, no bars, silhouettes or texts); the cell texts as the frame draws them (debug's coordinate texts,
        // a selection's logic texts, production texts).
        const frameLod = this.lod
        this.lod = !!lod
        try {
            this.drawStillUnits(lctx, this.surfaceOverlayCells)
            this.drawEntityOverlays(lctx, this.surfaceOverlayCells)
            this.drawCellText(lctx)
        } finally {
            this.lod = frameLod
        }
        return {canvas, width, height, x0, y0, bounds}
    }
    // Queues the overlay layer for transform t of ctx (one at a time). It is not built if the
    // surface cache changed or the gesture ended before the task runs.
    queueOverlayLayer(ctx, t) {
        if (this.overlayLayerQueued)
            return
        this.overlayLayerQueued = true
        const cw = ctx.canvas.width, ch = ctx.canvas.height, revision = this.surfaceCacheRevision
        setTimeout(gridTask(() => {
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
        }))
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
    // TASK-1515: during a pan on the lit-tiles path (Screen.surfaceMoving, no zoom gesture: drawLitView drew lit tiles or the
    // rest snapshot), the units pass (drawOther's 'units': still units with their bars, production silhouettes and their
    // texts, building and portal bars, fogged portal previews) and the cell texts (drawCellText: debug's coordinate texts, a
    // selection's logic texts, production texts) come from one transparent raster of them, the lit layer, kept as its pieces
    // (the rectangles round the cells that draw, drawLitLayerRaster) and its pixels copied whole at the camera's shift rounded
    // to whole pixels (under half a pixel off while moving, as the lit tiles under it). Only the pieces in view are drawn: the
    // lit tiles (about 66 of 296 KB on a 2560x1398 canvas) and a layer of the canvas's size or more would exceed the images a
    // Chromium canvas records before it rasterizes (about 32 MB: the frame's whole drawing then rasterized inside it).
    // Drawn directly they are a call or more for each unit, bar and text every frame (the user's 55x55 6-player co-op board:
    // 323 calls at 0.36, about 2500 with debug at 0.156). The layer is built by a task after a frame that could not use one
    // (queueLitLayer: drawn at that frame's transform and context state over litLayerRect, the canvas and LIT_LAYER_MARGIN of
    // it on each side within the board, its pieces rasterized there), and used while its
    // scale, context state and key (litLayerKey: debug, logic texts and their revision, hex radius, bar settings, fog) are
    // the frame's, every cell it drew still draws the same (litLayerSignature: each drawn cell's unit and building, their
    // hp, pending heal, hit, moves, moves bar, image, owner colour and production; the fog), no unit is left out of the unit
    // passes (stillUnitsHidden) and no online observation runs and the view is inside it; once the view is within
    // LIT_STRIP_NEAR of its size of the layer's edge the layer is extended by strips (TASK-1551, queueLitStrips). A layer
    // whose cells are fewer than LIT_LAYER_MIN_CELLS (and no debug or logic texts) is not
    // drawn: the frames draw those few cells directly and queue nothing until the view leaves it. Frames at rest, zoom
    // gestures, the surface cache's paths and level-of-detail frames never draw it.
    // Returns whether it drew the units and the cell texts.
    drawLitLayer(ctx) {
        const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
        const t = ctx.getTransform()
        if (!Grid.litLayers || !otherSettings.atmosphericVisuals || !screen || !screen.surfaceMoving || screen.zoomGesture ||
                screen.surfaceZooming || typeof createImageBitmap !== 'function' || typeof mainCanvas === 'undefined' ||
                ctx.canvas !== mainCanvas || this !== grid ||
                t.b !== 0 || t.c !== 0 || t.a <= 0 || t.d <= 0 || this.lod || this.stillUnitsHidden() || this.isObserving()) {
            this.dropLitLayer()
            return false
        }
        const cw = ctx.canvas.width, ch = ctx.canvas.height
        const rect = this.litLayerRect(cw, ch, t)
        if (rect.width * rect.height > LIT_LAYER_MAX_PIXELS) {
            this.dropLitLayer()
            return false
        }
        const layer = this.litLayer, state = canvasStateOf(ctx)
        // The view in the layer's device pixels (its placement moved by the camera's shift rounded to whole pixels), within
        // the part of the canvas the layer can cover (litLayerRect's board and margin).
        const ox = layer ? Math.round(t.e - layer.e) : 0, oy = layer ? Math.round(t.f - layer.f) : 0
        const cover = this.litLayerRect(cw, ch, t, 0)
        const vx0 = cover.x0 - ox, vy0 = cover.y0 - oy, vx1 = vx0 + cover.width, vy1 = vy0 + cover.height
        // TASK-1551: no age limit (the layer is kept while its cells, key and state hold): a full rebuild only for a new scale,
        // canvas or state, a changed cell or key, or a view outside it; one nearing its edge is extended by strips instead.
        const cause = !layer ? 'none' : layer.a !== t.a || layer.d !== t.d ? 'scale' : cw !== layer.cw || ch !== layer.ch ? 'canvas' :
            !sameCanvasState(state, layer.state, LIT_LAYER_FREE_STATE) ? 'state:' + canvasStateDiff(state, layer.state, LIT_LAYER_FREE_STATE) :
            vx0 < layer.x0 && layer.x0 > layer.left || vy0 < layer.y0 && layer.y0 > layer.top ||
                vx1 > layer.x0 + layer.width && layer.x0 + layer.width < layer.right ||
                vy1 > layer.y0 + layer.height && layer.y0 + layer.height < layer.bottom ? 'outside' :
            !this.litLayerKeyHolds(layer) ? 'key' : !this.litLayerSignature(layer.range, layer.signature) ? 'cells' : null
        if (cause) {
            this.queueLitLayer(ctx, t, state, false, cause)
            return false
        }
        if (!layer.pieces)
            return false
        this.flushHeldPieces()
        const nearX = cover.width * LIT_STRIP_NEAR, nearY = cover.height * LIT_STRIP_NEAR
        if (vx0 - nearX < layer.x0 && layer.x0 > layer.left || vy0 - nearY < layer.y0 && layer.y0 > layer.top ||
                vx1 + nearX > layer.x0 + layer.width && layer.x0 + layer.width < layer.right ||
                vy1 + nearY > layer.y0 + layer.height && layer.y0 + layer.height < layer.bottom)
            this.queueLitStrips(layer, t, cw, ch, ox, oy)
        // The pieces in view, each copied whole at the layer's placement.
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        // (TASK-1551: a piece's x, y in the layer's pixels, its source sx, sy within its canvas: a trimmed piece draws a part.)
        for (const piece of layer.pieces) {
            const x = ox + piece.x, y = oy + piece.y
            if (x < cw && y < ch && x + piece.w > 0 && y + piece.h > 0)
                ctx.drawImage(piece.canvas, piece.sx, piece.sy, piece.w, piece.h, x, y, piece.w, piece.h)
        }
        ctx.restore()
        // What the skipped units pass does besides drawing: a selected demon portal's panel kept current (drawNextProduction,
        // refreshCulledPortal).
        const portal = gameEvent.selected
        if (portal?.isDemonPortal && !portal.killed && portal.nextProduction && this.arr[portal.coord.x]?.[portal.coord.y]?.building === portal &&
                (!isFogOfWar || this.fogOfWar[portal.coord.x][portal.coord.y] || fogShowsPortalPreview(portal)))
            entityInterface.refreshPortal(portal)
        ++this.litLayerFrames
        this.litLayerDrawnSerial = this.drawSerial
        return true
    }
    dropLitLayer() {
        // TASK-1546: one a kept recording or a zoom replay under way lists is retired instead (retireLitLayer).
        if (this.litLayer && this.litLayerListed(this.litLayer)) {
            this.retireLitLayer()
            return
        }
        this.givePieces(this.litLayer)
        this.litLayer = undefined
    }
    // The lit layer and its scratch canvas released (the frames left the lit tiles).
    releaseLitLayer() {
        this.dropLitLayerJob()
        this.dropLitLayer()
        this.givePieces(this.litLayerRetired)
        this.litLayerRetired = undefined
        this.flushHeldPieces(true)
        if (this.litLayerScratch)
            this.litLayerScratch.width = this.litLayerScratch.height = 0
        this.litLayerScratch = undefined
    }
    // The device-pixel rectangle of the lit layer for a cw x ch canvas at transform t: the canvas and margin (a fraction of
    // it) on each side, within the board and the overlays' margin around it (mapDepth.bounds; left, top, right, bottom: that
    // limit in the same pixels).
    litLayerRect(cw, ch, t, margin = LIT_LAYER_MARGIN) {
        mapDepth.ensureGeometry(this)
        const reach = 4 * basis.r + assets.size, b = mapDepth.bounds
        const left = Math.floor(t.a * (b.left - reach) + t.e), top = Math.floor(t.d * (b.top - reach) + t.f)
        const right = Math.ceil(t.a * (b.right + reach) + t.e), bottom = Math.ceil(t.d * (b.bottom + reach) + t.f)
        const x0 = Math.max(Math.floor(-cw * margin), left), y0 = Math.max(Math.floor(-ch * margin), top)
        const x1 = Math.min(Math.ceil(cw * (1 + margin)), right), y1 = Math.min(Math.ceil(ch * (1 + margin)), bottom)
        return {x0, y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0), left, top, right, bottom}
    }
    // What the lit layer drew from besides its cells: debug, the logic texts on and their revision, the hex radius, the bar
    // settings and fog of war.
    litLayerKey() {
        return [debug, this.drawLogicText, Grid.logicTextRevision, basis.r, otherSettings.alwaysDisplayHPBar,
            otherSettings.alwaysDisplayMovesBar, isFogOfWar, this.arr.length, this.arr[0]?.length]
    }
    litLayerKeyHolds(layer) {
        const key = this.litLayerKey()
        return key.every((v, k) => v === layer.key[k])
    }
    // What the units pass and the cell texts draw on the cells of range (a drawRange): for each cell that can draw (an
    // overlay cell, isOverlayCell; a fogged demon portal) its index, unit and building and what their drawing reads (hp,
    // pending heal, hit, moves and the moves bar shown, image, owner colour, production and its turns); with debug or logic
    // texts every cell's fog. ref undefined: returns {values, cells}; else whether the cells draw what ref lists.
    litLayerSignature(range, ref) {
        const values = ref ? null : []
        let k = 0, cells = 0
        // Object.is: an hp or pending heal read from a building without hp is NaN.
        const put = ref ? v => Object.is(ref[k++], v) : v => { values.push(v); return true }
        const texts = debug || this.drawLogicText, h = this.arr[0].length
        for (let i = range.i0; i < range.i1; ++i) {
            const row = this.arr[i], fogRow = isFogOfWar ? this.fogOfWar[i] : undefined
            for (let j = range.j0; j < range.j1; ++j) {
                const cell = row[j], fogged = !!fogRow && !fogRow[j]
                if (texts && !put(fogged))
                    return false
                const building = cell.building
                if (fogged) {
                    if (!building.isDemonPortal)
                        continue
                    const next = building.nextProduction
                    if (!put(i * h + j) || !put(building) || !put(building.killed) || !put(!!next) || !put(next?.type) ||
                            !put(next?.roundsRemaining) || !put(cell.hexColor))
                        return false
                    ++cells
                    continue
                }
                if (!this.isOverlayCell(cell))
                    continue
                ++cells
                const unit = cell.unit
                if (!put(i * h + j) || !put(unit) || !put(building) || !put(cell.hexColor) || !put(building.showsBar) ||
                        !put(building.hp) || !put(building.wasHitted) || !put(building.killed))
                    return false
                if (building.hasBar && building.hpBar && !put(building.hpIncrease))
                    return false
                if (building.isPreparingManufacture) {
                    const production = building.unitProduction
                    if (!put(production) || !put(production.name) || !put(production.turns))
                        return false
                }
                else if (building.isDemonPortal) {
                    // (a new object every read)
                    const next = building.nextProduction
                    if (!put(!!next) || !put(next?.type) || !put(next?.roundsRemaining))
                        return false
                }
                if (unit.notEmpty() && (!put(unit.hp) || !put(unit.hpIncrease) || !put(unit.wasHitted) || !put(unit.moves) ||
                        !put(unit.bodyImageName) || !put(shouldShowMovesBar(unit))))
                    return false
            }
        }
        return ref ? k === ref.length : {values, cells}
    }
    // Queues the lit layer for transform t of ctx, drawn from ctx's state now (one at a time). It is not built if the camera
    // came to rest, a zoom gesture began, the frames left the lit tiles or a unit is left out of the unit passes.
    queueLitLayer(ctx, t, state, ahead = false, cause = 'ahead') {
        if (this.litLayerQueued)
            return
        this.litLayerQueued = true
        this.litLayerRebuilds[cause] = (this.litLayerRebuilds[cause] || 0) + 1
        const cw = ctx.canvas.width, ch = ctx.canvas.height
        // TASK-1546 (Grid.litLayerSteps): the layer drawn in steps (litLayerRasterSteps), as many a task as fit LIT_LAYER_TASK_MS
        // (the first always), the next task queued until it is done; given up when the camera rests, a zoom begins, the
        // frames leave the lit tiles or the camera's scale changes. Only one queued ahead while the last frame drew the layer
        // (litLayerDrawnSerial: the frames draw it meanwhile) is stepped: without a layer to draw every frame between the steps
        // draws the units and texts directly, more work than the steps left (a direct pan frame at 0.156 with debug texts ~2500
        // calls), so such a layer is drawn at once as before (drawLitLayerRaster), and a stepped one the frames stop drawing
        // meanwhile finishes its steps at once.
        const steps = Grid.litLayerSteps ? this.litLayerRasterSteps(cw, ch, t, state) : null
        const job = this.litLayerJob = steps ? {steps, tasks: 0} : undefined
        const run = gridTask(() => {
            const screen = gameEvent.screen
            if (steps && this.litLayerJob !== job)
                return
            if (!screen.surfaceMoving || screen.zoomGesture || this !== grid || this.frameSurface !== 'lit' ||
                    this.stillUnitsHidden() || this.isObserving() ||
                    steps && typeof mainCtx !== 'undefined' && (mainCtx.getTransform().a !== t.a || mainCtx.getTransform().d !== t.d)) {
                this.litLayerQueued = false
                if (steps)
                    this.dropLitLayerJob()
                return
            }
            let layer
            const drawn = this.litLayerDrawnSerial === this.drawSerial
            if (steps && !job.tasks && !(ahead && drawn)) {
                this.litLayerJob = undefined
                steps.return()
            }
            else if (steps) {
                const start = performance.now(), budget = drawn ? LIT_LAYER_TASK_MS : Infinity
                let last = 0, step
                ++job.tasks
                do {
                    const t0 = performance.now()
                    step = steps.next()
                    last = performance.now() - t0
                } while (!step.done && performance.now() - start + last <= budget)
                if (!step.done) {
                    setTimeout(run)
                    return
                }
                this.litLayerJob = undefined
                this.litLayerQueued = false
                layer = step.value
                // Given up (a cell or the key changed while it was drawn): the frames queue another.
                if (!layer) {
                    ++this.litLayerJobsDropped
                    return
                }
                this.litLayerTaskCounts.push(job.tasks)
                if (this.litLayerTaskCounts.length > 32)
                    this.litLayerTaskCounts.shift()
            }
            if (!layer) {
                this.litLayerQueued = false
                layer = this.drawLitLayerRaster(cw, ch, t, state)
                this.dropLitLayer()
            }
            else
                this.retireLitLayer()
            this.litLayer = layer
            ++this.litLayerBuilds
            // TASK-1551: the strip chunk canvases the layers let go of meanwhile back to their pool.
            Grid.sweepLitStrips()
            // TASK-1550: its pieces' sizes, for the spare canvases made at rest (Grid.reserveLitPieces).
            if (layer.pieces?.length) {
                const demand = Grid.litPieceDemand = new Map()
                for (const piece of layer.pieces) {
                    const key = Grid.canvasPool.size(piece.w) + 'x' + Grid.canvasPool.size(piece.h)
                    demand.set(key, (demand.get(key) || 0) + 1)
                }
            }
        })
        setTimeout(run)
    }
    // TASK-1546: the lit layer replaced by one drawn in steps is kept (litLayerRetired) until the next is: the last frame's
    // recording (keepZoomSource) may draw its pieces, and a zoom raster made again from it (startZoomReplay) draws them then;
    // the one retired before is released unless a kept recording or a replay under way still lists it.
    retireLitLayer() {
        const old = this.litLayerRetired
        if (old && !this.litLayerListed(old))
            this.givePieces(old)
        this.litLayerRetired = this.litLayer
        this.litLayer = undefined
    }
    // TASK-1550: a layer's piece canvases given to Grid.canvasPool (the layer keeps none).
    givePieces(layer) {
        for (const piece of layer?.pieces || [])
            Grid.giveLitCanvas(piece.canvas)
        if (layer)
            layer.pieces = null
    }
    // TASK-1551: the lit layer extended while the camera pans at its scale. The view nearing its edge (drawLitLayer), the layer's
    // new rectangle is litLayerRect at the camera now (in the layer's pixels: shifted by the whole-pixel camera shift ox, oy);
    // only the strips of it the layer does not cover (at most 4 rectangles; a side moved out by less than LIT_STRIP_MIN of the
    // canvas, not to the board's limit, keeps its edge) are drawn: the units pass and the cell texts at the layer's transform
    // over each strip, cut into chunks (litStripChunks), each drawn on a canvas of its own whose pieces are the layer's
    // (litStripSteps), at most LIT_STRIP_STEP_CELLS drawing cells by a task between two frames (the cells within reach of a
    // chunk only, litStripRange). Done, the layer's pieces are cut to the new rectangle and the strips' added (commitLitStrips). The
    // pieces are drawn on the same pixel grid at the same transform, so a unit or text across a strip's edge draws the same
    // pixels on both sides. Given up as a full layer job is (dropLitLayerJob), or when the layer is no longer the one drawn.
    queueLitStrips(layer, t, cw, ch, ox, oy) {
        if (this.litLayerQueued)
            return
        const want = this.litLayerRect(cw, ch, t)
        const n = {x0: want.x0 - ox, y0: want.y0 - oy, x1: want.x0 - ox + want.width, y1: want.y0 - oy + want.height}
        const c = {x0: layer.x0, y0: layer.y0, x1: layer.x0 + layer.width, y1: layer.y0 + layer.height}
        const mx = Math.ceil(cw * LIT_STRIP_MIN), my = Math.ceil(ch * LIT_STRIP_MIN)
        if (n.x0 < c.x0 && c.x0 - n.x0 < mx && n.x0 > layer.left)
            n.x0 = c.x0
        if (n.y0 < c.y0 && c.y0 - n.y0 < my && n.y0 > layer.top)
            n.y0 = c.y0
        if (n.x1 > c.x1 && n.x1 - c.x1 < mx && n.x1 < layer.right)
            n.x1 = c.x1
        if (n.y1 > c.y1 && n.y1 - c.y1 < my && n.y1 < layer.bottom)
            n.y1 = c.y1
        // Not overlapping the layer: a full layer is drawn when the view leaves it.
        if (n.x0 >= c.x1 || n.x1 <= c.x0 || n.y0 >= c.y1 || n.y1 <= c.y0)
            return
        const strips = []
        if (n.y0 < c.y0)
            strips.push({x0: n.x0, y0: n.y0, x1: n.x1, y1: c.y0})
        if (n.y1 > c.y1)
            strips.push({x0: n.x0, y0: c.y1, x1: n.x1, y1: n.y1})
        const my0 = Math.max(n.y0, c.y0), my1 = Math.min(n.y1, c.y1)
        if (n.x0 < c.x0)
            strips.push({x0: n.x0, y0: my0, x1: c.x0, y1: my1})
        if (n.x1 > c.x1)
            strips.push({x0: c.x1, y0: my0, x1: n.x1, y1: my1})
        if (!strips.length)
            return
        this.litLayerQueued = true
        const steps = this.litStripSteps(layer, strips)
        const job = this.litLayerJob = {steps, tasks: 0, strips: strips.length}
        const run = gridTask(() => {
            if (this.litLayerJob !== job)
                return
            const screen = gameEvent.screen
            if (!screen.surfaceMoving || screen.zoomGesture || screen.surfaceZooming || this !== grid || this.frameSurface !== 'lit' ||
                    this.litLayer !== layer || !layer.pieces || this.stillUnitsHidden() || this.isObserving() ||
                    typeof mainCtx !== 'undefined' && (mainCtx.getTransform().a !== layer.a || mainCtx.getTransform().d !== layer.d)) {
                this.dropLitLayerJob()
                return
            }
            // One step between two frames: the next task waits for the next frame.
            if (job.serial === this.drawSerial) {
                setTimeout(run, LIT_STRIP_WAIT_MS)
                return
            }
            ++job.tasks
            const step = steps.next()
            if (!step.done) {
                job.serial = this.drawSerial
                setTimeout(run, LIT_STRIP_WAIT_MS)
                return
            }
            this.litLayerJob = undefined
            this.litLayerQueued = false
            if (!step.value || !this.commitLitStrips(layer, n, step.value))
                ++this.litLayerJobsDropped
        })
        setTimeout(run)
    }
    // TASK-1551: queueLitStrips's work in steps (a generator; its value {pieces, strips}, null when given up): for each chunk of
    // the strips (a rectangle in the layer's pixels) the units pass and the cell texts of the cells within its reach drawn on
    // a canvas of its own (Grid.litStripPool), its pieces (litLayerPieces within the chunk, so none overlaps the layer's or
    // another chunk's) drawn from that canvas, placed in the layer's pixels; a step yields before a chunk that would take the
    // step's drawing cells past LIT_STRIP_STEP_CELLS. Given up when the key changed by a chunk's drawing or a chunk's cells
    // changed by the end; the canvases taken are given back then.
    *litStripSteps(layer, strips) {
        const pieces = [], signatures = [], T = LIT_STRIP_TILE
        let done = false, drawn = 0
        try {
            for (const r of this.litStripChunks(strips)) {
                const width = r.x1 - r.x0, height = r.y1 - r.y0
                const transform = {a: layer.a, b: 0, c: 0, d: layer.d, e: layer.e - r.x0, f: layer.f - r.y0}
                const range = this.litStripRange(transform, width, height)
                const {values, cells} = this.litLayerSignature(range)
                signatures.push([range, values])
                const target = Math.max(1, Math.round(LIT_PIECE_VISIBLE * width * height / (layer.cw * layer.ch)))
                const parts = this.litLayerPieces(range, transform, width, height, target)
                if (!parts.length)
                    continue
                // At most LIT_STRIP_STEP_CELLS drawing cells a task between two frames (a chunk with more alone).
                if (drawn && drawn + cells > LIT_STRIP_STEP_CELLS) {
                    drawn = 0
                    yield
                }
                drawn += cells
                // The chunk drawn on its own canvas (LIT_STRIP_TILE square, from Grid.litStripPool, its own: every chunk takes that
                // one size, so the tiles the pans let go of are the ones they take), its pieces drawn from it.
                const canvas = Grid.litStripPool.take(T, T, width, height)
                canvas.litStrip = true
                Grid.litStripLive.add(canvas)
                ++Grid.litStripMoving
                pieces.push(...parts.map(piece => ({x: r.x0 + piece.x, y: r.y0 + piece.y, w: piece.w, h: piece.h, sx: piece.x, sy: piece.y, canvas, strip: true})))
                const lctx = canvas.getContext('2d')
                lctx.save()
                applyCanvasState(lctx, {...layer.state, transform})
                this.drawOther(lctx, 'units', range)
                this.drawCellText(lctx, range)
                lctx.restore()
                lctx.getImageData(0, 0, 1, 1)
                if (!this.litLayerKeyHolds(layer))
                    return null
            }
            for (const [range, values] of signatures)
                if (!this.litLayerSignature(range, values))
                    return null
            done = true
            return {pieces, strips: strips.length}
        } finally {
            if (!done)
                for (const piece of pieces)
                    Grid.giveLitCanvas(piece.canvas)
        }
    }
    // TASK-1551: each strip cut into equal chunks of at most LIT_STRIP_TILE a side.
    litStripChunks(strips) {
        const chunks = [], T = LIT_STRIP_TILE
        for (const r of strips) {
            const w = r.x1 - r.x0, h = r.y1 - r.y0, nx = Math.ceil(w / T), ny = Math.ceil(h / T)
            for (let b = 0; b < ny; ++b)
                for (let a = 0; a < nx; ++a)
                    chunks.push({x0: r.x0 + Math.floor(a * w / nx), x1: r.x0 + Math.floor((a + 1) * w / nx),
                        y0: r.y0 + Math.floor(b * h / ny), y1: r.y0 + Math.floor((b + 1) * h / ny)})
        }
        return chunks
    }
    // TASK-1551: the cells whose drawing can reach a width x height canvas at transform: centres within LIT_STRIP_REACH hex
    // radii (past the pieces' LIT_PIECE_REACH) and LIT_PIECE_PAD device pixels of it (drawRange's cells within its wide margin
    // would draw several times the cells a thin strip needs).
    litStripRange(transform, width, height) {
        const reach = LIT_STRIP_REACH * basis.r, padX = LIT_PIECE_PAD / transform.a, padY = LIT_PIECE_PAD / transform.d
        const left = -transform.e / transform.a - reach - padX, right = (width - transform.e) / transform.a + reach + padX
        const top = -transform.f / transform.d - reach - padY, bottom = (height - transform.f) / transform.d + reach + padY
        const n = this.arr.length, m = n ? this.arr[0].length : 0
        return {
            i0: Math.max(0, Math.floor(left / basis.offset.x)), i1: Math.min(n, Math.ceil(right / basis.offset.x) + 1),
            j0: Math.max(0, Math.floor((top / basis.offset.y - 1) / 2)), j1: Math.min(m, Math.ceil(bottom / basis.offset.y / 2) + 1)
        }
    }
    // TASK-1551: the strips' pieces added to the layer (still the one drawn, its key and cells as it drew them), its pieces cut to
    // the new rectangle cover (in its pixels; a piece across its edge keeps the part inside, drawn from its source offset), the
    // ones outside given to the pool (held while a kept recording lists the layer, flushHeldPieces), its range and signature
    // those of the new rectangle. Returns whether it was added.
    commitLitStrips(layer, cover, {pieces, strips}) {
        if (this.litLayer !== layer || !layer.pieces || !this.litLayerKeyHolds(layer) || !this.litLayerSignature(layer.range, layer.signature)) {
            for (const piece of pieces)
                Grid.giveLitCanvas(piece.canvas)
            return false
        }
        const kept = []
        let dropped = []
        for (const p of layer.pieces) {
            const x0 = Math.max(p.x, cover.x0), y0 = Math.max(p.y, cover.y0)
            const x1 = Math.min(p.x + p.w, cover.x1), y1 = Math.min(p.y + p.h, cover.y1)
            if (x1 <= x0 || y1 <= y0)
                dropped.push(p.canvas)
            else if (x0 !== p.x || y0 !== p.y || x1 !== p.x + p.w || y1 !== p.y + p.h)
                kept.push({x: x0, y: y0, w: x1 - x0, h: y1 - y0, sx: p.sx + x0 - p.x, sy: p.sy + y0 - p.y, canvas: p.canvas, strip: p.strip})
            else
                kept.push(p)
        }
        // (A strip chunk's pieces share its canvas: it is let go of with its last piece.)
        const used = new Set(kept.map(p => p.canvas))
        dropped = [...new Set(dropped)].filter(canvas => !used.has(canvas))
        if (this.litLayerListed(layer))
            this.litPiecesHeld.push({layer, serial: this.drawSerial, canvases: dropped})
        else
            for (const canvas of dropped)
                Grid.giveLitCanvas(canvas)
        layer.pieces = kept.concat(pieces)
        layer.x0 = cover.x0
        layer.y0 = cover.y0
        layer.width = cover.x1 - cover.x0
        layer.height = cover.y1 - cover.y0
        const transform = {a: layer.a, b: 0, c: 0, d: layer.d, e: layer.e - cover.x0, f: layer.f - cover.y0}
        layer.range = this.drawRange({getTransform: () => transform, canvas: {width: layer.width, height: layer.height}})
        const {values, cells} = this.litLayerSignature(layer.range)
        layer.signature = values
        layer.cells = cells
        layer.strips = (layer.strips || 0) + strips
        ++this.litLayerStripJobs
        this.litLayerStrips += strips
        return true
    }
    // TASK-1551: piece canvases a strip trim let go of, given to the pool once a frame was drawn after the trim (the kept
    // recording, keepZoomSource, is the last frame's: it no longer draws them) and no zoom replay under way lists their layer
    // (all: at once).
    flushHeldPieces(all = false) {
        if (!this.litPiecesHeld.length)
            return
        this.litPiecesHeld = this.litPiecesHeld.filter(held => {
            if (!all && (held.serial === this.drawSerial || this.zoomReplayJob?.source?.layers?.[0] === held.layer))
                return true
            for (const canvas of held.canvases)
                Grid.giveLitCanvas(canvas)
            return false
        })
    }
    litLayerListed(layer) {
        return this.zoomSource?.layers?.[0] === layer || this.zoomReplayJob?.source?.layers?.[0] === layer
    }
    // TASK-1546: the lit layer under way given up (the copies it made released).
    dropLitLayerJob() {
        const job = this.litLayerJob
        if (!job)
            return
        this.litLayerJob = undefined
        this.litLayerQueued = false
        job.steps.return()
        ++this.litLayerJobsDropped
    }
    // The units pass and the cell texts as a frame on a cw x ch canvas at transform t with context state draws them (drawOther
    // 'units', drawCellText), within litLayerRect and on the same pixel grid: drawn on a transparent canvas of the
    // rectangle's size (litLayerScratch, kept), then copied whole-pixel into the pieces (litLayerPieces: disjoint rectangles
    // round the cells that draw), one canvas each, so a frame draws (and its canvas records) only the pieces in view, not
    // the empty pixels between the units. Nothing is drawn (no pieces) for fewer than LIT_LAYER_MIN_CELLS cells and no
    // debug or logic texts.
    drawLitLayerRaster(cw, ch, t, state) {
        const steps = this.litLayerRasterSteps(cw, ch, t, state, true)
        let step
        while (!(step = steps.next()).done);
        return step.value
    }
    // TASK-1546: drawLitLayerRaster's work in steps (a generator; its value the layer): the units pass and the cell texts on
    // the scratch canvas (one step: a frame between them would draw and clear the cells' info texts), then each piece's copy
    // (rasterized by a one-pixel read). Stepped (once false: all in one task as before), the layer is the scratch's when the
    // units were drawn: the pieces are new canvases (the layer the frames draw meanwhile keeps its own), its time is the
    // drawing's, and it is given up (value null) when a cell it drew or its key changed by its end (litLayerSignature,
    // litLayerKeyHolds).
    *litLayerRasterSteps(cw, ch, t, state, once = false) {
        const time = performance.now()
        const rect = this.litLayerRect(cw, ch, t)
        const {x0, y0, width, height} = rect
        const transform = {a: t.a, b: 0, c: 0, d: t.d, e: t.e - x0, f: t.f - y0}
        const range = this.drawRange({getTransform: () => transform, canvas: {width, height}})
        const {values, cells} = this.litLayerSignature(range)
        let pieces = null, key
        if (cells >= LIT_LAYER_MIN_CELLS || debug || this.drawLogicText) {
            let canvas = this.litLayerScratch
            if (!canvas || canvas.width < width || canvas.height < height) {
                if (canvas)
                    canvas.width = canvas.height = 0
                canvas = this.litLayerScratch = document.createElement('canvas')
                canvas.width = width
                canvas.height = height
            }
            // About LIT_PIECE_VISIBLE pieces in a canvas-sized view: the layer's area over the view's (within the board) times it.
            const cover = this.litLayerRect(cw, ch, t, 0)
            const target = Math.max(LIT_PIECE_VISIBLE, Math.round(LIT_PIECE_VISIBLE * width * height / (cover.width * cover.height)))
            const lctx = canvas.getContext('2d')
            const parts = this.litLayerPieces(range, transform, width, height, target)
            // Only the pieces are read: only they are cleared (the whole canvas for the audit).
            lctx.setTransform(1, 0, 0, 1, 0, 0)
            if (Grid.litLayerAudit)
                lctx.clearRect(0, 0, width, height)
            else
                for (const piece of parts)
                    lctx.clearRect(piece.x, piece.y, piece.w, piece.h)
            applyCanvasState(lctx, {...state, transform})
            this.drawOther(lctx, 'units')
            this.drawCellText(lctx)
            // The key after the drawing (a logic text read the first time is made then, Grid.logicTextChanged).
            key = this.litLayerKey()
            if (!once)
                yield
            // Each piece copied into its own canvas, rasterized by a one-pixel read in this task between frames (as
            // queueOverlayLayer). TASK-1550: the canvases from Grid.canvasPool (at least the piece's size; the piece is its
            // corner), at once the pieces of the layer before given to it first, so they are reused.
            // TASK-1546: the layer whose pieces are drawn again is noted (litLayerRedrawn: a recording listing it is stale,
            // zoomSourceFor) and, while a kept recording lists it, its pieces are not given back (a zoom replay of that
            // recording draws them).
            const listed = once && !!this.litLayer && this.litLayerListed(this.litLayer)
            if (once && this.litLayer) {
                this.litLayerRedrawn = this.litLayer
                if (listed)
                    this.litLayer.pieces = null
                else
                    this.givePieces(this.litLayer)
            }
            pieces = []
            try {
                for (const piece of parts) {
                    if (pieces.length && !once)
                        yield
                    if (canvas !== this.litLayerScratch)
                        return null
                    const part = Grid.canvasPool.take(piece.w, piece.h)
                    const pctx = part.getContext('2d')
                    pctx.drawImage(canvas, piece.x, piece.y, piece.w, piece.h, 0, 0, piece.w, piece.h)
                    pctx.getImageData(0, 0, 1, 1)
                    pieces.push({...piece, canvas: part})
                }
            } finally {
                // Given up: the copies made given back.
                if (pieces.length < parts.length)
                    for (const piece of pieces)
                        Grid.canvasPool.give(piece.canvas)
            }
            if (Grid.litLayerAudit)
                this.auditLitLayer(lctx, width, height, pieces)
            // TASK-1551: the pieces placed in the layer's pixels (x, y; the canvas's at the layer's transform), drawn from sx, sy.
            for (const piece of pieces) {
                piece.x += x0
                piece.y += y0
                piece.sx = piece.sy = 0
            }
            if (!once && (!this.litLayerKeyHolds({key}) || !this.litLayerSignature(range, values))) {
                for (const piece of pieces)
                    Grid.canvasPool.give(piece.canvas)
                return null
            }
        }
        else
            key = this.litLayerKey()
        return {pieces, a: t.a, d: t.d, e: t.e, f: t.f, cw, ch, x0, y0, width, height, left: rect.left, top: rect.top,
            right: rect.right, bottom: rect.bottom, range, signature: values, cells, key, state,
            time: once ? performance.now() : time}
    }
    // The lit layer's pieces for the cells of range at transform (the layer's own pixels, width x height): the cells that can
    // draw in the units pass or the cell texts (an overlay cell, a fogged portal's preview, with debug every cell's
    // coordinate text, with logic texts every cell holding one) each mark the LIT_PIECE_BLOCK px blocks within
    // LIT_PIECE_REACH of its centre (the reach of its sprites, bars, preview and texts); the marked blocks are covered exactly
    // by rectangles, merged into fewer (about target) adding the fewest unmarked blocks; none overlap.
    litLayerPieces(range, transform, width, height, target) {
        const B = LIT_PIECE_BLOCK, cols = Math.ceil(width / B), rows = Math.ceil(height / B)
        const marked = new Uint8Array(cols * rows)
        const [reachLeft, reachUp, reachRight, reachDown] = LIT_PIECE_REACH
        const left = reachLeft * basis.r * transform.a + LIT_PIECE_PAD, right = reachRight * basis.r * transform.a + LIT_PIECE_PAD
        const up = reachUp * basis.r * transform.d + LIT_PIECE_PAD, down = reachDown * basis.r * transform.d + LIT_PIECE_PAD
        const logic = this.drawLogicText && !this.lod
        for (let i = range.i0; i < range.i1; ++i) {
            const row = this.arr[i], fogRow = isFogOfWar ? this.fogOfWar[i] : undefined
            for (let j = range.j0; j < range.j1; ++j) {
                const cell = row[j]
                if (cell.building.isMapEdge && !this.isOverlayCell(cell))
                    continue
                const fogged = !!fogRow && !fogRow[j]
                if (!(debug || (fogged ? this.fogPortalPreview(cell) : this.isOverlayCell(cell) || logic && cell.logicText.text != '')))
                    continue
                const x = i * basis.offset.x * transform.a + transform.e, y = (2 * j + (i & 1)) * basis.offset.y * transform.d + transform.f
                const c0 = Math.max(0, Math.floor((x - left) / B)), c1 = Math.min(cols - 1, Math.floor((x + right) / B))
                const r0 = Math.max(0, Math.floor((y - up) / B)), r1 = Math.min(rows - 1, Math.floor((y + down) / B))
                for (let r = r0; r <= r1; ++r)
                    marked.fill(1, r * cols + c0, r * cols + c1 + 1)
            }
        }
        // The marked blocks covered exactly by rectangles (in blocks): each row's runs, a run continuing the same columns of the
        // row above extending that rectangle.
        let boxes = [], open = new Map()
        for (let r = 0; r < rows; ++r) {
            const next = new Map()
            for (let c = 0; c < cols; ++c) {
                if (!marked[r * cols + c])
                    continue
                const c0 = c
                while (c + 1 < cols && marked[r * cols + c + 1])
                    ++c
                const key = c0 * 65536 + c
                let box = open.get(key)
                if (box)
                    box.r1 = r
                else
                    boxes.push(box = {c0, c1: c, r0: r, r1: r})
                next.set(key, box)
            }
            open = next
        }
        // Then pairs merged into their bounds, fewest added blocks first (a pair whose bounds overlap a third rectangle is not
        // merged: none overlap, and no merge swallows its neighbours): every merge that adds no block, and others while more
        // than target are left.
        const area = q => (q.c1 - q.c0 + 1) * (q.r1 - q.r0 + 1)
        const union = (p, q) => ({c0: Math.min(p.c0, q.c0), c1: Math.max(p.c1, q.c1), r0: Math.min(p.r0, q.r0), r1: Math.max(p.r1, q.r1)})
        const overlaps = (p, q) => p.c0 <= q.c1 && q.c0 <= p.c1 && p.r0 <= q.r1 && q.r0 <= p.r1
        if (boxes.length > 1 && boxes.length <= LIT_PIECE_MERGE_LIMIT) {
            // A binary min-heap of [waste, p, q].
            const heap = []
            const push = item => {
                heap.push(item)
                for (let k = heap.length - 1; k > 0;) {
                    const up = (k - 1) >> 1
                    if (heap[up][0] <= heap[k][0])
                        break
                    ;[heap[up], heap[k]] = [heap[k], heap[up]]
                    k = up
                }
            }
            const pop = () => {
                const top = heap[0], last = heap.pop()
                if (heap.length) {
                    heap[0] = last
                    for (let k = 0; ;) {
                        const l = 2 * k + 1, r = l + 1
                        let m = k
                        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
                        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
                        if (m === k)
                            break
                        ;[heap[m], heap[k]] = [heap[k], heap[m]]
                        k = m
                    }
                }
                return top
            }
            const pairWith = (p, list) => {
                for (const q of list)
                    if (q !== p && !q.dead)
                        push([area(union(p, q)) - area(p) - area(q), p, q])
            }
            boxes.forEach((p, k) => pairWith(p, boxes.slice(k + 1)))
            let live = boxes.length
            while (heap.length && live > 1) {
                const [waste, p, q] = pop()
                if (p.dead || q.dead)
                    continue
                if (waste > 0 && live <= target)
                    break
                const u = union(p, q)
                if (boxes.some(o => o !== p && o !== q && !o.dead && overlaps(u, o)))
                    continue
                p.dead = q.dead = true
                boxes.push(u)
                --live
                pairWith(u, boxes)
            }
            boxes = boxes.filter(q => !q.dead)
        }
        // TASK-1545: a rectangle over LIT_PIECE_MAX_SIDE a side cut into equal pieces within it (a frame draws a piece in view
        // whole: one reaching past the canvas's side records its pixels off the canvas too).
        const pieces = [], most = Math.max(1, Math.floor(LIT_PIECE_MAX_SIDE / B))
        for (const box of boxes) {
            const nc = Math.ceil((box.c1 - box.c0 + 1) / most), nr = Math.ceil((box.r1 - box.r0 + 1) / most)
            for (let a = 0; a < nr; ++a)
                for (let b = 0; b < nc; ++b) {
                    const c0 = box.c0 + Math.floor(b * (box.c1 - box.c0 + 1) / nc), c1 = box.c0 + Math.floor((b + 1) * (box.c1 - box.c0 + 1) / nc) - 1
                    const r0 = box.r0 + Math.floor(a * (box.r1 - box.r0 + 1) / nr), r1 = box.r0 + Math.floor((a + 1) * (box.r1 - box.r0 + 1) / nr) - 1
                    const x0 = c0 * B, y0 = r0 * B, x1 = Math.min(width, (c1 + 1) * B), y1 = Math.min(height, (r1 + 1) * B)
                    pieces.push({x: x0, y: y0, w: x1 - x0, h: y1 - y0})
                }
        }
        return pieces
    }
    // Grid.litLayerAudit (tests and measurements only): the drawn layer's pixels outside its pieces (lost; should be none),
    // counted on Grid.litLayerAudits.
    auditLitLayer(lctx, width, height, pieces) {
        const data = lctx.getImageData(0, 0, width, height).data, inside = new Uint8Array(width * height)
        for (const p of pieces)
            for (let y = p.y; y < p.y + p.h; ++y)
                inside.fill(1, y * width + p.x, y * width + p.x + p.w)
        let lost = 0, maxAlpha = 0, drawn = 0
        for (let k = 0; k < inside.length; ++k) {
            const alpha = data[k * 4 + 3]
            if (alpha)
                ++drawn
            if (alpha && !inside[k]) {
                ++lost
                maxAlpha = Math.max(maxAlpha, alpha)
            }
        }
        const area = pieces.reduce((sum, p) => sum + p.w * p.h, 0)
        ;(Grid.litLayerAudits ||= []).push({width, height, pieces: pieces.length, piecePixels: area, drawnPixels: drawn, lost, maxAlpha})
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
        if (typeof Proxy !== 'function' || debug || this.lod || this.stillRecording || this.zoomRecording || !screen || screen.surfaceMoving || !this.surfaceCacheLit || this.surfacePatchJob || this.litView?.layerJob ||
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
        setTimeout(gridTask(() => {
            composite.queued = false
            const t = source.getContext('2d').getTransform(), key = composite.key, b = this.surfaceCacheBounds
            const now = [t.a, t.d, t.e, t.f, source.width, source.height, atmosphericBackground.raster, mapDepth.atmosphericShadow,
                this.surfaceCache, this.surfaceCacheRevision, b?.left, b?.top, b?.width, b?.height]
            // Nor while a patch is under way: frames then draw their overlays directly (beginOverlayComposite).
            if (this.overlayComposite !== composite || now.some((v, k) => v !== key[k]) || this.surfacePatchJob || this.litView?.layerJob || this.surfaceLayerJob ||
                    !atmosphericBackground.opaqueOver(source.getContext('2d')))
                return
            this.renderOverlaySnapshot(source, composite)
        }))
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
    // TASK-1560 (SECTORS 4/11): UNIT SECTORS. During a pan (Screen.surfaceMoving, no zoom gesture) the units pass (the lit
    // tiles' drawOther 'units'; the surface cache's drawStillUnits + drawEntityOverlays: still units with their bars, production
    // silhouettes and previews with their production texts, building and portal bars, fogged portal previews) is drawn
    // into board-space sectors together with the board picture under it, so a pan frame composites one image a sector and
    // draws no unit call. A sector (Grid.unitSectors, a SectorCache of LIT_TILE squares on the board's device grid at the
    // camera's exact scale, the lit tiles' grid: view e/f 0) holds its square of
    //   - the ground the frame draws there: on the lit path the lit tile (its sector, TASK-1559) or, with none, the stand-in
    //     (the surface cache drawn magnified or the stand-in preview, drawLitView's missing squares); on the surface cache's
    //     path (drawCacheSectors) the cache (drawSurfaceCacheRect, the light baked in);
    //   - over it the units pass of the cells reaching the square (drawRange of the sector's canvas), then their cell
    //     texts (TASK-1561, sectorCellTexts: the production texts the pass sets; with debug the coordinate texts), in
    //     the frame's order; a sector frame draws no cell text of its own (Grid.draw's layered).
    // A frame draws a square's sector when it is clean (no cell reaching it changed since it was built: unitSectorCheck) and
    // its ground is the one the frame would draw (the same tile, or the same stand-in, unitStandInToken); every other square
    // is a LIVE square: its ground drawn as before and the units pass and cell texts drawn live, clipped to the live squares
    // (drawLiveSectorUnits), so a unit across a sector's edge is drawn once. A lit square whose tile meets the view's edge
    // runs (the frame's light over the sky there comes after the tile and before the units, drawLitEdges) is always live.
    // The sectors missing or not clean on the canvas and a ring of UNIT_SECTOR_AHEAD squares round it are built by one task
    // between frames (queueUnitSectors, nearest the centre first, within UNIT_SECTOR_TASK_MS), drawn on new canvases (a kept
    // recording of the last frame may still draw the old ones) and rasterized there by a one-pixel read.
    // Live on top, as before (never in a sector): moveTween's moving units, onlineObservation's and remoteEffects' drawing,
    // attack and heal effects (a unit they hide keeps the frames off the sectors: stillUnitsHidden), the loading cells, the
    // chance of winning texts (debug's I key: they follow the selection), the attack border and border (selection,
    // hover), the selection marks and overlay, and the interface. A selection's logic texts keep the frames off the sectors
    // (they replace the info texts of their cells).
    // Not used at rest (settled frames are drawn as before), in zoom gestures, level-of-detail frames, with logic texts, an
    // observed board, or (the sectors released) another scale, debug, setting or context state than the sectors' (unitSectorPlan).
    // Grid.unitSectors false: as before.
    // TASK-1561 (SECTORS 5/11): the cell texts are in the sectors (debug's coordinate texts too); a sector frame draws none
    // itself, and draws no lit layer or (Grid.sceneYieldsToSectors) scene layer. Besides:
    //   - OVERLAY sectors (unitSectorGround: UNIT_OVERLAY): a square whose ground cannot be drawn into a sector (an edge-run
    //     tile, a stand-in the build cannot draw, no view yet) gets one holding the units pass and texts on a transparent
    //     canvas, drawn over its live ground (drawUnitOverlays); a whole sector replaces it later (the frames' upgrades).
    //   - Frames at rest have the squares on the canvas and the ring built (restUnitSectors), so a pan starts on sectors.
    //   - A build is steps (unitSectorSteps: the ground, column chunks of the units pass, the bars, then the texts one by
    //     one) within a task's draw call budget (UNIT_SECTOR_TASK_CALLS, counted on the sector's canvas: countDrawCalls); a
    //     cut build goes on in the next task (unitSectorBuilding). After a frame whose live squares cost more than
    //     UNIT_SECTOR_BURST_COST the task builds the canvas's squares at once (UNIT_SECTOR_BURST_CALLS / _MS).
    //   - The texts a sector holds are those whose box meets its square (textMeets), not drawRange's units margin.
    //   - Live squares are drawn per disjoint rectangle with its own cells (drawLiveSectorUnits), not their bounding box.
    //   - Debug turned on or off keeps the other state's sectors aside (unitSectorAlt).
    // The plan of a frame on ctx on the unit sectors of kind ('lit' or 'cache'), null when it draws the units as before.
    // TASK-1565 (SECTORS 9/11, Grid.sectorAhead): BUILD AHEAD. The frames on the lit tiles and the surface cache's path queue the
    // sectors of the camera's level (lit tiles: queueLitTiles; unit sectors: queueUnitSectors / restUnitSectors) for the
    // canvas's squares (nearest its centre first) and a ring round them (aheadRange: SECTOR_AHEAD_RING squares, more on the
    // sides the camera moves to: the squares it crosses in LIT_AHEAD_MS at its velocity, sectorMotion, at most LIT_AHEAD_MAX),
    // the ring's in the order the camera reaches them (aheadWhen), while the camera moves and at rest. A build under way for a
    // square that left the ring is given up (cancelled), so are queued ones (the lists are the frame's). While the camera
    // moves the builds between two frames share LEVEL_FRAME_CALLS (levelWorkLeft, as after a zoom) with AHEAD_TILE_STEPS
    // lit tile steps, so a pan frame and its builds stay under a heavy frame's 500 calls; a square whose tile is missing gets
    // an overlay sector (its units and texts, drawn over the stand-in, then over the tile when it comes) instead of a sector
    // on the stand-in's ground. The sector caches keep SECTOR_CACHE_BYTES together (LIT_SECTOR_BYTES + UNIT_SECTOR_BYTES,
    // LRU). The stand-in is drawn only for a square whose tile is still missing.
    // The camera's motion (device pixels a ms, smoothed over LIT_MOTION_SMOOTH_MS; again from 0 after LIT_MOTION_GAP_MS
    // without a frame or at another scale) from a frame's camera transform t.
    followSectorMotion(t) {
        const now = performance.now(), m = this.sectorMotion
        if (!m || m.a !== t.a || now - m.time > LIT_MOTION_GAP_MS) {
            this.sectorMotion = {a: t.a, e: t.e, f: t.f, time: now, vx: 0, vy: 0}
            return
        }
        const dt = now - m.time
        if (dt <= 0)
            return
        const k = Math.min(1, dt / LIT_MOTION_SMOOTH_MS)
        m.vx += ((t.e - m.e) / dt - m.vx) * k
        m.vy += ((t.f - m.f) / dt - m.vy) * k
        m.e = t.e
        m.f = t.f
        m.time = now
    }
    // Whether the build-ahead runs (and the camera moves: moving).
    aheadOn(moving = false) {
        return !!Grid.sectorAhead && (!moving || typeof gameEvent !== 'undefined' && !!gameEvent.screen?.surfaceMoving)
    }
    // The squares of range (litTileRange of the canvas) grown by the ring: {range, mx, my, ox, oy, cw, ch} (the canvas's motion
    // over the board's squares, mx/my, device pixels a ms; 0 at rest or without a motion at the camera's scale a).
    aheadRange(range, a, ox, oy, cw, ch, ring = SECTOR_AHEAD_RING) {
        const m = this.sectorMotion && this.sectorMotion.a === a && performance.now() - this.sectorMotion.time <= LIT_MOTION_GAP_MS ?
            this.sectorMotion : null
        const mx = m ? -m.vx : 0, my = m ? -m.vy : 0
        const r = {u0: range.u0 - ring, u1: range.u1 + ring, v0: range.v0 - ring, v1: range.v1 + ring}
        const reach = speed => Math.min(LIT_AHEAD_MAX, Math.ceil(Math.abs(speed) * LIT_AHEAD_MS / LIT_TILE))
        if (mx > 0) r.u1 += reach(mx)
        else if (mx < 0) r.u0 -= reach(mx)
        if (my > 0) r.v1 += reach(my)
        else if (my < 0) r.v0 -= reach(my)
        return {range: r, ox, oy, cw, ch, mx, my}
    }
    unitSectorPlan(ctx, kind, rest = false) {
        const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
        const t = ctx.getTransform()
        const refused = !Grid.unitSectors || !this.unitSectors || !otherSettings.atmosphericVisuals || !screen ? 'off' :
            !screen.surfaceMoving && !rest ? 'rest' : screen.zoomGesture || screen.surfaceZooming ? 'zoom' :
            typeof mainCanvas === 'undefined' || ctx.canvas !== mainCanvas || this !== grid || !this.arr.length ? 'canvas' :
            t.b !== 0 || t.c !== 0 || !(t.a > 0) || t.a !== t.d ? 'transform' : this.lod ? 'lod' :
            this.drawLogicText ? 'texts' : this.stillUnitsHidden() ? 'hidden' : this.isObserving() ? 'observing' : null
        if (refused) {
            this.unitSectorRefusals[kind + ':' + refused] = (this.unitSectorRefusals[kind + ':' + refused] || 0) + 1
            return null
        }
        const state = canvasStateOf(ctx)
        // TASK-1562 (Grid.zoomLevels): the key holds neither the kind nor the scale: the sectors of every level (and of both
        // kinds: the scale picks the kind) are kept across zooms, each entry with its level, kind and, on the cache's path,
        // what its ground was drawn from (entry.tag: cacheSectorKey, plan.tag; unitEntryFits).
        const levels = Grid.zoomLevels
        const key = [levels ? 'levels' : kind, levels ? 0 : t.a, basis.r, assets.size, otherSettings.alwaysDisplayHPBar, otherSettings.alwaysDisplayMovesBar,
            isFogOfWar, this.arr.length, this.arr[0].length, !!debug, ...(kind === 'cache' && !levels ? this.cacheSectorKey() : []),
            ...(levels ? [cachedImagesSignature()] : [])]
        const old = this.unitSectorKey
        const same = (k, skip) => !!k && k.key.length === key.length && key.every((v, i) => skip?.includes(i) || v === k.key[i]) &&
            sameCanvasState(state, k.state, LIT_LAYER_FREE_STATE)
        if (!same(old)) {
            // TASK-1561: debug turned on or off keeps the sectors of the other state aside (unitSectorAlt, within
            // UNIT_SECTOR_ALT_SHARE of the budget) and takes back the ones kept for this state.
            const debugAt = kind === 'cache' && !levels ? [UNIT_SECTOR_DEBUG_KEY, UNIT_SECTOR_KEY_BASE + SCENE_LAYER_KEY_DEBUG] : [UNIT_SECTOR_DEBUG_KEY]
            if (Grid.unitSectorDebugSets && same(old, debugAt)) {
                const alt = this.unitSectorAlt, kept = {cache: this.unitSectors, key: old}
                if (alt && same(alt.key)) {
                    this.unitSectors = alt.cache
                    this.unitSectorKey = alt.key
                }
                else {
                    alt?.cache.clear()
                    this.unitSectors = alt ? alt.cache : this.newUnitSectorCache()
                    this.unitSectorKey = {key, state}
                }
                // TASK-1565: the two sets within the unit sectors' budget together (SECTOR_CACHE_BYTES with the lit sectors).
                const base = this.unitSectorBudget()
                kept.cache.budget = Math.floor(base * UNIT_SECTOR_ALT_SHARE)
                this.unitSectors.budget = base - kept.cache.budget
                kept.cache.evict()
                this.unitSectors.evict()
                this.unitSectorAlt = kept
                this.unitSectorWanted = undefined
                this.unitSectorBuilding = undefined
                ++this.unitSectorWork.swaps
            }
            else {
                this.clearUnitSectors(old ? 'key' : 'none')
                this.unitSectorKey = {key, state}
            }
        }
        const plan = {kind, t, level: t.a, state, key: this.unitSectorKey, rest, tag: kind === 'cache' ? this.cacheSectorKey() : null}
        if (!rest)
            this.unitSectorLastPlan = plan
        if (this.unitSectorSerial !== this.drawSerial) {
            this.unitSectorSerial = this.drawSerial
            this.unitSectors.beginFrame()
        }
        return plan
    }
    // Every unit sector released (the cells' kept values too: a new set is built from the board).
    clearUnitSectors(reason) {
        // TASK-1564: the pictures under way in the Worker dropped when they come back.
        this.unitWorkerSectors = undefined
        if (this.unitSectors?.entries.size) {
            ++this.unitSectorWork.clears
            this.unitSectorClears.push(reason)
            if (this.unitSectorClears.length > 64)
                this.unitSectorClears.splice(0, 32)
        }
        this.unitSectors?.clear()
        if (this.unitSectorAlt) {
            this.unitSectors.budget = this.unitSectorBudget()
            this.unitSectorAlt.cache.clear()
            this.unitSectorAlt = undefined
        }
        this.unitCellVals.clear()
        this.unitSectorWanted = undefined
        this.unitSectorBuilding = undefined
    }
    // TASK-1561: an empty unit sector cache (LIT_TILE squares, UNIT_SECTOR_BYTES, UNIT_SECTOR_PHONE_BYTES on a phone).
    newUnitSectorCache() {
        return new SectorCache({size: LIT_TILE, pad: 0, budget: this.unitSectorBudget()})
    }
    unitSectorBudget() {
        return typeof mobilePhone !== 'undefined' && mobilePhone ? UNIT_SECTOR_PHONE_BYTES : UNIT_SECTOR_BYTES
    }
    // What the units pass draws on cell (i, j), as litLayerSignature lists it, in out (its length returned; 0: nothing).
    unitCellValues(i, j, out) {
        const cell = this.arr[i][j], building = cell.building
        let n = 0
        if (isFogOfWar && !this.fogOfWar[i][j]) {
            if (!building.isDemonPortal)
                return 0
            const next = building.nextProduction
            out[n++] = 'fog'; out[n++] = building; out[n++] = building.killed; out[n++] = !!next; out[n++] = next?.type
            out[n++] = next?.roundsRemaining; out[n++] = cell.hexColor
            return n
        }
        if (!this.isOverlayCell(cell))
            return 0
        const unit = cell.unit
        out[n++] = unit; out[n++] = building; out[n++] = cell.hexColor; out[n++] = building.showsBar; out[n++] = building.hp
        out[n++] = building.wasHitted; out[n++] = building.killed; out[n++] = building.hasBar && building.hpBar ? building.hpIncrease : 0
        out[n++] = building.isBuildingProduction()
        if (building.isBuildingProduction())
            out[n++] = building.turns
        if (building.isPreparingManufacture) {
            const production = building.unitProduction
            out[n++] = production; out[n++] = production?.name; out[n++] = production?.turns
        }
        else if (building.isDemonPortal) {
            const next = building.nextProduction
            out[n++] = !!next; out[n++] = next?.type; out[n++] = next?.roundsRemaining
        }
        if (unit.notEmpty()) {
            out[n++] = unit.hp; out[n++] = unit.hpIncrease; out[n++] = unit.wasHitted; out[n++] = unit.moves
            out[n++] = unit.bodyImageName; out[n++] = shouldShowMovesBar(unit)
        }
        return n
    }
    // The cells of range (a drawRange) compared with the values kept for them (unitCellVals): every cell that draws otherwise
    // now dirties the unit sectors it reaches (its centre's box grown by drawRange's margin and a column) and keeps its new
    // values. Kept values change only here, and a sector is built only after its range was compared (buildUnitSector), so a
    // clean sector was drawn from the values kept for its cells.
    unitSectorCheck(range) {
        const h = this.arr[0].length, kept = this.unitCellVals, out = this.unitCellScratch ||= []
        const reach = 4 * basis.r + assets.size + basis.offset.x
        let boxes = null
        for (let i = range.i0; i < range.i1; ++i) {
            for (let j = range.j0; j < range.j1; ++j) {
                const n = this.unitCellValues(i, j, out), index = i * h + j, old = kept.get(index)
                if (!n && !old)
                    continue
                if (n && old && old.length === n) {
                    let same = true
                    for (let k = 0; k < n && same; ++k)
                        same = Object.is(old[k], out[k])
                    if (same)
                        continue
                }
                if (n)
                    kept.set(index, out.slice(0, n))
                else
                    kept.delete(index)
                const x = i * basis.offset.x, y = (2 * j + (i & 1)) * basis.offset.y
                ;(boxes ||= []).push({x: x - reach, y: y - reach, w: 2 * reach, h: 2 * reach})
            }
        }
        ++this.unitSectorWork.checks
        if (boxes)
            ++this.unitCellChanges
        if (boxes && this.unitSectors.entries.size)
            this.unitSectorWork.dirtied += this.unitSectors.dirtyCells(boxes).length
        if (boxes && this.unitSectorAlt?.cache.entries.size)
            this.unitSectorWork.dirtied += this.unitSectorAlt.cache.dirtyCells(boxes).length
    }
    // The stand-in a lit frame draws for a square without its tile (standIn: drawLitView's, true = the surface cache as it
    // matches, 'standin' = drawStandIn's source) as one object while what it draws from is the same.
    unitStandInToken(standIn) {
        const source = standIn === 'standin' ? this.standInSource() : 'exact'
        const parts = [source, this.surfaceCache, this.surfaceCacheShown, this.surfaceCacheRevision, this.cellLayerRevision,
            this.surfaceCacheBounds, source === 'preview' ? this.standInPreview : null, this.standInPreview?.canvas]
        const token = this.unitStandIn
        if (token && token.parts.every((v, k) => v === parts[k]))
            return token
        return this.unitStandIn = {parts, source, standIn: true}
    }
    // The device rectangle (identity transform) of square (u, v) on a cw x ch canvas, the grid placed at ox, oy; null off it.
    unitSquareRect(u, v, ox, oy, cw, ch) {
        const x0 = Math.max(0, u * LIT_TILE + ox), y0 = Math.max(0, v * LIT_TILE + oy)
        const x1 = Math.min(cw, (u + 1) * LIT_TILE + ox), y1 = Math.min(ch, (v + 1) * LIT_TILE + oy)
        return x0 < x1 && y0 < y1 ? {x: x0, y: y0, w: x1 - x0, h: y1 - y0} : null
    }
    // Why the surface cache is not drawn whole as the frame draws it, the light baked in (surfaceCacheSteady, but for a split
    // under way that holds: the frame draws the cache's raster uncut, drawSurfaceCache); null when it is.
    // TASK-1561: not for surfaceCacheDirty (the board not compared with the whole cache since a change): the frames draw the
    // cache while its captured state matches the board's (drawCacheSectors' surfaceStateMatches), and a patch or a new raster
    // changes the sectors' key (cacheSectorKey: the raster and its revision).
    cacheSectorUnsteady() {
        return !this.surfaceCache ? 'none' : !this.surfaceCacheLit ? 'unlit' : this.surfaceCacheBuild ? 'build' :
            this.surfacePatchJob ? 'patch' : this.surfaceLayerJob ? 'layer' :
            this.surfaceSplitJob && !this.surfaceSplitHolds(this.surfaceSplitJob) ? 'split' : null
    }
    // What the cache sectors' ground is drawn from (sceneLayerKey and the split under way, which draws the raster uncut).
    cacheSectorKey() {
        return [...this.sceneLayerKey(), !!this.surfaceSplitJob]
    }
    // The squares (u, v ranges) at level the board and its units can draw on: mapDepth.bounds and the surface cache's grown by
    // drawRange's margin.
    unitBoardSquares(level) {
        mapDepth.ensureGeometry(this)
        const b = mapDepth.bounds, c = this.surfaceCacheBounds, m = 4 * basis.r + assets.size
        let left = b.left, top = b.top, right = b.right, bottom = b.bottom
        if (c) {
            left = Math.min(left, c.left); top = Math.min(top, c.top)
            right = Math.max(right, c.left + c.width); bottom = Math.max(bottom, c.top + c.height)
        }
        return {u0: Math.floor((left - m) * level / LIT_TILE), u1: Math.floor((right + m) * level / LIT_TILE),
            v0: Math.floor((top - m) * level / LIT_TILE), v1: Math.floor((bottom + m) * level / LIT_TILE)}
    }
    // The clean sector (u, v) of plan whose ground is ground (a lit tile, null for none, or a stand-in token), else null.
    freshUnitSector(plan, u, v, ground) {
        const entry = this.unitSectors.get(SectorCache.key(plan.level, u, v))
        return entry && this.unitEntryFits(entry, plan) && entry.ground === ground ? entry : null
    }
    // TASK-1562: whether a unit sector entry is clean and of plan's kind (on the cache's path drawn over the cache the plan
    // draws: the same tag; the levels' key no longer holds it).
    unitEntryFits(entry, plan) {
        return !entry.dirty && entry.kind === plan.kind && (plan.kind !== 'cache' || sameKeyArray(entry.tag, plan.tag))
    }
    // The squares of view (a lit view's sector grid) its edge runs meet (drawLitEdges lights them after the tiles), kept with
    // the runs they were found for.
    unitEdgeSquares(view) {
        const kept = view.unitEdgeSquares
        if (kept && kept.edges === view.edges)
            return kept.squares
        const squares = new Set()
        for (const run of view.edges || []) {
            const u0 = Math.floor(run.x / LIT_TILE), u1 = Math.floor((run.x + run.w - 1) / LIT_TILE)
            const v0 = Math.floor(run.y / LIT_TILE), v1 = Math.floor((run.y + run.h - 1) / LIT_TILE)
            for (let v = v0; v <= v1; ++v)
                for (let u = u0; u <= u1; ++u)
                    squares.add(u + ',' + v)
        }
        view.unitEdgeSquares = {edges: view.edges, squares}
        return squares
    }
    // TASK-1561: the cell texts drawCellText would draw on range now (a drawRange, or a list of them: their cells, each once),
    // in its order, as copies (the info texts are emptied once drawn): a unit sector build draws them later, a few a task
    // (buildUnitSector); drawLiveSectorUnits after the live rectangles' units. The info texts of those cells are cleared, as
    // drawCellText clears them (with debug none is drawn). (A unit sector frame has no logic texts or level of detail:
    // unitSectorPlan.)
    sectorCellTexts(range, boxes = null, pad = 0) {
        const texts = this.collectCellTexts(range)
        return boxes ? texts.filter(text => this.textMeets(text, boxes, pad)) : texts
    }
    // TASK-1561: whether text (a CoordText: drawn centred on its position, textAlign center, textBaseline middle) can paint
    // within one of boxes (board space {left, top, right, bottom}): its box, at most UNIT_TEXT_EM_WIDTH of its font size a
    // character wide and UNIT_TEXT_EM_HEIGHT high, grown by its outline and pad (board units), meets one. Another text: true.
    textMeets(text, boxes, pad) {
        const fontSize = text.fontSize, pos = text.pos
        if (!(fontSize > 0) || !pos || typeof text.text !== 'string' && typeof text.text !== 'number')
            return true
        const grow = (text.strokeWidth || 0) + pad
        const hw = UNIT_TEXT_EM_WIDTH * String(text.text).length * fontSize / 2 + grow, hh = UNIT_TEXT_EM_HEIGHT * fontSize / 2 + grow
        return boxes.some(b => pos.x + hw > b.left && pos.x - hw < b.right && pos.y + hh > b.top && pos.y - hh < b.bottom)
    }
    collectCellTexts(range) {
        const ranges = Array.isArray(range) ? range : [range]
        const within = (i, j) => ranges.some(r => i >= r.i0 && i < r.i1 && j >= r.j0 && j < r.j1)
        const texts = [], h = this.arr[0].length
        if (debug) {
            const i0 = Math.min(...ranges.map(r => r.i0)), i1 = Math.max(...ranges.map(r => r.i1))
            const j0 = Math.min(...ranges.map(r => r.j0)), j1 = Math.max(...ranges.map(r => r.j1))
            for (let i = i0; i < i1; ++i)
                for (let j = j0; j < j1; ++j)
                    if (!this.arr[i][j].building.isMapEdge && (ranges.length === 1 || within(i, j)))
                        texts.push(this.arr[i][j].coordText)
            for (const index of [...this.infoTextCells]) {
                const i = Math.floor(index / h), j = index % h
                if (within(i, j)) {
                    this.arr[i][j].infoText.text = ''
                    this.infoTextCells.delete(index)
                }
            }
            return texts
        }
        if (!this.infoTextCells.size)
            return texts
        for (const index of [...this.infoTextCells].sort((a, b) => a - b)) {
            const i = Math.floor(index / h), j = index % h
            if (!within(i, j))
                continue
            const cell = this.arr[i][j], text = cell.infoText
            if (!cell.building.isMapEdge && !(isFogOfWar && !this.fogOfWar[i][j] && !fogShowsPortalPreview(cell.building)) &&
                    text.text != '')
                texts.push(typeof text.spriteCopy === 'function' ? text.spriteCopy() : Object.assign(Object.create(Object.getPrototypeOf(text)), text))
            text.text = ''
            this.infoTextCells.delete(index)
        }
        return texts
    }
    // TASK-1561: texts (sectorCellTexts) drawn on ctx from the index from on, all of them, or (calls: {n, max}, the draw calls
    // a build task made and may make) while calls.n < calls.max. Returns the index of the first text not drawn.
    drawSectorTexts(ctx, texts, from, calls) {
        let k = from
        while (k < texts.length && (!calls || calls.n < calls.max))
            texts[k++].draw(ctx)
        return k
    }
    // TASK-1561: the frame's overlay sectors ({entry, x, y}: the units pass and cell texts of a square whose ground the frame
    // drew live) drawn over that ground at their squares' places.
    drawUnitOverlays(ctx, overlays) {
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        for (const o of overlays)
            this.drawUnitSectorAt(ctx, o.entry, o.x, o.y)
        ctx.restore()
        this.unitSectorWork.overlaysDrawn += overlays.length
    }
    // A frame's sector drawn whole at its square's place (identity transform).
    drawUnitSectorAt(ctx, entry, x, y) {
        // TASK-1565: a sector built on a stand-in's ground (unitStandInToken) is the stand-in under its units.
        if (entry.ground?.standIn)
            this.drawStandInSector(ctx, entry.image, x, y)
        else
            ctx.drawImage(entry.image, x, y)
        this.unitSectors.use(entry.key)
        ++this.unitSectorWork.drawn
        this.countLevelDraws(1)
    }
    // TASK-1565: the whole sector of square (u, v) of plan units made from its built tile and its overlay sector (over): the
    // tile's quarters, then the overlay, on a sector canvas (as a frame draws them there), stored as the square's sector on that
    // tile (the overlay's kind, tag and epoch). Null when the board is not the one in play.
    composeUnitSector(units, u, v, tile, over) {
        if (this !== grid || typeof document === 'undefined')
            return null
        const c = this.aheadComposed?.serial === this.drawSerial ? this.aheadComposed : this.aheadComposed = {serial: this.drawSerial, n: 0}
        ++c.n
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = LIT_TILE
        const g = canvas.getContext('2d')
        this.drawLitTileAt(g, tile, 0, 0, LIT_TILE, LIT_TILE)
        g.drawImage(over.image, 0, 0)
        ++this.aheadWork.composed
        return this.storeUnitSector(units.level, u, v, canvas, tile, over.kind, over.tag, over.epoch)
    }
    // TASK-1565: a unit sector on a stand-in's ground drawn (visualsPerf counts it as stand-in pixels, 'sector-standin').
    drawStandInSector(ctx, image, x, y) {
        ctx.drawImage(image, x, y)
    }
    // TASK-1562: the sector copies the frame being drawn made (levelDraws: its draw calls the level budget leaves room for).
    countLevelDraws(n) {
        const d = this.levelDraws ||= {serial: -1, n: 0}
        if (d.serial !== this.drawSerial) {
            d.serial = this.drawSerial
            d.n = 0
        }
        d.n += n
    }
    // TASK-1562 (SECTORS 6/11): ZOOM LEVELS (Grid.zoomLevels). The unit sectors (the board picture of a square: its ground,
    // units, bars and cell texts) of every level the camera rested or panned at are kept (the key holds no scale:
    // unitSectorPlan), so
    //   - a zoom gesture's frame (drawZoomSectors, instead of the zoom raster: nothing captured, replayed or rebuilt) draws the
    //     board from the sectors kept, each level's stretched to the camera (drawStretchedSectors: per square of the frame's
    //     level the best level that covers it whole, the next finer first, downscaled, then the next coarser), over the
    //     surface cache (or its stand-in preview) for what no sector covers, as the raster's frames did past the raster;
    //   - after the gesture (levelSettle) the frames draw the squares on the canvas from the sectors of the camera's level
    //     where clean ones are (with the ground they were built on: an exact-level sector on the stand-in until it is built
    //     again on its tile), else stretched from another level, else live as a pan frame does; the sectors of the camera's
    //     level are built between frames, the canvas's first (nearest its centre), within LEVEL_FRAME_CALLS draw calls a
    //     frame (levelWorkLeft: the tasks between two frames together; a frame's live cost bursts as a pan's does), so the
    //     stretched squares are replaced one by one; then (sectorRest) the frames at rest draw the sectors (no rest snapshot,
    //     no live units) until the camera pans;
    //   - the lit tiles of the new level are built a step at a time within the same frame budget (LEVEL_TILE_STEPS).
    // levelCoverage: the squares of the last frame drawn at the camera's level (exact) and not (stretched; bare: none
    // covers it, live). Grid.zoomLevels false: as before (the zoom raster, sectors released on a zoom).
    // Whether this board's frames draw the levels (zoom frames and the frames after them).
    // (Grid.zoomRasters false: the gesture's frames drawn as any frame, no levels either.)
    levelsOn() {
        return !!(Grid.zoomLevels && Grid.zoomRasters && Grid.unitSectors && this.unitSectors && this === grid && otherSettings.atmosphericVisuals &&
            typeof mainCanvas !== 'undefined')
    }
    // Whether ctx's frame is one after a zoom drawn on the levels (levelSettle or sectorRest), the camera not panning.
    levelMode(ctx) {
        if (!this.levelsOn() || ctx && ctx.canvas !== mainCanvas || !(this.levelSettle || this.sectorRest))
            return false
        const screen = gameEvent.screen
        // A pan ends the frames at rest on the sectors but within ZOOM_QUIET_MS of the zoom; a settle goes on through it (its
        // squares stretched, not live, its builds within the frames' budget) until done or LEVEL_SETTLE_MS after the zoom.
        if (this.levelSettle && performance.now() - this.levelSettle.since > LEVEL_SETTLE_MS)
            this.endLevels('timeout')
        if (!this.levelSettle && performance.now() >= this.zoomQuietUntil && (performance.now() < screen.surfacePanUntil || screen.surfacePanFrames > 0)) {
            this.endLevels('pan')
            return false
        }
        // The settle done and the zoom's quiet over, the frames at rest are drawn as before (the rest snapshot at the camera's
        // exact offset: a sector is composited at the offset rounded to whole device pixels, up to half a pixel off).
        if (!this.levelSettle && performance.now() >= this.zoomQuietUntil) {
            this.endLevels('rest')
            return false
        }
        return !!(this.levelSettle || this.sectorRest) && !screen.zoomGesture
    }
    // TASK-1574: the main canvas frame's camera (frameView), for the swap counters of render/visualsPerf.js.
    noteFrameView(ctx) {
        if (this !== grid || typeof mainCanvas === 'undefined' || ctx.canvas !== mainCanvas)
            return
        const t = ctx.getTransform()
        this.frameView = {serial: this.drawSerial, level: t.a, ox: Math.round(t.e), oy: Math.round(t.f), cw: ctx.canvas.width, ch: ctx.canvas.height}
    }
    endLevels(why) {
        if (this.levelSettle || this.sectorRest) {
            this.levelWork.ends[why] = (this.levelWork.ends[why] || 0) + 1
            // (TASK-1562: a still frame held from a level frame is not the rest path's picture: the next frame draws it.)
            this.dropHeldFrame()
        }
        this.levelSettle = this.sectorRest = undefined
    }
    // Whether entry can be drawn stretched (at another level than it was built for): clean, and its ground still the board's
    // (a cache sector's the cache's now: its tag; a lit tile's or stand-in's not changed by the board since: unitGroundEpoch);
    // an overlay holds no ground.
    stretchable(entry) {
        if (entry.dirty || !entry.image)
            return false
        if (entry.kind === 'cache')
            return entry.ground === UNIT_OVERLAY || sameKeyArray(entry.tag, this.cacheSectorKey())
        return entry.epoch === this.unitGroundEpoch && !(entry.ground?.parts && entry.ground.parts[4] !== this.cellLayerRevision)
    }
    // The levels of the kept sectors that can stand in at level (not level itself), best first: the finer ones (the next finer
    // first: downscaled), then the coarser (the next coarser first, magnified at most LEVEL_MAX_MAGNIFY); at most LEVEL_SOURCES.
    // {levels, by: level -> entries}.
    stretchSources(level, t, cw, ch, withLevel = false) {
        const by = new Map()
        for (const entry of this.unitSectors.entries.values()) {
            // A level magnified more than LEVEL_MAX_MAGNIFY is left to the underlay (a sector magnified 9x covered ~5 MP of
            // the frame: a software canvas took ~1 s for a few of them).
            if (entry.level === level && !withLevel || level > entry.level * LEVEL_MAX_MAGNIFY || !this.stretchable(entry))
                continue
            const k = t.a / entry.level, x = entry.u * LIT_TILE * k + t.e, y = entry.v * LIT_TILE * k + t.f, w = LIT_TILE * k
            if (x >= cw || y >= ch || x + w <= 0 || y + w <= 0)
                continue
            let list = by.get(entry.level)
            if (!list)
                by.set(entry.level, list = new Map())
            list.set(entry.u + ',' + entry.v, entry)
        }
        const keys = [...by.keys()]
        const levels = keys.filter(l => l === level).concat(keys.filter(l => l > level).sort((a, b) => a - b),
            keys.filter(l => l < level).sort((a, b) => b - a))
        return {levels: levels.slice(0, LEVEL_SOURCES), by}
    }
    // Which of squares (u, v at level) the levels of src (stretchSources) cover whole: {covered: Set of 'u,v', need: Map of the
    // sectors to draw for them}, each square from the best level that covers it whole. partial: the squares none covers whole
    // get every level's sectors meeting them (need) too.
    stretchCover(level, squares, src, partial = false) {
        const covered = new Set(), need = new Map()
        for (const {u, v} of squares) {
            const x0 = u * LIT_TILE / level, y0 = v * LIT_TILE / level, x1 = (u + 1) * LIT_TILE / level, y1 = (v + 1) * LIT_TILE / level
            let found = null
            for (const L of src.levels) {
                const map = src.by.get(L), s = LIT_TILE / L
                const su0 = Math.floor(x0 / s + 1e-6), su1 = Math.ceil(x1 / s - 1e-6) - 1
                const sv0 = Math.floor(y0 / s + 1e-6), sv1 = Math.ceil(y1 / s - 1e-6) - 1
                const list = []
                let whole = true
                for (let sv = sv0; sv <= sv1 && whole; ++sv)
                    for (let su = su0; su <= su1; ++su) {
                        const e = map.get(su + ',' + sv)
                        if (!e) {
                            whole = false
                            break
                        }
                        list.push(e)
                    }
                if (whole) {
                    found = list
                    break
                }
            }
            if (found) {
                covered.add(u + ',' + v)
                for (const e of found)
                    need.set(e.key, e)
                continue
            }
            if (!partial)
                continue
            // The best level with a sector meeting the square: its sectors there.
            for (const L of src.levels) {
                const map = src.by.get(L), s = LIT_TILE / L
                let any = false
                for (let sv = Math.floor(y0 / s + 1e-6); sv <= Math.ceil(y1 / s - 1e-6) - 1; ++sv)
                    for (let su = Math.floor(x0 / s + 1e-6); su <= Math.ceil(x1 / s - 1e-6) - 1; ++su) {
                        const e = map.get(su + ',' + sv)
                        if (e) {
                            need.set(e.key, e)
                            any = true
                        }
                    }
                if (any)
                    break
            }
        }
        // At most LEVEL_MAX_DRAWS sectors (the worst levels' left out first): a Chromium canvas rasterizes inside the frame
        // once the images drawn into it pass ~32 MB (LIT_TILE squares: 256 KB each).
        if (need.size > LEVEL_MAX_DRAWS) {
            const rank = new Map(src.levels.map((L, k) => [L, k]))
            const kept = [...need.values()].sort((p, q) => rank.get(p.level) - rank.get(q.level)).slice(0, LEVEL_MAX_DRAWS)
            need.clear()
            for (const e of kept)
                need.set(e.key, e)
        }
        return {covered, need}
    }
    // Draws on ctx (frame at transform t, canvas cw x ch, the sectors' grid at ox, oy) the sectors cover.need (stretchCover),
    // clipped to squares (all: the whole canvas), over the surface cache or its stand-in preview (drawLevelUnderlay), the
    // levels of src worst first.
    drawStretchedSectors(ctx, t, squares, src, cover, cw, ch, ox, oy, all = false) {
        ctx.save()
        if (!all)
            clipToDeviceRects(ctx, squares.map(({u, v}) => this.unitSquareRect(u, v, ox, oy, cw, ch)).filter(Boolean))
        ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f)
        this.drawLevelUnderlay(ctx)
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        const order = [...src.levels].reverse()
        const list = [...cover.need.values()].sort((p, q) => order.indexOf(p.level) - order.indexOf(q.level))
        for (const e of list) {
            const k = t.a / e.level
            ctx.drawImage(e.image, e.u * LIT_TILE * k + t.e, e.v * LIT_TILE * k + t.f, LIT_TILE * k, LIT_TILE * k)
            this.unitSectors.use(e.key)
        }
        ctx.restore()
        this.levelWork.stretchedDrawn += list.length
        this.countLevelDraws(list.length + 2)
    }
    // What a level frame draws under its stretched sectors and where none is: the surface cache (with its cell layer) where
    // it meets the view, else the stand-in preview (drawZoomUnderlay).
    drawLevelUnderlay(ctx) {
        this.drawZoomUnderlay(ctx)
    }
    // TASK-1562: a level frame's plan (plan: the unit sector plan at the camera's level, the sectors' grid at ox, oy): its
    // squares, the other levels to stretch (src) and the squares they cover whole (cover), the squares it stretches (stretch).
    levelPlan(plan, t, cw, ch, ox, oy) {
        const squares = this.levelSquares(plan.level, cw, ch, ox, oy)
        const src = this.stretchSources(plan.level, t, cw, ch)
        // first: the squares drawn live, built first (queueUnitSectors: a burst ends them).
        const lv = {plan, squares, src, cover: this.stretchCover(plan.level, squares, src), stretch: [], held: [], standIn: 0, old: 0, first: new Set()}
        plan.first = lv.first
        return lv
    }
    // The clean sector (u, v) of plan's level and kind whatever its ground (not an overlay; the cache's path: its own
    // cache), for a square whose sector is built again.
    levelAnySector(plan, u, v) {
        const entry = this.unitSectors.get(SectorCache.key(plan.level, u, v))
        return entry && entry.ground !== UNIT_OVERLAY && this.stretchable(entry) ? entry : null
    }
    // The squares lv stretches drawn (their own sectors only, clipped to them).
    drawLevelStretch(ctx, t, lv, cw, ch, ox, oy) {
        if (!lv.stretch.length)
            return
        this.drawStretchedSectors(ctx, t, lv.stretch, lv.src, this.stretchCover(lv.plan.level, lv.stretch, lv.src), cw, ch, ox, oy)
    }
    // TASK-1572 (Grid.settleHoldsLevels): within SETTLE_HOLD_MS of a zoom gesture's last frame (levelSettle.since) a settle
    // frame's squares no sector of the camera's level (nor an overlay) and no other level covers whole are drawn as the
    // gesture's frames drew them (drawStretchedSectors' partial cover: the levels' sectors meeting them over the underlay),
    // not with their units and texts live (16-62 squares, 550-3200 calls in each of the settle's first 2-3 frames on the
    // desktop capture), while their sectors are built between frames (queueUnitSectors: first; with the Worker timed, not a
    // burst: no live cost). Past the hold they are drawn live as before. False: as fa72a557.
    settleHoldOn() {
        return !!(Grid.settleHoldsLevels && this.levelSettle && performance.now() - this.levelSettle.since < Grid.SETTLE_HOLD_MS)
    }
    drawLevelHeld(ctx, t, lv, cw, ch, ox, oy) {
        if (!lv.held.length)
            return
        this.drawStretchedSectors(ctx, t, lv.held, lv.src, this.stretchCover(lv.plan.level, lv.held, lv.src, true), cw, ch, ox, oy)
        this.levelWork.heldSquares += lv.held.length
        ++this.levelWork.heldFrames
    }
    // A level frame's coverage (levelCoverage); with no square stretched or live the settle is over: the frames at rest
    // draw the sectors (sectorRest) until the camera pans or zooms.
    levelFrameEnd(lv, live, kind) {
        const total = lv.squares.length, stretched = lv.stretch.length + lv.held.length
        // standIn: squares drawn on the stand-in's ground (no tile yet); old: from a sector of the level on an older ground.
        this.levelCoverage = {serial: this.drawSerial, mode: this.levelSettle ? 'settle' : 'rest', kind, level: lv.plan.level, total,
            exact: total - stretched, stretched, bare: live, live, standIn: kind === 'standin' ? total - stretched : lv.standIn, old: lv.old}
        // TASK-1574: the frame's stretched and held squares (the others drawn at the camera's level: sectors or live).
        this.squareStates = {serial: this.drawSerial, mode: this.levelCoverage.mode, level: lv.plan.level, squares: lv.squares,
            stretch: lv.stretch, held: lv.held, fading: null}
        if (this.levelSettle) {
            ++this.levelWork.settleFrames
            if (!stretched && !live) {
                this.levelSettle = undefined
                ++this.levelWork.settled
                // On the lit path the frames at rest go on drawing the sectors while the zoom's quiet lasts (the rest path
                // would build the rest snapshot's bands and draw the units live in it); so do they with debug on (no still
                // frame holds a debug frame, stillFrameCandidate: each would draw every unit and coordinate text live).
                // Elsewhere (the surface cache's path: the cache and the units, held as a still frame from the next frame)
                // they are drawn as before at once.
                if (kind === 'lit' || debug)
                    this.sectorRest = {since: performance.now()}
                else
                    this.endLevels('done')
            }
        }
        else
            ++this.levelWork.restFrames
    }
    // TASK-1562: a level frame on the lit path whose view at the camera's scale is not made yet (planLitView's stand-in plan:
    // its light map or view made by tasks): the stand-in (the surface cache magnified, else its preview) under the squares,
    // drawn from the sectors of the camera's level built on that stand-in (or another ground), else stretched, else live.
    // Returns whether it drew the surface and units (Grid.draw then draws the live squares' units: unitFrame).
    // On the surface cache's path with no cache yet (a new game's first build), its stand-in preview likewise.
    // TASK-1562: a pan there (no cache yet) too, as a pan on the lit tiles draws its missing tiles' stand-in from sectors.
    drawLevelStandIn(ctx) {
        const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
        const levels = this.levelMode(ctx)
        // TASK-1572 (Grid.litFillOverlays): at or below the cache's scale without a cache to draw (none, or one not matching the
        // board while the camera moves: drawSurfaceCache), outside a zoom gesture, the frame draws the lit view (drawMapSurface,
        // TASK-1571): while that view is not made its ground fill is drawn here as the lit path's (the sectors of the camera's
        // level on an exact ground, else overlay sectors), not with every unit and text live.
        const noCache = !this.surfaceCache || !!screen?.surfaceMoving && !this.surfacePatchJob && !this.surfaceStateMatches(ctx)
        const litFill = Grid.litFillOverlays && Grid.litGroundFill && noCache && this === grid && otherSettings.atmosphericVisuals &&
            !(Grid.standInsInGesture && Grid.zoomGestureNow()) && this.canUseSurfaceCache()
        const pan = !levels && this.levelsOn() && ctx.canvas === mainCanvas && !!screen?.surfaceMoving && !screen.zoomGesture &&
            !screen.surfaceZooming && this.canUseSurfaceCache() && (!this.surfaceCache || litFill)
        if (!levels && !pan)
            return false
        const t = ctx.getTransform()
        let standIn, viewPending = false
        if (this.canUseSurfaceCache() && !litFill) {
            // TASK-1571 (Grid.standInsInGesture): the preview only in a zoom gesture.
            if (this.surfaceCache || !this.standInPreviewFits() || Grid.standInsInGesture && !Grid.zoomGestureNow())
                return false
            standIn = 'standin'
        }
        else {
            viewPending = true
            let plan = this.litPlan
            if (plan === undefined || plan && (plan.t.a !== t.a || plan.t.d !== t.d || plan.t.e !== t.e || plan.t.f !== t.f))
                plan = this.litPlan = this.planLitView(ctx)
            if (!plan || !plan.cache && !plan.fill)
                return false
            // TASK-1571 (Grid.litGroundFill): no stand-in: the ground fill under the squares (plan.fill), the sectors of the
            // camera's level on an exact ground or stretched over it, else the units live over the fill.
            standIn = plan.fill ? 'fill' : this.litStandIn(ctx) || !!this.standInSource() && 'standin'
        }
        if (!standIn)
            return false
        // Kind 'standin': the units drawn as the frame drawing the stand-in draws them (drawStillUnits + drawEntityOverlays).
        // TASK-1562: on the lit path (the view of the camera's level pending) kind 'lit' on the stand-in's ground: the sectors
        // the lit frames build for their squares without a tile (drawLitView's stand-in squares: the same token, ground and
        // units pass, drawOther), so those frames draw these as they are instead of building every square again.
        const units = this.unitSectorPlan(ctx, viewPending ? 'lit' : 'standin', levels)
        if (!units)
            return false
        this.litPlan = undefined
        const fill = standIn === 'fill'
        units.standIn = fill ? undefined : standIn
        units.token = fill ? null : this.unitStandInToken(standIn)
        units.noView = true
        const cw = ctx.canvas.width, ch = ctx.canvas.height, ox = Math.round(t.e), oy = Math.round(t.f)
        this.unitSectorCheck(this.drawRange(ctx))
        const range = this.litTileRange(cw, ch, ox, oy, 0), board = this.unitBoardSquares(units.level)
        const lv = this.levelPlan(units, t, cw, ch, ox, oy)
        const hold = levels && this.settleHoldOn()
        // The stand-in under every square (the sectors are opaque where the board is).
        if (fill)
            this.drawGroundFill(ctx, [{x: 0, y: 0, w: cw, h: ch}])
        else if (standIn === 'standin')
            this.drawStandIn(ctx)
        else
            this.drawSurfaceCache(ctx)
        const live = [], wanted = [], overlays = [], upgrades = []
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        for (const {u, v} of lv.squares) {
            // TASK-1571: over the fill only a sector on an exact ground (none built on a stand-in's).
            const any = this.levelAnySector(units, u, v)
            const entry = !fill && this.freshUnitSector(units, u, v, units.token) || (any && !(fill && any.ground?.standIn) ? any : null)
            if (entry) {
                this.drawUnitSectorAt(ctx, entry, u * LIT_TILE + ox, v * LIT_TILE + oy)
                if (entry.ground !== units.token)
                    wanted.push({u, v})
                continue
            }
            const over = this.freshUnitSector(units, u, v, UNIT_OVERLAY)
            const r = this.unitSquareRect(u, v, ox, oy, cw, ch)
            ;(over ? upgrades : wanted).push({u, v})
            if (over)
                overlays.push({entry: over, x: u * LIT_TILE + ox, y: v * LIT_TILE + oy})
            else if (r && lv.cover.covered.has(u + ',' + v))
                lv.stretch.push({u, v})
            else if (r && hold) {
                lv.held.push({u, v})
                lv.first.add(u + ',' + v)
            }
            else if (r) {
                live.push(r)
                lv?.first.add(u + ',' + v)
            }
        }
        ctx.restore()
        this.drawLevelStretch(ctx, t, lv, cw, ch, ox, oy)
        this.drawLevelHeld(ctx, t, lv, cw, ch, ox, oy)
        this.litFrame = undefined
        this.unitFrame = {kind: 'standin', live, overlays, plan: units}
        // TASK-1571: none built on the fill (the lit view's frames build them on its tiles).
        // TASK-1572 (Grid.litFillOverlays): but overlay sectors (units and texts on a transparent canvas: unitSectorGround gives
        // the fill's squares no other ground), so the units are not drawn live in every frame while the view is made.
        if (!fill || Grid.litFillOverlays)
            this.queueUnitSectors(units, wanted, range, board, cw, ch, ox, oy, upgrades)
        if (levels)
            this.levelFrameEnd(lv, live.length, 'standin')
        return true
    }
    // The squares (u, v at the frame's level) on a cw x ch canvas with the sectors' grid at ox, oy, within the board's.
    levelSquares(level, cw, ch, ox, oy) {
        const range = this.litTileRange(cw, ch, ox, oy, 0), board = this.unitBoardSquares(level), out = []
        for (let v = Math.max(range.v0, board.v0); v <= Math.min(range.v1, board.v1); ++v)
            for (let u = Math.max(range.u0, board.u0); u <= Math.min(range.u1, board.u1); ++u)
                out.push({u, v})
        return out
    }
    // TASK-1562: a zoom gesture's frame drawn from the levels (instead of drawZoomRaster): the sky, the slab's shadow, then the
    // board from the kept sectors of every level, stretched to the camera (over the surface cache or the stand-in preview),
    // the selection's raster. Nothing is built (the unit sector tasks refuse zoom gestures). False when the frame is not one.
    drawZoomSectors(ctx) {
        const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
        if (!this.levelsOn() || !screen?.zoomGesture || zoomRasterTweens() || ctx.canvas !== mainCanvas)
            return false
        const t = ctx.getTransform(), cw = ctx.canvas.width, ch = ctx.canvas.height
        if (t.b !== 0 || t.c !== 0 || !(t.a > 0) || t.a !== t.d || !this.arr.length)
            return false
        ++this.drawSerial
        this.noteFrameView(ctx)
        this.zoomRaster = undefined
        if (!atmosphericBackground.opaqueOver(ctx))
            ctx.clearRect(canvas.offset.x, canvas.offset.y, width, height)
        atmosphericBackground.draw(ctx)
        drawBackgroundHints(ctx)
        this.coverOpen = undefined
        this.drawSlabShadow(ctx)
        // (The cells are not compared in the gesture: its frames show the sectors as they were, as the zoom raster showed
        // the frame before it; the frames after it compare them.)
        this.lod = false
        if (this.unitSectorSerial !== this.drawSerial) {
            this.unitSectorSerial = this.drawSerial
            this.unitSectors.beginFrame()
        }
        const level = t.a, ox = Math.round(t.e), oy = Math.round(t.f)
        const squares = this.levelSquares(level, cw, ch, ox, oy)
        // The camera's own level drawn as the others (at the exact offset t.e, t.f).
        const src = this.stretchSources(level, t, cw, ch, true)
        const cover = this.stretchCover(level, squares, src, true)
        this.drawStretchedSectors(ctx, t, squares, src, cover, cw, ch, ox, oy, true)
        this.levelCoverage = {serial: this.drawSerial, mode: 'zoom', level, total: squares.length, exact: 0,
            stretched: cover.covered.size, bare: squares.length - cover.covered.size, live: 0}
        // TASK-1574: every square of a zoom frame is a scaled picture (stretched levels or the underlay), none exact.
        this.squareStates = {serial: this.drawSerial, mode: 'zoom', level, squares, stretch: squares, held: [], fading: null}
        ++this.levelWork.zoomFrames
        // The frames after the gesture: drawn on the levels until the camera's level is built (levelSettle).
        this.levelSettle = {since: performance.now(), level: null}
        this.sectorRest = undefined
        this.zoomQuietUntil = performance.now() + ZOOM_QUIET_MS
        SelectionOverlay.drawSelection(ctx)
        this.dropHeldFrame()
        this.prepareSurfaceCache()
        this.countGestureFrame()
        return true
    }
    // The units pass and info texts of the frame's live squares (frame: unitFrame, or a lit frame's units), clipped to them;
    // then what the skipped units pass does besides drawing (a selected demon portal's panel kept current).
    drawLiveSectorUnits(ctx, frame) {
        if (frame.overlays?.length)
            this.drawUnitOverlays(ctx, frame.overlays)
        const live = frame.live
        if (live.length) {
            // TASK-1561: the live squares as disjoint rectangles (squares joined in rows and the rows alike joined), each
            // drawn with its own cells (drawRange of the rectangle), clipped to it: a cell reaching two is drawn in each, a
            // part a clip (the bounding box of every live square drew every cell in it). The cell texts after all of them,
            // once each (the cells of any rectangle's range), clipped to the live squares.
            const t = ctx.getTransform(), rects = disjointDeviceRects(live), ranges = []
            for (const r of rects) {
                const transform = {a: t.a, b: 0, c: 0, d: t.d, e: t.e - r.x, f: t.f - r.y}
                const range = this.drawRange({getTransform: () => transform, canvas: {width: r.w, height: r.h}})
                ranges.push(range)
                ctx.save()
                clipToDeviceRects(ctx, [r])
                ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f)
                if (frame.kind === 'lit')
                    this.drawOther(ctx, 'units', range)
                else {
                    const h = this.arr[0].length
                    // TASK-1562: a stand-in level frame's: every cell the pass draws on (unitCellVals, compared this frame).
                    const cells = frame.kind === 'standin' ? [...this.unitCellVals.keys()].filter(k => {
                        const i = Math.floor(k / h), j = k - i * h
                        return i >= range.i0 && i < range.i1 && j >= range.j0 && j < range.j1
                    }).sort((p, q) => p - q) : this.surfaceOverlayCells.filter(k => {
                        const i = Math.floor(k / h), j = k - i * h
                        return i >= range.i0 && i < range.i1 && j >= range.j0 && j < range.j1
                    })
                    this.drawStillUnits(ctx, cells)
                    this.drawEntityOverlays(ctx, cells)
                }
                ctx.restore()
            }
            const texts = this.sectorCellTexts(ranges, live.map(r => ({left: (r.x - t.e) / t.a, right: (r.x + r.w - t.e) / t.a,
                top: (r.y - t.f) / t.d, bottom: (r.y + r.h - t.f) / t.d})), UNIT_TEXT_PAD / t.a)
            // The live drawing's cost in draw calls, about: UNIT_SECTOR_CELL_CALLS a cell the units pass draws, a text each.
            const h = this.arr[0].length
            let cells = 0
            for (const r of ranges)
                for (let i = r.i0; i < r.i1; ++i)
                    for (let j = r.j0; j < r.j1; ++j)
                        if (this.unitCellVals.has(i * h + j))
                            ++cells
            frame.liveCost = cells * UNIT_SECTOR_CELL_CALLS + texts.length
            if (texts.length) {
                ctx.save()
                clipToDeviceRects(ctx, live)
                ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f)
                this.drawSectorTexts(ctx, texts, 0, null)
                ctx.restore()
            }
            this.unitSectorWork.live += live.length
        }
        const portal = gameEvent.selected
        if (portal?.isDemonPortal && !portal.killed && portal.nextProduction && this.arr[portal.coord.x]?.[portal.coord.y]?.building === portal &&
                (!isFogOfWar || this.fogOfWar[portal.coord.x][portal.coord.y] || fogShowsPortalPreview(portal)))
            entityInterface.refreshPortal(portal)
        ++this.unitSectorWork.frames
    }
    // TASK-1561: a frame with the camera at rest (Grid.unitSectorsAtRest) has the unit sectors of its squares on the canvas
    // and the ring round it built between frames, so a pan starting there finds them: on the surface cache's path whole (the
    // cache under the units), on the lit tiles' as overlays (unitSectorGround: the view the pan draws is not made yet). The
    // cells in view are compared first (unitSectorCheck). It draws nothing.
    restUnitSectors(ctx) {
        const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
        if (!Grid.unitSectorsAtRest || !screen || screen.surfaceMoving || screen.zoomGesture || screen.surfaceZooming ||
                this.zoomBoardPass || !otherSettings.atmosphericVisuals || this.levelMode(ctx))
            return
        // TASK-1572 (Grid.litFillOverlays): at or below the cache's scale without a cache the frames draw the lit view
        // (drawMapSurface, drawLevelStandIn's litFill): its sectors then, as the lit path's.
        const litFill = Grid.litFillOverlays && Grid.litGroundFill && !this.surfaceCache && this === grid
        const kind = this.canUseSurfaceCache() && !litFill ? 'cache' : 'lit'
        if (kind === 'cache' && (this.cacheSectorUnsteady() || !this.surfaceStateMatches(ctx) || !this.surfaceCellLayerHolds()))
            return
        const cw = ctx.canvas.width, ch = ctx.canvas.height
        const plan = this.unitSectorPlan(ctx, kind, true)
        if (!plan)
            return
        const t = plan.t, ox = Math.round(t.e), oy = Math.round(t.f)
        const range = this.litTileRange(cw, ch, ox, oy, 0), board = this.unitBoardSquares(plan.level)
        this.unitSectorCheck(this.drawRange(ctx))
        const wanted = []
        for (let v = Math.max(range.v0, board.v0); v <= Math.min(range.v1, board.v1); ++v)
            for (let u = Math.max(range.u0, board.u0); u <= Math.min(range.u1, board.u1); ++u) {
                const entry = this.unitSectors.get(SectorCache.key(plan.level, u, v))
                if (!entry || !this.unitEntryFits(entry, plan))
                    wanted.push({u, v})
            }
        this.queueUnitSectors(plan, wanted, range, board, cw, ch, ox, oy)
    }
    // TASK-1560: a pan frame far out on the surface cache's path (drawn whole at or below its scale, the light baked in) draws
    // the cache and the units from the unit sectors (live squares as before, clipped). Returns whether it drew the surface
    // and the units (the frame then draws neither again).
    drawCacheSectors(ctx) {
        if (!Grid.unitSectors || !otherSettings.atmosphericVisuals || !this.canUseSurfaceCache())
            return false
        const refuse = reason => {
            this.unitSectorRefusals['cache:' + reason] = (this.unitSectorRefusals['cache:' + reason] || 0) + 1
            return false
        }
        const unsteady = this.cacheSectorUnsteady()
        if (unsteady)
            return refuse(unsteady)
        const levels = this.levelMode(ctx)
        const plan = this.unitSectorPlan(ctx, 'cache', levels)
        if (!plan)
            return false
        if (!this.surfaceStateMatches(ctx) || !this.surfaceCellLayerHolds())
            return refuse('state')
        const t = plan.t, cw = ctx.canvas.width, ch = ctx.canvas.height
        const ox = Math.round(t.e), oy = Math.round(t.f)
        this.unitSectorCheck(this.drawRange(ctx))
        const range = this.litTileRange(cw, ch, ox, oy, 0), board = this.unitBoardSquares(plan.level)
        // TASK-1562: after a zoom, the squares without a sector of the camera's level stretched from another (lv).
        const lv = levels ? this.levelPlan(plan, t, cw, ch, ox, oy) : null
        const hold = !!lv && this.settleHoldOn()
        const live = [], wanted = [], overlays = [], ground = [], upgrades = []
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        for (let v = Math.max(range.v0, board.v0); v <= Math.min(range.v1, board.v1); ++v) {
            for (let u = Math.max(range.u0, board.u0); u <= Math.min(range.u1, board.u1); ++u) {
                const entry = this.freshUnitSector(plan, u, v, 'cache')
                if (entry) {
                    this.drawUnitSectorAt(ctx, entry, u * LIT_TILE + ox, v * LIT_TILE + oy)
                    continue
                }
                // TASK-1561: the cache drawn there, then the units and texts from an overlay sector, else live.
                const over = this.freshUnitSector(plan, u, v, UNIT_OVERLAY)
                const r = this.unitSquareRect(u, v, ox, oy, cw, ch)
                if (r && !over && lv?.cover.covered.has(u + ',' + v)) {
                    lv.stretch.push({u, v})
                    wanted.push({u, v})
                    continue
                }
                // TASK-1572 (Grid.settleHoldsLevels): a square that would be live in a settle's first frames: as the gesture drew it.
                if (r && !over && hold) {
                    lv.held.push({u, v})
                    lv.first.add(u + ',' + v)
                    wanted.push({u, v})
                    continue
                }
                if (r)
                    ground.push(r)
                if (over)
                    overlays.push({entry: over, x: u * LIT_TILE + ox, y: v * LIT_TILE + oy})
                else if (r) {
                    live.push(r)
                    lv?.first.add(u + ',' + v)
                }
                ;(over ? upgrades : wanted).push({u, v})
            }
        }
        ctx.restore()
        if (ground.length) {
            ctx.save()
            clipToDeviceRects(ctx, ground)
            ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f)
            const left = -t.e / t.a, top = -t.f / t.d
            this.drawSurfaceCacheRect(ctx, left, top, left + cw / t.a, top + ch / t.d)
            ctx.restore()
        }
        if (lv) {
            this.drawLevelStretch(ctx, t, lv, cw, ch, ox, oy)
            this.drawLevelHeld(ctx, t, lv, cw, ch, ox, oy)
        }
        this.unitFrame = {kind: 'cache', live, overlays, plan}
        this.queueUnitSectors(plan, wanted, range, board, cw, ch, ox, oy, upgrades)
        if (lv)
            this.levelFrameEnd(lv, live.length, 'cache')
        return true
    }
    // The frame's wanted squares (on the canvas, nearest its centre first) and the ring UNIT_SECTOR_AHEAD round the canvas
    // (within the board's squares, not clean) built by a task between frames.
    queueUnitSectors(plan, wanted, range, board, cw, ch, ox, oy, upgrades = null) {
        const cu = (cw / 2 - ox) / LIT_TILE - 0.5, cv = (ch / 2 - oy) / LIT_TILE - 0.5
        const near = (p, q) => Math.hypot(p.u - cu, p.v - cv) - Math.hypot(q.u - cu, q.v - cv)
        // TASK-1562: a level frame's live squares first (plan.first), then the others nearest the centre.
        const first = plan.first?.size ? p => plan.first.has(p.u + ',' + p.v) ? 0 : 1 : null
        wanted.sort(first ? (p, q) => first(p) - first(q) || near(p, q) : near)
        const ring = [], A = UNIT_SECTOR_AHEAD
        // TASK-1565 (Grid.sectorAhead): the ring grown on the sides the camera moves to (aheadRange), its squares in the order
        // the camera reaches them (aheadWhen; at rest nearest first).
        const ahead = this.aheadOn() ? this.aheadRange(range, plan.level, ox, oy, cw, ch) : null
        const R = ahead ? ahead.range : {u0: range.u0 - A, u1: range.u1 + A, v0: range.v0 - A, v1: range.v1 + A}
        for (let v = Math.max(R.v0, board.v0); v <= Math.min(R.v1, board.v1); ++v)
            for (let u = Math.max(R.u0, board.u0); u <= Math.min(R.u1, board.u1); ++u) {
                if (u >= range.u0 && u <= range.u1 && v >= range.v0 && v <= range.v1)
                    continue
                const entry = this.unitSectors.get(SectorCache.key(plan.level, u, v))
                if (!entry || !this.unitEntryFits(entry, plan))
                    ring.push(ahead ? {u, v, when: this.litAheadWhen(ahead, u, v, !this.aheadOn(true))} : {u, v})
            }
        ring.sort(ahead ? (p, q) => p.when - q.when || near(p, q) : near)
        if (ahead) {
            this.aheadWork.queued = wanted.length + ring.length
            this.aheadWork.ring = (R.u1 - R.u0 + 1) * (R.v1 - R.v0 + 1)
        }
        // TASK-1561: the squares drawn from an overlay sector (upgrades) after the ring: a whole sector there saves the frame
        // its ground's copy only.
        const list = upgrades?.length ? wanted.concat(ring, upgrades.sort(near)) : wanted.concat(ring)
        if (!list.length && !this.unitSectorBuilding) {
            this.unitSectorWanted = undefined
            return
        }
        this.unitSectorWanted = {plan, list, standIn: plan.standIn, token: plan.token, onCanvas: wanted.length}
        if (this.unitSectorQueued)
            return
        this.unitSectorQueued = true
        setTimeout(gridTask(() => this.unitSectorTask()))
    }
    // The task between frames that builds the unit sectors the last frame wanted (queueUnitSectors).
    unitSectorTask() {
        this.unitSectorQueued = false
        const job = this.unitSectorWanted
        this.unitSectorWanted = undefined
        const screen = gameEvent.screen
        const why = !job ? 'job' : !screen.surfaceMoving && !job.plan.rest ? 'rest' : screen.zoomGesture || screen.surfaceZooming ? 'zoom' :
            this !== grid ? 'grid' : !!debug !== job.plan.key.key[UNIT_SECTOR_DEBUG_KEY] ? 'debug' : this.drawLogicText ? 'texts' :
            this.stillUnitsHidden() ? 'hidden' : this.isObserving() ? 'observing' : job.plan.key !== this.unitSectorKey ? 'key' :
            typeof mainCtx === 'undefined' || mainCtx.getTransform().a !== job.plan.level ? 'level' : null
        if (why) {
            this.unitSectorRefusals['task:' + why] = (this.unitSectorRefusals['task:' + why] || 0) + 1
            return
        }
        // TASK-1561: within UNIT_SECTOR_TASK_MS and UNIT_SECTOR_TASK_CALLS draw calls (calls.n, counted on the sectors'
        // canvases): a build the last task left unfinished first, then the list; a build the budget cuts is finished by
        // the next task (unitSectorBuilding).
        // A frame whose live squares alone drew more than UNIT_SECTOR_BURST_COST (its estimate, liveCost) is a heavy frame
        // whatever the task adds, and each such frame draws those squares' units and texts again: then the task builds the
        // squares on the canvas (up to UNIT_SECTOR_BURST_CALLS calls in UNIT_SECTOR_BURST_MS), so the live squares (and the
        // heavy frames) end at once.
        const frame = this.unitFrame || this.litFrame?.units
        // TASK-1562: a level frame's (levelMode) live squares burst too; its other builds share LEVEL_FRAME_CALLS a frame with
        // the lit tiles' steps (levelWorkLeft), the rest left to the next frame's task.
        // TASK-1565 (Grid.sectorAhead): a moving camera's builds too (with the lit tiles' steps: buildLitTiles).
        const levels = this.levelMode() || this.aheadOn(true)
        // TASK-1565: while the camera moves (not a zoom's levels) only when its frames are heavy anyway (Grid.lastFrameCalls).
        const burst = (!job.plan.rest || levels) && !!frame && frame.plan?.key === job.plan.key && frame.liveCost > UNIT_SECTOR_BURST_COST &&
            (this.levelMode() || !this.aheadOn(true) || Grid.lastFrameCalls > AHEAD_BURST_FRAME_CALLS)
        const left = levels && !burst ? Grid.levelWorkLeft() : null
        // With no square stretched or live (the sectors left are upgrades onto built tiles) the lit tiles' steps keep their
        // share of the frame's budget.
        const cover = this.levelCoverage
        if (left && cover && cover.serial === this.drawSerial && !cover.stretched && !cover.live)
            left.calls -= LEVEL_TILE_STEPS * LEVEL_TILE_STEP_CALLS / 2
        // The frame's own calls are in it too: its sector copies (levelDraws), live squares (liveCost) and the rest of a
        // frame (LEVEL_FRAME_BASE: the sky, the interface, the borders), within LEVEL_FRAME_TOTAL.
        // TASK-1565: a moving camera's (not a zoom's levels): the room the last frame's real calls leave (aheadCallsLeft), the
        // calls recorded counted by their real calls' ratio (aheadUnitRatio).
        const ahead = !!left && !this.levelMode()
        if (ahead)
            left.calls = (Grid.aheadCallsLeft() - (this.aheadTilesShown?.serial === this.drawSerial && this.aheadTilesShown.n ?
                AHEAD_TILE_STEPS * litStepCalls.mean / 2 : 0)) / this.aheadUnitRatio
        else if (left) {
            const drawn = this.levelDraws?.serial === this.drawSerial ? this.levelDraws.n : 0
            left.calls = Math.min(left.calls, LEVEL_FRAME_TOTAL - LEVEL_FRAME_BASE - drawn - (frame?.liveCost || 0))
        }
        // TASK-1570 (Grid.unitWorkerTime): with the Worker drawing the sectors (Grid.aheadInWorker) a settle's or a moving
        // camera's builds only record on the main thread: their recorded calls are not the frame's (a handful of real ones,
        // spent below), so they are bounded by their recording time (AHEAD_WORKER_FRAME_MS a task) and the Worker's queue, not
        // by the calls the frame leaves: a settle's frames drawing ~60 squares stretched left no calls for them, the settle
        // timed out with them live (2-5 heavy frames on the desktop capture's 0.611 pan, artifacts/TASK-1570/change.md), as
        // TASK-1565 pass 7 found for the lit tile steps.
        // (a frame's tasks AHEAD_WORKER_FRAME_MS together: levelFrameWork.unitMs)
        const timed = !!left && Grid.unitWorkerTime && Grid.aheadInWorker()
        // TASK-1572 (Grid.settleHoldsLevels): while a settle holds its squares (no live ones: its frames ~40-120 calls) the
        // recording gets SETTLE_HOLD_TASK_MS a frame, so the held squares' sectors come within the hold.
        const timedMs = timed && this.levelMode() && this.settleHoldOn() ? Grid.SETTLE_HOLD_TASK_MS : AHEAD_WORKER_FRAME_MS
        if (timed && Grid.levelFrameWork.unitMs >= timedMs) {
            ++this.levelWork.budgetStops
            this.unitSectorWanted ||= job
            return
        }
        if (left && !timed && left.calls < UNIT_SECTOR_GROUND_CALLS) {
            ++this.levelWork.budgetStops
            this.unitSectorWanted ||= job
            return
        }
        const start = performance.now(), calls = {n: 0, max: burst ? UNIT_SECTOR_BURST_CALLS : timed ? Infinity : left ? left.calls : UNIT_SECTOR_TASK_CALLS}
        const ms = burst ? (levels ? LEVEL_BURST_MS : UNIT_SECTOR_BURST_MS) : timed ? timedMs - Grid.levelFrameWork.unitMs :
            left ? LEVEL_TASK_MS : UNIT_SECTOR_TASK_MS
        if (burst)
            ++this.unitSectorWork.bursts
        let last = 0
        const fits = () => performance.now() - start + last <= ms && calls.n < calls.max && !calls.full
        // TASK-1565: a moving camera's task spends the calls it really made (the page's count), and learns their ratio to the
        // calls it recorded (aheadUnitRatio, 1-4).
        const real0 = Grid.frameCallsNow()
        const spend = () => {
            if (timed)
                Grid.levelFrameWork.unitMs += performance.now() - start
            if (!left)
                return
            if (!ahead) {
                Grid.levelSpend(calls.n)
                return
            }
            const real = Grid.frameCallsNow() - real0
            if (calls.n >= 20)
                this.aheadUnitRatio = Math.min(4, Math.max(1, this.aheadUnitRatio * 0.7 + real / calls.n * 0.3))
            Grid.levelSpend(real)
        }
        const open = this.unitSectorBuilding
        if (open) {
            if (open.plan.key !== job.plan.key || open.plan.level !== job.plan.level)
                this.unitSectorBuilding = undefined
            // TASK-1565: a build whose square left the frame's ring (its list): given up.
            else if (this.aheadOn() && !job.list.some(p => p.u === open.u && p.v === open.v)) {
                this.unitSectorBuilding = undefined
                ++this.aheadWork.cancelled
            }
            else
                this.buildUnitSector(job, open.u, open.v, calls)
        }
        let k = 0
        for (; k < job.list.length; ++k) {
            // A burst builds the squares on the canvas only; the ring after them within the task's own budget.
            if (burst && k === job.onCanvas)
                calls.max = Math.min(calls.max, calls.n + UNIT_SECTOR_TASK_CALLS)
            if (this.unitSectorBuilding || !fits())
                break
            // TASK-1564: no new build while the Worker's queue is full: the rest when a picture comes back (onDrain).
            // TASK-1565 rework: but a burst's squares on the canvas all go (the frames draw them live, heavy, till they come;
            // the Worker makes a unit sector in ~1 ms once its canvases are kept, artifacts/TASK-1565/preview).
            // TASK-1570 (Grid.litWorkerOrder): a square on the canvas may fill the queue as far as a lit tile there
            // (SectorWorker.busy(true)): the lit tiles' allowance left the unit sectors on the canvas waiting (drawn live).
            if (!(burst && k < job.onCanvas) && Grid.sectorWorkerBusy(Grid.litWorkerOrder && k < (job.onCanvas || 0))) {
                ++this.unitWorkerStops
                this.unitSectorWanted ||= {...job, list: job.list.slice(k), onCanvas: Math.max(0, (job.onCanvas || 0) - k)}
                spend()
                return
            }
            // TASK-1565: a moving camera's builds within the frame's offscreen megapixels too (Grid.aheadMpLeft); not when the
            // Worker draws them (Grid.aheadInWorker: no offscreen pixels on the main thread).
            const inWorker = ahead && Grid.aheadInWorker()
            if (ahead && !inWorker && Grid.aheadMpLeft() < AHEAD_SECTOR_MP) {
                ++this.aheadWork.stopMp
                break
            }
            const {u, v} = job.list[k]
            const t0 = performance.now()
            if (this.buildUnitSector(job, u, v, calls))
                last = performance.now() - t0
            if (ahead && !inWorker)
                Grid.aheadMpSpend(AHEAD_SECTOR_MP)
        }
        spend()
        // A cut build, and the squares the task did not reach, by the next task, though no frame queues one (a frame's own
        // list replaces it; a pan stopped stops a pan's job: the check above).
        // TASK-1562: a level frame's job by the next frame's task (its budget spent).
        if (left && (this.unitSectorBuilding || k < job.list.length)) {
            this.unitSectorWanted ||= {...job, list: job.list.slice(k), onCanvas: Math.max(0, (job.onCanvas || 0) - k)}
            ++this.levelWork.budgetStops
        }
        else if ((this.unitSectorBuilding || k < job.list.length) && !this.unitSectorQueued) {
            this.unitSectorWanted ||= {...job, list: job.list.slice(k), onCanvas: Math.max(0, (job.onCanvas || 0) - k)}
            this.unitSectorQueued = true
            setTimeout(gridTask(() => this.unitSectorTask()))
        }
    }
    // TASK-1561: what a unit sector of job's plan at (u, v) is drawn over: {ground, draw(g)}, ground the object a frame's
    // ground must be for the sector (freshUnitSector): the lit tile (null: none), the stand-in token or 'cache'; or, when the
    // ground a frame draws there cannot be drawn into a sector (a stale or edge-run tile, another stand-in than the frame's, a
    // surface job under way, the cache unsteady, another view), UNIT_OVERLAY: the sector holds the units pass and the cell
    // texts on a transparent canvas, drawn over the square's live ground (drawLiveSectorUnits).
    unitSectorGround(job, u, v) {
        const {plan} = job, level = plan.level, key = u + ',' + v
        const overlay = why => {
            this.unitSectorRefusals['overlay:' + why] = (this.unitSectorRefusals['overlay:' + why] || 0) + 1
            return {ground: UNIT_OVERLAY, draw: null}
        }
        const span = LIT_TILE / level, rect = {left: u * span, top: v * span, right: (u + 1) * span, bottom: (v + 1) * span}
        // The stand-in and cache drawn over the square grown by a quarter of it (the canvas cuts it), so the source's
        // sampling near the square's edge is the whole picture's.
        const grown = {left: rect.left - span / 4, top: rect.top - span / 4, right: rect.right + span / 4, bottom: rect.bottom + span / 4}
        if (plan.kind === 'cache') {
            if (this.cacheSectorUnsteady() || (Grid.zoomLevels ? !sameKeyArray(this.cacheSectorKey(), plan.tag) :
                    this.cacheSectorKey().some((k, i) => k !== plan.key.key[UNIT_SECTOR_KEY_BASE + i])))
                return overlay('cache')
            return {ground: 'cache', draw: g => this.drawSurfaceCacheRect(g, grown.left, grown.top, grown.right, grown.bottom)}
        }
        const view = this.litView
        // TASK-1562: a level frame without the view (drawLevelStandIn): the stand-in as the ground.
        if (plan.noView && !(view && view.a === level && view.e === 0 && view.f === 0)) {
            if (!job.standIn || this.surfacePatchJob || this.surfaceLayerJob || this.surfaceSplitJob || this.surfaceCacheBuild ||
                    this.unitStandInToken(job.standIn) !== job.token)
                return overlay('standin')
            const source = job.token.source
            return {ground: job.token, draw: g => {
                if (source === 'preview')
                    this.drawStandInRect(g, grown.left, grown.top, grown.right, grown.bottom, 'sector')
                else if (this.surfaceCache)
                    this.drawSurfaceCacheRect(g, grown.left, grown.top, grown.right, grown.bottom)
            }}
        }
        if (!view || view !== plan.view || view.a !== level || view.e !== 0 || view.f !== 0 || view.stale?.has(key) ||
                view.patch || view.layerJob)
            return overlay(!view ? 'noview' : view !== plan.view ? 'view' : view.stale?.has(key) ? 'stale' : view.patch ? 'patch' : view.layerJob ? 'layerjob' : 'viewgrid')
        if (this.litHas(view, u, v)) {
            const tile = view.tiles.get(key) || null
            if (tile && this.unitEdgeSquares(view).has(key))
                return overlay('edge')
            return {ground: tile, draw: g => {
                if (tile) {
                    g.save()
                    g.setTransform(1, 0, 0, 1, 0, 0)
                    this.drawLitTileAt(g, tile, 0, 0, LIT_TILE, LIT_TILE)
                    g.restore()
                }
            }}
        }
        if (!job.standIn || this.surfacePatchJob || this.surfaceLayerJob || this.surfaceSplitJob || this.surfaceCacheBuild ||
                this.unitStandInToken(job.standIn) !== job.token)
            return overlay('standin')
        // TASK-1565 (Grid.sectorAhead): a square whose tile is missing gets an overlay (drawn over the stand-in now and over its
        // tile when built) rather than a sector on the stand-in's ground (built again when the tile comes).
        if (this.aheadOn())
            return overlay('ahead')
        const source = job.token.source
        return {ground: job.token, draw: g => {
            if (source === 'preview')
                this.drawStandInRect(g, grown.left, grown.top, grown.right, grown.bottom, 'sector')
            else if (this.surfaceCache)
                this.drawSurfaceCacheRect(g, grown.left, grown.top, grown.right, grown.bottom)
        }}
    }
    // Builds sector (u, v) of job's plan: its ground (unitSectorGround), the units pass and the cell texts. calls ({n}: the
    // draw calls the task made and may make, max) given, the texts are drawn while calls.n < calls.max; the rest are left to the
    // next call for the same square (unitSectorBuilding: the canvas, the texts to draw, and what they were drawn from; begun
    // again when a cell changed since, unitCellChanges, or the ground differs). Returns whether it stored a sector.
    buildUnitSector(job, u, v, calls = null) {
        const {plan} = job, level = plan.level
        const {ground, draw} = this.unitSectorGround(job, u, v)
        let b = this.unitSectorBuilding
        if (b && (b.u !== u || b.v !== v || b.plan.key !== plan.key || b.ground !== ground || b.changes !== this.unitCellChanges)) {
            if (b.u === u && b.v === v)
                ++this.unitSectorWork.restarts
            b = this.unitSectorBuilding = undefined
        }
        if (!b) {
            // Already clean with that ground (or, as an overlay, clean).
            const entry = this.unitSectors.get(SectorCache.key(level, u, v))
            if (entry && this.unitEntryFits(entry, plan) && entry.ground === ground)
                return false
            // TASK-1564: or being made in the Worker for that plan and ground with the cells as they are.
            const pending = this.unitWorkerSectors?.get(SectorCache.key(level, u, v))
            if (pending && pending.cache === this.unitSectors && pending.planKey === plan.key && pending.ground === ground &&
                    pending.changes === this.unitCellChanges && pending.epoch === this.unitGroundEpoch)
                return false
            const transform = {a: level, b: 0, c: 0, d: level, e: -u * LIT_TILE, f: -v * LIT_TILE}
            const range = this.drawRange({getTransform: () => transform, canvas: {width: LIT_TILE, height: LIT_TILE}})
            // Compared first: the sector is drawn from the values its cells keep (unitSectorCheck).
            this.unitSectorCheck(range)
            const canvas = document.createElement('canvas')
            canvas.width = canvas.height = LIT_TILE
            const holder = {calls: null}
            let g = canvas.getContext('2d'), sector = null, recorder = null
            // TASK-1563: drawn through SectorDraw: the steps recorded into the sector's snapshot (g its recording context,
            // counting the draw calls in holder as countDrawCalls does), each step's runs drawn on the canvas (flush).
            if (Grid.sectorModule) {
                sector = this.sectorSnapshot('unit', level, u, v, range)
                recorder = new SectorRecorder(g, sector.snapshot, sector.sink, 0, holder)
                g = recorder.context
            }
            else
                countDrawCalls(g, holder)
            applyCanvasState(g, {...plan.state, transform})
            const span = LIT_TILE / level
            const box = {left: u * span, top: v * span, right: (u + 1) * span, bottom: (v + 1) * span}
            b = {job, plan, u, v, ground, canvas, g, holder, range, box, texts: [], next: 0, changes: this.unitCellChanges,
                steps: this.unitSectorSteps(plan, range, draw), step: 0, sector, recorder}
        }
        this.unitSectorBuilding = b
        // The steps (ground, units pass, bars, each with the cell texts it set taken), each begun when its cost (about) fits
        // the task's budget or the task made no call yet; then the texts while the budget lasts.
        const {g} = b
        b.holder.calls = calls
        while (b.step < b.steps.length) {
            const step = b.steps[b.step]
            if (calls && calls.n > 0 && calls.n + step.cost > calls.max)
                break
            const n0 = calls ? calls.n : 0
            step.run(g)
            b.recorder?.flush()
            if (step.cells !== undefined) {
                // The cell texts the pass set on these cells (drawCellText's, taken now: the pass's info texts are cleared
                // as drawn ones are), those reaching the square.
                b.texts.push(...this.sectorCellTexts(step.cells, [b.box], UNIT_TEXT_PAD / level))
                if (calls) {
                    this.unitSectorWork.stepCalls += calls.n - n0
                    this.unitSectorWork.stepCells += step.unitCells
                }
            }
            ++b.step
        }
        if (b.step === b.steps.length) {
            b.next = this.drawSectorTexts(g, b.texts, b.next, calls)
            b.recorder?.flush()
        }
        b.holder.calls = null
        if (b.step < b.steps.length || b.next < b.texts.length) {
            ++this.unitSectorWork.cut
            if (calls)
                calls.full = true
            return false
        }
        this.unitSectorBuilding = undefined
        if (b.recorder) {
            b.recorder.end()
            Grid.onSectorSnapshot?.(b.sector.snapshot, b.sector.sink.sprites, [b.canvas])
            // TASK-1564: the picture made in the Worker: stored when it comes back (unitSectorArrived).
            const key = SectorCache.key(level, u, v)
            const rec = {key, level, u, v, cache: this.unitSectors, planKey: plan.key, ground, kind: plan.kind, tag: plan.tag,
                changes: b.changes, epoch: this.unitGroundEpoch}
            if (this.sectorSubmit(b.sector, out => this.unitSectorArrived(rec, out), () => this.unitSectorFailed(rec))) {
                (this.unitWorkerSectors ||= new Map()).set(key, rec)
                return false
            }
        }
        b.canvas.getContext('2d').getImageData(0, 0, 1, 1)
        this.storeUnitSector(level, u, v, b.canvas, ground, plan.kind, plan.tag, this.unitGroundEpoch)
        return true
    }
    // A unit sector picture stored (built here, or back from the Worker).
    storeUnitSector(level, u, v, image, ground, kind, tag, epoch) {
        const before = this.unitSectors.evictions
        const entry = this.unitSectors.put(level, u, v, image)
        entry.ground = ground
        entry.kind = kind
        entry.tag = tag
        entry.epoch = epoch
        this.unitSectorWork.evicted += this.unitSectors.evictions - before
        ++this.unitSectorWork.built
        if (ground === UNIT_OVERLAY)
            ++this.unitSectorWork.overlays
        if (this.aheadOn()) {
            ++this.aheadWork.units
            if (this.aheadOn(true))
                ++this.aheadWork.unitsMoving
        }
        return entry
    }
    // TASK-1564: a unit sector's picture back from the Worker (out: [[0, ImageBitmap]]): stored as buildUnitSector stores one
    // built here; dropped (a stale version) when another build of the square was sent since, the cache is another (debug
    // toggled), or a cell the units pass draws or the grounds changed since it was recorded (unitCellChanges, unitGroundEpoch).
    unitSectorArrived(rec, out) {
        const mine = this.unitWorkerSectors?.get(rec.key) === rec
        if (mine)
            this.unitWorkerSectors.delete(rec.key)
        if (!mine || this !== grid || rec.cache !== this.unitSectors || rec.planKey !== this.unitSectorKey ||
                rec.changes !== this.unitCellChanges ||
                rec.epoch !== this.unitGroundEpoch || !out.length) {
            SectorWorker.dropped(out)
            return
        }
        this.storeUnitSector(rec.level, rec.u, rec.v, out[0][1], rec.ground, rec.kind, rec.tag, rec.epoch)
        SectorWorker.built('worker')
    }
    unitSectorFailed(rec) {
        if (this.unitWorkerSectors?.get(rec.key) === rec)
            this.unitWorkerSectors.delete(rec.key)
    }
    // TASK-1561: the steps of a unit sector's build ({run(g), cost, cells?: the drawRange whose texts it set, unitCells}):
    // the ground; on the lit path the units pass (drawOther 'units') in column chunks of about UNIT_SECTOR_CHUNK_CALLS (the
    // cells in drawOther's order, the building bars it draws after every cell kept for the last step, as it draws them);
    // on the cache's path drawStillUnits + drawEntityOverlays in one step. With debug the coordinate texts (any cell) come
    // with the last step.
    unitSectorSteps(plan, range, draw) {
        const steps = [{run: g => draw?.(g), cost: draw ? UNIT_SECTOR_GROUND_CALLS : 0}]
        const h = this.arr[0].length, cellsOf = (i0, i1) => {
            let n = 0
            for (let i = i0; i < i1; ++i)
                for (let j = range.j0; j < range.j1; ++j)
                    if (this.unitCellVals.has(i * h + j))
                        ++n
            return n
        }
        if (plan.kind !== 'lit') {
            // TASK-1562: in chunks of the cells the pass draws on (unitCellVals, board order): drawStillUnits on each, then
            // drawEntityOverlays on each with the buildings' bars kept for the last step, as one pass draws them.
            const cells = []
            for (let i = range.i0; i < range.i1; ++i)
                for (let j = range.j0; j < range.j1; ++j)
                    if (this.unitCellVals.has(i * h + j))
                        cells.push(i * h + j)
            const per = Math.max(1, Math.floor(UNIT_SECTOR_CHUNK_CALLS / UNIT_SECTOR_CELL_CALLS / 2)), parts = []
            for (let k = 0; k < cells.length; k += per)
                parts.push(cells.slice(k, k + per))
            const bars = []
            for (const part of parts)
                steps.push({run: g => this.drawStillUnits(g, part), cost: part.length * UNIT_SECTOR_CELL_CALLS / 2})
            for (const part of parts)
                steps.push({run: g => this.drawEntityOverlays(g, part, bars), cost: part.length * UNIT_SECTOR_CELL_CALLS / 2})
            steps.push({run: g => {
                for (const building of bars)
                    building.drawBars(g)
                this.refreshCulledPortal(range)
            }, get cost() { return 1 + 3 * bars.length }, cells: range, unitCells: cells.length})
            return steps
        }
        const bars = []
        for (let i0 = range.i0; i0 < range.i1;) {
            let i1 = i0, n = 0
            while (i1 < range.i1) {
                const c = cellsOf(i1, i1 + 1)
                if (i1 > i0 && (n + c) * UNIT_SECTOR_CELL_CALLS > UNIT_SECTOR_CHUNK_CALLS)
                    break
                n += c
                ++i1
            }
            const part = {i0, i1, j0: range.j0, j1: range.j1}
            steps.push({run: g => this.drawOther(g, 'units', part, bars), cost: n * UNIT_SECTOR_CELL_CALLS, cells: part, unitCells: n})
            i0 = i1
        }
        steps.push({run: g => {
            for (const building of bars)
                building.drawBars(g)
            this.refreshCulledPortal(range)
        }, get cost() { return 1 + 3 * bars.length }})
        return steps
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
        // TASK-1553: squares frameCover left without the sky for the stand-in (plan.covered); a plan made again gets them
        // the sky and the slab shadow first (coverSkyUnder), as frameCover left them.
        const covered = this.coverStandIn
        this.coverStandIn = undefined
        if (covered && plan !== covered.plan)
            this.coverSkyUnder(ctx, covered.rects)
        if (!plan)
            return false
        if (plan.cache)
            return this.drawSurfaceCache(ctx, true) ? 'cache' : false
        const cw = ctx.canvas.width, ch = ctx.canvas.height
        // TASK-1571: the view at the camera's scale not made yet (its light map or edges by tasks): the ground fill over the
        // board, the frame's units over it as over a stand-in (Grid.draw: 'fill').
        if (plan.fill) {
            this.litFrame = undefined
            this.drawGroundFill(ctx, [{x: 0, y: 0, w: cw, h: ch}])
            return 'fill'
        }
        const {view, rest} = plan
        if (rest) {
            ctx.save()
            ctx.setTransform(1, 0, 0, 1, 0, 0)
            // With its cell layer (splitCellLayer) the snapshot with the layer composed (TASK-1316, prepareLitCellLayer).
            ctx.drawImage(rest.canvas.cellLayered && rest.cellLayer && rest.shown || rest.canvas, 0, 0)
            ctx.restore()
            // TASK-1519: the snapshot drawn from the board now, stale tiles (refreshLitTiles) are not drawn again (the view's
            // state may follow later changes without them: followCellLayer, patchLitView).
            if (view.stale)
                this.releaseStaleTile(view)
            if (Grid.litAhead)
                this.followLitMotion(view, t)
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
        if (Grid.litAhead)
            this.followLitMotion(view, t)
        // A tile not built yet is drawn from the stand-in (the tasks build it, queueLitTiles); without one it is built now.
        // TASK-1553: the stand-in frameCover found (plan.standIn), if it looked.
        let standIn = plan.standIn, missing = null, stale = false
        // TASK-1560: a pan frame draws a square's unit sector (its tile or stand-in and the units over it) where one is clean
        // with the ground the frame draws there; the other squares within the board are live (their ground as before, the
        // units drawn over them after drawLitEdges, drawLiveSectorUnits). Not with stale tiles (drawn with their changed cells).
        // TASK-1562: after a zoom (levelMode) at rest too, the squares not drawn from the camera's level stretched from another
        // where one covers them (lv).
        const levels = this.levelMode(ctx)
        const units = view.e === 0 && view.f === 0 && !view.stale?.size ? this.unitSectorPlan(ctx, 'lit', levels) : null
        if (!units && (view.e !== 0 || view.f !== 0 || view.stale?.size))
            this.unitSectorRefusals['lit:view'] = (this.unitSectorRefusals['lit:view'] || 0) + 1
        let composed = null, live = null, wanted = null, edges = null, board = null, overlays = null, upgrades = null
        if (units) {
            this.unitSectorCheck(this.drawRange(ctx))
            units.view = view
            live = []
            overlays = []
            upgrades = []
            wanted = []
            edges = this.unitEdgeSquares(view)
            board = this.unitBoardSquares(units.level)
        }
        const lv = units && levels ? this.levelPlan(units, t, cw, ch, Math.round(t.e), Math.round(t.f)) : null
        // TASK-1572 (Grid.settleHoldsLevels): a square that would be live in a settle's first frames: as the gesture drew it.
        const hold = !!lv && this.settleHoldOn()
        // TASK-1559: the sectors drawn this frame are the cache's most recent and are not evicted before the next frame.
        this.beginSectorFrame()
        // TASK-1571 (Grid.litGroundFill): the squares without a tile the frame builds (litFrameBuilds), the others filled.
        let builds = null, filled = null
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        for (let v = range.v0; v <= range.v1; ++v) {
            for (let u = range.u0; u <= range.u1; ++u) {
                // TASK-1519: a stale tile (refreshLitTiles) drawn as it was until built again, the changes drawn over it below.
                const old = view.stale && !this.litHas(view, u, v) ? view.stale.get(u + ',' + v) : undefined
                if (old) {
                    this.useSector(view, u, v)
                    this.drawLitTileAt(ctx, old, u * LIT_TILE + ox, v * LIT_TILE + oy, cw, ch)
                    stale = true
                    continue
                }
                const inBoard = units && u >= board.u0 && u <= board.u1 && v >= board.v0 && v <= board.v1
                // TASK-1544: without the cache to stand in, its stand-in (the stale cache or the preview, drawStandIn).
                if (!this.litHas(view, u, v) && (standIn ??= this.litStandIn(ctx) || !!this.standInSource() && 'standin')) {
                    if (inBoard) {
                        units.standIn = standIn
                        const entry = this.freshUnitSector(units, u, v, units.token ||= this.unitStandInToken(standIn))
                        if (entry) {
                            this.drawUnitSectorAt(ctx, entry, u * LIT_TILE + ox, v * LIT_TILE + oy)
                            ;(composed ||= new Set()).add(u + ',' + v)
                            if (lv)
                                ++lv.standIn
                            continue
                        }
                        // TASK-1562: a clean sector of the camera's level on another ground, until built again.
                        const any = lv && this.levelAnySector(units, u, v)
                        if (lv)
                            ++lv.standIn
                        if (any) {
                            this.drawUnitSectorAt(ctx, any, u * LIT_TILE + ox, v * LIT_TILE + oy)
                            ;(composed ||= new Set()).add(u + ',' + v)
                            wanted.push({u, v})
                            continue
                        }
                        // TASK-1561: the units and texts from an overlay sector over the stand-in, else live.
                        // TASK-1565 (Grid.sectorAhead): an overlay there is not upgraded before the tile is built (it would be
                        // an overlay again).
                        const over = this.freshUnitSector(units, u, v, UNIT_OVERLAY)
                        if (!over)
                            wanted.push({u, v})
                        else if (!this.aheadOn())
                            upgrades.push({u, v})
                        const r = this.unitSquareRect(u, v, ox, oy, cw, ch)
                        if (over)
                            overlays.push({entry: over, x: u * LIT_TILE + ox, y: v * LIT_TILE + oy})
                        else if (r && lv && lv.cover.covered.has(u + ',' + v)) {
                            lv.stretch.push({u, v})
                            ;(composed ||= new Set()).add(u + ',' + v)
                            continue
                        }
                        else if (r && hold) {
                            lv.held.push({u, v})
                            lv.first.add(u + ',' + v)
                            ;(composed ||= new Set()).add(u + ',' + v)
                            continue
                        }
                        else if (r) {
                            live.push(r)
                            lv?.first.add(u + ',' + v)
                        }
                    }
                    (missing ||= new Set()).add(u + ',' + v)
                    continue
                }
                // TASK-1571 (Grid.litGroundFill): a square without its tile not among the frame's builds: the ground fill there
                // (a square the board does not reach: nothing, as its null tile), the units over it live (or an overlay
                // sector's, or a clean sector of the camera's level on an exact ground, or stretched after a zoom).
                if (Grid.litGroundFill && !this.litHas(view, u, v) &&
                        !(builds ??= this.litFrameBuilds(view, range, cw, ch, ox, oy, (u, v) => units && u >= board.u0 && u <= board.u1 &&
                            v >= board.v0 && v <= board.v1 && (!!lv?.cover.covered.has(u + ',' + v) ||
                            !!this.levelAnySector(units, u, v) && !this.levelAnySector(units, u, v).ground?.standIn))).has(u + ',' + v)) {
                    if (!this.litTileReaches(view, u, v))
                        continue
                    if (inBoard) {
                        const any = this.levelAnySector(units, u, v)
                        if (any && !any.ground?.standIn) {
                            this.drawUnitSectorAt(ctx, any, u * LIT_TILE + ox, v * LIT_TILE + oy)
                            ;(composed ||= new Set()).add(u + ',' + v)
                            continue
                        }
                        // (After a zoom the stretched levels before the fill: a picture of the square, units and all.)
                        const r = this.unitSquareRect(u, v, ox, oy, cw, ch)
                        const over = this.freshUnitSector(units, u, v, UNIT_OVERLAY)
                        // TASK-1572 (Grid.litFillOverlays): a filled square's units and texts get an overlay sector (built by the
                        // unit sector tasks, drawn over the fill now and over the tile when it comes), not live in every frame.
                        // (Grid.settleHoldsLevels: a stretched one too, so the frames after the levels do not draw it live.)
                        const stretched = !!r && !!lv && lv.cover.covered.has(u + ',' + v)
                        if (!over && Grid.litFillOverlays && (!stretched || Grid.settleHoldsLevels))
                            wanted.push({u, v})
                        if (stretched) {
                            lv.stretch.push({u, v})
                            ;(composed ||= new Set()).add(u + ',' + v)
                            continue
                        }
                        if (over)
                            overlays.push({entry: over, x: u * LIT_TILE + ox, y: v * LIT_TILE + oy})
                        else if (r && hold) {
                            lv.held.push({u, v})
                            lv.first.add(u + ',' + v)
                            ;(composed ||= new Set()).add(u + ',' + v)
                            continue
                        }
                        else if (r) {
                            live.push(r)
                            lv?.first.add(u + ',' + v)
                        }
                    }
                    (filled ||= []).push(u + ',' + v)
                    ;(missing ||= new Set()).add(u + ',' + v)
                    continue
                }
                const built0 = !this.litHas(view, u, v) && Grid.frameCallsNow()
                const tile = this.litTile(view, u, v, true)
                // TASK-1572 (Grid.litFrameBudget): a tile the frame built itself: its real calls (litFrameTileCalls).
                if (built0 !== false && Grid.frameCallsNow() > built0)
                    Grid.litFrameTileBuilt(Grid.frameCallsNow() - built0)
                this.useSector(view, u, v)
                if (inBoard) {
                    // A tile the edge runs meet stays live (the frame lights the runs over it before the units).
                    const edge = !!tile && edges.has(u + ',' + v)
                    const entry = !edge && this.freshUnitSector(units, u, v, tile || null)
                    if (entry) {
                        this.drawUnitSectorAt(ctx, entry, u * LIT_TILE + ox, v * LIT_TILE + oy)
                        continue
                    }
                    // TASK-1562: a clean sector of the camera's level on another ground (the stand-in), until built again.
                    const any = lv && !edge && this.levelAnySector(units, u, v)
                    if (any)
                        ++lv.old
                    if (any) {
                        this.drawUnitSectorAt(ctx, any, u * LIT_TILE + ox, v * LIT_TILE + oy)
                        ;(composed ||= new Set()).add(u + ',' + v)
                        wanted.push({u, v})
                        continue
                    }
                    // TASK-1561: else the units and texts from an overlay sector over the tile (an edge-run tile's is one), else live.
                    const over = this.freshUnitSector(units, u, v, UNIT_OVERLAY)
                    // TASK-1565 (Grid.sectorAhead): an overlay over a built tile (not an edge-run one) made a whole sector at once
                    // (the tile's quarters and the overlay drawn into it: what the frame draws there), AHEAD_COMPOSE_FRAME a frame,
                    // so the next frames draw one picture there instead of the quarters and the overlay.
                    if (over && tile && !edge && this.aheadOn() && (this.aheadComposed?.serial === this.drawSerial ? this.aheadComposed.n : 0) <
                            Math.min(AHEAD_COMPOSE_FRAME, Math.floor((AHEAD_FRAME_MP - Grid.aheadPrevMp() - Grid.frameTileMp()) / AHEAD_COMPOSE_MP))) {
                        const whole = this.composeUnitSector(units, u, v, tile, over)
                        if (whole) {
                            this.drawUnitSectorAt(ctx, whole, u * LIT_TILE + ox, v * LIT_TILE + oy)
                            continue
                        }
                    }
                    if (!over)
                        wanted.push({u, v})
                    else if (!edge)
                        upgrades.push({u, v})
                    const r = this.unitSquareRect(u, v, ox, oy, cw, ch)
                    if (over)
                        overlays.push({entry: over, x: u * LIT_TILE + ox, y: v * LIT_TILE + oy})
                    else if (r && lv && !edge && lv.cover.covered.has(u + ',' + v)) {
                        lv.stretch.push({u, v})
                        ;(composed ||= new Set()).add(u + ',' + v)
                        continue
                    }
                    else if (r && hold && !edge) {
                        lv.held.push({u, v})
                        lv.first.add(u + ',' + v)
                        ;(composed ||= new Set()).add(u + ',' + v)
                        continue
                    }
                    else if (r) {
                        live.push(r)
                        lv?.first.add(u + ',' + v)
                    }
                }
                if (tile)
                    this.drawLitTileAt(ctx, tile, u * LIT_TILE + ox, v * LIT_TILE + oy, cw, ch)
            }
        }
        ctx.restore()
        // TASK-1565: the canvas's squares whose tile is missing this frame (unitSectorTask keeps the lit steps' share for them).
        this.aheadTilesShown = {serial: this.drawSerial, n: missing ? missing.size : 0}
        if (lv) {
            this.drawLevelStretch(ctx, t, lv, cw, ch, ox, oy)
            this.drawLevelHeld(ctx, t, lv, cw, ch, ox, oy)
        }
        const squareRect = key => {
            const [u, v] = key.split(',').map(Number)
            const x0 = Math.max(0, u * LIT_TILE + ox), y0 = Math.max(0, v * LIT_TILE + oy)
            return {x: x0, y: y0, w: Math.min(cw, (u + 1) * LIT_TILE + ox) - x0, h: Math.min(ch, (v + 1) * LIT_TILE + oy) - y0}
        }
        // TASK-1571: the filled squares' ground (under the units drawn after; the squares stretched or drawn from a sector not).
        if (filled)
            this.drawGroundFill(ctx, filled.map(squareRect))
        // (TASK-1571: the stand-in under its own squares only, in a zoom gesture; the filled ones are drawn.)
        const standInSquares = missing && standIn ? [...missing].filter(key => !filled?.includes(key)) : []
        if (standInSquares.length) {
            ctx.save()
            clipToDeviceRects(ctx, standInSquares.map(squareRect))
            ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f)
            const drawn = standIn === 'standin' ? this.drawStandIn(ctx) : this.drawSurfaceCache(ctx)
            ctx.restore()
            // TASK-1553: a stand-in that did not draw leaves frameCover's covered squares the sky and the slab shadow.
            if (!drawn && plan.covered)
                this.coverSkyUnder(ctx, plan.covered)
        }
        if (stale)
            this.drawPatchCells(ctx, view.refresh, 'lit')
        // Tiles more than a tile off the canvas go back to the pool.
        // TASK-1552 (Grid.litAhead): more than a tile off the ring built ahead (litAheadRange), while the camera moves more
        // than LIT_AHEAD_KEEP tiles off it (a pan back finds them built).
        // TASK-1559: a sector's tile leaves the view only: the sector cache keeps it (its LRU budget releases it), so a pan
        // back finds it (litHas).
        const keep = Grid.litAhead ? this.litAheadRange(view, cw, ch, ox, oy).range : range
        const off = Grid.litAhead && gameEvent.screen.surfaceMoving ? LIT_AHEAD_KEEP : 1
        for (const [key, tile] of view.tiles) {
            const [u, v] = key.split(',').map(Number)
            if (u < keep.u0 - off || u > keep.u1 + off || v < keep.v0 - off || v > keep.v1 + off) {
                view.tiles.delete(key)
                if (!this.sectorHolds(view, u, v, tile))
                    this.releaseLitTile(tile)
            }
        }
        if (view.stale) {
            for (const key of [...view.stale.keys()]) {
                const [u, v] = key.split(',').map(Number)
                if (u < range.u0 - 1 || u > range.u1 + 1 || v < range.v0 - 1 || v > range.v1 + 1)
                    this.releaseStaleTile(view, key)
            }
        }
        // (TASK-1560: a sector drawn with the stand-in's ground is a stand-in square to the lit edges.)
        this.litFrame = {view, ox, oy, rest: false, missing: composed ? new Set([...(missing || []), ...composed]) : missing, stale,
            units: units ? {kind: 'lit', live, overlays, plan: units} : undefined}
        if (units)
            this.queueUnitSectors(units, wanted, range, board, cw, ch, ox, oy, upgrades)
        if (lv)
            this.levelFrameEnd(lv, live.length, 'lit')
        this.queueLitTiles(view, t, cw, ch)
        return true
    }
    // Whether the surface cache can stand in for the lit view on ctx's canvas (drawn magnified: lit, its state the board's,
    // no build or patch under way), so no frame builds the lit view's light map or tiles (Grid.litStandIns).
    // TASK-1316: exactly (surfaceStateMatches exact): with the cell layer a stand-in cache not drawn since a cell's owner, suburb
    // or fog changed (its layer not brought up, followCellLayer) stands in no more, as without the layer.
    // TASK-1519 (Grid.standInFollows): a cache that differs only in what its cell layer holds (an owner, suburb or fog change:
    // a turn playback's capture) has its layer brought up now (followCellLayer: the changed cells' sprites) and stands in,
    // instead of the frame drawing the whole board directly.
    // TASK-1571: gesture, a phone's zoom gesture frame (planLitView): the stand-in there whatever Grid.litStandIns (counted).
    litStandIn(ctx, gesture = false) {
        if (!(Grid.litStandIns || gesture && Grid.zoomGestureNow()) || !this.surfaceCache || !this.surfaceCacheLit ||
                this.surfaceCacheBuild || this.surfacePatchJob)
            return false
        if (this.surfaceStateMatches(ctx, undefined, true))
            return true
        if (!Grid.standInFollows || !this.cellLayerOn() || this.surfaceSplitJob || !this.surfaceStateMatches(ctx))
            return false
        this.followCellLayer('surface')
        ++this.standInFollows
        return !!this.surfaceCache && !this.surfaceLayerJob && this.surfaceStateMatches(ctx, undefined, true)
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
            // TASK-1571: a gesture's frame drawn from the stretched levels is drawZoomSectors' (Grid.draw); one it does not
            // take (no levels, a zoom tween, the two frames surfaceZooming outlasts zoomGesture by) keeps the cache inside the
            // gesture only (litStandIn's gesture, counted in gestureStandIns).
            if (!(zooming && typeof mobilePhone !== 'undefined' && mobilePhone && this.litStandIn(ctx, true)))
                return false
            if (!Grid.litStandIns)
                ++this.gestureStandIns
            return {t, cache: true}
        }
        const cw = ctx.canvas.width, ch = ctx.canvas.height
        let view = this.litView
        // A view being patched holds while its patch does (patchLitView).
        const holds = !!view && !view.patch && this.litViewHolds(ctx, view, t) ? view : null
        if (!view || !(holds || this.patchLitView(ctx, view, t) || this.refreshLitTiles(ctx, view, t))) {
            // TASK-1546: a view for a new scale (none, or the dropped one another's: a zoom's end) may be made by tasks below.
            const newScale = !view || view.a !== t.a || view.d !== t.d
            this.dropLitView()
            // The light map at the camera's scale is built a step a task (queueLitTiles) while the surface cache stands in.
            // TASK-1571 (Grid.litGroundFill): without the stand-in the frames draw the ground fill meanwhile (drawLitView).
            const standIn = this.litStandIn(ctx), fill = !standIn && Grid.litGroundFill
            if (!atmosphericLighting.lightMapReady(this) && (standIn || fill)) {
                this.queueLitTiles(null, t, cw, ch)
                return standIn ? {t, cache: true} : {t, fill: true}
            }
            // TASK-1546 (Grid.litViewSteps): a view for a new scale with the surface cache to stand in is made a step at a time
            // by tasks between frames (stepLitView), the frames drawing the stand-in meanwhile; one for the same scale (the board
            // changed past a patch) at once as before, so the frames keep the lit tiles.
            if (Grid.litViewSteps && (newScale || this.litViewJob) && (standIn || fill)) {
                const made = this.stepLitView(ctx, t)
                if (!made)
                    return standIn ? {t, cache: true} : {t, fill: true}
                view = this.setLitView(made, cw, ch)
            }
            else
                view = this.setLitView(this.newLitView(t, ctx.canvas), cw, ch)
        }
        // The rest snapshot's cell layer brought up to the board (TASK-1315); a view dropped for it is made again.
        // TASK-1372: so is one whose snapshot's split is behind the board.
        if (!this.followCellLayer('lit', ctx, t) || !this.litSplitHolds(view))
            view = this.setLitView(this.newLitView(t, ctx.canvas), cw, ch)
        // TASK-1377: a view that held and is still the one drawn vouches for the light map (atmosphericLighting.trust): the
        // frame's lightMap calls (the tiles, the lit edges) and the tasks building its tiles skip the whole board's light
        // state. exact: its whole state compared (litViewHolds' exact, not the rest snapshot's cell layer compare).
        if (Grid.litTrust && holds && view === holds)
            atmosphericLighting.trust = {board: this, view, rebuilds: view.rebuilds, exact: !view.rest || view.rest.done !== LIT_REST_BANDS}
        // TASK-1562: none after a zoom (levelMode): the frames at rest draw the sectors.
        const rest = screen.surfaceMoving || this.levelMode(ctx) ? null : this.litRest(ctx, view, t, cw, ch)
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
                if (!this.litHas(view, u, v) && !view.stale?.has(u + ',' + v))
                    ++missing
        // TASK-1571 (Grid.litGroundFill): the view is drawn (LIT_FRAME_TILE_CAP built in the frame, the ground fill for the
        // others), not the board live: its tiles are built as a view drawn with a stand-in had them (queueLitTiles' ring, the
        // canvas's first), so not unbuilt (no batch, the surface cache's tasks not waited for as a stand-in).
        return view.unbuilt = missing > LIT_FRAME_TILES && !Grid.litGroundFill && !this.litStandIn(ctx) && !this.standInSource()
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
    // TASK-1519: a board change while the frames draw view's tiles with no finished rest snapshot (a camera that keeps moving,
    // as a turn playback's glides: a step captures a cell or two, whose territory glow reaches a few hexes) does not drop
    // the view (every tile on the canvas built again, the frames drawing the whole board directly until they are): the view
    // takes the board's state and the tiles the changed cells reach (surfaceCacheChangeRects at the view's transform, as a
    // lit patch's region) become stale (view.stale): built again as missing ones are (queueLitTiles; each drawn whole from
    // the board as it is), and until then drawn as they were with the changed cells drawn over them in their new state
    // (drawPatchCells, view.refresh: every change since the oldest stale tile), as a patch's frames draw them. A snapshot
    // under way is started over. Not for a lamp or portal change (their light reaches far), a change of the light state
    // (another light map: view.rebuilds), an observed board, another scale, or more than LIT_REFRESH_MAX_CELLS changed cells
    // (Grid.litTileRefresh false: dropped as before). Returns whether view holds.
    refreshLitTiles(ctx, view, t) {
        const L = atmosphericLighting
        if (!Grid.litTileRefresh || this.isObserving() || view.patch || view.a !== t.a || view.d !== t.d ||
                view.rebuilds !== L.rebuilds || view.mapScale !== L.mapScale || view.rest && view.rest.done === LIT_REST_BANDS)
            return false
        const changes = []
        const matches = this.withLitState(view, () => {
            const overlayCells = this.surfaceOverlayCells
            this.surfaceOverlayCells = []
            try {
                return this.surfaceStateMatches(undefined, changes, true)
            } finally {
                this.surfaceOverlayCells = overlayCells
            }
        })
        const refuse = reason => {
            this.litRefreshRefusals[reason] = (this.litRefreshRefusals[reason] || 0) + 1
            return false
        }
        if (!matches)
            return refuse('board')
        if (changes.length + (view.refresh ? view.refresh.changed.length : 0) > LIT_REFRESH_MAX_CELLS)
            return refuse('cells')
        const found = changes.length ? this.withLitState(view, () => this.surfaceCacheChangeRects(changes)) : {cells: [], light: [], sprites: []}
        if (!found)
            return refuse('lamp or portal')
        if (changes.length) {
            // The tiles meeting the region (view-relative device pixels, the tiles' squares), grown by the edge runs' reach.
            const at = (x, y) => ({x: x * view.a + view.e, y: y * view.d + view.f})
            const r = this.patchRegion(found, L.mapPixel(), at, Infinity, Infinity), grow = 4 * LIT_EDGE_BLOCK
            const stale = view.stale ||= new Map()
            let staled = 0
            // TASK-1559: with sectors, those the change reaches at every level (staleSectors: the view's own left dirty, the
            // others released).
            const reached = view.sectorLevel ? new Set(this.staleSectors(view, found)) : null
            for (const [key, tile] of view.tiles) {
                const [u, v] = key.split(',').map(Number), x = u * LIT_TILE, y = v * LIT_TILE
                if (reached ? reached.has(key) : x < r.x + r.w + grow && x + LIT_TILE > r.x - grow && y < r.y + r.h + grow && y + LIT_TILE > r.y - grow) {
                    view.tiles.delete(key)
                    if (stale.has(key))
                        this.releaseLitTile(stale.get(key))
                    stale.set(key, tile)
                    ++staled
                }
            }
            if (stale.size) {
                const refresh = view.refresh ||= {changed: [], boxes: [], sprites: [], light: []}
                refresh.changed.push(...changes)
                refresh.boxes.push(...found.cells)
                refresh.sprites.push(...found.sprites)
                refresh.light.push(...found.light)
                refresh.regionLight = undefined
            }
            else
                view.stale = view.refresh = undefined
            this.litTilesStaled += staled
        }
        this.withLitState(view, () => this.captureSurfaceState())
        Object.assign(view, this.litEdges(view))
        view.rest = undefined
        ++this.litTileRefreshes
        return true
    }
    // A built tile (litTile) or the view's tiles dropped (released): its stale tile (refreshLitTiles) released; none left,
    // the changes drawn over them are done.
    releaseStaleTile(view, key) {
        const stale = view.stale
        if (!stale)
            return
        if (key === undefined) {
            for (const tile of stale.values())
                this.releaseLitTile(tile)
            stale.clear()
        }
        else if (stale.has(key)) {
            this.releaseLitTile(stale.get(key))
            stale.delete(key)
        }
        if (!stale.size)
            view.stale = view.refresh = undefined
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
        // TASK-1559: with sectors, those the change reaches at every level (staleSectors), the view's own released here.
        const reached = r && view.sectorLevel ? new Set(this.staleSectors(view, {cells: job.boxes, light: job.light})) : null
        if (r) {
            // The tiles whose squares meet the region grown by the edge runs' reach (a run joins blocks up to 3 apart).
            const grow = 4 * LIT_EDGE_BLOCK, ox = Math.round(job.rest.e - view.e), oy = Math.round(job.rest.f - view.f)
            for (const [key, tile] of view.tiles) {
                const [u, v] = key.split(',').map(Number), x = u * LIT_TILE + ox, y = v * LIT_TILE + oy
                if (reached ? reached.has(key) : x < r.x + r.w + grow && x + LIT_TILE > r.x - grow && y < r.y + r.h + grow && y + LIT_TILE > r.y - grow) {
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
        this.coverSky = undefined
        this.coverStandIn = undefined
        // The sky's check first: a sky drawn with another key or board invalidates the light first.
        if (!otherSettings.atmosphericVisuals || !atmosphericBackground.opaqueOver(ctx) || this.canUseSurfaceCache())
            return null
        const plan = this.litPlan = this.planLitView(ctx)
        // TASK-1571: a fill plan's frame draws the sky whole, the ground fill over the board (drawLitView).
        if (!plan || plan.cache || plan.fill)
            return null
        if (plan.rest)
            return {open: this.coverOpen = []}
        const {t, view} = plan, cw = ctx.canvas.width, ch = ctx.canvas.height
        const ox = Math.round(t.e - view.e), oy = Math.round(t.f - view.f)
        const range = this.litTileRange(cw, ch, ox, oy, 0), open = []
        // TASK-1553 (Grid.standInCover): a tile square not built (drawn from the stand-in, drawLitView) is covered where the
        // stand-in is opaque: inside the board outline by standInMargin (its underlay magnified, standInCoverMargin).
        let margin
        const covered = []
        // Rows of tiles cut to the canvas: the runs of tiles without an opaque square, and the
        // canvas above, below, left and right of the tile range (none: the range covers it).
        for (let v = range.v0; v <= range.v1; ++v) {
            const y0 = Math.max(0, v * LIT_TILE + oy), y1 = Math.min(ch, (v + 1) * LIT_TILE + oy)
            let run = null
            for (let u = range.u0; u <= range.u1; ++u) {
                const key = u + ',' + v
                const tile = this.litHas(view, u, v) ? view.tiles.get(key) : undefined
                if (tile && tile.litOpaque === mapDepth.outline && mapDepth.outline) {
                    run = null
                    continue
                }
                const x0 = Math.max(0, u * LIT_TILE + ox), x1 = Math.min(cw, (u + 1) * LIT_TILE + ox)
                if (!tile && Grid.standInCover && !view.stale?.has(key) &&
                        (margin ??= this.standInCoverMargin(ctx, plan, t)) > 0 &&
                        this.litSquareOpaque(view, x0 - ox, y0 - oy, x1 - ox, y1 - oy, margin, false)) {
                    covered.push({x: x0, y: y0, w: x1 - x0, h: y1 - y0})
                    run = null
                    continue
                }
                if (run)
                    run.w = x1 - run.x
                else
                    open.push(run = {x: x0, y: y0, w: x1 - x0, h: y1 - y0})
            }
        }
        if (covered.length) {
            plan.covered = covered
            this.coverStandIn = {plan, rects: covered}
            ++this.standInCovers
        }
        const sky = Grid.skyBlocks ? this.coverSkyBlocks(ctx, open, view, ox, oy, margin || 0) : null
        this.coverSky = sky
        return {open: this.coverOpen = open, sky}
    }
    // TASK-1553: the device margin inside the board outline past which the stand-in the frame draws for its tiles not built
    // (drawLitView: litStandIn's surface cache, else standInSource's cache or preview) is opaque: its underlay (an opaque
    // fill of the outline) magnified from its raster's scale (two source pixels of antialiasing and sampling, two device
    // pixels besides); 0 when there is no stand-in (the tiles are built in the frame: open as before). The stand-in found
    // is kept for drawLitView (plan.standIn), which draws it, so it is found once a frame.
    standInCoverMargin(ctx, plan, t) {
        const standIn = plan.standIn = this.litStandIn(ctx) || !!this.standInSource() && 'standin'
        if (!standIn)
            return 0
        let k
        if (standIn === true || this.standInSource() === 'cache')
            k = this.surfaceCache && this.surfaceCacheBounds ? this.surfaceCache.width / this.surfaceCacheBounds.width : 0
        else
            k = this.standInPreview?.scale || 0
        if (!(k > 0))
            return 0
        return Math.ceil(2 + 2 * Math.max(t.a, t.d) / k)
    }
    // TASK-1545: the sky raster's blocks (atmosphericBackground.BLOCK_W x BLOCK_H, from the canvas's corner) the frame
    // draws: those meeting an open rectangle where it is not covered by the lit tiles' opaque pixels: a piece of a block in
    // an open rectangle is covered when every tile square it meets has a built tile (drawn this frame) and the piece is
    // inside the board outline as litSquareOpaque finds it (its margin of two device pixels: the tile is opaque there). A
    // block the outline crosses is cut into BLOCK_SPLIT wide blocks, found the same way (the sky along the board's edge).
    // The sky drawn is clipped to the open rectangles as before, so the pixels drawn are the same; those not drawn are
    // under opaque tile pixels. Null (the whole raster) when the sky cannot draw blocks for this canvas.
    // TASK-1553: standIn > 0 (frameCover's stand-in margin): a piece in a tile square not built (drawn from the stand-in) is
    // covered where the stand-in is opaque (inside the outline by that margin), as frameCover's squares.
    coverSkyBlocks(ctx, open, view, ox, oy, standIn = 0) {
        const cw = ctx.canvas.width, ch = ctx.canvas.height, B = atmosphericBackground
        if (!open.length || !B.blocksFor(cw, ch))
            return null
        const W = B.BLOCK_W, H = B.BLOCK_H, S = Math.min(W, B.BLOCK_SPLIT || W), blocks = []
        const covered = (x0, y0, x1, y1) => {
            let built = false, stood = false
            for (let v = Math.floor((y0 - oy) / LIT_TILE); v <= Math.floor((y1 - 1 - oy) / LIT_TILE); ++v)
                for (let u = Math.floor((x0 - ox) / LIT_TILE); u <= Math.floor((x1 - 1 - ox) / LIT_TILE); ++u) {
                    const key = u + ',' + v, tile = this.litHas(view, u, v) ? view.tiles.get(key) : undefined
                    if (!mapDepth.outline)
                        return false
                    if (tile?.litOutline === mapDepth.outline)
                        built = true
                    else if (!tile && standIn > 0 && !view.stale?.has(key))
                        stood = true
                    else
                        return false
                }
            return this.litSquareOpaque(view, x0 - ox, y0 - oy, x1 - ox, y1 - oy, stood ? Math.max(2, standIn) : 2, built || !stood)
        }
        const needed = (x, y, x1, y1) => {
            for (const r of open) {
                const px0 = Math.max(x, r.x), py0 = Math.max(y, r.y), px1 = Math.min(x1, r.x + r.w), py1 = Math.min(y1, r.y + r.h)
                if (px0 < px1 && py0 < py1 && !covered(px0, py0, px1, py1))
                    return true
            }
            return false
        }
        for (let y = 0; y < ch; y += H)
            for (let x = 0; x < cw; x += W) {
                const x1 = Math.min(cw, x + W), y1 = Math.min(ch, y + H)
                if (!needed(x, y, x1, y1))
                    continue
                if (S >= W || !this.litOutlineMeets(view, x - ox, y - oy, x1 - ox, y1 - oy))
                    blocks.push({x, y, w: x1 - x, h: y1 - y})
                else
                    for (let sx = x; sx < x1; sx += S)
                        if (needed(sx, y, Math.min(x1, sx + S), y1))
                            blocks.push({x: sx, y, w: Math.min(x1, sx + S) - sx, h: y1 - y})
            }
        return blocks
    }
    // TASK-1545: whether a side of the board outline's loop meets the device rectangle x0..x1 x y0..y1 of view's tile pixels
    // grown by litSquareOpaque's margin (two device pixels).
    litOutlineMeets(view, x0, y0, x1, y1) {
        const loop = mapDepth.outlineLoop
        if (!loop)
            return true
        const m = 2
        const left = (x0 - m - view.e) / view.a, right = (x1 + m - view.e) / view.a
        const top = (y0 - m - view.f) / view.d, bottom = (y1 + m - view.f) / view.d
        for (let k = 0; k < loop.length; ++k) {
            const p = loop[k], q = loop[(k + 1) % loop.length]
            if (Math.max(p.x, q.x) >= left && Math.min(p.x, q.x) <= right &&
                    Math.max(p.y, q.y) >= top && Math.min(p.y, q.y) <= bottom)
                return true
        }
        return false
    }
    // Whether the device rectangle x0..x1 x y0..y1 of view's tile pixels is opaque on a lit tile:
    // inside the board outline's loop (with a margin of two device pixels), where the underlay's
    // opaque fill under the surface has full coverage and every later draw on the tile keeps the
    // alpha (source-over, multiply, color-dodge, screen). A loop side whose bounds meet the
    // rectangle counts as crossing it.
    // TASK-1553: m the margin (device pixels), underlay false: the board's own underlay cache not needed (a stand-in's).
    litSquareOpaque(view, x0, y0, x1, y1, m = 2, underlay = true) {
        const loop = mapDepth.outlineLoop
        if (!loop || underlay && !mapDepth.underlayCache)
            return false
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
    // TASK-1553 (Grid.shadowClip): drawn whole but clipped to the open part the sky is drawn on (the sky's blocks in it, if
    // any): the rest of the canvas is under the board's opaque images.
    drawSlabShadow(ctx) {
        const open = this.coverOpen, sky = this.coverSky
        this.coverOpen = undefined
        this.coverSky = undefined
        if (open)
            mapDepth.ensureGeometry(this)
        const shadow = mapDepth.atmosphericShadow
        if (open && shadow) {
            const t = ctx.getTransform()
            const x0 = t.a * shadow.left + t.e, x1 = x0 + t.a * shadow.width
            const y0 = t.d * shadow.top + t.f, y1 = y0 + t.d * shadow.height
            const meets = r => r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0
            if (!open.some(meets))
                return
            if (Grid.shadowClip) {
                const rects = shadowClipRects(open, sky).filter(meets)
                if (!rects.length)
                    return
                ctx.save()
                clipToDeviceRects(ctx, rects)
                ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f)
                mapDepth.drawAtmosphericShadow(ctx, this)
                ctx.restore()
                return
            }
        }
        mapDepth.drawAtmosphericShadow(ctx, this)
    }
    // TASK-1571 (Grid.litGroundFill): the board's plain ground fill on ctx (the camera's transform) in the device rectangles
    // rects (whole device pixels): the opaque fill of the board outline in the underlay's colour (mapDepth.drawUnderlay's
    // solid map backing, under every tile), for squares without an exact picture this frame. visualsPerf.groundFill counts the
    // rectangles' device pixels within the board's bounds (the outline's box).
    drawGroundFill(ctx, rects) {
        if (!rects.length)
            return
        mapDepth.ensureGeometry(this)
        if (!mapDepth.outline)
            return
        const t = ctx.getTransform(), b = mapDepth.bounds
        ctx.save()
        clipToDeviceRects(ctx, rects)
        ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f)
        ctx.fillStyle = MapDepth.GROUND_FILL
        ctx.fill(mapDepth.outline)
        ctx.restore()
        ++this.groundFills
        if (b && typeof visualsPerf !== 'undefined' && visualsPerf.groundFill) {
            const bx0 = b.left * t.a + t.e, bx1 = b.right * t.a + t.e, by0 = b.top * t.d + t.f, by1 = b.bottom * t.d + t.f
            let px = 0
            for (const r of rects)
                px += Math.max(0, Math.min(r.x + r.w, bx1) - Math.max(r.x, bx0)) * Math.max(0, Math.min(r.y + r.h, by1) - Math.max(r.y, by0))
            visualsPerf.groundFill(px)
        }
    }
    // TASK-1553: the sky and the slab shadow on ctx (the camera's transform) in the device rectangles rects, which
    // frameCover left without them for a stand-in that is not drawn there after all.
    coverSkyUnder(ctx, rects) {
        const t = ctx.getTransform()
        ctx.save()
        clipToDeviceRects(ctx, rects)
        atmosphericBackground.draw(ctx)
        ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f)
        if (typeof drawBackgroundHints !== 'undefined')
            drawBackgroundHints(ctx)
        mapDepth.drawAtmosphericShadow(ctx, this)
        ctx.restore()
        ++this.coverSkyUnders
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
    // TASK-1546: the lit view for transform t's scale on ctx's canvas made by tasks (newLitViewSteps, as many steps a task as
    // fit LIT_VIEW_TASK_MS, the first always): the view once made (taken: the job ends), else null with the job queued. A job
    // for another scale or canvas size, or one whose light map changed meanwhile, is given up and started again.
    stepLitView(ctx, t) {
        const main = ctx.canvas
        let job = this.litViewJob
        if (job && (job.a !== t.a || job.d !== t.d || job.cw !== main.width || job.ch !== main.height ||
                job.rebuilds !== atmosphericLighting.rebuilds || job.mapScale !== atmosphericLighting.mapScale)) {
            this.litViewJob = undefined
            ++this.litViewJobsDropped
            job = undefined
        }
        if (job?.view) {
            this.litViewJob = undefined
            // Made from the board as it was: taken only if it holds for the board now, else made again.
            if (this.litViewHolds(ctx, job.view, t))
                return job.view
            ++this.litViewJobsDropped
            job = undefined
        }
        if (job)
            return null
        job = this.litViewJob = {a: t.a, d: t.d, cw: main.width, ch: main.height, rebuilds: atmosphericLighting.rebuilds,
            mapScale: atmosphericLighting.mapScale, steps: this.newLitViewSteps(t, main), view: null, tasks: 0}
        ++this.litViewJobs
        const run = gridTask(() => {
            if (this.litViewJob !== job || this !== grid)
                return
            const start = performance.now()
            let last = 0, step
            ++job.tasks
            do {
                const t0 = performance.now()
                step = job.steps.next()
                last = performance.now() - t0
            } while (!step.done && performance.now() - start + last <= LIT_VIEW_TASK_MS)
            if (step.done)
                job.view = step.value
            else
                setTimeout(run)
        })
        setTimeout(run)
        return null
    }
    // A view at transform t of the camera's canvas main (no tiles yet): the board state now, the
    // light map at the camera's scale and the edge of its lit cells.
    newLitView(t, main) {
        const steps = this.newLitViewSteps(t, main)
        let step
        while (!(step = steps.next()).done);
        return step.value
    }
    // TASK-1518: newLitView's work as a generator returning the view (startBuildSteps): a yield after the board state is
    // captured and litEdges' steps.
    *newLitViewSteps(t, main) {
        mapDepth.ensureGeometry(this)
        atmosphericLighting.lightMap(this)
        // TASK-1559: with sectors (Grid.litSectors) the tiles' grid is the board's device grid at the scale (e, f 0: tile u, v
        // is sector (t.a, u, v)), whatever the camera's offset; the frames move it by the camera's offset rounded to whole pixels.
        const sectors = this.litSectorsOn()
        const view = {a: t.a, d: t.d, e: sectors ? 0 : t.e, f: sectors ? 0 : t.f, cw: main.width, ch: main.height, tiles: new Map(),
            sectorLevel: sectors ? t.a : 0, madeAt: {e: t.e, f: t.f},
            rest: null, state: [], overlayCells: [], rebuilds: atmosphericLighting.rebuilds,
            mapScale: atmosphericLighting.mapScale}
        this.withLitState(view, () => this.captureSurfaceState())
        yield
        Object.assign(view, yield* this.litEdgesSteps(view))
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
        const steps = this.litEdgesSteps(view)
        let step
        while (!(step = steps.next()).done);
        return step.value
    }
    // TASK-1518: litEdges' work as a generator returning its value (a yield after each LIT_EDGE_STEP_CELLS cells' sides and
    // after each later pass), so a new board's first view is made in steps (startBuildSteps).
    *litEdgesSteps(view) {
        const cells = atmosphericLighting.collect(this, false).cells
        const margin = (atmosphericLighting.MAP_GROW + 1) * view.a / atmosphericLighting.mapScale + 2
        let key = basis.r + ',' + view.a + ',' + view.d + ',' + view.e + ',' + view.f + ',' + margin + '|'
        for (const {x, y} of cells)
            key += x + ',' + y + ';'
        if (this.litEdgesKept?.key === key)
            return this.litEdgesKept.edges
        const sides = new Map()
        let counted = 0
        for (const {pos} of cells) {
            if (++counted % LIT_EDGE_STEP_CELLS === 0)
                yield
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
        yield
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
        yield
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
        yield
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
    // TASK-1571: whether the board reaches tile square (u, v) of view (litTileSteps' test: else its tile is null).
    litTileReaches(view, u, v) {
        const P = LIT_TILE_PAD, b = mapDepth.bounds, X = u * LIT_TILE, Y = v * LIT_TILE
        if (!b)
            return true
        const left = (X - P - view.e) / view.a, top = (Y - P - view.f) / view.d
        const right = (X + LIT_TILE + P - view.e) / view.a, bottom = (Y + LIT_TILE + P - view.f) / view.d
        return !(right < b.left || left > b.right || bottom < b.top || top > b.bottom)
    }
    // TASK-1571 (Grid.litGroundFill): the squares of range (the canvas's, the grid at ox, oy) without a tile that the frame
    // builds itself (drawLitView): at most LIT_FRAME_TILE_CAP of those the board reaches, nearest the canvas's centre first
    // (the tasks and the Worker build the others, queueLitTiles; a square the board does not reach is not built: nothing is
    // drawn there). A set of 'u,v' keys.
    // Not built in the frame either: a square on its way from the Worker (litPending: it comes in a later frame, the ground fill
    // meanwhile) or one drawn without its tile otherwise (drawn(u, v): a clean sector of the camera's level, or after a zoom
    // the stretched levels; the tasks build its tile).
    litFrameBuilds(view, range, cw, ch, ox, oy, drawn) {
        const cu = (cw / 2 - ox) / LIT_TILE - 0.5, cv = (ch / 2 - oy) / LIT_TILE - 0.5, list = []
        const work = this.litFrameWork
        for (let v = range.v0; v <= range.v1; ++v)
            for (let u = range.u0; u <= range.u1; ++u) {
                if (this.litHas(view, u, v) || view.stale?.has(u + ',' + v) || !this.litTileReaches(view, u, v))
                    continue
                ++work.missing
                if (drawn(u, v))
                    ++work.drawn
                else if (this.litPending(view, u, v))
                    ++work.pending
                else
                    list.push({key: u + ',' + v, far: Math.hypot(u - cu, v - cv)})
            }
        list.sort((a, b) => a.far - b.far)
        const out = new Set(list.slice(0, Grid.litFrameBudget ? Grid.litFrameTilesFit(this) : LIT_FRAME_TILE_CAP).map(m => m.key))
        // TASK-1572 (Grid.litFrameBudget): their offscreen megapixels reserved for the frame (the composes after them fit the rest).
        if (Grid.litFrameBudget)
            Grid.frameTileMpAt = {frame: Grid.frameNo, mp: out.size * LIT_FRAME_TILE_MP}
        work.built += out.size
        if (Grid.litFrameBudget && out.size < Math.min(LIT_FRAME_TILE_CAP, list.length))
            work.overBudget = (work.overBudget || 0) + Math.min(LIT_FRAME_TILE_CAP, list.length) - out.size
        work.filled += list.length - out.size
        return out
    }
    // Tile (u, v) of view, built now if missing; null when the board does not reach it.
    // TASK-1439: each build timed (litTileCost, a tile the board reaches).
    // TASK-1564: sync, a frame drawing the tile now (drawLitView): built on the main thread; else made in the Worker
    // (SectorWorker) when it is on: the tile is then stored when its quarters come back (litTileArrived), undefined till then.
    litTile(view, u, v, sync = false) {
        const key = u + ',' + v
        if (!this.litHas(view, u, v) && !(!sync && this.litPending(view, u, v))) {
            const start = performance.now()
            this.sectorSync = sync
            let tile
            try {
                tile = this.buildLitTile(view, u, v)
            } finally {
                this.sectorSync = false
            }
            if (tile)
                litTileCost.add(performance.now() - start)
            if (tile?.workerPending)
                return undefined
            view.tiles.set(key, tile)
            this.releaseStaleTile(view, key)
            this.storeSector(view, u, v, tile)
        }
        return view.tiles.get(key)
    }
    // TASK-1439: builds tiles of view from list ({u, v}, the first cap of them as before, those built already skipped) while
    // the time the task has taken and one tile's estimate fit LIT_TASK_MS; atLeastOne: the first even when it does not
    // (the camera at rest or a view the frames draw live, so the lighting completes).
    // TASK-1453: a view the frames draw live (view.unbuilt, the first after a start or a new scale) builds all cap of them
    // in the task, as before TASK-1439 (one tile a task made a game start's first view settle seconds later).
    buildLitTiles(view, list, cap, atLeastOne) {
        const start = performance.now(), batch = view.unbuilt
        let built = 0
        // TASK-1546 (Grid.litTileSteps): but for a batch, a tile is built a step at a time (litTileStep, its steps timed:
        // litTileStepCost) while the task's time and the next step's estimate (the last step's) fit LIT_TASK_MS (at rest
        // LIT_REST_TASK_MS); the first step of the task even when it does not when atLeastOne. A tile under way (litTileJob) is
        // carried on in the next task.
        const stepped = Grid.litTileSteps && !batch
        // With the camera at rest (atLeastOne: the frames hold or draw the stand-in for the tiles not built yet) the steps fit
        // LIT_REST_TASK_MS, so the tiles are not drawn from the stand-in for many more frames than when built a tile a task.
        const budget = atLeastOne && !gameEvent.screen.surfaceMoving ? LIT_REST_TASK_MS : LIT_TASK_MS
        let steps = 0, last = litTileStepCost.ms
        const tiles = list.slice(0, cap)
        // The tile under way first, while it is still one to build.
        // TASK-1552 (Grid.litAhead): anywhere in the list (an order that changes with the camera's motion would give it up).
        const job = this.litTileJob
        if (Grid.litAhead && stepped && job && job.view === view && !tiles.some(m => m.u === job.u && m.v === job.v)) {
            const under = list.find(m => m.u === job.u && m.v === job.v)
            if (under)
                tiles.unshift(under)
            // TASK-1565: the tile under way left the ring (the list is the frame's ring): given up.
            else if (this.aheadOn()) {
                this.dropLitTileJob()
                ++this.aheadWork.cancelled
            }
        }
        if (stepped && job && job.view === view && tiles.some(m => m.u === job.u && m.v === job.v)) {
            const k = tiles.findIndex(m => m.u === job.u && m.v === job.v)
            tiles.unshift(...tiles.splice(k, 1))
        }
        // TASK-1562: after a zoom (levelMode) at most LEVEL_TILE_STEPS steps between two frames, within the frames' budget
        // (levelWorkLeft, LEVEL_TILE_STEP_CALLS a step), the rest by the next frame's task.
        const levels = stepped && this.levelMode()
        // TASK-1565: while the camera moves (Grid.sectorAhead) the steps between two frames share the frame's budget
        // (levelWorkLeft) too, at most AHEAD_TILE_STEPS, each spending the calls it made (litStepHolder; LEVEL_TILE_STEP_CALLS
        // its estimate before the first).
        const ahead = stepped && !levels && this.aheadOn(true)
        const stepCalls = {n: 0, max: Infinity}
        for (const {u, v, shown: onCanvas, soon} of tiles) {
            // TASK-1570: a ring tile the camera reaches soon is budgeted as one on the canvas
            const shown = onCanvas || soon
            if (this.litHas(view, u, v) || this.litPending(view, u, v))
                continue
            // TASK-1564: no new tile while the Worker's queue is full (the tile under way goes on; a first view's batch, drawn
            // live till its tiles come, is sent whole). The next frame's task goes on.
            // TASK-1570: a square on the canvas (shown) may fill the queue further (SectorWorker.busy(true)).
            if (!batch && Grid.sectorWorkerBusy(!!shown && Grid.litWorkerOrder) && !(this.litTileJob && this.litTileJob.view === view && this.litTileJob.u === u &&
                    this.litTileJob.v === v)) {
                ++this.litWorkerStops
                if (ahead)
                    ++this.aheadWork.stopQueue
                return
            }
            if (stepped) {
                for (;;) {
                    // TASK-1565 pass 7: with the Worker drawing, a settle's steps (levels) are bounded by their recording time
                    // as the ahead steps are (AHEAD_WORKER_FRAME_MS / CATCHUP for a square on the canvas), not LEVEL_TILE_STEPS:
                    // a whole-tile recording with the shared row memo (litStepMemo) takes ~1.5 ms a tile, and 4 steps a frame
                    // built half a tile a frame (artifacts/TASK-1565/preview/new-memo1: 3 s after the zoom to 0.151).
                    if (levels && Grid.aheadInWorker()) {
                        Grid.levelWorkLeft()
                        if (Grid.levelFrameWork.ms > 0 && Grid.levelFrameWork.ms + litTileStepCost.ms > (shown ? AHEAD_WORKER_CATCHUP_MS :
                                AHEAD_WORKER_FRAME_MS)) {
                            ++this.aheadWork.stopTime
                            ++this.levelWork.budgetStops
                            return
                        }
                    }
                    else if (levels) {
                        const left = Grid.levelWorkLeft()
                        if (left.tileSteps >= LEVEL_TILE_STEPS || left.calls < LEVEL_TILE_STEP_CALLS) {
                            ++this.levelWork.budgetStops
                            return
                        }
                        Grid.levelSpend(LEVEL_TILE_STEP_CALLS, 1)
                    }
                    else if (ahead) {
                        // The next step's estimate: the most the last steps of its kind (its index in the tile's steps) made.
                        const job = this.litTileJob, next = job && job.view === view && job.u === u && job.v === v ? job.count : 0
                        // TASK-1565 rework: with the Worker drawing (Grid.aheadInWorker) a step only records on the main thread: no
                        // offscreen pixels there and next to no real calls, so its cost is the recording's time
                        // (AHEAD_WORKER_FRAME_MS between two frames, with the next step's estimate litTileStepCost.ms), not
                        // AHEAD_TILE_STEPS or the megapixels.
                        // TASK-1565 pass 7: nor the frame's draw calls (aheadCallsLeft): its real calls are a handful (artifacts/
                        // TASK-1565/preview/new-memo3-ahead.out: 12 for 267 steps) and a frame of ~380 calls (over AHEAD_FRAME_TOTAL)
                        // stopped every lit tile (runs of 1447624a: superseded-1447624a/new-after-2 pan@0.151, 0 tiles in 38 frames).
                        const inWorker = Grid.aheadInWorker()
                        const stop = !inWorker && Grid.aheadCallsLeft() < litStepCalls.at(next) ? 'stopCalls' :
                            // (the first step between two frames always runs: a step estimate over the budget would stop
                            // them all, and with no step the estimate never comes down)
                            inWorker ? (Grid.levelFrameWork.ms > 0 && Grid.levelFrameWork.ms + litTileStepCost.ms > (shown ?
                                AHEAD_WORKER_CATCHUP_MS : AHEAD_WORKER_FRAME_MS) ? 'stopTime' : null) :
                            Grid.levelWorkLeft().tileSteps >= AHEAD_TILE_STEPS ? 'stopSteps' : Grid.aheadMpLeft() < AHEAD_STEP_MP ? 'stopMp' : null
                        if (stop) {
                            ++this.aheadWork[stop]
                            ++this.levelWork.budgetStops
                            return
                        }
                    }
                    // (TASK-1565 pass 7: nor a settle's with the Worker drawing: bounded by their time above, not LIT_TASK_MS)
                    if (performance.now() - start + last > budget && !(atLeastOne && !steps) && !ahead && !(levels && Grid.aheadInWorker())) {
                        // At rest the tile under way goes on in the next task at once (queueLitTileSteps), not a frame later.
                        if (budget === LIT_REST_TASK_MS && this.litTileJob)
                            this.queueLitTileSteps()
                        return
                    }
                    const t0 = performance.now(), n0 = Grid.frameCallsNow()
                    const index = this.litTileJob && this.litTileJob.view === view && this.litTileJob.u === u && this.litTileJob.v === v ?
                        this.litTileJob.count : 0
                    this.litStepHolder.calls = stepCalls
                    let done
                    try {
                        done = this.litTileStep(view, u, v)
                    } finally {
                        this.litStepHolder.calls = null
                    }
                    last = performance.now() - t0
                    litTileStepCost.add(last)
                    ++steps
                    if (levels && Grid.aheadInWorker()) {
                        Grid.levelFrameWork.ms += last
                        ++this.aheadWork.levelSteps
                        this.aheadWork.levelStepMs += last
                    }
                    if (ahead) {
                        const n = Grid.frameCallsNow() - n0
                        litStepCalls.add(n, index)
                        Grid.levelSpend(n, 1)
                        Grid.levelFrameWork.ms += last
                        if (!Grid.aheadInWorker())
                            Grid.aheadMpSpend(AHEAD_STEP_MP)
                        ++this.aheadWork.tileSteps
                        this.aheadWork.tileStepCalls += n
                        this.aheadWork.tileStepMs += last
                    }
                    if (done)
                        break
                }
                ++built
                continue
            }
            if (!batch && performance.now() - start + litTileCost.ms > LIT_TASK_MS && !(atLeastOne && !built))
                return
            this.litTile(view, u, v)
            ++built
        }
    }
    // TASK-1546: with the camera at rest, the tile under way (litTileJob) built on by the next task (buildLitTiles at rest's
    // budget, LIT_REST_TASK_MS, and again until it is done), as a tile was in one task before: the frames between are held.
    // Not while the camera moves or zooms, the view is another, the lit tasks defer (litTaskDefers) or the view's cell layer
    // is behind the board (litLayerBehind): the frames queue the tiles again then (queueLitTiles).
    queueLitTileSteps() {
        if (this.litTileStepsQueued)
            return
        this.litTileStepsQueued = true
        const snapshots = this.overlaySnapshots
        setTimeout(gridTask(() => {
            this.litTileStepsQueued = false
            const job = this.litTileJob, screen = gameEvent.screen
            if (!job || this !== grid || screen.surfaceMoving || screen.surfaceZooming || job.view !== this.litView ||
                    this.litTaskDefers(snapshots, true) || this.litLayerBehind(job.view))
                return
            ++this.litTileStepTasks
            atmosphericLighting.checkedOnce(this, () => this.buildLitTiles(job.view, [{u: job.u, v: job.v}], 1, true))
        }))
    }
    // TASK-1546: a step of tile (u, v) of view's build (litTileSteps: TASK-1552 on quarters of its own, so a tile built at once
    // meanwhile, litTile, draws on others), the tile under way (litTileJob) given up first when it is another
    // or no longer holds (litTileJobHolds). Returns whether the tile is done (in view.tiles, as litTile leaves it).
    litTileStep(view, u, v) {
        const key = u + ',' + v
        let job = this.litTileJob
        if (job && (job.view !== view || job.key !== key || !this.litTileJobHolds(job))) {
            this.dropLitTileJob()
            job = undefined
        }
        if (!job) {
            job = this.litTileJob = {view, key, u, v, steps: this.litTileSteps(view, u, v), edges: view.edges,
                outline: view.outline, rebuilds: atmosphericLighting.rebuilds, mapScale: atmosphericLighting.mapScale, ms: 0, count: 0}
            ++this.litTileJobs
        }
        const t0 = performance.now(), step = job.steps.next()
        job.ms += performance.now() - t0
        ++job.count
        if (!step.done)
            return false
        this.litTileJob = undefined
        const tile = step.value
        if (tile)
            litTileCost.add(job.ms)
        if (tile && this.aheadOn()) {
            ++this.aheadWork.tiles
            if (this.aheadOn(true))
                ++this.aheadWork.tilesMoving
        }
        // TASK-1564: its quarters made in the Worker: stored when they come back (litTileArrived).
        if (tile?.workerPending)
            return true
        view.tiles.set(key, tile)
        this.releaseStaleTile(view, key)
        this.storeSector(view, u, v, tile)
        return true
    }
    // TASK-1546: whether the tile under way still draws its view as a tile built now would: the view is the board's, the tile
    // not built meanwhile (litTile), the view's edge runs and outline (found again on every change the view takes: patch,
    // refresh, light map) and the light map the same.
    litTileJobHolds(job) {
        const view = job.view
        return view === this.litView && !view.tiles.has(job.key) && job.edges === view.edges && job.outline === view.outline &&
            job.rebuilds === atmosphericLighting.rebuilds && job.mapScale === atmosphericLighting.mapScale
    }
    dropLitTileJob() {
        const job = this.litTileJob
        if (!job)
            return
        this.litTileJob = undefined
        // Its canvases' state restored and its quarters given back (litTileSteps' finally).
        job.steps.return()
        ++this.litTileJobsDropped
    }
    // One task between frames: a band of the rest snapshot while the camera is at rest, else up
    // to LIT_TILE_BUDGET of the tiles within a tile of the canvas, nearest its centre first.
    queueLitTiles(view, t, cw, ch) {
        // TASK-1570: the frame's ring (litQueueAt: litTilePriority's order and cancels, the drain refill), taken before a task
        // already queued returns, and the worker's pending builds ordered by it (SectorWorker.pump).
        if (view && Grid.litWorkerOrder)
            this.noteLitQueue(view, t, cw, ch)
        if (this.litTilesQueued)
            return
        const snapshots = this.overlaySnapshots
        // No view yet: a step of the light map at the camera's scale (atmosphericLighting.stepLightMap).
        if (!view) {
            this.litTilesQueued = true
            setTimeout(gridTask(() => {
                this.litTilesQueued = false
                if (this === grid && otherSettings.atmosphericVisuals && !this.litView && !gameEvent.screen.surfaceZooming &&
                        !this.litTaskDefers(snapshots, true))
                    atmosphericLighting.stepLightMap(this)
            }))
            return
        }
        const ox = Math.round(t.e - view.e), oy = Math.round(t.f - view.f)
        // TASK-1552 (Grid.litAhead): the ring round the canvas (litAheadRange: LIT_AHEAD_RING tiles, more on the sides the camera
        // moves to): the tiles on the canvas first (nearest its centre), then the others in litAheadWhen's order (while the
        // camera moves: by when it reaches them).
        const ahead = Grid.litAhead ? this.litAheadRange(view, cw, ch, ox, oy) : null, moving = gameEvent.screen.surfaceMoving
        const range = ahead ? ahead.range : this.litTileRange(cw, ch, ox, oy, 1), missing = []
        const shownRange = this.litTileRange(cw, ch, ox, oy, 0)
        const cu = (cw / 2 - ox) / LIT_TILE - 0.5, cv = (ch / 2 - oy) / LIT_TILE - 0.5
        // TASK-1570 (Grid.litWorkerOrder): not the tiles on their way from the worker (litPending): they took the first places of
        // the task's LIT_AHEAD_CAP / LIT_TILE_BUDGET (buildLitTiles skips them), so a task started 2-3 new tiles where it could 8.
        const order = Grid.litWorkerOrder
        for (let v = range.v0; v <= range.v1; ++v)
            for (let u = range.u0; u <= range.u1; ++u)
                if (!this.litHas(view, u, v) && !(order && this.litPending(view, u, v))) {
                    const shown = u >= shownRange.u0 && u <= shownRange.u1 && v >= shownRange.v0 && v <= shownRange.v1
                    const when = ahead && !shown ? this.litAheadWhen(ahead, u, v, !moving) : 0
                    // TASK-1570 (Grid.litWorkerOrder): soon, a ring tile the moving camera reaches within LIT_AHEAD_MS (litAheadWhen
                    // <= 1): as urgent as one on the canvas (buildLitTiles: AHEAD_WORKER_CATCHUP_MS, SectorWorker.busy(true)).
                    missing.push({u, v, shown, soon: order && moving && !shown && !!ahead && when <= 1,
                        far: ahead && !shown ? LIT_AHEAD_LATER + when : Math.hypot(u - cu, v - cv)})
                }
        const rest = view.rest
        const banding = rest && rest.done < LIT_REST_BANDS && rest.e === t.e && rest.f === t.f
        // TASK-1372: the snapshot's split, a step a task (cellSplitStep), not during its patch.
        if (view.splitJob && !banding && !view.patch) {
            this.litTilesQueued = true
            setTimeout(gridTask(() => {
                this.litTilesQueued = false
                if (view !== this.litView || !view.splitJob || view.patch || gameEvent.screen.surfaceZooming || this.litTaskDefers(snapshots, true) ||
                        !this.litSplitHolds(view))
                    return
                if (this.cellSplitStep(view.splitJob, SURFACE_STEP_MS))
                    view.splitJob = undefined
            }))
            return
        }
        if (!banding && !missing.length) {
            view.patchedTiles = false
            if (this.litQueueAt?.view === view)
                this.litQueueAt.refill = false
            return
        }
        missing.sort((a, b) => a.far - b.far)
        // TASK-1570: whether the worker's drain should queue this again (tiles missing that are not on their way).
        if (this.litQueueAt?.view === view)
            this.litQueueAt.refill = !banding
        this.litTilesQueued = true
        // TASK-1439: a task of tiles with the camera at rest when the browser is idle (LIT_IDLE_TIMEOUT at most); TASK-1453: a
        // view the frames draw live at once (setTimeout).
        // TASK-1570 (Grid.litWorkerOrder): not while tiles on the canvas are missing (litQueueAt.shownMissing): an idle callback
        // waited up to LIT_IDLE_TIMEOUT across frames in a pan's short pauses, and no lit task could be queued meanwhile.
        const idle = !banding && !view.unbuilt && !gameEvent.screen.surfaceMoving && typeof requestIdleCallback === 'function' &&
            !(Grid.litWorkerOrder && this.litQueueAt?.view === view && this.litQueueAt.shownMissing)
        ;(idle ? fn => requestIdleCallback(fn, {timeout: LIT_IDLE_TIMEOUT}) : setTimeout)(gridTask(() => {
            this.litTilesQueued = false
            // Nothing is built inside a zoom gesture (its frames keep their live light), nor (TASK-1316) for a board the
            // view's cell layer is behind (the next frame brings it up, followCellLayer; a tile built now would also bring
            // the light map's owners up in the task drawing from it).
            // (TASK-1569: litTaskDefers asked once: it keeps whether this lit task already deferred, litDeferred)
            const otherView = view !== this.litView, zooming = gameEvent.screen.surfaceZooming
            const defers = !otherView && !zooming && this.litTaskDefers(snapshots, true)
            if (otherView || zooming || defers || this.litLayerBehind(view)) {
                // TASK-1565 rework: a moving camera's tile task that built nothing for these (visualsPerf work.sectorAhead)
                if (gameEvent.screen.surfaceMoving)
                    ++this.aheadWork[otherView ? 'litOtherView' : zooming ? 'litZooming' : defers ? 'litDefers' : 'litBehind']
                return
            }
            if (gameEvent.screen.surfaceMoving)
                ++this.aheadWork.litTasks
            if (banding && !gameEvent.screen.surfaceMoving) {
                // The tiles on the canvas the frames draw from the stand-in first (at most LIT_TILE_BUDGET a task, a view
                // the frames draw live LIT_FIRST_TILE_BUDGET), then the bands.
                const shown = missing.filter(m => m.shown && !this.litHas(view, m.u, m.v))
                if (shown.length) {
                    // TASK-1377: the task's tiles compare the board's light state once (atmosphericLighting.checkedOnce).
                    atmosphericLighting.checkedOnce(this, () =>
                        this.buildLitTiles(view, shown, view.unbuilt ? LIT_FIRST_TILE_BUDGET : LIT_TILE_BUDGET, true))
                }
                else if (view.rest === rest && rest.done < LIT_REST_BANDS && !(rest.done === LIT_REST_BANDS - 1 && this.litMaskStep(view, rest)))
                    this.buildLitRestBand(view, rest, rest.done)
                return
            }
            // After a patch dropped some, one a task while the camera rests.
            const moving = gameEvent.screen.surfaceMoving
            const budget = view.unbuilt ? LIT_FIRST_TILE_BUDGET :
                view.patchedTiles && !moving ? LIT_TILE_PATCHED_BUDGET : LIT_TILE_BUDGET
            // TASK-1439: tiles that fit LIT_TASK_MS; while the camera moves none when one tile does not fit (the frames draw
            // the stand-in), at rest and for a view the frames draw live at least one.
            // TASK-1552 (Grid.litAhead + Grid.litAheadMoving): while the camera moves too, a step at least (the tile under way carried on by the next
            // task), and the next task queued at once while ring tiles are missing, at most LIT_AHEAD_TASKS tasks between two
            // frames (litAheadTasks, reset by the frame), each within LIT_TASK_MS but for its first step.
            // Only with Grid.litAheadMoving (off: TASK-1552 measured the builds' offscreen drawing doubling the heavy pan frames).
            const ahead = Grid.litAhead && (Grid.litAheadMoving || this.aheadOn())
            if (moving && !view.unbuilt && litTileCost.ms > LIT_TASK_MS && !ahead)
                return
            atmosphericLighting.checkedOnce(this, () => this.buildLitTiles(view, missing, ahead && moving ? LIT_AHEAD_CAP : budget,
                !moving || view.unbuilt || ahead))
            if (ahead && moving && ++this.litAheadTasks < LIT_AHEAD_TASKS && missing.some(m => !this.litHas(view, m.u, m.v)))
                this.queueLitTiles(view, t, cw, ch)
        }))
    }
    // TASK-1552: the lit view's tiles to keep built round the canvas at offset ox, oy: the canvas's tiles grown by LIT_AHEAD_RING,
    // and on each side the camera moves to (litMotion: its last frames' velocity) by the tiles it crosses in LIT_AHEAD_MS, at
    // most LIT_AHEAD_MAX. {range, ox, oy, cw, ch, mx, my}: mx, my the canvas's motion over the view (device pixels a ms).
    // TASK-1570 (Grid.litAheadSized): the reach on each side sized from the camera's velocity and the measured time a lit tile
    // takes to build (litBuildMs): litReach. The ring's tiles at most LIT_AHEAD_BYTES_SHARE of the lit sectors' budget (the
    // larger reach cut first), so a ring never evicts the canvas's own tiles.
    litAheadRange(view, cw, ch, ox, oy) {
        const m = this.litMotion && this.litMotion.view === view ? this.litMotion : null
        const mx = m ? -m.vx : 0, my = m ? -m.vy : 0
        const r = this.litTileRange(cw, ch, ox, oy, LIT_AHEAD_RING)
        let rx, ry, sx = 0, sy = 0
        if (Grid.litAheadSized) {
            const ms = this.litBuildMs(), cols = r.u1 - r.u0 + 1, rows = r.v1 - r.v0 + 1
            rx = this.litReach(mx, rows, ms)
            ry = this.litReach(my, cols + rx, ms)
            // TASK-1570: on every side, the reach of the recent peak speed (litPeakNow), at most LIT_AHEAD_REST_MAX: where a
            // pan from rest gets to before its motion is known.
            const p = this.litPeakNow()
            sx = Math.min(LIT_AHEAD_REST_MAX, this.litReach(p.x, rows, ms))
            sy = Math.min(LIT_AHEAD_REST_MAX, this.litReach(p.y, cols, ms))
            const most = this.sectors ? Math.floor(this.sectors.budget * LIT_AHEAD_BYTES_SHARE / (LIT_TILE * LIT_TILE * 4)) : Infinity
            // (the rest reach cut first, then the larger of the motion's)
            while ((rx || ry || sx || sy) && (cols + rx + 2 * sx) * (rows + ry + 2 * sy) > most) {
                if (sx || sy) {
                    if (sx >= sy) --sx
                    else --sy
                }
                else if (rx >= ry) --rx
                else --ry
            }
            r.u0 -= sx
            r.u1 += sx
            r.v0 -= sy
            r.v1 += sy
        }
        else {
            const reach = speed => Math.min(LIT_AHEAD_MAX, Math.ceil(Math.abs(speed) * LIT_AHEAD_MS / LIT_TILE))
            rx = mx ? reach(mx) : 0
            ry = my ? reach(my) : 0
        }
        if (mx > 0) r.u1 += rx
        else if (mx < 0) r.u0 -= rx
        if (my > 0) r.v1 += ry
        else if (my < 0) r.v0 -= ry
        return {range: r, ox, oy, cw, ch, mx, my, rx, ry, sx, sy}
    }
    // TASK-1570: the tiles the ring reaches past LIT_AHEAD_RING on a side the camera moves to at speed (device pixels a ms),
    // across tiles to build for each tile it crosses (the ring's extent along the other axis), ms a tile's build: the camera
    // crosses d tiles in d * LIT_TILE / speed ms, and the queue builds them in LIT_AHEAD_MS (the lead: a few frames and the
    // queue's wait) + d * across * ms, so d = speed * LIT_AHEAD_MS / (LIT_TILE - speed * across * ms) (the builds keep up), at
    // most LIT_AHEAD_REACH_MAX (also when they cannot: the denominator <= 0).
    litReach(speed, across, ms) {
        const s = Math.abs(speed)
        if (!(s > 0))
            return 0
        const spare = LIT_TILE - s * across * ms
        return Math.min(LIT_AHEAD_REACH_MAX, spare > 0 ? Math.ceil(s * LIT_AHEAD_MS / spare) : Infinity)
    }
    // TASK-1570: the measured time (ms) a lit tile takes to build: with the Worker drawing the slower of its mean for a lit
    // tile (SectorWorker.kindMs) and the main thread's recording (litTileCost), else the main-thread build (litTileCost).
    litBuildMs() {
        const main = litTileCost.ms || 0
        return Grid.aheadInWorker() ? Math.max(SectorWorker.kindMs('lit'), main) : main
    }
    // TASK-1570 (Grid.litWorkerOrder): the frame's lit ring at queueLitTiles (litQueueAt: view, its ahead range, the canvas's
    // tiles and centre, whether the camera moves; the drain refill's arguments; refill kept while the view is the same), and
    // the worker's pending builds ordered by it.
    noteLitQueue(view, t, cw, ch) {
        const ox = Math.round(t.e - view.e), oy = Math.round(t.f - view.f)
        const ahead = Grid.litAhead ? this.litAheadRange(view, cw, ch, ox, oy) : null
        const old = this.litQueueAt
        this.litQueueAt = {view, t, cw, ch, ahead, range: ahead ? ahead.range : this.litTileRange(cw, ch, ox, oy, 1),
            shown: this.litTileRange(cw, ch, ox, oy, 0), cu: (cw / 2 - ox) / LIT_TILE - 0.5, cv: (ch / 2 - oy) / LIT_TILE - 0.5,
            moving: !!gameEvent.screen.surfaceMoving, refill: old?.view === view ? old.refill : false, shownMissing: false}
        const q = this.litQueueAt, r = q.shown
        for (let v = r.v0; v <= r.v1 && !q.shownMissing; ++v)
            for (let u = r.u0; u <= r.u1; ++u)
                if (!this.litHas(view, u, v)) {
                    q.shownMissing = true
                    break
                }
        if (ahead)
            this.aheadWork.reach = (ahead.rx || 0) + (ahead.ry || 0) + (ahead.sx || 0) + (ahead.sy || 0)
        if (Grid.sectorWorkerOn())
            SectorWorker.pump()
    }
    // TASK-1570: the worker's order for lit tile build rec (lower first; SectorWorker.pump): a tile on the canvas by its
    // distance from the canvas's centre (tiles), else LIT_AHEAD_LATER + litAheadWhen (by when the camera reaches it); null
    // (cancelled) for another view than the board's, or a tile outside the frame's ring (the camera left it behind).
    litTilePriority(rec) {
        const q = this.litQueueAt
        if (this !== grid || rec.view !== this.litView)
            return null
        if (!q || q.view !== rec.view)
            return LIT_AHEAD_LATER
        const {u, v} = rec, s = q.shown, r = q.range
        if (u >= s.u0 && u <= s.u1 && v >= s.v0 && v <= s.v1)
            return Math.hypot(u - q.cu, v - q.cv)
        if (u < r.u0 || u > r.u1 || v < r.v0 || v > r.v1)
            return null
        return LIT_AHEAD_LATER + (q.ahead ? this.litAheadWhen(q.ahead, u, v, !q.moving) : 0)
    }
    // TASK-1552: the order of tile (u, v) of litAheadRange's ahead, not on the canvas, among the ring's tiles to build (lower
    // first): while the camera moves (rest false) the time the canvas takes to reach it at this motion (LIT_AHEAD_MS units),
    // else (or never reached) LIT_AHEAD_MAX plus its distance from the canvas (tiles).
    litAheadWhen(ahead, u, v, rest) {
        const {ox, oy, cw, ch, mx, my} = ahead
        const x0 = u * LIT_TILE + ox, y0 = v * LIT_TILE + oy, x1 = x0 + LIT_TILE, y1 = y0 + LIT_TILE
        const gap = Math.max(0, -x1, x0 - cw, -y1, y0 - ch) / LIT_TILE
        if (rest)
            return LIT_AHEAD_MAX + gap
        // Along one axis: 0 when the tile's square meets the canvas, else the time until it does (Infinity: moving away).
        const axis = (a0, a1, size, speed) => a1 <= 0 ? (speed < 0 ? a1 / speed : Infinity) : a0 >= size ? (speed > 0 ? (a0 - size) / speed : Infinity) : 0
        const when = Math.max(axis(x0, x1, cw, mx), axis(y0, y1, ch, my))
        return when < Infinity ? when / LIT_AHEAD_MS : LIT_AHEAD_MAX + gap
    }
    // TASK-1552: the canvas's motion over the lit view (litMotion, device pixels a ms) from a frame at offset t.e, t.f of view.
    followLitMotion(view, t) {
        const now = performance.now(), m = this.litMotion
        this.litAheadTasks = 0
        if (!m || m.view !== view || now - m.time > LIT_MOTION_GAP_MS) {
            this.litMotion = {view, e: t.e, f: t.f, time: now, vx: m && m.view === view ? m.vx : 0, vy: m && m.view === view ? m.vy : 0}
            return
        }
        const dt = now - m.time
        if (dt <= 0)
            return
        if (t.e !== m.e || t.f !== m.f) {
            const k = Math.min(1, dt / LIT_MOTION_SMOOTH_MS)
            m.vx += ((t.e - m.e) / dt - m.vx) * k
            m.vy += ((t.f - m.f) / dt - m.vy) * k
            // TASK-1570: the recent peak speed on each axis (litPeakNow), for the ring at rest.
            if (Grid.litAheadSized) {
                const p = this.litPeakNow(now)
                p.x = Math.max(p.x, Math.abs(m.vx))
                p.y = Math.max(p.y, Math.abs(m.vy))
            }
        }
        m.e = t.e
        m.f = t.f
        m.time = now
    }
    // TASK-1570: the camera's recent peak speed on each axis (device pixels a ms; litPeak, any view: the screen's motion), decayed
    // by LIT_AHEAD_PEAK_MS to now: a pan starting from rest (a fling) moved 1-2 tiles in its first frame on the phone capture
    // (artifacts/TASK-1570/change.md), before the motion's own reach exists.
    litPeakNow(now = performance.now()) {
        const p = this.litPeak ||= {x: 0, y: 0, time: now}
        if (now > p.time) {
            const k = Math.exp(-(now - p.time) / LIT_AHEAD_PEAK_MS)
            p.x *= k
            p.y *= k
            p.time = now
        }
        return p
    }
    // TASK-1518: before the rest snapshot's last band (whose finish starts its split, prepareLitCellLayer -> startCellSplit ->
    // cellLayerCells), a step of the cell mask that split takes (the same key, builder and cache: cellMaskSteps), as the
    // surface cache's build does before its finish (surfaceMaskSteps); it was ~80 ms in that task on the user's desktop.
    // Returns whether it ran one (the mask not kept yet).
    litMaskStep(view, rest) {
        if (!Grid.cellLayerSplitJobs || !rest.canvas.cellLayered || rest.maskSteps === null)
            return false
        let job = rest.maskSteps
        if (!job) {
            const W = rest.canvas.width, H = rest.canvas.height
            const {key, a, d, e, f, reach} = this.cellMaskKey(W, H, g => this.setLitRestTransform(g, view, rest))
            if (cellMaskCache.has(key)) {
                rest.maskSteps = null
                return false
            }
            const board = this
            job = rest.maskSteps = (function* () {
                const mask = yield* board.cellMaskSteps(W, H, a, d, e, f, reach)
                if (!cellMaskCache.has(key))
                    rememberCellMask(key, mask)
            })()
        }
        if (runSteps(job, SURFACE_STEP_MS))
            rest.maskSteps = null
        return true
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
    // TASK-1568: count = the caller gives up its task when true: the conditions that held are counted (aheadWork.litDeferBy).
    // TASK-1569 (Grid.litShareTurns): never deferred forever (on the user's phone capture the surface cache's split task, queued
    // by every frame after the lit task and stepping only outside a zoom's quiet, deferred 456 of 458 moving lit tasks: tiles on
    // the canvas drawn from the stand-in for seconds, artifacts/TASK-1568/defer-causes.md). The two tasks' drawing in one pause
    // stays bounded by time instead: while the camera moves the lit task shares the pause (its steps within the frame's time
    // budget, AHEAD_WORKER_FRAME_MS / LIT_TASK_MS, buildLitTiles; the surface task a step of SURFACE_STEP_MS); at rest it defers
    // once and the next lit task (the next pause, litDeferred) runs within its own budget (LIT_REST_TASK_MS). A queued surface
    // task that will draw nothing (surfaceTaskIdle) is not waited for.
    litTaskDefers(snapshots, count = false) {
        if (!Grid.litStandIns)
            return false
        const queued = !!this.surfaceCacheQueued, idle = Grid.litShareTurns && queued && this.surfaceTaskIdle()
        const surfaceQueued = queued && !idle, overlayQueued = !!this.overlayComposite?.queued,
            overlaySnapshot = this.overlaySnapshots !== snapshots
        const held = surfaceQueued || overlayQueued || overlaySnapshot
        if (Grid.litShareTurns && count) {
            if (idle && this.aheadWork)
                ++this.aheadWork.litIdleSurface
            const moving = typeof gameEvent !== 'undefined' && !!gameEvent.screen?.surfaceMoving
            if (!held || moving || this.litDeferred) {
                if (held && this.aheadWork)
                    ++this.aheadWork.litShared[moving ? 'moving' : 'rest']
                this.litDeferred = false
                return false
            }
            this.litDeferred = true
        }
        if (count && held && this.aheadWork) {
            const by = this.aheadWork.litDeferBy
            if (surfaceQueued) ++by.surfaceQueued
            if (overlayQueued) ++by.overlayQueued
            if (overlaySnapshot) ++by.overlaySnapshot
        }
        return held
    }
    // TASK-1569: whether the queued surface cache task (surfaceCacheQueued) will draw nothing when it runs: a split task in a zoom's
    // quiet with the cache there (prepareSurfaceCache: it steps only outside Grid.zoomQuiet or when cacheUrgent).
    surfaceTaskIdle() {
        return this.surfaceQueuedKind === 'split' && Grid.zoomQuiet() && !this.cacheUrgent()
    }
    // Draws tile (u, v) of view as the direct draw draws the canvas there, without the sky: the
    // surface, the buildings and the light but in view's edge runs (drawLitEdges lights them in
    // the frame).
    buildLitTile(view, u, v) {
        // TASK-1546: the steps (litTileSteps) run at once.
        const steps = this.litTileSteps(view, u, v)
        let step
        while (!(step = steps.next()).done);
        return step.value
    }
    // TASK-1546: buildLitTile's drawing in steps (a generator; its value the tile, null when the board does not reach it): the
    // scene's underlay and sides, the grout, the cells' tiles in LIT_TILE_HEX_STEPS runs, the shadows, fog and rim, the
    // buildings, the light. The calls are the same, in the same order, on the same canvases, whether the steps run in one task
    // or several (Grid.buildLitTiles); the canvases' state restored and the quarters given back to the pool when it is given up
    // (return()).
    // TASK-1552: each step draws straight into the tile's quarters (litTileParts: LIT_TILE_PART canvases, those the board
    // cannot reach left out), each under the camera's transform moved to it: no build canvas copied into quarters, no pad
    // drawn round the tile (a padded build's shown pixels differ by at most a few levels: probes/pad-test.json). A quarter is
    // cleared only when it was drawn before and the board's underlay (an opaque fill of its outline, drawUnderlay) does not
    // cover it whole (litSquareOpaque; one that it covers gets the fill as a rectangle). (Not the grout: a quarter's last row
    // is not quite opaque under the grout's fill.)
    *litTileSteps(view, u, v) {
        const P = LIT_TILE_PAD, b = mapDepth.bounds, X = u * LIT_TILE, Y = v * LIT_TILE
        // Null as for the padded square before TASK-1552 (the tiles the board reaches are the same).
        const left = (X - P - view.e) / view.a, top = (Y - P - view.f) / view.d
        const right = (X + LIT_TILE + P - view.e) / view.a, bottom = (Y + LIT_TILE + P - view.f) / view.d
        if (right < b.left || left > b.right || bottom < b.top || top > b.bottom)
            return null
        mapDepth.ensureGeometry(this)
        const tile = this.litTileParts(view, X, Y), Q = LIT_TILE_PART, gradients = litGradientSource()
        const quarters = []
        for (let k = 0; k < 4; ++k) {
            const part = tile.parts[k]
            if (!part)
                continue
            const px = X + (k & 1) * Q, py = Y + (k >> 1) * Q
            part.gradientSource = gradients
            sectorEdited(part)
            // TASK-1559: a sector's quarter draws the same whatever the camera: its window is its own square (drawRange and
            // onCanvas add their hexagon margins round it).
            part.litWindow = view.sectorLevel ? {left: 0, top: 0, right: Q, bottom: Q} :
                {left: Math.min(0, -px), top: Math.min(0, -py), right: Math.max(Q, view.cw - px), bottom: Math.max(Q, view.ch - py)}
            const inside = this.litSquareOpaque(view, px, py, px + Q, py + Q)
            quarters.push({part, g: part.getContext('2d'), px, py, inside, clear: part.litDrawn && !inside,
                underlay: {left: (px - view.e) / view.a, top: (py - view.f) / view.d, right: (px + Q - view.e) / view.a, bottom: (py + Q - view.f) / view.d}})
            part.litDrawn = true
        }
        // TASK-1563: the quarters drawn through SectorDraw: each step recorded into the tile's sector snapshot (a quarter a
        // target, q.g its recording context), then the step's runs drawn on the quarter (flush).
        let sector = null, whole = null, drawn = quarters
        if (Grid.sectorModule) {
            const level = view.a, transform = {a: level, b: 0, c: 0, d: level, e: view.e - X, f: view.f - Y}
            const range = this.drawRange({getTransform: () => transform, canvas: {width: LIT_TILE, height: LIT_TILE}}, true)
            sector = this.sectorSnapshot('lit', level, u, v, range)
            // TASK-1565 pass 6 (Grid.litTileWhole): with the Worker drawing the pictures, the tile's steps are recorded once,
            // on the whole tile (a LIT_TILE canvas: litWholeCanvas), not once a quarter: the steps' cell walks, union paths
            // and casters (drawShadows, the grout) were made ~4 times a tile on the main thread (artifacts/TASK-1565/preview/
            // new-prof-breakdown.out). The worker draws the tile once and cuts the quarters out of it (the target's crops); a
            // build the worker cannot make (mainOnly) is drawn on the whole canvas and copied into the quarters
            // (litWholeToQuarters).
            if (Grid.litTileWhole && sector.sink.worker && quarters.length) {
                const canvas = this.litWholeCanvas ||= document.createElement('canvas')
                if (canvas.width !== LIT_TILE || canvas.height !== LIT_TILE) {
                    canvas.width = LIT_TILE
                    canvas.height = LIT_TILE
                }
                canvas.gradientSource = gradients
                canvas.litWindow = view.sectorLevel ? {left: 0, top: 0, right: LIT_TILE, bottom: LIT_TILE} :
                    {left: Math.min(0, -X), top: Math.min(0, -Y), right: Math.max(LIT_TILE, view.cw - X), bottom: Math.max(LIT_TILE, view.ch - Y)}
                whole = {part: canvas, g: canvas.getContext('2d'), px: X, py: Y, size: LIT_TILE, whole: true,
                    inside: this.litSquareOpaque(view, X, Y, X + LIT_TILE, Y + LIT_TILE),
                    underlay: {left: (X - view.e) / view.a, top: (Y - view.f) / view.d, right: (X + LIT_TILE - view.e) / view.a,
                        bottom: (Y + LIT_TILE - view.f) / view.d}}
                whole.recorder = new SectorRecorder(whole.g, sector.snapshot, sector.sink, -1, this.litStepHolder)
                whole.recorder.entry.crops = quarters.map(q => [tile.parts.indexOf(q.part), q.px - X, q.py - Y, Q, Q])
                whole.g = whole.recorder.context
                drawn = [whole]
                ++this.aheadWork.whole
            }
            else
                for (const q of quarters) {
                    const k = tile.parts.indexOf(q.part)
                    q.recorder = new SectorRecorder(q.g, sector.snapshot, sector.sink, k, this.litStepHolder)
                    q.recorder.entry.x = (k & 1) * Q
                    q.recorder.entry.y = (k >> 1) * Q
                    q.g = q.recorder.context
                }
        }
        const flush = () => {
            if (sector)
                for (const q of drawn)
                    q.recorder.flush()
        }
        // A step drawn into each quarter, the union paths it traces shared by the quarters (atmosphericLighting.pathMemo), the
        // lamp overlays and cell tiles drawn from their crop boxes (cropOverlays).
        const memo = this.litStepMemo(view)
        const each = draw => {
            atmosphericLighting.pathMemo = memo
            atmosphericLighting.cropOverlays = true
            try {
                for (const q of drawn) {
                    q.g.setTransform(view.a, 0, 0, view.d, view.e - q.px, view.f - q.py)
                    draw(q.g, q)
                }
            } finally {
                atmosphericLighting.pathMemo = null
                atmosphericLighting.cropOverlays = false
            }
        }
        let done = false
        for (const q of drawn)
            q.g.save()
        try {
            for (const {g, clear, whole: all} of drawn) {
                g.setTransform(1, 0, 0, 1, 0, 0)
                // (the whole canvas is drawn on only by a build the worker cannot make: cleared first then)
                if (clear || all)
                    g.clearRect(0, 0, all ? LIT_TILE : Q, all ? LIT_TILE : Q)
                // As drawMain leaves the main canvas before the board.
                g.lineJoin = 'round'
                g.lineCap = 'round'
            }
            // The underlay cache's part grown by two of its pixels, so the quarter's edge pixels sample it as one draw over
            // the canvas does.
            const cache = mapDepth.underlayCache, grow = cache ? 2 * mapDepth.cacheBounds.width / cache.width : 0
            // drawLitScene's parts, the hexagons' (drawHexagons) as its grout and runs of the cells' tiles.
            each((g, q) => {
                const r = q.underlay
                LIT_SCENE_PARTS[0](this, g, {left: r.left - grow, top: r.top - grow, right: r.right + grow, bottom: r.bottom + grow, inside: q.inside})
            })
            flush()
            yield
            each(g => this.drawHexagons(g, {grout: true, n: 0}))
            flush()
            yield
            for (let k = 0; k < LIT_TILE_HEX_STEPS; ++k) {
                each(g => this.drawHexagons(g, {k, n: LIT_TILE_HEX_STEPS, grout: false}))
                flush()
                yield
            }
            for (const part of LIT_SCENE_PARTS.slice(2)) {
                each(g => part(this, g))
                flush()
                yield
            }
            // The light everywhere on the quarter but in the edge runs (even-odd: they do not overlap).
            for (const {g, px, py, size = Q} of drawn) {
                g.setTransform(1, 0, 0, 1, 0, 0)
                g.beginPath()
                g.rect(0, 0, size, size)
                for (const run of view.edges) {
                    const x0 = Math.max(run.x - px, 0), y0 = Math.max(run.y - py, 0)
                    const x1 = Math.min(run.x + run.w - px, size), y1 = Math.min(run.y + run.h - py, size)
                    if (x0 < x1 && y0 < y1) g.rect(x0, y0, x1 - x0, y1 - y0)
                }
                g.clip('evenodd')
            }
            each(g => atmosphericLighting.lightTile(g, this, view.outline))
            done = true
        } finally {
            for (const q of drawn)
                q.g.restore()
            if (sector)
                for (const q of drawn)
                    q.recorder.end()
            if (!done)
                this.releaseLitTile(tile)
        }
        if (sector && Grid.onSectorSnapshot)
            Grid.onSectorSnapshot(sector.snapshot, sector.sink.sprites, tile.parts)
        tile.litOutline = mapDepth.outline
        // The board outline the tile's drawn square is opaque under (frameCover), if any.
        tile.litOpaque = this.litSquareOpaque(view, X, Y, X + LIT_TILE, Y + LIT_TILE) ? mapDepth.outline : null
        // TASK-1564: the quarters made in the Worker (the recording drew nothing on them): the tile waits in view.workerTiles
        // (litPending) for them, litTileArrived; else (main only, the fallback) they were drawn here.
        if (sector) {
            const key = u + ',' + v
            const rec = {view, key, u, v, tile, edges: view.edges, outline: view.outline, rebuilds: atmosphericLighting.rebuilds,
                mapScale: atmosphericLighting.mapScale, gen: this.sectorGen}
            // TASK-1570: posted to the worker in litTilePriority's order (cancelled when the camera left its square).
            if (this.sectorSubmit(sector, out => this.litTileArrived(rec, out), () => this.litTileFailed(rec),
                    Grid.litWorkerOrder ? () => this.litTilePriority(rec) : null)) {
                tile.workerPending = rec
                ;(view.workerTiles ||= new Map()).set(key, rec)
            }
            else if (whole)
                this.litWholeToQuarters(whole.part, quarters, X, Y)
        }
        return tile
    }
    // TASK-1565 pass 7: the memo (atmosphericLighting.pathMemo) a lit tile's steps share: the row walks (drawHexagons, collect)
    // and union paths (memoPath: the grout, the shadows' clip, the fog's) of whole board rows are the same for every tile of a
    // tile row at a level, and the lamps (collect of the whole board) for every tile: kept across the tiles while the board
    // state they were made from holds (the view, its edges and outline, the light map, the sector generation and every
    // capture of the board's state, captureSurfaceState: litMemoEpoch), at most LIT_MEMO_KEYS entries. Grid.litRowMemo false
    // or an observed board: a memo a tile, as before (TASK-1552: a step's).
    litStepMemo(view) {
        if (!Grid.litRowMemo || this.isObserving())
            return new Map()
        const L = atmosphericLighting, sig = this.litMemoSig
        if (!sig || sig.view !== view || sig.edges !== view.edges || sig.outline !== view.outline || sig.rebuilds !== L.rebuilds ||
                sig.mapScale !== L.mapScale || sig.gen !== this.sectorGen || sig.epoch !== this.litMemoEpoch ||
                sig.fog !== isFogOfWar || sig.visuals !== otherSettings.atmosphericVisuals || sig.r !== basis.r ||
                this.litMemo.size > LIT_MEMO_KEYS) {
            this.litMemo = new Map()
            this.litMemoSig = {view, edges: view.edges, outline: view.outline, rebuilds: L.rebuilds, mapScale: L.mapScale,
                gen: this.sectorGen, epoch: this.litMemoEpoch, fog: isFogOfWar, visuals: otherSettings.atmosphericVisuals, r: basis.r}
            ++this.litMemoResets
        }
        return this.litMemo
    }
    // TASK-1565 pass 6: a whole tile drawn on the main thread after all (Grid.litTileWhole, the worker could not make it):
    // its quarters copied out of the whole canvas.
    litWholeToQuarters(canvas, quarters, X, Y) {
        for (const q of quarters) {
            const g = q.part.getContext('2d')
            g.save()
            g.setTransform(1, 0, 0, 1, 0, 0)
            g.globalAlpha = 1
            g.globalCompositeOperation = 'copy'
            g.drawImage(canvas, X - q.px, Y - q.py)
            g.restore()
        }
    }
    // TASK-1545: a lit tile is kept as its four LIT_TILE_PART squares, each a canvas of its own (litTilePool): a frame draws
    // (and its canvas records) only the quarters on the canvas, not whole tiles a quarter of which is in view along the
    // canvas's sides (a Chromium canvas records about 32 MB of images before it rasterizes inside the frame). A quarter the
    // board's drawing cannot reach (litPartEmpty) is not kept. {parts: [top left, top right, bottom left, bottom right]
    // (null: empty), litOpaque}. TASK-1552: the quarters of tile (u, v) at device pixel x, y of view, taken for its build to
    // draw into (litTileSteps).
    litTileParts(view, x, y) {
        const Q = LIT_TILE_PART, parts = []
        for (let k = 0; k < 4; ++k) {
            const qx = (k & 1) * Q, qy = (k >> 1) * Q
            if (Grid.litPartSkips && this.litPartEmpty(view, x + qx, y + qy, x + qx + Q, y + qy + Q)) {
                parts.push(null)
                continue
            }
            const part = this.litTilePool.pop() || document.createElement('canvas')
            if (part.width !== Q || part.height !== Q) {
                part.width = Q
                part.height = Q
                part.litDrawn = false
            }
            parts.push(part)
        }
        return {parts, width: LIT_TILE, height: LIT_TILE}
    }
    // TASK-1545: whether nothing a lit tile draws (drawLitScene: the slab's underlay and sides below the board's edge, the
    // surface, shadows, fog, rim and buildings; the light within the outline) can reach the device rectangle x0..x1 x y0..y1
    // of view's pixels: the rectangle grown by LIT_PART_REACH hex radii and the slab's depth lies wholly outside the board
    // outline's loop (no side of it meets the grown rectangle, whose centre is outside).
    litPartEmpty(view, x0, y0, x1, y1) {
        const loop = mapDepth.outlineLoop
        if (!loop)
            return false
        const m = LIT_PART_REACH * basis.r + (mapDepth.depth || 0)
        const left = (x0 - view.e) / view.a - m, right = (x1 - view.e) / view.a + m
        const top = (y0 - view.f) / view.d - m, bottom = (y1 - view.f) / view.d + m
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
        return !inside
    }
    // TASK-1545: tile (litTileParts) drawn with its top left corner at device pixel x, y (identity transform) on a cw x ch
    // canvas: its quarters on the canvas.
    drawLitTileAt(ctx, tile, x, y, cw, ch) {
        const Q = LIT_TILE_PART
        for (let k = 0; k < 4; ++k) {
            const part = tile.parts[k]
            if (!part)
                continue
            const px = x + (k & 1) * Q, py = y + (k >> 1) * Q
            if (px < cw && py < ch && px + Q > 0 && py + Q > 0)
                ctx.drawImage(part, px, py)
        }
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
        // TASK-1566: the camera moving (a pan or zoom under way, not the hold after it): the lamp overlays' copies at a nearby phase.
        const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : null
        const moving = !!screen && !!(screen.zoomGesture || screen.surfaceZooming || performance.now() < screen.surfacePanUntil || screen.surfacePanFrames > 0)
        if (Grid.litTrust && kept && kept.view === view && kept.edges === view.edges && kept.ox === ox && kept.oy === oy && kept.cw === cw &&
                kept.ch === ch && kept.squares === squares) {
            atmosphericLighting.drawEdges(ctx, this, kept.runs, moving)
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
        atmosphericLighting.drawEdges(ctx, this, runs, moving)
    }
    // TASK-1564: whether view's tile (u, v) is being made in the Worker (litTileSteps).
    litPending(view, u, v) {
        return !!view.workerTiles?.has(u + ',' + v)
    }
    // TASK-1564: a tile's quarters back from the Worker (out: [[k, ImageBitmap], ...]): the tile stored as litTileStep stores
    // one built here, its pooled canvases given back; dropped (a stale version) when the view, its edges, outline or light map,
    // or the sector generation changed since, or the tile was built meanwhile.
    litTileArrived(rec, out) {
        const {view, key, u, v, tile} = rec
        const mine = view.workerTiles?.get(key) === rec
        if (mine)
            view.workerTiles.delete(key)
        if (!mine || this !== grid || view !== this.litView || view.tiles.has(key) || rec.edges !== view.edges ||
                rec.outline !== view.outline || rec.rebuilds !== atmosphericLighting.rebuilds ||
                rec.mapScale !== atmosphericLighting.mapScale || rec.gen !== this.sectorGen) {
            // TASK-1570: why (the first that held), visualsPerf work.sectorAhead.litDropBy
            const why = !mine ? 'other' : this !== grid || view !== this.litView ? 'view' : view.tiles.has(key) ? 'built' :
                rec.edges !== view.edges ? 'edges' : rec.outline !== view.outline ? 'outline' : rec.rebuilds !== atmosphericLighting.rebuilds ?
                'rebuilds' : rec.mapScale !== atmosphericLighting.mapScale ? 'mapScale' : 'gen'
            if (this.aheadWork.litDropBy)
                ++this.aheadWork.litDropBy[why]
            SectorWorker.dropped(out)
            delete tile.workerPending
            this.freeLitTile(tile)
            return
        }
        const parts = tile.parts.slice()
        for (const [k, bitmap] of out)
            tile.parts[k] = bitmap
        delete tile.workerPending
        this.freeLitTile({parts})
        view.tiles.set(key, tile)
        this.releaseStaleTile(view, key)
        this.storeSector(view, u, v, tile)
        SectorWorker.built('worker')
    }
    // TASK-1564: the Worker could not make the tile: given up (the frames' tasks build it again, on the main thread).
    litTileFailed(rec) {
        const {view, key, tile} = rec
        if (view.workerTiles?.get(key) === rec)
            view.workerTiles.delete(key)
        delete tile.workerPending
        this.freeLitTile(tile)
    }
    // TASK-1564: a sector build's recording ended (sector: sectorSnapshot's): its pictures sent to the Worker (onDone / onFail
    // later; true), or, main only or without the worker, drawn here (its recorders' runs flushed; false), counted.
    // TASK-1570: priority: SectorWorker.submit's (lower first, null cancels a build still pending).
    sectorSubmit(sector, onDone, onFail, priority = null) {
        const {sink, snapshot} = sector
        if (sink.worker && !sink.mainOnly) {
            for (const key of sink.sprites.keys())
                if (SectorWorker.bad(key)) {
                    sink.recorders[0]?.mainOnly()
                    break
                }
        }
        if (sink.worker && !sink.mainOnly && SectorWorker.on()) {
            SectorWorker.submit(snapshot, sink.sprites, onDone, onFail, priority)
            return true
        }
        if (sink.worker && !sink.mainOnly)
            sink.recorders[0]?.mainOnly()
        // The fallback: the worker not used for a build that could have used it (not a frame's own: sectorSync); counted with
        // whether the camera moved then (builtMainMoving).
        if (typeof SectorWorker !== 'undefined')
            SectorWorker.built('main', !sink.sync, !Grid.cameraAtRest())
        return false
    }
    // TASK-1559: a tile released: through the sector cache when it holds it (remove: close takes it out of the view and frees
    // it), else freed at once.
    releaseLitTile(tile) {
        if (!tile)
            return
        const key = tile.sectorKey
        if (key && this.sectors?.get(key)?.image === tile) {
            this.sectors.remove(key)
            return
        }
        this.freeLitTile(tile)
    }
    // A tile's quarters back to the pool (TASK-1559: also as the sector cache's close).
    freeLitTile(tile) {
        for (const part of tile.parts) {
            if (!part)
                continue
            // TASK-1564: a quarter made in the Worker (an ImageBitmap) is let go of (not closed: a kept recording may still
            // draw it), never pooled.
            if (typeof ImageBitmap !== 'undefined' && part instanceof ImageBitmap)
                continue
            if (this.litTilePool.length < (Grid.litAhead ? LIT_TILE_SPARE_PARTS : 4 * LIT_TILE_POOL))
                this.litTilePool.push(part)
            else
                part.width = part.height = 0
        }
        tile.parts = []
    }
    // TASK-1559: a sectors view's tiles stay in the sector cache (the next view adopts those its board still draws alike:
    // adoptSectors against this view's state, sectorBasis); its stale tiles are released.
    dropLitView() {
        const view = this.litView
        if (view) {
            if (view.sectorLevel && this.sectors) {
                this.releaseStaleTile(view)
                for (const [key, tile] of view.tiles) {
                    const [u, v] = key.split(',').map(Number)
                    if (!this.sectorHolds(view, u, v, tile))
                        this.releaseLitTile(tile)
                }
                this.sectorBasis = view
            }
            else {
                for (const tile of view.tiles.values())
                    this.releaseLitTile(tile)
                this.releaseStaleTile(view)
            }
            view.tiles = new Map()
        }
        this.litView = undefined
        this.litEdgeRuns = undefined
    }
    // TASK-1559 (SECTORS 3/11): lit tiles as sectors. Whether this board keeps its lit tiles as sectors (Grid.litSectors).
    litSectorsOn() {
        return !!(Grid.litSectors && this.sectors)
    }
    // The sector key of view's tile (u, v), null when view keeps no sectors.
    sectorKey(view, u, v) {
        return view.sectorLevel && this.sectors ? SectorCache.key(view.sectorLevel, u, v) : null
    }
    // Whether view has tile (u, v): in its tiles, else a clean sector of its level taken from the cache (built for the light
    // map, outline and board state the view draws: entry.version the cache's generation, sectorGen; dirty ones are not).
    litHas(view, u, v) {
        const key = u + ',' + v
        if (view.tiles.has(key))
            return true
        const skey = view === this.litView && this.sectorKey(view, u, v)
        const entry = skey && this.sectors.get(skey)
        if (!entry || entry.dirty || entry.version !== this.sectorGeneration() || entry.d !== view.d ||
                entry.image && !entry.image.parts.length)
            return false
        view.tiles.set(key, entry.image)
        ++this.sectorWork.pulled
        return true
    }
    // Whether the cache holds tile as view's sector (u, v).
    sectorHolds(view, u, v, tile) {
        const key = this.sectorKey(view, u, v)
        return !!key && !!tile && this.sectors.get(key)?.image === tile
    }
    // The generation the cache's sectors were built for (sectorGen: one more on every clear, clearSectors); a tile stored
    // after a clear never mixes with one from before it.
    sectorGeneration() {
        return this.sectorGen
    }
    // A tile view built (null: the board does not reach it) stored as its sector; the entry it replaces (a dirty one) is freed
    // unless it is still drawn as view's stale tile.
    storeSector(view, u, v, tile) {
        const key = view === this.litView && this.sectorKey(view, u, v)
        if (!key)
            return
        const old = this.sectors.get(key)
        if (old && old.image === tile)
            return
        if (old) {
            this.sectors.entries.delete(key)
            this.sectors.bytes -= old.bytes
            if (old.image && view.stale?.get(u + ',' + v) !== old.image)
                this.freeLitTile(old.image)
        }
        if (this.sectorOutline !== mapDepth.outline) {
            if (this.sectors.entries.size)
                this.clearSectors('outline')
            this.sectorOutline = mapDepth.outline
        }
        let bytes = 0
        if (tile) {
            tile.sectorKey = key
            tile.close = () => this.closeSectorTile(tile, u + ',' + v)
            bytes = tile.parts.filter(Boolean).length * LIT_TILE_PART ** 2 * 4
        }
        const before = this.sectors.evictions
        const entry = this.sectors.put(view.sectorLevel, u, v, tile, {version: this.sectorGeneration(), bytes})
        entry.d = view.d
        this.sectorWork.evicted += this.sectors.evictions - before
        ++this.sectorWork.stored
    }
    // The cache's close of a tile (evicted, removed or cleared): out of the lit view (its tiles or stale tiles), then freed.
    closeSectorTile(tile, uv) {
        const view = this.litView
        if (view) {
            if (view.tiles.get(uv) === tile)
                view.tiles.delete(uv)
            if (view.stale?.get(uv) === tile) {
                view.stale.delete(uv)
                if (!view.stale.size)
                    view.stale = view.refresh = undefined
            }
        }
        tile.sectorKey = undefined
        this.freeLitTile(tile)
    }
    // Once a frame (drawSerial): the cache's frame, so the sectors this frame draws (useSector) are not evicted till the next.
    beginSectorFrame() {
        if (this.sectors && this.sectorFrame !== this.drawSerial) {
            this.sectorFrame = this.drawSerial
            this.sectors.beginFrame()
        }
    }
    useSector(view, u, v) {
        const key = this.sectorKey(view, u, v)
        if (key)
            this.sectors.use(key)
    }
    // Every sector released (reason counted: sectorClears, the frame's ground-sectors full rebuild).
    clearSectors(reason) {
        const sectors = this.sectors
        if (!sectors)
            return
        if (sectors.entries.size) {
            ++this.sectorWork.clears
            this.sectorClears.push(reason)
            if (this.sectorClears.length > 64)
                this.sectorClears.splice(0, 32)
        }
        sectors.clear()
        ++this.sectorGen
        this.sectorBasis = undefined
        // TASK-1562: a board change (not a release, or a light map made for another scale only: adoptSectors) leaves the
        // unit sectors' grounds of other levels behind the board.
        if (/board|cell layer|lamp|outline|light map/.test(reason))
            ++this.unitGroundEpoch
    }
    // The sectors the board change found (surfaceCacheChangeRects' cells and light, world boxes) reaches, at every level: each
    // world box (the light's grown by a light map pixel) grown by 3 device pixels at the sector's level and the edge
    // runs' reach (4 LIT_EDGE_BLOCK: a run joins blocks up to 3 apart), as refreshLitTiles and finishLitPatch found the tiles
    // before (SectorCache.dirtyCells). Those that are view's tiles are left dirty for the caller (returned: their u,v keys);
    // the others are released (built again when a frame reaches them).
    staleSectors(view, found) {
        if (!this.sectors || !this.sectors.entries.size)
            return []
        const texel = atmosphericLighting.mapPixel()
        const boxes = [...found.cells, ...found.light.map(r => ({x0: r.x0 - texel, y0: r.y0 - texel, x1: r.x1 + texel, y1: r.y1 + texel}))]
        if (!boxes.length)
            return []
        // Grown by the territory glow's cool spill past its warm reach (TERRITORY.cool.reach - reach hex radii): the change's
        // light rectangles give the warm reach only where the owner's colour is not known to be blue (probes/dirty-probe-g:
        // a kept sector 3.7 radii from a changed cell 2/255 off), and a kept sector is never drawn again unless dirtied.
        const T = atmosphericLighting.TERRITORY, m = T.cool ? Math.max(0, T.cool.reach - T.reach) * basis.r : 0
        return this.staleSectorsIn(view, boxes.map(r => ({x: r.x0 - m, y: r.y0 - m, w: r.x1 - r.x0 + 2 * m, h: r.y1 - r.y0 + 2 * m})))
    }
    // staleSectors for world rectangles rects (a rectangle or a list; not yet grown), each on its own (not their union).
    staleSectorsIn(view, rects) {
        const sectors = this.sectors
        if (!sectors || !sectors.entries.size)
            return []
        const kept = []
        // TASK-1562: the unit sectors there (every level) too: their ground is the lit tile's.
        if (Grid.zoomLevels && this.unitSectors?.entries.size)
            this.unitSectorWork.dirtied += this.unitSectors.dirtyCells(Array.isArray(rects) ? rects : [rects], level => (3 + 4 * LIT_EDGE_BLOCK) / level).length
        for (const skey of sectors.dirtyCells(Array.isArray(rects) ? rects : [rects], level => (3 + 4 * LIT_EDGE_BLOCK) / level)) {
            const entry = sectors.get(skey), uv = entry.u + ',' + entry.v
            if (view && entry.level === view.sectorLevel && entry.image && (view.tiles.get(uv) === entry.image || view.stale?.get(uv) === entry.image)) {
                kept.push(uv)
                continue
            }
            sectors.remove(skey)
            ++this.sectorWork.removed
        }
        return kept
    }
    // TASK-1559: a new lit view (planLitView) takes the sectors kept: none (cleared) when the light map or the outline differ
    // from those they were built for or the board cannot be compared with the last view's state (sectorBasis: an observed
    // board, another board state past a cell list, a lamp or portal change); else the board's cells changed since that state
    // (surfaceStateMatches' list, as refreshLitTiles finds them) dirty the sectors they reach (staleSectors), the others are
    // the view's tiles where its frames reach them (litHas). view.sectorAdopt: what was done; view.sectorsOnCanvas: the clean
    // sectors on the canvas it was made at (visualsPerf: a view finding none is a full rebuild).
    adoptSectors(view, cw, ch) {
        const sectors = this.sectors
        const basis = this.sectorBasis
        this.sectorBasis = undefined
        if (!view.sectorLevel || !sectors)
            return
        ++this.sectorWork.adopted
        const L = atmosphericLighting
        const done = what => {
            view.sectorAdopt = what
            let on = 0
            if (sectors.entries.size) {
                const ox = Math.round(view.madeAt.e), oy = Math.round(view.madeAt.f), r = this.litTileRange(cw, ch, ox, oy, 0)
                for (let v = r.v0; v <= r.v1; ++v)
                    for (let u = r.u0; u <= r.u1; ++u) {
                        const e = sectors.get(SectorCache.key(view.sectorLevel, u, v))
                        if (e && !e.dirty && e.version === this.sectorGeneration() && e.d === view.d) ++on
                    }
            }
            view.sectorsOnCanvas = on
        }
        if (!sectors.entries.size)
            return done('empty')
        const refuse = !basis ? 'no basis' : this.isObserving() ? 'observed' : this.sectorOutline !== mapDepth.outline ? 'outline' :
            basis.rebuilds !== L.rebuilds ? 'light map' : basis.mapScale !== L.mapScale ? 'light map scale' : null
        if (refuse) {
            this.clearSectors(refuse)
            return done('cleared')
        }
        const changes = []
        const matches = this.withLitState(basis, () => {
            const overlayCells = this.surfaceOverlayCells
            this.surfaceOverlayCells = []
            try {
                return this.surfaceStateMatches(undefined, changes, true)
            } finally {
                this.surfaceOverlayCells = overlayCells
            }
        })
        if (!matches) {
            this.clearSectors('board')
            return done('cleared')
        }
        if (!changes.length) {
            ++this.sectorWork.kept
            return done('kept')
        }
        const found = this.withLitState(basis, () => this.surfaceCacheChangeRects(changes))
        if (!found) {
            this.clearSectors('lamp or portal')
            return done('cleared')
        }
        this.staleSectors(null, found)
        ++this.sectorWork.dirtied
        return done('dirtied')
    }
    // A new lit view taken (planLitView, a start's steps): its sectors adopted.
    setLitView(view, cw, ch) {
        if (this.litView && this.litView !== view)
            this.dropLitView()
        this.litView = view
        // TASK-1562: made after a zoom on the levels (its tiles built a step at a time while the frames draw the sectors kept).
        view.levelBuild = !!(this.levelSettle || this.sectorRest)
        this.adoptSectors(view, cw, ch)
        return view
    }
    // Releases every lit canvas (the surface cache draws the board).
    releaseLitCanvases() {
        this.dropLitView()
        // TASK-1559: the sectors too (the surface cache draws the board).
        this.clearSectors('released')
        for (const part of this.litTilePool)
            part.width = part.height = 0
        this.litTilePool.length = 0
        this.dropLitTileJob()
        if (this.litRestCanvas)
            this.litRestCanvas.width = this.litRestCanvas.height = 0
        this.litRestCanvas = undefined
        if (this.litPatchBuffer)
            this.litPatchBuffer.width = this.litPatchBuffer.height = 0
        this.litPatchBuffer = undefined
        if (this.litCellLayer) {
            this.releaseCellSprites(this.litCellLayer)
            this.litCellLayer.width = this.litCellLayer.height = 0
        }
        this.litCellLayer = undefined
        if (this.litCellShown)
            this.litCellShown.width = this.litCellShown.height = 0
        this.litCellShown = undefined
    }
    // Bytes of the lit canvases: the view's tiles' quarters, the pool, the build canvas, the rest snapshot and the lit patch
    // buffer.
    litTileBytes() {
        let parts = this.litTilePool.length
        // TASK-1559: the sectors' tiles (the view's among them) as the cache counts them.
        if (this.sectors?.entries.size)
            parts += this.sectors.bytes / (LIT_TILE_PART ** 2 * 4)
        if (this.litView)
            for (const [key, tile] of this.litView.tiles) {
                const [u, v] = key.split(',').map(Number)
                if (tile && !this.sectorHolds(this.litView, u, v, tile)) parts += tile.parts.filter(Boolean).length
            }
        const rest = this.litRestCanvas ? this.litRestCanvas.width * this.litRestCanvas.height * 4 : 0
        const buffer = this.litPatchBuffer ? this.litPatchBuffer.width * this.litPatchBuffer.height * 4 : 0
        return parts * LIT_TILE_PART ** 2 * 4 + rest + buffer
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
        // TASK-1544: without a cache to draw at its scale, its stand-in (drawStandIn), not the board drawn directly.
        if (cached && this.drawStandIn(ctx))
            return 'standin'
        // TASK-1571 (Grid.litGroundFill): no stand-in outside a zoom gesture (Grid.standInsInGesture): a frame at or below the
        // cache's scale without a cache to draw (none yet, a build under way, one not matching the board while the camera
        // moves) draws the lit view at its scale (exact tiles, the ground fill for those not built yet), not the whole board
        // directly (on the 2026-11-06 capture's first pan, no cache for 25 s: 4000-5400 calls, ~750 ms a frame).
        const lit = (!cached || Grid.litGroundFill && this === grid && otherSettings.atmosphericVisuals) && this.drawLitView(ctx)
        // (the cache's tasks then run as for frames drawing its stand-in: prepareSurfaceCache's waiting budget)
        if (cached && lit)
            this.cacheWaitedAt = performance.now()
        if (lit === 'cache')
            return true
        // TASK-1571: the ground fill for a view not made yet (drawLitView), drawn over as a stand-in is (Grid.draw).
        if (lit === 'fill')
            return 'fill'
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
        if (!pass)
            this.noteFrameView(ctx)
        this.lod = pass ? pass.lod : this.lodTransform(ctx)
        // TASK-1474: a moving frame far out draws the slab shadow, surface and overlays from the scene layer.
        const scene = !pass && this.drawSceneLayer(ctx)
        // The slab's soft drop shadow on the sky, under the board (not in the zoom raster's board: the gesture's frames
        // draw it with the sky, drawZoomRaster).
        if (!pass && !scene)
            this.drawSlabShadow(ctx)
        // TASK-1560: a pan frame on the surface cache's path draws the cache and the units from the unit sectors.
        this.unitFrame = undefined
        // TASK-1565: the camera's motion the sectors are built ahead along (aheadRange).
        if (!pass && this === grid && Grid.sectorAhead)
            this.followSectorMotion(ctx.getTransform())
        // TASK-1561: a frame at rest has them built for the pan that may follow (with the state a pan frame plans them in).
        if (!pass && !scene)
            this.restUnitSectors(ctx)
        const sectored = !pass && !scene && (this.drawCacheSectors(ctx) || this.drawLevelStandIn(ctx))
        const surface = scene || sectored || this.drawMapSurface(ctx)
        this.frameSurface = surface
        // TASK-1571: a frame that does not draw the lit view leaves no lit frame behind (an earlier one read as this frame's:
        // unitSectorTask's live squares; a frame at or below the cache's scale may now draw the lit view, drawMapSurface).
        if (!pass && surface !== 'lit')
            this.litFrame = undefined
        // Lit tiles (drawLitView) hold the buildings and the light but for the board's edge.
        // TASK-1571: a frame on the ground fill (drawMapSurface 'fill') draws its units and overlays as over a stand-in.
        const lit = surface === 'lit', cachedScene = surface === true, standIn = surface === 'standin' || surface === 'fill'
        if (!lit && !pass && (this.litLayer || this.litLayerScratch))
            this.releaseLitLayer()
        // The overlay layer holds the production texts too (drawInfoTexts); so does the scene layer.
        let layered = scene
        // A rest frame's overlays and everything after them, recorded (drawOverlayComposite).
        let composite = null
        if (scene) {
            // The light is baked into the cache (surfaceCacheSteady); the layer holds the overlays.
        }
        else if (sectored) {
            this.drawLiveSectorUnits(ctx, this.unitFrame)
            // TASK-1561: the cell texts are in the sectors (and drawn on the live squares).
            layered = true
        }
        else if (otherSettings.atmosphericVisuals) {
            // The light map lights terrain and buildings; units, silhouettes and
            // bars come after it, so the multiply never darkens them.
            // TASK-1544: a stand-in holds the buildings and the light as the cache does (drawStandIn).
            if (!cachedScene && !lit && !standIn)
                this.drawOther(ctx, 'buildings')
            if (lit)
                this.drawLitEdges(ctx)
            // The light map's multiply would paint the transparent canvas off the board (as on a lit tile): clipped to
            // the lit cells as a lit tile's light is.
            else if (pass)
                atmosphericLighting.lightTile(ctx, this, pass.outline)
            else if (!standIn)
                atmosphericLighting.draw(ctx, this, cachedScene && this.surfaceCacheLit)
            layered = cachedScene && this.drawOverlayLayer(ctx)
            if (!cachedScene) {
                if (!pass)
                    this.dropOverlayLayer()
                // TASK-1560: the lit frame's unit sectors hold the units pass but on its live squares.
                const sectorUnits = lit && this.litFrame?.units
                // TASK-1515: a pan on the lit tiles draws the units, bars and cell texts from the lit layer.
                layered = !sectorUnits && lit && this.drawLitLayer(ctx)
                // TASK-1561: the cell texts too (debug's coordinate texts included): no lit layer.
                if (sectorUnits) {
                    this.drawLiveSectorUnits(ctx, sectorUnits)
                    layered = true
                }
                // TASK-1544: over a stand-in the cache path's units and overlays (buildings under construction, bars,
                // productions) of every cell in view.
                else if (!layered && standIn) {
                    this.drawStillUnits(ctx)
                    this.drawEntityOverlays(ctx)
                }
                else if (!layered)
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
        // TASK-1412: drawMain draws the marks after the selection overlay and the effects (SelectionOverlay.drawSelectionIcons).
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
    // TASK-1517: rendering the board in the input handler still took 70-600 ms (3000-7400 calls) when the gesture started
    // while the camera moved (no held frame). Every frame's board calls on the main canvas are recorded (beginLodFrame) and
    // the last frame's kept (keepZoomSource); without a held bitmap the raster is those calls made again on it
    // (replayZoomBoard: the board as the frame on screen shows it, drawn from the same cached images, 12-100 calls on the
    // surface-cache and lit paths), sky cut off as a copy's. A frame of more calls (Grid.ZOOM_REPLAY_SYNC_CALLS: a direct
    // frame) keeps a snapshot of its board (keepZoomBitmap, before the interface), copied as the held bitmap is; one whose
    // cached images changed since is copied from that snapshot too. Without a snapshot (not resolved yet, or a stale
    // recording of few calls) the calls are made again into another canvas in budgeted steps between frames
    // (startZoomReplay) while the screen keeps the frame it shows (holdZoomFrame: nothing drawn, its interface once), at
    // most Grid.ZOOM_HOLD_FRAMES frames; then the gesture's frames draw that raster. The main canvas (its interface on it)
    // is never copied. No recording (none since the last frame, or the camera moved since): no raster, the gesture's frames
    // drawn as any frame. Grid.zoomReplays false: renderZoomBoard as before.
    captureZoomRaster() {
        if (!Grid.zoomRasters || this !== grid || this.zoomRaster || typeof mainCanvas === 'undefined' || typeof mainCtx === 'undefined' ||
                !this.zoomRasterSource || zoomRasterTweens())
            return
        // TASK-1562: the gesture's frames draw the levels kept (drawZoomSectors): no raster.
        if (this.levelsOn()) {
            ++this.levelWork.skippedRasters
            return
        }
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
        let box = this.copyZoomBoard(canvas, t), steps = null
        if (box)
            ++this.zoomBoardCopies
        else if (!Grid.zoomReplays) {
            if (!this.renderZoomBoard(canvas, t))
                return
            box = {x: 0, y: 0, w: cw, h: ch}
            ++this.zoomBoardRenders
        }
        else {
            const {source, stale} = this.zoomSourceFor(t, cw, ch)
            if (!source)
                return
            const over = source.calls.length > Grid.ZOOM_REPLAY_SYNC_CALLS
            if (over)
                ++this.zoomSourceMisses.overSync
            if (!stale && !over && (box = this.replayZoomBoard(canvas, t, source)))
                ++this.zoomBoardReplays
            else if (source.bitmap && (box = this.copyZoomImage(canvas, t, source.bitmap)))
                ++this.zoomBitmapCopies
            else {
                // No board-only image of the frame on screen yet: the screen holds that frame (holdZoomFrame) until the
                // recording made again in steps is swapped in.
                box = {x: 0, y: 0, w: 0, h: 0}
                steps = source
            }
        }
        this.zoomRaster = {canvas, box, a: t.a, d: t.d, e: t.e, f: t.f, pending: !!steps, held: 0}
        if (steps) {
            ++this.zoomHoldStarts
            this.startZoomReplay(steps, t, this.zoomRaster)
        }
    }
    // TASK-1517: whether drawAll draws nothing this frame: the gesture's zoom raster is still made in steps
    // (startZoomReplay; pending), so the canvas keeps the frame on screen at the input, its interface drawn once, for at
    // most Grid.ZOOM_HOLD_FRAMES frames; past them (or the gesture over) the raster is given up and the frame drawn as
    // any frame is.
    holdZoomFrame() {
        const raster = this.zoomRaster
        if (!raster?.pending)
            return false
        if (raster.held < Grid.ZOOM_HOLD_FRAMES && Grid.zoomRasters && this === grid && gameEvent.screen.zoomGesture && !zoomRasterTweens() &&
                this.zoomReplayJob?.raster === raster) {
            ++raster.held
            ++this.zoomHeldFrames
            return true
        }
        this.zoomRaster = undefined
        ++this.zoomHoldDrops
        return false
    }
    // TASK-1520: a board whose frames draw it directly for want of its surface cache (frameSurface false: zoomed out before
    // the cache was built; a 55x55 board's direct frame is ~0.65 s on a software canvas, ~0.26 s on the user's desktop) built
    // the cache a step (SURFACE_STEP_MS) a frame (TASK-1518's stepped stages): ~150 s of such frames at the farthest zoom ~10 s
    // after a game's start. Instead, after such a frame is drawn, the screen keeps it (drawAll: nothing drawn, as the start and
    // playback holds) while the cache's build, split or patch runs back to back in tasks of CACHE_HOLD_TASK_MS (input and
    // frames between them); its next frame is drawn from the cache. Only for the frames of the game loop with the camera at
    // rest, no effect playing and no playback or start hold; given up (the frames drawn as before, the work between them) on
    // a camera move or zoom, any input (a click, key, wheel or touch), a turn change, a drawAll from elsewhere, the cache's
    // work done or none to do, or after Grid.CACHE_HOLD_MS (then a frame is drawn before the next hold). Grid.cacheHolds
    // false: no hold. Returns whether the frame is held.
    holdCacheFrame() {
        let hold = this.cacheHold
        const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
        if (!hold) {
            if (!Grid.cacheHolds || this !== grid || this.frameSurface !== false && this.frameSurface !== 'standin' ||
                    this.drawSerial === this.cacheHoldSerial ||
                    !otherSettings.atmosphericVisuals || typeof gameLoopFrame === 'undefined' || !gameLoopFrame || !screen ||
                    typeof canvas === 'undefined' || typeof createImageBitmap !== 'function' || typeof menu !== 'undefined' && menu.visible ||
                    this.startJob || this.playbackHold || this.zoomRaster || this.surfaceCacheDonor ||
                    typeof turnPlaybackView !== 'undefined' && turnPlaybackView.active ||
                    typeof attackFx !== 'undefined' && attackFx.effects.length || typeof healFx !== 'undefined' && healFx.effects.length ||
                    screen.surfaceMoving || screen.surfaceZooming || screen.zoomGesture || screen.glide || this.litRestUnderWay() ||
                    !(this.surfaceCacheBuild || this.surfaceSplitJob || this.surfacePatchJob || !this.surfaceCache) ||
                    Grid.zoomQuiet())
                return false
            watchGridInput()
            hold = this.cacheHold = {start: performance.now(), frames: 0, workMs: 0, tasks: 0, scale: canvas.scale, x: canvas.offset.x,
                y: canvas.offset.y, inputs: gridInputs, turn: typeof whooseTurn !== 'undefined' ? whooseTurn : null,
                round: typeof gameRound !== 'undefined' ? gameRound : null, none: false}
            ++this.cacheHolds
            this.cacheHoldTask(hold)
        }
        const why = this !== grid ? 'board' : typeof gameExit !== 'undefined' && gameExit ? 'exit' : !otherSettings.atmosphericVisuals ? 'off' :
            canvas.scale !== hold.scale || canvas.offset.x !== hold.x || canvas.offset.y !== hold.y || screen.surfaceMoving ||
            screen.surfaceZooming || screen.zoomGesture || screen.glide ? 'camera' : gridInputs !== hold.inputs ? 'input' :
            typeof whooseTurn !== 'undefined' && whooseTurn !== hold.turn || typeof gameRound !== 'undefined' && gameRound !== hold.round ? 'turn' :
            typeof gameLoopFrame === 'undefined' || !gameLoopFrame ? 'direct' :
            typeof turnPlaybackView !== 'undefined' && turnPlaybackView.active ? 'playback' :
            hold.none ? 'none' : !this.surfaceCacheBuild && !this.surfaceSplitJob && !this.surfacePatchJob && this.surfaceCache ? 'built' :
            performance.now() - hold.start >= Grid.CACHE_HOLD_MS ? 'time' : null
        if (why) {
            this.cacheHold = undefined
            this.cacheHoldSerial = this.drawSerial
            this.cacheHoldEnds[why] = (this.cacheHoldEnds[why] || 0) + 1
            return false
        }
        ++hold.frames
        ++this.cacheHoldFrames
        this.cacheHeldFrame = true
        return true
    }
    // A task of the cache hold's work (holdCacheFrame), the next queued at once while the hold lasts and work is left.
    cacheHoldTask(hold) {
        queueDonorTask(true, gridTask(() => {
            if (this.cacheHold !== hold || this !== grid)
                return
            const start = performance.now()
            do {
                // TASK-1544: the stand-in preview first (standInPreviewStep).
                if (this.standInWanted())
                    this.standInPreviewStep(SURFACE_STEP_MS)
                else if (this.surfacePatchJob)
                    this.surfacePatchStep()
                else if (this.surfaceCacheBuild || !this.surfaceCache) {
                    this.surfaceCacheBuildStep(SURFACE_STEP_MS)
                    if (!this.surfaceCacheBuild && !this.surfaceCache && !this.surfaceSplitJob) {
                        hold.none = true
                        break
                    }
                }
                else if (this.surfaceSplitJob)
                    this.surfaceSplitStep()
                else
                    break
            } while (performance.now() - start < CACHE_HOLD_TASK_MS - SURFACE_STEP_MS)
            const ms = performance.now() - start
            hold.workMs += ms
            this.cacheHoldWorkMs += ms
            ++hold.tasks
            if (this.cacheHold === hold && !hold.none && (this.surfaceCacheBuild || this.surfaceSplitJob || this.surfacePatchJob ||
                    !this.surfaceCache))
                this.cacheHoldTask(hold)
        }))
    }
    // TASK-1518: a new game's first frame drew everything its first view needs at once (the owned tiles of its colours, the
    // light map at the camera's scale, the lit view's edges, then the board directly: ~0.8 s on the user's desktop, then
    // ~0.2 s frames while the lit tiles were built). Instead, until the board's first frame (drawSerial 0) can be drawn from
    // its lit tiles, the screen keeps the frame it shows (the menu's, as before the first frame: nothing drawn, drawAll) while
    // startBuildSteps builds them, at most START_STEP_MS a frame (but for its last piece: runSteps) and as many pieces heavy
    // to rasterize as the frames' pace allows (one, doubled while they keep it, START_PACE_MS): then the first frame is a
    // lit-tiles frame, built from the same builders and keys as before (the same pixels). Only for a game started by
    // GameManager.start (startHoldWanted), with the atmospheric visuals on the main canvas, for the frames of its loop
    // (gameLoop: a direct drawAll call draws, as tests' do) and with createImageBitmap (as the held frames: not under
    // jsdom); given up (the frames drawn as before) when the camera moves or zooms, a drawAll call comes from elsewhere, or
    // after Grid.START_HOLD_MS.
    holdStartFrame() {
        let job = this.startJob
        if (job === null)
            return false
        if (job === undefined) {
            if (!Grid.startHolds || !this.startHoldWanted || this !== grid || this.drawSerial !== 0 || !otherSettings.atmosphericVisuals ||
                    typeof gameLoopFrame === 'undefined' || !gameLoopFrame ||
                    typeof mainCtx === 'undefined' || typeof createImageBitmap !== 'function' ||
                    typeof menu !== 'undefined' && menu.visible) {
                this.startJob = null
                this.startEnd = 'off'
                return false
            }
            const t = mainCtx.getTransform()
            job = this.startJob = {t: {a: t.a, b: t.b, c: t.c, d: t.d, e: t.e, f: t.f}, steps: this.startBuildSteps(t), frames: 0,
                start: performance.now(), last: undefined, allow: 1}
            this.startRestFirst = true
            this.startRestFirstAt = undefined
        }
        // (The start's moveTo marks the camera as moving, Screen.surfaceMoving, though it does not: its transform is compared.)
        const t = mainCtx.getTransform(), screen = gameEvent.screen
        const end = why => {
            this.startJob = null
            this.startEnd = why
            return false
        }
        if (t.a !== job.t.a || t.b !== job.t.b || t.c !== job.t.c || t.d !== job.t.d || t.e !== job.t.e || t.f !== job.t.f ||
                screen.surfaceZooming || screen.zoomGesture)
            return end('camera')
        if (typeof gameLoopFrame === 'undefined' || !gameLoopFrame)
            return end('direct')
        if (performance.now() - job.start >= Grid.START_HOLD_MS)
            return end('time')
        const start = performance.now()
        // Pieces heavy to rasterize a frame (their raster comes at the task's end, after this time budget): doubled while
        // the frames keep their pace (START_PACE_MS since the frame before), halved when they fall behind it twice over.
        if (job.last !== undefined) {
            const gap = start - job.last
            job.allow = gap <= START_PACE_MS ? Math.min(START_MAX_RASTER, 2 * job.allow) : gap > 2 * START_PACE_MS ? Math.max(1, job.allow >> 1) : job.allow
        }
        job.last = start
        let done, piece = 0, rasters = 0
        do {
            const begin = performance.now(), next = gridTask(() => job.steps.next())()
            done = next.done
            piece = performance.now() - begin
            ++this.startSteps
            this.startMaxStepMs = Math.max(this.startMaxStepMs, piece)
            const [name, raster] = done ? ['end', false] : next.value
            const kind = this.startPieces[name] ||= [0, 0, 0]
            ++kind[0]
            kind[1] += piece
            kind[2] = Math.max(kind[2], piece)
            if (raster && ++rasters >= job.allow)
                break
        } while (!done && performance.now() - start + piece < START_STEP_MS)
        this.startWorkMs += performance.now() - start
        if (done) {
            atmosphericLighting.prewarmOwnedTiles()
            return end('built')
        }
        ++job.frames
        ++this.startHeldFrames
        return true
    }
    // The board's first lit view at camera t (as planLitView makes it, newLitView) and what it draws, a piece a step (a
    // generator): the owned tiles of the board's colours (as its first frame built them: prebuildOwnedSteps, the menu's
    // pieces), the light map at the camera's scale (stepLightMap's steps), the view, then its tiles on the canvas, nearest
    // the canvas's centre first (as queueLitTiles orders them).
    *startBuildSteps(t) {
        // The sky's key and board first: its first draw for a new board releases the light map (atmosphericBackground.syncKey).
        atmosphericBackground.syncKey()
        // The owned tiles the cells drawn at t show (drawTile); the other owners' are built a tile a task after the first
        // frame (prewarmOwnedTiles), as before a fill a task after it.
        const fills = new Set(), drawn = this.drawRange(mainCtx)
        for (let i = drawn.i0; i < drawn.i1; ++i)
            for (let j = drawn.j0; j < drawn.j1; ++j) {
                const hexagon = this.arr[i][j].hexagon
                if (hexagon.playerColor !== 0 && hexagon.player?.color)
                    fills.add(atmosphericLighting.tileFill(hexagon))
            }
        // Each piece's kind (startPieces) and whether it is heavy to rasterize (holdStartFrame).
        for (const piece of atmosphericLighting.ownedFillSteps([...fills])) {
            const kind = piece.split(' ')[0]
            yield [kind, kind === 'tileVariant' || kind === 'ownedTile']
        }
        for (;;) {
            const done = atmosphericLighting.stepLightMap(this, undefined, true)
            if (done)
                break
            yield ['lightMap', atmosphericLighting.stagedRaster]
        }
        yield ['lightMap', true]
        const cw = mainCanvas.width, ch = mainCanvas.height
        if (t.b !== 0 || t.c !== 0 || t.a <= 0 || t.d <= 0 || this.constructionInView(mainCtx))
            return
        const viewSteps = this.newLitViewSteps(t, mainCanvas)
        let made
        while (!(made = viewSteps.next()).done)
            yield ['view', false]
        const view = this.setLitView(made.value, cw, ch)
        yield ['view', false]
        const ox = Math.round(t.e - view.e), oy = Math.round(t.f - view.f)
        const range = this.litTileRange(cw, ch, ox, oy, 0), tiles = []
        const cu = (cw / 2 - ox) / LIT_TILE - 0.5, cv = (ch / 2 - oy) / LIT_TILE - 0.5
        for (let v = range.v0; v <= range.v1; ++v)
            for (let u = range.u0; u <= range.u1; ++u)
                tiles.push({u, v, far: Math.hypot(u - cu, v - cv)})
        tiles.sort((a, b) => a.far - b.far)
        for (const {u, v} of tiles) {
            if (view !== this.litView)
                return
            atmosphericLighting.checkedOnce(this, () => this.litTile(view, u, v))
            yield ['tile', true]
        }
    }
    // Keeps a recorded frame's calls on the main canvas (beginLodFrame) as the board on the canvas now (the zoom raster's
    // source, replayZoomBoard): with the context state they started from, the frame's serial, key (lodFrameKey: the camera,
    // the canvas's size, the cached rasters the calls draw) and the layers they draw from (zoomSourceLayers).
    keepZoomSource(recorder) {
        this.dropZoomSource()
        this.zoomSource = {calls: recorder.calls, labels: recorder.labels, overlayEnd: recorder.overlayEnd, state: recorder.state,
            serial: this.drawSerial, key: recorder.key, layers: this.zoomSourceLayers(), bitmap: null}
    }
    // No kept recording (its board snapshot let go of).
    dropZoomSource() {
        this.zoomSource?.bitmap?.close?.()
        this.zoomSource = undefined
    }
    // TASK-1517: a kept recording of more calls than a gesture's input replays at once (Grid.ZOOM_REPLAY_SYNC_CALLS: a
    // direct frame, already that many calls) gets a snapshot of ctx's canvas as its frame left it, before the
    // interface (as a held frame's, captureHeldFrame): the zoom raster is then that board in one drawImage, the frame on
    // screen exactly, whatever was rebuilt since.
    // TASK-1546 (Grid.zoomBitmapLitSkips): none when the frames that follow are lit-tile frames of this camera (the snapshot
    // rasterizes the frame inside its task: 40-80 ms of a 115-180 ms frame here, the frame's own raster moved into it plus a
    // whole-canvas copy): the camera at rest on the lit tiles (its next frames draw the same view while its tiles are built,
    // then held once steady), or moving on them with the lit layer queued or under way (the next frames draw it: few calls,
    // replayed at once); or a lit view made by tasks (stepLitView: the frames draw the stand-in until it is, then lit tiles).
    // A gesture starting from such a frame makes its calls again in steps (startZoomReplay).
    keepZoomBitmap(ctx) {
        const source = this.zoomSource
        if (!source || source.serial !== this.drawSerial || source.calls.length <= Grid.ZOOM_REPLAY_SYNC_CALLS ||
                typeof createImageBitmap !== 'function')
            return
        const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
        if (Grid.zoomBitmapLitSkips && screen && !screen.zoomGesture && !screen.surfaceZooming &&
                (this.frameSurface === 'lit' && (!screen.surfaceMoving || this.litLayerQueued) || this.litViewJob)) {
            ++this.zoomBitmapSkips
            return
        }
        let snapshot
        try {
            snapshot = createImageBitmap(ctx.canvas)
        } catch (e) {
            return
        }
        ++this.zoomSourceBitmaps
        snapshot.then(bitmap => {
            if (this.zoomSource === source)
                source.bitmap = bitmap
            else
                bitmap.close?.()
        }, () => {})
    }
    // The layers a frame draws whose canvases are drawn again in place by a later build (the lit layer's pieces) or that a
    // build replaces: a recording drawing them stands for the board only while they are the same.
    zoomSourceLayers() {
        return [this.litLayer, this.litLayerBuilds, this.sceneLayer, this.sceneLayerBuilds, this.overlayLayer, this.overlayComposite,
            this.overlaySnapshotCanvas, this.overlaySnapshots]
    }
    // Whether a frame on ctx is recorded only for its calls (keepZoomSource): a frame of the main canvas but a move tween's
    // (no zoom raster then), when the zoom rasters are replayed.
    // TASK-1519: none while a turn playback's board has no surface cache (its frames are direct: recording and making again
    // each one's ~1500 calls took ~400 ms here a frame, time its cache build waits for); a gesture then has no raster.
    zoomSourceCandidate(ctx) {
        return Grid.zoomReplays && Grid.zoomRasters && this === grid && typeof mainCanvas !== 'undefined' && ctx.canvas === mainCanvas &&
            !zoomRasterTweens() && !(Grid.playbackHolds && !this.surfaceCache && typeof turnPlaybackView !== 'undefined' && turnPlaybackView.active)
    }
    // The kept recording (keepZoomSource) when it is the last frame's on the main canvas at camera t (cw x ch device
    // pixels): {source, stale}, stale ('key' or 'layers') when a raster or layer it draws changed since (made again, it is
    // the board as those draw now, not the frame on screen; its snapshot, if any, still is); {} without one (the reason
    // counted in zoomSourceMisses).
    zoomSourceFor(t, cw, ch) {
        const source = this.zoomSource, misses = this.zoomSourceMisses
        if (!source || typeof mainCtx === 'undefined')
            return ++misses.none, {}
        if (source.serial !== this.drawSerial)
            return ++misses.serial, {}
        const key = source.key
        if (key[0] !== t.a || key[1] !== t.d || key[2] !== t.e || key[3] !== t.f || key[4] !== cw || key[5] !== ch)
            return ++misses.camera, {}
        const now = this.lodFrameKey(mainCtx), layers = this.zoomSourceLayers()
        let stale = key.length !== now.length || key.some((k, i) => k !== now[i]) ? 'key' : undefined
        // TASK-1546: a lit layer drawn in steps never draws on its pieces again (new canvases each, Grid.litLayerSteps), and the one
        // it replaces is kept while a recording lists it (retireLitLayer): its replacement leaves the recording the frame on screen.
        // (Not one whose pieces a layer drawn at once took and drew again, litLayerRedrawn.)
        const kept = Grid.litLayerSteps && source.layers[0] !== this.litLayerRedrawn &&
            (!source.layers[0] || source.layers[0] === this.litLayer || source.layers[0] === this.litLayerRetired)
        if (!stale && (layers.length !== source.layers.length || layers.some((l, i) => l !== source.layers[i] && !(kept && i < 2))))
            stale = 'layers'
        if (stale)
            ++misses[stale]
        return {source, stale}
    }
    // Sets canvas up for a zoom raster of the board at camera t: cleared, clipped to the slab grown by
    // Grid.ZOOM_SLAB_MARGIN where the board's surroundings are not the cleared canvas (see copyZoomBoard), the identity
    // transform, its state saved (the caller restores it). {g, box} (box: the device rectangle past which the raster holds
    // nothing), or null without the slab's bounds.
    zoomRasterTarget(canvas, t) {
        // With simple visuals the board's underlay casts its own soft shadow past the slab (MapDepth.renderUnderlay)
        // on a sky that is the cleared canvas: the clip holds it too; without the background hints that sky is all the
        // frame holds off the board, so it is kept whole. (A clip: a mask composited over the whole canvas, source-in or
        // destination-in, took 20 ms more at 1920x1080 in software.)
        const atmo = otherSettings.atmosphericVisuals, b = mapDepth.surfaceBounds
        const hints = typeof backgroundHintsShown === 'function' && backgroundHintsShown()
        let margin = Grid.ZOOM_SLAB_MARGIN * basis.r
        if (!atmo)
            margin += 2 * mapDepth.shadowBlur + mapDepth.shadowOffset
        let slab
        if (!b || (atmo || hints) && !(slab = this.zoomSlabPath(margin)))
            return null
        const x0 = Math.max(0, Math.floor(t.a * (b.left - margin) + t.e)), y0 = Math.max(0, Math.floor(t.d * (b.top - margin) + t.f))
        const x1 = Math.min(canvas.width, Math.ceil(t.a * (b.right + margin) + t.e))
        const y1 = Math.min(canvas.height, Math.ceil(t.d * (b.bottom + mapDepth.depth + margin) + t.f))
        const g = canvas.getContext('2d')
        g.save()
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.globalAlpha = 1
        g.globalCompositeOperation = 'source-over'
        g.clearRect(0, 0, canvas.width, canvas.height)
        if (slab) {
            g.setTransform(t.a, t.b, t.c, t.d, t.e, t.f)
            g.clip(slab)
            g.setTransform(1, 0, 0, 1, 0, 0)
        }
        return {g, box: {x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0)}}
    }
    // Makes the recorded board calls of source (zoomSourceFor) on canvas, set up by zoomRasterTarget: the board as the frame
    // on the main canvas at camera t drew it, without the sky. The raster's box, or false.
    replayZoomBoard(canvas, t, source) {
        const target = this.zoomRasterTarget(canvas, t)
        if (!target)
            return false
        const g = target.g
        try {
            applyCanvasState(g, source.state)
            replayCanvasCalls(g, source.calls, source.labels, source.overlayEnd, true, 0, source.calls.length)
        } finally {
            g.restore()
        }
        return target.box
    }
    // Draws image (a board snapshot of the frame at camera t: no interface) on canvas, set up by zoomRasterTarget (the sky
    // cut off). The raster's box, or false.
    copyZoomImage(canvas, t, image) {
        if (image.width !== canvas.width || image.height !== canvas.height)
            return false
        const target = this.zoomRasterTarget(canvas, t)
        if (!target)
            return false
        target.g.drawImage(image, 0, 0)
        target.g.restore()
        return target.box
    }
    // Makes source's recorded calls (zoomSourceFor: the board at camera t) on a canvas of its own, set up by zoomRasterTarget,
    // in tasks between frames of at most about Grid.ZOOM_REPLAY_STEP_MS each; when all are made, raster (the gesture's zoom
    // raster) draws that canvas. Given up when the gesture's raster is dropped or replaced.
    startZoomReplay(source, t, raster) {
        this.zoomReplayJob?.g.restore()
        this.zoomReplayJob = undefined
        let canvas = this.zoomReplayCanvas
        if (!canvas || canvas === raster.canvas || canvas.width !== raster.canvas.width || canvas.height !== raster.canvas.height) {
            canvas = this.zoomReplayCanvas = document.createElement('canvas')
            canvas.width = raster.canvas.width
            canvas.height = raster.canvas.height
        }
        const target = this.zoomRasterTarget(canvas, t)
        if (!target)
            return
        applyCanvasState(target.g, source.state)
        const job = this.zoomReplayJob = {source, raster, canvas, g: target.g, box: target.box, next: 0}
        const calls = source.calls
        const step = () => setTimeout(gridTask(() => {
            if (this.zoomReplayJob !== job)
                return
            if (this.zoomRaster !== raster) {
                job.g.restore()
                this.zoomReplayJob = undefined
                return
            }
            const start = performance.now()
            let k = job.next
            while (k < calls.length) {
                const end = Math.min(calls.length, k + Grid.ZOOM_REPLAY_CHUNK)
                replayCanvasCalls(job.g, calls, source.labels, source.overlayEnd, true, k, end)
                k = end
                if (performance.now() - start >= Grid.ZOOM_REPLAY_STEP_MS)
                    break
            }
            job.next = k
            ++this.zoomReplaySteps
            this.zoomReplayMaxStepMs = Math.max(this.zoomReplayMaxStepMs, performance.now() - start)
            if (k < calls.length)
                return step()
            job.g.restore()
            this.zoomReplayJob = undefined
            // The finished canvas becomes the raster's; the copy's canvas the next replay's.
            this.zoomReplayCanvas = raster.canvas
            this.zoomRasterCanvas = raster.canvas = canvas
            raster.box = job.box
            raster.pending = false
            ++this.zoomReplaySwaps
        }))
        step()
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
        // bitmap (zoomRasterTarget).
        return this.copyZoomImage(canvas, t, bitmap)
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
        if (!Grid.zoomRasters || this !== grid || !gameEvent.screen.zoomGesture || zoomRasterTweens() || raster.pending ||
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
        // TASK-1411: the selection overlay's raster scaled to the camera (the zoom raster's board has none); its icons
        // after the effects (drawMain, TASK-1450).
        SelectionOverlay.drawSelection(ctx)
        this.dropHeldFrame()
        this.prepareSurfaceCache()
        this.countGestureFrame()
        return true
    }
    // The surface cache's raster (with its cell layer as drawSurfaceCache shows it) where it meets the view, as it is.
    // TASK-1544: without it (none yet, or its split under way) the stand-in preview, so the board has no hole of sky.
    drawZoomUnderlay(ctx) {
        const cache = this.surfaceCache, b = this.surfaceCacheBounds
        if (!cache || !b || this.surfaceSplitJob) {
            if (this.standInPreviewFits())
                this.drawStandInRect(ctx, canvas.offset.x, canvas.offset.y, canvas.offset.x + width, canvas.offset.y + height, 'zoom')
            return
        }
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
    // TASK-1517: and any other frame on the main canvas but a move tween's (zoomSourceCandidate), only for its calls: they
    // are made on ctx at its end and kept (keepZoomSource), never held.
    beginLodFrame(ctx) {
        this.stillRecording = false
        this.zoomRecording = false
        if (typeof Proxy !== 'function' || !this.lodTransform(ctx) && !(this.stillRecording = this.stillFrameCandidate(ctx)) &&
                !(this.zoomRecording = this.zoomSourceCandidate(ctx))) {
            this.dropHeldFrame()
            this.dropZoomSource()
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
            this.cellLayerComposites, this.cellLayerRefreshes, this.litPatches, mapDepth.outline, mapDepth.rim,
            // TASK-1516: a still frame on the lit tiles (their light and the lit edges' from the light map).
            atmosphericLighting.rebuilds, atmosphericLighting.mapScale]
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
    // drawn whole (no patch's or layer job's cells over it, no patch under way: it changes it in place), or with
    // simple visuals the board drawn directly (its sprites and hexagon images do not change).
    // TASK-1516 (Grid.stillLitTiles): also from the lit view's tiles while its rest snapshot is built (its bands, a task
    // each) when every tile on the canvas is built (no stand-in drawn for one: missing): a drawn tile is never changed in
    // place (built once under its key, released only off the canvas or with its view; a patch drops the view's tiles and
    // is no still frame), the snapshot's finishing makes the frame draw it instead (other calls), and the light map's
    // rebuilds are in the key (lodFrameKey). And while the snapshot's split job runs (view.splitJob): its steps draw only
    // into the cell layer, the snapshot is drawn uncut until the last step cuts it and the frames draw the composed one
    // (rest.shown, other calls).
    stillFrameSteady(recorder) {
        const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
        if (!screen || screen.surfaceMoving || screen.zoomGesture || zoomRasterTweens())
            return false
        if (this.frameSurface === true)
            return this.lodFrameSteady(recorder)
        if (otherSettings.atmosphericVisuals) {
            const frame = this.litFrame, view = this.litView, tiles = Grid.stillLitTiles
            if (this.frameSurface !== 'lit' || !frame || frame.view !== view || !view || view.patch || view.layerJob ||
                    (frame.rest ? frame.job : !tiles || frame.missing || frame.stale) || view.splitJob && !tiles)
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
        const held = this.makeLodFrame(ctx, recorder)
        // TASK-1517: a board snapshot for a zoom raster when the frame is not held and has none of its own (captureHeldFrame).
        if (!held && this.lodFrame?.serial !== this.drawSerial)
            this.keepZoomBitmap(ctx)
        return held
    }
    // endLodFrame's frame: made on ctx or held; whether held.
    makeLodFrame(ctx, recorder) {
        const still = this.stillRecording, zoom = this.zoomRecording
        this.stillRecording = false
        this.zoomRecording = false
        recorder.key = this.lodFrameKey(ctx)
        // TASK-1517: a held frame's calls repeat the frame's before it: the board on the canvas either way.
        this.keepZoomSource(recorder)
        if (zoom) {
            recorder.replay(ctx, true)
            this.dropHeldFrame()
            return false
        }
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
// TASK-1562: which canvases the sprite cache (cachedImages) holds, as one value: the unit sectors drawn from them are
// released when one is swapped (unitSectorPlan's key; a lost and restored context repaints them in place:
// restoreImageCaches releases them).
const cachedImageIds = new WeakMap()
let cachedImageSeq = 0
function cachedImagesSignature() {
    if (typeof cachedImages === 'undefined')
        return ''
    let h = 0, n = 0
    for (const name in cachedImages) {
        const image = cachedImages[name]
        if (!image || typeof image !== 'object')
            continue
        let id = cachedImageIds.get(image)
        if (!id)
            cachedImageIds.set(image, id = ++cachedImageSeq)
        h = Math.imul(h, 31) + id | 0
        ++n
    }
    return h + ':' + n
}
// TASK-1562: two keys (arrays, or null) with the same values.
function sameKeyArray(a, b) {
    return a === b || !!a && !!b && a.length === b.length && a.every((v, k) => v === b[k])
}
function zoomRasterTweens() {
    return typeof moveTween !== 'undefined' && moveTween.tweens.size > 0
}

// Clips ctx to rects (whole device pixel rectangles {x, y, w, h}); leaves the identity transform.
// TASK-1553: the device rectangles the sky is drawn in: the open rectangles, cut to the sky's blocks when it draws blocks
// (Grid.frameCover's sky; null: the whole open rectangles).
function shadowClipRects(open, blocks) {
    if (!blocks)
        return open
    const out = []
    for (const b of blocks)
        for (const r of open) {
            const x0 = Math.max(b.x, r.x), y0 = Math.max(b.y, r.y), x1 = Math.min(b.x + b.w, r.x + r.w), y1 = Math.min(b.y + b.h, r.y + r.h)
            if (x0 < x1 && y0 < y1)
                out.push({x: x0, y: y0, w: x1 - x0, h: y1 - y0})
        }
    return out
}

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
// TASK-1561: the drawing calls made on g counted in holder.calls.n while holder.calls is set (own methods of the context: a
// canvas made for it; the holder's counter is the task's drawing on it now).
function countDrawCalls(g, holder) {
    for (const name of CANVAS_DRAW_CALLS) {
        const call = g[name]
        if (typeof call === 'function')
            g[name] = function() {
                if (holder.calls)
                    ++holder.calls.n
                return call.apply(this, arguments)
            }
    }
}
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
            },
            // TASK-1517: `name in ctx` (canvasStateOf: the state a layer built in a task draws with) answers as the real
            // context; without it a recorded frame's state was empty (a lit layer of round-joined outlines drawn mitered).
            has(_, name) {
                return name === 'canvas' || name in recorder.scratch
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
        // TASK-1517: the transform the recorded calls give the real context, in its double precision: Chrome rounds the
        // arguments of setTransform, translate, scale and transform to single precision and composes them in double, as
        // exactTransform does (the same values for every sequence of these, save, restore and resetTransform tried); null
        // after a rotate (cos and sin rounded otherwise: the scratch context answers then). A frame's getTransform read
        // from the scratch context (set up with setTransform: single precision) put sprites (SpriteCache's 1/8 px phase
        // buckets, keyed by the scale) a hair off a directly drawn frame's.
        this.exact = [t.a, t.b, t.c, t.d, t.e, t.f]
        this.exacts = []
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
        if (name === 'getTransform' && this.exact && typeof DOMMatrix === 'function')
            return new DOMMatrix(this.exact)
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
        this.exactTransform(name, args)
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
    // Follows a recorded call's change of the transform in this.exact (begin).
    exactTransform(name, a) {
        const m = this.exact, f = Math.fround
        switch (name) {
        case 'save': this.exacts.push(m && m.slice()); return
        case 'restore': if (this.exacts.length) this.exact = this.exacts.pop(); return
        case 'reset': this.exacts.length = 0; this.exact = [1, 0, 0, 1, 0, 0]; return
        case 'resetTransform': this.exact = [1, 0, 0, 1, 0, 0]; return
        case 'rotate': this.exact = null; return
        case 'setTransform': {
            const o = a.length === 1 ? a[0] : null
            const v = a.length >= 6 ? a.slice(0, 6) : o ? [o.a ?? o.m11 ?? 1, o.b ?? o.m12 ?? 0, o.c ?? o.m21 ?? 0, o.d ?? o.m22 ?? 1,
                o.e ?? o.m41 ?? 0, o.f ?? o.m42 ?? 0] : a.length === 0 ? [1, 0, 0, 1, 0, 0] : null
            this.exact = v && v.every(Number.isFinite) ? v.map(f) : null
            return
        }
        case 'translate': case 'scale': case 'transform': break
        default: return
        }
        if (!m || !a.slice(0, name === 'transform' ? 6 : 2).every(Number.isFinite) || a.length < (name === 'transform' ? 6 : 2))
            return
        if (name === 'translate') {
            const x = f(a[0]), y = f(a[1])
            this.exact = [m[0], m[1], m[2], m[3], m[4] + (x * m[0] + y * m[2]), m[5] + (x * m[1] + y * m[3])]
        }
        else if (name === 'scale') {
            const x = f(a[0]), y = f(a[1])
            this.exact = [m[0] * x, m[1] * x, m[2] * y, m[3] * y, m[4], m[5]]
        }
        else {
            const o = a.slice(0, 6).map(f)
            this.exact = [o[0] * m[0] + o[1] * m[2], o[0] * m[1] + o[1] * m[3], o[2] * m[0] + o[3] * m[2], o[2] * m[1] + o[3] * m[3],
                o[4] * m[0] + o[5] * m[2] + m[4], o[4] * m[1] + o[5] * m[3] + m[5]]
        }
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

// TASK-1563 (SECTORS 7/11): a recording context for a sector build (SectorDraw, render/sectorDraw.js). The drawing code
// draws a sector's target on context (an ES Proxy) as it drew on the target's 2D context; the calls and property sets are
// put in the snapshot's runs (SectorDraw's ops, their values serializable: images by sprite key, gradients and patterns
// made by the recording, SectorPath paths), each run with the cell being drawn (sectorCell, called by the board's cell
// loops: Grid.drawOther, forEachDrawnCell, drawHexagons) and the visualsPerf layer (canvasCallLabels). State, transform
// and query calls also go to a scratch 2D context in the same state, so the drawing code reads the transform, state and
// text metrics it read on the target; drawing calls are only recorded (and counted in holder.calls, as countDrawCalls
// counts them on a canvas). flush() draws the runs recorded since the last flush on the target through SectorDraw: the
// main thread's sector builds draw only through it (one code path with a Worker's). A pixel read (getImageData) flushes and
// reads the target. Values that cannot be serialized (a Path2D not a SectorPath, a gradient made on a real context) are
// kept by key and counted in snapshot.opaque.
const SECTOR_STATE_CALLS = new Set(['save', 'restore', 'setTransform', 'transform', 'translate', 'scale', 'rotate',
    'resetTransform', 'setLineDash', 'reset'])
const SECTOR_QUERY_CALLS = new Set(['getTransform', 'measureText', 'getLineDash', 'isContextLost', 'getContextAttributes',
    'createImageData'])
// atmosphericLighting.gradient's owner for recorded gradients (gradientContext): SectorGradients, never a real context's.
const SECTOR_GRADIENT_OWNER = {sectorGradients: true}
const sectorScratchPool = []
// TASK-1564: a new 2D context's state (SectorRecorder.recordStartState).
let sectorDefaultState = null
let sectorValueKeys = new WeakMap(), sectorValueSerial = 0
// TASK-1563: sprites a recording draws that their owners redraw in place (the light map's multiply and gain canvases, a
// lit tile's pooled quarters) carry sectorVersion(), called on the canvas: their content version, changed by every edit
// (atmosphericLighting.sectorVersion, sectorEditsVersion). Such a sprite's key holds the version, and a snapshot kept
// past its build holds a copy of that version (sectorFrozen: one copy per canvas and version, never drawn into again), so
// its sprites are the pixels the recording drew whenever and wherever (a Worker) it is drawn.
const sectorFrozenCopies = new WeakMap()
function sectorFrozen(canvas, version) {
    const kept = sectorFrozenCopies.get(canvas)
    if (kept && kept.version === version)
        return kept.copy
    const copy = document.createElement('canvas')
    copy.width = canvas.width
    copy.height = canvas.height
    if (canvas.width && canvas.height)
        copy.getContext('2d').drawImage(canvas, 0, 0)
    sectorFrozenCopies.set(canvas, {version, copy})
    return copy
}
// sectorVersion for a canvas whose editor bumps its sectorEdits (sectorEdited).
function sectorEditsVersion() {
    return this.sectorEdits || 0
}
function sectorEdited(canvas) {
    canvas.sectorEdits = (canvas.sectorEdits || 0) + 1
    canvas.sectorVersion = sectorEditsVersion
}
class SectorRecorder {
    // target: the real 2D context the runs are drawn on; snapshot: Grid.sectorSnapshot's (its targets get {k, segs});
    // sink: {sprites (key -> image), cellIndex (board index -> index in snapshot.cells)}.
    constructor(target, snapshot, sink, k, holder = null) {
        this.target = target
        this.snapshot = snapshot
        this.sink = sink
        this.holder = holder
        const canvas = target.canvas
        this.entry = {k, x: 0, y: 0, w: canvas.width, h: canvas.height, segs: []}
        snapshot.targets.push(this.entry)
        this.segs = this.entry.segs
        this.seg = null
        this.flushed = 0
        this.cell = -1
        this.labels = typeof canvasCallLabels !== 'undefined' ? canvasCallLabels : null
        this.within = this.labels ? (label, fn) => this.labels.within(label, fn) : null
        // TASK-1564: a worker build's runs are not drawn here (flush does nothing) until the sink turns main only.
        this.deferred = !!sink.worker && !sink.mainOnly
        sink.recorders?.push(this)
        // fillStyle / strokeStyle set to a recorded gradient or pattern (the scratch context keeps its own then).
        this.fake = {}
        this.fakes = []
        const scratchCanvas = sectorScratchPool.pop() || document.createElement('canvas')
        this.scratchCanvas = scratchCanvas
        const g = this.scratch = scratchCanvas.getContext('2d')
        if (typeof g.reset === 'function') g.reset()
        else scratchCanvas.width = 1
        const t = target.getTransform()
        g.setTransform(t.a, t.b, t.c, t.d, t.e, t.f)
        for (const name of CANVAS_STATE)
            if (name in target) g[name] = target[name]
        if (typeof target.getLineDash === 'function') g.setLineDash(target.getLineDash())
        // TASK-1564: a worker's canvas starts in the default state: the target's own state (its transform, the plain values of
        // its state properties, its line dash) recorded first.
        if (this.deferred)
            this.recordStartState(target, t)
        const recorder = this, methods = new Map()
        const cell = (i, j) => recorder.setCell(i, j)
        this.context = new Proxy({}, {
            get(_, name) {
                if (name === 'canvas') return canvas
                if (name === 'sectorCell') return cell
                if (name === 'sectorGradients') return SECTOR_GRADIENT_OWNER
                const fake = recorder.fake[name]
                if (fake !== undefined) return fake
                const value = recorder.scratch[name]
                if (typeof value !== 'function') return value
                let method = methods.get(name)
                if (!method) methods.set(name, method = (...args) => recorder.call(name, args))
                return method
            },
            set(_, name, value) {
                recorder.op(['=', name, recorder.encode(value)])
                if (value instanceof SectorGradient || value?.sp)
                    recorder.fake[name] = value
                else {
                    recorder.fake[name] = undefined
                    recorder.scratch[name] = value
                }
                return true
            },
            has(_, name) {
                return name === 'canvas' || name === 'sectorCell' || name === 'sectorGradients' || name in recorder.scratch
            }
        })
    }
    // The cell (board indices) the next calls draw; -1: the sector's own.
    setCell(i, j) {
        if (i < 0) {
            this.cell = -1
            return
        }
        const index = i * this.sink.h + j
        let c = this.sink.cellIndex.get(index)
        if (c === undefined) {
            c = this.snapshot.cells.length
            this.snapshot.cells.push(this.sink.cellRow(i, j))
            this.sink.cellIndex.set(index, c)
        }
        this.cell = c
    }
    op(o) {
        const l = this.labels ? this.labels.current() : null
        let s = this.seg
        if (!s || s.c !== this.cell || s.l !== l) {
            s = this.seg = {c: this.cell, l, o: []}
            this.segs.push(s)
        }
        s.o.push(o)
    }
    // TASK-1564: the target's state as ops (only what differs from a new context's).
    recordStartState(target, t) {
        const d = sectorDefaultState ||= (() => {
            const c = document.createElement('canvas').getContext('2d'), out = {}
            for (const name of CANVAS_STATE)
                if (name in c) out[name] = c[name]
            return out
        })()
        if (t.a !== 1 || t.b !== 0 || t.c !== 0 || t.d !== 1 || t.e !== 0 || t.f !== 0)
            this.op(['setTransform', t.a, t.b, t.c, t.d, t.e, t.f])
        for (const name of CANVAS_STATE) {
            const value = target[name]
            if (name in target && value !== d[name] && (typeof value !== 'object' || value === null))
                this.op(['=', name, value])
        }
        const dash = typeof target.getLineDash === 'function' ? target.getLineDash() : []
        if (dash.length)
            this.op(['setLineDash', dash])
        this.seg = null
    }
    // TASK-1564: the sink's snapshot made on the main thread after all: its recorders draw what they recorded and draw on.
    mainOnly() {
        const sink = this.sink
        if (!sink.worker || sink.mainOnly)
            return
        sink.mainOnly = true
        for (const r of sink.recorders) {
            r.deferred = false
            r.flush()
        }
    }
    key(value) {
        let key = sectorValueKeys.get(value)
        if (key === undefined)
            sectorValueKeys.set(value, key = 'k' + (++sectorValueSerial))
        // TASK-1564: for the worker, a canvas's key holds its content version (sectorCanvasVersion) and its bitmap is made
        // now (SectorWorker.prepare: the pixels the recording draws).
        if (this.sink.worker) {
            const version = sectorCanvasVersion(value), base = key
            if (version !== null)
                key += '@' + version
            this.sink.sprites.set(key, value)
            SectorWorker.prepare(key, value, version !== null ? base : null)
            return key
        }
        if (typeof value.sectorVersion === 'function') {
            const version = value.sectorVersion()
            key += '@' + version
            if (this.sink.freeze)
                value = sectorFrozen(value, version)
        }
        this.sink.sprites.set(key, value)
        return key
    }
    // A value as SectorDraw takes it (render/sectorDraw.js's list).
    encode(v) {
        if (typeof v !== 'object' || v === null || Array.isArray(v) || v instanceof SectorGradient || v.sp)
            return v
        if (v instanceof SectorPath)
            return v.sectorValue ||= {path: v.cmds}
        if (typeof ImageData !== 'undefined' && v instanceof ImageData)
            return {id: [v.width, v.height, v.data]}
        if (typeof v.width === 'number' && typeof v.height === 'number' && !(typeof Path2D !== 'undefined' && v instanceof Path2D))
            return {s: this.key(v)}
        ++this.snapshot.opaque
        this.mainOnly()
        return {o: this.key(v)}
    }
    call(name, args) {
        const g = this.scratch
        if (SECTOR_QUERY_CALLS.has(name))
            return g[name](...args)
        if (name === 'createLinearGradient')
            return new SectorGradient('linear', args)
        if (name === 'createRadialGradient')
            return new SectorGradient('radial', args)
        if (name === 'createConicGradient')
            return new SectorGradient('conic', args)
        if (name === 'createPattern')
            return {sp: 1, s: this.key(args[0]), rep: args[1] ?? null}
        if (CANVAS_READ_CALLS.has(name)) {
            this.mainOnly()
            this.flush()
            ++this.snapshot.reads
            return this.target[name](...args)
        }
        if (name === 'setTransform' && args.length === 1 && args[0] && typeof args[0] === 'object') {
            const m = args[0]
            this.op([name, {m: [m.a ?? m.m11 ?? 1, m.b ?? m.m12 ?? 0, m.c ?? m.m21 ?? 0, m.d ?? m.m22 ?? 1, m.e ?? m.m41 ?? 0,
                m.f ?? m.m42 ?? 0]}])
        }
        else {
            const o = [name]
            for (let k = 0; k < args.length; ++k)
                o.push(this.encode(args[k]))
            this.op(o)
        }
        if (CANVAS_DRAW_CALLS.has(name)) {
            if (this.holder && this.holder.calls)
                ++this.holder.calls.n
            return undefined
        }
        if (SECTOR_STATE_CALLS.has(name)) {
            if (name === 'save')
                this.fakes.push({...this.fake})
            else if (name === 'restore' && this.fakes.length)
                this.fake = this.fakes.pop()
            else if (name === 'reset') {
                this.fake = {}
                this.fakes.length = 0
            }
            return g[name](...args)
        }
        return undefined
    }
    // The runs recorded since the last flush drawn on the target (SectorDraw).
    flush() {
        if (this.deferred || this.flushed === this.segs.length)
            return
        const from = this.flushed
        this.flushed = this.segs.length
        this.seg = null
        SectorDraw.drawSegs(this.target, this.segs, this.sink.sprites, this.within, from, this.flushed)
    }
    // Flushed, and the scratch canvas given back.
    end() {
        this.flush()
        if (this.scratchCanvas) {
            sectorScratchPool.push(this.scratchCanvas)
            this.scratchCanvas = null
        }
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
// Whether two canvasStateOf states are the same.
// (TASK-1551: the names in free not compared.)
function sameCanvasState(a, b, free) {
    if (!a || !b)
        return false
    for (const name of CANVAS_STATE)
        if (a[name] !== b[name] && !free?.includes(name))
            return false
    const da = a.lineDash || [], db = b.lineDash || []
    return da.length === db.length && da.every((v, k) => v === db[k])
}
// TASK-1551: the first state property two canvasStateOf states differ in (counted with the lit layer's rebuilds).
function canvasStateDiff(a, b, free) {
    for (const name of CANVAS_STATE)
        if (a[name] !== b[name] && !free?.includes(name))
            return name
    return 'lineDash'
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

// TASK-1554 (render/draw.js InterfaceLayer):
// A CanvasCallRecorder for the interface (InterfaceLayer): bounds also for texts (their measured box) and for drawings with
// a shadow (grown by the blur and moved by the offset); a filter makes the bounds unknown. Each drawImage of a canvas keeps
// the canvas's size and contentVersion (bumped by the code that draws a kept canvas again: markCanvasDrawn), so a cached
// drawing of an image that changed is drawn again; an image still loading makes the recording volatile (never repeated).
// A blend other than source-over cannot be cached on a transparent canvas the same: such a recording is drawn directly.
class InterfaceRecorder extends CanvasCallRecorder {
    begin(ctx, key) {
        super.begin(ctx, key)
        this.segments = []
        this.point = this.start = null
        this.volatile = false
        this.blended = false
    }
    record(entry) {
        if (entry.set === 'globalCompositeOperation' && entry.value !== 'source-over')
            this.blended = true
        super.record(entry)
    }
    call(name, args) {
        const before = this.boxes.length, unbounded = this.unbounded
        const result = super.call(name, args)
        if (CANVAS_DRAW_CALLS.has(name)) {
            // The call's own device boxes (those it added: a stroke's per segment; null when its bounds are unknown), for a
            // partial redraw (dirtyRects).
            const entry = this.calls[this.calls.length - 1]
            entry.boxes = this.unbounded && !unbounded ? null : this.boxes.slice(before)
        }
        if (name === 'drawImage') {
            const source = args[0], entry = this.calls[this.calls.length - 1]
            if (typeof HTMLImageElement === 'function' && source instanceof HTMLImageElement) {
                if (!source.complete || !source.naturalWidth)
                    this.volatile = true
            }
            else if (source && typeof source === 'object')
                entry.source = [source.width, source.height, source.contentVersion || 0]
        }
        return result
    }
    // This frame's recording (a new one starts with the next begin).
    take() {
        const boxes = this.boxes
        return {calls: this.calls, key: this.key, state: this.state, labels: this.labels,
            unbounded: this.unbounded, uncacheable: this.uncacheable || this.blended, volatile: this.volatile, boxes,
            // The boxes as whole device-pixel rectangles cut to W x H, joined where that adds no area (overlayRects), then
            // cut apart where they overlap (a pixel drawn twice from the cache would blend its translucent pixels twice).
            rects: (W, H) => InterfaceRecorder.disjoint(
                CanvasCallRecorder.prototype.overlayRects.call({boxes, unbounded: false, uncacheable: false}, W, H))}
    }
    // A partial redraw of the cache from recording a to recording b (cut to W x H): {rects, calls}: the device rectangles to
    // redraw and b's calls to make for them (every state and path call, and the drawing calls whose boxes meet the
    // rectangles). The rectangles hold the boxes of the drawing calls that differ (old and new). TASK-1561: the calls are
    // made whole on a scratch canvas of the cache's size (InterfaceLayer.redraw; not clipped: Chromium rasterizes a clipped
    // stroke's edges differently) and only the rectangles are copied from it, so the calls meeting them need not be grown
    // into (that took a timer's text to the whole interface: its panel meets the buttons it touches). Only when the two
    // make the same calls in the same order and differ only in drawing calls' arguments or drawn canvases (a timer's text);
    // null when b must be drawn whole (another call differs, a call's bounds are unknown, or the rectangles are most of
    // b's), the reason in InterfaceRecorder.fullWhy (diagnostic, InterfaceLayer.stats.fullWhy).
    static dirtyRects(a, b, W, H) {
        const no = why => { InterfaceRecorder.fullWhy = why; return null }
        if (!a || a.calls.length !== b.calls.length || a.key.some((v, k) => v !== b.key[k]))
            return no(!a ? 'none' : a.calls.length !== b.calls.length ? 'length' : 'key')
        if (!InterfaceRecorder.sameStart(a, b))
            return no('state ' + canvasStateDiff(a.state, b.state))
        const ta = a.state.transform, tb = b.state.transform
        if (ta.a !== tb.a || ta.b !== tb.b || ta.c !== tb.c || ta.d !== tb.d || ta.e !== tb.e || ta.f !== tb.f)
            return no('transform')
        // Whole device pixels round a box, one more each way (overlayRects' margin).
        const cell = q => [Math.floor(q[0]) - 1, Math.floor(q[1]) - 1, Math.ceil(q[2]) + 1, Math.ceil(q[3]) + 1]
        const dirty = []
        for (let k = 0; k < a.calls.length; ++k) {
            const x = a.calls[k], y = b.calls[k]
            if (x.set !== y.set || x.name !== y.name)
                return no('call ' + k + ' ' + x.name + '/' + y.name)
            if (x.set !== undefined) {
                if (x.value !== y.value) return no('set ' + x.set)
                continue
            }
            let same = x.args.length === y.args.length && x.args.every((v, i) => v === y.args[i])
            const s = x.source, t = y.source
            if (same && (s || t) && !(s && t && s[0] === t[0] && s[1] === t[1] && s[2] === t[2]))
                same = false
            if (same)
                continue
            if (!x.draw || !x.boxes || !y.boxes)
                return no('unbounded ' + x.name)
            for (const q of x.boxes) dirty.push(cell(q))
            for (const q of y.boxes) dirty.push(cell(q))
        }
        const rects = InterfaceRecorder.disjoint(dirty.map(q => {
            const x0 = Math.max(0, q[0]), y0 = Math.max(0, q[1]), x1 = Math.min(W, q[2]), y1 = Math.min(H, q[3])
            return {x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0)}
        }).filter(r => r.w > 0 && r.h > 0))
        const area = rects.reduce((n, r) => n + r.w * r.h, 0), whole = b.rects(W, H).reduce((n, r) => n + r.w * r.h, 0)
        if (!(area < 0.5 * whole))
            return no('area ' + Math.round(area / 1e3) + 'k/' + Math.round(whole / 1e3) + 'k')
        // The drawing calls that may paint a pixel of the rectangles (their boxes, a pixel grown, meet one).
        const meets = q => rects.some(r => q[0] < r.x + r.w && r.x < q[2] && q[1] < r.y + r.h && r.y < q[3])
        const calls = []
        for (const c of b.calls) {
            if (c.draw) {
                if (!c.boxes)
                    return no('grown unbounded ' + c.name)
                if (!c.boxes.some(q => meets(cell(q))))
                    continue
            }
            calls.push(c)
        }
        return {rects, calls}
    }
    // TASK-1561: whether recordings a and b (the same calls) start from states that draw the same: the same state, or one
    // that differs only in properties no drawing call of b reads (each set before any drawing call, at the save level it is
    // drawn in; a restore past b's own saves brings the start back). The interface is recorded from the main canvas's state
    // as the board left it (the last fill's style, a text's font), which a frame on the unit sectors leaves otherwise.
    static sameStart(a, b) {
        if (sameCanvasState(a.state, b.state))
            return true
        const names = CANVAS_STATE.filter(name => a.state[name] !== b.state[name])
        const da = a.state.lineDash || [], db = b.state.lineDash || []
        if (da.length !== db.length || da.some((v, k) => v !== db[k]))
            names.push('lineDash')
        let set = new Set()
        const stack = []
        for (const c of b.calls) {
            if (c.set !== undefined)
                set.add(c.set)
            else if (c.name === 'save')
                stack.push(new Set(set))
            else if (c.name === 'restore')
                set = stack.length ? stack.pop() : new Set()
            else if (c.name === 'setLineDash')
                set.add('lineDash')
            else if (c.name === 'reset')
                return false
            else if ((c.draw || CANVAS_DRAW_CALLS.has(c.name)) && names.some(name => !set.has(name)))
                return false
        }
        return true
    }
    // Rectangles {x, y, w, h} covering the same pixels as rects, none overlapping another (each the part of a rectangle
    // outside those before it, in at most four pieces per overlap).
    static disjoint(rects) {
        let out = []
        for (const r of rects) {
            let pieces = [{x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h}]
            for (const o of out) {
                const next = []
                for (const p of pieces) {
                    if (p.x1 <= o.x0 || o.x1 <= p.x0 || p.y1 <= o.y0 || o.y1 <= p.y0) {
                        next.push(p)
                        continue
                    }
                    if (p.y0 < o.y0) next.push({x0: p.x0, y0: p.y0, x1: p.x1, y1: o.y0})
                    if (o.y1 < p.y1) next.push({x0: p.x0, y0: o.y1, x1: p.x1, y1: p.y1})
                    const y0 = Math.max(p.y0, o.y0), y1 = Math.min(p.y1, o.y1)
                    if (p.x0 < o.x0) next.push({x0: p.x0, y0, x1: o.x0, y1})
                    if (o.x1 < p.x1) next.push({x0: o.x1, y0, x1: p.x1, y1})
                }
                pieces = next
            }
            out = out.concat(pieces.map(p => ({x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, x: p.x0, y: p.y0, w: p.x1 - p.x0, h: p.y1 - p.y0})))
        }
        return out.map(p => ({x: p.x, y: p.y, w: p.w, h: p.h}))
    }
    // Makes recording's calls on ctx.
    replayOn(ctx, recording) {
        replayCanvasCalls(ctx, recording.calls, recording.labels, -1, true, 0, recording.calls.length)
    }
    // Whether recordings a and b draw the same: the same key, starting state and calls with the same arguments (canvases
    // drawn: the same size and contentVersion).
    static same(a, b) {
        if (a.calls.length !== b.calls.length || a.key.length !== b.key.length || !a.key.every((v, k) => v === b.key[k]))
            return false
        const ta = a.state.transform, tb = b.state.transform
        if (ta.a !== tb.a || ta.b !== tb.b || ta.c !== tb.c || ta.d !== tb.d || ta.e !== tb.e || ta.f !== tb.f ||
                !InterfaceRecorder.sameStart(a, b))
            return false
        for (let k = 0; k < a.calls.length; ++k) {
            const x = a.calls[k], y = b.calls[k]
            if (x.set !== y.set || x.name !== y.name)
                return false
            if (x.set !== undefined) {
                if (x.value !== y.value) return false
                continue
            }
            const p = x.args, q = y.args
            if (p.length !== q.length) return false
            for (let i = 0; i < p.length; ++i) if (p[i] !== q[i]) return false
            const s = x.source, t = y.source
            if (s || t) {
                if (!s || !t || s[0] !== t[0] || s[1] !== t[1] || s[2] !== t[2]) return false
            }
        }
        return true
    }
    // The current path's segments' device boxes, beside its whole box (trace): a stroke paints only near its segments, so
    // a stroked outline (a screen-sized frame) is bounded by strips along its sides, not by the whole rectangle.
    trace(name, a) {
        super.trace(name, a)
        if (name === 'beginPath') {
            this.segments = []
            this.point = this.start = null
            return
        }
        // this.point: the points the path's current point lies in the hull of (after an arcTo, its tangent point lies
        // between its corner and its end), this.start: the subpath's first point.
        const segments = this.segments ||= []
        const m = this.transform(), at = (x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]
        const add = (...points) => {
            if (segments.length > 64) return
            const xs = points.map(p => p[0]), ys = points.map(p => p[1])
            segments.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)])
        }
        const from = this.point || []
        switch (name) {
        case 'moveTo': this.point = [this.start = at(a[0], a[1])]; break
        case 'lineTo': { const p = at(a[0], a[1]); add(...from, p); if (!this.point) this.start = p; this.point = [p]; break }
        case 'arcTo': { const c = at(a[0], a[1]), p = at(a[2], a[3]); add(...from, c, p); if (!this.point) this.start = c; this.point = [c, p]; break }
        case 'quadraticCurveTo': { const p = at(a[2], a[3]); add(...from, at(a[0], a[1]), p); this.point = [p]; break }
        case 'bezierCurveTo': { const p = at(a[4], a[5]); add(...from, at(a[0], a[1]), at(a[2], a[3]), p); this.point = [p]; break }
        case 'rect': {
            const p = at(a[0], a[1]), q = at(a[0] + a[2], a[1]), r = at(a[0] + a[2], a[1] + a[3]), t = at(a[0], a[1] + a[3])
            add(p, q); add(q, r); add(r, t); add(t, p)
            this.point = [this.start = p]
            break
        }
        case 'closePath': if (this.point && this.start) { add(...from, this.start); this.point = [this.start] } break
        case 'save': case 'restore': case 'translate': case 'scale': case 'rotate': case 'transform':
        case 'setTransform': case 'resetTransform': case 'clip': case 'setLineDash': break
        default: segments.length = 65 // arc, ellipse, roundRect (corners inside the sides) and calls not followed: the whole box
        }
    }
    // A stroke of the current path: one box a segment (trace), grown by the stroke's reach; else the whole path's box.
    boundStroke() {
        const segments = this.segments
        if (!this.path || !segments || !segments.length || segments.length > 64)
            return false
        const reach = this.strokeReach()
        for (const s of segments) {
            const box = [s[0] - reach, s[1] - reach, s[2] + reach, s[3] + reach]
            this.shadowed(box)
            this.boxes.push(box)
        }
        return true
    }
    // The first difference between recordings a and b (InterfaceLayer.stats.changes): 'calls' (their number), 'state', or
    // the first call that differs ('set <property>' or '<method> <argument index>').
    static difference(a, b) {
        if (a.volatile) return 'volatile'
        if (a.calls.length !== b.calls.length) return 'calls'
        if (a.key.some((v, k) => v !== b.key[k])) return 'key'
        if (!sameCanvasState(a.state, b.state)) return 'state ' + canvasStateDiff(a.state, b.state)
        for (let k = 0; k < a.calls.length; ++k) {
            const x = a.calls[k], y = b.calls[k]
            if (x.set !== y.set || x.name !== y.name) return 'call ' + (x.set || x.name)
            if (x.set !== undefined) {
                if (x.value !== y.value) return 'set ' + x.set
                continue
            }
            for (let i = 0; i < x.args.length; ++i) if (x.args[i] !== y.args[i]) return x.name + ' ' + i + (typeof x.args[i] === 'string' ? ' ' + x.args[i].slice(0, 16) : '')
            const s = x.source, t = y.source
            if ((s || t) && !(s && t && s[0] === t[0] && s[1] === t[1] && s[2] === t[2]))
                return x.name + ' source ' + (s || []).join('x') + (s && t && s[0] === t[0] && s[1] === t[1] ? ' version' : '') +
                    (x.args[0]?.canvasPooled !== undefined ? ' pooled' : '')
        }
        return 'transform'
    }
    // A drawing call's device bounds (CanvasCallRecorder.bound), texts and shadows included.
    bound(name, a) {
        const g = this.scratch
        if (g.filter && g.filter !== 'none') {
            this.unbounded = true
            return
        }
        let box = [Infinity, Infinity, -Infinity, -Infinity], grow = 0
        if (name === 'fillText' || name === 'strokeText') {
            const m = g.measureText(String(a[0]))
            const ascent = m.actualBoundingBoxAscent, descent = m.actualBoundingBoxDescent
            if (![m.actualBoundingBoxLeft, m.actualBoundingBoxRight, ascent, descent].every(Number.isFinite)) {
                this.unbounded = true
                return
            }
            // Glyphs may reach a little past their measured box (antialiasing, hinting): a fifth of the text's height.
            const pad = 0.2 * (ascent + descent) + 1
            const x0 = a[1] - m.actualBoundingBoxLeft - pad, x1 = a[1] + m.actualBoundingBoxRight + pad
            const y0 = a[2] - ascent - pad, y1 = a[2] + descent + pad
            this.grow(box, x0, y0); this.grow(box, x1, y1); this.grow(box, x1, y0); this.grow(box, x0, y1)
            if (name === 'strokeText') grow = this.strokeReach()
        }
        else if (name === 'stroke' && !(a[0] && typeof a[0] === 'object') && !g.shadowBlur && !g.shadowOffsetX &&
                !g.shadowOffsetY && this.boundStroke())
            return
        else if (name === 'strokeRect' && !g.shadowBlur && !g.shadowOffsetX && !g.shadowOffsetY) {
            // Its four sides, each grown by the stroke's reach.
            const reach = this.strokeReach(), x0 = a[0], y0 = a[1], x1 = a[0] + a[2], y1 = a[1] + a[3]
            for (const [p, q, r, t] of [[x0, y0, x1, y0], [x1, y0, x1, y1], [x0, y1, x1, y1], [x0, y0, x0, y1]]) {
                const side = [Infinity, Infinity, -Infinity, -Infinity]
                this.grow(side, p, q); this.grow(side, r, t)
                this.boxes.push([side[0] - reach, side[1] - reach, side[2] + reach, side[3] + reach])
            }
            return
        }
        else if (name === 'clearRect') {
            this.grow(box, a[0], a[1]); this.grow(box, a[0] + a[2], a[1] + a[3])
            this.grow(box, a[0] + a[2], a[1]); this.grow(box, a[0], a[1] + a[3])
        }
        else {
            const shadow = [g.shadowBlur, g.shadowOffsetX, g.shadowOffsetY]
            const before = this.boxes.length
            g.shadowBlur = g.shadowOffsetX = g.shadowOffsetY = 0
            try { super.bound(name, a) }
            finally { [g.shadowBlur, g.shadowOffsetX, g.shadowOffsetY] = shadow }
            if (this.boxes.length > before)
                this.shadowed(this.boxes[this.boxes.length - 1])
            return
        }
        if (!(box[0] <= box[2] && box[1] <= box[3]))
            return
        box = [box[0] - grow, box[1] - grow, box[2] + grow, box[3] + grow]
        this.shadowed(box)
        this.boxes.push(box)
    }
    // box grown by the current shadow (device px: the blur's reach and the offset, not transformed).
    shadowed(box) {
        const g = this.scratch, blur = g.shadowBlur, dx = g.shadowOffsetX, dy = g.shadowOffsetY
        if (!(blur > 0 || dx || dy))
            return
        const reach = 2 * blur + 2
        box[0] = Math.min(box[0], box[0] + dx - reach)
        box[1] = Math.min(box[1], box[1] + dy - reach)
        box[2] = Math.max(box[2], box[2] + dx + reach)
        box[3] = Math.max(box[3], box[3] + dy + reach)
    }
}

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
// TASK-1518: stages of a build between frames (Grid.surfaceCacheBuildStep with a budget) drawn in steps (generators of the
// same calls in the same order), by stage index: the underlay and the slab's sides a step each; the cells' tiles (the
// owned tiles of the board's owners not built yet first, a tile a step: ownedFillSteps, as drawTile would build them; the
// grout a step) in SURFACE_HEX_STEPS runs (drawHexagons' parts, as the lit rest snapshot draws them); the shadows (their
// clip path traced and their casters in steps: drawShadowSteps), the fog and the rim each a step; the buildings' bodies in
// SURFACE_BODY_STEPS runs of rows. The bake stays one stage (drawn in steps, frames between them could rebuild the light map
// at the camera's scale before its draws: the cell layer's renders then found no map of the cache's scale, test-cell-layer).
// A stage was up to ~350 ms on the user's desktop. Chromium rasterizes a step's drawing in its task; the stage's end has it
// rasterized as a whole stage does (flushSurfaceBuild).
const SURFACE_HEX_STEPS = 32
const SURFACE_BODY_STEPS = 8
const SURFACE_CACHE_STAGE_STEPS = {
    0: function* (grid, build) {
        const cacheCtx = build.ctx, scale = build.geometry.scale
        cacheCtx.setTransform(1, 0, 0, 1, 0, 0)
        cacheCtx.clearRect(0, 0, build.canvas.width, build.canvas.height)
        cacheCtx.scale(scale, scale)
        cacheCtx.translate(-build.left, -build.top)
        mapDepth.renderUnderlay(cacheCtx, scale)
        yield RASTER_STEP
        mapDepth.renderAtmosphericSides(cacheCtx)
        grid.flushSurfaceBuild(build)
    },
    1: function* (grid, build) {
        const tiles = atmosphericLighting.ownedTileMap()
        for (const _ of atmosphericLighting.ownedFillSteps(atmosphericLighting.ownedFills().filter(fill => !tiles.has(fill))))
            yield
        grid.drawHexagons(build.ctx, {k: 0, n: 0, grout: true})
        yield RASTER_STEP
        for (let k = 0; k < SURFACE_HEX_STEPS; ++k) {
            grid.drawHexagons(build.ctx, {k, n: SURFACE_HEX_STEPS, grout: false})
            if (k < SURFACE_HEX_STEPS - 1)
                yield RASTER_STEP
        }
        grid.flushSurfaceBuild(build)
    },
    2: function* (grid, build) {
        // Through drawShadows and bake (which tests replace), their steps when they give them.
        const shadows = atmosphericLighting.drawShadows(build.ctx, grid, true)
        if (shadows && typeof shadows.next === 'function')
            yield* shadows
        yield RASTER_STEP
        if (isFogOfWar) {
            grid.drawFogOfWar(build.ctx)
            yield RASTER_STEP
        }
        mapDepth.renderRim(build.ctx)
        grid.flushSurfaceBuild(build)
    },
    3: function* (grid, build) {
        for (let k = 0; k < SURFACE_BODY_STEPS; ++k) {
            grid.drawEntityBodies(build.ctx, {k, n: SURFACE_BODY_STEPS})
            if (k < SURFACE_BODY_STEPS - 1)
                yield RASTER_STEP
        }
        grid.flushSurfaceBuild(build)
    },
}
// TASK-1544: the stand-in preview's raster (Grid.startStandInPreview), the surface cache's stages' calls at its scale in fewer
// steps (a quarter of the pixels): the underlay and sides, the grout and the cells' tiles in STANDIN_HEX_STEPS runs (an
// owner's tiles not built yet drawn flat in its colour: building them was ~950 ms of a 1270 ms preview at a game's
// start on this host; the cache's build and prewarmOwnedTiles build them), the fog and rim, the buildings' bodies in
// STANDIN_BODY_STEPS runs; then lit with the light map there is (atmosphericLighting.bakeStandIn; none: lit by a later
// step, Grid.standInPreviewStep). Not the buildings'
// shadows: on the 6-player board they were 820 of the preview's 1310 ms on this host (the rest ~490 ms, the cache's own
// stages 0-4 ~1480 ms: artifacts/TASK-1544 prevcost).
const STANDIN_HEX_STEPS = 8
const STANDIN_BODY_STEPS = 2
// How long after a frame drew a stand-in the surface cache's tasks run Grid.donorTaskMs of steps (prepareSurfaceCache).
const STANDIN_WAIT_MS = 500
// The preview's steps within budget ms: unlike runSteps a piece heavy to rasterize (RASTER_STEP) does not end the run: its
// raster is made at once (the preview's canvas flushed, as flushSurfaceBuild), so the time measured holds it.
function runStandInSteps(board, p, budget) {
    const start = performance.now()
    let piece = 0
    do {
        const begin = performance.now(), step = p.steps.next()
        if (step.done)
            return true
        if (step.value === RASTER_STEP)
            board.flushSurfaceBuild(p)
        piece = performance.now() - begin
    } while (performance.now() - start + piece < budget)
    return false
}
function* standInPreviewSteps(grid, p) {
    const g = p.ctx
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, p.canvas.width, p.canvas.height)
    Grid.surfacePlace(p.scale, p.left, p.top)(g)
    mapDepth.renderUnderlay(g, p.scale)
    mapDepth.renderAtmosphericSides(g)
    yield RASTER_STEP
    grid.drawHexagons(g, {k: 0, n: 0, grout: true})
    for (let k = 0; k < STANDIN_HEX_STEPS; ++k) {
        yield RASTER_STEP
        // The owned tiles not built yet drawn flat in their colour (atmosphericLighting.flatOwnedTiles), not built here.
        atmosphericLighting.flatOwnedTiles = true
        try {
            grid.drawHexagons(g, {k, n: STANDIN_HEX_STEPS, grout: false})
        } finally {
            atmosphericLighting.flatOwnedTiles = false
        }
    }
    yield RASTER_STEP
    if (isFogOfWar)
        grid.drawFogOfWar(g)
    mapDepth.renderRim(g)
    for (let k = 0; k < STANDIN_BODY_STEPS; ++k) {
        yield RASTER_STEP
        grid.drawEntityBodies(g, {k, n: STANDIN_BODY_STEPS})
    }
    yield RASTER_STEP
    p.lit = atmosphericLighting.bakeStandIn(g, grid)
}
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
// TASK-1519: how often (ms) a cache the lit view waits for as its stand-in is compared with the board (prepareSurfaceCache).
const SURFACE_PATCH_CHECK_MS = 100
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
// TASK-1519: a turn playback's loaded board takes over the computed board's surface cache (Grid.adoptSurfaceCache).
Grid.surfaceAdoption = true
// TASK-1519: a lit view without a finished rest snapshot follows a board change, the tiles it reaches stale (Grid.refreshLitTiles).
Grid.litTileRefresh = true
// TASK-1519: a surface cache standing in for lit tiles has its cell layer brought up to the board first (Grid.litStandIn).
Grid.standInFollows = true
// TASK-1519: a turn playback's loaded board finishes the computed board's surface cache build under way and takes it over
// (Grid.stepSurfaceDonor) instead of starting its own.
Grid.donorBuilds = true
Grid.donorTaskMs = 40
// TASK-1543: the surface cache's build (and split) under way goes on while the camera moves or the lit view waits for it
// (Grid.prepareSurfaceCache); false: only with the camera at rest and the lit view's tiles built, as before.
Grid.movingCacheBuilds = true
// TASK-1544: frames with no surface cache to draw (or no lit tiles and no cache to stand in) draw its stand-in instead of the
// board directly (Grid.standInSource); the preview's scale, a part of the cache's (its raster a quarter of the pixels).
Grid.standIns = true
Grid.STANDIN_SCALE = 0.5
// TASK-1543: how long (ms, from the first frame drawn after the start hold) the surface cache's build waits for the start
// view's rest snapshot (Grid.litRestUnderWay, TASK-1518).
Grid.START_REST_FIRST_MS = 1000
Grid.donorLogSteps = false
// TASK-1360: true brings the surface cache's cell layer up to a board change needing new variants in a job, a step a frame
// (Grid.startSurfaceLayerJob); false draws them all in the frame that found the change (refreshCellLayer).
Grid.surfaceLayerJobs = true
// TASK-1372: true splits a raster into its cell layer in steps, CELL_SPLIT_CELLS cells a task (Grid.startCellSplit), and a
// lit view without a stand-in has its tiles built in tasks while the frames draw the board live (Grid.litTilesUnbuilt); false
// does each in the frame or task that needs it, as before.
Grid.cellLayerSplitJobs = true
Grid.litFirstViewSteps = true
const CELL_SPLIT_CELLS = 400
// TASK-1518: a split job's preparation in steps (Grid.startCellSplit, cellSplitPrep), CELL_SPLIT_KEYS cells' sprite keys a step.
Grid.cellSplitPreps = true
const CELL_SPLIT_KEYS = 300
// TASK-1473: the time (ms) a between-frames step of the surface cache's build or a cell split takes at most, but for its
// last piece (runSteps, Grid.cellSplitStep).
const SURFACE_STEP_MS = 8
// TASK-1519: a donor's build task while the frames draw the board directly (Grid.stepSurfaceDonor).
const SURFACE_DONOR_TASK_MS = 40
// TASK-1519: a turn playback's start holds its frames (the screen keeps the turn end's frame, the playback's clock waits)
// while its board has no surface cache and finishes the computed board's (turnPlaybackView.holdFrame, Grid.stepSurfaceDonor),
// for at most PLAYBACK_HOLD_MS; the donor's tasks then take PLAYBACK_HOLD_TASK_MS each. False: no hold (the playback starts
// at once, the donor's work between its direct frames).
Grid.playbackHolds = true
// TASK-1519: a surface cache build between frames makes its cell mask first (Grid.surfaceCacheBuildStep); false: last.
Grid.maskFirst = true
Grid.PLAYBACK_HOLD_MS = 5000
// TASK-1520: frames drawn directly for want of the surface cache are held while its work runs back to back
// (Grid.holdCacheFrame), for at most CACHE_HOLD_MS, in tasks of CACHE_HOLD_TASK_MS. False: no hold.
Grid.cacheHolds = true
Grid.CACHE_HOLD_MS = 5000
const CACHE_HOLD_TASK_MS = 48
// TASK-1520: user input seen (a click, key, wheel or touch; watched from the first cache hold on): ends a cache hold.
let gridInputs = 0, gridInputWatched = false
function watchGridInput() {
    if (gridInputWatched || typeof document === 'undefined' || typeof document.addEventListener !== 'function')
        return
    gridInputWatched = true
    for (const type of ['mousedown', 'pointerdown', 'keydown', 'wheel', 'touchstart'])
        document.addEventListener(type, () => { ++gridInputs }, {capture: true, passive: true})
}
const PLAYBACK_HOLD_TASK_MS = 48
// A donor task: queued after the frame (setTimeout), or while frames are held at once after the task before (a message).
let donorChannel
function queueDonorTask(now, task) {
    if (!now || typeof MessageChannel !== 'function')
        return setTimeout(task)
    if (!donorChannel) {
        donorChannel = new MessageChannel()
        donorChannel.tasks = []
        donorChannel.port1.onmessage = () => donorChannel.tasks.shift()?.()
    }
    donorChannel.tasks.push(task)
    donorChannel.port2.postMessage(0)
}
// Runs steps (a generator) while the time spent and the last piece's fit in budget (ms; at least one piece). Returns whether
// they are done.
function runSteps(steps, budget = Infinity) {
    const start = performance.now()
    let piece = 0
    do {
        const begin = performance.now(), step = steps.next()
        if (step.done)
            return true
        piece = performance.now() - begin
        // TASK-1518: a step heavy to rasterize ends the run (its raster comes at the task's end).
        if (step.value === RASTER_STEP)
            return false
    } while (performance.now() - start + piece < budget)
    return false
}
// TASK-1361: variants a cell layer keeps a cell (the cell's now and the one before, for an undo; Grid.pruneCellSprites) and
// sprite canvases kept for reuse (Grid.cellSpriteCanvas).
const CELL_LAYER_VARIANTS = 2
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
// TASK-1455: 2 for a game's surface cache and lit view, 2 more for the menu's prebuilt boards (menuPrebuild).
const CELL_MASK_CACHE = 4
// A mask kept in cellMaskCache under key, the most recently used; the least recently used dropped beyond CELL_MASK_CACHE.
function rememberCellMask(key, mask) {
    cellMaskCache.delete(key)
    cellMaskCache.set(key, mask)
    if (cellMaskCache.size > CELL_MASK_CACHE)
        cellMaskCache.delete(cellMaskCache.keys().next().value)
}
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
// TASK-1571 (NOSTANDIN 4/6): false. The user, after the 2026-11-10 desktop and phone captures: 'this "low quality image"
// optimization really hurts experience'; outside a zoom gesture no frame draws the cache magnified for the lit view (nor its
// unit sectors on that ground). A phone's zoom gesture that no zoom-sectors frame draws (planLitView) keeps it inside the
// gesture only (litStandIn(ctx, true), counted in gestureStandIns).
Grid.litStandIns = false
// TASK-1571: a lit frame draws only exact pictures or the board's plain ground fill (drawGroundFill: the underlay's opaque
// fill of the board outline, mapDepth.drawUnderlay's colour) outside a zoom gesture: a tile on the canvas not built is built
// in the frame, at most LIT_FRAME_TILE_CAP a frame nearest the canvas's centre first (litFrameBuilds), the others filled
// until a later frame, a task or the Worker builds them; a frame whose view at the camera's scale is not made yet (its light
// map or its edges made by tasks, planLitView) draws the fill over the board (and the levels' exact or stretched sectors
// after a zoom, drawLevelStandIn); a view with many tiles not built is drawn so too, not live (litTilesUnbuilt). False: as
// before (with Grid.litStandIns false, every missing tile built in the frame, the light map and view at once).
Grid.litGroundFill = true
// TASK-1571: the stand-in (standInSource: the stale surface cache or its preview, drawStandIn) and the preview under the
// levels (drawLevelStandIn) only in an active zoom gesture (Grid.zoomGestureNow); false: as before (any frame).
Grid.standInsInGesture = true
// TASK-1571: whether a zoom gesture is under way (Screen.zoomGesture or surfaceZooming: the zoom input's window and the frames
// drawn after it), where the stand-ins stay.
Grid.zoomGestureNow = () => {
    const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
    return !!screen && !!(screen.zoomGesture || screen.surfaceZooming)
}
// TASK-1569: a lit task deferred by litTaskDefers shares the pause while the camera moves and runs at the latest in the next
// pause at rest, and a queued surface task that will draw nothing (surfaceTaskIdle) is not waited for; false: as TASK-1568
// (deferred while any condition holds).
Grid.litShareTurns = true
// TASK-1553: a lit frame's tile squares drawn from the stand-in inside the board outline get no sky (Grid.frameCover), and
// the slab shadow is clipped to the part of the canvas the sky is drawn on (Grid.drawSlabShadow).
Grid.standInCover = true
Grid.shadowClip = true
// TASK-1374: true draws a zoom gesture's frames from the zoom raster, the board rebuilt once when it ends (Grid.drawZoomRaster);
// false draws them as any frame (the board directly above the surface cache's scale on a desktop).
Grid.zoomRasters = true
// TASK-1396: the band around the slab (in basis.r) a zoom raster copied from the held frame keeps (Grid.copyZoomBoard): the rim and
// the edge cells' strokes, half outside the outline.
Grid.ZOOM_SLAB_MARGIN = 0.12
// TASK-1517: a zoom gesture's raster without a held frame is the last frame's recorded board calls made again (Grid.replayZoomBoard)
// at once up to this many calls, else its board snapshot copied (Grid.keepZoomBitmap) or the calls made in steps between frames
// (Grid.startZoomReplay, the frame on screen held meanwhile) of about ZOOM_REPLAY_STEP_MS each, checked every ZOOM_REPLAY_CHUNK calls. False zoomReplays: the board rendered at once
// (Grid.renderZoomBoard).
Grid.zoomReplays = true
Grid.ZOOM_REPLAY_SYNC_CALLS = 600
// The frames a gesture keeps the frame on screen while its raster is made in steps (Grid.holdZoomFrame).
Grid.ZOOM_HOLD_FRAMES = 4
// TASK-1518: a new board's first frame held while its lit tiles are built (Grid.holdStartFrame), for at most
// START_HOLD_MS (then the frames are drawn as before), START_STEP_MS of steps a frame.
Grid.startHolds = true
Grid.START_HOLD_MS = 5000
const START_STEP_MS = 8
// The frame pace the held frames keep (ms from one to the next: 60 Hz with a margin) and the most pieces heavy to rasterize
// a held frame runs (Grid.holdStartFrame).
const START_PACE_MS = 21
const START_MAX_RASTER = 16
Grid.ZOOM_REPLAY_STEP_MS = 6
Grid.ZOOM_REPLAY_CHUNK = 8
// TASK-1375: level-of-detail frames (Grid.lodTransform) below this hexagon radius on screen, in CSS pixels (12 device pixels at
// the user's DPR 1.5): the hp and moves bars are then about a pixel high and the cell texts 3-4 pixels, unreadable. False:
// every frame draws as above it.
Grid.LOD_RADIUS = 8
// TASK-1514: bumped by every logic text change (made, set, cleaned, Grid.logicTextChanged): the scene layer's key.
Grid.logicTextRevision = 0
Grid.logicTextChanged = () => { ++Grid.logicTextRevision }
Grid.lodFrames = true
// TASK-1376: simple visuals' frames walk the cells reaching the canvas only (drawRange); still frames above the
// level-of-detail threshold are held (Grid.stillFrameCandidate).
Grid.simpleCulling = true
Grid.stillFrames = true
// TASK-1516: still frames on the lit tiles (while the rest snapshot is built) and during the snapshot's split are held too.
Grid.stillLitTiles = true
// TASK-1474: moving frames far out draw from the scene layer (Grid.drawSceneLayer).
Grid.sceneLayers = true
// TASK-1515: pan frames on the lit tiles draw the units and cell texts from the lit layer (Grid.drawLitLayer).
Grid.litLayers = true
// TASK-1377: a lit view holding exactly vouches for the light map (atmosphericLighting.trust) and drawLitEdges keeps its runs
// (litEdgeRuns). False: every frame compares the whole board's light state and finds the runs again.
Grid.litTrust = true
// TASK-1545: lit tiles' quarters the board cannot reach are not kept (Grid.litTileParts).
Grid.litPartSkips = true
// TASK-1546: lit tiles built by the tasks between frames a step at a time (Grid.buildLitTiles, litTileSteps); false: a tile a
// task at once as before.
Grid.litTileSteps = true
// TASK-1565 pass 6: with the Worker drawing, a lit tile's steps recorded once on the whole tile, not once a quarter
// (Grid.litTileSteps); false: a recording a quarter as before.
Grid.litTileWhole = true
// TASK-1565 pass 7: the lit tiles' row walks and union paths kept across tiles (Grid.litStepMemo); false: a memo a tile.
Grid.litRowMemo = true
// TASK-1552: lit tiles built ahead of the camera, at rest and while it moves (Grid.queueLitTiles, litAheadRange); false: only
// within a tile of the canvas and none while the camera moves when a tile does not fit LIT_TASK_MS, as before.
Grid.litAhead = true
// TASK-1552: and while the camera moves, a step at least a task and the tasks chained (LIT_AHEAD_TASKS); false (default): while
// it moves as before (none when a tile does not fit LIT_TASK_MS). On the user's 6-player capture replayed here (3 reps each) it
// built ~2.7 tiles a second against ~7.5 a second that the pan shows (318 distinct tiles, ~42 s), so frames still drew ~63 of 66
// tiles from the stand-in, while its ~0.63 MP of offscreen drawing a tile doubled the heavy pan frames (14 -> 28-36).
Grid.litAheadMoving = false
// TASK-1565 (SECTORS 9/11): the sectors of the camera's level built ahead of it, in a ring, while it moves and at rest, within
// a frame's budget (Grid.aheadRange, queueLitTiles, queueUnitSectors); false: as TASK-1564.
Grid.sectorAhead = true
// TASK-1570 (NOSTANDIN 3/6): lit tiles ready ahead of the screen. litAheadSized: the lit ring's reach from the camera's
// velocity and the measured build time a tile (litAheadRange, litReach); litWorkerOrder: the worker's pending lit builds
// posted in order (on the canvas first, then by when the camera reaches them; cancelled when it left them: litTilePriority,
// SectorWorker.pump) and a square on the canvas may fill its queue further (SectorWorker.busy(true)); litDrainRefill: a
// picture back queues the lit tiles still missing (SectorWorker.onDrain). false: as TASK-1569.
Grid.litAheadSized = true
Grid.litWorkerOrder = true
Grid.litDrainRefill = true
// TASK-1570: with the Worker drawing them, a settle's or a moving camera's unit sector builds bounded by their recording time
// (unitSectorTask: AHEAD_WORKER_FRAME_MS a task) instead of the frame's draw calls left; false: as TASK-1565.
Grid.unitWorkerTime = true
// TASK-1570: the surface cache split's last step (its whole-canvas cut) waits for the camera at rest while the frames draw the
// cache (surfaceSplitStep), at most SPLIT_CUT_WAIT_MS; false: as before.
Grid.splitCutAtRest = true
const SPLIT_CUT_WAIT_MS = 4000
// TASK-1565: the ring of squares round the canvas (besides the squares the camera's motion reaches: aheadRange), and the lit
// tile steps the builds between two frames of a moving camera make at most (each counted LEVEL_TILE_STEP_CALLS in the
// frame's LEVEL_FRAME_CALLS).
const SECTOR_AHEAD_RING = 1
const AHEAD_TILE_STEPS = 8
// TASK-1565 rework: with the Worker drawing the pictures, the main-thread time (ms) the lit tile steps' recordings between two
// frames of a moving camera take at most (half a 60 Hz frame).
const AHEAD_WORKER_FRAME_MS = 8
// TASK-1565 rework: and up to a whole 60 Hz frame while tiles on the canvas are missing (the frames draw the stand-in there).
const AHEAD_WORKER_CATCHUP_MS = 16
// TASK-1565: a moving camera's frame and the builds before it at most this many draw calls together (Grid.aheadCallsLeft).
const AHEAD_FRAME_TOTAL = 370
const AHEAD_FRAME_SAMPLES = 5
// TASK-1565: the whole sectors a lit frame makes from a built tile and its overlay at most (Grid.composeUnitSector: 5 draw calls
// and ~0.13 MP each).
const AHEAD_COMPOSE_FRAME = 3
// TASK-1565: the offscreen megapixels the builds between two frames of a moving camera and its composes draw at most (about:
// a lit tile step ~0.045 MP, a unit sector ~0.1, a compose ~0.13 on the user's capture replayed, artifacts/TASK-1565), so the
// frame stays under a heavy frame's 1 MP offscreen (Grid.aheadMpLeft).
const AHEAD_FRAME_MP = 0.7
const AHEAD_STEP_MP = 0.05
const AHEAD_SECTOR_MP = 0.1
const AHEAD_COMPOSE_MP = 0.13
// TASK-1565: a moving camera's live squares are built in a burst (unitSectorTask) only when its frames draw more than this.
const AHEAD_BURST_FRAME_CALLS = 500
// TASK-1565: a lit tile step's draw calls before any was counted (litStepCalls).
const LEVEL_TILE_STEP_CALLS_FIRST = 80
// TASK-1546: the lit layer drawn by tasks of steps (Grid.queueLitLayer: litLayerRasterSteps), at most LIT_LAYER_TASK_MS a task
// but its first step; false: in one task as before.
Grid.litLayerSteps = true
// TASK-1546: no zoom board snapshot of a frame that lit-tile frames of its camera follow (Grid.keepZoomBitmap).
Grid.zoomBitmapLitSkips = true
// TASK-1546: a new lit view with the surface cache to stand in made by tasks between frames (Grid.stepLitView); false: in the
// frame that needs it, as before.
Grid.litViewSteps = true
// TASK-1545: a frame on the lit tiles draws only the sky's blocks the board leaves open (Grid.coverSkyBlocks).
Grid.skyBlocks = true
// TASK-1559 (SECTORS 3/11): the lit tiles kept as board-space sectors in the board's SectorCache (Grid.litHas, adoptSectors,
// staleSectors); false: tiles on the grid of the view's own transform, released with it, as before.
Grid.litSectors = true
// TASK-1559: the lit sectors' budget on a phone (SECTOR_CACHE_BYTES elsewhere).
const LIT_SECTOR_PHONE_BYTES = 64 * 1024 * 1024
// TASK-1560 (SECTORS 4/11): pan frames draw the units pass from the unit sectors (Grid.unitSectorPlan); false: as before.
Grid.unitSectors = true
// TASK-1560: the unit sectors' budget (UNIT_SECTOR_PHONE_BYTES on a phone), the ring of squares built ahead round the canvas,
// and the time a build task between frames may take.
const UNIT_SECTOR_BYTES = 128 * 1024 * 1024
// TASK-1565: elsewhere the lit sectors and the unit sectors (UNIT_SECTOR_BYTES, both debug sets) share SECTOR_CACHE_BYTES
// (render/sectorCache.js; the server loads grid.js without it: no sectors there).
const LIT_SECTOR_BYTES = (typeof SECTOR_CACHE_BYTES !== 'undefined' ? SECTOR_CACHE_BYTES : 256 * 1024 * 1024) - UNIT_SECTOR_BYTES
const UNIT_SECTOR_PHONE_BYTES = 32 * 1024 * 1024
const UNIT_SECTOR_AHEAD = 1
const UNIT_SECTOR_TASK_MS = 8
// TASK-1561: the draw calls a unit sector build task may make (counted on the sectors' canvases, countDrawCalls; a build's
// steps, Grid.unitSectorSteps, each begun when its estimate fits, then its cell texts one by one): a task's builds stay off
// the heavy frames (500 calls with the frame's own).
const UNIT_SECTOR_TASK_CALLS = 200
// TASK-1561: a frame's live squares drawing more than UNIT_SECTOR_BURST_COST calls (UNIT_SECTOR_CELL_CALLS a unit cell, one a
// text: Grid.drawLiveSectorUnits' liveCost) make it heavy anyway: the next build task may then make UNIT_SECTOR_BURST_CALLS
// calls in UNIT_SECTOR_BURST_MS.
const UNIT_SECTOR_BURST_COST = 200
const UNIT_SECTOR_CELL_CALLS = 8
// TASK-1561: a unit sector's ground (a lit tile's quarters, the stand-in or the cache), in draw calls, about.
const UNIT_SECTOR_GROUND_CALLS = 8
// TASK-1561: a lit unit sector's units pass is drawn in column chunks of about this many calls (Grid.unitSectorSteps).
const UNIT_SECTOR_CHUNK_CALLS = 100
// TASK-1561: a cell text's box (Grid.textMeets): a character at most UNIT_TEXT_EM_WIDTH of the font size wide (Times New
// Roman: 0.25-0.94), UNIT_TEXT_EM_HEIGHT high, grown by its outline and UNIT_TEXT_PAD device pixels
// (antialiasing, a sprite's edge).
const UNIT_TEXT_EM_WIDTH = 1
const UNIT_TEXT_EM_HEIGHT = 1.5
const UNIT_TEXT_PAD = 3
const UNIT_SECTOR_BURST_CALLS = 10000
const UNIT_SECTOR_BURST_MS = 100
// TASK-1561: frames at rest have their unit sectors built between frames (Grid.restUnitSectors); false: only pans build.
Grid.unitSectorsAtRest = true
// TASK-1562 (SECTORS 6/11): zoom levels (Grid.drawZoomSectors, levelSettle, sectorRest). False: the zoom raster as before.
Grid.zoomLevels = true
// TASK-1566: a surface cache build without a cache during a zoom gesture bounded by its real draw calls (prepareSurfaceCache).
Grid.urgentGestureCalls = true
// TASK-1563: sector builds (lit tiles' quarters, unit sectors) recorded into a sector snapshot (SectorRecorder) and drawn
// by SectorDraw (render/sectorDraw.js) from it; false: drawn directly by the board's drawing code (the pre-TASK-1563 path,
// kept for the equivalence audit).
Grid.sectorModule = true
// TASK-1563: called with (snapshot, sprites, canvases) when a sector build made through SectorDraw ends (audits).
Grid.onSectorSnapshot = null
// TASK-1564 (SECTORS 8/11): sector pictures made in a Worker (render/sectorWorker.js: SectorWorker) from the snapshots the
// builds record; false (or the page's ?sectorWorker=0, or no Worker / OffscreenCanvas): drawn on the main thread as TASK-1563
// did (the fallback, counted). Not with an audit hook (Grid.onSectorSnapshot: it compares the main thread's pictures).
Grid.sectorWorker = true
Grid.sectorWorkerBusy = (shown = false) => Grid.sectorWorkerOn() && SectorWorker.busy(shown)
// TASK-1565 rework: whether the sector pictures are drawn in the Worker now (not the main-thread fallback): a build ahead then
// only records on the main thread (budgeted by its time, AHEAD_WORKER_FRAME_MS, not by offscreen megapixels or tile steps).
Grid.aheadInWorker = () => Grid.sectorWorkerOn()
// TASK-1564: the camera at rest: no pan or zoom gesture (nor their hold, surfaceMoving), no pan key or zoom key held, no glide.
Grid.cameraAtRest = () => {
    const events = typeof gameEvent !== 'undefined' ? gameEvent : null, screen = events?.screen
    return !!screen && !screen.surfaceMoving && !screen.zoomGesture && !screen.speedX && !screen.speedY && !screen.glide &&
        !events.heldZoomKeys?.size && !(typeof zoomRasterTweens === 'function' && zoomRasterTweens())
}
// TASK-1564: a picture back from the Worker frees a place in its queue: the unit sector builds a full queue stopped go on.
if (typeof SectorWorker !== 'undefined')
    SectorWorker.onDrain = () => {
        const g = typeof grid !== 'undefined' ? grid : null
        // TASK-1570 (Grid.litDrainRefill): the lit tiles the last lit frame's task left missing (litQueueAt.refill) queued
        // again at once, so the worker is fed as it drains instead of once a frame (the builds stay within the frame's
        // recording budget: AHEAD_WORKER_FRAME_MS / CATCHUP, levelFrameWork).
        const q = g && g.litQueueAt
        if (Grid.litDrainRefill && q && q.refill && q.view === g.litView && !g.litTilesQueued && !SectorWorker.busy(q.shownMissing)) {
            ++g.aheadWork.litDrainTasks
            g.queueLitTiles(q.view, q.t, q.cw, q.ch)
        }
        if (!g || !g.unitSectorWanted || g.unitSectorQueued || SectorWorker.busy(Grid.litWorkerOrder && g.unitSectorWanted.onCanvas > 0))
            return
        g.unitSectorQueued = true
        setTimeout(gridTask(() => g.unitSectorTask()))
    }
Grid.sectorWorkerOn = () => !!(Grid.sectorModule && Grid.sectorWorker && !Grid.onSectorSnapshot && typeof SectorWorker !== 'undefined' &&
    SectorWorker.on())
// The levels a level frame stretches from (the best first: stretchSources).
const LEVEL_SOURCES = 4
// The sectors a level frame draws stretched at most (stretchCover).
const LEVEL_MAX_DRAWS = 100
// The most a level is magnified to stand in for the camera's (stretchSources).
const LEVEL_MAX_MAGNIFY = 8
// Draw calls the tasks between two frames make after a zoom (the unit sector builds and the lit tile steps together:
// levelWorkLeft), at most LEVEL_TILE_STEPS lit tile steps, each counted LEVEL_TILE_STEP_CALLS (about: a tile quarter's
// draws, artifacts/TASK-1562), so a frame and the work before it stay under ~500 calls.
const LEVEL_FRAME_CALLS = 360
// A level frame and the tasks before the next together at most this many draw calls (a heavy frame: over 500), the frame's
// calls but its sector copies and live squares counted as LEVEL_FRAME_BASE.
const LEVEL_FRAME_TOTAL = 460
const LEVEL_FRAME_BASE = 40
// A level frame's unit sector task's time (the frames after a zoom draw few calls: ~60-130).
const LEVEL_TASK_MS = 24
// A level frame's burst (its live squares, the squares no level covers): one task long enough to end them (a burst cut at
// UNIT_SECTOR_BURST_MS went on over several frames, each a heavy one).
const LEVEL_BURST_MS = 250
const LEVEL_TILE_STEPS = 4
const LEVEL_TILE_STEP_CALLS = 80
// A settle (levelSettle) given up this long after its zoom's last frame (its squares then drawn as a pan's or rest frame's).
const LEVEL_SETTLE_MS = 6000
// After a zoom gesture (and while its settle lasts) the background builds that do not draw the frame run a piece a frame
// (the surface cache's build steps: Grid.oncePerFrame) or wait (its split, finish and bake, the owned tiles' prewarm, the
// sky raster, the canvas pools' reserves, cache holds) for this long after its last zoom frame (Grid.zoomQuiet), so they do not crowd the frames the
// levels draw (8 ms of them was 3-7 MP drawn between two frames on this host).
const ZOOM_QUIET_MS = 2500
// A zoom's quiet cache step: the pieces that fit this (up to a piece heavy to rasterize), one task a frame.
const ZOOM_QUIET_STEP_MS = 4
Grid.zoomQuiet = () => {
    const g = typeof grid !== 'undefined' ? grid : null
    if (!g || !Grid.zoomLevels || typeof g.levelsOn !== 'function' || !g.levelsOn())
        return false
    const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
    return !!screen?.zoomGesture || !!g.levelSettle || performance.now() < g.zoomQuietUntil
}
// Whether the camera moves or a zoom's quiet lasts (Grid.zoomQuiet): the optional prewarms (the sky raster, the owned tiles)
// and the surface cache's heavy pieces (its finish, the bake) wait for the camera at rest.
Grid.cameraBusy = () => {
    const screen = typeof gameEvent !== 'undefined' ? gameEvent.screen : undefined
    // (A zoom key held: the frames zoom by it, Events.updateKeyboardZoom, from the next one on.)
    return !!Grid.zoomLevels && (!!screen?.surfaceMoving || Grid.zoomQuiet() || !!screen && gameEvent.heldZoomKeys?.size > 0)
}
// Whether tag's piece of work may run now: the first time a frame (frameNo) it is asked.
Grid.quietPieces = new Map()
Grid.oncePerFrame = tag => {
    if (Grid.quietPieces.get(tag) === Grid.frameNo)
        return false
    Grid.quietPieces.set(tag, Grid.frameNo)
    return true
}
// The frame number (drawAll) and the level work the tasks did since that frame began.
Grid.frameNo = 0
Grid.levelFrameWork = {frame: -1, calls: 0, tileSteps: 0, mp: 0, prevMp: 0, ms: 0, unitMs: 0}
Grid.levelWorkLeft = () => {
    const w = Grid.levelFrameWork
    if (w.frame !== Grid.frameNo) {
        // TASK-1565: the offscreen megapixels the builds before this frame made (about: aheadMp), for its composes.
        w.prevMp = w.frame === Grid.frameNo - 1 ? w.mp : 0
        w.frame = Grid.frameNo
        w.calls = 0
        w.tileSteps = 0
        w.mp = 0
        w.ms = 0
        // TASK-1570: the unit sector tasks' recording time (unitSectorTask, Grid.unitWorkerTime)
        w.unitMs = 0
    }
    return {calls: LEVEL_FRAME_CALLS - w.calls, tileSteps: w.tileSteps}
}
// TASK-1565: the offscreen megapixels (about) the builds between two frames of a moving camera still may draw (a heavy frame:
// over 1 MP offscreen): AHEAD_FRAME_MP less AHEAD_STEP_MP a lit tile step and AHEAD_SECTOR_MP a unit sector spent; spend(mp).
Grid.aheadMpLeft = () => {
    Grid.levelWorkLeft()
    return AHEAD_FRAME_MP - Grid.levelFrameWork.mp
}
// The builds' offscreen megapixels before the frame being drawn (its composes draw within the rest).
Grid.aheadPrevMp = () => {
    Grid.levelWorkLeft()
    return Grid.levelFrameWork.prevMp
}
Grid.aheadMpSpend = mp => {
    Grid.levelWorkLeft()
    Grid.levelFrameWork.mp += mp
}
// TASK-1565: THE FRAME'S REAL DRAW CALLS (Grid.sectorAhead). Every drawing call of the page is counted (sectorCountDraws,
// render/sectorWorker.js: sectorDrawTotal); drawAll marks a frame's own calls (frameBegin / frameFinish: lastFrameCalls), so the
// builds between two frames of a moving camera spend their real calls (frameCallsNow deltas) within AHEAD_FRAME_TOTAL less the
// last frame's own (aheadCallsLeft): a frame and the builds before it stay under a heavy frame's 500 calls.
Grid.lastFrameCalls = 0
Grid.frameCallsStart = 0
Grid.frameCallsEnd = 0
Grid.frameBuildCalls = 0
Grid.lastFrameOwnCalls = 0
Grid.frameCallsNow = () => typeof sectorDrawTotal !== 'undefined' ? sectorDrawTotal : 0
Grid.frameBegin = () => {
    if (!Grid.sectorAhead)
        return
    if (typeof sectorCountDraws === 'function')
        sectorCountDraws()
    Grid.frameCallsStart = Grid.frameCallsNow()
    Grid.frameBuildCalls = 0
}
Grid.recentFrameCalls = []
Grid.frameFinish = () => {
    if (!Grid.sectorAhead)
        return
    // The most of the last AHEAD_FRAME_SAMPLES frames' own calls (a frame's varies with the squares it draws live).
    const recent = Grid.recentFrameCalls
    recent.push(Grid.frameCallsNow() - Grid.frameCallsStart)
    if (recent.length > AHEAD_FRAME_SAMPLES)
        recent.shift()
    Grid.lastFrameCalls = Math.max(...recent)
    // TASK-1572 (Grid.litFrameBudget): the frame's own calls besides the tiles it built itself, and where the next one's begin.
    Grid.lastFrameOwnCalls = Grid.frameCallsNow() - Grid.frameCallsStart - Grid.frameBuildCalls
    Grid.frameCallsEnd = Grid.frameCallsNow()
}
// The calls the builds before the next frame may still make while the camera moves (levelWorkLeft's, within the frame's room).
Grid.aheadCallsLeft = () => {
    const left = Grid.levelWorkLeft()
    return Math.min(left.calls, AHEAD_FRAME_TOTAL - Grid.lastFrameCalls - Grid.levelFrameWork.calls)
}
Grid.levelSpend = (calls, tileSteps = 0) => {
    Grid.levelWorkLeft()
    Grid.levelFrameWork.calls += calls
    Grid.levelFrameWork.tileSteps += tileSteps
}
// TASK-1561: debug turned on or off keeps the other state's unit sectors aside (Grid.unitSectorPlan), in a share of the
// budget; the index of debug in the unit sectors' key.
Grid.unitSectorDebugSets = true
const UNIT_SECTOR_ALT_SHARE = 0.5
const UNIT_SECTOR_DEBUG_KEY = 9
// TASK-1561: the index of debug in Grid.sceneLayerKey (the cache sectors' key from UNIT_SECTOR_KEY_BASE on).
const SCENE_LAYER_KEY_DEBUG = 9
// TASK-1561: the scene layer gives way to the unit sectors where they draw the pan (Grid.sceneYieldsToSectors).
Grid.sceneYieldsToSectors = true
// TASK-1561: the ground of a unit sector holding the units pass and cell texts only (Grid.unitSectorGround).
const UNIT_OVERLAY = 'overlay'
// TASK-1560: the unit sectors' key (unitSectorPlan) before the cache sectors' ground key (cacheSectorKey): its length.
const UNIT_SECTOR_KEY_BASE = 10
// How often (ms) an idle frame compares the surface cache with the whole board (Grid.prepareSurfaceCache).
const SURFACE_CACHE_CHECK_MS = 500
// The surface cache's captured state (captureSurfaceState), swapped for a lit view's copy (withLitState).
const SURFACE_STATE_FIELDS = ['surfaceCacheLighting', 'surfaceCacheAtmospheric', 'surfaceCacheLayered', 'surfaceCacheState',
    'surfaceCacheBuildings', 'surfaceCacheUnits', 'surfaceCacheBuildingImages', 'surfaceCacheUnitImages',
    'surfaceCacheInert', 'surfaceCacheInertUnits', 'surfaceCacheInertBuildings', 'surfaceCacheNatureNames']
// TASK-1519: the surface cache's rasters and their geometry (besides SURFACE_STATE_FIELDS) a board takes over from another
// (Grid.adoptSurfaceCache).
const SURFACE_ADOPTED_FIELDS = ['surfaceCache', 'surfaceCacheScale', 'surfaceCacheBounds', 'surfaceCacheLit',
    'surfaceCellLayer', 'surfaceCacheShown', 'surfacePatchBuffer']
// Lit tiles (Grid.drawLitView): side in device pixels (and the margin round it), tiles built
// between two frames, spare canvases kept, the side of the edge blocks the frame lights and the
// rest snapshot's bands.
const LIT_TILE = 256
// TASK-1552: the margin (device pixels) round a tile within which the board must reach for it to be built (Grid.litTileSteps).
const LIT_TILE_PAD = 8
// TASK-1545: a lit tile's quarter (Grid.litTileParts) and the reach (hex radii, besides the slab's depth) of a tile's drawing
// past the board outline (Grid.litPartEmpty: buildings and their shadows on the edge cells, the rim).
const LIT_TILE_PART = LIT_TILE / 2
const LIT_PART_REACH = 1.5
const LIT_TILE_BUDGET = 5
// TASK-1372: tiles a frame without a stand-in builds itself (drawLitView; more and it draws the board live, planLitView), and
// tiles a task builds meanwhile (queueLitTiles).
const LIT_FRAME_TILES = 8
// TASK-1571 (Grid.litGroundFill): lit tiles a frame builds itself at most (drawLitView, litFrameBuilds), nearest the canvas's
// centre first; the other squares without a tile get the ground fill. 2: the TASK-1568 baseline's most tiles built in one
// frame was 2 (phone, 1 desktop, 0 the older capture: tilesBuiltInFrame max, artifacts/TASK-1568/baseline.json), so a
// frame builds no more than before; a tile built on the main thread is a full lit tile drawing (11-14 ms on the Worker,
// TASK-1564), so 2 keep a frame's own building near one 30 ms frame, while 3-4 would make the camera's stop (the squares
// the ring did not reach) a frame of 40-55 ms, the stall TASK-1334 removed (40 tiles in one frame).
const LIT_FRAME_TILE_CAP = 2
// TASK-1572 (Grid.litFrameBudget): a frame builds its missing tiles itself (litFrameBuilds, at most LIT_FRAME_TILE_CAP) only while
// the calls since the last frame (the tasks between, the frame so far), the last frame's own calls besides its builds and the
// builds' (each the most of the last LIT_FRAME_TILE_SAMPLES measured, about 220-280) stay within LIT_FRAME_BUILD_CALLS, and the
// builds' offscreen megapixels (LIT_FRAME_TILE_MP each: a tile's quarters and buildings, 0.41-0.47 measured in the TASK-1571
// replays) with the builds' before the frame within LIT_FRAME_BUILD_MP: under a heavy frame's 500 calls / 1 MP (the frames
// building 2 tiles were 750-1050 calls, ~0.9 MP). The squares past it get the ground fill this frame (the Worker and the tasks
// build them); 0 when the frame has no room. False: LIT_FRAME_TILE_CAP a frame (TASK-1571).
Grid.litFrameBudget = true
const LIT_FRAME_BUILD_CALLS = 470
const LIT_FRAME_BUILD_MP = 0.9
const LIT_FRAME_TILE_MP = 0.45
const LIT_FRAME_TILE_SAMPLES = 4
Grid.litFrameTileCalls = [250]
Grid.litFrameTileBuilt = calls => {
    const recent = Grid.litFrameTileCalls
    recent.push(calls)
    if (recent.length > LIT_FRAME_TILE_SAMPLES)
        recent.shift()
    Grid.frameBuildCalls += calls
}
// The offscreen megapixels the frame's own tile builds were given (litFrameBuilds), for the composes (drawLitView).
Grid.frameTileMpAt = {frame: -1, mp: 0}
Grid.frameTileMp = () => Grid.frameTileMpAt.frame === Grid.frameNo ? Grid.frameTileMpAt.mp : 0
// The tiles the frame being drawn by board may still build itself (0..LIT_FRAME_TILE_CAP), the composes it made so far
// (AHEAD_COMPOSE_MP each) besides the builds' before it.
Grid.litFrameTilesFit = board => {
    // (Without the page's call counts, sectorCountDraws: no Worker, the headless tests: LIT_FRAME_TILE_CAP.)
    if (typeof sectorDrawCountsOn === 'undefined' || !sectorDrawCountsOn || !Grid.sectorAhead)
        return LIT_FRAME_TILE_CAP
    // TASK-1572 (Grid.settleHoldsLevels): none in a settle's frames (levelSettle): its squares without a tile are drawn from
    // the levels or the fill with their overlay sectors while the tile steps (Worker) build them; a settle frame building
    // tiles itself was heavy (2 tiles at 0.151 / 0.18: ~365 calls each, 790-810 a frame; 1 tile + composes + an interface
    // redraw: 1.03-1.07 MP; dev9-desk2, dev/dev-notes.md).
    if (Grid.settleHoldsLevels && board?.levelSettle)
        return 0
    const tile = Math.max(...Grid.litFrameTileCalls)
    // The tasks' calls since the last frame, and the frame's own: those so far or the last frame's, the larger.
    const between = Grid.frameCallsStart - Grid.frameCallsEnd
    const own = Math.max(Grid.frameCallsNow() - Grid.frameCallsStart - Grid.frameBuildCalls, Grid.lastFrameOwnCalls)
    const calls = Math.floor((LIT_FRAME_BUILD_CALLS - between - own) / tile)
    const composed = board && board.aheadComposed?.serial === board.drawSerial ? board.aheadComposed.n : 0
    const mp = Math.floor((LIT_FRAME_BUILD_MP - Grid.aheadPrevMp() - Grid.levelFrameWork.mp - composed * AHEAD_COMPOSE_MP) / LIT_FRAME_TILE_MP)
    return Math.max(0, Math.min(LIT_FRAME_TILE_CAP, calls, mp))
}
// TASK-1572 (Grid.litFillOverlays): the squares a lit frame fills (drawLitView, drawLevelStandIn's fill) want an overlay unit
// sector (queueUnitSectors), drawn over the fill, so their units and texts are not drawn live in every frame till the tile
// comes (the stand-in squares had sectors on the stand-in's ground). False: live over the fill (TASK-1571).
Grid.litFillOverlays = true
// TASK-1572: a settle's first frames draw the squares that would be live as the zoom gesture drew them, for at most
// SETTLE_HOLD_MS after its last frame (Grid.settleHoldOn); false: as fa72a557 (live at once).
Grid.settleHoldsLevels = true
Grid.SETTLE_HOLD_MS = 1000
Grid.SETTLE_HOLD_TASK_MS = 24
const LIT_FIRST_TILE_BUDGET = 16
const LIT_TILE_POOL = 16
// TASK-1552 (Grid.litAhead): lit tiles built ahead of the camera (Grid.queueLitTiles, litAheadRange): the ring round the
// canvas (tiles), the time (ms) of motion whose tiles are added on the sides the camera moves to (at most LIT_AHEAD_MAX),
// tiles kept past the ring while the camera moves, ring tiles built a task while it moves (the first LIT_AHEAD_CAP in order)
// and tasks between two frames, the order offset of tiles not on the canvas, and the camera's velocity smoothing (ms) and the
// frame gap (ms) after which it starts again (Grid.followLitMotion).
const LIT_AHEAD_RING = 1
const LIT_AHEAD_MS = 600
const LIT_AHEAD_MAX = 3
const LIT_AHEAD_KEEP = 2
const LIT_AHEAD_CAP = 8
const LIT_AHEAD_TASKS = 10
// TASK-1570 (Grid.litAheadSized): the most tiles the lit ring reaches past LIT_AHEAD_RING on a side the camera moves to
// (litReach; LIT_AHEAD_MAX before), and the share of the lit sectors' budget the whole ring may take (litAheadRange).
const LIT_AHEAD_REACH_MAX = 6
const LIT_AHEAD_BYTES_SHARE = 0.5
// TASK-1570: the ring's reach on every side from the recent peak speed (litPeakNow: decayed over LIT_AHEAD_PEAK_MS) at most.
const LIT_AHEAD_REST_MAX = 2
const LIT_AHEAD_PEAK_MS = 4000
// TASK-1552: lit tile quarters kept spare (Grid.releaseLitTile; topped up at rest, Grid.reserveLitTileParts).
const LIT_TILE_SPARE_PARTS = 192
const LIT_AHEAD_LATER = 1000
const LIT_MOTION_SMOOTH_MS = 100
const LIT_MOTION_GAP_MS = 400
const LIT_EDGE_BLOCK = 16
// TASK-1518: lit cells a step of litEdgesSteps takes the sides of.
const LIT_EDGE_STEP_CELLS = 400
const LIT_REST_BANDS = 12
// Tiles built a task while the camera rests after a patch of the view dropped some (Grid.finishLitPatch).
const LIT_TILE_PATCHED_BUDGET = 1
// TASK-1519: at most this many changed cells drawn over a lit view's stale tiles (Grid.refreshLitTiles); more drop the view.
const LIT_REFRESH_MAX_CELLS = 24
// TASK-1439: the time (ms) a task between frames spends on lit tiles (Grid.buildLitTiles: tiles while the task's time and one
// tile's estimate fit, LIT_TILE_BUDGET 1 ms tiles), and the most a rest task waits for the browser to be idle.
const LIT_TASK_MS = 5
const LIT_IDLE_TIMEOUT = 100
// TASK-1439: one lit tile's build time on this device (Grid.litTile): the mean of the last LIT_COST_SAMPLES builds,
// LIT_TASK_MS before the first.
const LIT_COST_SAMPLES = 8
// TASK-1546: a lit tile's cells' tiles drawn in this many steps (Grid.litTileSteps), the time (ms) a task with the camera at
// rest spends on steps (Grid.buildLitTiles), and one step's build time on this device (the mean of the last LIT_COST_SAMPLES
// steps, LIT_TASK_MS before the first).
const LIT_TILE_HEX_STEPS = 3
const LIT_REST_TASK_MS = 40
const litTileStepCost = {
    samples: [],
    ms: LIT_TASK_MS,
    add(ms) {
        this.samples.push(ms)
        if (this.samples.length > LIT_COST_SAMPLES)
            this.samples.shift()
        this.ms = this.samples.reduce((a, b) => a + b, 0) / this.samples.length
    }
}
// TASK-1565: the draw calls of a lit tile's steps built while the camera moves (Grid.buildLitTiles' ahead budget): the mean of
// the last LIT_COST_SAMPLES, and by the step's index in its tile the most of the last LIT_COST_SAMPLES of that index (at(k);
// LEVEL_TILE_STEP_CALLS before the first).
const litStepCalls = {
    samples: [],
    mean: LEVEL_TILE_STEP_CALLS_FIRST,
    byIndex: [],
    add(n, index = 0) {
        this.samples.push(n)
        if (this.samples.length > LIT_COST_SAMPLES)
            this.samples.shift()
        this.mean = this.samples.reduce((a, b) => a + b, 0) / this.samples.length
        const list = this.byIndex[index] ||= []
        list.push(n)
        if (list.length > LIT_COST_SAMPLES)
            list.shift()
    },
    at(index) {
        const list = this.byIndex[index]
        return list?.length ? Math.max(...list) : LEVEL_TILE_STEP_CALLS_FIRST
    }
}
const litTileCost = {
    samples: [],
    ms: LIT_TASK_MS,
    add(ms) {
        this.samples.push(ms)
        if (this.samples.length > LIT_COST_SAMPLES)
            this.samples.shift()
        this.ms = this.samples.reduce((a, b) => a + b, 0) / this.samples.length
    }
}
// The direct draw's surface and buildings in parts (Grid.drawLitScene), a part a step of a lit view patch.
// TASK-1565 pass 7: the most entries the lit tiles' shared memo (Grid.litStepMemo) holds before it starts again.
const LIT_MEMO_KEYS = 256
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
// TASK-1474: the scene layer (Grid.drawSceneLayer) is used for a layer rectangle over OVERLAY_LAYER_MAX_PIXELS and at most
// SCENE_LAYER_MAX_PIXELS (with the canvas-sized sky, within the images a Chromium canvas records before it rasterizes),
// with at least SCENE_LAYER_CELLS_PER_MP overlay cells a megapixel of it (their calls then cost more than the layer).
const SCENE_LAYER_MAX_PIXELS = 4.5 * 1024 * 1024
const SCENE_LAYER_CELLS_PER_MP = 64
// TASK-1515: the lit layer (Grid.drawLitLayer): its margin round the canvas (a fraction of the canvas each side), its largest
// size (device pixels) and the fewest cells it is drawn for.
const LIT_LAYER_MARGIN = 0.25
const LIT_LAYER_MAX_PIXELS = 9 * 1024 * 1024
const LIT_LAYER_MIN_CELLS = 16
// TASK-1551: the lit layer's strips (Grid.queueLitStrips): queued once the view is within LIT_STRIP_NEAR of its size of the
// layer's edge; the least a side is moved out (a fraction of the canvas); the wait (ms) of a task for the next frame; the reach
// (hex radii) of the cells drawn.
const LIT_STRIP_NEAR = 0.15
// TASK-1551: the drawing cells (litLayerSignature's) a task between two frames draws for the strips: about 9 draw calls each on the
// user's board at 0.467 (13 at most; TASK-1551 calls-per-cell.js), so a frame stays well under 500 calls.
const LIT_STRIP_STEP_CELLS = 24
// TASK-1551: the canvas state a lit layer does not depend on: the units pass and the cell texts set their own fill, stroke, line
// width, font and text placement (the frame's leftovers, such as the last owner colour drawn before them, change with the
// view). Each drawn with other values, the whole user's board's units and texts, debug texts too, drew the same pixels; not so
// lineJoin, lineCap and image smoothing, which stay compared (TASK-1551 fill-invariance.js).
const LIT_LAYER_FREE_STATE = ['fillStyle', 'strokeStyle', 'lineWidth', 'lineDashOffset', 'font', 'textAlign', 'textBaseline']
const LIT_STRIP_MIN = 0.05
const LIT_STRIP_WAIT_MS = 4
const LIT_STRIP_REACH = 1.5
// TASK-1551: a strip chunk's largest side (device pixels): one canvas of that square (Grid.litStripPool) a chunk.
const LIT_STRIP_TILE = 256
// TASK-1551: Grid.litStripPool's size (bytes) and the chunk canvases it keeps ready at rest at least.
const LIT_STRIP_POOL_BYTES = 64 * 1024 * 1024
const LIT_STRIP_RESERVE = 128
// TASK-1546: the time (ms) a task drawing the lit layer in steps (Grid.queueLitLayer) spends: its piece copies while the task's
// time and the last copy's fit (the units and texts, one step, always).
const LIT_LAYER_TASK_MS = 40
// TASK-1546: the time (ms) a task making a lit view in steps (Grid.stepLitView) spends, the first step always.
const LIT_VIEW_TASK_MS = 16
// The lit layer's pieces (Grid.litLayerPieces): the side (device pixels) of the blocks a drawing cell marks; its reach left, up,
// right and down in hex radii from its centre (measured on the user's board, Grid.litLayerAudit: a sprite 0.8 = assets.size / 2
// each way, a unit's hp bar up to 1.05 up, a portal's preview 0.73; texts inside the hexagon) and in device pixels besides
// (antialiasing); a piece's largest side (device pixels; a frame's canvas records a whole piece in view).
const LIT_PIECE_BLOCK = 16
// TASK-1550: canvases reused by size (CanvasPool, sprites/elements/rect.js) for the lit layer's pieces and the cell layers'
// sprites: at most GRID_POOL_BYTES kept after a rest's trim; at rest, LIT_PIECE_SPARE sets of the last lit layer's pieces
// kept ready (a layer built while one is drawn and another retired takes them, then the retired one's come back).
const GRID_POOL_BYTES = 160 * 1024 * 1024
// (TASK-1551: one set: full layers are rare now, strips extend the one drawn.)
const LIT_PIECE_SPARE = 1
const LIT_PIECE_REACH = [1, 1.3, 1, 1]
const LIT_PIECE_PAD = 3
// About LIT_PIECE_VISIBLE pieces in a canvas-sized view (merged while more; a frame draws one call a piece in view), pairs
// compared for at most LIT_PIECE_MERGE_LIMIT rectangles.
const LIT_PIECE_VISIBLE = 30
// TASK-1545: a piece's largest side (device pixels; Grid.litLayerPieces cuts larger ones).
const LIT_PIECE_MAX_SIDE = 1024
const LIT_PIECE_MERGE_LIMIT = 400
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
// TASK-1550: the shared canvas pool (CanvasPool) and its rest hook: spare canvases for the next lit layer's pieces.
Grid.canvasPool = new CanvasPool('grid', GRID_POOL_BYTES, 16, 4, true)
Grid.litPieceDemand = null
// TASK-1551: the lit layer strips' chunk canvases (LIT_STRIP_TILE squares) in a pool of their own (the grid pool's other takers
// took any canvas up to 4 times their size), kept ready at rest: the most a moving period took (litStripMoving, into
// litStripPeak at rest), at least LIT_STRIP_RESERVE (about a layer's chunks).
Grid.litStripPool = new CanvasPool('lit-strips', LIT_STRIP_POOL_BYTES, 16, 1)
Grid.litStripMoving = 0
Grid.litStripPeak = LIT_STRIP_RESERVE
Grid.litStripPool.wanted = () => new Map([[LIT_STRIP_TILE + 'x' + LIT_STRIP_TILE, Grid.litStripPeak]])
// A lit layer piece's canvas given back to its pool.
Grid.giveLitCanvas = canvas => {
    if (canvas?.litStrip)
        Grid.litStripLive.delete(canvas)
    ;(canvas?.litStrip ? Grid.litStripPool : Grid.canvasPool).give(canvas)
}
// The chunk canvases taken and not given back. At rest (no strip job under way) the ones nothing draws any more (not a piece of
// the lit layer, the retired one or the one drawn again, not held after a trim, not in a kept recording's or a zoom replay's
// calls) are given back: a layer let go of while a recording listed it drops its pieces (dropLitLayer, the drawn-at-once path).
Grid.litStripLive = new Set()
Grid.litStripSwept = null
Grid.sweepLitStrips = () => {
    const g = typeof grid !== 'undefined' ? grid : undefined
    if (!g || !Grid.litStripLive.size || g.litLayerJob)
        return
    const used = new Set()
    for (const layer of [g.litLayer, g.litLayerRetired, g.litLayerRedrawn])
        for (const piece of layer?.pieces || [])
            used.add(piece.canvas)
    for (const held of g.litPiecesHeld || [])
        for (const canvas of held.canvases)
            used.add(canvas)
    for (const source of [g.zoomSource, g.zoomReplayJob?.source])
        for (const entry of source?.calls || [])
            for (const arg of entry.args || [])
                if (arg?.litStrip)
                    used.add(arg)
    for (const canvas of [...Grid.litStripLive])
        if (!used.has(canvas))
            Grid.giveLitCanvas(canvas)
}
Grid.litPieceWant = () => {
    const want = new Map()
    for (const [key, n] of Grid.litPieceDemand || [])
        want.set(key, LIT_PIECE_SPARE * n)
    return want
}
Grid.reserveLitPieces = limit => {
    Grid.litStripPeak = Math.max(Grid.litStripPeak, Grid.litStripMoving)
    Grid.litStripMoving = 0
    // (Once a rest.)
    if (Grid.litStripSwept !== CanvasPool.lastMove) {
        Grid.litStripSwept = CanvasPool.lastMove
        Grid.sweepLitStrips()
    }
    // (Only with the lit layer on: atmospheric visuals.)
    let made = Grid.litLayers && typeof otherSettings !== 'undefined' && otherSettings.atmosphericVisuals ?
        Grid.litStripPool.reserve(LIT_STRIP_TILE, LIT_STRIP_TILE, Grid.litStripPeak, limit) : 0
    for (const [key, n] of Grid.litPieceWant()) {
        if (made >= limit)
            break
        const [w, h] = key.split('x').map(Number)
        made += Grid.canvasPool.reserve(w, h, n, limit - made)
    }
    return made
}
CanvasPool.restHooks.push(limit => Grid.reserveLitPieces(limit))
// TASK-1552 (Grid.litAhead): at rest, with atmospheric visuals, the board's lit tile pool (litTilePool) topped up to
// LIT_TILE_SPARE_PARTS quarter canvases, at most limit a frame, so tiles built ahead while the camera moves make none.
Grid.reserveLitTileParts = limit => {
    if (!Grid.litAhead || typeof grid === 'undefined' || !grid || !otherSettings.atmosphericVisuals || !grid.litView)
        return
    const pool = grid.litTilePool, Q = LIT_TILE_PART
    for (let k = 0; k < limit && pool.length < LIT_TILE_SPARE_PARTS; ++k) {
        const part = document.createElement('canvas')
        part.width = Q
        part.height = Q
        pool.push(part)
    }
}
CanvasPool.restHooks.push(limit => Grid.reserveLitTileParts(limit))
// TASK-1550: at rest before the board's surface cache is split, a sprite canvas for each cell of its cell layer (the cells
// of its mask, cellMaskCache, built ahead by the menu's prebuild or a split before): the first split, which runs while the
// camera moves, takes them instead of making ~one canvas per cell. Not while the cache's layer holds sprites (a split
// again gives those back, releaseCellSprites).
Grid.cellSpritePlan = null
Grid.cellMaskRestJob = null
const CELL_MASK_REST_MS = 10
// Sprite canvases made a frame at rest (a split's few thousand within a few frames: the camera may move again soon).
const CELL_SPRITE_RESERVE_PER_FRAME = 512
// Spare sprites beyond one a cell: the variants the cells take while the split runs (a cell's state changed).
const CELL_SPRITE_HEADROOM = 1.25
Grid.reserveCellSprites = limit => {
    const g = typeof grid !== 'undefined' ? grid : undefined
    if (!g?.arr?.length || typeof mapDepth === 'undefined' || !g.cellLayerOn() || g.surfaceCellLayer?.sprites?.size)
        return 0
    mapDepth.ensureGeometry(g)
    const geometry = g.getSurfaceCacheGeometry()
    if (!(geometry.cacheWidth > 0 && geometry.cacheHeight > 0))
        return 0
    const {width: W, height: H} = Grid.surfaceRasterSize(geometry)
    const {key, a, d, e, f, reach} = g.cellMaskKey(W, H, Grid.surfacePlace(geometry.scale, mapDepth.bounds.left, mapDepth.bounds.top))
    let plan = Grid.cellSpritePlan
    if (plan?.key !== key) {
        const mask = cellMaskCache.get(key)
        if (!mask) {
            // Not built yet (the cache build builds it in its steps, surfaceMaskSteps, which then finds it kept): built
            // here in steps of the rest's frames, CELL_MASK_REST_MS a frame.
            let job = Grid.cellMaskRestJob
            if (job?.key !== key || job.board !== g)
                job = Grid.cellMaskRestJob = {key, board: g, steps: g.cellMaskSteps(W, H, a, d, e, f, reach)}
            const start = performance.now()
            let step
            do
                step = job.steps.next()
            while (!step.done && performance.now() - start < CELL_MASK_REST_MS)
            if (step.done) {
                Grid.cellMaskRestJob = null
                if (!cellMaskCache.has(key))
                    rememberCellMask(key, step.value)
            }
            return 0
        }
        plan = Grid.cellSpritePlan = {key, buckets: new Map()}
        for (const {box} of mask.cells) {
            const bucket = Grid.canvasPool.size(box.w) + 'x' + Grid.canvasPool.size(box.h)
            plan.buckets.set(bucket, (plan.buckets.get(bucket) || 0) + 1)
        }
    }
    let made = 0
    for (const [bucket, n] of plan.buckets) {
        if (made >= limit)
            break
        const [w, h] = bucket.split('x').map(Number)
        made += Grid.canvasPool.reserve(w, h, Math.ceil(n * CELL_SPRITE_HEADROOM), limit - made)
    }
    return made
}
CanvasPool.restHooks.push(() => Grid.reserveCellSprites(CELL_SPRITE_RESERVE_PER_FRAME))
// What a rest's trim keeps first: the spare pieces and, until the surface cache's layer is split (its cells set), its sprites.
Grid.canvasPool.wanted = () => {
    const want = Grid.litPieceWant()
    const g = typeof grid !== 'undefined' ? grid : undefined
    if (Grid.cellSpritePlan && !g?.surfaceCellLayer?.cells)
        for (const [key, n] of Grid.cellSpritePlan.buckets)
            want.set(key, (want.get(key) || 0) + Math.ceil(n * CELL_SPRITE_HEADROOM))
    return want
}
