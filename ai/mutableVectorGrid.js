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

function replaceMutableCellVectorFromGrid(mutableGrid, coord) {
    if (!mutableGrid.cells[coord.x] || !mutableGrid.cells[coord.x][coord.y]) {
        throw new Error('fast unit action coord is outside mutable vector grid: ' +
            JSON.stringify(coord))
    }
    mutableGrid.cells[coord.x][coord.y] = vectorizeCell(grid.getCell(coord))
}

var unitFastActionHandler = {
    apply: function(mutableGrid, command) {
        if (!command || !command.whoDoCommandCoord ||
                !command.destinationCoord) {
            throw new Error('fast unit action requires source and destination coords')
        }
        let coords = collectAllMutableVectorGridCoords(mutableGrid)
        let previous = []
        for (let i = 0; i < coords.length; ++i) {
            let coord = coords[i]
            previous.push({
                coord: {x: coord.x, y: coord.y},
                vector: mutableGrid.cells[coord.x][coord.y].slice()
            })
            replaceMutableCellVectorFromGrid(mutableGrid, coord)
        }
        return {previous: previous}
    },
    undo: function(mutableGrid, command, token) {
        for (let i = 0; token && token.previous &&
                i < token.previous.length; ++i) {
            let entry = token.previous[i]
            mutableGrid.cells[entry.coord.x][entry.coord.y] =
                entry.vector.slice()
        }
    }
}

var unitProductionFastActionHandler = {
    apply: function(mutableGrid, command) {
        if (!command || !command.producerCoord || !command.product) {
            throw new Error('fast unit production requires producer coord and product')
        }
        let coords = collectAllMutableVectorGridCoords(mutableGrid)
        let previous = []
        for (let i = 0; i < coords.length; ++i) {
            let coord = coords[i]
            previous.push({
                coord: {x: coord.x, y: coord.y},
                vector: mutableGrid.cells[coord.x][coord.y].slice()
            })
            replaceMutableCellVectorFromGrid(mutableGrid, coord)
        }
        return {previous: previous}
    },
    undo: function(mutableGrid, command, token) {
        for (let i = 0; token && token.previous &&
                i < token.previous.length; ++i) {
            let entry = token.previous[i]
            mutableGrid.cells[entry.coord.x][entry.coord.y] =
                entry.vector.slice()
        }
    }
}

var suburbExpansionFastActionHandler = {
    apply: function(mutableGrid, command) {
        if (!command || !command.producerCoord || !command.destinationCoord ||
                command.product != 'suburb') {
            throw new Error('fast suburb expansion requires producer coord, ' +
                'destination coord, and suburb product')
        }
        let coords = collectAllMutableVectorGridCoords(mutableGrid)
        let previous = []
        for (let i = 0; i < coords.length; ++i) {
            let coord = coords[i]
            previous.push({
                coord: {x: coord.x, y: coord.y},
                vector: mutableGrid.cells[coord.x][coord.y].slice()
            })
            replaceMutableCellVectorFromGrid(mutableGrid, coord)
        }
        return {previous: previous}
    },
    undo: function(mutableGrid, command, token) {
        for (let i = 0; token && token.previous &&
                i < token.previous.length; ++i) {
            let entry = token.previous[i]
            mutableGrid.cells[entry.coord.x][entry.coord.y] =
                entry.vector.slice()
        }
    }
}

var buildingPlacementFastActionHandler = {
    apply: function(mutableGrid, command) {
        if (!command || !command.producerCoord || !command.destinationCoord ||
                (command.product != 'farm' && command.product != 'barrack')) {
            throw new Error('fast building placement requires producer coord, ' +
                'destination coord, and farm or barrack product')
        }
        let coords = collectAllMutableVectorGridCoords(mutableGrid)
        let previous = []
        for (let i = 0; i < coords.length; ++i) {
            let coord = coords[i]
            previous.push({
                coord: {x: coord.x, y: coord.y},
                vector: mutableGrid.cells[coord.x][coord.y].slice()
            })
            replaceMutableCellVectorFromGrid(mutableGrid, coord)
        }
        return {previous: previous}
    },
    undo: function(mutableGrid, command, token) {
        for (let i = 0; token && token.previous &&
                i < token.previous.length; ++i) {
            let entry = token.previous[i]
            mutableGrid.cells[entry.coord.x][entry.coord.y] =
                entry.vector.slice()
        }
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
