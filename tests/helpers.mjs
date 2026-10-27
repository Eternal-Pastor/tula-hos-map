import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { gunzipSync } from 'node:zlib';
import { createHash, webcrypto } from 'node:crypto';
import { Worker } from 'node:worker_threads';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const read = file => readFileSync(resolve(root, file));
export const hash = value => createHash('sha256').update(value).digest('hex');
export const plain = value => JSON.parse(JSON.stringify(value));

export function context(files, extra = {}) {
  const sandbox = {
    console, URL, URLSearchParams, TextEncoder, TextDecoder, crypto: webcrypto,
    setTimeout, clearTimeout, AbortController, DOMException, performance, Map, Set,
    navigator: { userAgent: 'regression-tests' },
    ...extra,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const file of files) vm.runInContext(read(file).toString(), sandbox, { filename: file });
  return sandbox;
}

export const engineFiles = [
  'src/engine/vendor/d3-delaunay.min.js', 'src/engine/vendor/clipper.js',
  'src/engine/territories.js', 'src/engine/zones.js', 'src/engine/accessibility.js',
  'src/engine/core.js', 'src/engine/viewer-core.js', 'src/engine/cache.js',
  'src/engine/backup.js', 'src/engine/routing-osrm.js', 'src/engine/zone-jobs.js',
];

export function snapshot() {
  const pack = context(['public/viewer-data.js']).HospitalViewerData;
  const json = gunzipSync(Buffer.from(pack.data, 'base64')).toString();
  return { pack, json, data: JSON.parse(json) };
}

/** Execute the actual classic production Worker bundle in a separate JS thread. */
export function workerRequest(name, message) {
  const source = read(`public/workers/${name}.js`).toString();
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const vm = require('node:vm');
    const ctx = { console, performance, setTimeout, clearTimeout, Map, Set, navigator: { userAgent: 'regression-worker' } };
    ctx.self = ctx;
    ctx.postMessage = message => parentPort.postMessage(message);
    vm.createContext(ctx);
    vm.runInContext(workerData, ctx);
    parentPort.on('message', data => ctx.onmessage({ data }));
  `, { eval: true, workerData: source });
  return new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => { worker.terminate(); reject(new Error(`${name}: worker timeout`)); }, 45000);
    worker.on('error', error => { clearTimeout(timer); worker.terminate(); reject(error); });
    worker.on('message', response => {
      if (response.type === 'progress') return;
      clearTimeout(timer);
      worker.terminate();
      response.error ? reject(new Error(response.error)) : resolveResult(response);
    });
    worker.postMessage(message);
  });
}
