function removeFromArrayIfKilled(array) {
    for (let i = 0; i < array.length; ++i) {
        if (array[i].killed) {
            console.log('removed from array if killed', array[i])
            array.splice(i--, 1)
            continue
        }
    }
}

function getGameObject() {
    let timers = Array(players.length)
    for (let i = 0; i < players.length; ++i) {
        timers[i] = JSON.parse(unpacker.getPlayerTimerByIndex(i))
    }
    removeFromArrayIfKilled(external)
    removeFromArrayIfKilled(externalProduction)
    removeFromArrayIfKilled(nature)
    for (let i = 0; i < players.length; ++i) {
        players[i].updateUnits()
        players[i].updateTowns()
    }
    return {
        'grid': grid,
        'players': players,
        'external': external,
        'externalProduction': externalProduction,
        'nature': nature,
        'goldmines': goldmines,
        'timers': timers,
        'whooseTurn': whooseTurn,
        'gameRound': gameRound,
        'isFogOfWar': isFogOfWar,
        'gameSettings': gameSettings,
        // Only partial boards carry the keys, so full boards serialize unchanged.
        ...(hiddenInfo ? {'hiddenInfo': true} : {}),
        ...(hiddenInfo && hiddenStatus ? {'status': hiddenStatus} : {})
    }
}

// The game status of a hidden-information board: the partial entity lists cannot tell game end,
// lost players or the winner, so the server sends them (board.status {ended, result, lostPlayers, winner, round}).
function hiddenGameStatus() {
    const status = hiddenStatus || {}
    return {
        ended: status.ended === true,
        result: typeof status.result === 'string' ? status.result : null,
        lostPlayers: Array.isArray(status.lostPlayers) ? status.lostPlayers.filter(Number.isInteger) : [],
        winner: Number.isInteger(status.winner) ? status.winner : null,
        round: Number.isInteger(status.round) ? status.round : gameRound,
    }
}

// The end-of-game banner text of a hidden-information board, or null while it goes on.
function hiddenGameEndText() {
    if (!hiddenInfo) return null
    const status = hiddenGameStatus()
    if (!status.ended) return null
    if (gameSettings.coop) return null // the co-op banner shows gameSettings.coop.result
    return status.winner !== null ? 'Game over — Player ' + status.winner + ' wins' : 'Game over'
}

// Contents for unknown cells of a hidden-information board (PRD 7.3-7.4), e.g. the answer to
// onLoadingCellsNeeded: [{x, y, colour, isSuburb?, building?, unit?}], building and unit packed
// as in a board (a town as in players[i].towns, a goldmine as in goldmines). A filled cell is a
// normal cell from then on (known contents, no longer loading); known cells are left alone.
// Returns the number of cells filled.
function markCellsKnown(cells) {
    let filled = 0
    for (const cell of cells) {
        const hexagon = grid.arr[cell.x][cell.y].hexagon
        if (!hexagon.unknown || !Number.isInteger(cell.colour))
            continue
        hexagon.firstpaint(cell.colour)
        hexagon.isSuburb = Boolean(cell.isSuburb)
        const building = cell.building
        if (building && building.name === 'town')
            unpacker.unpackTown(building)
        else if (building && building.name === 'goldmine')
            new Goldmine(cell.x, cell.y, building.income)
        else if (building && building.name !== 'Empty')
            unpacker.fullUnpackBuilding(building)
        if (cell.unit && cell.unit.name !== 'Empty')
            unpacker.fullUnpackUnit(cell.unit)
        ++filled
    }
    // New contents can be vision barriers or always-visible nature: recompute the fog.
    if (filled && isFogOfWar) {
        if (gameSettings.coop) refreshCoopVision()
        else players[whooseTurn].changeFogOfWarByVision()
    }
    return filled
}

