// Hand-made tutorial maps. The human always plays red (slot 1, fog of war) against
// blue (slot 2, an AI player). `pass` picks the win rule (TutorialManager.isPassed):
// 'enemyUnitsDead' every blue unit is dead, 'enemyLost' blue has no towns and no units,
// 'coopVictory' the co-op result is victory while red still owns a town,
// 'captureTowns' red owns every town of `targets` [{x, y}], 'surviveRounds' gameRound
// reaches `rounds` while red still owns a town (a unit if the map gives red no town).
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

function createTutorial5Map() {
    // Town defense against demons (co-op tutorial map). Red's town (1,4) owns the whole strip x <= 4 as
    // suburbs (a rich town: it pays for the army it builds after the first turns). Walls face the demons:
    // the column x = 4 with two gates (4,3) and (4,5) the KOHb sortie through, (3,1)/(3,2) and (2,7)/(2,8) on
    // the flanks and (2,4) right in front of the town. Red starts with 2 KOHb, the town's noob, a barrack and
    // 77 gold: with the first turn's income that is 119, exactly 2 more KOHb. 6 ember archers and a bulwark
    // stand 3-6 hexes from the walls; two ranged portals and a heavy one keep sending more. Attacking at once
    // loses; ordering 2 KOHb (town + barrack) and waiting behind the walls until round 4, then attacking with
    // 4 KOHb, wins.
    let redSide = []
    for (let x = 0; x <= 4; ++x) {
        for (let y = 0; y < 9; ++y) {
            redSide.push({x: x, y: y})
        }
    }
    // The same cells as suburbs, nearest to the town first (breadth-first over the hex neighbours).
    let suburbs = [{x: 1, y: 4}]
    for (let i = 0; i < suburbs.length; ++i) {
        for (let offset of neighborhood[suburbs[i].x & 1]) {
            let cell = {x: suburbs[i].x + offset[0], y: suburbs[i].y + offset[1]}
            if (cell.x >= 0 && cell.x <= 4 && cell.y >= 0 && cell.y < 9 &&
                    !suburbs.some(suburb => suburb.x == cell.x && suburb.y == cell.y)) {
                suburbs.push(cell)
            }
        }
    }
    let map = new GameMap(
        {x: 17, y: 9},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                gold: 77,
                towns: [{x: 1, y: 4}],
                suburbs: [{town: {x: 1, y: 4}, cells: suburbs, expansionCells: redSide}],
                barracks: [{x: 1, y: 3, town: {x: 1, y: 4}}],
                walls: [
                    {x: 4, y: 1}, {x: 4, y: 2}, {x: 4, y: 4}, {x: 4, y: 6}, {x: 4, y: 7},
                    {x: 3, y: 1}, {x: 3, y: 2}, {x: 2, y: 4}, {x: 2, y: 7}, {x: 2, y: 8}
                ],
                units: [
                    {x: 1, y: 1, type: KOHb},
                    {x: 2, y: 6, type: KOHb}
                ]
            }
        ],
        [],
        [],
        coordDictionary([[5, 6]]),
        [],
        [],
        {type: 'rectangular'},
        {
            tutorial: true,
            units: [
                {x: 9, y: 3, type: EmberArcher},
                {x: 7, y: 7, type: EmberArcher},
                {x: 7, y: 4, type: EmberArcher},
                {x: 10, y: 8, type: EmberArcher},
                {x: 10, y: 6, type: EmberArcher},
                {x: 8, y: 5, type: EmberArcher},
                {x: 8, y: 2, type: Bulwark}
            ]
        }
    )
    map.portals = [
        {x: 12, y: 2, category: 'ranged'},
        {x: 15, y: 4, category: 'ranged'},
        {x: 16, y: 7, category: 'heavy'}
    ]
    map.testName = 'tutorial 5'
    return map
}

