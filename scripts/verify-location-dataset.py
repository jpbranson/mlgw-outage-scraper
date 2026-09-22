"""Independently compare a derived dataset with archived source JSON; all input opens are read-only."""
import gzip
import hashlib
import itertools
import json
import math
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

directory = Path(sys.argv[1]).resolve()
root = Path(__file__).resolve().parents[1]
archive = root / 'data/collector/archive'
db = sqlite3.connect((directory / 'locations.sqlite').as_uri() + '?mode=ro', uri=True)
db.row_factory = sqlite3.Row
meta = {r['key']: json.loads(r['value_json']) for r in db.execute('SELECT * FROM metadata')}
captures = list(db.execute('SELECT * FROM captures ORDER BY captured_ms'))
sites = {r['site_id']: (r['longitude'], r['latitude']) for r in db.execute('SELECT * FROM sites')}
coordinates = {point: key for key, point in sites.items()}
assert len(coordinates) == len(sites), 'Duplicate site geometry'
expected, site_ids, site_spans = {}, defaultdict(set), defaultdict(list)
histogram, bin_ids = Counter(), defaultdict(set)
raw_by_capture = {}

def safe_path(key):
    path = (archive / key).resolve()
    path.relative_to(archive.resolve())
    return path

def distance(a, b):
    lat1, lat2 = math.radians(a[1]), math.radians(b[1])
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(math.radians(b[0] - a[0]) / 2) ** 2
    return 12742017.6 * math.asin(math.sqrt(min(1, h)))

for c in captures:
    manifest_bytes = safe_path(c['manifest_key']).read_bytes()
    assert hashlib.sha256(manifest_bytes).hexdigest() == c['manifest_hash']
    manifest = json.loads(manifest_bytes)
    body = gzip.decompress(safe_path(manifest['bodies']['feed']['key']).read_bytes())
    assert hashlib.sha256(body).hexdigest() == c['raw_hash'] == manifest['bodies']['feed']['hash']
    assert hashlib.sha256(safe_path(manifest['parserKey']).read_bytes()).hexdigest() == c['parser_hash']
    feed = json.loads(body)['features']
    assert len(feed) == c['source_outages']
    assert sum(f['properties']['CUR_CUST_AFF'] for f in feed) == c['source_customers']
    current = {}
    for f in feed:
        p = f['properties']
        source_id = str(p['OUTAGE_NO']).strip()
        assert source_id not in current
        geometry = f.get('geometry')
        geometry = geometry if isinstance(geometry, dict) else {}
        raw_point = geometry.get('coordinates')
        valid = geometry.get('type') == 'Point' and isinstance(raw_point, list) and len(raw_point) == 2
        valid = valid and all(isinstance(v, (float, int)) and math.isfinite(v) for v in raw_point)
        valid = valid and -90.4 <= raw_point[0] <= -89.3 and 34.7 <= raw_point[1] <= 35.7
        site = coordinates[tuple(raw_point)] if valid else None
        state = (site, p['CUR_CUST_AFF'], p.get('TIME_STAMP'), p.get('IMPACT'), p.get('STATUS'))
        expected[(c['capture_id'], source_id)] = state
        current[source_id] = state
        if site is not None:
            site_ids[site].add(source_id)
            site_spans[(site, source_id)].append((c['captured_ms'], c['capture_id']))
            histogram[(site, p['CUR_CUST_AFF'])] += 1
            bin_ids[(site, p['CUR_CUST_AFF'])].add(source_id)
    raw_by_capture[c['capture_id']] = current

actual = {(r['capture_id'], r['source_id']): (r['site_id'], r['customers'], r['source_start_raw'], r['impact'], r['status'])
          for r in db.execute('SELECT * FROM observations')}
assert actual == expected, 'Observation rows differ from original source'
assert {(r['site_id'], r['customers']): r['observation_count'] for r in db.execute('SELECT * FROM site_customer_distribution')} == histogram
assert {(r['site_id'], r['customers']): r['source_record_count'] for r in db.execute('SELECT * FROM site_customer_distribution')} == {key: len(ids) for key, ids in bin_ids.items()}
expected_pairs = {}
for site, ids in site_ids.items():
    for a, b in itertools.combinations(sorted(ids), 2):
        a_times, b_times = site_spans[(site, a)], site_spans[(site, b)]
        disjoint = max(t for t, _ in a_times) < min(t for t, _ in b_times) or max(t for t, _ in b_times) < min(t for t, _ in a_times)
        together = bool({c for _, c in a_times} & {c for _, c in b_times})
        expected_pairs[(site, a, b)] = (int(disjoint), int(together))
