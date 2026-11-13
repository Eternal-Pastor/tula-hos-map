import type { Polygon, TravelMode } from '../types/domain';
import type { Facility, GridCell, MatrixEntry, OptimizationResult } from './types';
import { applyFacilitySettings, digest, download, facilitySettings, loadOptimizationData, loadPreparedResult } from './data';
import { buildOutlines, optimizer } from './engine';
import { pairKey, runMatrix } from './matrix';
import { OptimizationStorage } from './storage';

export interface OptimizationState {
  loading: boolean; busy: boolean; prepared: boolean; error: string; status: string; count: number; total: number;
  facilities: Facility[]; mode: TravelMode; result: OptimizationResult | null;
  scenario: 'before' | 'after'; showZones: boolean; showTimes: boolean; opacity: number; compareBoundaries: boolean;
}
export class OptimizationStore {
  private state: OptimizationState = { loading: true, busy: false, prepared: true, error: '', status: '', count: 0, total: 0,
    facilities: [], mode: 'auto', result: null, scenario: 'before', showZones: true, showTimes: true, opacity: 0.5, compareBoundaries: false };
  private listeners = new Set<() => void>();
  private generation = 0;
  private controller?: AbortController;
  private storage = new OptimizationStorage();
  private data?: Awaited<ReturnType<typeof loadOptimizationData>>;
  private saving = Promise.resolve();
  private presentation = 0;
  private preparedResults = new Map<TravelMode, OptimizationResult>();
  cells: GridCell[] = [];
  baseline: Facility[] = [];
  zones: [string, Polygon[]][] = [];
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.state;
  patch(patch: Partial<OptimizationState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  async start() {
    const generation = ++this.generation;
    try {
      const data = await loadOptimizationData();
      if (generation !== this.generation) return;
      this.data = data; this.cells = data.cells; this.baseline = data.baseline; this.zones = data.snapshot.zones;
      const result = await loadPreparedResult('auto', data);
      if (generation !== this.generation) return;
      this.preparedResults.set('auto', result);
      const facilities = data.facilities.map(f => ({ ...f, confirmed: !!f.legacy }));
      this.patch({ facilities, mode: 'auto', result, prepared: true, loading: false, scenario: 'after', status: 'Готовый расчёт · 38 исходных точек' });
    } catch (error) { if (generation === this.generation) this.patch({ loading: false, error: (error as Error).message }); }
  }
  dispose() { this.generation++; this.presentation++; this.controller?.abort(); }
  private persist() {
    const value = { identity: this.data?.identity, facilities: facilitySettings(this.state.facilities), mode: this.state.mode };
    this.saving = this.saving.catch(() => {}).then(() => this.storage.writeState('settings', value));
    void this.saving.catch(() => this.patch({ error: 'Не удалось сохранить выбор объектов. Проверьте свободное место браузера.' }));
  }
  setFacilities(facilities: Facility[]) {
    if (this.state.prepared || this.state.busy || !this.data) return;
    // Reapply only mutable fields; source rows, names and addresses stay immutable.
    const validated = applyFacilitySettings(this.data.facilities, facilitySettings(facilities));
    this.patch({ facilities: validated, result: null, scenario: 'before', status: '', error: '' }); this.persist();
  }
  setMode(mode: TravelMode) {
    if (this.state.busy) return;
    if (this.state.prepared) { void this.showPrepared(mode); return; }
    this.patch({ mode, result: null, scenario: 'before', status: '', error: '' }); this.persist();
  }
  private async showPrepared(mode: TravelMode) {
    if (!this.data) return;
    const generation = this.generation, presentation = ++this.presentation;
    this.patch({ mode, prepared: true, result: null, error: '', status: 'Загрузка готового расчёта…' });
    try {
      const result = this.preparedResults.get(mode) || await loadPreparedResult(mode, this.data);
      if (generation !== this.generation || presentation !== this.presentation) return;
      this.preparedResults.set(mode, result);
      this.patch({ result, facilities: this.data.facilities.map(f => ({ ...f, confirmed: !!f.legacy })), status: 'Готовый расчёт · 38 исходных точек' });
    } catch (error) {
      if (generation === this.generation && presentation === this.presentation) this.patch({ error: (error as Error).message, status: '' });
    }
  }
  usePrepared() { if (!this.state.busy) void this.showPrepared(this.state.mode); }
  useCustomParameters() {
    if (!this.data || this.state.busy) return;
    this.presentation++;
    this.patch({ prepared: false, result: null, scenario: 'before', status: '', error: '' });
  }
  private async fingerprint(facilities = this.state.facilities, mode = this.state.mode) {
    if (!this.data) throw new Error('Данные ещё загружаются.');
    return digest({ version: 'travel-time-v1', data: this.data.identity, mode,
      service: this.data.snapshot.services[mode], baseline: this.baseline.map(f => [f.id, f.coords]),
      candidates: facilities.filter(f => f.confirmed).map(f => [f.id, f.coords]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) });
  }
  stop = () => this.controller?.abort();
  async calculate(fresh = false) {
    if (this.state.prepared || !this.data || this.state.loading || this.controller) return;
    const candidates = this.state.facilities.filter(f => f.confirmed && f.coords);
    if (!candidates.length) { this.patch({ error: 'Подтвердите объекты приёма и их координаты в перечне учреждений.' }); return; }
    const controller = new AbortController(), generation = this.generation;
    this.controller = controller;
    const live = () => generation === this.generation;
    this.patch({ busy: true, error: '', status: 'Подготовка матрицы…', count: 0, total: 0 });
    try {
      await this.saving;
      const fingerprint = await this.fingerprint();
      let run = fresh ? undefined : await this.storage.readState<string>('run:' + fingerprint);
      if (!run) { run = crypto.randomUUID(); await this.storage.writeState('run:' + fingerprint, run); }
      const cache = new Map((await this.storage.readMatrix(run)).map(r => [r.key, r.seconds]));
      const service = this.data.snapshot.services[this.state.mode];
      const request = async (sources: GridCell[], destinations: Facility[], label: string) => runMatrix({ service,
        sources: sources.map(c => c.origin), destinations: destinations.map(f => f.coords!), cache, signal: controller.signal,
        save: batch => this.storage.writeMatrix(run!, batch),
        progress: (count, total) => { if (live()) this.patch({ count, total, status: `${label}: ${count.toLocaleString('ru-RU')} / ${total.toLocaleString('ru-RU')}` }); } });
      await request(this.cells, candidates, 'Время до разрешённых объектов');
      for (let i = 0; i < this.baseline.length; i++) {
        const h = this.baseline[i];
        await request(this.cells.filter(c => c.organizationId === h.id), [h], `Исходные прикрепления · ${i + 1} / ${this.baseline.length}`);
      }
      controller.signal.throwIfAborted();
      const solution = optimizer.solve(this.cells, candidates, this.baseline, (c, f) => cache.get(pairKey(c.origin, f.coords!)));
      if (solution.summary.pending) throw new Error('Матрица рассчитана не полностью. Продолжите расчёт.');
      const zones = await buildOutlines(this.cells, solution, controller.signal,
        (count, total) => { if (live()) this.patch({ count, total, status: `Объединение новых зон: ${count} / ${total}` }); });
      const result: OptimizationResult = { solution, zones, mode: this.state.mode, at: new Date().toISOString(), fingerprint };
      await this.storage.writeState('result:' + fingerprint, result);
      if (live()) this.patch({ result, scenario: 'after', status: 'Расчёт завершён и сохранён локально.', count: 1, total: 1 });
    } catch (error) {
      if (live()) this.patch({ status: controller.signal.aborted ? 'Остановлено. Сохранённые порции будут использованы при продолжении.' : 'Расчёт приостановлен. Сохранённые порции доступны для продолжения.',
        error: controller.signal.aborted ? '' : (error as Error).message });
    } finally { this.controller = undefined; if (live()) this.patch({ busy: false }); }
  }
  async exportBackup() {
    try {
      const fingerprint = await this.fingerprint(), run = await this.storage.readState<string>('run:' + fingerprint);
      const payload = { identity: this.data!.identity, fingerprint, facilities: facilitySettings(this.state.facilities), mode: this.state.mode,
        entries: run ? await this.storage.readMatrix(run) : [] };
      download('hospital-optimization-' + new Date().toISOString().replaceAll(':', '-') + '.json',
        JSON.stringify({ type: 'hospital-optimization', version: 1, createdAt: new Date().toISOString(), checksum: await digest(payload), payload }));
    } catch (error) { this.patch({ error: (error as Error).message }); }
  }
  async importBackup(file: File) {
    if (!this.data || this.state.busy) return;
    try {
      if (file.size > 150 * 1024 * 1024) throw new Error('Файл больше 150 МБ.');
      const backup = JSON.parse(await file.text()), p = backup.payload;
      if (backup.type !== 'hospital-optimization' || backup.version !== 1 || !p ||
        await digest(p) !== backup.checksum || p.identity !== this.data.identity || !['auto', 'pedestrian'].includes(p.mode)) throw new Error('Резервная копия повреждена или относится к другой сетке.');
      const facilities = applyFacilitySettings(this.data.facilities, p.facilities);
      const origins = new Set(this.cells.map(c => c.origin.map(n => n.toFixed(7)).join(',')));
      const targets = new Set([...this.baseline, ...facilities.filter(f => f.confirmed)].map(f => f.coords!.map(n => n.toFixed(7)).join(',')));
      if (!Array.isArray(p.entries) || p.entries.length > this.cells.length * (facilities.length + this.baseline.length)) throw new Error('Некорректный размер матрицы.');
      const seen = new Set();
      for (const entry of p.entries as MatrixEntry[]) {
        if (!entry || typeof entry.key !== 'string') throw new Error('Некорректная запись матрицы.');
        const parts = entry.key.split('>');
        if (parts.length !== 2 || !origins.has(parts[0]) || !targets.has(parts[1]) || seen.has(entry.key) ||
          entry.seconds !== null && (typeof entry.seconds !== 'number' || !Number.isFinite(entry.seconds) || entry.seconds < 0 || entry.seconds > 604800)) throw new Error('Некорректная запись матрицы.');
        seen.add(entry.key);
      }
      // Validate everything before changing the saved selection.
      const fingerprint = await this.fingerprint(facilities, p.mode);
      if (fingerprint !== p.fingerprint) throw new Error('Параметры копии не соответствуют матрице.');
      const run = crypto.randomUUID();
      await this.storage.writeMatrix(run, p.entries);
      await this.storage.writeState('run:' + fingerprint, run);
      this.patch({ facilities, mode: p.mode, result: null, scenario: 'before', error: '', status: 'Копия импортирована. Нажмите «Рассчитать / продолжить»: сохранённые пары запрашиваться не будут.' });
      this.persist();
    } catch (error) { this.patch({ error: (error as Error).message }); }
  }
  exportGeoJSON() {
    const result = this.state.result; if (!result) return;
    const rows = new Map(result.solution.rows.map(r => [r.cellId, r]));
    download('hospital-optimization.geojson', JSON.stringify({ type: 'FeatureCollection', properties: { mode: result.mode, at: result.at, stage: 1 },
      features: this.cells.map(c => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: c.geometry },
        properties: { ...rows.get(c.id), step: c.step } })) }));
  }
}
