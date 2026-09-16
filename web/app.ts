import L from 'leaflet';
import { Chart, registerables } from 'chart.js';
import 'leaflet/dist/leaflet.css';
import './style.css';

Chart.register(...registerables);
Chart.defaults.font.family = 'Inter, "Segoe UI", Arial, sans-serif';
Chart.defaults.font.size = 16;
Chart.defaults.color = '#5c6d63';
type Metric = 'customers' | 'outages';
type Capture = { id: string; at: number; capturedAt: string; customers: number; outages: number };
type SourceTime = { utc: string | null; raw: string | null; status: string };
type Feature = { type: 'Feature'; id: string; geometry: { type: 'Point'; coordinates: [number, number] } | null;
  properties: { customers: number; status: string | null; started: SourceTime; estimatedRepair: SourceTime } };
type Snapshot = { summary: (Capture & { change: number | null; previousAt: string | null; dailyPeak: number; peakDay: string;
  dailyPeakAt: string; sharpRise: boolean; highBaseline: boolean; baseline: { enabled: boolean; coverage: number; explanation: string; threshold: number | null } }) | null;
  detail: { available: boolean; reason?: string; geojson?: { features: Feature[] }; unmapped?: number; flags?: string[];
    longRunning?: { id: string; customers: number; startedAt: string; hours: number }[]; unknownStartTimes?: number } };
type Health = { status: string; ageMinutes: number | null; latest: Capture | null; firstCaptureAt: string | null; lastAttemptOutcome: string | null };
type Point = { at: number; id: string | null; outageId?: string; customers: number | null; outages: number | null;
  capturedAt?: string; outageCapturedAt?: string; coverage?: number | null };
type Series = { from: number; to: number; resolution: string; points: Point[]; coverage: number; observedSnapshots: number; firstCaptureAt: string | null;
  meaning: string; anomalies: { id: string; at: number; explanation: string }[]; quality: { outcome: string; count: number }[]; gaps: { from: number; to: number }[] };
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const put = (id: string, value: string) => { el(id).textContent = value; };
const fmt = new Intl.NumberFormat('en-US');
const time = (value: string | number, date = false) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago',
  ...(date ? { month: 'short', day: 'numeric' } as const : {}), hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value));
