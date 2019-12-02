function randomInt(max) {
    // получить случайное число от (min-0.5) до (max+0.5)
    let rand = -0.5 + Math.random() * max;
    return Math.round(rand);
  }
function filling(old) {
    let wasUpdate = false
    let colors = []
    for (let i = 0; i < old.length; ++i) {
        colors.push([])
        for (let j = 0; j < old[i].length; ++j) {
            let coord = old[i][j];
            let neighbours = grid.getHexagon(coord).neighbours
            for (let k = 0; k < neighbours.length; ++k) {
                if (isCoordNotOnGrid(neighbours[k]) ||
                    grid.getHexagon(neighbours[k]).playerColor != 0)
                    continue
                
                grid.getHexagon(neighbours[k]).firstpaint(i + 1)
                colors[i].push(neighbours[k])
                wasUpdate = true
            }
        }
    }
    if (!wasUpdate)
        return
    filling(colors)
}

function getNeedToDeleteColors(v0, g, colors, minDist, used, usedV) {
    let wayDists = Array(colors.length)
    let q = [v0]
    wayDists[v0.color] = 0;

    let colorsNeedToDelete = []
    while (q.length) {
        let v = q.shift()

        colorsNeedToDelete.push(v.color)
        
        if (wayDists[v.color] >= minDist)
            continue

        for (let i = 0; i < g[v.color].length; ++i) {
            let c = g[v.color][i]
            let newv = {
                color: c,
                x: colors[c].x,
                y: colors[c].y
            }
            if (isCoordNotOnGrid(newv) || 
                used[newv.x][newv.y] == usedV)
                continue
            
            wayDists[newv.color] = wayDists[v.color] + 1
            used[newv.x][newv.y] = usedV
            q.push(newv)
        }
    }

    return colorsNeedToDelete
}

