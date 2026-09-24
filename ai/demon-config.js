// Combat values are in hit points, damage per hit, and hexes per turn/attack.
// Melee range is one adjacent hex. Ranged types also retain melee capability,
// matching the existing RangeUnit mechanics. Keep runtime state off this table.
const DEMON_TYPES = Object.freeze({
  imp: Object.freeze({name: 'imp', role: 'fragile basic melee', health: 2, damage: 1, movement: 2, melee: true, ranged: false, range: 1}),
  clawling: Object.freeze({name: 'clawling', role: 'quick light melee', health: 1, damage: 2, movement: 2, melee: true, ranged: false, range: 1}),
  hound: Object.freeze({name: 'hound', role: 'fast melee pursuit', health: 2, damage: 1, movement: 5, melee: true, ranged: false, range: 1}),
  brute: Object.freeze({name: 'brute', role: 'slow high-health melee', health: 3, damage: 2, movement: 2, melee: true, ranged: false, range: 1}),
  bulwark: Object.freeze({name: 'bulwark', role: 'very durable slow melee', health: 7, damage: 1, movement: 2, melee: true, ranged: false, range: 1}),
  spitter: Object.freeze({name: 'spitter', role: 'fragile short-range attacker', health: 2, damage: 1, movement: 2, melee: true, ranged: true, range: 1}),
  emberArcher: Object.freeze({name: 'ember archer', role: 'mobile ranged attacker', health: 1, damage: 1, movement: 2, melee: true, ranged: true, range: 3}),
  hexcaster: Object.freeze({name: 'hexcaster', role: 'slow stronger ranged attacker', health: 1, damage: 3, movement: 1, melee: true, ranged: true, range: 2}),
  ravager: Object.freeze({name: 'ravager', role: 'fast strong late-game melee', health: 4, damage: 1, movement: 3, melee: true, ranged: false, range: 1}),
  demonLord: Object.freeze({name: 'demon lord', role: 'durable powerful late-game melee', health: 5, damage: 3, movement: 2, melee: true, ranged: false, range: 1})
});

// Combat stats are current for every game; saved wave versions do not select them.
if (typeof module !== 'undefined' && module.exports) module.exports = DEMON_TYPES;
