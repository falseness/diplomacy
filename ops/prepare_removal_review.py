#!/usr/bin/env python3
"""Prepare immutable TASK-225 clause reviews from independently checked TASK-244 proof.

The actual JS inventory must consume the result before any closure is claimed.
Original archives, plans and evidence manifests are never modified.
"""
import argparse
import datetime
import json
import shutil
from pathlib import Path

from review_removal_archive import CASES, digest, review


def prepare(archive, reviews, tasks, output):
    output = Path(output).absolute()
    output.mkdir(exist_ok=False)
    archive = Path(archive).absolute()
    result = review(archive)
    save = lambda name, value: (output / name).write_text(json.dumps(value, indent=2) + '\n')
    save('independent-observations.json', result)
    selected = output / 'selected-244'
    shutil.copytree(archive, selected)
    # Expose existing files, including final reports, as a later read-only index.
    # This is not a claim that a final report was hashed before it was written.
    manifest = result['originalFiles']
    save('selected-244/evidence-hashes.json', manifest)
    save('selected-244-provenance.json', dict(kind='later-byte-identical-archive-index',
        attestedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        originalRun=str(archive), copiedFiles=manifest,
        note='Later index of completed original bytes; no new execution or original manifest edit.'))
    for file, sha in manifest.items():
        if digest(selected / file) != sha or digest(archive / file) != sha:
            raise ValueError('copy changed: ' + file)
    crosswalk = json.loads(Path(reviews).read_text())
    all_tasks = json.loads(Path(tasks).read_text())
    task = next(t for t in all_tasks if t['id'] == 'TASK-244')
    ref = lambda file: dict(file=file, sha256=manifest[file])
    proof_names = ['verification-plan.json', 'verification-budget.json', 'coverage-results.json',
                   'verification.log', 'checkpoints.json', 'source-identities.json',
                   'initial-fixture.json', 'obsolete-rejection-payloads.json',
                   'request-traces.jsonl', 'state-traces.json', 'transport-manifest.json',
                   'removal-inventory.json', 'removed-runtime-rg.txt', 'remaining-references-rg.txt',
                   'server-diff-check.txt', 'client-diff-check.txt', 'creation-regression/checkpoints.json']
    # The full independent reader checks every original file and semantic trace.
    # Consumer assertions bind original persisted checkpoint IDs, not this report's flag.
    reason = (
        'Independently reviewed generated tiny H2 seed-1 fixture; production Socket.IO handlers '
        'use test-owned loopback HTTP and in-memory persistence. This is local-fixture evidence, '
        'not HTTPS/MongoDB durability or shipped-browser UI coverage. Exact 17 obsolete '
        'creation/save payloads reject with unchanged rows; four complete rounds, revision 8, '
        'six imp plus six spitter wave, reconnect and socket/service cleanup are checked. '
        'Original full traces, empty removal/diff outputs, scoped source inventory, runtime '
        'log and final command/budget receipts are bound by a later byte-identical index. '
        'Independent reader checks all 117 creation-regression assertions too.')
    derivation = (
        'Initial noob HP=2/moves=2 and gold=100; one town income 4 plus seven suburbs minus '
        'noob upkeep 1 gives 10 per human refresh. Two submissions per round imply revisions '
        '0..8 after four rounds. Completed-round storage is compared to every recipient '
        'after exactly one next-active-human income projection. Round 4 has six imp and '
        'six spitter. Eight creation fixtures derive by one explicit obsolete-format '
        'mutation; nine saved fixtures derive from the valid stored game. Rejected '
        'requests preserve exact baseline rows, including dynamic identities checked '
        'against the ownership manifest. Checkpoint expected and observed values both '
        'must equal these independent derivations; a saved pass flag is insufficient.')
    selected_ids = {
        1: [c for c in CASES if '/' in c] + ['current-wave'],
        2: CASES,
        3: ['current-create', 'current-advance', 'cleanup'],
        4: ['current-create', 'current-advance', 'cleanup'],
        5: ['current-create', 'current-wave', 'current-advance'],
        6: ['cleanup'],
    }
    for index, text in enumerate(task['acceptance_criteria'], 1):
        row = next(r for r in crosswalk['reviews'] if r['id'] == 'TASK-244/AC' + str(index))
        old = row['clauses'][0]
        clause = dict(text=text, disposition='reviewed', runTask='TASK-244', tier='local-fixture',
            caseIds=CASES, sourceIdentity=ref('source-identities.json'),
            proofs=[ref(f) for f in proof_names], traces=[ref('request-traces.jsonl')],
            assertions=[a for a in result['assertions'] if a['id'] in selected_ids[index]],
            reason=reason, derivation=derivation, followUp=old['followUp'])
        if index == 4:
            # TASK-245 intentionally renamed this file to avoid broad test discovery.
            # Preserve the literal unsatisfied path clause; do not silently reinterpret it.
            split = text.index(' Save actual proof')
            unresolved = dict(old, text=text[:split],
                reason='The exact required tests/coop/task244-verification.test.js path is absent; '
                       'later TASK-245 intentionally renamed the entry to task244-verification.js. '
                       'The current entry runs successfully but that does not satisfy the literal path requirement.')
            unresolved['followUp'] = dict(old['followUp'], scope='Resolve the literal TASK-244/AC4 entry-point path against the intentional TASK-245 no-autodiscovery policy; keep current tested .js entry and do not introduce expensive automatic test discovery.')
            clause['text'] = text[split:]
            row['clauses'] = [unresolved, clause]
        else:
            row['clauses'] = [clause]
        row['reviewer'] = 'TASK-225 independent local-fixture removal archive review'
    crosswalk['runReferences']['TASK-244'] = dict(directory=str(selected),
        manifestSha256=digest(selected / 'evidence-hashes.json'),
        reason='Relevant server/index.js and client runtime bytes changed since the accepted archive; one bounded current-source provider refresh. Later byte-identical index of original final reports, not a new run or rewritten plan.')
    save('reviewed-crosswalk.json', crosswalk)
    print('PASS prepared independent TASK-244 clause proof; exact AC4 path remains unresolved')
    print('REQUIRES actual consumer inventory; preparation alone establishes no closure')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['archive', 'reviews', 'tasks', 'output']:
        p.add_argument(name)
    a = p.parse_args()
    prepare(a.archive, a.reviews, a.tasks, a.output)
