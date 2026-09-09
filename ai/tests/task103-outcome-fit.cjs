// One predeclared outcome-supervision pilot. No acceptance binding or policy edit.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const tf = require('@tensorflow/tfjs-node');
const { collectOutcomeTrajectory, outcomeLayoutHash, assertDisjointOutcomeLayouts } = require('../economy-outcome-data');
const { parseArgs, runRuntimeScenario } = require('../benchmark-gamestart-all-slots');
const { saveCheckpoint } = require('../economy-training');
const { createRuntimeContext, loadBrowserScripts } = require('../gamestart-simple-economy-completion');

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function main() {
  const output = path.resolve(process.argv[2]);
  fs.mkdirSync(output);
  const write = (name, data) => fs.writeFileSync(path.join(output, name), JSON.stringify(data) + '\n');
  const initialPath = path.resolve('artifacts/TASK-103/economy-development/experiment/trained');
  const plan = {
    trainingSeeds: Array.from({length:8}, (_, i) => 10311000 + i),
    validationSeeds: [10312000, 10312001], developmentSeeds: [10313000, 10313001],
    sides: [1, 2], epochs: 12, batchSize: 32, shuffle: false,
    arms: ['initial', 'outcome', 'zero'], initialPath,
    options: {roundLimit:1200, suddenDeathRound:500, actionLimit:30, commandLimit:60},
    labels: 'undiscounted terminal returns on actually visited candidate end-of-turn states; losses0/wins1; exclude nonterminal/crash but retain all attempts',
    hypothesis: 'full-game outcome supervision improves development wins over the same initial weights trained on immediate teacher labels',
    decision: 'one fixed fit, no seed/epoch/checkpoint search; without more development wins than initial and zero, do not promote or repeat this fit; MSE is not strength',
    claim: 'small development pilot, not independent final holdout or acceptance'
  };
  write('plan.json', plan);
  console.log('OUTCOME_FIT_PLAN: ' + JSON.stringify(plan));
  const seeds = [...plan.trainingSeeds, ...plan.validationSeeds, ...plan.developmentSeeds];
  assert.equal(new Set(seeds).size, seeds.length);
  const layouts = {};
  const physicalLayouts = [];
  for (const seed of seeds) {
    const context = createRuntimeContext(seed);
    loadBrowserScripts(context);
    context.__seed = seed;
    const layout = JSON.parse(new vm.Script(
      'JSON.stringify(generateEconomyStage2TrainingMap({seed:__seed}))').runInContext(context));
    write(`layout-${seed}.json`, layout);
    layouts[seed] = outcomeLayoutHash(layout);
    const split = ['training','validation','development'].find(name=>plan[name+'Seeds'].includes(seed));
    physicalLayouts.push({seed,split,map:layout});
  }
  write('layout-hashes.json', layouts);
  assertDisjointOutcomeLayouts(physicalLayouts);
  const frozen = JSON.parse(fs.readFileSync(path.join(initialPath, '../checkpoint-freeze.json'))).trained;
  for (const [file, expected] of Object.entries(frozen)) {
    assert.equal(hash(fs.readFileSync(path.join(initialPath, file))), expected);
  }
  write('initial-hashes.json', frozen);
  const model = await tf.loadLayersModel('file://' + path.join(initialPath, 'model.json'));
  const options = {...parseArgs([]), ...plan.options};
  const entry = seed => ({name:`outcome-stage2-${seed}`, sourceType:'standalone-factory',
    sourceName:'generateEconomyStage2TrainingMap', factoryOptions:{seed}, nonNeutralPlayerCount:2});
  const checkpoint = () => ({model, inference:{calls:0, positions:0}});
  const tensors = [];
  try {
    const data = {};
    for (const split of ['training', 'validation']) {
      const examples = [], labels = [], games = [];
      for (const seed of plan[split+'Seeds']) for (const side of plan.sides) {
        const trajectory = collectOutcomeTrajectory(entry(seed), side, seed, options, checkpoint());
        const file = `${split}-${seed}-${side}.json`;
        write(file, trajectory);
        examples.push(...trajectory.examples); labels.push(...trajectory.labels);
        const row = {split, seed, side, file, sha256:hash(fs.readFileSync(path.join(output,file))),
          disposition:trajectory.disposition, winner:trajectory.game && trajectory.game.winner,
          won:!!(trajectory.game && trajectory.game.candidateWon), examples:trajectory.labels.length,
          error:trajectory.error || null};
        games.push(row);
        console.log('OUTCOME_COLLECTION: ' + JSON.stringify(row));
      }
      write(`${split}-games.json`, games);
      assert(labels.includes(0) && labels.includes(1), 'pilot needs both outcome classes; stop instead of selecting replacement games');
      const x = [tf.tensor4d(examples.flatMap(e=>e.board.flat(2)), [examples.length,...model.inputs[0].shape.slice(1)]),
        tf.tensor2d(examples.map(e=>e.global), [examples.length,1])];
      const y = tf.tensor2d(labels,[labels.length,1]);
      tensors.push(...x,y);
      data[split] = {x,y,count:labels.length, wins:labels.filter(v=>v===1).length};
    }
    const metadata = {...plan, featureFusionWeight:0, labelScale:1,
      supervision:'terminal-outcome', behaviorCheckpointHashes:frozen};
    await saveCheckpoint(model,path.join(output,'initial'),metadata);
    model.compile({optimizer:tf.train.adam(0.001),loss:'meanSquaredError'});
    const loss = () => tf.tidy(()=>Number(model.evaluate(data.validation.x,data.validation.y).dataSync()[0]));
    const before = loss();
    const history = await model.fit(data.training.x,data.training.y,{
      epochs:plan.epochs,batchSize:plan.batchSize,shuffle:plan.shuffle,verbose:0,
      validationData:[data.validation.x,data.validation.y],
      callbacks:{onEpochEnd:(epoch,logs)=>console.log('OUTCOME_EPOCH: '+JSON.stringify({epoch:epoch+1,...logs}))}
    });
    const after = loss();
    await saveCheckpoint(model,path.join(output,'outcome'),{...metadata,before,after,history:history.history});
    const zero = model.getWeights().map(weight=>tf.zerosLike(weight));
    model.setWeights(zero); zero.forEach(weight=>weight.dispose());
    await saveCheckpoint(model,path.join(output,'zero'),metadata);
    const checkpoints = {};
    for (const arm of plan.arms) {
      checkpoints[arm] = Object.fromEntries(fs.readdirSync(path.join(output,arm)).map(file=>
        [file,hash(fs.readFileSync(path.join(output,arm,file)))]));
    }
    write('checkpoint-freeze.json',checkpoints);
    write('fit.json',{before,after,history:history.history,
      training:{count:data.training.count,wins:data.training.wins},
      validation:{count:data.validation.count,wins:data.validation.wins}});
    console.log('OUTCOME_VALIDATION: '+JSON.stringify({before,after}));
    const results = [];
    for (const arm of plan.arms) {
      const candidate = await tf.loadLayersModel('file://'+path.join(output,arm,'model.json'));
      try {
        for (const seed of plan.developmentSeeds) for (const side of plan.sides) {
          let game = null, error = null;
          try { game = runRuntimeScenario(entry(seed),side,seed,options,
            {model:candidate,inference:{calls:0,positions:0}}); }
          catch (caught) { error = {message:caught.message,stack:caught.stack}; }
          const result = {arm,seed,side,game,error,
            won:!!(game && game.candidateWon && !game.timeout && !game.suddenDeath && game.exactClassAssignment)};
          results.push(result);write('results.json',results);
          console.log('OUTCOME_DEVELOPMENT: '+JSON.stringify(result));
        }
      } finally {candidate.dispose();}
    }
    for (const arm of plan.arms) for (const [file,expected] of Object.entries(checkpoints[arm])) {
      assert.equal(hash(fs.readFileSync(path.join(output,arm,file))),expected);
    }
    const wins = Object.fromEntries(plan.arms.map(arm=>[arm,results.filter(r=>r.arm===arm && r.won).length]));
    const supported = wins.outcome > wins.initial && wins.outcome > wins.zero;
    write('conclusion.json',{wins,supported,claim:plan.claim,
      decision:supported?'bounded support only; independent training/holdout work required':'no improvement; do not promote or repeat this fit'});
    console.log('OUTCOME_PILOT_COMPLETE: '+JSON.stringify({wins,supported,claim:plan.claim}));
  } finally {tensors.forEach(tensor=>tensor.dispose());model.dispose();}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
