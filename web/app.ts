import L from 'leaflet';
import { Chart, registerables } from 'chart.js';
import { ggplotMinimalGrid } from './ggplot-theme';
import { HistoryHeatmap } from './heatmap';
import type { FeatureCollection } from 'geojson';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { WeatherControls } from './weather';
import { RainfallControls } from './rainfall';
import { PairedOutageMap } from './paired-map';

Chart.register(...registerables);
Chart.defaults.font.family = 'Arial, Helvetica, sans-serif';
Chart.defaults.font.size = 16;
Chart.defaults.color = '#333333';
import { api } from './api';
import type { Metric, Capture, SourceTime, Feature, Snapshot, Health, Series, SpatialCell, SpatialHistory } from './api-types';
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const put = (id: string, value: string) => { el(id).textContent = value; };
const fmt = new Intl.NumberFormat('en-US');
const DAY = 86400000;
const time = (value: string | number, date = false) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago',
  ...(date ? { month: 'short', day: 'numeric' } as const : {}), hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value));
const chartTime = (value: number) => {
  const resolution = series?.resolution ?? '5m', span = series ? series.to - series.from : DAY;
  return new Intl.DateTimeFormat('en-US', resolution === 'daily' ? { timeZone: 'UTC', month: 'short', day: 'numeric' } :
    resolution === 'hourly' || span > 26 * 3600000 ? { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric' } :
    { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(value);
};
const dayOf = (value: string) => value.slice(0, 10);
let selected: Snapshot | null = null, health: Health | null = null, captures: Capture[] = [], series: Series | null = null;
let followLatest = true, metric: Metric = 'customers', days = 1, snapshotRequest = 0, seriesRequest = 0, dayRequest = 0;
let activeParams = '', tilesFailed = false, mapMessage = '';
type MapView = 'capture' | 'history' | 'percapita' | 'locations' | 'rainfall';
type Range = { from: number; to: number };
const isSpatial = (view: MapView) => view === 'history' || view === 'percapita' || view === 'locations';
let mapView: MapView = 'capture', spatialRequest = 0;
let rainfallRange:{from:string;to:string}|null=null;
let spatialData: SpatialHistory | null = null, censusGeometry: FeatureCollection | null = null;
let mapMeasure: 'events' | 'customers' = 'events';
// A custom episode is one explicit UTC interval shared by the chart and period maps.
let episode: Range | null = null, chartEpisode = false, playing = false, playTimer = 0;
const map = L.map('map', { preferCanvas: true, scrollWheelZoom: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView([35.14, -89.88], 10);
map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
const pointsLayer = L.layerGroup().addTo(map);
const markers = new Map<string, L.CircleMarker>();
const weather = new WeatherControls(map);
const paired = new PairedOutageMap(map, cell => spatialPopup(cell, false));
const rainfall = new RainfallControls(map,range=>{
  rainfallRange=range?{from:range.from,to:range.to}:null;seriesRequest++;series=null;chart.data.datasets[0].data=[];chart.update('none');
  put('coverage',range?'Loading matching outage coverage…':'No rainfall period selected');
  put('quality-note','Outage coverage is loading for the selected rainfall period.');
  el('chart-empty').hidden=false;put('chart-empty',range?'Loading outage history for this period…':'Select a prepared rainfall period');
  el('csv').setAttribute('aria-disabled','true');
  void paired.load(rainfallRange,health?.firstCaptureAt??null);
  if(range)void loadSeries().catch(error=>{put('chart-empty','Outage history unavailable for this period');showError(error.message);});
});
const showError = (message: string) => { put('error-text', message); el('error').hidden = false; };
const clearError = () => { el('error').hidden = true; };
function mapNotice(message = mapMessage) {
  mapMessage = message;
  const content = message || (tilesFailed ? 'Basemap unavailable. Reported outage points remain visible.' : '');
  put('map-notice', content); el('map-notice').hidden = !content;
}
function sourceTime(value: SourceTime) {
  return value.utc ? time(value.utc, true) : value.status === 'ambiguous' ? `${value.raw ?? ''} (ambiguous Central time)` : 'Unavailable';
}
function popupNode(title: string, entries: string[][], note: string) {
  const node = document.createElement('div'); node.className = 'outage-popup';
  const heading = document.createElement('strong'); heading.textContent = title; node.append(heading);
  for (const [label, value] of entries) { const p = document.createElement('p'), b = document.createElement('b'); b.textContent = `${label}: `; p.append(b, document.createTextNode(value)); node.append(p); }
  const small = document.createElement('small'); small.textContent = note; node.append(small);
  return node;
}
function popup(feature: Feature): HTMLElement {
  return popupNode(`Outage ${feature.id}`, [['Customers', fmt.format(feature.properties.customers)], ['Started', sourceTime(feature.properties.started)],
    ['Status', feature.properties.status || 'Unavailable'], ['Repair estimate', sourceTime(feature.properties.estimatedRepair)]], 'Approximate location · Times assume Central');
}
function renderMap(data: Snapshot) {
  if (mapView !== 'capture') return;
  pointsLayer.clearLayers(); markers.clear();
  if (!data.detail.available) { mapNotice(data.detail.reason); return; }
  for (const feature of data.detail.geojson?.features ?? []) {
    if (!feature.geometry) continue;
    const [lng, lat] = feature.geometry.coordinates;
    const marker = L.circleMarker([lat, lng], { radius: Math.max(5, Math.min(30, 4 + Math.sqrt(feature.properties.customers) * .85)),
      color: '#000000', weight: 1, fillColor: '#000000', fillOpacity: .65 }).bindPopup(popup(feature), { maxHeight: 240, maxWidth: 280, autoPanPadding: [16, 16] });
    marker.addTo(pointsLayer); markers.set(feature.id, marker);
  }
  mapNotice(data.detail.geojson?.features.length === 0 ? 'This accepted capture reports zero outages.' :
    data.detail.unmapped ? `${data.detail.unmapped} reported events have no usable map location.` : '');
}
const rateText = (value: number | null | undefined) => value == null ? 'Unavailable' : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
const rateBreaks = () => mapMeasure === 'events' ? [1, 2, 5, 10] : [10, 25, 50, 100];
const rateColors = ['#fff', '#deebf7', '#9ecae1', '#6baed6', '#3182bd', '#08519c'];
const rateValue = (cell?: SpatialCell) => mapMeasure === 'events' ? cell?.eventsPer1000 : cell?.customersPer1000;
// Distinct source records at one exact point; a fixed scale so periods compare directly.
const LOCATION_BINS = [{ label: '1 source record', color: '#c6dbef', radius: 5 }, { label: '2', color: '#6baed6', radius: 7 },
  { label: '3–4', color: '#2171b5', radius: 9 }, { label: '5 or more', color: '#08306b', radius: 11 }];
const locationBin = (records: number) => LOCATION_BINS[records >= 5 ? 3 : records >= 3 ? 2 : records >= 2 ? 1 : 0];
function rateColor(value: number | null | undefined) {
  if (value == null) return '#bdbdbd';
  if (value === 0) return rateColors[0];
  const index = rateBreaks().findIndex(stop => value <= stop);
  return rateColors[index < 0 ? 5 : index + 1];
}
function renderScale() {
  const scale = el('map-scale'); scale.replaceChildren();
  if (mapView === 'history') {
    const low = document.createElement('span'), high = document.createElement('span'), ramp = document.createElement('i');
    low.textContent = 'Lower'; high.textContent = 'Higher'; ramp.className = 'heat-scale'; ramp.setAttribute('aria-hidden', 'true');
    scale.append(low, ramp, high); return;
  }
  if (mapView === 'locations') {
    for (const bin of LOCATION_BINS) {
      const item = document.createElement('span'), swatch = document.createElement('i');
      swatch.className = 'location-dot'; swatch.style.background = bin.color; swatch.style.width = swatch.style.height = `${bin.radius * 2}px`; swatch.setAttribute('aria-hidden', 'true');
      item.append(swatch, document.createTextNode(bin.label)); scale.append(item);
    }
    return;
  }
  const breaks = rateBreaks(), labels = ['0', `0–${breaks[0]}`, ...breaks.slice(1).map((n, i) => `${breaks[i]}–${n}`), `>${breaks.at(-1)}`, 'No rate'];
  labels.forEach((label, i) => {
    const item = document.createElement('span'), swatch = document.createElement('i');
    swatch.style.background = i === 6 ? '#bdbdbd' : rateColors[i]; swatch.setAttribute('aria-hidden', 'true');
    item.append(swatch, document.createTextNode(label)); scale.append(item);
  });
}
function spatialPopup(cell: SpatialCell, census: boolean) {
    const entries = [['Reported events (provisional)', rateText(cell.events)],
      ['Peak customers in one capture', rateText(cell.peakCustomers)]];
    if (census) entries.push(['Events per 1,000 residents', rateText(cell.eventsPer1000)], ['Peak customers per 1,000 residents', rateText(cell.customersPer1000)],
      ['Estimated residents (2020–2024 ACS)', cell.population == null ? 'Unavailable' : `${fmt.format(cell.population)}${cell.populationMoe == null ? '' : ` ± ${fmt.format(cell.populationMoe)} (90% MOE)`}`]);
    if (cell.firstSeenAt != null) entries.push(['First observed', time(cell.firstSeenAt, true)], ['Last observed', time(cell.lastSeenAt!, true)]);
    if (cell.uncertainEvents) entries.push(['Events with uncertain identity', fmt.format(cell.uncertainEvents)]);
    return popupNode(census ? `${cell.name ?? cell.id} · Tract ${Number(cell.id.slice(5, 9))}.${cell.id.slice(9, 11)}` : 'Reported activity in this 1 km area', entries,
      census ? `${cell.populationUncertain ? 'Population estimate has a large or unavailable margin of error. ' : ''}${!cell.population ? 'No positive population denominator. ' : ''}Customers are utility accounts. Approximate outage points can represent customers across block-group boundaries.` : 'Smoothed reported activity, not an outage boundary or customer address.');
}
function locationPopup(cell: SpatialCell) {
  const entries = [['Source records (distinct IDs)', fmt.format(cell.sourceRecords ?? 0)], ['Provisional events (ID and start time)', rateText(cell.events)],
    ['Captures reporting this point', fmt.format(cell.observations ?? 0)], ['Peak simultaneous customers', rateText(cell.peakCustomers)],
    ['First observed', time(cell.firstSeenAt!, true)], ['Last observed', time(cell.lastSeenAt!, true)], ['Coordinates', `${cell.center![1]}, ${cell.center![0]}`]];
  if (cell.uncertainEvents) entries.push(['Events with uncertain identity', fmt.format(cell.uncertainEvents)]);
  return popupNode('Exact reported location', entries, 'The published point for these source records, not a customer address, equipment location or outage boundary. Shared points show reuse of a reporting location only.');
}
function coverageWarnings(data: SpatialHistory) {
  const warnings = [];
  if (data.unavailableCaptures) warnings.push(`${data.unavailableCaptures} captures could not be mapped`);
  if (data.unmappedObservations) warnings.push(`${data.unmappedObservations} observations could not be assigned`);
  if (data.verifiedCaptures && data.coverage < .9) warnings.push(`${Math.round(data.coverage * 100)}% time coverage; missing history is unknown`);
  mapNotice(!data.captures ? 'No captures in this period.' : !data.verifiedCaptures ? 'Archived map detail is unavailable for this period.' :
    !data.cells.length ? 'No mapped outages in the verified captures.' : warnings.join('. '));
}
function renderLocations(data: SpatialHistory) {
  spatialData = data; pointsLayer.clearLayers(); markers.clear(); renderScale();
  const records = (cell: SpatialCell) => cell.sourceRecords ?? 0;
  const sites = data.cells.filter(cell => cell.center).sort((a, b) => records(b) - records(a) || (b.peakCustomers ?? 0) - (a.peakCustomers ?? 0) || a.id.localeCompare(b.id));
  const reused = sites.filter(cell => records(cell) > 1), shown = el<HTMLSelectElement>('location-filter').value === 'recurring' ? reused : sites;
  const siteMarkers = new Map<string, L.CircleMarker>();
  // Draw the most reused points last so they stay on top.
  for (const cell of [...shown].reverse()) {
    const bin = locationBin(records(cell));
    siteMarkers.set(cell.id, L.circleMarker([cell.center![1], cell.center![0]], { radius: bin.radius, color: '#000000', weight: 1, fillColor: bin.color, fillOpacity: .85 })
      .bindPopup(locationPopup(cell), { maxHeight: 280, maxWidth: 300, autoPanPadding: [16, 16] }).addTo(pointsLayer));
  }
  const list = el('location-list'); list.replaceChildren();
  if (!reused.length) { const p = document.createElement('p'); p.className = 'muted empty-list'; p.textContent = 'No reporting location was reused by different source records in this period.'; list.append(p); }
  for (const cell of reused.slice(0, 10)) {
    const button = document.createElement('button'); button.className = 'outage-row';
    const name = document.createElement('span'); name.textContent = `${fmt.format(records(cell))} source records`;
    const detail = document.createElement('small'); detail.textContent = `Peak ${fmt.format(cell.peakCustomers ?? 0)} ${cell.peakCustomers === 1 ? 'customer' : 'customers'} · last ${time(cell.lastSeenAt!, true)}`;
    const place = document.createElement('b'); place.textContent = `${cell.center![1].toFixed(4)}, ${cell.center![0].toFixed(4)}`;
    name.append(detail); button.append(name, place);
    button.addEventListener('click', () => {
      const marker = siteMarkers.get(cell.id); if (!marker) return;
      map.setView(marker.getLatLng(), 14, { animate: false }); marker.openPopup(); el('map').scrollIntoView({ block: 'center' });
    });
    list.append(button);
  }
  put('location-note', `${reused.length > 10 ? 'Ten most reused shown. ' : ''}Ranked by distinct source records, then peak simultaneous customers. Reuse is observed location sharing, not a confirmed cause, circuit or customer group.`);
  const csv = el<HTMLAnchorElement>('locations-csv');
  csv.href = `/api/export.csv?${new URLSearchParams({ view: 'locations', from: new Date(data.from).toISOString(), to: new Date(data.to).toISOString() })}`; csv.removeAttribute('aria-disabled');
  put('spatial-status', `${fmt.format(sites.length)} exact reporting location${sites.length === 1 ? '' : 's'} · ${fmt.format(reused.length)} reused by 2+ source records`);
  put('spatial-window', `${time(data.from, true)} – ${time(data.to, true)} · ${data.verifiedCaptures} verified captures`);
  put('spatial-notes', `${data.meaning} Colors and sizes use a fixed scale of distinct source records. A record whose coordinates change appears at each point it used, and its events are marked uncertain. ${data.uncertainEvents} event identities are uncertain. ${data.unavailableCaptures} captures have unavailable detail; ${data.unmappedObservations} observations have no usable location. ${(data.coverage * 100).toFixed(1)}% time coverage for this map period. Coordinate transitions and unconfirmed nearby replacements are available from the offline location dataset build.`);
  coverageWarnings(data);
}
function renderSpatial(data: SpatialHistory) {
  if (data.geography === 'location') { renderLocations(data); return; }
  spatialData = data; pointsLayer.clearLayers(); markers.clear(); renderScale();
  const census = data.geography === 'block-group';
  if (census && censusGeometry) {
    const cells = new Map(data.cells.map(cell => [cell.id, cell]));
    L.geoJSON(censusGeometry, { style: feature => ({ color: '#777', weight: .6, fillOpacity: .72, fillColor: rateColor(rateValue(cells.get(String(feature?.id)))) }),
      onEachFeature: (feature, layer) => { const cell = cells.get(String(feature.id)); if (cell) layer.bindPopup(spatialPopup(cell, true), { maxHeight: 280, maxWidth: 300, autoPanPadding: [16, 16] }); }
    }).addTo(pointsLayer);
  } else if (!census) {
    new HistoryHeatmap(data.cells.filter(c => c.center && c.events).map(c => ({ center: c.center!, events: c.events! }))).addTo(pointsLayer);
    for (const cell of data.cells) if (cell.center) L.circleMarker([cell.center[1], cell.center[0]], { radius: 14, stroke: false, fillOpacity: 0 })
      .bindPopup(spatialPopup(cell, false), { maxHeight: 240, maxWidth: 280, autoPanPadding: [16, 16] }).addTo(pointsLayer);
  }
  const activeAreas = data.cells.filter(cell => cell.events && cell.events > 0).length;
  put('spatial-status', `${fmt.format(data.mappedEvents)} reported events · ${fmt.format(activeAreas)} ${census ? 'block groups' : 'areas'}`);
  put('spatial-window', `${time(data.from, true)} – ${time(data.to, true)} · ${data.verifiedCaptures} verified captures`);
  put('spatial-notes', `${data.meaning} ${census ? 'Population estimates and 90% margins of error are from ACS table B01003; matching 2024 boundaries are from Census TIGERweb. Zero/missing populations have no rate. White areas have no assigned events in verified captures, not proof of uninterrupted power. ' : 'The heatmap smooths 1 km cells with a 750 m Gaussian bandwidth, truncated at 2.25 km. Color uses square-root-scaled relative density within this period; panning does not rescale it. '}Peak customers is the largest simultaneous count in an area, never a sum across captures. ${data.uncertainEvents} event identities are uncertain. ${data.unavailableCaptures} captures have unavailable detail; ${data.unmappedObservations} observations cannot be assigned. ${(data.coverage * 100).toFixed(1)}% time coverage for this map period. Only collected current-format history is included; older legacy history has not been imported.`);
  coverageWarnings(data);
}
async function loadSpatial() {
  const ticket = ++spatialRequest;
  clearError(); spatialData = null; pointsLayer.clearLayers(); markers.clear();
  el('locations-csv').setAttribute('aria-disabled', 'true');
  const period = el<HTMLSelectElement>('map-period'), to = Date.now();
  if (period.value === 'episode' && !episode) {
    put('spatial-status', 'Choose a custom episode'); put('spatial-window', ''); put('spatial-notes', 'Enter a start and end time above, then apply the episode.');
    mapNotice('Choose a custom episode to map.'); openEpisodeForm(); return;
  }
  put('spatial-status', mapView === 'locations' ? 'Loading reported locations…' : 'Loading historical locations…'); put('spatial-window', '');
  put('spatial-notes', 'Historical map is loading.'); mapNotice('Loading historical locations…');
  const first = health?.firstCaptureAt ? Date.parse(health.firstCaptureAt) : to - DAY;
  const available = period.querySelector<HTMLOptionElement>('option[value="available"]')!;
  available.disabled = to - first > 31 * DAY;
  if (period.value === 'available' && available.disabled) period.value = '30';
  const range = period.value === 'episode' ? episode! : { from: period.value === 'available' ? Math.min(first, to - 1) : to - Number(period.value) * DAY, to };
  period.disabled = true;
  try {
    const params = new URLSearchParams({ view: 'spatial', from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString() });
    if (mapView === 'locations') params.set('geography', 'location');
    if (mapView === 'percapita') {
      params.set('geography', 'block-group');
      censusGeometry ??= await api<FeatureCollection>('/api/config?view=census');
      if (ticket !== spatialRequest || mapView !== 'percapita') return;
    }
    const data = await api<SpatialHistory>(`/api/series?${params}`);
    if (ticket !== spatialRequest || !isSpatial(mapView)) return;
    renderSpatial(data);
  } catch (error) {
    if (ticket !== spatialRequest || !isSpatial(mapView)) return;
    put('spatial-status', 'Historical map unavailable'); put('spatial-notes', (error as Error).message);
    mapNotice((error as Error).message); showError((error as Error).message);
  } finally { if (ticket === spatialRequest) period.disabled = false; }
}
function setMapView(view: MapView, load = true) {
  const wasRainfall=mapView==='rainfall';mapView = view; spatialRequest++;snapshotRequest++;dayRequest++;seriesRequest++;
  if (view !== 'capture') stopPlayback();
  pointsLayer.clearLayers();markers.clear();mapNotice('');
  void weather.select(null,view==='capture');
  void rainfall.activate(view==='rainfall');
  paired.show(view==='rainfall');
  const history = view !== 'capture', spatial = isSpatial(view);
  for (const id of ['capture-selection', 'capture-totals', 'capture-long-running', 'history-controls', 'capture-signals', 'capture-notes', 'geojson']) el(id).hidden = history;
  for (const id of ['spatial-summary', 'map-period-label', 'spatial-notes']) el(id).hidden = !spatial;
  el('location-filter-label').hidden = el('location-ranking').hidden = view !== 'locations';
  document.querySelectorAll<HTMLButtonElement>('[data-map-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mapView === view)));
  el('map-measure-label').hidden = el('census-caption').hidden = view !== 'percapita';
  el('map-circles').hidden = history; el('map-scale').hidden = !spatial;
  el('map-key-label').parentElement!.hidden=view==='rainfall';
  document.querySelector<HTMLElement>('.range-buttons')!.hidden=view==='rainfall';
  document.querySelector<HTMLElement>('.legend-selected')!.parentElement!.hidden=view==='rainfall';
  put('chart-heading',view==='rainfall'?'Outages in rainfall period':'History');
  put('map-heading', view==='rainfall'?'Rainfall and outages':view === 'percapita' ? 'Outages per capita' : view === 'locations' ? 'Exact reporting locations' : history ? 'Historical outage density' : 'Reported locations');
  el('map').setAttribute('aria-label',view==='rainfall'?'Prepared accumulated rainfall; tap to inspect a native cell': view === 'percapita' ? 'Shelby County Census block-group outage rates' :
    view === 'locations' ? 'Exact reported outage locations, colored and sized by distinct source records' : history ? 'Historical reported outage density heatmap' : 'Approximate reported outage points');
  updateMapLegend(); syncEpisodeForm(); syncUrl();
  el<HTMLSelectElement>('map-period').disabled = false;
  if (load) {
    if (view==='rainfall')return;
    if (spatial) void loadSpatial();
    else void selectCapture(followLatest ? undefined : selected?.summary?.id);
  }
  if(wasRainfall&&view!=='rainfall')void loadSeries().catch(error=>showError(error.message));
}
function updateMapLegend() {
  put('map-key-label', mapView === 'percapita' ? `${mapMeasure === 'events' ? 'Reported events' : 'Peak customers affected'} per 1,000 residents` :
    mapView === 'history' ? 'Reported event density · selected period' : mapView === 'locations' ? 'Exact reported points · distinct source records' : 'Size = customers affected');
  renderScale();
}
// Central wall-clock inputs. An ambiguous fall-back time uses its first
// (daylight) occurrence; a time skipped by the spring change is rejected.
const centralParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function toCentralInput(ms: number) {
  const p = Object.fromEntries(centralParts.formatToParts(ms).map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function fromCentralInput(value: string) {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::00(?:\.000)?)?$/.exec(value);
  if (!m) return NaN;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  for (const hours of [5, 6]) if (toCentralInput(wall + hours * 3600000) === value.slice(0, 16)) return wall + hours * 3600000;
  return NaN;
}
function syncEpisodeForm() {
  el('episode-form').hidden = mapView === 'rainfall' || !((isSpatial(mapView) && el<HTMLSelectElement>('map-period').value === 'episode') || chartEpisode);
  document.querySelectorAll<HTMLButtonElement>('[data-days]').forEach(b => b.setAttribute('aria-pressed', String(chartEpisode ? b.dataset.days === 'episode' : b.dataset.days === String(days))));
}
function openEpisodeForm() {
  const from = el<HTMLInputElement>('episode-from'), to = el<HTMLInputElement>('episode-to');
  if (!from.value || !to.value) { const now = Date.now(); from.value = toCentralInput(episode?.from ?? now - DAY); to.value = toCentralInput(episode?.to ?? now); }
  el('episode-form').hidden = false;
}
function syncUrl() {
  const params = new URLSearchParams();
  if (episode && (chartEpisode || el<HTMLSelectElement>('map-period').value === 'episode')) { params.set('from', new Date(episode.from).toISOString()); params.set('to', new Date(episode.to).toISOString()); }
  if (mapView !== 'capture') params.set('view', mapView);
  const query = params.toString();
  history.replaceState(null, '', query ? `?${query}` : location.pathname);
}
function describeEpisode(range: Range) {
  const hours = (range.to - range.from) / 3600000;
  return `${time(range.from, true)} – ${time(range.to, true)} · ${hours < 48 ? `${hours.toFixed(hours % 1 ? 1 : 0)} hours` : `${(hours / 24).toFixed(1)} days`}`;
}
function applyEpisode(range: Range) {
  episode = range; chartEpisode = true;
  el<HTMLSelectElement>('map-period').value = 'episode';
  el<HTMLInputElement>('episode-from').value = toCentralInput(range.from); el<HTMLInputElement>('episode-to').value = toCentralInput(range.to);
  const first = health?.firstCaptureAt ? Date.parse(health.firstCaptureAt) : NaN;
  put('episode-status', `Episode: ${describeEpisode(range)}.${range.from < first ? ` Current-feed collection began ${time(first, true)}; earlier time is unknown, not zero.` : ''}`);
  syncEpisodeForm(); syncUrl();
  void loadSeries().catch(error => showError(error.message));
  if (isSpatial(mapView)) void loadSpatial();
}
el('episode-form').addEventListener('submit', event => {
  event.preventDefault();
  const now = Date.now(), from = fromCentralInput(el<HTMLInputElement>('episode-from').value);
  let to = fromCentralInput(el<HTMLInputElement>('episode-to').value), note = '';
  const first = health?.firstCaptureAt ? Date.parse(health.firstCaptureAt) : NaN;
  if (Number.isFinite(to) && to > now) { to = now; note = ' The end was set to now.'; }
  const problem = !Number.isFinite(from) || !Number.isFinite(to) ? 'Enter both times. A time skipped by the daylight-saving change is not valid.' :
    from >= to ? 'The end must be after the start.' : to - from > 31 * DAY ? 'Choose an episode of at most 31 days.' :
    to <= first ? `Current-feed collection begins ${time(first, true)}. Use the Legacy archive for 2022–2025.` : '';
  if (problem) { put('episode-status', problem); return; }
  applyEpisode({ from, to });
  if (note) el('episode-status').textContent += note;
});
el('episode-clear').addEventListener('click', () => {
  episode = null; chartEpisode = false; put('episode-status', '');
  el<HTMLInputElement>('episode-from').value = el<HTMLInputElement>('episode-to').value = '';
  if (el<HTMLSelectElement>('map-period').value === 'episode') el<HTMLSelectElement>('map-period').value = '1';
  syncEpisodeForm(); syncUrl();
  void loadSeries().catch(error => showError(error.message));
  if (isSpatial(mapView)) void loadSpatial();
});
function renderNotes(data: Snapshot) {
  const summary = data.summary;
  put('rise-title', summary?.sharpRise ? 'Sharp increase' : summary?.change == null ? 'Change unavailable' : 'No sharp increase');
  put('rise-copy', summary?.sharpRise ? 'At least 100 more customers and double the prior comparable capture.' :
    summary?.change == null ? 'A nearby, trustworthy earlier capture is needed to compare.' : 'Threshold: +100 customers and at least 2× the prior capture within 7½ minutes.');
  el('rise-signal').classList.toggle('signal-alert', Boolean(summary?.sharpRise));
  put('baseline-title', summary?.highBaseline ? 'Above baseline' : summary?.baseline.enabled ? 'Baseline ready' : 'Learning baseline');
  put('baseline-copy', summary?.baseline.explanation ?? 'Requires 28 days with at least 90% valid coverage.');
  const list = el('long-list'); list.replaceChildren();
  const rows = data.detail.longRunning ?? [];
  put('long-count', data.detail.available ? String(rows.length) : '—');
  if (!data.detail.available || !rows.length) {
    const p = document.createElement('p'); p.className = 'muted empty-list'; p.textContent = data.detail.available ? 'None in this capture' : 'Detail unavailable'; list.append(p);
  }
  for (const row of rows.slice(0, 5)) {
    const button = document.createElement('button'); button.className = 'outage-row'; button.disabled = !markers.has(row.id);
    const name = document.createElement('span'); name.textContent = `#${row.id}`;
    const detail = document.createElement('small'); detail.textContent = `${fmt.format(row.customers)} customers`;
    const duration = document.createElement('b'); duration.textContent = `${row.hours.toFixed(1)}h`;
    name.append(detail); button.append(name, duration); button.addEventListener('click', () => {
      const marker = markers.get(row.id); if (marker) { map.setView(marker.getLatLng(), 12, { animate: false }); marker.openPopup(); el('map').scrollIntoView({ block: 'center' }); }
    }); list.append(button);
  }
  put('long-note', `${rows.length > 5 ? 'Five longest shown. ' : ''}Duration at selected capture, from source start time.${data.detail.unknownStartTimes ? ` ${data.detail.unknownStartTimes} start times unavailable or ambiguous.` : ''}`);
}
function renderSnapshot(data: Snapshot) {
  selected = data;
  const s = data.summary;
  put('selection-mode', followLatest ? 'Latest capture' : playing ? 'Replaying captures' : 'Historical capture');
  el('selection-mode').dataset.historical = String(!followLatest);
  put('selected-time', s ? time(s.capturedAt, true) : 'No accepted capture');
  const warnings = [...new Set((data.warnings ?? []).map(code =>
    code.startsWith('start_') || code.startsWith('repair_') ? 'some source times are uncertain' :
    code === 'invalid_geometry' || code === 'outside_review_bounds' ? 'some locations need review' :
    code === 'html_customer_mismatch' ? 'the source summary has a different customer total' : 'some source details need review'))];
  put('selected-note', s ? `Retrieved ${new Date(s.at).toISOString().replace('.000', '')} · current GeoJSON format${warnings.length ? `. Counts accepted; ${warnings.join('; ')}.` : ''}` : 'Choose another archive date or return to latest.');
  put('customers', s ? fmt.format(s.customers) : '—'); put('outages', s ? fmt.format(s.outages) : '—');
  put('change', s?.change != null ? `${s.change > 0 ? '+' : ''}${fmt.format(s.change)}` : '—');
  el('change').dataset.direction = s?.change == null || s.change === 0 ? 'flat' : s.change > 0 ? 'up' : 'down';
  put('change-note', s?.previousAt ? `Since ${time(s.previousAt)}` : 'No comparable prior capture');
  put('peak', s ? fmt.format(s.dailyPeak) : '—'); put('peak-note', s ? `${s.peakDay} UTC · through selection` : 'Observed through selected capture');
  renderMap(data); renderNotes(data); syncSlider();
  void weather.select(s?.capturedAt??null,mapView==='capture');
  const geo = el<HTMLAnchorElement>('geojson');
  if (s && data.detail.available) { geo.href = `/api/export.geojson?id=${encodeURIComponent(s.id)}`; geo.removeAttribute('aria-disabled'); }
  else { geo.removeAttribute('href'); geo.setAttribute('aria-disabled', 'true'); }
  chart.update('none');
}
function syncSlider() {
  const slider = el<HTMLInputElement>('time-slider'), index = captures.findIndex(c => c.id === selected?.summary?.id);
  slider.max = String(Math.max(0, captures.length - 1)); slider.value = String(Math.max(0, index)); slider.disabled = captures.length < 2;
  slider.setAttribute('aria-valuetext', index >= 0 ? time(captures[index].capturedAt, true) : 'No capture selected');
  el<HTMLButtonElement>('previous').disabled = index <= 0; el<HTMLButtonElement>('next').disabled = index < 0 || index >= captures.length - 1;
  el<HTMLButtonElement>('play').disabled = !playing && captures.length < 2;
  put('capture-count', `${captures.length} captures`); put('first-time', captures.length ? time(captures[0].at) : '—');
  put('last-time', captures.length ? time(captures.at(-1)!.at) : '—'); put('slider-time', index >= 0 ? `${index + 1} of ${captures.length} · ${time(captures[index].at)}` : 'No capture selected');
}
async function loadDay(date: string) {
  const ticket = ++dayRequest;
  const result = await api<{ snapshots: Capture[] }>(`/api/snapshots?date=${date}`);
  if (ticket !== dayRequest) return;
  captures = result.snapshots; el<HTMLInputElement>('archive-date').value = date; syncSlider();
}
async function selectCapture(id?: string) {
  const ticket = ++snapshotRequest;
  clearError();
  // Clear previous values immediately so a slow or failed read cannot label the old map as the new selection.
  renderSnapshot({ summary: null, detail: { available: false, reason: 'Loading selected capture…' } });
  put('selected-time', 'Loading observation…');
  try {
    const data = await api<Snapshot>(id ? `/api/snapshot/${encodeURIComponent(id)}` : '/api/latest');
    if (ticket !== snapshotRequest) return;
    // Replay stays within the request budget: the day list is reread only when the selection leaves it.
    if (data.summary && !captures.some(c => c.id === data.summary!.id)) await loadDay(dayOf(data.summary.capturedAt));
    if (ticket !== snapshotRequest) return;
    renderSnapshot(data);
  } catch (error) {
    if (ticket !== snapshotRequest) return;
    renderSnapshot({ summary: null, detail: { available: false, reason: 'Unable to load the selected capture. Retry or choose another date.' } });
    showError((error as Error).message);
  }
}
function renderPlay() {
  const button = el('play');
  button.setAttribute('aria-pressed', String(playing)); button.setAttribute('aria-label', playing ? 'Pause replay' : 'Play replay');
  el('play-icon').setAttribute('d', playing ? 'M8 5v14M16 5v14' : 'M7 4.5v15l12-7.5z');
  syncSlider();
}
function stopPlayback() {
  if (!playing) return;
  playing = false; window.clearTimeout(playTimer); renderPlay();
  if (selected?.summary && !followLatest) put('selection-mode', 'Historical capture');
}
async function nextCapture() {
  const index = captures.findIndex(c => c.id === selected?.summary?.id);
  if (index < 0) return undefined;
  if (index < captures.length - 1) return captures[index + 1];
  // Continue into the following UTC day only when it has accepted captures.
  const following = new Date(Date.parse(el<HTMLInputElement>('archive-date').value) + DAY).toISOString().slice(0, 10);
  if (following > new Date().toISOString().slice(0, 10)) return undefined;
  return (await api<{ snapshots: Capture[] }>(`/api/snapshots?date=${following}`)).snapshots[0];
}
function schedule(delay = Number(el<HTMLSelectElement>('play-speed').value)) { window.clearTimeout(playTimer); playTimer = window.setTimeout(() => void step(), delay); }
async function step() {
  if (!playing) return;
  try {
    const row = await nextCapture();
    if (!playing) return;
    if (!row) { stopPlayback(); put('slider-time', `${el('slider-time').textContent} · end of available captures`); return; }
    await selectCapture(row.id);
    if (!playing) return;
    if (selected?.summary?.id !== row.id) { stopPlayback(); return; }
    schedule();
  } catch (error) { stopPlayback(); showError((error as Error).message); }
}
el('play').addEventListener('click', () => {
  if (playing) { stopPlayback(); return; }
  playing = true; followLatest = false; renderPlay();
  const index = captures.findIndex(c => c.id === selected?.summary?.id);
  // From the newest capture, replay the loaded UTC day from its beginning.
  if (index === captures.length - 1 && captures.length > 1 && selected?.summary?.id === health?.latest?.id)
    void selectCapture(captures[0].id).then(() => { if (playing) schedule(); });
  else void step();
});
const chart = new Chart(el<HTMLCanvasElement>('chart'), {
  type: 'line', data: { datasets: [{ label: 'Affected customers', data: [] as { x: number; y: number | null }[], borderColor: '#000000',
    backgroundColor: '#000000', borderWidth: 1.5, pointRadius: 2.5, pointHoverRadius: 5, pointHitRadius: 12, tension: 0, spanGaps: false }] },
  options: { responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
    onResize: (chart, size) => { chart.options.scales!.x!.ticks!.maxTicksLimit = size.width < 450 ? 3 : 5; },
    scales: { x: { type: 'linear', border: { display: false },
      grid: { color: '#EBEBEB', lineWidth: 1, drawTicks: false, tickLength: 0 },
      ticks: { maxTicksLimit: 5, maxRotation: 0, padding: 6, font: { size: 16 }, color: '#333333', callback: value => chartTime(Number(value)) } },
      y: { beginAtZero: true, border: { display: false },
        grid: { color: '#EBEBEB', lineWidth: 1, drawTicks: false, tickLength: 0 },
        ticks: { precision: 0, maxTicksLimit: 6, padding: 6, font: { size: 16 }, color: '#333333' } } },
    plugins: { legend: { display: false }, tooltip: { cornerRadius: 0, titleFont: { size: 16 }, bodyFont: { size: 16 }, footerFont: { size: 16 }, padding: 8, callbacks: {
      title: items => { const p = series?.points[items[0]?.dataIndex]; return p ? series?.resolution === 'daily' ? `UTC day: ${new Date(p.at).toISOString().slice(0, 10)}` : time(p.at, true) : ''; },
      afterBody: items => { const p = series?.points[items[0]?.dataIndex]; return p && series?.resolution !== '5m' ? ['Observed bucket peak', `${Math.round((p.coverage ?? 0) * 100)}% time coverage`, time(metric === 'outages' ? p.outageCapturedAt! : p.capturedAt!, true), 'Tap to view map'] : ['Tap to view map']; }
    } } },
    onClick: (_event, elements) => {
      const p = series?.points[elements[0]?.index]; const id = metric === 'outages' ? p?.outageId ?? p?.id : p?.id;
      if (id) { stopPlayback(); followLatest = false; setMapView('capture', false); void selectCapture(id); }
    }
  },
  plugins: [ggplotMinimalGrid, { id: 'selected-capture', afterDraw(chart) {
    const s = selected?.summary; if (!s) return;
    const x = chart.scales.x.getPixelForValue(s.at); if (x < chart.chartArea.left || x > chart.chartArea.right) return;
    const ctx = chart.ctx; ctx.save(); ctx.strokeStyle = '#000000'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x, chart.chartArea.top); ctx.lineTo(x, chart.chartArea.bottom); ctx.stroke(); ctx.restore();
  } }]
});
void document.fonts.ready.then(() => chart.update('none'));
function renderChart() {
  if (!series) return;
  const ds = chart.data.datasets[0]; ds.data = series.points.map(p => ({ x: p.at, y: p[metric] }));
  ds.label = metric === 'customers' ? 'Affected customers' : 'Reported outages';
  const anomalyIds = new Set(series.anomalies.map(a => a.id));
  const marked = (index: number) => { const p = series?.points[index], id = metric === 'outages' ? p?.outageId ?? p?.id : p?.id; return Boolean(id && anomalyIds.has(id)); };
  ds.pointRadius = context => marked(context.dataIndex) ? 6 : 2.5;
  ds.pointStyle = context => marked(context.dataIndex) ? 'triangle' : 'circle';
  ds.pointBackgroundColor = '#000000';
  ds.segment = { borderColor: context => series?.resolution !== '5m' &&
    ((series?.points[context.p0DataIndex]?.coverage ?? 0) < .9999 || (series?.points[context.p1DataIndex]?.coverage ?? 0) < .9999) ? 'transparent' : '#000000' };
  const x = chart.options.scales!.x!;
  x.min = series.resolution === '5m' ? (series.points[0]?.at ?? series.from) - 60000 : series.from;
  x.max = series.resolution === '5m' ? (series.points.at(-1)?.at ?? series.to) + 60000 : series.to;
  chart.update(); el('chart-empty').hidden = series.observedSnapshots > 0;
  put('chart-zone', series.resolution === 'daily' ? 'UTC days' : 'Central time');
  put('chart-empty',mapView==='rainfall'?'No collected outage captures in this rainfall period':'No captures in this period');
  put('series-label', series.resolution === '5m' ? 'Captured totals' : series.resolution === 'hourly' ? 'Hourly peaks' : 'Daily peaks');
  put('series-note', `${series.meaning} Select a point to view its map. Larger triangles mark sharp increases.`);
  put('coverage', `${(series.coverage * 100).toFixed(1)}% time coverage`);
  put('quality-note', `${fmt.format(series.observedSnapshots)} accepted captures in the requested period. ${series.firstCaptureAt ? `Available history in this window begins ${time(series.firstCaptureAt, true)}. ` : ''}Missing observations are unknown. ${series.quality.length ? series.quality.map(q => `${q.count} ${q.outcome} attempts`).join(' · ') + '. ' : ''}${mapView==='rainfall'?'Weather does not imply outage observations for this period.':'Dashed line: selected capture.'}`);
  el<HTMLAnchorElement>('csv').href = `/api/export.csv?${activeParams}`;
  el('csv').removeAttribute('aria-disabled');
}
async function loadSeries() {
  if(mapView==='rainfall'&&!rainfallRange)return;
  const ticket = ++seriesRequest, now = Date.now();
  let range: Range, resolution: string;
  if (mapView === 'rainfall') { range = { from: Date.parse(rainfallRange!.from), to: Math.min(Date.parse(rainfallRange!.to), now) }; resolution = 'hourly'; }
  else if (chartEpisode && episode) { range = episode; const span = episode.to - episode.from; resolution = span <= 2 * DAY ? '5m' : span <= 10 * DAY ? 'hourly' : 'daily'; }
  else { range = { from: now - days * DAY, to: now }; resolution = days === 1 ? '5m' : days === 7 ? 'hourly' : 'daily'; }
  const params = new URLSearchParams({ from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString(), resolution }).toString();
  const data = await api<Series>(`/api/series?${params}`);
  if (ticket !== seriesRequest) return;
  series = data; activeParams = params; renderChart();
}
async function refreshHealth() {
  health = await api<Health>('/api/health');
  el('freshness').dataset.status = health.status;
  put('freshness-label', health.status === 'ok' ? 'Up to date' : health.status === 'warning' ? 'Needs attention' : 'Capture stale');
  put('freshness-time', health.latest ? `${Math.floor(health.ageMinutes ?? 0)} min since capture` : 'No captures yet');
  el<HTMLInputElement>('archive-date').max = new Date().toISOString().slice(0, 10);
  if (health.firstCaptureAt) el<HTMLInputElement>('archive-date').min = dayOf(health.firstCaptureAt);
}
async function refresh() {
  try {
    await refreshHealth();
    // A completed custom episode cannot gain captures; only rolling periods are refreshed.
    if (mapView === 'rainfall' || !chartEpisode) await loadSeries();
    if (isSpatial(mapView) && el<HTMLSelectElement>('map-period').value !== 'episode') await loadSpatial();
    else if (mapView==='capture'&&followLatest && health?.latest?.id !== selected?.summary?.id) await selectCapture();
  }
  catch (error) { el('freshness').dataset.status = 'stale'; put('freshness-label', 'Local archive connection lost'); showError((error as Error).message); }
}
el('latest').addEventListener('click', () => { stopPlayback(); followLatest = true; void selectCapture(); });
el('retry').addEventListener('click', () => { stopPlayback(); clearError(); void refresh(); if (mapView === 'capture' && !followLatest) void selectCapture(captures[Number(el<HTMLInputElement>('time-slider').value)]?.id); });
document.querySelectorAll<HTMLButtonElement>('[data-map-view]').forEach(button => button.addEventListener('click', () => setMapView(button.dataset.mapView as MapView)));
el('map-period').addEventListener('change', () => {
  syncEpisodeForm(); syncUrl();
  if (el<HTMLSelectElement>('map-period').value === 'episode' && !episode) openEpisodeForm();
  if (isSpatial(mapView)) void loadSpatial();
});
el('map-measure').addEventListener('change', () => {
  mapMeasure = el<HTMLSelectElement>('map-measure').value as 'events' | 'customers'; updateMapLegend();
  if (mapView === 'percapita' && spatialData?.geography === 'block-group') renderSpatial(spatialData);
});
el('location-filter').addEventListener('change', () => { if (mapView === 'locations' && spatialData?.geography === 'location') renderLocations(spatialData); });
el('fit-map').addEventListener('click', () => map.setView([35.14, -89.88], 10));
el<HTMLInputElement>('time-slider').addEventListener('input', event => { stopPlayback(); const row = captures[Number((event.target as HTMLInputElement).value)]; if (row) put('slider-time', time(row.at, true)); });
el<HTMLInputElement>('time-slider').addEventListener('change', event => { const row = captures[Number((event.target as HTMLInputElement).value)]; if (row) { followLatest = false; void selectCapture(row.id); } });
for (const [id, delta] of [['previous', -1], ['next', 1]] as const) el(id).addEventListener('click', () => {
  stopPlayback();
  const index = captures.findIndex(c => c.id === selected?.summary?.id), row = captures[index + delta];
  if (row) { followLatest = false; void selectCapture(row.id); }
});
el<HTMLInputElement>('archive-date').addEventListener('change', async event => {
  stopPlayback();
  const date = (event.target as HTMLInputElement).value; if (!date) return;
  const ticket = ++snapshotRequest; followLatest = false;
  renderSnapshot({ summary: null, detail: { available: false, reason: 'Loading archive date…' } });
  try {
    await loadDay(date);
    if (ticket !== snapshotRequest) return;
    if (captures.length) await selectCapture(captures.at(-1)!.id);
    else renderSnapshot({ summary: null, detail: { available: false, reason: 'No accepted captures on this UTC date. Missing data is unknown.' } });
  } catch (error) { showError((error as Error).message); }
});
document.querySelectorAll<HTMLButtonElement>('[data-metric]').forEach(button => button.addEventListener('click', () => {
  metric = button.dataset.metric as Metric;
  document.querySelectorAll<HTMLButtonElement>('[data-metric]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); renderChart();
}));
document.querySelectorAll<HTMLButtonElement>('[data-days]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.days === 'episode') {
    if (!episode) { chartEpisode = false; openEpisodeForm(); el<HTMLInputElement>('episode-from').focus(); return; }
    chartEpisode = true;
  } else { chartEpisode = false; days = Number(button.dataset.days); }
  syncEpisodeForm(); syncUrl();
  void loadSeries().catch(error => showError(error.message));
}));
// Shared links restore an explicit episode and map view; invalid values are ignored.
function restoreFromUrl(): MapView | null {
  const query = new URLSearchParams(location.search), from = Date.parse(query.get('from') ?? ''), to = Date.parse(query.get('to') ?? '');
  if (Number.isFinite(from) && Number.isFinite(to) && from < to && to - from <= 31 * DAY && to <= Date.now() + 60000) {
    episode = { from, to }; chartEpisode = true; el<HTMLSelectElement>('map-period').value = 'episode';
    el<HTMLInputElement>('episode-from').value = toCentralInput(from); el<HTMLInputElement>('episode-to').value = toCentralInput(to);
    put('episode-status', `Episode: ${describeEpisode(episode)}.`);
  }
  const view = query.get('view');
  return view && ['history', 'percapita', 'locations', 'rainfall'].includes(view) ? view as MapView : null;
}
async function start() {
  const initialView = restoreFromUrl(); syncEpisodeForm();
  try {
    const config = await api<{ tiles: string; attribution: string; attributionUrl: string }>('/api/config');
    if (config.tiles) {
      const attribution = document.createElement('a'); attribution.href = config.attributionUrl; attribution.textContent = config.attribution;
      attribution.target = '_blank'; attribution.rel = 'noopener';
      L.tileLayer(config.tiles, { maxZoom: 18, attribution: attribution.outerHTML }).on('tileerror', () => { tilesFailed = true; mapNotice(); }).addTo(map);
      paired.setTiles(config.tiles, attribution.outerHTML);
    } else { tilesFailed = true; mapNotice(); }
    await refreshHealth(); await Promise.all([selectCapture(), loadSeries()]);
    if (initialView) setMapView(initialView);
  } catch (error) { showError((error as Error).message); }
}
void start(); window.setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
