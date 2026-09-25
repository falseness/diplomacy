#!/usr/bin/env python3
"""Recover TASK-231's transient oracle repair without inventing historical bytes.

Reconstruction is accepted only when both files match independently archived
source identities. Retained tool calls explain the transformations; they are
never executed by this reader. This proves one AC2 subclause, not the criterion.
"""
import argparse
import hashlib
import json
from pathlib import Path


def sha(data):
    return hashlib.sha256(data).hexdigest()


def reconstruct(baseline):
    text = baseline.replace("'use strict';", "'use strict';\nprocess.env.PLAYWRIGHT_BROWSERS_PATH ??= '0';", 1)
    text = text.replace("!file.startsWith('artifacts/')&&fs.statSync", "!file.startsWith('artifacts/')&&fs.existsSync(path.join(repo,file))&&fs.statSync")
    text = text.replace("for(const [preset,size] of ['tiny','normal','big'].entries())", "const sizes=process.env.COOP_EXHAUSTIVE_PRESETS==='1'?['tiny','normal','big']:['tiny'];\n        for(const [preset,size] of sizes.entries())")
    text = text.replace('const side=Math.max({tiny:11,normal:15,big:21}[size],Math.ceil({tiny:15,normal:25,big:39}[size]*Math.sqrt(count/4)));', 'const side=expectedMap(size,count,1).side;')
    text = text.replace('new Set(roomIDs).size,3', 'new Set(roomIDs).size,sizes.length')
    text = text.replace("console.log('PASS browser-online presets=3 contexts=6 screenshots=12 reconnects=3 console-errors=0');", "console.log(`PASS browser-online presets=${sizes.length} contexts=${sizes.length*2} screenshots=${sizes.length*4} reconnects=${sizes.length} console-errors=0`);")
    repaired = text.replace('const side=expectedMap(size,count,1).side;', 'const side={tiny:14,normal:28,big:68}[size];')
    repaired = repaired.replace('Date.now=()=>1700000000000;', '').replace(';window.requestAnimationFrame=()=>0', '')
    return text, repaired


def review(history, records, current):
    history, records, current = map(Path, (history, records, current))
    proofs = []

    def read(path):
        path = path.resolve(strict=True)
        data = path.read_bytes()
        proofs.append(dict(file=str(path), sha256=sha(data)))
        return data.decode()

    retained = json.loads(read(records))
    # Bind each excerpt to the actual retained record, not a paraphrased command.
    session = Path(retained['source']).read_bytes()
    if sha(session) != retained['sha256']:
        raise ValueError('changed-session')
    lines = session.decode().splitlines()
    if [r['line'] for r in retained['calls']] != [114, 185, 233]:
        raise ValueError('incomplete-edit-provenance')
    for call in retained['calls']:
        if json.loads(lines[call['line'] - 1]) != call['record']:
            raise ValueError('substituted-edit-record')
        for output in call['outputs']:
            if not any(json.loads(line) == output for line in lines):
                raise ValueError('substituted-edit-output')
    text, repaired = reconstruct(read(history / 'baseline/browser-online.test.js'))
    checks = []
    for name, source in [('repro-05', text), ('repro-06', repaired)]:
        identity = json.loads(read(history / name / 'focused/source-identities.json'))
        expected = identity['before']['server']['files']['tests/coop/browser-online.test.js']
        observed = sha(source.encode())
        if expected != observed:
            raise ValueError('historical-source-mismatch:' + name)
        checks.append(dict(id=name + '-exact-source', expected=expected, observed=observed, passed=True))
    if read(current) != repaired:
        raise ValueError('current-source-mismatch')
    original = read(history / 'repro-05/focused/children/001-coop_browser-online/stdout.log')
    if "error: 'expectedMap is not a function'" not in original:
        raise ValueError('missing-original-failure')
    positive = read(history / 'repro-06/focused/children/001-coop_browser-online/stdout.log')
    if 'ok 1 - browser preset requests, peer maps and reconnect retain committed metadata' not in positive.splitlines():
        raise ValueError('missing-passing-regression')
    return dict(subclause='map-oracle-repair-provenance', passed=True, criterionCovered=False,
                explanation='Transient uncommitted expectedMap call replaced by literal dimensions; both reconstructed files match their original tested SHA-256. No helper/export repair occurred.',
                checks=checks, proofs=proofs, session=retained['source'], sessionSha256=retained['sha256'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['history', 'records', 'current', 'output']:
        parser.add_argument(name)
    args = parser.parse_args()
    result = review(args.history, args.records, args.current)
    Path(args.output).write_text(json.dumps(result, indent=2) + '\n')
    print('PASS map-oracle-repair-provenance historical_source_matches=2 current_source_match=true criterionCovered=false')
