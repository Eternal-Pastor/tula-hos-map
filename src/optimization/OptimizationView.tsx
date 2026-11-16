import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { YandexMap, type YandexMapHost } from '@/components/YandexMap';
import { loadYandex } from '@/services/yandex-loader';
import { OptimizationMap, timeColors, gainColors } from './map';
import { MapViewSync } from './map-sync';
import { MapCard } from './MapCard';
import { OptimizationStore, type OptimizationState } from './store';
import './optimization.css';

const min = (n: number | null | undefined) => n == null ? '—' : (n / 60).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' мин';
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
  }, [renderer, state.result, state.scenario, state.showZones, state.showTimes, state.opacity, state.compareBoundaries, state.theme, state.focusChanges]);
  useEffect(() => { if (active && renderer) renderer.resize(); }, [active, renderer, state.comparison]);
  const selected = scenario || state.scenario, before = selected === 'before';
  return <div className="opt-map-panel">
    <YandexMap id={id} className="opt-yandex-map" ariaLabel={before ? 'До оптимизации: исходное прикрепление' : 'После оптимизации: новое прикрепление'} onHostReady={ready} />
    {state.comparison !== 'swipe' && <div className={'opt-panel-title ' + (before ? 'is-before' : 'is-after')}><strong>{before ? 'ДО' : 'ПОСЛЕ'}</strong></div>}
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
    {state.focusChanges && state.theme !== 'attachment' && <p><i className="dot" style={{ background: '#f2edda' }} /> Без смены больницы</p>}
    {state.showZones && <p>{state.compareBoundaries && state.comparison === 'overlay' && state.scenario === 'after' ? 'Сплошная граница — после. Синий пунктир — до.' : state.theme === 'attachment' ? 'Границы разделяют учреждения.' : 'Тёмные линии — границы прикреплений.'}</p>}
    
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
      <span>{state.mode === 'auto' ? 'На машине' : 'Пешком'}</span></div>
    <div ref={stage} className={'opt-comparison-stage opt-view-' + state.comparison}>
      {state.comparison === 'overlay' ? <OptimizationCanvas key="overlay" state={state} store={store} active={active} sync={sync} id="optimization-map-overlay" /> : <>
        <div key="before" className="opt-map-slot opt-slot-before"><OptimizationCanvas state={state} store={store} active={active} sync={sync} scenario="before" id="optimization-map-before" /></div>
        <div key="after" className="opt-map-slot opt-slot-after" style={swipe ? { clipPath: `inset(0 0 0 ${state.divider}%)` } : undefined}><OptimizationCanvas state={state} store={store} active={active} sync={sync} scenario="after" id="optimization-map-after" /></div>
      </>}
      {swipe && <>
        <div className="opt-swipe-label is-before">ДО</div><div className="opt-swipe-label is-after">ПОСЛЕ</div>
        <button className="opt-swipe-handle" style={{ left: state.divider + '%' }} role="slider" aria-label="Разделитель до и после" aria-valuemin={5} aria-valuemax={95} aria-valuenow={Math.round(state.divider)}
          onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setDivider(e.clientX); }}
          onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) setDivider(e.clientX); }}
          onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
          onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); store.patch({ divider: Math.max(5, Math.min(95, state.divider + (e.key === 'ArrowLeft' ? -2 : 2))) }); } }}><span>↔</span></button>
      </>}
      <ComparisonLegend state={state} />
      <MapCard state={state} store={store} />
    </div>
  </div>;
}

