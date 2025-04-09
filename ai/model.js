// todo: поправь
let maxGridX = 10
let maxGridY = 10

function createModel(inputShape) {
  const model = tf.sequential();

  // First Dense layer that adapts to input shape
  model.add(tf.layers.dense({ units: 64, inputShape: inputShape }));
  model.add(tf.layers.batchNormalization());
  model.add(tf.layers.activation({ activation: 'relu' }));

  // Flatten to make it 1D
  model.add(tf.layers.flatten());

  // Another Dense layer
  model.add(tf.layers.dense({
    units: 32,
    activation: 'relu',
  }));

  // Output layer with single value (0 to 1 score prediction)
  model.add(tf.layers.dense({
    units: 1,
    activation: 'sigmoid',
  }));

  // Compile the model
  const learningRate = 0.001
  model.compile({
    optimizer: tf.train.adam(learningRate),
    loss: 'binaryCrossentropy',
    metrics: ['accuracy'],
  });

  return model;
}

let ai_model = createModel([maxGridX, maxGridY, 12])


async function trainModelUnsafe(model, trainX, trainY, epochs=5) {
  console.log('start train')
  return await model.fit(trainX, trainY, {
    epochs: epochs,
    batchSize: 32,
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
    trainXvectorised.push(tf.tensor3d(trainXarr[i]))
  }
  let trainX = tf.stack(trainXvectorised)
  let trainY = tf.tensor1d(trainYarr)
  let result = await model.fit(trainX, trainY, {
    epochs: epochs,
    batchSize: 32,
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
  trainY.dispose()

}


// ✅ Model Summary
ai_model.summary();

/*function predict(tf, vectorizedGrid) {
    
}

function train(vectorizedGrid, result) {
    model.train(vectorizedGrid, )
}*/


let humanCommands = []

let modelIndex = 32

async function loadModel() {
  return await tf.loadLayersModel('indexeddb://diplomacy_weights' + modelIndex)
}

async function saveModel() {
  console.log('saving', modelIndex)
  await ai_model.save('downloads://diplomacy_weights' + (modelIndex + 1))
  return await ai_model.save('indexeddb://diplomacy_weights' + (modelIndex + 1))
}

function predict(model, xValidate) {
  return tf.tidy(() => {
    let tf_result = model.predict(tf.stack(xValidate))
    let result = tf_result.arraySync() 
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
  console.log(players[2].chosenGridsDebug)


  for (let i = 0; i < players[2].chosenGridsDebug.length; ++i) {
    xTrain.push(players[2].chosenGridsDebug[i])
    yTrain.push(0.0)
  }
  

  const learningRate = 0.00001
  ai_model.compile({
      optimizer: tf.train.adam(learningRate),
      loss: 'meanSquaredError',
      metrics: ['accuracy'],
  });
  
  trainModel(ai_model, xTrain, yTrain, 500)
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