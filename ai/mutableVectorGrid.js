function cloneVectorGridCells(cells) {
    let result = new Array(cells.length)
    for (let x = 0; x < cells.length; ++x) {
        result[x] = new Array(cells[x].length)
        for (let y = 0; y < cells[x].length; ++y) {
            result[x][y] = cells[x][y].slice()
        }
    }
    return result
}

function normalizeVectorGridResult(vectorGrid) {
    if (vectorGrid && vectorGrid.cells) {
        return [vectorGrid.cells, vectorGrid.suddenDeathMetric]
    }
    return vectorGrid
}

function createMutableVectorGrid(vectorizedGrid) {
    let source = vectorizedGrid || vectoriseGrid()
    if (!source || !source[0]) {
        throw new Error('mutable vector grid requires a vectoriseGrid() result')
    }
    return {
        cells: cloneVectorGridCells(source[0]),
        suddenDeathMetric: source[1],
        appliedFastActions: []
    }
}

function mutableVectorGridToVectoriseGridResult(mutableGrid) {
    return [mutableGrid.cells, mutableGrid.suddenDeathMetric]
}

function compareVectorGridResults(expectedGrid, actualGrid, options) {
    options = options || {}
    let expected = normalizeVectorGridResult(expectedGrid)
    let actual = normalizeVectorGridResult(actualGrid)
    let mismatches = []
    let limit = options.limit || 10

    if (!expected || !actual || !expected[0] || !actual[0]) {
        return {
            equal: false,
            mismatches: [{
                location: 'root',
                expected: expected,
                actual: actual,
                message: 'both grids must be vectoriseGrid() results or mutable vector grids'
            }]
        }
    }

    if (expected[1] !== actual[1]) {
        mismatches.push({
            location: 'suddenDeathMetric',
            expected: expected[1],
            actual: actual[1]
        })
    }

    if (expected[0].length !== actual[0].length) {
        mismatches.push({
            location: 'cells.length',
            expected: expected[0].length,
            actual: actual[0].length
        })
    }

    let width = Math.min(expected[0].length, actual[0].length)
    for (let x = 0; x < width && mismatches.length < limit; ++x) {
        let expectedColumn = expected[0][x] || []
        let actualColumn = actual[0][x] || []
        if (expectedColumn.length !== actualColumn.length) {
            mismatches.push({
                location: 'cells[' + x + '].length',
                expected: expectedColumn.length,
                actual: actualColumn.length
            })
        }
        let height = Math.min(expectedColumn.length, actualColumn.length)
        for (let y = 0; y < height && mismatches.length < limit; ++y) {
            let expectedCell = expectedColumn[y] || []
            let actualCell = actualColumn[y] || []
            if (expectedCell.length !== actualCell.length) {
                mismatches.push({
                    location: 'cells[' + x + '][' + y + '].length',
                    expected: expectedCell.length,
                    actual: actualCell.length
                })
            }
            let channels = Math.min(expectedCell.length, actualCell.length)
            for (let channel = 0; channel < channels &&
                    mismatches.length < limit; ++channel) {
                if (expectedCell[channel] !== actualCell[channel]) {
                    mismatches.push({
                        location: {
                            x: x,
                            y: y,
                            channel: channel
                        },
                        expected: expectedCell[channel],
                        actual: actualCell[channel]
                    })
                }
            }
        }
    }

    return {
        equal: mismatches.length == 0,
        mismatches: mismatches
    }
}

function assertMutableVectorGridMatchesFresh(mutableGrid, options) {
    let comparison = compareVectorGridResults(vectoriseGrid(), mutableGrid, options)
    if (!comparison.equal) {
        throw new Error('mutable vector grid mismatch: ' +
            JSON.stringify(comparison.mismatches))
    }
    return comparison
}

function fastActionCommandCategory(command) {
    if (!command) {
        return 'unknown'
    }
    if (command.category) {
        return command.category
    }
    if (command.type) {
        return command.type
    }
    return 'unknown'
}

function summarizeFastActionCommand(command) {
    if (!command) {
        return 'null command'
    }
    let summary = {
        type: command.type,
        category: command.category,
        product: command.product,
        producerCoord: command.producerCoord,
        whoDoCommandCoord: command.whoDoCommandCoord,
        destinationCoord: command.destinationCoord
    }
    return JSON.stringify(summary)
}

function missingFastActionHandlerError(phase, command) {
    let category = fastActionCommandCategory(command)
    return new Error('Missing fast-action ' + phase + ' handler for category "' +
        category + '": ' + summarizeFastActionCommand(command))
}

function fastActionCoordKey(coord) {
    return coord.x + ':' + coord.y
}

function isFastActionCoordOnMutableGrid(mutableGrid, coord) {
    return coord && Number.isFinite(coord.x) && Number.isFinite(coord.y) &&
        mutableGrid.cells[coord.x] && mutableGrid.cells[coord.x][coord.y]
}

