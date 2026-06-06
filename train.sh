#!/usr/bin/env bash

set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
storage_dir="${DIPLOMACY_STORAGE_DIR:-/mnt/storage/diplomacy}"
games=1
epochs=1
seed=1
run_id=""
resume=false
install_deps=false
max_games_this_run=0
checkpoint_interval=1
checkpoint_retain=0
evaluate_latest=false
fail_after_game=0

usage() {
  cat <<'EOF'
Usage: ./train.sh [options]

Run cloud training with persistent logs and artifacts.

Options:
  --storage-dir PATH        Artifact root (default: $DIPLOMACY_STORAGE_DIR or /mnt/storage/diplomacy)
  --games N                 Total training games/steps (default: 1)
  --epochs N                Epochs per game/step (default: 1)
  --seed N                  Deterministic seed (default: 1)
  --run-id ID               Explicit run identifier for a new run
  --resume                   Resume the latest incomplete checkpoint
  --install-deps             Run npm install before dependency checks
  --max-games-this-run N    Pause after N games; useful for controlled restart tests
  --checkpoint-interval N   Save every N completed games (default: 1)
  --checkpoint-retain N     Keep newest N checkpoints; 0 keeps all (default: 0)
  --evaluate-latest         Load and evaluate the latest complete checkpoint
  --fail-after-game N       Force a failure after game N for recovery testing
  -h, --help                Show this help

Examples:
  ./train.sh --games 2 --epochs 1 --seed 42
  ./train.sh --games 10 --max-games-this-run 2
  ./train.sh --games 10 --checkpoint-interval 2 --checkpoint-retain 5
  ./train.sh --resume
  ./train.sh --evaluate-latest
EOF
}

die() {
  printf 'train.sh: %s\n' "$*" >&2
  exit 1
}

require_positive_integer() {
  local name="$1"
  local value="$2"
  [[ "$value" =~ ^[1-9][0-9]*$ ]] || die "$name must be a positive integer"
}

while (($#)); do
  case "$1" in
    --storage-dir)
      (($# >= 2)) || die "--storage-dir requires a path"
      storage_dir="$2"
      shift 2
      ;;
    --games)
      (($# >= 2)) || die "--games requires a value"
      games="$2"
      shift 2
      ;;
    --epochs)
      (($# >= 2)) || die "--epochs requires a value"
      epochs="$2"
      shift 2
      ;;
    --seed)
      (($# >= 2)) || die "--seed requires a value"
      seed="$2"
      shift 2
      ;;
    --run-id)
      (($# >= 2)) || die "--run-id requires a value"
      run_id="$2"
      shift 2
      ;;
    --resume)
      resume=true
      shift
      ;;
    --install-deps)
      install_deps=true
      shift
      ;;
    --max-games-this-run)
      (($# >= 2)) || die "--max-games-this-run requires a value"
      max_games_this_run="$2"
      shift 2
      ;;
    --checkpoint-interval)
      (($# >= 2)) || die "--checkpoint-interval requires a value"
      checkpoint_interval="$2"
      shift 2
      ;;
    --checkpoint-retain)
      (($# >= 2)) || die "--checkpoint-retain requires a value"
      checkpoint_retain="$2"
      shift 2
      ;;
    --evaluate-latest)
      evaluate_latest=true
      shift
      ;;
    --fail-after-game)
      (($# >= 2)) || die "--fail-after-game requires a value"
      fail_after_game="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1 (run ./train.sh --help)"
      ;;
  esac
done

require_positive_integer "--games" "$games"
require_positive_integer "--epochs" "$epochs"
require_positive_integer "--seed" "$seed"
require_positive_integer "--checkpoint-interval" "$checkpoint_interval"
[[ "$checkpoint_retain" =~ ^[0-9]+$ ]] || die "--checkpoint-retain must be a non-negative integer"
if [[ "$max_games_this_run" != 0 ]]; then
  require_positive_integer "--max-games-this-run" "$max_games_this_run"
fi
if [[ "$fail_after_game" != 0 ]]; then
  require_positive_integer "--fail-after-game" "$fail_after_game"
fi
if [[ "$resume" == true && -n "$run_id" ]]; then
  die "--resume and --run-id cannot be used together"
fi
if [[ "$evaluate_latest" == true && "$resume" == true ]]; then
  die "--evaluate-latest and --resume cannot be used together"
fi

command -v node >/dev/null 2>&1 || die "node is required"
command -v npm >/dev/null 2>&1 || die "npm is required"
node_major="$(node -p "process.versions.node.split('.')[0]")"
((node_major >= 20)) || die "Node.js 20 or newer is required (found $(node --version))"
[[ -f "$repo_dir/package.json" ]] || die "package.json is missing from $repo_dir"

if [[ "$install_deps" == true ]]; then
  (cd "$repo_dir" && npm install)
fi

(cd "$repo_dir" && node -e "require('@tensorflow/tfjs-node')") \
  >/dev/null 2>&1 || die "@tensorflow/tfjs-node is unavailable; run ./train.sh --install-deps"

mkdir -p "$storage_dir"/{checkpoints,final,logs,metrics,runs} \
  || die "cannot create artifact directories under $storage_dir"
probe="$storage_dir/.train-write-test.$$"
if ! printf 'ok\n' >"$probe"; then
  die "storage directory is not writable: $storage_dir"
fi
rm -f "$probe"

if [[ "$resume" == true || "$evaluate_latest" == true ]]; then
  checkpoint_mode=evaluate
  if [[ "$resume" == true ]]; then
    checkpoint_mode=resume
  fi
  if ! run_id="$(node "$repo_dir/ai/find-latest-checkpoint.js" "$storage_dir" "$checkpoint_mode")"; then
    die "unable to discover a complete checkpoint under $storage_dir/checkpoints"
  fi
else
  if [[ -z "$run_id" ]]; then
    run_id="$(date -u +%Y%m%dT%H%M%SZ)-seed${seed}"
  fi
  [[ "$run_id" =~ ^[A-Za-z0-9._-]+$ ]] || die "--run-id may contain only letters, numbers, dot, underscore, and dash"
fi

log_file="$storage_dir/logs/$run_id.log"
runner_args=(
  "$repo_dir/ai/cloud-train-runner.js"
  --storage-dir "$storage_dir"
  --run-id "$run_id"
  --games "$games"
  --epochs "$epochs"
  --seed "$seed"
  --max-games-this-run "$max_games_this_run"
  --checkpoint-interval "$checkpoint_interval"
  --checkpoint-retain "$checkpoint_retain"
  --fail-after-game "$fail_after_game"
)
if [[ "$resume" == true ]]; then
  runner_args+=(--resume)
fi
if [[ "$evaluate_latest" == true ]]; then
  runner_args+=(--evaluate-latest)
fi

printf 'Training run %s; log: %s\n' "$run_id" "$log_file"
set +e
(cd "$repo_dir" && node "${runner_args[@]}") 2>&1 | tee -a "$log_file"
status=${PIPESTATUS[0]}
set -e
if ((status != 0)); then
  die "training failed with exit code $status; see $log_file"
fi
