class SaveManager {
    constructor() {}
    hasSave() {
        return !!localStorage.getItem('whooseTurn')
    }
    save() {
        let _grid = JSON.stringify(grid)
        let _players = JSON.stringify(players)
        let _whooseTurn = JSON.stringify(whooseTurn)
        localStorage.setItem('grid', _grid)
        localStorage.setItem('players', _players)
        localStorage.setItem('whooseTurn', _whooseTurn)

        //console.log("saved")
    }
    load() {
        if (!this.hasSave())
            return false
        let _grid = localStorage.getItem('grid')
        let _players = localStorage.getItem('players')
        let _whooseTurn = localStorage.getItem('whooseTurn')

        unpacker.unpackAll(_grid, _players, _whooseTurn)

        gameEvent.hideAll()
            //console.log("loaded")
        return true
    }
}

class JsonUnpackManager {
    constructor() {
        this.unitClass = {
            noob: Noob,
            archer: Archer,
            KOHb: KOHb,
            normchel: Normchel,
            catapult: Catapult
        }
        this.buildingClass = {
            farm: Farm,
            barrack: Barrack
        }
    }
    unpackUnit(packedUnit, _unit) {
        if (packedUnit.name == 'Empty') {
            let empty = new Empty()
            return empty
        }
        let unit = new _unit(packedUnit.coord.x, packedUnit.coord.y)
        unit.hp = packedUnit.hp
        unit.wasHitted = packedUnit.wasHitted
        unit.moves = packedUnit.moves

        return unit
    }
    fullUnpackUnit(packedUnit) {
        this.unpackUnit(packedUnit, this.unitClass[packedUnit.name])
    }
    unpackBuilding(packedBuilding, _building) {
        if (packedBuilding.name == 'Empty') {
            let empty = new Empty()
            return empty
        }

        let building = new _building(packedBuilding.coord.x, packedBuilding.coord.y)

        building.hp = packedBuilding.hp
        building.wasHitted = packedBuilding.wasHitted

        if (packedBuilding.name == 'barrack' &&
            packedBuilding.unitProduction.name != 'Empty') {
            building.unitProduction = new UnitProduction(
                packedBuilding.unitProduction.turns,
                production[packedBuilding.unitProduction.name].cost,
                this.unitClass[packedBuilding.unitProduction.name],
                packedBuilding.unitProduction.name)
        }

        return building
    }
    fullUnpackBuilding(packedBuilding) {
        this.unpackBuilding(packedBuilding, this.buildingClass[packedBuilding.name])
    }
    unpackManufacture(packedManufacture, _manufacture) {
        if (packedManufacture.name == 'Empty') {
            let empty = new Empty()
            return empty
        }

        let manufacture = new ManufactureProduction(
            packedManufacture.turns, production[packedManufacture.name].cost,
            _manufacture, packedManufacture.name)
        manufacture.coord = packedManufacture.coord

        grid.arr[packedManufacture.coord.x][packedManufacture.coord.y].building = manufacture
        return manufacture
            //res.manufacture
    }
    unpackHexagon(packedHexagon) {
        let x = packedHexagon.coord.x
        let y = packedHexagon.coord.y
        grid.arr[x][y].hexagon = new Hexagon(x, y, packedHexagon.player, packedHexagon.suburb)
    }
    unpackTown(packedTown) {
        let town = new Town(packedTown.coord.x, packedTown.coord.y, true)

        town.hp = packedTown.hp
        town.wasHitted = packedTown.wasHitted

        town.suburbs = []
        for (let q = 0; q < packedTown.suburbs.length; ++q) {
            grid.arr[packedTown.suburbs[q].x][packedTown.suburbs[q].y].hexagon.isSuburb = true
            town.suburbs.push(
                grid.arr[packedTown.suburbs[q].x][packedTown.suburbs[q].y].hexagon)
        }
        for (let q = 0; q < packedTown.buildings.length; ++q) {
            let packedBuilding = packedTown.buildings[q]
            town.buildings.push(
                this.unpackBuilding(packedBuilding, this.buildingClass[packedBuilding.name]))
        }
        for (let q = 0; q < packedTown.buildingProduction.length; ++q) {
            let packedManufacture = packedTown.buildingProduction[q]
            town.buildingProduction.push(
                this.unpackManufacture(packedManufacture,
                    this.buildingClass[packedManufacture.name]))
            town.buildingProduction[q].town = town
        }
        if (packedTown.unitProduction.name != 'Empty') {
            town.unitProduction = new UnitProduction(
                packedTown.unitProduction.turns,
                production[packedTown.unitProduction.name].cost,
                this.unitClass[packedTown.unitProduction.name],
                packedTown.unitProduction.name)
        }
    }
    unpackAll(jsonGrid, jsonPlayers, jsonWhooseTurn) {
        let packedGrid = JSON.parse(jsonGrid)
        let packedPlayers = JSON.parse(jsonPlayers)
        whooseTurn = JSON.parse(jsonWhooseTurn)

        let gridSize = {
            x: packedGrid.length,
            y: packedGrid[0].length
        }
        grid = new Grid(0, 0, gridSize)


        for (let i = 0; i < packedGrid.length; ++i) {
            for (let j = 0; j < packedGrid[i].length; ++j) {
                grid.arr[i][j].hexagon.firstpaint(packedGrid[i][j])
            }
        }

        players = []
        for (let i = 0; i < packedPlayers.length; ++i) {
            players.push(new Player(packedPlayers[i].color, packedPlayers[i].gold, !i))

            for (let j = 0; j < packedPlayers[i].towns.length; ++j) {
                let packedTown = packedPlayers[i].towns[j]
                this.unpackTown(packedTown)
            }
            for (let j = 0; j < packedPlayers[i].units.length; ++j) {
                let packedUnit = packedPlayers[i].units[j]
                this.unpackUnit(packedUnit, this.unitClass[packedUnit.name])
            }
        }
    }
}