assert {(r['site_id'], r['source_id_a'], r['source_id_b']): (r['disjoint_observed_spans'], r['observed_together'])
        for r in db.execute('SELECT * FROM exact_recurrences')} == expected_pairs

source_db = sqlite3.connect((root / 'data/collector/index.sqlite').as_uri() + '?mode=ro', uri=True)
bad_times = [r[0] for r in source_db.execute("SELECT received_ms FROM poll_attempts WHERE outcome NOT IN ('valid','duplicate_slot')")]
source_rows = {r[0]: r[1:] for r in source_db.execute('SELECT s.id,s.raw_hash,a.manifest_hash,s.parser_hash FROM snapshots s JOIN poll_attempts a ON s.id=a.id')}
source_db.close()
last_seen, previous, previous_capture = {}, {}, None
expected_transitions, expected_candidates, episode_count = {}, {}, 0
for c in captures:
    assert source_rows[c['capture_id']] == (c['raw_hash'], c['manifest_hash'], c['parser_hash'])
    current = raw_by_capture[c['capture_id']]
    comparable = previous_capture is not None and c['captured_ms'] - previous_capture['captured_ms'] <= meta['maxGapMs']
    comparable = comparable and not any(previous_capture['captured_ms'] < t <= c['captured_ms'] for t in bad_times)
    assert int(comparable) == c['comparable_to_previous']
    for source_id, state in current.items():
        continuous = comparable and source_id in previous
        if not continuous:
            episode_count += 1
        if source_id in last_seen:
            old_capture, old = last_seen[source_id]
            moved, changed_count, changed_start = old[0] != state[0], old[1] != state[1], old[2] != state[2]
            if moved or changed_count or changed_start or not continuous:
                expected_transitions[(source_id, old_capture, c['capture_id'])] = (int(moved), int(changed_count), int(changed_start), int(continuous))
        last_seen[source_id] = (c['capture_id'], state)
    if comparable:
        for a in previous.keys() - current.keys():
            for b in current.keys() - previous.keys():
                old, new = previous[a], current[b]
                if old[0] is None or new[0] is None:
                    continue
                meters = distance(sites[old[0]], sites[new[0]])
                if meters <= meta['candidateDistanceMeters']:
                    expected_candidates[(previous_capture['capture_id'], c['capture_id'], a, b)] = meters
    previous, previous_capture = current, c
assert db.execute('SELECT COUNT(*) FROM episodes').fetchone()[0] == episode_count
assert {(r['source_id'], r['from_capture_id'], r['to_capture_id']): (r['location_changed'], r['customers_changed'], r['start_changed'], r['comparable'])
        for r in db.execute('SELECT * FROM transitions')} == expected_transitions
actual_candidates = {(r['from_capture_id'], r['to_capture_id'], r['from_source_id'], r['to_source_id']): r['distance_meters']
                     for r in db.execute('SELECT * FROM candidate_turnovers')}
assert actual_candidates.keys() == expected_candidates.keys()
assert all(abs(actual_candidates[key] - value) < 1e-6 for key, value in expected_candidates.items())
geojson = json.loads((directory / 'locations.geojson').read_text())
assert {f['id']: tuple(f['geometry']['coordinates']) for f in geojson['features']} == sites
assert all(f['properties']['footprint_available'] is False for f in geojson['features'])
assert not list(db.execute('PRAGMA foreign_key_check'))
assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
result = {'verified': True, 'method': 'Independent Python reconstruction directly from hash-verified original GeoJSON.',
          'captures': len(captures), 'observations': len(expected), 'sites': len(sites),
          'sourceRecords': len(last_seen), 'episodes': episode_count, 'distributionBins': len(histogram),
          'exactRecurrencePairs': len(expected_pairs), 'transitions': len(expected_transitions),
          'candidateTurnovers': len(expected_candidates), 'geojsonFeatures': len(geojson['features'])}
db.close()
(directory / 'independent-verification.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
