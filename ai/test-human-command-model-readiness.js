// Same TASK-103 repro inputs now require successful human command completion.
// Uses actual browser clicks and asserts the desired behavior, not the defect.
require('./test-human-command-model-browser').run({regression:true})
  .catch(error=>{console.error(error);process.exitCode=1;});
