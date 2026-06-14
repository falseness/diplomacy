// what the difference between command and action?
// result of command execution is sequence of actions, which are needed to do to apply changes
// for example, for moving of unit is command, which constists actions such as capturing land,
// changing amount of moves, changing position of unit... 

class ActionManager {
    constructor() {
        this.arr = []
        this.maximumSize = 1000
    }
    clear() {
        this.arr = []
    }
    startAction(type) {
        if (this.arr.length == this.maximumSize)
            this.arr.shift()
        else if (this.arr.length > this.maximumSize)
            console.log("ERROR")

        this.arr.push({
            type: type,
            hexagons: [],
            units: [],
            killUnit: [],
            townExternal: [],
            townExternalProduction: [],
            buildingProductions: [],
            playerEntityLists: this.snapshotPlayerEntityLists()
        })
    }
    get lastAction() {
        return this.arr[this.arr.length - 1]
    }
    removeKilledEntityAt(collection, coord) {
        if (!collection || !coord) {
            return -1
        }
        for (let i = collection.length - 1; i >= 0; --i) {
            let entity = collection[i]
            if (entity && entity.killed && entity.coord &&
                    entity.coord.x == coord.x && entity.coord.y == coord.y) {
                collection.splice(i, 1)
                return i
            }
        }
        return -1
    }
    findTownForBuilding(building, restoredBuilding) {
        if (building.town && building.town.coord &&
                !isCoordNotOnMap(
                    building.town.coord, grid.arr.length, grid.arr[0].length)) {
            let town = grid.getBuilding(building.town.coord)
            if (town && town.isTown && town.isTown()) {
                return town
            }
        }
        let player = restoredBuilding && players ?
            players[restoredBuilding.playerColor] : null
        if (!player || !player.towns) {
            return null
        }
        for (let i = 0; i < player.towns.length; ++i) {
            let town = player.towns[i]
            if (!town || town.killed) {
                continue
            }
            for (let j = 0; town.buildings && j < town.buildings.length; ++j) {
                let existing = town.buildings[j]
                if (existing.coord && coordsEqually(existing.coord, building.coord)) {
                    return town
                }
            }
            for (let j = 0; town.suburbs && j < town.suburbs.length; ++j) {
                if (town.suburbs[j].coord &&
                        coordsEqually(town.suburbs[j].coord, building.coord)) {
                    return town
                }
            }
        }
        return null
    }
    undoBuilding(building) {
        // cant be empty
        let externalIndex = this.removeKilledEntityAt(external, building.coord)
        let res = unpacker.fullUnpackBuilding(building)
        if (externalIndex != -1 && external[external.length - 1] == res) {
            external.pop()
            external.splice(externalIndex, 0, res)
        }
        if (building.town) {
            let town = this.findTownForBuilding(building, res)
            if (!town) {
                return
            }
            res.town = town

            if (!town.buildings) {
                town.buildings = []
            }
            for (let i = town.buildings.length - 1; i >= 0; --i) {
                let existing = town.buildings[i]
                if (existing.killed ||
                        (existing.coord && coordsEqually(existing.coord, building.coord))) {
                    town.buildings.splice(i, 1)
                }
            }
            town.buildings.push(res)
        }
    }
    removeTownFromPlayers(coord) {
        if (!players) {
            return
        }
        for (let i = 0; i < players.length; ++i) {
            let player = players[i]
            if (!player || !player.towns) {
                continue
            }
            for (let j = player.towns.length - 1; j >= 0; --j) {
                let town = player.towns[j]
                if (town && town.coord && town.coord.x == coord.x &&
                        town.coord.y == coord.y) {
                    player.towns.splice(j, 1)
                }
            }
        }
    }
    removeUnitFromPlayers(coord) {
        if (!players) {
            return
        }
        for (let i = 0; i < players.length; ++i) {
            let player = players[i]
            if (!player || !player.units) {
                continue
            }
            for (let j = player.units.length - 1; j >= 0; --j) {
                let unit = player.units[j]
                if (unit && unit.coord && unit.coord.x == coord.x &&
                        unit.coord.y == coord.y) {
                    player.units.splice(j, 1)
                }
            }
        }
    }
    snapshotPlayerEntityLists() {
        let snapshot = []
        if (!players) {
            return snapshot
        }
        for (let i = 0; i < players.length; ++i) {
            let player = players[i]
            snapshot[i] = {
                units: [],
                towns: []
            }
            if (!player) {
                continue
            }
            for (let j = 0; player.units && j < player.units.length; ++j) {
                let unit = player.units[j]
                if (unit && unit.coord) {
                    snapshot[i].units.push({x: unit.coord.x, y: unit.coord.y})
                }
            }
            for (let j = 0; player.towns && j < player.towns.length; ++j) {
                let town = player.towns[j]
                if (town && town.coord) {
                    snapshot[i].towns.push({x: town.coord.x, y: town.coord.y})
                }
            }
        }
        return snapshot
    }
    restorePlayerEntityLists(snapshot) {
        if (!snapshot || !players || !grid || !grid.arr) {
            return
        }
        for (let i = 0; i < players.length; ++i) {
            let player = players[i]
            if (!player || !snapshot[i]) {
                continue
            }
            player.units = []
            for (let j = 0; j < snapshot[i].units.length; ++j) {
                let unit = grid.getUnit(snapshot[i].units[j])
                if (unit && unit.notEmpty && unit.notEmpty() && !unit.killed) {
                    player.units.push(unit)
                }
            }
            player.towns = []
            for (let j = 0; j < snapshot[i].towns.length; ++j) {
                let town = grid.getBuilding(snapshot[i].towns[j])
                if (town && town.isTown && town.isTown() && !town.killed) {
                    player.towns.push(town)
                }
            }
        }
    }
    undoTown(town, isBuildingCaptured = false) {
        //town = town
        this.removeTownFromPlayers(town.coord)
        unpacker.unpackTown(town)
        if (!isBuildingCaptured)
            return
        let playerColor = grid.getBuilding(town.coord).playerColor
        for (let i = 0; i < town.suburbs.length; ++i) {
            let hexagon = grid.getHexagon(town.suburbs[i])
            if (hexagon.isSuburb)
                hexagon.sudoPaint(playerColor)
        }
    }
    undoExternalProduction(exProduction) {
        let externalProductionIndex =
            this.removeKilledEntityAt(externalProduction, exProduction.coord)
        let res = unpacker.fullUnpackExternal(exProduction)
        if (externalProductionIndex == -1) {
            externalProduction.push(res)
        } else {
            externalProduction.splice(externalProductionIndex, 0, res)
        }
    }
    undoBuildingProduction(buildingProduction) {
        let res = unpacker.fullUnpackManufacture(buildingProduction)
        let town = grid.getBuilding(buildingProduction.town.coord)

        res.town = town

        if (!town.buildingProduction) {
            town.buildingProduction = []
        }
        for (let i = town.buildingProduction.length - 1; i >= 0; --i) {
            let existing = town.buildingProduction[i]
            if (existing.killed ||
                    (existing.coord &&
                    coordsEqually(existing.coord, buildingProduction.coord))) {
                town.buildingProduction.splice(i, 1)
            }
        }
        town.buildingProduction.push(res)
    }
    removeBuildingProduction(buildingProduction) {
        let collection = externalProduction
        if (!buildingProduction.isExternalProduction() &&
            buildingProduction.town) {
            collection = buildingProduction.town.buildingProduction
        }
        let index = collection.indexOf(buildingProduction)
        if (index != -1) {
            collection.splice(index, 1)
        }
    }
    undoBuildingProductionList(primary, list) {
        let seen = {}
        let entries = []
        if (primary) {
            entries.push(primary)
        }
        for (let i = 0; list && i < list.length; ++i) {
            entries.push(list[i])
        }
        for (let i = 0; i < entries.length; ++i) {
            let entry = entries[i]
            if (!entry || !entry.coord) {
                continue
            }
            let key = entry.coord.x + ':' + entry.coord.y
            if (seen[key]) {
                continue
            }
            seen[key] = true
            this.undoBuildingProduction(entry)
        }
    }
    unitUndo() {
        let undo = this.arr.pop() //JSON.parse(this.arr.pop())

        for (let i = 0; i < undo.killUnit.length; ++i) {
            let unit = undo.killUnit[i]
            grid.getUnit(unit.coord).kill()
        }
        if (undo.killBuilding)
            grid.getBuilding(undo.killBuilding.coord).kill()


        for (let i = 0; i < undo.hexagons.length; ++i) {
            let hexagon = undo.hexagons[i]
            let res = grid.getHexagon(hexagon.coord)
            res.firstpaint(hexagon.player)
            res.isSuburb = hexagon.isSuburb
        }

        for (let i = undo.units.length - 1; i >= 0; --i) {
            let unit = undo.units[i]
            this.removeUnitFromPlayers(unit.coord)
            unpacker.fullUnpackUnit(unit)
        }

        let building = undo.building
        let buildingProduction = undo.buildingProduction
        let exProduction = undo.externalProduction

        let townExternalProduction = undo.townExternalProduction
        let townExternal = undo.townExternal
        let town = undo.town

        if (town) {
            this.undoTown(town, undo.isBuildingCaptured)
        }

        if (building && Number.isFinite(building.turns)) {
            if (building.town) {
                this.undoBuildingProduction(building)
            }
            else {
                this.undoExternalProduction(building)
            }
        }
        else if (building) {
            this.undoBuilding(building)
        }
        this.undoBuildingProductionList(
            buildingProduction,
            undo.buildingProductions)
        if (exProduction) {
            this.undoExternalProduction(exProduction)
        }
        if (town) {
            for (let i = 0; i < townExternalProduction.length; ++i) {
                this.undoExternalProduction(townExternalProduction[i])
            }
            for (let i = 0; i < townExternal.length; ++i) {
                this.undoBuilding(townExternal[i])
            }
        }
        this.restorePlayerEntityLists(undo.playerEntityLists)
        gameEvent.selected = grid.getUnit(undo.units[0].coord)
        nextTurnButton.highlightButton = false
    }
    preparingUnitUndo() {
        let undo = this.arr.pop()
        grid.getBuilding(undo.killBuilding.coord).kill()

        if (undo.building.name == 'town') {
            this.undoTown(undo.building)
        } else {
            this.undoBuilding(undo.building)
        }
        grid.getBuilding(undo.building.coord).player.gold = undo.gold
        this.restorePlayerEntityLists(undo.playerEntityLists)
        gameEvent.selected = grid.getBuilding(undo.building.coord)
    }
    preparingBuildingUndo() {
        let undo = this.arr.pop()
        let buildingProduction = grid.getBuilding(undo.production.coord)

        grid.getBuilding(undo.killBuilding.coord).kill()
        this.removeBuildingProduction(buildingProduction)
        buildingProduction.kill()

        this.undoTown(undo.building)

        grid.getBuilding(undo.building.coord).player.gold = undo.gold
        this.restorePlayerEntityLists(undo.playerEntityLists)
        gameEvent.selected = grid.getBuilding(undo.building.coord)
    }
    preparingSuburbUndo() {
        let undo = this.arr.pop()

        grid.getBuilding(undo.killBuilding.coord).kill()
        grid.getHexagon(undo.production.coord).isSuburb = false

        this.undoTown(undo.building)

        grid.getBuilding(undo.building.coord).player.gold = undo.gold
        this.restorePlayerEntityLists(undo.playerEntityLists)
        gameEvent.selected = grid.getBuilding(undo.building.coord)
    }
    destroyBuildingUndo() {
        let undo = this.arr.pop()

        this.undoBuilding(undo.building)
        gameEvent.selected = grid.getBuilding(undo.building.coord)
    }
    destroyTownUndo() {
        let undo = this.arr.pop()

        this.undoTown(undo.building)
        gameEvent.selected = grid.getBuilding(undo.building.coord)
    }

