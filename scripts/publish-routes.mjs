// Publish a completed, explicitly fresh car-only OSRM run. Never starts routing.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile, rename, unlink, open } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const sha256 = value => createHash('sha256').update(value).digest('hex');
// Engine data may originate in a VM realm; compare JSON values, not prototypes.
function same(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && same(left[key], right[key]));
}
const sorted = values => [...values].sort();
const grids = new Map();

function check(condition, message) {
  if (!condition) throw new Error(`Cannot publish routes: ${message}`);
}
function unpack(bytes) {
  const scope = { window: {} };
  vm.runInNewContext(bytes.toString('utf8'), scope, { timeout: 1000 });
  const pack = scope.window.HospitalViewerData;
  check(pack?.version === 1 && pack.encoding === 'gzip-base64', 'unsupported viewer snapshot.');
  const json = gunzipSync(Buffer.from(pack.data, 'base64'), { maxOutputLength: 100 * 1024 * 1024 }).toString('utf8');
  check(sha256(json) === pack.checksum, 'viewer snapshot checksum does not match.');
  return { pack, snapshot: JSON.parse(json) };
}
function keyed(records) {
  return new Map(records.map(record => [record.key, record]));
}
function equalRecords(left, right) {
  const a = keyed(left), b = keyed(right);
  return a.size === left.length && b.size === right.length && a.size === b.size &&
    [...a].every(([key, record]) => same(record, b.get(key)));
}

