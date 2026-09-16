'use strict';
// Final typed-wave integration regression suite. Runs every child program of the
// typed-wave task series sequentially (browser and server suites included), each
// in its own process group with an isolated evidence directory under --output-dir,
// then audits the three archived economy-bot balance manifests against the current
// sources. Exits nonzero when any required child fails, times out or leaves
// processes behind, or when the audit fails.
// Usage: node20 ai/test-coop-wave-regressions.js --output-dir DIR
//        node20 ai/test-coop-wave-regressions.js --fault-child-failure --output-dir DIR
//   The fault mode is a negative control: a real child fault is declared as a
//   required positive, so this runner must exit 1 naming that child.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {spawn, execFileSync} = require('child_process');

const ROOT = path.join(__dirname, '..');
const SIBLING = path.resolve(ROOT, '../diplomacy_server');
const MINUTE = 60 * 1000;

function option(name) {
  const i = process.argv.indexOf(name);
  if (i < 0) return null;
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) throw new Error(`value required for ${name}`);
  return value;
}
const outArg = option('--output-dir');
if (!outArg) { console.error('usage: --output-dir DIR [--fault-child-failure]'); process.exit(2); }
const OUT = path.resolve(outArg);
const FAULT = process.argv.includes('--fault-child-failure');
const rel = p => path.relative(ROOT, p);

// Each child: literal argv relative to ROOT, the expected exit status, a wall
// timeout, the stdout marker its own pass line prints, and its evidence dir.
function suites() {
  const dir = name => path.join(OUT, 'children', name);
  const withDir = (name, script, extra = []) => ({name, argv: [script, ...extra, '--output-dir', rel(dir(name))],
    evidence: dir(name), ownsDir: true});
  // Stdout-only regressions: their full log is their evidence.
  const plain = (name, script) => ({name, argv: [script], evidence: path.join(OUT, 'logs', name + '.log'), ownsDir: false});
  if (FAULT) return [
    {...plain('control-shared-vision', 'ai/test-coop-shared-vision.js'), kind: 'regression', expected: 0,
      timeoutMs: 10 * MINUTE, marker: /^PASS co-op shared vision$/m},
    // Required positive on purpose: the result fault must propagate as a failure.
    {...plain('fault-results-wrong-victory', 'ai/test-coop-results.js'), argv: ['ai/test-coop-results.js', '--fault'],
      kind: 'regression', expected: 0, timeoutMs: 10 * MINUTE, marker: /^PASS result-case simultaneous-flood-draw /m,
      intended: /victory-portals-first-shared-result/},
    // A required child that cannot finish inside its bound must also fail the runner.
    {...plain('fault-timeout-tile-ownership', 'ai/test-coop-demon-tile-ownership.js'), kind: 'regression', expected: 0,
      timeoutMs: 100, marker: /^PASS demon-tile-ownership /m, intended: 'timeout'}
  ];
  return [
    {...withDir('typed-wave-config', 'ai/test-coop-typed-wave-config.js'), kind: 'node', expected: 0,
      timeoutMs: 30 * MINUTE, marker: /^PASS co-op typed wave config categories=4 /m},
    {...withDir('typed-portal-matrix', 'ai/test-coop-typed-portal-matrix.js'), kind: 'node', expected: 0,
      timeoutMs: 240 * MINUTE, marker: /^PASS typed-portal-matrix cases=1152\/1152 /m},
    {...withDir('synchronized-waves', 'ai/test-coop-synchronized-waves.js'), kind: 'node', expected: 0,
      timeoutMs: 30 * MINUTE, marker: /^PASS synchronized-waves scenarios=2 /m},
    {...withDir('typed-wave-save', 'ai/test-coop-typed-wave-save.js'), kind: 'node', expected: 0,
      timeoutMs: 60 * MINUTE, marker: /^PASS typed-wave-save scenarios=solo,h10 /m},
    {...withDir('typed-wave-server', 'ai/test-coop-typed-wave-server.js'), kind: 'server', expected: 0,
      timeoutMs: 90 * MINUTE, marker: /^PASS typed-wave-server /m},
    {...withDir('production-preview', 'ai/test-production-preview.js'), kind: 'node', expected: 0,
      timeoutMs: 30 * MINUTE, marker: /^PASS production-preview checkpoints=/m},
    {...withDir('portal-production', 'ai/test-coop-portal-production.js'), kind: 'browser', expected: 0,
      timeoutMs: 60 * MINUTE, marker: /^PASS portal-production checkpoints=/m},
    {...withDir('zoom-matrix', 'ai/test-coop-zoom.js', ['--matrix']), kind: 'browser', expected: 0,
      timeoutMs: 150 * MINUTE, marker: /^PASS co-op zoom matrix cases=15 /m},
    {...plain('demon-tile-ownership', 'ai/test-coop-demon-tile-ownership.js'), kind: 'regression', expected: 0,
      timeoutMs: 20 * MINUTE, marker: /^PASS demon-tile-ownership /m},
    {...plain('demon-economy', 'ai/test-coop-demon-economy.js'), kind: 'regression', expected: 0,
      timeoutMs: 20 * MINUTE, marker: /^PASS demon-economy /m},
    {...plain('shared-vision', 'ai/test-coop-shared-vision.js'), kind: 'regression', expected: 0,
      timeoutMs: 20 * MINUTE, marker: /^PASS co-op shared vision$/m},
    {...plain('undo-boundaries', 'ai/test-coop-undo-boundaries.js'), kind: 'regression', expected: 0,
      timeoutMs: 30 * MINUTE, marker: /^PASS co-op undo boundaries /m},
    {...plain('results', 'ai/test-coop-results.js'), kind: 'regression', expected: 0,
      timeoutMs: 30 * MINUTE, marker: /^PASS rejects-wrong-result expected_exit=1 observed_exit=1$/m}
  ];
}

