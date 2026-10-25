// Hand-made tutorial maps. The human always plays red (slot 1, fog of war) against
// blue (slot 2, an AI player). `pass` picks the win rule (TutorialManager.isPassed):
// 'enemyUnitsDead' every blue unit is dead, 'enemyLost' blue has no towns and no units,
// 'coopVictory' the co-op result is victory while red still owns a town,
// 'captureTowns' red owns every town of `targets` [{x, y}], 'surviveRounds' gameRound
// reaches `rounds` while red still owns a town (a unit if the map gives red no town).
// Unit classes load after this file, so each map is built on access.
// First contact teaches moving through fog and concentrating two attacks.
// Border scenery leaves the entire interior approach and combat area open.
function createTutorial0Map() {
    const map = new GameMap({x: 9, y: 7}, [
        {rgb: {r: 208, g: 208, b: 208}, towns: []},
        {rgb: {r: 255, g: 0, b: 0}, economyEnabled: false, towns: [],
            units: [{x: 2, y: 3, type: Noob}, {x: 2, y: 4, type: Noob}]},
        {rgb: {r: 98, g: 168, b: 222}, playerType: 'SimpleAiPlayer',
            economyEnabled: false, towns: [], units: [{x: 5, y: 3, type: KOHb}]}
    ], [], coordDictionary([[0, 0], [1, 0]]), coordDictionary([[7, 6], [8, 6]]), [])
    map.testName = 'tutorial 0'
    return map
}

// Moving around: two red noobs (one hurt) face two blue noobs straight up column 4.
// Scenery hugs the side borders, away from the units and the column between them.
function createTutorial16Map() {
    const map = new GameMap({x: 9, y: 7}, [
        {rgb: {r: 208, g: 208, b: 208}, towns: []},
        {rgb: {r: 255, g: 0, b: 0}, economyEnabled: false, towns: [],
            units: [{x: 4, y: 4, type: Noob, hp: 1}, {x: 4, y: 5, type: Noob, hp: 2}]},
        {rgb: {r: 98, g: 168, b: 222}, playerType: 'SimpleAiPlayer', economyEnabled: false, towns: [],
            units: [{x: 4, y: 3, type: Noob, hp: 2}, {x: 4, y: 2, type: Noob, hp: 2}]}
    ], [], coordDictionary([[0, 0], [1, 0], [0, 1]]), coordDictionary([[8, 5], [8, 6], [7, 6]]),
    coordDictionary([[0, 5], [0, 6], [8, 0], [8, 1]]))
    map.testName = 'tutorial 16'
    return map
}

// Shield and bow: two red noobs meet a blue normchel (vanguard) with an archer behind it.
// Scenery sits in the corners, away from the units and the route between them.
function createTutorial17Map() {
    const map = new GameMap({x: 9, y: 7}, [
        {rgb: {r: 208, g: 208, b: 208}, towns: []},
        {rgb: {r: 255, g: 0, b: 0}, economyEnabled: false, towns: [],
            units: [{x: 4, y: 3, type: Noob}, {x: 4, y: 4, type: Noob}]},
        {rgb: {r: 98, g: 168, b: 222}, playerType: 'SimpleAiPlayer', economyEnabled: false, towns: [],
            units: [{x: 5, y: 3, type: Normchel}, {x: 6, y: 4, type: Archer}]}
    ], [], coordDictionary([[0, 5], [0, 6], [1, 6]]), coordDictionary([[8, 0], [7, 0], [8, 1]]),
    coordDictionary([[0, 0], [1, 0], [8, 5], [8, 6]]))
    map.testName = 'tutorial 17'
    return map
}

// Expand: a lone red noob next to a neutral town with 1 hp left; red's economy is on, so the
// captured town pays for an army against blue's three noobs and archer, which march from the
// far side from blue's first turn (ignoresFog: blue paths through hexes red cannot see). Scenery lies along the top and bottom borders, away from the units, the town and
// the rows between the two sides.
function createTutorial18Map() {
    const map = new GameMap({x: 16, y: 9}, [
        {rgb: {r: 208, g: 208, b: 208}, towns: [{x: 2, y: 4, hp: 1}]},
        {rgb: {r: 255, g: 0, b: 0}, towns: [], units: [{x: 1, y: 4, type: Noob}]},
        {rgb: {r: 98, g: 168, b: 222}, playerType: 'SimpleAiPlayer', economyEnabled: false, ignoresFog: true, towns: [],
            units: [{x: 14, y: 3, type: Noob}, {x: 14, y: 4, type: Noob}, {x: 14, y: 5, type: Noob},
                {x: 15, y: 4, type: Archer}]}
    ], [], coordDictionary([[5, 0], [6, 0]]), coordDictionary([[9, 8], [10, 8]]),
    coordDictionary([[0, 0], [0, 8], [15, 0], [15, 8]]))
    map.testName = 'tutorial 18'
    return map
}

