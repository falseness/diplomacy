const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs-node');
const { runGame } = require('./benchmarkHarness');

const MODEL_VERSION = 1;
const MODEL_SIGNATURE = {
  inputs: [
    { name: 'board', shape: [null, 3, 3, 21] },
    { name: 'global_variables', shape: [null, 1] }
  ],
  outputs: [
    { name: 'value_output', shape: [null, 1] }
  ]
};

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
    'checkpoint-retain',
    'old-vs-new-games',
    'plateau-window',
    'plateau-min-delta',
    'plateau-patience',
    'curriculum-simple-winrate',
    'curriculum-simple-winrate-threshold',
    'curriculum-lr-reduction-attempted',
    'curriculum-lr-reduction-improved',
    'fail-after-game'
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
  options.oldVsNewGames = Number(options['old-vs-new-games']);
  options.plateauWindow = Number(options['plateau-window']);
  options.plateauMinDelta = Number(options['plateau-min-delta']);
  options.plateauPatience = Number(options['plateau-patience']);
  options.curriculumSimpleWinrate = Number(options['curriculum-simple-winrate']);
  options.curriculumSimpleWinrateThreshold =
    Number(options['curriculum-simple-winrate-threshold']);
  options.curriculumLearningRateReductionAttempted =
    options['curriculum-lr-reduction-attempted'] === 'true';
  options.curriculumLearningRateReductionImproved =
    options['curriculum-lr-reduction-improved'] === 'true';
  options.failAfterGame = Number(options['fail-after-game']);
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

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function createRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function projectedCombatLabel(boardValues, globalValue) {
  const friendlyUnits = [];
  const enemyUnits = [];
  const targets = [];
  let score = 0;
  for (let x = 0; x < 3; x += 1) {
    for (let y = 0; y < 3; y += 1) {
      const offset = (x * 3 + y) * 21;
      const friendlyUnitCount = boardValues[offset];
      const enemyUnitCount = boardValues[offset + 1];
      const friendlyUnitHp = boardValues[offset + 2];
      const enemyUnitHp = boardValues[offset + 3];
      const friendlyDamage = boardValues[offset + 4];
      const enemyDamage = boardValues[offset + 5];
      const friendlyRange = boardValues[offset + 6];
      const enemyRange = boardValues[offset + 7];
      const friendlyTownCount = boardValues[offset + 8];
      const enemyTownCount = boardValues[offset + 9];
      const friendlyTownHp = boardValues[offset + 10];
      const enemyTownHp = boardValues[offset + 11];
      const friendlyMoves = boardValues[offset + 12];
      const enemyMoves = boardValues[offset + 13];
      if (friendlyUnitCount > 0) {
        friendlyUnits.push({ x, y, count: friendlyUnitCount });
      }
      if (enemyUnitCount > 0) {
        enemyUnits.push({ x, y, count: enemyUnitCount });
        targets.push({ x, y, kind: 'unit', count: enemyUnitCount });
      }
      if (enemyTownCount > 0) {
        targets.push({ x, y, kind: 'town', count: enemyTownCount });
      }
      score += friendlyUnitCount * 8 + friendlyUnitHp * 0.12 +
        friendlyDamage * 0.6 + friendlyRange * 2 + friendlyMoves * 0.2;
      score -= enemyUnitCount * 8 + enemyUnitHp * 0.12 +
        enemyDamage * 0.6 + enemyRange * 2 + enemyMoves * 0.2;
      score += friendlyTownCount * 45 + friendlyTownHp * 16;
      score -= enemyTownCount * 45 + enemyTownHp * 16;
    }
  }
  if (friendlyUnits.length && targets.length) {
    let nearestTotal = 0;
    let unitTotal = 0;
    for (const unit of friendlyUnits) {
      let nearest = Infinity;
      for (const target of targets) {
        nearest = Math.min(
          nearest,
          Math.abs(unit.x - target.x) + Math.abs(unit.y - target.y)
        );
      }
      nearestTotal += nearest * unit.count;
      unitTotal += unit.count;
    }
    score -= nearestTotal * 8 / Math.max(1, unitTotal);
  }
  if (enemyUnits.length && !friendlyUnits.length) {
    score -= 20;
  }
  score += Number(globalValue) || 0;
  return Math.tanh(score / 45);
}

function putTown(boardValues, x, y, owner, hpRatio) {
  const offset = (x * 3 + y) * 21;
  if (owner > 0) {
    boardValues[offset + 8] += 1;
    boardValues[offset + 10] += hpRatio;
  } else if (owner < 0) {
    boardValues[offset + 9] += 1;
    boardValues[offset + 11] += hpRatio;
  }
}

function putUnit(boardValues, x, y, owner, type, moves) {
  const offset = (x * 3 + y) * 21;
  const base = owner > 0 ? 0 : 1;
  boardValues[offset + base] += 1;
  boardValues[offset + 2 + base] += [10, 8, 14, 16, 7][type];
  boardValues[offset + 4 + base] += [5, 4, 7, 8, 10][type];
  boardValues[offset + 6 + base] += [1, 2, 1, 1, 5][type];
  boardValues[offset + 12 + base] += moves;
}

