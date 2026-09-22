"""Independent audit against original PSV and SQLite, without JavaScript execution."""
import csv
import gzip
import hashlib
import io
import json
import math
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'data/weather/cache'
OUTPUT = ROOT / 'data/comparisons/conditions'
HOUR = 3600000
def digest(b): return hashlib.sha256(b).hexdigest()
def ms(s): return int(datetime.fromisoformat(s.replace('Z', '+00:00')).replace(tzinfo=timezone.utc).timestamp()*1000)
def near(a,b): assert a == b or (a is not None and b is not None and math.isclose(a,b,abs_tol=1e-7)), (a,b)
def verified(root,ref):
    b=(root/ref.get('path',ref.get('key'))).read_bytes()
    assert digest(b)==ref['sha256'] and len(b)==ref['bytes']
    return json.loads(b)
def original(ref):
    m=json.loads((CACHE/'manifests'/(ref['id']+'.json')).read_bytes())
    assert m['body']['sha256']==ref['sha256']
    path=CACHE/'objects'/(ref['sha256']+'.raw.gz')
    b=gzip.decompress(path.read_bytes()) if path.exists() else (CACHE/'objects'/(ref['sha256']+'.raw')).read_bytes()
    assert digest(b)==ref['sha256'] and len(b)==m['body']['bytes']
    return b
def value(r,field):
    source,q,measure=(r[field+s] for s in ['_Source_Code','_Quality_Code','_Measurement_Code'])
    if not ((source in {'313','314','315','322','335','343','344','346'} and q in {'1','5'}) or (source in {'220','221','222','223','347','348'} and q=='1')): return None
    try: v=float(r[field])
    except ValueError: return None
    if not math.isfinite(v) or v < (-273.15 if field=='temperature' else 0): return None
    if field=='wind_speed':
        if measure not in {'','N','C','V'} or (measure=='C' and v!=0): return None
    elif measure: return None
    return v
def anchors(rows,start):
    return [min((r for r in rows if abs(r['at']-(start+(h+.5)*HOUR))<=900000),key=lambda r:(abs(r['at']-(start+(h+.5)*HOUR)),r['at']),default=None) for h in range(72)]
def temperature(records,start):
    out=[]
    for h in range(72):
        group=[r for r in records if start+h*HOUR<=ms(r['DATE'])<start+(h+1)*HOUR]
        good=[(r,value(r,'temperature')) for r in group if value(r,'temperature') is not None]
        wind=[value(r,'wind_speed') for r in group if value(r,'wind_speed') is not None]
        rain=[r for r in group if (r['precipitation_Report_Type'] or r['REM_Report_Type']) in ['FM15','FM16'] or r['precipitation'].strip() not in ['', '-9999']]
        last=max(rain,key=lambda r:ms(r['DATE']),default=None)
        precip=value(last,'precipitation') if last and (last['precipitation_Report_Type'] or last['REM_Report_Type'])=='FM15' and ms(last['DATE'])//60000%60>=45 else None
        low=min(good,key=lambda p:p[1],default=None);high=max(good,key=lambda p:p[1],default=None)
        out.append({'minC':low[1] if low else None,'maxC':high[1] if high else None,'acceptedReports':len(good),'minimumAt':ms(low[0]['DATE']) if low else None,'maximumAt':ms(high[0]['DATE']) if high else None,'windMs':max(wind,default=None),'precipitationMm':precip})
    return out
def calendar(a,b):
    key=lambda n:datetime.fromtimestamp(n/1000,timezone.utc).astimezone(ZoneInfo('America/Chicago')).strftime('%a %H %z')
    return all(key(a+i*HOUR)==key(b+i*HOUR) for i in range(72))
