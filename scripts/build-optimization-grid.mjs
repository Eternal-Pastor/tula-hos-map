import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFile(path.join(root, file), 'utf8');
const ctx = { console, performance, navigator: { userAgent: 'grid-builder' } }; ctx.window = ctx; ctx.self = ctx; vm.createContext(ctx);
for (const file of ['vendor/d3-delaunay.min.js','vendor/clipper.js','territories.js','zones.js','accessibility.js','optimization.js'])
  vm.runInContext(await read('src/engine/' + file), ctx);
vm.runInContext(await read('public/viewer-data.js'), ctx);
const snapshot = JSON.parse(gunzipSync(Buffer.from(ctx.HospitalViewerData.data, 'base64')));
const cities = JSON.parse(await read('public/optimization/cities.geojson'));
const cells = ctx.HospitalOptimization.adaptiveGrid(new Map(snapshot.zones), cities.features.map(f => f.geometry.coordinates),
  value => console.log(JSON.stringify(value)));
const hash = text => createHash('sha256').update(text).digest('hex');
const identity = { snapshot: ctx.HospitalViewerData.checksum, cities: hash(JSON.stringify(cities)), algorithm: 'urban-250-rural-2000-v1' };
const json = JSON.stringify({ version: 1, identity, cells });
await writeFile(path.join(root, 'public/optimization/grid.json.gz'), gzipSync(json, { level: 9 }));
await writeFile(path.join(root, 'public/optimization/grid-meta.json'), JSON.stringify({ ...identity, checksum: hash(json), cells: cells.length,
  urban: cells.filter(c => c.step === 250).length, rural: cells.filter(c => c.step === 2000).length }, null, 2) + '\n');
console.log('Adaptive grid saved:', cells.length);