function addFastActionCoord(coords, seen, coord) {
    if (!coord) {
        return
    }
    let key = fastActionCoordKey(coord)
    if (seen[key]) {
        return
    }
    seen[key] = true
    coords.push({x: coord.x, y: coord.y})
}

function addFastActionCoordIfOnGrid(mutableGrid, coords, seen, coord) {
    if (isFastActionCoordOnMutableGrid(mutableGrid, coord)) {
        addFastActionCoord(coords, seen, coord)
    }
}

function addFastActionNeighbourCoords(mutableGrid, coords, seen, coord) {
    if (!isFastActionCoordOnMutableGrid(mutableGrid, coord)) {
        return
    }
    let cell = grid.getCell(coord)
    let neighbours = cell && cell.hexagon && cell.hexagon.neighbours
    for (let i = 0; neighbours && i < neighbours.length; ++i) {
        addFastActionCoordIfOnGrid(mutableGrid, coords, seen, neighbours[i])
    }
}

function addFastActionCoordAndNeighbours(mutableGrid, coords, seen, coord) {
    addFastActionCoordIfOnGrid(mutableGrid, coords, seen, coord)
    addFastActionNeighbourCoords(mutableGrid, coords, seen, coord)
}

function addTownSuburbFastActionCoords(mutableGrid, coords, seen, town) {
    if (!town || !town.suburbs) {
        return
    }
    addFastActionCoordAndNeighbours(mutableGrid, coords, seen, town.coord)
    for (let i = 0; i < town.suburbs.length; ++i) {
        addFastActionCoordAndNeighbours(mutableGrid, coords, seen, town.suburbs[i])
    }
}

function addBuildingFastActionCoords(mutableGrid, coords, seen, building) {
    if (!building) {
        return
    }
    addFastActionCoordAndNeighbours(mutableGrid, coords, seen, building.coord)
    if (building.town) {
        addFastActionCoordAndNeighbours(mutableGrid, coords, seen, building.town.coord)
    }
}

function addAllTownSummaryFastActionCoords(mutableGrid, coords, seen) {
    if (typeof players == 'undefined') {
        return
    }
    for (let i = 1; i < players.length; ++i) {
        let player = players[i]
        for (let j = 0; player && player.towns && j < player.towns.length; ++j) {
            addTownSuburbFastActionCoords(mutableGrid, coords, seen, player.towns[j])
        }
    }
}

function collectFastActionChangedCoords(mutableGrid, command) {
    let coords = []
    let seen = {}
    addFastActionCoordAndNeighbours(mutableGrid, coords, seen,
        command && command.whoDoCommandCoord)
    addFastActionCoordAndNeighbours(mutableGrid, coords, seen,
        command && command.producerCoord)
    addFastActionCoordAndNeighbours(mutableGrid, coords, seen,
        command && command.destinationCoord)
    if (typeof actionManager == 'undefined' || !actionManager.lastAction) {
        return coords
    }
    let undo = actionManager.lastAction
    for (let i = 0; undo.hexagons && i < undo.hexagons.length; ++i) {
        addFastActionCoordAndNeighbours(mutableGrid, coords, seen,
            undo.hexagons[i].coord)
    }
    for (let i = 0; undo.units && i < undo.units.length; ++i) {
        addFastActionCoordAndNeighbours(mutableGrid, coords, seen,
            undo.units[i].coord)
    }
    for (let i = 0; undo.killUnit && i < undo.killUnit.length; ++i) {
        addFastActionCoordAndNeighbours(mutableGrid, coords, seen,
            undo.killUnit[i].coord)
    }
    addBuildingFastActionCoords(mutableGrid, coords, seen, undo.killBuilding)
    addBuildingFastActionCoords(mutableGrid, coords, seen, undo.building)
    addBuildingFastActionCoords(mutableGrid, coords, seen, undo.buildingProduction)
    addBuildingFastActionCoords(mutableGrid, coords, seen, undo.externalProduction)
    addTownSuburbFastActionCoords(mutableGrid, coords, seen, undo.town)
    for (let i = 0; undo.townExternal && i < undo.townExternal.length; ++i) {
        addBuildingFastActionCoords(mutableGrid, coords, seen, undo.townExternal[i])
    }
    for (let i = 0; undo.townExternalProduction &&
            i < undo.townExternalProduction.length; ++i) {
        addBuildingFastActionCoords(
            mutableGrid,
            coords,
            seen,
            undo.townExternalProduction[i])
    }
    // Every live unit's nearest enemy can change after movement, a kill,
    // production, or capture, even when that unit is far from the action.
    for (let playerIndex = 1; playerIndex < players.length; ++playerIndex) {
        for (let unit of players[playerIndex].units) {
            if (!unit.killed) {
                addFastActionCoordIfOnGrid(mutableGrid, coords, seen, unit.coord)
            }
        }
    }
    addAllTownSummaryFastActionCoords(mutableGrid, coords, seen)
    return coords
}

