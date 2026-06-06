const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs-node');

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = { resume: false, evaluateLatest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--resume') {
      options.resume = true;
      continue;
    }
    if (arg === '--evaluate-latest') {
      options.evaluateLatest = true;
      continue;
    }
    if (!arg.startsWith('--') || i + 1 >= argv.length) {
      fail(`invalid runner argument: ${arg}`);
    }
    options[arg.slice(2)] = argv[i + 1];
    i += 1;
  }
  for (const key of [
    'storage-dir',
    'run-id',
    'games',
    'epochs',
    'seed',
    'max-games-this-run',
    'checkpoint-interval',
    'checkpoint-retain'
  ]) {
    if (options[key] === undefined) {
      fail(`missing runner argument --${key}`);
    }
  }
  options.games = Number(options.games);
  options.epochs = Number(options.epochs);
  options.seed = Number(options.seed);
  options.maxGamesThisRun = Number(options['max-games-this-run']);
  options.checkpointInterval = Number(options['checkpoint-interval']);
  options.checkpointRetain = Number(options['checkpoint-retain']);
  options.storageDir = path.resolve(options['storage-dir']);
  options.runId = options['run-id'];
  return options;
}

function writeJson(filePath, value) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporaryPath, filePath);
}

function appendJsonLine(filePath, value) {
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`);
}

function createRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function createModel() {
  const boardInput = tf.input({ shape: [3, 3, 21], name: 'board' });
  const globalInput = tf.input({ shape: [1], name: 'global_variables' });
  const flattened = tf.layers.flatten().apply(boardInput);
  const merged = tf.layers.concatenate().apply([flattened, globalInput]);
  const hidden = tf.layers.dense({ units: 16, activation: 'relu' }).apply(merged);
  const output = tf.layers.dense({ units: 1, activation: 'tanh', name: 'value_output' }).apply(hidden);
  return tf.model({ inputs: [boardInput, globalInput], outputs: output });
}

function compileModel(model) {
  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'meanSquaredError',
    metrics: ['accuracy']
  });
}

function makeBatch(seed, game) {
  const random = createRandom(seed + game * 1009);
  const boardValues = [];
  const globalValues = [];
  const labels = [];
  for (let sample = 0; sample < 4; sample += 1) {
    for (let value = 0; value < 3 * 3 * 21; value += 1) {
      boardValues.push(random());
    }
    const globalValue = random();
    globalValues.push(globalValue);
    labels.push(globalValue >= 0.5 ? 1 : -1);
  }
  return {
    board: tf.tensor4d(boardValues, [4, 3, 3, 21]),
    global: tf.tensor2d(globalValues, [4, 1]),
    labels: tf.tensor2d(labels, [4, 1])
  };
}

function replaceDirectory(source, destination) {
  const backup = `${destination}.previous`;
  if (fs.existsSync(backup)) {
    fs.rmSync(backup, { recursive: true, force: true });
  }
  if (fs.existsSync(destination)) {
    fs.renameSync(destination, backup);
  }
  fs.renameSync(source, destination);
  if (fs.existsSync(backup)) {
    fs.rmSync(backup, { recursive: true, force: true });
  }
}

async function saveModelAtomically(model, destination) {
  const temporary = `${destination}.tmp-${process.pid}`;
  if (fs.existsSync(temporary)) {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  await model.save(`file://${temporary}`);
  replaceDirectory(temporary, destination);
}

function checkpointName(step) {
  return `step-${String(step).padStart(8, '0')}`;
}

function latestCheckpointPath(storageDir, runId) {
  return path.join(storageDir, 'checkpoints', runId, 'latest.json');
}

function readLatestCheckpoint(storageDir, runId) {
  const pointerPath = latestCheckpointPath(storageDir, runId);
  if (!fs.existsSync(pointerPath)) {
    fail(`no complete checkpoint found for run ${runId}`);
  }
  const pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
  const checkpointPath = path.join(storageDir, pointer.path);
  if (!fs.existsSync(path.join(checkpointPath, 'model.json')) ||
      !fs.existsSync(path.join(checkpointPath, 'metadata.json'))) {
    fail(`latest checkpoint is incomplete for run ${runId}`);
  }
  return {
    path: checkpointPath,
    metadata: JSON.parse(fs.readFileSync(path.join(checkpointPath, 'metadata.json'), 'utf8'))
  };
}

function pruneCheckpoints(checkpointDir, retain) {
  if (retain === 0) {
    return;
  }
  const checkpoints = fs.readdirSync(checkpointDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^step-\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const checkpoint of checkpoints.slice(0, Math.max(0, checkpoints.length - retain))) {
    fs.rmSync(path.join(checkpointDir, checkpoint), { recursive: true, force: true });
  }
}

async function saveCheckpoint(model, options, state, checkpointDir, reason) {
  const name = checkpointName(state.completedGames);
  const destination = path.join(checkpointDir, name);
  const temporary = `${destination}.tmp-${process.pid}`;
  fs.rmSync(temporary, { recursive: true, force: true });
  await model.save(`file://${temporary}`);
  const timestamp = new Date().toISOString();
  writeJson(path.join(temporary, 'metadata.json'), {
    modelVersion: 1,
    runId: state.runId,
    trainingStep: state.completedGames,
    seed: state.seed,
    epochs: state.epochs,
    totalGames: state.totalGames,
    timestamp,
    codeRevision: gitRevision(),
    reason,
    state: {
      completedGames: state.completedGames,
      status: state.status,
      updatedAt: state.updatedAt
    }
  });
  replaceDirectory(temporary, destination);
  writeJson(latestCheckpointPath(options.storageDir, options.runId), {
    runId: options.runId,
    trainingStep: state.completedGames,
    timestamp,
    path: path.relative(options.storageDir, destination)
  });
  fs.writeFileSync(path.join(options.storageDir, 'checkpoints', 'latest-run'), `${options.runId}\n`);
  pruneCheckpoints(checkpointDir, options.checkpointRetain);
  return destination;
}

