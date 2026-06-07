const { parseArgs, run } = require('./economy-training');

run(parseArgs(process.argv.slice(2))).then((result) => {
  console.log(JSON.stringify({
    status: 'complete',
    games: result.metrics.length,
    candidate: result.candidate,
    snapshot: result.snapshotPath
  }));
}).catch((error) => {
  console.error(`economy training error: ${error.message}`);
  process.exitCode = 1;
});
