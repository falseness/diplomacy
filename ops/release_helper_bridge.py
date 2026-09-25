"""Trusted-caller bridge for intermediate release operations, never authorization.

Input comes over stdin. The caller must authenticate the observation collector
and validate release prerequisites. No environment/CLI prerequisite bypass exists.
"""
import json
from pathlib import Path
import subprocess
import sys
import time

import prepare_runtime_bundle as bundle
import prepare_rollback as rollback


def dispatch(request):
    stop_at = request['stopAtMs'] / 1000  # JS Unix milliseconds -> Python seconds
    bundle.check_deadline(stop_at)
    c = request['config']
    out = Path(request['outputDir'])
    if request['stage'] == 'paired-runtime-package':
        return bundle.prepare(*(Path(c[k]) for k in
            ('client', 'server', 'sources', 'runtime', 'dependencies', 'runtimeReceipt')),
            out / 'candidate', stop_at)
    if request['stage'] == 'current-rollback':
        def observe():
            bundle.check_deadline(stop_at)
            result = subprocess.run(c['observerArgv'], check=True, capture_output=True,
                                    timeout=max(0.001, stop_at - time.time()))
            return json.loads(result.stdout)
        return rollback.retain(c['rollbackRoots'], Path(c['observationFile']),
            c['observationSha256'], observe, out / 'rollback', stop_at)
    if request['stage'] == 'archive-readback':
        pair = json.loads((out / 'candidate/paired-package.json').read_bytes())
        prior = json.loads((out / 'rollback/retained-installation.json').read_bytes())
        for name, digest in [('candidate/candidate.tar.gz', pair['source_archive_sha256']),
                             ('candidate/runtime-dependencies.tar.gz', pair['runtime_archive_sha256']),
                             ('rollback/prior-installation.tar.gz', prior['archive_sha256'])]:
            if bundle.source_package.sha((out / name).read_bytes()) != digest:
                raise ValueError('archive-hash-mismatch:' + name)
        bundle.verify_archive(out / 'candidate/runtime-dependencies.tar.gz', pair['inventory'], stop_at)
        rollback.bundle.verify_archive(out / 'rollback/prior-installation.tar.gz', prior['inventory'], stop_at)
        print('PASS upstream archives read back before guarded plan')
        return {'source': pair['source_archive_sha256'], 'runtime': pair['runtime_archive_sha256'],
                'rollback': prior['archive_sha256']}
    raise ValueError('unknown-helper-stage')


if __name__ == '__main__':
    try:
        dispatch(json.load(sys.stdin))
    except Exception as error:
        print('HELPER_FAILURE=' + str(error), file=sys.stderr)
        sys.exit(1)
