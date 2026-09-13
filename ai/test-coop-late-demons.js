const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {run: ranged} = require('./test-coop-early-ranged');
const {run: melee} = require('./test-coop-heavy-melee');

// Independent literal expectations, never derived from production configuration.
// Reuse the full action and invariant suites, including persistence and death.
function run(fault) {
  ranged(fault === 'hexcaster' ? 'health' : undefined,
    [['Hexcaster', 'hexcaster', 5, 1, 4, 3]],
    'PASS late ranged hexcaster health=5 movement=1 damage=4 range=3 boundary=inside,at,outside obstruction=mountain persistence=2 incoming_lethal=5');
  melee(fault === 'melee' ? 'health' : undefined,
    [['Ravager', 'ravager', 8, 4, 5], ['DemonLord', 'demonLord', 20, 2, 6]],
    'PASS late melee ravager health=8 movement=4 damage=5 range=1; demonLord health=20 movement=2 damage=6 range=1; incoming_lethal=8,20 persistence=2');
  console.log('PASS co-op late demons types=3 exact_stats movement_boundaries range_boundaries death_cleanup shared_invariants');
}
if (require.main === module) {
  if (process.argv[2] === '--fault') run(process.argv[3]);
  else {
    run();
    for (const [fault, marker] of [['hexcaster','hexcaster-inside'], ['melee','ravager-combat']]) {
      const child = spawnSync(process.execPath, [__filename, '--fault', fault], {encoding:'utf8'});
      process.stdout.write(child.stdout); process.stderr.write(child.stderr);
      assert.equal(child.status, 1);
      assert.ok(child.stderr.includes('AssertionError') && child.stderr.includes(marker+'-exact-config-and-identity'));
      console.log('PASS rejects-'+fault+'-health-corruption expected_exit=1 observed_exit='+child.status);
    }
  }
}
