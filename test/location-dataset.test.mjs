import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLocationDataset,summarizeLocationDataset,exportLocationGeoJSON,siteId} from '../src/analysis/location-dataset.mjs';

const base=Date.parse('2026-09-16T12:00:00Z'),minute=60000,here=[-90,35.15],near=[-89.9999,35.15],far=[-89.99,35.15];
const feature=(id,customers=1,coordinates=here,start='09/16/2026 06:30:00 AM')=>({id,geometry:coordinates?{type:'Point',coordinates}:null,
  properties:{customers,started:{raw:start,utc:null,status:'unverified'},impact:'Example',status:'Reported'}});
const capture=(index,features,extra={})=>({id:`capture-${index}`,at:base+index*5*minute,
  customers:features.reduce((n,f)=>n+f.properties.customers,0),outages:features.length,features,...extra});
function build(t,captures){const db=buildLocationDataset(captures);t.after(()=>db.close());return db;}

test('repeat polls and corrected start times preserve one source record; peaks are simultaneous',t=>{
  const db=build(t,[capture(0,[feature('a',10),feature('b',20)]),capture(1,[feature('a',7,here,'corrected')]),capture(2,[feature('a',7,here,'corrected')])]);
  const summary=summarizeLocationDataset(db),site=db.prepare('SELECT * FROM site_summary').get();
  assert.equal(summary.sourceRecords,2);assert.equal(summary.episodes,2);assert.equal(summary.revisedStartRecords,1);
  assert.equal(site.source_record_count,2);assert.equal(site.peak_simultaneous_customers,30);assert.equal(site.observation_count,4);
  assert.equal(db.prepare('SELECT observation_count FROM site_customer_distribution WHERE customers=7').get().observation_count,2);
  const relation=db.prepare('SELECT * FROM exact_recurrences').get();
  assert.equal(relation.observed_together,1);assert.equal(relation.disjoint_observed_spans,0);
  assert.equal(summary.customerTotalsMismatch,0);assert.equal(summary.histogramObservationMismatch,0);
});

test('a moving record stays one source record while both exact locations and the count change survive',t=>{
  const db=build(t,[capture(0,[feature('a',20)]),capture(1,[feature('a',5,far)])]);
  const summary=summarizeLocationDataset(db),change=db.prepare('SELECT * FROM transitions').get();
  assert.equal(summary.sourceRecords,1);assert.equal(summary.sites,2);assert.equal(summary.episodes,1);
  assert.equal(summary.coordinateChanges,1);assert.equal(change.comparable,1);assert.equal(change.customers_changed,1);
  assert.ok(change.distance_meters>900&&change.distance_meters<920);assert.equal(summary.exactRecurrencePairs,0);
  assert.ok(exportLocationGeoJSON(db).features.every(f=>f.properties.footprint_available===false));
});

test('absence, missing collection time, and failed-attempt boundaries break observed continuity',t=>{
  const db=build(t,[capture(0,[feature('a')]),capture(1,[]),capture(2,[feature('a')]),
    capture(8,[feature('a')]),capture(9,[feature('a')],{comparableToPrevious:false})]);
  assert.equal(summarizeLocationDataset(db).episodes,4);
  assert.deepEqual(db.prepare('SELECT start_reason FROM episodes ORDER BY first_ms').all().map(r=>r.start_reason),
    ['first_observation','after_observed_absence','after_collection_break','after_collection_break']);
  assert.equal(db.prepare('SELECT SUM(comparable) n FROM transitions').get().n,0);
  assert.equal(summarizeLocationDataset(db).candidateTurnovers,0);
});

test('nearby turnover keeps competing hypotheses and does not merge locations or records',t=>{
  const db=build(t,[capture(0,[feature('a',5)]),capture(1,[feature('b',5,near),feature('c',5,[-90.0001,35.15])])]);
  const summary=summarizeLocationDataset(db);
  assert.equal(summary.sourceRecords,3);assert.equal(summary.sites,3);assert.equal(summary.exactRecurrencePairs,0);
  assert.equal(summary.candidateTurnovers,2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM candidate_turnovers WHERE relationship='unconfirmed_nearby_turnover'").get().n,2);
  assert.equal(summary.candidateSensitivity.find(r=>r.meters===0).pairs,0);
  assert.equal(summary.candidateSensitivity.find(r=>r.meters===10).pairs,2);
});

test('unmapped records retain their counts and traceable observations',t=>{
  const db=build(t,[capture(0,[feature('a',17,null),feature('b',8,[-95,40])])]);
  const summary=summarizeLocationDataset(db);
  assert.equal(summary.unmappedObservations,2);assert.equal(summary.observations,2);assert.equal(summary.sites,0);
  assert.equal(summary.customerTotalsMismatch,0);assert.equal(summary.histogramObservationMismatch,0);
  assert.equal(exportLocationGeoJSON(db).features.length,0);
});

test('extending a cutoff preserves existing observation identities and exact coordinate precision',t=>{
  const original=[capture(0,[feature('a')]),capture(1,[feature('a',3)])];
  const first=build(t,original),longer=build(t,[...original,capture(2,[feature('b',3,[-90.000001,35.15])])]);
  assert.deepEqual(longer.prepare("SELECT * FROM observations WHERE capture_id IN ('capture-0','capture-1') ORDER BY capture_id,source_id").all(),
    first.prepare('SELECT * FROM observations ORDER BY capture_id,source_id').all());
  assert.notEqual(siteId(here),siteId([-90.000001,35.15]));
  assert.equal(summarizeLocationDataset(longer).sites,2);
});

test('invalid source totals, repeated IDs, and unsorted captures are rejected',()=>{
  assert.throws(()=>buildLocationDataset([capture(0,[feature('a')],{customers:99})]),/totals disagree/);
  assert.throws(()=>buildLocationDataset([capture(0,[feature('a'),feature('a')])]),/duplicate/);
  assert.throws(()=>buildLocationDataset([capture(1,[]),capture(0,[])]),/strictly increasing/);
});
