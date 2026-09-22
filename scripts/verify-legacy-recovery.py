"""Verify preservation and prepare an independent R timestamp comparison. --finalize publishes validation."""
import csv
import datetime as dt
import gzip
import hashlib
import json
from pathlib import Path
import sys

if not __debug__:
    raise RuntimeError('Validation requires Python assertions to be enabled')

root = Path('data/legacy')
catalog_path = root/'recovered/catalog.json'
catalog = json.loads(catalog_path.read_text())
report = json.loads(Path(catalog['report']).read_text())
output = Path(catalog['report']).parent
verification = output/'verification'
verification.mkdir(exist_ok=True)


def sha(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream,'sha256').hexdigest()


def rows(file):
    with gzip.open(file,'rt',encoding='utf-8') as stream:
        yield from (json.loads(line) for line in stream)


def save(file, value):
    temp = file.with_suffix(file.suffix+'.tmp')
    temp.write_text(json.dumps(value,indent=2)+'\n')
    temp.replace(file)


if '--finalize' in sys.argv:
    result = json.loads((verification/'preservation.json').read_text())
    check = list(csv.DictReader((verification/'r-results.csv').open()))
    assert len(check)==2 and all(r['verified']=='TRUE' for r in check)
    assert int(check[0]['records'])==report['totalObservations'] and int(check[1]['records'])==report['gridCellRecords']
    for kind,item in report['outputs'].items():
        assert sha(item['path'])==item['sha256']==result['outputHashes'][kind]
    result.update(independentRVerified=True, independentRResults=check,
                  verifiedAt=dt.datetime.now(dt.timezone.utc).isoformat(), rResultsSha256=sha(verification/'r-results.csv'),
                  pythonVerifierSha256=sha(__file__), rVerifierSha256=sha('scripts/verify-legacy-recovery.R'))
    save(verification/'verified.json',result)
    catalog.update(verified=True,verification=(verification/'verified.json').as_posix(),verificationSha256=sha(verification/'verified.json'))
    report.update(validation='verified',independentVerification=catalog['verification'],verifiedAt=result['verifiedAt'])
    save(Path(catalog['report']),report)
    save(Path('reports/legacy-timezone-recovery.json'),report)
    save(catalog_path,catalog)
    save(Path('reports/legacy-recovery-verification.json'),result)
    print(json.dumps(result,indent=2))
    sys.exit(0)

originals={r['blob']:r for r in json.loads((root/'recovery-evidence/captures.json').read_text())}
stats={}; hashes={}
for kind,name,key_fields in [('totals','totals.jsonl.gz',('sourceTime','outages','customers')),
                             ('grids','grid-cells.jsonl.gz',('captureKey','gridCellId','customers'))]:
    item=report['outputs'][kind]
    hashes[kind]=sha(item['path']);assert hashes[kind]==item['sha256']
    staged={tuple(r[k] for k in key_fields):r for r in rows(root/'staged'/name)}
    assert len(staged)==(report['totalObservations'] if kind=='totals' else report['gridCellRecords'])
    with gzip.open(verification/(kind+'.csv.gz'),'wt',encoding='utf-8',newline='') as stream:
        fields=['key','source_time','observed_at','method','zone','original_path','related_total','first_source_row','outages','customers']
        writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader()
        seen=set();known=[];missing=0
        for recovered in rows(item['path']):
            key=tuple(recovered[k] for k in key_fields);assert key not in seen;seen.add(key)
            original=staged[key]
            restored=dict(recovered)
            proof=restored.pop('timeRecovery');prior=restored.pop('originalTimeStatus')
            assert prior==original['timeStatus']
            restored['observedAt']=original['observedAt'];restored['timeStatus']=prior
            assert restored==original,'Recovery changed source content or provenance'
            if recovered['observedAt']:
                assert recovered['timeStatus']=='resolved'
                known.append(recovered['observedAt'])
            else:
                missing+=1;assert recovered['timeStatus']=='timezone-unresolved'
            blob=proof.get('blob');original_path=originals[blob]['local'] if blob else ''
            source_time=recovered['sourceTime'] if kind=='totals' else recovered['captureKey']
            index=next((p['firstSourceRow'] for p in recovered['provenance'] if p['source']=='mlgw.outage.3/total_outages.rds'),'')
            writer.writerow({'key':source_time,'source_time':source_time,'observed_at':recovered['observedAt'] or '',
                             'method':proof['method'],'zone':proof.get('zone',''),'original_path':original_path,
                             'related_total':proof.get('relatedTotalSourceTime',''),'first_source_row':index,
                             'outages':recovered.get('outages',''),'customers':recovered['customers']})
        assert seen==set(staged) and known==sorted(known)
        if kind=='totals':assert len(set(known))==len(known)
        stats[kind]={'recordsPreserved':len(seen),'resolvedRecords':len(known),'unresolvedRecords':missing}
result={'generation':report['generation'],'outputHashes':hashes,'sourceAndGeometryPreserved':True,'strictUTCOrder':True,'statistics':stats}
save(verification/'preservation.json',result)
Path('data/legacy/recovered/verification-path.txt').write_text(verification.as_posix())
print(json.dumps(result,indent=2))
