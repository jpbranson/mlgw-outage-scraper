"""Verify original capture times against Git commits; report, never rewrite staging."""
import collections
import csv
import datetime as dt
from decimal import Decimal
import gzip
import hashlib
import json
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path('data/legacy/time-evidence')
UTC = dt.timezone.utc
CENTRAL = ZoneInfo('America/Chicago')


def utc_candidates(raw, zone):
    naive = dt.datetime.fromisoformat(raw)
    if naive.tzinfo is not None:
        raise ValueError('Expected timezone-free source value')
    result = set()
    for fold in (0, 1):
        candidate = naive.replace(tzinfo=zone, fold=fold).astimezone(UTC)
        if candidate.astimezone(zone).replace(tzinfo=None) == naive:
            result.add(candidate)
    return sorted(result)


def close_commit_candidates(raw, committed, maximum_lag_seconds=120):
    result = []
    for zone, label in [(UTC, 'UTC'), (CENTRAL, 'America/Chicago')]:
        for candidate in utc_candidates(raw, zone):
            lag = (committed - candidate).total_seconds()
            if 0 <= lag <= maximum_lag_seconds:
                result.append({'zone': label, 'utc': candidate.isoformat().replace('+00:00', 'Z'), 'commitLagSeconds': lag})
    return result


def epoch_time(raw):
    return dt.datetime(1970, 1, 1, tzinfo=UTC) + dt.timedelta(microseconds=int(Decimal(raw) * 1000000))


def count(raw):
    return int(raw.rsplit(': ', 1)[-1].replace(',', ''))


def main():
    captures = json.loads((ROOT / 'captures.json').read_text())
    for f in captures:
        body = Path(f['local']).read_bytes()
        assert hashlib.sha256(body).hexdigest() == f['sha256']
        assert hashlib.sha1(f'blob {len(body)}\0'.encode() + body).hexdigest() == f['blob']
    with gzip.open('data/legacy/staged/totals.jsonl.gz', 'rt', encoding='utf-8') as stream:
        totals = [json.loads(line) for line in stream]
    total_index = {(r['sourceTime'], r['outages'], r['customers']): r for r in totals}
    inspected = list(csv.DictReader((ROOT / 'capture-time-inspection.csv').open(encoding='utf-8')))
    verified = []
    for row in inspected:
        original = next(f for f in captures if f['blob'] == row['blob'] and f['commit'] == row['commit'])
        commit_time = dt.datetime.fromisoformat(original['time'].replace('Z', '+00:00'))
        if row['stored_type'] == 'double' and row['stored_class'] == 'POSIXct/POSIXt':
            absolute = epoch_time(row['epoch_seconds'])
            stored = absolute.astimezone(CENTRAL).strftime('%Y-%m-%d %H:%M:%S')
            assert (stored, count(row['outages']), count(row['customers'])) in total_index
            lag = (commit_time - absolute).total_seconds()
            assert 0 <= lag <= 120
            finding = {'zone': 'absolute-epoch; consolidated string matches Central',
                       'utc': absolute.isoformat().replace('+00:00', 'Z'), 'commitLagSeconds': lag,
                       'consolidatedTime': stored, 'precisionNote': 'Original fractional seconds are absent from the consolidated string.'}
        else:
            assert row['stored_type'] == 'character'
            stored = row['source_time']
            assert (stored, count(row['outages']), count(row['customers'])) in total_index
            candidates = close_commit_candidates(stored, commit_time)
            assert len(candidates) == 1
            finding = dict(candidates[0], consolidatedTime=stored)
        verified.append({'repository': original['repo'], 'commit': original['commit'], 'path': original['path'],
                         'blob': original['blob'], 'committedAt': original['time'], **finding})
    eras = collections.Counter()
    for row in totals:
        raw = row['sourceTime']
        if raw.endswith('Z'):
            era = 'explicit-UTC'
        elif raw < '2022-12-24 07:10:24':
            era = 'early-RData-conversion-period'
        elif raw[:10] < '2024-04-26':
            era = 'UTC-character-period'
        elif raw[:10] <= '2024-04-28':
            era = '2024-transition-days-needing-record-level-check'
        else:
            era = 'explicit-Central-code-period'
        eras[era] += 1
    late = [r for r in totals if r['sourceTime'][:10] > '2024-04-28']
    dst = collections.Counter(len(utc_candidates(r['sourceTime'], CENTRAL)) for r in late)
    report = {'checkedAt': dt.datetime.now(UTC).isoformat(), 'purpose': 'Evidence audit, not bulk timestamp migration',
              'verifiedOriginalCaptureAnchors': len(verified), 'anchors': verified,
              'sourceEraCountsForPlanning': dict(eras),
              'laterCentralTimeCandidateCounts': {str(k): v for k, v in sorted(dst.items())},
              'stagedTimestampsChanged': False,
              'conclusions': [
                  'Historical R setup code explicitly exports TZ=UTC; runner location alone is not the evidence.',
                  'Scraper revision 15c24fa on 2024-04-28 explicitly changes timestamp creation to America/Chicago.',
                  'Earlier POSIXct originals contain absolute epochs; sampled consolidated strings have already been rendered in Central.',
                  'Use original epochs where available, source-version rules and commit checks, and America/Chicago DST conversion.',
                  'Do not infer every record from these anchors or apply a single fixed offset; validate transition/manual captures and geometry separately.'
              ]}
    Path('reports/legacy-timestamp-audit.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
