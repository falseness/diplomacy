const fs = require('fs');
const path = require('path');
const {
  Worker,
  isMainThread,
  parentPort
} = require('worker_threads');
const tf = isMainThread ? require('@tensorflow/tfjs-node') : null;
const { runGame } = require('./benchmarkHarness');
const {
  ALPHAZERO_LITE_COMBAT_ARCHITECTURE_VERSION,
  DEFAULT_ACTION_SPACE_SIZE,
  createAlphaZeroLiteCombatModel,
  validateMetadata: validateAlphaZeroLiteCombatMetadata
} = require('./alphazero-lite-combat');
const {
  finalSymmetricalCombatPredict
} = require('./benchmark-final-symmetrical-combat-gate');

const MODEL_VERSION = 2;
const CURRICULUM_FINAL_STAGE_INDEX = 6;
const MODEL_SIGNATURE = {
  inputs: [
    { name: 'board', shape: [null, 3, 3, 21] },
    { name: 'global_variables', shape: [null, 1] }
  ],
  outputs: [
    { name: 'combat_policy', shape: [null, DEFAULT_ACTION_SPACE_SIZE] },
    { name: 'combat_value', shape: [null, 1] }
  ]
};
const MODEL_ARCHITECTURE_METADATA = {
  architectureVersion: ALPHAZERO_LITE_COMBAT_ARCHITECTURE_VERSION,
  combatOnly: true,
  vectorCompatibility: {
    kind: 'combat-only',
    boardShape: [3, 3, 21],
    globalShape: [1],
    economyFeatures: false
  },
  actionSpace: {
    kind: 'legal-combat-action-index',
    size: DEFAULT_ACTION_SPACE_SIZE,
    maskRequired: true
  },
  outputs: {
    policy: 'combat_policy',
    value: 'combat_value'
  }
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
    'evaluation-cadence',
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
  options.evaluationCadence = Number(options['evaluation-cadence']);
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
  options.workers = options.workers === undefined ? 1 : Number(options.workers);
  options.failAfterGame = Number(options['fail-after-game']);
  options.storageDir = path.resolve(options['storage-dir']);
  options.runId = options['run-id'];
  if (!Number.isInteger(options.workers) || options.workers < 1) {
    fail('--workers must be a positive integer');
  }
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

function task104DeterministicInvariantMode() {
  return process.env.DIPLOMACY_TASK104_DETERMINISTIC_INVARIANT === '1';
}

function deterministicTrainingMode(options, state) {
  if (task104DeterministicInvariantMode()) {
    return true;
  }
  if (state && state.deterministicTraining === true) {
    return true;
  }
  return options && options.evaluationCadence === 1;
}

function cadenceSpeedMode(options) {
  return options && options.evaluationCadence > 1;
}

function task104LegacyMetricLoopMode() {
  return process.env.DIPLOMACY_TASK104_LEGACY_METRIC_LOOP === '1';
}

function nowIso(state, label) {
  if (!task104DeterministicInvariantMode() &&
      !(state && state.deterministicTraining === true)) {
    return new Date().toISOString();
  }
  const step = state && Number.isInteger(state.completedGames)
    ? state.completedGames
    : 0;
  const labelOffset = label
    ? Array.from(label).reduce((total, character) =>
      total + character.charCodeAt(0), 0) % 100
    : 0;
  return new Date(Date.UTC(2026, 0, 1, 0, step, labelOffset)).toISOString();
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

function createModel(seed) {
  return createAlphaZeroLiteCombatModel({
    boardHeight: 3,
    boardWidth: 3,
    channels: 21,
    globalFeatures: 1,
    actionSpaceSize: DEFAULT_ACTION_SPACE_SIZE,
    filters: 32,
    residualBlocks: 3,
    learningRate: 0.01,
    seed
  }).model;
}

function compileModel(model) {
  model.compile({
    optimizer: tf.train.adam(0.01),
    loss: {
      combat_policy: 'categoricalCrossentropy',
      combat_value: 'meanSquaredError'
    },
    lossWeights: {
      combat_policy: 0.25,
      combat_value: 1
    }
  });
}

function actionIndexFromProjectedBoard(boardValues) {
  let bestIndex = 0;
  let bestScore = -Infinity;
  for (let x = 0; x < 3; x += 1) {
    for (let y = 0; y < 3; y += 1) {
      const offset = (x * 3 + y) * 21;
      const score = (boardValues[offset] || 0) * 2 +
        (boardValues[offset + 2] || 0) * 0.1 +
        (boardValues[offset + 4] || 0) -
        Math.abs(1 - x) * 0.05 -
        Math.abs(1 - y) * 0.05;
      const index = x * 3 + y;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
  }
  return bestIndex;
}

function oneHotPolicy(index) {
  const policy = new Array(DEFAULT_ACTION_SPACE_SIZE).fill(0);
  policy[Math.max(0, Math.min(DEFAULT_ACTION_SPACE_SIZE - 1, index))] = 1;
  return policy;
}

function modelTargets(batch) {
  return {
    combat_policy: batch.policy,
    combat_value: batch.labels
  };
}

function modelLoss(history) {
  const valueLoss = history.history.combat_value_loss || history.history.loss || [];
  return valueLoss.length ? valueLoss[valueLoss.length - 1] : null;
}

function predictionValueTensor(prediction) {
  if (Array.isArray(prediction)) {
    const valueOutputIndex = prediction.findIndex((tensor) =>
      (tensor.name || '').replace(/:\d+$/, '').split('/')[0] === 'combat_value');
    return prediction[valueOutputIndex >= 0 ? valueOutputIndex : prediction.length - 1];
  }
  return prediction;
}

function disposePrediction(prediction) {
  if (Array.isArray(prediction)) {
    prediction.forEach((tensor) => tensor.dispose());
  } else if (prediction) {
    prediction.dispose();
  }
}

function makeBatch(seed, game) {
  const random = createRandom(seed + game * 1009);
  const boardValues = [];
  const globalValues = [];
  const labels = [];
  const policies = [];
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
    policies.push(oneHotPolicy(actionIndexFromProjectedBoard(board)));
    labels.push(Math.tanh(4 * projectedCombatLabel(board, globalValue)));
  }
  const sampleCount = labels.length;
  return {
    board: tf.tensor4d(boardValues, [sampleCount, 3, 3, 21]),
    global: tf.tensor2d(globalValues, [sampleCount, 1]),
    policy: tf.tensor2d(policies, [sampleCount, DEFAULT_ACTION_SPACE_SIZE]),
    labels: tf.tensor2d(labels, [sampleCount, 1])
  };
}

const runtimeProjectionBucketCache = new Map();

function runtimeProjectionBuckets(width, height) {
  const key = width + 'x' + height;
  const cached = runtimeProjectionBucketCache.get(key);
  if (cached) {
    return cached;
  }
  const buckets = [];
  for (let xBucket = 0; xBucket < 3; xBucket += 1) {
    for (let yBucket = 0; yBucket < 3; yBucket += 1) {
      const xStart = Math.floor(xBucket * width / 3);
      const xEnd = Math.min(
        width,
        Math.max(xStart + 1, Math.floor((xBucket + 1) * width / 3))
      );
      const yStart = Math.floor(yBucket * height / 3);
      const yEnd = Math.min(
        height,
        Math.max(yStart + 1, Math.floor((yBucket + 1) * height / 3))
      );
      buckets.push({
        xStart,
        xEnd,
        yStart,
        yEnd,
        xValue: xBucket / 2,
        yValue: yBucket / 2
      });
    }
  }
  runtimeProjectionBucketCache.set(key, buckets);
  return buckets;
}

function projectRuntimeVectorForModel(vectorizedGrid) {
  const board = vectorizedGrid[0];
  const globalValue = 0;
  const width = board.length;
  const height = width ? board[0].length : 0;
  const projected = new Array(3 * 3 * 21).fill(0);
  const buckets = runtimeProjectionBuckets(width, height);
  for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex += 1) {
    const bucket = buckets[bucketIndex];
    const offset = bucketIndex * 21;
    for (let x = bucket.xStart; x < bucket.xEnd; x += 1) {
      for (let y = bucket.yStart; y < bucket.yEnd; y += 1) {
        const cell = board[x][y] || [];
        const unitOwner = Number(cell[1]) || 0;
        if (unitOwner > 0) {
          projected[offset] += 1;
          projected[offset + 2] += Number(cell[11]) || 0;
          projected[offset + 4] += Number(cell[9]) || 0;
          projected[offset + 6] += Number(cell[10]) || 0;
          projected[offset + 12] += Number(cell[7]) || 0;
        } else if (unitOwner < 0) {
          projected[offset + 1] += 1;
          projected[offset + 3] += Number(cell[11]) || 0;
          projected[offset + 5] += Number(cell[9]) || 0;
          projected[offset + 7] += Number(cell[10]) || 0;
          projected[offset + 13] += Number(cell[7]) || 0;
        }
        const townOwner = Number(cell[13]) || 0;
        if (townOwner > 0) {
          projected[offset + 8] += 1;
          projected[offset + 10] += Number(cell[14]) || 0;
        } else if (townOwner < 0) {
          projected[offset + 9] += 1;
          projected[offset + 11] += Number(cell[14]) || 0;
        }
      }
    }
    projected[offset + 14] = bucket.xValue;
    projected[offset + 15] = bucket.yValue;
  }
  return { board: projected, globalValue };
}

function createRuntimeModelPredict(model) {
  return function runtimeModelPredict(_modelIdentifier, vectorizedGrids) {
    return finalSymmetricalCombatPredict(model, vectorizedGrids);
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

function runtimeCombatTeacherGameSeed(seed, stageIndex, game) {
  return seed + stageIndex * 997 + game;
}

function collectRuntimeCombatTeacherGame(seed, stageIndex, game) {
  const examples = [];
  const collectPredict = function collectPredict(_modelIdentifier, vectorizedGrids) {
    const predictions = [];
    for (const vectorizedGrid of vectorizedGrids) {
      const example = runtimeCombatTeacherLabel(vectorizedGrid);
      examples.push({
        board: example.board,
        globalValue: example.globalValue,
        label: example.label,
        policy: oneHotPolicy(actionIndexFromProjectedBoard(example.board))
      });
      predictions.push([example.label]);
    }
    return predictions;
  };
  const gameSeed = runtimeCombatTeacherGameSeed(seed, stageIndex, game);
  const result = runGame({
    mapName: 'tiny-duel',
    playerA: 'AIPlayer',
    playerB: 'SimpleAiPlayer',
    seed: gameSeed,
    roundLimit: 80,
    actionLimit: 12,
    commandLimit: 60,
    predictFunction: collectPredict,
    modelIdentifier: {
      teacher: 'runtime-combat-curriculum',
      seed,
      stageIndex
    },
    inferenceSource: 'runtime combat teacher labels for model training'
  });
  return {
    game,
    seed: gameSeed,
    winnerSide: result.winnerSide,
    winner: result.winner,
    roundCount: result.roundCount,
    inference: result.inference,
    examples
  };
}

class RuntimeTeacherWorkerPool {
  constructor(workerCount) {
    this.workerCount = Math.max(1, workerCount || 1);
    this.nextJobId = 1;
    this.nextWorkerIndex = 0;
    this.pending = new Map();
    this.workers = [];
    if (this.workerCount <= 1) {
      return;
    }
    for (let index = 0; index < this.workerCount; index += 1) {
      const worker = new Worker(__filename);
      worker.on('message', (message) => this.handleMessage(message));
      worker.on('error', (error) => this.handleWorkerFailure(worker, error));
      worker.on('exit', (code) => {
        if (code !== 0) {
          this.handleWorkerFailure(worker, new Error(`runtime teacher worker exited with code ${code}`));
        }
      });
      this.workers.push(worker);
    }
  }

  handleMessage(message) {
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error));
    } else {
      pending.resolve(message.result);
    }
  }

  handleWorkerFailure(worker, error) {
    for (const [id, pending] of this.pending.entries()) {
      if (pending.worker === worker) {
        this.pending.delete(id);
        pending.reject(error);
      }
    }
  }

  runRuntimeTeacherGame(job) {
    if (this.workerCount <= 1) {
      return Promise.resolve(collectRuntimeCombatTeacherGame(
        job.seed,
        job.stageIndex,
        job.game
      ));
    }
    const worker = this.workers[this.nextWorkerIndex % this.workers.length];
    this.nextWorkerIndex += 1;
    const id = this.nextJobId;
    this.nextJobId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, worker });
      worker.postMessage({
        id,
        type: 'runtime-teacher-game',
        job
      });
    });
  }

  async close() {
    await Promise.all(this.workers.map((worker) => worker.terminate()));
    this.workers = [];
  }
}

