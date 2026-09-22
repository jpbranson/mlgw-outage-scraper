"""Offline capture availability, sampling and timeline-gap audit; never imputes outages."""
import bisect
import collections
import csv
import datetime as dt
import gzip
import hashlib
import json
from pathlib import Path
import re
from zoneinfo import ZoneInfo

ROOT = Path('data/legacy/coverage')
UTC = dt.timezone.utc
PATTERN = re.compile(r'data/(\d{4}-\d{2}-\d{2}_\d{2}_\d{2}_\d{2}(?:\.\d{1,6})?)(\.csv|\.txt|\.RData|_txt\.rds)')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, data):
    p = Path(path)
    p.with_suffix(p.suffix + '.tmp').write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
    p.with_suffix(p.suffix + '.tmp').replace(p)


def candidates(key, zone_name=None):
    wall = dt.datetime.fromisoformat(key[:10] + 'T' + key[11:].replace('_', ':'))
    result = {wall.replace(tzinfo=UTC).timestamp()} if zone_name != 'America/Chicago' else set()
    if zone_name == 'UTC':
        return sorted(result)
    zone = ZoneInfo('America/Chicago')
    for fold in (0, 1):
        aware = wall.replace(tzinfo=zone, fold=fold)
        value = aware.astimezone(UTC)
        if value.astimezone(zone).replace(tzinfo=None) == wall:
            result.add(value.timestamp())
    return sorted(result)


def nearby(key, clocks, rows, zone_name=None):
    # Availability association only, never a new timezone-recovery rule.
    matches = {}
    for clock in candidates(key, zone_name):
        lo, hi = bisect.bisect_left(clocks, clock - 1.000001), bisect.bisect_right(clocks, clock + 1.000001)
        for i in range(lo, hi):
            matches[rows[i]['sourceTime']] = rows[i]
    return list(matches.values())


def gaps(times, threshold=3600):
    clocks = sorted(set(times))
    return [{'after': a.isoformat().replace('+00:00', 'Z'), 'before': b.isoformat().replace('+00:00', 'Z'),
             'secondsBetweenObservations': (b-a).total_seconds()}
            for a, b in zip(clocks, clocks[1:]) if (b-a).total_seconds() > threshold]


