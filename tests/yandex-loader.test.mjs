import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = readFileSync(new URL('../src/services/yandex-loader.ts', import.meta.url), 'utf8');
const compiled = await transform(source, { loader: 'ts', format: 'iife', globalName: 'loader', target: 'es2022' });

function environment() {
  const scripts = [], timers = new Map(), readyCallbacks = [];
  let sequence = 0;
  const api = { ready(callback) { readyCallbacks.push(callback); } };
  const sandbox = {
    window: {}, URLSearchParams,
    setTimeout(callback) { const id = ++sequence; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    document: {
      createElement() { return { removed: false, remove() { this.removed = true; } }; },
      head: { append(script) { scripts.push(script); } },
    },
  };
  vm.runInNewContext(compiled.code, sandbox);
  return {
    ...sandbox, scripts, readyCallbacks, api,
    load: () => sandbox.loader.loadYandex('test-key', 'testMaps'),
    expire() {
      for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
    },
  };
}

test('SDK loading is shared and finishes only when the map API is ready', async () => {
  const env = environment();
  const first = env.load();
  assert.equal(env.load(), first);
  assert.equal(env.scripts.length, 1);
  env.window.testMaps = env.api;
  env.scripts[0].onload();
  let settled = false;
  first.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false, 'script load alone does not make the SDK usable');
  assert.equal(env.load(), first, 'callers also share the wait for SDK modules');
  env.readyCallbacks[0]();
  assert.equal(await first, env.api);
  env.expire();
  assert.equal(env.scripts[0].removed, false);
  assert.equal(await env.load(), env.api);
});

test('timeout covers SDK readiness and a late callback cannot finish a retry', async () => {
  const env = environment();
  const first = env.load();
  env.window.testMaps = env.api;
  env.scripts[0].onload();
  const rejection = assert.rejects(first, /Время ожидания карты истекло/);
  env.expire();
  await rejection;
  assert.equal(env.scripts[0].removed, true);
  const retry = env.load();
  assert.notEqual(retry, first);
  let settled = false;
  retry.then(() => { settled = true; });
  env.readyCallbacks[0]();
  await Promise.resolve();
  assert.equal(settled, false, 'old readiness callback belongs to the timed-out attempt');
  env.readyCallbacks[1]();
  assert.equal(await retry, env.api);
});

test('network failure allows another script load and ignores callbacks from the failed attempt', async () => {
  const env = environment();
  const first = env.load();
  const oldError = env.scripts[0].onerror;
  const rejection = assert.rejects(first, /Не удалось подключить карту/);
  oldError();
  await rejection;
  assert.equal(env.scripts[0].removed, true);
  const retry = env.load();
  assert.equal(env.scripts.length, 2);
  oldError();
  assert.equal(env.load(), retry, 'late errors must not discard the new attempt');
  env.window.testMaps = env.api;
  env.scripts[1].onload();
  env.readyCallbacks[0]();
  assert.equal(await retry, env.api);
});

test('an existing SDK also has a readiness timeout and a synchronous ready failure can be retried', async () => {
  const env = environment();
  env.window.testMaps = env.api;
  const pending = env.load();
  const rejection = assert.rejects(pending, /Время ожидания карты истекло/);
  env.expire();
  await rejection;
  assert.equal(env.scripts.length, 0);
  env.api.ready = () => { throw new Error('SDK initialization failed'); };
  await assert.rejects(env.load(), /SDK initialization failed/);
  env.api.ready = callback => callback();
  assert.equal(await env.load(), env.api, 'failed existing SDK must not poison the loader cache');
});
