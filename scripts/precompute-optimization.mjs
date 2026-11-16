// Offline preparation. The shipped browser loads the resulting files, never this script.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--routing-root') throw new Error('Usage: node scripts/precompute-optimization.mjs --routing-root PATH_TO_PREPARED_LOCAL_ROUTING');
const routingRoot = path.resolve(args[1]);
const read = file => readFile(path.join(root, file));
const hash = value => createHash('sha256').update(value).digest('hex');
async function graphIdentity() {
  const files = ['runtime/osrm-image.txt', 'osrm/region.source', 'osrm/car/prepared.txt', 'osrm/foot/prepared.txt'];
  return Object.fromEntries(await Promise.all(files.map(async file => [file, (await readFile(path.join(routingRoot, file), 'utf8')).trim()])));
}
const graph = await graphIdentity();
const ctx = { console, performance, navigator: { userAgent: 'offline-routing' } }; ctx.window = ctx; ctx.self = ctx; vm.createContext(ctx);
for (const file of ['vendor/d3-delaunay.min.js', 'vendor/clipper.js', 'territories.js', 'zones.js', 'accessibility.js', 'optimization.js'])
  vm.runInContext((await read('src/engine/' + file)).toString(), ctx);
vm.runInContext((await read('public/viewer-data.js')).toString(), ctx);
const snapshot = JSON.parse(gunzipSync(Buffer.from(ctx.HospitalViewerData.data, 'base64')));
const meta = JSON.parse(await read('public/optimization/grid-meta.json'));
const gridText = gunzipSync(await read('public/optimization/grid.json.gz')).toString();
if (hash(gridText) !== meta.checksum || meta.snapshot !== ctx.HospitalViewerData.checksum) throw new Error('Grid checksum mismatch.');
const { cells } = JSON.parse(gridText), hospitals = snapshot.hospitals;
const registry = JSON.parse(await read('public/optimization/facilities.json'));
const dataIdentity = hash(JSON.stringify({ grid: meta.checksum, registry: registry.sha256 }));
const baseline = hospitals.map(h => ({ id: h.id, organizationId: h.id, coords: h.coords }));
const pairs = cells.length * hospitals.length;
const identity = { schema: 1, grid: meta.checksum, snapshot: meta.snapshot, candidates: baseline, graph,
  snapRadiusMeters: 1000, engine: hash(await read('src/engine/optimization.js')) };
const jobId = hash(JSON.stringify(identity));
const checkpoint = path.join(root, '.tmp', 'optimization-' + jobId.slice(0, 16));
await mkdir(checkpoint, { recursive: true });
await mkdir(path.join(root, 'data/optimization'), { recursive: true });
const output = path.join(root, 'public/optimization');
const artifactMeta = { version: 1, identity: dataIdentity, grid: meta.checksum, snapshot: meta.snapshot,
  candidates: hospitals.map(h => h.id), graph, snapRadiusMeters: 1000, cells: cells.length, results: {} };
const log = value => console.log(JSON.stringify({ at: new Date().toISOString(), ...value }));
const timeValue = n => n === null || typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 604800;
async function atomic(file, value) { await writeFile(file + '.writing', value); await rename(file + '.writing', file); }

