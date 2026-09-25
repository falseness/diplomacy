#!/usr/bin/env python3
"""Later receipt selection for TASK-231; never edit or re-execute an archive."""
import argparse
import datetime
import json
from pathlib import Path
import shutil

from review_fast_archive import digest, review


def save(file, value):
    file.write_text(json.dumps(value, indent=2) + '\n')


def files(root):
    result = {}
    for file in sorted(root.rglob('*')):
        if file.is_symlink():
            raise ValueError('receipt-selection:symlink')
        if file.is_file():
            result[str(file.relative_to(root))] = digest(file)
    return result


def execution_review(archive, require_current=True):
    result = review(archive, require_current)
    log = (archive / 'verification.log').read_text()
    children = json.loads((archive / 'child-results.json').read_text())
    required = []
    for command in children['commands']:
        marker = ('COMMAND ' + command['program'] + ' ' + ' '.join(command['args'])
                  + '\nCWD=' + command['cwd'])
        required.append(('full-command/' + command['label'], marker))
    for child in children['children']:
        for key in ['stdoutPath', 'stderrPath']:
            file = Path(child[key])
            required.append(('full-child-output/' + child['selection'] + '/' + child['file'] + '/' + key,
                             'CHILD_LOG ' + str(file) + '\n' + file.read_text()))
    for name, marker in required:
        if marker not in log:
            raise ValueError('receipt-selection:' + name)
        result['checks'].append(dict(id=name, expected=True, observed=True, pass_=True))
    return result


def normalized_coverage(archive):
    coverage = json.loads((archive / 'coverage-results.json').read_text())
    for case in coverage['cases']:
        proof = (archive / case['proof']).resolve(strict=True)
        if not proof.is_relative_to(archive) or not proof.is_file():
            raise ValueError('receipt-selection:escaped-proof')
        case['proof'] = str(proof.relative_to(archive))
    return coverage


def validate_selection(selected, require_current=True):
    """Recompute from retained original evidence, including rehashed semantics."""
    selected = Path(selected).resolve(strict=True)
    provenance = json.loads((selected / 'selection-provenance.json').read_text())
    if provenance['kind'] != 'later-task231-receipt-selection':
        raise ValueError('receipt-selection:kind')
    archive = Path(provenance['originalArchive']).resolve(strict=True)
    if selected == archive or selected.is_relative_to(archive) or archive.is_relative_to(selected):
        raise ValueError('receipt-selection:overlapping-directories')
    result = execution_review(archive, require_current)
    original = files(archive)
    if original != provenance['originalFiles']:
        raise ValueError('receipt-selection:changed-original')
    budget = json.loads((archive / 'verification-budget.json').read_text())
    stamp = lambda s: datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))
    if stamp(provenance['selectedAt']) <= stamp(budget['finishedAt']):
        raise ValueError('receipt-selection:not-later')
    for name, sha in original.items():
        target = {'coverage-results.json': 'original-coverage-results.json',
                  'evidence-hashes.json': 'original-evidence-hashes.json'}.get(name, name)
        if digest(selected / target) != sha:
            raise ValueError('receipt-selection:changed-copy/' + name)
    if json.loads((selected / 'coverage-results.json').read_text()) != normalized_coverage(archive):
        raise ValueError('receipt-selection:coverage-projection')
    checks = dict(result, checks=[dict(id=c['id'], expected=c['expected'],
                  observed=c['observed'], **{'pass': c['pass_']}) for c in result['checks']])
    if json.loads((selected / 'independent-execution-review.json').read_text()) != json.loads(json.dumps(checks)):
        raise ValueError('receipt-selection:changed-review')
    expected = files(selected)
    expected.pop('evidence-hashes.json')
    if json.loads((selected / 'evidence-hashes.json').read_text()) != expected:
        raise ValueError('receipt-selection:index')
    return result


