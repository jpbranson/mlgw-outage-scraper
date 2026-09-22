"""Versioned, offline timezone recovery. Retains originals and publishes only a separate catalog."""
import bisect
import collections
import csv
import datetime as dt
from decimal import Decimal, ROUND_HALF_EVEN
import gzip
import hashlib
import json
from pathlib import Path
import re
from zoneinfo import ZoneInfo

VERSION = 'legacy-time-recovery-v1'
UTC = dt.timezone.utc
CENTRAL = ZoneInfo('America/Chicago')
ROOT = Path('data/legacy')
EVIDENCE = ROOT / 'recovery-evidence'
LATEST_SOURCE = 'mlgw.outage.3/total_outages.rds'
FIRST_CENTRAL_ROW = 1775646
FIRST_BOUNDARY_ROW = 1775632
UNKNOWN_TIME = '2024-04-26 12:24:32.859703'
EXPECTED_TOTAL_SHA = 'eff8233cb93b33da0890a6d3649f713c41ba54f3cc65f1d0fcb07bc7f0d7fdfe'
EXPECTED_GRID_SHA = '298162d27b0a6e61967812624256b954038e021ad43717e5d5c9bd9899861b8c'


def digest(file):
    with Path(file).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def iso(value):
    return value.astimezone(UTC).isoformat(timespec='microseconds').replace('+00:00', 'Z')


def parse(value):
    return dt.datetime.fromisoformat(value.replace('Z', '+00:00'))


def candidates(raw, zone):
    value = parse(raw)
    if value.tzinfo is not None:
        raise ValueError('Expected a timezone-free source string')
    result = set()
    for fold in (0, 1):
        utc = value.replace(tzinfo=zone, fold=fold).astimezone(UTC)
        if utc.astimezone(zone).replace(tzinfo=None) == value:
            result.add(utc)
    return sorted(result)


def absolute_epoch(raw):
    value = Decimal(raw)
    if not value.is_finite() or not Decimal('0') <= value < Decimal('4102444800'):
        raise ValueError('Epoch outside supported bounds')
    micros = int((value * 1000000).to_integral_value(rounding=ROUND_HALF_EVEN))
    return dt.datetime(1970, 1, 1, tzinfo=UTC) + dt.timedelta(microseconds=micros)


def key_from_filename(filename):
    match = re.fullmatch(r'(?:\./data/|data/)?(\d{4}-\d{2}-\d{2}_\d{2}_\d{2}_\d{2}(?:\.\d{1,6})?)(?:\.txt|\.RData)', filename)
    if not match:
        raise ValueError('Unexpected original filename')
    return match[1]


def select_commit_zone(raw, committed_at, maximum_lag=300):
    commit = parse(committed_at)
    if commit.tzinfo is None:
        raise ValueError('Commit time requires an explicit offset')
    acceptable = []
    for zone, name in [(UTC, 'UTC'), (CENTRAL, 'America/Chicago')]:
        for value in candidates(raw, zone):
            lag = (commit - value).total_seconds()
            if 0 <= lag <= maximum_lag:
                acceptable.append((value, name, lag))
    if len(acceptable) != 1:
        raise ValueError('Commit does not select exactly one timezone candidate')
    return acceptable[0]


def read_records(file):
    with gzip.open(file, 'rt', encoding='utf-8') as stream:
        for line in stream:
            yield json.loads(line)


def write_records(file, records):
    temp = file.with_suffix(file.suffix + '.tmp')
    with temp.open('wb') as raw:
        with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as stream:
            for record in records:
                stream.write((json.dumps(record, separators=(',', ':'), ensure_ascii=False) + '\n').encode())
    temp.replace(file)
    return {'path': file.as_posix(), 'bytes': file.stat().st_size, 'sha256': digest(file)}


def write_json(file, value):
    temp = file.with_suffix(file.suffix + '.tmp')
    temp.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    temp.replace(file)