// Cells revealed on an action's ack (reveal on ack, PRD 6.2, 7.1; diplomacy_server server/reveal.js): the boardDiff
// cell shape {x, y, colour, unit, building, production}, each entity tagged with owner / list / town. The cells this
// client still holds as unknown (its loading cells) become known with those contents, applied in place by
// applyCellDiff; cells it already knows keep the local state (its own optimistic actions). Public terrain the client
// already holds on an unknown cell (nature, landmarks: never in a reveal) stays. Returns the number of cells filled.
const REVEALED_CELL_LAYERS = {towns: 'town', townBuildings: 'townBuilding', external: 'external', nature: 'nature',
    goldmines: 'goldmine', townProduction: 'manufacture', externalProduction: 'externalProduction'}

function revealedCellEntity(entry) {
    if (!entry || !REVEALED_CELL_LAYERS[entry.list])
        return null
    const {list, owner, ...packed} = entry
    packed.layer = REVEALED_CELL_LAYERS[list]
    if (packed.layer !== 'townBuilding' && packed.layer !== 'manufacture')
        delete packed.town
    return packed
}

function markRevealedCellsKnown(cells) {
    if (typeof grid === 'undefined' || !grid || !Array.isArray(cells))
        return 0
    const suburbs = new Map()
    for (const cell of cells)
        if (cell && cell.building && cell.building.list === 'towns')
            for (const suburb of cell.building.suburbs || [])
                suburbs.set(cellDiffKey(suburb), !('isSuburb' in suburb) || Boolean(suburb.isSuburb))
    const records = []
    for (const cell of cells) {
        if (!cell || !Number.isInteger(cell.x) || !Number.isInteger(cell.y) || !Number.isInteger(cell.colour) ||
                isCoordNotOnMap(cell, grid.arr.length, grid.arr[0].length) || !grid.arr[cell.x][cell.y].hexagon.unknown)
            continue
        const local = packCellRecord(cell.x, cell.y)
        let unit = null
        if (cell.unit) {
            const {owner, ...packed} = cell.unit
            unit = packed
        }
        records.push({x: cell.x, y: cell.y, colour: cell.colour, isSuburb: suburbs.get(cellDiffKey(cell)) === true, unit,
            building: revealedCellEntity(cell.building) || local.building,
            production: revealedCellEntity(cell.production) || local.production})
    }
    if (records.length)
        applyCellDiff({cells: records, players: []})
    return records.length
}

function loadFromJson(game_string) {
    loadFromObject(JSON.parse(game_string))
}

// loadFromJson(JSON.stringify(game)) without the whole-board round trip: unpackAll serializes each part itself, so
// the runtime never keeps a reference into game. game is a plain (JSON-shaped) board.
function loadFromObject(game) {
    // A partial board: unknown cells (grid null) and partial entity lists.
    hiddenInfo = game.hiddenInfo === true
    hiddenStatus = hiddenInfo && game.status && typeof game.status === 'object' ? game.status : null
    // A hole in the timers array is null after a JSON round trip.
    const packedTimer = i => game.timers[i] === undefined && i < game.timers.length ? null : game.timers[i]
    unpacker.unpackAll(JSON.stringify(game.grid), JSON.stringify(game.players), JSON.stringify(game.external),
        JSON.stringify(game.externalProduction),  JSON.stringify(game.nature),  JSON.stringify(game.goldmines),
        JSON.stringify(packedTimer(game.whooseTurn)), JSON.stringify(game.whooseTurn), JSON.stringify(game.gameRound),
        JSON.stringify(game.isFogOfWar),
        'gameSettings' in game && game.gameSettings !== undefined ? JSON.stringify(game.gameSettings) : null)
    // After unpackAll, which picks the timers' storage slot (gameStorageSlot) for this board.
    for (let i = 0; i < game.players.length; ++i) {
        unpacker.setPlayerTimerByIndex(i, packedTimer(i))
    }
    // An authoritative online snapshot (co-op or competitive, incl. a reconnect/Retry reload) starts a new
    // undo scope: entries recorded on the old board would re-create units the reloaded board already has.
    // Stale/equal network deliveries are rejected before reaching this loader; a continued co-op turn
    // restores its own undo history after this call (onlineLogic receiveBoard).
    if (gameSettings.isOnline) actionManager.clear()
}