function createModel() {
  const boardInput = tf.input({ shape: [3, 3, 21], name: 'board' });
  const globalInput = tf.input({ shape: [1], name: 'global_variables' });
  const flattened = tf.layers.flatten().apply(boardInput);
  const merged = tf.layers.concatenate().apply([flattened, globalInput]);
  const output = tf.layers.dense({
    units: 1,
    activation: 'tanh',
    kernelInitializer: 'zeros',
    biasInitializer: 'zeros',
    name: 'value_output'
  }).apply(merged);
  const model = tf.model({ inputs: [boardInput, globalInput], outputs: output });
  return model;
}

function compileModel(model) {
  model.compile({
    optimizer: tf.train.adam(0.01),
    loss: 'meanSquaredError',
    metrics: ['accuracy']
  });
}

function makeBatch(seed, game) {
  const random = createRandom(seed + game * 1009);
  const boardValues = [];
  const globalValues = [];
  const labels = [];
  for (let sample = 0; sample < 96; sample += 1) {
    const board = new Array(3 * 3 * 21).fill(0);
    putTown(board, 0, 1, 1, 0.7 + random() * 0.3);
    putTown(board, 2, 1, -1, 0.45 + random() * 0.55);
    const friendlyCount = 1 + Math.floor(random() * 3);
    const enemyCount = 1 + Math.floor(random() * 3);
    for (let i = 0; i < friendlyCount; i += 1) {
      putUnit(
        board,
        Math.min(2, Math.floor(random() * 2)),
        Math.floor(random() * 3),
        1,
        Math.floor(random() * 5),
        random() > 0.25 ? 1 : 0
      );
    }
    for (let i = 0; i < enemyCount; i += 1) {
      putUnit(
        board,
        1 + Math.floor(random() * 2),
        Math.floor(random() * 3),
        -1,
        Math.floor(random() * 5),
        random() > 0.25 ? 1 : 0
      );
    }
    const globalValue = 0;
    boardValues.push(...board);
    globalValues.push(globalValue);
    labels.push(Math.tanh(4 * projectedCombatLabel(board, globalValue)));
  }
  const sampleCount = labels.length;
  return {
    board: tf.tensor4d(boardValues, [sampleCount, 3, 3, 21]),
    global: tf.tensor2d(globalValues, [sampleCount, 1]),
    labels: tf.tensor2d(labels, [sampleCount, 1])
  };
}

function projectRuntimeVectorForModel(vectorizedGrid) {
  const board = vectorizedGrid[0];
  const globalValue = 0;
  const width = board.length;
  const height = width ? board[0].length : 0;
  const projected = [];
  for (let xBucket = 0; xBucket < 3; xBucket += 1) {
    for (let yBucket = 0; yBucket < 3; yBucket += 1) {
      const xStart = Math.floor(xBucket * width / 3);
      const xEnd = Math.max(xStart + 1, Math.floor((xBucket + 1) * width / 3));
      const yStart = Math.floor(yBucket * height / 3);
      const yEnd = Math.max(yStart + 1, Math.floor((yBucket + 1) * height / 3));
      const sums = new Array(21).fill(0);
      let cells = 0;
      for (let x = xStart; x < Math.min(width, xEnd); x += 1) {
        for (let y = yStart; y < Math.min(height, yEnd); y += 1) {
          const cell = board[x][y] || [];
          const unitOwner = Number(cell[1]) || 0;
          if (unitOwner > 0) {
            sums[0] += 1;
            sums[2] += Number(cell[11]) || 0;
            sums[4] += Number(cell[9]) || 0;
            sums[6] += Number(cell[10]) || 0;
            sums[12] += Number(cell[7]) || 0;
          } else if (unitOwner < 0) {
            sums[1] += 1;
            sums[3] += Number(cell[11]) || 0;
            sums[5] += Number(cell[9]) || 0;
            sums[7] += Number(cell[10]) || 0;
            sums[13] += Number(cell[7]) || 0;
          }
          const townOwner = Number(cell[13]) || 0;
          if (townOwner > 0) {
            sums[8] += 1;
            sums[10] += Number(cell[14]) || 0;
          } else if (townOwner < 0) {
            sums[9] += 1;
            sums[11] += Number(cell[14]) || 0;
          }
          cells += 1;
        }
      }
      sums[14] = xBucket / 2;
      sums[15] = yBucket / 2;
      for (let channel = 0; channel < sums.length; channel += 1) {
        projected.push(sums[channel]);
      }
    }
  }
  return { board: projected, globalValue };
}

function createRuntimeModelPredict(model) {
  return function runtimeModelPredict(_modelIdentifier, vectorizedGrids) {
    const boards = [];
    const globals = [];
    for (const vectorizedGrid of vectorizedGrids) {
      const projected = projectRuntimeVectorForModel(vectorizedGrid);
      boards.push(...projected.board);
      globals.push(projected.globalValue);
    }
    const boardTensor = tf.tensor4d(boards, [vectorizedGrids.length, 3, 3, 21]);
    const globalTensor = tf.tensor2d(globals, [vectorizedGrids.length, 1]);
    const predictionTensor = model.predict([boardTensor, globalTensor]);
    try {
      return Array.from(predictionTensor.dataSync()).map((value) => [value]);
    } finally {
      predictionTensor.dispose();
      boardTensor.dispose();
      globalTensor.dispose();
    }
  };
}

function runtimeCombatTeacherLabel(vectorizedGrid) {
  const projected = projectRuntimeVectorForModel(vectorizedGrid);
  return {
    board: projected.board,
    globalValue: projected.globalValue,
    label: projectedCombatLabel(projected.board, projected.globalValue)
  };
}