def make_manual_anchors(matches):
    specifications = [
        ('2022-12-24 01:08:56', 'early-character-history.json'),
        ('2024-04-26 17:22:43.937077', 'april26-detail.json'),
        ('2024-04-28 16:01:24.799172', 'switch-detail.json'),
        ('2024-04-28 16:03:21.523106', 'switch-detail.json'),
    ]
    anchors = {}
    for source_time, evidence_file in specifications:
        matching = [m for m in matches if m['matched_source_time'] == source_time and m['rendering'] == 'character']
        if len(matching) != 1:
            raise ValueError('Missing/ambiguous full-content boundary match')
        match = matching[0]
        commit = json.loads((EVIDENCE / evidence_file).read_text())
        if isinstance(commit, list):
            if len(commit) != 1:
                raise ValueError('Expected one original-file history revision')
            commit = commit[0]
        else:
            if not any(f['filename'] == match['filename'] and f['sha'] == match['blob'] and f['status'] == 'added' for f in commit['files']):
                raise ValueError('Boundary capture was not added in the expected commit')
        committed_at = commit['commit']['committer']['date']
        value, zone, lag = select_commit_zone(source_time, committed_at)
        anchors[source_time] = {'observedAt': iso(value), 'method': 'original-content-and-commit-anchor', 'zone': zone,
                               'blob': match['blob'], 'filename': match['filename'], 'commit': commit['sha'],
                               'committedAt': committed_at, 'commitLagSeconds': lag, 'evidenceFile': evidence_file,
                               'firstSourceRow': int(match['first_source_row'])}
    return anchors


def resolve_total(record, epochs, manual):
    result = dict(record, originalTimeStatus=record['timeStatus'])
    raw = record['sourceTime']
    precision = len(raw.rstrip('Z').split('.')[-1]) if '.' in raw else 0
    proof = {'version': VERSION, 'sourceFractionDigits': precision}
    index = next(p['firstSourceRow'] for p in record['provenance'] if p['source'] == LATEST_SOURCE)
    value = None
    if raw.endswith('Z'):
        value = parse(raw); proof.update(method='explicit-UTC', zone='UTC')
    elif raw in epochs:
        match = epochs[raw]
        if index != int(match['first_source_row']):
            raise ValueError('Epoch provenance row mismatch')
        value = absolute_epoch(match['epoch_seconds'])
        if value.astimezone(CENTRAL).strftime('%Y-%m-%d %H:%M:%S') != raw:
            raise ValueError('Original epoch does not reproduce consolidated rendering')
        proof.update(method='original-POSIXct-epoch', zone='absolute-instant', blob=match['blob'],
                     filename=match['filename'], originalEpochSeconds=match['epoch_seconds'],
                     consolidationRendering='America/Chicago at whole seconds', precision='rounded to microsecond; original numeric text retained')
    elif raw in manual:
        anchor = manual[raw]
        if index != anchor['firstSourceRow']:
            raise ValueError('Boundary anchor provenance row mismatch')
        value = parse(anchor['observedAt']); proof.update({k:v for k,v in anchor.items() if k != 'observedAt'})
    elif raw == UNKNOWN_TIME:
        proof.update(method='unresolved', reason='Original capture and independent clock anchor unavailable',
                     utcCandidates=[iso(v) for zone in (UTC,CENTRAL) for v in candidates(raw,zone)])
    else:
        if index >= FIRST_CENTRAL_ROW:
            zone, name, source_commit = CENTRAL, 'America/Chicago', '15c24fa1a7eb2c8530468a8e340920f4d194b54e'
        elif raw >= '2022-12-24 07:10:24' and index < FIRST_BOUNDARY_ROW:
            zone, name, source_commit = UTC, 'UTC', 'cd7c8dc719be6e8a865b2ad4ad016a40e4b4892d'
        else:
            zone = None
        if zone is None:
            proof.update(method='unresolved', reason='Outside verified source-version rules')
        else:
            choices = candidates(raw, zone)
            proof.update(method='verified-source-version', zone=name, sourceCommit=source_commit,
                         basis='Historical scraper/setup code corroborated by retained capture/commit anchors')
            if len(choices) == 1:
                value = choices[0]
            else:
                proof.update(method='unresolved', reason='Ambiguous or nonexistent local time', utcCandidates=[iso(c) for c in choices])
    result.update(observedAt=iso(value) if value else None, timeStatus='resolved' if value else 'timezone-unresolved', timeRecovery=proof)
    return result


