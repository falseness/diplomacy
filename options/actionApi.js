// Headless rules API for action-based play (artifacts/actions_feature_prd.txt sec. 3 and 4.1).
//
// One rules engine: an action is applied through the very code path a click runs
// (select + sendInstructions, prepare/choose + sendInstructions, the destroy body,
// actionManager.undo), so the client and the server replaying the same actions reach
// the same state. Success is detected as "an undo entry was pushed" (actionManager.lastAction
// changed), exactly as the AI does in ai/players.js; a rejected action leaves
// JSON.stringify(getGameObject()) unchanged.
//
//   applyAction(action, actor = whooseTurn) -> {ok: true, changedCells: [{x, y}, ...]}
//                                           | {ok: false, reason: ACTION_REASON.*}
//
// Action schema (every coord is {x, y}):
//   {t: 'unit',    from, to, expect: {name, id?}}  move / melee attack / capture / ranged or siege shot
//   {t: 'skip',    at}                              skip the unit's remaining moves
//   {t: 'train',   producer, product}               order a unit in a town or barrack
//   {t: 'build',   producer, product, at}           suburb / farm / barrack / wall / tower / bastion
//   {t: 'destroy', at, layer: 'building'}           destroy an own entity (units cannot be destroyed)
//   {t: 'undo'}                                     undo the last action of this turn
//   {t: 'end',     hash?}                           accepted without ending the turn (turn flow stays in nextTurn.js)
//
// Loaded before ai/players.js (index.html, server/loadGameCode.js). Depends only on scripts
// loaded earlier (coordsEqually) and on game globals resolved at call time.

const ACTION_REASON = Object.freeze({
    NOT_YOUR_TURN: 'NOT_YOUR_TURN',     // the actor is not players[whooseTurn]
    NOT_OWNER: 'NOT_OWNER',             // the acting unit / producer / destroy target belongs to another player
    EXPECT_MISMATCH: 'EXPECT_MISMATCH', // no unit at `from`, or its name/id differs from `expect`
    ILLEGAL_TARGET: 'ILLEGAL_TARGET',   // the rules refused: no undo entry was pushed (or a precondition the UI enforces)
    CANNOT_AFFORD: 'CANNOT_AFFORD',     // not enough gold for the product (suburbs: for that cell's distance cost)
    NOTHING_TO_UNDO: 'NOTHING_TO_UNDO', // the undo stack of this turn is empty
    BAD_ACTION: 'BAD_ACTION',           // malformed action: unknown type, missing/off-map coords, bad product or layer
    WAITING: 'WAITING'                  // gameEvent.waitingMode: the client waits for the server
})

const ACTION_TYPES = Object.freeze(['unit', 'skip', 'train', 'build', 'destroy', 'undo', 'end'])

// Border stand-in for runtimes without a canvas UI: path-finding (Way.create) and
// production choose() report their border lines to it and nothing is drawn. Same shape
// as HeadlessBorder in ai/gamestart-simple-economy-completion.js.
class HeadlessActionBorder {
    constructor() {
        this.lines = []
        this.visible = false
    }
    clean() {
        this.lines = []
    }
    isCleaned() {
        return true
    }
    createLine() {}
    newBrokenLine() {
        this.clean()
        this.visible = false
    }
    draw() {}
}

// The canvas UI is active when gameEvent is the real Events instance (managers.js);
// test vms and the server use plain-object stubs.
function isActionUiActive() {
    return typeof Events === 'function' && typeof gameEvent !== 'undefined' &&
        gameEvent !== null && gameEvent instanceof Events
}

// Replaces the drawing borders with headless ones (idempotent).
function installHeadlessActionBorders() {
    if (typeof border === 'undefined' || !(border instanceof HeadlessActionBorder))
        border = new HeadlessActionBorder()
    if (typeof attackBorder === 'undefined' || !(attackBorder instanceof HeadlessActionBorder))
        attackBorder = new HeadlessActionBorder()
}

// The body of the entity panel's destroy button (interface/entityinterface.js destroySelected)
// without the UI selection: one undo entry of the matching type, then destroy().
function destroyEntityWithUndo(entity) {
    let type = 'destroyBuilding'
    if (entity.isTown())
        type = 'destroyTown'
    if (entity.isExternalProduction())
        type = 'destroyExternalProduction'
    else if (entity.isBuildingProduction())
        type = 'destroyBuildingProduction'

    actionManager.startAction(type)
    actionManager.lastAction.building = entity.toUndoJSON()

    entity.destroy()
}

