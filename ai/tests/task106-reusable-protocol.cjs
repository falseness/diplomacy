const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EvaluatorProcess } = require('../reusable-baseline-evaluation');
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task106-reuse-'));
  const cases = [
    ['missing', "process.on('message', () => {});", /timeout/],
    ['stale', "process.on('message', m => process.send({id:m.id-1}));", /stale/],
    ['duplicate', "process.on('message', m => {process.send({id:m.id});process.send({id:m.id});});", /duplicate|stale/],
    ['error', "process.on('message', m => process.send({id:m.id,error:'injected failure'}));", /injected failure/],
    ['crash', "process.on('message', () => process.exit(7));", /unexpected evaluator exit/]
  ];
  try {
    for (const [name, source, expected] of cases) {
      const file = path.join(dir, name + '.cjs'); fs.writeFileSync(file, source);
      const worker = new EvaluatorProcess(file, 2000);
      try { await worker.request('refresh'); } catch (error) { assert.match(error.message, expected); }
      await assert.rejects(worker.close(), expected);
      assert(worker.exit, 'failed child not reaped');
      console.log(`PROTOCOL REJECTION: PASS ${name}; process reaped`);
    }
    for (const [name, job, expected] of [
      ['game-before-refresh', {type:'game', boundary:1, hash:'missing', game:1}, /missing refresh/],
      ['stale-refresh', {type:'refresh', boundary:0}, /stale boundary/],
      ['invalid-model', {type:'refresh', boundary:1, baselinePath:dir}, /model\.json does not exist: loading failed/]
    ]) {
      const worker = new EvaluatorProcess();
      await assert.rejects(worker.request(job.type, job), expected);
      await assert.rejects(worker.close(), expected);
      assert(worker.exit);
      console.log(`REAL PROCESS REJECTION: PASS ${name}; process reaped`);
    }
  } finally { fs.rmSync(dir, { recursive:true, force:true }); }
}
main().catch(error => {console.error(error);process.exitCode=1;});