const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function git(cwd, ...args) {
  return execFileSync('git', args, {cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
}
function sourceIdentities() {
  const files = {};
  for (const f of git(ROOT, 'ls-files').split('\n').filter(f => /\.(js|html|css|svg)$/.test(f)))
    if (fs.existsSync(path.join(ROOT, f))) files[f] = sha256(path.join(ROOT, f));
  const sibling = {};
  if (fs.existsSync(SIBLING)) for (const f of git(SIBLING, 'ls-files').split('\n').filter(f => /\.js$/.test(f)))
    if (fs.existsSync(path.join(SIBLING, f))) sibling[f] = sha256(path.join(SIBLING, f));
  return {head: git(ROOT, 'rev-parse', 'HEAD').trim(), dirty: git(ROOT, 'status', '--short', '--', '.', ':!artifacts')
    .split('\n').filter(Boolean), files, sibling: {
    root: SIBLING, head: fs.existsSync(SIBLING) ? git(SIBLING, 'rev-parse', 'HEAD').trim() : null, files: sibling}};
}
function siblingState() {
  if (!fs.existsSync(SIBLING)) return null;
  const diff = git(SIBLING, 'diff', 'HEAD');
  return {head: git(SIBLING, 'rev-parse', 'HEAD').trim(), diffSha256: crypto.createHash('sha256').update(diff).digest('hex'),
    status: git(SIBLING, 'status', '--short', '--untracked-files=no').split('\n').filter(Boolean)};
}
function groupAlive(pid) {
  try { process.kill(-pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
function groupMembers(pid) {
  try {
    return execFileSync('ps', ['-e', '-o', 'pgid=,pid=,args='], {encoding: 'utf8'}).split('\n')
      .map(s => s.trim().split(/\s+/)).filter(row => row[0] === String(pid)).map(row => row.slice(1).join(' '));
  } catch (error) { return []; }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function runChild(suite) {
  fs.mkdirSync(path.join(OUT, 'logs'), {recursive: true});
  const logPath = path.join(OUT, 'logs', suite.name + '.log');
  const command = `${process.execPath} ${suite.argv.join(' ')}`;
  const env = {...process.env};
  const log = fs.openSync(logPath, 'w');
  fs.writeSync(log, `$ cd ${ROOT}\n$ NODE_PATH=${env.NODE_PATH || ''} ${command}\n` +
    `# expected_exit=${suite.expected} timeout_ms=${suite.timeoutMs} evidence=${rel(suite.evidence)}\n`);
  const started = new Date();
  const t0 = process.hrtime.bigint();
  console.log(`BEGIN child ${suite.name} kind=${suite.kind} command=${command} expected_exit=${suite.expected}`);
  return new Promise(resolve => {
    const child = spawn(process.execPath, suite.argv, {cwd: ROOT, env, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '';
    const sink = chunk => { output += chunk; fs.writeSync(log, chunk); };
    child.stdout.on('data', sink); child.stderr.on('data', sink);
    let timedOut = false;
    const timer = setTimeout(async () => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGTERM'); } catch (error) {}
      await sleep(5000);
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {}
    }, suite.timeoutMs);
    child.on('close', async (code, signal) => {
      clearTimeout(timer);
      const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;
      // Test-owned cleanup: nothing from the child's process group may survive it.
      await sleep(500);
      const leftovers = groupAlive(child.pid) ? groupMembers(child.pid) : [];
      if (leftovers.length) try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {}
      const actual = timedOut ? 'timeout' : code === null ? `signal:${signal}` : code;
      const markerFound = suite.marker.test(output);
      const tail = `\n# actual_exit=${actual} duration_ms=${durationMs.toFixed(0)} marker_found=${markerFound} ` +
        `leftover_processes=${leftovers.length}\n`;
      fs.writeSync(log, tail); fs.closeSync(log);
      resolve({name: suite.name, kind: suite.kind, cwd: ROOT, command, argv: [process.execPath, ...suite.argv],
        nodePath: env.NODE_PATH || null, expectedExit: suite.expected, actualExit: actual, timedOut,
        timeoutMs: suite.timeoutMs, startedAt: started.toISOString(), finishedAt: new Date().toISOString(),
        durationMs: Math.round(durationMs), marker: String(suite.marker), markerFound, leftoverProcesses: leftovers,
        log: rel(logPath), evidence: rel(suite.evidence), output, intended: suite.intended});
    });
  });
}

// Reads a child's own checkpoints.json, whatever its shape, into pass/fail counts.
function childCheckpoints(dir) {
  const file = path.join(dir, 'checkpoints.json');
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(data) ? data : data.checkpoints || [];
  const passed = list.filter(c => c.pass === true || c.passed === true).length;
  return {file: rel(file), total: list.length, passed, failed: list.length - passed,
    status: data.status || data.summary?.status || null, list};
}
function listFiles(dir, pattern) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ?
    listFiles(path.join(dir, e.name), pattern) : pattern.test(e.name) ? [path.join(dir, e.name)] : []);
}

// Independent balance audit of the archived fixed-matrix economy-bot gates.
const BALANCE_GATES = [
  {size: 'tiny', dir: 'artifacts/TASK-163/sibling-revalidation/tiny'},
  {size: 'normal', dir: 'artifacts/TASK-163/sibling-revalidation/normal'},
  {size: 'big', dir: 'artifacts/TASK-163'}
];
const BALANCE_HUMANS = [1, 2, 4, 10, 12];
const BALANCE_SEEDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
function auditBalance(check) {
  const gates = [];
  const ids = new Set();
  let defeats = 0;
  for (const gate of BALANCE_GATES) {
    const read = name => JSON.parse(fs.readFileSync(path.join(ROOT, gate.dir, name), 'utf8'));
    const manifest = read('case-manifest.json'), results = read('results.json'), sources = read('source-identities.json');
    const expectedIds = BALANCE_HUMANS.flatMap(h => BALANCE_SEEDS.map(s => `${gate.size}-H${h}-seed${s}-fog0`)).sort();
    const manifestIds = manifest.cases.map(c => c.id).sort();
    const rows = results.results;
    const resultIds = rows.map(r => r.id).sort();
    check(`balance-${gate.size}-manifest-matrix`, expectedIds, manifestIds);
    check(`balance-${gate.size}-result-matrix`, expectedIds, resultIds);
    check(`balance-${gate.size}-case-specs`, true, manifest.cases.every(c => c.spec.size === gate.size &&
      c.id === `${gate.size}-H${c.spec.humans}-seed${c.spec.seed}-fog0` && c.spec.fog === false && !c.spec.fault));
    const combat = rows.filter(r => r.classification === 'combat-defeat' && r.result === 'defeat' && r.exitStatus === 0 &&
      r.finalHumanAssets.every(a => a.units === 0 && a.towns === 0 && a.buildings === 0) &&
      r.lastHumanRemoval && r.lastHumanRemoval.actorRole === 'DEMONS' && r.lastHumanRemoval.cause === 'unit-action');
    check(`balance-${gate.size}-combat-defeats`, 50, combat.length);
    check(`balance-${gate.size}-harness-verdict`, {passed: true, cases: 50, combatDefeats: 50},
      {passed: results.passed, cases: results.summary.cases, combatDefeats: results.summary.combatDefeats});
    const mismatched = Object.entries(sources.files).filter(([f, h]) =>
      !fs.existsSync(path.join(ROOT, f)) || sha256(path.join(ROOT, f)) !== h).map(([f]) => f);
    check(`balance-${gate.size}-source-hashes-match-tree`, {files: 100, mismatched: []},
      {files: Object.keys(sources.files).length, mismatched});
    for (const id of resultIds) ids.add(id);
    defeats += combat.length;
    gates.push({size: gate.size, dir: gate.dir, head: sources.head, sourceFiles: Object.keys(sources.files).length,
      mismatchedSources: mismatched, cases: rows.length, combatDefeats: combat.length,
      rounds: {min: Math.min(...rows.map(r => r.completedRound)), max: Math.max(...rows.map(r => r.completedRound))},
      maxCpuSeconds: Math.max(...rows.map(r => r.cpuSeconds)),
      harnessSha256: sources.files['ai/test-coop-economy-bot-defeat.js'],
      demonConfigSha256: sources.files['ai/demon-config.js'], waveConfigSha256: sources.files['ai/wave-config.js'],
      reuse: mismatched.length ? 'stale: rerun required' : 'reused: archived gate matches current sources'});
  }
  check('balance-unique-cases', 150, ids.size);
  check('balance-total-combat-defeats', 150, defeats);
  check('balance-single-source-head', 1, new Set(gates.map(g => g.head)).size);
  check('balance-shared-rule-hashes', 1, new Set(gates.map(g => g.demonConfigSha256 + g.waveConfigSha256 +
    g.harnessSha256)).size);
  return {statement: 'Observed 150/150 combat defeats on three fixed matrices (sizes tiny/normal/big x humans ' +
    '1/2/4/10/12 x seeds 0..9, fog off, SimpleAiPlayerWithEconomy). This is an observation on these cases only, ' +
    'not a claim about all maps, seeds, players or strategies.', uniqueCases: ids.size, combatDefeats: defeats, gates};
}

// Installed rules, read from the production sources for the summary.
function installedRules() {
  const {COOP_TYPED_WAVE_SCHEDULE} = require('./wave-config');
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'ai/demon-config.js'), 'utf8') +
    '\nthis.stats = {v1: getDemonTypes(1), v2: getDemonTypes(2)};', context);
  return {waveInterval: COOP_TYPED_WAVE_SCHEDULE.waveInterval, categories: JSON.parse(JSON.stringify(
    COOP_TYPED_WAVE_SCHEDULE.categories)), balanceVersion: 2, stats: JSON.parse(JSON.stringify(context.stats.v2))};
}

async function main() {
  for (const name of ['suite-results.json', 'checkpoints.json', 'source-identities.json', 'summary.md'])
    if (fs.existsSync(path.join(OUT, name))) {
      console.error(`REFUSED existing evidence ${rel(path.join(OUT, name))}; choose a new --output-dir`);
      return 2;
    }
  if (fs.existsSync(path.join(OUT, 'children')) || fs.existsSync(path.join(OUT, 'logs'))) {
    console.error(`REFUSED existing child evidence under ${rel(OUT)}`);
    return 2;
  }
  fs.mkdirSync(OUT, {recursive: true});
  const checkpoints = [];
  const check = (id, expected, observed) => {
    const pass = JSON.stringify(expected) === JSON.stringify(observed);
    checkpoints.push({id, expected, observed, pass});
    console.log(`${pass ? 'PASS' : 'FAIL'} ${id} expected=${JSON.stringify(expected).slice(0, 200)} ` +
      `observed=${JSON.stringify(observed).slice(0, 200)}`);
    return pass;
  };
  const before = sourceIdentities();
  const siblingBefore = siblingState();
  console.log(`BEGIN wave-regressions mode=${FAULT ? 'fault-child-failure (expected negative control)' : 'suite'} ` +
    `head=${before.head} node=${process.version} cwd=${process.cwd()} output=${rel(OUT)}`);
  const children = [];
  for (const suite of suites()) {
    const r = await runChild(suite);
    const own = childCheckpoints(suite.evidence);
    r.childCheckpoints = own && {file: own.file, total: own.total, passed: own.passed, failed: own.failed, status: own.status};
    r.required = true;
    r.passed = r.actualExit === r.expectedExit && r.markerFound && !r.leftoverProcesses.length &&
      (!own || (own.total > 0 && own.failed === 0));
    if (suite.kind === 'server') {
      r.siblingRestored = JSON.stringify(siblingState()) === JSON.stringify(siblingBefore);
      r.passed = r.passed && r.siblingRestored;
    }
    if (suite.kind === 'browser') {
      const errorsFile = path.join(suite.evidence, 'browser-errors.json');
      r.browserErrors = fs.existsSync(errorsFile) ? JSON.parse(fs.readFileSync(errorsFile, 'utf8')) : null;
      r.screenshots = listFiles(suite.evidence, /\.png$/).map(rel).sort();
      r.passed = r.passed && Array.isArray(r.browserErrors) && r.browserErrors.length === 0 && r.screenshots.length > 0;
    }
    if (FAULT && r.intended) r.intendedFailureObserved = r.intended === 'timeout' ? r.timedOut : r.intended.test(r.output);
    console.log(`END child ${r.name} expected_exit=${r.expectedExit} actual_exit=${r.actualExit} ` +
      `duration_ms=${r.durationMs} marker_found=${r.markerFound} leftover_processes=${r.leftoverProcesses.length}` +
      (r.childCheckpoints ? ` child_checkpoints=${r.childCheckpoints.passed}/${r.childCheckpoints.total}` : '') +
      (r.browserErrors ? ` browser_errors=${r.browserErrors.length} screenshots=${r.screenshots.length}` : '') +
      (r.siblingRestored !== undefined ? ` sibling_restored=${r.siblingRestored}` : '') +
      ` evidence=${r.evidence} log=${r.log} status=${r.passed ? 'passed' : 'FAILED'}`);
    if (own && !FAULT) {
      const passedIds = new Set(own.list.filter(c => c.pass === true || c.passed === true)
        .map(c => c.id || c.name || c.checkpoint));
      r.childCheckpointSample = [...passedIds].slice(0, 5);
    }
    children.push(r);
  }
  for (const r of children) {
    check(`child-${r.name}-exit`, r.expectedExit, r.actualExit);
    check(`child-${r.name}-pass-marker`, true, r.markerFound);
    check(`child-${r.name}-no-leftover-processes`, [], r.leftoverProcesses);
    if (r.childCheckpoints) check(`child-${r.name}-own-checkpoints-all-pass`,
      {failed: 0, nonEmpty: true}, {failed: r.childCheckpoints.failed, nonEmpty: r.childCheckpoints.total > 0});
    if (r.siblingRestored !== undefined) check(`child-${r.name}-sibling-server-restored`, true, r.siblingRestored);
    if (r.browserErrors !== undefined) {
      check(`child-${r.name}-zero-browser-errors`, [], r.browserErrors);
      check(`child-${r.name}-screenshots-captured`, true, r.screenshots.length > 0);
    }
  }
  let balance = null, rules = null;
  if (!FAULT) {
    balance = auditBalance(check);
    rules = installedRules();
    check('installed-typed-schedule', {waveInterval: 4, categories: {
      normal: [[4, 'imp'], [8, 'clawling'], [12, 'hound']], ranged: [[12, 'spitter'], [16, 'emberArcher'], [20, 'hexcaster']],
      heavy: [[20, 'brute'], [24, 'bulwark']], highTier: [[24, 'ravager'], [28, 'demonLord']]}},
      {waveInterval: rules.waveInterval, categories: Object.fromEntries(Object.entries(rules.categories)
        .map(([c, steps]) => [c, steps.map(s => [s.round, s.type])]))});
  }
  const after = sourceIdentities();
  check('sources-unchanged-during-run', true, JSON.stringify(before) === JSON.stringify(after));
  const requiredFailures = children.filter(r => r.required && !r.passed).map(r => r.name);
  const auditFailures = checkpoints.filter(c => !c.pass && !c.id.startsWith('child-')).map(c => c.id);
  const passed = requiredFailures.length === 0 && auditFailures.length === 0;

  const write = (name, data) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 1) + '\n');
  write('source-identities.json', {algorithm: 'sha256', ...after, unchangedDuringRun: JSON.stringify(before) ===
    JSON.stringify(after), fileCount: Object.keys(after.files).length,
    siblingFileCount: Object.keys(after.sibling.files).length});
  write('suite-results.json', {program: 'ai/test-coop-wave-regressions.js', mode: FAULT ? 'fault-child-failure' : 'suite',
    negativeControl: FAULT, argv: process.argv.slice(1), cwd: process.cwd(), node: process.version,
    head: after.head, passed, requiredFailures, auditFailures,
    children: children.map(({output, intended, ...r}) => r)});
  write('checkpoints.json', {total: checkpoints.length, passed: checkpoints.filter(c => c.pass).length,
    failed: checkpoints.filter(c => !c.pass).map(c => c.id), checkpoints});
  if (balance) write('balance-manifest-audit.json', balance);
  fs.writeFileSync(path.join(OUT, 'summary.md'), summary({children, balance, rules, passed, requiredFailures,
    auditFailures, head: after.head, checkpoints}));

  if (FAULT) {
    const intended = children.filter(r => r.intended);
    const observed = intended.filter(r => !r.passed && r.intendedFailureObserved).map(r => r.name);
    console.log(`NEGATIVE-CONTROL fault-child-failure required_failures=${requiredFailures.join(',')} ` +
      `intended_failures_observed=${observed.join(',')}/${intended.map(r => r.name).join(',')}`);
  }
  if (!passed) {
    console.log(`FAIL wave-regressions required_failures=${requiredFailures.join(',') || 'none'} ` +
      `audit_failures=${auditFailures.join(',') || 'none'} checkpoints=${checkpoints.filter(c => c.pass).length}/` +
      `${checkpoints.length}`);
    return 1;
  }
  console.log(`PASS wave-regressions children=${children.length} checkpoints=${checkpoints.length} ` +
    `balance_cases=${balance.uniqueCases} combat_defeats=${balance.combatDefeats} head=${after.head}`);
  return 0;
}

