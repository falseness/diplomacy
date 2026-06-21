// todo: поправь
let maxGridX = 10
let maxGridY = 10


// Residual Block Function
function residualBlock(inputTensor) {
  const conv1 = tf.layers.conv2d({
    filters: 16,
    kernelSize: 3,
    padding: 'same',
    useBias: false
  }).apply(inputTensor);
  const bn1 = tf.layers.batchNormalization().apply(conv1);
  const relu1 = tf.layers.activation({ activation: 'relu' }).apply(bn1);

  const conv2 = tf.layers.conv2d({
    filters: 16,
    kernelSize: 3,
    padding: 'same',
    useBias: false
  }).apply(relu1);
  const bn2 = tf.layers.batchNormalization().apply(conv2);

  const add = tf.layers.add().apply([inputTensor, bn2]);
  return tf.layers.activation({ activation: 'relu' }).apply(add);
}

function getCellVectorSize() {
  return typeof CELL_VECTOR_SIZE == 'undefined' ? 12 : CELL_VECTOR_SIZE
}

function getModelCellVectorSize(model) {
  return model.inputs[0].shape[3]
}

function assertModelCellVectorCompatible(model) {
  const modelChannels = getModelCellVectorSize(model)
  const vectorChannels = getCellVectorSize()
  if (modelChannels != vectorChannels) {
    throw new Error('Model cell vector channel mismatch: checkpoint expects ' +
      modelChannels + ' channels, current vectorizer emits ' + vectorChannels +
      '. Reinitialize or retrain the model for the current vector shape.')
  }
}

function getAiEconomyObjectiveCounts(player, playerIndex, distanceFn) {
  let counts = {
    liveOpponentCount: 0,
    neutralTownCount: 0,
    hadNeutralTownsAtStart: false,
    goldmineCount: 0,
    lakeCount: 0,
    mountainCount: 0,
    nearestEnemyThreatDistance: Infinity
  }
  if (typeof players != 'undefined' && players[0]) {
    counts.hadNeutralTownsAtStart =
      player.hadNeutralTownsAtStart === true || players[0].towns.length > 0
    for (let townIndex = 0; townIndex < players[0].towns.length; ++townIndex) {
      if (!players[0].towns[townIndex].killed) {
        ++counts.neutralTownCount
      }
    }
    for (let opponentIndex = 1; opponentIndex < players.length; ++opponentIndex) {
      let opponent = players[opponentIndex]
      if (opponentIndex == playerIndex || !opponent || opponent.isNeutral ||
          opponent.isLost) {
        continue
      }
      ++counts.liveOpponentCount
      for (let unitIndex = 0; unitIndex < opponent.units.length; ++unitIndex) {
        let enemy = opponent.units[unitIndex]
        if (enemy.killed) {
          continue
        }
        for (let townIndex = 0; townIndex < player.towns.length; ++townIndex) {
          if (!player.towns[townIndex].killed) {
            counts.nearestEnemyThreatDistance = Math.min(
              counts.nearestEnemyThreatDistance,
              distanceFn(enemy.coord, player.towns[townIndex].coord))
          }
        }
      }
    }
  }
  if (typeof grid != 'undefined' && grid.arr &&
      player.hadNeutralTownsAtStart === undefined) {
    for (let x = 0; x < grid.arr.length; ++x) {
      for (let y = 0; y < grid.arr[x].length; ++y) {
        let building = grid.arr[x][y].building
        if (building && building.notEmpty && building.notEmpty() &&
            building.name == 'town' && building.playerColor == -1) {
          counts.hadNeutralTownsAtStart = true
        }
      }
    }
  }
  if (typeof goldmines != 'undefined') {
    for (let i = 0; i < goldmines.length; ++i) {
      if (!goldmines[i].killed) {
        ++counts.goldmineCount
      }
    }
  }
  if (typeof nature != 'undefined') {
    for (let i = 0; i < nature.length; ++i) {
      if (nature[i].killed) {
        continue
      }
      if (nature[i].name == 'lake') {
        ++counts.lakeCount
      }
      else if (nature[i].name == 'mountain') {
        ++counts.mountainCount
      }
    }
  }
  return counts
}

