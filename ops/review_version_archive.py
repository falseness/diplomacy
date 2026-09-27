#!/usr/bin/env python3
"""Read retained TASK-211 compatibility proof; never certify current coverage."""
import argparse
import copy
import json
from pathlib import Path

from review_asset_archive import review as review_assets, sha

MESSAGE = 'Reload required: unsupported browser version'
CASES = ('cold-warm-delay', 'failed-recovery', 'old-client', 'old-server')
PROOFS = ['version-matrix.json', 'release-identities.json', 'release-cleanup.json',
          'asset-events.jsonl', 'checkpoints.json', 'old-client/declared-fixture.json',
          'old-client/archived-served-sources.json', 'old-client/served-sources.json',
          'old-server/served-sources.json']


def review(root, manifest_sha256):
    root = Path(root).resolve(strict=True)
    asset = review_assets(root, manifest_sha256)
    checks, proofs = [], dict(asset['proofs'])
    manifest = json.loads((root/'coverage-results.json').read_text())['evidenceHashes']

    def check(name, expected, observed):
        if type(expected) is not type(observed) or expected != observed:
            raise ValueError('version-proof: '+name)
        checks.append(dict(id=name, expected=expected, observed=observed, **{'pass': True}))

    def read(name, lines=False):
        path = (root/name).resolve(strict=True)
        check('contained/'+name, True, path.is_relative_to(root) and path.is_file())
        check('hash/'+name, manifest[name], sha(path))
        proofs[name] = sha(path)
        return ([json.loads(line) for line in path.read_text().splitlines()]
                if lines else json.loads(path.read_text()))

    matrix = read('version-matrix.json')
    release = read('release-identities.json')
    check('release/matrix-identity', release, matrix['release'])
    # Fixed provider identity binds these external historical absolute paths.
    # They are read only; no arbitrary path supplied by a report is followed.
    base = Path('/root/diplomacy/artifacts/TASK-065')
    for field, filename in [('archive', 'candidate.tar.gz'), ('manifest', 'release-manifest.json')]:
        check('release/'+field+'-path', str(base/filename), release[field])
        actual = sha(base/filename)
        check('release/'+field+'-hash', release[field+'Sha256'], actual)
        proofs[str(base/filename)] = actual
    historical = json.loads((base/'release-manifest.json').read_text())['candidate']
    check('release/archive-manifest', historical['archive_sha256'], release['archiveSha256'])
    check('release/files', historical['files'], release['files'])
    check('release/revisions', historical['revisions'], release['revisions'])
    check('release/cleanup', {'removed': True, 'unchanged': True}, read('release-cleanup.json'))
    check('matrix/cases', list(CASES), [r['id'] for r in matrix['cases']])
    for row in matrix['cases']:
        case = row['id']
        check(case+'/pair', ['TASK-065 recorded release' if case == 'old-client' else 'candidate',
                            'TASK-065 recorded release' if case == 'old-server' else 'candidate'],
              [row['client'], row['server']])
    identities = json.loads((root/'source-identities.json').read_text())['after']['client']['files']
    for name, files, prefix in [('old-client/archived-served-sources.json', release['files'], 'diplomacy/'),
                                ('old-client/served-sources.json', identities, ''),
                                ('old-server/served-sources.json', identities, '')]:
        served = read(name)
        check(name+'/required-source', True, {'index.html', 'options/onlineLogic.js'} <= served.keys())
        check(name+'/source-count', True, len(served) > 50)
        for file, digest in served.items():
            check(name+'/'+file, files[prefix+file], digest)

    rows = read('asset-events.jsonl', True)
    rows = [r for r in rows if r['id'] == 'old-client']
    for slot in (1, 2):
        player = f'old-client-p{slot}'
        own = [r for r in rows if r.get('player') == player]
        wire = [r for r in own if r['stage'] == 'wire']
        starts = [i for i, r in enumerate(wire) if r.get('engine') == '40{"browserProtocol":1}' and r['direction'] == 'sent']
        check(player+'/upgrade-count', 1, len(starts))
        old, upgraded = wire[:starts[0]], wire[starts[0]:]
        check(player+'/legacy-handshake', 1, sum(r.get('engine') == '40' and r['direction'] == 'sent' for r in old))
        sequence = [(r['direction'], r['event']) for r in old if 'event' in r]
        check(player+'/rejection-sequence', [('sent','startGameOrConnect'), ('received','lobbyStatus'),
                                            ('sent','nextTurn'), ('received','lobbyStatus')], sequence)
        for i, row in enumerate(r for r in old if r.get('event') == 'lobbyStatus'):
            check(player+f'/reload-message-{i}', MESSAGE, row['args'][0]['json']['occupiedHumans'])
        check(player+'/unsupported-ui-submit', 1, sum(r.get('label') == 'attempt unsupported turn submission' and
              r.get('via') == 'mouse.click' for r in own))
        accepted = [r for r in upgraded if r.get('event') in ('playYourTurn','waitYouTurn','gameStarted') and r['direction']=='received']
        check(player+'/candidate-recovery-rounds', [0,1], [r['args'][0]['json']['gameRound'] for r in accepted])
        check(player+'/candidate-slot', [slot,slot], [r['args'][0]['json']['whooseTurn'] for r in accepted])

    # Use the observed database snapshot only. Neither expected nor pass fields
    # of the old checker supply the oracle: derive initial boards from fixture.
    fixture = read('old-client/declared-fixture.json')['board']
    observed = [c['observed'] for c in read('checkpoints.json')['checkpoints']
                if c['id'] == 'old-client/rejected-state-unchanged']
    check('rejection/snapshot-count', 1, len(observed))
    check('rejection/document-count', 1, len(observed[0]))
    doc = observed[0][0]
    check('rejection/identities', [None,'[user-1]','[user-2]'], doc['playerIndexToUserIndex'])
    check('rejection/round-count', 1, len(doc['rounds']))
    components = doc['rounds'][0]
    check('rejection/components', 3, len(components))
    check('rejection/initial-component', dict(parallelTurnResult=fixture, componentResult=fixture,
          nextTurnIndex=1, turns=[dict(playerIndex=0, gameObject=fixture)]), components[0])
    for slot, income in [(1,9),(2,10)]:
        expected_player = copy.deepcopy(fixture['players'][slot])
        expected_player['gold'] += income  # town +10, extra field noob costs 1
        prepared = dict(playerIndex=slot, player=expected_player, external=[], externalProduction=[],
                        packedTimer=fixture['timers'][slot])
        expected = dict(parallelTurnResult=None, componentResult=fixture, nextTurnIndex=0,
                        turns=[dict(playerIndex=slot, gameObject=None, preparedTurnState=prepared)])
        check(f'rejection/unsubmitted-component-{slot}', expected, components[slot])
    return dict(checks=checks, proofs=proofs, manifestSha256=manifest_sha256,
                assetObservationChecks=len(asset['checks']), sourceHashes=asset['sourceHashes'],
                sourceMismatches=asset['sourceMismatches'], currentSourceValid=asset['currentSourceValid'],
                versionObservationsPass=True, wholeCriterionClosure=False, fullAuditReady=False,
                scope='Historical release bindings, legacy rejection packets and unsubmitted database state',
                limitations=['Pairing labels and server identity require runtime/source review before whole-clause consumption.',
                             'Post-upgrade rounds are packet milestones, not independent full gameplay correctness.',
                             'Screenshots, old-server gameplay, complete turn/persistence and current refresh remain separate obligations.'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive')
    parser.add_argument('manifest_sha256')
    parser.add_argument('output')
    args = parser.parse_args()
    result = review(args.archive, args.manifest_sha256)
    with Path(args.output).open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
    print(f"PASS retained version observations checks={len(result['checks'])} sourceHashes={result['sourceHashes']}")
    print('INCOMPLETE wholeCriterionClosure=false fullAuditReady=false')


if __name__ == '__main__':
    main()
