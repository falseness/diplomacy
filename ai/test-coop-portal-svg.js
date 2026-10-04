// Use the shared vector validator and node-canvas preview checks (moved to diplomacy_server, TASK-459).
process.argv.push('--type', 'demonPortal');
require('../../diplomacy_server/tests/client/test-coop-demon-svg');
