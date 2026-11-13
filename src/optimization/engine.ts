import '../services/engine';
import '../engine/optimization.js';
import type { Facility, GridCell, Solution } from './types';
import type { Polygon } from '../types/domain';
interface OptimizationEngine {
  solve(cells: GridCell[], candidates: Facility[], baseline: Facility[], lookup: (cell: GridCell, destination: Facility) => number | null | undefined): Solution;
}
export const optimizer = (window as unknown as { HospitalOptimization: OptimizationEngine }).HospitalOptimization;
export function buildOutlines(cells: GridCell[], solution: Solution, signal: AbortSignal, progress: (n: number, total: number) => void) {
  return new Promise<[string, Polygon[]][]>((resolve, reject) => {
    signal.throwIfAborted();
    const worker = new Worker(new URL('workers/optimization.js', document.baseURI));
    const clean = () => { worker.terminate(); signal.removeEventListener('abort', abort); };
    const abort = () => { clean(); reject(new DOMException('Остановлено', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') { progress(data.value.completed, data.value.total); return; }
      clean(); data.error ? reject(new Error(data.error)) : resolve(data.result);
    };
    worker.onerror = () => { clean(); reject(new Error('Не удалось объединить новые зоны.')); };
    worker.postMessage({ id: 1, task: 'outlines', payload: { cells, rows: solution.rows } });
  });
}
