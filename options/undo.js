class UndoManager {
    constructor() {
        this.arr = []
        this.maximumSize = 5
    }
    clear() {
        this.arr = []
    }
    startUndo() {
        if (this.arr.length == this.maximumSize)
            this.arr.shift()
        else if (this.arr.length > this.maximumSize)
            console.log("ERROR")

        this.arr.push({
            hexagons: [],
            units: [],
            killUnit: []
        })
    }
    get lastUndo() {
        return this.arr[this.arr.length - 1]
    }
    undo() {
        if (!this.arr.length)
            return

        gameEvent.hideAll()
        gameEvent.removeSelection()

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
            building = JSON.parse(JSON.stringify(building))
            // cant be empty
            let res = unpacker.fullUnpackBuilding(building)
            let town = grid.getBuilding(building.town.coord)
            res.town = town

            town.buildings.push(res)
        }
        if (buildingProduction) {
            let res = unpacker.fullUnpackManufacture(buildingProduction)
            let town = grid.getBuilding(buildingProduction.town.coord)

            res.town = town

            town.buildingProduction.push(res)
        }
        let town = undo.town
        if (town) {
            town = JSON.parse(JSON.stringify(town))
            unpacker.unpackTown(town)
        }
        /*
        players[1].updateUnits()
        players[2].updateUnits()
        if (players[1].units.length > 1) {
            console.log("UNTIS > 1")
        }
        if (players[2].units.length > 1) {
            console.log("UNTIS > 1")
        }
        */
    }
}