def main():
    inventory = json.loads((ROOT / 'inventory.json').read_text())
    catalog = json.loads(Path('data/legacy/recovered/catalog.json').read_text())
    if catalog.get('verified') is not True:
        raise ValueError('Recovered catalog must be verified')
    if sha(catalog['verification']) != catalog['verificationSha256']:
        raise ValueError('Recovered verification evidence hash mismatch')
    for output in catalog['outputs'].values():
        if sha(output['path']) != output['sha256']:
            raise ValueError('Recovered output hash mismatch')
    with gzip.open(catalog['outputs']['totals']['path'], 'rt') as f:
        totals = [json.loads(l) for l in f]
    by_source = {r['sourceTime']: r for r in totals}
    zones_by_wall = collections.defaultdict(set)
    for row in totals:
        zones_by_wall[row['sourceTime'].split('.')[0]].add(row['timeRecovery'].get('zone'))
    resolved = sorted((r for r in totals if r['observedAt']), key=lambda r: r['observedAt'])
    clocks = [dt.datetime.fromisoformat(r['observedAt']).timestamp() for r in resolved]
    originals = {}
    with open('data/legacy/recovery-evidence/original-matches.csv', newline='') as f:
        for r in csv.DictReader(f):
            if r['full_event_content_match'] == 'TRUE':
                originals[(r['repository'], PATTERN.fullmatch(r['filename'])[1])] = r['matched_source_time']
    empty_blobs = set()
    with open('data/legacy/recovery-evidence/inspection.csv', newline='') as f:
        for r in csv.DictReader(f):
            if int(r['rows']) == 0:
                empty_blobs.add(r['blob'])
    captures = {}
    for f in inventory['entries']:
        match = PATTERN.fullmatch(f['path'])
        if not match:
            raise ValueError('Unexpected capture path')
        key, kind = match.groups()
        capture = captures.setdefault((f['repository'], key), {'repository': f['repository'], 'captureKey': key, 'files': []})
        # Repeated checkpoint reference does not create another capture or file.
        existing = next((e for e in capture['files'] if e['path'] == f['path'] and e['blob'] == f['blob']), None)
        if existing:
            existing['commits'].append(f['commit'])
        else:
            capture['files'].append({**f, 'kind': kind, 'commits': [f['commit']]})
    associated, ambiguous, no_match, shared = set(), [], [], collections.defaultdict(list)
    for pair, capture in sorted(captures.items()):
        direct = originals.get(pair)
        # Source versions already independently audited in timezone recovery.
        # The Apr 28 manual transition captures have direct original-content matches.
        zone = 'America/Chicago' if pair[0] == 'mlgw.outage.3' or (pair[0] == 'mlgw.outage.2' and pair[1][:10] > '2024-04-28') else 'UTC'
        # On the switch day use the exact stored-total relation to disambiguate
        # later Central captures from older UTC wall clocks in the same date.
        if pair[0] == 'mlgw.outage.2' and pair[1][:10] == '2024-04-28' and not direct:
            same_wall = pair[1][:10] + ' ' + pair[1][11:].replace('_', ':')
            zones = zones_by_wall[same_wall.split('.')[0]]
            zone = next(iter(zones)) if len(zones) == 1 else None
        capture['filenameZoneRule'] = zone
        capture['knownEmptyEventObject'] = any(f['blob'] in empty_blobs for f in capture['files'] if f['kind'] == '.RData')
        matches = [by_source[direct]] if direct else [] if capture['knownEmptyEventObject'] else nearby(pair[1], clocks, resolved, zone)
        capture['association'] = 'original-full-content' if direct else 'unique-clock-candidate' if len(matches) == 1 else 'ambiguous' if matches else 'none'
        capture['candidateTotalTimes'] = [r['sourceTime'] for r in matches]
        capture['totalSourceTime'] = matches[0]['sourceTime'] if len(matches) == 1 else None
        capture['observedAt'] = matches[0]['observedAt'] if len(matches) == 1 else None
        if len(matches) == 1:
            associated.add(matches[0]['sourceTime'])
        elif matches:
            ambiguous.append(capture)
        else:
            no_match.append(capture)
        for f in capture['files']:
            shared[f['blob']].append(pair)
    records = list(captures.values())
    records.sort(key=lambda r: (r['repository'], r['captureKey']))
    with (ROOT/'captures.jsonl.gz').open('wb') as raw:
        with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as out:
            for r in records:
                out.write((json.dumps(r, separators=(',', ':')) + '\n').encode())
    # Deliberate strata: month/format edges; all distinct unmatched parsed-object blobs;
    # and examples of empty-object reuse. These are not a random completeness sample.
    selected = {}
    def select(r, reason):
        item = selected.setdefault((r['repository'], r['captureKey']), {'capture': r, 'reasons': []})
        if reason not in item['reasons']:
            item['reasons'].append(reason)
    strata = collections.defaultdict(list)
    for r in records:
        kind = '+'.join(sorted(f['kind'] for f in r['files']))
        strata[(r['repository'], r['captureKey'][:7], kind)].append(r)
    for group in strata.values():
        for i in sorted({0, len(group)//2, len(group)-1}):
            select(group[i], 'month-and-format-stratum')
    inspected = set()
    for r in no_match + ambiguous:
        for f in r['files']:
            if f['blob'] not in inspected:
                inspected.add(f['blob'])
                select(r, 'distinct-unmatched-object-or-page')
    for repo in {r['repository'] for r in records}:
        empty = [r for r in records if r['repository'] == repo and r['knownEmptyEventObject']]
        for r in empty[:3] + empty[-3:]:
            select(r, 'known-empty-object')
    files = [dict(f, selectionReasons=item['reasons']) for item in selected.values() for f in item['capture']['files']]
    write_json(ROOT/'selected.json', files)
    month_totals = collections.Counter(r['observedAt'][:7] for r in resolved)
    with gzip.open(catalog['outputs']['grids']['path'], 'rt') as f:
        grid_times = {json.loads(l)['observedAt'] for l in f}
    month_grids = collections.Counter(t[:7] for t in grid_times)
    monthly = []
    cursor = dt.date.fromisoformat(resolved[0]['observedAt'][:7]+'-01')
    last_month = resolved[-1]['observedAt'][:7]
    while cursor.strftime('%Y-%m') <= last_month:
        month = cursor.strftime('%Y-%m')
        monthly.append({'utcMonth': month, 'resolvedTotals': month_totals[month], 'resolvedGridSnapshots': month_grids[month]})
        cursor = dt.date(cursor.year + (cursor.month == 12), cursor.month % 12 + 1, 1)
    total_gaps = gaps([dt.datetime.fromisoformat(r['observedAt']) for r in resolved])
    grid_gaps = gaps([dt.datetime.fromisoformat(t) for t in grid_times])
    write_json(ROOT/'timeline-gaps.json', {'thresholdSeconds': 3600, 'meaning': 'Between known observations, not outage duration or proven scraper downtime', 'totals': total_gaps, 'grids': grid_gaps})
    write_json(ROOT/'unmatched-captures.json', no_match + ambiguous)
    write_json(ROOT/'totals-without-capture.json', [r for r in totals if r['sourceTime'] not in associated])
    summary = {
        'checkedAt': dt.datetime.now(UTC).isoformat(), 'scope': inventory['scope'], 'recoveredGeneration': catalog['generation'],
        'inventorySha256': sha(ROOT/'inventory.json'), 'captureManifestSha256': sha(ROOT/'captures.jsonl.gz'),
        'captureKeys': len(records), 'fileReferencesAcrossRevisions': len(inventory['entries']),
        'distinctRepositoryFiles': sum(len(r['files']) for r in records), 'uniqueBlobs': len(shared),
        'blobsReusedAcrossCaptureKeys': sum(len(set(v)) > 1 for v in shared.values()),
        'conflictingFileVersions': sum(len({f['path'] for f in r['files']}) != len(r['files']) for r in records),
        'associatedCaptures': sum(r['totalSourceTime'] is not None for r in records),
        'originalContentAssociations': sum(r['association']=='original-full-content' for r in records),
        'unmatchedCaptures': len(no_match), 'ambiguousCaptures': len(ambiguous),
        'knownEmptyEventCaptures': sum(r['knownEmptyEventObject'] for r in records),
        'totalsWithCandidateOriginal': len(associated), 'totalsWithoutCandidateOriginal': len(totals)-len(associated),
        'selectedCaptures': len(selected), 'selectedFiles': len(files), 'selectedBytes': sum(f['bytes'] for f in files),
        'monthlyUTC': monthly, 'totalIntervalsOverOneHour': len(total_gaps), 'gridIntervalsOverOneHour': len(grid_gaps),
        'largestTotalIntervals': sorted(total_gaps, key=lambda g: g['secondsBetweenObservations'], reverse=True)[:10],
        'repositories': [{ 'repository': repo, 'captures': len(group),
            'storedFilenameRange': [group[0]['captureKey'], group[-1]['captureKey']],
            'associatedCaptures': sum(bool(r['totalSourceTime']) for r in group),
            'parsedAndSavedTextPairs': sum(any(f['kind'] in ('.csv','.RData') for f in r['files']) and any(f['kind'] in ('.txt','_txt.rds') for f in r['files']) for r in group)}
            for repo in sorted({r['repository'] for r in records})
            for group in [[r for r in records if r['repository']==repo]]],
        'sampleValidation': 'pending', 'dashboardPublished': False,
    }
    write_json('reports/legacy-coverage-audit.json', summary)
    print(json.dumps({k:v for k,v in summary.items() if k not in ('monthlyUTC','largestTotalIntervals')},indent=2))


if __name__ == '__main__':
    main()
