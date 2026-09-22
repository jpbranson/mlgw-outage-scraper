import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sha256 } from '../weather/objects.mjs';
import { COMPARISON_VERSION } from '../weather/comparisons.mjs';
import { RequestError } from './service.mjs';

export class ComparisonService {
  constructor(root){this.root=resolve(root);}
  catalog() {
    try {
      const path=join(this.root,'catalog.json');if(statSync(path).size>65536)throw Error('Catalog size');
      const c=JSON.parse(readFileSync(path));
      const extra=join(this.root,'conditions','catalog.json');
      if(existsSync(extra)) {
        if(statSync(extra).size>65536)throw Error('Temperature catalog size');
        const t=JSON.parse(readFileSync(extra));
        if(t.version!==COMPARISON_VERSION||t.analysisVersion!=='temperature-comparison-v1'||!Array.isArray(t.entries)||t.entries.some(e=>e.kind!=='temperature'))throw Error('Temperature catalog version');
        c.entries=[...c.entries,...t.entries];
      }
      if(c.version!==COMPARISON_VERSION||!Array.isArray(c.entries)||c.entries.length>10||new Set(c.entries.map(e=>e.id)).size!==c.entries.length)throw Error('Catalog version');
      for(const e of c.entries)if(!/^[a-z0-9-]{1,40}$/.test(e.id)||!/^[a-f0-9]{64}$/.test(e.sha256)||e.path!==e.sha256+'.json'||e.bytes>12*1024*1024)throw Error('Catalog entry');
      return c;
    }catch{throw new RequestError('Prepared weather comparisons unavailable. Run npm run weather:comparisons.',503);}
  }
  series(params) {
    if([...params.keys()].some(k=>!['view','id','lag','table'].includes(k))||params.getAll('id').length!==1||params.getAll('lag').length>1||params.getAll('view').length>1||params.getAll('table').length>1||!['case','reference'].includes(params.get('table')??'case')||!['0','1','3'].includes(params.get('lag')??'0'))throw new RequestError('Choose one prepared comparison, a case/reference table and a lag of 0, 1 or 3 hours.');
    const e=this.catalog().entries.find(e=>e.id===params.get('id'));
    if(!e)throw new RequestError('Prepared comparison not found.',404);
    let d;try {
      const path=join(this.root,...(e.kind==='temperature'?['conditions']:[]),e.path);if(statSync(path).size!==e.bytes)throw Error('Size');
      const bytes=readFileSync(path);if(sha256(bytes)!==e.sha256)throw Error('Checksum');
      d=JSON.parse(bytes);if(d.version!==COMPARISON_VERSION||d.id!==e.id||d.from!==e.from||d.to!==e.to||(e.kind==='temperature'&&(d.kind!=='temperature'||d.analysisVersion!=='temperature-comparison-v1')))throw Error('Identity');
    }catch{throw new RequestError('Prepared comparison could not be verified.',503);}
    const lag=Number(params.get('lag')??0);
    return {...d,byLag:undefined,comparison:d.byLag.find(l=>l.lagHours===lag),
      matchedReference:d.matchedReference?{...d.matchedReference,byLag:undefined,comparison:d.matchedReference.byLag.find(l=>l.lagHours===lag)}:undefined,publicationSha256:e.sha256};
  }
  csv(params) {
    const d=this.series(params), fields=['from','to','observations','peakCustomers','peakOutages','customerPeakAt','outagePeakAt','coveredMinutes','observedCustomerHours','exposureFrom','exposureTo',...(d.kind==='temperature'?['temperatureC']:['rainMm','windMs','gustMs','windReportAt','windAcceptedReports'])];
    if(params.get('table')==='reference') {
      if(!d.matchedReference?.comparison)throw new RequestError('Matched reference unavailable.',409);
      const cols=['hour','caseFrom','referenceFrom','included','captureOffsetMinutes','caseExposureFrom','caseExposureTo','referenceExposureFrom','referenceExposureTo',...(d.kind==='temperature'?['caseTemperatureC','caseTemperatureAt','referenceTemperatureC','referenceTemperatureAt','referenceWindMs','referencePrecipitationMm','condition']:['caseRainMm','caseWindMs','caseWindReportAt','referenceRainMm','referenceWindMs','referenceWindReportAt'])];
      const lines=[['source_format','episode_id','additional_lag_hours',...cols,'case_capture_id','case_capture_utc','case_customers','case_outages','reference_capture_id','reference_capture_utc','reference_customers','reference_outages','exclusion_reasons'].join(',')];
      for(const p of d.matchedReference.comparison.pairs)lines.push(['legacy_html',d.id,d.comparison.lagHours,...cols.map(k=>p[k]??''),
        ...['caseCapture','referenceCapture'].flatMap(k=>[p[k]?.id??'',p[k]?.capturedAt??'',p[k]?.customers??'',p[k]?.outages??'']),p.reasons.join('|')].join(','));
      return lines.join('\r\n')+'\r\n';
    }
    const lines=[['source_format','episode_id','additional_lag_hours',...fields].join(',')];
    for(const h of d.comparison.matches)lines.push(['legacy_html',d.id,d.comparison.lagHours,...fields.map(f=>h[f]??'')].join(','));
    return lines.join('\r\n')+'\r\n';
  }
}