const chartTime = (value: number) => days === 30 ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(value) :
  days === 7 ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric' }).format(value) :
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(value);
const dayOf = (value: string) => value.slice(0, 10);
let selected: Snapshot | null = null, health: Health | null = null, captures: Capture[] = [], series: Series | null = null;
let followLatest = true, metric: Metric = 'customers', days = 1, snapshotRequest = 0, seriesRequest = 0, dayRequest = 0;
let activeParams = '', tilesFailed = false;
const map = L.map('map', { preferCanvas: true, scrollWheelZoom: false }).setView([35.14, -89.88], 10);
const pointsLayer = L.layerGroup().addTo(map);
const markers = new Map<string, L.CircleMarker>();
const showError = (message: string) => { put('error-text', message); el('error').hidden = false; };
const clearError = () => { el('error').hidden = true; };
async function api<T>(path: string): Promise<T> {
  const response = await fetch(path, { signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Unable to read the local archive.');
  return data as T;
}
function mapNotice(message = '') {
  const content = message || (tilesFailed ? 'Basemap unavailable. Reported outage points remain visible.' : '');
  put('map-notice', content); el('map-notice').hidden = !content;
}
function sourceTime(value: SourceTime) {
  return value.utc ? time(value.utc, true) : value.status === 'ambiguous' ? `${value.raw ?? ''} (ambiguous Central time)` : 'Unavailable';
}
function popup(feature: Feature): HTMLElement {
  const node = document.createElement('div'); node.className = 'outage-popup';
  const title = document.createElement('strong'); title.textContent = `Outage ${feature.id}`; node.append(title);
  const entries = [['Customers', fmt.format(feature.properties.customers)], ['Started', sourceTime(feature.properties.started)],
    ['Status', feature.properties.status || 'Unavailable'], ['Repair estimate', sourceTime(feature.properties.estimatedRepair)]];
  for (const [label, value] of entries) { const p = document.createElement('p'), b = document.createElement('b'); b.textContent = `${label}: `; p.append(b, document.createTextNode(value)); node.append(p); }
  const note = document.createElement('small'); note.textContent = 'Approximate location · Times assume Central'; node.append(note);
  return node;
}
function renderMap(data: Snapshot) {
  pointsLayer.clearLayers(); markers.clear();
  if (!data.detail.available) { mapNotice(data.detail.reason); return; }
  for (const feature of data.detail.geojson?.features ?? []) {
    if (!feature.geometry) continue;
    const [lng, lat] = feature.geometry.coordinates;
    const marker = L.circleMarker([lat, lng], { radius: Math.max(5, Math.min(30, 4 + Math.sqrt(feature.properties.customers) * .85)),
      color: '#9b4a28', weight: 1.3, fillColor: '#cd7749', fillOpacity: .66 }).bindPopup(popup(feature), { maxHeight: 240, maxWidth: 280, autoPanPadding: [16, 16] });
    marker.addTo(pointsLayer); markers.set(feature.id, marker);
  }
  mapNotice(data.detail.geojson?.features.length === 0 ? 'This accepted capture reports zero outages.' :
    data.detail.unmapped ? `${data.detail.unmapped} reported events have no usable map location.` : '');
}
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
    button.style.setProperty('--duration-width', `${Math.min(100, row.hours / Math.max(6, ...rows.map(r => r.hours)) * 100)}%`);
    const name = document.createElement('span'); name.textContent = `#${row.id}`;
    const detail = document.createElement('small'); detail.textContent = `${fmt.format(row.customers)} customers`;
    const duration = document.createElement('b'); duration.textContent = `${row.hours.toFixed(1)}h`;
    name.append(detail); button.append(name, duration); button.addEventListener('click', () => {
      const marker = markers.get(row.id); if (marker) { map.setView(marker.getLatLng(), 12, { animate: false }); marker.openPopup(); el('map').scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    }); list.append(button);
  }
  put('long-note', `${rows.length > 5 ? 'Five longest shown. ' : ''}Duration at selected capture, from source start time.${data.detail.unknownStartTimes ? ` ${data.detail.unknownStartTimes} start times unavailable or ambiguous.` : ''}`);
}
function renderSnapshot(data: Snapshot) {
  selected = data;
  const s = data.summary;
  put('selection-mode', followLatest ? 'Latest capture' : 'Historical capture');
  el('selection-mode').dataset.historical = String(!followLatest);
  put('selected-time', s ? time(s.capturedAt, true) : 'No accepted capture');
  put('selected-note', s ? `Retrieved ${new Date(s.at).toISOString().replace('.000', '')} · current GeoJSON format` : 'Choose another archive date or return to latest.');
  put('customers', s ? fmt.format(s.customers) : '—'); put('outages', s ? fmt.format(s.outages) : '—');
  put('change', s?.change != null ? `${s.change > 0 ? '+' : ''}${fmt.format(s.change)}` : '—');
  el('change').dataset.direction = s?.change == null || s.change === 0 ? 'flat' : s.change > 0 ? 'up' : 'down';
  put('change-note', s?.previousAt ? `Since ${time(s.previousAt)}` : 'No comparable prior capture');
  put('peak', s ? fmt.format(s.dailyPeak) : '—'); put('peak-note', s ? `${s.peakDay} UTC · through selection` : 'Observed through selected capture');
  renderMap(data); renderNotes(data); syncSlider();
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
    if (data.summary) await loadDay(dayOf(data.summary.capturedAt));
    if (ticket !== snapshotRequest) return;
    renderSnapshot(data);
  } catch (error) {
    if (ticket !== snapshotRequest) return;
    renderSnapshot({ summary: null, detail: { available: false, reason: 'Unable to load the selected capture. Retry or choose another date.' } });
    showError((error as Error).message);
  }
}
const chart = new Chart(el<HTMLCanvasElement>('chart'), {
  type: 'line', data: { datasets: [{ label: 'Affected customers', data: [] as { x: number; y: number | null }[], borderColor: '#b76035',
    backgroundColor: '#ca774a', borderWidth: 2, pointRadius: 3, pointHoverRadius: 6, pointHitRadius: 12, tension: 0, spanGaps: false }] },
  options: { responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
    onResize: (chart, size) => { chart.options.scales!.x!.ticks!.maxTicksLimit = size.width < 450 ? 3 : 5; },
    scales: { x: { type: 'linear', grid: { display: false }, ticks: { maxTicksLimit: 5, maxRotation: 0, font: { size: 16 }, color: '#5c6d63', callback: value => chartTime(Number(value)) } },
      y: { beginAtZero: true, grid: { color: '#e8ebe5' }, ticks: { precision: 0, maxTicksLimit: 6, font: { size: 16 }, color: '#5c6d63' } } },
    plugins: { legend: { display: false }, tooltip: { titleFont: { size: 16 }, bodyFont: { size: 16 }, footerFont: { size: 16 }, padding: 12, callbacks: {
      title: items => { const p = series?.points[items[0]?.dataIndex]; return p ? series?.resolution === 'daily' ? `UTC day: ${new Date(p.at).toISOString().slice(0, 10)}` : time(p.at, true) : ''; },
      afterBody: items => { const p = series?.points[items[0]?.dataIndex]; return p && series?.resolution !== '5m' ? ['Observed bucket peak', `${Math.round((p.coverage ?? 0) * 100)}% time coverage`, time(metric === 'outages' ? p.outageCapturedAt! : p.capturedAt!, true), 'Tap to view map'] : ['Tap to view map']; }
    } } },
    onClick: (_event, elements) => {
      const p = series?.points[elements[0]?.index]; const id = metric === 'outages' ? p?.outageId ?? p?.id : p?.id;
      if (id) { followLatest = false; void selectCapture(id); }
    }
  },
  plugins: [{ id: 'selected-capture', afterDraw(chart) {
    const s = selected?.summary; if (!s) return;
    const x = chart.scales.x.getPixelForValue(s.at); if (x < chart.chartArea.left || x > chart.chartArea.right) return;
    const ctx = chart.ctx; ctx.save(); ctx.strokeStyle = '#204c43'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x, chart.chartArea.top); ctx.lineTo(x, chart.chartArea.bottom); ctx.stroke(); ctx.restore();
  } }]
});
void document.fonts.ready.then(() => chart.update('none'));
function renderChart() {
  if (!series) return;
  const ds = chart.data.datasets[0]; ds.data = series.points.map(p => ({ x: p.at, y: p[metric] }));
  ds.label = metric === 'customers' ? 'Affected customers' : 'Reported outages';
  const anomalyIds = new Set(series.anomalies.map(a => a.id));
  const marked = (index: number) => { const p = series?.points[index], id = metric === 'outages' ? p?.outageId ?? p?.id : p?.id; return Boolean(id && anomalyIds.has(id)); };
  ds.pointRadius = context => marked(context.dataIndex) ? 6 : 3;
  ds.pointBackgroundColor = context => marked(context.dataIndex) ? '#9a352a' : '#ca774a';
  ds.segment = { borderColor: context => series?.resolution !== '5m' &&
    ((series?.points[context.p0DataIndex]?.coverage ?? 0) < .9999 || (series?.points[context.p1DataIndex]?.coverage ?? 0) < .9999) ? 'transparent' : '#b76035' };
  const x = chart.options.scales!.x!;
  x.min = series.resolution === '5m' ? (series.points[0]?.at ?? series.from) - 60000 : series.from;
  x.max = series.resolution === '5m' ? (series.points.at(-1)?.at ?? series.to) + 60000 : series.to;
  chart.update(); el('chart-empty').hidden = series.observedSnapshots > 0;
  put('chart-zone', days === 30 ? 'UTC days' : 'Central time');
  put('series-label', series.resolution === '5m' ? 'Captured totals' : series.resolution === 'hourly' ? 'Hourly peaks' : 'Daily peaks');
  put('series-note', `${series.meaning} Select a point to view its map. Larger red dots mark sharp increases.`);
  put('coverage', `${(series.coverage * 100).toFixed(1)}% time coverage`);
  el<HTMLProgressElement>('coverage-meter').value = series.coverage;
  put('quality-note', `${fmt.format(series.observedSnapshots)} accepted captures in the requested period. ${series.firstCaptureAt ? `Available history in this window begins ${time(series.firstCaptureAt, true)}. ` : ''}Missing observations are unknown. ${series.quality.length ? series.quality.map(q => `${q.count} ${q.outcome} attempts`).join(' · ') + '. ' : ''}Dashed green line: selected capture.`);
  el<HTMLAnchorElement>('csv').href = `/api/export.csv?${activeParams}`;
}
async function loadSeries() {
  const ticket = ++seriesRequest, to = Date.now();
  const params = new URLSearchParams({ from: new Date(to - days * 86400000).toISOString(), to: new Date(to).toISOString(), resolution: days === 1 ? '5m' : days === 7 ? 'hourly' : 'daily' }).toString();
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
  try { await refreshHealth(); await loadSeries(); if (followLatest && health?.latest?.id !== selected?.summary?.id) await selectCapture(); }
  catch (error) { el('freshness').dataset.status = 'stale'; put('freshness-label', 'Local archive connection lost'); showError((error as Error).message); }
}
el('latest').addEventListener('click', () => { followLatest = true; void selectCapture(); });
el('retry').addEventListener('click', () => { clearError(); void refresh(); if (!followLatest) void selectCapture(captures[Number(el<HTMLInputElement>('time-slider').value)]?.id); });
el('fit-map').addEventListener('click', () => map.setView([35.14, -89.88], 10));
el<HTMLInputElement>('time-slider').addEventListener('input', event => { const row = captures[Number((event.target as HTMLInputElement).value)]; if (row) put('slider-time', time(row.at, true)); });
el<HTMLInputElement>('time-slider').addEventListener('change', event => { const row = captures[Number((event.target as HTMLInputElement).value)]; if (row) { followLatest = false; void selectCapture(row.id); } });
for (const [id, delta] of [['previous', -1], ['next', 1]] as const) el(id).addEventListener('click', () => {
  const index = captures.findIndex(c => c.id === selected?.summary?.id), row = captures[index + delta];
  if (row) { followLatest = false; void selectCapture(row.id); }
});
el<HTMLInputElement>('archive-date').addEventListener('change', async event => {
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
  days = Number(button.dataset.days);
  document.querySelectorAll<HTMLButtonElement>('[data-days]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  void loadSeries().catch(error => showError(error.message));
}));
async function start() {
  try {
    const config = await api<{ tiles: string; attribution: string; attributionUrl: string }>('/api/config');
    if (config.tiles) {
      const attribution = document.createElement('a'); attribution.href = config.attributionUrl; attribution.textContent = config.attribution;
      attribution.target = '_blank'; attribution.rel = 'noopener';
      L.tileLayer(config.tiles, { maxZoom: 18, attribution: attribution.outerHTML }).on('tileerror', () => { tilesFailed = true; mapNotice(); }).addTo(map);
    } else { tilesFailed = true; mapNotice(); }
    await refreshHealth(); await Promise.all([selectCapture(), loadSeries()]);
  } catch (error) { showError((error as Error).message); }
}
void start(); window.setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
