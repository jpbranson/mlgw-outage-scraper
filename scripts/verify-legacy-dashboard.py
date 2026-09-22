"""Independent, offline, complete comparison of the dashboard index to recovery."""
import gzip
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def records(path):
    with gzip.open(path, 'rt', encoding='utf-8') as stream:
        for line in stream:
            yield json.loads(line)


def main():
    project = Path(__file__).resolve().parent.parent
    root = project / 'data/legacy'
    catalog = read(root / 'dashboard/catalog.json')
    recovered = read(root / 'recovered/catalog.json')
    coverage = read(root / 'coverage/catalog.json')
    index = root / 'dashboard' / catalog['index']['path']
    assert catalog['verified'] and catalog['version'] == 'legacy-dashboard-v1'
    assert digest(index) == catalog['index']['sha256']
    for entry in recovered['outputs'].values():
        assert digest(project / entry['path']) == entry['sha256']
    with sqlite3.connect(index.as_uri() + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert not db.execute('PRAGMA foreign_key_check').fetchall()
        metadata = json.loads(db.execute('SELECT json FROM metadata').fetchone()[0])
        assert metadata['inputs']['recoveryCatalog'] == digest(root / 'recovered/catalog.json')
        assert metadata['inputs']['coverageCatalog'] == digest(root / 'coverage/catalog.json')
        assert metadata['recoveredGeneration'] == recovered['generation'] == coverage['recoveredGeneration']
        no_original = {row['sourceTime'] for row in read(project / coverage['files']['totals-without-capture.json']['path'])}
        resolved = unresolved = 0
        unresolved_rows = []
        for row in records(project / recovered['outputs']['totals']['path']):
            actual = db.execute('SELECT * FROM observations WHERE source_time=?', (row['sourceTime'],)).fetchone()
            if row['observedAt'] is None:
                assert actual is None
                unresolved += 1
                unresolved_rows.append({'sourceTime': row['sourceTime'], 'customers': row['customers'], 'outages': row['outages'], 'recovery': row['timeRecovery']})
                continue
            assert actual is not None
            assert actual['observed_at'] == row['observedAt']
            instant = datetime.fromisoformat(row['observedAt'])
            epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
            delta = instant - epoch
            expected_ms = delta.days * 86400000 + delta.seconds * 1000 + delta.microseconds // 1000
            assert actual['at'] == expected_ms
            assert actual['customers'] == row['customers'] and actual['outages'] == row['outages']
            assert json.loads(actual['recovery']) == row['timeRecovery']
            assert json.loads(actual['provenance']) == [{k: p[k] for k in ('source', 'firstSourceRow', 'sourceRowCount')} for p in row['provenance']]
            assert actual['original_candidate'] == (row['sourceTime'] not in no_original)
            resolved += 1
        cells = 0
        keys = set()
        for row in records(project / recovered['outputs']['grids']['path']):
            actual = db.execute('SELECT * FROM cells WHERE capture_key=? AND cell_id=?', (row['captureKey'], row['gridCellId'])).fetchone()
            assert actual is not None and actual['customers'] == row['customers']
            assert json.loads(actual['geometry']) == row['geometry']
            if row['captureKey'] not in keys:
                grid = db.execute('SELECT g.*,o.source_time FROM grids g JOIN observations o ON o.id=g.total_id WHERE capture_key=?', (row['captureKey'],)).fetchone()
                assert grid['observed_at'] == row['observedAt']
                assert grid['source_time'] == row['timeRecovery']['relatedTotalSourceTime']
                assert json.loads(grid['recovery']) == row['timeRecovery']
                keys.add(row['captureKey'])
            cells += 1
        assert db.execute('SELECT COUNT(*) FROM observations').fetchone()[0] == resolved
        assert db.execute('SELECT COUNT(*) FROM cells').fetchone()[0] == cells
        assert db.execute('SELECT COUNT(*) FROM grids').fetchone()[0] == len(keys)
        assert metadata['unresolved'] == unresolved_rows
        gaps = read(project / coverage['files']['timeline-gaps.json']['path'])
        assert metadata['gaps']['totals'] == len(gaps['totals'])
        assert metadata['gaps']['grids'] == len(gaps['grids'])
        assert metadata['gaps']['largest'] == max(gaps['totals'], key=lambda row: row['secondsBetweenObservations'])
        proof = read(project / coverage['files']['sample-verification.json']['path'])
        assert metadata['coverage']['emptyEventCaptures'] == proof['allEmptyEventCaptures']
        assert metadata['coverage']['emptyHeads'] == proof['allEmptyCapturesWithVerifiedEmptyHead']
        assert metadata['coverage']['totalObservationsWithoutOriginal'] == len(no_original)
        for month in metadata['months']:
            actual = db.execute('SELECT COUNT(*) FROM observations WHERE substr(observed_at,1,7)=?', (month['month'],)).fetchone()[0]
            assert actual == month['totals']
    result = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'offline': True, 'networkRequests': 0,
              'totalsCompared': resolved, 'unresolvedExcluded': unresolved, 'gridSnapshotsCompared': len(keys),
              'gridCellsCompared': cells, 'coordinatesAndCountsExact': True, 'catalogAndCoverageVerified': True,
              'indexSha256': digest(index), 'indexBytes': index.stat().st_size}
    (project / 'reports/legacy-dashboard-verification.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
