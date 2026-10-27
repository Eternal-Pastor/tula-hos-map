import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { read, hash, plain, context, engineFiles, snapshot, workerRequest } from './helpers.mjs';

const E = context(engineFiles, { indexedDB });
const A = E.HospitalAccessibility, O = E.HospitalRoutingOSRM, V = E.HospitalViewer;
const { pack, json, data: S } = snapshot();
const destinations = new Map(S.hospitals.map(h => [h.id, h.coords]));
const records = new Map(S.routes.map(r => [r.key, r]));
const knownIds = new Set(S.hospitals.map(h => h.id));

test('canonical inputs and both SHA-256 checksums are unchanged', async () => {
  assert.equal(hash(read('public/data.js')), '19faaf34f6dc14719239008a0131bad12148e9883200c730058316b2a79aea47');
  assert.equal(hash(read('public/viewer-data.js')), 'af969330fbae410ba119d09e8412861e16d0a77b0d8affdbeabe7f9ec35338a1');
  assert.equal(hash(read('data/full-project.json')), '99e629c34076ff6de23bcadf740219d22615bb56299c83b277d20b6bcc1b10cf');
  assert.equal(hash(json), pack.checksum);
  assert.equal(pack.checksum, 'd098703380c1f3333d15edebf11d391a5eda462472185bdcc9458f33c7c979f6');
  const backup = JSON.parse(read('data/full-project.json'));
  assert.equal(await E.HospitalBackup.digest(backup.payload), backup.checksum);
  assert.equal(S.sourceChecksum, backup.checksum);
});

test('snapshot recomputes 38 hospitals, 1942 cells and 3884 OSRM responses without estimates entering cache', () => {
  assert.deepEqual([S.hospitals.length, S.cells.length, S.routes.length, S.step], [38, 1942, 3884, 5000]);
  const before = hash(JSON.stringify([...records]));
  const result = A.completeTimes(S.cells, destinations, records, S.services);
  assert.deepEqual(plain(result.summary), {
    auto: { measured: 1258, neighbor: 684, distance: 0, missing: 0 },
    pedestrian: { measured: 1733, neighbor: 209, distance: 0, missing: 0 },
  });
  assert.equal(result.method, 'same-hospital-idw4-v1');
  assert.equal(hash(JSON.stringify([...records])), before);
  assert.equal(A.pending(S.cells, destinations, records, ['auto', 'pedestrian'], S.services).length, 0);
  for (const cell of S.cells) {
    for (const mode of ['auto', 'pedestrian']) {
      const v = result.values.get(cell.id)[mode];
      assert.ok(Number.isFinite(v.seconds));
      for (const donor of v.donors) {
        const d = S.cells.find(c => c.id === donor.id);
        assert.equal(d.organizationId, cell.organizationId);
        assert.equal(result.values.get(d.id)[mode].source, 'osrm');
      }
    }
  }
});

test('route keys and route validation keep source identity, precision and unreachable responses', () => {
  for (const record of S.routes) {
    const valid = A.record(record, knownIds);
    assert.ok(valid);
    assert.equal(valid.key, record.key);
  }
  const r = S.routes[0];
  assert.equal(A.routeKey(r.organizationId, r.origin, r.destination, r.mode, r.routingService), r.key);
  assert.equal(A.record({ ...r, mode: 'masstransit' }, knownIds), null);
  assert.equal(A.record({ ...r, status: 'estimated' }, knownIds), null);
  assert.equal(A.record({ ...r, status: 'found', seconds: -1 }, knownIds), null);
  const half = new Map(S.routes.slice(0, 2001).map(r => [r.key, r]));
  const remaining = A.pending(S.cells, destinations, half, O.MODES, S.services);
  assert.equal(remaining.length, 3884 - 2001);
  assert.ok(remaining.every(job => !half.has(job.key)));
});

test('viewer fixed thresholds differ from developer terciles and coordinate conversion preserves order', () => {
  assert.deepEqual([699.99, 700, 1000, 1000.01, null].map(V.loadBand), ['low', 'middle', 'middle', 'high', 'missing']);
  const d = { populations: [], organizations: [100, 200, 300, 400].map((attached, id) => ({ id, adultAttached: attached })) };
  const scale = E.HospitalCore.scale(d, { metric: 'absolute', includeMixed: false });
  assert.deepEqual(plain(scale), { low: 200, high: 300, count: 4 });
  assert.equal(E.HospitalCore.band(700, scale), 'high');
  const geometry = { type: 'Polygon', coordinates: [[[37, 54], [38, 54], [38, 55], [37, 54]]] };
  assert.deepEqual(plain(E.HospitalCore.yandexGeometry(geometry).coordinates[0][0]), [54, 37]);
  assert.deepEqual(geometry.coordinates[0][0], [37, 54]);
});

