// Per-category portal durability: common (melee/ranged/support) 12 HP, elite 30 HP.
// Fresh portals start at their category max and a save/load keeps damaged hp.
// --fault flat-health rewrites coopPortalHealth to a flat 30 and must exit 1.
const assert = require('assert').strict;
const {createFixture, defaultFixture} = require('./test-coop-harness');
const {coopPortalHealth, COOP_COMMON_PORTAL_HEALTH, COOP_ELITE_PORTAL_HEALTH} = require('./wave-config');

const fault = process.argv[2] === '--fault' ? process.argv[3] : undefined;
if (process.argv.length > 2 && fault !== 'flat-health') throw new Error('usage: [--fault flat-health]');

// Literal expectations, independent of the module under test.
const EXPECTED = {melee: 12, ranged: 12, support: 12, siege: 30, heavy: 30, chaos: 30, mage: 30};

assert.equal(COOP_COMMON_PORTAL_HEALTH, 12, 'common-constant');
assert.equal(COOP_ELITE_PORTAL_HEALTH, 30, 'elite-constant');
for (const [category, max] of Object.entries(EXPECTED))
  assert.equal(coopPortalHealth(category), max, `module-${category}`);
for (const bad of ['boss', undefined, '', 'Melee'])
  assert.throws(() => coopPortalHealth(bad), RangeError, `module-unknown-${bad}`);

const config = defaultFixture();
config.coop = true;
const f = createFixture(config, () => {});
if (fault === 'flat-health') {
  f.evaluate('coopPortalHealth = () => 30; undefined');
  console.log('FAULT flat-health: coopPortalHealth rewritten to always return 30');
}
const categories = Object.keys(EXPECTED);
f.context.portalCategories = categories;
f.evaluate(`globalThis.healthPortals = portalCategories.map((category, x) => new DemonPortal(x, 0, category)); undefined`);

const observe = () => f.evaluate(`JSON.parse(JSON.stringify(portalCategories.map((category, x) => {
  const p = grid.getBuilding({x, y: 0});
  return {category: p.category, maxHP: p.maxHP, hp: p.hp, info: p.info.info.hp,
    barMaxHP: p.hpBar.maxHP, killed: p.killed};
})))`);

let cases = 0;
for (const row of observe()) {
  const max = EXPECTED[row.category];
  console.log(JSON.stringify({scenario: 'fresh-portal', ...row, expectedMaxHP: max}));
  assert.deepEqual(row, {category: row.category, maxHP: max, hp: max, info: `${max} / ${max}`,
    barMaxHP: max, killed: false}, `fresh-${row.category}`);
  cases++;
}

// Damage a common and an elite portal by 5, then round-trip the whole board.
f.evaluate(`grid.getBuilding({x: portalCategories.indexOf('melee'), y: 0}).hit(5);
  grid.getBuilding({x: portalCategories.indexOf('chaos'), y: 0}).hit(5); undefined`);
f.evaluate('globalThis.healthSave = JSON.stringify(getGameObject()); loadFromJson(healthSave); undefined');
const loaded = observe();
for (const [category, hp, max] of [['melee', 7, 12], ['chaos', 25, 30]]) {
  const row = loaded.find(r => r.category === category);
  console.log(JSON.stringify({scenario: 'save-load-roundtrip', ...row, expectedHP: hp, expectedMaxHP: max}));
  assert.deepEqual(row, {category, maxHP: max, hp, info: `${hp} / ${max}`, barMaxHP: max, killed: false},
    `roundtrip-${category}`);
  cases++;
}
// Undamaged portals load at their category max.
for (const row of loaded.filter(r => r.category !== 'melee' && r.category !== 'chaos')) {
  const max = EXPECTED[row.category];
  assert.deepEqual(row, {category: row.category, maxHP: max, hp: max, info: `${max} / ${max}`,
    barMaxHP: max, killed: false}, `roundtrip-full-${row.category}`);
  cases++;
}
assert.equal(f.evaluate('external.filter(e => e.isDemonPortal).length'), categories.length, 'portal-count');
console.log(`PASS portal-health cases=${cases}`);