function collectUnitFastActionCoords(command) {
    let coords = []
    let seen = {}
    addFastActionCoord(coords, seen, command.whoDoCommandCoord)
    addFastActionCoord(coords, seen, command.destinationCoord)
    if (typeof actionManager == 'undefined' || !actionManager.lastAction) {
        return coords
    }
    let undo = actionManager.lastAction
    for (let i = 0; undo.hexagons && i < undo.hexagons.length; ++i) {
        addFastActionCoord(coords, seen, undo.hexagons[i].coord)
    }
    for (let i = 0; undo.units && i < undo.units.length; ++i) {
        addFastActionCoord(coords, seen, undo.units[i].coord)
    }
    for (let i = 0; undo.killUnit && i < undo.killUnit.length; ++i) {
        addFastActionCoord(coords, seen, undo.killUnit[i].coord)
    }
    if (undo.killBuilding) {
        addFastActionCoord(coords, seen, undo.killBuilding.coord)
    }
    for (let i = 0; undo.townExternal && i < undo.townExternal.length; ++i) {
        addFastActionCoord(coords, seen, undo.townExternal[i].coord)
    }
    for (let i = 0; undo.townExternalProduction &&
            i < undo.townExternalProduction.length; ++i) {
        addFastActionCoord(coords, seen, undo.townExternalProduction[i].coord)
    }
    if (undo.building) {
        addFastActionCoord(coords, seen, undo.building.coord)
    }
    if (undo.buildingProduction) {
        addFastActionCoord(coords, seen, undo.buildingProduction.coord)
    }
    if (undo.externalProduction) {
        addFastActionCoord(coords, seen, undo.externalProduction.coord)
    }
    return coords
}

function collectAllMutableVectorGridCoords(mutableGrid) {
    let coords = []
    for (let x = 0; x < mutableGrid.cells.length; ++x) {
        for (let y = 0; y < mutableGrid.cells[x].length; ++y) {
            coords.push({x: x, y: y})
        }
    }
    return coords
}

function replaceMutableCellVectorFromGrid(mutableGrid, coord, globalChannels, expansionLookup) {
    if (!mutableGrid.cells[coord.x] || !mutableGrid.cells[coord.x][coord.y]) {
        throw new Error('fast unit action coord is outside mutable vector grid: ' +
            JSON.stringify(coord))
    }
    if (typeof vectorizeCellLocal == 'undefined') {
        mutableGrid.cells[coord.x][coord.y] = vectorizeCell(grid.getCell(coord))
        return
    }
    if (!globalChannels && typeof computeGlobalVectorChannels != 'undefined') {
        globalChannels = computeGlobalVectorChannels()
    }
    mutableGrid.cells[coord.x][coord.y] = vectorizeCellLocal(
        grid.getCell(coord),
        globalChannels, expansionLookup)
}

function mutableVectorGridGlobalChannelList() {
    if (typeof CELL_VECTOR_GLOBAL_CHANNELS == 'undefined') {
        return []
    }
    return CELL_VECTOR_GLOBAL_CHANNELS
}

function captureMutableVectorGridGlobalChannels(mutableGrid) {
    let firstCell = mutableGrid.cells.length && mutableGrid.cells[0].length ?
        mutableGrid.cells[0][0] : []
    let size = typeof CELL_VECTOR_SIZE == 'undefined' ?
        firstCell.length : CELL_VECTOR_SIZE
    let result = new Array(size)
    result = result.fill(0)
    if (!mutableGrid.cells.length || !mutableGrid.cells[0].length) {
        return result
    }
    let channels = mutableVectorGridGlobalChannelList()
    for (let i = 0; i < channels.length; ++i) {
        let channel = channels[i]
        result[channel] = firstCell[channel]
    }
    return result
}

function refreshMutableVectorGridGlobalChannels(mutableGrid, globalChannels) {
    if (typeof applyGlobalVectorChannels == 'undefined') {
        return
    }
    for (let x = 0; x < mutableGrid.cells.length; ++x) {
        for (let y = 0; y < mutableGrid.cells[x].length; ++y) {
            applyGlobalVectorChannels(mutableGrid.cells[x][y], globalChannels)
        }
    }
}