export async function preparePublication({ input, receipt: receiptFile, root = repositoryRoot }) {
  check(input && receiptFile, 'specify --input and --receipt.');
  root = path.resolve(root);
  const backupPath = path.join(root, 'data/full-project.json');
  const viewerPath = path.join(root, 'public/viewer-data.js');
  check(path.resolve(input) !== backupPath && path.resolve(input) !== viewerPath, 'the fresh result must be a separate file.');
  const { A, B } = require('../local-routing/engine.cjs');
  const { loadProject, localServices } = require('../local-routing/calculate-routes.cjs');
  const [backupBytes, viewerBytes, freshBytes, receiptBytes, engineBytes] = await Promise.all([
    readFile(backupPath), readFile(viewerPath), readFile(input), readFile(receiptFile),
    readFile(new URL('../local-routing/engine.cjs', import.meta.url)),
  ]);
  const receipt = JSON.parse(receiptBytes), freshRaw = JSON.parse(freshBytes), currentRaw = JSON.parse(backupBytes);
  check(receipt.schemaVersion === 2 && receipt.fresh === true && receipt.complete === true, 'a complete fresh receipt version 2 is required.');
  check(same(receipt.modes, ['auto']), 'only a car-only run can be published; pedestrian data must be preserved.');
  check(currentRaw.version === 2 && freshRaw.version === 2, 'both backups must use version 2.');
  check(receipt.inputChecksum === currentRaw.checksum, 'the run was calculated from another canonical backup.');
  check(await B.digest(currentRaw.payload) === currentRaw.checksum, 'canonical backup checksum does not match.');
  check(await B.digest(freshRaw.payload) === freshRaw.checksum && receipt.checksum === freshRaw.checksum, 'fresh backup checksum does not match its receipt.');
  check(receipt.engineChecksum === sha256(engineBytes), 'the routing engine has changed since this run.');
  const identity = freshRaw.payload.routing?.recalculation;
  check(identity && typeof identity.runId === 'string' && identity.runId.length > 0, 'the checksummed fresh-run identity is missing.');
  for (const key of ['schemaVersion', 'fresh', 'inputChecksum', 'modes', 'services', 'step', 'graph', 'engineChecksum', 'jobKeys', 'runId']) {
    check(same(identity[key], receipt[key]), `receipt field ${key} differs from the checksummed run identity.`);
  }
  check(receipt.graph?.image && receipt.graph.source && receipt.graph.profiles?.auto, 'the car graph identity is missing.');
  const services = localServices(receipt.services);
  const { pack: oldPack, snapshot } = unpack(viewerBytes);
  check(snapshot.version === 1 && snapshot.sourceChecksum === currentRaw.checksum, 'the canonical viewer and full backup are not linked.');
  check(same(services, snapshot.services), 'service URLs changed; use an explicit migration instead.');
  check(receipt.step === snapshot.step && freshRaw.payload.routing.step === snapshot.step, 'the grid step changed.');
  const [current, fresh] = await Promise.all([loadProject(backupPath), loadProject(path.resolve(input))]);
  const analyticalSettings = settings => Object.fromEntries(Object.entries(settings).filter(([key]) => !['selectedOrganization', 'showZones', 'showEmpty'].includes(key)));
  check(same(analyticalSettings(current.plan.settings), analyticalSettings(fresh.plan.settings)), 'project settings changed beyond calculation display options.');
  check(fresh.plan.routing?.source === 'osrm' && same(fresh.plan.routing.osrm, services), 'fresh routing settings do not select the measured OSRM services.');
  check(current.coverage.signature === fresh.coverage.signature && same(current.coverage.zones, fresh.coverage.zones), 'regional coverage changed.');
  check(same(snapshot.zones, current.coverage.zones), 'the viewer has different regional coverage.');
  check(same(current.hospitals, fresh.hospitals), 'hospital coordinates changed.');
  const hospitalCoordinates = new Map(current.hospitals.map(hospital => [hospital.id, hospital.coords]));
  check(snapshot.hospitals.length === hospitalCoordinates.size && snapshot.hospitals.every(hospital => same(hospital.coords, hospitalCoordinates.get(hospital.id))), 'the viewer has different hospital coordinates.');
  const gridKey = sha256(JSON.stringify([current.coverage.zones, snapshot.step]));
  if (!grids.has(gridKey)) {
    if (grids.size >= 8) grids.clear();
    grids.set(gridKey, A.grid(new Map(current.coverage.zones), snapshot.step).cells);
  }
  check(same(grids.get(gridKey), snapshot.cells), 'the canonical viewer grid does not match its saved coverage.');
  const jobs = [...new Map(A.pending(snapshot.cells, hospitalCoordinates, new Map(), ['auto'], services).map(job => [job.key, job])).values()];
  const expectedKeys = sorted(jobs.map(job => job.key));
  check(expectedKeys.length === snapshot.cells.length, 'the baseline grid contains duplicate route keys.');
  check(Array.isArray(receipt.jobKeys) && same(sorted(receipt.jobKeys), expectedKeys), 'receipt job keys do not cover the complete canonical car grid.');
  check(receipt.cells === snapshot.cells.length && receipt.total === jobs.length && receipt.completed === jobs.length, 'receipt counts do not describe a complete car grid.');
  check(Number.isInteger(receipt.cached) && receipt.cached >= 0 && receipt.cached <= jobs.length, 'invalid resumed-job count.');
  const isTarget = record => record.type === 'route' && record.mode === 'auto' && record.routingService === services.auto;
  check(equalRecords(current.plan.records.filter(record => !isTarget(record)), fresh.plan.records.filter(record => !isTarget(record))), 'pedestrian routes or other project data changed.');
  const freshTargets = fresh.plan.records.filter(isTarget), routes = keyed(freshTargets);
  const rawTargets = freshRaw.payload.records.filter(isTarget);
  const knownIds = new Set(snapshot.hospitals.map(hospital => hospital.id));
  check(rawTargets.length === freshTargets.length && rawTargets.every(record => same(record, A.record(record, knownIds))), 'fresh route records are not canonical or contain duplicate keys.');
  check(routes.size === freshTargets.length && same(sorted(routes.keys()), expectedKeys), 'fresh results must contain exactly one answer for every canonical car job.');
  const results = { found: 0, NoRoute: 0, NoSegment: 0 };
  for (const job of jobs) {
    const record = routes.get(job.key), valid = A.record(record, knownIds);
    check(valid && valid.key === job.key && record.provider === 'osrm' && record.trafficType === 'disabled', `invalid OSRM answer: ${job.key}`);
    check(same(record.origin, job.cell.origin) && same(record.destination, job.destination), `coordinates changed: ${job.key}`);
    check(Date.parse(record.at) > Date.parse(currentRaw.createdAt), `an old answer was reused: ${job.key}`);
    if (record.status === 'found') {
      check(record.lines.length > 0 && record.lines.every(line => line.length >= 2) && record.snapDistances.length === 2, `missing measured route geometry or snapping: ${job.key}`);
      results.found++;
    } else {
      check(['NoRoute', 'NoSegment'].includes(record.routeReason) && record.seconds === null, `an error was stored as an unreachable route: ${job.key}`);
      results[record.routeReason]++;
    }
  }
  check(same(results, receipt.results?.auto) && receipt.found === results.found && receipt.unreachable === results.NoRoute + results.NoSegment, 'receipt result counts do not match the actual answers.');
  const pedestrian = snapshot.routes.filter(record => record.mode === 'pedestrian');
  const targetOrder = snapshot.routes.filter(record => record.mode === 'auto').map(record => record.key);
  check(same(sorted(targetOrder), expectedKeys) && pedestrian.length === snapshot.cells.length, 'the canonical viewer route set is incomplete.');
  const next = { ...snapshot, sourceChecksum: freshRaw.checksum,
    routes: snapshot.routes.map(record => record.mode === 'auto' ? routes.get(record.key) : record) };
  const json = JSON.stringify(next);
  const pack = { version: oldPack.version, checksum: sha256(json), encoding: 'gzip-base64', data: gzipSync(json).toString('base64') };
  const viewer = Buffer.from(`window.HospitalViewerData=${JSON.stringify(pack)};\n`);
  const allRoutes = keyed(next.routes), destinations = new Map(next.hospitals.map(hospital => [hospital.id, hospital.coords]));
  const completion = A.completeTimes(next.cells, destinations, allRoutes, next.services);
  const visibleWalking = [...completion.values.values()].filter(value => Number.isFinite(value.pedestrian.seconds) && value.pedestrian.seconds <= 3600).length;
  return {
    root, backupPath, viewerPath, backupBytes, viewerBytes, freshBytes, viewer,
    report: { schemaVersion: 1, runId: receipt.runId, publishedAt: new Date().toISOString(),
      previousBackupChecksum: currentRaw.checksum, backupChecksum: freshRaw.checksum,
      previousSnapshotChecksum: oldPack.checksum, snapshotChecksum: pack.checksum,
      files: { 'data/full-project.json': sha256(freshBytes), 'public/viewer-data.js': sha256(viewer) },
      hospitals: next.hospitals.length, cells: next.cells.length, routes: next.routes.length,
      carResults: results, completion: completion.summary, visibleWalkingCells: next.cells.length,
      walkingWithinHourCells: visibleWalking, walkingGrayCells: next.cells.length - visibleWalking },
  };
}