    destroyBuildingProductionUndo() {
        let undo = this.arr.pop()

        this.undoBuildingProduction(undo.building)
        gameEvent.selected = grid.getBuilding(undo.building.coord)
    }
    destroyExternalProductionUndo() {
        let undo = this.arr.pop()

        this.undoExternalProduction(undo.building)
        gameEvent.selected = grid.getBuilding(undo.building.coord)
    }
    undo() {
        if (!this.arr.length)
            return

        let wasSelection = gameEvent.selected.notEmpty()
        gameEvent.hideAll()
        gameEvent.removeSelection()

        let func = {
            unit: this.unitUndo,
            prepareUnit: this.preparingUnitUndo,
            prepareBuilding: this.preparingBuildingUndo,
            prepareSuburb: this.preparingSuburbUndo,
            destroyBuilding: this.destroyBuildingUndo,
            destroyTown: this.destroyTownUndo,
            destroyBuildingProduction: this.destroyBuildingProductionUndo,
            destroyExternalProduction: this.destroyExternalProductionUndo
        }

        func[this.lastAction.type].call(this)

        if (otherSettings.moveCameraToUndoTarget)
            this.__moveCameraToUndoTarget()
        if (wasSelection)
            gameEvent.selected.select()
        else
            gameEvent.selected = new Empty()
    }
    __moveCameraToUndoTarget() {
        gameEvent.screen.moveTo(gameEvent.selected.pos)
    }
}
