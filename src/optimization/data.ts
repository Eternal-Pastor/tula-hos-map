import { unpackSnapshot } from '../services/viewer-data';
import type { Facility, GridCell, OptimizationResult } from './types';
import type { YandexPoint } from '../types/domain';
export const validCoords = (point: unknown): point is YandexPoint => Array.isArray(point) && point.length === 2 &&
  point.every(n => typeof n === 'number' && Number.isFinite(n)) && point[0] >= 52.4 && point[0] <= 55.4 && point[1] >= 35 && point[1] <= 39.8;
export async function digest(value: unknown) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function json(file: string) {
  const response = await fetch(new URL('optimization/' + file, document.baseURI));
  if (!response.ok) throw new Error('Не удалось загрузить ' + file);
  return response.json();
}
export async function loadOptimizationData() {
  const [snapshot, registry, meta] = await Promise.all([unpackSnapshot(window.HospitalViewerData), json('facilities.json'), json('grid-meta.json')]);
  const response = await fetch(new URL('optimization/grid.json.gz', document.baseURI));
  if (!response.ok || !response.body) throw new Error('Не удалось загрузить сетку оптимизации.');
  const text = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).text();
  if (await digest(text) !== meta.checksum || meta.snapshot !== window.HospitalViewerData.checksum) throw new Error('Сетка не соответствует исходной карте.');
  const grid = JSON.parse(text) as { cells: GridCell[] };
  const baseline: Facility[] = snapshot.hospitals.map(h => ({ id: h.id, organizationId: h.id, organization: h.name, name: h.name,
    address: 'Исходная точка из сохранённой карты', type: 'Исходная больница', coords: h.coords, confirmed: false, suggested: false, legacy: true }));
  return { snapshot, meta, identity: await digest({ grid: meta.checksum, registry: registry.sha256 }),
    cells: grid.cells, facilities: [...registry.facilities as Facility[], ...baseline], baseline };
}
export async function loadPreparedResult(mode: 'auto' | 'pedestrian', data: Awaited<ReturnType<typeof loadOptimizationData>>) {
  const meta = await json('prepared-meta.json');
  const item = meta.results?.[mode];
  if (meta.version !== 1 || meta.identity !== data.identity || meta.grid !== data.meta.checksum ||
    JSON.stringify(meta.candidates) !== JSON.stringify(data.baseline.map(f => f.id)) ||
    item?.file !== `prepared-${mode}.json.gz`) throw new Error('Готовый расчёт не соответствует сетке или исходным 38 больницам.');
  const response = await fetch(new URL('optimization/' + item.file, document.baseURI));
  if (!response.ok || !response.body) throw new Error('Не удалось загрузить готовый расчёт.');
  const text = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).text();
  if (await digest(text) !== item.checksum) throw new Error('Контрольная сумма готового расчёта не совпала.');
  const result = JSON.parse(text) as OptimizationResult;
  if (result.mode !== mode || result.fingerprint !== item.fingerprint || result.solution.rows.length !== data.cells.length || result.solution.summary.pending)
    throw new Error('Готовый расчёт повреждён или неполон.');
  return result;
}
export function applyFacilitySettings(facilities: Facility[], settings: unknown): Facility[] {
  if (!Array.isArray(settings)) throw new Error('Неверный формат перечня объектов.');
  const ids = new Set(facilities.map(f => f.id)), seen = new Set<string>();
  for (const item of settings) {
    if (!item || !ids.has(item.id) || seen.has(item.id) || typeof item.confirmed !== 'boolean' ||
      (item.coords !== null && !validCoords(item.coords)) || (item.confirmed && !validCoords(item.coords)))
      throw new Error('Проверьте ID, координаты и подтверждения объектов.');
    seen.add(item.id);
  }
  const map = new Map(settings.map(s => [s.id, s]));
  return facilities.map(f => map.has(f.id) ? { ...f, coords: map.get(f.id).coords, confirmed: map.get(f.id).confirmed } : f);
}
export const facilitySettings = (facilities: Facility[]) => facilities.map(({ id, coords, confirmed }) => ({ id, coords, confirmed }));
export function download(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type })), link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exportFacilities(facilities: Facility[]) {
  const quote = (v: unknown) => '"' + String(v ?? '').replaceAll('"', '""') + '"';
  return '\uFEFFid;organization;name;address;latitude;longitude;confirmed\r\n' + facilities.map(f =>
    [f.id, f.organization, f.name, f.address, f.coords?.[0], f.coords?.[1], f.confirmed ? '1' : '0'].map(quote).join(';')).join('\r\n');
}
export function importFacilities(text: string, facilities: Facility[]) {
  const rows: string[][] = []; let row: string[] = [], value = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ';' || c === '\n' || c === undefined)) {
      row.push(value.replace(/\r$/, '')); value = '';
      if (c !== ';') { if (row.some(Boolean)) rows.push(row); row = []; }
    } else value += c;
  }
  if (quoted || rows[0]?.join(';') !== 'id;organization;name;address;latitude;longitude;confirmed') throw new Error('Используйте выданный CSV-шаблон, сохранив его заголовки.');
  return applyFacilitySettings(facilities, rows.slice(1).map(r => {
    if (r.length !== 7 || !['0', '1'].includes(r[6])) throw new Error('В confirmed допустимы только 0 и 1.');
    return { id: r[0], coords: !r[4] && !r[5] ? null : [Number(r[4].replace(',', '.')), Number(r[5].replace(',', '.'))], confirmed: r[6] === '1' };
  }));
}
