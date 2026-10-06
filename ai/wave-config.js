// Current portal durability; wave production uses the six-category schedule below.
const COOP_PORTAL_HEALTH = 30;
// Common (melee/ranged) portals are weaker than elite ones.
const COOP_COMMON_PORTAL_HEALTH = 12;
const COOP_ELITE_PORTAL_HEALTH = 30;
const COOP_COMMON_PORTAL_CATEGORIES = Object.freeze(['melee', 'ranged']);
const COOP_ELITE_PORTAL_CATEGORIES = Object.freeze(['siege', 'heavy', 'chaos', 'mage', 'cavalry']);

function coopPortalHealth(category) {
  if (COOP_COMMON_PORTAL_CATEGORIES.includes(category)) return COOP_COMMON_PORTAL_HEALTH;
  if (COOP_ELITE_PORTAL_CATEGORIES.includes(category)) return COOP_ELITE_PORTAL_HEALTH;
  throw new RangeError('Invalid portal category');
}

function validateCoopWaveRound(round) {
  if (!Number.isSafeInteger(round) || round < 0) throw new RangeError('Invalid wave round');
}

// Typed portal rules supersede weighted sampling: every active portal produces one
// demon at each completed round divisible by waveInterval. A category produces
// nothing before its first step and repeats its last reached (strongest) type.
// Shared by spawning and next-production previews; no seed, map or population input.
const COOP_TYPED_WAVE_SCHEDULE = Object.freeze({
  waveInterval: 4,
  categories: Object.freeze(Object.fromEntries(Object.entries({
    melee: [[4, 'imp'], [12, 'clawling'], [16, 'brute']],
    ranged: [[4, 'spitter'], [16, 'emberArcher']],
    siege: [[16, 'bombard'], [32, 'mortar']],
    heavy: [[20, 'bulwark']],
    cavalry: [[16, 'ravager'], [24, 'hound']],
    chaos: [[28, 'demonLord']],
    mage: [[20, 'hexcaster'], [36, 'demonQueen']]
  }).map(([category, steps]) => [category,
    Object.freeze(steps.map(([round, type]) => Object.freeze({round, type})))])))
});
const COOP_PORTAL_CATEGORIES = Object.freeze(Object.keys(COOP_TYPED_WAVE_SCHEDULE.categories));
// Saves written before TASK-572 call the cavalry category 'support' (same schedule).
const COOP_LEGACY_PORTAL_CATEGORIES = Object.freeze({support: 'cavalry'});

// In place, before any category validation; unknown categories stay as they are and are rejected later.
function normalizeLegacyCoopPortalCategories(external) {
  if (!Array.isArray(external)) return external;
  for (const portal of external) {
    if (portal && portal.name === 'demonPortal' &&
        Object.prototype.hasOwnProperty.call(COOP_LEGACY_PORTAL_CATEGORIES, portal.category))
      portal.category = COOP_LEGACY_PORTAL_CATEGORIES[portal.category];
  }
  return external;
}

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
  // A first step between wave rounds (e.g. round 6 with interval 4) first produces at the next wave round.
  const firstWave = Math.ceil(steps[0].round / interval) * interval;
  const round = Math.max(firstWave, completedRound - completedRound % interval + interval);
  if (!Number.isSafeInteger(round)) throw new RangeError('Wave round exceeds safe integer range');
  return {round, type: getCoopScheduledDemonType(category, round), roundsRemaining: round - completedRound};
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {COOP_PORTAL_HEALTH, COOP_COMMON_PORTAL_HEALTH, COOP_ELITE_PORTAL_HEALTH, coopPortalHealth,
    COOP_COMMON_PORTAL_CATEGORIES, COOP_ELITE_PORTAL_CATEGORIES,
    COOP_TYPED_WAVE_SCHEDULE, COOP_PORTAL_CATEGORIES, isCoopTypedWaveRound,
    COOP_LEGACY_PORTAL_CATEGORIES, normalizeLegacyCoopPortalCategories,
    getCoopScheduledDemonType, getCoopNextScheduledProduction};
}
