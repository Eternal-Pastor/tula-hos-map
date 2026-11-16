import { useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import type { Polygon } from '@/types/domain';
import type { OptimizationState, OptimizationStore } from './store';
const number = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
const minutes = (n: number | null | undefined) => n == null ? '—' : Math.round(n / 60).toLocaleString('ru-RU') + ' мин';
function area(polygons: Polygon[]) {
  const radians = Math.PI / 180;
  const ringArea = (ring: number[][]) => {
    let sum = 0;
    for (let i = 1; i < ring.length; i++) sum += (ring[i][0] - ring[i - 1][0]) * radians * (2 + Math.sin(ring[i - 1][1] * radians) + Math.sin(ring[i][1] * radians));
    return Math.abs(sum * 6371.0088 ** 2 / 2);
  };
  return polygons.reduce((sum, p) => sum + Math.max(0, ringArea(p[0]) - p.slice(1).reduce((s, r) => s + ringArea(r), 0)), 0);
}
export function MapCard({ state, store }: { state: OptimizationState; store: OptimizationStore }) {
  const close = useRef<HTMLButtonElement>(null), card = state.card;
  const hospital = card?.kind === 'hospital' ? store.getHospital(card.id) : undefined;
  const zoneAfter = useMemo(() => card?.kind === 'hospital' && state.result ? area(state.result.zones.find(([id]) => id === card.id)?.[1] || []) : null,
    [card, state.result]);
  useEffect(() => { if (card) close.current?.focus({ preventScroll: true }); }, [card]);
  useEffect(() => {
    if (!card) return;
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') store.patch({ card: null }); };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [card, store]);
  if (!card) return null;
  const row = card.kind === 'cell' ? state.result?.solution.rows.find(r => r.cellId === card.id) : undefined;
  const title = card.kind === 'hospital' ? hospital?.name || 'Больница' : 'До и после';
  const before = row ? store.getHospital(row.beforeId)?.name : '', after = row?.afterId ? store.getHospital(row.afterId)?.name : '';
  return <aside className="opt-info-card" role="dialog" aria-modal="false" aria-labelledby="opt-card-title">
    <div className="opt-info-header"><h3 id="opt-card-title">{title}</h3><Button ref={close} variant="ghost" size="icon" aria-label="Закрыть карточку" onClick={() => store.patch({ card: null })}><span aria-hidden="true">×</span></Button></div>
    <div className="opt-info-body">
      {hospital && <dl className="opt-hospital-metrics">
        <div><dt>Прикреплено на 1 000 жителей</dt><dd>{number(hospital.per1000)}</dd></div>
        <div><dt>Зона до</dt><dd>{number(hospital.areaKm2)} км²</dd></div>
        <div><dt>Зона после</dt><dd>{number(zoneAfter)} км²</dd></div>
        <div><dt>Плановая пропускная способность</dt><dd>{number(hospital.capacity)}<small>посещений / смену</small></dd></div>
      </dl>}
      {row && <><div className="opt-cell-comparison"><section><span>До</span><h4>{before}</h4><strong>{minutes(row.beforeSeconds)}</strong></section>
        <section><span>После</span><h4>{after}</h4><strong>{minutes(row.afterSeconds)}</strong></section></div>
        <p className={'opt-card-change' + ((row.deltaSeconds ?? 0) < 0 ? ' is-increase' : '')}>{row.deltaSeconds == null ? '—' : Math.abs(row.deltaSeconds) <= 0.01 ? 'Время не изменилось' :
          `${row.deltaSeconds > 0 ? 'Быстрее' : 'Дольше'} на ${minutes(Math.abs(row.deltaSeconds))}`}</p></>}
    </div>
  </aside>;
}
