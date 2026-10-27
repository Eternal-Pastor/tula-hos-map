import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { gunzipSync } from 'node:zlib';
import { hash, read, snapshot } from './helpers.mjs';
import { preparePublication, publishRoutes } from '../scripts/publish-routes.mjs';

const require = createRequire(import.meta.url);
const { A, B } = require('../local-routing/engine.cjs');
const originalBackup = read('data/full-project.json'), originalViewer = read('public/viewer-data.js');
const source = JSON.parse(originalBackup), originalSnapshot = snapshot().data;
const clone = value => JSON.parse(JSON.stringify(value));

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hospital-map-publish-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('hospital-map-publish-test-'));
    await rm(root, { recursive: true, force: true });
  });
  await Promise.all(['data', 'public'].map(name => mkdir(path.join(root, name))));
  await Promise.all([
    writeFile(path.join(root, 'data/full-project.json'), originalBackup),
    writeFile(path.join(root, 'public/viewer-data.js'), originalViewer),
  ]);
  const jobs = A.pending(originalSnapshot.cells, new Map(originalSnapshot.hospitals.map(hospital => [hospital.id, hospital.coords])), new Map(), ['auto'], originalSnapshot.services);
  const jobsByKey = new Map(jobs.map(job => [job.key, job]));
  const identity = {
    schemaVersion: 2, fresh: true, inputChecksum: source.checksum, modes: ['auto'],
    services: clone(originalSnapshot.services), step: originalSnapshot.step,
    graph: { image: 'synthetic-test-image', source: 'test-fixture-only', profiles: { auto: 'car.lua:test' } },
    engineChecksum: hash(read('local-routing/engine.cjs')), jobKeys: jobs.map(job => job.key), runId: 'isolated-test-run',
  };
  const payload = clone(source.payload);
  payload.routing.recalculation = identity;
  const timestamp = new Date(Date.parse(source.createdAt) + 60000).toISOString();
  payload.records = payload.records.map(record => {
    const job = jobsByKey.get(record.key);
    return job ? { ...record, origin: clone(job.cell.origin), destination: clone(job.destination), at: timestamp,
      seconds: record.status === 'found' ? record.seconds + 42 : null } : record;
  });
  const backup = await B.create(payload);
  const counts = { found: 0, NoRoute: 0, NoSegment: 0 };
  for (const record of payload.records.filter(record => jobsByKey.has(record.key))) counts[record.status === 'found' ? 'found' : record.routeReason]++;
  const receipt = { ...clone(identity), complete: true, checksum: backup.checksum,
    cells: jobs.length, total: jobs.length, completed: jobs.length, cached: 100,
    found: counts.found, unreachable: counts.NoRoute + counts.NoSegment, results: { auto: counts } };
  const input = path.join(root, 'fresh-test-only.json'), receiptPath = path.join(root, 'fresh-test-only.receipt.json');
  const save = async (nextBackup = backup, nextReceipt = receipt) => {
    await Promise.all([writeFile(input, JSON.stringify(nextBackup)), writeFile(receiptPath, JSON.stringify(nextReceipt))]);
  };
  await save();
  return { root, input, receipt: receiptPath, backup, receiptData: receipt, save };
}