// Incremental cell diffs (PRD sec. 6.3, 8): the server sends a player only the cells that changed,
// as cell records, instead of a whole board.
// A cell record: {x, y, colour, isSuburb, unit, building, production}; unit is packed as in
// players[i].units; building is the building layer packed as in a board plus `layer` ('town',
// 'townBuilding', 'external', 'nature', 'goldmine'; a town without its nested buildings, which
// are on their own cells; a town building with `town` {x, y}); production is a building under
// construction ('manufacture' with `town` {x, y}, or 'externalProduction'). Owners are the cell
// colour, as on a loaded board. A diff: {cells: [records], players: [{index, gold}],
// meta?: {whooseTurn, gameRound}, paths?: [{from, to, path?}]} (paths: move hints, UI only).
function cellBuildingLayer(building) {
    if (!building || building.isEmpty() || building.killed)
        return null
    if (building.isBuildingProduction())
        return building.isExternalProduction() ? 'externalProduction' : 'manufacture'
    if (building.isTown())
        return 'town'
    if (building.name === 'goldmine')
        return 'goldmine'
    if (building.isNature)
        return 'nature'
    if (external.includes(building))
        return 'external'
    return 'townBuilding'
}

function cellBuildingTown(building, layer) {
    const town = layer === 'manufacture' ? building.town :
        layer === 'townBuilding' ? building.town || building.findOwningTown() : null
    return town ? {x: town.coord.x, y: town.coord.y} : null
}

function packCellRecord(x, y) {
    const cell = grid.arr[x][y]
    const record = {x, y, colour: cell.hexagon.playerColor, isSuburb: Boolean(cell.hexagon.isSuburb),
        unit: null, building: null, production: null}
    if (cell.unit.notEmpty() && !cell.unit.killed)
        record.unit = JSON.parse(JSON.stringify(cell.unit))
    const layer = cellBuildingLayer(cell.building)
    if (layer) {
        const packed = JSON.parse(JSON.stringify(cell.building))
        packed.layer = layer
        if (layer === 'town') {
            delete packed.buildings
            delete packed.buildingProduction
        }
        if (layer === 'townBuilding' || layer === 'manufacture')
            packed.town = cellBuildingTown(cell.building, layer)
        if (layer === 'manufacture' || layer === 'externalProduction')
            record.production = packed
        else
            record.building = packed
    }
    return record
}

// Every cell record, gold and turn of the current board (the input of a server-side diff).
function packBoardCells() {
    const cells = []
    for (let x = 0; x < grid.arr.length; ++x)
        for (let y = 0; y < grid.arr[x].length; ++y)
            cells.push(packCellRecord(x, y))
    return {cells, players: players.map((player, index) => ({index, gold: player.gold})),
        meta: {whooseTurn, gameRound}}
}

function cellDiffKey(coord) {
    return coord.x + ',' + coord.y
}

// Cells named by the local player's undo entries (their own pending actions). The entity list
// snapshots name every unit and are rebased instead (rebaseUndoEntityLists).
function pendingActionCells() {
    const keys = new Set()
    const walk = value => {
        if (!value || typeof value !== 'object')
            return
        if (Number.isInteger(value.x) && Number.isInteger(value.y))
            keys.add(cellDiffKey(value))
        for (const key of Object.keys(value))
            if (key !== 'playerEntityLists' && key !== 'externalOrder')
                walk(value[key])
    }
    actionManager.arr.forEach(walk)
    return keys
}

function removeFromList(list, entity) {
    const index = list ? list.indexOf(entity) : -1
    if (index !== -1)
        list.splice(index, 1)
}