function createTutorial6Map() {
    // Retreat and come back (co-op tutorial map). Red owns two towns on the axis toward the demons, the
    // back town (3,4) and the front town (10,4), 7 hexes apart; each town has every hex within 3 steps
    // (every suburb up to cost 5) as a suburb. Red's army (a normchel, 2 archers and a KOHb) starts on the
    // far side among 10 portals (4 melee, 4 mage, a siege and a chaos one) that open on round 4. Attacking
    // at once loses; pulling the army back toward the back town while both towns buy units, then
    // counter-attacking, wins.
    let size = {x: 25, y: 9}
    let towns = [{x: 3, y: 4}, {x: 10, y: 4}]
    // Hex distance in the x-parity offset layout of sprites/sprite.js.
    let distance = (a, b) => {
        let dq = a.x - b.x
        let dr = (a.y - (a.x - (a.x & 1)) / 2) - (b.y - (b.x - (b.x & 1)) / 2)
        return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
    }
    // A town's suburbs: every cell within 3 steps (37 cells including the town), nearest first.
    let suburbsOf = town => {
        let cells = []
        for (let x = 0; x < size.x; ++x) {
            for (let y = 0; y < size.y; ++y) {
                if (distance(town, {x: x, y: y}) <= 3) {
                    cells.push({x: x, y: y})
                }
            }
        }
        return cells.sort((left, right) => distance(town, left) - distance(town, right))
    }
    let map = new GameMap(
        size,
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                gold: 850,
                towns: towns,
                suburbs: towns.map(town => ({town: town, cells: suburbsOf(town), expansionCells: suburbsOf(town)})),
                units: [
                    {x: 18, y: 4, type: Normchel},
                    {x: 16, y: 3, type: Archer},
                    {x: 15, y: 4, type: Archer},
                    {x: 16, y: 7, type: KOHb}
                ]
            }
        ],
        [],
        [],
        coordDictionary([]),
        coordDictionary([[17, 0]]),
        [],
        {type: 'rectangular'},
        {tutorial: true}
    )
    map.portals = [
        {x: 17, y: 1, category: 'melee'},
        {x: 20, y: 7, category: 'melee'},
        {x: 23, y: 2, category: 'melee'},
        {x: 22, y: 5, category: 'melee'},
        {x: 21, y: 4, category: 'mage'},
        {x: 22, y: 0, category: 'mage'},
        {x: 23, y: 7, category: 'mage'},
        {x: 19, y: 4, category: 'mage'},
        {x: 24, y: 3, category: 'siege'},
        {x: 24, y: 5, category: 'chaos'}
    ]
    map.testName = 'tutorial 6'
    return map
}

function createTutorial7Map() {
    // High ground: a 3-hex hill (4,4), (4,5), (5,4) stands between red (2 archers, 2 noobs) and blue's
    // 3 archers and 2 noobs on open ground. Each red archer is one step from a hill hex, and every blue
    // archer is exactly 3 hexes from the nearest hill hex: an archer on a hill shoots 3 hexes, so red's
    // archers on it hit blue first, while blue's archers (range 2) must walk up and spend their moves.
    // Walking the archers straight at blue (what SimpleAiPlayer does for red) gets them shot first.
    let map = new GameMap(
        {x: 12, y: 9},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [],
                units: [
                    {x: 4, y: 3, type: Archer},
                    {x: 3, y: 5, type: Archer},
                    {x: 3, y: 3, type: Noob},
                    {x: 4, y: 6, type: Noob}
                ]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                playerType: 'SimpleAiPlayer',
                towns: [],
                units: [
                    {x: 8, y: 3, type: Archer},
                    {x: 8, y: 4, type: Archer},
                    {x: 8, y: 5, type: Archer},
                    {x: 7, y: 5, type: Noob},
                    {x: 7, y: 6, type: Noob}
                ]
            }
        ],
        [],
        coordDictionary([]),
        coordDictionary([]),
        coordDictionary([]),
        coordDictionary([[4, 4], [4, 5], [5, 4]])
    )
    map.testName = 'tutorial 7'
    return map
}