function createTutorial1Map() {
    // Red stands on the left, blue on the right, along a hedge of bushes (column 5) with a
    // single gap at (5,3). Blue's two normchels stand in the hedge, its noob blocks the gap
    // and its archer waits behind the noob. Bushes block shots, so the gap is the only line
    // of fire through the hedge: the red archer can hit only the blue noob (dmg 2 = hp 2),
    // and with the noob dead the red noob in front of the gap runs through it and kills the
    // blue archer (hp 1); the other two noobs both hit one normchel. Then red's 4 units
    // out-damage the two normchels. Hitting the nearest normchels instead (what SimpleAiPlayer
    // does for red) leaves the archer shooting through the gap and loses.
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
                    {x: 4, y: 2, type: Noob},
                    {x: 4, y: 3, type: Noob},
                    {x: 4, y: 4, type: Noob},
                    {x: 3, y: 3, type: Archer}
                ]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                playerType: 'SimpleAiPlayer',
                towns: [],
                units: [
                    {x: 5, y: 2, type: Normchel},
                    {x: 5, y: 3, type: Noob},
                    {x: 5, y: 4, type: Normchel},
                    {x: 6, y: 3, type: Archer}
                ]
            }
        ],
        [],
        // A western pond and two low ridges frame the fighting ground. Keep the
        // central approach, firing gap and both melee pairs untouched.
        coordDictionary([[1, 2], [1, 3], [2, 2], [2, 3]]),
        coordDictionary([[2, 5], [3, 5], [3, 6], [7, 0], [7, 1], [8, 1]]),
        // Thicken the hedge's ends, away from the lesson's targets and sight line.
        coordDictionary([[5, 0], [5, 1], [5, 2], [5, 4], [5, 5], [5, 6],
            [4, 0], [4, 1], [6, 5], [6, 6]])
    )
    map.testName = 'tutorial 1'
    return map
}

function createTutorial2Map() {
    // Blue's 4 normchels and 8 archers face red's 2 normchels and 2 archers.
    // Red can retreat along the clear road to its town and barrack, through the
    // mountain gate in column 11 (rows 3-5). Blue has no town, so its economy is
    // disabled to prevent salaries from disbanding its army.
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
                    {x: 1, y: 2, type: Archer},
                    {x: 1, y: 3, type: Archer},
                    {x: 1, y: 4, type: Archer},
                    {x: 1, y: 5, type: Archer},
                    {x: 1, y: 6, type: Archer},
                    {x: 1, y: 1, type: Archer},
                    {x: 1, y: 7, type: Archer},
                    {x: 0, y: 4, type: Archer},
                ]
            }
        ],
        [],
        // Widen the northern pond and southern ridge along the road, keeping rows
        // 3-5 clear through the gate and the town's deployment area unobstructed.
        coordDictionary([[8, 0], [9, 0], [8, 1], [9, 1], [10, 0], [6, 0], [7, 0], [7, 1], [10, 1]]),
        coordDictionary([[8, 7], [8, 8], [9, 8], [10, 8], [11, 0], [11, 1], [11, 2], [11, 6], [11, 7], [11, 8],
            [6, 7], [6, 8], [7, 7], [7, 8], [9, 7]]),
        // Two thickets frame the field and a third sits behind the northern spur.
        // None crosses the retreat road or the archers' central lines of fire.
        coordDictionary([[4, 0], [4, 1], [5, 1], [4, 7], [4, 8], [5, 7], [12, 1], [13, 1], [13, 0]])
    )
    map.testName = 'tutorial 2'
    return map
}

