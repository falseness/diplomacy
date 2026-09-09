// Diagnose candidate ranking on archived development data without fitting or gameplay.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const tf = require('@tensorflow/tfjs-node');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function ranking(labels, predictions) {
  assert.equal(labels.length, predictions.length);
  assert(labels.length > 0 && labels.every(Number.isFinite) && predictions.every(Number.isFinite));
  const best = Math.max(...labels);
  const chosen = predictions.indexOf(Math.max(...predictions));
  let ordered = 0, reversed = 0, tied = 0;
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      if (Math.abs(labels[i] - labels[j]) <= 1e-6) continue;
      const direction = (labels[i] - labels[j]) * (predictions[i] - predictions[j]);
      if (direction > 0) ordered++;
      else if (direction < 0) reversed++;
      else tied++;
    }
  }
  return { candidates: labels.length, chosen, regret: best - labels[chosen],
    optimal: best - labels[chosen] <= 1e-6, ordered, reversed, tied };
}

async function main() {
  const source = path.resolve(process.argv[2]);
  const output = path.resolve(process.argv[3]);
  fs.mkdirSync(output); // Never overwrite previous evidence.
  const write = (name, data) => fs.writeFileSync(path.join(output, name), JSON.stringify(data, null, 2) + '\n');
  assert(ranking([0, 1], [0, 1]).optimal);
  assert.equal(ranking([0, 1], [1, 0]).regret, 1);
  assert.equal(ranking([0, 1], [0, 0]).tied, 1);
  assert(ranking([1, 1], [0, 1]).optimal);
  console.log('RANKING_CONTROLS: PASS ordered, reversed, constant, teacher ties');
  const plan = JSON.parse(fs.readFileSync(path.join(source, 'plan.json')));
  const freeze = JSON.parse(fs.readFileSync(path.join(source, 'checkpoint-freeze.json')));
  const provenance = { source, plan, hashes: {}, purpose: 'archived validation ranking; no fit, checkpoint selection or acceptance claim' };
  for (const arm of plan.controls) {
    for (const [name, expected] of Object.entries(freeze[arm])) {
      const file = path.join(source, arm, name);
      assert.equal(hash(file), expected);
      provenance.hashes[file] = expected;
    }
  }
  const batches = plan.validationSeeds.map(seed => {
    const file = path.join(source, `validation-${seed}.json`);
    provenance.hashes[file] = hash(file);
    const batch = JSON.parse(fs.readFileSync(file));
    assert.equal(batch.map.seed, seed);
    assert.equal(batch.appliedActions.length, batch.labels.length);
    return batch;
  });
  write('provenance.json', provenance);
  console.log('CHECKPOINT_FREEZE: PASS all three archived arms match');
  const results = [];
  for (const arm of plan.controls) {
    const model = await tf.loadLayersModel('file://' + path.join(source, arm, 'model.json'));
    const decisions = [];
    let squaredError = 0, count = 0;
    for (const batch of batches) {
      const predictions = tf.tidy(() => Array.from(model.predict([
        tf.tensor4d(batch.boards.flat(3), [batch.labels.length, ...plan.shape]),
        tf.tensor2d(batch.globals, [batch.labels.length, 1])
      ]).dataSync()));
      const groups = new Map();
      batch.appliedActions.forEach((action, index) => {
        const key = `${action.playerIndex}:${action.turn}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(index);
        squaredError += (predictions[index] - batch.labels[index]) ** 2;
        count++;
      });
      for (const [key, indices] of groups) {
        const labels = indices.map(i => batch.labels[i]);
        const scores = indices.map(i => predictions[i]);
        const stats = ranking(labels, scores);
        decisions.push({ seed: batch.map.seed, key, ...stats,
          selectedAction: batch.appliedActions[indices[stats.chosen]],
          teacherActions: indices.filter(i => Math.max(...labels) - batch.labels[i] <= 1e-6)
            .map(i => batch.appliedActions[i]), labels, predictions: scores });
      }
    }
    model.dispose();
    const summary = { arm, examples: count, decisions: decisions.length,
      optimal: decisions.filter(d => d.optimal).length,
      meanRegret: decisions.reduce((sum, d) => sum + d.regret, 0) / decisions.length,
      mse: squaredError / count,
      ordered: decisions.reduce((sum, d) => sum + d.ordered, 0),
      reversed: decisions.reduce((sum, d) => sum + d.reversed, 0),
      tied: decisions.reduce((sum, d) => sum + d.tied, 0) };
    write(`${arm}.json`, { summary, decisions });
    results.push(summary);
    console.log('RANKING_RESULT: ' + JSON.stringify(summary));
  }
  write('result.json', results);
  console.log('RANKING_COMPLETE: diagnostic only; teacher agreement is not a win gate');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
