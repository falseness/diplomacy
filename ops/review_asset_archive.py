#!/usr/bin/env python3
"""Independently review retained TASK-211 AC1 asset observations for TASK-225.

The caller must supply a previously recorded coverage manifest hash. This is a
prerequisite reader, never a current-source certificate or whole-audit gate.
"""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit

DEP = 'https://cdn.socket.io/socket.io-3.0.0.js'
CASES = ('cold-warm-delay', 'failed-recovery')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def review(root, manifest_sha256):
    root = Path(root).resolve(strict=True)
    checks, proofs = [], {}

    def check(name, expected, observed):
        if type(expected) is not type(observed) or expected != observed:
            raise ValueError('asset-proof: ' + name)
        checks.append(dict(id=name, expected=expected, observed=observed, **{'pass': True}))

    def contained(name):
        path = (root/name).resolve(strict=True)
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError('asset-proof: escaped-proof')
        return path

    manifest_path = contained('coverage-results.json')
    check('manifest-binding', manifest_sha256, sha(manifest_path))
    manifest = json.loads(manifest_path.read_text())['evidenceHashes']

    def read(name, lines=False):
        path = contained(name)
        check('hash/'+name, manifest[name], sha(path))
        proofs[name] = sha(path)
        return ([json.loads(line) for line in path.read_text().splitlines()]
                if lines else json.loads(path.read_text()))

    identities = read('source-identities.json')
    check('source-stable-during-run', identities['before'], identities['after'])
    requests = read('asset-requests.jsonl', True)
    historical = identities['after']['client']['files']
    # Expectations come from the frozen source manifest and the requested
    # scenario, never from a checkpoint's expected/pass fields.
    for case in CASES:
        record = read(f'{case}/{case}-p1-assets.json')
        served = read(f'{case}/served-sources.json')
        check(case+'/kind', case, record['kind'])
        check(case+'/html-shipped', historical['index.html'], served['index.html'])
        rows = [r for r in requests if r['id'] == case and r['player'] == case+'-p1']
        check(case+'/requests-present', True, bool(rows))
        # The participant receipt omits aggregate routing fields. Preserve order
        # and duplicates. Receipt is written before a later identity reconnect;
        # it must be an exact prefix, while all subsequent requests are reviewed.
        projected = [{k:v for k,v in r.items() if k not in ('id','player','phase')} for r in rows]
        check(case+'/participant-trace-prefix', True, bool(record['requests']) and record['requests'] == projected[:len(record['requests'])])
        phases = ('cold', 'warm') if case == CASES[0] else ('cold', 'recovered')
        for phase in phases:
            html = [r for r in rows if urlsplit(r['url']).path == '/' and r.get('observedPhase') == phase]
            check(case+'/'+phase+'/html-present', True, bool(html))
            for i, r in enumerate(html):
                check(f'{case}/{phase}/html-{i}', (200, historical['index.html']), (r['status'], r['sha256']))
        successful = [r for r in rows if r['url'] == DEP and r.get('status') == 200]
        check(case+'/dependency-present', True, bool(successful))
        dependency_hashes = {r['sha256'] for r in successful}
        check(case+'/same-dependency-bytes', 1, len(dependency_hashes))
        check(case+'/dependency-nonempty', True, all(r['bytes'] > 10000 for r in successful))
        expected_phases = {'cold','warm'} if case == CASES[0] else {'recovered'}
        check(case+'/dependency-phases', sorted(expected_phases), sorted({r['observedPhase'] for r in successful}))
        for i, r in enumerate(rows):
            url = urlsplit(r['url'])
            name = url.path.lstrip('/') or 'index.html'
            if url.hostname == '127.0.0.1' and name in historical and 'sha256' in r:
                check(f'{case}/served-request-{i}/{name}', historical[name], r['sha256'])
        if case == CASES[0]:
            check(case+'/delay-at-least-1000ms', True, record['delayMs'] >= 1000)
            check(case+'/not-failed', False, record['failed'])
            check(case+'/online-logic-cached', True, any(urlsplit(u).path == '/options/onlineLogic.js' for u in record['cachedRequests']))
            cold_hash = next(iter(dependency_hashes))
        else:
            failures = [r for r in rows if r['url'] == DEP and r.get('failure') == 'net::ERR_FAILED']
            check(case+'/failure-observed', 1, len(failures))
            check(case+'/failure-before-recovery', True, rows.index(failures[0]) < rows.index(successful[0]))
            check(case+'/same-dependency-after-recovery', [cold_hash], sorted(dependency_hashes))
        check(case+'/unexpected-browser-errors', [], read(case+'/browser-errors.json'))

    mismatches, source_count = [], 0
    for label, identity in identities['after'].items():
        repo = Path(identity['repo']).resolve(strict=True)
        for name, expected in identity['files'].items():
            path = (repo/name).resolve()
            if not path.is_relative_to(repo):
                raise ValueError('asset-proof: escaped-source')
            actual = sha(path) if path.is_file() else None
            source_count += 1
            if actual != expected:
                mismatches.append(dict(repo=label, path=name, expected=expected, observed=actual))
    return dict(checks=checks, proofs=proofs, manifestSha256=manifest_sha256,
                sourceHashes=source_count, sourceMismatches=mismatches,
                assetObservationsPass=True, currentSourceValid=not mismatches,
                wholeCriterionClosure=False, fullAuditReady=False,
                scope='TASK-211/AC1 retained browser asset observations only',
                limitations=['Delay/cache are recorded browser instrumentation observations; no fresh browser execution.',
                             'No independent version, gameplay, persistence or screenshot review in this reader.',
                             'Do not consume as covered-current or a complete clause review.'],
                followUp='Freeze final dependencies, then refresh the bounded assets-versions provider if current proof is required; review all clause ownership and consume with the validated catalog adapter.')


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
    print(f"PASS retained asset observations checks={len(result['checks'])} sourceHashes={result['sourceHashes']} sourceMismatches={len(result['sourceMismatches'])}")
    print('INCOMPLETE wholeCriterionClosure=false fullAuditReady=false')


if __name__ == '__main__':
    main()
