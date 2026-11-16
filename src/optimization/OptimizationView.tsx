import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { YandexMap, type YandexMapHost } from '@/components/YandexMap';
import { loadYandex } from '@/services/yandex-loader';
import { download, exportFacilities, importFacilities, validCoords } from './data';
import { OptimizationMap, timeColors, gainColors } from './map';
import { MapViewSync } from './map-sync';
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
function OptimizationCanvas({ state, store, active, sync, scenario, id }: {
  state: OptimizationState; store: OptimizationStore; active: boolean; sync: MapViewSync;
  scenario?: 'before' | 'after'; id: string;
}) {
  const [host, setHost] = useState<YandexMapHost | null>(null), [renderer, setRenderer] = useState<OptimizationMap | null>(null);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0), [drawing, setDrawing] = useState(false);
  const drawingSource = useRef<OptimizationState['result'] | undefined>(undefined), drawingRenderer = useRef<OptimizationMap | null>(null);
  const ready = useCallback((value: YandexMapHost | null) => setHost(value), []);
  const [started, setStarted] = useState(active);
  useEffect(() => { if (active) setStarted(true); }, [active]);
  useEffect(() => {
    if (!host || state.loading || !started) return;
    let alive = true, map: OptimizationMap | undefined;
    setError('');
    void loadYandex(window.HospitalViewerConfig.mapKey).then(api => {
      if (!alive) return; map = new OptimizationMap(api, host, store, sync, scenario); setRenderer(map);
    }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; map?.dispose(); setRenderer(null); };
  }, [host, state.loading, store, retry, started, sync, scenario]);
  useEffect(() => {
    if (!renderer) return;
    let alive = true;
    if (drawingSource.current !== state.result || drawingRenderer.current !== renderer) setDrawing(true);
    void renderer.draw().then(() => {
      if (alive) { drawingSource.current = state.result; drawingRenderer.current = renderer; }
    }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setDrawing(false); });
    return () => { alive = false; };
  }, [renderer, state.result, state.scenario, state.showZones, state.showTimes, state.opacity, state.compareBoundaries, state.theme]);
  useEffect(() => { if (active && renderer) renderer.resize(); }, [active, renderer, state.comparison]);
  const selected = scenario || state.scenario, before = selected === 'before';
  return <div className="opt-map-panel">
    <YandexMap id={id} className="opt-yandex-map" ariaLabel={before ? 'До оптимизации: исходное прикрепление' : 'После оптимизации: новое прикрепление'} onHostReady={ready} />
    {state.comparison !== 'swipe' && <div className={'opt-panel-title ' + (before ? 'is-before' : 'is-after')}><strong>{before ? 'ДО' : 'ПОСЛЕ'}</strong><span>{before ? 'Исходное прикрепление' : 'Новое общее прикрепление'}</span></div>}
    <div className="opt-map-toolbar"><Button variant="outline" size="sm" disabled={!renderer} onClick={() => renderer?.fit()}>Вся область</Button></div>
    {(state.loading || drawing || !renderer && !error) && <p className="opt-map-status" role="status">{state.loading ? 'Загрузка данных…' : drawing ? 'Подготовка слоя…' : 'Подключение карты…'}</p>}
    {error && <div className="opt-map-status opt-error" role="alert">{error}<Button variant="outline" onClick={() => setRetry(n => n + 1)}>Повторить</Button></div>}
  </div>;
}

function ComparisonLegend({ state }: { state: OptimizationState }) {
  const gains = state.theme === 'gain';
  const bands = state.theme === 'attachment' ? [] : gains
    ? gainColors.map((color, i) => [color, ['Без изменений', 'Быстрее до 5 мин', 'Быстрее на 5–15 мин', 'Быстрее более чем на 15 мин', 'Стало дольше'][i]])
    : timeColors.map((color, i) => [color, ['До 15 мин', '15–30 мин', '30–60 мин', 'Более 60 мин'][i]]);
  return <div className="opt-map-legend" role="region" aria-label="Как читать карту">
    <strong>{state.theme === 'attachment' ? 'Каждый цвет — отдельное учреждение' : gains ? 'На сколько сократилось время пути' : 'Время от ячейки до закреплённой больницы'}</strong>
    {!!bands.length && <div className="legend-bands">{bands.filter((_, i) => !gains || i !== 4 || !!state.result?.solution.summary.worsened).map(([color, label]) => <span className="legend-band" key={label}><i className="dot" style={{ background: color }} />{label}</span>)}</div>}
    {state.showZones && <p>{state.compareBoundaries && state.comparison === 'overlay' && state.scenario === 'after' ? 'Сплошные цветные границы — после. Чёрный пунктир — до.' : 'Цветные границы — зоны прикрепления.'}</p>}
    <p>Нажмите на ячейку: больница и время до и после.</p>
  </div>;
}

