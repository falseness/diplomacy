const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs-node');

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = { resume: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--resume') {
      options.resume = true;
      continue;
    }
    if (!arg.startsWith('--') || i + 1 >= argv.length) {
      fail(`invalid runner argument: ${arg}`);
    }
    options[arg.slice(2)] = argv[i + 1];
    i += 1;
  }
  for (const key of ['storage-dir', 'run-id', 'games', 'epochs', 'seed', 'max-games-this-run']) {
    if (options[key] === undefined) {
      fail(`missing runner argument --${key}`);
    }
  }
  options.games = Number(options.games);
  options.epochs = Number(options.epochs);
  options.seed = Number(options.seed);
  options.maxGamesThisRun = Number(options['max-games-this-run']);
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
  const latestModelDir = path.join(checkpointDir, 'latest');
  const statePath = path.join(runDir, 'state.json');
  const manifestPath = path.join(runDir, 'manifest.json');
  const metricsPath = path.join(options.storageDir, 'metrics', `${options.runId}.jsonl`);
  const finalDir = path.join(options.storageDir, 'final', options.runId);

  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(checkpointDir, { recursive: true });

  let state;
  let model;
  if (options.resume) {
    if (!fs.existsSync(statePath) || !fs.existsSync(path.join(latestModelDir, 'model.json'))) {
      fail(`checkpoint is incomplete for run ${options.runId}`);
    }
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (state.status === 'complete') {
      fail(`run ${options.runId} is already complete`);
    }
    model = await tf.loadLayersModel(`file://${path.join(latestModelDir, 'model.json')}`);
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
        checkpoint: path.relative(options.storageDir, latestModelDir),
        metrics: path.relative(options.storageDir, metricsPath),
        finalModel: path.relative(options.storageDir, finalDir)
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
    await saveModelAtomically(model, latestModelDir);
    writeJson(statePath, state);
    fs.writeFileSync(path.join(options.storageDir, 'checkpoints', 'latest-run'), `${options.runId}\n`);
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
    const latestRunPath = path.join(options.storageDir, 'checkpoints', 'latest-run');
    if (fs.existsSync(latestRunPath) &&
        fs.readFileSync(latestRunPath, 'utf8').trim() === options.runId) {
      fs.unlinkSync(latestRunPath);
    }
    console.log(`Training complete. Final model: ${finalDir}`);
  } else {
    state.status = 'paused';
    state.updatedAt = new Date().toISOString();
    writeJson(statePath, state);
    console.log(`Training paused at ${state.completedGames}/${state.totalGames}; resume with ./train.sh --resume`);
  }
  model.dispose();
}

main().catch((error) => {
  console.error(`cloud training error: ${error.message}`);
  process.exitCode = 1;
});
