// Waves use completed round numbers: round 0 is setup, round 1 is the first wave.
// Strength is a spawn budget; each type's positive weight is its budget cost.
// Scale by the INITIAL human count (2–4), never by surviving humans or portals.
// For r >= 1: strength = (4 + 2*(r-1) + latest escalation bonus) * humans/2.
// After the last escalation the same linear growth continues indefinitely.
const COOP_WAVE_CONFIG = Object.freeze({
  portalHealth: 30,
  // Inclusive hex-distance bounds from a portal. Terrain, occupancy and map
  // bounds must also be checked by the spawning controller; distance 0 is illegal.
  spawnRadius: Object.freeze({min: 1, max: 2}),
  minInitialHumans: 2,
  maxInitialHumans: 4,
  baseStrength: 4,
  strengthPerRound: 2,
  referenceHumanCount: 2,
  escalations: Object.freeze([
    Object.freeze({round: 5, bonus: 4}),
    Object.freeze({round: 9, bonus: 8}),
    Object.freeze({round: 13, bonus: 12})
  ]),
  types: Object.freeze({
    imp: Object.freeze({weight: 1, unlockRound: 1}),
    clawling: Object.freeze({weight: 2, unlockRound: 2}),
    hound: Object.freeze({weight: 3, unlockRound: 3}),
    brute: Object.freeze({weight: 5, unlockRound: 4}),
    bulwark: Object.freeze({weight: 7, unlockRound: 6}),
    spitter: Object.freeze({weight: 2, unlockRound: 3}),
    emberArcher: Object.freeze({weight: 4, unlockRound: 5}),
    hexcaster: Object.freeze({weight: 6, unlockRound: 7}),
    ravager: Object.freeze({weight: 8, unlockRound: 9}),
    demonLord: Object.freeze({weight: 12, unlockRound: 12})
  })
});

function validateCoopWaveRound(round) {
  if (!Number.isSafeInteger(round) || round < 0) throw new RangeError('Invalid wave round');
}

function getCoopWaveStrength(round, initialHumanCount) {
  validateCoopWaveRound(round);
  const c = COOP_WAVE_CONFIG;
  if (!Number.isInteger(initialHumanCount) || initialHumanCount < c.minInitialHumans ||
      initialHumanCount > c.maxInitialHumans) throw new RangeError('Invalid initial human count');
  if (round === 0) return 0;
  let bonus = 0;
  for (const escalation of c.escalations) {
    if (round >= escalation.round) bonus = escalation.bonus;
  }
  const strength = (c.baseStrength + c.strengthPerRound * (round - 1) + bonus) *
    initialHumanCount / c.referenceHumanCount;
  if (!Number.isSafeInteger(strength)) throw new RangeError('Wave strength exceeds safe integer range');
  return strength;
}

function getUnlockedCoopDemonTypes(round) {
  validateCoopWaveRound(round);
  return Object.keys(COOP_WAVE_CONFIG.types).filter(id =>
    round >= COOP_WAVE_CONFIG.types[id].unlockRound);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {COOP_WAVE_CONFIG, getCoopWaveStrength, getUnlockedCoopDemonTypes};
}
