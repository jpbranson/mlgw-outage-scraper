import L from 'leaflet';

type HeatPoint = { center: [number, number]; events: number };
const METRES_PER_DEGREE = 111195, X_SCALE = METRES_PER_DEGREE * Math.cos(35.15 * Math.PI / 180);
const SIGMA = 750, RADIUS = SIGMA * 3;

// Fixed geographic smoothing and a period-wide scale: panning does not renormalize density.
export class HistoryHeatmap extends L.Layer {
  private canvas = document.createElement('canvas');
  private owner: L.Map | null = null;
  private maximum: number;
  constructor(private points: HeatPoint[]) {
    super();
    this.canvas.className = 'history-heatmap';
    this.canvas.setAttribute('aria-hidden', 'true');
    const density = new Map<string, number>(), step = 250;
    for (const point of points) {
      const x = (point.center[0] + 90) * X_SCALE, y = (point.center[1] - 35.15) * METRES_PER_DEGREE;
      for (let gx = Math.floor((x - RADIUS) / step); gx <= Math.ceil((x + RADIUS) / step); gx++)
        for (let gy = Math.floor((y - RADIUS) / step); gy <= Math.ceil((y + RADIUS) / step); gy++) {
          const d2 = (gx * step - x) ** 2 + (gy * step - y) ** 2;
          if (d2 > RADIUS ** 2) continue;
          const key = `${gx}:${gy}`;
          density.set(key, (density.get(key) ?? 0) + point.events * Math.exp(-d2 / (2 * SIGMA ** 2)));
        }
    }
    this.maximum = 1;
    for (const value of density.values()) this.maximum = Math.max(this.maximum, value);
  }
  onAdd(map: L.Map): this { this.owner = map; map.getPane('overlayPane')!.append(this.canvas); this.draw(); return this; }
  onRemove(): this { this.canvas.remove(); this.owner = null; return this; }
  getEvents() { return { moveend: this.draw, zoomend: this.draw, resize: this.draw }; }
  private draw = () => {
    const map = this.owner; if (!map) return;
    const size = map.getSize(), scale = 3, width = Math.ceil(size.x / scale), height = Math.ceil(size.y / scale);
    this.canvas.width = width; this.canvas.height = height;
    this.canvas.style.width = `${size.x}px`; this.canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(this.canvas, map.containerPointToLayerPoint([0, 0]));
    const centre = map.getCenter(), origin = map.latLngToContainerPoint(centre);
    const sigma = Math.max(.5, Math.abs(map.latLngToContainerPoint([centre.lat + SIGMA / METRES_PER_DEGREE, centre.lng]).y - origin.y) / scale);
    const radius = sigma * 3, values = new Float32Array(width * height);
    for (const point of this.points) {
      const p = map.latLngToContainerPoint([point.center[1], point.center[0]]), cx = p.x / scale, cy = p.y / scale;
      for (let y = Math.max(0, Math.floor(cy - radius)); y < Math.min(height, Math.ceil(cy + radius)); y++)
        for (let x = Math.max(0, Math.floor(cx - radius)); x < Math.min(width, Math.ceil(cx + radius)); x++) {
          const d2 = (x + .5 - cx) ** 2 + (y + .5 - cy) ** 2;
          if (d2 <= radius ** 2) values[y * width + x] += point.events * Math.exp(-d2 / (2 * sigma ** 2));
        }
    }
    const ctx = this.canvas.getContext('2d')!, frame = ctx.createImageData(width, height);
    const stops = [[222, 235, 247], [107, 174, 214], [33, 113, 181], [8, 48, 107]];
    for (let i = 0; i < values.length; i++) {
      const relative = Math.min(1, values[i] / this.maximum); if (relative < .001) continue;
      const t = Math.sqrt(relative); // Keep isolated reported locations visible beside dense clusters.
      const position = t * 3, lo = Math.min(2, Math.floor(position)), blend = position - lo;
      for (let c = 0; c < 3; c++) frame.data[i * 4 + c] = stops[lo][c] * (1 - blend) + stops[lo + 1][c] * blend;
      frame.data[i * 4 + 3] = Math.round(225 * Math.min(1, t * 5));
    }
    ctx.putImageData(frame, 0, 0);
  };
}
