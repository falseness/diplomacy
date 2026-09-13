// Completed rounds 0–2 have no eligible types; round 3 starts with imps.
// Weights control per-portal selection, never spawn counts.
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
    imp: Object.freeze({weight: 1, unlockRound: 3}),
    clawling: Object.freeze({weight: 2, unlockRound: 4}),
    hound: Object.freeze({weight: 3, unlockRound: 5}),
    brute: Object.freeze({weight: 5, unlockRound: 6}),
    bulwark: Object.freeze({weight: 7, unlockRound: 8}),
    spitter: Object.freeze({weight: 2, unlockRound: 5}),
    emberArcher: Object.freeze({weight: 4, unlockRound: 7}),
    hexcaster: Object.freeze({weight: 6, unlockRound: 9}),
    ravager: Object.freeze({weight: 8, unlockRound: 11}),
    demonLord: Object.freeze({weight: 12, unlockRound: 14})
  })
});

function validateCoopWaveRound(round) {
  if (!Number.isSafeInteger(round) || round < 0) throw new RangeError('Invalid wave round');
}

// Legacy projection API retained for existing balance reports; not used by generation.
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
