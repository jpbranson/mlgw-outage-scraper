import L from 'leaflet';
import { HistoryHeatmap } from './heatmap';
import { api } from './api';
import type { SpatialCell, SpatialHistory } from './api-types';
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const put = (id: string, value: string) => { el(id).textContent = value; };
const fmt = new Intl.NumberFormat('en-US');
const day = (at: number) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' }).format(at);

// Current-feed outage density beside the rainfall map for the same interval. The
// outage side never draws weather, and missing outage history is never shown as zero.
export class PairedOutageMap {
  private map: L.Map | null = null;
  private layer = L.layerGroup();
  private ticket = 0;
  private syncing = false;
  private tiles: { url: string; attribution: string } | null = null;
  constructor(private main: L.Map, private popup: (cell: SpatialCell) => HTMLElement) {
    main.on('move', () => this.follow(main, this.map));
  }
  private linked() { return Boolean(this.map) && !el('outage-map-figure').hidden && el<HTMLInputElement>('link-maps').checked; }
  private follow(source: L.Map, target: L.Map | null) {
    if (!target || this.syncing || !this.linked()) return;
    this.syncing = true;
    try { target.setView(source.getCenter(), source.getZoom(), { animate: false }); } finally { this.syncing = false; }
  }
  setTiles(url: string, attribution: string) {
    this.tiles = { url, attribution };
    if (this.map) L.tileLayer(url, { maxZoom: 18, attribution }).addTo(this.map);
  }
  private notice(message: string) { put('outage-map-notice', message); el('outage-map-notice').hidden = !message; }
  show(active: boolean) {
    this.ticket++; this.layer.clearLayers(); this.notice('');
    el('outage-map-figure').hidden = el('rain-map-caption').hidden = el('outage-map-status').hidden = !active;
    el('map-pair').classList.toggle('paired', active);
    if (active && !this.map) {
      this.map = L.map('outage-map', { preferCanvas: true, scrollWheelZoom: false, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false });
      this.map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
      this.map.setView(this.main.getCenter(), this.main.getZoom(), { animate: false });
      if (this.tiles) L.tileLayer(this.tiles.url, { maxZoom: 18, attribution: this.tiles.attribution }).addTo(this.map);
      this.layer.addTo(this.map);
      this.map.on('move', () => this.follow(this.map!, this.main));
    }
    // Both containers change width when the pair opens or closes.
    requestAnimationFrame(() => {
      this.main.invalidateSize({ animate: false });
      if (active && this.map) { this.map.invalidateSize({ animate: false }); this.map.setView(this.main.getCenter(), this.main.getZoom(), { animate: false }); }
    });
  }
  async load(range: { from: string; to: string } | null, firstCaptureAt: string | null) {
    const ticket = ++this.ticket; this.layer.clearLayers();
    const status = el('outage-map-status'); status.replaceChildren();
    if (!range) { this.notice('Select a rainfall period.'); return; }
    const from = Date.parse(range.from), to = Math.min(Date.parse(range.to), Date.now()), first = firstCaptureAt ? Date.parse(firstCaptureAt) : NaN;
    if (!Number.isFinite(first) || to <= first) {
      this.notice(`No current-feed outage captures in this period.${Number.isFinite(first) ? ` Collection begins ${day(first)}.` : ''}`);
      const link = document.createElement('a'); link.href = '/legacy.html?view=comparisons'; link.textContent = 'Weather comparisons';
      status.append('Missing outage history is unknown, not zero. Regional legacy totals for prepared storms are on the ', link, ' page.');
      return;
    }
    this.notice('Loading outage locations for this period…');
    try {
      const params = new URLSearchParams({ view: 'spatial', from: new Date(from).toISOString(), to: new Date(to).toISOString() });
      const data = await api<SpatialHistory>(`/api/series?${params}`);
      if (ticket !== this.ticket) return;
      new HistoryHeatmap(data.cells.filter(c => c.center && c.events).map(c => ({ center: c.center!, events: c.events! }))).addTo(this.layer);
      for (const cell of data.cells) if (cell.center) L.circleMarker([cell.center[1], cell.center[0]], { radius: 14, stroke: false, fillOpacity: 0 })
        .bindPopup(this.popup(cell), { maxHeight: 240, maxWidth: 280, autoPanPadding: [16, 16] }).addTo(this.layer);
      status.append(`Right map: ${fmt.format(data.mappedEvents)} reported events in ${fmt.format(data.verifiedCaptures)} verified captures · ${(data.coverage * 100).toFixed(1)}% time coverage.` +
        `${from < first ? ` Collection began ${day(first)}, part-way through this period.` : ''} Color is relative density within this period, as in the Heatmap view. Shared locations with rain do not establish a cause.`);
      this.notice(!data.captures ? 'No captures in this period.' : !data.verifiedCaptures ? 'Archived map detail is unavailable for this period.' :
        !data.cells.length ? 'No mapped outages in the verified captures.' : data.coverage < .9 ? `${Math.round(data.coverage * 100)}% time coverage; missing history is unknown.` : '');
    } catch (error) {
      if (ticket === this.ticket) this.notice((error as Error).message);
    }
  }
}
