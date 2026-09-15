// Combat values are in hit points, damage per hit, and hexes per turn/attack.
// Melee range is one adjacent hex. Ranged types also retain melee capability,
// matching the existing RangeUnit mechanics. Keep runtime state off this table.
const DEMON_TYPES = Object.freeze({
  imp: Object.freeze({name: 'imp', role: 'fragile basic melee', health: 2, damage: 1, movement: 2, melee: true, ranged: false, range: 1}),
  clawling: Object.freeze({name: 'clawling', role: 'quick light melee', health: 3, damage: 1, movement: 3, melee: true, ranged: false, range: 1}),
  hound: Object.freeze({name: 'hound', role: 'fast melee pursuit', health: 4, damage: 2, movement: 4, melee: true, ranged: false, range: 1}),
  brute: Object.freeze({name: 'brute', role: 'slow high-health melee', health: 10, damage: 3, movement: 1, melee: true, ranged: false, range: 1}),
  bulwark: Object.freeze({name: 'bulwark', role: 'very durable slow melee', health: 16, damage: 2, movement: 1, melee: true, ranged: false, range: 1}),
  spitter: Object.freeze({name: 'spitter', role: 'fragile short-range attacker', health: 2, damage: 1, movement: 2, melee: true, ranged: true, range: 2}),
  emberArcher: Object.freeze({name: 'ember archer', role: 'mobile ranged attacker', health: 4, damage: 2, movement: 3, melee: true, ranged: true, range: 3}),
  hexcaster: Object.freeze({name: 'hexcaster', role: 'slow stronger ranged attacker', health: 5, damage: 4, movement: 1, melee: true, ranged: true, range: 3}),
  ravager: Object.freeze({name: 'ravager', role: 'fast strong late-game melee', health: 8, damage: 5, movement: 4, melee: true, ranged: false, range: 1}),
  demonLord: Object.freeze({name: 'demon lord', role: 'durable powerful late-game melee', health: 20, damage: 6, movement: 2, melee: true, ranged: false, range: 1})
});

// Version 1 (including unversioned saves) is the original table above.
const TUNED_DEMON_TYPES = Object.freeze(Object.fromEntries(Object.entries(
{
  imp: {"health": 3, "damage": 2, "movement": 3, "range": 1},
  clawling: {"health": 4, "damage": 2, "movement": 4, "range": 1},
  hound: {"health": 6, "damage": 3, "movement": 5, "range": 1},
  brute: {"health": 12, "damage": 4, "movement": 2, "range": 1},
  bulwark: {"health": 20, "damage": 4, "movement": 2, "range": 1},
  spitter: {"health": 3, "damage": 2, "movement": 3, "range": 4},
  emberArcher: {"health": 5, "damage": 3, "movement": 3, "range": 5},
  hexcaster: {"health": 6, "damage": 5, "movement": 2, "range": 6},
  ravager: {"health": 10, "damage": 6, "movement": 4, "range": 1},
  demonLord: {"health": 24, "damage": 8, "movement": 3, "range": 1}
}
).map(([id, stats]) => [id, Object.freeze({...DEMON_TYPES[id], ...stats})])));
function getDemonTypes(version = 1) {
  if (version !== 1 && version !== 2) throw new RangeError('Unsupported demon balance version');
  return version === 2 ? TUNED_DEMON_TYPES : DEMON_TYPES;
}
function currentDemonTypes() {
  return getDemonTypes(typeof gameSettings === 'undefined' ? 1 : gameSettings.coop?.balanceVersion ?? 1);
}

if (typeof module !== 'undefined' && module.exports) module.exports = DEMON_TYPES;
