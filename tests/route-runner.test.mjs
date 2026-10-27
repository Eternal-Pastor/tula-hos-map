import test from 'node:test';
import assert from 'node:assert/strict';
import { transform } from 'esbuild';
import { read, context, engineFiles, snapshot } from './helpers.mjs';

// Use the same TS compiler as the build; tests also work on Node.js 22.12.
const compiledRunner = await transform(read('src/services/route-runner.ts').toString(), { loader: 'ts', format: 'esm', target: 'es2022' });
const { runRoutes } = await import(`data:text/javascript;base64,${Buffer.from(compiledRunner.code).toString('base64')}`);

const E = context(engineFiles);
const A = E.HospitalAccessibility;
const { data: S } = snapshot();
const knownIds = new Set(S.hospitals.map(h => h.id));
const destinations = new Map(S.hospitals.map(h => [h.id, h.coords]));
const source = new Map(S.routes.map(r => [r.key, r]));
const jobs = A.pending(S.cells, destinations, new Map(), ['auto', 'pedestrian'], S.services).slice(0, 120);

test('real route runner stops, flushes the partial batch, then resumes both modes without querying saved routes', async () => {
  const controller = new AbortController(), records = new Map(), disk = new Map();
  const queried = [], batches = [];
  const common = {
    jobs, records, knownIds, services: S.services, normalize: A.record, concurrency: 1, batchSize: 50,
    saveBatch: async batch => {
      if (batch.length) batches.push(batch.length);
      for (const r of batch) disk.set(r.key, r);
    },
    requestRoute: async (_service, job, signal) => {
      assert.equal(signal.aborted, false);
      queried.push(job.key);
      return source.get(job.key);
    },
  };
  const first = await runRoutes({ ...common, signal: controller.signal, onProgress: count => { if (count === 57) controller.abort(); } });
  assert.deepEqual(first, { stopped: true, count: 57, total: 120 });
  assert.deepEqual(batches, [50, 7]);
  assert.equal(disk.size, 57);
  assert.ok([...disk.values()].some(r => r.status === 'unreachable'));
  const firstKeys = new Set(disk.keys());
  queried.length = 0;
  const restored = new Map(disk);
  const second = await runRoutes({ ...common, records: restored, signal: new AbortController().signal, onProgress: () => {} });
  assert.deepEqual(second, { stopped: false, count: 120, total: 120 });
  assert.equal(queried.length, 63);
  assert.ok(queried.every(key => !firstKeys.has(key)));
  assert.deepEqual(new Set([...disk.values()].map(r => r.mode)), new Set(['auto', 'pedestrian']));
  assert.equal(disk.size, 120);
  assert.ok([...disk.values()].every(r => r.provider === 'osrm' && !r.model));
});

test('failed batch persistence stops requests and retry saves memory results before more network work', async () => {
  const records = new Map(), persisted = new Map();
  const failure = new Error('disk-full');
  let shouldFail = true, requests = 0;
  const options = {
    jobs, records, knownIds, services: S.services, normalize: A.record, concurrency: 1, batchSize: 10,
    signal: new AbortController().signal, onProgress: () => {},
    saveBatch: async batch => {
      if (batch.length && shouldFail) throw failure;
      for (const r of batch) persisted.set(r.key, r);
    },
    requestRoute: async (_service, job) => { requests++; return source.get(job.key); },
  };
  await assert.rejects(runRoutes(options), failure);
  assert.ok(records.size >= 10 && records.size < jobs.length);
  const inMemory = new Set(records.keys()), firstRequests = requests;
  shouldFail = false;
  await runRoutes({ ...options, requestRoute: async (_service, job) => {
    assert.ok([...inMemory].every(key => persisted.has(key)), 'memory must reach disk before additional requests');
    assert.equal(inMemory.has(job.key), false);
    requests++;
    return source.get(job.key);
  } });
  assert.equal(requests - firstRequests, jobs.length - inMemory.size);
  assert.equal(persisted.size, 120);
});