test('completed fresh car publication backs up originals and links both outputs while preserving pedestrian measurements', async t => {
  const data = await fixture(t);
  const report = await publishRoutes(data);
  const backupBytes = await readFile(path.join(data.root, 'data/full-project.json'));
  const viewerBytes = await readFile(path.join(data.root, 'public/viewer-data.js'));
  assert.deepEqual(await readFile(path.join(report.backupDirectory, 'full-project.json')), originalBackup);
  assert.deepEqual(await readFile(path.join(report.backupDirectory, 'viewer-data.js')), originalViewer);
  const published = JSON.parse(backupBytes);
  assert.equal(published.checksum, await B.digest(published.payload));
  const scope = { window: {} };
  vm.runInNewContext(viewerBytes.toString(), scope);
  const pack = scope.window.HospitalViewerData, json = gunzipSync(Buffer.from(pack.data, 'base64')).toString();
  assert.equal(pack.checksum, hash(json));
  const current = JSON.parse(json);
  assert.equal(current.sourceChecksum, published.checksum);
  assert.deepEqual(current.routes.filter(record => record.mode === 'pedestrian'), originalSnapshot.routes.filter(record => record.mode === 'pedestrian'));
  assert.notEqual(current.routes.find(record => record.mode === 'auto' && record.status === 'found').seconds,
    originalSnapshot.routes.find(record => record.mode === 'auto' && record.status === 'found').seconds);
  assert.equal(report.cells, originalSnapshot.cells.length);
  assert.equal(report.routes, originalSnapshot.routes.length);
  assert.equal(report.carResults.found, data.receiptData.results.auto.found);
  assert.equal(report.completion.auto.neighbor + report.completion.auto.measured, originalSnapshot.cells.length);
  assert.equal(report.visibleWalkingCells, originalSnapshot.cells.length);
  assert.equal(report.walkingWithinHourCells, 102);
  assert.equal(report.walkingGrayCells, 1840);
  assert.equal(report.files['data/full-project.json'], hash(backupBytes));
  assert.equal(report.files['public/viewer-data.js'], hash(viewerBytes));
  assert.ok(!(await readdir(path.join(data.root, 'data'))).some(name => name.endsWith('.lock') || name.endsWith('.writing')));
  await assert.rejects(publishRoutes(data), /another canonical backup/);
});

test('incomplete, unrelated, mixed-mode and corrupted receipts cannot change canonical files', async t => {
  const data = await fixture(t);
  const cases = [
    [receipt => { receipt.complete = false; }, /complete fresh receipt/],
    [receipt => { receipt.fresh = false; }, /complete fresh receipt/],
    [receipt => { receipt.inputChecksum = 'different-input'; }, /another canonical backup/],
    [receipt => { receipt.modes.push('pedestrian'); }, /car-only/],
    [receipt => { receipt.engineChecksum = 'different-engine'; }, /engine has changed/],
    [receipt => { receipt.jobKeys.pop(); }, /jobKeys differs/],
    [receipt => { receipt.checksum = 'invalid-checksum'; }, /fresh backup checksum/],
  ];
  for (const [mutate, expected] of cases) {
    const receipt = clone(data.receiptData);
    mutate(receipt);
    await data.save(data.backup, receipt);
    await assert.rejects(publishRoutes(data), expected);
    assert.deepEqual(await readFile(path.join(data.root, 'data/full-project.json')), originalBackup);
    assert.deepEqual(await readFile(path.join(data.root, 'public/viewer-data.js')), originalViewer);
  }
});

test('a valid checksum cannot conceal missing jobs, old cache, changed pedestrian answers, coordinate changes or fake no-route errors', async t => {
  const data = await fixture(t);
  const isCar = record => record.type === 'route' && record.mode === 'auto' && record.routingService === originalSnapshot.services.auto;
  const cases = [
    [payload => { payload.records.splice(payload.records.findIndex(isCar), 1); }, /exactly one answer/],
    [payload => { payload.records.find(isCar).at = source.createdAt; }, /old answer was reused/],
    [payload => { payload.records.find(record => record.type === 'route' && record.mode === 'pedestrian' && record.status === 'found').seconds++; }, /pedestrian routes or other project data changed/],
    [payload => { payload.records.find(isCar).origin[0] += 0.001; }, /not canonical|exactly one answer/],
    [payload => { const record = payload.records.find(record => isCar(record) && record.status === 'unreachable'); record.routeReason = 'NetworkError'; }, /not canonical|error was stored/],
    [payload => { payload.records.push(clone(payload.records.find(isCar))); }, /duplicate keys/],
    [payload => { payload.routing.recalculation.jobKeys.pop(); }, /job keys do not cover/],
  ];
  for (const [mutate, expected] of cases) {
    const payload = clone(data.backup.payload);
    mutate(payload);
    const backup = await B.create(payload), receipt = { ...clone(data.receiptData), checksum: backup.checksum,
      jobKeys: clone(payload.routing.recalculation.jobKeys) };
    await data.save(backup, receipt);
    await assert.rejects(preparePublication(data), expected);
  }
  assert.deepEqual(await readFile(path.join(data.root, 'data/full-project.json')), originalBackup);
  assert.deepEqual(await readFile(path.join(data.root, 'public/viewer-data.js')), originalViewer);
  assert.equal(hash(read('data/full-project.json')), hash(originalBackup));
  assert.equal(hash(read('public/viewer-data.js')), hash(originalViewer));
});