def prepare(archive, reviews, output):
    archive = Path(archive).resolve(strict=True)
    output = Path(output).resolve()
    if output == archive or output.is_relative_to(archive) or archive.is_relative_to(output):
        raise ValueError('receipt-selection:overlapping-directories')
    result = execution_review(archive)
    original = files(archive)
    output.mkdir(exist_ok=False)
    selected = output / 'selected-231'
    shutil.copytree(archive, selected)
    (selected / 'evidence-hashes.json').rename(selected / 'original-evidence-hashes.json')
    (selected / 'coverage-results.json').rename(selected / 'original-coverage-results.json')
    save(selected / 'coverage-results.json', normalized_coverage(archive))
    save(selected / 'selection-provenance.json', dict(kind='later-task231-receipt-selection',
         selectedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
         originalArchive=str(archive), originalFiles=original,
         note='Later read-only selection, not a new invocation or original worker index. '
              'Only coverage proof paths become contained relative paths; original metadata '
              'and every raw file are retained byte-for-byte. Final log and budget are '
              'indexed now, never claimed to have been worker-indexed.'))
    checks = dict(result, checks=[dict(id=c['id'], expected=c['expected'],
                  observed=c['observed'], **{'pass': c['pass_']}) for c in result['checks']])
    save(selected / 'independent-execution-review.json', checks)
    save(selected / 'evidence-hashes.json', files(selected))
    validate_selection(selected)
    manifest = json.loads((selected / 'evidence-hashes.json').read_text())
    ref = lambda name: dict(file=name, sha256=manifest[name])
    crosswalk = json.loads(Path(reviews).read_text())
    ids = {
        3: ['exact-children', 'exits', 'signals', 'no-run-drift', 'current-source-differences',
            'history/fast', 'history/focused', 'full-command/fast', 'full-command/focused', 'log/PASS TASK-231 complete-invocation cases=30 cleanup=true'],
        5: ['exact-selection', 'exact-coverage', 'bounded-elapsed', 'bounded-estimate', 'stop-at',
            'shared-deadline/fast', 'shared-deadline/focused', 'budget/cleanup', 'budget/pass',
            'cleanup/fast/remaining', 'cleanup/focused/remaining', 'elapsed', 'exits']}
    for index, names in ids.items():
        row = next(r for r in crosswalk['reviews'] if r['id'] == 'TASK-231/AC' + str(index))
        old = row['clauses'][0]
        assertions = []
        for name in names:
            check, = [c for c in checks['checks'] if c['id'] == name]
            assertions.append(dict(id=name, expected=check['expected'],
                                   proof=ref('independent-execution-review.json')))
        row['reviewer'] = 'TASK-225 independently recomputed finalized TASK-231 execution receipts'
        row['clauses'] = [dict(text=''.join(c['text'] for c in row['clauses']),
            disposition='reviewed', runTask='TASK-231', tier='source-executed',
            caseIds=result['cases'], sourceIdentity=ref('source-identities.json'),
            proofs=[ref(n) for n in ['verification.log', 'verification-budget.json',
                'verification-plan.json', 'coverage-results.json', 'child-results.json',
                'discovery-manifest.json', 'selection-provenance.json',
                'original-evidence-hashes.json', 'original-coverage-results.json',
                'fast-owned.jsonl.cleanup.json', 'focused-owned.jsonl.cleanup.json',
                'independent-execution-review.json']], assertions=assertions,
            followUp=old['followUp'],
            reason='Later selection binds the existing completed parent log and final budget. '
                'Nine children, thirty cases, raw TAP, no skips, exact current sources, '
                'history preservation and owned cleanup are independently checked. '
                'Only proof-path metadata is projected; original evidence is unchanged. '
                'No exhaustive-profile or independent gameplay-semantic claim.',
            derivation='Compare independently fixed six fast and three focused suite names '
                'and thirty case names with original plans, coverage, child results and raw TAP. '
                'Recompute elapsed time from original start/end and require a single absolute '
                'start+3300000 deadline for both supervised commands, zero command exits '
                'and empty remaining-process lists. Rehash every original, selected and '
                'current source file; consume the exact reviewed checks and final receipts.')]
    # Preserve AC1's hashes: only its coverage proof reference needs normalization.
    ac1 = next(r for r in crosswalk['reviews'] if r['id'] == 'TASK-231/AC1')
    for clause in ac1['clauses']:
        for proof in clause.get('proofs', []):
            if proof['file'] == 'coverage-results.json':
                proof['sha256'] = manifest['coverage-results.json']
    crosswalk['runReferences']['TASK-231'] = dict(directory=str(selected),
        manifestSha256=digest(selected / 'evidence-hashes.json'),
        reason='Later normalized selection of the same refresh-231-29 completed parent. '
               'Original indexes and bytes retained, final receipts bound by this later index; '
               'no gameplay replay or timestamp fabrication. AC2/AC4 remain unresolved.')
    save(output / 'reviewed-crosswalk.json', crosswalk)
    print('PASS prepared TASK-231 AC3/AC5 finalized receipts; actual inventory consumption required')


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ['archive', 'reviews', 'output']:
        p.add_argument(name)
    a = p.parse_args()
    prepare(a.archive, a.reviews, a.output)
