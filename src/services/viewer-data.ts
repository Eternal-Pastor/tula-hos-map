import type {
  RouteRecord,
  ViewerSettings,
  ViewerSnapshot,
} from "../types/domain";
import type { ViewerPack } from "./engine";

let unpacked: Promise<ViewerSnapshot> | undefined;
export function unpackSnapshot(pack: ViewerPack): Promise<ViewerSnapshot> {
  return (unpacked ??= (async () => {
    if (pack.encoding !== "gzip-base64")
      throw new Error("Не удалось открыть сохранённую карту.");
    const bytes = Uint8Array.from(atob(pack.data), (c) => c.charCodeAt(0));
    const json = await new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
    ).text();
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(json),
    );
    if (
      Array.from(new Uint8Array(digest), (v) =>
        v.toString(16).padStart(2, "0"),
      ).join("") !== pack.checksum
    )
      throw new Error("Не удалось проверить сохранённую карту.");
    return JSON.parse(json) as ViewerSnapshot;
  })().catch((error) => {
    unpacked = undefined;
    throw error;
  }));
}

const storageKey = "hospital-map-viewer-settings-v1";
export function readViewerSettings(checksum: string): ViewerSettings {
  const defaults: ViewerSettings = {
    mode: "travel",
    transport: "auto",
    step: 5000,
    checksum,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (saved?.checksum === checksum) {
      if (["travel", "zones", "load"].includes(saved.mode))
        defaults.mode = saved.mode;
      if (["auto", "pedestrian"].includes(saved.transport))
        defaults.transport = saved.transport;
      if ([5000, 10000, 20000].includes(saved.step)) defaults.step = saved.step;
    }
  } catch {
    /* Как и раньше, просмотр работает без доступного localStorage. */
  }
  return defaults;
}
export function writeViewerSettings(settings: ViewerSettings) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(settings));
  } catch {
    /* Не блокируем карту. */
  }
}

export class ViewerRouteStorage {
  private connection?: Promise<IDBDatabase>;
  constructor(private readonly checksum: string) {}
  private database() {
    return (this.connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(
        "hospital-map-viewer-routes-v1-" + this.checksum.slice(0, 16),
        1,
      );
      request.onupgradeneeded = () =>
        request.result.createObjectStore("routes", { keyPath: "key" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.connection = undefined;
        reject(request.error);
      };
    }));
  }
  async read(): Promise<RouteRecord[]> {
    return this.transaction(true) as Promise<RouteRecord[]>;
  }
  async write(records: RouteRecord[]) {
    await this.transaction(false, records);
  }
  private async transaction(read: boolean, batch: RouteRecord[] = []) {
    const db = await this.database();
    return new Promise<RouteRecord[] | undefined>((resolve, reject) => {
      const transaction = db.transaction(
        "routes",
        read ? "readonly" : "readwrite",
      );
      const store = transaction.objectStore("routes");
      const request = read ? store.getAll() : undefined;
      if (!read) for (const record of batch) store.put(record);
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error || new Error("Не удалось сохранить расчёт."));
    });
  }
  close() {
    void this.connection?.then((db) => db.close()).catch(() => {});
    this.connection = undefined;
  }
}