function batchFromRuntimeTeacherGameResults(gameResults) {
  const boardValues = [];
  const globalValues = [];
  const labels = [];
  const policies = [];
  for (const result of gameResults.slice().sort((a, b) => a.game - b.game)) {
    for (const example of result.examples) {
      for (let index = 0; index < example.board.length; index += 1) {
        boardValues.push(example.board[index]);
      }
      globalValues.push(example.globalValue);
      labels.push(example.label);
      policies.push(example.policy);
    }
  }
  const sampleCount = labels.length;
  if (!sampleCount) {
    return null;
  }
  return {
    board: tf.tensor4d(boardValues, [sampleCount, 3, 3, 21]),
    global: tf.tensor2d(globalValues, [sampleCount, 1]),
    policy: tf.tensor2d(policies, [sampleCount, DEFAULT_ACTION_SPACE_SIZE]),
    labels: tf.tensor2d(labels, [sampleCount, 1]),
    gameResults
  };
}

async function collectRuntimeCombatTeacherGames(seed, stageIndex, workerPool) {
  const jobs = [];
  for (let game = 1; game <= 2; game += 1) {
    jobs.push({ seed, stageIndex, game });
  }
  if (workerPool) {
    return Promise.all(jobs.map((job) => workerPool.runRuntimeTeacherGame(job)));
  }
  return jobs.map((job) => collectRuntimeCombatTeacherGame(
    job.seed,
    job.stageIndex,
    job.game
  ));
}

