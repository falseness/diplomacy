// Hand-made tutorial maps. The human always plays red (slot 1, fog of war) against
// blue (slot 2, an AI player). `pass` picks the win rule (TutorialManager.isPassed):
// 'enemyUnitsDead' every blue unit is dead, 'enemyLost' blue has no towns and no units,
// 'coopVictory' the co-op result is victory while red still owns a town.
// Unit classes load after this file, so each map is built on access.
function createTutorial1Map() {
    // Blue holds column 3, red stands directly to its right in column 4. The red
    // archer can kill the blue noob (dmg 2 = hp 2) and a red noob the blue archer (hp 1)
    // on the first turn; after that red out-damages the two normchels. Hitting the
    // nearest normchel instead (what SimpleAiPlayer does for red) loses.
    let map = new GameMap(
        {x: 9, y: 7},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [],
                units: [
                    {x: 4, y: 1, type: Noob},
                    {x: 4, y: 2, type: Noob},
                    {x: 4, y: 3, type: Archer},
                    {x: 4, y: 4, type: Noob}
                ]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                playerType: 'SimpleAiPlayer',
                towns: [],
                units: [
                    {x: 3, y: 1, type: Normchel},
                    {x: 3, y: 2, type: Archer},
                    {x: 3, y: 3, type: Normchel},
                    {x: 3, y: 4, type: Noob}
                ]
            }
        ],
        [],
        [],
        []
    )
    map.testName = 'tutorial 1'
    return map
}

function createTutorial2Map() {
    // Blue's army (5 normchels in front of 5 archers) stands 3 hexes left of red's
    // 2 normchels and 2 archers; red's town with a barrack is 7 hexes behind red's army.
    // Fighting at once loses. Retreating to the town for 4 rounds while the town and the
    // barrack order a unit every turn wins. Blue has no town, so its economy is off
    // (salaries would bankrupt it and disband its army).
    let map = new GameMap(
        {x: 16, y: 9},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                gold: 250,
                towns: [{x: 13, y: 4}],
                barracks: [{x: 14, y: 4, town: {x: 13, y: 4}}],
                units: [
                    {x: 5, y: 3, type: Normchel},
                    {x: 5, y: 5, type: Normchel},
                    {x: 6, y: 3, type: Archer},
                    {x: 6, y: 5, type: Archer}
                ]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                playerType: 'SimpleAiPlayerWithEconomy',
                economyEnabled: false,
                towns: [],
                units: [
                    {x: 2, y: 2, type: Normchel},
                    {x: 2, y: 3, type: Normchel},
                    {x: 2, y: 4, type: Normchel},
                    {x: 2, y: 5, type: Normchel},
                    {x: 2, y: 6, type: Normchel},
                    {x: 1, y: 2, type: Archer},
                    {x: 1, y: 3, type: Archer},
                    {x: 1, y: 4, type: Archer},
                    {x: 1, y: 5, type: Archer},
                    {x: 1, y: 6, type: Archer}
                ]
            }
        ],
        [],
        [],
        []
    )
    map.testName = 'tutorial 2'
    return map
}

function createTutorial3Map() {
    // Blue's town (2,4) sits behind a wall line in column 5 that spans the whole map height;
    // the line's cells (5,3) and (5,5) are towers, each with a blue archer on it (range 3).
    // Red has no town: 2 normchels, 2 archers, 2 KOHb and 2 catapults (range 2-5, 4 damage
    // to buildings). Both catapults start 5 hexes from both towers, out of the tower archers'
    // reach: shooting the same tower together destroys it (hp 5) in one turn. Attacking at once
    // loses; destroying both towers while the army holds its line, then fighting the defenders
    // who come out, wins. Red has no town and blue never buys, so both economies are off.
    let wallLine = []
    for (let y = 0; y < 9; ++y) {
        if (y != 3 && y != 5) {
            wallLine.push({x: 5, y: y})
        }
    }
    let blueSide = []
    for (let x = 0; x <= 5; ++x) {
        for (let y = 0; y < 9; ++y) {
            blueSide.push({x: x, y: y})
        }
    }
    let map = new GameMap(
        {x: 14, y: 9},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                economyEnabled: false,
                towns: [],
                units: [
                    {x: 10, y: 3, type: Catapult},
                    {x: 10, y: 5, type: Catapult},
                    {x: 11, y: 3, type: Normchel},
                    {x: 11, y: 5, type: Normchel},
                    {x: 12, y: 3, type: Archer},
                    {x: 12, y: 5, type: Archer},
                    {x: 11, y: 4, type: KOHb},
                    {x: 12, y: 4, type: KOHb}
                ]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                playerType: 'SimpleAiPlayerWithEconomy',
                economyEnabled: false,
                towns: [{x: 2, y: 4}],
                suburbs: [{
                    town: {x: 2, y: 4},
                    cells: [{x: 2, y: 4}, {x: 2, y: 3}, {x: 3, y: 3}, {x: 3, y: 4},
                        {x: 2, y: 5}, {x: 1, y: 4}, {x: 1, y: 3}],
                    expansionCells: blueSide
                }],
                walls: wallLine,
                towers: [{x: 5, y: 3}, {x: 5, y: 5}],
                units: [
                    {x: 5, y: 3, type: Archer},
                    {x: 5, y: 5, type: Archer},
                    {x: 4, y: 3, type: Normchel},
                    {x: 4, y: 5, type: Normchel},
                    {x: 3, y: 4, type: Archer},
                    {x: 4, y: 4, type: Archer}
                ]
            }
        ],
        [],
        [],
        []
    )
    map.testName = 'tutorial 3'
    return map
}

function createTutorial4Map() {
    // A full 1v1 from the very beginning: each side has one town (with its spawned noob) and the
    // default gold. The map is mirror-symmetric about column 9 (x -> 18 - x keeps the column
    // parity, so hex neighbours mirror exactly): red's town (1,4) faces blue's (17,4) across a
    // mountain ridge on each side, two neutral towns and a lake on the centre column, bushes and
    // hills on the flanks.
    let map = new GameMap(
        {x: 19, y: 10},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: [{x: 9, y: 2}, {x: 9, y: 7}]
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [{x: 1, y: 4}]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                playerType: 'SimpleAiPlayerWithEconomy',
                towns: [{x: 17, y: 4}]
            }
        ],
        [],
        coordDictionary([[9, 4], [9, 5]]),
        coordDictionary([[5, 4], [5, 5], [6, 5], [13, 4], [13, 5], [12, 5]]),
        coordDictionary([[3, 7], [4, 8], [15, 7], [14, 8]]),
        coordDictionary([[7, 2], [3, 1], [11, 2], [15, 1]])
    )
    map.testName = 'tutorial 4'
    return map
}

const tutorials = [
    {id: 'tutorial-1', title: 'Tutorial 1', pass: 'enemyUnitsDead', get map() { return createTutorial1Map() }},
    {id: 'tutorial-2', title: 'Tutorial 2', pass: 'enemyUnitsDead', get map() { return createTutorial2Map() }},
    {id: 'tutorial-3', title: 'Tutorial 3', pass: 'enemyLost', get map() { return createTutorial3Map() }},
    {id: 'tutorial-4', title: 'Tutorial 4', pass: 'enemyLost', get map() { return createTutorial4Map() }}
]