test('OSRM converts Yandex coordinates to lon,lat and cancels a pending fetch', async () => {
  const cell = S.cells[0], job = { cell, destination: destinations.get(cell.organizationId), mode: 'auto' };
  let requested;
  const result = await O.requestRoute(S.services.auto, job, new AbortController().signal, async url => {
    requested = url;
    return { ok: true, json: async () => ({ code: 'Ok', routes: [{ duration: 123, geometry: { type: 'LineString', coordinates: [[37, 54], [37.1, 54.1]] } }], waypoints: [{ distance: 1 }, { distance: 2 }] }) };
  });
  assert.ok(requested.includes(`/${cell.origin[1]},${cell.origin[0]};${job.destination[1]},${job.destination[0]}?`));
  assert.deepEqual(plain(result.lines), [[[54, 37], [54.1, 37.1]]]);
  const controller = new AbortController();
  const pending = O.requestRoute(S.services.auto, job, controller.signal, async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
  }));
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('existing full backup restores canonical addresses, zones and all route records; corruption is rejected', async () => {
  const data = context(['public/data.js']).HOSPITAL_DATA;
  const index = E.HospitalTerritories.index(data);
  const backup = JSON.parse(read('data/full-project.json'));
  const options = { data, index, validateSettings: value => value, validateRouting: value => value, dataset: backup.payload.dataset };
  const prepared = await E.HospitalBackup.prepare(backup, options);
  assert.equal(prepared.invalid, 0);
  assert.equal(prepared.datasetMismatch, false);
  assert.deepEqual(plain(prepared.summary), plain(backup.summary));
  backup.payload.records[0].status = 'tampered';
  await assert.rejects(E.HospitalBackup.prepare(backup, options), /Контрольная сумма/);
});

test('IndexedDB schema, batched writes, atomic replacement and previous-project checkpoint stay compatible', async () => {
  const cache = E.HospitalLocalCache;
  const first = S.routes.slice(0, 52);
  await cache.write(first.slice(0, 50));
  await cache.write(first.slice(50));
  assert.equal((await cache.read()).length, 52);
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('hospital-map-local-data', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  assert.equal(db.transaction('results').objectStore('results').keyPath, 'key');
  db.close();
  const checkpoint = { type: 'hospital-map-local-data', version: 2, payload: { records: first } };
  await cache.install(S.routes.slice(52, 55), { replace: true, checkpoint });
  const installed = await cache.read();
  assert.equal(installed.length, 4);
  assert.deepEqual(plain(await cache.checkpoint()), checkpoint);
  assert.ok(installed.some(r => r.key === 'backup:previous'));
  assert.ok(installed.every(r => r.key === 'backup:previous' || !first.some(old => old.key === r.key)));
});

test('production accessibility Worker regenerates the original grid and bands', { timeout: 60000 }, async () => {
  const response = await workerRequest('accessibility', { id: 42, task: 'grid', payload: { zones: new Map(S.zones), step: 5000 } });
  assert.equal(response.id, 42);
  assert.equal(response.result.cells.length, 1942);
  // Full coordinates/IDs are compared, not just totals.
  assert.deepEqual(response.result.cells, S.cells);
  const bands = await workerRequest('accessibility', { id: 43, task: 'bands', payload: { items: [{ ...S.cells[0], band: 1 }] } });
  assert.equal(bands.result[0].organizationId, S.cells[0].organizationId);
  assert.equal(bands.result[0].band, 1);
  const completed = await workerRequest('accessibility', {
    id: 44, task: 'complete', payload: { cells: S.cells, destinations, records, services: S.services },
  });
  assert.deepEqual(completed.result.summary, {
    auto: { measured: 1258, neighbor: 684, distance: 0, missing: 0 },
    pedestrian: { measured: 1733, neighbor: 209, distance: 0, missing: 0 },
  });
  assert.equal(completed.result.values.size, 1942);
});

test('production zones Worker partitions source anchors and produces progress/result protocol', async () => {
  const organizations = [{ id: 'one', anchors: [[54, 37], [54, 37.01], [54.01, 37.01], [54.01, 37]].map(coords => ({ coords, kind: 'house' })) }];
  const response = await workerRequest('zones', { id: 9, key: 'test', organizations });
  assert.equal(response.id, 9);
  assert.equal(response.key, 'test');
  assert.ok(response.result.zones instanceof Map);
  assert.equal(response.result.zones.size, 1);
  assert.ok(E.HospitalZones.area(response.result.zones.get('one')) > 0);
  assert.equal(response.result.anchorCounts.get('one'), 4);
});
