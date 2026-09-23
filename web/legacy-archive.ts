import L from 'leaflet';
import { Chart, registerables } from 'chart.js';
import type { FeatureCollection } from 'geojson';
import { ggplotMinimalGrid } from './ggplot-theme';
import 'leaflet/dist/leaflet.css';
import './style.css';

Chart.register(...registerables, ggplotMinimalGrid);
Chart.defaults.font.family = 'Arial, Helvetica, sans-serif'; Chart.defaults.font.size = 16; Chart.defaults.color = '#333';
type Capture = { id: string; at: number; capturedAt: string; customers: number; outages: number; gridCaptureKey: string | null };
type Point = { at: number; customers: number | null; outages: number | null; id: string | null; outageId?: string; capturedAt?: string; outageCapturedAt?: string; observations?: number };
type Series = { from: number; to: number; resolution: string; points: Point[]; observedSnapshots: number; gridSnapshots: number; meaning: string; gaps: { from: number; to: number; reason: string }[] };
type Exception = { captureKey: string; storedTime?: string; summary?: { outage_num: string[]; cust_affected: string[] } };
type Catalog = { counts: { totals: number; gridSnapshots: number }; range: { first: string; last: string }; months: { month: string; totals: number; gridSnapshots: number }[];
  gaps: { totals: number; grids: number; largest: { after: string; before: string; secondsBetweenObservations: number } | null };
  coverage: { scope: string; totalObservationsWithoutOriginal: number; emptyEventCaptures: number; blankSavedHeads: Exception[]; rejectedSavedHeads: Exception[]; unmatchedNonempty: Exception[]; missingSavedPages: Exception[] };
  unresolved: { sourceTime: string; customers: number; outages: number }[] };
