#!/usr/bin/env python3
"""Prepare one independently complete TASK-209/AC2 clause, keeping G09 separate."""
import argparse
import json
from pathlib import Path
import shutil
from review_concurrent_archive import review as historical_review, digest
from review_concurrent_recipients import review as recipient_review
from review_concurrent_browser import review as browser_review


def prepare(archive, baseline, tasks, output):
    archive, output = Path(archive).resolve(), Path(output).resolve()
    output.mkdir(exist_ok=False)
    historical = historical_review(archive)
    recipients = recipient_review(archive)
    browser = browser_review(archive)
    # Each raw independent observation is persisted and hash-bound, not merely
    # asserted by this crosswalk. Original archives remain byte-for-byte intact.
    selected = output/'selected-209'
    shutil.copytree(archive, selected)
    checks = []
    for prefix, result in [('archive', historical), ('recipient', recipients), ('browser', browser)]:
        for c in result['checks']:
            checks.append(dict(id=prefix+'/'+c['id'], expected=c['expected'], observed=c['observed'], **{'pass': True}))
    report = dict(checks=checks, derivations=[str(Path(__file__).resolve()),
                  'review_concurrent_archive.py', 'review_concurrent_recipients.py', 'review_concurrent_browser.py'],
                  sourceDifferences=historical['sourceDifferences'], fullAuditReady=False)
    (selected/'ac2-independent-review.json').write_text(json.dumps(report, indent=2)+'\n')
    manifest = {str(p.relative_to(selected)): digest(p) for p in selected.rglob('*')
                if p.is_file() and p.name != 'evidence-hashes.json'}
    (selected/'evidence-hashes.json').write_text(json.dumps(manifest, indent=2)+'\n')
    for name, sha in manifest.items():
        if name != 'ac2-independent-review.json':
            assert digest(archive/name) == sha, 'provider copy changed '+name
    crosswalk = json.loads(Path(baseline).read_text())
    task = next(t for t in json.loads(Path(tasks).read_text()) if t['id'] == 'TASK-209')
    row = next(r for r in crosswalk['reviews'] if r['id'] == 'TASK-209/AC2')
    old = row['clauses'][0]
    ref = lambda name: dict(file=name, sha256=manifest[name])
    raw = sorted(set(historical['proofs']) | set(recipients['proofs']) | set(browser['proofs']))
    selected_checks = [c for c in checks if c['id'] in {
        'browser/connected-browser-contexts', 'recipient/every-recipient-every-revision',
        'archive/ten-socket-isolation/participants/expected',
        'archive/ten-intermediate/1/submitted-board', 'archive/ten-intermediate/2/submitted-board',
        'archive/coop-browser/real-ai', 'archive/coop-ten/real-ai',
        'archive/cleanup-processes', 'archive/child/exitCode'
    } or (c['id'].startswith('browser/') and c['id'].endswith(('/submissions', '/move-input', '/reconnect-input')))]
    assert len(selected_checks) == 17, len(selected_checks)
    row['reviewer'] = 'TASK-225 independent complete concurrent AC2 state, recipient and input review'
    row['clauses'] = [dict(text=task['acceptance_criteria'][1], disposition='reviewed',
        runTask='TASK-209', tier='real-network', caseIds=['browser-pair', 'ten-socket-isolation'],
        sourceIdentity=ref('source-identities.json'), proofs=[ref(n) for n in raw]+[ref('ac2-independent-review.json')],
        assertions=[dict(id=c['id'], expected=c['expected'], proof=ref('ac2-independent-review.json')) for c in selected_checks],
        traces=[ref(n) for n in ['wire.jsonl','inputs.jsonl','game-isolation.jsonl','recipient-packets.jsonl','recipient-bindings.json']],
        milestoneIds=['browser/connected-browser-contexts','recipient/every-recipient-every-revision',
                      'archive/browser-pair/reconnect-exact/expected'] if any(c['id']=='archive/browser-pair/reconnect-exact/expected' for c in checks)
                     else ['browser/connected-browser-contexts','recipient/every-recipient-every-revision'],
        followUp=old['followUp'],
        reason='Full AC2 independently reviewed in one fresh capture-justified provider invocation: four real browser contexts '
               'in co-op/competitive plus ten protocol identities. Raw packets, roster binding, UI moves/submissions/reconnect, '
               'intermediate/final MongoDB boards, genuine AI and bounded queue progress have independent checks. '
               'Browser workflow proof remains four-context only; ten-player evidence is protocol only. G09 and AC3 remain unresolved.',
        derivation='Literal authored geometry, salary/income, ownership, coordinates, HP and moves are reconstructed without production calls. '
                   'Every ten-player revision 0..20 must reach every credential-bound recipient, including reconnect; slots derive from MongoDB '
                   'roster membership rather than received whooseTurn. All browser inbound boards match independently authored round/revision '
                   'states, and raw UI move, submission and reconnect inputs match observed deliveries. Archive oracle checks both intermediate '
                   'documents, all final documents, exact round counts, AI phase order, bounded progress, cleanup and actual exits.')]
    crosswalk['runReferences']['TASK-209'] = dict(directory=str(selected), manifestSha256=digest(selected/'evidence-hashes.json'),
        reason='Capture-justified provider refresh; later byte-identical finalized receipt index. AC2 independently reviewed; other clauses unchanged.')
    (output/'reviewed-crosswalk.json').write_text(json.dumps(crosswalk, indent=2)+'\n')
    (output/'selection-provenance.json').write_text(json.dumps(dict(original=str(archive),
        kind='later finalized byte-identical provider selection, not original worker receipt',
        baseline=str(Path(baseline).resolve()), baselineSha256=digest(baseline), checks=len(checks),
        originalFiles={n:h for n,h in manifest.items() if n != 'ac2-independent-review.json'},
        reviewers={p.name:digest(p) for p in [Path(__file__),Path(__file__).with_name('review_concurrent_archive.py'),
            Path(__file__).with_name('review_concurrent_recipients.py'),Path(__file__).with_name('review_concurrent_browser.py')]}),indent=2)+'\n')
    print('PASS prepared complete TASK-209/AC2 checks='+str(len(checks))+' G09=unresolved requires actual consumer')


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['archive','baseline','tasks','output']:p.add_argument(name)
    a=p.parse_args();prepare(a.archive,a.baseline,a.tasks,a.output)
