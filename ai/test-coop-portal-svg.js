// Use the shared vector validator and real Chromium preview checks.
process.argv.push('--type', 'demonPortal');
require('./test-coop-demon-svg');