function createTutorial8Map() {
    // Through the bushes: blue's 4 archers stand on the right of a 13x9 map behind a wide open field; red's
    // 3 normchels and 2 noobs start on the left. A 2-row band of bushes (rows 0 and 1, x 1..11) runs along
    // the top from red's side to blue's flank. Bushes block line of sight: an archer can shoot a bush hex
    // but not past it, so a unit in the inner row or behind the band cannot be shot from the field. Walking
    // straight across the field (what SimpleAiPlayer does for red) gets red shot on the way; moving along
    // the bushes out of the archers' sight and striking when they come close wins.
    let map = new GameMap(
        {x: 13, y: 9},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [],
                units: [
                    {x: 0, y: 4, type: Normchel},
                    {x: 2, y: 4, type: Normchel},
                    {x: 1, y: 4, type: Normchel},
                    {x: 1, y: 3, type: Noob},
                    {x: 1, y: 2, type: Noob}
                ]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                playerType: 'SimpleAiPlayer',
                towns: [],
                units: [
                    {x: 12, y: 5, type: Archer},
                    {x: 11, y: 4, type: Archer},
                    {x: 10, y: 6, type: Archer},
                    {x: 11, y: 3, type: Archer}
                ]
            }
        ],
        [],
        coordDictionary([]),
        coordDictionary([]),
        coordDictionary([
            [1, 1], [1, 0], [2, 1], [2, 0], [3, 1], [3, 0], [4, 1], [4, 0], [5, 1], [5, 0], [6, 1], [6, 0],
            [7, 1], [7, 0], [8, 1], [8, 0], [9, 1], [9, 0], [10, 1], [10, 0], [11, 1], [11, 0]
        ]),
        coordDictionary([])
    )
    map.testName = 'tutorial 8'
    return map
}

function createTutorial9Map() {
    // Cavalry raid: a mountain range (row 4, x 2..12) splits a 15x9 map into a southern road and a northern
    // detour; the passes are its two ends (x 0..1 and x 13..14). Blue's army (4 normchels in column 8, 3 archers
    // behind them in column 9) blocks the road between red (3 KOHb, 2 normchels, bottom left) and the blue town
    // (14,7), which starts at 0 hp guarded only by its own noob. Riding the road (what SimpleAiPlayer does for
    // red: it heads for the nearest enemy building) runs into the army and loses. Leaving the normchels on the
    // road as bait while the KOHb (speed 4) ride around the mountains reaches the town long before blue's army
    // (speed 2) can turn back; the KOHb knock the healing town down to 0 hp again and step in.
    let mountains = []
    for (let x = 2; x <= 12; ++x) {
        mountains.push([x, 4])
    }
    let map = new GameMap(
        {x: 15, y: 9},
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
                    {x: 0, y: 6, type: KOHb},
                    {x: 1, y: 6, type: KOHb},
                    {x: 0, y: 7, type: KOHb},
                    {x: 1, y: 7, type: Normchel},
                    {x: 2, y: 7, type: Normchel}
                ]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                playerType: 'SimpleAiPlayer',
                economyEnabled: false,
                towns: [{x: 14, y: 7, hp: 0}],
                units: [
                    {x: 8, y: 5, type: Normchel},
                    {x: 8, y: 6, type: Normchel},
                    {x: 8, y: 7, type: Normchel},
                    {x: 8, y: 8, type: Normchel},
                    {x: 9, y: 5, type: Archer},
                    {x: 9, y: 6, type: Archer},
                    {x: 9, y: 7, type: Archer}
                ]
            }
        ],
        [],
        coordDictionary([]),
        coordDictionary(mountains),
        coordDictionary([]),
        coordDictionary([])
    )
    map.testName = 'tutorial 9'
    return map
}

function createTutorial10Map() {
    // Hold the bridge: a lake (column 5, every row but 4) splits an 11x9 map; the bridge (5,4) is its only
    // passable hex, and the lake hex (4,5) leaves the bridge a single exit on red's side, (4,4). Blue's 8 noobs
    // and 2 archers start on the far side (columns 8..10); red's 2 normchels and 2 archers stand at the exit.
    // Crossing the bridge (what SimpleAiPlayer does for red) gets red surrounded by the noobs on the open far
    // bank. Holding the exit with one normchel (the other relieves it when wounded) means only the unit on the
    // bridge can strike it, while red's archers shoot whoever queues on the bridge; once blue's numbers are
    // gone red crosses and finishes the rest. The economy is off for both sides: without towns the upkeep would
    // bankrupt blue's 10 units by round 8 and win the map for a red that just waits.
    let lakes = [[4, 5]]
    for (let y = 0; y < 9; ++y) {
        if (y != 4) {
            lakes.push([5, y])
        }
    }
    let map = new GameMap(
        {x: 11, y: 9},
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
                    {x: 4, y: 4, type: Normchel},
                    {x: 3, y: 5, type: Normchel},
                    {x: 3, y: 3, type: Archer},
                    {x: 4, y: 3, type: Archer}
                ]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                playerType: 'SimpleAiPlayer',
                economyEnabled: false,
                towns: [],
                units: [
                    {x: 8, y: 2, type: Noob},
                    {x: 8, y: 3, type: Noob},
                    {x: 8, y: 4, type: Noob},
                    {x: 8, y: 5, type: Noob},
                    {x: 9, y: 2, type: Noob},
                    {x: 9, y: 3, type: Noob},
                    {x: 9, y: 4, type: Noob},
                    {x: 9, y: 5, type: Noob},
                    {x: 10, y: 3, type: Archer},
                    {x: 10, y: 5, type: Archer}
                ]
            }
        ],
        [],
        coordDictionary(lakes),
        coordDictionary([]),
        coordDictionary([]),
        coordDictionary([])
    )
    map.testName = 'tutorial 10'
    return map
}

