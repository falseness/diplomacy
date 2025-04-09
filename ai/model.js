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

async function predict(model, inputData) {
  const prediction = model.predict(inputData);
  return prediction;
}


let ai_model = createModel([maxGridX, maxGridY, 12])


async function trainModel(model, trainX, trainY, epochs=5) {
  console.log('start train')
  return await model.fit(trainX, trainY, {
    epochs: epochs,
    batchSize: 32,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        console.log('epoch ', epoch, logs)
      }
    },
    shuffle: true,
  });
}


// ✅ Model Summary
ai_model.summary();

/*function predict(tf, vectorizedGrid) {
    
}

function train(vectorizedGrid, result) {
    model.train(vectorizedGrid, )
}*/


let humanCommands = []

let modelIndex = 19

async function loadModel() {
  return await tf.loadLayersModel('indexeddb://diplomacy_weights' + modelIndex)
}

async function saveModel() {
  return await ai_model.save('indexeddb://diplomacy_weights' + (modelIndex + 1))
}


function trainModelByHumanData() {
  let xTrain = [] 
  let yTrain = []
  
  for (let i = 0; i < humanCommands.length; ++i) {
    xTrain.push(humanCommands[i])
    yTrain.push(1.0)
  }
  console.log(humanCommands)
  console.log(players[2].chosenGrids)


  for (let i = 0; i < players[2].chosenGrids.length; ++i) {
    xTrain.push(players[2].chosenGrids[i])
    yTrain.push(0.0)
  }
  

  const learningRate = 0.00001
  ai_model.compile({
      optimizer: tf.train.adam(learningRate),
      loss: 'meanSquaredError',
      metrics: ['accuracy'],
  });

  trainModel(ai_model, tf.stack(xTrain), tf.tensor1d(yTrain), 1000)
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