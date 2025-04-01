class SaveManager {
    constructor() {}
    save() {
        updateExternal()

        saveGame()
        //console.log("saved")
    }
    load() {
        return loadGame()
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
            barrack: Barrack,
            wall: Wall, 
            bastion: Bastion,
            tower: Tower,
            lake: Lake,
            sea: Sea, 
            mountain: Mountain,
            bush: Bush
        }
    }
    setPlayerTimerByIndex(index, _timer) {
        localStorage.setItem(gameSlot + 'timer' + index, JSON.stringify(_timer))
    }
    getPlayerTimerByIndex(index) {
        return localStorage.getItem(gameSlot + 'timer' + index)
    }
    static timeNotFound = 9999
    getPlayerTime() {
        let _timer = this.getPlayerTimerByIndex(whooseTurn)
        return _timer ? JSON.parse(_timer).time : timeNotFound
    }
    unpackUnit(packedUnit, _unit) {
        if (packedUnit.name == 'Empty') {
            let empty = new Empty()
            grid.setUnit(empty, packedUnit.coord)
            return empty
        }
        let unit = new _unit(packedUnit.coord.x, packedUnit.coord.y)
        unit.hp = packedUnit.hp
        unit.wasHitted = packedUnit.wasHitted
        unit.moves = packedUnit.moves
        unit.updateHPBar()
        return unit
    }
    fullUnpackUnit(packedUnit) {
        this.unpackUnit(packedUnit, this.unitClass[packedUnit.name])
    }
    unpackBuilding(packedBuilding, _building) {
        if (packedBuilding.name == 'Empty') {
            let empty = new Empty()
            grid.setBuilding(empty, packedBuilding.coord)
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
        building.updateHPBar()
        return building
    }
    fullUnpackBuilding(packedBuilding) {
        return this.unpackBuilding(packedBuilding, this.buildingClass[packedBuilding.name])
    }
    unpackBuildingProduction(packedProduction, _production, _class) {
        if (packedProduction.name == 'Empty') {
            let empty = new Empty()
            return empty
        }

        let res = new _class(
            packedProduction.turns, production[packedProduction.name].cost,
            _production, packedProduction.name)
        
        res.coord = packedProduction.coord

        grid.arr[packedProduction.coord.x][packedProduction.coord.y].building = res
        
        return res
    }
    unpackManufacture(packedManufacture, _manufacture) {
        return this.unpackBuildingProduction(
            packedManufacture, _manufacture, ManufactureProduction)
    }
    fullUnpackManufacture(packedManufacture) {
        return this.unpackManufacture(packedManufacture,
            this.buildingClass[packedManufacture.name])
    }
    unpackExternal(packedExternal, _external) {
        return this.unpackBuildingProduction(packedExternal, _external, ExternalProduction)
    }
    fullUnpackExternal(packedExternal) {
        return this.unpackExternal(packedExternal,
            this.buildingClass[packedExternal.name])
    }
    unpackAllExternal(packedExternal, packedExternalProduction) {
        external = []
        externalProduction = []

        for (let i = 0; i < packedExternal.length; ++i) {
            let packedBuilding = packedExternal[i]
            let res = this.unpackBuilding(packedBuilding, this.buildingClass[packedBuilding.name])
            //external.push(res)
        }
        for (let i = 0; i < packedExternalProduction.length; ++i) {
            let packedProduction = packedExternalProduction[i]
            let res = this.unpackExternal(packedProduction, 
                this.buildingClass[packedProduction.name])
            externalProduction.push(res)
        }
    }
    unpackHexagon(packedHexagon) {
        let x = packedHexagon.coord.x
        let y = packedHexagon.coord.y
        grid.arr[x][y].hexagon = new Hexagon(x, y, packedHexagon.player, packedHexagon.suburb)
    }
    unpackTown(packedTown) {
        let town = new Town(packedTown.coord.x, packedTown.coord.y, true)
        town.isRecentlyCaptured = packedTown.isRecentlyCaptured

        town.hp = packedTown.hp
        town.updateHPBar()
        town.wasHitted = packedTown.wasHitted

        town.suburbs = []
        for (let q = 0; q < packedTown.suburbs.length; ++q) {
            let hexagon =  grid.arr[packedTown.suburbs[q].x][packedTown.suburbs[q].y].hexagon
            town.suburbs.push(hexagon)
            // hexagon can be in suburbs array, but no be suburb 
            // (it need for undo work with no bugs)
            if (hexagon.playerColor == town.playerColor) {
                hexagon.isSuburb = true
            }
        }
        for (let q = 0; q < packedTown.buildings.length; ++q) {
            let packedBuilding = packedTown.buildings[q]
            town.buildings.push(
                this.unpackBuilding(packedBuilding, this.buildingClass[packedBuilding.name]))
            town.buildings[q].town = town
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
    unpackAllNature(packedNature) {
        nature = []
        for (let i = 0; i < packedNature.length; ++i) {
            let natureBuilding = new this.buildingClass[packedNature[i].name](
                packedNature[i].coord.x, packedNature[i].coord.y)
        }
    }
    unpackAll(jsonGrid, jsonPlayers, jsonExternal, jsonExternalProduction, 
            jsonNature, jsonGoldmines, jsonTimer, jsonWhooseTurn, jsonGameRound, jsonIsFogOfWar, jsonGameSettings) {
        let packedTimer = JSON.parse(jsonTimer)
        if (packedTimer.type == 'long') {
            timer = new LongTimer(packedTimer.time)
        }
        else {
            timer = new Timer()
            timer.time = packedTimer.time
        }
        let packedGrid = JSON.parse(jsonGrid)
        let packedPlayers = JSON.parse(jsonPlayers)
        let packedExternal = JSON.parse(jsonExternal)
        let packedExternalProduction = JSON.parse(jsonExternalProduction)
        let packedNature = JSON.parse(jsonNature)
        let packedGoldmines = JSON.parse(jsonGoldmines)
        whooseTurn = JSON.parse(jsonWhooseTurn)
        gameRound = JSON.parse(jsonGameRound)
        isFogOfWar = JSON.parse(jsonIsFogOfWar)
        if (jsonGameSettings == null) {
            // default value
            gameSettings = {
                'isOnline': false
            }
        }
        else {
            gameSettings = JSON.parse(jsonGameSettings)
        }

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
        goldmines = []
        for (let i = 0; i < packedGoldmines.length; ++i) {
            new Goldmine(packedGoldmines[i].coord.x, packedGoldmines[i].coord.y, packedGoldmines[i].income)
        }

        players = []
        for (let i = 0; i < packedPlayers.length; ++i) {
            if (!i)
                players.push(new NeutralPlayer(packedPlayers[i].color, packedPlayers[i].gold))
            else 
                players.push(new Player(packedPlayers[i].color, packedPlayers[i].gold))

            for (let j = 0; j < packedPlayers[i].towns.length; ++j) {
                let packedTown = packedPlayers[i].towns[j]
                this.unpackTown(packedTown)
            }
            for (let j = 0; j < packedPlayers[i].units.length; ++j) {
                let packedUnit = packedPlayers[i].units[j]
                this.unpackUnit(packedUnit, this.unitClass[packedUnit.name])
            }
        }
        this.unpackAllExternal(packedExternal, packedExternalProduction)
        this.unpackAllNature(packedNature)

        if (isFogOfWar)
            players[whooseTurn].changeFogOfWarByVision()
    }
}