function createTutorial3Map() {
    // The three adjacent archer towers cover the approach and protect one another; blue
    // holds them with three archers and a normchel behind them (no ember archers). Red's
    // army starts in one column x = 9, four hexes from the towers: the upper four units on
    // rows 0-3, the lower four on rows 4-7, row 8 empty. Catapults break the towers while
    // the army holds, then advance through the breach to capture the town.
    // The map is 11 wide; lakes shelter the rear corners, mountain shoulders frame
    // the field, and bushes mark the flanks without blocking the central siege/withdrawal routes.
    let wallLine = []
    for (let y = 0; y < 9; ++y) {
        if (y != 3 && y != 4 && y != 5) {
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
                    {x: 9, y: 0, type: Archer},
                    {x: 9, y: 1, type: Normchel},
                    {x: 9, y: 2, type: KOHb},
                    {x: 9, y: 3, type: Catapult},
                    {x: 9, y: 4, type: Catapult},
                    {x: 9, y: 5, type: KOHb},
                    {x: 9, y: 6, type: Normchel},
                    {x: 9, y: 7, type: Archer}
                ]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                playerType: 'TutorialDefenderAiPlayer',
                gold: 40,
                towns: [{x: 2, y: 4}],
                suburbs: [{
                    town: {x: 2, y: 4},
                    cells: [{x: 2, y: 4}],
                    expansionCells: blueSide
                }],
                walls: wallLine,
                towers: [{x: 5, y: 3}, {x: 5, y: 5}, {x: 5, y: 4}],
                units: [
                    {x: 5, y: 3, type: Archer},
                    {x: 5, y: 5, type: Archer},
                    {x: 4, y: 3, type: Normchel},
                    {x: 5, y: 4, type: Archer}
                ]
            }
        ],
        [],
        coordDictionary([[0, 0], [1, 0], [0, 1], [0, 7], [0, 8], [1, 8], [1, 1], [1, 7]]),
        coordDictionary([[8, 0], [8, 1], [8, 7], [8, 8], [7, 0], [7, 8]]),
        coordDictionary([[2, 0], [3, 1], [2, 8], [3, 7], [6, 1], [6, 7]])
    )
    map.testName = 'tutorial 3'
    return map
}

function createTutorial5Map() {
    // Town defense against demons (co-op tutorial map). Red's town (1,4) owns the whole strip x <= 4 as
    // suburbs (a rich town: it pays for the army it builds after the first turns). Walls face the demons only
    // on the column x = 4, with two gates (4,3) and (4,5) the KOHb sortie through. Red starts with 2 KOHb, the
    // town's noob, a barrack and 77 gold: with the first turn's income that is 119, exactly 2 more KOHb. The map
    // is 9 wide: 8 ember archers, a bulwark and two Bombards crowd the field x 5..7 right in front of the walls,
    // and two ranged portals, a heavy one and a siege one on the last column x = 8 send more every 4 rounds.
    // The Bombards (building damage only) breach the walls within a few rounds, so merely waiting behind them
    // loses, and so does attacking at once. Training KOHb every round while holding until round 4 (the KOHb
    // only pick off the ember archers they reach; the walls take the first volleys and wounded units heal on
    // the town's suburbs), then striking out of the gates, ember archers first, finishing wounded demons, and
    // killing every wave as it steps off its portal wins (pass 'demonUnitsDead': the portals may still stand; a
    // demon on its portal cannot be hit, the portal takes the blow). The gates and the walls' open ends stay
    // passable: the sortie needs them.
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
        {x: 9, y: 9},
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
                    {x: 4, y: 1}, {x: 4, y: 2}, {x: 4, y: 4}, {x: 4, y: 6}, {x: 4, y: 7}
                ],
                units: [
                    {x: 1, y: 1, type: KOHb},
                    {x: 2, y: 6, type: KOHb}
                ]
            }
        ],
        [],
        // Lakes guard the town's back corners; two more lie in the demons' field.
        coordDictionary([[0, 0], [0, 1], [0, 7], [0, 8], [6, 5], [8, 3]]),
        // Mountains on the field's flanks and in front of the south wall stop arrows and block the way.
        coordDictionary([[5, 6], [6, 0], [5, 8], [5, 5]]),
        // Bushes inside the walls stop the ember archers' arrows; the others grow in the field.
        coordDictionary([[2, 1], [3, 6], [1, 7], [7, 1], [6, 8], [5, 0]]),
        [],
        {type: 'rectangular'},
        {
            tutorial: true,
            units: [
                {x: 5, y: 1, type: Bombard},
                {x: 7, y: 6, type: Bombard},
                {x: 6, y: 7, type: Bulwark},
                {x: 7, y: 3, type: EmberArcher},
                {x: 7, y: 8, type: EmberArcher},
                {x: 5, y: 3, type: EmberArcher},
                {x: 5, y: 7, type: EmberArcher},
                {x: 7, y: 5, type: EmberArcher},
                {x: 6, y: 6, type: EmberArcher},
                {x: 6, y: 2, type: EmberArcher},
                {x: 6, y: 4, type: EmberArcher}
            ]
        }
    )
    map.portals = [
        {x: 8, y: 2, category: 'ranged'},
        {x: 8, y: 4, category: 'ranged'},
        {x: 8, y: 7, category: 'heavy'},
        {x: 8, y: 5, category: 'siege'}
    ]
    map.testName = 'tutorial 5'
    return map
}