function applyChangedCellFastAction(mutableGrid, command) {
    let coords = collectFastActionChangedCoords(mutableGrid, command)
    let previous = []
    // The standalone dispatcher also supports the legacy vectorizeCell API.
    let expansionLookup = typeof createSuburbExpansionLookup == 'undefined' ?
        undefined : createSuburbExpansionLookup()
    let previousGlobalChannels = captureMutableVectorGridGlobalChannels(mutableGrid)
    let currentGlobalChannels = typeof computeGlobalVectorChannels == 'undefined' ?
        previousGlobalChannels : computeGlobalVectorChannels()
    for (let i = 0; i < coords.length; ++i) {
        let coord = coords[i]
        previous.push({
            coord: {x: coord.x, y: coord.y},
            vector: mutableGrid.cells[coord.x][coord.y].slice()
        })
        replaceMutableCellVectorFromGrid(mutableGrid, coord, currentGlobalChannels, expansionLookup)
    }
    refreshMutableVectorGridGlobalChannels(
        mutableGrid,
        currentGlobalChannels)
    return {
        previous: previous,
        previousGlobalChannels: previousGlobalChannels,
        currentGlobalChannels: currentGlobalChannels,
        changedCellCount: coords.length
    }
}

function undoChangedCellFastAction(mutableGrid, token) {
    for (let i = 0; token && token.previous &&
            i < token.previous.length; ++i) {
        let entry = token.previous[i]
        mutableGrid.cells[entry.coord.x][entry.coord.y] =
            entry.vector.slice()
    }
    if (token && token.previousGlobalChannels) {
        refreshMutableVectorGridGlobalChannels(
            mutableGrid,
            token.previousGlobalChannels)
    }
}

var unitFastActionHandler = {
    apply: function(mutableGrid, command) {
        if (!command || !command.whoDoCommandCoord ||
                !command.destinationCoord) {
            throw new Error('fast unit action requires source and destination coords')
        }
        return applyChangedCellFastAction(mutableGrid, command)
    },
    undo: function(mutableGrid, command, token) {
        undoChangedCellFastAction(mutableGrid, token)
    }
}

var unitProductionFastActionHandler = {
    apply: function(mutableGrid, command) {
        if (!command || !command.producerCoord || !command.product) {
            throw new Error('fast unit production requires producer coord and product')
        }
        return applyChangedCellFastAction(mutableGrid, command)
    },
    undo: function(mutableGrid, command, token) {
        undoChangedCellFastAction(mutableGrid, token)
    }
}

var suburbExpansionFastActionHandler = {
    apply: function(mutableGrid, command) {
        if (!command || !command.producerCoord || !command.destinationCoord ||
                command.product != 'suburb') {
            throw new Error('fast suburb expansion requires producer coord, ' +
                'destination coord, and suburb product')
        }
        return applyChangedCellFastAction(mutableGrid, command)
    },
    undo: function(mutableGrid, command, token) {
        undoChangedCellFastAction(mutableGrid, token)
    }
}

var buildingPlacementFastActionHandler = {
    apply: function(mutableGrid, command) {
        if (!command || !command.producerCoord || !command.destinationCoord ||
                !production[command.product] ||
                production[command.product].production.isUnitProduction() ||
                command.product == 'suburb') {
            throw new Error('fast building placement requires producer coord, ' +
                'destination coord, and non-unit building product')
        }
        return applyChangedCellFastAction(mutableGrid, command)
    },
    undo: function(mutableGrid, command, token) {
        undoChangedCellFastAction(mutableGrid, token)
    }
}

function createFastActionDispatcher(handlers) {
    handlers = handlers || {}
    return {
        apply: function(mutableGrid, command) {
            let category = fastActionCommandCategory(command)
            let handler = handlers[category]
            if (!handler || !handler.apply) {
                throw missingFastActionHandlerError('apply', command)
            }
            let token = handler.apply(mutableGrid, command)
            let applied = {
                category: category,
                command: command,
                token: token
            }
            mutableGrid.appliedFastActions.push(applied)
            return applied
        },
        undo: function(mutableGrid, appliedAction) {
            if (!appliedAction) {
                throw missingFastActionHandlerError('undo', null)
            }
            let handler = handlers[appliedAction.category]
            if (!handler || !handler.undo) {
                throw missingFastActionHandlerError('undo', appliedAction.command)
            }
            handler.undo(mutableGrid, appliedAction.command, appliedAction.token)
            let last = mutableGrid.appliedFastActions[
                mutableGrid.appliedFastActions.length - 1]
            if (last === appliedAction) {
                mutableGrid.appliedFastActions.pop()
            }
        }
    }
}

var defaultFastActionDispatcher = createFastActionDispatcher({
    unit: unitFastActionHandler,
    'unit-training': unitProductionFastActionHandler,
    'suburb-expansion': suburbExpansionFastActionHandler,
    'building-placement': buildingPlacementFastActionHandler
})

function applyFastAction(mutableGrid, command) {
    return defaultFastActionDispatcher.apply(mutableGrid, command)
}

function undoFastAction(mutableGrid, appliedAction) {
    return defaultFastActionDispatcher.undo(mutableGrid, appliedAction)
}
