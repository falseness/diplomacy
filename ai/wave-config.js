// Version 1: completed rounds 0–2 have no eligible types; round 3 starts with imps.
// Weights control per-portal selection, never spawn counts.
const COOP_WAVE_CONFIG = Object.freeze({
  portalHealth: 30,
  // Inclusive hex-distance bounds from a portal. Terrain, occupancy and map
  // bounds must also be checked by the spawning controller; distance 0 is illegal.
  spawnRadius: Object.freeze({min: 1, max: 2}),
  minInitialHumans: 1,
  maxInitialHumans: 12,
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

function getCoopWaveConfig(version = 1) {
  if (version !== 1 && version !== 2) throw new RangeError('Unsupported demon balance version');
  return version === 2 ? TUNED_COOP_WAVE_CONFIG : COOP_WAVE_CONFIG;
}
const TUNED_COOP_WAVE_CONFIG = Object.freeze({...COOP_WAVE_CONFIG,
  // Version 2 eligibility is explicit; retain the original type order and weights
  // so seeded weighted selection continues to use the same algorithm.
  types: Object.freeze(Object.fromEntries(Object.entries({
    imp: 1, clawling: 3, hound: 6, brute: 10, bulwark: 20,
    spitter: 6, emberArcher: 15, hexcaster: 24, ravager: 30, demonLord: 35
  }).map(([id, unlockRound]) =>
    [id, Object.freeze({...COOP_WAVE_CONFIG.types[id], unlockRound})])))
});
function getUnlockedCoopDemonTypes(round, version = 1) {
  validateCoopWaveRound(round);
  const config = getCoopWaveConfig(version);
  return Object.keys(config.types).filter(id => round >= config.types[id].unlockRound);
}

// Typed portal rules supersede weighted sampling: every active portal produces one
// demon at each completed round divisible by waveInterval. A category produces
// nothing before its first step and repeats its last reached (strongest) type.
// Shared by spawning and next-production previews; no seed, map or population input.
const COOP_TYPED_WAVE_SCHEDULE = Object.freeze({
  waveInterval: 4,
  categories: Object.freeze(Object.fromEntries(Object.entries({
    melee: [[4, 'imp'], [8, 'clawling'], [16, 'brute']],
    ranged: [[4, 'spitter'], [12, 'emberArcher'], [20, 'hexcaster']],
    siege: [[16, 'bombard']],
    heavy: [[20, 'bulwark']],
    support: [[16, 'ravager'], [24, 'hound']],
    chaos: [[28, 'demonLord']]
  }).map(([category, steps]) => [category,
    Object.freeze(steps.map(([round, type]) => Object.freeze({round, type})))])))
});
const COOP_PORTAL_CATEGORIES = Object.freeze(Object.keys(COOP_TYPED_WAVE_SCHEDULE.categories));

function getCoopPortalCategorySteps(category) {
  if (typeof category !== 'string' ||
      !Object.prototype.hasOwnProperty.call(COOP_TYPED_WAVE_SCHEDULE.categories, category))
    throw new RangeError('Invalid portal category');
  return COOP_TYPED_WAVE_SCHEDULE.categories[category];
}

function isCoopTypedWaveRound(round) {
  validateCoopWaveRound(round);
  return round > 0 && round % COOP_TYPED_WAVE_SCHEDULE.waveInterval === 0;
}

// Demon type a portal of this category produces at an absolute completed round, or null.
function getCoopScheduledDemonType(category, round) {
  const steps = getCoopPortalCategorySteps(category);
  if (!isCoopTypedWaveRound(round)) return null;
  let type = null;
  for (const step of steps) if (round >= step.round) type = step.type;
  return type;
}

// First production strictly after the given completed round; always exists.
function getCoopNextScheduledProduction(category, completedRound) {
  const steps = getCoopPortalCategorySteps(category);
  validateCoopWaveRound(completedRound);
  const interval = COOP_TYPED_WAVE_SCHEDULE.waveInterval;
  const round = Math.max(steps[0].round, completedRound - completedRound % interval + interval);
  if (!Number.isSafeInteger(round)) throw new RangeError('Wave round exceeds safe integer range');
  return {round, type: getCoopScheduledDemonType(category, round), roundsRemaining: round - completedRound};
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {getCoopWaveConfig, COOP_WAVE_CONFIG, getCoopWaveStrength, getUnlockedCoopDemonTypes,
    COOP_TYPED_WAVE_SCHEDULE, COOP_PORTAL_CATEGORIES, isCoopTypedWaveRound,
    getCoopScheduledDemonType, getCoopNextScheduledProduction};
}