function createTutorial6Map() {
    // Twelve typed portals share the open eastern battlefield (five of them mage). Starting defenders occupy
    // their own portals; chaos starts empty and follows the game's chaos schedule (a demon lord every 4
    // rounds from round 28). Red's archers start further west at (8,7), (8,4) and (10,4), so they can
    // retreat to the towns in time.
    let size = {x: 16, y: 9}
    let towns = [{x: 1, y: 4}, {x: 6, y: 4}]
    // Hex distance in the x-parity offset layout of sprites/sprite.js.
    let distance = (a, b) => {
        let dq = a.x - b.x
        let dr = (a.y - (a.x - (a.x & 1)) / 2) - (b.y - (b.x - (b.x & 1)) / 2)
        return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
    }
    // A town's suburbs: every cell within 2 steps, nearest first.
    let suburbsOf = town => {
        let cells = []
        for (let x = 0; x < size.x; ++x) {
            for (let y = 0; y < size.y; ++y) {
                if (distance(town, {x: x, y: y}) <= 2) {
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
                gold: 400,
                towns: towns,
                suburbs: towns.map(town => ({town: town, cells: suburbsOf(town), expansionCells: suburbsOf(town)})),
                barracks: [{x: 1, y: 3, town: {x: 1, y: 4}}, {x: 6, y: 3, town: {x: 6, y: 4}}],
                units: [
                    {x: 10, y: 3, type: Normchel},
                    {x: 8, y: 7, type: Archer},
                    {x: 8, y: 4, type: Archer},
                    {x: 10, y: 7, type: KOHb},
                    {x: 10, y: 4, type: Archer}
                ]
            }
        ],
        [],
        // Preserve the northern lakes and the lake at the south-east edge.
        coordDictionary([[13, 8], [1, 0], [1, 1], [3, 1], [4, 1], [6, 1], [7, 1], [8, 2], [9, 0]]),
        // Preserve the northern mountains and the southern edge.
        coordDictionary([[3, 8], [4, 8], [8, 8], [9, 8], [15, 0], [2, 2], [5, 1], [9, 1]]),
        // Bushes around the front town give the returning archers cover.
        coordDictionary([[5, 2], [7, 5], [5, 6], [4, 2], [4, 6]]),
        [],
        {type: 'rectangular'},
        {
            tutorial: true,
            // The demons start standing on their portals; a portal spawns only once its hex is free.
            units: [
                {x: 10, y: 1, type: Hexcaster},
                {x: 10, y: 2, type: Bulwark},
                {x: 11, y: 2, type: Bulwark},
                {x: 12, y: 2, type: Hexcaster},
                {x: 12, y: 5, type: Brute},
                {x: 11, y: 6, type: Hexcaster},
                {x: 12, y: 6, type: Bulwark},
                {x: 10, y: 6, type: Bombard},
                {x: 9, y: 2, type: Brute},
                {x: 13, y: 2, type: Hexcaster},
                {x: 13, y: 6, type: Hexcaster}
            ]
        }
    )
    map.portals = [
        {x: 10, y: 1, category: 'mage'},
        {x: 10, y: 2, category: 'heavy'},
        {x: 11, y: 2, category: 'heavy'},
        {x: 12, y: 2, category: 'mage'},
        {x: 12, y: 5, category: 'melee'},
        {x: 11, y: 6, category: 'mage'},
        {x: 12, y: 6, category: 'heavy'},
        {x: 10, y: 6, category: 'siege'},
        {x: 9, y: 2, category: 'melee'},
        {x: 7, y: 7, category: 'chaos'},
        {x: 13, y: 2, category: 'mage'},
        {x: 13, y: 6, category: 'mage'}
    ]
    map.testName = 'tutorial 6'
    return map
}

function createTutorial7Map() {
    // High ground: red holds a plateau behind a mountain ridge (column 5) with a 2-hex pass (5,3)-(5,4).
    // Red's own tower (3,4) stands empty behind the pass mouth and two hills (4,2) and (4,6), drawn as hills, flank
    // the pass behind the ridge; each of red's 3 archers is one step from one of them. An archer on the tower or a
    // hill shoots 3 hexes and sees and shoots over bushes and mountains. Red's 3 normchels plug the pass exits
    // (4,3) (4,4) (4,5). Blue pushes 4 normchels and 2 KOHb at the pass while its 3 archers (range 2) wait behind
    // bushes (8,3) (8,5). From the tower and the hills red shoots everything that comes into the pass before blue's
    // archers get in range. Walking down through the pass to fight (what SimpleAiPlayer does for red) gets the
    // normchels surrounded in the open and then the archers overrun.
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
                // GameMap.start paints the tower's hex red.
                towers: [{x: 3, y: 4}],
                units: [
                    {x: 3, y: 3, type: Archer},
                    {x: 3, y: 2, type: Archer},
                    {x: 3, y: 6, type: Archer},
                    {x: 4, y: 3, type: Normchel},
                    {x: 4, y: 4, type: Normchel},
                    {x: 4, y: 5, type: Normchel}
                ]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                playerType: 'SimpleAiPlayer',
                towns: [],
                units: [
                    {x: 7, y: 3, type: Normchel},
                    {x: 7, y: 4, type: Normchel},
                    {x: 7, y: 5, type: Normchel},
                    {x: 8, y: 4, type: Normchel},
                    {x: 8, y: 2, type: KOHb},
                    {x: 8, y: 6, type: KOHb},
                    {x: 9, y: 3, type: Archer},
                    {x: 9, y: 5, type: Archer},
                    {x: 10, y: 4, type: Archer}
                ]
            }
        ],
        [],
        // Ponds spread along the plateau's rear banks, away from the archer deployment hexes.
        coordDictionary([[0, 0], [0, 1], [0, 8], [1, 8], [11, 0], [11, 8],
            [0, 2], [1, 1], [1, 2], [0, 6], [0, 7], [1, 7]]),
        // Wider ridge shoulders frame the hills; only (5,3) and (5,4) lead onto red's plateau.
        coordDictionary([[5, 0], [5, 1], [5, 2], [5, 5], [5, 6], [5, 7], [5, 8],
            [4, 0], [4, 1], [4, 7], [4, 8], [6, 0], [6, 8]]),
        // Bushes hide blue's archers from the low ground, not from the tower or the hills.
        coordDictionary([[8, 3], [8, 5], [9, 1], [9, 7], [8, 1], [10, 1], [10, 2],
            [8, 7], [10, 7], [10, 6]]),
        coordDictionary([[4, 2], [4, 6]])
    )
    map.testName = 'tutorial 7'
    return map
}

