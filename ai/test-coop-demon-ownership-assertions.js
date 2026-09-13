const assert = require('assert').strict;

// Call only after a complete action/load/undo. Repainting and map relocation
// temporarily disagree inside movement; inspecting there would be invalid.
function assertDemonTileOwnership(fixture, label) {
  const observed = fixture.evaluate(`(() => {
    if (!gameSettings.coop) return [];
    const slot = gameSettings.coop.demonSlot, demon = players[slot];
    const units = new Set(demon.units.filter(u => !u.killed));
    for (const p of players) for (const u of p.units)
      if (!u.killed && (u.playerColor === slot || u.ownerSlot === slot)) units.add(u);
    for (const column of grid.arr) for (const cell of column) {
      const u = cell.unit;
      if (!u.isEmpty() && !u.killed && (u.playerColor === slot || u.ownerSlot === slot)) units.add(u);
    }
    return [...units].map(u => ({name:u.name, id:u.id === undefined ? null : u.id,
      coord:u.coord, expectedOwner:slot, owner:u.playerColor,
      tileOwner:grid.getHexagon(u.coord).playerColor,
      registry:players.flatMap((p,i) => p.units.filter(v=>v===u).map(()=>i)),
      playerMatches:u.player===demon, mapMatches:grid.getUnit(u.coord)===u}));
  })()`);
  for (const row of observed) {
    const expected = {...row, owner:row.expectedOwner, tileOwner:row.expectedOwner,
      registry:[row.expectedOwner], playerMatches:true, mapMatches:true};
    console.log(JSON.stringify({scenario:label+'-demon-tile-ownership', expected, observed:row}));
    assert.deepStrictEqual(row, expected,
      `${label} demon-tile-ownership unit=${row.name} id=${row.id} coord=(${row.coord.x},${row.coord.y})`);
  }
  console.log(`PASS ${label} demon-tile-ownership live=${observed.length}`);
  return observed;
}
module.exports = {assertDemonTileOwnership};