async function makeRuntimeCombatTeacherBatch(seed, stageIndex, workerPool) {
  const gameResults = await collectRuntimeCombatTeacherGames(seed, stageIndex, workerPool);
  return batchFromRuntimeTeacherGameResults(gameResults);
}

if (!isMainThread && parentPort) {
  parentPort.on('message', (message) => {
    if (!message || message.type !== 'runtime-teacher-game') {
      return;
    }
    try {
      parentPort.postMessage({
        id: message.id,
        result: collectRuntimeCombatTeacherGame(
          message.job.seed,
          message.job.stageIndex,
          message.job.game
        )
      });
    } catch (error) {
      parentPort.postMessage({
        id: message.id,
        error: error.stack || error.message
      });
    }
  });
} else {
  // Main-thread execution continues below.
}

function assertRuntimeTeacherGameResultsEqual(serialResult, workerResult) {
  const comparable = (result) => ({
    game: result.game,
    seed: result.seed,
    winnerSide: result.winnerSide,
    winner: result.winner,
    roundCount: result.roundCount,
    inference: result.inference,
    examples: result.examples
  });
  const serialJson = JSON.stringify(comparable(serialResult));
  const workerJson = JSON.stringify(comparable(workerResult));
  if (serialJson !== workerJson) {
    fail(`worker runtime teacher result diverged for seed ${serialResult.seed}`);
  }
}

