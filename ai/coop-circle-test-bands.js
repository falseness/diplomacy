// Test-only re-derivation of the co-op Circle region bands (TASK-332 rule), shared
// by the circle suites. Own cube layer and lattice; never loads ai/coop-circle-plan.js.
'use strict';
const TOWN_DISTANCE = {tiny: 3, normal: 4, big: 5};

// Offset columns (odd columns lower) -> axial q = x, r = y - floor(x/2).
const layer = (x, y, R) => {
    const dq = x - R, dr = y - Math.floor(x / 2) - Math.ceil(R / 2);
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
};
const onLattice = (x, y) => (((x - (y - Math.floor(x / 2))) % 3) + 3) % 3 === 0;

// Elite core E = max(floor(R/6), smallest layer whose disc holds 4 lattice cells
// and 12 cells per human); common ring ends at min(floor(R/2), R - 3 - D).
function circleTestBands(R, humans, size) {
    const side = 2 * R + 1, discCells = [], discLattice = [];
    for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) {
        const l = layer(x, y, R);
        if (l > R) continue;
        discCells[l] = (discCells[l] || 0) + 1;
        if (onLattice(x, y)) discLattice[l] = (discLattice[l] || 0) + 1;
    }
    let E = 0, cells = 0, lattice = 0;
    for (; E < R; E++) {
        cells += discCells[E] || 0; lattice += discLattice[E] || 0;
        if (E >= Math.floor(R / 6) && cells >= 12 * humans && lattice >= 4 * humans) break;
    }
    const ringOuter = Math.min(Math.floor(R / 2), R - 3 - TOWN_DISTANCE[size]);
    return {E, ringOuter};
}

module.exports = {circleTestBands};
