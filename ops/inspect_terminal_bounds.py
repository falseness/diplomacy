#!/usr/bin/env python3
"""Read-only TASK-225 AC7 sufficiency inspection; never awards coverage credit."""
import hashlib
import json
import pathlib
import re
import sys
import time

ROOT = pathlib.Path('/root/diplomacy')
BASE = ROOT / 'artifacts/TASK-225/smoke-exits-162/run-01'


def digest(file):
    h = hashlib.sha256()
    with open(file, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def inspect(out):
    started = time.monotonic()
    out.mkdir(parents=True, exist_ok=False)
    checks, bindings = [], {}

    def save(name, value):
        (out / name).write_text(json.dumps(value, indent=2) + '\n')

    def ck(name, expected, observed):
        checks.append(dict(id=name, expected=expected, observed=observed, pass_=expected == observed))
        assert expected == observed, name
        assert time.monotonic() - started < 3300, 'cumulative inspection deadline'

    def read(file):
        file = pathlib.Path(file)
        bindings[str(file)] = digest(file)
        return json.loads(file.read_text())

    retained = read(BASE / 'source-identities.json')['bindings']
    for file, sha in retained.items():
        ck('retained/' + file, sha, digest(file))
    bindings.update(retained)
    selection = read(BASE / 'reviewed-crosswalk.json')
    result = read(BASE / 'scoped-result.json')
    ck('retained-scope', True, result['scopePass'])
    ck('eight-self-owners', 8, result['selfOwners'])
    ck('consumer-exit', 0, read(BASE / 'consumer-exit.json')['actualExit'])
    ck('supervisor-exit', 0, read(BASE / 'process-exit.json')['actualRunnerExit'])
    ck('independent-handoff', True, read(BASE / 'independent-handoff.json')['scopePass'])
    ck('completed-smoke-AC5', 'covered-current', read(BASE / 'exits-transition.json')['status'])
    for key in ['ac1Selection', 'ac2Selection', 'ac3Selection', 'ac6Selection',
                'smokeSelection', 'smokeTiersSelection', 'smokeBoundsSelection', 'smokeExitsSelection']:
        s = selection[key]
        if 'baseline' in s:
            ck(key + '/ancestry', s['baseline']['sha256'], digest(s['baseline']['file']))
        # Validate every original pin, including files not used by this inspection.
        for name, sha in s.get('originalFiles', {}).items():
            f = pathlib.Path(s.get('original', s.get('directory'))) / name
            ck(key + '/original/' + name, sha, digest(f))
            bindings[str(f)] = sha
    s = selection['ac3Selection']
    provider = pathlib.Path(s['original'])
    receipt = s['receipt']
    ck('original-receipt-pin', receipt['sha256'], digest(receipt['file']))
    invocation = read(receipt['file'])
    ck('original-provider-exit', 0, invocation['actualExit'])
    ck('original-provider-output', str(provider), invocation['argv'][-1])
    plan = read(provider / 'verification-plan.json')
    cases = [c['id'] for c in plan['cases']]
    ck('four-journeys', ['terminal-victory', 'terminal-draw', 'terminal-to-coop', 'terminal-to-competitive'], cases)
    ck('five-source-rules', ['victory', 'defeat', 'draw', 'competitive-draw', 'competitive-survivor'], plan['sourceCases'])
    cp = read(provider / 'checkpoints.json')['checkpoints']
    for name in plan['requiredCheckpoints']:
        rows = [c for c in cp if c['id'] == name]
        ck('required-count/' + name, 1, len(rows))
        ck('required-pass/' + name, True, rows[0]['pass'])
        ck('required-value/' + name, rows[0]['expected'], rows[0]['observed'])
    observations = []
    for case in cases:
        fixture = read(provider / case / 'declared-fixture.json')['spec']['generation']
        ck(case + '/fixture-seed', 1, fixture['seed'])
        ck(case + '/fixture-size', 'tiny', fixture['size'])
        ck(case + '/authored', False, fixture['testFixture']['generated'])
        f = provider / case / 'network-traces.jsonl'
        bindings[str(f)] = digest(f)
        rows = [json.loads(line) for line in f.read_text().splitlines()]
        participants = [r for r in rows if r.get('stage') == 'ac2-passive' and r.get('kind') == 'page' and r.get('boundary') == 'reconnect-before']
        ck(case + '/participants', ['p1', 'p2'], sorted(r['participant'] for r in participants))
        ck(case + '/sessions', 2, len({r['session'] for r in participants}))
        if not case.startswith('terminal-to-'):
            continue
        pages = [r for r in rows if r.get('stage') == 'ac3-passive' and r.get('kind') == 'page' and r.get('boundary') == 'first-move-before']
        ck(case + '/next-pages', ['p1', 'p2'], sorted(r['participant'] for r in pages))
        dimensions = []
        for r in pages:
            grid = r['raw']['state']['grid']['items']
            heights = {len(col['items']) for col in grid}
            ck(case + '/' + r['participant'] + '/rectangular', 1, len(heights))
            dimensions.append([len(grid), heights.pop()])
        ck(case + '/same-map', dimensions[0], dimensions[1])
        observations.append(dict(case=case, boundary='first-move-before', dimensions=dimensions, proof=str(f)))
    # Current production map catalog and menu establish a smaller supported option.
    maps = ROOT / 'options/gamestart.js'
    source = maps.read_text()
    match = re.search(r'"tiny deathmatch":\s*\[\s*new GameMap\(\s*\{x: (\d+), y: (\d+)\}', source)
    assert match, 'review map catalog change before using this inspector'
    smaller = list(map(int, match.groups()))
    competitive = next(o for o in observations if o['case'] == 'terminal-to-competitive')['dimensions'][0]
    ck('smaller-supported-competitive-map', True, smaller[0] * smaller[1] < competitive[0] * competitive[1])
    for f in [maps, ROOT / 'menu/menu.js', ROOT / 'ops/terminal_ac3_provider.js',
              pathlib.Path('/root/diplomacy_server/tests/reliability/helpers/terminal-flow-next-game.js'),
              ROOT / 'ops/inspect_terminal_bounds.py']:
        bindings[str(f)] = digest(f)
    clauses = [
        dict(clause='Distinct behaviors and boundaries; source combinations and focused network cases', finding='Retained AC1/AC2/AC3/AC6 reviews plus five source rules and four original journeys; no new credit.', proof='ac1Selection/ac2Selection/ac3Selection/ac6Selection'),
        dict(clause='At most four journeys, two humans', finding='Four exact case IDs, two distinct observed sessions per case.', proof='checkpoints.json and original network-traces.jsonl'),
        dict(clause='Smallest supported maps and seed 1', finding='FAIL: competitive next-game pages are 21x21; supported tiny deathmatch is 20x10. Initial tiny seed-1 fixtures do not establish the next competitive map size.', proof=observations[-1]['proof']),
        dict(clause='Fog and join modes across journeys', finding='Manifest distributes fog false/true and sequential/simultaneous across journeys.', proof=str(provider / 'verification-plan.json')),
        dict(clause='Declared valid initial fixtures', finding='Four original authored tiny seed-1 fixtures; validity/semantics retained in consumed AC1 and AC6, not newly certified here.', proof='original declared-fixture.json files and retained AC1/AC6'),
        dict(clause='Exclude cross-products, long natural games, high-count rendering', finding='Four-case loop, no expansion; original plan excludes Cartesian products and long natural games; no high-count journey selected.', proof=str(provider / 'verification-plan.json')),
        dict(clause='Exact assertions in selected cases', finding='Every original required checkpoint exists once, passes, and expected equals observed; independent semantic reviewers retained separately.', proof=str(provider / 'checkpoints.json')),
    ]
    save('inspection.json', dict(scopePass=True, wholeCriterionCredit=False, overallPass=False,
         decision='STOP_AC7_CLOSURE', deficit='competitive-next-game-not-smallest-supported-map',
         observedCompetitiveMap=competitive, smallerSupportedMap=smaller, observations=observations,
         clauses=clauses, activeSelection=str(BASE / 'reviewed-crosswalk.json'),
         activeGate='ops/evidence_smoke_exits_gate.js', remainingPrior=result['remainingPrior'],
         nextAction='Separate changed acquisition design must explicitly select the smallest supported competitive map via shipped controls; preserve old evidence. No unchanged replay or successor selection.'))
    for file, sha in bindings.items():
        ck('final-binding/' + file, sha, digest(file))
    save('source-identities.json', dict(fullInvocation=False, bindings=bindings))
    save('checkpoints.json', dict(fullInvocation=False, checks=[{('pass' if k == 'pass_' else k): v for k, v in c.items()} for c in checks]))
    print('PASS retained bindings and AC7 sufficiency inspection; assertions=' + str(len(checks)))
    print('STOP_AC7_CLOSURE competitive-next-game-not-smallest-supported-map observed=' + str(competitive) + ' smaller-supported=' + str(smaller))
    print('FULL_TASK_PASS=false wholeCriterionCredit=false no provider or consumer launched')


if __name__ == '__main__':
    inspect(pathlib.Path(sys.argv[1]).absolute())