export async function publishRoutes(options) {
  const publicationLock = path.join(path.resolve(options.root || repositoryRoot), 'data', '.routes-publication.lock');
  const handle = await open(publicationLock, 'wx');
  try { return await publishLocked(options); }
  finally { await handle.close(); await unlink(publicationLock); }
}

async function publishLocked(options) {
  const prepared = await preparePublication(options);
  const { root, backupPath, viewerPath, backupBytes, viewerBytes, freshBytes, viewer, report } = prepared;
  const suffix = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const backupDirectory = path.join(root, 'backups', `before-routes-${suffix}`);
  const backupStage = `${backupPath}.${suffix}.writing`, viewerStage = `${viewerPath}.${suffix}.writing`;
  await mkdir(backupDirectory, { recursive: true });
  // Both exact originals are backed up before either canonical file is changed.
  await writeFile(path.join(backupDirectory, 'full-project.json'), backupBytes, { flag: 'wx' });
  await writeFile(path.join(backupDirectory, 'viewer-data.js'), viewerBytes, { flag: 'wx' });
  await writeFile(path.join(backupDirectory, 'publication.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  let backupChanged = false, viewerChanged = false;
  try {
    await writeFile(backupStage, freshBytes, { flag: 'wx' });
    await writeFile(viewerStage, viewer, { flag: 'wx' });
    // Do not overwrite edits or another publication made while validation ran.
    check((await readFile(backupPath)).equals(backupBytes) && (await readFile(viewerPath)).equals(viewerBytes), 'canonical files changed during validation.');
    await rename(backupStage, backupPath); backupChanged = true;
    await rename(viewerStage, viewerPath); viewerChanged = true;
  } catch (error) {
    if (backupChanged) await copyFile(path.join(backupDirectory, 'full-project.json'), backupPath);
    if (viewerChanged) await copyFile(path.join(backupDirectory, 'viewer-data.js'), viewerPath);
    throw error;
  } finally {
    await Promise.all([backupStage, viewerStage].map(file => unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; })));
  }
  return { ...report, backupDirectory };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index];
    if (!['--input', '--receipt'].includes(name) || !process.argv[index + 1]) throw new Error('Usage: node scripts/publish-routes.mjs --input fresh.json --receipt fresh.receipt.json');
    options[name.slice(2)] = process.argv[index + 1];
  }
  publishRoutes(options).then(report => console.log(JSON.stringify(report, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
