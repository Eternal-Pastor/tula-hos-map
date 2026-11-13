import { jobs } from '../services/engine';
import type { YandexMapHost } from '../components/YandexMap';
import type { OptimizationStore } from './store';
import type { Polygon } from '../types/domain';
export const facilityColor = (id: string) => {
  let hash = 2166136261; for (const c of id) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  const hue = (hash >>> 0) % 360, s = 0.65, l = 0.39;
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12, a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  };
  return '#' + channel(0) + channel(8) + channel(4);
};
export const timeColors = ['#258b57', '#d0b323', '#df8233', '#c94545', '#929ba2'];
export const timeBand = (n: number | null | undefined) => n == null ? 4 : n <= 900 ? 0 : n <= 1800 ? 1 : n <= 3600 ? 2 : 3;
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const minutes = (n: number | null | undefined) => n == null ? 'нет маршрута' : Math.round(n / 60) + ' мин';
export class OptimizationMap {
  private map: any;
  private heat: any;
  private outlines: any;
  private markers: any;
  private token = 0;
  constructor(private api: any, private host: YandexMapHost, private store: OptimizationStore) {
    this.map = host.create(api, { center: [54.05, 37.4], zoom: 8, controls: ['zoomControl', 'typeSelector'] }, { suppressMapOpenBlock: true });
    this.heat = new api.ObjectManager({ clusterize: false, viewportMargin: 100 });
    this.outlines = new api.GeoObjectCollection(); this.markers = new api.GeoObjectCollection();
    this.map.geoObjects.add(this.heat).add(this.outlines).add(this.markers);
    this.fit();
  }
  fit = () => this.map?.setBounds([[52.7, 35.8], [54.85, 38.6]], { checkZoomRange: true, zoomMargin: 35 });
  resize = () => this.map?.container.fitToViewport();
  async draw() {
    const token = ++this.token, state = this.store.getSnapshot(), after = state.scenario === 'after';
    const cancelled = () => token !== this.token || !this.map;
    this.heat.removeAll(); this.outlines.removeAll(); this.markers.removeAll();
    const rows = new Map(state.result?.solution.rows.map(r => [r.cellId, r]) || []);
    const facilities = new Map([...this.store.baseline, ...state.facilities].map(f => [f.id, f]));
    const coordinates = (p: Polygon) => p.map(r => r.map(([lon, lat]) => [lat, lon]));
    const features: any[] = [];
    if (state.showTimes && state.result) {
      await jobs.chunks(this.store.cells, cell => {
        const row = rows.get(cell.id), seconds = after ? row?.afterSeconds : row?.beforeSeconds;
        const id = after ? row?.afterId : cell.organizationId, facility = id ? facilities.get(id) : null;
        features.push({ type: 'Feature', id: cell.id, geometry: { type: 'Polygon', coordinates: coordinates(cell.geometry) },
          properties: { hintContent: escape(`${facility?.name || 'Объект не назначен'} — ${minutes(seconds)}`),
            balloonContent: escape(`${facility?.organization || ''}. ${facility?.name || 'Нет назначения'}. До: ${minutes(row?.beforeSeconds)}. После: ${minutes(row?.afterSeconds)}. Ячейка ${cell.step} м.`) },
          options: { fillColor: timeColors[timeBand(seconds)], fillOpacity: state.opacity, strokeWidth: 0, zIndex: 100 } });
      }, { budget: 6, cancelled });
      if (cancelled()) return;
      // ObjectManager instantiates only objects in the viewport while zooming/panning.
      for (let i = 0; i < features.length; i += 1000) {
        if (cancelled()) return;
        this.heat.add({ type: 'FeatureCollection', features: features.slice(i, i + 1000) });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    if (state.showZones) {
      const zones = after ? state.result?.zones || [] : this.store.zones;
      const add = async (items: [string, Polygon[]][], reference = false) => jobs.chunks(items.flatMap(([id, parts]) => parts.map(geometry => ({ id, geometry }))), item => {
        const f = facilities.get(item.id), color = reference ? '#333333' : facilityColor(item.id);
        const shape = new this.api.Polygon(coordinates(item.geometry), { hintContent: escape(f?.name || item.id) },
          { fillOpacity: state.showTimes && state.result || reference ? 0 : 0.15, fillColor: color, strokeColor: color,
            strokeWidth: reference ? 1.5 : 3, strokeStyle: reference ? 'dash' : 'solid', strokeOpacity: 0.95, zIndex: reference ? 220 : 210,
            interactivityModel: state.showTimes && state.result ? 'default#transparent' : 'default#geoObject' });
        this.outlines.add(shape);
      }, { budget: 6, cancelled });
      await add(zones);
      if (cancelled()) return;
      if (after && state.compareBoundaries) await add(this.store.zones, true);
    }
    if (cancelled()) return;
    const visible = after ? state.facilities.filter(f => f.confirmed) : this.store.baseline;
    for (const f of visible) {
      if (!f.coords) continue;
      this.markers.add(new this.api.Placemark(f.coords, { hintContent: escape(f.name), balloonContent: escape(f.organization + '. ' + f.name + '. ' + f.address) },
        { preset: 'islands#circleDotIcon', iconColor: facilityColor(f.id), zIndex: 500 }));
    }
  }
  dispose() { this.token++; this.host.destroy(); this.map = null; }
}
