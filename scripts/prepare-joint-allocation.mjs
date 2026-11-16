import { readFile, writeFile, rename } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jointAllocation } from '../src/optimization/joint-allocation.js';
import { prepareDisplay } from './prepare-optimization-display.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFile(path.join(root, file));
const hash = value => createHash('sha256').update(value).digest('hex');
async function atomic(file, value) { await writeFile(path.join(root, file + '.writing'), value); await rename(path.join(root, file + '.writing'), path.join(root, file)); }
export async function prepareJointAllocation() {
  const ctx = { console, performance, navigator: { userAgent: 'joint-allocation' } }; ctx.window = ctx; ctx.self = ctx; vm.createContext(ctx);
  for (const file of ['vendor/d3-delaunay.min.js', 'vendor/clipper.js', 'territories.js', 'zones.js', 'accessibility.js', 'optimization.js'])
    vm.runInContext((await read('src/engine/' + file)).toString(), ctx);
  const cells = JSON.parse(gunzipSync(await read('public/optimization/grid.json.gz'))).cells;
  const meta = JSON.parse(await read('public/optimization/prepared-meta.json'));
  const auto = JSON.parse(gunzipSync(await read('data/optimization/auto-completed-matrix.json.gz')));
  const pedestrian = JSON.parse(gunzipSync(await read('data/optimization/pedestrian-completed-matrix.json.gz')));
  if (JSON.stringify(auto.rows) !== JSON.stringify(pedestrian.rows) || JSON.stringify(auto.columns) !== JSON.stringify(pedestrian.columns) ||
    !cells.every((c, i) => c.id === auto.rows[i])) throw new Error('Matrix cell/hospital ordering mismatch.');
  const hospitals = auto.columns.map(id => ({ id }));
  const joint = jointAllocation(cells, hospitals, { auto: auto.values, pedestrian: pedestrian.values });
  const zones = ctx.HospitalOptimization.outlines(cells, joint.solutions.auto.rows);
  const allocation = { version: 1, grid: meta.grid, summary: joint.summary, assignments: joint.assignments };
  const allocationText = JSON.stringify(allocation), allocationChecksum = hash(allocationText);
  await atomic('data/optimization/joint-allocation.json.gz', gzipSync(allocationText, { level: 9 }));
  for (const mode of ['auto', 'pedestrian']) {
    const fingerprint = hash(JSON.stringify({ data: meta.identity, mode, allocation: allocationChecksum }));
    const result = { solution: joint.solutions[mode], zones, mode, at: meta.results[mode].at, fingerprint, allocation: joint.summary };
    const text = JSON.stringify(result);
    await atomic('public/optimization/' + meta.results[mode].file, gzipSync(text, { level: 9 }));
    meta.results[mode] = { ...meta.results[mode], checksum: hash(text), fingerprint, summary: result.solution.summary };
    console.log(JSON.stringify({ mode, summary: result.solution.summary }));
  }
  meta.allocation = { ...joint.summary, checksum: allocationChecksum, at: new Date().toISOString() };
  await atomic('public/optimization/prepared-meta.json', JSON.stringify(meta, null, 2) + '\n');
  console.log(JSON.stringify({ allocation: meta.allocation }));
  await prepareDisplay();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareJointAllocation();
