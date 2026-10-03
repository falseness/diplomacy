const assert = require('assert').strict;
const {spawnSync} = require('child_process');
const {run: ranged} = require('../../diplomacy_server/tests/client/test-coop-early-ranged');
const {run: melee} = require('./test-coop-heavy-melee');

// Independent literal expectations, never derived from production configuration.
// Reuse the full action and invariant suites, including persistence and death.
function run(fault) {
  ranged(fault === 'hexcaster' ? 'health' : undefined,
    [['Hexcaster', 'hexcaster', 1, 1, 3, 2]],
    'PASS late ranged hexcaster health=1 movement=1 damage=3 range=2 boundary=inside,at,outside obstruction=mountain persistence=2 incoming_lethal=1');
  melee(fault === 'melee' ? 'health' : undefined,
    [['Ravager', 'ravager', 4, 3, 1], ['DemonLord', 'demonLord', 5, 2, 3]],
    'PASS late melee ravager health=4 movement=3 damage=1 range=1; demonLord health=5 movement=2 damage=3 range=1; incoming_lethal=4,5 persistence=2');
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
