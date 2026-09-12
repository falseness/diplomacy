// Diagnostic only: complete ordered batches, never individual positions.
const assert = require('node:assert/strict');
const tf = require('@tensorflow/tfjs-node');

// Callers must clear after any weight update, and close before disposing model.
// The boundary replay creates a fresh cache for each fixed-weight game.
function batchCache(model, limitBytes = 16 * 1024 * 1024) {
  assert(Number.isSafeInteger(limitBytes) && limitBytes >= 0);
  const entries = new Map();
  const stats = { hits: 0, misses: 0, bytes: 0, peakBytes: 0, evictions: 0 };
  let closed = false;
  function clear() { entries.clear(); stats.bytes = 0; }
  return {
    stats, clear,
    close() { clear(); closed = true; },
    predict(inputs) {
      assert(!closed, 'cache is closed');
      assert(inputs.length === 2 && inputs[0].shape[0] === inputs[1].shape[0]);
      return tf.tidy(() => {
        const outputs = [];
        for (let start = 0; start < inputs[0].shape[0]; start += 32) {
          const count = Math.min(32, inputs[0].shape[0] - start);
          const batch = tf.tidy(() => {
            const sliced = inputs.map(input => input.slice(
              [start, ...input.shape.slice(1).map(() => 0)], [count, ...input.shape.slice(1)]));
            // Full bytes, dtype and shape prevent hash collisions or tail reuse.
            const key = sliced.map(input => {
              assert.equal(input.dtype, 'float32');
              const data = input.dataSync();
              return JSON.stringify(input.shape) + ':' + Buffer.from(
                data.buffer, data.byteOffset, data.byteLength).toString('base64');
            }).join('|');
            const hit = entries.get(key);
            if (hit) {
              stats.hits += 1;
              entries.delete(key);
              entries.set(key, hit);
              return hit.outputs.map(output => tf.tensor(output.data, output.shape, 'float32'));
            }
            stats.misses += 1;
            const result = model.predict(sliced, { batchSize: 32 });
            assert(Array.isArray(result) && result.length === 2, 'both outputs required');
            const stored = result.map(output => {
              assert.equal(output.dtype, 'float32');
              return { shape: [...output.shape], data: Float32Array.from(output.dataSync()) };
            });
            // Conservatively account UTF-16 keys, arrays and entry overhead.
            const bytes = key.length * 2 + stored.reduce((sum, output) =>
              sum + output.data.byteLength + output.shape.length * 8, 0) + 1024;
            if (bytes <= limitBytes) {
              while (stats.bytes + bytes > limitBytes) {
                const oldest = entries.keys().next().value;
                stats.bytes -= entries.get(oldest).bytes;
                entries.delete(oldest);
                stats.evictions += 1;
              }
              entries.set(key, { outputs: stored, bytes });
              stats.bytes += bytes;
              stats.peakBytes = Math.max(stats.peakBytes, stats.bytes);
            }
            return result;
          });
          batch.forEach((output, index) => (outputs[index] ||= []).push(output));
        }
        return outputs.map(parts => tf.concat(parts, 0));
      });
    }
  };
}

module.exports = { batchCache };