function summary({children, balance, rules, passed, requiredFailures, auditFailures, head, checkpoints}) {
  const lines = [`# Typed-wave regression suite ${FAULT ? '(negative control: --fault-child-failure)' : ''}`, '',
    `- head: \`${head}\`; node ${process.version}; status: **${passed ? 'passed' : 'FAILED'}**`,
    `- checkpoints: ${checkpoints.filter(c => c.pass).length}/${checkpoints.length} (checkpoints.json)`,
    `- required failures: ${requiredFailures.join(', ') || 'none'}; audit failures: ${auditFailures.join(', ') || 'none'}`, '',
    '| child | command | expected | actual | duration s | own checkpoints | log | evidence |', '|---|---|---|---|---|---|---|---|'];
  for (const r of children) lines.push(`| ${r.name} | \`${r.command.replace(process.execPath, 'node20')}\` | ` +
    `${r.expectedExit} | ${r.actualExit} | ${(r.durationMs / 1000).toFixed(1)} | ` +
    `${r.childCheckpoints ? `${r.childCheckpoints.passed}/${r.childCheckpoints.total}` : 'stdout PASS lines'} | ` +
    `[log](${path.relative(OUT, path.join(ROOT, r.log))}) | ${path.relative(OUT, path.join(ROOT, r.evidence))} |`);
  const browser = children.filter(r => r.browserErrors !== undefined);
  if (browser.length) {
    lines.push('', '## Browser evidence', '');
    for (const r of browser) lines.push(`- ${r.name}: unexpected browser errors ${r.browserErrors ? r.browserErrors.length : 'missing'}, ` +
      `${r.screenshots.length} screenshots, e.g. ${r.screenshots.slice(0, 4).map(s => `[${path.basename(s)}](${path.relative(OUT, path.join(ROOT, s))})`).join(', ')}`);
  }
  if (rules) {
    lines.push('', `## Installed progression (balanceVersion ${rules.balanceVersion}, typed waves every ${rules.waveInterval} rounds)`, '');
    for (const [category, steps] of Object.entries(rules.categories))
      lines.push(`- ${category}: ${steps.map(s => `round ${s.round} ${s.type}`).join(', ')}`);
    lines.push('', '## Installed demon stat table (version 2)', '', '| type | health | damage | movement | range |', '|---|---|---|---|---|');
    for (const [id, s] of Object.entries(rules.stats)) lines.push(`| ${id} | ${s.health} | ${s.damage} | ${s.movement} | ${s.range} |`);
  }
  if (!FAULT) {
    const byName = Object.fromEntries(children.map(r => [r.name, r]));
    const status = name => byName[name] ? `${byName[name].passed ? 'passed' : 'FAILED'} (exit ${byName[name].actualExit}` +
      `${byName[name].childCheckpoints ? `, ${byName[name].childCheckpoints.passed}/${byName[name].childCheckpoints.total} checkpoints` : ''})` : 'missing';
    lines.push('', '## Local / server / save parity', '',
      `- local synchronized waves: ${status('synchronized-waves')}`,
      `- typed save/load round trips: ${status('typed-wave-save')}`,
      `- local authoritative server integration (identical peers, typed spawns, restarts): ${status('typed-wave-server')}`,
      `- portal next-production previews against real spawns, including save/load: ${status('portal-production')}`);
  }
  if (balance) {
    lines.push('', '## Balance manifests', '', balance.statement, '');
    for (const g of balance.gates) lines.push(`- ${g.size}: ${g.combatDefeats}/${g.cases} combat defeats, rounds ` +
      `${g.rounds.min}-${g.rounds.max}, max ${g.maxCpuSeconds.toFixed(1)} CPU-s, head ${g.head.slice(0, 7)}, ` +
      `${g.sourceFiles} source hashes, ${g.reuse} (${g.dir})`);
  }
  lines.push('', 'Backward compatibility and deployment are out of scope for this suite.', '');
  return lines.join('\n');
}

main().then(code => { process.exitCode = code; }, error => { console.error(error && error.stack || error); process.exitCode = 1; });