function createTutorial11Map() {
    // Rotate and heal: red's town (1,4) heals every unit standing on it or its 6 suburbs, a normchel by 3 a
    // round, but only in a round it was not hit. Red's 3 normchels start wounded (hp 2, 3, 3) on the suburbs (2,4), (1,3), (2,5).
    // Blue's first wave (4 noobs and a normchel, columns 6..7) arrives at once; the second (2 noobs and a
    // normchel, columns 14..15) arrives about round 4, after the first is worn down. Charging out with the
    // wounded normchels (what SimpleAiPlayer does) leaves the suburbs, so nothing heals and red loses its units
    // and then the town by round 7. Holding the suburbs, striking only what comes next to them, and pulling a
    // unit at hp 2 or less back onto a quiet suburb hex keeps red's town past round 12. The economy is off for
    // both sides: no production, and blue (no town) does not go bankrupt.
    let map = new GameMap(
        {x: 16, y: 9},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                economyEnabled: false,
                towns: [{x: 1, y: 4}],
                units: [
                    {x: 2, y: 4, type: Normchel, hp: 2},
                    {x: 1, y: 3, type: Normchel, hp: 3},
                    {x: 2, y: 5, type: Normchel, hp: 3}
                ]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                playerType: 'SimpleAiPlayer',
                economyEnabled: false,
                towns: [],
                units: [
                    {x: 6, y: 3, type: Noob},
                    {x: 6, y: 4, type: Noob},
                    {x: 6, y: 5, type: Noob},
                    {x: 6, y: 6, type: Noob},
                    {x: 7, y: 4, type: Normchel},
                    {x: 14, y: 3, type: Noob},
                    {x: 14, y: 4, type: Noob},
                    {x: 15, y: 4, type: Normchel}
                ]
            }
        ],
        [],
        coordDictionary([]),
        coordDictionary([]),
        coordDictionary([]),
        coordDictionary([])
    )
    map.testName = 'tutorial 11'
    return map
}

function createTutorial12Map() {
    // Scout first: blue's 3 archers stand on the plain (x=8) right behind a ridge of hills (x=7 rows 1..7) that hides
    // them from red's units on the plain. No unit starts on a hill: hills share the mountain art, and an archer there
    // reads as one standing on a mountain (TASK-731). Under fog of war blue only moves through hexes red sees, so a
    // hidden blue army waits. Marching at the ridge blind (what SimpleAiPlayer does for red) walks red into their range
    // without a target and red loses everything by round 3. The KOHb (3,4) can ride 2 hexes onto the lone lookout hill
    // (5,4), see over the ridge, and ride back out of range in the same turn; the revealed archers come down off the
    // ridge into the open, where red's archers step onto the hills (3,3) and (3,5) and shoot them from 3 hexes, out of
    // a plain archer's range. The economy is off for both sides: no towns, so the upkeep would bankrupt blue.
    let hills = [[5, 4], [3, 3], [3, 5]]
    for (let y = 1; y <= 7; ++y) {
        hills.push([7, y])
    }
    let map = new GameMap(
        {x: 15, y: 9},
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
                    {x: 3, y: 4, type: KOHb},
                    {x: 2, y: 3, type: Archer},
                    {x: 2, y: 5, type: Archer},
                    {x: 1, y: 3, type: Normchel},
                    {x: 1, y: 4, type: Normchel}
                ]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                playerType: 'SimpleAiPlayer',
                economyEnabled: false,
                towns: [],
                units: [
                    {x: 8, y: 3, type: Archer},
                    {x: 8, y: 4, type: Archer},
                    {x: 8, y: 5, type: Archer},
                    {x: 10, y: 3, type: Normchel},
                    {x: 10, y: 5, type: Normchel}
                ]
            }
        ],
        [],
        coordDictionary([]),
        coordDictionary([]),
        coordDictionary([]),
        coordDictionary(hills)
    )
    map.testName = 'tutorial 12'
    return map
}