def main():
    input_totals = ROOT / 'staged/totals.jsonl.gz'; input_grids = ROOT / 'staged/grid-cells.jsonl.gz'
    if digest(input_totals) != EXPECTED_TOTAL_SHA or digest(input_grids) != EXPECTED_GRID_SHA:
        raise ValueError('Staged inputs changed: source-row rules must be reviewed')
    policy_files = {
        'UTC scraper': ROOT/'time-evidence/mlgw.outage.job-cd7c8dc719be6e8a865b2ad4ad016a40e4b4892d.txt',
        'Central scraper': ROOT/'time-evidence/mlgw.outage.2.job-15c24fa1a7eb2c8530468a8e340920f4d194b54e.txt',
        'R setup UTC': ROOT/'time-evidence/r-lib/installer-2022.ts',
        'verified capture anchors': ROOT/'time-evidence/capture-time-inspection.csv',
    }
    if 'timestamp <- Sys.time()\n' not in policy_files['UTC scraper'].read_text():
        raise ValueError('UTC scraper evidence changed')
    if 'timestamp <- Sys.time() %>% with_tz("America/Chicago")' not in policy_files['Central scraper'].read_text():
        raise ValueError('Central scraper evidence changed')
    if 'core.exportVariable("TZ", "UTC")' not in policy_files['R setup UTC'].read_text():
        raise ValueError('R setup UTC evidence changed')
    catalog = json.loads((ROOT / 'staged/sources.json').read_text())
    for source in catalog['sources'].values():
        if digest(source['local']) != source['sha256']:
            raise ValueError('Consolidated original hash mismatch')
    originals = json.loads((EVIDENCE / 'captures.json').read_text())
    original_by_blob = {r['blob']:r for r in originals}
    for original in original_by_blob.values():
        if digest(original['local']) != original['sha256']:
            raise ValueError('Recovery original hash mismatch')
    matches = list(csv.DictReader((EVIDENCE / 'original-matches.csv').open(encoding='utf-8')))
    epochs = {}
    for match in matches:
        if match['full_event_content_match'] != 'TRUE' or match['blob'] not in original_by_blob:
            raise ValueError('Unverified original content match')
        if match['rendering'] == 'central':
            if match['matched_source_time'] in epochs:
                raise ValueError('Multiple original epochs for a consolidated value')
            epochs[match['matched_source_time']] = match
        elif match['rendering'] != 'character':
            raise ValueError('Unsupported/competing consolidation rendering')
    if len(epochs) != 1567:
        raise ValueError('Expected complete 1,567-epoch recovery cohort')
    manual = make_manual_anchors(matches)
    totals = [resolve_total(r, epochs, manual) for r in read_records(input_totals)]
    boundary = next(r for r in totals if r['sourceTime'] == '2024-04-28 16:05:55.281641')
    if next(p['firstSourceRow'] for p in boundary['provenance'] if p['source'] == LATEST_SOURCE) != FIRST_CENTRAL_ROW:
        raise ValueError('Source layout no longer matches the Central transition')
    totals.sort(key=lambda r: (r['observedAt'] is None, r['observedAt'] or '', r['sourceTime']))
    known = [r for r in totals if r['observedAt']]
    instants = [parse(r['observedAt']) for r in known]
    if len(set(instants)) != len(instants):
        raise ValueError('UTC collision requires explicit conflict review')
    total_by_source = {r['sourceTime']:r for r in totals}
    by_file = collections.defaultdict(list)
    for match in matches:
        total = total_by_source.get(match['matched_source_time'])
        if total and total['observedAt']:
            by_file[key_from_filename(match['filename'])].append((match, total))
    grid_times = {}; grids = []
    for record in read_records(input_grids):
        key = record['captureKey']
        if key not in grid_times:
            raw = key[:10] + ' ' + key[11:].replace('_', ':')
            proof = {'version': VERSION, 'sourceFilenameTime': raw}
            value = None
            pairs = by_file.get(key, [])
            if pairs and len({r['observedAt'] for _,r in pairs}) == 1:
                match, total = pairs[0]; value = parse(total['observedAt'])
                proof.update(method='paired-original-RData', blob=match['blob'], filename=match['filename'],
                             relatedTotalSourceTime=total['sourceTime'], totalRecoveryMethod=total['timeRecovery']['method'])
            elif not pairs and key[:10] <= '2024-04-27':
                # UTC filename convention must also have an independent unique recovered total within one second.
                candidate = parse(raw).replace(tzinfo=UTC)
                lo = bisect.bisect_left(instants, candidate - dt.timedelta(seconds=1))
                hi = bisect.bisect_right(instants, candidate + dt.timedelta(seconds=1))
                if hi - lo == 1:
                    value = candidate; total = known[lo]
                    proof.update(method='UTC-filename-with-total-anchor', zone='UTC',
                                 relatedTotalSourceTime=total['sourceTime'], filenameMinusTotalSeconds=(candidate-instants[lo]).total_seconds(),
                                 precision='Filename clock; separately sampled from event timestamp, verified within one second')
            if value is None:
                proof.update(method='unresolved', reason='No unique paired-original or verified filename/total anchor')
            grid_times[key] = (iso(value) if value else None, proof)
        value, proof = grid_times[key]
        grids.append(dict(record, originalTimeStatus=record['timeStatus'], observedAt=value,
                          timeStatus='resolved' if value else 'timezone-unresolved', timeRecovery=proof))
    grids.sort(key=lambda r: (r['observedAt'] is None, r['observedAt'] or '', r['captureKey'], r['gridCellId']))
    # Content-addressed generation: report/catalog publication happens only after all processing and checks succeed.
    evidence_files = ['original-matches.csv','captures.json','metadata.json','early-character-history.json','april26-detail.json','switch-detail.json']
    inputs = {'totals': EXPECTED_TOTAL_SHA, 'grids': EXPECTED_GRID_SHA, 'sourceCatalog':digest(ROOT/'staged/sources.json'),
              'policyEvidence':{name:{'path':file.as_posix(),'sha256':digest(file)} for name,file in policy_files.items()},
              'evidence': {name:digest(EVIDENCE/name) for name in evidence_files},
              'resolverSha256': digest(__file__)}
    generation = hashlib.sha256(json.dumps(inputs,sort_keys=True).encode()).hexdigest()[:20]
    output = ROOT / 'recovered' / VERSION / generation
    output.mkdir(parents=True, exist_ok=True)
    exceptions = [{'kind':'regional-total','sourceTime':r['sourceTime'],'outages':r['outages'],'customers':r['customers'],
                   'recovery':r['timeRecovery'],'provenance':r['provenance']} for r in totals if not r['observedAt']]
    exceptions += [{'kind':'grid-capture','captureKey':key,'recovery':proof} for key,(time,proof) in grid_times.items() if not time]
    outputs = {'totals':write_records(output/'totals.jsonl.gz',totals), 'grids':write_records(output/'grid-cells.jsonl.gz',grids)}
    write_json(output/'exceptions.json',exceptions)
    methods = collections.Counter((r['timeRecovery']['method'] + (':' + r['timeRecovery']['zone'] if r['timeRecovery']['method']=='verified-source-version' else '')) for r in totals)
    report = {'version':VERSION, 'generatedAt':dt.datetime.now(UTC).isoformat(), 'generation':generation, 'inputs':inputs, 'outputs':outputs,
              'totalObservations':len(totals),'resolvedTotalObservations':len(known),'unresolvedTotalObservations':len(totals)-len(known),
              'totalMethods':dict(methods),'newlyRecoveredTimezoneFreeTotals':len(known)-17519,
              'gridCellRecords':len(grids),'gridCaptures':len(grid_times),'resolvedGridCaptures':sum(bool(t) for t,_ in grid_times.values()),
              'gridMethods':dict(collections.Counter(p['method'] for _,p in grid_times.values())),
              'utcCollisions':0,'utcRange':[known[0]['observedAt'],known[-1]['observedAt']],
              'exceptionFile':(output/'exceptions.json').as_posix(),'exceptions':exceptions,'manualAnchors':manual,
              'stagedInputsUnchanged':True,'dashboardPublished':False,'validation':'pending-independent-verification'}
    write_json(output/'report.json',report)
    write_json(ROOT/'recovered/catalog.json',{'version':VERSION,'generation':generation,'report':(output/'report.json').as_posix(),'outputs':outputs,'verified':False})
    write_json(Path('reports/legacy-timezone-recovery.json'),report)
    print(json.dumps({k:v for k,v in report.items() if k not in ('inputs','manualAnchors','exceptions')},indent=2))


if __name__ == '__main__':
    main()
