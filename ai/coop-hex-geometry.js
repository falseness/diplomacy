// Shared co-op hex geometry. Offset columns (odd columns sit lower) map to axial
// as q = x, r = y - floor(x/2). With center {q: R, r: ceil(R/2)}, a (2R+1)-square
// grid and offset {0, 0}, every cell with layer <= R is in bounds: 3R*R+3R+1
// playable cells, R*R+R masked. The offset must stay {0, 0} because createMapEdge
// and radialSuddenDeath read raw grid coordinates.

// Same algorithm as getHexagonalLayer (options/gamestart.js), which is kept
// byte-identical; diplomacy_server tests/client/test-coop-hex-geometry.js checks parity.
function coopHexLayer(x, y, center) {
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

function coopHexCenter(radius) {
    return {q: radius, r: Math.ceil(radius / 2)}
}

function coopHexMapShape(radius) {
    return {type: 'hexagonal', center: coopHexCenter(radius), radius, offset: {x: 0, y: 0}}
}

// In-bounds offset-column cells with layer <= radius, column-major.
function coopHexCells(radius) {
    const side = 2 * radius + 1
    const center = coopHexCenter(radius)
    const cells = []
    for (let x = 0; x < side; x++) for (let y = 0; y < side; y++)
        if (coopHexLayer(x, y, center) <= radius) cells.push({x, y})
    return cells
}

// Axial (q - r) mod 3 portal lattice on the odd-q offset grid (r = y - floor(x / 2)).
const coopHexLattice = (x, y) => ((x - y + (x - (x & 1)) / 2) % 3 + 3) % 3 === 0

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {coopHexLayer, coopHexCenter, coopHexMapShape, coopHexCells, coopHexLattice}
}