function createTutorial8Map() {
    // Through the bushes: blue holds a line behind a river. The river (lakes down column 8) springs from a band of
    // bushes along the top of a 15x9 map and has a single ford (8,7) near its mouth; blue's 2 normchels guard the
    // ford's far bank and its 3 archers stand behind the river covering the ford and the open field. Lakes do not
    // stop arrows, bushes do: an archer can shoot into a bush hex but not past it. Red (3 normchels, 2 noobs) starts
    // on the left. Walking at the nearest blue unit (what SimpleAiPlayer does for red) crosses the open field into
    // the archers' fire and fights the screen in the ford. The bush band crosses the river at its source and ends
    // in a thicket on the archers' flank: walking in its outer row red sees nothing and is seen by nobody, so blue
    // (which only moves into hexes red sees) keeps facing the ford; from the thicket red falls on the archers.
    // Both sides keep their army without paying for it (economy off), so waiting in the bushes costs nothing.
    let bushes = []
    for (let x = 1; x <= 12; ++x) {
        bushes.push([x, 0], [x, 1])
    }
    // The thicket on blue's flank.
    bushes.push([12, 2], [13, 0], [13, 1], [13, 2])
    // A deeper near-bank thicket keeps the concealed approach legible beside the open ford route.
    bushes.push([3, 2], [4, 2], [5, 2], [6, 2])
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
                    {x: 1, y: 4, type: Normchel},
                    {x: 2, y: 4, type: Normchel},
                    {x: 1, y: 5, type: Normchel},
                    {x: 1, y: 3, type: Noob},
                    {x: 2, y: 3, type: Noob}
                ]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                playerType: 'SimpleAiPlayer',
                economyEnabled: false,
                towns: [],
                units: [
                    {x: 9, y: 6, type: Normchel},
                    {x: 9, y: 7, type: Normchel},
                    {x: 10, y: 4, type: Archer},
                    {x: 11, y: 5, type: Archer},
                    {x: 10, y: 6, type: Archer}
                ]
            }
        ],
        [],
        // The river keeps its single ford (8,7); a near-bank pond breaks up the open field.
        coordDictionary([[8, 2], [8, 3], [8, 4], [8, 5], [8, 6], [8, 8], [0, 7], [0, 8], [1, 8], [5, 4], [5, 5], [6, 4]]),
        // Low ridges frame the southern approach and far bank without closing the ford or firing lanes.
        coordDictionary([[4, 7], [4, 8], [5, 8], [14, 7], [14, 8], [13, 8], [5, 7], [6, 7], [6, 8], [13, 6], [14, 6]]),
        coordDictionary(bushes),
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
    // red: it heads for the nearest enemy building) runs into the army and loses. Walking the normchels up the
    // road as bait until blue's army sees them (it turns on them) while the KOHb (speed 4) ride around the
    // mountains reaches the town long before blue's army (speed 2) can turn back; the KOHb knock the healing town
    // down to 0 hp again and step in. The detour runs through a wood (bushes) between a peak and a pond on the
    // north edge; a pond and rocks lie on the road's south edge, bushes along the road.
    let mountains = []
    for (let x = 2; x <= 12; ++x) {
        mountains.push([x, 4])
    }
    // Broaden the northern peak and ridge shoulders without narrowing either end pass.
    mountains.push([6, 0], [7, 0], [0, 8], [7, 1], [5, 3], [10, 3])
    let lakes = [[10, 0], [11, 0], [3, 8], [4, 8], [12, 8], [11, 1], [13, 8], [3, 7]]
    let bushes = [[3, 1], [4, 1], [4, 2], [8, 1], [9, 2], [10, 2], [6, 6], [10, 7], [11, 5], [3, 2], [5, 1], [8, 2], [11, 6], [12, 6]]
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
        coordDictionary(lakes),
        coordDictionary(mountains),
        coordDictionary(bushes),
        coordDictionary([])
    )
    map.testName = 'tutorial 9'
    return map
}

