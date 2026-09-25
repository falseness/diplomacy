#!/usr/bin/env python3
"""Review TASK-209/AC1 independently, preserving the selected complete AC2."""
import argparse
import json
from pathlib import Path
import shutil
from datetime import datetime
from review_concurrent_archive import digest
from review_concurrent_browser import review as browser_review
from review_concurrent_recipients import review as recipient_review


def review(root):
    root = Path(root)
    read = lambda n: json.loads((root/n).read_text())
    lines = lambda n: [json.loads(l) for l in (root/n).read_text().splitlines()]
    browser, recipients = browser_review(root), recipient_review(root)
    checks = []

    def check(name, expected, observed):
        if type(expected) is not type(observed) or expected != observed:
            raise ValueError('participants-proof: '+name)
        checks.append(dict(id=name, expected=expected, observed=observed, **{'pass': True}))

    names = ['services/activity.jsonl', 'cleanup.json', 'served-sources.json',
             'source-identities.json', 'game-isolation.jsonl', 'checkpoints.json']
    proofs = {**browser['proofs'], **recipients['proofs'], **{n:digest(root/n) for n in names}}
    bindings = read('recipient-bindings.json')['bindings']
    documents = {label:read(label+'-persisted-'+str(r)+'.json') for label,r in
                 [('coop-browser',2), ('competitive-browser',4), ('coop-ten',2)]}
    check('three-distinct-games', 3, len({d['gameID'] for d in documents.values()}))
    for label, count in [('coop-browser',2), ('competitive-browser',2), ('coop-ten',10)]:
        doc = documents[label]
        peers = [b for b in bindings if b['gameID'] == doc['gameID']]
        check(label+'/slots', list(range(1,count+1)), sorted(b['slot'] for b in peers))
        check(label+'/users', count, len({b['user'] for b in peers}))
        check(label+'/roster-size', count, len([u for u in doc['playerIndexToUserIndex'] if u]))
        for b in peers:
            check(label+'/'+b['peer']+'/roster', doc['playerIndexToUserIndex'], b['roster'])
            check(label+'/'+b['peer']+'/identity', doc['playerIndexToUserIndex'][b['slot']], b['user'])
    checkpoint = next(c for c in read('checkpoints.json')['checkpoints'] if c['id']=='browser-pair/participants')
    for field in ['expected','observed']:
        check('actual-browser-contexts/'+field, dict(contexts=4,counts=[2,2],distinctGames=2), checkpoint[field])
    events = lines('game-isolation.jsonl')
    def at(label, round):
        return min(e['at'] for e in events if e['id']==label and e.get('round')==round)
    check('concurrent-browser-progress', True,
          max(at('coop-browser',0), at('competitive-browser',0)) <
          min(at('coop-browser',1), at('competitive-browser',1)))
    check('ten-with-competitive-progress', True,
          at('coop-ten',0) < at('competitive-browser',3) < at('coop-ten',2) and
          at('coop-ten',0) < at('competitive-browser',4))
    activity = lines('services/activity.jsonl')
    check('one-production-server', 1, sum(e['message'].startswith('starting production server for diplomacy_test_') for e in activity))
    for source, marker in [('mongodb','ping ok'),('server:stdout','Collections are ready')]:
        rows = [e for e in activity if e['source']==source and e['message']==marker]
        check(source+'/readiness', 1, len(rows))
        check(source+'/ready-before-games', True, datetime.fromisoformat(rows[0]['at'].replace('Z','+00:00')).timestamp()*1000 < min(e['at'] for e in events))
    cleanup = read('cleanup.json')
    check('owned-service-roles', ['mongod','server'], sorted(p['role'] for p in cleanup['processes']))
    check('owned-services-stopped', [False,False], [p['aliveAfter'] for p in cleanup['processes']])
    sources = read('source-identities.json')['before']['client']['files']
    served = read('served-sources.json')
    for n in ['index.html','options/onlineLogic.js','render/draw.js']:
        check('served/'+n, sources[n], served[n])
    for prefix, result in [('browser',browser),('recipient',recipients)]:
        checks.extend(dict(id=prefix+'/'+c['id'],expected=c['expected'],observed=c['observed'],**{'pass':True}) for c in result['checks'])
    return dict(checks=checks, proofs=proofs, fullAuditReady=False,
                scope='Four shipped browser contexts in two games; ten protocol identities with competitive progress. No ten-browser or G09 claim.')


