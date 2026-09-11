const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { launch } = require('../baseline-evaluation-process');
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task106-evaluation-'));
  const snapshot = { modelTopology: {}, weightSpecs: [], weightData: Buffer.alloc(0) };
  const job = { game: 1, snapshot };
  const cases = [
    ['missing', "process.once('message', () => process.disconnect());", /missing\/duplicate/],
    ['duplicate', "process.once('message', () => { process.send({}); process.send({}, () => process.disconnect()); });", /missing\/duplicate/],
    ['crash', "process.once('message', () => process.exit(7));", /evaluation child exit/],
    ['wrong-game', "process.once('message', () => process.send({game:2}, () => process.disconnect()));", /wrong evaluation game/],
    ['stale-model', "process.once('message', () => process.send({game:1,hash:'stale'}, () => process.disconnect()));", /stale evaluation model/]
  ];
  try {
    for (const [name, source, expected] of cases) {
      const file = path.join(dir, name + '.cjs'); fs.writeFileSync(file, source);
      await assert.rejects(launch(job, file), expected);
      console.log(`LIFECYCLE REJECTION: PASS ${name}; child exited before rejection`);
    }
    await assert.rejects(launch({ ...job, options: {}, state: {} }), /evaluation child exit/);
    console.log('REAL CHILD LOAD FAILURE: PASS invalid model rejected; child exited');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
