#!/usr/bin/env node
// Independent audit of an ai/test-coop-economy-bot-defeat.js gate output directory.
// Recounts every case from its journal, record, per-round ledger and initial/final snapshots instead of trusting
// the harness summary, then writes results.json, audit-checkpoints.json and ledgers/<case>.json.
//   node ai/audit-coop-economy-bot-defeat.js --output-dir DIR --size tiny --humans 1,2,4,10,12 --seeds 0,...,9
//     [--max-rounds 100] [--case-timeout-ms 600000] [--fault drop-case|survivor|stale-source]
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const POLICY = 'SimpleAiPlayerWithEconomy';
const FAULTS = ['drop-case', 'survivor', 'stale-source'];
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
};
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const bump = (map, key, n = 1) => { map[key] = (map[key] || 0) + n; };
const sameCounts = (a, b) => {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  return [...keys].every(k => (a[k] || 0) === (b[k] || 0));
};

function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error(`bad argument ${argv[i]}`);
    values[argv[i]] = argv[i + 1];
  }
  const list = text => text.split(',').map(Number);
  if (!values['--output-dir'] || !values['--size'] || !values['--humans'] || !values['--seeds'])
    throw new Error('--output-dir, --size, --humans and --seeds are required');
  const fault = values['--fault'] || null;
  if (fault && !FAULTS.includes(fault)) throw new Error(`invalid --fault: ${fault}`);
  return {outputDir: path.resolve(values['--output-dir']), size: values['--size'], humans: list(values['--humans']),
    seeds: list(values['--seeds']), maxRounds: Number(values['--max-rounds'] || 100),
    caseTimeoutMs: Number(values['--case-timeout-ms'] || 600000), fault};
}

