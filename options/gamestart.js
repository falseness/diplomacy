function getHexagonalLayer(x, y, center) {
    let q = x
    let r = y - Math.floor(x / 2)
    let s = -q - r
    let centerS = -center.q - center.r
    return Math.ceil(Math.max(
        Math.abs(q - center.q),
        Math.abs(r - center.r),
        Math.abs(s - centerS)
    ))
}

// Checked before a map is built (GameMap.start): every unit, town, building, goldmine and
// portal stands inside the map on a cell without impassable nature (Mountain, Lake, or the
// InvisibleMountain edge of a hexagonal map), and no two of them share a cell, except a
// unit standing on a building or portal. A violation throws with the coordinates.
// Coordinates go through the same offset rules as the build below.
function validateGameMap(map) {
    const layers = {building: new Map(), unit: new Map()}
    const where = coord => coord.x + ',' + coord.y
    const inside = coord => Number.isInteger(coord.x) && Number.isInteger(coord.y) &&
        coord.x >= 0 && coord.y >= 0 && coord.x < map.mapSize.x && coord.y < map.mapSize.y
    const impassable = new Map()
    for (const [cells, name] of [[map.mountains, 'mountain'], [map.lakes, 'lake']]) {
        for (const cell of cells || []) {
            const coord = map.getMapCoord(cell)
            impassable.set(where(coord), name)
        }
    }
    const shape = map.mapShape
    const onEdge = coord => shape && shape.type == 'hexagonal' &&
        getHexagonalLayer(coord.x, coord.y, shape.center) > shape.radius
    const entity = (layer, coord, label) => {
        if (onEdge(coord))
            throw new Error('Map ' + label + ' at ' + where(coord) + ' stands on impassable invisibleMountain')
        if (!inside(coord))
            throw new Error('Map ' + label + ' at ' + where(coord) + ' is outside the map')
        if (impassable.has(where(coord)))
            throw new Error('Map ' + label + ' at ' + where(coord) + ' stands on impassable ' + impassable.get(where(coord)))
        const previous = layers[layer].get(where(coord))
        if (previous)
            throw new Error('Map ' + label + ' at ' + where(coord) + ' shares its cell with ' + previous)
        layers[layer].set(where(coord), label)
    }
    for (let i = 0; i < map.players.length; ++i) {
        const player = map.players[i]
        for (const town of player.towns || [])
            entity('building', map.getMapCoord(town), 'town of player ' + i)
        for (const property of ['barracks', 'pendingBarracks', 'farms', 'pendingFarms', 'walls', 'bastions', 'towers']) {
            for (const building of player[property] || [])
                entity('building', building, property + ' of player ' + i)
        }
        for (const unit of player.units || [])
            entity('unit', unit, 'unit of player ' + i)
    }
    for (const goldmine of map.goldmines || [])
        entity('building', map.getMapCoord(goldmine), 'goldmine')
    for (const portal of map.portals || [])
        entity('building', map.getMapCoord(portal), 'portal')
}

class GameMap {
    constructor(mapSize, _players, _goldmines, lakes, mountains, bushes=[], hills=[], mapShape={type: 'rectangular'}, coop=null) {
        if (coop && (_players.length < 2 || _players.length > 13)) {
            throw new RangeError('Co-op requires 1 to 12 humans plus a neutral slot')
        }
        this.mapSize = mapSize
        this.players = _players
        this.goldmines = _goldmines
        this.lakes = lakes
        this.mountains = mountains
        this.bushes = bushes
        this.hills = hills
        this.mapShape = mapShape
        // Input slots remain neutral + humans. The controller is appended outside
        // that roster so it never replaces a human, even at the interface limit.
        this.coop = coop ? {
            initialHumanCount: _players.length - 1,
            humanSlots: _players.slice(1).map((_, i) => i + 1),
            humanTeam: 'HUMANS', demonSlot: _players.length,
            ...(coop.tutorial ? {tutorial: true} : {})
        } : null
        if (coop) {
            this.players = [..._players, {
                rgb: {r: 160, g: 40, b: 180}, units: coop.units || [],
                towns: [], gold: 0
            }]
        }
    }
    getMapCoord(coord) {
        let offset = this.mapShape.offset || {x: 0, y: 0}
        return {...coord, x: coord.x + offset.x, y: coord.y + offset.y}
    }
    getPlayerType(playerSettings) {
        if (playerSettings.playerType == 'simple-ai' ||
            playerSettings.playerType == 'SimpleAiPlayer') {
            return SimpleAiPlayer
        }
        if (playerSettings.playerType == 'simple-ai-economy' ||
            playerSettings.playerType == 'SimpleAiPlayerWithEconomy') {
            return SimpleAiPlayerWithEconomy
        }
        if (playerSettings.playerType == 'TutorialDefenderAiPlayer') {
            return TutorialDefenderAiPlayer
        }
        if (playerSettings.playerType == 'ai-economy' ||
            playerSettings.playerType == 'AIPlayerWithEconomy') {
            return AIPlayerWithEconomy
        }
        if (playerSettings.playerType == 'ai' ||
            playerSettings.playerType == 'AIPlayer' ||
            playerSettings.ai) {
            return AIPlayer
        }
        return Player
    }
    createPlayers(competitiveHotseat = false) {
        players = new Array(this.players.length)
        players[0] = new NeutralPlayer(this.players[0].rgb, 0)

        for (let i = 1; i < this.players.length; ++i) {
            let playerType = this.coop && i === this.coop.demonSlot ?
                DemonPlayer : this.getPlayerType(this.players[i])
            // A co-op tutorial human without a town has no economy: it cannot earn or spend, and the army
            // salary would drive its gold below 0 on the first turn, where crisisPenalty disbands every unit.
            const townlessTutorialHuman = this.coop && this.coop.tutorial && i !== this.coop.demonSlot &&
                !(this.players[i].towns || []).length
            let economyEnabled = this.players[i].economyEnabled !== false && !townlessTutorialHuman
            let configuredGold = economyEnabled ? this.players[i].gold : 0
            if (competitiveHotseat && playerType === Player) {
                if (configuredGold === undefined) configuredGold = 100
                gameSettings.pendingHotseatOpeningEconomy.push(i)
            }
            players[i] = configuredGold === undefined ?
                new playerType(this.players[i].rgb) :
                new playerType(this.players[i].rgb, configuredGold)
            players[i].economyEnabled = economyEnabled
            // A lesson-only setting: the player's units path through hexes red cannot see (tutorial
            // AIs otherwise move only into hexes red sees, see Way.isCellImpassable).
            if (this.players[i].ignoresFog === true) players[i].ignoresFog = true

            if (!('units' in this.players[i])) {
                continue;
            }
            for (let j = 0; j < this.players[i].units.length; ++j) {
                let unit = this.players[i].units[j]
                grid.arr[unit.x][unit.y].hexagon.firstpaint(i)
                assert(grid.arr[unit.x][unit.y].unit.isEmpty())
                let unitType = unit.type || Noob
                let configuredUnit = new unitType(unit.x, unit.y)
                if (!('hp' in unit)) {
                    continue
                }
                assert(0 < unit.hp && unit.hp <= configuredUnit.hp)
                configuredUnit.hit(configuredUnit.hp - unit.hp)
            }
        }
    }
    createTowns() {
        for (let i = 0; i < this.players[0].towns.length; ++i) {
            let town_coord = this.getMapCoord(this.players[0].towns[i])
            let town = new Town(town_coord.x, town_coord.y, false, -1)
            if ('hp' in town_coord) {
                assert(0 <= town_coord.hp && town_coord.hp <= town.hp)
                town.hit(town.hp - town_coord.hp)
            }
        }
        for (let i = 1; i < this.players.length; ++i) {
            let towns = this.players[i].towns
            for (let j = 0; j < towns.length; ++j) {
                let town_coord = this.getMapCoord(towns[j])

                grid.arr[town_coord.x][town_coord.y].hexagon.firstpaint(i)
                // A town may start without its own noob (noob: false): a configured unit stands on it instead.
                let town = new Town(town_coord.x, town_coord.y, false, town_coord.noob !== false)
                if ('hp' in town_coord) {
                    // A town may start at 0 hp: an enemy unit can step in and capture it.
                    assert(0 <= town_coord.hp && town_coord.hp <= town.hp)
                    town.hit(town.hp - town_coord.hp)
                }
            }
        }
    }
    createConfiguredSuburbs() {
        for (let playerIndex = 1; playerIndex < this.players.length; ++playerIndex) {
            let configuredLayouts = this.players[playerIndex].suburbs
            if (!configuredLayouts) {
                continue
            }
            for (let layoutIndex = 0; layoutIndex < configuredLayouts.length; ++layoutIndex) {
                let layout = configuredLayouts[layoutIndex]
                let town = this.getConfiguredTown(playerIndex, layout.town)
                for (let suburbIndex = 0; suburbIndex < town.suburbs.length; ++suburbIndex) {
                    town.suburbs[suburbIndex].isSuburb = false
                }
                town.suburbs = []
                for (let cellIndex = 0; cellIndex < layout.cells.length; ++cellIndex) {
                    let hexagon = grid.getHexagon(layout.cells[cellIndex])
                    hexagon.firstpaint(playerIndex)
                    hexagon.isSuburb = true
                    town.suburbs.push(hexagon)
                }
                let expansionCells = layout.expansionCells || []
                for (let cellIndex = 0; cellIndex < expansionCells.length; ++cellIndex) {
                    grid.getHexagon(expansionCells[cellIndex]).firstpaint(playerIndex)
                }
            }
        }
    }
    getConfiguredTown(playerIndex, townCoord) {
        for (let i = 0; i < players[playerIndex].towns.length; ++i) {
            let town = players[playerIndex].towns[i]
            if (coordsEqually(town.coord, townCoord)) {
                return town
            }
        }
        throw new Error('Configured manufacture references an unknown town')
    }
    createConfiguredBarracks() {
        for (let playerIndex = 1; playerIndex < this.players.length; ++playerIndex) {
            let playerSettings = this.players[playerIndex]
            let barracks = playerSettings.barracks || []
            for (let i = 0; i < barracks.length; ++i) {
                let configured = barracks[i]
                let town = this.getConfiguredTown(playerIndex, configured.town)
                assert(grid.getBuilding(configured).isEmpty())
                let barrack = new Barrack(configured.x, configured.y, town)
                if ('hp' in configured) {
                    assert(0 < configured.hp && configured.hp <= barrack.hp)
                    barrack.hit(barrack.hp - configured.hp)
                }
                town.buildings.push(barrack)
            }

            let pendingBarracks = playerSettings.pendingBarracks || []
            for (let i = 0; i < pendingBarracks.length; ++i) {
                let configured = pendingBarracks[i]
                let town = this.getConfiguredTown(playerIndex, configured.town)
                assert(grid.getBuilding(configured).isEmpty())
                let pending = new ManufactureProduction(
                    configured.turns, production.barrack.cost, Barrack, 'barrack')
                pending.town = town
                pending.coord = {x: configured.x, y: configured.y}
                town.buildingProduction.push(pending)
                grid.setBuilding(pending, pending.coord)
            }
        }
    }
    createConfiguredFarms() {
        for (let playerIndex = 1; playerIndex < this.players.length; ++playerIndex) {
            let playerSettings = this.players[playerIndex]
            let farms = playerSettings.farms || []
            for (let i = 0; i < farms.length; ++i) {
                let configured = farms[i]
                let town = this.getConfiguredTown(playerIndex, configured.town)
                assert(grid.getBuilding(configured).isEmpty())
                let farm = new Farm(configured.x, configured.y, town)
                if ('hp' in configured) {
                    assert(0 < configured.hp && configured.hp <= farm.hp)
                    farm.hit(farm.hp - configured.hp)
                }
                town.buildings.push(farm)
            }

            let pendingFarms = playerSettings.pendingFarms || []
            for (let i = 0; i < pendingFarms.length; ++i) {
                let configured = pendingFarms[i]
                let town = this.getConfiguredTown(playerIndex, configured.town)
                assert(grid.getBuilding(configured).isEmpty())
                let pending = new ManufactureProduction(
                    configured.turns, production.farm.cost, Farm, 'farm')
                pending.town = town
                pending.coord = {x: configured.x, y: configured.y}
                town.buildingProduction.push(pending)
                grid.setBuilding(pending, pending.coord)
            }
        }
    }
    createConfiguredExternalBuildings() {
        let externalTypes = [
            ['walls', Wall],
            ['bastions', Bastion],
            ['towers', Tower]
        ]
        for (let playerIndex = 1; playerIndex < this.players.length; ++playerIndex) {
            let playerSettings = this.players[playerIndex]
            for (let typeIndex = 0; typeIndex < externalTypes.length; ++typeIndex) {
                let property = externalTypes[typeIndex][0]
                let BuildingType = externalTypes[typeIndex][1]
                let configuredBuildings = playerSettings[property] || []
                for (let i = 0; i < configuredBuildings.length; ++i) {
                    let configured = configuredBuildings[i]
                    assert(grid.getBuilding(configured).isEmpty())
                    // A building on a hex nothing painted yet (no unit, town or suburb) takes its owner's colour.
                    let hexagon = grid.getHexagon(configured)
                    if (hexagon.playerColor == 0)
                        hexagon.firstpaint(playerIndex)
                    assert(hexagon.playerColor == playerIndex)
                    let building = new BuildingType(configured.x, configured.y)
                    if (!('hp' in configured)) {
                        continue
                    }
                    assert(0 < configured.hp && configured.hp <= building.hp)
                    building.hit(building.hp - configured.hp)
                }
            }
        }
    }
    createGoldmines() {
        for (let i = 0; i < this.goldmines.length; ++i) {
            let goldmine = this.getMapCoord(this.goldmines[i])
            let owner = goldmine.owner === undefined ? 0 : goldmine.owner
            assert(owner >= 0 && owner < this.players.length)
            grid.arr[goldmine.x][goldmine.y].hexagon.firstpaint(owner)
            new Goldmine(goldmine.x, goldmine.y, goldmine.income)
        }
    }
    createNature() {
        let natures = [
            [this.mountains, Mountain],
            [this.lakes, Lake],
            [this.bushes, Bush],
            [this.hills, Hill]
        ]
        for (let i = 0; i < natures.length; ++i) {
            let nature_type = natures[i][0]
            let nature_class = natures[i][1]
            for (let j = 0; j < nature_type.length; ++j) {
                let coord = this.getMapCoord(nature_type[j])
                new (nature_class)(coord.x, coord.y)
            }
        }
    }
    createMapEdge() {
        if (this.mapShape.type != 'hexagonal')
            return

        for (let x = 0; x < grid.arr.length; ++x) {
            for (let y = 0; y < grid.arr[x].length; ++y) {
                if (getHexagonalLayer(x, y, this.mapShape.center) <= this.mapShape.radius)
                    continue
                if (grid.arr[x][y].building.notEmpty())
                    throw new Error('Hexagonal map edge overlaps an authored object at ' + x + ',' + y)
                new InvisibleMountain(x, y)
            }
        }
    }
    start(_gameManager, isClassicTimer, competitiveHotseat = false) {
        // Local and online co-op accept only current typed maps.
        if (this.coop) validateCoopTypedPortals(this)
        validateGameMap(this)
        grid = new Grid(0, 0, this.mapSize)
        _gameManager.clearValues()
        normalizeInterfaceSettings(gameSettings)
        gameSettings.mapShape = this.mapShape
        if (this.coop) gameSettings.coop = {...JSON.parse(JSON.stringify(this.coop)), balanceVersion: 2}
        else delete gameSettings.coop
        // Set before the timers below, which a tutorial keeps out of the save slot.
        if (this.tutorial) gameSettings.tutorial = {...this.tutorial}
        else delete gameSettings.tutorial
        gameSettings.drawFogLandmarks = true

        // Store unplayed opening slots with the save, including round-zero saves.
        delete gameSettings.pendingHotseatOpeningEconomy
        if (competitiveHotseat && !this.coop) gameSettings.pendingHotseatOpeningEconomy = []
        this.createPlayers(competitiveHotseat && !this.coop)
        this.createTowns()
        if (this.tutorial?.id === 'tutorial-14') {
            // Only town rings own opening land. Unit ownership was captured during
            // construction, so the authored field forces remain blue on neutral land.
            for (const column of grid.arr)
                for (const cell of column)
                    if (!cell.hexagon.isSuburb) cell.hexagon.firstpaint(0)
        }
        this.createConfiguredSuburbs()
        this.createConfiguredBarracks()
        this.createConfiguredFarms()
        this.createConfiguredExternalBuildings()
        this.createGoldmines()
        this.createNature()
        this.createMapEdge()
        if (this.coop) {
            for (const placement of this.portals || []) {
                const coord = this.getMapCoord(placement)
                // A demon from coop.units may start standing on its portal (DemonPortal checks the owner).
                new DemonPortal(coord.x, coord.y, placement.category)
            }
        }
        _gameManager.updateCameraBorders()
        _gameManager.fitCamera?.()
        // A map may start later in the game (tutorials entry startRound): round
        // counters and the co-op wave schedule continue from it.
        gameRound = this.startRound || 0

        if (!isClassicTimer) {
            timer = new LongTimer()
            timer.time = STANDARTTIME
            timer.lastPause = undefined
        }
        else {
            timer = new Timer()
        }
        for (let i = 0; i < this.players.length; ++i) {
            unpacker.setPlayerTimerByIndex(i, timer)
        }
        if (!isClassicTimer) {
            for (let i = 1; i < this.players.length; ++i) {
                const packedTimer = JSON.parse(unpacker.getPlayerTimerByIndex(i))
                recalculatePlayerTimer(i, packedTimer)
            }
        }
    }
    /*
    эта структура нужна для удобного хранения карт
    и для общения GameSettingsTree и GameManager
    осталось допилить это и можно будет
    сделать нормальное создание игры со слотами
    */
}
function packMap() {
    let res = ''
    res += '{x: ' + grid.arr.length + ', y: ' + grid.arr[0].length + '},\n'
    res += '[\n'
    for (let i = 0; i < players.length; ++i) {
        let p = players[i]
        res += '{\n'
        res +='rgb: {r: ' + p.color.r + ', g: ' + p.color.g + ', b: ' + p.color.b + '},\n'
        let s = ''
        for (let j = 0; j < p.towns.length; ++j) {
            s += '{x: ' + p.towns[j].coord.x + ', y: ' + p.towns[j].coord.y + '}'
            if (j != p.towns.length - 1)
                s += ', '
        }
        res += 'towns: [' + s + ']\n'
        let tmps = '}'
        if (i != players.length - 1)
            tmps += ','

        res += tmps + '\n'
    }
    res += '],\n'
    let s = ''
    for (let i = 0; i < goldmines.length; ++i) {
        let g = goldmines[i]
        s += '{x: ' + g.coord.x + ', y: ' + g.coord.y + ', income: ' + g.potentialIncome + '}'
        if (i != goldmines.length - 1)
            s += ', '
    }
    res += '[' + s + '],\n'

    let s_mountain = ''
    let s_lake = ''
    for (let i = 0; i < nature.length; ++i) {
        let n = nature[i]
        if (n.name == 'mountain') {
            s_mountain += '{x: ' + n.coord.x + ', y: ' + n.coord.y + '}, '
        }
        else {
            s_lake += '{x: ' + n.coord.x + ', y: ' + n.coord.y + '}, '
        }
    }
    if (s_lake.length) {
        s_lake = s_lake.substring(0, s_lake.length - 2)
    }
    if (s_mountain.length) {
        s_mountain = s_mountain.substring(0, s_mountain.length - 2)
    }
    res += '[' + s_lake + '],\n'
    res += '[' + s_mountain + ']\n'
    console.log(res)
}

