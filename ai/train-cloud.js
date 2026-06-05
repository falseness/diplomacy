const { loadAiScripts } = require('./smokeHarness');

const { context, scripts } = loadAiScripts();

const result = new Function(
  'context',
  `return {
    rotated: context.rotateRight([[1, 2], [3, 4]]),
    reflected: context.reflectByVerticalLine([[1, 2], [3, 4]])
  };`
)(context);

const expectedRotation = JSON.stringify([[3, 1], [4, 2]]);
const expectedReflection = JSON.stringify([[2, 1], [4, 3]]);

if (JSON.stringify(result.rotated) !== expectedRotation) {
  throw new Error('rotateRight smoke check failed');
}

if (JSON.stringify(result.reflected) !== expectedReflection) {
  throw new Error('reflectByVerticalLine smoke check failed');
}

console.log(`AI training smoke loaded ${scripts.length} AI scripts and validated vector helpers`);
