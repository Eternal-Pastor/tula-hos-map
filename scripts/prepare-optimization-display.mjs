import { readFile, writeFile, rename } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFile(path.join(root, file));
const hash = value => createHash('sha256').update(value).digest('hex');
export async function prepareDisplay() {
  const ctx = { console, performance, navigator: { userAgent: 'offline-display' } }; ctx.window = ctx; ctx.self = ctx; vm.createContext(ctx);
  for (const file of ['vendor/d3-delaunay.min.js', 'vendor/clipper.js', 'territories.js', 'zones.js', 'accessibility.js', 'optimization.js'])
    vm.runInContext((await read('src/engine/' + file)).toString(), ctx);
  const { cells } = JSON.parse(gunzipSync(await read('public/optimization/grid.json.gz')));
  const meta = JSON.parse(await read('public/optimization/prepared-meta.json'));
  const band = n => n == null ? 4 : n <= 900 ? 0 : n <= 1800 ? 1 : n <= 3600 ? 2 : 3;
  for (const mode of ['auto', 'pedestrian']) {
    const file = 'public/optimization/' + meta.results[mode].file;
    const text = gunzipSync(await read(file)).toString();
    if (hash(text) !== meta.results[mode].checksum) throw new Error('Prepared result checksum mismatch.');
    const result = JSON.parse(text); result.display = {};
    for (const scenario of ['before', 'after']) {
      const groups = new Map();
      const rows = result.solution.rows.map(r => {
        const id = scenario === 'before' ? r.beforeId : r.afterId;
        const seconds = scenario === 'before' ? r.beforeSeconds : r.afterSeconds;
        const b = band(seconds), key = JSON.stringify([id, b]);
        groups.set(key, { organizationId: id, band: b });
        return { cellId: r.cellId, afterId: key };
      });
      const polygons = ctx.HospitalOptimization.outlines(cells, rows);
      result.display[scenario] = polygons.flatMap(([key, shapes]) => shapes.map((geometry, i) => ({
        id: key + ':' + i, ...groups.get(key), geometry })));
      console.log(JSON.stringify({ mode, stage: 'display', scenario, polygons: result.display[scenario].length }));
    }
    const updated = JSON.stringify(result);
    await writeFile(path.join(root, file + '.writing'), gzipSync(updated, { level: 9 }));
    await rename(path.join(root, file + '.writing'), path.join(root, file));
    meta.results[mode].checksum = hash(updated);
    meta.results[mode].displayPolygons = { before: result.display.before.length, after: result.display.after.length };
  }
  await writeFile(path.join(root, 'public/optimization/prepared-meta.json'), JSON.stringify(meta, null, 2) + '\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareDisplay();
