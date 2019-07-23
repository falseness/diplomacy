class SaveManager {
    constructor() 
    {
       this.unpacker = new JsonUnpackManager()
    }
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
        
        console.log("saved")
    }
    load() {
        if (!this.hasSave())
            return
        let _grid = localStorage.getItem('grid')
        let _players = localStorage.getItem('players')
        let _whooseTurn = localStorage.getItem('whooseTurn')
        
        this.unpacker.unpackAll(_grid, _players, _whooseTurn)
        
        gameEvent.hideAll()
        console.log("loaded")
    }
}

class JsonUnpackManager {
    constructor() {}
    unpackUnit(packedUnit, _unit) {
        let unit = new _unit(packedUnit.coord.x, packedUnit.coord.y, 
                            grid.arr[packedUnit.town.coord.x][packedUnit.town.coord.y].building)
        unit.hp = packedUnit.hp
        unit.wasHitted = packedUnit.wasHitted
        unit.moves = packedUnit.moves
        return unit
    }
    unpackBuilding(packedBuilding, _building) {        
        let building = new _building(packedBuilding.coord.x, packedBuilding.coord.y,
                            grid.arr[packedBuilding.town.coord.x][packedBuilding.town.coord.y].building)
        building.hp = packedBuilding.hp
        building.wasHitted = packedBuilding.wasHitted
        return building
    }
    unpackManufacture(packedManufacture, _manufacture) {
        let manufacture = new ManufactureProduction(packedManufacture.turns, packedManufacture.cost,
                    _manufacture, packedManufacture.name)
        manufacture.coord = packedManufacture.coord
        manufacture.town = grid.arr[packedManufacture.town.coord.x][packedManufacture.town.coord.y].building
        
        manufacture.text = new CoordText(packedManufacture.coord.x, packedManufacture.coord.y, packedManufacture.turns)
        
        grid.arr[packedManufacture.coord.x][packedManufacture.coord.y].building = manufacture
        return manufacture
        //res.manufacture
    }
    unpackAll(jsonGrid, jsonPlayers, jsonWhooseTurn) {
        let packedGrid = JSON.parse(jsonGrid)
        let packedPlayers = JSON.parse(jsonPlayers)
        whooseTurn = JSON.parse(jsonWhooseTurn)
        
        let gridSize = {
            x: packedGrid.arr.length,
            y: packedGrid.arr[0].length
        }
        grid = new Grid(packedGrid.pos.x, packedGrid.pos.y, gridSize)
        grid.setDrawLogicText(packedGrid.drawLogicText)
        /*towns":[{"coord":{"x":5,"y":3},"pos":{"x":600,"y":484.9742261192856},"hp":12,"maxHP":12,"killed":false,"healSpeed":3,"wasHitted":false,"name":"town","suburbs":[{"coord":{"x":5,"y":3},"pos":{"x":518.4,"y":414.09219381653054},"player":1,"suburb":true},{"coord":{"x":5,"y":2},"pos":{"x":518.4,"y":275.5281292110203},"player":1,"suburb":true},{"coord":{"x":6,"y":3},"pos":{"x":638.4,"y":344.8101615137754},"player":1,"suburb":true},{"coord":{"x":6,"y":4},"pos":{"x":638.4,"y":483.3742261192856},"player":1,"suburb":true},{"coord":{"x":5,"y":4},"pos":{"x":518.4,"y":552.6562584220407},"player":1,"suburb":true},{"coord":{"x":4,"y":4},"pos":{"x":398.4,"y":483.3742261192856},"player":1,"suburb":true},{"coord":{"x":4,"y":3},"pos":{"x":398.4,"y":344.8101615137754},"player":1,"suburb":true}],"buildings":[],"units":[],"gold":12,"buildingProduction":[],"unitProduction":"Empty","activeProduction":"Empty"}]*/
        
        for (let i = 0; i < packedGrid.arr.length; ++i) {
            for (let j = 0; j < packedGrid.arr[i].length; ++j) {
                let cell = grid.arr[i][j]
                let packedCell = packedGrid.arr[i][j]
                cell.hexagon = new Hexagon(i, j, packedCell.hexagon.player, packedCell.hexagon.suburb) 
            }
        }
        
        let unitClass = {
            noob: Noob,
            archer: Archer, 
            KOHb: KOHb, 
            normchel: Normchel,
            catapult: Catapult
        }
        let buildingClass = {
            farm: Farm,
            barrack: Barrack
        }
        players = []
        for (let i = 0; i < packedPlayers.length; ++i) {
            players.push(new Player(packedPlayers[i].color, !i))
            for (let j = 0; j < packedPlayers[i].towns.length; ++j) {
                let packedTown = packedPlayers[i].towns[j]
                let town = new Town(packedTown.coord.x, packedTown.coord.y, packedTown.gold)
                town.suburbs = []
                
                town.hp = packedTown.hp
                town.wasHitted = packedTown.wasHitted
                
                for (let q = 0; q < packedTown.suburbs.length; ++q) {
                    town.addSuburb(grid.arr[packedTown.suburbs[q].coord.x][packedTown.suburbs[q].coord.y].hexagon)
                }
                for (let q = 0; q < packedTown.units.length; ++q) {
                    let packedUnit = packedTown.units[q]
                    town.units.push(this.unpackUnit(packedUnit, unitClass[packedUnit.name]))
                }
                for (let q = 0; q < packedTown.buildings.length; ++q) {
                    let packedBuilding = packedTown.buildings[q]        
                    town.buildings.push(this.unpackBuilding(packedBuilding, buildingClass[packedBuilding.name]))
                }
                for (let q = 0; q < packedTown.buildingProduction.length; ++q) {
                    let packedManufacture = packedTown.buildingProduction[q]
                    town.buildingProduction.push(this.unpackManufacture(packedManufacture, 
                                                                        buildingClass[packedManufacture.name]))
                }
                if (packedTown.unitProduction.name != 'Empty') {
                    town.unitProduction = new UnitProduction(
                        packedTown.unitProduction.turns, packedTown.unitProduction.cost,
                        unitClass[packedTown.unitProduction.name], packedTown.unitProduction.name)
                }
            }
        }
        mapBorder = {
            left: 0,
            right: grid.getRight(),
            top: 0,
            bottom: grid.getBottom(),
            scale: {
                min: 0.4,
                max: 1
            }
        }
        nextTurnButton.setColor(players[whooseTurn].getHexColor())
    }
}