cases=[]
for entry in json.loads((OUTPUT/'catalog.json').read_bytes())['entries']:
    d=verified(OUTPUT,entry);p=d['provenance'];bundle=verified(OUTPUT,p['inputBundle'])
    assert digest((ROOT/'config/weather-candidates.json').read_bytes())==p['configSha256']
    assert digest((ROOT/'config/weather-reference-policy.json').read_bytes())==p['policySha256']
    assert digest((ROOT/'reports/weather-candidate-screen.json').read_bytes())==p['screenSha256']
    index=ROOT/'data/legacy/dashboard'/p['legacyIndex']['path'];assert digest(index.read_bytes())==p['legacyIndex']['sha256']
    db=sqlite3.connect(index.as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
    query='SELECT o.id,o.at,o.observed_at AS capturedAt,o.customers,o.outages,g.capture_key AS gridCaptureKey FROM observations o LEFT JOIN grids g ON g.total_id=o.id WHERE o.at>=? AND o.at<? ORDER BY o.at,o.observed_at'
    read_rows=lambda start:[dict(r) for r in db.execute(query,(start,start+72*HOUR))]
    start=ms(d['from']);ref=d['matchedReference'];rstart=ms(ref['from']);rows=read_rows(start);rr=read_rows(rstart)
    assert rows==bundle['observations'] and rr==bundle['referenceObservations']
    records=list(csv.DictReader(io.StringIO(original(p['station']).decode()),delimiter='|'))
    for side,obs,at in [(d,rows,start),(ref,rr,rstart)]:
        peak=max(obs,key=lambda r:r['customers']);assert side['outage']['peakCustomers']==peak['customers']
        coverage=0;burden=0
        for a,b in zip(obs,obs[1:]):
            gap=b['at']-a['at']
            if gap<=450000: coverage+=gap/60000;burden+=a['customers']*gap/HOUR
        near(side['outage']['coveredMinutes'],coverage);near(side['outage']['observedCustomerHours'],burden if coverage else None)
        near(side['outage']['customerHours'],burden if coverage/4320>=.9 else None)
        for expected,actual in zip(temperature(records,at),side['temperature']['hours'],strict=True):
            for k in ['minC','maxC','acceptedReports','windMs','precipitationMm']: near(actual[k],expected[k])
            for k in ['minimumAt','maximumAt']: assert (ms(actual[k]) if actual[k] else None)==expected[k]
    ca=anchors(rows,start);ra=anchors(rr,rstart);eligible=[]
    for c in ref['selection']['candidates']:
        a=ms(c['from']);cr=read_rows(a);an=anchors(cr,a);pairs=sum(x is not None and y is not None and abs(x['at']-y['at']-(start-a))<=600000 for x,y in zip(ca,an))
        assert pairs==c['pairedAnchorHours']
        wind=[];known=wet=trace=0
        for h in range(72):
            group=[r for r in records if a+h*HOUR<=ms(r['DATE'])<a+(h+1)*HOUR]
            w=[value(r,'wind_speed') for r in group if value(r,'wind_speed') is not None]
            if w:wind.append(max(w))
            rain=[r for r in group if (r['precipitation_Report_Type'] or r['REM_Report_Type']) in ['FM15','FM16'] or r['precipitation'].strip() not in ['', '-9999']]
            last=max(rain,key=lambda r:ms(r['DATE']),default=None)
            if last and (last['precipitation_Report_Type'] or last['REM_Report_Type'])=='FM15' and ms(last['DATE'])//60000%60>=45:
                v=value(last,'precipitation')
                if v is not None: known+=1;wet+=int(v>=.1)
                if last['precipitation_Measurement_Code'] in ['T','2']:
                    cp=dict(last);cp['precipitation_Measurement_Code']='';trace+=int(value(cp,'precipitation')==0)
        temp=sum(h['minC'] is not None for h in temperature(records,a))
        ok=calendar(start,a) and pairs>=48 and len(wind)/72>=.9 and known/72>=.9 and not wet and not trace and max(wind,default=math.inf)<10 and temp/72>=.9
        assert c['eligible']==ok
        if ok:eligible.append(c['from'])
    assert eligible[0]==ref['from']
    for matched,case_lag in zip(ref['byLag'],d['byLag'],strict=True):
        lag=matched['lagHours'];assert lag==case_lag['lagHours'];included=[]
        for i,pair in enumerate(matched['pairs']):
            a,b=ca[i],ra[i];k=i-lag-1;field='minC' if d['family']=='winter' else 'maxC'
            v=d['temperature']['hours'][k][field] if k>=0 else None;rv=ref['temperature']['hours'][k][field] if k>=0 else None
            condition=None if v is None else (v<0 if d['family']=='winter' else v>=32)
            refcondition=None if rv is None else (rv<0 if d['family']=='winter' else rv>=32)
            reasons=[]
            if not a:reasons.append('case-capture-missing')
            if not b:reasons.append('reference-capture-missing')
            if a and b and abs(a['at']-b['at']-(start-rstart))>600000:reasons.append('capture-times-differ-over-10-minutes')
            if condition is None or refcondition is None:reasons.append('temperature-missing')
            if refcondition:reasons.append('reference-temperature-reaches-threshold')
            rh=ref['temperature']['hours'][k] if k>=0 else {}
            if rh.get('windMs') is None or rh.get('precipitationStatus')!='accepted' or rh.get('precipitationMm') is None:reasons.append('reference-station-weather-missing')
            if (rh.get('windMs') or 0)>=10 or (rh.get('precipitationMm') or 0)>=.1:reasons.append('reference-station-weather-reaches-threshold')
            near(pair['referenceWindMs'],rh.get('windMs'));near(pair['referencePrecipitationMm'],rh.get('precipitationMm'))
            assert pair['included']==(not reasons) and pair['reasons']==reasons and pair['condition']==condition
            near(pair['caseTemperatureC'],v);near(pair['referenceTemperatureC'],rv)
            for obs,key in [(a,'caseCapture'),(b,'referenceCapture')]: assert pair[key]==({k:obs[k] for k in ['id','at','capturedAt','customers','outages']} if obs else None)
            if not reasons:included.append(pair)
        assert matched['includedHours']==len(included)
        for group,predicate in zip(matched['groups'],[lambda p:True,lambda p:p['condition'],lambda p:not p['condition']]):
            ps=[p for p in included if predicate(p)];assert group['pairs']==len(ps)
            for field,key in [('caseMedianCustomers','caseCapture'),('referenceMedianCustomers','referenceCapture')]:near(group[field],median(p[key]['customers'] for p in ps) if len(ps)>=6 else None)
            near(group['medianPairedDifference'],median(p['caseCapture']['customers']-p['referenceCapture']['customers'] for p in ps) if len(ps)>=6 else None)
        expected={};grid_hours=0
        for pair in [p for p in included if p['condition']]:
            grid=db.execute('SELECT capture_key FROM grids WHERE total_id=?',(pair['caseCapture']['id'],)).fetchone()
            if grid:
                grid_hours+=1
                for c in db.execute('SELECT cell_id,customers,geometry FROM cells WHERE capture_key=?',(grid['capture_key'],)):
                    expected.setdefault(c['cell_id'],[]).append((c['customers'],json.loads(c['geometry']),pair['caseCapture']['id']))
        g=case_lag['geography'];assert g['gridHours']==grid_hours and len(g['geojson']['features'])==len(expected)
        for f in g['geojson']['features']:
            values=expected[f['properties']['gridCellId']];pr=f['properties'];assert pr['reports']==len(values) and pr['peakCustomers']==max(v[0] for v in values)
            near(pr['medianCustomers'],median(v[0] for v in values) if len(values)>=6 else None)
            assert [v['captureId'] for v in pr['observations']]==[v[2] for v in values]
            assert f['geometry']==(values[0][1] if all(v[1]==values[0][1] for v in values) else None)
    # Verify finalized event identities/types directly against the compressed NOAA CSV.
    event_rows={int(r['EVENT_ID']):r for r in csv.DictReader(io.StringIO(gzip.decompress(original(p['events'])).decode('utf-8-sig')))}
    for e in d['context']['records']:assert event_rows[e['eventId']]['EVENT_TYPE']==e['eventType']
    db.close();cases.append({'id':d['id'],'observations':len(rows),'references':len(rr),'pairs':[m['includedHours'] for m in ref['byLag']],'gridCells':len(d['byLag'][0]['geography']['geojson']['features']),'passed':True})
report={'method':'Independent Python: original station PSV, NOAA event CSV, legacy SQLite, all candidate references, all lag pairs and every published grid polygon','cases':cases,'passed':True}
(ROOT/'reports/temperature-comparison-verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report))
