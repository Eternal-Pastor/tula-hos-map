import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { context, engineFiles } from './helpers.mjs';
import { createDeveloperUI } from '../src/runtime/developer-ui-store.js';

const bundled = await build({ entryPoints: ['src/runtime/developer-controller.js'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
const { mountDeveloperController } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function fileEvent(read) {
  return { target: { files: [{ size: 20, text: read }], value: 'selected.json' } };
}
async function withController(run) {
  const E = context([...engineFiles, 'public/data.js']);
  E.HospitalLocalCache.read = async () => [];
  E.HospitalLocalCache.checkpoint = async () => null;
  E.HospitalBackup.prepare = async input => ({
    summary: { addresses: input.addresses, failed: 0, hospitals: 0, routes: 0, zones: 0, coverageZones: 0 },
    legacy: false, datasetMismatch: false, invalid: 0,
  });
  E.setInterval = setInterval;
  E.clearInterval = clearInterval;
  const globals = {
    window: E,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { baseURI: 'http://localhost:8765/' },
    requestAnimationFrame: callback => setTimeout(callback, 0),
  };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const ui = createDeveloperUI();
  let dispose;
  try {
    dispose = mountDeveloperController(ui, { destroy() {} }, { update() {}, open() {} });
    await turn();
    await run(ui, E);
  } finally {
    dispose?.();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test('a slower earlier backup cannot replace the latest verified preview', async () => {
  await withController(async ui => {
    const first = deferred();
    const firstEvent = fileEvent(() => first.promise);
    const readingFirst = ui.invoke('local-data-file', 'change', firstEvent);
    await turn();
    assert.equal(ui.get('backup-file').disabled, true);
    assert.equal(ui.get('local-data-file').disabled, true, 'both import entry points are locked during validation');
    const secondEvent = fileEvent(async () => JSON.stringify({ addresses: 22 }));
    await ui.invoke('backup-file', 'change', secondEvent);
    const latestSummary = ui.get('backup-preview-summary').textContent;
    const latestStatus = ui.get('backup-status').textContent;
    assert.match(latestSummary, /Адресов: 22;/);
    assert.equal(ui.get('backup-preview').hidden, false);
    first.resolve(JSON.stringify({ addresses: 11 }));
    await readingFirst;
    assert.equal(ui.get('backup-preview-summary').textContent, latestSummary);
    assert.equal(ui.get('backup-status').textContent, latestStatus);
    assert.equal(ui.get('backup-file').disabled, false);
    assert.equal(ui.get('local-data-file').disabled, false);
    assert.equal(firstEvent.target.value, '', 'the superseded input can select the same file again');
    assert.equal(secondEvent.target.value, '', 'file input is cleared after its own read');
  });
});

test('a superseded backup awaiting checkpoint cannot reopen a dismissed current dialog', async () => {
  await withController(async (ui, E) => {
    const checkpoint = deferred();
    let checks = 0;
    E.HospitalLocalCache.checkpoint = () => ++checks === 1 ? checkpoint.promise : Promise.resolve(null);
    const firstEvent = fileEvent(async () => JSON.stringify({ addresses: 44 }));
    const readingFirst = ui.invoke('local-data-file', 'change', firstEvent);
    await turn();
    await ui.invoke('backup-file', 'change', fileEvent(async () => JSON.stringify({ addresses: 55 })));
    const latestSummary = ui.get('backup-preview-summary').textContent;
    ui.invoke('close-backup');
    assert.equal(ui.get('backup-dialog').open, false);
    checkpoint.resolve(null);
    await readingFirst;
    assert.equal(ui.get('backup-dialog').open, false, 'late opening work must respect the superseding request');
    assert.equal(ui.get('backup-preview-summary').textContent, latestSummary);
    assert.match(latestSummary, /Адресов: 55;/);
    assert.equal(firstEvent.target.value, '');
  });
});

test('a late error from an older backup does not erase a valid newer preview', async () => {
  await withController(async ui => {
    const first = deferred();
    const readingFirst = ui.invoke('backup-file', 'change', fileEvent(() => first.promise));
    await turn();
    await ui.invoke('local-data-file', 'change', fileEvent(async () => JSON.stringify({ addresses: 33 })));
    const latestSummary = ui.get('backup-preview-summary').textContent;
    const latestStatus = ui.get('backup-status').textContent;
    first.reject(new Error('old file read failed'));
    await readingFirst;
    assert.match(latestSummary, /Адресов: 33;/);
    assert.equal(ui.get('backup-preview-summary').textContent, latestSummary);
    assert.equal(ui.get('backup-status').textContent, latestStatus);
    assert.equal(ui.get('backup-preview').hidden, false);
  });
});

test('restore retains the chosen merge mode while preparing the previous-project checkpoint', async () => {
  await withController(async (ui, E) => {
    const checkpoint = deferred(), started = deferred();
    let merges = 0;
    E.HospitalBackup.prepare = async () => ({
      summary: { addresses: 0, failed: 0, hospitals: 0, routes: 0, zones: 0, coverageZones: 0 },
      records: [],
      settings: { selectedOrganization: null, showZones: true, showAddressPoints: false, fullCoverage: false, mapColor: 'organization', metric: 'per1000', includeMixed: false, showEmpty: true, populationLinks: {}, populationValues: {}, coordinates: {}, coordinateVersions: {}, geojson: [] },
    });
    E.HospitalBackup.create = async () => {
      started.resolve();
      await checkpoint.promise;
      return { payload: { records: [] } };
    };
    E.HospitalBackup.merge = (_current, imported) => { merges++; return imported; };
    E.HospitalLocalCache.install = async () => {};
    await ui.invoke('backup-file', 'change', fileEvent(async () => '{}'));
    const applying = ui.invoke('backup-apply');
    await started.promise;
    assert.equal(ui.get('backup-mode').disabled, true, 'mode stays fixed while restoration is running');
    ui.get('backup-mode').value = 'replace';
    checkpoint.resolve();
    await applying;
    assert.equal(merges, 1, 'the mode at the original click determines how records are restored');
    assert.equal(ui.get('backup-mode').disabled, false);
  });
});
