"""Independent reference selection, weather, capture matching and summary audit.

Reuses the existing Python source/hash helpers, never the JavaScript algorithms.
Original reference GRIB unpacking is also checked by verify-rainfall-window.py.
"""
import csv
import io
import json
import math
import runpy
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]
base=runpy.run_path(str(ROOT/'scripts/verify-weather-comparisons.py'))
verified,original,near,ms,accepted,audit_outages,digest=(base[k] for k in ['verified','original','near','ms','accepted','audit_outages','digest'])
CACHE=ROOT/'data/weather/cache';OUTPUT=ROOT/'data/comparisons';HOUR=3600000
policy_bytes=(ROOT/'config/weather-reference-policy.json').read_bytes();policy=json.loads(policy_bytes)
selection_bytes=(ROOT/'reports/weather-reference-selection.json').read_bytes();selection=json.loads(selection_bytes)
assert selection['policySha256']==digest(policy_bytes)
assert policy['candidateDaysBefore']==[7,14,21,28] and policy['minimumAnchorPairs']==48 and policy['minimumGroupPairs']==6
zone=ZoneInfo('America/Chicago')

def at(row):
    return ms(row['DATE'] if row['DATE'].endswith('Z') else row['DATE']+'Z')

def anchors(rows,start):
    result=[]
    for h in range(72):
        target=start+(h+.5)*HOUR
        eligible=[r for r in rows if abs(r['at']-target)<=900000]
        result.append(min(eligible,key=lambda r:(abs(r['at']-target),r['at'])) if eligible else None)
    return result

def calendar(start,reference):
    if (start-reference)/(24*HOUR) not in [7,14,21,28]:
        return False
    key=lambda t:datetime.fromtimestamp(t/1000,timezone.utc).astimezone(zone).strftime('%a %H %z')
    return all(key(start+h*HOUR)==key(reference+h*HOUR) for h in range(72))

