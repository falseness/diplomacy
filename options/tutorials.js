// Hand-made tutorial maps. The human always plays red (slot 1, fog of war) against
// blue (slot 2, SimpleAiPlayer). `pass` picks the win rule (TutorialManager.isPassed):
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

const tutorials = [
    {id: 'tutorial-1', title: 'Tutorial 1', pass: 'enemyUnitsDead', get map() { return createTutorial1Map() }}
]