function createTutorial10Map() {
    // Hold the bridge: a river (column 5, every row but 4, widening into the lakes (4,8), (6,0) and (6,8)) splits
    // an 11x9 map; the bridge (5,4) is its only passable hex, and the lake hex (4,5) leaves the bridge a single
    // exit on red's side, (4,4). Blue's 8 noobs and 2 archers start on the far side (columns 8..10); red's 2
    // normchels stand at the exit and its 2 archers behind it, one on a hill (3,3) (+1 range over the bridge).
    // Crossing the bridge (what SimpleAiPlayer does for red) gets red surrounded by the noobs on the open far
    // bank. Holding the exit with one normchel (the other relieves it when wounded) means only the unit on the
    // bridge can strike it, while red's archers shoot whoever queues on the bridge; once blue's numbers are
    // gone red crosses and finishes the rest. Broad river pools, short ridges and linked thickets frame both banks away from the bridge, so
    // the archers' lines of fire onto the bridge stay open. The economy is off for both sides: without towns the
    // upkeep would bankrupt blue's 10 units by round 8 and win the map for a red that just waits.
    let lakes = [[4, 5], [6, 0], [6, 8], [4, 8], [4, 0], [4, 1], [4, 7], [6, 7]]
    for (let y = 0; y < 9; ++y) {
        if (y != 4) {
            lakes.push([5, y])
        }
    }
    let mountains = [[0, 0], [1, 0], [0, 8], [10, 0], [10, 8], [1, 1], [1, 8], [2, 8], [10, 1], [10, 7]]
    let bushes = [[1, 2], [2, 6], [1, 7], [8, 0], [9, 1], [8, 7], [9, 8], [0, 2], [1, 3], [1, 6], [2, 7], [8, 1], [9, 0], [8, 8], [9, 7]]
    let hills = [[3, 3]]
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
        coordDictionary(mountains),
        coordDictionary(bushes),
        coordDictionary(hills)
    )
    map.testName = 'tutorial 10'
    return map
}

