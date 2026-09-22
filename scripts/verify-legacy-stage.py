"""Project staged JSONL back to source-row CSV for independent base-R comparison."""
import csv
import gzip
import hashlib
import json
from pathlib import Path

root = Path('data/legacy')
catalog = json.loads((root / 'staged/sources.json').read_text(encoding='utf-8'))['sources']
report = json.loads(Path('reports/legacy-data-audit.json').read_text(encoding='utf-8'))
assert hashlib.sha256((root / 'staged/sources.json').read_bytes()).hexdigest() == report['sourceCatalogSha256']
target = root / 'verification'
target.mkdir(exist_ok=True)
unique = {}
for source_id, source in catalog.items():
    unique.setdefault(source['blob'], (source_id, source))
handles, writers, counts = {}, {}, {}
try:
    for blob, (source_id, source) in unique.items():
        handle = gzip.open(target / (blob + '.csv.gz'), 'wt', encoding='utf-8', newline='')
        handles[blob] = handle
        writer = csv.writer(handle)
        fields = ['source_row', 'source_rows', 'time', 'outages', 'customers'] if source['path'] == 'total_outages.rds' else [
            'source_row', 'filename', 'id', 'long', 'lat', 'customers']
        writer.writerow(fields); writers[blob] = writer; counts[blob] = 0
    for kind, name in [('totals', 'totals.jsonl.gz'), ('geometry', 'grid-cells.jsonl.gz')]:
        file = root / 'staged' / name
        assert hashlib.sha256(file.read_bytes()).hexdigest() == report[kind]['output']['sha256']
        with gzip.open(file, 'rt', encoding='utf-8') as stream:
            record_count = 0
            for line in stream:
                record = json.loads(line); record_count += 1
                assert record['sourceFormat'] == 'legacy_html'
                if kind == 'totals':
                    assert (record['observedAt'] == record['sourceTime']) if record['sourceTime'].endswith('Z') else record['observedAt'] is None
                else:
                    assert record['observedAt'] is None and record['geometry']['type'] == 'Polygon'
                for provenance in record['provenance']:
                    source_id = provenance['source']; source = catalog[source_id]; blob = source['blob']
                    assert provenance['sourceRowCount'] > 0 and provenance['firstSourceRow'] > 0
                    if unique[blob][0] != source_id:
                        # Same retained bytes from another repo must have identical row provenance.
                        alias = next(p for p in record['provenance'] if p['source'] == unique[blob][0])
                        assert {k: v for k, v in alias.items() if k != 'source'} == {k: v for k, v in provenance.items() if k != 'source'}
                        continue
                    if kind == 'totals':
                        assert source['path'] == 'total_outages.rds'
                        writers[blob].writerow([provenance['firstSourceRow'], provenance['sourceRowCount'],
                                               record['sourceTime'], record['outages'], record['customers']])
                        counts[blob] += 1
                    else:
                        assert source['path'] == 'total_parsed_polygons.rds'
                        ring = record['geometry']['coordinates'][0]
                        assert len(ring) == provenance['sourceRowCount']
                        for offset, (lon, lat) in enumerate(ring):
                            writers[blob].writerow([provenance['firstSourceRow'] + offset, provenance['filename'],
                                                   record['gridCellId'], lon, lat, record['customers']])
                            counts[blob] += 1
            assert record_count == report[kind]['output']['records']
finally:
    for handle in handles.values():
        handle.close()
with (target / 'sources.csv').open('w', encoding='utf-8', newline='') as stream:
    writer = csv.writer(stream)
    writer.writerow(['blob', 'kind', 'original', 'projection'])
    for blob, (_, source) in unique.items():
        writer.writerow([blob, 'totals' if source['path'] == 'total_outages.rds' else 'polygons',
                         source['local'], (target / (blob + '.csv.gz')).as_posix()])
print(json.dumps({'stageHashesMatch': True, 'sourceProjections': counts}, indent=2))