function __repaintDeletingColor(color) {
    // slow algorithm just for debug
    for (let i = 0; i < grid.arr.length; ++i) {
        for (let j = 0; j < grid.arr[i].length; ++j) {
            if (grid.arr[i][j].hexagon.playerColor == color) {
                new Noob(i, j)
            }
        }
    }
}
function deleteColors(colorsWithNoTown, colorsNeedToDelete, needToAddCount) {
    for (let i = 0; i < colorsNeedToDelete.length; ++i) {
        if (colorsWithNoTown.length == needToAddCount)
            return
        // binsearch cuz colorsWithNoTown is sorted
        deletingColor = colorsNeedToDelete[i]

        let l = 0
        let r = colorsWithNoTown.length
        while (r - l > 1) {
            let m = Math.floor((l + r) / 2)
            if (colorsWithNoTown[m].color <= deletingColor)
                l = m
            else
                r = m
        }
        if (colorsWithNoTown[l].color == deletingColor) {
            colorsWithNoTown.splice(l, 1)
            __repaintDeletingColor(deletingColor + 1)
        }
    }
}
function isColorBoundary(color) {
    let neighbours = grid.getHexagon(color).neighbours
    for (let i = 0; i < neighbours.length; ++i) {
        if (isCoordNotOnGrid(neighbours[i])) {
            return true
        }
    }
    return false
}
function generateTowns(colors, g, used) {
    let colorsWithNoTown = []
    for (let i = 0; i < colors.length; ++i) {
        if (isColorBoundary(colors[i]))
            continue

        colorsWithNoTown.push({
            color: i, 
            x: colors[i].x,
            y: colors[i].y
        })
    }
    let townsCount = 2
    let minDist = Math.max(0, 
        Math.floor((colorsWithNoTown.length - townsCount) / Math.pow(3, townsCount)))
    
    console.log(minDist)
    console.log(colors.length)

    for (let i = 0; i < townsCount; ++i) {
        townSegment = colorsWithNoTown[randomInt(colorsWithNoTown.length)]
        if (!townSegment)
            break
        new Town(townSegment.x, townSegment.y, true)
        
        let colorsNeedToDelete = getNeedToDeleteColors(
            townSegment, g, colors, minDist, used, i + 3)
        
        deleteColors(colorsWithNoTown, colorsNeedToDelete, townsCount - i - 1)
    }
}
function findSegmentNeighbours(color0, colors, g, used, usedColors) {
    usedColors[color0] = true
    let v0 = colors[color0]
    used[v0.x][v0.y] = true
    let q = [v0]
    while (q.length) {
        let v = q.shift()
        
        grid.arr[v.x][v.y].logicText.text = color0

        let neighbours = grid.getHexagon(v).neighbours
        for (let i = 0; i < neighbours.length; ++i) {
            let tmpv = neighbours[i]

            if (isCoordNotOnGrid(tmpv) ||
                used[tmpv.x][tmpv.y])
                continue

            let color = grid.getHexagon(tmpv).playerColor - 1
            
            used[tmpv.x][tmpv.y] = true
            if (color == color0) {
                q.push(tmpv)
            }
            else if (!usedColors[color]) {
                g[color0].push(color)
                g[color].push(color0)
            }
        }
    }
}
function createSegmentGraph(colors) {
    let matrix = Array(colors.length)
    for (let i = 0; i < colors.length; ++i) {
        matrix[i] = Array(colors.length).fill(false)
    }

    for (let i = 0; i < grid.arr.length; ++i) {
        for (let j = 0; j < grid.arr[i].length; ++j) {
            grid.arr[i][j].logicText.text = grid.arr[i][j].hexagon.playerColor - 1
        }
    }
    for (let i = 0; i < grid.arr.length; ++i) {
        for (let j = 0; j < grid.arr[i].length; ++j) {
            let neighbours = grid.arr[i][j].hexagon.neighbours
            let color0 = grid.arr[i][j].hexagon.playerColor - 1
            for (let k = 0; k < neighbours.length; ++k) {
                if (isCoordNotOnGrid(neighbours[k]))
                    continue
                color = grid.getHexagon(neighbours[k]).playerColor - 1
                if (color0 != color) {
                    console.log(color0, color, [i, j], neighbours[k])
                    matrix[color0][color] = true
                }
            }
        }
    }
    let g = Array(colors.length)
    for (let i = 0; i < g.length; ++i) {
        g[i] = []
    }
    for (let i = 0; i < matrix.length; ++i) {
        for (let j = 0; j < matrix[i].length; ++j) {
            if (matrix[i][j]) {
                g[i].push(j)
            }
        }
    }
    return g
}
class MapGenerator {
    constructor() {
        
    }
}
function generateAll(colors) {   
    let tmpg = Array(colors.length).fill([])
    let usedColors = Array(colors.length).fill(false)

    let used = Array(grid.arr.length)
    for (let i = 0; i < grid.arr.length; ++i) {
        used[i] = Array(grid.arr[i].length)
        for (let j = 0; j < grid.arr[i].length; ++j) {
            used[i][j] = false
        }
    }

    // tmp:
    grid.drawLogicText = true
    let g = createSegmentGraph(colors)

    generateTowns(colors, g, used)
}
function randomGeneration() {
    let tn = 14, tm = 7
    grid = new Grid(0, 0, {
        x: tn,
        y: tm
    })

    let col = [[205, 92, 92], [220, 20, 60], [139, 0, 0], [255, 182, 193], [255, 105, 180],
        [199, 21, 133], [255, 127, 80], [255, 69, 0], [255, 165, 0], [255, 215, 0], 
        [221, 160, 221], [255, 0, 255], [186, 85, 211], [138, 43, 226], 
        [139, 0, 139], [75, 0, 130], [106, 90, 205], [0, 0, 128], [0, 128, 0],
        [205, 133, 63], [189, 183, 107], [128, 128, 0], [128, 0, 128],
        [0, 128, 128], [50, 205, 50], [25, 25, 112], [255, 0, 0], [0, 255, 255]]
    players = [
        (new NeutralPlayer({
            r: 208, 
            g: 208,
            b: 208
            }, 0)
        )
    ]

    for (let i = 0; i < col.length; ++i) {
        players.push(new Player({
            r: col[i][0],
            g: col[i][1],
            b: col[i][2]
        }))
    }
    // player isLoosed and timer calc and window.blur
     
    players[1].gold = 9999
    //players[0].towns = [new Town(-1, -1)]
    //grid.arr[0][0].hexagon.firstpaint(1)
    //let TOWN1 = new Town(0, 0)

    GameManager.clearValues()
    GameManager.initValues()

    let v = Array(tn)
    let colorsStart = Array(players.length - 1)
    let colorsFilling = Array(players.length - 1)
    for (let i = 0; i < tn; ++i) {
        v[i] = []
        for (let j = 0; j < tm; ++j) {
            v[i].push([i, j])
        }
    }

    for (let i = 0; i < colorsStart.length; ++i) {
        let vi = randomInt(v.length)
        let vj = randomInt(v[vi].length)

        let ti = v[vi][vj][0]
        let tj = v[vi][vj][1]

        v[vi].splice(vj, 1)
        if (!v[vi].length) {
            v.splice(vi, 1)
        }

        grid.arr[ti][tj].hexagon.firstpaint(i + 1)
        colorsStart[i] = {x: ti, y: tj}
        colorsFilling[i] = [{x: ti, y: tj}]
    }
    filling(colorsFilling)
    generateAll(colorsStart)

    requestAnimationFrame(gameLoop)
}