const ActionApi = {
    reject(reason) {
        return {ok: false, reason: reason}
    },
    accept(entry, extraCells) {
        return {ok: true, changedCells: ActionApi.cellsOfUndoEntry(entry, extraCells)}
    },
    // The grid cell for a coord, or null when the coord is malformed or off the map.
    cell(coord) {
        if (!coord || typeof coord !== 'object' ||
                !Number.isInteger(coord.x) || !Number.isInteger(coord.y)) {
            return null
        }
        if (typeof grid === 'undefined' || !grid || !grid.arr || !grid.arr[coord.x] ||
                coord.y < 0 || coord.y >= grid.arr[coord.x].length) {
            return null
        }
        return grid.arr[coord.x][coord.y]
    },
    copyCoord(coord) {
        return {x: coord.x, y: coord.y}
    },
    isLiveEntity(entity) {
        return Boolean(entity) && typeof entity.notEmpty === 'function' && entity.notEmpty() &&
            !entity.killed
    },
    configuredProduction(product) {
        if (typeof product !== 'string' || typeof production === 'undefined' ||
                !Object.prototype.hasOwnProperty.call(production, product)) {
            return null
        }
        return production[product]
    },
    // Runs `execute` and returns the undo entry it pushed, or null when the rules refused.
    runTracked(execute) {
        let previous = actionManager.lastAction
        execute()
        let entry = actionManager.lastAction
        return entry !== previous ? entry : null
    },
    // Cells an undo entry touched (pre-action copies it holds) plus the action's own cells.
    cellsOfUndoEntry(entry, extraCells) {
        let cells = []
        let seen = new Set()
        const add = coord => {
            if (!coord || !Number.isInteger(coord.x) || !Number.isInteger(coord.y))
                return
            let key = coord.x + ',' + coord.y
            if (seen.has(key))
                return
            seen.add(key)
            cells.push({x: coord.x, y: coord.y})
        }
        for (let i = 0; extraCells && i < extraCells.length; ++i)
            add(extraCells[i])
        if (!entry)
            return cells
        for (let list of ['units', 'hexagons', 'killUnit', 'townExternal', 'townExternalProduction',
                'buildingProductions']) {
            for (let i = 0; entry[list] && i < entry[list].length; ++i)
                add(entry[list][i] && entry[list][i].coord)
        }
        for (let key of ['killBuilding', 'building', 'town', 'production', 'buildingProduction',
                'externalProduction']) {
            if (entry[key])
                add(entry[key].coord)
        }
        return cells
    },

    unit(action, actor) {
        let fromCell = ActionApi.cell(action.from)
        let toCell = ActionApi.cell(action.to)
        let expect = action.expect
        if (!fromCell || !toCell || !expect || typeof expect !== 'object' ||
                typeof expect.name !== 'string') {
            return ActionApi.reject(ACTION_REASON.BAD_ACTION)
        }
        let unit = fromCell.unit
        if (!ActionApi.isLiveEntity(unit) || !unit.isUnit || unit.name !== expect.name ||
                (expect.id !== undefined && unit.id !== expect.id)) {
            return ActionApi.reject(ACTION_REASON.EXPECT_MISMATCH)
        }
        if (unit.playerColor !== actor)
            return ActionApi.reject(ACTION_REASON.NOT_OWNER)
        // Standing still is 'skip'; a unit without moves can do nothing (the UI never offers it).
        if (coordsEqually(action.from, action.to) || unit.moves == 0)
            return ActionApi.reject(ACTION_REASON.ILLEGAL_TARGET)
        let entry = ActionApi.runTracked(() => {
            unit.select()
            unit.sendInstructions(toCell)
        })
        unit.removeSelect()
        if (!entry)
            return ActionApi.reject(ACTION_REASON.ILLEGAL_TARGET)
        return ActionApi.accept(entry, [action.from, action.to])
    },

    skip(action, actor) {
        let cell = ActionApi.cell(action.at)
        if (!cell)
            return ActionApi.reject(ACTION_REASON.BAD_ACTION)
        let unit = cell.unit
        if (!ActionApi.isLiveEntity(unit) || !unit.isUnit)
            return ActionApi.reject(ACTION_REASON.ILLEGAL_TARGET)
        if (unit.playerColor !== actor)
            return ActionApi.reject(ACTION_REASON.NOT_OWNER)
        // The panel offers 'skip moves' only while moves remain (Unit.info canSkipMoves).
        if (unit.moves == 0)
            return ActionApi.reject(ACTION_REASON.ILLEGAL_TARGET)
        let entry = ActionApi.runTracked(() => {
            unit.select()
            unit.skipMoves()
        })
        unit.removeSelect()
        if (!entry)
            return ActionApi.reject(ACTION_REASON.ILLEGAL_TARGET)
        return ActionApi.accept(entry, [action.at])
    },

    train(action, actor) {
        let cell = ActionApi.cell(action.producer)
        if (!cell || typeof action.product !== 'string')
            return ActionApi.reject(ACTION_REASON.BAD_ACTION)
        let producer = cell.building
        if (!ActionApi.isLiveEntity(producer) || !producer.isPreparingManufacture)
            return ActionApi.reject(ACTION_REASON.ILLEGAL_TARGET)
        if (producer.playerColor !== actor)
            return ActionApi.reject(ACTION_REASON.NOT_OWNER)
        let configured = ActionApi.configuredProduction(action.product)
        if (!configured || !configured.production.isUnitProduction())
            return ActionApi.reject(ACTION_REASON.BAD_ACTION)
        if (producer.player.economyEnabled === false || producer.isPreparingUnit ||
                (producer.isTown() && producer.isBadlyDamaged)) {
            return ActionApi.reject(ACTION_REASON.ILLEGAL_TARGET)
        }
        if (producer.gold < configured.cost)
            return ActionApi.reject(ACTION_REASON.CANNOT_AFFORD)
        let entry = ActionApi.runTracked(() => {
            producer.prepare(action.product)
        })
        if (!entry)
            return ActionApi.reject(ACTION_REASON.ILLEGAL_TARGET)
        return ActionApi.accept(entry, [action.producer])
    },

    build(action, actor) {
        let cell = ActionApi.cell(action.producer)
        let target = ActionApi.cell(action.at)
        if (!cell || !target || typeof action.product !== 'string')
            return ActionApi.reject(ACTION_REASON.BAD_ACTION)
        let town = cell.building
        if (!ActionApi.isLiveEntity(town) || typeof town.isTown !== 'function' || !town.isTown())
            return ActionApi.reject(ACTION_REASON.ILLEGAL_TARGET)
        if (town.playerColor !== actor)
            return ActionApi.reject(ACTION_REASON.NOT_OWNER)
        let configured = ActionApi.configuredProduction(action.product)
        if (!configured || configured.production.isUnitProduction())
            return ActionApi.reject(ACTION_REASON.BAD_ACTION)
        if (town.player.economyEnabled === false || town.isBadlyDamaged)
            return ActionApi.reject(ACTION_REASON.ILLEGAL_TARGET)
        if (town.gold < configured.cost)
            return ActionApi.reject(ACTION_REASON.CANNOT_AFFORD)
        // As the town panel does: prepare -> startBuildingPreparing -> choose() fills the
        // candidate cells (and the suburb distance costs) the placement is checked against.
        if (!town.prepare(action.product) || !ActionApi.isLiveEntity(town.activeProduction)) {
            town.removeSelect()
            return ActionApi.reject(ACTION_REASON.ILLEGAL_TARGET)
        }
        let candidate = town.activeProduction
        let reason = null
        if (candidate.isSuburbProduction()) {
            let available = candidate.availableHexagons || []
            let listed = false
            for (let i = 0; i < available.length; ++i) {
                if (coordsEqually(available[i].coord, target.coord))
                    listed = true
            }
            if (!listed)
                reason = ACTION_REASON.ILLEGAL_TARGET
            else if (town.gold < candidate.suburbsCostformula(
                    candidate.distance[target.coord.x][target.coord.y]))
                reason = ACTION_REASON.CANNOT_AFFORD
        }
        else if (!candidate.canCreateOnCell(target, town))
            reason = ACTION_REASON.ILLEGAL_TARGET
        else if (!candidate.canAfford(town))
            reason = ACTION_REASON.CANNOT_AFFORD
        if (reason) {
            town.removeSelect()
            return ActionApi.reject(reason)
        }
        let entry = ActionApi.runTracked(() => {
            town.sendInstructions(target)
        })
        // Drops the pending activeProduction a successful placement re-chooses for the next click.
        town.removeSelect()
        if (!entry)
            return ActionApi.reject(ACTION_REASON.ILLEGAL_TARGET)
        return ActionApi.accept(entry, [action.producer, action.at])
    },

    destroy(action, actor) {
        let cell = ActionApi.cell(action.at)
        let layer = action.layer === undefined ? 'building' : action.layer
        if (!cell || layer !== 'building')
            return ActionApi.reject(ACTION_REASON.BAD_ACTION)
        let target = cell.building
        if (!ActionApi.isLiveEntity(target))
            return ActionApi.reject(ACTION_REASON.ILLEGAL_TARGET)
        if (target.playerColor !== actor)
            return ActionApi.reject(ACTION_REASON.NOT_OWNER)
        // isDestroyable = canBeDestroyed && isMyTurn (towns only when recently captured,
        // farms, nature and portals never).
        if (!target.isDestroyable)
            return ActionApi.reject(ACTION_REASON.ILLEGAL_TARGET)
        let entry = ActionApi.runTracked(() => {
            destroyEntityWithUndo(target)
        })
        if (!entry)
            return ActionApi.reject(ACTION_REASON.ILLEGAL_TARGET)
        return ActionApi.accept(entry, [action.at])
    },

    undo(action, actor) {
        if (!actionManager.arr.length)
            return ActionApi.reject(ACTION_REASON.NOTHING_TO_UNDO)
        let entry = actionManager.lastAction
        if (!actionManager.undo())
            return ActionApi.reject(ACTION_REASON.NOTHING_TO_UNDO)
        return ActionApi.accept(entry)
    },

    end(action, actor) {
        if (action.hash !== undefined && typeof action.hash !== 'string')
            return ActionApi.reject(ACTION_REASON.BAD_ACTION)
        return {ok: true, changedCells: []}
    }
}