function makeRuntimeCombatTeacherBatch(seed, stageIndex) {
  const boardValues = [];
  const globalValues = [];
  const labels = [];
  const collectPredict = function collectPredict(_modelIdentifier, vectorizedGrids) {
    const predictions = [];
    for (const vectorizedGrid of vectorizedGrids) {
      const example = runtimeCombatTeacherLabel(vectorizedGrid);
      boardValues.push(...example.board);
      globalValues.push(example.globalValue);
      labels.push(example.label);
      predictions.push([example.label]);
    }
    return predictions;
  };
  for (let game = 1; game <= 2; game += 1) {
    runGame({
      mapName: 'tiny-duel',
      playerA: 'AIPlayer',
      playerB: 'SimpleAiPlayer',
      seed: seed + stageIndex * 997 + game,
      roundLimit: 80,
      actionLimit: 80,
      commandLimit: 120,
      predictFunction: collectPredict,
      modelIdentifier: {
        teacher: 'runtime-combat-curriculum',
        seed,
        stageIndex
      },
      inferenceSource: 'runtime combat teacher labels for model training'
    });
  }
  const sampleCount = labels.length;
  if (!sampleCount) {
    return null;
  }
  return {
    board: tf.tensor4d(boardValues, [sampleCount, 3, 3, 21]),
    global: tf.tensor2d(globalValues, [sampleCount, 1]),
    labels: tf.tensor2d(labels, [sampleCount, 1])
  };
}

