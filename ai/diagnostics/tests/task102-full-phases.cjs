// Real teacher/ranking integration control for the diagnostic preload.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const {spawnSync} = require('child_process');
const ROOT = path.resolve(__dirname, '../../..');
const TEACHER_SEED = 137087;
const EPOCHS = 1;
const MODES = ['plain', 'off', 'on'];

async function child(mode, output, checkpoint) {
  process.argv[1] = path.join(ROOT, 'ai/cloud-train-runner.js');
  process.env.TASK102_PHASE_OUTPUT = output;
  process.env.TASK102_PHASE_MODE = mode;
  if (mode !== 'plain') require('../task102-full-phases.cjs');
  const trainer = require('../../cloud-train-runner');
  const tf = require('@tensorflow/tfjs-node');
  const teacher = trainer.collectRuntimeCombatTeacherGame(TEACHER_SEED, 0, 1);
  const model = await tf.loadLayersModel('file://' + path.join(checkpoint, 'model.json'));
  const history = await trainer.trainRuntimeCombatBatch(model, {gameResults: [teacher]}, EPOCHS);
  const weights = Buffer.concat(model.getWeights().map(tensor => {
    const data = tensor.dataSync();
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }));
  fs.writeFileSync(path.join(output, 'control.json'), JSON.stringify({teacher, history: history.history,
    weightHash: crypto.createHash('sha256').update(weights).digest('hex')}));
  model.dispose();
}

async function main() {
  if (process.argv[2] === '--child') return child(...process.argv.slice(3));
  const output = path.resolve(process.argv[2]);
  const checkpoint = path.resolve(process.argv[3]);
  fs.mkdirSync(output); // Keep earlier failures; do not overwrite runs.
  let reference;
  for (const mode of MODES) {
    const dir = path.join(output, mode);
    fs.mkdirSync(dir);
    const args = [__filename, '--child', mode, dir, checkpoint];
    const result = spawnSync(process.execPath, args, {cwd: ROOT, encoding: 'utf8',
      env: {...process.env, NODE_OPTIONS: '--max-old-space-size=6144'}});
    fs.writeFileSync(path.join(dir, 'command.log'), JSON.stringify([process.execPath, ...args]) + '\n' +
      result.stdout + result.stderr + `\nEXIT_CODE: ${result.status}\n`);
    assert.strictEqual(result.status, 0, result.stderr);
    const actual = fs.readFileSync(path.join(dir, 'control.json'), 'utf8');
    if (reference === undefined) reference = actual;
    assert.strictEqual(actual, reference, `${mode} changed teacher labels, loss or weights`);
  }
  const phases = JSON.parse(fs.readFileSync(path.join(output, 'on/phases.json')));
  assert.deepStrictEqual(phases.unfinished, []);
  assert.strictEqual(phases.counts.teacherGames, 1);
  const ranking = phases.events.find(event => event.name === 'ranking-preparation-cleanup');
  const fit = phases.events.find(event => event.name === 'ranking-fit');
  assert(ranking && fit && ranking.exclusiveMs > 0 && fit.exclusiveMs > 0);
  assert(ranking.start <= fit.start && ranking.end >= fit.end);
  assert(Math.abs(ranking.childrenMs - fit.exclusiveMs) < 1e-6);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(output, 'off/phases.json'))).events.length, 0);
  console.log('REAL_PHASE_CONTROL: PASS plain/off/on identical teacher examples, loss and trained weights');
  console.log('NESTED_PHASE_CONTROL: PASS positive exclusive preparation/fit and empty off events');
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