function createTutorial11Map() {
    // Rotate and heal: three wounded normchels and the town's noob face twelve enemies.
    // Keep the six suburbs clear for healing. The inner rocks split the approach into
    // a central fight and flank paths, giving injured fighters room to rotate behind
    // fresh ones. Every blue unit can join under normal fog; no remote idle wave.
    // Lakes behind town and the eastern pond, mountain shoulders and wooded flanks
    // preserve the landscape. Economy stays off; survive twelve rounds with the
    // original army. Charging and standing still both lose in the balance controls.
    let lakes = [[0, 0], [0, 1], [1, 0], [0, 7], [0, 8], [1, 8], [10, 4], [11, 4], [11, 5], [10, 5], [12, 4]]
    let mountains = [[3, 0], [4, 0], [5, 0], [3, 8], [4, 8], [5, 8], [8, 0], [9, 0], [8, 8], [9, 8], [10, 0], [3, 2], [3, 6], [3, 3], [2, 2], [2, 6]]
    let bushes = [[2, 1], [2, 7], [8, 1], [9, 1], [8, 7], [9, 7], [12, 2], [12, 6], [13, 6], [7, 1], [7, 7], [10, 7]]
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
                    {x: 6, y: 1, type: Noob},
                    {x: 6, y: 2, type: Noob},
                    {x: 7, y: 5, type: Normchel},
                    {x: 5, y: 1, type: Noob},
                    {x: 5, y: 7, type: Noob},
                    {x: 6, y: 7, type: Noob},
                    {x: 7, y: 3, type: Noob}
                ]
            }
        ],
        [],
        coordDictionary(lakes),
        coordDictionary(mountains),
        coordDictionary(bushes),
        coordDictionary([])
    )
    map.testName = 'tutorial 11'
    return map
}

function createTutorial13Map() {
    // Escort the catapults: blue's town (14,4) sits in a pocket of mountains closed on the west by three walls
    // (12,3)-(12,5). Archers on the towers (14,3) and (14,5) shoot 3 hexes over anything, so every hex in front of
    // the walls is under their arrows, with two more tower archers behind the walls. Three KOHb raiders (speed 4) wait in
    // the fog east of a mountain ridge whose only pass is (6,3)-(6,5). Catapults are the only red units that hurt
    // buildings from range (2..5 hexes, 4 damage), but they have 1 hp and never hit units; nobody heals (red has
    // no town). Marching everything at the town (what SimpleAiPlayer does for red) sends the catapults and the
    // archers into the raiders alone, and the normchels left die at the walls under the towers' arrows; storming
    // the walls without the catapults fails the same way. Lining the normchels up in the pass with the archers and
    // the catapults behind them kills the raiders where they cannot reach the catapults; then the catapults shoot
    // the towers from 5 hexes (out of the archers' reach), knock the walls down and bring the town to 0 hp, and a
    // normchel walks in. The economy is off for both sides: no production, and red (no town) does not go bankrupt.
    let lakes = [[0, 0], [0, 1], [0, 8], [6, 2], [6, 6], [11, 8], [12, 8], [1, 0]]
    let mountains = [[6, 0], [6, 1], [6, 7], [6, 8], [13, 2], [14, 2], [15, 2], [13, 5], [14, 6], [15, 5], [15, 0], [15, 8], [5, 0]]
    let bushes = [[3, 0], [3, 8], [8, 1], [8, 7], [10, 0], [10, 8], [4, 8]]
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
                towns: [],
                units: [
                    {x: 3, y: 3, type: Catapult},
                    {x: 3, y: 5, type: Catapult},
                    {x: 3, y: 4, type: Archer},
                    {x: 2, y: 4, type: Archer},
                    {x: 1, y: 3, type: Normchel},
                    {x: 1, y: 4, type: Normchel},
                    {x: 1, y: 5, type: Normchel},
                    {x: 2, y: 3, type: Normchel}
                ]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                playerType: 'SimpleAiPlayer',
                economyEnabled: false,
                towns: [{x: 14, y: 4}],
                walls: [{x: 12, y: 3}, {x: 12, y: 4}, {x: 12, y: 5}],
                towers: [{x: 14, y: 3}, {x: 14, y: 5}, {x: 15, y: 3}, {x: 15, y: 4}],
                units: [
                    {x: 9, y: 3, type: KOHb},
                    {x: 9, y: 5, type: KOHb},
                    {x: 10, y: 4, type: KOHb},
                    {x: 14, y: 3, type: Archer},
                    {x: 14, y: 5, type: Archer},
                    {x: 15, y: 3, type: Archer},
                    {x: 15, y: 4, type: Archer}
                ]
            }
        ],
        [],
        coordDictionary(lakes),
        coordDictionary(mountains),
        coordDictionary(bushes),
        coordDictionary([])
    )
    map.testName = 'tutorial 13'
    return map
}

