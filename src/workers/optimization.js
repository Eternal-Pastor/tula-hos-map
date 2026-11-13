self.onmessage = function(event) {
  const { id, task, payload } = event.data;
  try {
    const progress = value => self.postMessage({ id, type: 'progress', value });
    const result = task === 'grid'
      ? self.HospitalOptimization.adaptiveGrid(payload.zones, payload.cities, progress)
      : self.HospitalOptimization.outlines(payload.cells, payload.rows, progress);
    self.postMessage({ id, result });
  } catch (error) { self.postMessage({ id, error: String(error.message || error) }); }
};
