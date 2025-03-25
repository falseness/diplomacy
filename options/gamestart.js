class Map {
    constructor(mapSize, _players, _goldmines, lakes, mountains) {
        this.mapSize = mapSize
        this.players = _players
        this.goldmines = _goldmines
        this.lakes = lakes
        this.mountains = mountains
    }
    createPlayers() {
        players = new Array(this.players.length)
        players[0] = new NeutralPlayer(this.players[0].rgb, 0)
        for (let i = 1; i < this.players.length; ++i) {
            players[i] = new Player(this.players[i].rgb)
        }
    }
    createTowns() {
        for (let i = 0; i < this.players[0].towns.length; ++i) {
            let town_coord = this.players[0].towns[i]
            new Town(town_coord.x, town_coord.y, false, -1)
        }
        for (let i = 1; i < this.players.length; ++i) {
            let towns = this.players[i].towns
            for (let j = 0; j < towns.length; ++j) {
                let town_coord = towns[j]

                grid.arr[town_coord.x][town_coord.y].hexagon.firstpaint(i)
                new Town(town_coord.x, town_coord.y, false, true)
            }
        }
    }
    createGoldmines() {
        for (let i = 0; i < this.goldmines.length; ++i) {
            let goldmine = this.goldmines[i]
            new Goldmine(goldmine.x, goldmine.y, goldmine.income)
        }
    }
    createNature() {
        for (let i = 0; i < this.mountains.length; ++i) {
            let mountain = this.mountains[i]
            new Mountain(mountain.x, mountain.y)
        }
        for (let i = 0; i < this.lakes.length; ++i) {
            let lake = this.lakes[i]
            new Lake(lake.x, lake.y)
        }
    }
    start(_gameManager, isClassicTimer) {
        grid = new Grid(0, 0, this.mapSize)
        _gameManager.clearValues()

        this.createPlayers()
        this.createTowns()
        this.createGoldmines()
        this.createNature()

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

        // refactoring is needed
        for (let i = 1; i < players.length; ++i) {
            localStorage.setItem(gameSlot + 'Player:' + i, 
            JSON.stringify([]))
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
maps = {
    "open field": 
    [
        new Map(
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
            []
        ),
        new Map(
            {x: 30, y: 23},
            [
                {
                    rgb: {r: 208, g: 208, b: 208},
                    towns: []
                },
                {
                    rgb: {r: 255, g: 0, b: 0},
                    towns: [{x: 9, y: 6}]
                },
                {
                    rgb: {r: 98, g: 168, b: 222},
                    towns: [{x: 20, y: 9}]
                },
                {
                    rgb: {r: 0, g: 179, b: 0},
                    towns: [{x: 12, y: 16}]
                }
            ],
            [],
            [],
            []
        ),
        new Map(
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
                {x: 20, y: 10}, {x: 19, y: 12}, {x: 19, y: 11}, {x: 20, y: 14}, {x: 19, y: 10}, {x: 19, y: 13}
            ],
            [{x: 0, y: 0}, {x: 24, y: 0}, {x: 1, y: 11}, {x: 1, y: 12}, 
                {x: 23, y: 11}, {x: 23, y: 12}, {x: 12, y: 1}, {x: 11, y: 1}, {x: 13, y: 1},
                {x: 12, y: 23}, {x: 11, y: 23}, {x: 13, y: 23}]
        )
    ],
    "tiny deathmatch":
    [
        new Map(
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
        new Map(
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
             {x: 14, y: 15}, {x: 14, y: 16}, {x: 13, y: 16}]
        )
    ],
    "two rivers": 
    [
        new Map(
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
             {x: 4, y: 16}, {x: 4, y: 17}, {x: 3, y: 17}]
        ),
    ],
    "mountain wall":
    [
        new Map(
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
            ]
        )
    ],
    "two in one":
    [
        new Map(
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
            ]
        )
    ],
    "tower defense":
    [
        new Map(
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
             ]
        )
    ],
    "capture rush": [
        new Map(
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
             {x: 14, y: 15}, {x: 14, y: 16}, {x: 13, y: 16}]
        )
    ],
    "strategic war":
    [
        new Map(
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
             {x: 15, y: 6}, {x: 16, y: 7}, {x: 17, y: 6}]
        )
    ],
    "reinforcement":
    [
        new Map(
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
            ]
        )
    ],
    "rush or defend":
    [
        new Map(
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
            ]
        )  
    ],
    "sneak attack":
    [
        new Map(
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
             {x: 4, y: 20}, {x: 16, y: 20}]
        )
    ],
    "flank attack": 
    [
        new Map(
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
             ]
        )
    ],
    "attack and protect": 
    [
        new Map(
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
             {x: 5, y: 3}, {x: 4, y: 4}, {x: 4, y: 5}]
        )
    ],
    "fight forever": 
    [
        new Map(
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
        new Map(
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
class GameManager {
	static clearValues() {
        external = []
        externalProduction = []
        nature = []
        goldmines = []
        gameRound = 0

        this.clearBasisValues()
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
        gameEvent.screen.stop()
        
        let grid_min_size = Math.min(grid.arr.length, grid.arr[0].length)
        mapBorder = {
	        left: 0,
	        right: grid.right,
	        top: 0,
	        bottom: grid.bottom,
	        scale: {
	            min: 1 / grid_min_size * 5, //0.275,
	            max: 1
	        }
	    }
	    createEvents()
    }
	static load() {
        this.clearBasisValues()
        
        nextTurnButton.color = players[whooseTurn].hexColor
        nextTurnPauseInterface.visible = true

    	requestAnimationFrame(gameLoop)
	}
	static initValues() {
        whooseTurn = 0
        gameRound = 0
        
        //undoManager.clear()
    }
    static start(map, _isFogOfWar, isClassicTimer = false, isOnline = false, password = '') {
        isFogOfWar = _isFogOfWar
        gameSettings.isOnline = isOnline
        unsafeVariablePassword = password
        map.start(this, isClassicTimer)
        this.initValues()
        startTurn()
        if (isOnline) {
            SetupServerCommunicationLogic(password)
        }

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
function gameLoop() {
    gameEvent.moveScreen()
    drawAll()
    if (gameExit) {
        gameExit = false
        return
    }
    requestAnimationFrame(gameLoop)
}