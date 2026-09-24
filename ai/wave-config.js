// Current portal durability; wave production uses the six-category schedule below.
const COOP_PORTAL_HEALTH = 30;

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
  module.exports = {COOP_PORTAL_HEALTH,
    COOP_TYPED_WAVE_SCHEDULE, COOP_PORTAL_CATEGORIES, isCoopTypedWaveRound,
    getCoopScheduledDemonType, getCoopNextScheduledProduction};
}