function ComparisonMaps({ state, store, active }: { state: OptimizationState; store: OptimizationStore; active: boolean }) {
  const [sync] = useState(() => new MapViewSync()), stage = useRef<HTMLDivElement>(null);
  const swipe = state.comparison === 'swipe';
  const setDivider = (clientX: number) => {
    const box = stage.current?.getBoundingClientRect(); if (!box) return;
    store.patch({ divider: Math.max(5, Math.min(95, (clientX - box.left) / box.width * 100)) });
  };
  return <div className="opt-comparison-workspace">
    <div className="opt-comparison-caption"><strong>{state.comparison === 'side' ? 'До и после на одном масштабе' : swipe ? 'Перетаскивайте разделитель для сравнения' : state.theme === 'gain' ? 'Где изменилось время пути' : 'Слои на одной карте'}</strong>
      <span>{state.mode === 'auto' ? 'На машине' : 'Пешком'}{state.comparison !== 'overlay' ? ' · перемещение и масштаб синхронизированы' : ''}</span></div>
    <div ref={stage} className={'opt-comparison-stage opt-view-' + state.comparison}>
      {state.comparison === 'overlay' ? <OptimizationCanvas key="overlay" state={state} store={store} active={active} sync={sync} id="optimization-map-overlay" /> : <>
        <div key="before" className="opt-map-slot opt-slot-before"><OptimizationCanvas state={state} store={store} active={active} sync={sync} scenario="before" id="optimization-map-before" /></div>
        <div key="after" className="opt-map-slot opt-slot-after" style={swipe ? { clipPath: `inset(0 0 0 ${state.divider}%)` } : undefined}><OptimizationCanvas state={state} store={store} active={active} sync={sync} scenario="after" id="optimization-map-after" /></div>
      </>}
      {swipe && <>
        <div className="opt-swipe-label is-before">ДО · исходное прикрепление</div><div className="opt-swipe-label is-after">ПОСЛЕ · новое прикрепление</div>
        <button className="opt-swipe-handle" style={{ left: state.divider + '%' }} role="slider" aria-label="Разделитель до и после" aria-valuemin={5} aria-valuemax={95} aria-valuenow={Math.round(state.divider)}
          onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setDivider(e.clientX); }}
          onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) setDivider(e.clientX); }}
          onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
          onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); store.patch({ divider: Math.max(5, Math.min(95, state.divider + (e.key === 'ArrowLeft' ? -2 : 2))) }); } }}><span>↔</span></button>
      </>}
      <ComparisonLegend state={state} />
    </div>
  </div>;
}