function applyAction(action, actor) {
    if (!action || typeof action !== 'object' || ACTION_TYPES.indexOf(action.t) === -1)
        return ActionApi.reject(ACTION_REASON.BAD_ACTION)
    if (typeof gameEvent !== 'undefined' && gameEvent && gameEvent.waitingMode)
        return ActionApi.reject(ACTION_REASON.WAITING)
    if (actor === undefined)
        actor = whooseTurn
    if (!Number.isInteger(actor) || actor !== whooseTurn)
        return ActionApi.reject(ACTION_REASON.NOT_YOUR_TURN)
    if (!isActionUiActive())
        installHeadlessActionBorders()
    return ActionApi[action.t](action, actor)
}

// The AI's own command shapes (Unit.createCommandsFromDestinations, getEconomyCommands in
// ai/players.js) expressed in the action schema; null for anything else.
function actionFromAiCommand(command) {
    if (!command || typeof command !== 'object')
        return null
    if (command.type === 'economy' && command.producerCoord) {
        let producer = ActionApi.copyCoord(command.producerCoord)
        if (command.destinationCoord)
            return {t: 'build', producer: producer, product: command.product,
                at: ActionApi.copyCoord(command.destinationCoord)}
        return {t: 'train', producer: producer, product: command.product}
    }
    if (command.type === 'unit' && command.whoDoCommandCoord && command.destinationCoord) {
        let from = ActionApi.copyCoord(command.whoDoCommandCoord)
        let to = ActionApi.copyCoord(command.destinationCoord)
        if (coordsEqually(from, to))
            return {t: 'skip', at: from}
        let cell = ActionApi.cell(from)
        let unit = cell ? cell.unit : null
        let expect = {name: ActionApi.isLiveEntity(unit) ? unit.name : null}
        if (ActionApi.isLiveEntity(unit) && unit.id !== undefined)
            expect.id = unit.id
        return {t: 'unit', from: from, to: to, expect: expect}
    }
    return null
}