def station_hours(records,start):
    output=[]
    for h in range(72):
        rows=sorted((r for r in records if start+h*HOUR<=at(r)<start+(h+1)*HOUR),key=at)
        item={'reports':len(rows)}
        for field,key in [('wind_speed','sustained'),('wind_gust','gust')]:
            passing=[(r,v) for r in rows if (v:=accepted(r,field)) is not None]
            best=max(passing,key=lambda pair:pair[1]) if passing else None
            item[key]={'value':best[1] if best else None,'at':at(best[0]) if best else None,'count':len(passing)}
        precip=[r for r in rows if (r['precipitation_Report_Type'] or r['REM_Report_Type']) in ['FM15','FM16'] or r['precipitation'].strip() not in ['', '-9999']]
        last=precip[-1] if precip else None
        item['precip']=None;item['trace']=False
        if last and (last['precipitation_Report_Type'] or last['REM_Report_Type'])=='FM15' and (at(last)//60000)%60>=45:
            item['precip']=accepted(last,'precipitation')
            if last['precipitation_Measurement_Code'] in ['T','2']:
                copy=dict(last);copy['precipitation_Measurement_Code']=''
                item['trace']=accepted(copy,'precipitation')==0
        output.append(item)
    return output

cases=[]
for entry in json.loads((OUTPUT/'catalog.json').read_bytes())['entries']:
    d=verified(OUTPUT/entry['path'],entry);ref=d['matchedReference'];provenance=ref['provenance']
    assert provenance['selectionSha256']==digest(selection_bytes) and provenance['policySha256']==digest(policy_bytes)
    index=ROOT/'data/legacy/dashboard'/d['provenance']['legacyIndex']['path']
    connection=sqlite3.connect(index.as_uri()+'?mode=ro',uri=True);connection.row_factory=sqlite3.Row
    query='SELECT o.id,o.at,o.observed_at AS capturedAt,o.customers,o.outages,g.capture_key AS gridCaptureKey FROM observations o LEFT JOIN grids g ON g.total_id=o.id WHERE o.at>=? AND o.at<? ORDER BY o.at,o.observed_at'
    read_rows=lambda start:[dict(r) for r in connection.execute(query,(start,start+72*HOUR))]
    start=ms(d['from']);reference_start=ms(ref['from']);case_rows=read_rows(start);ref_rows=read_rows(reference_start)
    case_anchors=anchors(case_rows,start);ref_anchors=anchors(ref_rows,reference_start)
    bundle=verified(OUTPUT/d['provenance']['inputBundle']['path'],d['provenance']['inputBundle'])
    assert bundle['matchedReference']['observations']==ref_rows
    audit_outages(ref_rows,ref['outage'],reference_start)
    source=provenance['station'];raw=original(source['id'],source['sha256']);records=list(csv.DictReader(io.StringIO(raw.decode()),delimiter='|'))
    screen=next(c for c in selection['cases'] if c['id']==d['id']);assert screen==ref['selection']
    eligible_dates=[]
    for candidate in screen['candidates']:
        cstart=ms(candidate['from']);rows=read_rows(cstart);ca=anchors(rows,cstart)
        paired=sum(a is not None and b is not None and abs(a['at']-b['at']-(start-cstart))<=600000 for a,b in zip(case_anchors,ca))
        wh=station_hours(records,cstart);winds=[h['sustained']['value'] for h in wh if h['sustained']['value'] is not None]
        known=sum(h['precip'] is not None for h in wh);wet=sum(h['precip'] is not None and h['precip']>=.1 for h in wh);trace=sum(h['trace'] for h in wh)
        assert candidate['pairedAnchorHours']==paired and candidate['anchorHours']==sum(a is not None for a in ca)
        assert candidate['stationWindHours']==len(winds) and candidate['stationPrecipitationKnownHours']==known
        near(candidate['stationWindPeakMs'],max(winds,default=None));assert candidate['stationWetHours']==wet and candidate['stationTraceHours']==trace
        same_calendar=calendar(start,cstart);assert candidate['calendarMatched']==same_calendar
        eligible=same_calendar and paired>=48 and len(winds)/72>=.9 and known/72>=.9 and wet==0 and trace==0 and bool(winds) and max(winds)<10
        assert candidate['eligible']==eligible
        if eligible:eligible_dates.append(candidate['from'])
        derivative=verified(CACHE/candidate['stationDerived']['key'],candidate['stationDerived'])
        assert derivative['sourceSha256']==source['sha256']
    assert ref['from']==eligible_dates[0] and ref['from']==screen['selected']['from']
    connection.close()
    rain=[]
    for source_ref,hour in zip(provenance['rainfall'],ref['rainfall']['hours'],strict=True):
        grid=verified(CACHE/source_ref['derived']['key'],source_ref['derived']);original(source_ref['sourceId'],source_ref['sourceSha256'])
        g=grid['grid'];values=grid['values'];assert len(values)==g['width']*g['height'] and all(v is not None for v in values)
        weights=[math.sin(math.radians(g['y0']+(y-.5)*g['dy']))-math.sin(math.radians(g['y0']+(y+.5)*g['dy'])) for y in range(g['height']) for x in range(g['width'])]
        mean=sum(v*w for v,w in zip(values,weights))/sum(weights);near(hour['meanMm'],mean);rain.append(mean)
        assert ms(grid['intervalStart'])==ms(hour['from']) and ms(grid['intervalEnd'])==ms(hour['to'])
    near(ref['rainfall']['meanMm'],sum(rain))
    ref_wind=station_hours(records,reference_start)
    for calculated,published in zip(ref_wind,ref['wind']['hours'],strict=True):
        assert calculated['reports']==published['reports']
        for field in ['sustained','gust']:
            near(calculated[field]['value'],published[field]['value']);assert calculated[field]['count']==published[field]['acceptedReports']
            assert calculated[field]['at']==(ms(published[field]['at']) if published[field]['at'] else None)
    for match in ref['byLag']:
        lag=match['lagHours'];expected=[]
        for i,p in enumerate(match['pairs']):
            a,b=case_anchors[i],ref_anchors[i];k=i-lag-1;reasons=[]
            for selected,record in [(a,p['caseCapture']),(b,p['referenceCapture'])]:
                assert record==({key:selected[key] for key in ['id','capturedAt','at','customers','outages']} if selected else None)
            if a is None:reasons.append('case-capture-missing')
            if b is None:reasons.append('reference-capture-missing')
            difference=abs(a['at']-b['at']-(start-reference_start))/60000 if a and b else None;near(p['captureOffsetMinutes'],difference)
            if difference is not None and difference>10:reasons.append('capture-times-differ-over-10-minutes')
            cr=d['rainfall']['hours'][k]['meanMm'] if k>=0 else None;cw=d['wind']['hours'][k]['sustained']['value'] if k>=0 else None
            rr=rain[k] if k>=0 else None;rw=ref_wind[k]['sustained']['value'] if k>=0 else None
            for key,v in [('caseRainMm',cr),('caseWindMs',cw),('referenceRainMm',rr),('referenceWindMs',rw)]:near(p[key],v)
            if any(v is None for v in [cr,cw,rr,rw]):reasons.append('weather-missing')
            if rr is not None and rr>=.1:reasons.append('reference-rain-at-or-above-threshold')
            if rw is not None and rw>=10:reasons.append('reference-wind-at-or-above-threshold')
            assert p['included']==(not reasons) and p['reasons']==reasons
            if k>=0:
                assert ms(p['caseExposureTo'])<=ms(p['caseFrom']) and ms(p['referenceExposureTo'])<=ms(p['referenceFrom'])
                assert ms(p['caseWindReportAt'])<ms(p['caseFrom']) and ms(p['referenceWindReportAt'])<ms(p['referenceFrom'])
            expected.append(p)
        included=[p for p in expected if p['included']];assert match['includedHours']==len(included) and match['excludedHours']==72-len(included)
        assert match['exclusions']==dict(Counter(reason for p in expected for reason in p['reasons']))
        tests=[lambda p:True,lambda p:p['caseRainMm']>=.1,lambda p:p['caseRainMm']<.1,lambda p:p['caseWindMs']>=10,lambda p:p['caseWindMs']<10,lambda p:p['caseRainMm']>=.1 and p['caseWindMs']>=10]
        for group,predicate in zip(match['groups'],tests,strict=True):
            selected=[p for p in included if predicate(p)];assert group['pairs']==len(selected)
            enough=len(selected)>=6
            near(group['caseMedianCustomers'],median(p['caseCapture']['customers'] for p in selected) if enough else None)
            near(group['referenceMedianCustomers'],median(p['referenceCapture']['customers'] for p in selected) if enough else None)
            near(group['medianPairedDifference'],median(p['caseCapture']['customers']-p['referenceCapture']['customers'] for p in selected) if enough else None)
    cases.append({'id':d['id'],'referenceFrom':ref['from'],'referenceObservations':len(ref_rows),'candidateWindowsChecked':len(screen['candidates']),'rainfallHoursVerified':len(rain),'pairedHours':[{'lag':m['lagHours'],'included':m['includedHours']} for m in ref['byLag']],'passed':True})
report={'checkedAt':datetime.now(timezone.utc).isoformat(),'method':'Independent Python: original station weather, all eight candidate windows, calendar/DST, SQLite timestamps/counts, verified native rainfall cells, all 432 pair rows and all group medians','cases':cases,'passed':True}
(ROOT/'reports/weather-reference-verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8');print(json.dumps(report))
