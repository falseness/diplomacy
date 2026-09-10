const Module = require('module');
const { parentPort } = require('worker_threads');

// A dependency importing either TensorFlow implementation fails this startup check.
const load = Module._load;
Module._load = function(request, ...args) {
  if (request.startsWith('@tensorflow/')) {
    throw new Error('data-generation worker imported ' + request);
  }
  return load.call(this, request, ...args);
};
require('../../cloud-train-runner');
parentPort.postMessage({ tensorflowImports: 0 });
