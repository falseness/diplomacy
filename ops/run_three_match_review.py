#!/usr/bin/env python3
"""Bounded TASK-225 supplement, separate from the prerequisite-gated full audit."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from review_three_match import review, interleaving

ROOT = Path('/root/diplomacy')
NODE = '/usr/local/bin/node20'
BASELINE = ROOT/'artifacts/TASK-225/review-30/prepared/reviewed-crosswalk.json'
BASELINE_HASH = '81f4f5931d10393f55fd32604994c951d064355d421882348d214455d9ac4e24'


def digest(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def sources():
    result = {}
    for role, repo in [('client', ROOT), ('server', Path('/root/diplomacy_server'))]:
        git = lambda *args: subprocess.check_output(['git', *args], cwd=repo).decode()
        files = git('ls-files', '-z').split('\0')
        if role == 'client':
            files += ['ops/'+n for n in ['task225-three-match.test.js', 'task225-three-match-observer.js', 'review_three_match.py', 'run_three_match_review.py']]
        result[role] = dict(repo=str(repo), head=git('rev-parse', 'HEAD').strip(), dirty=git('status', '--porcelain', '--untracked-files=no'),
                            files={f: digest(repo/f) for f in sorted(set(files)) if f and not f.startswith('artifacts/') and (repo/f).is_file()})
    return result


def main():
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=False)
    started = time.time()
    stamp = lambda t: datetime.datetime.fromtimestamp(t, datetime.timezone.utc).isoformat()
    write = lambda n, v: (out/n).write_text(json.dumps(v, indent=2)+'\n')
    env = dict(os.environ, NODE_PATH='/opt/diplomacy/node_modules', ONLINE_EVIDENCE_DIR=str(out))
    exits = []
    log = (out/'verification.log').open('w', buffering=1)

    def command(argv, cwd=ROOT):
        log.write('COMMAND '+json.dumps([str(x) for x in argv])+'\nCWD='+str(cwd)+'\n')
        p = subprocess.run([str(x) for x in argv], cwd=cwd, env=env, stdout=log, stderr=log,
                           timeout=max(1, started+3300-time.time()))
        exits.append(p.returncode)
        log.write('ACTUAL_EXIT='+str(p.returncode)+'\n')
        if p.returncode:
            raise RuntimeError('required command failed '+str(argv))

    passed = False
    try:
        write('supplement-plan.json', dict(scope='TASK-225 prerequisite observation only, not full audit',
              cases=['historical-sequential-rejection', 'three-match-interleaving', 'deleted-game-rejection', 'swapped-identity-rejection'],
              estimateMs=600000, targetMs=2700000, stopWorkMs=3300000, budgetMs=3600000,
              sourceEvidence='source-identities.json', baseline=str(BASELINE), baselineHash=BASELINE_HASH,
              workload='two seed-1 H2 tiny co-op fixtures, four enclosed genuine imps each; competitive control; two rounds',
              evidenceTiers=['four shipped browser contexts', 'extra H2 Socket.IO game', 'real HTTPS/MongoDB/AI'],
              exclusions=['no long-workload closure inferred from short fixture', 'no ten-player repeat', 'no full TASK-225 gate before prerequisites']))
        assert digest(BASELINE) == BASELINE_HASH
        old = ROOT/'artifacts/TASK-209/green-14/game-isolation.jsonl'
        try:
            interleaving([json.loads(l) for l in old.read_text().splitlines()], ['coop-browser', 'competitive-browser', 'coop-ten'])
        except ValueError as e:
            assert str(e) == 'interleaving: sequential co-op lifetimes', str(e)
            write('historical-negative.json', dict(rejected=True, reason=str(e), proof=str(old), sha256=digest(old)))
            log.write('PASS historical negative: '+str(e)+'\n')
        else:
            raise AssertionError('historical sequential chronology accepted')
        before = sources()
        write('source-identities.json', dict(before=before))
        command([NODE, ROOT/'ai/task245-supervisor.js', out/'owned.jsonl', str(int((started+3300)*1000)),
                 NODE, '--test', ROOT/'ops/task225-three-match.test.js'])
        after = sources()
        write('source-identities.json', dict(before=before, after=after, unchanged=before == after))
        assert before == after, 'source changed during observation'
        result = review(out)
        write('independent-review.json', result)
        log.write(f"PASS three-match observations={result['checkCount']} closures=0 fullAuditReady=false\n")
        controls = []
        for kind in ['deleted-game', 'swapped-identity']:
            with tempfile.TemporaryDirectory(prefix='task225-three-match-control-') as temporary:
                copy = Path(temporary)/'proof'
                shutil.copytree(out, copy)
                p = copy/'game-isolation.jsonl'
                rows = [json.loads(l) for l in p.read_text().splitlines()]
                if kind == 'deleted-game':
                    rows = [r for r in rows if r['id'] != 'coop-extra']
                else:
                    for r in rows:
                        if r['id'] in ['coop-extra', 'coop-browser']:
                            r['id'] = 'coop-browser' if r['id'] == 'coop-extra' else 'coop-extra'
                p.write_text(''.join(json.dumps(r)+'\n' for r in rows))
                try:
                    review(copy)
                except ValueError as e:
                    controls.append(dict(case=kind, rejected=True, reason=str(e)))
                    log.write('PASS '+kind+' rejected: '+str(e)+'\n')
                else:
                    raise AssertionError(kind+' control accepted')
        write('supplement-controls.json', controls)
        for repo in [ROOT, Path('/root/diplomacy_server')]:
            r = subprocess.run(['git', 'diff', 'HEAD', '--check'], cwd=repo, capture_output=True)
            (out/(repo.name+'-diff-check.txt')).write_bytes(r.stdout+r.stderr)
            log.write(f'COMMAND git diff HEAD --check CWD={repo} ACTUAL_EXIT={r.returncode} OUTPUT_BYTES={len(r.stdout+r.stderr)}\n')
            exits.append(r.returncode)
            assert r.returncode == 0
            staged = subprocess.check_output(['git', 'diff', '--cached', '--name-only'], cwd=repo).decode().splitlines()
            assert not any(f.startswith('artifacts/') for f in staged)
        assert digest(BASELINE) == BASELINE_HASH
        assert time.time()-started < 3300
        passed = True
    except Exception:
        import traceback
        traceback.print_exc(file=log)
        raise
    finally:
        receipt = out/'owned.jsonl.cleanup.json'
        cleanup = json.loads(receipt.read_text()).get('cleanup', False) if receipt.exists() else False
        end = time.time()
        write('supplement-budget.json', dict(startedAt=stamp(started), finishedAt=stamp(end), elapsedMs=round((end-started)*1000),
              targetMs=2700000, stopWorkMs=3300000, budgetMs=3600000, exits=exits, cleanup=cleanup,
              passObservation=passed and cleanup and end-started < 3600, fullAuditReady=False))
        log.close()
        write('evidence-hashes.json', {str(p.relative_to(out)): digest(p) for p in out.rglob('*') if p.is_file()})
    print('PASS supplemental observation; TASK-225 remains pending, G09 long workload unresolved')


if __name__ == '__main__':
    main()
