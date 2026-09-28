"""Independent saved-snapshot checks; never grants whole-row coverage.

The archive binding must be declared before inspection. Current-source comparison
reports staleness separately from corruption of immutable historical evidence.
"""
import argparse
import hashlib
import json
from pathlib import Path


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def bound_read(root, name, hashes):
    root = Path(root).resolve(strict=True)
    file = (root / name).resolve(strict=True)
    require(file.is_relative_to(root) and file != root, "proof escape")
    require(name in hashes and digest(file) == hashes[name], "changed or unbound proof: " + name)
    return file.read_bytes()


def sentinel_checks(document):
    """Derive membership and preservation from raw Mongo documents, not pass flags."""
    checks = []

    def check(name, expected, observed):
        require(type(expected) is type(observed) and expected == observed, name)
        checks.append(dict(id=name, expected=expected, observed=observed, pass_=True))

    before, after = document['before'], document['after']
    check('sentinel/full-documents-preserved', before, after)
    games, accounts = before['games'], before['accounts']
    check('sentinel/game-count', 2, len(games))
    check('sentinel/account-count', 4, len(accounts))
    check('sentinel/namespaces', ['ordinary', 'run-b'], sorted(
        'ordinary' if g.get('smokeRun') is None else g['smokeRun'] for g in games))
    check('sentinel/distinct-game-identities', 2, len({g['gameID'] for g in games}))
    check('sentinel/distinct-account-identities', 4, len({a['userId'] for a in accounts}))
    observed_members = []
    for game in games:
        run = game.get('smokeRun')
        name = run or 'ordinary'
        members = [x for x in game['playerIndexToUserIndex'] if x is not None]
        check(name + '/two-distinct-members', 2, len(set(members)))
        check(name + '/two-slots', 2, len(members))
        assigned = [a for a in accounts if a['gameID'] == game['gameID']]
        check(name + '/account-membership', sorted(members), sorted(a['userId'] for a in assigned))
        check(name + '/account-namespace', [run, run], [a.get('smokeRun') for a in assigned])
        observed_members.extend(members)
    check('sentinel/no-shared-members', 4, len(set(observed_members)))
    check('sentinel/unrelated-database', [{'_id': 'keep', 'value': 123}], before['other'])
    return [{('pass' if k == 'pass_' else k): v for k, v in c.items()} for c in checks]


def inspect(root, coverage_sha256):
    root = Path(root).resolve(strict=True)
    require(digest(root / 'coverage-results.json') == coverage_sha256, 'coverage binding')
    coverage = json.loads((root / 'coverage-results.json').read_text())
    hashes = coverage['evidenceHashes']
    # Check every original bound proof, including empty streams.
    for name in hashes:
        bound_read(root, name, hashes)
    read = lambda name: json.loads(bound_read(root, name, hashes))
    checks = sentinel_checks(read('sentinel-before-after.json'))
    identities = read('source-identities.json')
    freshness = []
    for role, record in identities['after'].items():
        require(record['repo'] == {'client': '/root/diplomacy', 'server': '/root/diplomacy_server'}[role],
                'unexpected source repository')
        base = Path(record['repo']).resolve(strict=True)
        for name, expected in record['files'].items():
            file = (base / name).resolve()
            require(file.is_relative_to(base) and file != base, 'source escape')
            require(identities['before'][role]['files'][name] == expected, 'source changed during provider')
            actual = digest(file) if file.is_file() else None
            freshness.append(dict(path=str(file), expected=expected, observed=actual, current=actual == expected))
    trace = read('namespace-adversarial-cases.json')['trace']
    require(len(trace) == 16, 'original trace count')
    # These fields are absent from this capture contract, not inferred from a PASS.
    raw_request_fields = ['request', 'sentAt', 'receivedAt', 'socketId']
    missing = {field: sum(field not in event for event in trace) for field in raw_request_fields}
    return dict(
        targets=['TASK-223/AC1', 'TASK-223/AC2', 'TASK-223/AC3'],
        fullInvocation=False, wholeCriterionCredit=False, successorPublished=False,
        decision='INSUFFICIENT_WHOLE_ROW_PROOF',
        tier='offline independent review of archived Mongo snapshots; no fresh network/UI execution',
        archive=str(root), bindings={str(root / 'coverage-results.json'): coverage_sha256,
                                    **{str(root / k): v for k, v in hashes.items()}},
        checkpoints=checks, freshness=freshness, missingTraceFields=missing,
        clauses=[
            dict(target='TASK-223/AC1', complete=False,
                 missing='Whole implementation review must bind authenticated identity derivation, immutable socket binding, matchmaking and lookup handlers to tested source; saved provider source differs from current source.'),
            dict(target='TASK-223/AC2', complete=False,
                 supported='Two ordinary and two run-b members derive independently from raw game/account documents.',
                 missing='Retain pre-cleanup run-a documents and identity-to-allowlist bindings, redacted actual forged values, socket/session identity, authorization expiry and event times, and pre/post expired-turn state. The current trace stores forged key names and response event names only.'),
            dict(target='TASK-223/AC3', complete=False,
                 supported='All ordinary/run-b game/account and unrelated database sentinel documents are exactly preserved.',
                 missing='Retain complete owned-resource inventories before/after cleanup (including turn collections), an independent secret-handling review and bound cleanup-handler scope review. Zero count/pass summaries alone do not independently establish the complete deletion scope.')],
        followUp='Freeze the smoke provider source/helper closure, finish complete clause reviews and capture the missing observations together before one changed acquisition. Resolve the TASK-223 versus TASK-225 artifact-location constraint before acquisition. Do not rerun this unchanged archive or grant partial-row credit.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive')
    parser.add_argument('coverage_sha256')
    parser.add_argument('output')
    args = parser.parse_args()
    result = inspect(args.archive, args.coverage_sha256)
    with open(args.output, 'x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
    print('INSUFFICIENT_WHOLE_ROW_PROOF TASK-223/AC1..3 wholeCriterionCredit=false '
          f"snapshotChecks={len(result['checkpoints'])} staleSources={sum(not x['current'] for x in result['freshness'])}")
    raise SystemExit(2)
