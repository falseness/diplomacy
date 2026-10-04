const assert = require('assert').strict;
const {createFixture, defaultFixture} = require('../../diplomacy_server/tests/client/test-coop-harness');

// TASK-451-1: capturing a town whose suburb holds a live demon portal must not
// repaint the portal hex, and the resulting state must save and load.
const TOWN = {x:4, y:5};

function createScenario() {
  const config = defaultFixture(); config.coop = true;
  const f = createFixture(config, () => {});
  f.context.TOWN = TOWN;
  // Co-op humans are allies and cannot capture each other's towns, so the
  // captured town is the neutral one. Give it grown suburbs on its neighbours.
  const layout = f.evaluate(`(() => {
    const town = grid.getBuilding(TOWN);
    return town.neighbours.filter(c => !isCoordNotOnMap(c, grid.arr.length, grid.arr[0].length) &&
      grid.getUnit(c).isEmpty() && grid.getBuilding(c).isEmpty());
  })()`);
  assert.ok(layout.length >= 4, 'neutral town needs at least four free neighbours');
  // Portal on the first suburb, the attacker on the last neighbour (no
  // suburb), the remaining suburbs must turn to the capturer.
  const portal = layout[0], attacker = layout[layout.length - 1];
  f.context.layout = {portal, attacker, others: layout.slice(1, -1)};
  // The demon portal appears on a live suburb hex of the neutral town (the
  // hex stays in town.suburbs); human 1's noob stands next to the town, which
  // is undefended (hp 0) and capturable.
  f.evaluate(`(() => {
    const town = grid.getBuilding(TOWN);
    for (const c of [layout.portal, ...layout.others]) {
      const h = grid.getHexagon(c); h.firstpaint(0); h.isSuburb = true; town.suburbs.push(h);
    }
    if (!grid.getHexagon(layout.portal).isSuburb) throw new Error('portal hex must be a live suburb');
    globalThis.portal = new DemonPortal(layout.portal.x, layout.portal.y, "melee");
    grid.getHexagon(layout.attacker).playerColor = 1;
    new Noob(layout.attacker.x, layout.attacker.y);
    town.hp = 0;
    gameSettings.isOnline = false;
    actionManager.clear();
  })()`);
  return f;
}

function state(f) {
  return f.evaluate(`(() => {
    const p = grid.getBuilding(layout.portal);
    const town = grid.getBuilding(TOWN);
    return {
      townOwner: town.playerColor, townName: town.name,
      portal: {name: p.name, killed: Boolean(p.killed), ownerSlot: p.ownerSlot,
        tile: grid.getHexagon(layout.portal).playerColor,
        inExternal: external.includes(p)},
      demonSlot: gameSettings.coop.demonSlot,
      suburbTiles: layout.others.map(c => grid.getHexagon(c).playerColor),
      townCell: grid.getHexagon(TOWN).playerColor,
      portalInSuburbs: town.suburbs.some(h => coordsEqually(h.coord, layout.portal) && h.isSuburb)
    };
  })()`);
}

function assertPortalDemon(label, s) {
  assert.equal(s.portal.name, 'demonPortal', label + ' portal name');
  assert.equal(s.portal.killed, false, label + ' portal alive');
  assert.equal(s.portal.inExternal, true, label + ' portal registered');
  assert.equal(s.portal.tile, s.demonSlot, label + ' portal hex playerColor === demonSlot');
  assert.equal(s.portal.ownerSlot, s.demonSlot, label + ' portal ownerSlot === demonSlot');
  assert.equal(s.portalInSuburbs, false, label + ' portal hex is no live suburb');
}

function assertCaptured(label, s) {
  assert.equal(s.townName, 'town', label + ' town alive');
  assert.equal(s.townOwner, 1, label + ' town owner is the capturer');
  assert.equal(s.townCell, 1, label + ' town cell in capturer color');
  s.suburbTiles.forEach((c, i) => assert.equal(c, 1, `${label} suburb ${i} in capturer color`));
  assertPortalDemon(label, s);
}

function capture(f) {
  return f.evaluate(`(() => {
    whooseTurn = 1;
    const u = grid.getUnit(layout.attacker);
    u.select();
    const legal = u.getAvailableCommands().some(c => coordsEqually(c.destinationCoord, TOWN));
    if (!legal) throw new Error('capture move is not legal');
    u.sendInstructions(grid.getCell(TOWN));
    return {unitAt: grid.getUnit(TOWN).playerColor, captured: actionManager.lastAction.isBuildingCaptured};
  })()`);
}

function saveLoad(f) {
  f.evaluate('globalThis.savedGame = JSON.stringify(getGameObject()); loadFromJson(savedGame); undefined');
  // Round-trip stays exact.
  assert.equal(f.evaluate('JSON.stringify(getGameObject())'), f.evaluate('savedGame'), 'save/load roundtrip exact');
}

function main() {
  const f = createScenario();
  const before = state(f);
  assertPortalDemon('initial', before);
  assert.equal(before.townOwner, 0);
  before.suburbTiles.forEach(c => assert.equal(c, 0));
  const beforeSave = f.evaluate('JSON.stringify(getGameObject())');

  // (a) capture through the real unit move/capture code.
  assert.deepEqual(capture(f), {unitAt: 1, captured: true});
  assertCaptured('capture', state(f));
  console.log('PASS capture town_owner=1 portal_alive=true portal_tile=demonSlot ownerSlot=demonSlot suburbs=capturer');

  // (b) save through getGameObject and load through loadFromJson/unpackAll.
  const capturedState = state(f);
  saveLoad(f);
  assertCaptured('save-load', state(f));
  assert.deepEqual(state(f), capturedState);
  console.log('PASS save-load unpackAll=no-throw portal_tile=demonSlot ownerSlot=demonSlot');

  // (c) undo from the captured state (fresh capture, so the undo stack holds it).
  const g = createScenario();
  assert.deepEqual(capture(g), {unitAt: 1, captured: true});
  assertCaptured('undo-precondition', state(g));
  g.evaluate('actionManager.undo(); undefined');
  const undone = state(g);
  assert.deepEqual(undone, before, 'undo restores pre-capture town/suburbs/portal');
  assertPortalDemon('undo', undone);
  assert.equal(g.evaluate('JSON.stringify(getGameObject())'), beforeSave, 'undo restores exact saved state');
  saveLoad(g);
  assert.deepEqual(state(g), before, 'undo save/load state');
  console.log('PASS undo town_owner=0 suburbs=restored portal_tile=demonSlot ownerSlot=demonSlot save_load=ok');

  // (d) recapture after undo + load.
  g.evaluate('grid.getBuilding(TOWN).hp = 0; actionManager.clear(); undefined');
  assert.deepEqual(capture(g), {unitAt: 1, captured: true});
  assertCaptured('recapture', state(g));
  saveLoad(g);
  assertCaptured('recapture-save-load', state(g));
  console.log('PASS recapture town_owner=1 portal_tile=demonSlot ownerSlot=demonSlot save_load=ok');
  console.log('PASS co-op town capture keeps demon portal cases=4');
}

main();