async function verifyRuntimeTeacherWorkerInvariants(seedStart, stageIndex, workerCount) {
  const pool = new RuntimeTeacherWorkerPool(workerCount);
  try {
    const comparisons = [];
    for (let offset = 0; offset < 10; offset += 1) {
      const seed = seedStart + offset;
      comparisons.push(pool.runRuntimeTeacherGame({
        seed,
        stageIndex,
        game: 1
      }).then((workerResult) => {
        const serialResult = collectRuntimeCombatTeacherGame(seed, stageIndex, 1);
        assertRuntimeTeacherGameResultsEqual(serialResult, workerResult);
        return workerResult;
      }));
    }
    return await Promise.all(comparisons);
  } finally {
    await pool.close();
  }
}

async function runtimeTeacherDatasetSignature(seed, stageIndex, workerCount) {
  const pool = new RuntimeTeacherWorkerPool(workerCount);
  try {
    const results = await collectRuntimeCombatTeacherGames(seed, stageIndex, pool);
    const records = [];
    for (const result of results) {
      for (const example of result.examples) {
        records.push(JSON.stringify({
          game: result.game,
          board: example.board,
          globalValue: example.globalValue,
          label: example.label,
          policy: example.policy
        }));
      }
    }
    return records.sort();
  } finally {
    await pool.close();
  }
}

async function workerPoolDispatchProbe(workerCount, jobs) {
  const pool = new RuntimeTeacherWorkerPool(workerCount);
  try {
    const results = await Promise.all(jobs.map((job) => pool.runRuntimeTeacherGame(job)));
    return {
      requestedWorkers: workerCount,
      actualWorkers: pool.workers.length || 1,
      dispatched: jobs.length,
      collected: results.length,
      seeds: results.map((result) => result.seed).sort((a, b) => a - b)
    };
  } finally {
    await pool.close();
  }
}

