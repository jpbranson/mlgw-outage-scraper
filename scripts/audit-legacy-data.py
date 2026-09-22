"""Offline audit and lossless deduplicated staging; never writes the live collector.

Input: pinned GitHub inventory and base-R exports from export-legacy-rds.R.
Naive times remain unresolved. Staged records are not a weather-aligned timeline.
"""
import collections
import csv
import datetime as dt
import gzip
import hashlib
import itertools
import json
from pathlib import Path
import re

VERSION = 'legacy-audit-v1'
ROOT = Path('data/legacy')


def count_value(raw, prefix=''):
    match = re.fullmatch(re.escape(prefix) + r'(0|[1-9][0-9]*|[1-9][0-9]{0,2}(?:,[0-9]{3})+)', raw)
    if not match:
        raise ValueError(f'Unsupported count: {raw!r}')
    return int(match[1].replace(',', ''))


def timestamp(raw):
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z', raw):
        dt.datetime.fromisoformat(raw.replace('Z', '+00:00'))  # validate calendar fields
        return {'observedAt': raw, 'timeStatus': 'explicit-UTC'}
    if re.fullmatch(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?', raw):
        dt.datetime.fromisoformat(raw)
        return {'observedAt': None, 'timeStatus': 'timezone-unresolved'}
    raise ValueError(f'Unsupported timestamp: {raw!r}')


def capture_key(filename):
    # Only remove known storage wrappers; retain timestamp precision and wall-clock value.
    match = re.fullmatch(r'(?:\./data/|data/)?(\d{4}-\d{2}-\d{2}_\d{2}_\d{2}_\d{2}(?:\.\d{1,6})?)(?:\.txt|_txt\.rds|\.RData)', filename)
    if not match:
        raise ValueError(f'Unsupported capture filename: {filename!r}')
    raw = match[1]
    dt.datetime.fromisoformat(raw[:10] + ' ' + raw[11:].replace('_', ':'))
    return raw


def add_variant(records, identities, identity, semantic, record, provenance):
    """Merge identical records only at the same capture; keep every conflicting variant."""
    key = (identity, semantic)
    if key not in records:
        records[key] = dict(record, provenance=[])
    records[key]['provenance'].append(provenance)
    identities[identity].add(semantic)


def verified_source(source):
    file = Path(source['local'])
    sha256 = hashlib.sha256()
    git = hashlib.sha1(f'blob {file.stat().st_size}\0'.encode())
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            sha256.update(chunk); git.update(chunk)
    if file.stat().st_size != source['bytes'] or sha256.hexdigest() != source['sha256'] or git.hexdigest() != source['blob']:
        raise ValueError(f'Original hash mismatch: {file}')


def csv_rows(blob, name):
    file = ROOT / 'export' / blob / name
    compressed = file.with_suffix(file.suffix + '.gz')
    opener = gzip.open if compressed.exists() else open
    with opener(compressed if compressed.exists() else file, 'rt', encoding='utf-8', newline='') as stream:
        yield from csv.DictReader(stream)


def write_json(file, value):
    temp = file.with_suffix(file.suffix + '.tmp')
    temp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    temp.replace(file)


def write_records(file, records):
    temp = file.with_suffix(file.suffix + '.tmp')
    with temp.open('wb') as raw:
        with gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0) as stream:
            for key in sorted(records):
                row = records[key]
                row['provenance'].sort(key=lambda p: (p['source'], p['firstSourceRow']))
                stream.write((json.dumps(row, separators=(',', ':'), ensure_ascii=False) + '\n').encode())
    temp.replace(file)
    return {'path': file.as_posix(), 'bytes': file.stat().st_size,
            'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'records': len(records)}


def audit():
    inventory = json.loads((ROOT / 'inventory.json').read_text(encoding='utf-8'))
    sources = {}
    for f in inventory['originals']:
        verified_source(f)
        sources[f['repository'] + '/' + f['path']] = f
    stage = ROOT / 'staged'
    stage.mkdir(exist_ok=True)
    write_json(stage / 'sources.json', {'version': VERSION, 'sources': sources})
    totals, times = {}, collections.defaultdict(set)
    total_sets, total_stats = {}, []
    for source_id, source in sources.items():
        if source['path'] != 'total_outages.rds':
            continue
        keys, rows, source_rows = set(), 0, 0
        for row in csv_rows(source['blob'], 'totals.csv'):
            raw_time = row['time']
            semantic = (count_value(row['outage_num'], '# of Outages: '), count_value(row['cust_affected'], 'Customers Affected: '))
            first, repeated = int(row['first_source_row']), int(row['source_rows'])
            if first < 1 or repeated < 1:
                raise ValueError('Invalid source row provenance')
            add_variant(totals, times, raw_time, semantic,
                        {'sourceFormat': 'legacy_html', 'kind': 'regional-total', 'sourceTime': raw_time,
                         **timestamp(raw_time), 'outages': semantic[0], 'customers': semantic[1]},
                        {'source': source_id, 'firstSourceRow': first, 'sourceRowCount': repeated,
                         'rawOutages': row['outage_num'], 'rawCustomers': row['cust_affected']})
            keys.add((raw_time, semantic)); rows += 1; source_rows += repeated
        metadata = next(csv_rows(source['blob'], 'metadata.csv'))
        if source_rows != int(metadata['source_rows']) or rows != int(metadata['exported_rows']):
            raise ValueError('Total source-row accounting mismatch')
        total_sets[source['repository']] = keys
        total_stats.append({'repository': source['repository'], 'eventObservationRows': source_rows,
                            'distinctTotalObservations': len(keys), 'rawSummaryRows': rows})
    for stat in total_stats:
        stat['observationsAbsentFromRepo3'] = len(total_sets[stat['repository']] - total_sets['mlgw.outage.3'])
    total_conflicts = [time for time, variants in times.items() if len(variants) > 1]
    time_status = collections.Counter(row['timeStatus'] for row in totals.values())
    total_output = write_records(stage / 'totals.jsonl.gz', totals)
    max_customers = max(totals.values(), key=lambda r: r['customers'])
    max_outages = max(totals.values(), key=lambda r: r['outages'])
    raw_times = sorted(times)
    # Retain exact raw timestamp identity. Resolution of timezone/precision aliases is a later gate.
    total_report = {'repositories': total_stats, 'uniqueObservations': len(totals),
                    'duplicateSummaryReferences': sum(s['rawSummaryRows'] for s in total_stats) - len(totals),
                    'conflictingStoredTimestamps': total_conflicts, 'timeStatus': dict(time_status),
                    'storedDateRange': [raw_times[0][:10], raw_times[-1][:10]],
                    'maxCustomers': {k: max_customers[k] for k in ('sourceTime', 'customers', 'outages')},
                    'maxOutages': {k: max_outages[k] for k in ('sourceTime', 'customers', 'outages')},
                    'output': total_output}
    del totals, times, total_sets

    grids, cells = {}, collections.defaultdict(set)
    grid_sets, grid_stats, cached = {}, [], {}
    for source_id, source in sources.items():
        if source['path'] != 'total_parsed_polygons.rds':
            continue
        metadata = next(csv_rows(source['blob'], 'metadata.csv'))
        if source['blob'] in cached:
            previous, stats = cached[source['blob']]
            for key in previous:
                earlier = next(p for p in grids[key]['provenance'] if sources[p['source']]['blob'] == source['blob'])
                grids[key]['provenance'].append(dict(earlier, source=source_id))
            grid_sets[source['repository']] = previous
            grid_stats.append(dict(stats, repository=source['repository']))
            continue
        keys, filenames, vertex_count, repeated_groups = set(), set(), 0, 0
        rows = csv_rows(source['blob'], 'vertices.csv')
        for raw_key, group in itertools.groupby(rows, key=lambda r: (r['filename'], r['polygon'], r['id'])):
            ring = list(group)
            if len(ring) > 1000:
                raise ValueError('Unexpected legacy ring size')
            coords = [(float(r['long']), float(r['lat'])) for r in ring]
            if len(coords) < 4 or coords[0] != coords[-1] or any(not (-180 <= x <= 180 and -90 <= y <= 90) for x, y in coords):
                raise ValueError('Invalid or unclosed legacy ring')
            if abs(sum(x1*y2-x2*y1 for (x1,y1),(x2,y2) in zip(coords,coords[1:]))) < 1e-12:
                raise ValueError('Zero-area legacy ring')
            raw_time = capture_key(raw_key[0])
            if not re.fullmatch(r'\d+', raw_key[2]):
                raise ValueError('Unexpected geographic grid identifier')
            customer = count_value(ring[0]['custs_num'])
            if any(r['custs_num'] != ring[0]['custs_num'] or r['cust_affected_html'] != ring[0]['cust_affected_html'] for r in ring):
                raise ValueError('Inconsistent cell metadata across vertices')
            source_row_numbers = [int(r['source_row']) for r in ring]
            if source_row_numbers != list(range(source_row_numbers[0], source_row_numbers[0] + len(ring))):
                raise ValueError('Noncontiguous original ring')
            identity = (raw_time, raw_key[2])
            semantic = (customer, tuple(coords))
            record_key = (identity, semantic)
            repeated_groups += record_key in keys
            add_variant(grids, cells, identity, semantic,
                        {'sourceFormat': 'legacy_html', 'kind': 'geographic-grid-cell', 'captureKey': raw_time,
                         'observedAt': None, 'timeStatus': 'timezone-unresolved', 'gridCellId': raw_key[2],
                         'customers': customer, 'geometry': {'type': 'Polygon', 'coordinates': [coords]}},
                        {'source': source_id, 'filename': raw_key[0], 'polygonVariable': raw_key[1],
                         'firstSourceRow': source_row_numbers[0], 'sourceRowCount': len(ring),
                         'rawCustomersHtml': ring[0]['cust_affected_html'], 'rawCustomers': ring[0]['custs_num']})
            keys.add(record_key); filenames.add(raw_time); vertex_count += len(ring)
        if vertex_count != int(metadata['exported_rows']):
            raise ValueError('Polygon vertex accounting mismatch')
        stats = {'repository': source['repository'], 'sourceRows': int(metadata['source_rows']),
                 'validVertices': vertex_count, 'distinctSnapshotCells': len(keys),
                 'distinctSnapshots': len(filenames), 'repeatedIdenticalCellGroups': repeated_groups,
                 'nonfiniteCoordinateRows': int(metadata['nonfinite_coordinate_rows']),
                 'storedDateRange': [min(filenames)[:10], max(filenames)[:10]]}
        grid_sets[source['repository']] = keys; grid_stats.append(stats)
        cached[source['blob']] = (keys, stats)
    for stat in grid_stats:
        stat['snapshotCellsAbsentFromRepo3'] = len(grid_sets[stat['repository']] - grid_sets['mlgw.outage.3'])
    grid_conflicts = [key for key, variants in cells.items() if len(variants) > 1]
    grid_output = write_records(stage / 'grid-cells.jsonl.gz', grids)
    captures = sorted(set(row['captureKey'] for row in grids.values()))
    grid_report = {'repositories': grid_stats, 'uniqueSnapshotCells': len(grids),
                   'uniqueSnapshots': len(captures), 'uniqueGridCellIds': len(set(row['gridCellId'] for row in grids.values())),
                   'duplicateCellReferences': sum(len(s) for s in grid_sets.values()) - len(grids),
                   'conflictingCaptureCells': grid_conflicts, 'storedDateRange': [captures[0][:10], captures[-1][:10]],
                   'output': grid_output}
    del grids, cells, grid_sets, cached

    snapshots, by_content, snapshot_stats = {}, collections.defaultdict(list), []
    for file in inventory['entries']:
        if not file['path'].startswith('data/'):
            continue
        key = (file['repository'], capture_key(file['path']))
        snapshots.setdefault(key, []).append(file)
        by_content[file['blob']].append(key)
    for repo in inventory['repositories']:
        selected = {k: v for k, v in snapshots.items() if k[0] == repo['name']}
        dates = sorted(k[1] for k in selected)
        snapshot_stats.append({'repository': repo['name'], 'capturesInTipTree': len(selected),
                               'pairedRDataAndText': sum(any(f['path'].endswith('.RData') for f in v) and
                                                        any(f['path'].endswith('_txt.rds') for f in v) for v in selected.values()),
                               'storedDateRange': [dates[0][:10], dates[-1][:10]] if dates else None})
    report = {'version': VERSION, 'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
              'sourceCatalogSha256': hashlib.sha256((stage / 'sources.json').read_bytes()).hexdigest(),
              'scope': inventory['scope'], 'originalReferencesVerified': len(sources),
              'uniqueOriginalsVerified': len(set(f['blob'] for f in sources.values())),
              'totals': total_report, 'geometry': grid_report, 'tipSnapshotInventory': snapshot_stats,
              'snapshotBlobsSharedByDifferentCaptures': sum(len(set(v)) > 1 for v in by_content.values()),
              'readyForWeatherAlignment': False,
              'remainingGates': ['Resolve naive-time timezone periods and DST ambiguity before alignment.',
                                 'Audit historical Git revisions for originals absent from branch tips.',
                                 'Validate raw saved pages, including captures absent from event-derived totals.',
                                 'Publish separate legacy read-only views after import validation.']}
    write_json(Path('reports/legacy-data-audit.json'), report)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    audit()