function createTutorial13Map() {
    // Escort the catapults: blue's town (14,4) sits in a pocket of mountains (13,2), (14,2), (13,5), (14,6); its
    // only ways in are the bastions (13,3) and (13,4) on its west suburbs. Catapults are the only red units that
    // hurt buildings from range (2..5 hexes, 4 damage), but they have 1 hp and never hit units. Blue's 3 KOHb
    // raiders wait in front of the pocket, (8,3), (8,5), (9,4), hidden in the fog. Red's catapults and archer start
    // in front of its normchels: marching everything at the town (what SimpleAiPlayer does for red) sends the
    // catapults and the archer into the raiders alone, and the normchels lose the fight that is left. Sending the
    // normchels ahead with the archer and the catapults behind them kills the raiders first; then the catapults
    // shoot both bastions and the town down to 0 hp from 5 hexes, and a normchel walks through the gap into the
    // town. The economy is off for both sides: no production, and red (no town) does not go bankrupt.
    let map = new GameMap(
        {x: 15, y: 9},
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
                    {x: 3, y: 3, type: Catapult},
                    {x: 3, y: 5, type: Catapult},
                    {x: 3, y: 4, type: Archer},
                    {x: 1, y: 3, type: Normchel},
                    {x: 1, y: 5, type: Normchel}
                ]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                playerType: 'SimpleAiPlayer',
                economyEnabled: false,
                towns: [{x: 14, y: 4}],
                bastions: [{x: 13, y: 3}, {x: 13, y: 4}],
                units: [
                    {x: 8, y: 3, type: KOHb},
                    {x: 8, y: 5, type: KOHb},
                    {x: 9, y: 4, type: KOHb}
                ]
            }
        ],
        [],
        coordDictionary([]),
        coordDictionary([[13, 2], [14, 2], [13, 5], [14, 6]]),
        coordDictionary([]),
        coordDictionary([])
    )
    map.testName = 'tutorial 13'
    return map
}

function createTutorial14Map() {
    // Grow your economy: an open 15x9 plain, mirror-symmetric around column 7. Red's town (2,4) has only its
    // noob but 100 gold; blue's town (12,4) (SimpleAiPlayerWithEconomy, 60 gold) has a head start of 2 noobs and
    // an archer. Each side owns the land of its 5 home columns (red x 0..4, blue x 10..14), where suburbs are
    // cheap (3 gold two hexes from the town, 5 at three hexes) and each pays +1 gold a turn; a farm (32 gold)
    // pays +4. Spending the gold on noobs at once (what SimpleAiPlayerWithEconomy does for red) keeps
    // red's income near 4, the noobs walk into blue's head start one by one and red loses its town by round 25.
    // Buying the cheap suburbs and farms first lifts red's income from 10 to over 40 in 4 turns; blue only moves
    // through hexes red sees, so it waits; then the bigger income buys barracks and a mixed army that wipes blue
    // out before round 40.
    let band = (fromX, toX) => {
        let cells = []
        for (let x = fromX; x <= toX; ++x) {
            for (let y = 0; y < 9; ++y) {
                cells.push({x: x, y: y})
            }
        }
        return cells
    }
    let townSuburbs = (x, y, expansionCells) => ({
        town: {x: x, y: y},
        cells: [{x: x, y: y}].concat(neighborhood[x & 1].map(offset => ({x: x + offset[0], y: y + offset[1]}))),
        expansionCells: expansionCells
    })
    let map = new GameMap(
        {x: 15, y: 9},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                gold: 100,
                towns: [{x: 2, y: 4}],
                suburbs: [townSuburbs(2, 4, band(0, 4))]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                playerType: 'SimpleAiPlayerWithEconomy',
                gold: 60,
                towns: [{x: 12, y: 4}],
                suburbs: [townSuburbs(12, 4, band(10, 14))],
                units: [
                    {x: 10, y: 3, type: Noob},
                    {x: 10, y: 5, type: Noob},
                    {x: 11, y: 4, type: Archer}
                ]
            }
        ],
        [],
        coordDictionary([]),
        coordDictionary([]),
        coordDictionary([]),
        coordDictionary([])
    )
    map.testName = 'tutorial 14'
    return map
}

