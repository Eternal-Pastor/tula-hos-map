/**
 * Keeps inferred travel times outside the UI thread. A result is visible only for
 * the exact input revision that produced it; inferred values never enter records.
 */
export function createCompletionCache({ input, run, onResult = () => {}, onError = () => {} }) {
  let disposed = false, sequence = 0, controller = null, pending = null;
  let pendingStamp = '', valueStamp = '', value = null, failedStamp = '', failure = null;
  const aborted = () => new DOMException('Расчёт остановлен', 'AbortError');
  function ensure() {
    if (disposed) return Promise.reject(aborted());
    const next = input();
    if (value && valueStamp === next.stamp) return Promise.resolve(value);
    if (pending && pendingStamp === next.stamp) return pending;
    if (failure && failedStamp === next.stamp) return Promise.reject(failure);
    controller?.abort();
    const own = new AbortController(), token = ++sequence;
    controller = own; pendingStamp = next.stamp; failure = null; failedStamp = '';
    pending = Promise.resolve().then(() => run(next.payload, own.signal)).then(result => {
      if (disposed || token !== sequence) throw aborted();
      if (input().stamp !== next.stamp) return ensure();
      value = result; valueStamp = next.stamp;
      onResult(result);
      return result;
    }).catch(error => {
      if (!disposed && token === sequence && error.name !== 'AbortError') {
        failure = error; failedStamp = next.stamp; onError(error);
      }
      throw error;
    }).finally(() => {
      if (token === sequence) { pending = null; pendingStamp = ''; controller = null; }
    });
    return pending;
  }
  return {
    read() {
      if (disposed) return null;
      const stamp = input().stamp;
      if (value && valueStamp === stamp) return value;
      if (failedStamp !== stamp) void ensure().catch(() => {});
      return null;
    },
    ensure,
    get error() { return failedStamp === input().stamp ? failure : null; },
    retry() { failure = null; failedStamp = ''; },
    dispose() {
      if (disposed) return;
      disposed = true; sequence++; controller?.abort();
      controller = null; pending = null; value = null;
    }
  };
}
