const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
/** One destination per cell; the transport selector changes measurements, not ownership. */
export function jointAllocation(cells, hospitals, matrices) {
  const columns = hospitals.length, total = cells.length * columns;
  if (!columns || matrices.auto.length !== total || matrices.pedestrian.length !== total) throw new Error('Неверные размеры матриц общего распределения.');
  const index = new Map(hospitals.map((h, i) => [h.id, i])), assignments = [];
  let carOnly = 0;
  for (let row = 0; row < cells.length; row++) {
    const offset = row * columns, current = index.get(cells[row].organizationId);
    if (current === undefined) throw new Error('У ячейки не найдено исходное прикрепление.');
    let bestFoot = Infinity;
    for (let column = 0; column < columns; column++) {
      const auto = matrices.auto[offset + column], foot = matrices.pedestrian[offset + column];
      if (!finite(auto) || !finite(foot)) throw new Error('Для общего распределения нужны две заполненные матрицы.');
      bestFoot = Math.min(bestFoot, foot);
    }
    const rule = bestFoot > 3600 ? 'car-only' : 'mean';
    if (rule === 'car-only') carOnly++;
    const score = column => rule === 'car-only' ? matrices.auto[offset + column] : (matrices.auto[offset + column] + matrices.pedestrian[offset + column]) / 2;
    let winner = current, minimum = score(current);
    for (let column = 0; column < columns; column++) {
      const value = score(column);
      if (value < minimum - 1e-9 || Math.abs(value - minimum) <= 1e-9 && winner !== current && (column === current || hospitals[column].id < hospitals[winner].id)) {
        winner = column; minimum = value;
      }
    }
    assignments.push({ cellId: cells[row].id, targetId: hospitals[winner].id, column: winner, beforeColumn: current,
      rule, bestFootSeconds: bestFoot, beforeScore: score(current), afterScore: minimum });
  }
  const solutions = {};
  for (const mode of ['auto', 'pedestrian']) {
    const rows = assignments.map((assignment, i) => {
      const beforeSeconds = matrices[mode][i * columns + assignment.beforeColumn], afterSeconds = matrices[mode][i * columns + assignment.column];
      return { cellId: assignment.cellId, beforeId: cells[i].organizationId, beforeSeconds,
        afterId: assignment.targetId, afterSeconds, deltaSeconds: beforeSeconds - afterSeconds, complete: true, status: 'found' };
    });
    const average = key => rows.reduce((sum, r) => sum + r[key], 0) / Math.max(rows.length, 1);
    solutions[mode] = { version: 'joint-travel-time-v1', rows, summary: { cells: rows.length, paired: rows.length,
      beforeSeconds: average('beforeSeconds'), afterSeconds: average('afterSeconds'), savedSeconds: average('deltaSeconds'),
      improved: rows.filter(r => r.deltaSeconds > 0.01).length, worsened: rows.filter(r => r.deltaSeconds < -0.01).length,
      changed: rows.filter(r => r.beforeId !== r.afterId).length, unreachable: 0, pending: 0 } };
  }
  return { assignments, solutions, summary: { method: 'joint-travel-time-v1', pedestrianLimitSeconds: 3600,
    meanCandidates: 'all-38', cells: cells.length, carOnly, mean: cells.length - carOnly,
    changed: assignments.filter((a, i) => a.targetId !== cells[i].organizationId).length,
    beforeScore: assignments.reduce((s, a) => s + a.beforeScore, 0) / Math.max(cells.length, 1),
    afterScore: assignments.reduce((s, a) => s + a.afterScore, 0) / Math.max(cells.length, 1) } };
}
