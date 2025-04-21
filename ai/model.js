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

function createAlphaZeroModel(boardHeight, boardWidth, numChannels = 12) {
  
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

  // Input layer: Accepts any board size (n, m) with 12 channels
  model.add(tf.layers.inputLayer({
    inputShape: [null, null, 12], // Dynamic n x m board size
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

// let ai_model = createModel([maxGridX, maxGridY, 12])
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
  console.log('start train')
  let trainXvectorised = [] 
  for (let i = 0; i < trainXarr.length; ++i) {
    trainXvectorised.push(tf.tensor3d(trainXarr[i][0]))
  }

  let xGlobalVariables = []
    for (let i = 0; i < trainXarr.length; ++i) {
      xGlobalVariables.push(trainXarr[i][1])
    }
  let trainX = tf.stack(trainXvectorised)

  let globalX = tf.stack(xGlobalVariables)

  // console.log(JSON.stringify(trainXarr))
  // console.log(JSON.stringify(trainYarr))

  let trainY = tf.tensor1d(trainYarr)

  let result = await model.fit([trainX, globalX], trainY, {
    epochs: epochs,
    batchSize: 16,
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
let modelIndex = 500

async function loadModel() {
  return await tf.loadLayersModel('indexeddb://diplomacy_weights' + modelIndex)
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
  return tf.tidy(() => {
    let xValidate = []
    for (let i = 0; i < xValidateArr.length; ++i) {
      xValidate.push(tf.tensor3d(xValidateArr[i][0]))
    }
    let xGlobalVariables = []
    for (let i = 0; i < xValidateArr.length; ++i) {
      xGlobalVariables.push(xValidateArr[i][1])
    }
    let tfInput = tf.stack(xValidate)
    let tfGlobal = tf.stack(xGlobalVariables)
    let tf_result = model.predict([tfInput, tfGlobal])
    let result = tf_result.arraySync() 
    tfInput.dispose()
    tfGlobal.dispose()
    tf_result.dispose()
    for (let i = 0; i < xValidate.length; ++i) {
      xValidate[i].dispose()
    }
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