function getAiEconomyObjectivePolicy(player, playerIndex, distanceFn) {
  let counts = getAiEconomyObjectiveCounts(player, playerIndex, distanceFn)
  let directDuel = counts.liveOpponentCount == 1 &&
    !counts.hadNeutralTownsAtStart && counts.goldmineCount == 0
  let resourceObstacleField = counts.goldmineCount >= 8 &&
    counts.lakeCount > 0 && counts.mountainCount > 0
  let balancedResourceObstacleField = resourceObstacleField &&
    Math.abs(counts.lakeCount - counts.mountainCount) <= 1
  let cleanDirectDuel = directDuel &&
    counts.lakeCount == 0 && counts.mountainCount == 0
  return {
    enemyTownTargetScore: directDuel ?
      AI_ECONOMY_THREAT_TARGET_SCORE : AI_ECONOMY_TOWN_TARGET_SCORE,
    useTargetPriorityMovement: directDuel || balancedResourceObstacleField,
    holdTownThreatDistance: cleanDirectDuel || resourceObstacleField ? 6 : null
  }
}

function shouldHoldTownForAiEconomyObjective(player, unit, playerIndex, distanceFn) {
  let policy = getAiEconomyObjectivePolicy(player, playerIndex, distanceFn)
  if (!Number.isFinite(policy.holdTownThreatDistance)) {
    return false
  }
  let cell = grid.getCell(unit.coord)
  if (!cell || !cell.building || !cell.building.notEmpty ||
      !cell.building.notEmpty() || cell.building.name != 'town' ||
      cell.building.playerColor != playerIndex) {
    return false
  }
  if (typeof players == 'undefined') {
    return false
  }
  for (let opponentIndex = 1; opponentIndex < players.length; ++opponentIndex) {
    let opponent = players[opponentIndex]
    if (opponentIndex == playerIndex || !opponent || opponent.isNeutral ||
        opponent.isLost) {
      continue
    }
    for (let unitIndex = 0; unitIndex < opponent.units.length; ++unitIndex) {
      let enemy = opponent.units[unitIndex]
      if (!enemy.killed &&
          distanceFn(enemy.coord, unit.coord) <= policy.holdTownThreatDistance) {
        return true
      }
    }
  }
  return false
}

