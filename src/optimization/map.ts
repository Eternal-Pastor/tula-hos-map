import { jobs } from '../services/engine';
import type { YandexMapHost } from '../components/YandexMap';
import type { OptimizationStore } from './store';
import type { Polygon } from '../types/domain';
import type { GridCell, OptimizationResult } from './types';
import type { MapViewSync } from './map-sync';

export const facilityColor = (id: string) => {
  let hash = 2166136261; for (const c of id) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  const hue = (hash >>> 0) % 360, s = 0.65, l = 0.39;
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12, a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  };
  return '#' + channel(0) + channel(8) + channel(4);
};
export const timeColors = ['#258b57', '#d0b323', '#df8233', '#c94545'];
export const timeBand = (n: number | null | undefined) => n == null ? -1 : n <= 900 ? 0 : n <= 1800 ? 1 : n <= 3600 ? 2 : 3;
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const minutes = (n: number | null | undefined) => n == null ? '—' : Math.round(n / 60) + ' мин';
type Box = [number, number, number, number];
type Shape = { path: Path2D; bounds: Box; geometry: Polygon };
const sharedPaths = new WeakMap<object, WeakMap<Polygon, Shape>>();
export const gainColors = ['#f0e8bf', '#c0e3ce', '#63b58a', '#167248', '#d35f6b'];
export const gainBand = (seconds: number | null | undefined) => seconds == null || Math.abs(seconds) <= 0.01 ? 0 : seconds < 0 ? 4 : seconds <= 300 ? 1 : seconds <= 900 ? 2 : 3;
const overlaps = (a: Box, b: Box) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const contains = (point: number[], polygon: Polygon) => {
  const ringContains = (ring: number[][]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  };
  return ringContains(polygon[0]) && !polygon.slice(1).some(ringContains);
};

/** Two canvas surfaces replace thousands of independently managed map polygons. */
export class OptimizationMap {
  private map: any;
  private pane: any;
  private projection: any;
  private anchor: number[];
  private heat = document.createElement('canvas');
  private borders = document.createElement('canvas');
  private markers: any;
  private paths = new WeakMap<Polygon, Shape>();
  private cellShapes: Shape[] = [];
  private bins = new Map<string, number[]>();
  private indexedCells?: GridCell[];
  private rows = new Map<string, OptimizationResult['solution']['rows'][number]>();
  private result?: OptimizationResult | null;
  private facilities = new Map<string, OptimizationStore['baseline'][number]>();
  private markerSignature = '';
  private token = 0;
  private frame = 0;
  private viewport = '';
  private heatSignature = '';
  private borderSignature = '';
  private hovered = '';
  private observer: ResizeObserver;
  private ready = false;
  private bucket = 0.025;
  private extent: Box = [Infinity, Infinity, -Infinity, -Infinity];
  private detachSync?: () => void;
  private readState = () => {
    const state = this.store.getSnapshot();
    return this.fixedScenario ? { ...state, scenario: this.fixedScenario } : state;
  };

