'use strict';
// Pure typed portal wave schedule: categories, per-round selection, next-production
// lookup and seedless composition, checked in Node and in a browser-style VM realm.
// Usage: node20 ai/test-coop-typed-wave-config.js --output-dir DIR
//        node20 ai/test-coop-typed-wave-config.js --fault late-imp|order-dependent|next-at-wave
const assert = require('assert').strict;
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {spawnSync, execSync} = require('child_process');
const ROOT = path.join(__dirname, '..');
const SOURCES = ['ai/wave-config.js', 'ai/wave-composition.js', 'ai/wave-placement.js', 'ai/demon-config.js',
  'index.html', 'ai/test-coop-typed-wave-config.js'];

// Independent design literals; none of these read production values.
const CATEGORIES = ['normal', 'ranged', 'heavy', 'highTier'];
const WAVE_ROUNDS = [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88, 92, 96, 100];
const _ = null;
const SCHEDULE_AT_WAVES = {
  //       4      8           12       16             20             24           28-100
  normal: ['imp', 'clawling', 'hound', 'hound', 'hound', 'hound', 'hound', 'hound', 'hound', 'hound', 'hound',
    'hound', 'hound', 'hound', 'hound', 'hound', 'hound', 'hound', 'hound', 'hound', 'hound', 'hound', 'hound',
    'hound', 'hound'],
  ranged: [_, 'spitter', 'spitter', 'emberArcher', 'emberArcher', 'hexcaster', 'hexcaster', 'hexcaster',
    'hexcaster', 'hexcaster', 'hexcaster', 'hexcaster', 'hexcaster', 'hexcaster', 'hexcaster', 'hexcaster',
    'hexcaster', 'hexcaster', 'hexcaster', 'hexcaster', 'hexcaster', 'hexcaster', 'hexcaster', 'hexcaster',
    'hexcaster'],
  heavy: [_, _, 'brute', 'brute', 'bulwark', 'bulwark', 'bulwark', 'bulwark', 'bulwark', 'bulwark', 'bulwark',
    'bulwark', 'bulwark', 'bulwark', 'bulwark', 'bulwark', 'bulwark', 'bulwark', 'bulwark', 'bulwark', 'bulwark',
    'bulwark', 'bulwark', 'bulwark', 'bulwark'],
  highTier: [_, _, _, _, _, _, _, 'ravager', 'demonLord', 'demonLord', 'demonLord', 'demonLord', 'demonLord',
    'demonLord', 'demonLord', 'demonLord', 'demonLord', 'demonLord', 'demonLord', 'demonLord', 'demonLord',
    'demonLord', 'demonLord', 'demonLord', 'demonLord']
};
const TRANSITIONS = {normal: [4, 8, 12], ranged: [8, 16, 24], heavy: [12, 20], highTier: [32, 36]};
// [completedRound, nextRound, type, roundsRemaining]; before/at/after every transition.
const NEXT = {
  normal: [[0, 4, 'imp', 4], [3, 4, 'imp', 1], [4, 8, 'clawling', 4], [5, 8, 'clawling', 3], [7, 8, 'clawling', 1],
    [8, 12, 'hound', 4], [9, 12, 'hound', 3], [11, 12, 'hound', 1], [12, 16, 'hound', 4], [13, 16, 'hound', 3],
    [99, 100, 'hound', 1], [100, 104, 'hound', 4], [1000, 1004, 'hound', 4]],
  ranged: [[0, 8, 'spitter', 8], [3, 8, 'spitter', 5], [4, 8, 'spitter', 4], [5, 8, 'spitter', 3],
    [7, 8, 'spitter', 1], [8, 12, 'spitter', 4], [9, 12, 'spitter', 3], [15, 16, 'emberArcher', 1],
    [16, 20, 'emberArcher', 4], [17, 20, 'emberArcher', 3], [23, 24, 'hexcaster', 1], [24, 28, 'hexcaster', 4],
    [25, 28, 'hexcaster', 3], [100, 104, 'hexcaster', 4]],
  heavy: [[0, 12, 'brute', 12], [4, 12, 'brute', 8], [11, 12, 'brute', 1], [12, 16, 'brute', 4],
    [13, 16, 'brute', 3], [19, 20, 'bulwark', 1], [20, 24, 'bulwark', 4], [21, 24, 'bulwark', 3],
    [100, 104, 'bulwark', 4]],
  highTier: [[0, 32, 'ravager', 32], [28, 32, 'ravager', 4], [31, 32, 'ravager', 1], [32, 36, 'demonLord', 4],
    [33, 36, 'demonLord', 3], [35, 36, 'demonLord', 1], [36, 40, 'demonLord', 4], [37, 40, 'demonLord', 3],
    [100, 104, 'demonLord', 4]]
};
const DEMON_TYPE_IDS = ['imp', 'clawling', 'hound', 'brute', 'bulwark', 'spitter', 'emberArcher', 'hexcaster',
  'ravager', 'demonLord'];