function createAlphaZeroModel(boardHeight, boardWidth, numChannels = getCellVectorSize()) {
  
  const globalVariablesInput = tf.input({ shape: [1], name: 'global_variables' });

  const input = tf.input({ shape: [boardHeight, boardWidth, numChannels] });



  // Initial Conv Layer
  let x = tf.layers.conv2d({
    filters: 16,
    kernelSize: 3,
    padding: 'same',
    activation: 'relu'
  }).apply(input);

  // Residual Block (repeat N times)
  

  for (let i = 0; i < 5; i++) {
    x = residualBlock(x);
  }

  const valueConv = tf.layers.conv2d({
    filters: 32,
    kernelSize: 1,
    padding: 'same',
    useBias: false
  }).apply(x);
  const valueBN = tf.layers.batchNormalization().apply(valueConv);


  const valueRelu = tf.layers.activation({ activation: 'relu' }).apply(valueBN);
  
  const currentShape = valueRelu.shape;
  console.log('shape', currentShape)
  const height = currentShape[1]; // Height after convolution
  const width = currentShape[2];  // Width after convolution
  const channels = currentShape[3]; // Number of filters (channels) after convolution
  
  const valueFlat = tf.layers.globalMaxPooling2d({inputShape: [height, width, channels]}).apply(valueRelu);

  let merged = tf.layers.concatenate().apply([valueFlat, globalVariablesInput])

  const valueDense = tf.layers.dense({
    units: 32,
    activation: 'relu'
  }).apply(merged);
  const valueOutput = tf.layers.dense({
    units: 1,
    activation: 'tanh',
    name: 'value_output'
  }).apply(valueDense);


  // Policy Head
  // const policyConv = tf.layers.conv2d({
  //   filters: 2,
  //   kernelSize: 1,
  //   padding: 'same',
  //   useBias: false
  // }).apply(x);
  // const policyBN = tf.layers.batchNormalization().apply(policyConv);
  // const policyRelu = tf.layers.activation({ activation: 'relu' }).apply(policyBN);

  // Flatten before Dense layers

  // Flatten the output before Dense layers, specifying the shape explicitly
  // model.add(tf.layers.flatten({
  //   inputShape: [height, width, channels],  // Explicitly pass the output shape of previous layer
  // }));
  // tf.layers.reshape({ targetShape: [128] })
  // const policyFlat = tf.layers.globalMaxPooling2d({inputShape: [height, width, channels]}).apply(policyRelu);

  // // const policyOutput = tf.layers.dense({
  // //   units: boardHeight * boardWidth,
  // //   activation: 'softmax',
  // //   name: 'policy_output'
  // // }).apply(policyFlat);
  // const policyOutput = tf.layers.dense({ units: 1, activation: 'sigmoid' }).apply(policyFlat)

  const model = tf.model({
    inputs: [input, globalVariablesInput],
    outputs: valueOutput
  });

  return model;
}



function createModel() {
  const model = tf.sequential();

  // Input layer: Accepts any board size (n, m) with the current cell vector.
  model.add(tf.layers.inputLayer({
    inputShape: [null, null, getCellVectorSize()], // Dynamic n x m board size
  }));

  // First Residual Block
  model.add(residualBlock(32, 3));  // First block with 32 filters and kernel size 3
  model.add(residualBlock(64, 3));  // Second block with 64 filters and kernel size 3
  model.add(residualBlock(128, 3));  // Second block with 64 filters and kernel size 3

  model.add(residualBlock(256, 3));  // Second block with 64 filters and kernel size 3

  // Flatten before Dense layers
  const shapeAfterConv = model.output.shape;
  const height = shapeAfterConv[1]; // Height after convolution
  const width = shapeAfterConv[2];  // Width after convolution
  const channels = shapeAfterConv[3]; // Number of filters (channels) after convolution

  // console.log(height, width, channels)
  // Flatten the output before Dense layers, specifying the shape explicitly
  // model.add(tf.layers.flatten({
  //   inputShape: [height, width, channels],  // Explicitly pass the output shape of previous layer
  // }));
  // tf.layers.reshape({ targetShape: [128] })
  model.add(tf.layers.globalMaxPooling2d({inputShape: [height, width, channels]}));

  // Fully connected layers
  
  model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 32, activation: 'relu' }));

  model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 32, activation: 'relu' }));

  // Output layer: Single value (0-1 score)
  model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));


  return model;
}

// let ai_model = createModel([maxGridX, maxGridY, getCellVectorSize()])
let ai_model = undefined

async function trainModelUnsafe(model, trainX, trainY, epochs=5) {
  console.log('start train')
  return await model.fit(trainX, trainY, {
    epochs: epochs,
    batchSize: 8,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        if (epoch % 10 == 0) {
          console.log('epoch ', epoch, logs)
        }
      }
    },
    shuffle: true,
  });
}