function createTutorial14Map() {
    // Town Duel: each town starts with its six neighbouring suburbs (the default first ring); a
    // field unit owns only the hex it stands on. Capture neutral land with the starting noob, then
    // pay for suburbs and farms before gathering an army. The central pass keeps the enemy head
    // start meaningful; corner terrain leaves both home valleys usable.
    let lakes = [[7, 2], [7, 6], [0, 0], [14, 0], [0, 8], [14, 8], [1, 0], [13, 0]]
    let mountains = [[7, 0], [7, 1], [7, 7], [7, 8], [6, 0], [8, 0], [6, 8], [8, 8], [1, 8], [13, 8]]
    let bushes = [[5, 1], [9, 1], [5, 7], [9, 7], [4, 0], [10, 0], [4, 8], [10, 8], [3, 0], [11, 0]]
    let hills = [[6, 3], [8, 3], [6, 5], [8, 5]]
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
                towns: [{x: 2, y: 4}]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                playerType: 'SimpleAiPlayerWithEconomy',
                gold: 180,
                towns: [{x: 12, y: 4}],
                units: [
                    {x: 10, y: 3, type: Noob},
                    {x: 10, y: 5, type: Noob},
                    {x: 11, y: 4, type: Archer}
                ]
            }
        ],
        [],
        coordDictionary(lakes),
        coordDictionary(mountains),
        coordDictionary(bushes),
        coordDictionary(hills)
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
    // walls, and the town still stands at round 16. Lakes guard the town's back corners; the mountain line
    // thickens at its ends (6,0),(6,8) and lakes (9..10,1),(9..10,7) funnel the field towards the road, so the wave
    // comes straight at the gate; bushes lie off the road (never in the towers' fire lines), and mountains close
    // the far corners. Connected ponds and thickets frame both sides of the open approach;
    // short ridge spurs stay outside the towers' three-hex fire lanes.
    let band = (fromX, toX) => {
        let cells = []
        for (let x = fromX; x <= toX; ++x) {
            for (let y = 0; y < 9; ++y) {
                cells.push({x: x, y: y})
            }
        }
        return cells
    }
    let mountains = [[5, 0], [5, 1], [5, 2], [5, 5], [5, 6], [5, 7], [5, 8], [17, 0], [17, 8], [6, 0], [6, 8], [7, 0], [7, 8], [16, 0], [16, 8]]
    let lakes = [[0, 0], [0, 1], [0, 7], [0, 8], [9, 1], [10, 1], [9, 7], [10, 7], [9, 0], [10, 0], [11, 1], [9, 8], [10, 8], [11, 7]]
    let bushes = [[1, 0], [1, 8], [8, 1], [7, 7], [12, 1], [12, 7], [13, 1], [12, 0], [13, 0], [13, 7], [12, 8], [13, 8]]
    let hills = []
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
        coordDictionary(lakes),
        coordDictionary(mountains),
        coordDictionary(bushes),
        coordDictionary(hills)
    )
    map.testName = 'tutorial 15'
    return map
}

const tutorials = [
    {id: 'tutorial-0', title: 'Tutorial 0: First Contact', pass: 'enemyUnitsDead', get map() { return createTutorial0Map() }},
    {id: 'tutorial-16', title: 'Tutorial 1: Moving Around', pass: 'enemyLost', get map() { return createTutorial16Map() }},
    {id: 'tutorial-17', title: 'Tutorial 2: Shield and Bow', pass: 'enemyLost', get map() { return createTutorial17Map() }},
    {id: 'tutorial-1', title: 'Tutorial 3: Pick Your Targets', pass: 'enemyUnitsDead', get map() { return createTutorial1Map() }},
    {id: 'tutorial-7', title: 'Tutorial 4: High Ground', pass: 'enemyUnitsDead', get map() { return createTutorial7Map() }},
    {id: 'tutorial-3', title: 'Tutorial 5: Break the Walls', pass: 'enemyLost', get map() { return createTutorial3Map() }},
    {id: 'tutorial-18', title: 'Tutorial 6: Expand', pass: 'enemyLost', get map() { return createTutorial18Map() }},
    {id: 'tutorial-2', title: 'Tutorial 7: Retreat and Rebuild', pass: 'enemyUnitsDead', get map() { return createTutorial2Map() }},
    {id: 'tutorial-5', title: 'Tutorial 8: Hold the Walls', pass: 'demonUnitsDead', get map() { return createTutorial5Map() }},
    {id: 'tutorial-15', title: 'Tutorial 9: Fortify in Time', pass: 'surviveRounds', rounds: 16,
        get map() { return createTutorial15Map() }},
    {id: 'tutorial-13', title: 'Tutorial 10: Escort the Catapults', pass: 'captureTowns', targets: [{x: 14, y: 4}],
        get map() { return createTutorial13Map() }},
    {id: 'tutorial-6', title: 'Tutorial 11: Lose a Town, Win the War', pass: 'coopVictory', startRound: 20,
        get map() { return createTutorial6Map() }},
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
