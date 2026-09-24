'use strict';
// Loaded only in supervised test children. Record ownership before returning a
// process or temporary directory to the caller, including detached descendants.
const fs = require('node:fs');
const cp = require('node:child_process');
const journal = process.env.TASK245_OWNERSHIP;
const startOf = pid => fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').at(-1).split(' ')[19];
const record = row => fs.appendFileSync(journal, JSON.stringify(row) + '\n');
if (journal) {
  record({pid: process.pid, start: startOf(process.pid)});
  const spawn = cp.spawn;
  cp.spawn = function (...args) {
    const child = spawn.apply(this, args);
    if (child.pid) {
      try { record({pid: child.pid, start: startOf(child.pid)}); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    return child;
  };
  const recordDir = dir => {
    const stat = fs.statSync(dir); record({dir, dev: stat.dev, ino: stat.ino}); return dir;
  };
  const asyncMkdtemp = fs.promises.mkdtemp.bind(fs.promises);
  fs.promises.mkdtemp = async (...args) => recordDir(await asyncMkdtemp(...args));
  const callbackMkdtemp = fs.mkdtemp;
  fs.mkdtemp = function (...args) {
    const callback = args.pop();
    return callbackMkdtemp.call(this, ...args, (error, dir) => {
      if (!error) recordDir(dir);
      callback(error, dir);
    });
  };
  const mkdtemp = fs.mkdtempSync;
  fs.mkdtempSync = function (...args) {
    const dir = mkdtemp.apply(this, args), stat = fs.statSync(dir);
    record({dir, dev: stat.dev, ino: stat.ino});
    return dir;
  };
}
