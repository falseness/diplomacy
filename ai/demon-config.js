// Combat values are in hit points, damage per hit, and hexes per turn/attack.
// Melee range is one adjacent hex. Ranged types also retain melee capability,
// matching the existing RangeUnit mechanics. Keep runtime state off this table.
const DEMON_TYPES = Object.freeze({
  imp: Object.freeze({name: 'Imp', role: 'fragile basic melee', health: 2, damage: 1, movement: 2, melee: true, ranged: false, range: 1}),
  clawling: Object.freeze({name: 'Clawling', role: 'quick light melee', health: 3, damage: 1, movement: 3, melee: true, ranged: false, range: 1}),
  hound: Object.freeze({name: 'Hound', role: 'fast melee pursuit', health: 4, damage: 2, movement: 4, melee: true, ranged: false, range: 1}),
  brute: Object.freeze({name: 'Brute', role: 'slow high-health melee', health: 10, damage: 3, movement: 1, melee: true, ranged: false, range: 1}),
  bulwark: Object.freeze({name: 'Bulwark', role: 'very durable slow melee', health: 16, damage: 2, movement: 1, melee: true, ranged: false, range: 1}),
  spitter: Object.freeze({name: 'Spitter', role: 'fragile short-range attacker', health: 2, damage: 1, movement: 2, melee: true, ranged: true, range: 2}),
  emberArcher: Object.freeze({name: 'Ember Archer', role: 'mobile ranged attacker', health: 4, damage: 2, movement: 3, melee: true, ranged: true, range: 3}),
  hexcaster: Object.freeze({name: 'Hexcaster', role: 'slow stronger ranged attacker', health: 5, damage: 4, movement: 1, melee: true, ranged: true, range: 3}),
  ravager: Object.freeze({name: 'Ravager', role: 'fast strong late-game melee', health: 8, damage: 5, movement: 4, melee: true, ranged: false, range: 1}),
  demonLord: Object.freeze({name: 'Demon Lord', role: 'durable powerful late-game melee', health: 20, damage: 6, movement: 2, melee: true, ranged: false, range: 1})
});

if (typeof module !== 'undefined' && module.exports) module.exports = DEMON_TYPES;