const checkpoints = [];
function compare(id, observed, expected) {
  // JSON normalization also removes VM-realm prototypes from browser-realm values.
  observed = observed === undefined ? '<undefined>' : JSON.parse(JSON.stringify(observed));
  expected = JSON.parse(JSON.stringify(expected));
  let pass = true;
  try { assert.deepEqual(observed, expected); } catch (e) { pass = false; }
  checkpoints.push({id, expected, observed, pass});
  if (!pass) {
    console.log(`MISMATCH ${id} expected=${JSON.stringify(expected)} observed=${JSON.stringify(observed)}`);
    assert.fail(`checkpoint ${id}`);
  }
}
function throwsName(fn) {
  try { fn(); return 'no-throw'; } catch (e) { return e.name; }
}
function expectedAt(category, round) {
  const index = WAVE_ROUNDS.indexOf(round);
  return index === -1 ? null : SCHEDULE_AT_WAVES[category][index];
}
function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

function checkSchedule(a, runtime, record) {
  compare(`${runtime}-categories`, a.COOP_PORTAL_CATEGORIES, CATEGORIES);
  compare(`${runtime}-literal-transitions`, a.COOP_TYPED_WAVE_SCHEDULE, {waveInterval: 4, categories: {
    normal: [{round: 4, type: 'imp'}, {round: 8, type: 'clawling'}, {round: 12, type: 'hound'}],
    ranged: [{round: 8, type: 'spitter'}, {round: 16, type: 'emberArcher'}, {round: 24, type: 'hexcaster'}],
    heavy: [{round: 12, type: 'brute'}, {round: 20, type: 'bulwark'}],
    highTier: [{round: 32, type: 'ravager'}, {round: 36, type: 'demonLord'}]}});
  const table = {};
  for (const category of CATEGORIES) {
    const observed = [];
    const expected = [];
    for (let round = 0; round <= 100; round++) {
      observed.push(a.getCoopScheduledDemonType(category, round));
      expected.push(expectedAt(category, round));
    }
    compare(`${runtime}-schedule-${category}-rounds-0-100`, observed, expected);
    table[category] = observed;
  }
  const waveFlags = [];
  for (let round = 0; round <= 100; round++) waveFlags.push(a.isCoopTypedWaveRound(round));
  compare(`${runtime}-wave-rounds-0-100`, waveFlags.map((flag, round) => flag ? round : null).filter(r => r !== null),
    WAVE_ROUNDS);
  // Indefinite repetition of the strongest reached type, far past the table.
  for (const [round, expected] of [[101, [null, null, null, null]], [104, ['hound', 'hexcaster', 'bulwark', 'demonLord']],
    [4000, ['hound', 'hexcaster', 'bulwark', 'demonLord']], [4002, [null, null, null, null]],
    [Number.MAX_SAFE_INTEGER - 3, ['hound', 'hexcaster', 'bulwark', 'demonLord']]])
    compare(`${runtime}-repeat-round-${round}`, CATEGORIES.map(c => a.getCoopScheduledDemonType(c, round)), expected);
  for (const category of CATEGORIES) {
    for (const [completed, round, type, roundsRemaining] of NEXT[category])
      compare(`${runtime}-next-${category}-${completed}`, a.getCoopNextScheduledProduction(category, completed),
        {round, type, roundsRemaining});
    for (const t of TRANSITIONS[category]) {
      compare(`${runtime}-next-${category}-transition-${t}-covered`,
        [t - 1, t, t + 1].every(r => NEXT[category].some(row => row[0] === r)), true);
    }
    // Consistency with the literal round table for every completed round 0..99.
    for (let completed = 0; completed < 100; completed++) {
      const round = WAVE_ROUNDS.find(w => w > completed && expectedAt(category, w));
      compare(`${runtime}-next-${category}-table-${completed}`, a.getCoopNextScheduledProduction(category, completed),
        {round, type: expectedAt(category, round), roundsRemaining: round - completed});
    }
  }
  if (record) record.schedule = table;
}