export default function OptimizationView({ active }: { active: boolean }) {
  const [store] = useState(() => new OptimizationStore()), state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => { void store.start(); return () => store.dispose(); }, [store]);
  const summary = state.result?.solution.summary;
  const saving = summary?.savedSeconds ?? 0;
  const theme = (value: OptimizationState['theme']) => store.patch({ theme: value, showTimes: value !== 'attachment', showZones: value === 'attachment', compareBoundaries: false,
    ...(value === 'gain' ? { comparison: 'overlay' as const, scenario: 'after' as const, compareBoundaries: false } : {}) });
  return <div className="map-layout opt-layout"><aside className="sidebar opt-sidebar" aria-label="Сравнение распределения">
    <section><h2>Оптимизация</h2>
      <label htmlFor="opt-mode">Транспорт</label><select id="opt-mode" value={state.mode} disabled={state.busy || state.loading} onChange={e => store.setMode(e.target.value as OptimizationState['mode'])}><option value="auto">На машине</option><option value="pedestrian">Пешком</option></select>
      {summary && <><div className="opt-summary-cards"><div className="is-before"><span>До</span><strong>{min(summary.beforeSeconds)}</strong></div><div className="is-after"><span>После</span><strong>{min(summary.afterSeconds)}</strong></div></div>
        <div className={'opt-saving' + (saving < 0 ? ' is-increase' : '')}><span>{saving >= 0 ? 'Среднее сокращение' : 'Среднее увеличение'}</span><strong>{min(Math.abs(saving))}</strong></div></>}

    </section>
    <section><h3>Сравнение</h3><div className="opt-comparison-options">{([
      ['side', 'Рядом', 'Две карты на одном масштабе'], ['swipe', 'Ползунок', 'До слева, после справа'], ['overlay', 'Наложение', 'Слои на одной карте'],
    ] as const).map(([value, title, text]) => <Button key={value} variant={state.comparison === value ? 'default' : 'outline'} aria-pressed={state.comparison === value} onClick={() => {
      store.patch({ comparison: value, ...(value !== 'overlay' && state.theme === 'gain' ? { theme: 'time' as const, showTimes: true } : {}),
        showZones: state.theme === 'attachment', compareBoundaries: value === 'overlay' && state.theme === 'attachment',
        ...(value === 'overlay' ? { scenario: 'after' as const } : {}) });
    }}><strong>{title}</strong></Button>)}</div></section>
    <section><h3>Показать</h3><div className="opt-theme-options">{([
      ['time', 'Время пути'], ['attachment', 'Зоны прикрепления'], ['gain', 'Где стало быстрее'],
    ] as const).map(([value, label]) => <Button key={value} variant={state.theme === value ? 'default' : 'outline'} aria-pressed={state.theme === value} onClick={() => theme(value)}>{label}</Button>)}</div>
      {state.comparison === 'overlay' && state.theme !== 'gain' && <div className="opt-scenario" role="group" aria-label="Какие данные показать"><Button variant={state.scenario === 'before' ? 'default' : 'outline'} aria-pressed={state.scenario === 'before'} onClick={() => store.patch({ scenario: 'before' })}>До</Button><Button variant={state.scenario === 'after' ? 'default' : 'outline'} aria-pressed={state.scenario === 'after'} onClick={() => store.patch({ scenario: 'after' })}>После</Button></div>}
      {state.theme !== 'attachment' && <label className="opt-check"><input type="checkbox" checked={state.showZones} onChange={e => store.patch({ showZones: e.target.checked })} />Границы прикреплений поверх цвета</label>}
      {state.theme !== 'attachment' && <label className="opt-check"><input type="checkbox" checked={state.focusChanges} onChange={e => store.patch({ focusChanges: e.target.checked })} />Выделить ячейки с новой больницей</label>}
      {state.comparison === 'overlay' && state.scenario === 'after' && <label className="opt-check"><input type="checkbox" checked={state.compareBoundaries} onChange={e => store.patch({ compareBoundaries: e.target.checked, showZones: true })} />Исходные границы пунктиром</label>}
      {state.showTimes && <><label htmlFor="opt-opacity">Насыщенность заливки</label><input id="opt-opacity" type="range" min="0.35" max="1" step="0.05" value={state.opacity} onChange={e => store.patch({ opacity: Number(e.target.value) })} /></>}
    </section>
    {state.error && <section><p className="opt-error" role="alert">{state.error}</p></section>}

  </aside><ComparisonMaps state={state} store={store} active={active} />
  </div>;
}
