(function(root, factory) {
  const api = factory(root.HospitalAccessibility, root.HospitalZones);
  root.HospitalOptimization = api;
})(typeof window !== 'undefined' ? window : globalThis, function(A, Z) {
  'use strict';
  const VERSION = 'travel-time-v1';
  function adaptiveGrid(zones, cities, progress = () => {}) {
    if (!cities.length) throw new Error('Нет границ городов для сетки 250 м.');
    let urban = [];
    for (const city of cities) urban = urban.length ? Z.union(urban, city) : city;
    const cells = []; let n = 0;
    for (const [id, shape] of zones) {
      // Both resolutions are clipped to the same urban mask: no double coverage.
      const fine = Z.intersection(shape, urban), coarse = Z.difference(shape, urban);
      for (const [step, geometry] of [[250, fine], [2000, coarse]]) {
        if (!geometry.length) continue;
        const part = A.grid(new Map([[id, geometry]]), step, 100000).cells;
        cells.push(...part.map(cell => ({ ...cell, step })));
      }
      progress({ completed: ++n, total: zones.size, cells: cells.length });
    }
    return cells;
  }
  const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  function solve(cells, candidates, baseline, lookup) {
    if (!candidates.length) throw new Error('Подтвердите хотя бы один объект приёма.');
    const rows = [];
    for (const cell of cells) {
      const current = baseline.find(h => h.id === cell.organizationId);
      const before = current ? lookup(cell, current) : undefined;
      let winner = null, seconds = Infinity, checked = 0;
      for (const destination of candidates) {
        const value = lookup(cell, destination);
        if (value !== undefined) checked++;
        if (!finite(value)) continue;
        // Stable ties favour the incumbent organization, then lexical facility id.
        const incumbent = destination.organizationId === cell.organizationId;
        const preferred = seconds === value && (incumbent && winner?.organizationId !== cell.organizationId ||
          incumbent === (winner?.organizationId === cell.organizationId) && destination.id < winner.id);
        if (value < seconds || preferred) { winner = destination; seconds = value; }
      }
      rows.push({ cellId: cell.id, beforeId: cell.organizationId, beforeSeconds: finite(before) ? before : null,
        afterId: winner?.id ?? null, afterSeconds: winner ? seconds : null,
        deltaSeconds: finite(before) && winner ? before - seconds : null,
        complete: checked === candidates.length,
        status: checked < candidates.length ? 'pending' : winner ? 'found' : 'unreachable' });
    }
    const paired = rows.filter(r => r.deltaSeconds !== null);
    const average = key => paired.length ? paired.reduce((sum, r) => sum + r[key], 0) / paired.length : null;
    return { version: VERSION, rows, summary: { cells: rows.length, paired: paired.length,
      beforeSeconds: average('beforeSeconds'), afterSeconds: average('afterSeconds'),
      savedSeconds: average('deltaSeconds'), improved: paired.filter(r => r.deltaSeconds > 0.01).length,
      worsened: paired.filter(r => r.deltaSeconds < -0.01).length,
      changed: rows.filter(r => r.afterId && candidates.find(c => c.id === r.afterId)?.organizationId !== r.beforeId).length,
      unreachable: rows.filter(r => r.status === 'unreachable').length,
      pending: rows.filter(r => r.status === 'pending').length } };
  }
  function outlines(cells, rows, progress = () => {}) {
    const assignment = new Map(rows.map(r => [r.cellId, r.afterId]));
    const groups = new Map();
    for (const cell of cells) {
      const id = assignment.get(cell.id);
      if (!id) continue;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push([cell.geometry]);
    }
    const zones = []; let n = 0;
    const total = Math.max(1, [...groups.values()].reduce((sum, shapes) => sum + shapes.length - 1, 0));
    progress({ completed: 0, total });
    for (const [id, shapes] of groups) {
      // Balanced spatial batches avoid a single enormous sequential union.
      let level = shapes;
      while (level.length > 1) {
        const next = [];
        for (let i = 0; i < level.length; i += 16) {
          let merged = level[i];
          for (let j = i + 1; j < Math.min(i + 16, level.length); j++) {
            merged = Z.union(merged, level[j]); n++;
          }
          progress({ completed: n, total });
          next.push(merged);
        }
        level = next;
      }
      zones.push([id, level[0]]);
    }
    progress({ completed: total, total });
    return zones;
  }
  return { VERSION, adaptiveGrid, solve, outlines };
});
