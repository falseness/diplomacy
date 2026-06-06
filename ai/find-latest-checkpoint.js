const fs = require('fs');
const path = require('path');

function fail(message) {
  console.error(message);
  process.exit(1);
}

const storageDir = path.resolve(process.argv[2] || '');
const mode = process.argv[3] || 'resume';
const checkpointsDir = path.join(storageDir, 'checkpoints');

if (!storageDir || !['resume', 'evaluate'].includes(mode)) {
  fail('usage: node ai/find-latest-checkpoint.js STORAGE_DIR resume|evaluate');
}
if (!fs.existsSync(checkpointsDir)) {
  fail(`no checkpoints directory found under ${storageDir}`);
}

const candidates = [];
for (const entry of fs.readdirSync(checkpointsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }
  const pointerPath = path.join(checkpointsDir, entry.name, 'latest.json');
  if (!fs.existsSync(pointerPath)) {
    continue;
  }
  try {
    const pointer = JSON.parse(fs.readFileSync(pointerPath, 'utf8'));
    const checkpointPath = path.resolve(storageDir, pointer.path);
    const modelPath = path.join(checkpointPath, 'model.json');
    const metadataPath = path.join(checkpointPath, 'metadata.json');
    if (!fs.existsSync(modelPath) || !fs.existsSync(metadataPath)) {
      continue;
    }
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const completeRun = metadata.trainingStep >= metadata.totalGames ||
      (metadata.state && metadata.state.status === 'complete');
    if (mode === 'resume' && completeRun) {
      continue;
    }
    candidates.push({
      runId: pointer.runId || entry.name,
      timestamp: Date.parse(pointer.timestamp || metadata.timestamp || 0)
    });
  } catch (error) {
    // Ignore malformed and partial candidates; only complete checkpoints qualify.
  }
}

candidates.sort((a, b) => b.timestamp - a.timestamp);
if (!candidates.length) {
  fail(`no complete ${mode === 'resume' ? 'resumable ' : ''}checkpoint found under ${checkpointsDir}`);
}
process.stdout.write(`${candidates[0].runId}\n`);