function createTutorial15Map() {
    // Fortify in time: red's town (2,4) sits behind a mountain line at column 5 whose only gap is the gate
    // (5,3),(5,4). Blue's wave (SimpleAiPlayer: 6 normchels, 4 archers, economy off) starts at columns 14..16,
    // 4-5 rounds of marching from the gate. Red's farmland road (6..13,4) is part of its town's suburbs, so the
    // approach lies in red's sight and blue (which only moves through hexes red sees) marches in at once.
    // Red's 70 gold pays for 2 towers (30 each) and the walls (2 each); both take 4 turns. Spending it on units (what
    // SimpleAiPlayerWithEconomy does for red) sends them out to meet the wave and red loses the town by round 9.
    // Ordering towers (4,3),(4,5) and walls in the gate (5,3),(5,4) on turn 1 finishes them in round 4, when the
    // wave reaches the gate; the archers stand on the towers (range 3) and shoot the normchels hacking at the
    // walls, and the town still stands at round 16.
    let band = (fromX, toX) => {
        let cells = []
        for (let x = fromX; x <= toX; ++x) {
            for (let y = 0; y < 9; ++y) {
                cells.push({x: x, y: y})
            }
        }
        return cells
    }
    let mountains = [[5, 0], [5, 1], [5, 2], [5, 5], [5, 6], [5, 7], [5, 8]]
    let road = []
    for (let x = 6; x <= 13; ++x) {
        road.push({x: x, y: 4})
    }
    let map = new GameMap(
        {x: 18, y: 9},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                gold: 70,
                towns: [{x: 2, y: 4}],
                suburbs: [{
                    town: {x: 2, y: 4},
                    cells: [{x: 2, y: 4}].concat(neighborhood[0].map(offset => ({x: 2 + offset[0], y: 4 + offset[1]})), road),
                    expansionCells: band(0, 4).concat([{x: 5, y: 3}, {x: 5, y: 4}])
                }],
                units: [
                    {x: 2, y: 3, type: Archer},
                    {x: 2, y: 5, type: Archer}
                ]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                playerType: 'SimpleAiPlayer',
                economyEnabled: false,
                towns: [],
                units: [
                    {x: 14, y: 3, type: Normchel},
                    {x: 14, y: 4, type: Normchel},
                    {x: 14, y: 5, type: Normchel},
                    {x: 15, y: 2, type: Normchel},
                    {x: 15, y: 4, type: Normchel},
                    {x: 15, y: 6, type: Normchel},
                    {x: 15, y: 3, type: Archer},
                    {x: 15, y: 5, type: Archer},
                    {x: 16, y: 3, type: Archer},
                    {x: 16, y: 4, type: Archer}
                ]
            }
        ],
        [],
        coordDictionary([]),
        coordDictionary(mountains),
        coordDictionary([]),
        coordDictionary([])
    )
    map.testName = 'tutorial 15'
    return map
}