for (const mode of ['auto', 'pedestrian']) {
  const service = snapshot.services[mode];
  const url = new URL(service);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Only local OSRM is allowed.');
  const endpoint = service.replace('/route/v1/', '/table/v1/');
  const started = Date.now(), values = new Array(pairs), snapFailures = new Set();
  let requests = 0;
  async function block(origins) {
    const result = origins.map(() => hospitals.map(() => null));
    let sourceIndices = origins.map((_, i) => i), destinationIndices = hospitals.map((_, i) => i);
    while (sourceIndices.length && destinationIndices.length) {
      const coords = [...sourceIndices.map(i => origins[i].origin), ...destinationIndices.map(i => hospitals[i].coords)];
      const params = new URLSearchParams({ annotations: 'duration', generate_hints: 'false',
        sources: sourceIndices.map((_, i) => i).join(';'),
        destinations: destinationIndices.map((_, i) => sourceIndices.length + i).join(';'),
        radiuses: coords.map(() => '1000').join(';') });
      const response = await fetch(endpoint + '/' + coords.map(([lat, lon]) => lon + ',' + lat).join(';') + '?' + params,
        { signal: AbortSignal.timeout(120000) });
      requests++;
      const body = await response.json();
      if (body.code === 'NoSegment') {
        // OSRM identifies the first coordinate that cannot snap within the SAME 1 km radius.
        const match = /coordinate\s+(\d+)/i.exec(body.message || '');
        if (!match || Number(match[1]) >= coords.length) throw new Error('OSRM NoSegment did not identify the failed coordinate.');
        const index = Number(match[1]);
        if (index < sourceIndices.length) {
          snapFailures.add('source:' + origins[sourceIndices[index]].id);
          sourceIndices.splice(index, 1);
        } else {
          const destinationIndex = index - sourceIndices.length;
          snapFailures.add('hospital:' + hospitals[destinationIndices[destinationIndex]].id);
          destinationIndices.splice(destinationIndex, 1);
        }
        continue;
      }
      if (body.code === 'NoTable') return result;
      if (!response.ok || body.code !== 'Ok') throw new Error(`OSRM ${mode}: HTTP ${response.status}, ${body.code}: ${body.message || ''}`);
      if (body.fallback_speed_cells?.length || !Array.isArray(body.durations) || body.durations.length !== sourceIndices.length ||
        body.durations.some(row => !Array.isArray(row) || row.length !== destinationIndices.length || row.some(n => !timeValue(n)))) throw new Error('Invalid or estimated matrix response.');
      for (const [name, count] of [['sources', sourceIndices.length], ['destinations', destinationIndices.length]])
        if (body[name]?.length !== count || body[name].some(p => !Number.isFinite(p.distance) || p.distance < 0 || p.distance > 1001)) throw new Error('Invalid road snap.');
      sourceIndices.forEach((s, i) => destinationIndices.forEach((d, j) => { result[s][d] = body.durations[i][j]; }));
      return result;
    }
    return result;
  }
  for (let i = 0; i < cells.length; i += 128) {
    const part = cells.slice(i, i + 128), file = path.join(checkpoint, `${mode}-${i}.json`);
    let batch;
    try { batch = JSON.parse(await readFile(file, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!batch) { batch = await block(part); await atomic(file, JSON.stringify(batch)); }
    if (batch.length !== part.length || batch.some(row => row.length !== hospitals.length || row.some(n => !timeValue(n)))) throw new Error('Invalid checkpoint block.');
    batch.forEach((row, r) => row.forEach((seconds, d) => { values[(i + r) * hospitals.length + d] = seconds; }));
    log({ mode, stage: 'matrix', completed: Math.min(i + 128, cells.length), total: cells.length, requests, seconds: Math.round((Date.now() - started) / 1000) });
  }
  if (values.length !== pairs || values.some(n => !timeValue(n))) throw new Error('Incomplete matrix.');
  const indices = new Map(cells.map((c, i) => [c.id, i])), targets = new Map(hospitals.map((h, i) => [h.id, i]));
  const solution = ctx.HospitalOptimization.solve(cells, baseline, baseline,
    (c, h) => values[indices.get(c.id) * hospitals.length + targets.get(h.id)]);
  if (solution.summary.pending || solution.summary.worsened) throw new Error('Incomplete solution or a worsening despite including all incumbents.');
  let reported = -1;
  const zones = ctx.HospitalOptimization.outlines(cells, solution.rows, p => {
    const percent = Math.floor(100 * p.completed / p.total);
    if (percent !== reported) { reported = percent; log({ mode, stage: 'zones', percent }); }
  });
  if (JSON.stringify(await graphIdentity()) !== JSON.stringify(graph)) throw new Error('Road graph changed during calculation.');
  const candidates = baseline.map(h => [h.id, h.coords]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const fingerprint = hash(JSON.stringify({ version: 'travel-time-v1', data: dataIdentity, mode, service,
    baseline: baseline.map(h => [h.id, h.coords]), candidates }));
  const result = { solution, zones, mode, at: new Date().toISOString(), fingerprint };
  const text = JSON.stringify(result), file = `prepared-${mode}.json.gz`;
  await atomic(path.join(output, file), gzipSync(text, { level: 9 }));
  const receipt = { ...identity, jobId, mode, service, pairs, requests, snapFailures: [...snapFailures], seconds: Math.round((Date.now() - started) / 1000), at: result.at, summary: solution.summary };
  await atomic(path.join(root, `data/optimization/${mode}-matrix.json.gz`), gzipSync(JSON.stringify({ identity, mode, columns: hospitals.map(h => h.id), rows: cells.map(c => c.id), values }), { level: 9 }));
  await atomic(path.join(root, `data/optimization/${mode}-receipt.json`), JSON.stringify(receipt, null, 2) + '\n');
  artifactMeta.results[mode] = { file, checksum: hash(text), fingerprint, at: result.at, summary: solution.summary };
  log({ mode, stage: 'ready', ...solution.summary });
}
await atomic(path.join(output, 'prepared-meta.json'), JSON.stringify(artifactMeta, null, 2) + '\n');
await (await import('./fill-optimization-neighbors.mjs')).fillPreparedResults();
log({ stage: 'complete', pairs: pairs * 2 });