// Takes the building layer object off its cell and out of its registry.
function removeCellBuilding(building, layer, changes) {
    const coord = {x: building.coord.x, y: building.coord.y}
    building.killed = true
    grid.setBuilding(new Empty(), coord)
    if (layer === 'town') {
        for (const player of players) removeFromList(player.towns, building)
        changes.townsRemoved.push(coord)
    }
    else if (layer === 'townBuilding')
        removeFromList(building.town && building.town.buildings, building)
    else if (layer === 'manufacture')
        removeFromList(building.town && building.town.buildingProduction, building)
    else if (layer === 'externalProduction')
        removeFromList(externalProduction, building)
    else if (layer === 'external') {
        removeFromList(external, building)
        changes.externalRemoved.push(coord)
    }
    else if (layer === 'nature')
        removeFromList(nature, building)
    else if (layer === 'goldmine')
        removeFromList(goldmines, building)
}

function cellDiffTownAt(coord) {
    if (!coord || isCoordNotOnMap(coord, grid.arr.length, grid.arr[0].length))
        return null
    const town = grid.getBuilding(coord)
    return town.notEmpty() && town.isTown() ? town : null
}

function unpackCellUnitProduction(packed) {
    if (!packed || packed.name === 'Empty')
        return new Empty()
    return new UnitProduction(packed.turns, production[packed.name].cost,
        unpacker.unitClass[packed.name], packed.name)
}

// Brings a kept building layer object to its record (same layer, name and town).
function updateCellBuilding(building, layer, record) {
    if (layer === 'manufacture' || layer === 'externalProduction') {
        building.turns = record.turns
        return
    }
    if ('hp' in record) {
        building.hp = record.hp
        building.wasHitted = record.wasHitted
        building.updateHPBar()
    }
    if ('unitProduction' in record &&
            JSON.stringify(building.unitProduction) !== JSON.stringify(record.unitProduction))
        building.unitProduction = unpackCellUnitProduction(record.unitProduction)
    if (layer === 'town') {
        building.isRecentlyCaptured = record.isRecentlyCaptured
        building.suburbs = []
        for (const suburb of record.suburbs) {
            const hexagon = grid.getHexagon(suburb)
            if (hexagon.unknown)
                continue
            building.suburbs.push(hexagon)
            if ('isSuburb' in suburb)
                hexagon.isSuburb = Boolean(suburb.isSuburb)
        }
    }
}

function createCellBuilding(record, changes) {
    const layer = record.layer
    if (layer === 'town') {
        unpacker.unpackTown({...record, buildings: [], buildingProduction: []})
        changes.townsAdded.push({x: record.coord.x, y: record.coord.y})
    }
    else if (layer === 'townBuilding') {
        const building = unpacker.fullUnpackBuilding(record)
        const town = cellDiffTownAt(record.town)
        if (town) {
            building.town = town
            town.buildings.push(building)
        }
    }
    else if (layer === 'manufacture') {
        const manufacture = unpacker.fullUnpackManufacture(record)
        const town = cellDiffTownAt(record.town)
        if (town) {
            manufacture.town = town
            town.buildingProduction.push(manufacture)
        }
    }
    else if (layer === 'externalProduction')
        externalProduction.push(unpacker.fullUnpackExternal(record))
    else if (layer === 'external') {
        unpacker.fullUnpackBuilding(record)
        changes.externalAdded.push({x: record.coord.x, y: record.coord.y})
    }
    else if (layer === 'nature')
        new unpacker.buildingClass[record.name](record.coord.x, record.coord.y)
    else if (layer === 'goldmine')
        new Goldmine(record.coord.x, record.coord.y, record.income)
}

function sameCellBuilding(building, layer, record) {
    if (layer !== record.layer || building.name !== record.name)
        return false
    const town = cellBuildingTown(building, layer)
    return JSON.stringify(town) === JSON.stringify(record.town || null)
}

