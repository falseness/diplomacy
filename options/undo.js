class UndoManager {
    constructor() {
        this.arr = []
        this.maximumSize = 100
    }
    clear() {
        this.arr = []
    }
    startUndo(type) {
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
            townExternalProduction: []
        })
    }
    get lastUndo() {
        return this.arr[this.arr.length - 1]
    }
    undoBuilding(building) {
        // cant be empty
        let res = unpacker.fullUnpackBuilding(building)
        if (building.town) {
            let town = grid.getBuilding(building.town.coord)
            res.town = town

            town.buildings.push(res)
        }
    }
    undoTown(town, isBuildingCaptured = false) {
        //town = town
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
        let res = unpacker.fullUnpackExternal(exProduction)
        externalProduction.push(res)
    }
    undoBuildingProduction(buildingProduction) {
        let res = unpacker.fullUnpackManufacture(buildingProduction)
        let town = grid.getBuilding(buildingProduction.town.coord)

        res.town = town

        town.buildingProduction.push(res)
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
            unpacker.fullUnpackUnit(unit)
        }

        let building = undo.building
        let buildingProduction = undo.buildingProduction
        let exProduction = undo.externalProduction

        let townExternalProduction = undo.townExternalProduction
        let townExternal = undo.townExternal

        if (building) {
            this.undoBuilding(building)
        }
        if (buildingProduction) {
            this.undoBuildingProduction(buildingProduction)
        }
        if (exProduction) {
            this.undoExternalProduction(exProduction)
        }
        let town = undo.town
        if (town) {
            this.undoTown(town, undo.isBuildingCaptured)
            
            for (let i = 0; i < townExternalProduction.length; ++i) {
                this.undoExternalProduction(townExternalProduction[i])
            }
            for (let i = 0; i < townExternal.length; ++i) {
                this.undoBuilding(townExternal[i])
            }
        }
        gameEvent.selected = grid.getUnit(undo.units[0].coord)
    }
    preparingUnitUndo() {
        let undo = this.arr.pop()
        grid.getBuilding(undo.killBuilding.coord).kill()

        if (undo.building.name == 'town') {
            this.undoTown(undo.building)
        }
        else {
            this.undoBuilding(undo.building)
        }
        grid.getBuilding(undo.building.coord).player.gold = undo.gold
        gameEvent.selected = grid.getBuilding(undo.building.coord)
    }
    preparingBuildingUndo() {
        let undo = this.arr.pop()

        grid.getBuilding(undo.killBuilding.coord).kill()
        grid.getBuilding(undo.production.coord).kill()

        this.undoTown(undo.building)

        grid.getBuilding(undo.building.coord).player.gold = undo.gold
        gameEvent.selected = grid.getBuilding(undo.building.coord)
    }
    preparingSuburbUndo() {
        let undo = this.arr.pop()

        grid.getBuilding(undo.killBuilding.coord).kill()
        grid.getHexagon(undo.production.coord).isSuburb = false
        
        this.undoTown(undo.building)

        grid.getBuilding(undo.building.coord).player.gold = undo.gold
        gameEvent.selected = grid.getBuilding(undo.building.coord)
    }
    destroyBuildingUndo() {
        let undo = this.arr.pop()

        this.undoBuilding(undo.building)
    }
    destroyTownUndo() {
        let undo = this.arr.pop()

        this.undoTown(undo.building)
    }

    destroyBuildingProductionUndo() {
        let undo = this.arr.pop()

        this.undoBuildingProduction(undo.building)
    }
    destroyExternalProductionUndo() {
        let undo = this.arr.pop()

        this.undoExternalProduction(undo.building)
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

        func[this.lastUndo.type].call(this)
        
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