function auditCase(out, row, expected) {
  const checks = [];
  const check = (name, expectedValue, observed, pass) => checks.push({case: row.id, name, expected: expectedValue, observed, pass: !!pass});
  const file = rel => path.join(out, rel);
  const exists = rel => fs.existsSync(file(rel)) && fs.statSync(file(rel)).size > 0;
  for (const rel of [row.recordFile, row.journal, row.snapshots.initial, row.snapshots.final])
    check(`file-present:${rel}`, 'non-empty file', exists(rel) ? `${fs.statSync(file(rel)).size} bytes` : 'missing or empty', exists(rel));
  if (!exists(row.recordFile) || !exists(row.journal) || !exists(row.snapshots.initial) || !exists(row.snapshots.final)) return {checks};

  const record = readJson(file(row.recordFile));
  const events = fs.readFileSync(file(row.journal), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  const initial = readJson(file(row.snapshots.initial));
  const final = readJson(file(row.snapshots.final));
  const humanSlots = record.configuration.humanSlots;

  // Case identity and run parameters.
  const s = row.spec;
  check('spec', {size: expected.size, fog: false, maxRounds: expected.maxRounds, cpuBoundMs: expected.caseTimeoutMs, fault: null},
    {size: s.size, fog: s.fog, maxRounds: s.maxRounds, cpuBoundMs: s.cpuBoundMs, fault: s.fault},
    s.size === expected.size && s.fog === false && s.maxRounds === expected.maxRounds && s.cpuBoundMs === expected.caseTimeoutMs && s.fault === null);
  check('generation-matches-case', {humans: s.humans, seed: s.seed, size: s.size}, record.generation,
    record.generation && record.generation.seed === s.seed && humanSlots.length === s.humans);
  check('fog-off', false, {configuration: record.configuration.isFogOfWar, initialSnapshot: initial.isFogOfWar, finalSnapshot: final.isFogOfWar},
    record.configuration.isFogOfWar === false && initial.isFogOfWar === false && final.isFogOfWar === false);
  const policySlots = record.configuration.slots.filter(slot => humanSlots.includes(slot.slot));
  check('policy-unchanged-every-human-slot', `${humanSlots.length} x ${POLICY} role=HUMAN no own overrides`,
    policySlots.map(slot => `${slot.slot}:${slot.class}:${slot.role}:${slot.ownOverrides.join('+') || 'none'}`),
    policySlots.length === s.humans && policySlots.every(slot => slot.class === POLICY && slot.role === 'HUMAN' && !slot.ownOverrides.length));

  // Journal recount.
  const count = {}, spawned = {}, humanRemovalCauses = {}, damageKinds = {};
  let illegal = 0, humanUnitActions = 0, demonUnitActions = 0, prepareOk = 0, goldSpent = 0, demonDamageOnHumans = 0;
  let badDamage = 0, badHumanRemovals = 0, humanRemovals = 0, demonRemovals = 0, waveSpawns = 0, unexplainedBirths = 0;
  const botPlaysBySlot = {}, advances = [];
  let crisisRemovals = 0, lastHumanRemoval = null;
  // player.js Player.nextTurn: gold + income < 0 runs crisisPenalty(), killing every unit of that player. The harness
  // emits the owner's economy-refresh right after the refresh. Only the crisis branch resets gold to 0; the income in that
  // event is read after the kills removed unit upkeep (and after income lost to demon damage since the owner's last play),
  // so it cannot show the negative pre-refresh income. A crisis removal must be followed by a refresh ending at gold 0.
  const crisisRefresh = (i, owner) => {
    for (let j = i + 1; j < events.length; j++) {
      const r = events[j];
      if (r.type === 'economy-refresh' && r.owner === owner) return r.gold === 0;
    }
    return false;
  };
  for (const [i, e] of events.entries()) {
    bump(count, e.type);
    if (e.type === 'unit-action') {
      if (!e.legal) illegal++;
      if (e.role === 'HUMAN') humanUnitActions++; else demonUnitActions++;
    } else if (e.type === 'economy-prepare' && e.ok) { prepareOk++; goldSpent += e.goldBefore - e.goldAfter; }
    else if (e.type === 'economy-placement') { goldSpent += e.goldBefore - e.goldAfter; if (!e.legal) illegal++; }
    else if (e.type === 'bot-play') bump(botPlaysBySlot, e.owner);
    else if (e.type === 'wave') for (const sp of e.spawned) { bump(spawned, sp.type); waveSpawns++; }
    else if (e.type === 'damage') {
      bump(damageKinds, `${e.actorRole}->${e.target.role}`);
      if (e.cause !== 'unit-action' || e.legal !== true || !(e.damage > 0)) badDamage++;
      if (e.actorRole === 'DEMONS' && e.target.role === 'HUMAN') demonDamageOnHumans += e.damage;
    } else if (e.type === 'removal') {
      if (e.target.role === 'HUMAN' && e.target.owner !== null) {
        humanRemovals++;
        lastHumanRemoval = e;
        bump(humanRemovalCauses, e.cause);
        const combat = e.cause === 'unit-action' && e.legal === true && e.actorRole === 'DEMONS';
        const crisis = e.cause === 'turn-refresh' && e.actor === null && e.target.kind !== 'town' && crisisRefresh(i, e.target.owner);
        if (crisis) crisisRemovals++;
        if (!combat && !crisis) badHumanRemovals++;
      } else if (e.target.role === 'DEMONS') demonRemovals++;
    } else if (e.type === 'round-advance') advances.push([e.from, e.to]);
    else if (e.type === 'birth' && e.cause === 'unexplained') unexplainedBirths++;
  }
  const c = record.counters;
  check('bot-economy-actions', 'every human slot played; economy prepares and gold spent > 0; journal counts equal record counters',
    {botPlaysBySlot, botPlays: count['bot-play'] || 0, economyPreparesOk: prepareOk, economyPlacements: count['economy-placement'] || 0,
      goldSpent, humanUnitActions},
    humanSlots.every(slot => botPlaysBySlot[slot] > 0) && (count['bot-play'] || 0) === c.botPlays && prepareOk > 0 &&
      prepareOk === c.economyPreparesOk && (count['economy-placement'] || 0) === c.economyPlacements && goldSpent > 0 &&
      goldSpent === c.economyGoldSpent && humanUnitActions > 0 && humanUnitActions === c.humanUnitActions);
  check('actions-legal', 0, {illegalActions: illegal, unexplainedBirths}, illegal === 0 && unexplainedBirths === 0);
  check('waves-actual-types-counts', {waves: c.waves, spawned: c.spawned},
    {waves: count.wave || 0, spawnCount: waveSpawns, spawned}, (count.wave || 0) > 0 && (count.wave || 0) === c.waves &&
      waveSpawns > 0 && sameCounts(spawned, c.spawned));
  check('combat-damage-legal', 'demon->human damage > 0, every damage event a legal unit action',
    {damageEvents: count.damage || 0, damageKinds, demonDamageOnHumans, badDamage},
    demonDamageOnHumans > 0 && badDamage === 0 && demonDamageOnHumans === c.demonDamageOnHumans);
  check('human-removals-by-demon-combat', 'every human removal is a legal demon unit action or a production crisisPenalty unit kill ' +
    '(owner gold went negative); the last human removal is a legal demon unit action',
    {humanRemovals, humanRemovalCauses, crisisRemovals, demonRemovals, badHumanRemovals,
      lastHumanRemoval: lastHumanRemoval && {cause: lastHumanRemoval.cause, actorRole: lastHumanRemoval.actorRole, legal: lastHumanRemoval.legal,
        target: lastHumanRemoval.target.kind, round: lastHumanRemoval.round}},
    humanRemovals > 0 && badHumanRemovals === 0 && sameCounts(humanRemovalCauses, c.humanRemovalCauses) && lastHumanRemoval &&
      lastHumanRemoval.cause === 'unit-action' && lastHumanRemoval.legal === true && lastHumanRemoval.actorRole === 'DEMONS');

  // Terminal evaluation.
  const resultSets = events.filter(e => e.type === 'result-set');
  const terminals = events.filter(e => e.type === 'terminal');
  const lastObservation = events.filter(e => e.type === 'turn-observation').pop();
  const terminalRound = terminals.length ? terminals[0].round : null;
  check('terminal-defeat-by-evaluator', {resultSets: [{value: 'defeat', previous: null, evaluator: true}], terminal: 'defeat', roundAtMost: expected.maxRounds},
    {resultSets: resultSets.map(e => ({value: e.value, previous: e.previous, evaluator: e.evaluator})), terminals: terminals.map(e => e.result),
      terminalRound, lastObservation: lastObservation && {terminal: lastObservation.terminal, result: lastObservation.result}},
    resultSets.length === 1 && resultSets[0].value === 'defeat' && resultSets[0].evaluator === true &&
      terminals.length === 1 && terminals[0].result === 'defeat' && terminalRound <= expected.maxRounds &&
      lastObservation && lastObservation.terminal === true && lastObservation.result === 'defeat');
  const advancesOk = advances.every(([from, to], i) => from === i && to === i + 1) && advances.length === terminalRound;
  check('rounds-advance-one-at-a-time', `0->1 ... ${terminalRound - 1}->${terminalRound}`, {advances: advances.length,
    first: advances[0] || null, last: advances[advances.length - 1] || null}, advancesOk);

  // Snapshots.
  const humanAssets = snap => humanSlots.map(slot => {
    const p = snap.players[slot];
    return {slot, units: p.units.length, towns: p.towns.length, buildings: p.towns.reduce((n, t) => n + (t.buildings || []).length, 0)};
  });
  const initialAssets = humanAssets(initial), finalAssets = humanAssets(final);
  check('initial-snapshot-humans-have-assets', 'every human slot starts with a town', initialAssets,
    initialAssets.every(a => a.towns > 0));
  check('final-snapshot-no-human-assets', 'units=towns=buildings=0 in every human slot', {gameRound: final.gameRound,
    result: final.gameSettings && final.gameSettings.coop ? final.gameSettings.coop.result : null, finalAssets},
    finalAssets.every(a => a.units === 0 && a.towns === 0 && a.buildings === 0) && final.gameRound === terminalRound &&
      (!final.gameSettings || !final.gameSettings.coop || final.gameSettings.coop.result === undefined || final.gameSettings.coop.result === 'defeat'));

  // Per-round ledger.
  const rounds = record.rounds;
  const lastRound = rounds[rounds.length - 1];
  const ledgerOk = rounds.length > 0 && rounds.every((r, i) => i === 0 || r.fromRound === rounds[i - 1].round) &&
    lastRound.terminal === true && lastRound.result === 'defeat' && lastRound.round === terminalRound &&
    lastRound.humans.length === s.humans && lastRound.humans.every(h => h.lost && h.units === 0 && h.towns === 0 && h.buildings === 0);
  check('per-round-asset-ledger', `contiguous ledger ending terminal defeat at round ${terminalRound} with zero human assets`,
    {entries: rounds.length, last: lastRound && {round: lastRound.round, terminal: lastRound.terminal, result: lastRound.result, humans: lastRound.humans}},
    ledgerOk);
  const ledger = {case: row.id, source: row.recordFile, rounds: rounds.map(r => ({fromRound: r.fromRound, round: r.round, terminal: r.terminal,
    result: r.result, humans: r.humans, humanAssets: r.humans.reduce((n, h) => n + h.units + h.towns, 0), demons: r.demons, portals: r.portals,
    delta: r.delta}))};
  writeJson(path.join(out, 'ledgers', `${row.id}.json`), ledger);

  // Manifest row agrees with the evidence.
  check('manifest-row', {classification: 'combat-defeat', gatePass: true, exitStatus: 0, timedOut: false, completedRound: terminalRound},
    {classification: row.classification, gatePass: row.gatePass, exitStatus: row.exitStatus, timedOut: row.timedOut,
      completedRound: row.summary.completedRound, elapsedMs: row.elapsedMs, cpuSeconds: row.cpuSeconds, lastPhase: row.lastPhase},
    row.classification === 'combat-defeat' && row.gatePass === true && row.exitStatus === 0 && row.timedOut === false &&
      row.summary.completedRound === terminalRound && Number.isFinite(row.elapsedMs) && row.lastPhase && row.lastPhase.stage === 'completed');

  const result = {id: row.id, size: s.size, humans: s.humans, seed: s.seed, fog: s.fog, classification: row.classification,
    result: terminals.length ? terminals[0].result : null, completedRound: terminalRound, exitStatus: row.exitStatus,
    elapsedMs: row.elapsedMs, cpuSeconds: row.cpuSeconds, wallSeconds: row.wallSeconds, lastPhase: row.lastPhase,
    botPlays: count['bot-play'] || 0, economyPreparesOk: prepareOk, economyPlacements: count['economy-placement'] || 0, economyGoldSpent: goldSpent,
    humanUnitActions, demonUnitActions, waves: count.wave || 0, spawned, demonDamageOnHumans, humanRemovals, humanRemovalCauses,
    crisisRemovals, lastHumanRemoval, finalHumanAssets: finalAssets,
    files: {record: row.recordFile, journal: row.journal, initialSnapshot: row.snapshots.initial, finalSnapshot: row.snapshots.final,
      ledger: `ledgers/${row.id}.json`},
    auditPass: checks.every(x => x.pass)};
  return {checks, result};
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = args.outputDir;
  const manifest = readJson(path.join(out, 'case-manifest.json'));
  const harnessCheckpoints = readJson(path.join(out, 'checkpoints.json'));
  const identities = readJson(path.join(out, 'source-identities.json'));
  const policy = readJson(path.join(out, 'policy-identities.json'));
  if (args.fault === 'drop-case') manifest.cases.pop();
  if (args.fault === 'survivor') manifest.cases[0].classification = 'survival';
  if (args.fault === 'stale-source') identities.files[Object.keys(identities.files)[0]] = '0'.repeat(64);

  const checks = [];
  const check = (name, expected, observed, pass) => checks.push({case: null, name, expected, observed, pass: !!pass});
  const expectedIds = [];
  for (const humans of args.humans) for (const seed of args.seeds) expectedIds.push(`${args.size}-H${humans}-seed${seed}-fog0`);
  const ids = manifest.cases.map(r => r.id);
  check('manifest-case-count', expectedIds.length, ids.length, ids.length === expectedIds.length);
  check('manifest-ids-unique', ids.length, new Set(ids).size, new Set(ids).size === ids.length);
  const missing = expectedIds.filter(id => !ids.includes(id)), extra = ids.filter(id => !expectedIds.includes(id));
  check('manifest-matrix-complete', {missing: [], extra: []}, {missing, extra}, !missing.length && !extra.length);
  const distinctMaps = new Set(manifest.cases.map(r => {
    try { return readJson(path.join(out, r.recordFile)).generatedMapSha256; } catch (e) { return null; }
  }));
  check('distinct-generated-games', ids.length, distinctMaps.size, distinctMaps.size === ids.length && !distinctMaps.has(null));
  const expectedArgv = ['--size', args.size, '--humans', args.humans.join(','), '--seeds', args.seeds.join(','), '--max-rounds',
    String(args.maxRounds), '--case-timeout-ms', String(args.caseTimeoutMs)];
  check('manifest-run-parameters', {mode: 'gate', fog: false, maxRounds: args.maxRounds, cpuBoundMs: args.caseTimeoutMs, fault: null, argvPrefix: expectedArgv},
    {mode: manifest.mode, fog: manifest.fog, maxRounds: manifest.maxRounds, cpuBoundMs: manifest.cpuBoundMs, fault: manifest.fault, argv: manifest.argv},
    manifest.mode === 'gate' && manifest.fog === false && manifest.maxRounds === args.maxRounds && manifest.cpuBoundMs === args.caseTimeoutMs &&
      manifest.fault === null && !manifest.faultCpuBound && expectedArgv.every((v, i) => manifest.argv[i] === v));
  check('harness-gate-passed', true, {manifestPassed: manifest.passed, gateClaimed: manifest.gateClaimed, checkpointsPassed: harnessCheckpoints.passed,
    failedCheckpoints: harnessCheckpoints.checkpoints.filter(x => !x.pass).map(x => x.name)},
    manifest.passed === true && manifest.gateClaimed === true && harnessCheckpoints.passed === true);

  // Source hashes recorded by the run must still describe the files on disk.
  const drift = Object.entries(identities.files).filter(([file, hash]) => {
    try { return sha(fs.readFileSync(path.join(ROOT, file))) !== hash; } catch (e) { return true; }
  }).map(([file]) => file);
  check('source-identities-match-tested-files', {drift: []}, {fileCount: Object.keys(identities.files).length, drift, head: identities.head},
    Object.keys(identities.files).length > 0 && !drift.length);
  const policyMethodsOk = policy.policyClass === POLICY && policy.methods.length > 0 && policy.methods.every(m => m.foundVerbatimInSource) &&
    policy.cases.length === ids.length && policy.cases.every(x => x.methodShaMatchesFirst);
  check('policy-source-unchanged', `${POLICY} methods verbatim in ai/players.js for every case`,
    {methods: policy.methods.length, notVerbatim: policy.methods.filter(m => !m.foundVerbatimInSource).map(m => m.name),
      casesMatchingFirst: policy.cases.filter(x => x.methodShaMatchesFirst).length}, policyMethodsOk);

  const results = [];
  for (const row of manifest.cases) {
    const audited = auditCase(out, row, args);
    checks.push(...audited.checks);
    if (audited.result) results.push(audited.result);
  }
  const defeats = results.filter(r => r.auditPass && r.classification === 'combat-defeat').length;
  check('observed-combat-defeats', `${expectedIds.length}/${expectedIds.length}`, `${defeats}/${ids.length}`, defeats === expectedIds.length);

  const passed = checks.every(x => x.pass);
  const rounds = results.map(r => r.completedRound);
  const summary = {size: args.size, cases: ids.length, combatDefeats: defeats,
    observedDefeatRate: `${defeats}/${expectedIds.length}`,
    statement: `Observed ${defeats}/${expectedIds.length} combat defeats for this fixed matrix (humans ${args.humans.join('/')} x seeds ` +
      `${args.seeds[0]}..${args.seeds[args.seeds.length - 1]}, fog off); this is not a universal probability claim.`,
    completedRounds: {min: Math.min(...rounds), max: Math.max(...rounds)},
    maxCpuSeconds: Math.max(...results.map(r => r.cpuSeconds)), maxElapsedMs: Math.max(...results.map(r => r.elapsedMs)),
    sourceHead: identities.head, sourceFiles: Object.keys(identities.files).length};
  const suffix = args.fault ? `-fault-${args.fault}` : '';
  writeJson(path.join(out, `results${suffix}.json`), {passed, summary, manifestStartedAt: manifest.startedAt, manifestFinishedAt: manifest.finishedAt,
    runtime: manifest.runtime, results});
  writeJson(path.join(out, `audit-checkpoints${suffix}.json`), {passed, total: checks.length, failed: checks.filter(x => !x.pass).length,
    failedNames: checks.filter(x => !x.pass).map(x => `${x.case || 'global'}:${x.name}`), checkpoints: checks});
  console.log(`${passed ? 'PASS' : 'FAIL'} economy-bot-defeat audit size=${args.size} cases=${ids.length} combatDefeats=${defeats}/${expectedIds.length} ` +
    `checkpoints=${checks.filter(x => x.pass).length}/${checks.length} rounds=${summary.completedRounds.min}-${summary.completedRounds.max} ` +
    `maxCpuSeconds=${summary.maxCpuSeconds.toFixed(2)} fault=${args.fault || 'none'}`);
  for (const x of checks.filter(y => !y.pass)) console.log(`FAILED ${x.case || 'global'}:${x.name} observed=${JSON.stringify(x.observed).slice(0, 400)}`);
  process.exitCode = passed ? 0 : 1;
}

try { main(); } catch (error) { console.error(error && error.stack || error); process.exitCode = 2; }
