class UndoManager {
    constructor() {
        this.arr = []
        this.maximumSize = 10
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
            killUnit: []
        })
    }
    get lastUndo() {
        return this.arr[this.arr.length - 1]
    }
    undoBuilding(building) {
        building = building
        // cant be empty
        let res = unpacker.fullUnpackBuilding(building)
        let town = grid.getBuilding(building.town.coord)
        res.town = town

        town.buildings.push(res)
    }
    undoTown(town) {
        town = town
        unpacker.unpackTown(town)
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
        if (building) {
            this.undoBuilding(building)
        }
        if (buildingProduction) {
            let res = unpacker.fullUnpackManufacture(buildingProduction)
            let town = grid.getBuilding(buildingProduction.town.coord)

            res.town = town

            town.buildingProduction.push(res)
        }
        let town = undo.town
        if (town) {
            this.undoTown(town)
        }
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
    }
    preparingBuildingUndo() {
        let undo = this.arr.pop()

        grid.getBuilding(undo.killBuilding.coord).kill()
        grid.getBuilding(undo.production.coord).kill()

        this.undoTown(undo.building)

        grid.getBuilding(undo.building.coord).player.gold = undo.gold
    }
    preparingSuburbUndo() {
        let undo = this.arr.pop()

        grid.getBuilding(undo.killBuilding.coord).kill()
        grid.getHexagon(undo.production.coord).isSuburb = false
        
        this.undoTown(undo.building)

        grid.getBuilding(undo.building.coord).player.gold = undo.gold
    }
    undo() {
        if (!this.arr.length)
            return

        gameEvent.hideAll()
        gameEvent.removeSelection()

        if (this.lastUndo.type == 'unit') {
            this.unitUndo()
        }
        else if (this.lastUndo.type == 'prepareUnit') {
            this.preparingUnitUndo()
        }
        else if (this.lastUndo.type == 'prepareBuilding') {
            this.preparingBuildingUndo()
        } 
        else if (this.lastUndo.type == 'prepareSuburb') {
            this.preparingSuburbUndo()
        }
        else {
            console.log("ERROR")
        }
    }
}