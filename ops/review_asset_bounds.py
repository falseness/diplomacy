#!/usr/bin/env python3
"""Independent TASK-211 AC7 review, extending the complete AC1..3 oracles.

Plan labels alone are insufficient: match fixture, wire admission, persisted
boards, actual contexts and input-driven turn observations on bound source.
"""
import json
import sys
from pathlib import Path
from review_asset_recovery import review as recovery
from review_asset_archive import sha

CASES = ('cold-warm-delay', 'failed-recovery', 'old-client', 'old-server')


def review(root, digest):
    root = Path(root).resolve(strict=True)
    result = recovery(root, digest)
    checks, proofs = result['checks'], result['proofs']
    manifest = json.loads((root/'coverage-results.json').read_text())['evidenceHashes']

    def check(name, expected, observed):
        if type(expected) is not type(observed) or expected != observed:
            raise ValueError('asset-bounds: '+name)
        checks.append(dict(id='bounds/'+name, expected=expected, observed=observed, **{'pass': True}))

    def read(name, lines=False):
        p = (root/name).resolve(strict=True)
        check('contained/'+name, True, p.is_relative_to(root) and p.is_file())
        check('hash/'+name, manifest[name], sha(p))
        proofs[name] = sha(p)
        return [json.loads(l) for l in p.read_text().splitlines()] if lines else json.loads(p.read_text())

    plan = read('verification-plan.json')
    expected_cases = [dict(id=c, tier='real HTTPS/Socket.IO/MongoDB and shipped browser UI',
                           humans=2, size='tiny', seed=1,
                           join='simultaneous' if c=='failed-recovery' else 'sequential',
                           fog=c=='failed-recovery') for c in CASES]
    check('exact-plan', expected_cases, plan['cases'])
    check('exclusions', ['exhaustive seed/class/count combinations', 'high-count rendering',
          'long natural games', 'compatibility combinations beyond the recorded TASK-065 release',
          'co-op version cross-product (competitive turn protocol selected for release combinations)',
          'three-round repetition'], plan['exclusions'])
    events = read('asset-events.jsonl', True)
    checkpoints = read('checkpoints.json')['checkpoints']
    check('checkpoint-ownership', sorted(plan['requiredCheckpoints']), sorted(c['id'] for c in checkpoints))
    check('no-extra-journey', sorted(CASES), sorted({e['id'] for e in events}))
    identities = read('source-identities.json')['after']
    # This helper is the executed fixture constructor, not a second simulated game.
    for repo, name, fragments in [
        ('server', 'tests/coop/helpers/current-coop-fixture.js',
         ['tiny: Object.freeze({2: 14, 3: 19, 4: 20})',
          'normal: Object.freeze({2: 18, 3: 22, 4: 25})',
          'big: Object.freeze({2: 28, 3: 34, 4: 39})']),
        ('server', 'tests/reliability/assets-versions.test.js',
         ["const CASES=['cold-warm-delay','failed-recovery','old-client','old-server']",
          'fixture.buildCurrentCoopBoardInVm(spec)', "json(id+'/declared-fixture.json',{spec,board:b})",
          "s.client.emit('startGameOrConnect',JSON.stringify({password:secrets[i],game:b}))",
          "const assigned=coop?await Promise.all([admit(0),admit(1)]):[await admit(0),await admit(1)]",
          'for(let i=0;i<2;i++)ps.push(await BrowserPlayer.open',
          "contexts:new Set(ps.map(p=>p.page.context())).size", 'for(const round of [0])'])]:
        p = Path(identities[repo]['repo'])/name
        check('source/'+name, identities[repo]['files'][name], sha(p))
        proofs[str(p)] = sha(p)
        for i, fragment in enumerate(fragments):
            check('source-contract/'+name+'/'+str(i), True, fragment in p.read_text())
    for case in CASES:
        coop = case=='failed-recovery'
        fixture = read(case+'/declared-fixture.json')
        spec, board = fixture['spec'], fixture['board']
        for key, expected in [('label',case),('humans',2),('size','tiny'),('side',14),('seed',1)]:
            check(case+'/spec/'+key, expected, spec[key])
        check(case+'/declared-not-generated', dict(label=case,kind='declared-local-fixture',generated=False),
              {k:spec['generation']['testFixture'][k] for k in ('label','kind','generated')})
        check(case+'/dimensions', [14]*14, [len(col) for col in board['grid']])
        check(case+'/fog', coop, board['isFogOfWar'])
        check(case+'/no-ai', False, board['gameSettings']['withAI'])
        check(case+'/coop', coop, board['gameSettings']['coop'] is not None)
        own = [e for e in events if e['id']==case]
        admissions = [e for e in own if e['stage']=='admission']
        check(case+'/admission-count', 1, len(admissions))
        check(case+'/join', 'simultaneous' if coop else 'sequential', admissions[0]['join'])
        check(case+'/assigned', [dict(identity=0,slot=1),dict(identity=1,slot=2)], admissions[0]['assigned'])
        check(case+'/observed-contexts', [dict(contexts=2,persisted=2)],
              [c['observed'] for c in checkpoints if c['id']==case+'/participants'])
        check(case+'/wire-participants', [case+'-p1',case+'-p2'],
              sorted({e['player'] for e in own if e['stage']=='wire'}))
        # Full board comparisons and persisted identities already ran through the
        # independent AC3 oracle; also verify fixture admission precedes UI input.
        check(case+'/admission-before-input', True,
              own.index(admissions[0]) < next(i for i,e in enumerate(own) if e['stage']=='input'))
        check(case+'/one-round', [1], [e['round'] for e in own if e['stage']=='round-complete'])
    result.update(scope='TASK-211/AC7: bounded four real journeys with declared tiny H2 seed-1 fixtures, both fog/join modes and exact independent observations',
                  wholeCriterionClosure=True,
                  derivation=result['derivation']+' AC7 compares the exact predeclared four-case plan to fixture dimensions, seed and metadata, two observed contexts and wire identities, join admission order, fog settings and one completed round. The hash-bound constructor declares tiny H2 side 14 versus normal 18 and big 28. Authored fixtures are explicitly not generated-map coverage; excluded cross-products/stress/long games remain excluded.')
    return result


if __name__=='__main__':
    print(json.dumps(review(sys.argv[1],sys.argv[2])))
