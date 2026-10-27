import type { RouteJob, RouteRecord, TravelMode } from "../types/domain";

interface Options {
  jobs: RouteJob[];
  records: Map<string, RouteRecord>;
  knownIds: Set<string>;
  services: Record<TravelMode, string>;
  signal: AbortSignal;
  saveBatch(records: RouteRecord[]): Promise<unknown>;
  onProgress(count: number, total: number): void;
  requestRoute(
    service: string,
    job: RouteJob,
    signal: AbortSignal,
  ): Promise<Partial<RouteRecord>>;
  normalize(value: unknown, knownIds: Set<string>): RouteRecord | null;
  concurrency?: number;
  batchSize?: number;
}
/** Сохраняет только ответы сервиса. Оценки completeTimes не входят в records. */
export async function runRoutes({
  jobs,
  records,
  knownIds,
  services,
  signal,
  saveBatch,
  onProgress,
  requestRoute,
  normalize,
  concurrency = 4,
  batchSize = 50,
}: Options) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const queue = jobs.filter((job) => !records.has(job.key));
  let cursor = 0,
    count = jobs.length - queue.length;
  let error: unknown;
  let buffer: RouteRecord[] = [],
    saving = Promise.resolve();
  const flush = () => {
    if (!buffer.length) return;
    const batch = buffer;
    buffer = [];
    saving = saving
      .then(async () => {
        await saveBatch(batch);
      })
      .catch((cause) => {
        error = cause;
        abort();
      });
  };
  onProgress(count, jobs.length);
  try {
    // Повторяем несохранённые записи после прежней ошибки IndexedDB.
    await saveBatch([...records.values()]);
    async function worker() {
      while (!controller.signal.aborted) {
        const job = queue[cursor++];
        if (!job) return;
        try {
          const result = await requestRoute(
            services[job.mode],
            job,
            controller.signal,
          );
          const record = normalize(
            {
              type: "route",
              organizationId: job.cell.organizationId,
              origin: job.cell.origin,
              destination: job.destination,
              mode: job.mode,
              ...result,
              lines: [],
              at: new Date().toISOString(),
            },
            knownIds,
          );
          if (!record) throw new Error("Некорректный ответ маршрутизатора.");
          records.set(record.key, record);
          buffer.push(record);
          count++;
          if (buffer.length >= batchSize) flush();
          onProgress(count, jobs.length);
        } catch (cause) {
          if (!(cause instanceof DOMException && cause.name === "AbortError"))
            error = cause;
          abort();
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    flush();
    await saving;
    if (error) throw error;
    return { stopped: controller.signal.aborted, count, total: jobs.length };
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
