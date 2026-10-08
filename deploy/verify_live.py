"""Local host verification. No fixed release, task, remote or credential values."""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import urllib.parse
import urllib.request
import journal
from candidate import verify


def run(argv, log, cwd=None, env=None, timeout=300, cancel_timeout=15):
    failure = None
    with log.open('x') as out:
        out.write('COMMAND ' + json.dumps(list(map(str, argv))) + '\n'); out.flush()
        p = subprocess.Popen(list(map(str, argv)), cwd=cwd, env=env,
                             stdout=out, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            p.wait(timeout=timeout)
        except BaseException as error:
            failure = error
            out.write('CANCELLATION ' + ('timeout' if isinstance(error, subprocess.TimeoutExpired)
                                       else type(error).__name__) + '\n'); out.flush()
            # Repeated operator signals must not interrupt the cleanup/reap window.
            handlers = {sig: signal.signal(sig, signal.SIG_IGN)
                        for sig in (signal.SIGTERM, signal.SIGINT)}
            def send(sig):
                try: os.killpg(p.pid, sig)
                except ProcessLookupError: pass  # Child exited at the deadline.
            try:
                send(signal.SIGTERM)
                try:
                    p.wait(timeout=cancel_timeout)
                    out.write('TERMINATION graceful\n')
                except subprocess.TimeoutExpired:
                    send(signal.SIGKILL)
                    p.wait()
                    out.write('TERMINATION forced; cleanup unconfirmed; retain residue evidence\n')
            finally:
                for sig, handler in handlers.items(): signal.signal(sig, handler)
        finally:
            out.write('EXIT_STATUS=' + str(p.returncode) + '\n'); out.flush()
    if failure is not None:
        raise RuntimeError('Verification cancelled: ' + log.name + ' (' +
                           ('timeout' if isinstance(failure, subprocess.TimeoutExpired)
                            else type(failure).__name__) + ')') from failure
    if p.returncode: raise RuntimeError('Verification failed: ' + log.name)
    return log.read_text()


def games(node, cwd, output):
    text = run([node, Path(__file__).with_name('existing_games.js')], output, cwd=cwd)
    return {r['gameID']: r for r in (json.loads(line) for line in text.splitlines() if line.startswith('{'))}


def compare_games(before, after):
    # Real traffic may update or delete documents; only unchanged snapshots are
    # comparable. A previously openable, still-present game must remain openable.
    lost = [k for k, v in before.items() if v['ok'] and k in after and not after[k]['ok']]
    new_failures = [k for k, v in after.items() if not v['ok'] and
                    (k not in before or before[k].get('error') != v.get('error'))]
    if lost or new_failures: raise RuntimeError('Existing-game open regression')
    result = {'status': 'pass', 'baseline': len(before), 'after': len(after),
              'unchanged': sum(k in after and v['documentHash'] == after[k]['documentHash'] for k, v in before.items()),
              'concurrent_removed': sorted(set(before) - set(after)),
              'baseline_failures': [k for k, v in before.items() if not v['ok']],
              'limit': 'read-only loader/turn preparation; not authenticated UI open for real accounts'}
    print('PASS existing-game open baseline ' + json.dumps(result), flush=True)
    return result


def assets(root, manifest, base, google_id, output):
    files = manifest['files']
    seen = {}
    def fetch(relative):
        url = urllib.parse.urljoin(base.rstrip('/') + '/', relative)
        if urllib.parse.urlsplit(url).netloc != urllib.parse.urlsplit(base).netloc:
            raise RuntimeError('Cross-origin local asset')
        with urllib.request.urlopen(url, timeout=20) as response:
            body = response.read()
        digest = hashlib.sha256(body).hexdigest()
        expected = files['diplomacy/' + relative]['sha256']
        if digest != expected: raise RuntimeError('Served file mismatch: ' + relative)
        seen[relative] = digest
        return body.decode('utf-8')
    html = fetch('index.html')
    for src in re.findall(r'<script\b[^>]*\bsrc=["\']([^"\']+)', html):
        if urllib.parse.urlsplit(src).netloc: continue
        fetch(urllib.parse.urlsplit(src).path.removeprefix('./').lstrip('/'))
    auth = fetch('options/googleAuth.js')
    ids = re.findall(r"const GOOGLE_CLIENT_ID\s*=\s*['\"]([^'\"]+)", auth)
    if ids != [google_id.strip()]: raise RuntimeError('Google client ID mismatch')
    # All version constants in served scripts are bound byte-for-byte by hashes.
    report = {'status': 'pass', 'files': seen, 'GOOGLE_CLIENT_ID': ids[0],
              'version_constants': 'served script bytes equal manifest', 'fetched': len(seen)}
    output.write_text(json.dumps(report, indent=2) + '\n')
    print('PASS public-assets Google client ID and version constants ' + json.dumps(report), flush=True)
    return report


def residue(run_id, retained=None):
    # Persist IDs before cleanup so orphan turns/sessions remain discoverable.
    retained = retained or {'gameIDs': [], 'accountIds': []}
    code = '''const run=%s, prior=%s;
const gameIDs=[...new Set([...prior.gameIDs,...db.games.find({smokeRun:run},{gameID:1}).toArray().map(x=>x.gameID)])];
const accountIds=[...new Set([...prior.accountIds,...db.accounts.find({smokeRun:run},{accountId:1}).toArray().map(x=>x.accountId)])];
print(JSON.stringify({run,gameIDs,accountIds,owned:{games:db.games.countDocuments({smokeRun:run}),accounts:db.accounts.countDocuments({smokeRun:run}),lobbies:db.lobbies.countDocuments({smokeRun:run}),turns:db.turns.countDocuments({gameID:{$in:gameIDs}}),gameRounds:db.gameRounds.countDocuments({gameID:{$in:gameIDs}}),sessions:db.sessions.countDocuments({accountId:{$in:accountIds}})},counts:Object.fromEntries(db.getCollectionNames().sort().map(c=>[c,db[c].countDocuments()]))}));''' % (json.dumps(run_id), json.dumps(retained))
    return json.loads(subprocess.check_output(['mongosh', '--quiet', 'gameDB', '--eval', code], text=True, timeout=30))


def final_checks(since, output):
    text = journal.read(since)
    (output / 'journal.log').write_text(text)
    errors = '\n'.join(l for l in text.splitlines() if re.search(r'error|exception|unhandled|failed|    at ', l, re.I))
    (output / 'journal-error-grep.txt').write_text(errors)
    if errors or not all(s in text for s in ['@@actionEnforce on', '@@hiddenInfo on']):
        raise RuntimeError('Final journal checks failed')
    print('PASS final-checks canonical UTC journal; enforcement and hidden information on', flush=True)