// The undo entries' entity list snapshots (unit and town coords per player, external order) are
// in the coordinates of the time they were taken: follow the diff's moves, removals and additions
// so an undo neither drops a unit the diff moved nor revives one it removed.
function rebaseUndoEntityLists(changes) {
    const movedTo = new Map(changes.unitsMoved.map(move => [cellDiffKey(move.from), move.to]))
    const unitsRemoved = new Set(changes.unitsRemoved.map(cellDiffKey))
    const townsRemoved = new Set(changes.townsRemoved.map(cellDiffKey))
    const externalRemoved = new Set(changes.externalRemoved.map(cellDiffKey))
    for (const entry of actionManager.arr) {
        const lists = entry.playerEntityLists || []
        for (let i = 0; i < lists.length; ++i) {
            if (!lists[i])
                continue
            lists[i].units = lists[i].units.filter(coord => !unitsRemoved.has(cellDiffKey(coord)))
                .map(coord => movedTo.has(cellDiffKey(coord)) ? {...movedTo.get(cellDiffKey(coord))} : coord)
            lists[i].towns = lists[i].towns.filter(coord => !townsRemoved.has(cellDiffKey(coord)))
        }
        for (const added of changes.unitsAdded)
            if (lists[added.owner]) lists[added.owner].units.push({...added.coord})
        for (const added of changes.townsAdded) {
            const town = cellDiffTownAt(added)
            if (town && lists[town.playerColor]) lists[town.playerColor].towns.push({...added})
        }
        if (entry.externalOrder)
            entry.externalOrder = entry.externalOrder.filter(coord => !externalRemoved.has(cellDiffKey(coord)))
                .concat(changes.externalAdded.map(coord => ({...coord})))
    }
}

