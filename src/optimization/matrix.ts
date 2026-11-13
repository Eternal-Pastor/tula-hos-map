import type { YandexPoint } from '../types/domain';
import type { MatrixEntry } from './types';

export const pointKey = (p: YandexPoint) => p.map(n => n.toFixed(7)).join(',');
export const pairKey = (a: YandexPoint, b: YandexPoint) => pointKey(a) + '>' + pointKey(b);
export function localTableEndpoint(service: string) {
  const url = new URL(service);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
    !/^\/route\/v1\/[^/]+\/?$/.test(url.pathname)) throw new Error('Массовый расчёт разрешён только на локальном OSRM.');
  return url.href.replace('/route/v1/', '/table/v1/').replace(/\/$/, '');
}

/** No fallback_speed: unavailable routes never compete with measured routes. */
export async function table(service: string, sources: YandexPoint[], destinations: YandexPoint[], signal: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<(number | null)[][]> {
  const endpoint = localTableEndpoint(service);
  signal.throwIfAborted();
  const coords = [...sources, ...destinations];
  const params = new URLSearchParams({ annotations: 'duration', generate_hints: 'false',
    sources: sources.map((_, i) => i).join(';'), destinations: destinations.map((_, i) => sources.length + i).join(';'),
    radiuses: coords.map(() => '1000').join(';') });
  const controller = new AbortController(), abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetcher(endpoint + '/' + coords.map(([lat, lon]) => lon + ',' + lat).join(';') + '?' + params,
      { signal: controller.signal, credentials: 'omit', cache: 'no-store' });
    const body = await response.json();
    if (['NoSegment', 'TooBig'].includes(body.code)) {
      if (sources.length === 1 && destinations.length === 1) {
        if (body.code === 'NoSegment') return [[null]];
        throw new Error('OSRM отклонил матрицу из одной пары.');
      }
      if (sources.length >= destinations.length && sources.length > 1) {
        const cut = Math.ceil(sources.length / 2);
        return [...await table(service, sources.slice(0, cut), destinations, signal, fetcher),
          ...await table(service, sources.slice(cut), destinations, signal, fetcher)];
      }
      const cut = Math.ceil(destinations.length / 2);
      const left = await table(service, sources, destinations.slice(0, cut), signal, fetcher);
      const right = await table(service, sources, destinations.slice(cut), signal, fetcher);
      return left.map((row, i) => [...row, ...right[i]]);
    }
    if (body.code === 'NoTable') return sources.map(() => destinations.map(() => null));
    if (!response.ok || body.code !== 'Ok') throw new Error(`OSRM: HTTP ${response.status}, ${String(body.code || 'неверный ответ').slice(0, 50)}.`);
    if (body.fallback_speed_cells?.length) throw new Error('OSRM вернул оценки вместо дорожных времён.');
    if (!Array.isArray(body.durations) || body.durations.length !== sources.length ||
      body.durations.some((row: unknown) => !Array.isArray(row) || row.length !== destinations.length ||
        row.some(n => n !== null && (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 604800))))
      throw new Error('OSRM вернул некорректную матрицу времени.');
    for (const [key, count] of [['sources', sources.length], ['destinations', destinations.length]] as const)
      if (!Array.isArray(body[key]) || body[key].length !== count || body[key].some((p: { distance: number }) =>
        !Number.isFinite(p?.distance) || p.distance < 0 || p.distance > 1001))
        throw new Error('Некорректная привязка к дорожной сети.');
    return body.durations;
  } catch (error) {
    if (signal.aborted) throw new DOMException('Расчёт остановлен.', 'AbortError');
    if (controller.signal.aborted) throw new Error('Локальный OSRM не ответил за 45 секунд.');
    if (error instanceof TypeError) throw new Error('Нет соединения с локальным OSRM. Запустите нужный профиль и проверьте CORS.');
    throw error;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

export async function runMatrix(options: { service: string; sources: YandexPoint[]; destinations: YandexPoint[];
  cache: Map<string, number | null>; signal: AbortSignal; save: (batch: MatrixEntry[]) => Promise<void>;
  progress: (count: number, total: number) => void; request?: typeof table }) {
  localTableEndpoint(options.service);
  const sources = [...new Map(options.sources.map(p => [pointKey(p), p])).values()];
  const destinations = [...new Map(options.destinations.map(p => [pointKey(p), p])).values()];
  const total = sources.length * destinations.length;
  let count = sources.reduce((sum, a) => sum + destinations.filter(b => options.cache.has(pairKey(a, b))).length, 0);
  options.progress(count, total);
  // Bounded sequential requests keep pause/resume precise and memory predictable.
  for (let i = 0; i < sources.length; i += 32) for (let j = 0; j < destinations.length; j += 32) {
    options.signal.throwIfAborted();
    const a = sources.slice(i, i + 32), b = destinations.slice(j, j + 32);
    if (a.every(p => b.every(q => options.cache.has(pairKey(p, q))))) continue;
    const values = await (options.request || table)(options.service, a, b, options.signal);
    const batch: MatrixEntry[] = [];
    a.forEach((p, x) => b.forEach((q, y) => {
      const key = pairKey(p, q);
      if (!options.cache.has(key)) { batch.push({ key, seconds: values[x][y] }); count++; }
    }));
    // Persist before advancing: a failed write must not masquerade as a resumable checkpoint.
    await options.save(batch);
    batch.forEach(r => options.cache.set(r.key, r.seconds));
    options.progress(count, total);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}
