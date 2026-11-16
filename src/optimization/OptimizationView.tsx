import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { YandexMap, type YandexMapHost } from '@/components/YandexMap';
import { loadYandex } from '@/services/yandex-loader';
import { download, exportFacilities, importFacilities, validCoords } from './data';
import { OptimizationMap, timeColors } from './map';
import { OptimizationStore, type OptimizationState } from './store';
import type { Facility } from './types';
import './optimization.css';

const min = (n: number | null | undefined) => n == null ? '—' : (n / 60).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' мин';
function CoordinateInput({ facility, disabled, change }: { facility: Facility; disabled: boolean; change: (point: Facility['coords']) => void }) {
  const [text, setText] = useState(facility.coords?.join(', ') || '');
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setText(facility.coords?.join(', ') || ''); setInvalid(false); }, [facility.coords]);
  const commit = () => {
    if (!text.trim()) { setInvalid(false); change(null); return; }
    const value = text.trim().split(/[;,\s]+/).map(Number);
    if (!validCoords(value)) { setInvalid(true); return; }
    setInvalid(false); change(value);
  };
  return <div><Input aria-label={`Координаты: ${facility.name}`} placeholder="54.123456, 37.123456" value={text} disabled={disabled}
    aria-invalid={invalid} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
    {invalid && <small role="alert">Нужны широта и долгота в пределах региона.</small>}</div>;
}
function FacilityDialog({ state, store, open, close }: { state: OptimizationState; store: OptimizationStore; open: boolean; close: () => void }) {
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('all'), [page, setPage] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const filtered = state.facilities.filter(f => (filter === 'all' || filter === 'confirmed' && f.confirmed || filter === 'suggested' && f.suggested || filter === 'legacy' && f.legacy) &&
    [f.name, f.organization, f.address].join(' ').toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')));
  const update = (id: string, patch: Partial<Facility>) => store.setFacilities(state.facilities.map(f => f.id === id ? { ...f, ...patch } : f));
  return <Dialog open={open} onOpenChange={value => { if (!value) close(); }}><DialogContent className="opt-facilities-dialog">
    <DialogHeader><DialogTitle>Объекты приёма терапевта</DialogTitle><DialogDescription>
      229 объектов из нового перечня и 38 исходных точек. Отметьте только те места, где подтверждены приём взрослых у терапевта и координаты входа.
      Название «поликлиника» само по себе не подтверждает профиль. Флажок — ваше подтверждение.
    </DialogDescription></DialogHeader>
    <div className="opt-roster-controls">
      <Input aria-label="Поиск учреждения" placeholder="Название, подразделение или адрес" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
      <select aria-label="Фильтр учреждений" value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }}>
        <option value="all">Все объекты</option><option value="suggested">Возможный взрослый приём</option><option value="confirmed">Подтверждённые</option><option value="legacy">Исходные точки</option>
      </select>
      <Button variant="outline" onClick={() => download('therapist-facilities.csv', exportFacilities(state.facilities), 'text/csv;charset=utf-8')}>Скачать перечень CSV</Button>
      <Button variant="outline" disabled={state.busy} onClick={() => file.current?.click()}>Загрузить CSV</Button>
      <input ref={file} type="file" accept=".csv" hidden onChange={async e => {
        const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
        try { if (f.size > 2e6) throw new Error('Файл больше 2 МБ.'); store.setFacilities(importFacilities(await f.text(), state.facilities)); }
        catch (error) { store.patch({ error: (error as Error).message }); }
      }} />
    </div>
    {state.error && <p className="opt-error" role="alert">{state.error}</p>}
    <div className="opt-roster-table"><table><thead><tr><th>Разрешить</th><th>Учреждение / объект</th><th>Адрес</th><th>Широта, долгота</th></tr></thead>
      <tbody>{filtered.slice(page * 30, (page + 1) * 30).map(f => <tr key={f.id}>
        <td><input type="checkbox" aria-label={`Подтверждён приём: ${f.organization}, ${f.name}`} checked={f.confirmed} disabled={state.busy || !validCoords(f.coords)}
          onChange={e => update(f.id, { confirmed: e.target.checked })} />{!f.coords && <small>Нужны координаты</small>}</td>
        <td><strong>{f.organization}</strong><span>{f.name}</span><small>{f.sourceRow ? `Строка ${f.sourceRow}` : 'Исходная карта'}</small></td>
        <td>{f.address || 'Адрес отсутствует в перечне'}{f.address && !f.legacy && <a target="_blank" rel="noreferrer" href={'https://yandex.ru/maps/?text=' + encodeURIComponent('Тульская область, ' + f.address)}>Найти на карте</a>}</td>
        <td><CoordinateInput facility={f} disabled={state.busy} change={coords => update(f.id, { coords, confirmed: coords ? f.confirmed : false })} /></td>
      </tr>)}</tbody></table></div>
    <div className="opt-roster-footer"><span>Подтверждено: {state.facilities.filter(f => f.confirmed).length} · Найдено: {filtered.length}</span>
      <Button variant="outline" disabled={!page} onClick={() => setPage(p => p - 1)}>Назад</Button>
      <span>{page + 1} / {Math.max(1, Math.ceil(filtered.length / 30))}</span>
      <Button variant="outline" disabled={(page + 1) * 30 >= filtered.length} onClick={() => setPage(p => p + 1)}>Далее</Button>
      <Button onClick={close}>Готово</Button></div>
  </DialogContent></Dialog>;
}
function OptimizationCanvas({ state, store, active }: { state: OptimizationState; store: OptimizationStore; active: boolean }) {
  const [host, setHost] = useState<YandexMapHost | null>(null), [renderer, setRenderer] = useState<OptimizationMap | null>(null);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0), [drawing, setDrawing] = useState(false);
  const drawingSource = useRef<OptimizationState['result'] | undefined>(undefined);
  const drawingRenderer = useRef<OptimizationMap | null>(null);
  const ready = useCallback((value: YandexMapHost | null) => setHost(value), []);
  const [started, setStarted] = useState(active);
  useEffect(() => { if (active) setStarted(true); }, [active]);
  useEffect(() => {
    if (!host || state.loading || !started) return;
    let alive = true, map: OptimizationMap | undefined;
    setError('');
    void loadYandex(window.HospitalViewerConfig.mapKey).then(api => {
      if (!alive) return; map = new OptimizationMap(api, host, store); setRenderer(map);
    }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; map?.dispose(); setRenderer(null); };
  }, [host, state.loading, store, retry, started]);
  useEffect(() => {
    if (!renderer) return;
    let alive = true;
    if (drawingSource.current !== state.result || drawingRenderer.current !== renderer) setDrawing(true);
    void renderer.draw().then(() => {
      if (alive) { drawingSource.current = state.result; drawingRenderer.current = renderer; }
    }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setDrawing(false); });
    return () => { alive = false; };
  }, [renderer, state.result, state.scenario, state.showZones, state.showTimes, state.opacity, state.compareBoundaries]);
  useEffect(() => { if (active && renderer) renderer.resize(); }, [active, renderer]);
  return <div className="map-workspace opt-map-workspace"><YandexMap id="optimization-map" ariaLabel="Сравнение прикреплений и времени пути" onHostReady={ready} />
    <div className="opt-map-toolbar"><Button variant="outline" disabled={!renderer} onClick={() => renderer?.fit()}>Вся область</Button></div>
    {(state.loading || drawing || !renderer && !error) && <p className="opt-map-status" role="status">{state.loading ? 'Загрузка сетки…' : drawing ? 'Обновление слоёв…' : 'Подключение карты…'}</p>}
    {error && <div className="opt-map-status opt-error" role="alert">{error}<Button variant="outline" onClick={() => setRetry(n => n + 1)}>Повторить</Button></div>}
    <div className="opt-map-legend"><strong>{state.scenario === 'before' ? 'Исходные' : 'Оптимизированные'} прикрепления</strong>
      {state.showZones && <p>Цветные контуры — зоны учреждений.{state.compareBoundaries && state.scenario === 'after' && ' Чёрный пунктир — исходные зоны.'}</p>}
      {state.showTimes && (state.result ? <><p>{state.mode === 'auto' ? 'На машине' : 'Пешком'} · время без пробок</p><div className="legend-bands">{timeColors.map((c, i) => <span className="legend-band" key={c}><i className="dot" style={{ background: c }} />{['≤ 15 мин', '15–30 мин', '30–60 мин', '> 60 мин'][i]}</span>)}</div></> : <p>Время по новой сетке появится после расчёта.</p>)}
      {state.result?.display && <p>При приближении видны отдельные ячейки сетки и время пути.</p>}
    </div>
  </div>;
}
export default function OptimizationView({ active }: { active: boolean }) {
  const [store] = useState(() => new OptimizationStore()), state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [roster, setRoster] = useState(false), backup = useRef<HTMLInputElement>(null);
  useEffect(() => { void store.start(); return () => store.dispose(); }, [store]);
  const summary = state.result?.solution.summary;
  return <div className="map-layout opt-layout"><aside className="sidebar opt-sidebar" aria-label="Параметры оптимизации">
    <section><h2>Оптимизация прикреплений</h2><p>Этап 1 · минимальное время пути</p><p className="opt-note">Сетка: города — 250 м, остальная область — 2 км. Мощность пока не ограничивает распределение.</p>
      {state.prepared ? <p className="opt-note">Готовые результаты для 38 исходных точек. Локальный OSRM для просмотра не нужен.</p> : <Button className="w-full" variant="outline" disabled={state.loading} onClick={() => setRoster(true)}>Учреждения · {state.facilities.filter(f => f.confirmed).length} подтверждено</Button>}</section>
    <section><label htmlFor="opt-mode">Способ передвижения</label><select id="opt-mode" value={state.mode} disabled={state.busy} onChange={e => store.setMode(e.target.value as OptimizationState['mode'])}>
      <option value="auto">На машине</option><option value="pedestrian">Пешком</option></select>
      {!state.prepared && <><Button className="w-full" disabled={state.loading || state.busy || !state.facilities.some(f => f.confirmed)} onClick={() => void store.calculate()}>Рассчитать / продолжить</Button>
      {state.busy ? <Button variant="outline" onClick={store.stop}>Остановить</Button> : <Button variant="ghost" disabled={state.loading || !state.facilities.some(f => f.confirmed)} onClick={() => void store.calculate(true)}>Пересчитать заново</Button>}</>}
      {(state.status || state.busy) && <>{!state.prepared && <Progress value={state.busy ? state.total ? state.count / state.total * 100 : null : state.result ? 100 : 0} aria-label="Текущий этап расчёта" />}<p className="opt-note" role="status">{state.status}</p></>}
      {state.error && <p className="opt-error" role="alert">{state.error}</p>}</section>
    <section><h3>Слои карты</h3><div className="opt-scenario" role="group" aria-label="Прикрепления до и после">
      <Button variant={state.scenario === 'before' ? 'default' : 'outline'} aria-pressed={state.scenario === 'before'} onClick={() => store.patch({ scenario: 'before' })}>До</Button>
      <Button variant={state.scenario === 'after' ? 'default' : 'outline'} aria-pressed={state.scenario === 'after'} disabled={!state.result} onClick={() => store.patch({ scenario: 'after' })}>После</Button></div>
      <label className="opt-check"><input type="checkbox" checked={state.showZones} onChange={e => store.patch({ showZones: e.target.checked })} />Контуры прикреплений</label>
      <label className="opt-check"><input type="checkbox" checked={state.showTimes} onChange={e => store.patch({ showTimes: e.target.checked })} />Время пути поверх зон</label>
      <label className="opt-check"><input type="checkbox" checked={state.compareBoundaries} disabled={state.scenario !== 'after' || !state.showZones} onChange={e => store.patch({ compareBoundaries: e.target.checked })} />Исходные границы пунктиром</label>
      <label htmlFor="opt-opacity">Заливка времени · {Math.round(state.opacity * 100)}%</label><input id="opt-opacity" type="range" min="0.1" max="0.8" step="0.05" value={state.opacity} onChange={e => store.patch({ opacity: Number(e.target.value) })} /></section>
    {summary && <section><h3>Сравнение на одной сетке</h3><dl className="opt-metrics"><div><dt>Среднее до</dt><dd>{min(summary.beforeSeconds)}</dd></div>
      <div><dt>Среднее после</dt><dd>{min(summary.afterSeconds)}</dd></div><div><dt>Среднее сокращение</dt><dd>{min(summary.savedSeconds)}</dd></div>
      <div><dt>Сопоставимых ячеек</dt><dd>{summary.paired.toLocaleString('ru-RU')} / {summary.cells.toLocaleString('ru-RU')}</dd></div>
      <div><dt>Быстрее / дольше</dt><dd>{summary.improved} / {summary.worsened}</dd></div><div><dt>Изменено прикреплений</dt><dd>{summary.changed}</dd></div></dl>
      <p className="opt-note">Средние по сопоставимым ячейкам, без весов населения. Это сценарий доступности, перегрузка больниц пока не проверяется.</p>
      <p className="opt-note">Расчёт: {new Date(state.result!.at).toLocaleString('ru-RU')}</p><Button variant="outline" onClick={() => store.exportGeoJSON()}>Выгрузить зоны GeoJSON</Button></section>}
    <section>{state.prepared ? <Button variant="outline" disabled={state.loading} onClick={() => store.useCustomParameters()}>Свой набор учреждений</Button> : <><Button variant="outline" disabled={state.busy} onClick={() => store.usePrepared()}>Вернуться к готовому расчёту</Button><Button variant="outline" disabled={state.loading || state.busy} onClick={() => void store.exportBackup()}>Сохранить расчёт</Button>
      <Button variant="outline" disabled={state.loading || state.busy} onClick={() => backup.current?.click()}>Загрузить расчёт</Button>
      <input type="file" accept=".json" hidden ref={backup} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void store.importBackup(file); }} />
      <p className="opt-note">Для собственного расчёта нужны локальные OSRM: машина — порт 5000, пешком — 5001. Смена дорожного графа требует пересчёта заново.</p></>}</section>
  </aside><OptimizationCanvas state={state} store={store} active={active} />
    <FacilityDialog state={state} store={store} open={roster} close={() => setRoster(false)} /></div>;
}