function createTutorial16Map() {
    // Close the Portals (co-op tutorial map). A lake (column 7, rows 0..7) splits the map; its only ford is
    // (7,8) at the bottom. Behind it three melee portals (10,1), (11,4), (10,6) send a Brute every 4 rounds
    // from round 4 and three Imps wait in front of them. Red's town (1,4) has 2 catapults (2,3), (2,5) behind
    // 3 normchels (3,3), (3,4), (3,5) and 30 gold (the army costs a little more than the town earns).
    // Chasing the demons through the ford bleeds the army while the far portal keeps spawning; marching the
    // normchels up to the lake shore with the catapults behind them destroys every portal from across the
    // water (range 2-5, 4 damage to a 12 hp portal), after which the remaining demons can be cleaned up.
    let lakes = []
    for (let y = 0; y <= 7; ++y) {
        lakes.push([7, y])
    }
    let map = new GameMap(
        {x: 15, y: 9},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                gold: 30,
                towns: [{x: 1, y: 4}],
                units: [
                    {x: 2, y: 3, type: Catapult},
                    {x: 2, y: 5, type: Catapult},
                    {x: 3, y: 3, type: Normchel},
                    {x: 3, y: 4, type: Normchel},
                    {x: 3, y: 5, type: Normchel}
                ]
            }
        ],
        [],
        coordDictionary(lakes),
        coordDictionary([]),
        coordDictionary([]),
        coordDictionary([]),
        {type: 'rectangular'},
        {
            tutorial: true,
            units: [
                {x: 9, y: 2, type: Imp},
                {x: 9, y: 8, type: Imp},
                {x: 11, y: 7, type: Imp}
            ]
        }
    )
    map.portals = [
        {x: 10, y: 1, category: 'melee'},
        {x: 11, y: 4, category: 'melee'},
        {x: 10, y: 6, category: 'melee'}
    ]
    map.testName = 'tutorial 16'
    return map
}

const tutorials = [
    {id: 'tutorial-1', title: 'Tutorial 1', pass: 'enemyUnitsDead', get map() { return createTutorial1Map() }},
    {id: 'tutorial-2', title: 'Tutorial 2', pass: 'enemyUnitsDead', get map() { return createTutorial2Map() }},
    {id: 'tutorial-3', title: 'Tutorial 3', pass: 'enemyLost', get map() { return createTutorial3Map() }},
    {id: 'tutorial-4', title: 'Tutorial 4', pass: 'enemyLost', get map() { return createTutorial4Map() }},
    {id: 'tutorial-5', title: 'Tutorial 5', pass: 'coopVictory', get map() { return createTutorial5Map() }},
    {id: 'tutorial-6', title: 'Tutorial 6', pass: 'coopVictory', get map() { return createTutorial6Map() }},
    {id: 'tutorial-7', title: 'Tutorial 7: High Ground', pass: 'enemyUnitsDead', get map() { return createTutorial7Map() }},
    {id: 'tutorial-8', title: 'Tutorial 8: Through the Bushes', pass: 'enemyUnitsDead', get map() { return createTutorial8Map() }},
    {id: 'tutorial-9', title: 'Tutorial 9: Cavalry Raid', pass: 'captureTowns', targets: [{x: 14, y: 7}],
        get map() { return createTutorial9Map() }},
    {id: 'tutorial-10', title: 'Tutorial 10: Hold the Bridge', pass: 'enemyUnitsDead', get map() { return createTutorial10Map() }},
    {id: 'tutorial-11', title: 'Tutorial 11: Rotate and Heal', pass: 'surviveRounds', rounds: 12,
        get map() { return createTutorial11Map() }},
    {id: 'tutorial-12', title: 'Tutorial 12: Scout First', pass: 'enemyUnitsDead', get map() { return createTutorial12Map() }},
    {id: 'tutorial-13', title: 'Tutorial 13: Escort the Catapults', pass: 'captureTowns', targets: [{x: 14, y: 4}],
        get map() { return createTutorial13Map() }},
    {id: 'tutorial-14', title: 'Tutorial 14: Grow Your Economy', pass: 'enemyLost', get map() { return createTutorial14Map() }},
    {id: 'tutorial-15', title: 'Tutorial 15: Fortify in Time', pass: 'surviveRounds', rounds: 16,
        get map() { return createTutorial15Map() }},
    {id: 'tutorial-16', title: 'Tutorial 16: Close the Portals', pass: 'coopVictory', get map() { return createTutorial16Map() }}
]
// An entry may set startRound: N (the game starts at gameRound N, so round counters and the
// co-op wave schedule follow it) and suddenDeathRound (default the normal round 40).
for (const tutorial of tutorials) {
    const createMap = Object.getOwnPropertyDescriptor(tutorial, 'map').get
    Object.defineProperty(tutorial, 'map', {
        get() {
            const map = createMap.call(tutorial)
            map.startRound = tutorial.startRound || 0
            return map
        }
    })
}
