


function generateTinyMap() {
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
                units: [{type: Noob, x: 0, y: 0}]
            },
            {
                rgb: {r: 98, g: 168, b: 222},
                towns: [],
                units: [{type: Noob, x: 2, y: 2}],
                ai: true
            }
        ],
        [],
        [],
        [])
}