function portalSet(seed, humans) {
  const random = lcg(seed);
  const used = new Set();
  const portals = [];
  for (let i = 0; i < 4 * humans; i++) {
    let x, y;
    do { x = Math.floor(random() * 62); y = Math.floor(random() * 62); } while (used.has(`${x},${y}`));
    used.add(`${x},${y}`);
    portals.push({x, y, category: CATEGORIES[i % 4]});
  }
  return portals.sort((p, q) => p.x - q.x || p.y - q.y);
}
function shuffled(list, seed) {
  const random = lcg(seed);
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function typeCounts(wave) {
  const counts = {};
  for (const type of wave.types) counts[type] = (counts[type] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort());
}

function checkComposition(a, runtime, record) {
  const one = CATEGORIES.map((category, i) => ({x: i, y: 0, category}));
  for (let round = 0; round <= 100; round++) {
    const expected = CATEGORIES.map((c, i) => ({x: i, y: 0, type: expectedAt(c, round)})).filter(s => s.type);
    compare(`${runtime}-compose-one-per-category-round-${round}`, a.composeTypedCoopWave(round, one),
      {round, types: expected.map(s => s.type), selections: expected});
  }
  compare(`${runtime}-compose-empty`, a.composeTypedCoopWave(8, []), {round: 8, types: [], selections: []});
  compare(`${runtime}-compose-signature-has-no-seed`, a.composeTypedCoopWave.length, 1);
  const comparisons = [];
  for (const humans of [1, 4, 10, 12]) {
    for (const round of [3, 4, 8, 12, 16, 24, 32, 36, 100]) {
      const perSeed = [];
      for (let seed = 0; seed < 8; seed++) {
        const portals = portalSet(seed * 7919 + humans, humans);
        const expected = portals.map(p => ({x: p.x, y: p.y, type: expectedAt(p.category, round)}))
          .filter(s => s.type).sort((p, q) => p.x - q.x || p.y - q.y);
        const base = a.composeTypedCoopWave(round, portals);
        compare(`${runtime}-seed-order-H${humans}-round-${round}-seed-${seed}-exact`, base,
          {round, types: expected.map(s => s.type), selections: expected});
        const variants = {
          reversed: [...portals].reverse(),
          shuffled: shuffled(portals, seed + 1),
          // Human elimination and live demons are not inputs; extra context is ignored.
          eliminatedHumansAndLiveDemons: portals.map(p => ({...p, owner: 'eliminated', liveDemons: 9, seed: 12345}))
        };
        for (const [name, list] of Object.entries(variants))
          compare(`${runtime}-seed-order-H${humans}-round-${round}-seed-${seed}-${name}`,
            a.composeTypedCoopWave(round, list), base);
        perSeed.push({seed, portals: portals.length, counts: typeCounts(base)});
      }
      const counts = {};
      for (const c of CATEGORIES) {
        const type = expectedAt(c, round);
        if (type) counts[type] = (counts[type] || 0) + humans;
      }
      const expectedCounts = Object.fromEntries(Object.entries(counts).sort());
      compare(`${runtime}-seed-independent-counts-H${humans}-round-${round}`, perSeed.map(s => s.counts),
        perSeed.map(() => expectedCounts));
      comparisons.push({humans, round, expectedCounts, perSeed, variants: ['reversed', 'shuffled',
        'eliminatedHumansAndLiveDemons'], identical: true});
    }
  }
  if (record) record.seedOrder = comparisons;
}

function checkInvalid(a, runtime) {
  const badRounds = [-1, 1.5, NaN, Infinity, '4', null, undefined, Number.MAX_SAFE_INTEGER + 1];
  const badCategories = ['Normal', '', null, undefined, 1, 'toString', '__proto__', 'high_tier'];
  const observed = {
    typeRound: badRounds.map(r => throwsName(() => a.getCoopScheduledDemonType('normal', r))),
    nextRound: badRounds.map(r => throwsName(() => a.getCoopNextScheduledProduction('normal', r))),
    waveRound: badRounds.map(r => throwsName(() => a.isCoopTypedWaveRound(r))),
    composeRound: badRounds.map(r => throwsName(() => a.composeTypedCoopWave(r, []))),
    typeCategory: badCategories.map(c => throwsName(() => a.getCoopScheduledDemonType(c, 4))),
    typeCategoryOffWave: badCategories.map(c => throwsName(() => a.getCoopScheduledDemonType(c, 3))),
    nextCategory: badCategories.map(c => throwsName(() => a.getCoopNextScheduledProduction(c, 0))),
    nextOverflow: throwsName(() => a.getCoopNextScheduledProduction('normal', Number.MAX_SAFE_INTEGER)),
    composePortals: [null, 'portals', [{x: 1, y: 1, category: 'normal'}, {x: 1, y: 1, category: 'heavy'}],
      [{x: -1, y: 0, category: 'normal'}], [{x: 0.5, y: 0, category: 'normal'}], [null],
      [{x: 0, y: 0}], [{x: 0, y: 0, category: 'boss'}]].map(p => throwsName(() => a.composeTypedCoopWave(8, p)))
  };
  const r = name => badRounds.map(() => name);
  const c = name => badCategories.map(() => name);
  compare(`${runtime}-invalid-inputs`, observed, {typeRound: r('RangeError'), nextRound: r('RangeError'),
    waveRound: r('RangeError'), composeRound: r('RangeError'), typeCategory: c('RangeError'),
    typeCategoryOffWave: c('RangeError'), nextCategory: c('RangeError'), nextOverflow: 'RangeError',
    composePortals: Array(8).fill('RangeError')});
  const mutations = [() => { a.COOP_TYPED_WAVE_SCHEDULE.waveInterval = 2; },
    () => { a.COOP_TYPED_WAVE_SCHEDULE.categories.normal[0].round = 0; },
    () => { a.COOP_TYPED_WAVE_SCHEDULE.categories.heavy.push({round: 4, type: 'imp'}); },
    () => { a.COOP_TYPED_WAVE_SCHEDULE.categories.boss = []; },
    () => { a.COOP_PORTAL_CATEGORIES.push('boss'); }];
  compare(`${runtime}-rejects-mutation`, mutations.map(m => throwsName(m)), Array(5).fill('TypeError'));
  const next = a.getCoopNextScheduledProduction('normal', 0);
  next.type = 'demonLord';
  compare(`${runtime}-next-result-detached`, a.getCoopNextScheduledProduction('normal', 0),
    {round: 4, type: 'imp', roundsRemaining: 4});
}

function loadBrowserRealm() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const order = ['ai/demon-config.js', 'ai/wave-config.js', 'ai/wave-composition.js', 'ai/wave-placement.js']
    .map(src => html.indexOf(`<script src='${src}'></script>`));
  compare('browser-script-order', order.every((index, i) => index !== -1 && (i === 0 || index > order[i - 1])), true);
  const context = vm.createContext({});
  for (const src of ['ai/wave-config.js', 'ai/wave-composition.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT, src), 'utf8'), context, {filename: src});
  return vm.runInContext(`({COOP_TYPED_WAVE_SCHEDULE, COOP_PORTAL_CATEGORIES, isCoopTypedWaveRound,
    getCoopScheduledDemonType, getCoopNextScheduledProduction, composeTypedCoopWave})`, context);
}
function nodeApi() {
  return {...require('./wave-config'), composeTypedCoopWave: require('./wave-composition').composeTypedCoopWave};
}
function checkTypeRegistry(a) {
  const scheduled = [...new Set(CATEGORIES.flatMap(c => a.COOP_TYPED_WAVE_SCHEDULE.categories[c].map(s => s.type)))];
  compare('scheduled-types-cover-all-demon-types', [...scheduled].sort(), [...DEMON_TYPE_IDS].sort());
  compare('scheduled-types-in-demon-config', scheduled.every(id =>
    Object.prototype.hasOwnProperty.call(require('./demon-config'), id)), true);
  const placement = fs.readFileSync(path.join(__dirname, 'wave-placement.js'), 'utf8');
  compare('scheduled-types-constructible-by-placement', scheduled.filter(id => !new RegExp(`\\b${id}:`).test(placement)), []);
}

function runFault(fault) {
  const a = nodeApi();
  if (fault === 'late-imp') {
    const original = a.getCoopScheduledDemonType;
    a.getCoopScheduledDemonType = (c, r) => c === 'normal' && r === 4 ? null : original(c, r);
    checkSchedule(a, 'node');
  } else if (fault === 'order-dependent') {
    const original = a.composeTypedCoopWave;
    // Order coupling: unsorted input makes each portal take the next input portal's category.
    a.composeTypedCoopWave = (round, portals = []) => original(round, portals.every((p, i) => !i ||
      portals[i - 1].x < p.x || (portals[i - 1].x === p.x && portals[i - 1].y < p.y)) ? portals :
      portals.map((p, i) => ({...p, category: portals[(i + 1) % portals.length].category})));
    checkComposition(a, 'node');
  } else if (fault === 'next-at-wave') {
    const original = a.getCoopNextScheduledProduction;
    a.getCoopNextScheduledProduction = (c, r) => a.getCoopScheduledDemonType(c, r) ?
      {round: r, type: a.getCoopScheduledDemonType(c, r), roundsRemaining: 0} : original(c, r);
    checkSchedule(a, 'node');
  } else throw new Error(`unknown fault ${fault}`);
  console.log(`FAULT ${fault} was not detected`);
}

function run(outputDir) {
  fs.mkdirSync(outputDir, {recursive: true});
  for (const name of ['checkpoints.json', 'schedule.json', 'seed-order-comparisons.json', 'source-identities.json'])
    if (fs.existsSync(path.join(outputDir, name))) throw new Error(`refusing to overwrite ${path.join(outputDir, name)}`);
  const identities = () => Object.fromEntries(SOURCES.map(src =>
    [src, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, src))).digest('hex')]));
  const before = identities();
  const record = {};
  const runtimes = [['node', nodeApi()], ['browser', loadBrowserRealm()]];
  for (const [runtime, a] of runtimes) {
    checkSchedule(a, runtime, runtime === 'node' ? record : null);
    checkComposition(a, runtime, runtime === 'node' ? record : null);
    checkInvalid(a, runtime);
  }
  compare('node-browser-schedule-identical', CATEGORIES.map(c => Array.from({length: 101}, (x, r) =>
    runtimes[1][1].getCoopScheduledDemonType(c, r))), CATEGORIES.map(c => record.schedule[c]));
  checkTypeRegistry(runtimes[0][1]);
  const negative = [];
  for (const [fault, marker] of [['late-imp', 'MISMATCH node-schedule-normal-rounds-0-100'],
    ['order-dependent', 'MISMATCH node-seed-order-H1-round-4-seed-0-reversed'],
    ['next-at-wave', 'MISMATCH node-next-normal-4 ']]) {
    const child = spawnSync(process.execPath, [__filename, '--fault', fault], {encoding: 'utf8'});
    process.stdout.write(child.stdout.split('\n').filter(l => l.startsWith('MISMATCH')).join('\n') + '\n');
    const observed = {exit: child.status, marker: child.stdout.includes(marker)};
    console.log(`NEGATIVE ${fault} exit=${child.status} marker=${JSON.stringify(marker)} found=${observed.marker}`);
    negative.push({fault, marker, exit: child.status});
    compare(`negative-control-${fault}`, observed, {exit: 1, marker: true});
  }
  compare('sources-unchanged-during-run', identities(), before);
  const schedule = {waveInterval: 4, categories: CATEGORIES, rounds: '0..100 (index = absolute completed round)',
    transitions: runtimes[0][1].COOP_TYPED_WAVE_SCHEDULE.categories, typeByRound: record.schedule,
    nextProduction: Object.fromEntries(CATEGORIES.map(c => [c, Array.from({length: 101}, (x, r) =>
      ({completedRound: r, ...runtimes[0][1].getCoopNextScheduledProduction(c, r)}))]))};
  let head = null;
  try { head = execSync('git rev-parse HEAD', {cwd: ROOT, encoding: 'utf8'}).trim(); } catch (e) {}
  fs.writeFileSync(path.join(outputDir, 'schedule.json'), JSON.stringify(schedule, null, 1) + '\n');
  fs.writeFileSync(path.join(outputDir, 'seed-order-comparisons.json'), JSON.stringify(record.seedOrder, null, 1) + '\n');
  fs.writeFileSync(path.join(outputDir, 'source-identities.json'), JSON.stringify({algorithm: 'sha256', head,
    node: process.version, files: before}, null, 1) + '\n');
  fs.writeFileSync(path.join(outputDir, 'checkpoints.json'), JSON.stringify({total: checkpoints.length,
    passed: checkpoints.filter(c => c.pass).length, negativeControls: negative, checkpoints}, null, 1) + '\n');
  console.log(`PASS co-op typed wave config categories=4 rounds=0..100 runtimes=node,browser checkpoints=${checkpoints.length} negative_controls=${negative.length}`);
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const option = name => argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined;
  try {
    if (option('--fault')) runFault(option('--fault'));
    else if (option('--output-dir')) run(path.resolve(option('--output-dir')));
    else throw new Error('usage: --output-dir DIR | --fault late-imp|order-dependent|next-at-wave');
  } catch (error) {
    console.error(error.stack || error);
    process.exit(1);
  }
}
