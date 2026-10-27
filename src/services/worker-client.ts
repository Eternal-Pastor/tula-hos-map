export function runAccessibilityTask<T>(
  task: string,
  payload: unknown,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted)
      return reject(new DOMException("Остановлено", "AbortError"));
    const worker = new Worker(
      new URL("workers/accessibility.js", document.baseURI),
    );
    const clean = () => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      clean();
      reject(new DOMException("Остановлено", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event) => {
      clean();
      event.data.error
        ? reject(new Error(event.data.error))
        : resolve(event.data.result as T);
    };
    worker.onerror = () => {
      clean();
      reject(new Error("Ошибка фонового расчёта."));
    };
    try {
      worker.postMessage({ id: 1, task, payload });
    } catch (error) {
      clean();
      reject(error);
    }
  });
}
