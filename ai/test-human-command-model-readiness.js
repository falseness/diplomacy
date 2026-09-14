// Intentionally red until the human-command/model lifecycle defect is fixed.
// Uses actual browser clicks and asserts the desired behavior, not the defect.
require('./test-human-command-model-browser').run({regression:true})
  .catch(error=>{console.error(error);process.exitCode=1;});
