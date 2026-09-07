#!/usr/bin/env python3
"""Check TASK-101 teacher records against raw same-run output and curriculum seeds."""

import argparse
import hashlib
import json
from pathlib import Path

TEACHER_GAMES_PER_BATCH = 2
PRETRAIN_BATCHES = 4
TRAINING_STEPS = 15
TRAINING_SEED = 87087
PRETRAIN_OFFSET = 50000
PRETRAIN_STRIDE = 173
TRAINING_STRIDE = 1543
STAGE_STRIDE = 997
RUN_ID = 'task101-fast-full-real'


def audit(artifacts):
    report = json.loads((artifacts / 'teacher-game-results.json').read_text())
    log = (artifacts / 'full-real-training.log').read_bytes()
    assert hashlib.sha256(log).hexdigest() == report['full_real_training_log_sha256']
    manifest = (artifacts / 'source-sha256.json').read_bytes()
    assert hashlib.sha256(manifest).hexdigest() == report['source_manifest_sha256']
    for name, digest in json.loads(manifest).items():
        assert hashlib.sha256((artifacts / 'fast-source' / name).read_bytes()).hexdigest() == digest, name
    starts = []
    results = []
    for line in log.decode().splitlines():
        if line.startswith('TEACHER_GAME_START: '):
            starts.append(json.loads(line.removeprefix('TEACHER_GAME_START: ')))
        if line.startswith('TEACHER_GAME_RESULT: '):
            results.append(json.loads(line.removeprefix('TEACHER_GAME_RESULT: ')))
    assert report['games'] == results
    assert starts == [result['scenario'] for result in results]
    expected_count = (PRETRAIN_BATCHES + TRAINING_STEPS) * TEACHER_GAMES_PER_BATCH
    assert report['attempted'] == report['completed_records'] == len(results) == expected_count
    expected_seeds = [TRAINING_SEED + PRETRAIN_OFFSET + batch * PRETRAIN_STRIDE + game
                      for batch in range(PRETRAIN_BATCHES)
                      for game in range(1, TEACHER_GAMES_PER_BATCH + 1)]
    progress = [json.loads(line) for line in
                (artifacts / 'training/progress' / (RUN_ID + '.jsonl')).read_text().splitlines()]
    assert len(progress) == TRAINING_STEPS
    stage = 0
    for row in progress:
        expected_seeds.extend(TRAINING_SEED + row['game'] * TRAINING_STRIDE + stage * STAGE_STRIDE + game
                              for game in range(1, TEACHER_GAMES_PER_BATCH + 1))
        stage = row['stageIndex']
    assert [scenario['seed'] for scenario in starts] == expected_seeds
    assert len(set(expected_seeds)) == expected_count
    for result in results:
        assert result['seed'] == result['scenario']['seed']
        assert result['scenario']['side'] == 'A'
        assert result['mapName'] == 'tiny-duel'
        assert result['runtimePlayerA'] == result['playerA'] == 'AIPlayer'
        assert result['runtimePlayerB'] == result['playerB'] == 'SimpleAiPlayer'
        assert result['winnerSide'] in ('A', 'B', None)
        assert result['failure'] == (result['winnerSide'] != 'A')
        assert result['nonResult'] == (result['winnerSide'] is None)
        assert all(isinstance(result[key], bool) for key in ('crash', 'failure', 'nonResult', 'timeout', 'suddenDeath'))
    print(f'TEACHER_ACCOUNTING: PASS {expected_count} attempts; {len(results)} exact same-log results; unique seeds; original classes/map/side')
    print('TEACHER_PROVENANCE: PASS log SHA256, source manifest SHA256, all frozen source hashes, curriculum seed sequence')
    print('TEACHER_OUTCOMES: ' + json.dumps({
        'wins': sum(result['winnerSide'] == 'A' for result in results),
        'losses': sum(result['winnerSide'] == 'B' for result in results),
        **{key: sum(result[key] for result in results)
           for key in ('nonResult', 'timeout', 'suddenDeath', 'crash', 'failure')}}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', type=Path, default=Path('artifacts/TASK-101'))
    audit(parser.parse_args().artifacts.resolve())