type Snapshot = { summary: Capture; detail: { available: boolean; reason?: string; capturedAt?: string; geojson?: FeatureCollection };
  sourceTime: string; recovery: { method: string }; originalAvailability: string; provenance: { source: string; firstSourceRow: number }[] };
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const put = (id: string, text: string) => { el(id).textContent = text; };
const number = (n: number) => n.toLocaleString('en-US');
const time = (value: string | number) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(new Date(value));
const option = (text: string, value: string) => { const node = document.createElement('option'); node.textContent = text; node.value = value; return node; };
const monthSelect = el<HTMLSelectElement>('legacy-month'), dateInput = el<HTMLInputElement>('archive-date'), captureSelect = el<HTMLSelectElement>('legacy-capture'), slider = el<HTMLInputElement>('time-slider');
let catalog: Catalog, captures: Capture[] = [], series: Series | null = null, selectedId = '', metric: 'customers' | 'outages' = 'customers';
let dayRequest = 0, snapshotRequest = 0, seriesRequest = 0, playing = false, playTimer = 0, tileFailed = false, notice = 'Select a capture to inspect its grid coverage.';
const map = L.map('map', { preferCanvas: true, scrollWheelZoom: false, zoomAnimation: false, fadeAnimation: false }).setView([35.14, -89.88], 10);
const areas = L.layerGroup().addTo(map);
const showError = (error: unknown) => { put('error-text', error instanceof Error ? error.message : String(error)); el('error').hidden = false; };
const run = (work: Promise<unknown>) => { el('error').hidden = true; void work.catch(showError); };
async function api<T>(path: string): Promise<T> { const response = await fetch(path, { signal: AbortSignal.timeout(15000) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Legacy archive unavailable.'); return data; }
function mapNotice(text: string) { notice = text; const display = notice || (tileFailed ? 'Basemap unavailable. Verified grid areas remain visible.' : ''); put('map-notice', display); el('map-notice').hidden = !display; }
function clearSnapshot(message: string) {
  snapshotRequest++; selectedId = ''; areas.clearLayers(); put('selected-time', message); put('customers', '—'); put('outages', '—');
  mapNotice(message); put('grid-summary', 'Missing geometry is unknown.'); put('capture-note', 'No capture selected.'); put('provenance-note', '');
  el('geojson').removeAttribute('href'); el('geojson').setAttribute('aria-disabled', 'true'); chart.update('none');
}
function replayButtons(index: number) { el<HTMLButtonElement>('previous').disabled = index <= 0; el<HTMLButtonElement>('next').disabled = index < 0 || index >= captures.length - 1; el<HTMLButtonElement>('play').disabled = !playing && !captures.length; }
function renderPlay() {
  el('play').setAttribute('aria-pressed', String(playing)); el('play').setAttribute('aria-label', playing ? 'Pause replay' : 'Play replay');
  el('play-icon').setAttribute('d', playing ? 'M8 5v14M16 5v14' : 'M7 4.5v15l12-7.5z'); replayButtons(captures.findIndex(c => c.id === selectedId));
}
function stopPlayback() { if (!playing) return; playing = false; window.clearTimeout(playTimer); renderPlay(); }
// One capture per step; at the end of a UTC day, continue with the next day that has numeric observations.
async function step() {
  if (!playing) return;
  try {
    const index = captures.findIndex(c => c.id === selectedId), row = captures[index + 1];
    if (row) await loadSnapshot(row.id);
    else {
      const following = new Date(Date.parse(dateInput.value + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
      if (following > dateInput.max) { stopPlayback(); put('day-coverage', 'Replay reached the end of the legacy archive.'); return; }
      const monthChanged = following.slice(0, 7) !== monthSelect.value;
      dateInput.value = following; monthSelect.value = following.slice(0, 7);
      await loadDay(); if (monthChanged) void loadSeries().catch(showError);
      if (!captures.length) { stopPlayback(); put('day-coverage', `No numeric observations on ${following} (UTC). Replay paused; missing history is unknown.`); return; }
    }
    if (playing) playTimer = window.setTimeout(() => void step(), Number(el<HTMLSelectElement>('play-speed').value));
  } catch (error) { stopPlayback(); showError(error); }
}
async function loadSnapshot(id: string) {
  clearSnapshot('Loading capture…'); const request = ++snapshotRequest;
  const data = await api<Snapshot>('/api/legacy/snapshot/' + encodeURIComponent(id)); if (request !== snapshotRequest) return;
  selectedId = data.summary.id; put('selected-time', time(data.summary.capturedAt)); put('customers', number(data.summary.customers)); put('outages', number(data.summary.outages));
  const index = captures.findIndex(c => c.id === id); slider.value = String(Math.max(0, index)); captureSelect.value = id; replayButtons(index);
  put('capture-note', `Stored time: ${data.sourceTime}. Resolved UTC: ${data.summary.capturedAt}. Recovery: ${data.recovery.method}. ${data.originalAvailability}`);
  put('provenance-note', 'Consolidated sources: ' + data.provenance.map(p => `${p.source} (first row ${p.firstSourceRow})`).join('; '));
  if (data.detail.available && data.detail.geojson) {
    L.geoJSON(data.detail.geojson, { style: { color: '#000', weight: 1, fillColor: '#555', fillOpacity: .25 }, onEachFeature(feature, layer) {
      const node = document.createElement('div'), title = document.createElement('strong'), count = document.createElement('p'), note = document.createElement('p');
      title.textContent = `Grid area ${feature.properties?.gridCellId}`; count.textContent = `${number(feature.properties?.customers)} customers affected`;
      note.textContent = 'Geographic area, not an individual outage.'; node.append(title, count, note); layer.bindPopup(node);
    } }).addTo(areas);
    mapNotice(''); put('grid-summary', `${number(data.detail.geojson.features.length)} grid areas · ${time(data.detail.capturedAt!)} · Tap an area for its customer count.`);
    el('geojson').setAttribute('href', '/api/legacy/export.geojson?id=' + id); el('geojson').setAttribute('aria-disabled', 'false');
  } else { mapNotice(data.detail.reason!); put('grid-summary', 'Regional totals only · no verified grid snapshot.'); }
  chart.update('none');
}
async function loadDay(id?: string) {
  const request = ++dayRequest, date = dateInput.value;
  clearSnapshot('Loading archive day…'); captures = []; captureSelect.replaceChildren(option('Loading…', '')); captureSelect.disabled = slider.disabled = true; replayButtons(-1);
  const data = await api<{ snapshots: Capture[] }>('/api/legacy/snapshots?date=' + date); if (request !== dayRequest) return;
  captures = data.snapshots; captureSelect.replaceChildren(...captures.map(c => option(`${time(c.capturedAt)} · ${number(c.customers)} customers${c.gridCaptureKey ? ' · grid' : ' · totals only'}`, c.id)));
  slider.max = String(Math.max(0, captures.length - 1)); slider.value = '0'; captureSelect.disabled = slider.disabled = !captures.length;
  put('day-coverage', `${number(captures.length)} numeric observations · ${number(captures.filter(c => c.gridCaptureKey).length)} verified grid snapshots on this UTC day.`);
  if (!captures.length) { captureSelect.append(option('No numeric observations', '')); clearSnapshot('No numeric observations on this UTC day'); return; }
  await loadSnapshot(captures.find(c => c.id === id)?.id ?? captures[0].id);
}
const chart = new Chart(el<HTMLCanvasElement>('chart'), { type: 'line', data: { datasets: [{ label: 'Customers', data: [] as { x: number; y: number | null }[],
  borderColor: '#000', backgroundColor: '#000', borderWidth: 1, pointRadius: 3, pointHoverRadius: 6, spanGaps: false }] }, options: {
  animation: false, responsive: true, maintainAspectRatio: false, parsing: false, interaction: { mode: 'nearest', intersect: true },
  plugins: { legend: { display: false }, tooltip: { callbacks: { title: items => {
    const p = series?.points[items[0]?.dataIndex]; const at = metric === 'outages' ? p?.outageCapturedAt ?? p?.capturedAt : p?.capturedAt;
    return at ? time(at) : '';
  }, afterLabel: item => series?.resolution === 'daily' ? `${series.points[item.dataIndex].observations} observations in UTC day` : '' } } },
  scales: { x: { type: 'linear', border: { display: false }, grid: { color: '#e5e5e5', drawTicks: false }, ticks: { maxTicksLimit: 5, maxRotation: 0, callback: value => new Intl.DateTimeFormat('en-US', series?.resolution === 'daily'
    ? { timeZone: 'UTC', month: 'short', day: 'numeric' } : { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(Number(value)) } },
    y: { beginAtZero: true, border: { display: false }, grid: { color: '#e5e5e5', drawTicks: false }, ticks: { maxTicksLimit: 6 } } },
  onClick: (_event, active) => { const p = series?.points[active[0]?.index]; const id = metric === 'outages' ? p?.outageId ?? p?.id : p?.id;
    const at = metric === 'outages' ? p?.outageCapturedAt ?? p?.capturedAt : p?.capturedAt;
    if (id && at) { stopPlayback(); dateInput.value = at.slice(0, 10); run(loadDay(id)); }
  }
}, plugins: [{ id: 'legacySelected', afterDraw(chart) {
  const index = series?.points.findIndex(p => (metric === 'outages' ? p.outageId ?? p.id : p.id) === selectedId) ?? -1;
  if (index < 0) return; const x = chart.scales.x.getPixelForValue(series!.points[index].at), ctx = chart.ctx;
  ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.moveTo(x, chart.chartArea.top); ctx.lineTo(x, chart.chartArea.bottom); ctx.stroke(); ctx.restore();
} }] });
function renderChart() {
  if (!series) return;
  chart.data.datasets[0].label = metric === 'customers' ? 'Customers' : 'Outages';
  chart.data.datasets[0].data = series.points.map(p => ({ x: p.at, y: p[metric] })); chart.data.datasets[0].showLine = series.resolution === 'observations';
  chart.options.scales!.x!.min = series.from; chart.options.scales!.x!.max = series.to; chart.update('none');
  el('chart-empty').hidden = series.observedSnapshots > 0;
}
async function loadSeries() {
  const request = ++seriesRequest, daily = el<HTMLSelectElement>('legacy-resolution').value === 'daily';
  let from = new Date(daily ? monthSelect.value + '-01T00:00:00Z' : dateInput.value + 'T00:00:00Z'), to = new Date(from);
  if (daily) to.setUTCMonth(to.getUTCMonth() + 1); else to.setUTCDate(to.getUTCDate() + 1);
  const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), resolution: daily ? 'daily' : 'observations' });
  series = null; chart.data.datasets[0].data = []; chart.update('none'); put('coverage', 'Loading…'); el('csv').setAttribute('aria-disabled', 'true');
  const data = await api<Series>('/api/legacy/series?' + params); if (request !== seriesRequest) return;
  series = data; put('chart-heading', daily ? 'Observed daily peaks' : 'Observed totals'); put('chart-zone', daily ? 'UTC days' : 'Central time');
  put('coverage', `${number(data.observedSnapshots)} observations · ${number(data.gridSnapshots)} grid snapshots`); put('series-note', data.meaning);
  put('gap-summary', `Intervals over one hour intersecting this period: ${data.gaps.filter(g => g.reason.startsWith('Over')).length}. Sampling completeness is unknown.`);
  el('csv').setAttribute('href', '/api/legacy/export.csv?' + params); el('csv').setAttribute('aria-disabled', 'false'); renderChart();
}
async function changeMonth() {
  const month = monthSelect.value;
  // Select the first observed day in the month, without filling empty months.
  await loadSeries(); if (month !== monthSelect.value) return;
  const first = series?.points.find(p => p.id)?.capturedAt; dateInput.value = first?.slice(0, 10) ?? month + '-01';
  await loadDay();
}
function renderCatalog(data: Catalog) {
  catalog = data; monthSelect.replaceChildren(...data.months.map(m => option(`${m.month} · ${number(m.totals)} observations`, m.month)));
  monthSelect.value = data.range.first.slice(0, 7); monthSelect.disabled = false;
  dateInput.min = data.range.first.slice(0, 10); dateInput.max = data.range.last.slice(0, 10); dateInput.value = dateInput.min; dateInput.disabled = false;
  put('archive-summary', `${number(data.counts.totals)} resolved observations · ${number(data.counts.gridSnapshots)} grid snapshots · ${data.range.first.slice(0, 10)} to ${data.range.last.slice(0, 10)} (UTC).`);
  put('exception-summary', `${data.unresolved.length} unresolved time and ${data.coverage.unmatchedNonempty.length} unreconciled original excluded · ${number(data.coverage.emptyEventCaptures)} empty or failed captures have no numeric total.`);
  put('coverage-note', `${data.coverage.scope}. ${number(data.coverage.totalObservationsWithoutOriginal)} consolidated observations have no candidate standalone original in these trees. Original-file availability is distinct from verified numeric coverage. The chart has ${number(data.gaps.totals)} intervals over one hour; the grid archive has ${number(data.gaps.grids)}.`);
  const largest = data.gaps.largest; if (largest) put('largest-gap', `Largest interval between numeric observations: ${(largest.secondsBetweenObservations / 86400).toFixed(1)} days, ${largest.after} to ${largest.before}. This is not outage duration.`);
  put('source-range', `Legacy source ends ${data.range.last}. Current-format collection begins in September 2026; the two periods are displayed separately.`);
  const notes = [ ...data.unresolved.map(r => `Unresolved stored time ${r.sourceTime}: ${r.outages} outages / ${r.customers} customers. No UTC position assigned.`),
    ...data.coverage.unmatchedNonempty.map(r => `Unreconciled original ${r.storedTime ?? r.captureKey}: ${r.summary?.outage_num.join(', ') ?? ''}; ${r.summary?.cust_affected.join(', ') ?? ''}. Excluded from this timeline.`),
    ...data.coverage.blankSavedHeads.map(r => `Blank saved page: ${r.captureKey}.`), ...data.coverage.rejectedSavedHeads.map(r => `Rejected request: ${r.captureKey}.`),
    ...data.coverage.missingSavedPages.map(r => `Missing saved-page counterpart: ${r.captureKey}.`) ];
  el('legacy-exceptions').replaceChildren(...notes.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
}
el('play').addEventListener('click', () => { if (playing) { stopPlayback(); return; } playing = true; renderPlay(); el('error').hidden = true; void step(); });
monthSelect.addEventListener('change', () => { stopPlayback(); el<HTMLSelectElement>('legacy-resolution').value = 'daily'; dayRequest++; snapshotRequest++; run(changeMonth()); });
dateInput.addEventListener('change', () => { stopPlayback(); if (!dateInput.value) return; monthSelect.value = dateInput.value.slice(0, 7); run(Promise.all([loadDay(), loadSeries()])); });
el('legacy-resolution').addEventListener('change', () => run(loadSeries()));
captureSelect.addEventListener('change', () => { stopPlayback(); run(loadSnapshot(captureSelect.value)); });
slider.addEventListener('input', () => { stopPlayback(); const row = captures[Number(slider.value)]; if (row) run(loadSnapshot(row.id)); });
for (const [id, offset] of [['previous', -1], ['next', 1]] as const) el(id).addEventListener('click', () => { stopPlayback(); const row = captures[Number(slider.value) + offset]; if (row) run(loadSnapshot(row.id)); });
document.querySelectorAll<HTMLButtonElement>('[data-metric]').forEach(button => button.addEventListener('click', () => { metric = button.dataset.metric as typeof metric; document.querySelectorAll<HTMLButtonElement>('[data-metric]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); renderChart(); }));
el('fit-map').addEventListener('click', () => map.setView([35.14, -89.88], 10));
el('retry').addEventListener('click', () => { stopPlayback(); run(initialize()); });
async function initialize() { dayRequest++; snapshotRequest++; seriesRequest++; renderCatalog(await api<Catalog>('/api/legacy/catalog')); await changeMonth(); }
void api<{ tiles: string; attribution: string; attributionUrl: string }>('/api/config').then(config => {
  if (!config.tiles) return; const link = document.createElement('a'); link.href = config.attributionUrl; link.textContent = config.attribution; link.target = '_blank'; link.rel = 'noopener noreferrer';
  L.tileLayer(config.tiles, { attribution: link.outerHTML, maxZoom: 18 }).on('tileerror', () => { tileFailed = true; mapNotice(notice); }).addTo(map);
}).catch(() => { tileFailed = true; mapNotice(notice); });
run(initialize());
