"""Independent audit: SQLite observations, original station PSV, verified native rainfall cells.

Does not import or execute the JavaScript comparison implementation. Rainfall GRIB
decoding was independently checked at the earlier rainfall checkpoint; this audit
rechecks its immutable source hashes and independently weights the derived cells.
"""
import csv
import gzip
import hashlib
import io
import json
import math
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'data/weather/cache'
OUTPUT = ROOT / 'data/comparisons'
HOUR = 3600000

def digest(data):
    return hashlib.sha256(data).hexdigest()

def verified(path, ref):
    data = path.read_bytes()
    assert digest(data) == ref['sha256'], path
    if 'bytes' in ref:
        assert len(data) == ref['bytes'], path
    return json.loads(data)

def ms(value):
    return int(datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000)

def near(a, b):
    assert (a is None and b is None) or (a is not None and b is not None and math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-7)), (a, b)

def original(source_id, expected):
    manifest = json.loads((CACHE / 'manifests' / (source_id + '.json')).read_bytes())
    assert manifest['body']['sha256'] == expected
    path = CACHE / 'objects' / (expected + '.raw.gz')
    raw = gzip.decompress(path.read_bytes()) if path.exists() else (CACHE / 'objects' / (expected + '.raw')).read_bytes()
    assert digest(raw) == expected and len(raw) == manifest['body']['bytes']
    return raw

def audit_outages(rows, summary, start, hours=None):
    assert len(rows) == summary['observations']
    expected_peak = max((r['customers'] for r in rows), default=None)
    assert summary['peakCustomers'] == expected_peak
    assert summary['gridSnapshots'] == sum(bool(r['gridCaptureKey']) for r in rows)
    assert summary['peakOutages'] == max((r['outages'] for r in rows), default=None)
    if rows:
        peak = max(rows, key=lambda r: r['customers'])
        assert summary['customerPeakAt'] == peak['capturedAt']
        assert summary['customerCaptureId'] == peak['id']
        assert summary['firstObservedCustomers'] == rows[0]['customers']
    coverage = [0.0] * 72
    burden = [0.0] * 72
    for a, b in zip(rows, rows[1:]):
        duration = b['at'] - a['at']
        assert duration > 0
        if duration > 450000:
            continue
        for h in range(72):
            overlap = max(0, min(b['at'], start+(h+1)*HOUR) - max(a['at'], start+h*HOUR))
            coverage[h] += overlap/60000
            burden[h] += overlap/HOUR*a['customers']
    near(summary['coveredMinutes'], sum(coverage))
    near(summary['coverage'], sum(coverage)/4320)
    near(summary['observedCustomerHours'], sum(burden) if sum(coverage) else None)
    near(summary['customerHours'], sum(burden) if sum(coverage)/4320 >= .9 else None)
    assert summary['uniqueEvents'] is None and summary['newlyReportedEvents'] is None
    if hours is not None:
        for h, output in enumerate(hours):
            group = [r for r in rows if start+h*HOUR <= r['at'] < start+(h+1)*HOUR]
            assert output['observations'] == len(group)
            for column, prefix in [('customers','customer'), ('outages','outage')]:
                peak = max(group, key=lambda r:r[column]) if group else None
                assert output['peakCustomers' if column == 'customers' else 'peakOutages'] == (peak[column] if peak else None)
                assert output[prefix+'PeakAt'] == (peak['capturedAt'] if peak else None)
                assert output[prefix+'CaptureId'] == (peak['id'] if peak else None)
            near(output['coveredMinutes'],coverage[h]);near(output['observedCustomerHours'],burden[h] if coverage[h] else None)

def accepted(row, field):
    source, qc, measurement = (row[field+s] for s in ['_Source_Code','_Quality_Code','_Measurement_Code'])
    passing = (source in {'313','314','315','322','335','343','344','346'} and qc in {'1','5'}) or (source in {'220','221','222','223','347','348'} and qc == '1')
    try:
        value=float(row[field])
    except ValueError:
        return None
    if not passing or not math.isfinite(value) or value < 0:
        return None
    if field == 'wind_speed':
        if measurement not in {'','N','C','V'} or (measurement == 'C' and value != 0):
            return None
    elif measurement:
        return None
    return value