function gitRevision() {
  try {
    return require('child_process')
      .execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' })
      .trim();
  } catch (error) {
    return 'unknown';
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runDir = path.join(options.storageDir, 'runs', options.runId);
  const checkpointDir = path.join(options.storageDir, 'checkpoints', options.runId);
  const statePath = path.join(runDir, 'state.json');
  const manifestPath = path.join(runDir, 'manifest.json');
  const metricsPath = path.join(options.storageDir, 'metrics', `${options.runId}.jsonl`);
  const finalDir = path.join(options.storageDir, 'final', options.runId);

  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(checkpointDir, { recursive: true });

  if (options.evaluateLatest) {
    const checkpoint = readLatestCheckpoint(options.storageDir, options.runId);
    const evaluationModel = await tf.loadLayersModel(
      `file://${path.join(checkpoint.path, 'model.json')}`
    );
    const batch = makeBatch(checkpoint.metadata.seed, checkpoint.metadata.trainingStep + 1);
    const prediction = evaluationModel.predict([batch.board, batch.global]);
    const values = await prediction.data();
    console.log(JSON.stringify({
      runId: options.runId,
      checkpoint: path.relative(options.storageDir, checkpoint.path),
      trainingStep: checkpoint.metadata.trainingStep,
      modelVersion: checkpoint.metadata.modelVersion,
      predictionCount: values.length
    }));
    prediction.dispose();
    batch.board.dispose();
    batch.global.dispose();
    batch.labels.dispose();
    evaluationModel.dispose();
    return;
  }

  let state;
  let model;
  if (options.resume) {
    const checkpoint = readLatestCheckpoint(options.storageDir, options.runId);
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state.completedGames = checkpoint.metadata.state.completedGames;
    state.status = checkpoint.metadata.state.status;
    state.updatedAt = checkpoint.metadata.state.updatedAt;
    if (state.status === 'complete') {
      fail(`run ${options.runId} is already complete`);
    }
    model = await tf.loadLayersModel(`file://${path.join(checkpoint.path, 'model.json')}`);
    console.log(`Resuming ${options.runId} after game ${state.completedGames}`);
  } else {
    if (fs.existsSync(statePath)) {
      fail(`run already exists: ${options.runId}`);
    }
    state = {
      runId: options.runId,
      status: 'running',
      seed: options.seed,
      epochs: options.epochs,
      totalGames: options.games,
      completedGames: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    model = createModel();
    writeJson(manifestPath, {
      runId: options.runId,
      codeRevision: gitRevision(),
      configuration: {
        games: options.games,
        epochs: options.epochs,
        seed: options.seed
      },
      artifacts: {
        checkpoints: path.relative(options.storageDir, checkpointDir),
        metrics: path.relative(options.storageDir, metricsPath),
        finalModel: path.relative(options.storageDir, finalDir)
      },
      checkpointPolicy: {
        interval: options.checkpointInterval,
        retain: options.checkpointRetain === 0 ? 'all' : options.checkpointRetain
      }
    });
  }

  compileModel(model);
  const invocationStart = state.completedGames;
  while (state.completedGames < state.totalGames) {
    if (options.maxGamesThisRun > 0 &&
        state.completedGames - invocationStart >= options.maxGamesThisRun) {
      break;
    }
    const game = state.completedGames + 1;
    const batch = makeBatch(state.seed, game);
    const started = Date.now();
    let history;
    try {
      history = await model.fit(
        [batch.board, batch.global],
        batch.labels,
        { epochs: state.epochs, batchSize: 4, shuffle: false, verbose: 0 }
      );
    } finally {
      batch.board.dispose();
      batch.global.dispose();
      batch.labels.dispose();
    }
    state.completedGames = game;
    state.updatedAt = new Date().toISOString();
    state.status = state.completedGames === state.totalGames ? 'complete' : 'paused';
    if (game % options.checkpointInterval === 0 || game === state.totalGames) {
      await saveCheckpoint(model, options, state, checkpointDir, 'interval');
    }
    writeJson(statePath, state);
    appendJsonLine(metricsPath, {
      runId: options.runId,
      game,
      epochs: state.epochs,
      loss: history.history.loss[history.history.loss.length - 1],
      durationMs: Date.now() - started,
      timestamp: state.updatedAt
    });
    console.log(`Completed game ${game}/${state.totalGames}`);
  }

  if (state.completedGames === state.totalGames) {
    state.status = 'complete';
    state.completedAt = new Date().toISOString();
    state.updatedAt = state.completedAt;
    await saveModelAtomically(model, finalDir);
    writeJson(statePath, state);
    console.log(`Training complete. Final model: ${finalDir}`);
  } else {
    state.status = 'paused';
    state.updatedAt = new Date().toISOString();
    const pointerPath = latestCheckpointPath(options.storageDir, options.runId);
    const latest = fs.existsSync(pointerPath)
      ? readLatestCheckpoint(options.storageDir, options.runId)
      : null;
    if (!latest || latest.metadata.trainingStep !== state.completedGames) {
      await saveCheckpoint(model, options, state, checkpointDir, 'pause');
    }
    writeJson(statePath, state);
    console.log(`Training paused at ${state.completedGames}/${state.totalGames}; resume with ./train.sh --resume`);
  }
  model.dispose();
}

main().catch((error) => {
  console.error(`cloud training error: ${error.message}`);
  process.exitCode = 1;
});
