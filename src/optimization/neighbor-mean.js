const METERS = 111195, COS = Math.cos(54 * Math.PI / 180);
const xy = cell => [(cell.origin[1] - 37) * METERS * COS, (cell.origin[0] - 54) * METERS];
const valid = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
function tree(indices, points, depth = 0) {
  if (!indices.length) return null;
  const axis = depth % 2;
  indices.sort((a, b) => points[a][axis] - points[b][axis] || a - b);
  const middle = indices.length >> 1;
  return { index: indices[middle], axis, left: tree(indices.slice(0, middle), points, depth + 1), right: tree(indices.slice(middle + 1), points, depth + 1) };
}
function nearest(root, points, point, count) {
  const best = [];
  function visit(node) {
    if (!node) return;
    const p = points[node.index], distance = (p[0] - point[0]) ** 2 + (p[1] - point[1]) ** 2;
    best.push({ index: node.index, distance });
    best.sort((a, b) => a.distance - b.distance || a.index - b.index);
    if (best.length > count) best.pop();
    const delta = point[node.axis] - p[node.axis];
    visit(delta <= 0 ? node.left : node.right);
    if (best.length < count || delta * delta <= best.at(-1).distance) visit(delta <= 0 ? node.right : node.left);
  }
  visit(root);
  return best.map(p => p.index);
}

/** Fill each hospital column independently; only original measured cells are donors. */
export function fillMatrixFromNeighbors(cells, input, columns, count = 8, progress = () => {}) {
  if (input.length !== cells.length * columns || !Number.isInteger(count) || count < 1) throw new Error('Неверный размер матрицы для заполнения соседями.');
  const points = cells.map(xy), values = input.slice(), inferredIndices = [], groups = new Map();
  for (let column = 0; column < columns; column++) {
    const known = [];
    for (let row = 0; row < cells.length; row++) if (valid(input[row * columns + column])) known.push(row);
    if (!known.length) throw new Error('У одной из больниц нет ни одного времени для расчёта среднего по соседям.');
    const signature = known.join(',');
    let group = groups.get(signature);
    if (!group) { group = { root: tree(known, points), donors: new Map() }; groups.set(signature, group); }
    for (let row = 0; row < cells.length; row++) {
      const index = row * columns + column;
      if (valid(input[index])) continue;
      let donors = group.donors.get(row);
      if (!donors) { donors = nearest(group.root, points, points[row], count); group.donors.set(row, donors); }
      values[index] = donors.reduce((sum, donor) => sum + input[donor * columns + column], 0) / donors.length;
      inferredIndices.push(index);
    }
    progress(column + 1, columns);
  }
  return { values, inferredIndices, method: 'measured-neighbor-arithmetic-mean-8-v1' };
}
