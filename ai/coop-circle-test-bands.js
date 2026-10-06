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

// Elite core E = max(floor(R/6), smallest layer whose disc holds one lattice cell
// and 3 cells per elite portal (8 per human: chaos, heavy, siege, 3 mage (client 1699b63),
// 2 cavalry (TASK-575) + 2 extra heavy per map, TASK-450-3), plus 9 per human on big for the
// elite neutral towns); common ring ends at floor(R/2), extended outwards while layers
// E+1..ringOuter hold fewer than 2 lattice cells per common ring portal (6 per human:
// 3 melee, 3 ranged), never past R - 3 - D.
function circleTestBands(R, humans, size) {
    const side = 2 * R + 1, discCells = [], discLattice = [];
    for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) {
        const l = layer(x, y, R);
        if (l > R) continue;
        discCells[l] = (discCells[l] || 0) + 1;
        if (onLattice(x, y)) discLattice[l] = (discLattice[l] || 0) + 1;
    }
    const elitePortals = 8 * humans + 2;
    const cellsNeeded = 3 * elitePortals + (size === 'big' ? 9 * humans : 0);
    let E = 0, cells = 0, lattice = 0;
    for (; E < R; E++) {
        cells += discCells[E] || 0; lattice += discLattice[E] || 0;
        if (E >= Math.floor(R / 6) && cells >= cellsNeeded && lattice >= elitePortals) break;
    }
    const limit = R - 3 - TOWN_DISTANCE[size], ringLattice = l => discLattice.slice(E + 1, l + 1).reduce((a, b) => a + (b || 0), 0);
    let ringOuter = Math.floor(R / 2);
    while (ringOuter < limit && ringLattice(ringOuter) < 2 * 6 * humans) ringOuter++;
    ringOuter = Math.min(ringOuter, limit);
    return {E, ringOuter};
}

module.exports = {circleTestBands};
