// [l, r]
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;

}

function areCoordsEqual(coord1, coord2) {
    return coord1.x == coord2.x && coord1.y == coord2.y
}

function hasSuchCoord(coords, coord) {
    for (let i = 0; i < coords.length; ++i) {
        if (areCoordsEqual(coords[i], coord)) {
            return true
        }
    }
    return false
}

function generateTinyMapAllUnits() {

    let mapSize = {x: 9, y: 9}

    let units1 = []
    let units2 = []

    let units_arrays = [units1, units2]
    let types = [Noob, Archer, KOHb, Normchel]
    for (let k = 0; k < units_arrays.length; ++k) {
        for (let i = 0; i < 6; ++i) {
            let unit = {type: types[randomInt(0, types.length - 1)], x: randomInt(0, mapSize.x - 1), y: randomInt(0, mapSize.y - 1)}
            if (hasSuchCoord(units1, unit) || hasSuchCoord(units2, unit)) {
                continue
            }
            units_arrays[k].push(unit)
        }
    }
    return new Map(
        mapSize,
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [],
                ai: true,
                units: units1
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                towns: [],
                units: units2,
                ai: true
            }
        ],
        [],
        [],
        [])
}

function generateTinyMap() {

    let mapSize = {x: randomInt(3, 3), y: randomInt(3, 3)}

    let units1 = []
    let units2 = []

    let units_arrays = [units1, units2]
    let unitsCount = randomInt(2, 3)
    for (let k = 0; k < units_arrays.length; ++k) {
        for (let i = 0; i < unitsCount; ++i) {
            let unit = {type: Noob, x: randomInt(0, mapSize.x - 1), y: randomInt(0, mapSize.y - 1)}
            if (hasSuchCoord(units1, unit) || hasSuchCoord(units2, unit)) {
                continue
            }
            units_arrays[k].push(unit)
        }
    }
    return new Map(
        mapSize,
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [],
                ai: !gameSettings.testAI,
                units: units1
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                towns: [],
                units: units2,
                ai: true
            }
        ],
        [],
        [],
        [])
}


function generateTinyMapLegacy() {
    let noob1 = [{type: Noob, x: randomInt(0, 2), y: randomInt(0, 2)}]
    let noob2 = [{type: Noob, x: randomInt(0, 2), y: randomInt(0, 2)}]
    if (areCoordsEqual(noob1[0], noob2[0])) {
        return generateTinyMapLegacy()
    }
    return new Map(
        {x: 3, y: 3},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [],
                ai: true,
                units: noob1
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                towns: [],
                units: noob2,
                ai: true
            }
        ],
        [],
        [],
        [])
}



function generateTinyMapLessHP() {
    let noob1 = [{type: Noob, x: randomInt(0, 2), y: randomInt(0, 2)}]
    let noob2 = [{type: Noob, x: randomInt(0, 2), y: randomInt(0, 2)}]
    if (areCoordsEqual(noob1[0], noob2[0])) {
        noob2 = []
    }
    else {
        noob2[0]['hp'] = 1
    }
    return new Map(
        {x: 3, y: 3},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [],
                ai: true,
                units: noob1
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                towns: [],
                units: noob2,
                ai: true
            }
        ],
        [],
        [],
        [])
}

function generateTinyMapOnlyRed() {
    return new Map(
        {x: 3, y: 3},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [],
                ai: true,
                units: [{type: Noob, x: randomInt(0, 2), y: randomInt(0, 2)}]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                towns: [],
                units: [],
                ai: true
            }
        ],
        [],
        [],
        [])
}

function generateTinyOnlyBlue() {
    return new Map(
        {x: 3, y: 3},
        [
            {
                rgb: {r: 208, g: 208, b: 208},
                towns: []
            },
            {
                rgb: {r: 255, g: 0, b: 0},
                towns: [],
                ai: true,
                units: []
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                towns: [],
                units: [{type: Noob, x: randomInt(0, 2), y: randomInt(0, 2)}],
                ai: true
            }
        ],
        [],
        [],
        [])
}