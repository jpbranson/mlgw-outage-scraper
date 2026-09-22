"""Independent inventory recount and raw-page/event-object consistency checks."""
import collections
import csv
import datetime as dt
import gzip
import hashlib
import json
from pathlib import Path
import re

ROOT = Path('data/legacy/coverage')
EVENT = re.compile(r'^\s*events\[(\d+)\]\s*=\s*(\[.*\]);\s*$', re.M)


def page_events(text):
    if not re.search(r'var\s+events\s*=\s*\[\s*\]\s*;', text):
        raise ValueError('Missing events declaration')
    matches = list(EVENT.finditer(text))
    if len(re.findall(r'^\s*events\[\d+\]\s*=', text, re.M)) != len(matches):
        raise ValueError('Unrecognized event assignment')
    if [int(m[1]) for m in matches] != list(range(len(matches))):
        raise ValueError('Duplicate or noncontiguous event indexes')
    for m in matches:
        event = json.loads(m[2])
        if not isinstance(event, list) or len(event) != 6 or not all(isinstance(v, str) for v in event):
            raise ValueError('Unsupported event schema')
    # Compare exactly to the archived parser's six string fields; no JS execution.
    return [m[0].strip().replace('"', '').split(',') for m in matches]


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def verify():
    inventory = json.loads((ROOT/'inventory.json').read_text())
    recount = []
    for revision in inventory['revisions']:
        file = revision.get('cached') or str(ROOT/'metadata'/f"{revision['repository']}.{revision['commit']}.recursive.json")
        data = json.loads(Path(file).read_text())
        if data['truncated']:
            raise ValueError('Independent verifier requires a complete tree')
        files = [f for f in data['tree'] if f['type']=='blob' and re.fullmatch(r'data/\d{4}-\d{2}-\d{2}_\d{2}_\d{2}_\d{2}(?:\.\d{1,6})?(?:\.csv|\.txt|\.RData|_txt\.rds)', f['path'])]
        if len(files) != revision['captureFiles']:
            raise ValueError('Tree count mismatch')
        for f in files:
            recount.append((revision['repository'],revision['commit'],f['path'],f['sha'],f['size']))
    declared = [(f['repository'],f['commit'],f['path'],f['blob'],f['bytes']) for f in inventory['entries']]
    if collections.Counter(recount) != collections.Counter(declared):
        raise ValueError('Inventory mismatch')
    originals = json.loads((ROOT/'originals.json').read_text())
    for original in originals:
        body = Path(original['local']).read_bytes()
        if len(body) != original['bytes'] or hashlib.sha256(body).hexdigest() != original['sha256'] or hashlib.sha1(f'blob {len(body)}\0'.encode()+body).hexdigest() != original['blob']:
            raise ValueError('Original hash mismatch')
    with open(ROOT/'inspection.csv', newline='') as f:
        inspected = list(csv.DictReader(f))
    if {(r['repository'],r['path'],r['blob']) for r in inspected} != {(r['repository'],r['path'],r['blob']) for r in originals}:
        raise ValueError('Sample inspection completeness mismatch')
    with gzip.open(ROOT/'sample-events.csv.gz','rt',newline='') as f:
        event_rows = collections.defaultdict(list)
        for row in csv.DictReader(f):
            event_rows[(row['repository'],row['path'])].append(row)
    pairs, unmatched, empty_blobs, verified_pages = [], [], set(), {}
    for item in inspected:
        if item['kind']=='saved-head-text':
            continue
        key = re.sub(r'\.(csv|RData)$','',item['path'])
        page = next((r for r in inspected if r['repository']==item['repository'] and r['path'] in (key+'.txt',key+'_txt.rds')),None)
        rows = event_rows[(item['repository'],item['path'])]
        if len(rows) != int(item['rows']):
            raise ValueError('Exported row count mismatch')
        if not rows:
            empty_blobs.add(item['blob'])
        result = {'repository': item['repository'], 'captureKey': key.removeprefix('data/'), 'eventBlob': item['blob'],
                  'events': len(rows), 'consolidatedContentMatch': item['fullContentMatch']=='TRUE',
                  'comparison': item['comparison'], 'matchedSourceTime': item['matchedSourceTime'],
                  'storedTime': item['storedTime'], 'pageAvailable': page is not None}
        if page:
            text = Path(page['decoded']).read_text(encoding='utf-8')
            if not text.strip() or text.strip() == 'Request Rejected':
                if rows:
                    raise ValueError('Nonempty event table paired with blank head')
                result.update(pageBlob=page['blob'], pageStatus='blank-saved-head' if not text.strip() else 'rejected-request', pageEventContentMatch=False)
                verified_pages[page['blob']] = {'events':None,'polygons':None}
                pairs.append(result)
                continue
            decoded = page_events(text)
            actual = [[r[f'V{i}'] for i in range(1,7)] for r in rows]
            if decoded != actual:
                raise ValueError('Raw page differs from event object: '+item['path'])
            polygon_count = len(re.findall(r'var\s+polygon\d+\s*=',text))
            result.update(pageBlob=page['blob'], pageStatus='recognized-head', pageEvents=len(decoded), polygonDeclarations=polygon_count, pageEventContentMatch=True)
            verified_pages[page['blob']] = {'events':len(decoded),'polygons':polygon_count}
        if rows and item['fullContentMatch']!='TRUE':
            result['summary'] = {k:sorted({r[k] for r in rows}) for k in ['outage_num','cust_affected']}
            unmatched.append(result)
        pairs.append(result)
    with gzip.open(ROOT/'captures.jsonl.gz','rt') as f:
        captures = [json.loads(l) for l in f]
    empty_captures, missing_pages, unmatched_nonempty, inconsistent = [], [], [], []
    nonempty_sample = {r['eventBlob']:r for r in pairs if r['events']}
    for capture in captures:
        event = next(f for f in capture['files'] if f['kind'] in ('.csv','.RData'))
        pages = [f for f in capture['files'] if f['kind'] in ('.txt','_txt.rds')]
        if not pages:
            missing_pages.append({'repository':capture['repository'],'captureKey':capture['captureKey']})
        if event['blob'] in empty_blobs:
            page_checks = [verified_pages.get(p['blob']) for p in pages]
            empty_captures.append({'repository':capture['repository'],'captureKey':capture['captureKey'],
                'eventBlob':event['blob'],'pageBlobs':[p['blob'] for p in pages],
                'savedHeadAlsoVerifiedEmpty':bool(page_checks) and all(p is not None and p['events']==0 and p['polygons']==0 for p in page_checks)})
            if capture['totalSourceTime']:
                inconsistent.append(capture['captureKey'])
        elif not capture['totalSourceTime']:
            unmatched_nonempty.append({'repository':capture['repository'],'captureKey':capture['captureKey'],
                'inspected':event['blob'] in nonempty_sample, 'eventBlob':event['blob']})
    if inconsistent:
        raise ValueError('Empty objects incorrectly associated to totals: '+str(inconsistent[:10]))
    if any(not r['inspected'] for r in unmatched_nonempty):
        raise ValueError('Unclassified unmatched event objects remain')
    report = {
        'independentInventoryVerified': True, 'originalsVerified':len(originals), 'selectedCapturePairs':len(pairs),
        'pairedPageChecks':sum(r['pageAvailable'] for r in pairs), 'nonemptySampleMatches':sum(r['consolidatedContentMatch'] for r in pairs),
        'pairedPageContentMatches':sum(r.get('pageEventContentMatch',False) for r in pairs),
        'blankSavedHeads':[r for r in pairs if r.get('pageStatus')=='blank-saved-head'],
        'rejectedSavedHeads':[r for r in pairs if r.get('pageStatus')=='rejected-request'],
        'sampleEmptyTables':sum(r['events']==0 for r in pairs), 'emptyObjectBlobs':sorted(empty_blobs),
        'allEmptyEventCaptures':len(empty_captures), 'allEmptyCapturesWithVerifiedEmptyHead':sum(r['savedHeadAlsoVerifiedEmpty'] for r in empty_captures),
        'unmatchedNonemptyCaptures':unmatched_nonempty, 'nonemptyOriginalsAbsentFromConsolidated':unmatched,
        'missingSavedPages':missing_pages, 'samplePairs':pairs,
        'inputHashes':{str(p):digest(p) for p in [ROOT/'inventory.json',ROOT/'captures.jsonl.gz',ROOT/'originals.json',ROOT/'inspection.csv',ROOT/'sample-events.csv.gz']},
        'interpretation':'Empty event arrays and no polygon declarations do not establish zero regional totals: saved head text omits the body summary.',
    }
    (ROOT/'empty-captures.json').write_text(json.dumps(empty_captures,indent=2)+'\n')
    (ROOT/'sample-verification.json').write_text(json.dumps(report,indent=2)+'\n')
    audit_file = Path('reports/legacy-coverage-audit.json')
    audit = json.loads(audit_file.read_text())
    if audit['inventorySha256'] != digest(ROOT/'inventory.json') or audit['captureManifestSha256'] != digest(ROOT/'captures.jsonl.gz'):
        raise ValueError('Audit belongs to different inventory')
    audit.update(sampleValidation='verified-with-recorded-exceptions', verifiedAt=dt.datetime.now(dt.timezone.utc).isoformat(),
        validation={k:v for k,v in report.items() if k not in ('samplePairs','inputHashes')},
        verificationSha256=digest(ROOT/'sample-verification.json'))
    audit_file.write_text(json.dumps(audit,indent=2)+'\n')
    catalog = {'version':'legacy-coverage-v1','scope':inventory['scope'],'verified':True,
        'meaning':'Availability and bounded content audit, not a complete raw-history import or assertion of uninterrupted sampling',
        'recoveredGeneration':audit['recoveredGeneration'], 'dashboardPublished':False,
        'files':{name:{'path':str(ROOT/name).replace('\\','/'),'sha256':digest(ROOT/name)} for name in
                 ['inventory.json','captures.jsonl.gz','timeline-gaps.json','unmatched-captures.json','totals-without-capture.json','empty-captures.json','sample-verification.json']}}
    (ROOT/'catalog.json').write_text(json.dumps(catalog,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ('samplePairs','inputHashes')},indent=2))


if __name__=='__main__':
    verify()
