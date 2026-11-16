import { readFile, writeFile, rename } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFile(path.join(root, file));
const hash = value => createHash('sha256').update(value).digest('hex');
const M = 111195, COS = Math.cos(54 * Math.PI / 180), SCALE = 100;
const method = 'display-dissolve-clean-2m-v1';

export async function prepareDisplayBoundaries() {
  const ctx = { console, navigator: { userAgent: 'boundary-preparation' } }; ctx.window = ctx; ctx.self = ctx; vm.createContext(ctx);
  vm.runInContext((await read('src/engine/vendor/clipper.js')).toString(), ctx);
  vm.runInContext((await read('public/viewer-data.js')).toString(), ctx);
  const C = ctx.ClipperLib, snapshot = JSON.parse(gunzipSync(Buffer.from(ctx.HospitalViewerData.data, 'base64')));
  const meta = JSON.parse(await read('public/optimization/prepared-meta.json'));
  const resultAuto = JSON.parse(gunzipSync(await read('public/optimization/' + meta.results.auto.file)));
  function pathsFromTree(tree) { return C.JS.PolyTreeToExPolygons(tree).flatMap(p => [p.outer, ...p.holes]); }
  function union(paths) {
    if (!paths.length) return [];
    const clipper = new C.Clipper(C.Clipper.ioStrictlySimple), tree = new C.PolyTree();
    clipper.AddPaths(paths, C.PolyType.ptSubject, true);
    if (!clipper.Execute(C.ClipType.ctUnion, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero)) throw new Error('Boundary dissolve failed.');
    return pathsFromTree(tree);
  }
  function offset(paths, distance) {
    if (!paths.length) return [];
    const offset = new C.ClipperOffset(2, 25), tree = new C.PolyTree();
    offset.AddPaths(paths, C.JoinType.jtRound, C.EndType.etClosedPolygon); offset.Execute(tree, distance);
    return pathsFromTree(tree);
  }
  function clean(polygons) {
    let paths = polygons.flatMap(polygon => polygon.map((ring, i) => {
      let p = ring.map(([lon, lat]) => ({ X: Math.round((lon - 37) * M * COS * SCALE), Y: Math.round((lat - 54) * M * SCALE) }));
      p = C.Clipper.CleanPolygon(p, SCALE);
      if (C.Clipper.Orientation(p) !== (i === 0)) p.reverse(); return p;
    })).filter(p => p.length >= 3 && Math.abs(C.Clipper.Area(p)) > 4 * SCALE * SCALE);
    paths = union(paths);
    // Close sub-grid cracks, then remove needles and zero-width retraced branches.
    // These are display contours only; cell geometries and ownership remain immutable.
    paths = offset(offset(paths, 2 * SCALE), -2 * SCALE);
    paths = offset(offset(paths, -2 * SCALE), 2 * SCALE);
    paths = C.Clipper.CleanPolygons(paths, SCALE).filter(p => {
      if (p.length < 3) return false;
      let perimeter = 0;
      for (let i = 0; i < p.length; i++) perimeter += Math.hypot(p[i].X - p[(i + 1) % p.length].X, p[i].Y - p[(i + 1) % p.length].Y);
      return Math.abs(C.Clipper.Area(p)) / Math.max(perimeter, 1) >= 0.5 * SCALE;
    });
    const clipper = new C.Clipper(C.Clipper.ioStrictlySimple), tree = new C.PolyTree();
    if (!paths.length) return [];
    clipper.AddPaths(paths, C.PolyType.ptSubject, true);
    if (!clipper.Execute(C.ClipType.ctUnion, tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero)) throw new Error('Clean boundary union failed.');
    const ring = path => {
      const r = path.map(p => [37 + p.X / (M * COS * SCALE), 54 + p.Y / (M * SCALE)]); r.push([...r[0]]); return r;
    };
    return C.JS.PolyTreeToExPolygons(tree).map(p => [ring(p.outer), ...p.holes.map(ring)]);
  }
  const boundaries = { before: [], after: [] };
  for (const [scenario, source] of [['before', snapshot.zones], ['after', resultAuto.zones]]) {
    let completed = 0;
    for (const [id, polygons] of source) {
      boundaries[scenario].push([id, clean(polygons)]);
      console.log(JSON.stringify({ stage: 'boundaries', scenario, completed: ++completed, total: source.length }));
    }
  }
  for (const mode of ['auto', 'pedestrian']) {
    const file = 'public/optimization/' + meta.results[mode].file;
    const text = gunzipSync(await read(file)).toString();
    if (hash(text) !== meta.results[mode].checksum) throw new Error('Prepared checksum mismatch.');
    const result = JSON.parse(text); result.boundaries = boundaries; result.boundaryMethod = method;
    const updated = JSON.stringify(result);
    await writeFile(path.join(root, file + '.writing'), gzipSync(updated, { level: 9 })); await rename(path.join(root, file + '.writing'), path.join(root, file));
    meta.results[mode].checksum = hash(updated);
  }
  meta.displayBoundaries = { method, toleranceMeters: 2, assignmentUnchanged: true };
  await writeFile(path.join(root, 'public/optimization/prepared-meta.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(JSON.stringify({ stage: 'complete', method }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareDisplayBoundaries();