function createTinyEconomyAiTestMap() {
    let map = new GameMap(
        {x: 9, y: 7},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                playerType: 'SimpleAiPlayerWithEconomy',
                towns: [{x: 1, y: 3}],
                units: [{x: 2, y: 2}, {x: 2, y: 4}]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                playerType: 'SimpleAiPlayerWithEconomy',
                towns: [{x: 7, y: 3}],
                units: [{x: 6, y: 2}, {x: 6, y: 4}]
            }
        ],
        [],
        [],
        []
    )
    map.suddenDeathRound = 2000
    map.testName = 'tiny economy ai duel'
    return map
}

maps = {
    "open field":
    [
        new GameMap(
            {x: 21, y: 21},
            [
                {
                    rgb: {r: 208, g: 208, b: 208},
                    towns: [{x: 10, y: 19},
                        {x: 10, y: 10}, {x: 10, y: 1}]
                },
                {
                    rgb: {r: 255, g: 0, b: 0},
                    towns: [{x: 3, y: 10}]
                },
                {
                    rgb: {r: 98, g: 168, b: 222},
                    towns: [{x: 17, y: 10}]
                }
            ],
            [{x: 5, y: 15, income: 10}, {x: 15, y: 15, income: 10},
             {x: 5, y: 18, income: 10}, {x: 15, y: 18, income: 10},
             {x: 5, y: 1, income: 10}, {x: 15, y: 1, income: 10},
             {x: 6, y: 5, income: 10}, {x: 14, y: 5, income: 10},
             {x: 1, y: 1, income: 10}, {x: 19, y: 1, income: 10},
             {x: 1, y: 17, income: 10}, {x: 19, y: 17, income: 10},
             {x: 2, y: 5, income: 10}, {x: 18, y: 5, income: 10},
             {x: 9, y: 14, income: 10}, {x: 11, y: 14, income: 10},
             ],
            [{x: 7, y: 14}, {x: 8, y: 14}, {x: 9, y: 13}, {x: 10, y: 14},
             {x: 11, y: 13}, {x: 12, y: 14}, {x: 13, y: 14},
             {x: 7, y: 6}, {x: 8, y: 6}, {x: 9, y: 5}, {x: 10, y: 6},
             {x: 11, y: 5}, {x: 12, y: 6}, {x: 13, y: 6}],
             [],
             [{"x":7,"y":2},{"x":13,"y":2},{"x":7,"y":3},{"x":13,"y":3},{"x":8,"y":4},{"x":12,"y":4},{"x":6,"y":4},{"x":14,"y":4},{"x":6,"y":3},{"x":14,"y":3},{"x":8,"y":9},{"x":12,"y":9},{"x":8,"y":10},{"x":12,"y":10},{"x":8,"y":11},{"x":12,"y":11},{"x":4,"y":14},{"x":16,"y":14},{"x":3,"y":14},{"x":17,"y":14},{"x":5,"y":13},{"x":15,"y":13},{"x":2,"y":15},{"x":18,"y":15},{"x":0,"y":2},{"x":20,"y":2},{"x":1,"y":2},{"x":19,"y":2},{"x":2,"y":2},{"x":18,"y":2},{"x":3,"y":2},{"x":17,"y":2}]
        ),
        new GameMap(
            {x: 26, y: 26},
            [
                {
                    rgb: {r: 208, g: 208, b: 208},
                    // One shared objective between each pair of player sectors.
                    towns: [{x: 11, y: 4}, {x: 19, y: 12}, {x: 7, y: 14}]
                },
                {
                    rgb: {r: 255, g: 0, b: 0},
                    towns: [{x: 5, y: 7}]
                },
                {
                    rgb: {r: 98, g: 168, b: 222},
                    towns: [{x: 19, y: 6}]
                },
                {
                    rgb: {r: 0, g: 179, b: 0},
                    towns: [{x: 13, y: 17}]
                }
            ],
            [
                // Every row is one 120-degree orbit around the three towns.
                {x: 1, y: 11, income: 10}, {x: 17, y: 1, income: 10},
                {x: 19, y: 18, income: 10},
                {x: 4, y: 13, income: 10}, {x: 14, y: 3, income: 10},
                {x: 19, y: 15, income: 10},
                {x: 12, y: 10, income: 20}, {x: 13, y: 10, income: 20},
                {x: 12, y: 11, income: 20},
                {x: 7, y: 2, income: 15}, {x: 23, y: 10, income: 15},
                {x: 7, y: 18, income: 15}
            ],
            [
                {x: 5, y: 12}, {x: 14, y: 4}, {x: 18, y: 15},
                {x: 6, y: 12}, {x: 14, y: 5}, {x: 17, y: 14},
                {x: 3, y: 14}, {x: 13, y: 1}, {x: 21, y: 15},
                {x: 4, y: 14}, {x: 13, y: 2}, {x: 20, y: 15},
                {x: 5, y: 15}, {x: 11, y: 2}, {x: 21, y: 13},
                {x: 6, y: 15}, {x: 11, y: 3}, {x: 20, y: 13},
                // Shoreline triplets decorate all three equivalent map edges.
                {x: 5, y: 1}, {x: 25, y: 9}, {x: 7, y: 20},
                {x: 6, y: 1}, {x: 25, y: 10}, {x: 6, y: 20}
            ],
            [
                {x: 11, y: 6}, {x: 17, y: 11}, {x: 9, y: 13},
                {x: 12, y: 6}, {x: 17, y: 12}, {x: 8, y: 13},
                {x: 6, y: 3}, {x: 23, y: 9}, {x: 8, y: 19},
                {x: 7, y: 3}, {x: 22, y: 10}, {x: 8, y: 18},
                {x: 9, y: 5}, {x: 19, y: 10}, {x: 9, y: 15},
                {x: 10, y: 5}, {x: 19, y: 11}, {x: 8, y: 15},
                // Border ridges are complete rotational orbits, not isolated walls.
                {x: 0, y: 12}, {x: 17, y: 0}, {x: 20, y: 19},
                {x: 4, y: 19}, {x: 8, y: 0}, {x: 25, y: 12}
            ],
            [
                {x: 8, y: 6}, {x: 19, y: 9}, {x: 10, y: 16},
                {x: 9, y: 6}, {x: 18, y: 10}, {x: 10, y: 15},
                {x: 7, y: 10}, {x: 15, y: 6}, {x: 15, y: 14},
                {x: 8, y: 10}, {x: 15, y: 7}, {x: 14, y: 14},
                {x: 5, y: 5}, {x: 21, y: 7}, {x: 11, y: 18},
                {x: 6, y: 5}, {x: 21, y: 8}, {x: 10, y: 18},
                {x: 9, y: 17}, {x: 7, y: 4}, {x: 21, y: 9},
                {x: 10, y: 17}, {x: 7, y: 5}, {x: 20, y: 9},
                {x: 2, y: 6}, {x: 22, y: 5}, {x: 13, y: 20},
                {x: 3, y: 6}, {x: 21, y: 5}, {x: 13, y: 19},
                {x: 2, y: 12}, {x: 16, y: 2}, {x: 19, y: 17},
                {x: 3, y: 12}, {x: 15, y: 2}, {x: 19, y: 16},
                // Edge vegetation fills empty margins without closing approaches.
                {x: 0, y: 10}, {x: 19, y: 1}, {x: 18, y: 20},
                {x: 0, y: 11}, {x: 18, y: 1}, {x: 19, y: 19},
                {x: 5, y: 19}, {x: 7, y: 0}, {x: 25, y: 11},
                // Passable central grove surrounding the shared mine cluster.
                {x: 10, y: 9}, {x: 15, y: 9}, {x: 12, y: 13},
                {x: 10, y: 10}, {x: 14, y: 9}, {x: 13, y: 12},
                {x: 11, y: 9}, {x: 14, y: 10}, {x: 12, y: 12},
                {x: 11, y: 8}, {x: 15, y: 10}, {x: 11, y: 12},
                {x: 9, y: 9}, {x: 15, y: 8}, {x: 13, y: 13},
                {x: 9, y: 10}, {x: 14, y: 8}, {x: 14, y: 13}
            ],
            [],
            {
                type: 'hexagonal',
                // The rectangular backing array contains a complete radius-13 hex.
                center: {q: 37 / 3, r: 19 / 3},
                radius: 13,
                offset: {x: 0, y: 2}
            }
        ),
        new GameMap(
            {x: 25, y: 25},
            [
                {
                    rgb: {r: 208, g: 208, b: 208},
                    towns: [{x: 12, y: 4}, {x: 12, y: 20}, {x: 4, y: 12}, {x: 20, y: 12}]
                },
                {
                    rgb: {r: 255, g: 0, b: 0},
                    towns: [{x: 1, y: 1}]
                },
                {
                    rgb: {r: 51, g: 153, b: 255},
                    towns: [{x: 23, y: 1}]
                },
                {
                    rgb: {r: 0, g: 179, b: 0},
                    towns: [{x: 23, y: 23}]
                },
                {
                    rgb: {r: 112, g: 0, b: 204},
                    towns: [{x: 1, y: 23}]
                }
            ],
            [
                {x: 12, y: 12, income: 75}, {x: 12, y: 24, income: 30}, {x: 12, y: 0, income: 30},
                {x: 0, y: 12, income: 30}, {x: 24, y: 12, income: 30}
            ],
            [
                {x: 12, y: 19}, {x: 11, y: 19}, {x: 10, y: 20}, {x: 13, y: 19}, {x: 14, y: 20},
                {x: 12, y: 5}, {x: 11, y: 4}, {x: 10, y: 4}, {x: 13, y: 4}, {x: 14, y: 4},
                {x: 4, y: 10}, {x: 5, y: 11}, {x: 5, y: 12}, {x: 4, y: 14}, {x: 5, y: 10}, {x: 5, y: 13},
                {x: 20, y: 10}, {x: 19, y: 12}, {x: 19, y: 11}, {x: 20, y: 14}, {x: 19, y: 10}, {x: 19, y: 13},
                // Forested layout: every addition below is one quadrant cell mirrored
                // to (x, y), (24 - x, y), (x, 24 - y), (24 - x, 24 - y).
                {x: 6, y: 3}, {x: 18, y: 3}, {x: 6, y: 21}, {x: 18, y: 21},
                {x: 3, y: 6}, {x: 21, y: 6}, {x: 3, y: 18}, {x: 21, y: 18},
                {x: 7, y: 4}, {x: 17, y: 4}, {x: 7, y: 20}, {x: 17, y: 20},
                {x: 4, y: 7}, {x: 20, y: 7}, {x: 4, y: 17}, {x: 20, y: 17}
            ],
            [{x: 0, y: 0}, {x: 24, y: 0}, {x: 1, y: 11}, {x: 1, y: 12},
                {x: 23, y: 11}, {x: 23, y: 12}, {x: 12, y: 1}, {x: 11, y: 1}, {x: 13, y: 1},
                {x: 12, y: 23}, {x: 11, y: 23}, {x: 13, y: 23},
                {x: 8, y: 8}, {x: 16, y: 8}, {x: 8, y: 16}, {x: 16, y: 16},
                {x: 2, y: 2}, {x: 22, y: 2}, {x: 2, y: 22}, {x: 22, y: 22}
            ],
            [
                {x: 3, y: 3}, {x: 21, y: 3}, {x: 3, y: 21}, {x: 21, y: 21},
                {x: 4, y: 3}, {x: 20, y: 3}, {x: 4, y: 21}, {x: 20, y: 21},
                {x: 3, y: 4}, {x: 21, y: 4}, {x: 3, y: 20}, {x: 21, y: 20},
                {x: 5, y: 3}, {x: 19, y: 3}, {x: 5, y: 21}, {x: 19, y: 21},
                {x: 3, y: 5}, {x: 21, y: 5}, {x: 3, y: 19}, {x: 21, y: 19},
                {x: 5, y: 5}, {x: 19, y: 5}, {x: 5, y: 19}, {x: 19, y: 19},
                {x: 6, y: 5}, {x: 18, y: 5}, {x: 6, y: 19}, {x: 18, y: 19},
                {x: 5, y: 6}, {x: 19, y: 6}, {x: 5, y: 18}, {x: 19, y: 18},
                {x: 8, y: 4}, {x: 16, y: 4}, {x: 8, y: 20}, {x: 16, y: 20},
                {x: 4, y: 8}, {x: 20, y: 8}, {x: 4, y: 16}, {x: 20, y: 16},
                {x: 9, y: 5}, {x: 15, y: 5}, {x: 9, y: 19}, {x: 15, y: 19},
                {x: 5, y: 9}, {x: 19, y: 9}, {x: 5, y: 15}, {x: 19, y: 15},
                {x: 10, y: 6}, {x: 14, y: 6}, {x: 10, y: 18}, {x: 14, y: 18},
                {x: 6, y: 10}, {x: 18, y: 10}, {x: 6, y: 14}, {x: 18, y: 14},
                {x: 7, y: 7}, {x: 17, y: 7}, {x: 7, y: 17}, {x: 17, y: 17},
                {x: 9, y: 8}, {x: 15, y: 8}, {x: 9, y: 16}, {x: 15, y: 16},
                {x: 8, y: 9}, {x: 16, y: 9}, {x: 8, y: 15}, {x: 16, y: 15},
                {x: 10, y: 10}, {x: 14, y: 10}, {x: 10, y: 14}, {x: 14, y: 14},
                {x: 2, y: 7}, {x: 22, y: 7}, {x: 2, y: 17}, {x: 22, y: 17},
                {x: 7, y: 2}, {x: 17, y: 2}, {x: 7, y: 22}, {x: 17, y: 22},
                {x: 1, y: 9}, {x: 23, y: 9}, {x: 1, y: 15}, {x: 23, y: 15},
                {x: 9, y: 1}, {x: 15, y: 1}, {x: 9, y: 23}, {x: 15, y: 23}
            ]
        ),
        // 5 players on a ring, hexagonal radius 16; goldmines: centre 75,
        // a safe 15 and an edge 25 per player.
        new GameMap(
            {x: 33, y: 33},
            [
                {
                    rgb: {r: 208, g: 208, b: 208},
                    towns: [{x: 22, y: 9}, {x: 25, y: 18}, {x: 16, y: 24}, {x: 7, y: 18}, {x: 10, y: 9}]
                },
                {
                    rgb: {r: 255, g: 0, b: 0},
                    towns: [{x: 16, y: 4}]
                },
                {
                    rgb: {r: 98, g: 168, b: 222},
                    towns: [{x: 29, y: 12}]
                },
                {
                    rgb: {r: 60, g: 190, b: 100},
                    towns: [{x: 24, y: 25}]
                },
                {
                    rgb: {r: 230, g: 170, b: 40},
                    towns: [{x: 8, y: 25}]
                },
                {
                    rgb: {r: 0, g: 110, b: 120},
                    towns: [{x: 3, y: 12}]
                }
            ],
            [
                {x: 16, y: 16, income: 75}, {x: 13, y: 7, income: 15}, {x: 25, y: 5, income: 25},
                {x: 25, y: 10, income: 15}, {x: 30, y: 20, income: 25}, {x: 24, y: 22, income: 15},
                {x: 16, y: 29, income: 25}, {x: 12, y: 25, income: 15}, {x: 2, y: 20, income: 25},
                {x: 5, y: 15, income: 15}, {x: 7, y: 5, income: 25}
            ],
            [
                {x: 20, y: 10}, {x: 21, y: 10}, {x: 22, y: 11}, {x: 21, y: 5}, {x: 24, y: 17},
                {x: 24, y: 18}, {x: 23, y: 19}, {x: 29, y: 17}, {x: 17, y: 23}, {x: 16, y: 23},
                {x: 15, y: 23}, {x: 9, y: 19}, {x: 8, y: 18}, {x: 8, y: 17}, {x: 5, y: 21},
                {x: 10, y: 11}, {x: 11, y: 10}, {x: 12, y: 10}, {x: 5, y: 9}
            ],
            [
                {x: 23, y: 7}, {x: 16, y: 14}, {x: 27, y: 19}, {x: 28, y: 19}, {x: 19, y: 15},
                {x: 16, y: 26}, {x: 16, y: 27}, {x: 18, y: 18}, {x: 5, y: 19}, {x: 4, y: 19},
                {x: 14, y: 18}, {x: 9, y: 7}, {x: 13, y: 15}
            ],
            [
                {x: 18, y: 14}, {x: 15, y: 5}, {x: 17, y: 5}, {x: 16, y: 7}, {x: 16, y: 10},
                {x: 17, y: 10}, {x: 15, y: 10}, {x: 17, y: 9}, {x: 16, y: 11}, {x: 14, y: 7},
                {x: 14, y: 8}, {x: 21, y: 3}, {x: 10, y: 4}, {x: 19, y: 6}, {x: 21, y: 6},
                {x: 20, y: 5}, {x: 13, y: 8}, {x: 19, y: 16}, {x: 27, y: 11}, {x: 28, y: 14},
                {x: 26, y: 13}, {x: 22, y: 14}, {x: 23, y: 15}, {x: 22, y: 13}, {x: 23, y: 14},
                {x: 21, y: 13}, {x: 26, y: 12}, {x: 24, y: 12}, {x: 31, y: 16}, {x: 27, y: 7},
                {x: 28, y: 16}, {x: 28, y: 17}, {x: 29, y: 16}, {x: 23, y: 11}, {x: 16, y: 18},
                {x: 24, y: 23}, {x: 22, y: 25}, {x: 22, y: 24}, {x: 20, y: 21}, {x: 19, y: 21},
                {x: 21, y: 20}, {x: 20, y: 22}, {x: 20, y: 20}, {x: 23, y: 21}, {x: 20, y: 28},
                {x: 28, y: 23}, {x: 20, y: 26}, {x: 19, y: 26}, {x: 20, y: 27}, {x: 23, y: 20},
                {x: 13, y: 16}, {x: 10, y: 25}, {x: 8, y: 23}, {x: 10, y: 24}, {x: 12, y: 21},
                {x: 11, y: 20}, {x: 13, y: 21}, {x: 11, y: 21}, {x: 13, y: 20}, {x: 11, y: 24},
                {x: 12, y: 24}, {x: 4, y: 23}, {x: 12, y: 28}, {x: 7, y: 22}, {x: 6, y: 22},
                {x: 5, y: 22}, {x: 12, y: 23}, {x: 13, y: 23}, {x: 14, y: 14}, {x: 4, y: 14},
                {x: 5, y: 11}, {x: 6, y: 13}, {x: 10, y: 14}, {x: 10, y: 13}, {x: 9, y: 15},
                {x: 9, y: 13}, {x: 10, y: 15}, {x: 5, y: 14}, {x: 6, y: 15}, {x: 4, y: 8},
                {x: 1, y: 16}, {x: 6, y: 10}, {x: 7, y: 9}, {x: 6, y: 9}, {x: 7, y: 15},
                {x: 7, y: 16}
            ],
            [],
            {
                type: 'hexagonal',
                center: {q: 16, r: 8},
                radius: 16,
                offset: {x: 0, y: 0}
            }
        ),
        // 6 players on a ring, hexagonal radius 17; goldmines: centre 75,
        // a safe 15, an edge 25 and an inner 20 per player.
        new GameMap(
            {x: 35, y: 35},
            [
                {
                    rgb: {r: 208, g: 208, b: 208},
                    towns: [{x: 22, y: 10}, {x: 27, y: 17}, {x: 22, y: 25}, {x: 12, y: 25}, {x: 7, y: 17}, {x: 12, y: 10}]
                },
                {
                    rgb: {r: 255, g: 0, b: 0},
                    towns: [{x: 17, y: 5}]
                },
                {
                    rgb: {r: 98, g: 168, b: 222},
                    towns: [{x: 29, y: 11}]
                },
                {
                    rgb: {r: 60, g: 190, b: 100},
                    towns: [{x: 29, y: 23}]
                },
                {
                    rgb: {r: 230, g: 170, b: 40},
                    towns: [{x: 17, y: 29}]
                },
                {
                    rgb: {r: 0, g: 110, b: 120},
                    towns: [{x: 5, y: 23}]
                },
                {
                    rgb: {r: 245, g: 120, b: 180},
                    towns: [{x: 5, y: 11}]
                }
            ],
            [
                {x: 17, y: 17, income: 75}, {x: 14, y: 8, income: 15}, {x: 25, y: 5, income: 25},
                {x: 20, y: 14, income: 20}, {x: 25, y: 10, income: 15}, {x: 33, y: 17, income: 25},
                {x: 22, y: 18, income: 20}, {x: 28, y: 20, income: 15}, {x: 25, y: 29, income: 25},
                {x: 19, y: 21, income: 20}, {x: 20, y: 27, income: 15}, {x: 9, y: 29, income: 25},
                {x: 15, y: 21, income: 20}, {x: 9, y: 24, income: 15}, {x: 1, y: 17, income: 25},
                {x: 12, y: 18, income: 20}, {x: 6, y: 15, income: 15}, {x: 9, y: 5, income: 25},
                {x: 14, y: 14, income: 20}
            ],
            [
                {x: 21, y: 10}, {x: 21, y: 11}, {x: 23, y: 11}, {x: 20, y: 6}, {x: 22, y: 6},
                {x: 26, y: 17}, {x: 25, y: 17}, {x: 26, y: 19}, {x: 30, y: 14}, {x: 31, y: 15},
                {x: 22, y: 24}, {x: 21, y: 23}, {x: 20, y: 25}, {x: 27, y: 25}, {x: 26, y: 27},
                {x: 14, y: 25}, {x: 13, y: 23}, {x: 12, y: 24}, {x: 14, y: 29}, {x: 12, y: 29},
                {x: 8, y: 19}, {x: 9, y: 17}, {x: 8, y: 17}, {x: 4, y: 21}, {x: 3, y: 19},
                {x: 11, y: 11}, {x: 13, y: 11}, {x: 13, y: 10}, {x: 7, y: 9}, {x: 8, y: 8}
            ],
            [
                {x: 23, y: 8}, {x: 24, y: 8}, {x: 17, y: 14}, {x: 29, y: 17}, {x: 30, y: 18},
                {x: 20, y: 16}, {x: 23, y: 26}, {x: 23, y: 27}, {x: 20, y: 19}, {x: 11, y: 26},
                {x: 11, y: 27}, {x: 17, y: 20}, {x: 5, y: 17}, {x: 4, y: 18}, {x: 14, y: 19},
                {x: 11, y: 8}, {x: 10, y: 8}, {x: 14, y: 16}
            ],
            [
                {x: 19, y: 15}, {x: 16, y: 7}, {x: 18, y: 7}, {x: 17, y: 7}, {x: 17, y: 11},
                {x: 18, y: 11}, {x: 16, y: 11}, {x: 17, y: 10}, {x: 16, y: 12}, {x: 16, y: 8},
                {x: 15, y: 8}, {x: 21, y: 4}, {x: 12, y: 5}, {x: 20, y: 7}, {x: 21, y: 7},
                {x: 21, y: 6}, {x: 15, y: 9}, {x: 20, y: 18}, {x: 27, y: 11}, {x: 28, y: 13},
                {x: 27, y: 12}, {x: 23, y: 14}, {x: 24, y: 15}, {x: 23, y: 13}, {x: 24, y: 14},
                {x: 22, y: 14}, {x: 26, y: 12}, {x: 25, y: 11}, {x: 32, y: 14}, {x: 27, y: 7},
                {x: 29, y: 14}, {x: 29, y: 15}, {x: 30, y: 15}, {x: 24, y: 12}, {x: 18, y: 20},
                {x: 28, y: 22}, {x: 27, y: 23}, {x: 27, y: 22}, {x: 23, y: 20}, {x: 23, y: 21},
                {x: 24, y: 20}, {x: 24, y: 21}, {x: 23, y: 19}, {x: 27, y: 21}, {x: 27, y: 20},
                {x: 28, y: 27}, {x: 32, y: 20}, {x: 26, y: 25}, {x: 25, y: 25}, {x: 26, y: 26},
                {x: 26, y: 20}, {x: 16, y: 20}, {x: 18, y: 28}, {x: 16, y: 28}, {x: 17, y: 27},
                {x: 17, y: 23}, {x: 16, y: 24}, {x: 18, y: 24}, {x: 17, y: 24}, {x: 18, y: 23},
                {x: 18, y: 27}, {x: 19, y: 26}, {x: 13, y: 30}, {x: 22, y: 30}, {x: 14, y: 28},
                {x: 13, y: 27}, {x: 13, y: 28}, {x: 19, y: 25}, {x: 14, y: 18}, {x: 7, y: 23},
                {x: 6, y: 22}, {x: 7, y: 22}, {x: 11, y: 20}, {x: 10, y: 20}, {x: 11, y: 21},
                {x: 10, y: 21}, {x: 12, y: 21}, {x: 8, y: 23}, {x: 9, y: 23}, {x: 2, y: 21},
                {x: 7, y: 27}, {x: 5, y: 20}, {x: 5, y: 19}, {x: 4, y: 20}, {x: 10, y: 23},
                {x: 15, y: 15}, {x: 6, y: 13}, {x: 7, y: 11}, {x: 7, y: 12}, {x: 11, y: 14},
                {x: 11, y: 13}, {x: 10, y: 15}, {x: 10, y: 14}, {x: 11, y: 15}, {x: 7, y: 13},
                {x: 7, y: 14}, {x: 6, y: 8}, {x: 2, y: 15}, {x: 8, y: 10}, {x: 9, y: 9},
                {x: 8, y: 9}, {x: 8, y: 15}
            ],
            [],
            {
                type: 'hexagonal',
                center: {q: 17, r: 9},
                radius: 17,
                offset: {x: 0, y: 0}
            }
        ),
        // 7 players on a ring, hexagonal radius 19; goldmines: centre 75,
        // a safe 15, an edge 25 and an inner 20 per player.
        new GameMap(
            {x: 39, y: 39},
            [
                {
                    rgb: {r: 208, g: 208, b: 208},
                    towns: [{x: 25, y: 10}, {x: 30, y: 18}, {x: 27, y: 26}, {x: 18, y: 29}, {x: 10, y: 25}, {x: 8, y: 17}, {x: 15, y: 10}]
                },
                {
                    rgb: {r: 255, g: 0, b: 0},
                    towns: [{x: 20, y: 6}]
                },
                {
                    rgb: {r: 98, g: 168, b: 222},
                    towns: [{x: 32, y: 12}]
                },
                {
                    rgb: {r: 60, g: 190, b: 100},
                    towns: [{x: 34, y: 24}]
                },
                {
                    rgb: {r: 230, g: 170, b: 40},
                    towns: [{x: 25, y: 32}]
                },
                {
                    rgb: {r: 0, g: 110, b: 120},
                    towns: [{x: 11, y: 31}]
                },
                {
                    rgb: {r: 245, g: 120, b: 180},
                    towns: [{x: 3, y: 21}]
                },
                {
                    rgb: {r: 100, g: 70, b: 210},
                    towns: [{x: 7, y: 10}]
                }
            ],
            [
                {x: 19, y: 19, income: 75}, {x: 17, y: 8, income: 15}, {x: 28, y: 6, income: 25},
                {x: 22, y: 15, income: 20}, {x: 28, y: 12, income: 15}, {x: 37, y: 17, income: 25},
                {x: 25, y: 18, income: 20}, {x: 32, y: 21, income: 15}, {x: 32, y: 30, income: 25},
                {x: 23, y: 22, income: 20}, {x: 26, y: 29, income: 15}, {x: 18, y: 35, income: 25},
                {x: 19, y: 24, income: 20}, {x: 15, y: 29, income: 15}, {x: 4, y: 28, income: 25},
                {x: 14, y: 22, income: 20}, {x: 7, y: 23, income: 15}, {x: 2, y: 15, income: 25},
                {x: 14, y: 18, income: 20}, {x: 8, y: 14, income: 15}, {x: 12, y: 5, income: 25},
                {x: 17, y: 14, income: 20}
            ],
            [
                {x: 23, y: 11}, {x: 24, y: 12}, {x: 25, y: 12}, {x: 25, y: 7}, {x: 29, y: 17},
                {x: 29, y: 18}, {x: 29, y: 19}, {x: 33, y: 15}, {x: 27, y: 24}, {x: 26, y: 25},
                {x: 26, y: 26}, {x: 32, y: 27}, {x: 19, y: 28}, {x: 18, y: 28}, {x: 17, y: 28},
                {x: 20, y: 33}, {x: 11, y: 25}, {x: 11, y: 24}, {x: 10, y: 24}, {x: 9, y: 29},
                {x: 8, y: 28}, {x: 9, y: 17}, {x: 10, y: 17}, {x: 10, y: 16}, {x: 4, y: 19},
                {x: 14, y: 12}, {x: 15, y: 11}, {x: 16, y: 11}, {x: 12, y: 8}
            ],
            [
                {x: 26, y: 9}, {x: 27, y: 8}, {x: 19, y: 16}, {x: 33, y: 17}, {x: 34, y: 18},
                {x: 22, y: 18}, {x: 29, y: 27}, {x: 30, y: 28}, {x: 22, y: 20}, {x: 18, y: 31},
                {x: 18, y: 32}, {x: 20, y: 22}, {x: 8, y: 26}, {x: 7, y: 26}, {x: 18, y: 22},
                {x: 6, y: 16}, {x: 5, y: 15}, {x: 16, y: 20}, {x: 14, y: 8}, {x: 13, y: 7},
                {x: 17, y: 17}
            ],
            [
                {x: 21, y: 17}, {x: 19, y: 7}, {x: 21, y: 7}, {x: 20, y: 8}, {x: 20, y: 13},
                {x: 21, y: 12}, {x: 19, y: 12}, {x: 20, y: 12}, {x: 19, y: 13}, {x: 19, y: 8},
                {x: 19, y: 9}, {x: 24, y: 5}, {x: 16, y: 5}, {x: 23, y: 7}, {x: 24, y: 8},
                {x: 24, y: 7}, {x: 18, y: 10}, {x: 17, y: 10}, {x: 22, y: 19}, {x: 30, y: 12},
                {x: 31, y: 13}, {x: 30, y: 13}, {x: 25, y: 15}, {x: 26, y: 16}, {x: 25, y: 14},
                {x: 27, y: 15}, {x: 24, y: 16}, {x: 29, y: 12}, {x: 28, y: 13}, {x: 35, y: 14},
                {x: 30, y: 8}, {x: 32, y: 15}, {x: 32, y: 16}, {x: 33, y: 14}, {x: 27, y: 13},
                {x: 26, y: 13}, {x: 21, y: 21}, {x: 33, y: 22}, {x: 32, y: 24}, {x: 32, y: 23},
                {x: 27, y: 21}, {x: 26, y: 22}, {x: 27, y: 20}, {x: 27, y: 22}, {x: 26, y: 21},
                {x: 32, y: 22}, {x: 30, y: 21}, {x: 34, y: 27}, {x: 36, y: 20}, {x: 31, y: 25},
                {x: 31, y: 26}, {x: 32, y: 26}, {x: 30, y: 20}, {x: 19, y: 22}, {x: 25, y: 30},
                {x: 23, y: 31}, {x: 24, y: 30}, {x: 22, y: 26}, {x: 21, y: 26}, {x: 23, y: 25},
                {x: 22, y: 27}, {x: 22, y: 25}, {x: 25, y: 29}, {x: 25, y: 28}, {x: 21, y: 34},
                {x: 29, y: 31}, {x: 21, y: 31}, {x: 20, y: 32}, {x: 21, y: 32}, {x: 24, y: 28},
                {x: 25, y: 27}, {x: 16, y: 21}, {x: 13, y: 30}, {x: 11, y: 29}, {x: 12, y: 30},
                {x: 15, y: 25}, {x: 14, y: 25}, {x: 16, y: 26}, {x: 14, y: 26}, {x: 16, y: 25},
                {x: 13, y: 29}, {x: 15, y: 28}, {x: 7, y: 30}, {x: 15, y: 34}, {x: 10, y: 29},
                {x: 9, y: 27}, {x: 8, y: 29}, {x: 16, y: 28}, {x: 16, y: 19}, {x: 5, y: 22},
                {x: 5, y: 20}, {x: 6, y: 21}, {x: 11, y: 20}, {x: 11, y: 19}, {x: 11, y: 21},
                {x: 10, y: 20}, {x: 12, y: 21}, {x: 6, y: 22}, {x: 8, y: 22}, {x: 2, y: 18},
                {x: 3, y: 25}, {x: 5, y: 18}, {x: 5, y: 17}, {x: 4, y: 18}, {x: 9, y: 22},
                {x: 9, y: 23}, {x: 18, y: 17}, {x: 8, y: 12}, {x: 9, y: 10}, {x: 9, y: 11},
                {x: 13, y: 14}, {x: 14, y: 14}, {x: 13, y: 15}, {x: 13, y: 13}, {x: 14, y: 16},
                {x: 9, y: 12}, {x: 9, y: 13}, {x: 10, y: 7}, {x: 3, y: 12}, {x: 11, y: 9},
                {x: 12, y: 9}, {x: 11, y: 8}, {x: 10, y: 14}, {x: 10, y: 15}
            ],
            [],
            {
                type: 'hexagonal',
                center: {q: 19, r: 10},
                radius: 19,
                offset: {x: 0, y: 0}
            }
        ),
        // 8 players on a ring, hexagonal radius 20; goldmines: centre 75,
        // a safe 15, an edge 25 and an inner 20 per player.
        new GameMap(
            {x: 41, y: 41},
            [
                {
                    rgb: {r: 208, g: 208, b: 208},
                    towns: [{x: 26, y: 11}, {x: 32, y: 17}, {x: 30, y: 25}, {x: 23, y: 30}, {x: 14, y: 29}, {x: 8, y: 23}, {x: 10, y: 15}, {x: 17, y: 9}]
                },
                {
                    rgb: {r: 255, g: 0, b: 0},
                    towns: [{x: 22, y: 5}]
                },
                {
                    rgb: {r: 98, g: 168, b: 222},
                    towns: [{x: 34, y: 11}]
                },
                {
                    rgb: {r: 60, g: 190, b: 100},
                    towns: [{x: 37, y: 21}]
                },
                {
                    rgb: {r: 230, g: 170, b: 40},
                    towns: [{x: 30, y: 32}]
                },
                {
                    rgb: {r: 0, g: 110, b: 120},
                    towns: [{x: 18, y: 35}]
                },
                {
                    rgb: {r: 245, g: 120, b: 180},
                    towns: [{x: 6, y: 29}]
                },
                {
                    rgb: {r: 100, g: 70, b: 210},
                    towns: [{x: 3, y: 18}]
                },
                {
                    rgb: {r: 135, g: 80, b: 35},
                    towns: [{x: 10, y: 8}]
                }
            ],
            [
                {x: 20, y: 20, income: 75}, {x: 20, y: 8, income: 15}, {x: 30, y: 5, income: 25},
                {x: 23, y: 15, income: 20}, {x: 30, y: 11, income: 15}, {x: 39, y: 15, income: 25},
                {x: 26, y: 19, income: 20}, {x: 34, y: 20, income: 15}, {x: 37, y: 28, income: 25},
                {x: 25, y: 22, income: 20}, {x: 30, y: 28, income: 15}, {x: 25, y: 36, income: 25},
                {x: 22, y: 25, income: 20}, {x: 20, y: 32, income: 15}, {x: 10, y: 35, income: 25},
                {x: 17, y: 24, income: 20}, {x: 10, y: 29, income: 15}, {x: 1, y: 24, income: 25},
                {x: 14, y: 21, income: 20}, {x: 6, y: 20, income: 15}, {x: 3, y: 11, income: 25},
                {x: 15, y: 17, income: 20}, {x: 10, y: 12, income: 15}, {x: 15, y: 3, income: 25},
                {x: 18, y: 15, income: 20}
            ],
            [
                {x: 24, y: 12}, {x: 25, y: 12}, {x: 26, y: 13}, {x: 25, y: 6}, {x: 26, y: 7},
                {x: 30, y: 17}, {x: 30, y: 18}, {x: 31, y: 18}, {x: 35, y: 14}, {x: 30, y: 24},
                {x: 29, y: 24}, {x: 29, y: 25}, {x: 35, y: 25}, {x: 24, y: 29}, {x: 23, y: 28},
                {x: 22, y: 29}, {x: 26, y: 33}, {x: 16, y: 28}, {x: 15, y: 27}, {x: 14, y: 27},
                {x: 15, y: 33}, {x: 14, y: 33}, {x: 10, y: 23}, {x: 10, y: 22}, {x: 9, y: 21},
                {x: 5, y: 25}, {x: 10, y: 16}, {x: 11, y: 15}, {x: 11, y: 14}, {x: 5, y: 14},
                {x: 16, y: 11}, {x: 17, y: 11}, {x: 18, y: 11}, {x: 14, y: 7}
            ],
            [
                {x: 27, y: 9}, {x: 28, y: 8}, {x: 20, y: 17}, {x: 34, y: 17}, {x: 35, y: 16},
                {x: 23, y: 18}, {x: 32, y: 26}, {x: 34, y: 27}, {x: 23, y: 20}, {x: 24, y: 32},
                {x: 24, y: 33}, {x: 22, y: 22}, {x: 13, y: 30}, {x: 12, y: 32}, {x: 20, y: 23},
                {x: 6, y: 23}, {x: 5, y: 23}, {x: 17, y: 21}, {x: 8, y: 14}, {x: 6, y: 13},
                {x: 17, y: 19}, {x: 16, y: 8}, {x: 16, y: 7}, {x: 18, y: 18}
            ],
            [
                {x: 22, y: 17}, {x: 21, y: 6}, {x: 23, y: 6}, {x: 22, y: 7}, {x: 21, y: 12},
                {x: 22, y: 13}, {x: 20, y: 13}, {x: 22, y: 12}, {x: 20, y: 14}, {x: 21, y: 7},
                {x: 20, y: 9}, {x: 27, y: 4}, {x: 18, y: 4}, {x: 24, y: 8}, {x: 26, y: 8},
                {x: 25, y: 7}, {x: 20, y: 10}, {x: 19, y: 10}, {x: 23, y: 19}, {x: 32, y: 11},
                {x: 33, y: 12}, {x: 32, y: 12}, {x: 27, y: 15}, {x: 27, y: 16}, {x: 26, y: 15},
                {x: 28, y: 15}, {x: 25, y: 15}, {x: 30, y: 12}, {x: 29, y: 12}, {x: 37, y: 13},
                {x: 32, y: 7}, {x: 33, y: 14}, {x: 34, y: 15}, {x: 34, y: 14}, {x: 28, y: 13},
                {x: 27, y: 12}, {x: 23, y: 21}, {x: 36, y: 21}, {x: 35, y: 22}, {x: 35, y: 21},
                {x: 28, y: 21}, {x: 28, y: 22}, {x: 28, y: 20}, {x: 29, y: 21}, {x: 27, y: 20},
                {x: 34, y: 21}, {x: 33, y: 20}, {x: 38, y: 26}, {x: 39, y: 18}, {x: 34, y: 24},
                {x: 34, y: 25}, {x: 35, y: 24}, {x: 31, y: 20}, {x: 31, y: 19}, {x: 21, y: 22},
                {x: 30, y: 30}, {x: 29, y: 31}, {x: 29, y: 30}, {x: 25, y: 25}, {x: 24, y: 26},
                {x: 26, y: 25}, {x: 25, y: 26}, {x: 25, y: 24}, {x: 29, y: 29}, {x: 29, y: 28},
                {x: 28, y: 35}, {x: 35, y: 30}, {x: 27, y: 31}, {x: 26, y: 32}, {x: 27, y: 32},
                {x: 28, y: 27}, {x: 29, y: 26}, {x: 18, y: 23}, {x: 19, y: 33}, {x: 17, y: 33},
                {x: 18, y: 33}, {x: 19, y: 27}, {x: 18, y: 27}, {x: 20, y: 27}, {x: 18, y: 28},
                {x: 20, y: 26}, {x: 19, y: 32}, {x: 20, y: 31}, {x: 13, y: 35}, {x: 22, y: 36},
                {x: 16, y: 32}, {x: 14, y: 32}, {x: 15, y: 32}, {x: 20, y: 30}, {x: 21, y: 29},
                {x: 17, y: 20}, {x: 8, y: 29}, {x: 7, y: 27}, {x: 8, y: 28}, {x: 13, y: 24},
                {x: 13, y: 23}, {x: 14, y: 25}, {x: 12, y: 25}, {x: 15, y: 24}, {x: 10, y: 28},
                {x: 11, y: 27}, {x: 3, y: 26}, {x: 8, y: 33}, {x: 7, y: 25}, {x: 6, y: 25},
                {x: 6, y: 26}, {x: 12, y: 27}, {x: 13, y: 27}, {x: 17, y: 18}, {x: 4, y: 19},
                {x: 5, y: 17}, {x: 5, y: 18}, {x: 12, y: 19}, {x: 12, y: 18}, {x: 12, y: 20},
                {x: 11, y: 18}, {x: 13, y: 19}, {x: 6, y: 19}, {x: 7, y: 19}, {x: 2, y: 14},
                {x: 1, y: 21}, {x: 6, y: 16}, {x: 6, y: 15}, {x: 5, y: 15}, {x: 9, y: 19},
                {x: 9, y: 20}, {x: 19, y: 17}, {x: 10, y: 10}, {x: 11, y: 8}, {x: 11, y: 9},
                {x: 15, y: 14}, {x: 16, y: 14}, {x: 14, y: 15}, {x: 15, y: 13}, {x: 15, y: 15},
                {x: 11, y: 10}, {x: 11, y: 11}, {x: 12, y: 5}, {x: 5, y: 9}, {x: 13, y: 8},
                {x: 14, y: 8}, {x: 13, y: 7}, {x: 12, y: 13}, {x: 11, y: 13}
            ],
            [],
            {
                type: 'hexagonal',
                center: {q: 20, r: 10},
                radius: 20,
                offset: {x: 0, y: 0}
            }
        )
    ],
    "tiny deathmatch":
    [
        new GameMap(
            {x: 20, y: 10},
            [
                {
                    rgb: {r: 208, g: 208, b: 208},
                    towns: [{x: 4, y: 9}, {x: 15, y: 0}]
                },
                {
                    rgb: {r: 255, g: 0, b: 0},
                    towns: [{x: 1, y: 1}]
                },
                {
                    rgb: {r: 98, g: 168, b: 222},
                    towns: [{x: 18, y: 8}]
                }
            ],
            [],
            coordDictionary([[10, 4], [9, 5]]),
            coordDictionary([[4, 7], [3, 7], [2, 8], [1, 8], [5, 6],
                            [14, 3], [15, 2], [16, 2], [17, 1], [18, 1]])
        )
    ],
    "stationary warfare":
    [
        new GameMap(
            {x: 21, y: 21},
            [
                {
                    rgb: {r: 208, g: 208, b: 208},
                    towns: [{x: 10, y: 19},
                        {x: 10, y: 10}, {x: 10, y: 1}]
                },
                {
                    rgb: {r: 255, g: 0, b: 0},
                    towns: [{x: 1, y: 10}]
                },
                {
                    rgb: {r: 98, g: 168, b: 222},
                    towns: [{x: 19, y: 10}]
                }
            ],
            [{x: 3, y: 10, income: 10}, {x: 17, y: 10, income: 10},
             {x: 7, y: 1, income: 10}, {x: 13, y: 1, income: 10},
             {x: 3, y: 6, income: 10}, {x: 17, y: 6, income: 10},
             {x: 10, y: 7, income: 10},
             {x: 10, y: 12, income: 10},
             {x: 6, y: 14, income: 10}, {x: 14, y: 14, income: 10},
             {x: 10, y: 15, income: 10}, {x: 3, y: 19, income: 10},
             {x: 17, y: 19, income: 10}, {x: 5, y: 16, income: 10},
             {x: 15, y: 16, income: 10}],
            [{x: 10, y: 5}, {x: 9, y: 16}, {x: 10, y: 16}, {x: 11, y: 16},
             {x: 16, y: 7}, {x: 17, y: 7}, {x: 18, y: 7}, {x: 18, y: 6},
             {x: 2, y: 6}, {x: 2, y: 7}, {x: 3, y: 7}, {x: 4, y: 7}],
            [
             {x: 8, y: 9}, {x: 9, y: 8}, {x: 10, y: 8}, {x: 11, y: 8},
             {x: 12, y: 9},
             {x: 7, y: 9}, {x: 13, y: 9},
             {x: 6, y: 15}, {x: 6, y: 16}, {x: 7, y: 16},
             {x: 14, y: 15}, {x: 14, y: 16}, {x: 13, y: 16}],
             [{"x":16,"y":7},{"x":7,"y":17},{"x":13,"y":17},{"x":7,"y":18},{"x":13,"y":18},{"x":7,"y":19},{"x":13,"y":19},{"x":7,"y":20},{"x":13,"y":20},{"x":5,"y":0},{"x":15,"y":0},{"x":5,"y":1},{"x":15,"y":1},{"x":5,"y":2},{"x":15,"y":2},{"x":6,"y":3},{"x":14,"y":3},{"x":7,"y":3},{"x":13,"y":3},{"x":7,"y":4},{"x":13,"y":4},{"x":8,"y":5},{"x":12,"y":5},{"x":8,"y":6},{"x":12,"y":6},{"x":8,"y":7},{"x":12,"y":7},{"x":8,"y":8},{"x":12,"y":8},{"x":8,"y":4},{"x":12,"y":4},{"x":6,"y":4},{"x":14,"y":4}]
        )
    ],
    "two rivers":
    [
        new GameMap(
            {x: 21, y: 23},
            [
                {
                    rgb: {r: 208, g: 208, b: 208},
                    towns: [{x: 10, y: 2}, {x: 6, y: 20}, {x: 14, y: 20}]
                },
                {
                    rgb: {r: 255, g: 0, b: 0},
                    towns: [{x: 3, y: 11}]
                },
                {
                    rgb: {r: 98, g: 168, b: 222},
                    towns: [{x: 17, y: 11}]
                }
            ],
            [
             {x: 10, y: 13, income: 10},  {x: 10, y: 10, income: 10},
             {x: 10, y: 4, income: 10}, {x: 10, y: 7, income: 10},
             {x: 10, y: 17, income: 10}, {x: 4, y: 2, income: 10},
             {x: 16, y: 2, income: 10}
             ],
            [
             {x: 7, y: 6}, {x: 7, y: 7}, {x: 7, y: 8}, {x: 7, y: 9}, {x: 7, y: 10},
             {x: 7, y: 11}, {x: 7, y: 12}, {x: 7, y: 13}, {x: 7, y: 14}, {x: 7, y: 15},
             {x: 13, y: 6}, {x: 13, y: 7}, {x: 13, y: 8}, {x: 13, y: 9}, {x: 13, y: 10},
             {x: 13, y: 11}, {x: 13, y: 12}, {x: 13, y: 13}, {x: 13, y: 14}, {x: 13, y: 15},
             {x: 3, y: 2}, {x: 4, y: 3}, {x: 16, y: 3}, {x: 17, y: 2}
            ],
            [{x: 2, y: 7}, {x: 3, y: 7}, {x: 4, y: 7},
             {x: 16, y: 7}, {x: 17, y: 7}, {x: 18, y: 7},
             {x: 16, y: 16}, {x: 16, y: 17}, {x: 17, y: 17},
             {x: 4, y: 16}, {x: 4, y: 17}, {x: 3, y: 17}],
             [{"x":0,"y":15},{"x":20,"y":15},{"x":1,"y":15},{"x":19,"y":15},{"x":2,"y":15},{"x":18,"y":15},{"x":3,"y":15},{"x":17,"y":15},{"x":8,"y":4},{"x":12,"y":4},{"x":9,"y":4},{"x":11,"y":4},{"x":10,"y":5},{"x":7,"y":3},{"x":13,"y":3},{"x":19,"y":6},{"x":1,"y":6},{"x":20,"y":7},{"x":0,"y":7},{"x":12,"y":17},{"x":8,"y":17},{"x":13,"y":17},{"x":7,"y":17},{"x":14,"y":17},{"x":6,"y":17},{"x":12,"y":16},{"x":8,"y":16},{"x":1,"y":3},{"x":19,"y":3},{"x":2,"y":4},{"x":18,"y":4},{"x":3,"y":3},{"x":17,"y":3},{"x":2,"y":3},{"x":18,"y":3},{"x":17,"y":19},{"x":3,"y":19},{"x":17,"y":20},{"x":3,"y":20},{"x":17,"y":18},{"x":3,"y":18}]
        ),
    ],
    "mountain wall":
    [
        new GameMap(
            {x: 21, y: 23},
            [
                {
                    rgb: {r: 208, g: 208, b: 208},
                    towns: [{x: 10, y: 10}, {x: 10, y: 4},
                        {x: 7, y: 17}, {x: 13, y: 17}]
                },
                {
                    rgb: {r: 255, g: 0, b: 0},
                    towns: [{x: 2, y: 8}, {x: 2, y: 14}]
                },
                {
                    rgb: {r: 98, g: 168, b: 222},
                    towns: [{x: 18, y: 8}, {x: 18, y: 14}]
                }
            ],
            [
                {x: 5, y: 20, income: 10},
                {x: 15, y: 20, income: 10},
                {x: 10, y: 21, income: 10},
                {x: 4, y: 2, income: 10}, {x: 16, y: 2, income: 10},
                {x: 10, y: 0, income: 10},
             ],
            [
                {x: 7, y: 3}, {x: 13, y: 3},

                {x: 8, y: 18}, {x: 9, y: 18},
                {x: 12, y: 18}, {x: 11, y: 18},
                {x: 6, y: 17}, {x: 14, y: 17},
                {x: 10, y: 19},
                {x: 4, y: 20}, {x: 5, y: 19},
                {x: 16, y: 20}, {x: 15, y: 19},
                {x: 10, y: 1},
            ],
            [{x: 0, y: 11}, {x: 1, y: 11}, {x: 2, y: 11},
             {x: 3, y: 11}, {x: 4, y: 11}, {x: 5, y: 11},
             {x: 6, y: 11}, {x: 7, y: 11}, {x: 8, y: 11},
             {x: 9, y: 11},
             {x: 11, y: 11}, {x: 12, y: 11}, {x: 13, y: 11},
             {x: 14, y: 11}, {x: 15, y: 11}, {x: 16, y: 11},
             {x: 17, y: 11}, {x: 18, y: 11}, {x: 19, y: 11},
             {x: 20, y: 11},

             {x: 10, y: 6}, {x: 10, y: 7}, {x: 10, y: 8},

             {x: 0, y: 0}, {x: 20, y: 0},

             {x: 5, y: 14}, {x: 5, y: 15},
             {x: 15, y: 14}, {x: 15, y: 15},
             {x: 10, y: 12}, {x: 10, y: 5},
             {x: 5, y: 16}, {x: 15, y: 16},
             {x: 10, y: 3},
             {x: 6, y: 5}, {x: 6, y: 6}, {x: 7, y: 6},
             {x: 14, y: 5}, {x: 14, y: 6}, {x: 13, y: 6},
             {x: 8, y: 2}, {x: 12, y: 2},
             {x: 6, y: 1}, {x: 14, y: 1},
             {x: 3, y: 1}, {x: 3, y: 2}, {x: 3, y: 3},
             {x: 17, y: 1}, {x: 17, y: 2}, {x: 17, y: 3},
            ],
            [{"x":10,"y":13},{"x":10,"y":14},{"x":10,"y":15},{"x":4,"y":17},{"x":16,"y":17},{"x":3,"y":17},{"x":17,"y":17},{"x":2,"y":18},{"x":18,"y":18},{"x":2,"y":17},{"x":18,"y":17},{"x":1,"y":17},{"x":19,"y":17},{"x":0,"y":17},{"x":20,"y":17},{"x":0,"y":16},{"x":20,"y":16},{"x":1,"y":16},{"x":19,"y":16},{"x":12,"y":20},{"x":8,"y":20},{"x":12,"y":21},{"x":8,"y":21},{"x":11,"y":8},{"x":9,"y":8},{"x":12,"y":9},{"x":8,"y":9},{"x":12,"y":10},{"x":8,"y":10},{"x":3,"y":0},{"x":17,"y":0},{"x":3,"y":4},{"x":17,"y":4},{"x":4,"y":5},{"x":16,"y":5},{"x":5,"y":5},{"x":15,"y":5},{"x":0,"y":4},{"x":20,"y":4},{"x":1,"y":4},{"x":19,"y":4},{"x":2,"y":4},{"x":18,"y":4}]
        )
    ],
    "two in one":
    [
        new GameMap(
            {x: 21, y: 23},
            [
                {
                    rgb: {r: 208, g: 208, b: 208},
                    towns: [{x: 6, y: 7}, {x: 14, y: 7},
                        {x: 10, y: 16}, {x: 10, y: 21}]
                },
                {
                    rgb: {r: 255, g: 0, b: 0},
                    towns: [{x: 1, y: 1}, {x: 2, y: 18}]
                },
                {
                    rgb: {r: 98, g: 168, b: 222},
                    towns: [{x: 19, y: 1}, {x: 18, y: 18}]
                }
            ],
            [
                {x: 8, y: 2, income: 10},
                {x: 12, y: 2, income: 10},
                {x: 10, y: 9, income: 10},
                {x: 5, y: 13, income: 10},
                {x: 15, y: 13, income: 10},
                {x: 10, y: 19, income: 10},
             ],
            [
                {x: 10, y: 2},
                {x: 6, y: 2}, {x: 14, y: 2},
                {x: 7, y: 3}, {x: 13, y: 3},
                {x: 10, y: 4},
                {x: 8, y: 0}, {x: 12, y: 0},
                {x: 8, y: 5}, {x: 12, y: 5},
                {x: 5, y: 0}, {x: 15, y: 0},

                {x: 6, y: 19}, {x: 7, y: 18}, {x: 8, y: 18}, {x: 9, y: 18},
                {x: 14, y: 19}, {x: 13, y: 18}, {x: 12, y: 18}, {x: 11, y: 18},
            ],
            [{x: 0, y: 11}, {x: 1, y: 11}, {x: 2, y: 11},
             {x: 3, y: 11}, {x: 4, y: 11}, {x: 5, y: 11},
             {x: 6, y: 11}, {x: 7, y: 11}, {x: 8, y: 11},
             {x: 9, y: 11},
             {x: 11, y: 11}, {x: 12, y: 11}, {x: 13, y: 11},
             {x: 14, y: 11}, {x: 15, y: 11}, {x: 16, y: 11},
             {x: 17, y: 11}, {x: 18, y: 11}, {x: 19, y: 11},
             {x: 20, y: 11},

             {x: 10, y: 6}, {x: 10, y: 7}, {x: 10, y: 8},

             {x: 1, y: 5}, {x: 2, y: 5}, {x: 3, y: 5},
             {x: 17, y: 5}, {x: 18, y: 5}, {x: 19, y: 5},

             {x: 0, y: 0}, {x: 20, y: 0},

             {x: 5, y: 14}, {x: 5, y: 15},
             {x: 15, y: 14}, {x: 15, y: 15},
            ],
            [{"x":8,"y":9},{"x":12,"y":9},{"x":8,"y":10},{"x":12,"y":10},{"x":1,"y":7},{"x":19,"y":7},{"x":2,"y":7},{"x":18,"y":7},{"x":3,"y":7},{"x":17,"y":7},{"x":0,"y":7},{"x":20,"y":7},{"x":15,"y":16},{"x":5,"y":16},{"x":14,"y":17},{"x":6,"y":17},{"x":14,"y":18},{"x":6,"y":18},{"x":4,"y":15},{"x":16,"y":15},{"x":3,"y":14},{"x":17,"y":14},{"x":2,"y":15},{"x":18,"y":15},{"x":1,"y":14},{"x":19,"y":14},{"x":6,"y":21},{"x":14,"y":21},{"x":7,"y":20},{"x":13,"y":20},{"x":7,"y":21},{"x":13,"y":21}]
        )
    ],
    "tower defense":
    [
        new GameMap(
            {x: 21, y: 23},
            [
                {
                    rgb: {r: 208, g: 208, b: 208},
                    towns: [{x: 10, y: 3}, {x: 6, y: 19}, {x: 14, y: 19}]
                },
                {
                    rgb: {r: 255, g: 0, b: 0},
                    towns: [{x: 3, y: 11}]
                },
                {
                    rgb: {r: 98, g: 168, b: 222},
                    towns: [{x: 17, y: 11}]
                }
            ],
            [
             {x: 10, y: 9, income: 10}, {x: 10, y: 14, income: 10},
             {x: 1, y: 21, income: 10}, {x: 19, y: 21, income: 10},
             {x: 5, y: 2, income: 10}, {x: 15, y: 2, income: 10},
             {x: 1, y: 4, income: 10}, {x: 19, y: 4, income: 10},
             {x: 10, y: 6, income: 10}, {x: 10, y: 22, income: 10},
             ],
            [{x: 7, y: 10}, {x: 7, y: 11}, {x: 7, y: 12}, {x: 8, y: 10},
             {x: 9, y: 9}, {x: 8, y: 13}, {x: 9, y: 13},
             {x: 11, y: 9}, {x: 12, y: 10}, {x: 13, y: 10}, {x: 13, y: 11},
             {x: 13, y: 12}, {x: 12, y: 13}, {x: 11, y: 13},
             {x: 10, y: 16},
             {x: 5, y: 3}, {x: 6, y: 3}, {x: 6, y: 2},
             {x: 14, y: 3}, {x: 15, y: 3}, {x: 14, y: 2},
             {x: 3, y: 2}, {x: 17, y: 2},
             {x: 4, y: 15}, {x: 16, y: 15},
             {x: 3, y: 16}, {x: 17, y: 16}
            ],
            [{x: 7, y: 5}, {x: 8, y: 6}, {x: 9, y: 6}, {x: 10, y: 7},
             {x: 11, y: 6}, {x: 12, y: 6}, {x: 13, y: 5},
             {x: 2, y: 7}, {x: 3, y: 7}, {x: 4, y: 7},
             {x: 16, y: 7}, {x: 17, y: 7}, {x: 18, y: 7},
             {x: 16, y: 16}, {x: 17, y: 17},
             {x: 4, y: 16}, {x: 3, y: 17},

             {x: 9, y: 17}, {x: 9, y: 18}, {x: 11, y: 17}, {x: 11, y: 18},
             ],
             [{"x":10,"y":3},{"x":3,"y":4},{"x":17,"y":4},{"x":4,"y":4},{"x":16,"y":4},{"x":4,"y":5},{"x":16,"y":5},{"x":5,"y":4},{"x":15,"y":4},{"x":7,"y":19},{"x":13,"y":19},{"x":2,"y":8},{"x":18,"y":8},{"x":1,"y":8},{"x":19,"y":8},{"x":0,"y":9},{"x":20,"y":9},{"x":0,"y":18},{"x":20,"y":18},{"x":1,"y":18},{"x":19,"y":18},{"x":2,"y":18},{"x":18,"y":18},{"x":9,"y":19},{"x":11,"y":19},{"x":10,"y":20},{"x":9,"y":16},{"x":11,"y":16},{"x":10,"y":17},{"x":10,"y":21},{"x":9,"y":21},{"x":11,"y":21},{"x":9,"y":22},{"x":11,"y":22},{"x":8,"y":21},{"x":12,"y":21},{"x":6,"y":21},{"x":14,"y":21},{"x":7,"y":21},{"x":13,"y":21},{"x":5,"y":20},{"x":15,"y":20},{"x":4,"y":21},{"x":16,"y":21},{"x":3,"y":20},{"x":17,"y":20},{"x":2,"y":20},{"x":18,"y":20},{"x":2,"y":19},{"x":18,"y":19},{"x":7,"y":14},{"x":13,"y":14},{"x":8,"y":15},{"x":12,"y":15},{"x":7,"y":15},{"x":13,"y":15},{"x":5,"y":7},{"x":15,"y":7},{"x":5,"y":8},{"x":15,"y":8},{"x":6,"y":9},{"x":14,"y":9},{"x":8,"y":3},{"x":12,"y":3},{"x":8,"y":4},{"x":12,"y":4},{"x":7,"y":4},{"x":13,"y":4},{"x":4,"y":8},{"x":16,"y":8}]
        )
    ],
    "capture rush": [
        new GameMap(
            {x: 21, y: 21},
            [
                {
                    rgb: {r: 208, g: 208, b: 208},
                    towns: [{x: 10, y: 19},
                        {x: 19, y: 16}, {x: 1, y: 16}]
                },
                {
                    rgb: {r: 255, g: 0, b: 0},
                    towns: [{x: 2, y: 2}]
                },
                {
                    rgb: {r: 98, g: 168, b: 222},
                    towns: [{x: 18, y: 2}]
                }
            ],
            [{x: 3, y: 10, income: 10}, {x: 17, y: 10, income: 10},
             {x: 7, y: 1, income: 10}, {x: 13, y: 1, income: 10},
             {x: 3, y: 6, income: 10}, {x: 17, y: 6, income: 10},
             {x: 10, y: 7, income: 10},
             {x: 10, y: 11, income: 10},
             {x: 6, y: 14, income: 10}, {x: 14, y: 14, income: 10},
             {x: 10, y: 15, income: 10}],
            [{x: 10, y: 5}, {x: 10, y: 12}],
            [{x: 0, y: 9}, {x: 1, y: 8}, {x: 2, y: 8}, {x: 3, y: 7},
             {x: 4, y: 8}, {x: 5, y: 8},
             {x: 20, y: 9}, {x: 19, y: 8}, {x: 18, y: 8}, {x: 17, y: 7},
             {x: 16, y: 8}, {x: 15, y: 8},
             {x: 8, y: 9}, {x: 9, y: 8}, {x: 10, y: 8}, {x: 11, y: 8},
             {x: 12, y: 9},
             {x: 7, y: 9}, {x: 13, y: 9},
             {x: 6, y: 15}, {x: 6, y: 16}, {x: 7, y: 16},
             {x: 14, y: 15}, {x: 14, y: 16}, {x: 13, y: 16}],
             [{"x":8,"y":11},{"x":12,"y":11},{"x":8,"y":12},{"x":12,"y":12},{"x":8,"y":13},{"x":12,"y":13},{"x":6,"y":17},{"x":14,"y":17},{"x":5,"y":17},{"x":15,"y":17},{"x":5,"y":18},{"x":15,"y":18},{"x":4,"y":19},{"x":16,"y":19},{"x":6,"y":5},{"x":14,"y":5},{"x":7,"y":4},{"x":13,"y":4},{"x":8,"y":4},{"x":12,"y":4},{"x":8,"y":3},{"x":12,"y":3},{"x":9,"y":2},{"x":11,"y":2},{"x":9,"y":1},{"x":11,"y":1},{"x":9,"y":0},{"x":11,"y":0},{"x":14,"y":1},{"x":6,"y":1},{"x":14,"y":2},{"x":6,"y":2}]
        )
    ],
    "strategic war":
    [
        new GameMap(
            {x: 21, y: 21},
            [
                {
                    rgb: {r: 208, g: 208, b: 208},
                    towns: [{x: 10, y: 17}]
                },
                {
                    rgb: {r: 255, g: 0, b: 0},
                    towns: [{x: 4, y: 11}, {x: 19, y: 1}]
                },
                {
                    rgb: {r: 98, g: 168, b: 222},
                    towns: [{x: 16, y: 11}, {x: 1, y: 1}]
                }
            ],
            [{x: 10, y: 1, income: 10},
             {x: 7, y: 3, income: 10}, {x: 13, y: 3, income: 10},
             {x: 1, y: 6, income: 10}, {x: 19, y: 6, income: 10},
             {x: 14, y: 19, income: 10}, {x: 6, y: 19, income: 10},
             {x: 2, y: 16, income: 10}, {x: 18, y: 16, income: 10},
             {x: 10, y: 7, income: 10},
             ],
            [{x: 10, y: 9}, {x: 10, y: 10}, {x: 10, y: 11}, {x: 10, y: 12}, {x: 10, y: 13}],
            [{x: 3, y: 6}, {x: 4, y: 7}, {x: 5, y: 6},
             {x: 15, y: 6}, {x: 16, y: 7}, {x: 17, y: 6}],
             [{"x":4,"y":14},{"x":16,"y":14},{"x":5,"y":14},{"x":15,"y":14},{"x":6,"y":15},{"x":14,"y":15},{"x":7,"y":14},{"x":13,"y":14},{"x":8,"y":15},{"x":12,"y":15},{"x":9,"y":14},{"x":11,"y":14},{"x":10,"y":15},{"x":12,"y":14},{"x":8,"y":14},{"x":13,"y":13},{"x":7,"y":13},{"x":13,"y":12},{"x":7,"y":12},{"x":3,"y":7},{"x":17,"y":7},{"x":2,"y":8},{"x":18,"y":8},{"x":0,"y":9},{"x":20,"y":9},{"x":1,"y":8},{"x":19,"y":8},{"x":10,"y":3},{"x":10,"y":4},{"x":10,"y":5},{"x":7,"y":0},{"x":13,"y":0},{"x":7,"y":1},{"x":13,"y":1},{"x":6,"y":7},{"x":14,"y":7},{"x":7,"y":7},{"x":13,"y":7}]
        )
    ],
    "reinforcement":
    [
        new GameMap(
            {x: 21, y: 23},
            [
                {
                    rgb: {r: 208, g: 208, b: 208},
                    towns: [{x: 5, y: 17}, {x: 15, y: 17}, {x: 10, y: 21}]
                },
                {
                    rgb: {r: 255, g: 0, b: 0},
                    towns: [{x: 5, y: 11}, {x: 3, y: 4}]
                },
                {
                    rgb: {r: 98, g: 168, b: 222},
                    towns: [{x: 15, y: 11}, {x: 17, y: 4}]
                }
            ],
            [
                {x: 10, y: 9, income: 10},
                {x: 10, y: 15, income: 10},
                {x: 10, y: 3, income: 10}, {x: 10, y: 5, income: 10},
                {x: 10, y: 12, income: 10}, {x: 6, y: 22, income: 10},
                {x: 14, y: 22, income: 10},
             ],
            [
                {x: 10, y: 4}, {x: 10, y: 2}, {x: 10, y: 6},
                {x: 8, y: 6},
                {x: 8, y: 2}, {x: 9, y: 0}, {x: 11, y: 0},
                {x: 12, y: 2}, {x: 12, y: 6},
                {x: 5, y: 21}, {x: 6, y: 21},
                {x: 14, y: 21}, {x: 15, y: 21}
            ],
            [
                {x: 3, y: 10}, {x: 4, y: 10}, {x: 5, y: 9}, {x: 6, y: 9},
                {x: 7, y: 8}, {x: 8, y: 8}, {x: 9, y: 7}, {x: 10, y: 8},
                {x: 3, y: 11}, {x: 3, y: 12}, {x: 4, y: 13}, {x: 5, y: 13},
                {x: 6, y: 14}, {x: 7, y: 14}, {x: 8, y: 15}, {x: 9, y: 15},
                {x: 10, y: 16}, {x: 11, y: 15}, {x: 12, y: 15},
                {x: 13, y: 14}, {x: 14, y: 14}, {x: 15, y: 13},
                {x: 16, y: 13}, {x: 17, y: 12}, {x: 17, y: 11},
                {x: 17, y: 10}, {x: 16, y: 10}, {x: 15, y: 9},
                {x: 14, y: 9}, {x: 13, y: 8}, {x: 12, y: 8},
                {x: 11, y: 7},
                {x: 7, y: 3}, {x: 7, y: 4}, {x: 13, y: 3},
                {x: 13, y: 4},
                {x: 10, y: 18}, {x: 10, y: 19}
            ],
            [{"x":7,"y":5},{"x":13,"y":5},{"x":12,"y":11},{"x":8,"y":11},{"x":12,"y":12},{"x":8,"y":12},{"x":12,"y":13},{"x":8,"y":13},{"x":10,"y":17},{"x":1,"y":7},{"x":19,"y":7},{"x":2,"y":8},{"x":18,"y":8},{"x":0,"y":7},{"x":20,"y":7},{"x":3,"y":8},{"x":17,"y":8},{"x":5,"y":0},{"x":15,"y":0},{"x":5,"y":1},{"x":15,"y":1},{"x":6,"y":2},{"x":14,"y":2},{"x":4,"y":1},{"x":16,"y":1},{"x":3,"y":1},{"x":17,"y":1},{"x":2,"y":1},{"x":18,"y":1},{"x":1,"y":0},{"x":19,"y":0},{"x":3,"y":0},{"x":17,"y":0},{"x":2,"y":0},{"x":18,"y":0},{"x":2,"y":19},{"x":18,"y":19},{"x":2,"y":15},{"x":18,"y":15}]
        )
    ],
    "rush or defend":
    [
        new GameMap(
            {x: 21, y: 23},
            [
                {
                    rgb: {r: 208, g: 208, b: 208},
                    towns: [{x: 10, y: 6}, {x: 17, y: 19}, {x: 3, y: 19}, {x: 10, y: 18}]
                },
                {
                    rgb: {r: 255, g: 0, b: 0},
                    towns: [{x: 3, y: 11}]
                },
                {
                    rgb: {r: 98, g: 168, b: 222},
                    towns: [{x: 17, y: 11}]
                }
            ],
            [ {x: 9, y: 11, income: 10}, {x: 11, y: 11, income: 10},
              {x: 3, y: 2, income: 10}, {x: 17, y: 2, income: 10},
              {x: 8, y: 2, income: 10}, {x: 12, y: 2, income: 10}

             ],
            [{x: 9, y: 13}, {x: 10, y: 13}, {x: 11, y: 13},
             {x: 9, y: 9}, {x: 10, y: 9}, {x: 11, y: 9},

             {x: 7, y: 18}, {x: 7, y: 19}, {x: 8, y: 20},
             {x: 13, y: 18}, {x: 13, y: 19}, {x: 12, y: 20},

             {x: 4, y: 3}, {x: 3, y: 3},
             {x: 17, y: 3}, {x: 16, y: 3},

             {x: 9, y: 1}, {x: 9, y: 2}, {x: 8, y: 3},
             {x: 11, y: 1}, {x: 11, y: 2}, {x: 12, y: 3},

             {x: 2, y: 3}, {x: 18, y: 3},
            ],
            [{x: 7, y: 5}, {x: 13, y: 5},
             {x: 2, y: 7}, {x: 3, y: 7}, {x: 4, y: 7},
             {x: 16, y: 7}, {x: 17, y: 7}, {x: 18, y: 7},


             {x: 13, y: 10}, {x: 13, y: 11}, {x: 13, y: 12},
             {x: 7, y: 10}, {x: 7, y: 11}, {x: 7, y: 12},

             {x: 5, y: 14}, {x: 4, y: 15}, {x: 4, y: 16},
             {x: 5, y: 16},

             {x: 15, y: 14}, {x: 16, y: 15}, {x: 16, y: 16},
             {x: 15, y: 16},
            ],
            [{"x":8,"y":15},{"x":12,"y":15},{"x":7,"y":15},{"x":13,"y":15},{"x":9,"y":15},{"x":11,"y":15},{"x":10,"y":15},{"x":18,"y":8},{"x":2,"y":8},{"x":19,"y":8},{"x":1,"y":8},{"x":20,"y":9},{"x":0,"y":9},{"x":5,"y":4},{"x":15,"y":4},{"x":4,"y":5},{"x":16,"y":5},{"x":1,"y":7},{"x":19,"y":7},{"x":1,"y":6},{"x":19,"y":6},{"x":1,"y":5},{"x":19,"y":5},{"x":0,"y":5},{"x":20,"y":5},{"x":0,"y":6},{"x":20,"y":6},{"x":0,"y":7},{"x":20,"y":7},{"x":0,"y":8},{"x":20,"y":8},{"x":0,"y":1},{"x":20,"y":1},{"x":1,"y":0},{"x":19,"y":0},{"x":0,"y":0},{"x":20,"y":0},{"x":0,"y":16},{"x":20,"y":16},{"x":1,"y":15},{"x":19,"y":15},{"x":2,"y":16},{"x":18,"y":16},{"x":3,"y":15},{"x":17,"y":15}]
        )
    ],
    "sneak attack":
    [
        new GameMap(
            {x: 21, y: 23},
            [
                {
                    rgb: {r: 208, g: 208, b: 208},
                    towns: [{x: 10, y: 19}, {x: 10, y: 4}]
                },
                {
                    rgb: {r: 255, g: 0, b: 0},
                    towns: [{x: 2, y: 11}]
                },
                {
                    rgb: {r: 98, g: 168, b: 222},
                    towns: [{x: 18, y: 11}]
                }
            ],
            [{x: 10, y: 11, income: 10}, {x: 16, y: 2, income: 10},
             {x: 4, y: 2, income: 10}, {x: 1, y: 21, income: 10},
             {x: 19, y: 21, income: 10}, {x: 10, y: 16, income: 10},
             {x: 10, y: 0, income: 10}
             ],
            [{x: 13, y: 6}, {x: 14, y: 6}, {x: 15, y: 5}, {x: 16, y: 5},
             {x: 17, y: 4},
             {x: 13, y: 15}, {x: 14, y: 16}, {x: 15, y: 16}, {x: 16, y: 17},
             {x: 17, y: 17},
             {x: 7, y: 6}, {x: 6, y: 6}, {x: 5, y: 5}, {x: 4, y: 5}, {x: 3, y: 4},
             {x: 7, y: 15}, {x: 6, y: 16}, {x: 5, y: 16}, {x: 4, y: 17}, {x: 3, y: 17}],
            [{x: 8, y: 10}, {x: 7, y: 10}, {x: 7, y: 11}, {x: 8, y: 12},
             {x: 12, y: 10}, {x: 13, y: 10}, {x: 13, y: 11}, {x: 12, y: 12},
             {x: 4, y: 20}, {x: 16, y: 20}],
             [{"x":18,"y":5},{"x":2,"y":5},{"x":6,"y":16},{"x":14,"y":16},{"x":0,"y":15},{"x":20,"y":15},{"x":1,"y":15},{"x":19,"y":15},{"x":2,"y":16},{"x":18,"y":16},{"x":2,"y":17},{"x":18,"y":17},{"x":1,"y":16},{"x":19,"y":16},{"x":0,"y":16},{"x":20,"y":16},{"x":2,"y":18},{"x":18,"y":18},{"x":4,"y":21},{"x":16,"y":21},{"x":4,"y":22},{"x":16,"y":22},{"x":0,"y":5},{"x":20,"y":5},{"x":1,"y":5},{"x":19,"y":5},{"x":0,"y":6},{"x":20,"y":6},{"x":1,"y":4},{"x":19,"y":4},{"x":2,"y":1},{"x":18,"y":1},{"x":3,"y":1},{"x":17,"y":1},{"x":4,"y":1},{"x":16,"y":1},{"x":5,"y":1},{"x":15,"y":1},{"x":6,"y":2},{"x":14,"y":2},{"x":7,"y":1},{"x":13,"y":1},{"x":8,"y":1},{"x":12,"y":1},{"x":9,"y":1},{"x":11,"y":1},{"x":10,"y":2},{"x":10,"y":9},{"x":10,"y":8},{"x":10,"y":7},{"x":9,"y":7},{"x":11,"y":7},{"x":9,"y":8},{"x":11,"y":8},{"x":10,"y":14},{"x":9,"y":13},{"x":11,"y":13},{"x":8,"y":13},{"x":12,"y":13},{"x":8,"y":9},{"x":12,"y":9},{"x":7,"y":17},{"x":13,"y":17},{"x":7,"y":18},{"x":13,"y":18},{"x":6,"y":19},{"x":14,"y":19},{"x":2,"y":15},{"x":18,"y":15},{"x":3,"y":14},{"x":17,"y":14},{"x":4,"y":14},{"x":16,"y":14},{"x":1,"y":2},{"x":19,"y":2},{"x":2,"y":2},{"x":18,"y":2},{"x":1,"y":3},{"x":19,"y":3},{"x":1,"y":0},{"x":19,"y":0},{"x":0,"y":0},{"x":20,"y":0},{"x":0,"y":1},{"x":20,"y":1},{"x":1,"y":1},{"x":19,"y":1}]
        )
    ],
    "flank attack":
    [
        new GameMap(
            {x: 21, y: 21},
            [
                {
                    rgb: {r: 208, g: 208, b: 208},
                    towns: [{x: 10, y: 19},
                        {x: 10, y: 10}, {x: 10, y: 1}]
                },
                {
                    rgb: {r: 255, g: 0, b: 0},
                    towns: [{x: 1, y: 10}]
                },
                {
                    rgb: {r: 98, g: 168, b: 222},
                    towns: [{x: 19, y: 10}]
                }
            ],
            [{x: 5, y: 15, income: 10}, {x: 15, y: 15, income: 10},
             {x: 5, y: 18, income: 10}, {x: 15, y: 18, income: 10},
             {x: 5, y: 6, income: 10}, {x: 15, y: 6, income: 10},
             {x: 6, y: 3, income: 10}, {x: 14, y: 3, income: 10},
             {x: 1, y: 1, income: 10}, {x: 19, y: 1, income: 10},
             {x: 1, y: 17, income: 10}, {x: 19, y: 17, income: 10},
             {x: 2, y: 14, income: 10}, {x: 18, y: 14, income: 10},
             {x: 2, y: 5, income: 10}, {x: 18, y: 5, income: 10}],
            [{x: 7, y: 14}, {x: 8, y: 14}, {x: 9, y: 13}, {x: 10, y: 14},
             {x: 11, y: 13}, {x: 12, y: 14}, {x: 13, y: 14},
             {x: 7, y: 6}, {x: 8, y: 6}, {x: 9, y: 5}, {x: 10, y: 6},
             {x: 11, y: 5}, {x: 12, y: 6}, {x: 13, y: 6}],
            [{x: 5, y: 8}, {x: 5, y: 9}, {x: 4, y: 10}, {x: 4, y: 11}, {x: 5, y: 11}, {x: 5, y: 12},
             {x: 15, y: 8}, {x: 15, y: 9}, {x: 16, y: 10}, {x: 16, y: 11}, {x: 15, y: 11}, {x: 15, y: 12},
             ],
             [{"x":8,"y":8},{"x":12,"y":8},{"x":7,"y":8},{"x":13,"y":8},{"x":7,"y":9},{"x":13,"y":9},{"x":8,"y":10},{"x":12,"y":10},{"x":8,"y":11},{"x":12,"y":11},{"x":7,"y":11},{"x":13,"y":11},{"x":7,"y":12},{"x":13,"y":12},{"x":0,"y":15},{"x":20,"y":15},{"x":1,"y":14},{"x":19,"y":14},{"x":2,"y":15},{"x":18,"y":15},{"x":3,"y":14},{"x":17,"y":14},{"x":4,"y":14},{"x":16,"y":14},{"x":6,"y":17},{"x":14,"y":17},{"x":5,"y":17},{"x":15,"y":17},{"x":4,"y":18},{"x":16,"y":18},{"x":3,"y":18},{"x":17,"y":18},{"x":4,"y":4},{"x":16,"y":4},{"x":4,"y":5},{"x":16,"y":5},{"x":5,"y":4},{"x":15,"y":4},{"x":3,"y":3},{"x":17,"y":3},{"x":3,"y":4},{"x":17,"y":4},{"x":3,"y":5},{"x":17,"y":5},{"x":3,"y":6},{"x":17,"y":6},{"x":2,"y":6},{"x":18,"y":6},{"x":2,"y":7},{"x":18,"y":7},{"x":1,"y":6},{"x":19,"y":6},{"x":1,"y":5},{"x":19,"y":5},{"x":9,"y":2},{"x":11,"y":2},{"x":7,"y":1},{"x":13,"y":1},{"x":8,"y":2},{"x":12,"y":2},{"x":9,"y":3},{"x":11,"y":3}]
        )
    ],
    "attack and protect":
    [
        new GameMap(
            {x: 21, y: 21},
            [
                {
                    rgb: {r: 208, g: 208, b: 208},
                    towns: [{x: 10, y: 7}]
                },
                {
                    rgb: {r: 255, g: 0, b: 0},
                    towns: [{x: 4, y: 13}, {x: 19, y: 1}]
                },
                {
                    rgb: {r: 98, g: 168, b: 222},
                    towns: [{x: 16, y: 13}, {x: 1, y: 1}]
                }
            ],
            [{x: 10, y: 1, income: 10},
             {x: 7, y: 3, income: 10}, {x: 13, y: 3, income: 10},
             {x: 5, y: 7, income: 10}, {x: 15, y: 7, income: 10},
             {x: 1, y: 7, income: 10}, {x: 19, y: 7, income: 10},
             {x: 10, y: 19, income: 10},
             {x: 3, y: 18, income: 10}, {x: 17, y: 18, income: 10}
             ],
            [{x: 2, y: 12}, {x: 3, y: 11}, {x: 4, y: 11}, {x: 5, y: 10},
             {x: 6, y: 11}, {x: 7, y: 10}, {x: 8, y: 11}, {x: 9, y: 11},
             {x: 2, y: 13}, {x: 2, y: 14}, {x: 3, y: 14}, {x: 4, y: 15},
             {x: 5, y: 15}, {x: 6, y: 15}, {x: 7, y: 15}, {x: 8, y: 15},
             {x: 9, y: 14},
             {x: 11, y: 11}, {x: 12, y: 11}, {x: 13, y: 10}, {x: 14, y: 11},
             {x: 15, y: 10}, {x: 16, y: 11}, {x: 17, y: 11}, {x: 18, y: 12},
             {x: 18, y: 13}, {x: 18, y: 14}, {x: 17, y: 14}, {x: 16, y: 15},
             {x: 15, y: 15}, {x: 14, y: 15}, {x: 13, y: 15}, {x: 12, y: 15},
             {x: 11, y: 14},
             {x: 10, y: 11}],
            [{x: 20, y: 0}, {x: 0, y: 0},
             {x: 15, y: 3}, {x: 16, y: 4}, {x: 16, y: 5},
             {x: 5, y: 3}, {x: 4, y: 4}, {x: 4, y: 5}],
             [{"x":6,"y":0},{"x":14,"y":0},{"x":6,"y":1},{"x":14,"y":1},{"x":7,"y":1},{"x":13,"y":1},{"x":9,"y":2},{"x":11,"y":2},{"x":8,"y":2},{"x":12,"y":2},{"x":10,"y":3},{"x":6,"y":6},{"x":14,"y":6},{"x":7,"y":6},{"x":13,"y":6},{"x":7,"y":7},{"x":13,"y":7},{"x":7,"y":8},{"x":13,"y":8},{"x":6,"y":9},{"x":14,"y":9},{"x":8,"y":17},{"x":12,"y":17},{"x":9,"y":16},{"x":11,"y":16},{"x":10,"y":16},{"x":4,"y":0},{"x":16,"y":0},{"x":5,"y":0},{"x":15,"y":0},{"x":4,"y":1},{"x":16,"y":1},{"x":5,"y":1},{"x":15,"y":1},{"x":2,"y":5},{"x":18,"y":5},{"x":3,"y":5},{"x":17,"y":5},{"x":1,"y":4},{"x":19,"y":4},{"x":0,"y":5},{"x":20,"y":5}]
        )
    ],
    "fight forever":
    [
        new GameMap(
            {x: 40, y: 30},
            [
                {
                    rgb: {r: 208, g: 208, b: 208},
                    towns: [{x: 12, y: 15}, {x: 27, y: 14},
                    {x: 31, y: 24}, {x: 18, y: 24},
                    {x: 8, y: 5}, {x: 21, y: 5}]
                },
                {
                    rgb: {r: 255, g: 0, b: 0},
                    towns: [{x: 15, y: 28}, {x: 17, y: 1}, {x: 38, y: 23}]
                },
                {
                    rgb: {r: 139, g: 0, b: 255},
                    towns: [{x: 24, y: 1}, {x: 22, y: 28}, {x: 1, y: 6}]
                }
            ],
            [{x: 18, y: 15, income: 100}, {x: 18, y: 21, income: 50},
                {x: 13, y: 27, income: 50},
                {x: 21, y: 14, income: 100}, {x: 21, y: 8, income: 50},
                {x: 26, y: 2, income: 50},
                {x: 4, y: 11, income: 25}, {x: 6, y: 22, income: 25}, {x: 3, y: 26, income: 25}, {x: 7, y: 24, income: 25}, {x: 2, y: 23, income: 25}, {x: 5, y: 17, income: 25}, {x: 10, y: 9, income: 25},
                {x: 35, y: 18, income: 25}, {x: 33, y: 7, income: 25}, {x: 36, y: 3, income: 25}, {x: 32, y: 5, income: 25}, {x: 37, y: 6, income: 25}, {x: 34, y: 12, income: 25}, {x: 29, y: 20, income: 25},
                {x: 2, y: 4, income: 25}, {x: 13, y: 5, income: 25},
                {x: 37, y: 25, income: 25}, {x: 26, y: 24, income: 25},
                {x: 32, y: 16, income: 25}, {x: 11, y: 18, income: 25},
                {x: 7, y: 13, income: 25}, {x: 28, y: 11, income: 25},
                {x: 2, y: 16, income: 25}, {x: 1, y: 13, income: 25},
                {x: 37, y: 13, income: 25}, {x: 38, y: 16, income: 25}

            ],
            [
                {x: 15, y: 11}, {x: 16, y: 11}, {x: 17, y: 11}, {x: 18, y: 11},
                {x: 24, y: 18}, {x: 23, y: 18}, {x: 22, y: 18}, {x: 21, y: 18},
                {x: 9, y: 21}, {x: 30, y: 8},
                {x: 17, y: 24}, {x: 18,  y: 25},
                {x: 22, y: 5}, {x: 21, y: 4},
                {x: 14, y: 21}, {x: 13, y: 20}, {x: 13, y: 19}, {x: 12, y: 19},
                {x: 25, y: 8}, {x: 26, y: 9}, {x: 26, y: 10}, {x: 27, y: 10},
                {x: 3, y: 15}, {x: 5, y: 15}, {x: 5, y: 14},
                {x: 36, y: 14}, {x: 34, y: 14}, {x: 34, y: 15}
            ],
            [{x: 20, y: 12}, {x: 21, y: 12}, {x: 22, y: 12}, {x: 23, y: 11},
                {x: 19, y: 17}, {x: 18, y: 17}, {x: 17, y: 17}, {x: 16, y: 18},
            {x: 5, y: 20}, {x: 6, y: 20}, {x: 7, y: 20}, {x: 8, y: 21},
            {x: 34, y: 9}, {x: 33, y: 9}, {x: 32, y: 9}, {x: 31, y: 8},
            {x: 30, y: 21}, {x: 31, y: 20}, {x: 32, y: 20}, {x: 33, y: 19},
            {x: 9, y: 8}, {x: 8, y: 9}, {x: 7, y: 9}, {x: 6, y: 10},
            {x: 27, y: 25}, {x: 28, y: 26}, {x: 28, y: 27},
            {x: 12, y: 4}, {x: 11, y: 3}, {x: 11, y: 2}]
        ),
        new GameMap(
            {x: 39, y: 39},
            [
                {
                    rgb: {r: 208, g: 208, b: 208},
                    towns: [{x: 14, y: 17}, {x: 24, y: 17}, {x: 19, y: 24},
                        {x: 10, y: 6}, {x: 28, y: 6}, {x: 1, y: 19},
                        {x: 37, y: 19}, {x: 8, y: 34}, {x: 30, y: 34}]
                },
                {
                    rgb: {r: 255, g: 0, b: 0},
                    towns: [{x: 2, y: 11}]
                },
                {
                    rgb: {r: 98, g: 168, b: 222},
                    towns: [{x: 36, y: 11}]
                },
                {
                    rgb: {r: 0, g: 179, b: 0},
                    towns: [{x: 19, y: 36}]
                }
            ],
            [{x: 19, y: 19, income: 60}, {x: 8, y: 25, income: 30},
                {x: 30, y: 25, income: 30}, {x: 19, y: 8, income: 30}],
            [{x: 12, y: 28}, {x: 13, y: 28}, {x: 14, y: 29},
                {x: 15, y: 29}, {x: 26, y: 28}, {x: 25, y: 28},
                {x: 24, y: 29}, {x: 23, y: 29}, {x: 7, y: 20}, {x: 7, y: 19},
                {x: 7, y: 18}, {x: 7, y: 17}, {x: 31, y: 20}, {x: 31, y: 19},
                 {x: 31, y: 18}, {x: 31, y: 17}, {x: 14, y: 10}, {x: 13, y: 10},
                 {x: 12, y: 11}, {x: 11, y: 11}, {x: 24, y: 10}, {x: 25, y: 10},
                 {x: 26, y: 11}, {x: 27, y: 11}],
            [{x: 8, y: 23}, {x: 9, y: 23}, {x: 10, y: 24}, {x: 10, y: 25},
                {x: 10, y: 26}, {x: 30, y: 23}, {x: 29, y: 23}, {x: 28, y: 24},
                {x: 28, y: 25}, {x: 28, y: 26}, {x: 17, y: 9}, {x: 18, y: 10},
                {x: 19, y: 10}, {x: 20, y: 10}, {x: 21, y: 9}]
        )
    ]
}
// The camera centres once on the local player when a game starts or loads (TASK-1164): on its own town with the
// highest income, else on its own unit with the smallest coordinate; ties go to the smallest coordinate (x, then y).
// Without towns and units the camera stays. Later turns and tutorials do not call this.
// An untouched fitted board (GameManager.fitCamera, TASK-1115) also stays: the whole board, the target included, is in view.
function playerStartFocusTarget(player) {
    const byCoord = (a, b) => a.coord.x - b.coord.x || a.coord.y - b.coord.y
    const towns = player.towns.filter(town => !player.isTownKilled(town))
    if (towns.length) {
        const incomes = new Map(towns.map(town => [town, town.income]))
        return towns.sort((a, b) => incomes.get(b) - incomes.get(a) || byCoord(a, b))[0]
    }
    return player.units.filter(unit => !unit.killed).sort(byCoord)[0] || null
}
function focusCameraOnPlayerStart(player) {
    const target = player && playerStartFocusTarget(player)
    const screen = gameEvent.screen
    if (target && !(screen.isFittedView?.() && screen.showsWholeBoard?.()))
        gameEvent.screen.moveTo(Sprite.prototype.calcPos.call(target))
    return target
}
class GameManager {
	static clearValues() {
        external = []
        externalProduction = []
        nature = []
        goldmines = []
        gameRound = 0
        hiddenInfo = false
        hiddenStatus = null
        moveTween.clear()

        this.clearBasisValues()
    }
    static updateCameraBorders() {
        mapDepth.rebuild(grid)
        mapBorder = {
	        left: mapDepth.bounds.left,
	        right: mapDepth.bounds.right,
	        top: mapDepth.bounds.top,
	        bottom: mapDepth.bounds.bottom,
	        scale: {min: 1, max: 1}
	    }
        this.updateScaleLimits()
    }
    // Zoom limits from the screen and the whole board (TASK-1219, TASK-1281): zooming out stops where the slab (top
    // face and sides, the geometry fitCamera fits) fills CAMERA_LIMITS.fill = 1/1.3 of the screen on its tighter side
    // (about 30% sky), so the whole board can always be seen, however small its hexes get; zooming in stops at 1.
    // mapBorder.slab is the slab's box, which the pan limits keep whole on screen on an axis where it is smaller than the screen.
    static CAMERA_LIMITS = {fill: 1 / 1.3, max: 1}
    static updateScaleLimits() {
        const b = mapDepth.surfaceBounds, max = this.CAMERA_LIMITS.max
        mapBorder.slab = b && b.right > b.left ? {left: b.left, right: b.right, top: b.top, bottom: b.bottom + mapDepth.depth} : undefined
        const s = mapBorder.slab
        const fitAll = s ? Math.min(this.CAMERA_LIMITS.fill * WIDTH / (s.right - s.left),
            this.CAMERA_LIMITS.fill * HEIGHT / (s.bottom - s.top)) : max
        mapBorder.scale = {min: Math.min(fitAll, max), max, fitAll}
    }
    // The game draws in WIDTH x HEIGHT canvas pixels fixed at load (index.html scales the canvas box to the
    // window), so after a resize or an orientation change the limits are recomputed for that screen and the
    // camera is brought back inside them: the scale clamped about the screen centre, then the pan limits.
    static screenResized() {
        if (!mapBorder || menu.visible)
            return
        this.updateScaleLimits()
        gameEvent.screen.zoomBy({x: WIDTH / 2, y: HEIGHT / 2}, 1)
        gameEvent.screen.move(0)
    }
    // Atmospheric visuals open the board like the concept: the whole slab (top face and sides) fitted and
    // centred with a sky margin (CAMERA_FIT.margin of the shorter screen side), when that leaves hexes
    // no smaller than at the map's zoom-out limit, nor than the minimum readable size: the hex radius at
    // the zoom-out limit of the standard 21-cell board in landscape (5/21 of basis.r = the longer screen
    // side / 18), in either orientation. Otherwise, and with atmospheric visuals off, the camera stays as
    // it is (the map's top-left corner at full zoom). Zoom limits: updateScaleLimits.
    // With the keyboard hint panels beside the board (Tutorial 1 on a desktop, render/draw.js), the fitted width
    // spans them too, symmetrically about the board's centre, so they stay whole on screen.
    static CAMERA_FIT = {margin: 0.04, readableRadius: 5 / 21 / 18}
    static fitCamera() {
        const b = mapDepth.surfaceBounds
        if (!otherSettings.atmosphericVisuals || !b || !(b.right > b.left))
            return this.cameraFit = {fitted: false, reason: 'off'}
        const margin = this.CAMERA_FIT.margin * Math.min(WIDTH, HEIGHT)
        let boardWidth = b.right - b.left
        const boardHeight = b.bottom - b.top + mapDepth.depth
        if (typeof backgroundHintsShown === 'function' && backgroundHintsShown()) {
            const centre = (b.left + b.right) / 2, pad = BACKGROUND_HINT_PAD * basis.r
            for (const rect of backgroundHintRects())
                boardWidth = Math.max(boardWidth, 2 * Math.max(centre - rect.x + pad, rect.x + rect.width + pad - centre))
        }
        const fit = Math.min((WIDTH - 2 * margin) / boardWidth, (HEIGHT - 2 * margin) / boardHeight)
        const readable = Math.max(mapBorder.scale.min,
            this.CAMERA_FIT.readableRadius * Math.max(WIDTH, HEIGHT) / basis.r)
        const decision = {fitScale: fit, readableScale: readable, fitHexRadius: fit * basis.r,
            readableHexRadius: readable * basis.r}
        if (!(fit >= readable))
            return this.cameraFit = {fitted: false, reason: 'too small', ...decision}
        const scale = Math.min(fit, mapBorder.scale.max)
        canvas.scale = scale
        width = WIDTH / scale
        height = HEIGHT / scale
        canvas.offset = {x: (b.left + b.right) / 2 - width / 2, y: (b.top + b.bottom + mapDepth.depth) / 2 - height / 2}
        // Within the unchanged pan limits (a tall portrait screen may shift the board up).
        gameEvent.screen?.correctCanvas?.()
        mainCtx.setTransform(scale, 0, 0, scale, -canvas.offset.x * scale, -canvas.offset.y * scale)
        return this.cameraFit = {fitted: true, scale, offset: {...canvas.offset}, hexRadius: scale * basis.r, ...decision}
    }
    static clearBasisValues() {
        gameExit = false
        menu.visible = false

		canvas = {
            offset: {
                x: 0,
                y: 0
            },
            scale: 1
        }
        width = WIDTH
        height = HEIGHT
        mainCtx.setTransform(1, 0, 0, 1, 0, 0)
        gameEvent.resetCameraInput()
        gameEvent.screen.stop()
        gameEvent.resetKeyboardZoom()
        this.updateCameraBorders()
        this.fitCamera()
        this.clearWaitingMode()

	    createEvents()
    }
    // An online wait or connection-lost panel freezes input; a game entered
    // from the menu starts unfrozen (an online board re-freezes after this),
    // without the 1-second next-turn guard of the previous game.
    static clearWaitingMode() {
        gameEvent.waitingMode = false
        nextTurnButton.highlightButton = false
        nextTurnButton.enableClick()
        nextTurnButton.unactive = false
        if (typeof undoButton != 'undefined') undoButton.enableClick()
    }
    static load() {
        this.clearBasisValues()
        actionManager.clear()
        this.clearHumanCommands()
        this.clearActionLog()

        nextTurnButton.setNextPlayerColor(players[whooseTurn].hexColor)
        nextTurnPauseInterface.visible = true
        if (!gameSettings.tutorial)
            focusCameraOnPlayerStart(players[whooseTurn])

        lastGameFrameTime = undefined
        framesPerSecond = 60
    	requestAnimationFrame(gameLoop)
	}
	static initValues() {
        whooseTurn = 0
        gameRound = 0
        actionManager.clear()
        this.clearHumanCommands()
        this.clearActionLog()
    }
    // Human commands belong to one game. AiRuntime is absent where only the
    // game rules are loaded (server, benchmarks).
    static clearHumanCommands() {
        if (typeof AiRuntime != 'undefined')
            AiRuntime.clearHumanCommands()
    }
    // So does the recorded action log (options/actionRecorder.js).
    static clearActionLog() {
        if (typeof actionLog != 'undefined')
            actionLog.reset()
    }
    // The board setup shared by start and buildOnlineBoard.
    static setUpBoard(map, _isFogOfWar, isClassicTimer, isOnline, gameManager = this) {
        isFogOfWar = _isFogOfWar
        gameSettings.isOnline = isOnline
        onlineGameStorage = isOnline
        map.start(gameManager, isClassicTimer, !isOnline)
        this.initValues()
        gameRound = map.startRound || 0
    }
    // The initial online board (the long timer, online settings), without
    // entering the game: the menu stays visible and the game globals it replaced
    // that the menu or a later load reads are restored.
    static buildOnlineBoard(map, _isFogOfWar) {
        const saved = {isFogOfWar, gameSettings: JSON.parse(JSON.stringify(gameSettings)), timer, onlineGameStorage}
        // No clearBasisValues: it hides the menu and installs the game's input events.
        const boardOnly = {
            clearValues() {
                external = []
                externalProduction = []
                nature = []
                goldmines = []
                gameRound = 0
            },
            updateCameraBorders() {},
        }
        try {
            this.setUpBoard(map, _isFogOfWar, false, true, boardOnly)
            return JSON.parse(JSON.stringify(getGameObject()))
        } finally {
            isFogOfWar = saved.isFogOfWar
            gameSettings = saved.gameSettings
            timer = saved.timer
            onlineGameStorage = saved.onlineGameStorage
        }
    }
    // A local (hot seat) game; online games start from a lobby (openLobbyGame).
    static start(map, _isFogOfWar, isClassicTimer = false) {
        this.setUpBoard(map, _isFogOfWar, isClassicTimer, false)
        startTurn()
        // A tutorial keeps the camera of its first turn.
        if (!gameSettings.tutorial)
            focusCameraOnPlayerStart(players[whooseTurn])

        lastGameFrameTime = undefined
        framesPerSecond = 60
        requestAnimationFrame(gameLoop)
    }

	/*static start1() {
        maps.small[0].start(this)
	}
	static start2() {
        maps.small[1].start(this)
    }
    static start3() {
        maps.small[2].start(this)
    }
    static start4() {
        maps.big[0].start(this)
    }
    static start5() {
        maps.big[1].start(this)
    }*/
}
let lastGameFrameTime = undefined
let framesPerSecond = 60
function gameLoop(frameTime) {
    const defaultFrameDuration = 1000 / 60
    const actualFrameDuration = lastGameFrameTime == undefined ? defaultFrameDuration :
        frameTime - lastGameFrameTime
    const frameDuration = Math.min(actualFrameDuration, 100)
    lastGameFrameTime = frameTime
    if (actualFrameDuration > 0) {
        const currentFps = 1000 / actualFrameDuration
        framesPerSecond = framesPerSecond * 0.9 + currentFps * 0.1
    }

    gameEvent.moveScreen(frameDuration, frameTime)
    drawAll()
    if (gameExit) {
        gameExit = false
        lastGameFrameTime = undefined
        return
    }
    requestAnimationFrame(gameLoop)
}
