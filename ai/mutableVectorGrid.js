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

var defaultFastActionDispatcher = createFastActionDispatcher()

function applyFastAction(mutableGrid, command) {
    return defaultFastActionDispatcher.apply(mutableGrid, command)
}

function undoFastAction(mutableGrid, appliedAction) {
    return defaultFastActionDispatcher.undo(mutableGrid, appliedAction)
}
