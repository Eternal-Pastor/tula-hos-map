import type { MatrixEntry } from './types';
export class OptimizationStorage {
  private db?: Promise<IDBDatabase>;
  private open() {
    return this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('hospital-optimization-v1', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('state');
        const records = request.result.createObjectStore('matrix', { keyPath: 'key' });
        records.createIndex('run', 'run');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.db = undefined; reject(request.error); };
    });
  }
  async readState<T>(key: string): Promise<T | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state'), request = tx.objectStore('state').get(key);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  async writeState(key: string, value: unknown) {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite'); tx.objectStore('state').put(value, key);
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  async readMatrix(run: string): Promise<MatrixEntry[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('matrix'), req = tx.objectStore('matrix').index('run').getAll(run);
      tx.oncomplete = () => resolve(req.result.map((r: { pair: string; seconds: number | null }) => ({ key: r.pair, seconds: r.seconds })));
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  async writeMatrix(run: string, batch: MatrixEntry[]) {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction('matrix', 'readwrite'), store = tx.objectStore('matrix');
      for (const entry of batch) store.put({ key: run + '|' + entry.key, run, pair: entry.key, seconds: entry.seconds });
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  close() { void this.db?.then(db => db.close()); this.db = undefined; }
}
