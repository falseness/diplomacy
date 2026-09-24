#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const state = pid => {
  try { const fields = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1).split(' '); return {start: fields[19], live: fields[0] !== 'Z', parent: Number(fields[1]), group: Number(fields[2])}; }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
};
async function supervise({program, args, journal, stopAt, graceMs = 10000}) {
  fs.writeFileSync(journal, '', {flag: 'wx'});
  const records = () => fs.readFileSync(journal, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const alive = row => { const s = state(row.pid); return s?.live && s.start === row.start; };
  const signal = (rows, sig) => { for (const row of rows) if (alive(row)) { try { process.kill(row.pid, sig); } catch (e) { if (e.code !== 'ESRCH') throw e; } } };
  const child = spawn(program, args, {stdio: 'inherit', detached: true, env: {...process.env,
    TASK245_OWNERSHIP: journal, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${path.join(__dirname, 'task245-owned-preload.js')}`}});
  if (child.pid) fs.appendFileSync(journal, JSON.stringify({pid: child.pid, start: state(child.pid)?.start}) + '\n');
  // Track native browser descendants too: they do not load the Node preload.
  const discover = () => {
    const known = new Map(records().filter(r => r.pid).map(r => [r.pid, r]));
    const all = fs.readdirSync('/proc').filter(n => /^\d+$/.test(n)).map(n => ({pid: Number(n), ...state(Number(n))}));
    let added;
    do {
      added = false;
      for (const row of all) if (row.live && !known.has(row.pid) &&
        ((known.has(row.parent) && alive(known.get(row.parent))) ||
         (known.has(row.group) && alive(known.get(row.group))))) {
        const record = {pid: row.pid, start: row.start};
        fs.appendFileSync(journal, JSON.stringify(record) + '\n');
        known.set(row.pid, record); added = true;
      }
    } while (added);
  };
  const tracker = setInterval(discover, 50);
  let timedOut = false, settled = false, timer;
  const result = await new Promise(resolve => {
    child.once('error', e => { settled = true; resolve({exit: null, error: e.message}); });
    child.once('exit', (exit, signal) => { settled = true; resolve({exit, signal}); });
    timer = setTimeout(() => { timedOut = true; resolve({exit: null, signal: 'deadline'}); }, Math.max(1, stopAt - Date.now()));
  });
  clearTimeout(timer);
  // SIGTERM permits ordinary child cleanup; identity-checked fallback handles
  // blocked event loops and detached services even when finally never executes.
  discover();
  const initial = records().filter(r => r.pid);
  signal(initial, 'SIGTERM');
  const until = Date.now() + graceMs;
  while (Date.now() < until && records().some(r => r.pid && alive(r))) await sleep(50);
  const processes = records().filter(r => r.pid);
  signal(processes, 'SIGKILL');
  const reapUntil = Date.now() + 5000;
  while (Date.now() < reapUntil && (records().some(r => r.pid && alive(r)) || !settled)) {
    signal(records().filter(r => r.pid), 'SIGKILL');
    await sleep(50);
  }
  clearInterval(tracker);
  const directories = records().filter(r => r.dir).reverse().map(row => {
    if (fs.existsSync(row.dir)) {
      const s = fs.statSync(row.dir);
      if (s.dev === row.dev && s.ino === row.ino) fs.rmSync(row.dir, {recursive: true, force: true});
    }
    return {...row, existsAfter: fs.existsSync(row.dir)};
  });
  const remaining = records().filter(r => r.pid && alive(r));
  const cleanup = settled && remaining.length === 0 && directories.every(r => !r.existsAfter);
  const report = {...result, timedOut, cleanup, processes, remaining, directories};
  fs.writeFileSync(journal + '.cleanup.json', JSON.stringify(report, null, 2) + '\n');
  console.error(`SUPERVISOR timeout=${timedOut} cleanup=${cleanup} owned=${processes.length}`);
  return {...report, status: !timedOut && cleanup && result.exit === 0 ? 0 : 1};
}
module.exports = {supervise};
if (require.main === module) {
  const [journal, deadline, program, ...args] = process.argv.slice(2);
  supervise({journal, stopAt: Number(deadline), program, args}).then(r => { process.exitCode = r.status; }).catch(e => { console.error(e); process.exitCode = 1; });
}