async function trainModel(model, trainXarr, trainYarr, epochs=5) {
  let trainXArrHorizontal = []
  let trainXArrVertical = []
  let trainXArrays = [trainXArrHorizontal, trainXArrVertical]
  let trainYArrays = [[], []]
  for (let i = 0; i < trainXarr.length; ++i) {
    let vectorisedGrid = trainXarr[i][0]
    trainXArrays[0].push(trainXarr[i])
    trainYArrays[0].push(trainYarr[i])
    const squareRotationsCount = 4
    for (let j = 1; j < squareRotationsCount; ++j) {
      vectorisedGrid = rotateRight(vectorisedGrid)
      trainXArrays[j % 2].push([vectorisedGrid, trainXarr[i][1]])
      trainYArrays[j % 2].push(trainYarr[i])
    }
  }
  
  for (let i = 0; i < trainXArrays.length; ++i) {
    let currentLen = trainXArrays[i].length
    for (let j = 0; j < currentLen; ++j) {
      trainXArrays[i].push([reflectByVerticalLine(trainXArrays[i][j][0]), trainXArrays[i][j][1]])
      trainYArrays[i].push(trainYArrays[i][j])
    }
    
    await doTrainModel(model, trainXArrays[i], trainYArrays[i], epochs)
  }
}


async function doTrainModel(model, augmentedTrainXarr, trainYarr, epochs=5) {
  console.log('start train')

  let trainXvectorised = [] 
  for (let i = 0; i < augmentedTrainXarr.length; ++i) {
    trainXvectorised.push(tf.tensor3d(augmentedTrainXarr[i][0]))
  }

  let xGlobalVariables = []
    for (let i = 0; i < augmentedTrainXarr.length; ++i) {
      xGlobalVariables.push(augmentedTrainXarr[i][1])
    }
  let trainX = tf.stack(trainXvectorised)

  let globalX = tf.stack(xGlobalVariables)

  // console.log(JSON.stringify(trainXarr))
  // console.log(JSON.stringify(trainYarr))

  let trainY = tf.tensor1d(trainYarr)

  let result = await model.fit([trainX, globalX], trainY, {
    epochs: epochs,
    batchSize: 256,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        if (epoch % 10 == 0) {
          console.log('epoch ', epoch, logs)
        }
      }
    },
    shuffle: true,
  });

  console.log('train result', result)
  for (let i = 0; i < trainXvectorised.length; ++i) {
    trainXvectorised[i].dispose()
  }
  trainX.dispose()
  globalX.dispose()
  trainY.dispose()

}


// ✅ Model Summary
// ai_model.summary();

/*function predict(tf, vectorizedGrid) {
    
}

function train(vectorizedGrid, result) {
    model.train(vectorizedGrid, )
}*/


let humanCommands = []
// 71
// 126
// 216 last heuristic train
let modelIndex = 750

function getConfiguredAiModelUrl() {
  if (typeof gameSettings != 'undefined' &&
      typeof gameSettings.aiModelUrl == 'string' &&
      gameSettings.aiModelUrl.length > 0) {
    return gameSettings.aiModelUrl
  }
  if (typeof window != 'undefined') {
    if (typeof window.DIPLOMACY_AI_MODEL_URL == 'string' &&
        window.DIPLOMACY_AI_MODEL_URL.length > 0) {
      return window.DIPLOMACY_AI_MODEL_URL
    }
    if (window.location && window.location.search &&
        typeof URLSearchParams != 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const queryModelUrl = params.get('aiModelUrl')
      if (queryModelUrl) {
        return queryModelUrl
      }
    }
  }
  return undefined
}

function getAiModelSource(explicitSource) {
  if (typeof explicitSource == 'string' && explicitSource.length > 0) {
    return explicitSource
  }
  const configuredUrl = getConfiguredAiModelUrl()
  if (configuredUrl) {
    return configuredUrl
  }
  return 'indexeddb://diplomacy_weights' + modelIndex
}

function assertBrowserSafeModelSource(source) {
  if (typeof window == 'undefined') {
    return
  }
  if (source.indexOf('file://') == 0) {
    throw new Error('Browser AI model source must be an HTTP(S), relative, IndexedDB, or localStorage TensorFlow.js URL, not file://')
  }
}

