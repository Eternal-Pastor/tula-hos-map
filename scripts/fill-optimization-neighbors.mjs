import { readFile, writeFile, rename } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillMatrixFromNeighbors } from '../src/optimization/neighbor-mean.js';
import { prepareJointAllocation } from './prepare-joint-allocation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFile(path.join(root, file));
const hash = value => createHash('sha256').update(value).digest('hex');
async function atomic(file, bytes) { await writeFile(path.join(root, file + '.writing'), bytes); await rename(path.join(root, file + '.writing'), path.join(root, file)); }
export async function fillPreparedResults() {
  const ctx = { console, performance, navigator: { userAgent: 'neighbor-completion' } }; ctx.window = ctx; ctx.self = ctx; vm.createContext(ctx);
  for (const file of ['vendor/d3-delaunay.min.js', 'vendor/clipper.js', 'territories.js', 'zones.js', 'accessibility.js', 'optimization.js'])
    vm.runInContext((await read('src/engine/' + file)).toString(), ctx);
  vm.runInContext((await read('public/viewer-data.js')).toString(), ctx);
  const snapshot = JSON.parse(gunzipSync(Buffer.from(ctx.HospitalViewerData.data, 'base64')));
  const cells = JSON.parse(gunzipSync(await read('public/optimization/grid.json.gz'))).cells;
  const baseline = snapshot.hospitals.map(h => ({ id: h.id, organizationId: h.id, coords: h.coords }));
  const meta = JSON.parse(await read('public/optimization/prepared-meta.json'));
  for (const mode of ['auto', 'pedestrian']) {
    const raw = await read(`data/optimization/${mode}-matrix.json.gz`), matrix = JSON.parse(gunzipSync(raw));
    if (matrix.rows.length !== cells.length || !cells.every((c, i) => c.id === matrix.rows[i]) ||
      JSON.stringify(matrix.columns) !== JSON.stringify(baseline.map(h => h.id))) throw new Error('Matrix does not match the fixed grid and hospitals.');
    const completed = fillMatrixFromNeighbors(cells, matrix.values, matrix.columns.length, 8,
      (count, total) => console.log(JSON.stringify({ mode, stage: 'mean', count, total })));
    const rowIndex = new Map(cells.map((c, i) => [c.id, i])), columns = new Map(baseline.map((h, i) => [h.id, i]));
    const solution = ctx.HospitalOptimization.solve(cells, baseline, baseline,
      (cell, hospital) => completed.values[rowIndex.get(cell.id) * baseline.length + columns.get(hospital.id)]);
    if (solution.summary.pending || solution.summary.unreachable || solution.summary.worsened) throw new Error('Completed solution is invalid.');
    const zones = ctx.HospitalOptimization.outlines(cells, solution.rows);
    const receipt = JSON.parse(await read(`data/optimization/${mode}-receipt.json`));
    const fingerprint = hash(JSON.stringify({ algorithm: completed.method, data: meta.identity, mode, matrix: hash(raw) }));
    const result = { solution, zones, mode, at: receipt.at, fingerprint };
    const text = JSON.stringify(result);
    await atomic('public/optimization/' + meta.results[mode].file, gzipSync(text, { level: 9 }));
    await atomic(`data/optimization/${mode}-completed-matrix.json.gz`, gzipSync(JSON.stringify({ ...matrix, ...completed }), { level: 9 }));
    const filled = new Set(completed.inferredIndices);
    const filledBefore = solution.rows.filter((r, i) => filled.has(i * baseline.length + columns.get(r.beforeId))).length;
    const filledAfter = solution.rows.filter((r, i) => filled.has(i * baseline.length + columns.get(r.afterId))).length;
    meta.results[mode] = { ...meta.results[mode], checksum: hash(text), fingerprint, summary: solution.summary,
      completion: { method: completed.method, at: new Date().toISOString(), pairs: completed.inferredIndices.length,
        before: filledBefore, after: filledAfter, measuredSummary: receipt.summary } };
    console.log(JSON.stringify({ mode, stage: 'filled', cells: solution.summary.cells, filledBefore, filledAfter, summary: solution.summary }));
  }
  await atomic('public/optimization/prepared-meta.json', JSON.stringify(meta, null, 2) + '\n');
  await prepareJointAllocation();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await fillPreparedResults();