async function fitRuntimeCombatTeacherBatch(
  model,
  seed,
  stageIndex,
  epochs,
  deterministic,
  workerPool
) {
  const runtimeBatch = await makeRuntimeCombatTeacherBatch(seed, stageIndex, workerPool);
  if (!runtimeBatch) {
    return null;
  }
  try {
    return await model.fit(
      [runtimeBatch.board, runtimeBatch.global],
      modelTargets(runtimeBatch),
      {
        epochs,
        batchSize: 16,
        shuffle: !deterministic,
        verbose: 0
      }
    );
  } finally {
    runtimeBatch.board.dispose();
    runtimeBatch.global.dispose();
    runtimeBatch.policy.dispose();
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

function copyDirectoryAtomically(source, destination) {
  const temporary = `${destination}.tmp-${process.pid}`;
  if (fs.existsSync(temporary)) {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  fs.cpSync(source, temporary, { recursive: true });
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
    fail('incompatible checkpoint model signature: expected board [3,3,21], globals [1], combat policy [128], and combat value [1]');
  }
  try {
    validateAlphaZeroLiteCombatMetadata(metadata.architecture);
  } catch (error) {
    fail(error.message);
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
  const timestamp = nowIso(state, 'checkpoint');
  writeJson(path.join(temporary, 'metadata.json'), {
    modelVersion: MODEL_VERSION,
    modelSignature: MODEL_SIGNATURE,
    architecture: MODEL_ARCHITECTURE_METADATA,
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
      evaluationCadence: options.evaluationCadence,
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

function assertMetricRecordsMatchFile(inMemoryRecords, metricsPath) {
  const fileRecords = metricRecords(metricsPath);
  if (!sameValue(inMemoryRecords, fileRecords)) {
    fail(`in-memory metric records diverged from ${metricsPath}`);
  }
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
  const prediction = model.predict([batch.board, batch.global]);
  const predictionTensor = predictionValueTensor(prediction);
  try {
    const predictions = Array.from(await predictionTensor.data());
    const labels = Array.from(await batch.labels.data());
    let loss = 0;
    for (let index = 0; index < predictions.length; index += 1) {
      loss += Math.pow(predictions[index] - labels[index], 2);
    }
    return loss / predictions.length;
  } finally {
    disposePrediction(prediction);
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
        batch.policy.dispose();
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
      mapName: 'big-open-field',
      playerA: 'AIPlayer',
      playerB: 'SimpleAiPlayer',
      seed,
      roundLimit: 80,
      actionLimit: 3,
      commandLimit: 60,
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
        name: 'big-open-field',
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
    modelAdapter: 'runtime vector grids are ranked by the shared full-vector final combat value adapter outside player code',
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
  if (state.curriculum.currentStageIndex >= CURRICULUM_FINAL_STAGE_INDEX) {
    return {
      currentStageIndex: state.curriculum.currentStageIndex,
      currentStage: state.curriculum.currentStage,
      eligible: false,
      decision: 'hold',
      reason: 'final curriculum stage reached',
      plateauEvidence: plateauState.status === 'plateau',
      learningRateReduction: learningRateAttempt,
      simpleAiPlayerWinrate,
      requiredSimpleAiPlayerWinrate: options.curriculumSimpleWinrateThreshold
    };
  }
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
  if (gateDecision.eligible &&
      state.curriculum.currentStageIndex < CURRICULUM_FINAL_STAGE_INDEX) {
    state.curriculum.currentStageIndex += 1;
    state.curriculum.currentStage = `combat-stage-${state.curriculum.currentStageIndex}`;
    entry.advancedToStage = state.curriculum.currentStage;
    entry.advancedToStageIndex = state.curriculum.currentStageIndex;
  }
  return state.curriculum;
}

function shouldEvaluateTrainingStep(state, cadence) {
  return state.completedGames % cadence === 0 ||
    state.completedGames === state.totalGames;
}

function shouldEvaluateGame(game, totalGames, cadence) {
  return game % cadence === 0 || game === totalGames;
}

async function progressRecord(
  options,
  state,
  metric,
  previousRecords,
  model,
  shouldEvaluateCurriculum = true
) {
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
  const learningRateReduction = curriculumLearningRateAttempt(options);
  const shouldMeasureSimpleAiPlayerWinrate = shouldEvaluateCurriculum && (
    state.totalGames <= 1 ||
    (plateauState.status === 'plateau' &&
      learningRateReduction.attempted &&
      !learningRateReduction.improved)
  );
  const simpleAiPlayerWinrate = shouldMeasureSimpleAiPlayerWinrate
    ? await curriculumSimpleAiWinrate(options, state, model)
    : {
      value: null,
      evaluated: false,
      games: 0,
      source: 'deferred-until-curriculum-gate-can-advance',
      reason: shouldEvaluateCurriculum
        ? 'plateau and learning-rate evidence are required before running the measured SimpleAiPlayer benchmark'
        : 'deferred until the configured evaluation cadence'
    };
  const nextStageEligibility = curriculumGateDecision(
    state,
    plateauState,
    simpleAiPlayerWinrate,
    learningRateReduction,
    options
  );
  const curriculum = shouldEvaluateCurriculum
    ? updateCurriculumState(state, nextStageEligibility)
    : state.curriculum;
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
      curriculumSimpleWinrateThreshold: options.curriculumSimpleWinrateThreshold,
      evaluationCadence: options.evaluationCadence,
      workers: options.workers,
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

function persistRunMetadata(options, state, paths, status, errorMessage, records) {
  writeJson(paths.statePath, state);
  writeJson(paths.metricsSummaryPath, {
    runId: options.runId,
    status,
    updatedAt: state.updatedAt,
    ...summarizeMetrics(records || metricRecords(paths.metricsPath))
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
  fs.mkdirSync(path.dirname(finalDir), { recursive: true });
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.mkdirSync(path.dirname(metricsPath), { recursive: true });
  fs.mkdirSync(path.dirname(progressPath), { recursive: true });

  if (options.evaluateLatest) {
    const checkpoint = readLatestCheckpoint(options.storageDir, options.runId);
    const evaluationModel = await tf.loadLayersModel(
      `file://${path.join(checkpoint.path, 'model.json')}`
    );
    const batch = makeBatch(checkpoint.metadata.seed, checkpoint.metadata.trainingStep + 1);
    const prediction = evaluationModel.predict([batch.board, batch.global]);
    const valuePrediction = predictionValueTensor(prediction);
    const values = await valuePrediction.data();
    console.log(JSON.stringify({
      runId: options.runId,
      checkpoint: path.relative(options.storageDir, checkpoint.path),
      trainingStep: checkpoint.metadata.trainingStep,
      modelVersion: checkpoint.metadata.modelVersion,
      predictionCount: values.length
    }));
    disposePrediction(prediction);
    batch.board.dispose();
    batch.global.dispose();
    batch.policy.dispose();
    batch.labels.dispose();
    evaluationModel.dispose();
    return;
  }

  let state;
  let model;
  let gameMetricRecords = [];
  if (options.resume) {
    const checkpoint = readLatestCheckpoint(options.storageDir, options.runId);
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const manifest = fs.existsSync(manifestPath)
      ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      : null;
    validateCheckpointMetadata(checkpoint, state, manifest);
    gameMetricRecords = metricRecords(metricsPath);
    const latestMetricGame = gameMetricRecords.length
      ? gameMetricRecords[gameMetricRecords.length - 1].game
      : 0;
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
    options.evaluationCadence =
      checkpoint.metadata.trainingConfiguration.evaluationCadence ||
      options.evaluationCadence;
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
      timestamp: nowIso(state, 'resume')
    };
    state.resumeEvents = (state.resumeEvents || []).concat(resumeEvent);
    state.status = 'running';
    state.updatedAt = resumeEvent.timestamp;
    appendJsonLine(metricsPath, {
      type: 'resume',
      runId: options.runId,
      ...resumeEvent
    });
    persistRunMetadata(options, state, paths, 'running', null, gameMetricRecords);
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
      deterministicTraining: options.evaluationCadence === 1
    };
    state.startedAt = nowIso(state, 'started');
    state.updatedAt = nowIso(state, 'updated');
    model = createModel(deterministicTrainingMode(options, state) ? state.seed : undefined);
    persistRunMetadata(options, state, paths, 'running', null, gameMetricRecords);
  }

  try {
    compileModel(model);
    let runtimeTeacherWorkerPool = null;
    let runtimeBatchPrefetch = null;
    const scheduleRuntimeBatchPrefetch = (afterCompletedGame) => {
      if (options.workers <= 1 || runtimeBatchPrefetch) {
        return;
      }
      for (let candidateGame = afterCompletedGame + 1;
        candidateGame <= state.totalGames;
        candidateGame += 1) {
        if (!shouldEvaluateGame(
          candidateGame,
          state.totalGames,
          options.evaluationCadence
        )) {
          continue;
        }
        const promise = makeRuntimeCombatTeacherBatch(
          state.seed + candidateGame * 1543,
          state.curriculum.currentStageIndex,
          runtimeTeacherWorkerPool
        );
        promise.catch(() => {});
        runtimeBatchPrefetch = {
          game: candidateGame,
          stageIndex: state.curriculum.currentStageIndex,
          promise
        };
        return;
      }
    };
    if (!options.resume && state.completedGames === 0) {
      const smokeSizedRun = state.totalGames <= 1 && state.epochs <= 1;
      const pretrainPasses = smokeSizedRun ? 1 : 1;
      const pretrainEpochs = smokeSizedRun ? 1 : 3;
      for (let pretrain = 0; pretrain < pretrainPasses; pretrain += 1) {
        await fitRuntimeCombatTeacherBatch(
          model,
          state.seed + 50000 + pretrain * 173,
          state.curriculum.currentStageIndex,
          pretrainEpochs,
          deterministicTrainingMode(options, state),
          null
        );
      }
    }
    runtimeTeacherWorkerPool = new RuntimeTeacherWorkerPool(options.workers);
    scheduleRuntimeBatchPrefetch(state.completedGames);
    try {
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
          const smokeSizedRun = state.totalGames <= 1 && state.epochs <= 1;
          const shouldEvaluateGameNow = shouldEvaluateGame(
            game,
            state.totalGames,
            options.evaluationCadence
          );
          const syntheticEpochs = smokeSizedRun
            ? 1
            : Math.max(state.epochs, cadenceSpeedMode(options) ? 1 : 8);
          const runtimeEpochs = smokeSizedRun
            ? 1
            : (options.workers > 1 && cadenceSpeedMode(options)
              ? state.epochs
              : Math.max(state.epochs, 2));
          const shouldFitRuntimeTeacher =
            !cadenceSpeedMode(options) || shouldEvaluateGameNow;
          let runtimeBatchPromise = null;
          if (shouldFitRuntimeTeacher && options.workers > 1) {
            if (runtimeBatchPrefetch &&
                runtimeBatchPrefetch.game === game &&
                runtimeBatchPrefetch.stageIndex === state.curriculum.currentStageIndex) {
              runtimeBatchPromise = runtimeBatchPrefetch.promise;
              runtimeBatchPrefetch = null;
            } else {
              runtimeBatchPromise = makeRuntimeCombatTeacherBatch(
                state.seed + game * 1543,
                state.curriculum.currentStageIndex,
                runtimeTeacherWorkerPool
              );
            }
          }
          history = await model.fit(
            [batch.board, batch.global],
            modelTargets(batch),
            {
              epochs: syntheticEpochs,
              batchSize: 16,
              shuffle: !deterministicTrainingMode(options, state),
              verbose: 0
            }
          );
          if (!cadenceSpeedMode(options) || shouldEvaluateGameNow) {
            if (runtimeBatchPromise) {
              const runtimeBatch = await runtimeBatchPromise;
              if (runtimeBatch) {
                try {
                  history = await model.fit(
                    [runtimeBatch.board, runtimeBatch.global],
                    modelTargets(runtimeBatch),
                    {
                      epochs: runtimeEpochs,
                      batchSize: 16,
                      shuffle: !deterministicTrainingMode(options, state),
                      verbose: 0
                    }
                  );
                } finally {
                  runtimeBatch.board.dispose();
                  runtimeBatch.global.dispose();
                  runtimeBatch.policy.dispose();
                  runtimeBatch.labels.dispose();
                }
              }
            } else {
              history = await fitRuntimeCombatTeacherBatch(
                model,
                state.seed + game * 1543,
                state.curriculum.currentStageIndex,
                runtimeEpochs,
                deterministicTrainingMode(options, state),
                runtimeTeacherWorkerPool
              ) || history;
            }
          }
          predictionTensor = model.predict([batch.board, batch.global]);
          prediction = Array.from(await predictionValueTensor(predictionTensor).data());
        } finally {
          if (predictionTensor) {
            disposePrediction(predictionTensor);
          }
          batch.board.dispose();
          batch.global.dispose();
          batch.policy.dispose();
          batch.labels.dispose();
        }
        const labelScore = labels.reduce((total, value) => total + value, 0);
        const predictionScore = prediction.reduce((total, value) => total + value, 0);
        const winner = labelScore === 0
          ? 'draw'
          : (predictionScore >= 0 ? 'red' : 'blue');
        const episodeLength = labels.length * state.epochs;
        state.completedGames = game;
        state.updatedAt = nowIso(state, 'game');
        state.status = state.completedGames === state.totalGames ? 'complete' : 'running';
        if (game % options.checkpointInterval === 0 || game === state.totalGames) {
          await saveCheckpoint(model, options, state, checkpointDir, 'interval');
        }
        const previousRecords = task104LegacyMetricLoopMode()
          ? metricRecords(metricsPath)
          : gameMetricRecords.slice();
        const loss = modelLoss(history);
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
          durationMs: deterministicTrainingMode(options, state) ? 0 : Date.now() - started,
          timestamp: state.updatedAt
        };
        const shouldEvaluate = shouldEvaluateTrainingStep(state, options.evaluationCadence);
        metric.oldVsNewEvaluation = shouldEvaluate
          ? await evaluateNewVsOld(
            options,
            state,
            model,
            readOldEpochPointer(options)
          )
          : {
            evaluated: false,
            reason: 'deferred until the configured evaluation cadence',
            games: 0,
            oldCheckpoint: null,
            newCheckpoint: null,
            newWins: 0,
            oldWins: 0,
            draws: 0,
            winrate: null
          };
        const summary = summarizeMetrics(previousRecords.concat(metric));
        metric.winRates = summary.winRates;
        metric.benchmarkSummary = {
          ...summary.benchmarkSummary,
          oldVsNewWinrate: metric.oldVsNewEvaluation
        };
        appendJsonLine(metricsPath, metric);
        if (!task104LegacyMetricLoopMode()) {
          gameMetricRecords.push(metric);
          assertMetricRecordsMatchFile(gameMetricRecords, metricsPath);
        } else {
          gameMetricRecords = metricRecords(metricsPath);
        }
        appendJsonLine(
          progressPath,
          await progressRecord(options, state, metric, previousRecords, model, shouldEvaluate)
        );
        scheduleRuntimeBatchPrefetch(state.completedGames);
        persistRunMetadata(options, state, paths, state.status, null, gameMetricRecords);
        console.log(`Completed game ${game}/${state.totalGames}`);
        if (options.failAfterGame === game) {
          fail(`forced failure after game ${game}`);
        }
      }
    } finally {
      if (runtimeTeacherWorkerPool) {
        await runtimeTeacherWorkerPool.close();
      }
    }

    if (state.completedGames === state.totalGames) {
      state.status = 'complete';
      state.completedAt = nowIso(state, 'complete');
      state.updatedAt = state.completedAt;
      const latestPointer = readLatestCheckpointPointer(options);
      if (options.workers > 1 &&
          latestPointer &&
          latestPointer.trainingStep === state.completedGames) {
        copyDirectoryAtomically(path.join(options.storageDir, latestPointer.path), finalDir);
      } else {
        await saveModelAtomically(model, finalDir);
      }
      persistRunMetadata(options, state, paths, 'complete', null, gameMetricRecords);
      console.log(`Training complete. Final model: ${finalDir}`);
    } else {
      state.status = 'paused';
      state.updatedAt = nowIso(state, 'paused');
      const pointerPath = latestCheckpointPath(options.storageDir, options.runId);
      const latest = fs.existsSync(pointerPath)
        ? readLatestCheckpoint(options.storageDir, options.runId)
        : null;
      if (!latest || latest.metadata.trainingStep !== state.completedGames) {
        await saveCheckpoint(model, options, state, checkpointDir, 'pause');
      }
      persistRunMetadata(options, state, paths, 'paused', null, gameMetricRecords);
      console.log(`Training paused at ${state.completedGames}/${state.totalGames}; resume with ./train.sh --resume`);
    }
  } catch (error) {
    state.status = 'failed';
    state.updatedAt = nowIso(state, 'failed');
    appendJsonLine(metricsPath, {
      type: 'run_failure',
      runId: options.runId,
      gamesPlayed: state.completedGames,
      message: error.message,
      timestamp: state.updatedAt
    });
    persistRunMetadata(options, state, paths, 'failed', error.message, gameMetricRecords);
    throw error;
  } finally {
    model.dispose();
  }
}

if (require.main === module && isMainThread) {
  main().catch((error) => {
    console.error(`cloud training error: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  evaluateCurriculumSimpleAiWinrate,
  collectRuntimeCombatTeacherGame,
  curriculumGateDecision,
  initialCurriculumState,
  runtimeTeacherDatasetSignature,
  verifyRuntimeTeacherWorkerInvariants,
  workerPoolDispatchProbe,
  updateCurriculumState
};