def prepare(baseline, output):
    baseline, output = Path(baseline).resolve(), Path(output).resolve()
    crosswalk = json.loads(baseline.read_text())
    archive = Path(crosswalk['runReferences']['TASK-209']['directory'])
    result = review(archive)
    output.mkdir(exist_ok=False)
    selected = output/'selected-209'
    shutil.copytree(archive, selected)
    report = selected/'ac1-independent-review.json'
    report.write_text(json.dumps(result,indent=2)+'\n')
    manifest = {str(p.relative_to(selected)):digest(p) for p in selected.rglob('*') if p.is_file() and p.name!='evidence-hashes.json'}
    (selected/'evidence-hashes.json').write_text(json.dumps(manifest,indent=2)+'\n')
    ref = lambda n:dict(file=n,sha256=manifest[n])
    row = next(r for r in crosswalk['reviews'] if r['id']=='TASK-209/AC1')
    tasks = json.loads(Path('/root/diplomacy/artifacts/tasks.json').read_text())
    task = next(t for t in tasks if t['id']=='TASK-209')
    assertion_ids = ['actual-browser-contexts/observed','concurrent-browser-progress','ten-with-competitive-progress',
                     'one-production-server','owned-services-stopped','recipient/every-recipient-every-revision']
    row['reviewer'] = 'TASK-225 independent participant, lifecycle and concurrent progress review'
    row['clauses'] = [dict(text=task['acceptance_criteria'][0], disposition='reviewed',runTask='TASK-209',tier='real-network',
        caseIds=['browser-pair','ten-socket-isolation'],sourceIdentity=ref('source-identities.json'),
        proofs=[ref(n) for n in sorted(result['proofs'])]+[ref(report.name)],
        assertions=[dict(id=c['id'],expected=c['expected'],proof=ref(report.name)) for c in result['checks'] if c['id'] in assertion_ids],
        traces=[ref(n) for n in ['wire.jsonl','inputs.jsonl','game-isolation.jsonl','recipient-packets.jsonl']],
        milestoneIds=assertion_ids,followUp=row['clauses'][0]['followUp'],reason=result['scope'],
        derivation='Raw MongoDB rosters independently bind participant identities; exact four-context observation is cross-checked with four labeled UI packet/input streams. Chronology requires both browser games to start before either advances, and competitive progress during the ten-identity journey. Independent board readers validate every received state. Owned production service readiness precedes games; served asset hashes bind to recorded source identities.')]
    crosswalk['runReferences']['TASK-209'] = dict(directory=str(selected),manifestSha256=digest(selected/'evidence-hashes.json'),reason='Byte-identical review-41 selection plus independent AC1 review; preserves AC2.')
    (output/'reviewed-crosswalk.json').write_text(json.dumps(crosswalk,indent=2)+'\n')
    (output/'selection-provenance.json').write_text(json.dumps(dict(baseline=str(baseline),baselineSha256=digest(baseline),
        original=str(archive),originalFiles={str(p.relative_to(archive)):digest(p) for p in archive.rglob('*') if p.is_file()},
        reviewerSha256=digest(__file__),checks=len(result['checks'])),indent=2)+'\n')
    print('PASS prepared complete TASK-209/AC1 checks='+str(len(result['checks']))+' G09=unresolved fullAuditReady=false')


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('baseline');p.add_argument('output')
    a=p.parse_args();prepare(a.baseline,a.output)
