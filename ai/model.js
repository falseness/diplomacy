// todo: поправь
let maxGridX = 10
let maxGridY = 10

function createModel(inputShape) {
  const model = tf.sequential();

  // First Dense layer that adapts to input shape
  model.add(tf.layers.dense({
    units: 64,
    activation: 'relu',
    inputShape: inputShape, // Dynamically assigned input shape
  }));

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