export default function OptimizationView({ active }: { active: boolean }) {
  const [store] = useState(() => new OptimizationStore()), state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [roster, setRoster] = useState(false), backup = useRef<HTMLInputElement>(null);
  useEffect(() => { void store.start(); return () => store.dispose(); }, [store]);
  const summary = state.result?.solution.summary;
  const saving = summary?.savedSeconds ?? 0;
  const theme = (value: OptimizationState['theme']) => store.patch({ theme: value, showTimes: value !== 'attachment', showZones: value === 'attachment' || value === 'time',
    ...(value === 'gain' ? { comparison: 'overlay' as const, scenario: 'after' as const, compareBoundaries: false } : {}) });
  return <div className="map-layout opt-layout"><aside className="sidebar opt-sidebar" aria-label="Сравнение распределения">
    <section><h2>Что изменилось после оптимизации</h2><p className="opt-note">38 исходных точек · города 250 м · остальная область 2 км</p>
      <label htmlFor="opt-mode">Как добираться</label><select id="opt-mode" value={state.mode} disabled={state.busy || state.loading} onChange={e => store.setMode(e.target.value as OptimizationState['mode'])}><option value="auto">На машине</option><option value="pedestrian">Пешком</option></select>
      {summary && <><div className="opt-summary-cards"><div className="is-before"><span>До</span><strong>{min(summary.beforeSeconds)}</strong></div><div className="is-after"><span>После</span><strong>{min(summary.afterSeconds)}</strong></div></div>
        <div className={'opt-saving' + (saving < 0 ? ' is-increase' : '')}><span>{saving >= 0 ? 'Среднее сокращение' : 'Среднее увеличение'}</span><strong>{min(Math.abs(saving))}</strong></div><p className="opt-note">Быстрее: {summary.improved.toLocaleString('ru-RU')} ячеек. Дольше: {summary.worsened.toLocaleString('ru-RU')}. Средние по ячейкам сетки.</p></>}
      {state.result?.allocation && <><p className="opt-note">Прикрепление общее для машины и пешего пути. Переключатель меняет время на карте, а не больницу.</p><details className="opt-extra"><summary>Как выбрана больница</summary><div><p className="opt-note">Если даже лучший пеший путь дольше 60 минут, выбираем по машине. Иначе сравниваем среднее времени машины и пешего пути среди всех 38 больниц.</p><p className="opt-note">По машине: {state.result.allocation.carOnly.toLocaleString('ru-RU')} ячеек. По среднему: {state.result.allocation.mean.toLocaleString('ru-RU')}.</p></div></details></>}
    </section>
    <section><h3>1. Способ сравнения</h3><div className="opt-comparison-options">{([
      ['side', 'Рядом', 'Две карты на одном масштабе'], ['swipe', 'Ползунок', 'До слева, после справа'], ['overlay', 'Наложение', 'Слои на одной карте'],
    ] as const).map(([value, title, text]) => <Button key={value} variant={state.comparison === value ? 'default' : 'outline'} aria-pressed={state.comparison === value} onClick={() => {
      store.patch({ comparison: value, ...(value !== 'overlay' && state.theme === 'gain' ? { theme: 'time' as const, showTimes: true } : {}),
        ...(value === 'overlay' ? { scenario: 'after' as const, showZones: true, compareBoundaries: true } : { compareBoundaries: false }) });
    }}><strong>{title}</strong><span>{text}</span></Button>)}</div></section>
    <section><h3>2. Что показывает карта</h3><div className="opt-theme-options">{([
      ['time', 'Время пути'], ['attachment', 'Зоны прикрепления'], ['gain', 'Где стало быстрее'],
    ] as const).map(([value, label]) => <Button key={value} variant={state.theme === value ? 'default' : 'outline'} aria-pressed={state.theme === value} onClick={() => theme(value)}>{label}</Button>)}</div>
      {state.comparison === 'overlay' && state.theme !== 'gain' && <div className="opt-scenario" role="group" aria-label="Какие данные показать"><Button variant={state.scenario === 'before' ? 'default' : 'outline'} aria-pressed={state.scenario === 'before'} onClick={() => store.patch({ scenario: 'before' })}>До</Button><Button variant={state.scenario === 'after' ? 'default' : 'outline'} aria-pressed={state.scenario === 'after'} onClick={() => store.patch({ scenario: 'after' })}>После</Button></div>}
      {state.theme !== 'attachment' && <label className="opt-check"><input type="checkbox" checked={state.showZones} onChange={e => store.patch({ showZones: e.target.checked })} />Границы прикреплений поверх цвета</label>}
      {state.comparison === 'overlay' && state.scenario === 'after' && <label className="opt-check"><input type="checkbox" checked={state.compareBoundaries} onChange={e => store.patch({ compareBoundaries: e.target.checked, showZones: true })} />Исходные границы пунктиром</label>}
      {state.showTimes && <><label htmlFor="opt-opacity">Прозрачность цветного слоя</label><input id="opt-opacity" type="range" min="0.15" max="0.85" step="0.05" value={state.opacity} onChange={e => store.patch({ opacity: Number(e.target.value) })} /></>}
    </section>
    {state.error && <section><p className="opt-error" role="alert">{state.error}</p></section>}
    <section><details className="opt-extra"><summary>Свой расчёт и выгрузка</summary><div>
      {state.result && <Button variant="outline" onClick={() => store.exportGeoJSON()}>Скачать результат GeoJSON</Button>}
      {state.prepared ? <Button variant="outline" disabled={state.loading} onClick={() => store.useCustomParameters()}>Свой набор учреждений</Button> : <>
        <Button variant="outline" onClick={() => setRoster(true)}>Учреждения · {state.facilities.filter(f => f.confirmed).length}</Button>
        <Button disabled={state.loading || state.busy || !state.facilities.some(f => f.confirmed)} onClick={() => void store.calculate()}>Рассчитать / продолжить</Button>
        {state.busy ? <Button variant="outline" onClick={store.stop}>Остановить</Button> : <Button variant="ghost" onClick={() => void store.calculate(true)}>Пересчитать заново</Button>}
        {state.status && <><Progress value={state.busy ? state.total ? state.count / state.total * 100 : null : state.result ? 100 : 0} aria-label="Расчёт" /><p className="opt-note" role="status">{state.status}</p></>}
        <Button variant="outline" disabled={state.busy} onClick={() => store.usePrepared()}>Вернуться к готовому результату</Button>
        <Button variant="outline" disabled={state.busy} onClick={() => void store.exportBackup()}>Сохранить расчёт</Button><Button variant="outline" disabled={state.busy} onClick={() => backup.current?.click()}>Загрузить расчёт</Button>
        <input type="file" accept=".json" hidden ref={backup} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void store.importBackup(file); }} />
      </>}
    </div></details><p className="opt-note">Этап 1: только время пути. Ограничения мощности пока не учитываются.</p></section>
  </aside><ComparisonMaps state={state} store={store} active={active} />
    <FacilityDialog state={state} store={store} open={roster} close={() => setRoster(false)} /></div>;
}