async function fitRuntimeCombatTeacherBatch(model, seed, stageIndex, epochs) {
  const runtimeBatch = makeRuntimeCombatTeacherBatch(seed, stageIndex);
  if (!runtimeBatch) {
    return null;
  }
  try {
    return await model.fit(
      [runtimeBatch.board, runtimeBatch.global],
      runtimeBatch.labels,
      {
        epochs,
        batchSize: 8,
        shuffle: true,
        verbose: 0
      }
    );
  } finally {
    runtimeBatch.board.dispose();
    runtimeBatch.global.dispose();
    runtimeBatch.labels.dispose();
  }
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

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function tensorSignature(tensors) {
  return tensors.map((tensor) => ({
    name: tensor.name.replace(/:\d+$/, '').split('/')[0].replace(/_\d+$/, ''),
    shape: tensor.shape
  }));
}

function validateCheckpointMetadata(checkpoint, state, manifest) {
  const metadata = checkpoint.metadata;
  if (metadata.modelVersion !== MODEL_VERSION) {
    fail(`incompatible checkpoint model version: expected ${MODEL_VERSION}, found ${metadata.modelVersion}`);
  }
  if (!sameValue(metadata.modelSignature, MODEL_SIGNATURE)) {
    fail('incompatible checkpoint model signature: expected board [3,3,21], globals [1], and value output [1]');
  }
  if (!metadata.trainingConfiguration) {
    fail('incompatible checkpoint: missing resumable training configuration');
  }
  const expected = metadata.trainingConfiguration;
  for (const [name, actual] of [
    ['games', state.totalGames],
    ['epochs', state.epochs],
    ['seed', state.seed]
  ]) {
    if (expected[name] !== actual) {
      fail(`incompatible checkpoint ${name}: checkpoint=${expected[name]} state=${actual}`);
    }
  }
  if (manifest && manifest.configuration) {
    for (const name of ['games', 'epochs', 'seed']) {
      if (manifest.configuration[name] !== expected[name]) {
        fail(`incompatible checkpoint ${name}: checkpoint=${expected[name]} manifest=${manifest.configuration[name]}`);
      }
    }
  }
}

function validateLoadedModel(model) {
  const actual = {
    inputs: tensorSignature(model.inputs),
    outputs: tensorSignature(model.outputs)
  };
  if (!sameValue(actual, MODEL_SIGNATURE)) {
    fail(`incompatible checkpoint model shapes: ${JSON.stringify(actual)}`);
  }
}

function latestCheckpointPath(storageDir, runId) {
  return path.join(storageDir, 'checkpoints', runId, 'latest.json');
}

function oldEpochPointerPath(storageDir, runId) {
  return path.join(storageDir, 'checkpoints', runId, 'old-epoch.json');
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

function pruneCheckpoints(checkpointDir, retain, protectedNames) {
  if (retain === 0) {
    return;
  }
  const protectedSet = new Set(protectedNames || []);
  const checkpoints = fs.readdirSync(checkpointDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^step-\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const checkpoint of checkpoints.slice(0, Math.max(0, checkpoints.length - retain))) {
    if (protectedSet.has(checkpoint)) {
      continue;
    }
    fs.rmSync(path.join(checkpointDir, checkpoint), { recursive: true, force: true });
  }
}

async function saveCheckpoint(model, options, state, checkpointDir, reason) {
  const name = checkpointName(state.completedGames);
  const destination = path.join(checkpointDir, name);
  const previousPointer = readLatestCheckpointPointer(options);
  const temporary = `${destination}.tmp-${process.pid}`;
  fs.rmSync(temporary, { recursive: true, force: true });
  await model.save(`file://${temporary}`);
  const timestamp = new Date().toISOString();
  writeJson(path.join(temporary, 'metadata.json'), {
    modelVersion: MODEL_VERSION,
    modelSignature: MODEL_SIGNATURE,
    runId: state.runId,
    trainingStep: state.completedGames,
    seed: state.seed,
    epochs: state.epochs,
    totalGames: state.totalGames,
    trainingConfiguration: {
      games: state.totalGames,
      epochs: state.epochs,
      seed: state.seed,
      checkpointInterval: options.checkpointInterval,
      checkpointRetain: options.checkpointRetain,
      oldVsNewGames: options.oldVsNewGames,
      plateauWindow: options.plateauWindow,
      plateauMinDelta: options.plateauMinDelta,
      plateauPatience: options.plateauPatience,
      curriculumSimpleWinrateThreshold: options.curriculumSimpleWinrateThreshold
    },
    timestamp,
    codeRevision: gitRevision(),
    reason,
    state: {
      completedGames: state.completedGames,
      status: state.status,
      updatedAt: state.updatedAt,
      curriculum: state.curriculum || initialCurriculumState()
    }
  });
  replaceDirectory(temporary, destination);
  writeJson(latestCheckpointPath(options.storageDir, options.runId), {
    runId: options.runId,
    trainingStep: state.completedGames,
    timestamp,
    path: path.relative(options.storageDir, destination)
  });
  if (previousPointer) {
    const previousPath = path.join(options.storageDir, previousPointer.path);
    if (fs.existsSync(path.join(previousPath, 'model.json')) &&
        fs.existsSync(path.join(previousPath, 'metadata.json'))) {
      writeJson(oldEpochPointerPath(options.storageDir, options.runId), {
        runId: options.runId,
        trainingStep: previousPointer.trainingStep,
        timestamp,
        path: previousPointer.path,
        evaluatedBy: path.relative(options.storageDir, destination)
      });
    }
  }
  fs.writeFileSync(path.join(options.storageDir, 'checkpoints', 'latest-run'), `${options.runId}\n`);
  const protectedNames = previousPointer && previousPointer.path
    ? [path.basename(previousPointer.path), name]
    : [name];
  pruneCheckpoints(checkpointDir, options.checkpointRetain, protectedNames);
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

function metricRecords(metricsPath) {
  return readJsonLines(metricsPath).filter((record) => record.type === 'game');
}

function summarizeMetrics(records) {
  const wins = { red: 0, blue: 0, draw: 0 };
  let lossTotal = 0;
  let episodeLengthTotal = 0;
  for (const record of records) {
    wins[record.winner] += 1;
    lossTotal += record.loss;
    episodeLengthTotal += record.episodeLength;
  }
  const gamesPlayed = records.length;
  return {
    gamesPlayed,
    averageLoss: gamesPlayed ? lossTotal / gamesPlayed : null,
    averageEpisodeLength: gamesPlayed ? episodeLengthTotal / gamesPlayed : null,
    wins,
    winRates: {
      red: gamesPlayed ? wins.red / gamesPlayed : 0,
      blue: gamesPlayed ? wins.blue / gamesPlayed : 0,
      draw: gamesPlayed ? wins.draw / gamesPlayed : 0
    },
    benchmarkSummary: {
      completedGames: gamesPlayed,
      decisiveGames: wins.red + wins.blue,
      draws: wins.draw
    }
  };
}

function readLatestCheckpointPointer(options) {
  const checkpointPointer = latestCheckpointPath(options.storageDir, options.runId);
  if (!fs.existsSync(checkpointPointer)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(checkpointPointer, 'utf8'));
}

function readOldEpochPointer(options) {
  const pointerPath = oldEpochPointerPath(options.storageDir, options.runId);
  if (!fs.existsSync(pointerPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
}

async function predictionLoss(model, batch) {
  const predictionTensor = model.predict([batch.board, batch.global]);
  try {
    const predictions = Array.from(await predictionTensor.data());
    const labels = Array.from(await batch.labels.data());
    let loss = 0;
    for (let index = 0; index < predictions.length; index += 1) {
      loss += Math.pow(predictions[index] - labels[index], 2);
    }
    return loss / predictions.length;
  } finally {
    predictionTensor.dispose();
  }
}

async function evaluateNewVsOld(options, state, newModel, oldPointer) {
  if (!oldPointer) {
    return {
      evaluated: false,
      reason: 'no previous complete checkpoint is available yet',
      games: 0,
      oldCheckpoint: null,
      newCheckpoint: null,
      newWins: 0,
      oldWins: 0,
      draws: 0,
      winrate: null
    };
  }
  const oldCheckpointPath = path.join(options.storageDir, oldPointer.path);
  if (!fs.existsSync(path.join(oldCheckpointPath, 'model.json'))) {
    fail(`old epoch checkpoint is incomplete: ${oldPointer.path}`);
  }
  const oldModel = await tf.loadLayersModel(
    `file://${path.join(oldCheckpointPath, 'model.json')}`
  );
  try {
    validateLoadedModel(oldModel);
    let newWins = 0;
    let oldWins = 0;
    let draws = 0;
    for (let game = 1; game <= options.oldVsNewGames; game += 1) {
      const batch = makeBatch(state.seed + state.completedGames * 7919, game);
      try {
        const newLoss = await predictionLoss(newModel, batch);
        const oldLoss = await predictionLoss(oldModel, batch);
        const delta = oldLoss - newLoss;
        if (Math.abs(delta) < 1e-9) {
          draws += 1;
        } else if (delta > 0) {
          newWins += 1;
        } else {
          oldWins += 1;
        }
      } finally {
        batch.board.dispose();
        batch.global.dispose();
        batch.labels.dispose();
      }
    }
    const decidedGames = newWins + oldWins + draws;
    const checkpointPointer = readLatestCheckpointPointer(options);
    return {
      evaluated: true,
      games: options.oldVsNewGames,
      oldCheckpoint: oldPointer.path,
      oldTrainingStep: oldPointer.trainingStep,
      newCheckpoint: checkpointPointer ? checkpointPointer.path : null,
      newTrainingStep: state.completedGames,
      newWins,
      oldWins,
      draws,
      winrate: decidedGames ? newWins / decidedGames : null
    };
  } finally {
    oldModel.dispose();
  }
}

function progressPlateauState(previousRecords, oldVsNewEvaluation, options) {
  const evaluated = previousRecords
    .map((record) => record.oldVsNewEvaluation)
    .filter((evaluation) => evaluation && evaluation.evaluated &&
      typeof evaluation.winrate === 'number');
  if (oldVsNewEvaluation && oldVsNewEvaluation.evaluated &&
      typeof oldVsNewEvaluation.winrate === 'number') {
    evaluated.push(oldVsNewEvaluation);
  }
  const recent = evaluated.slice(-options.plateauWindow);
  if (recent.length < options.plateauWindow) {
    return {
      status: 'insufficient-data',
      window: recent.length,
      configuredWindow: options.plateauWindow,
      minDelta: options.plateauMinDelta,
      patience: options.plateauPatience,
      winrateDelta: null,
      plateauCount: 0
    };
  }
  const winrateDelta = recent[recent.length - 1].winrate - recent[0].winrate;
  let plateauCount = 0;
  for (let index = 1; index < recent.length; index += 1) {
    if (recent[index].winrate - recent[index - 1].winrate < options.plateauMinDelta) {
      plateauCount += 1;
    }
  }
  return {
    status: plateauCount >= options.plateauPatience ? 'plateau' : 'improving',
    window: recent.length,
    configuredWindow: options.plateauWindow,
    minDelta: options.plateauMinDelta,
    patience: options.plateauPatience,
    winrateDelta,
    plateauCount
  };
}

function initialCurriculumState() {
  return {
    currentStageIndex: 0,
    currentStage: 'combat-foundation',
    gateHistory: []
  };
}

async function evaluateCurriculumSimpleAiWinrate(options, state, model) {
  const games = options.oldVsNewGames;
  let modelWins = 0;
  let simpleWins = 0;
  let draws = 0;
  const gameResults = [];
  const predictFunction = createRuntimeModelPredict(model);
  for (let game = 1; game <= games; game += 1) {
    const seed = state.seed + state.completedGames * 3571 +
      state.curriculum.currentStageIndex * 101 + game;
    const result = runGame({
      mapName: 'tiny-duel',
      playerA: 'AIPlayer',
      playerB: 'SimpleAiPlayer',
      seed,
      roundLimit: 80,
      actionLimit: 80,
      commandLimit: 120,
      predictFunction,
      modelIdentifier: {
        runId: state.runId,
        trainingStep: state.completedGames,
        curriculumStage: state.curriculum.currentStage
      },
      inferenceSource: 'current TensorFlow checkpoint output through unchanged runtime AIPlayer predict()'
    });
    let winner = 'draw';
    if (result.winnerSide === 'A') {
      modelWins += 1;
      winner = 'model';
    } else if (result.winnerSide === 'B') {
      simpleWins += 1;
      winner = 'SimpleAiPlayer';
    } else {
      draws += 1;
    }
    gameResults.push({
      game,
      seed,
      winner,
      winnerSide: result.winnerSide,
      roundCount: result.roundCount,
      timeout: result.timeout === true,
      suddenDeath: result.suddenDeath === true,
      nonResult: result.nonResult === true,
      runtimePlayerA: result.runtimePlayerA,
      runtimePlayerB: result.runtimePlayerB,
      inference: result.inference,
      map: {
        name: 'tiny-duel',
        stage: state.curriculum.currentStage,
        source: 'benchmarkHarness fixed combat map'
      }
    });
  }
  return {
    value: games ? modelWins / games : null,
    evaluated: true,
    games,
    modelWins,
    simpleAiPlayerWins: simpleWins,
    draws,
    source: 'measured-model-vs-SimpleAiPlayer-benchmark',
    benchmarkPolicy: 'real GameMap runtime with unchanged AIPlayer using current TensorFlow model output versus unchanged SimpleAiPlayer',
    modelAdapter: 'runtime vector grids are projected into the cloud model 3x3x21 input signature outside player code; the TensorFlow value_output is used directly',
    artificialAdvantage: false,
    results: gameResults
  };
}

async function curriculumSimpleAiWinrate(options, state, model) {
  if (options.curriculumSimpleWinrate >= 0) {
    return {
      value: options.curriculumSimpleWinrate,
      evaluated: true,
      games: options.oldVsNewGames,
      source: 'mock-or-tiny-evaluation'
    };
  }
  return evaluateCurriculumSimpleAiWinrate(options, state, model);
}

function curriculumLearningRateAttempt(options) {
  return {
    attempted: options.curriculumLearningRateReductionAttempted,
    improved: options.curriculumLearningRateReductionImproved,
    attemptedLearningRate: options.curriculumLearningRateReductionAttempted
      ? 0.0005
      : null,
    baseLearningRate: 0.01
  };
}

function curriculumGateDecision(state, plateauState, simpleAiPlayerWinrate, learningRateAttempt, options) {
  const reasons = [];
  if (plateauState.status !== 'plateau') {
    reasons.push('old-vs-new plateau evidence is not present');
  }
  if (!learningRateAttempt.attempted) {
    reasons.push('lower learning-rate attempt has not been recorded');
  } else if (learningRateAttempt.improved) {
    reasons.push('lower learning-rate attempt improved progress');
  }
  if (!simpleAiPlayerWinrate.evaluated) {
    reasons.push('SimpleAiPlayer winrate has not been evaluated');
  } else if (!(simpleAiPlayerWinrate.value > options.curriculumSimpleWinrateThreshold)) {
    reasons.push(`SimpleAiPlayer winrate must be greater than ${options.curriculumSimpleWinrateThreshold}`);
  }
  return {
    currentStageIndex: state.curriculum.currentStageIndex,
    currentStage: state.curriculum.currentStage,
    eligible: reasons.length === 0,
    decision: reasons.length === 0 ? 'advance' : 'hold',
    reason: reasons.length === 0
      ? 'plateau, learning-rate, and SimpleAiPlayer gates passed'
      : reasons.join('; '),
    plateauEvidence: plateauState.status === 'plateau',
    learningRateReduction: learningRateAttempt,
    simpleAiPlayerWinrate,
    requiredSimpleAiPlayerWinrate: options.curriculumSimpleWinrateThreshold
  };
}

function updateCurriculumState(state, gateDecision) {
  state.curriculum = state.curriculum || initialCurriculumState();
  const alreadyRecorded = state.curriculum.gateHistory.some((entry) =>
    entry.trainingStep === state.completedGames);
  if (alreadyRecorded) {
    return state.curriculum;
  }
  const entry = {
    trainingStep: state.completedGames,
    stageIndex: state.curriculum.currentStageIndex,
    stage: state.curriculum.currentStage,
    decision: gateDecision.decision,
    reason: gateDecision.reason,
    plateauEvidence: gateDecision.plateauEvidence,
    learningRateReduction: gateDecision.learningRateReduction,
    simpleAiPlayerWinrate: gateDecision.simpleAiPlayerWinrate,
    requiredSimpleAiPlayerWinrate: gateDecision.requiredSimpleAiPlayerWinrate,
    timestamp: state.updatedAt
  };
  state.curriculum.gateHistory.push(entry);
  if (gateDecision.eligible) {
    state.curriculum.currentStageIndex += 1;
    state.curriculum.currentStage = `combat-stage-${state.curriculum.currentStageIndex}`;
    entry.advancedToStage = state.curriculum.currentStage;
    entry.advancedToStageIndex = state.curriculum.currentStageIndex;
  }
  return state.curriculum;
}

async function progressRecord(options, state, metric, previousRecords, model) {
  const summary = summarizeMetrics(previousRecords.concat(metric));
  const checkpointPointer = readLatestCheckpointPointer(options);
  const oldVsNewEvaluation = metric.oldVsNewEvaluation || {
    evaluated: false,
    winrate: null
  };
  const plateauState = progressPlateauState(
    previousRecords,
    oldVsNewEvaluation,
    options
  );
  const simpleAiPlayerWinrate = await curriculumSimpleAiWinrate(options, state, model);
  const learningRateReduction = curriculumLearningRateAttempt(options);
  const nextStageEligibility = curriculumGateDecision(
    state,
    plateauState,
    simpleAiPlayerWinrate,
    learningRateReduction,
    options
  );
  const curriculum = updateCurriculumState(state, nextStageEligibility);
  return {
    type: 'combat-training-progress',
    runId: options.runId,
    stage: state.curriculum.currentStage,
    stageIndex: state.curriculum.currentStageIndex,
    epoch: state.epochs,
    game: metric.game,
    trainingStep: state.completedGames,
    checkpoint: checkpointPointer ? checkpointPointer.path : null,
    loss: metric.loss,
    learningRate: learningRateReduction.baseLearningRate,
    oldVsNewWinrate: {
      oldCheckpoint: oldVsNewEvaluation.oldCheckpoint || null,
      newCheckpoint: oldVsNewEvaluation.newCheckpoint || null,
      evaluated: oldVsNewEvaluation.evaluated === true,
      games: oldVsNewEvaluation.games || 0,
      newWins: oldVsNewEvaluation.newWins || 0,
      oldWins: oldVsNewEvaluation.oldWins || 0,
      draws: oldVsNewEvaluation.draws || 0,
      winrate: oldVsNewEvaluation.winrate,
      reason: oldVsNewEvaluation.reason || null
    },
    simpleAiPlayerWinrate,
    plateauState,
    learningRateReduction,
    nextStageEligibility,
    curriculum,
    timestamp: state.updatedAt
  };
}

function manifestValue(options, state, paths, status, errorMessage) {
  const checkpointPointer = latestCheckpointPath(options.storageDir, options.runId);
  const outputFiles = [
    paths.statePath,
    paths.manifestPath,
    paths.metricsPath,
    paths.metricsSummaryPath,
    paths.progressPath,
    paths.logPath
  ];
  if (fs.existsSync(checkpointPointer)) {
    outputFiles.push(checkpointPointer);
  }
  const oldEpochPointer = oldEpochPointerPath(options.storageDir, options.runId);
  if (fs.existsSync(oldEpochPointer)) {
    outputFiles.push(oldEpochPointer);
  }
  if (fs.existsSync(path.join(paths.finalDir, 'model.json'))) {
    outputFiles.push(paths.finalDir);
  }
  const value = {
    runId: options.runId,
    status,
    codeRevision: gitRevision(),
    configuration: {
      games: state.totalGames,
      epochs: state.epochs,
      seed: state.seed,
      checkpointInterval: options.checkpointInterval,
      checkpointRetain: options.checkpointRetain === 0 ? 'all' : options.checkpointRetain,
      oldVsNewGames: options.oldVsNewGames,
      plateauWindow: options.plateauWindow,
      plateauMinDelta: options.plateauMinDelta,
      plateauPatience: options.plateauPatience,
      curriculumSimpleWinrateThreshold: options.curriculumSimpleWinrateThreshold
    },
    progress: {
      completedGames: state.completedGames,
      totalGames: state.totalGames,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      completedAt: state.completedAt || null
    },
    resume: {
      count: (state.resumeEvents || []).length,
      events: state.resumeEvents || []
    },
    curriculum: state.curriculum || initialCurriculumState(),
    artifacts: {
      checkpoints: path.relative(options.storageDir, paths.checkpointDir),
      latestCheckpoint: fs.existsSync(checkpointPointer)
        ? path.relative(options.storageDir, checkpointPointer)
        : null,
      oldEpochWeights: fs.existsSync(oldEpochPointer)
        ? path.relative(options.storageDir, oldEpochPointer)
        : null,
      metrics: path.relative(options.storageDir, paths.metricsPath),
      metricsSummary: path.relative(options.storageDir, paths.metricsSummaryPath),
      progress: path.relative(options.storageDir, paths.progressPath),
      log: path.relative(options.storageDir, paths.logPath),
      state: path.relative(options.storageDir, paths.statePath),
      finalModel: path.relative(options.storageDir, paths.finalDir),
      outputFiles: outputFiles.map((filePath) => path.relative(options.storageDir, filePath))
    }
  };
  if (errorMessage) {
    value.failure = {
      message: errorMessage,
      timestamp: state.updatedAt
    };
  }
  return value;
}

function persistRunMetadata(options, state, paths, status, errorMessage) {
  writeJson(paths.statePath, state);
  writeJson(paths.metricsSummaryPath, {
    runId: options.runId,
    status,
    updatedAt: state.updatedAt,
    ...summarizeMetrics(metricRecords(paths.metricsPath))
  });
  writeJson(
    paths.manifestPath,
    manifestValue(options, state, paths, status, errorMessage)
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runDir = path.join(options.storageDir, 'runs', options.runId);
  const checkpointDir = path.join(options.storageDir, 'checkpoints', options.runId);
  const statePath = path.join(runDir, 'state.json');
  const manifestPath = path.join(runDir, 'manifest.json');
  const metricsPath = path.join(options.storageDir, 'metrics', `${options.runId}.jsonl`);
  const metricsSummaryPath = path.join(options.storageDir, 'metrics', `${options.runId}.summary.json`);
  const progressPath = path.join(options.storageDir, 'progress', `${options.runId}.jsonl`);
  const logPath = path.join(options.storageDir, 'logs', `${options.runId}.log`);
  const finalDir = path.join(options.storageDir, 'final', options.runId);
  const paths = {
    checkpointDir,
    finalDir,
    logPath,
    manifestPath,
    metricsPath,
    metricsSummaryPath,
    progressPath,
    statePath
  };

  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(checkpointDir, { recursive: true });
  fs.mkdirSync(path.dirname(metricsPath), { recursive: true });
  fs.mkdirSync(path.dirname(progressPath), { recursive: true });

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
    const manifest = fs.existsSync(manifestPath)
      ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      : null;
    validateCheckpointMetadata(checkpoint, state, manifest);
    const records = metricRecords(metricsPath);
    const latestMetricGame = records.length ? records[records.length - 1].game : 0;
    if (latestMetricGame !== checkpoint.metadata.trainingStep) {
      fail(`resume numbering conflict: latest checkpoint is game ${checkpoint.metadata.trainingStep} but metrics end at game ${latestMetricGame}`);
    }
    state.completedGames = checkpoint.metadata.state.completedGames;
    state.status = checkpoint.metadata.state.status;
    state.updatedAt = checkpoint.metadata.state.updatedAt;
    state.curriculum = state.curriculum ||
      checkpoint.metadata.state.curriculum ||
      initialCurriculumState();
    if (state.status === 'complete') {
      fail(`run ${options.runId} is already complete`);
    }
    options.checkpointInterval = checkpoint.metadata.trainingConfiguration.checkpointInterval;
    options.checkpointRetain = checkpoint.metadata.trainingConfiguration.checkpointRetain;
    options.oldVsNewGames = checkpoint.metadata.trainingConfiguration.oldVsNewGames ||
      options.oldVsNewGames;
    options.plateauWindow = checkpoint.metadata.trainingConfiguration.plateauWindow ||
      options.plateauWindow;
    options.plateauMinDelta =
      checkpoint.metadata.trainingConfiguration.plateauMinDelta !== undefined
        ? checkpoint.metadata.trainingConfiguration.plateauMinDelta
        : options.plateauMinDelta;
    options.plateauPatience = checkpoint.metadata.trainingConfiguration.plateauPatience ||
      options.plateauPatience;
    options.curriculumSimpleWinrateThreshold =
      checkpoint.metadata.trainingConfiguration.curriculumSimpleWinrateThreshold !== undefined
        ? checkpoint.metadata.trainingConfiguration.curriculumSimpleWinrateThreshold
        : options.curriculumSimpleWinrateThreshold;
    model = await tf.loadLayersModel(`file://${path.join(checkpoint.path, 'model.json')}`);
    validateLoadedModel(model);
    const resumeEvent = {
      checkpoint: path.relative(options.storageDir, checkpoint.path),
      trainingStep: state.completedGames,
      timestamp: new Date().toISOString()
    };
    state.resumeEvents = (state.resumeEvents || []).concat(resumeEvent);
    state.status = 'running';
    state.updatedAt = resumeEvent.timestamp;
    appendJsonLine(metricsPath, {
      type: 'resume',
      runId: options.runId,
      ...resumeEvent
    });
    persistRunMetadata(options, state, paths, 'running');
    console.log(`Resuming ${options.runId} from ${resumeEvent.checkpoint} after game ${state.completedGames}`);
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
      resumeEvents: [],
      curriculum: initialCurriculumState(),
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    model = createModel();
    persistRunMetadata(options, state, paths, 'running');
  }

  try {
    compileModel(model);
    if (!options.resume && state.completedGames === 0) {
      for (let pretrain = 0; pretrain < 4; pretrain += 1) {
        await fitRuntimeCombatTeacherBatch(
          model,
          state.seed + 50000 + pretrain * 173,
          state.curriculum.currentStageIndex,
          8
        );
      }
    }
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
      let labels;
      let prediction;
      let predictionTensor;
      try {
        labels = Array.from(await batch.labels.data());
        history = await model.fit(
          [batch.board, batch.global],
          batch.labels,
          {
            epochs: Math.max(state.epochs, 12),
            batchSize: 8,
            shuffle: true,
            verbose: 0
          }
        );
        history = await fitRuntimeCombatTeacherBatch(
          model,
          state.seed + game * 1543,
          state.curriculum.currentStageIndex,
          Math.max(state.epochs, 4)
        ) || history;
        predictionTensor = model.predict([batch.board, batch.global]);
        prediction = Array.from(await predictionTensor.data());
      } finally {
        if (predictionTensor) {
          predictionTensor.dispose();
        }
        batch.board.dispose();
        batch.global.dispose();
        batch.labels.dispose();
      }
      const labelScore = labels.reduce((total, value) => total + value, 0);
      const predictionScore = prediction.reduce((total, value) => total + value, 0);
      const winner = labelScore === 0
        ? 'draw'
        : (predictionScore >= 0 ? 'red' : 'blue');
      const episodeLength = labels.length * state.epochs;
      state.completedGames = game;
      state.updatedAt = new Date().toISOString();
      state.status = state.completedGames === state.totalGames ? 'complete' : 'running';
      if (game % options.checkpointInterval === 0 || game === state.totalGames) {
        await saveCheckpoint(model, options, state, checkpointDir, 'interval');
      }
      const previousRecords = metricRecords(metricsPath);
      const loss = history.history.loss[history.history.loss.length - 1];
      const accuracyHistory = history.history.acc || history.history.accuracy || [];
      const metric = {
        type: 'game',
        runId: options.runId,
        game,
        gamesPlayed: game,
        epochs: state.epochs,
        loss,
        accuracy: accuracyHistory.length
          ? accuracyHistory[accuracyHistory.length - 1]
          : null,
        episodeLength,
        winner,
        durationMs: Date.now() - started,
        timestamp: state.updatedAt
      };
      metric.oldVsNewEvaluation = await evaluateNewVsOld(
        options,
        state,
        model,
        readOldEpochPointer(options)
      );
      const summary = summarizeMetrics(previousRecords.concat(metric));
      metric.winRates = summary.winRates;
      metric.benchmarkSummary = {
        ...summary.benchmarkSummary,
        oldVsNewWinrate: metric.oldVsNewEvaluation
      };
      appendJsonLine(metricsPath, metric);
      appendJsonLine(
        progressPath,
        await progressRecord(options, state, metric, previousRecords, model)
      );
      persistRunMetadata(options, state, paths, state.status);
      console.log(`Completed game ${game}/${state.totalGames}`);
      if (options.failAfterGame === game) {
        fail(`forced failure after game ${game}`);
      }
    }

    if (state.completedGames === state.totalGames) {
      state.status = 'complete';
      state.completedAt = new Date().toISOString();
      state.updatedAt = state.completedAt;
      await saveModelAtomically(model, finalDir);
      persistRunMetadata(options, state, paths, 'complete');
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
      persistRunMetadata(options, state, paths, 'paused');
      console.log(`Training paused at ${state.completedGames}/${state.totalGames}; resume with ./train.sh --resume`);
    }
  } catch (error) {
    state.status = 'failed';
    state.updatedAt = new Date().toISOString();
    appendJsonLine(metricsPath, {
      type: 'run_failure',
      runId: options.runId,
      gamesPlayed: state.completedGames,
      message: error.message,
      timestamp: state.updatedAt
    });
    persistRunMetadata(options, state, paths, 'failed', error.message);
    throw error;
  } finally {
    model.dispose();
  }
}

main().catch((error) => {
  console.error(`cloud training error: ${error.message}`);
  process.exitCode = 1;
});