// Applies a cell diff to the live board in place (no loadFromJson): colours, units (moved units
// keep their object and list position; paths hints pick which one moved), buildings,
// productions, gold and turn. Unknown/loading cells in the diff become known. The selection is
// kept unless the diff touches the selected entity's cell; the undo stack is kept (and its entity
// list snapshots rebased) unless the diff touches a cell of a pending action, then it is cleared.
// Returns {cells, selectionKept, undoKept}.
function applyCellDiff(diff) {
    const records = diff && Array.isArray(diff.cells) ? diff.cells : []
    const touched = new Set(records.map(cellDiffKey))
    const selected = gameEvent.selected
    const selectionKept = !(selected && selected.notEmpty() && selected.coord &&
        touched.has(cellDiffKey(selected.coord)))
    if (!selectionKept)
        gameEvent.removeSelection()
    const undoKept = ![...pendingActionCells()].some(key => touched.has(key))
    if (!undoKept)
        actionManager.clear()
    const changes = {unitsMoved: [], unitsRemoved: [], unitsAdded: [],
        townsRemoved: [], townsAdded: [], externalRemoved: [], externalAdded: []}

    // Units leaving their cell or changing name/owner go to a pool: a unit of the same owner and
    // name appearing elsewhere is the same unit, moved.
    const pool = new Map()
    for (const record of records) {
        const unit = grid.arr[record.x][record.y].unit
        if (unit.isEmpty())
            continue
        // A new diff for a unit interrupts its running move tween.
        moveTween.cancel(unit)
        if (record.unit && record.unit.name === unit.name && record.colour === unit.playerColor)
            continue
        const key = unit.playerColor + ':' + unit.name
        if (!pool.has(key)) pool.set(key, [])
        pool.get(key).push({unit, from: {x: record.x, y: record.y}})
        grid.setUnit(new Empty(), record)
    }
    // Building layer objects that leave or change identity.
    for (const record of records) {
        const building = grid.arr[record.x][record.y].building
        const layer = cellBuildingLayer(building)
        if (!layer)
            continue
        const wanted = record.building || record.production
        if (!wanted || !sameCellBuilding(building, layer, wanted))
            removeCellBuilding(building, layer, changes)
    }
    // Colours (an unknown cell becomes known with its colour) and suburb flags.
    for (const record of records) {
        const hexagon = grid.arr[record.x][record.y].hexagon
        hexagon.firstpaint(Number.isInteger(record.colour) ? record.colour : null)
        hexagon.isSuburb = !hexagon.unknown && Boolean(record.isSuburb)
    }
    // Towns before the buildings and productions that belong to them.
    const byLayer = records.filter(record => record.building || record.production)
        .sort((a, b) => ((b.building || b.production).layer === 'town') - ((a.building || a.production).layer === 'town'))
    for (const record of byLayer) {
        const wanted = record.building || record.production
        const building = grid.arr[record.x][record.y].building
        const layer = cellBuildingLayer(building)
        if (layer) {
            updateCellBuilding(building, layer, wanted)
            // A captured town changes owner: it moves to the end of the new owner's towns.
            if (layer === 'town' && !players[building.playerColor].towns.includes(building)) {
                for (const player of players) removeFromList(player.towns, building)
                players[building.playerColor].towns.push(building)
                changes.townsRemoved.push({x: record.x, y: record.y})
                changes.townsAdded.push({x: record.x, y: record.y})
            }
            const packed = packCellRecord(record.x, record.y)
            if (JSON.stringify(packed.building || packed.production) === JSON.stringify(wanted))
                continue
            removeCellBuilding(building, layer, changes)
        }
        createCellBuilding(wanted, changes)
    }
    // Units: kept in place, moved from the pool (a paths hint names the source cell), or new.
    const hints = new Map()
    const hintPaths = new Map()
    for (const hint of diff && Array.isArray(diff.paths) ? diff.paths : []) {
        const to = hint.to || (hint.path && hint.path[hint.path.length - 1])
        const from = hint.from || (hint.path && hint.path[0])
        if (to && from) {
            hints.set(cellDiffKey(to), cellDiffKey(from))
            hintPaths.set(cellDiffKey(to), Array.isArray(hint.path) ? hint.path : [from, to])
        }
    }
    for (const record of records) {
        if (!record.unit)
            continue
        const coord = {x: record.x, y: record.y}
        let unit = grid.getUnit(coord)
        if (unit.isEmpty()) {
            const candidates = pool.get(record.colour + ':' + record.unit.name) || []
            let index = candidates.findIndex(candidate => cellDiffKey(candidate.from) === hints.get(cellDiffKey(coord)))
            if (index === -1 && record.unit.id !== undefined)
                index = candidates.findIndex(candidate => candidate.unit.id === record.unit.id)
            if (index === -1 && candidates.length)
                index = 0
            if (index !== -1) {
                const moved = candidates.splice(index, 1)[0]
                unit = moved.unit
                unit.coord = coord
                grid.setUnit(unit, coord)
                unit.pos = unit.calcPos()
                unit.trimBars()
                changes.unitsMoved.push({from: moved.from, to: coord})
                // Drawn sliding along the hinted path (UI only), when it starts where the unit was.
                const path = hintPaths.get(cellDiffKey(coord))
                if (path && cellDiffKey(path[0]) === cellDiffKey(moved.from))
                    moveTween.start(unit, path)
            }
            else {
                unit = unpacker.unpackUnit(record.unit, unpacker.unitClass[record.unit.name])
                changes.unitsAdded.push({owner: record.colour, coord})
                continue
            }
        }
        if (Object.prototype.hasOwnProperty.call(record.unit, 'id')) unit.id = record.unit.id
        unit.hp = record.unit.hp
        unit.wasHitted = record.unit.wasHitted
        unit.moves = record.unit.moves
        unit.updateHPBar()
    }
    // Pool units that did not reappear are gone.
    for (const candidates of pool.values()) {
        for (const {unit, from} of candidates) {
            unit.killed = true
            for (const player of players) removeFromList(player.units, unit)
            changes.unitsRemoved.push(from)
        }
    }
    for (const entry of diff && Array.isArray(diff.players) ? diff.players : [])
        if (players[entry.index] && Number.isFinite(entry.gold)) players[entry.index].gold = entry.gold
    if (diff && diff.meta) {
        if (Number.isInteger(diff.meta.whooseTurn)) whooseTurn = diff.meta.whooseTurn
        if (Number.isInteger(diff.meta.gameRound)) gameRound = diff.meta.gameRound
    }
    if (undoKept)
        rebaseUndoEntityLists(changes)
    if (records.length && isFogOfWar) {
        if (gameSettings.coop) refreshCoopVision()
        else players[whooseTurn].changeFogOfWarByVision()
    }
    return {cells: records.length, selectionKept, undoKept}
}