catalog=json.loads((OUTPUT/'catalog.json').read_bytes())
cases=[]
for entry in catalog['entries']:
    d=verified(OUTPUT/entry['path'],entry)
    provenance=d['provenance']; start=ms(d['from']); end=ms(d['to'])
    assert end-start == 72*HOUR
    index=ROOT/'data/legacy/dashboard'/provenance['legacyIndex']['path']
    assert digest(index.read_bytes()) == provenance['legacyIndex']['sha256']
    connection=sqlite3.connect(index.as_uri()+'?mode=ro',uri=True);connection.row_factory=sqlite3.Row
    query='SELECT o.id,o.at,o.observed_at AS capturedAt,o.customers,o.outages,g.capture_key AS gridCaptureKey FROM observations o LEFT JOIN grids g ON g.total_id=o.id WHERE o.at>=? AND o.at<? ORDER BY o.at,o.observed_at'
    observations=[dict(r) for r in connection.execute(query,(start,end))]
    reference=[dict(r) for r in connection.execute(query,(start-72*HOUR,start))];connection.close()
    bundle=verified(OUTPUT/provenance['inputBundle']['path'],provenance['inputBundle'])
    assert bundle['observations'] == observations and bundle['referenceObservations'] == reference
    audit_outages(observations,d['outage'],start,d['outageHours']);audit_outages(reference,d['reference'],start-72*HOUR)
    rain=[]
    cell_sums=None
    for ref, hour in zip(provenance['rainfall'],d['rainfall']['hours'],strict=True):
        grid=verified(CACHE/ref['derived']['key'],ref['derived'])
        original(ref['sourceId'],ref['sourceSha256'])
        assert grid['sourceSha256']==ref['sourceSha256'] and grid['sourceId']==ref['sourceId']
        g=grid['grid'];west,south,east,north=d['rainfall']['bbox']
        assert math.isclose(g['x0']-g['dx']/2,west,abs_tol=1e-7) and math.isclose(g['x0']+(g['width']-.5)*g['dx'],east,abs_tol=1e-7)
        assert math.isclose(g['y0']-g['dy']/2,north,abs_tol=1e-7) and math.isclose(g['y0']+(g['height']-.5)*g['dy'],south,abs_tol=1e-7)
        weights=[math.sin(math.radians(g['y0']+(y-.5)*g['dy']))-math.sin(math.radians(g['y0']+(y+.5)*g['dy'])) for y in range(g['height']) for x in range(g['width'])]
        values=grid['values'];assert all(v is not None for v in values)
        mean=sum(v*w for v,w in zip(values,weights))/sum(weights)
        near(hour['meanMm'],mean);rain.append(mean)
        assert ms(grid['intervalStart']) == ms(hour['from']) and ms(grid['intervalEnd'])==ms(hour['to'])
        cell_sums=values if cell_sums is None else [a+b for a,b in zip(cell_sums,values)]
    near(d['rainfall']['meanMm'],sum(v*w for v,w in zip(cell_sums,weights))/sum(weights))
    station=provenance['station'];source=original(station['id'],station['sha256'])
    records=[r for r in csv.DictReader(io.StringIO(source.decode()),delimiter='|') if start<=ms(r['DATE'] if r['DATE'].endswith('Z') else r['DATE']+'Z')<end]
    wind=[]
    for i,h in enumerate(d['wind']['hours']):
        group=[r for r in records if start+i*HOUR<=ms(r['DATE'] if r['DATE'].endswith('Z') else r['DATE']+'Z')<start+(i+1)*HOUR]
        assert len(group)==h['reports']
        for field,key in [('wind_speed','sustained'),('wind_gust','gust')]:
            values=[v for r in group if (v:=accepted(r,field)) is not None]
            near(h[key]['value'],max(values,default=None));assert h[key]['acceptedReports']==len(values)
        wind.append(h['sustained']['value'])
    for comparison in d['byLag']:
        lag=comparison['lagHours']
        for i,h in enumerate(comparison['matches']):
            k=i-lag-1
            near(h['rainMm'],rain[k] if k>=0 else None);near(h['windMs'],wind[k] if k>=0 else None)
            if k>=0:
                assert ms(h['exposureTo'])<=ms(h['from']) and ms(h['windReportAt'])<ms(h['from'])
        predicates=[lambda h:h['rainMm'] is not None and h['rainMm']>=.1,lambda h:h['rainMm'] is not None and h['rainMm']<.1,lambda h:h['windMs'] is not None and h['windMs']>=10,lambda h:h['windMs'] is not None and h['windMs']<10,lambda h:h['rainMm'] is not None and h['windMs'] is not None and h['rainMm']>=.1 and h['windMs']>=10]
        for group,predicate in zip(comparison['groups'],predicates):
            weather=[h for h in comparison['matches'] if predicate(h)];joint=[h for h in weather if h['observations']]
            assert group['weatherHours']==len(weather) and group['jointHours']==len(joint)
            near(group['medianHourlyPeakCustomers'],median(h['peakCustomers'] for h in joint) if len(joint)>=6 else None)
    assert d['spatial']['available'] is False and d['outage']['gridSnapshots']==0
    cases.append({'id':d['id'],'observations':len(observations),'referenceObservations':len(reference),'verifiedHourlyRainfall':len(rain),'verifiedWindHours':len(wind),'lags':[l['lagHours'] for l in d['byLag']],'peakCustomers':d['outage']['peakCustomers'],'rainMeanMm':d['rainfall']['meanMm'],'passed':True})
report={'checkedAt':datetime.now(timezone.utc).isoformat(),'implementation':'Independent Python; SQLite rows, original station PSV, source hashes, native-cell spherical weights, all hourly outcomes and lag groups','cases':cases,'passed':True}
(ROOT/'reports/weather-comparison-verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report))