  constructor(private api: any, private host: YandexMapHost, private store: OptimizationStore,
    private sync?: MapViewSync, private fixedScenario?: 'before' | 'after') {
    const camera = sync?.camera;
    this.map = host.create(api, { center: camera?.center || [54.05, 37.4], zoom: camera?.zoom ?? 8, controls: ['zoomControl'] }, { suppressMapOpenBlock: true });
    this.projection = this.map.options.get('projection');
    if (!sharedPaths.has(this.projection)) sharedPaths.set(this.projection, new WeakMap());
    this.paths = sharedPaths.get(this.projection)!;
    this.anchor = this.projection.toGlobalPixels([54, 37], 0);
    this.pane = new api.pane.MovablePane(this.map, { zIndex: 250, margin: 192, overflow: 'visible', css: { pointerEvents: 'none' } });
    this.map.panes.append('optimization-canvas', this.pane);
    for (const canvas of [this.heat, this.borders]) {
      Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none' });
      this.pane.getElement().appendChild(canvas);
    }
    this.markers = new api.GeoObjectCollection(); this.map.geoObjects.add(this.markers);
    this.pane.events.add('clientpixelschange', this.schedule);
    this.pane.events.add('viewportchange', this.schedule);
    this.pane.events.add('actionend', this.schedule);
    this.map.events.add('mousemove', this.hover);
    this.map.events.add('mouseleave', () => { this.hovered = ''; this.map?.hint.close(); });
    this.map.events.add('click', this.click);
    this.observer = new ResizeObserver(() => {
      const element = this.map?.container.getElement();
      if (element?.clientWidth && element.clientHeight) this.map.container.fitToViewport();
      this.viewport = ''; this.schedule();
    });
    this.observer.observe(this.map.container.getElement());
    this.detachSync = sync?.register(this.map);
    if (!camera) this.fit();
  }
  fit = () => { this.sync?.activate(this.map); return this.map?.setBounds([[52.7, 35.8], [54.85, 38.6]], { checkZoomRange: true, zoomMargin: 35 }); };
  resize = () => { this.map?.container.fitToViewport(); this.viewport = ''; this.schedule(); };
  private schedule = () => {
    if (!this.map || !this.ready || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; if (this.map) this.paint(); });
  };
  private shape(geometry: Polygon): Shape {
    const known = this.paths.get(geometry); if (known) return known;
    const path = new Path2D(), bounds: Box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ring of geometry) {
      ring.forEach(([lon, lat], i) => {
        const point = this.projection.toGlobalPixels([lat, lon], 0), x = point[0] - this.anchor[0], y = point[1] - this.anchor[1];
        bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y); bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
        if (i) path.lineTo(x, y); else path.moveTo(x, y);
      });
      path.closePath();
    }
    const result = { path, bounds, geometry }; this.paths.set(geometry, result); return result;
  }
  private eachBin(box: Box, visit: (key: string) => void) {
    for (let x = Math.floor(box[0] / this.bucket); x <= Math.floor(box[2] / this.bucket); x++)
      for (let y = Math.floor(box[1] / this.bucket); y <= Math.floor(box[3] / this.bucket); y++) visit(x + ':' + y);
  }
  private visibleCells(box: Box) {
    const found = new Set<number>();
    const clipped: Box = [Math.max(box[0], this.extent[0]), Math.max(box[1], this.extent[1]), Math.min(box[2], this.extent[2]), Math.min(box[3], this.extent[3])];
    if (clipped[0] > clipped[2] || clipped[1] > clipped[3]) return found;
    this.eachBin(clipped, key => { for (const i of this.bins.get(key) || []) if (overlaps(this.cellShapes[i].bounds, box)) found.add(i); });
    return found;
  }
  async draw() {
    const token = ++this.token, state = this.readState();
    const cancelled = () => token !== this.token || !this.map;
    if (this.indexedCells !== this.store.cells) {
      this.ready = false; this.cellShapes = []; this.bins.clear(); this.extent = [Infinity, Infinity, -Infinity, -Infinity];
      await jobs.chunks(this.store.cells, cell => {
        const index = this.cellShapes.length, shape = this.shape(cell.geometry); this.cellShapes.push(shape);
        this.extent[0] = Math.min(this.extent[0], shape.bounds[0]); this.extent[1] = Math.min(this.extent[1], shape.bounds[1]);
        this.extent[2] = Math.max(this.extent[2], shape.bounds[2]); this.extent[3] = Math.max(this.extent[3], shape.bounds[3]);
        this.eachBin(shape.bounds, key => { const bin = this.bins.get(key) || []; bin.push(index); this.bins.set(key, bin); });
      }, { budget: 5, cancelled });
      if (cancelled()) return;
      this.indexedCells = this.store.cells;
    }
    if (this.result !== state.result) {
      this.rows = new Map(state.result?.solution.rows.map(r => [r.cellId, r]) || []);
      this.result = state.result; this.heatSignature = ''; this.borderSignature = '';
      const geometries = [...(state.result?.display?.before || []).map(f => f.geometry), ...(state.result?.display?.after || []).map(f => f.geometry),
        ...this.store.zones.flatMap(([, parts]) => parts), ...(state.result?.zones || []).flatMap(([, parts]) => parts)];
      await jobs.chunks(geometries, geometry => { this.shape(geometry); }, { budget: 5, cancelled });
      if (cancelled()) return;
    }
    this.facilities = new Map([...this.store.baseline, ...state.facilities].map(f => [f.id, f]));
    const visible = state.scenario === 'after' ? state.facilities.filter(f => f.confirmed) : this.store.baseline;
    const signature = visible.map(f => f.id + ':' + f.coords?.join(',')).join('|');
    if (signature !== this.markerSignature) {
      this.markers.removeAll();
      for (const f of visible) if (f.coords) this.markers.add(new this.api.Placemark(f.coords,
        { hintContent: escape(f.name), balloonContent: escape(f.organization + '. ' + f.name + '. ' + f.address) },
        { preset: 'islands#circleDotIcon', iconColor: facilityColor(f.id), zIndex: 500 }));
      this.markerSignature = signature;
    }
    this.ready = true; this.schedule();
  }
  private paint() {
    const state = this.readState(), paneView = this.pane.getViewport();
    const left = Math.floor(paneView[0][0]), top = Math.floor(paneView[0][1]);
    const width = Math.ceil(paneView[1][0] - left), height = Math.ceil(paneView[1][1] - top);
    if (!width || !height) return;
    // Use the moving pane's own zoom and coordinate system throughout an animation.
    const zoom = this.pane.getZoom(), scale = 2 ** zoom, anchor = this.pane.toClientPixels(this.projection.toGlobalPixels([54, 37], zoom));
    const origin = [anchor[0] - left, anchor[1] - top];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = [left, top, width, height, zoom, origin[0], origin[1], dpr].join(':');
    const moved = viewport !== this.viewport; this.viewport = viewport;
    const box: Box = [-origin[0] / scale, -origin[1] / scale, (width - origin[0]) / scale, (height - origin[1]) / scale];
    const setup = (canvas: HTMLCanvasElement) => {
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
        canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
      }
      canvas.style.left = left + 'px'; canvas.style.top = top + 'px';
      const context = canvas.getContext('2d')!;
      context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * origin[0], dpr * origin[1]); return context;
    };
    this.heat.style.opacity = String(state.opacity);
    this.heat.style.display = state.showTimes && state.result ? '' : 'none';
    this.borders.style.display = state.showZones ? '' : 'none';
    const heatSignature = state.scenario + ':' + state.showTimes + ':' + state.theme;
    if (moved || heatSignature !== this.heatSignature) {
      this.heatSignature = heatSignature;
      const context = setup(this.heat);
      if (state.showTimes && state.result) {
        const gains = state.theme === 'gain';
        const overview = !gains && zoom < 11 && state.result.display?.[state.scenario];
        const colors = gains ? gainColors : timeColors, bands = colors.map(() => new Path2D());
        if (overview) {
          for (const feature of overview) {
            const shape = this.shape(feature.geometry);
            if (feature.band >= 0 && feature.band < 4 && overlaps(shape.bounds, box)) bands[feature.band].addPath(shape.path);
          }
        } else for (const index of this.visibleCells(box)) {
          const row = this.rows.get(this.store.cells[index].id), band = gains ? gainBand(row?.deltaSeconds) : timeBand(state.scenario === 'after' ? row?.afterSeconds : row?.beforeSeconds);
          if (band >= 0) bands[band].addPath(this.cellShapes[index].path);
        }
        bands.forEach((path, band) => { context.fillStyle = colors[band]; context.fill(path, 'evenodd'); });
      }
    }
    const borderSignature = [state.scenario, state.showTimes, state.showZones, state.compareBoundaries].join(':');
    if (moved || borderSignature !== this.borderSignature) {
      this.borderSignature = borderSignature;
      const context = setup(this.borders);
      const paintZones = (zones: [string, Polygon[]][], reference = false) => {
        context.lineWidth = (reference ? 1.25 : 2.25) / scale;
        context.setLineDash(reference ? [6 / scale, 4 / scale] : []);
        for (const [id, polygons] of zones) {
          context.strokeStyle = reference ? '#333333' : facilityColor(id); context.fillStyle = facilityColor(id);
          for (const polygon of polygons) {
            const shape = this.shape(polygon); if (!overlaps(shape.bounds, box)) continue;
            if (!state.showTimes && !reference) { context.globalAlpha = 0.15; context.fill(shape.path, 'evenodd'); context.globalAlpha = 1; }
            context.stroke(shape.path);
          }
        }
      };
      if (state.showZones) {
        paintZones(state.scenario === 'after' ? state.result?.zones || [] : this.store.zones);
        if (state.scenario === 'after' && state.compareBoundaries) paintZones(this.store.zones, true);
      }
    }
  }
  private cellAt(coords: number[]) {
    const p = this.projection.toGlobalPixels(coords, 0), x = p[0] - this.anchor[0], y = p[1] - this.anchor[1];
    for (const index of this.visibleCells([x, y, x, y])) if (contains([coords[1], coords[0]], this.store.cells[index].geometry)) return this.store.cells[index];
    return null;
  }
  private label(cell: GridCell) {
    const state = this.readState(), row = this.rows.get(cell.id), after = state.scenario === 'after';
    const id = after ? row?.afterId : cell.organizationId, facility = id ? this.facilities.get(id) : null;
    return { facility, row, title: `${facility?.name || ''} — ${minutes(after ? row?.afterSeconds : row?.beforeSeconds)}` };
  }
  private hover = (event: any) => {
    if (!this.ready) return;
    const coords = event.get('coords'); if (!coords) return;
    const cell = this.cellAt(coords);
    if (!cell) { this.hovered = ''; this.map.hint.close(); return; }
    const key = cell.id + ':' + this.readState().scenario;
    if (key === this.hovered) return;
    this.hovered = key; this.map.hint.open(coords, escape(this.label(cell).title));
  };
  private click = (event: any) => {
    if (!this.ready || event.get('target') !== this.map) return;
    const coords = event.get('coords'), cell = coords && this.cellAt(coords); if (!cell) return;
    const { facility, row, title } = this.label(cell);
    const before = row?.beforeId ? this.facilities.get(row.beforeId)?.name : '', after = row?.afterId ? this.facilities.get(row.afterId)?.name : '';
    const change = row?.deltaSeconds == null ? '' : row.deltaSeconds > 0.01 ? `Быстрее на ${minutes(row.deltaSeconds)}` : row.deltaSeconds < -0.01 ? `Дольше на ${minutes(-row.deltaSeconds)}` : 'Время не изменилось';
    this.map.balloon.open(coords, { contentHeader: 'Изменение для выбранной ячейки', contentBody:
      `<div class="opt-cell-card"><p><strong>До:</strong> ${escape(before || '')}<br>${escape(minutes(row?.beforeSeconds))}</p><p><strong>После:</strong> ${escape(after || '')}<br>${escape(minutes(row?.afterSeconds))}</p><strong>${escape(change)}</strong></div>` });
  };
  dispose() {
    this.token++; this.ready = false; if (this.frame) cancelAnimationFrame(this.frame);
    this.detachSync?.(); this.observer.disconnect(); this.host.destroy(); this.map = null;
  }
}
