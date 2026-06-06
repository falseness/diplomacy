# Cloud Training Runbook

## Entrypoints

The repository provides AI bootstrap smokes:

```sh
npm run init-model
npm run train
```

`init-model` loads the model API and `train` loads the AI scripts and validates
vector helpers. Persistent cloud training is orchestrated by:

```sh
./train.sh --games 100 --epochs 4 --seed 42
./train.sh --resume
```

Run `./train.sh --help` for all options. The script checks dependencies and
writable storage before starting, logs stdout/stderr, records metrics after
each game, keeps a latest resumable model, and writes the completed model under
`final/`. Use `--install-deps` to run `npm install` before preflight checks.

## Runtime

- Use 64-bit Linux with Node.js 20 LTS and npm.
- `package.json` pins TensorFlow.js and `@tensorflow/tfjs-node` to `4.22.0`.
- `jsdom@24` requires Node.js 18 or newer. Node.js 12 is not supported even
  though TensorFlow.js itself accepts older Node versions.
- The declared `@tensorflow/tfjs-node` package uses the native CPU backend.
  A GPU is optional, not required. GPU training requires Linux, a compatible
  NVIDIA driver/CUDA setup, and deliberately replacing the CPU binding with a
  matching `@tensorflow/tfjs-node-gpu` version.
- Start with at least 8 GB RAM for smoke and small runs. Long self-play runs
  should use more memory and monitor both process memory and swap.
- Persistent storage must be mounted at `/mnt/storage`; training output belongs
  under `/mnt/storage/diplomacy`, never only in the repository or `/tmp`.

For Debian/Ubuntu hosts, install Node.js 20 by the provider's supported method,
then install native build prerequisites:

```sh
sudo apt-get update
sudo apt-get install -y build-essential python3 pkg-config \
  libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

The graphics libraries are required when `canvas` cannot use a prebuilt binary.
`@tensorflow/tfjs-node` downloads or builds a native TensorFlow binding during
`npm install`, so outbound package access and a working compiler toolchain may
also be required.

## Configuration

Deployment configuration is owned by `~/ai/deploy`, outside the repository:

```sh
export DIPLOMACY_REPO_DIR=/opt/diplomacy
export DIPLOMACY_STORAGE_DIR=/mnt/storage/diplomacy
```

`train.sh` accepts `--storage-dir`, `--games`, `--epochs`, `--seed`, `--run-id`,
and `--resume`. Resume restores the original games, epochs, and seed from run
state. `--max-games-this-run` intentionally pauses after a bounded number of
games for restart testing or scheduled cloud jobs. Do not store provider
credentials in the repository or artifact directory.

Use this persistent layout:

```text
/mnt/storage/diplomacy/
  checkpoints/
  final/
  logs/
  metrics/
  benchmarks/
  runs/
```

Each run gets a timestamp/seed identifier under `runs/`. `train.sh` writes:

- `logs/<run>.log`: combined process output.
- `metrics/<run>.jsonl`: one structured record per completed game.
- `runs/<run>/manifest.json`: configuration, revision, and artifact paths.
- `runs/<run>/state.json`: resume progress.
- `checkpoints/<run>/latest/`: latest resumable model.
- `final/<run>/`: final TensorFlow.js model.

The latest-only resume model is orchestration support. Configurable checkpoint
intervals, versioned checkpoint metadata, and retention policy belong to
`TASK-010`.

## Install And Preflight

```sh
cd "${DIPLOMACY_REPO_DIR:-/opt/diplomacy}"
node --version
npm --version
npm install

"${HOME}/ai/deploy/deploy.sh" \
  --repo-dir "$PWD" \
  --storage-dir "${DIPLOMACY_STORAGE_DIR:-/mnt/storage/diplomacy}"

npm run init-model
npm run train
./train.sh --games 1 --epochs 1
```

On a reproducible host, use `npm ci` once a lockfile exists. This repository
does not currently contain a lockfile, so `npm install` is the available
command. Review install warnings rather than applying `npm audit fix --force`,
which can silently change the declared runtime.

## Training Lifecycle

The operational lifecycle is:

1. **Initialize:** run the model bootstrap, create a run manifest, record the
   git revision and seed, and write the initial model beneath persistent
   storage.
2. **Train:** start `train.sh` with explicit game/epoch/checkpoint settings.
   Redirect stdout and stderr to the run's `logs/` directory and write metrics
   incrementally.
3. **Resume:** select the newest complete checkpoint, validate its model input
   channel count against the current vectorizer, and continue with the saved
   step and seed metadata. Never resume from a partially written directory.
4. **Evaluate:** load a named checkpoint and run the required deterministic
   benchmark suite without updating weights.
5. **Collect:** retain the final model, run manifest, metrics, benchmark report,
   logs, failed seeds, and the exact checkpoint used for evaluation.

The browser-only model code still saves to IndexedDB/downloads and is not used
by the unattended cloud runner.

## Recovery And Risks

- Run long jobs under the cloud provider's service manager, `systemd`, or a
  terminal multiplexer so SSH disconnects do not terminate training.
- Write checkpoints to a temporary sibling directory and rename only after all
  model and metadata files are complete. Resume only complete checkpoints.
- Verify `/mnt/storage/diplomacy` is mounted and writable before installing or
  training. A missing mount can otherwise write artifacts to ephemeral root
  disk at the same path.
- Native `tfjs-node` installation can fail because of unsupported Node ABI,
  missing compilers, blocked binary downloads, or incompatible glibc. Use Node
  20, preserve the full npm log, and verify the binding with
  `node -e "require('@tensorflow/tfjs-node'); console.log('tfjs-node ok')"`.
- GPU mode adds NVIDIA driver, CUDA, and package compatibility requirements.
  Confirm `nvidia-smi` and a TensorFlow operation before starting a long run.
- Storage permissions and capacity must be monitored throughout training.
- Model/vector channel changes invalidate old checkpoints unless an explicit
  migration exists; the current loader intentionally rejects mismatches.
- Save the seed and failed game state for crashes, timeouts, or unstable
  benchmarks so a later run can reproduce them.