async function loadModel(modelSource) {
  const source = getAiModelSource(modelSource)
  assertBrowserSafeModelSource(source)
  const model = await tf.loadLayersModel(source)
  assertModelCellVectorCompatible(model)
  return model
}

function getPredictionValueTensor(prediction) {
  if (Array.isArray(prediction)) {
    for (let i = 0; i < prediction.length; ++i) {
      let outputName = (prediction[i].name || '').replace(/:\d+$/, '').split('/')[0]
      if (outputName == 'combat_value' || outputName == 'value_output') {
        return prediction[i]
      }
    }
    return prediction[prediction.length - 1]
  }
  return prediction
}

function disposePredictionResult(prediction) {
  if (Array.isArray(prediction)) {
    for (let i = 0; i < prediction.length; ++i) {
      prediction[i].dispose()
    }
  }
  else {
    prediction.dispose()
  }
}

async function saveModel() {
  // console.log('saving in', modelIndex + 1)
  await ai_model.save('downloads://diplomacy_weights' + (modelIndex + 1))
  let result = await ai_model.save('indexeddb://diplomacy_weights' + (modelIndex + 1))
  console.log('save result', modelIndex + 1, result)
  modelIndex += 1
  return result
}

function predict(model, xValidateArr) {
  if (xValidateArr.length == 0) {
    return []
  }
  return tf.tidy(() => {
    const firstBoard = xValidateArr[0][0]
    const boardHeight = firstBoard.length
    const boardWidth = firstBoard[0].length
    const channels = firstBoard[0][0].length
    const batchSize = xValidateArr.length
    const boardValues = new Float32Array(batchSize * boardHeight * boardWidth * channels)
    const globalValues = new Float32Array(batchSize)
    let offset = 0
    for (let batch = 0; batch < batchSize; ++batch) {
      const board = xValidateArr[batch][0]
      if (board.length != boardHeight ||
          board[0].length != boardWidth ||
          board[0][0].length != channels) {
        throw new Error('predict() requires every candidate board to have the same shape')
      }
      for (let x = 0; x < boardHeight; ++x) {
        for (let y = 0; y < boardWidth; ++y) {
          const cell = board[x][y]
          for (let channel = 0; channel < channels; ++channel) {
            boardValues[offset++] = cell[channel]
          }
        }
      }
      globalValues[batch] = xValidateArr[batch][1]
    }
    let tfInput = tf.tensor4d(
      boardValues,
      [batchSize, boardHeight, boardWidth, channels]
    )
    let tfGlobal = tf.tensor2d(globalValues, [batchSize, 1])
    let tf_result = model.predict([tfInput, tfGlobal])
    let result = getPredictionValueTensor(tf_result).arraySync()
    return result
  })
}


function trainModelByHumanData() {
  let xTrain = [] 
  let yTrain = []
  
  for (let i = 0; i < humanCommands.length; ++i) {
    xTrain.push(humanCommands[i])
    yTrain.push(1.0)
  }
  console.log(humanCommands)
  let aiPlayerIndex = 2
  console.log(players[aiPlayerIndex].chosenGrids)


  for (let i = 0; i < players[aiPlayerIndex].chosenGrids.length; ++i) {
    xTrain.push(players[aiPlayerIndex].chosenGrids[i])
    yTrain.push(0.0)
  }
  

  const learningRate = 0.00001
  ai_model.compile({
      optimizer: tf.train.adam(learningRate),
      loss: 'meanSquaredError',
      metrics: ['accuracy'],
  });

  
  trainModel(ai_model, xTrain, yTrain, 300)
  .then(async trainResult => { 
    console.log("trainedModel", trainResult)
    let save_result = await saveModel()
    console.log('saved', (modelIndex + 1), save_result)
    const blob = new Blob([JSON.stringify(xTrain), JSON.stringify(yTrain)],
      { type: 'application/json' });
    saveAs(blob, `data${modelIndex}.json`);
  })
  .catch(err => console.error('Error loading model:', err));
}
