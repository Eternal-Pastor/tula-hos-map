import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { root, hash } from './helpers.mjs';

const require = createRequire(import.meta.url);
const { run, loadProject, localServices } = require('../local-routing/calculate-routes.cjs');
const { B } = require('../local-routing/engine.cjs');
const input = path.join(root, 'data/full-project.json');
const graph = { image: 'test-only-graph', source: 'test-only-source', profiles: { auto: 'test-only-car', pedestrian: 'test-only-foot' } };
const identifyGraph = () => graph;

// These bounded responses exercise checkpoint integrity; they are never published
// as a recalculation or written into the application's canonical datasets.
function response(url, code = 'Ok') {
  const points = new URL(url).pathname.split('/').at(-1).split(';').map(point => point.split(',').map(Number));
  return {
    ok: code === 'Ok', status: code === 'Ok' ? 200 : 400,
    json: async () => code === 'Ok'
      ? { code, routes: [{ duration: 123.4, geometry: { type: 'LineString', coordinates: points } }], waypoints: [{ distance: 10 }, { distance: 20 }] }
      : { code },
  };
}

test('standalone routing CLI loads the canonical project after the React migration', async () => {
  const project = await loadProject(input);
  assert.equal(project.hospitals.length, 38);
  assert.equal(project.plan.records.filter(record => record.type === 'route').length, 4587);
  assert.equal(await B.digest(project.raw.payload), project.raw.checksum);
  assert.throws(() => localServices({ auto: 'https://router.project-osrm.org/route/v1/driving' }), /restricted to local/);
});

test('fresh auto run ignores old auto answers, then resumes only its own saved responses', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'hospital-routing-test-'));
  const output = path.join(temporary, 'result.json');
  const before = await readFile(input);
  const queried = new Set();
  let calls = 0;
  const fetcher = async url => {
    assert.match(url, /^http:\/\/localhost:5000\/route\/v1\/driving\//);
    assert.equal(new URL(url).searchParams.get('radiuses'), '1000;1000');
    assert.ok(!queried.has(url), 'resume must not request a saved response again');
    queried.add(url); calls++;
    return response(url, calls === 2 ? 'NoSegment' : 'Ok');
  };
  const options = { input, output, modes: ['auto'], concurrency: 1, identifyGraph, fetcher };
  try {
    const first = await run({ ...options, limit: 5, fresh: true });
    assert.deepEqual([first.cached, first.completed, first.total, calls], [0, 5, 1942, 5]);
    assert.equal(first.complete, false);
    assert.equal(first.fresh, true);
    assert.deepEqual(first.results.auto, { found: 4, NoRoute: 0, NoSegment: 1 });
    const backup = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(await B.digest(backup.payload), backup.checksum);
    assert.equal(backup.payload.routing.recalculation.runId, first.runId);
    const original = JSON.parse(before);
    assert.deepEqual(backup.payload.records.filter(record => record.mode === 'pedestrian'), original.payload.records.filter(record => record.mode === 'pedestrian'));
    await assert.rejects(run({ ...options, fresh: true, limit: 1 }), /requires a new output/);
    const second = await run({ ...options, limit: 7 });
    assert.deepEqual([second.cached, second.completed, calls], [5, 12, 12]);
    assert.equal(second.runId, first.runId);
    assert.equal(second.inputChecksum, original.checksum);
    assert.equal(hash(await readFile(input)), hash(before));
    await assert.rejects(run({ ...options, limit: 1, identifyGraph: () => ({ ...graph, image: 'another-graph' }) }), /Checkpoint.*has changed/);
    assert.equal(calls, 12);
  } finally {
    assert.equal(path.dirname(temporary), tmpdir());
    await rm(temporary, { recursive: true, force: true });
  }
});

test('stop saves new responses; network errors are not saved as unreachable', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'hospital-routing-test-'));
  const output = path.join(temporary, 'result.json');
  const controller = new AbortController();
  let calls = 0;
  const options = { input, output, modes: ['auto'], concurrency: 1, identifyGraph };
  try {
    await assert.rejects(run({ ...options, signal: controller.signal, fetcher: async url => {
      calls++;
      if (calls === 3) controller.abort();
      return response(url);
    } }), { name: 'AbortError' });
    const checkpoint = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(checkpoint.payload.records.filter(record => record.mode === 'auto' && record.routingService === 'http://localhost:5000/route/v1/driving').length, 3);
    assert.equal(await B.digest(checkpoint.payload), checkpoint.checksum);
    await assert.rejects(run({ ...options, fetcher: async () => { throw new TypeError('offline'); } }), /Нет ответа OSRM/);
    const receipt = JSON.parse(await readFile(path.join(temporary, 'result.receipt.json'), 'utf8'));
    assert.deepEqual([receipt.cached, receipt.completed, receipt.found, receipt.unreachable], [3, 3, 3, 0]);
    assert.equal(receipt.complete, false);
    assert.equal(receipt.results.auto.NoRoute, 0);
    assert.equal(receipt.results.auto.NoSegment, 0);
  } finally {
    assert.equal(path.dirname(temporary), tmpdir());
    await rm(temporary, { recursive: true, force: true });
  }
});
