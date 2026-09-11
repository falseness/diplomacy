const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const tf = require('@tensorflow/tfjs-node');
const runner = require('../cloud-train-runner');
const { ReusableBaselineEvaluator } = require('../reusable-baseline-evaluation');
const { snapshotModel, snapshotHash } = require('../baseline-evaluation-process');
const root = path.resolve(process.argv[2]);
const frozen = require(path.join(root, 'frozen/ai/cloud-train-runner'));
const checkpoint = path.resolve('artifacts/TASK-106/iteration-11/screen-current-w1/final/task106-screen');
const baseline = '/mnt/storage/diplomacy/task111-combat-training-20260612131303/final/task111-combat-training';
async function main() {
  const models = await Promise.all([0,1].map(() => tf.loadLayersModel(`file://${checkpoint}/model.json`)));
  const optimizers = models.map(() => tf.train.adam(0.000001));
  models.forEach((model,i) => model.compile({optimizer:optimizers[i],loss:{combat_policy:'categoricalCrossentropy',combat_value:'meanSquaredError'},lossWeights:{combat_policy:.25,combat_value:1}}));
  const report = { boundaries: [] };
  const pool = new ReusableBaselineEvaluator();
  let priorHash = snapshotHash(await snapshotModel(models[0]));
  try {
    for (let b = 0; b < 2; b++) {
      const batch = runner.makeBatch(87087, b + 1);
      const fits = [];
      try {
        for (const model of models) fits.push(await model.fit([batch.board,batch.global],
          {combat_policy:batch.policy,combat_value:batch.labels}, {epochs:1,batchSize:16,shuffle:false,verbose:0}));
      } finally { tf.dispose([batch.board,batch.global,batch.policy,batch.labels]); }
      assert.deepEqual(fits[0].history, fits[1].history);
      const hashes = await Promise.all(models.map(async m => snapshotHash(await snapshotModel(m))));
      assert.equal(hashes[0],hashes[1]); assert.notEqual(hashes[0],priorHash); priorHash=hashes[0];
      const options = {curriculumGateGames:2,curriculumBaselineAiModelPath:baseline,curriculumSimpleWinrateThreshold:.8,curriculumBaselineWinrateThreshold:.8};
      const state = {seed:[87087,87089][b],completedGames:1,runId:'task106-integration',curriculum:runner.initialCurriculumState()};
      const serial = await frozen.evaluateCurriculumBaselineAiWinrate(options,state,models[0]);
      const pooled = await runner.evaluateCurriculumBaselineAiWinrate({...options,baselineEvaluationPool:pool},state,models[1]);
      assert.deepEqual(pooled,serial);
      const gates = [serial,pooled].map(result => runner.curriculumGateDecision(state,{status:'plateau'},
        {evaluated:true,value:1,games:2},{attempted:true,improved:false},options,result));
      assert.deepEqual(gates[0],gates[1]);
      const states = gates.map(gate => {const s=JSON.parse(JSON.stringify(state));runner.updateCurriculumState(s,gate);return s;});
      assert.deepEqual(states[0],states[1]);
      report.boundaries.push({boundary:b+1,hash:hashes[0],fitHistory:fits[0].history,serial,pooled,gate:gates[0],state:states[0]});
      fs.writeFileSync(path.join(root,'integration.json'),JSON.stringify(report,null,2));
      console.log(`TRAINING INTEGRATION: PASS boundary=${b+1} equalFitHistory equalWeights freshHash=${hashes[0]} exactEvaluation exactCurriculum`);
    }
  } finally {
    report.shutdown = await pool.close();
    models.forEach(m=>m.dispose());optimizers.forEach(o=>o.dispose());
    report.finalTensors=tf.memory().numTensors;
    fs.writeFileSync(path.join(root,'integration.json'),JSON.stringify(report,null,2));
  }
  assert.equal(report.finalTensors,0);
  console.log('INTEGRATION CLEANUP: PASS tensors=0; children exited');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
