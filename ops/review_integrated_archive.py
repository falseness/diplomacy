#!/usr/bin/env python3
"""TASK-225 read-only review of TASK-245 matrix and execution-accounting clauses.

UI/protocol coverage is deliberately not certified by this source-tier reader.
It recomputes geometry from coordinates with an independent hex BFS and the
separate non-production capacity/valley oracles, and validates the full selected
execution ledger and owned cleanup. Never executes generation or gameplay.
"""
import argparse
import collections
import datetime
import hashlib
import json
import subprocess
from pathlib import Path

INPUTS = [dict(size=s, h=h, seed=1) for s in ['tiny', 'normal', 'big'] for h in range(1, 13)]
INPUTS += [dict(size=s, h=h, seed=seed) for seed in [0, 4294967295] for s, h in [('tiny', 1), ('big', 12)]]
CATEGORIES = dict(melee=3, ranged=3, siege=1, heavy=1, support=1, chaos=1)


def digest(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def identifier(input_):
    return '{size}-H{h}-seed{seed}'.format(**input_)


def neighbours(p):
    x, y = p
    shift = 0 if x % 2 else -1
    return [(x, y-1), (x, y+1)] + [(x+dx, y+shift+dy) for dx in [-1, 1] for dy in [0, 1]]


def geometry(board, input_):
    """Second path model: hostile objects, including mines, are endpoints."""
    h, size = input_['h'], input_['size']
    n = board['mapSize']['x']
    if board['mapSize']['y'] != n:
        raise ValueError('geometry/square')
    coord = lambda c: (c['x'], c['y'])
    portals = list(map(coord, board['portals']))
    humans = board['players'][1:1+h]
    towns = [coord(p['towns'][0]) for p in humans]
    solid = set(map(coord, board['mountains'] + board['lakes']))
    neutral = list(map(coord, board['players'][0]['towns']))
    mines = list(map(coord, board['goldmines']))
    all_objects = [coord(c) for p in board['players'] for c in p['towns']]
    for key in ['portals', 'goldmines', 'mountains', 'lakes', 'bushes', 'hills']:
        all_objects += list(map(coord, board[key]))
    if len(set(all_objects)) != len(all_objects) or not all(0 <= x < n and 0 <= y < n for x, y in all_objects):
        raise ValueError('geometry/overlap-or-bounds')
    if collections.Counter(p['category'] for p in board['portals']) != {k: v*h for k, v in CATEGORIES.items()}:
        raise ValueError('geometry/categories')
    counts = [len(humans), len(neutral), len(mines), len(portals)]
    objects = {'tiny': 1, 'normal': 2, 'big': 3}[size]
    if counts != [h, h*objects, h*objects, h*10]:
        raise ValueError('geometry/counts')
    for p in humans:
        if [p['gold'], len(p['towns']), len(p['units'])] != [100, 1, 0]:
            raise ValueError('geometry/assets')
    endpoints = set(neutral + portals + mines)
    occupied = solid | endpoints | set(towns)
    rows = []
    for origin in towns:
        blocked = solid | (set(towns) - {origin})
        distance = {origin: 0}
        queue = collections.deque([origin])
        while queue:
            cell = queue.popleft()
            if cell in endpoints and cell != origin:
                continue
            for point in neighbours(cell):
                x, y = point
                if 0 <= x < n and 0 <= y < n and point not in blocked and point not in distance:
                    distance[point] = distance[cell] + 1
                    queue.append(point)
        if not all(p in distance for p in endpoints):
            raise ValueError('geometry/unreachable')
        approaches = [sum(p not in occupied and p in distance for p in neighbours(portal)) for portal in portals]
        if min(approaches) < 2:
            raise ValueError('geometry/approach')
        near = {name: min(distance[p] for p in group) for name, group in [('portals', portals), ('mines', mines), ('neutral', neutral)]}
        # Cube distance is independent of terrain or production region labels.
        def cube(p):
            x, y = p
            z = y - (x - (x & 1)) // 2
            return x, -x-z, z
        minimum = min(max(abs(a-b) for a, b in zip(cube(origin), cube(portal))) for portal in portals)
        if minimum < {'tiny': 6, 'normal': 10, 'big': 14}[size]:
            raise ValueError('geometry/portal-distance')
        rows.append(dict(nearest=near, approaches=approaches, minimumHexDistance=minimum))
    # The existing contract treats mines as transit for general fairness; the
    # extra endpoint model specifically requires portal fairness, as declared.
    if max(r['nearest']['portals'] for r in rows) - min(r['nearest']['portals'] for r in rows) > 4:
        raise ValueError('geometry/fairness')
    return dict(counts=counts, humans=rows)


def review(directory, historical=False):
    root = Path(directory).resolve(strict=True)
    read = lambda file: json.loads((root / file).read_text())
    checks = []

    def check(name, expected, observed):
        a, b = json.dumps(expected, sort_keys=True), json.dumps(observed, sort_keys=True)
        if a != b:
            raise ValueError('integrated-review:' + name)
        if len(a) > 2048:
            expected, observed = [dict(sha256=hashlib.sha256(s.encode()).hexdigest(), encoding='sorted JSON') for s in [a, b]]
        checks.append(dict(id=name, expected=expected, observed=observed, pass_=True))

    coverage, plan, budget = map(read, ['coverage-results.json', 'verification-plan.json', 'verification-budget.json'])
    manifest = coverage['evidenceHashes']
    for name, sha in manifest.items():
        file = (root / name).resolve(strict=True)
        if not file.is_relative_to(root) or not file.is_file():
            raise ValueError('escaped/non-file proof')
        check('hash/' + name, sha, digest(file))
    for name in ['checkpoints.json', 'matrix/checkpoints.json', 'matrix/maps.json', 'matrix/negative-controls.json',
                 'coverage.json', 'verification-plan.json', 'source-identities.json']:
        check('manifest/' + name, True, name in manifest)
    differences = []
    sources = read('source-identities.json')['files']
    for role, record in sources.items():
        repo = Path(record['repo']).resolve(strict=True)
        for name, sha in record['files'].items():
            file = (repo / name).resolve()
            if not file.is_relative_to(repo):
                raise ValueError('source-path-escape')
            if not file.is_file() or digest(file) != sha:
                differences.append(role + '/' + name)
    for oracle in ['ai/test-coop-valley-contract.js', 'ai/test-task236-capacity.js']:
        check('independent-oracle-source/' + oracle, sources['client']['files'][oracle],
              digest(Path(sources['client']['repo']) / oracle))
    if not historical:
        check('current-source-differences', [], differences)
    case_ids = plan['cases']
    check('case-count', 446, len(case_ids))
    check('unique-cases', 446, len(set(case_ids)))
    check('exact-completed-cases', case_ids, [r['id'] for r in coverage['cases']])
    check('case-pass', [True]*446, [r['pass'] for r in coverage['cases']])
    declared = read('coverage.json')
    check('declared-expected', case_ids, declared['expected'])
    check('executed-exact', sorted(case_ids), sorted(declared['executed']))
    for key in ['exhaustiveProfile', 'priorEvidenceReused']:
        check('coverage/' + key, False, declared[key])
    checkpoints = read('checkpoints.json')['checkpoints']
    check('checkpoints-exact', sorted(case_ids), sorted(c['id'] for c in checkpoints))
    for c in checkpoints:
        check('checkpoint/pass/' + c['id'], True, c['pass'])
        check('checkpoint/equal/' + c['id'], c['expected'], c['observed'])
    commands = coverage['commandExits']
    check('command-count', 30, len(commands))
    for c in commands:
        check('command/exit', [0, None, None], [c['exit'], c['signal'], c['error']])
        owned = c['supervision']
        for k, v in dict(exit=0, signal=None, timedOut=False, cleanup=True, remaining=[]).items():
            check('supervision/' + k, v, owned[k])
        check('supervision/processes', True, bool(owned['processes']))
        check('supervision/directories', True, all(not d['existsAfter'] for d in owned['directories']))
    for name in ['verification-plan.json', 'verification-budget.json']:
        for key, expected in dict(targetMs=2700000, stopWorkMs=3300000, budgetMs=3600000).items():
            check(name + '/' + key, expected, read(name)[key])
    check('within-target', True, 0 <= budget['elapsedMs'] <= 2700000)
    stamp = lambda s: datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))
    elapsed = round((stamp(budget['finishedAt'])-stamp(budget['startedAt'])).total_seconds()*1000)
    # The producer calls Date.now separately for finishedAt and elapsedMs.
    check('elapsed-arithmetic', True, 0 <= budget['elapsedMs']-elapsed <= 1)
    check('budget/exits', [0]*30, budget['exits'])
    check('budget/cleanup', True, budget['cleanup'])
    check('budget/pass', True, budget['pass'])
    log = (root / 'verification.log').read_text()
    for marker in ['PASS matrix inputs=40 generated=80 categories=3:3:1:1:1:1 fairness=pass distances=pass approaches=pass',
                   'PASS final-audit required-files-present exact-case-inventory source-hashes screenshots-PNG cleanup=true',
                   'RUNNER_ACTUAL_EXIT_STATUS=0', 'NODE=', 'CWD=', 'COMMAND ']:
        check('log/' + marker, True, marker in log)
    for file in ['diff-check.txt', 'server-diff-check.txt', 'removed-runtime-rg.txt', 'removed-fixture-rg.txt']:
        check('empty/' + file, '', (root / file).read_text())
    maps, matrix = read('matrix/maps.json'), read('matrix/checkpoints.json')['checkpoints']
    check('matrix/exact-inputs', INPUTS, [r['input'] for r in maps])
    check('matrix/exact-ids', list(map(identifier, INPUTS)), [r['id'] for r in maps])
    check('matrix/checkpoint-count', 1200, len(matrix))
    for c in matrix:
        check('matrix/pass/' + c['id'], True, c['pass'])
        check('matrix/equal/' + c['id'], c['expected'], c['observed'])
    observations = []
    for row in maps:
        id_ = row['id']
        repeat = next(c for c in matrix if c['id'] == id_ + '-repeat')
        check('matrix/raw-repeat/' + id_, row['map'], json.loads(repeat['expected']))
        hashes = [hashlib.sha256(repeat[k].encode()).hexdigest() for k in ['expected', 'observed']]
        check('matrix/repeat-hashes/' + id_, hashes, row['duplicateHashes'])
        observations.append(dict(id=id_, geometry=geometry(row['map'], row['input'])))
    # These existing oracles do not import generation/planner code. Recompute
    # all valley contracts and feasible dimensions, never trust archived booleans.
    script = r"""
const fs=require('node:fs'),assert=require('node:assert/strict');
const root=process.argv[1],client=process.argv[2];
const {verifyValley}=require(client+'/ai/test-coop-valley-contract');
const {expectation}=require(client+'/ai/test-task236-capacity');
const maps=JSON.parse(fs.readFileSync(root+'/matrix/maps.json'));
for(const r of maps){const {h,size}=r.input,side=expectation(h,size,5).side;
 assert.deepEqual(r.map.mapSize,{x:side,y:side},r.id+':dimensions');
 const contract=verifyValley({...r.map,size,valley:r.plan.valley},{side,humanTowns:h,
 neutralTowns:h*{tiny:1,normal:2,big:3}[size],goldmines:h*{tiny:1,normal:2,big:3}[size],
 portals:10*h,portalDistance:{tiny:6,normal:10,big:14}[size]});
 assert.equal(contract.valid,true,r.id+':'+contract.failed.join(','));
 assert.deepEqual(contract,r.contract,r.id+':changed-contract');}
console.log('PASS recomputed 40 capacity and full valley contracts');
"""
    result = subprocess.run(['/usr/local/bin/node20', '-e', script, str(root), sources['client']['repo']], capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise ValueError('independent-capacity-contract: ' + result.stdout + result.stderr)
    check('independent-capacity-contract-exit', 0, result.returncode)
    check('independent-capacity-contract-marker', 'PASS recomputed 40 capacity and full valley contracts\n', result.stdout)
    return dict(archive=str(root), tier='source-executed', completeAudit=False,
                certifiedScope='matrix geometry and execution accounting; not browser/network tier',
                checks=checks, geometry=observations, sourceDifferences=differences,
                oracleCommand=result.args, oracleStdout=result.stdout, oracleStderr=result.stderr,
                evidenceHashes=len(manifest), sourceHashes=sum(len(r['files']) for r in sources.values()),
                assertions=[dict(id=r['id'], expected=dict(identical=True, valid=True, portals=10*r['input']['h']),
                                 proof=dict(file='checkpoints.json', sha256=digest(root/'checkpoints.json'))) for r in maps],
                originalFiles={str(p.relative_to(root)): digest(p) for p in sorted(root.rglob('*')) if p.is_file()})


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('archive'); p.add_argument('output'); p.add_argument('--historical', action='store_true')
    a = p.parse_args()
    result = review(a.archive, a.historical)
    with open(a.output, 'x') as stream:
        json.dump(result, stream, indent=2); stream.write('\n')
    print(f"PASS integrated archive: {len(result['checks'])} checks; 40 raw maps; 446 cases; 30 commands; scope=matrix-and-accounting")
    print('INCOMPLETE browser/network tiers and full TASK-225 audit remain separate')
