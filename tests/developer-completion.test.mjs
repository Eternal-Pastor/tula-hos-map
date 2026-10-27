import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompletionCache } from '../src/runtime/developer-completion.js';

test('completion cache shares work and exposes only the current revision', async () => {
  let revision = 'one';
  const tasks = [];
  const cache = createCompletionCache({
    input: () => ({ stamp: revision, payload: revision }),
    run: (payload, signal) => new Promise((resolve, reject) => {
      tasks.push({ payload, resolve, signal });
      signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')));
    })
  });
  assert.equal(cache.read(), null);
  const first = cache.ensure();
  assert.equal(first, cache.ensure());
  await Promise.resolve();
  tasks[0].resolve({ revision: 'one' });
  assert.deepEqual(await first, { revision: 'one' });
  assert.deepEqual(cache.read(), { revision: 'one' });
  revision = 'two';
  assert.equal(cache.read(), null);
  const second = cache.ensure();
  await Promise.resolve();
  tasks[1].resolve({ revision: 'two' });
  assert.deepEqual(await second, { revision: 'two' });
  assert.deepEqual(cache.read(), { revision: 'two' });
  cache.dispose();
});

test('new inputs cancel older work and dispose suppresses late results', async () => {
  let revision = 1, delivered = 0;
  const tasks = [];
  const cache = createCompletionCache({
    input: () => ({ stamp: String(revision), payload: revision }),
    run: (payload, signal) => new Promise(resolve => tasks.push({ payload, signal, resolve })),
    onResult: () => delivered++
  });
  const first = cache.ensure();
  await Promise.resolve();
  revision++;
  const second = cache.ensure();
  await Promise.resolve();
  assert.equal(tasks[0].signal.aborted, true);
  tasks[0].resolve('stale');
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(delivered, 0);
  cache.dispose();
  assert.equal(tasks[1].signal.aborted, true);
  tasks[1].resolve('late');
  await assert.rejects(second, { name: 'AbortError' });
  assert.equal(delivered, 0);
  assert.equal(cache.read(), null);
});
