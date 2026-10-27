import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { context, engineFiles, plain, snapshot } from "./helpers.mjs";
import { createDeveloperUI } from "../src/runtime/developer-ui-store.js";

const E = context(engineFiles), A = E.HospitalAccessibility;
const testEngines = { A, V: E.HospitalViewer, jobs: E.HospitalZoneJobs };
async function loadModule(entry) {
  const output = await build({
    entryPoints: [entry], bundle: true, write: false, format: "cjs",
    platform: "node", packages: "external", target: "es2022",
    plugins: [{ name: "test-engine-boundary", setup(builder) {
      builder.onResolve({ filter: /(^|\/)engine$/ }, () => ({ path: "engines", namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents:
        "export const accessibility = globalThis.testEngines.A; export const viewerEngine = globalThis.testEngines.V; export const jobs = globalThis.testEngines.jobs;" }));
    } }],
  });
  const sandbox = { module: { exports: {} }, require: createRequire(import.meta.url), testEngines,
    window: E, localStorage: { getItem: () => null, setItem() {} },
    document: { baseURI: "http://localhost:8765/" },
    AbortController, DOMException, URL, setTimeout, clearTimeout, queueMicrotask, console,
  };
  vm.runInNewContext(output.outputFiles[0].text, sandbox);
  return { exports: sandbox.module.exports, sandbox };
}

class Collection {
  items = [];
  add(value) { this.items.push(value); return this; }
  remove(value) { this.items = this.items.filter(item => item !== value); }
  removeAll() { this.items = []; }
}
class Shape {
  events = { add() {} };
  constructor(geometry, properties, options) { this.geometry = geometry; this.properties = properties; this.options = options; }
}
const api = { GeoObjectCollection: Collection, Polygon: Shape, Polyline: Shape, Placemark: Shape };
const seconds = [3599.9, 3600, 3600.1, 7200, null];
const cells = seconds.map((_, index) => ({
  id: String(index), organizationId: "hospital", origin: [54, 37 + index / 100],
  geometry: [[[37, 54], [37.01, 54], [37.01, 54.01], [37, 54]]],
}));
const times = new Map(cells.map((cell, i) => [cell.id, {
  auto: { seconds: seconds[i], source: "osrm", donors: [] },
  pedestrian: { seconds: seconds[i], source: i === 1 ? "neighbor" : "osrm", donors: [] },
}]));
const summary = Object.fromEntries(["auto", "pedestrian"].map(mode => [mode,
  { measured: 4, neighbor: 1, distance: 0, missing: 0 }]));

test("walking display accepts exactly one hour without clamping or changing either source", () => {
  assert.deepEqual([0, 3599.9, 3600, 3600.1, null, NaN, Infinity, -1]
    .map(value => A.visibleTime("pedestrian", value)), [true, true, true, false, false, false, false, false]);
  assert.ok([3600.1, 7200, null].every(value => A.visibleTime("auto", value)));
  assert.deepEqual(seconds.map(value => A.displayBand("pedestrian", value)), [2, 2, 4, 4, 4]);
  assert.deepEqual(seconds.map(value => A.displayBand("auto", value)), [2, 2, 3, 3, 4]);
  const { data: S } = snapshot(), records = new Map(S.routes.map(route => [route.key, route]));
  const before = JSON.stringify([...records]);
  const completed = A.completeTimes(S.cells, new Map(S.hospitals.map(h => [h.id, h.coords])), records, S.services);
  const shown = [...completed.values.values()].filter(value => A.visibleTime("pedestrian", value.pedestrian.seconds));
  assert.equal(shown.length, 102);
  assert.equal([...completed.values.values()].filter(value => A.displayBand("pedestrian", value.pedestrian.seconds) === 4).length, 1840);
  assert.equal(JSON.stringify([...records]), before, "display filtering does not rewrite the route cache");
  assert.ok([...completed.values.values()].some(value => value.pedestrian.seconds > 3600));
  assert.deepEqual(plain(completed.summary.pedestrian), { measured: 1733, neighbor: 209, distance: 0, missing: 0 });
});

test("viewer colors the walking boundary, fills longer and missing walking cells gray, and preserves car bands", async () => {
  const { exports: { ViewerMap } } = await loadModule("src/services/viewer-map.ts");
  const map = { geoObjects: new Collection(), setBounds() {}, container: { fitToViewport() {} } };
  const state = { hospitals: [{ id: "hospital", name: "Больница", coords: [54, 37], color: "green" }],
    mode: "travel", transport: "pedestrian" };
  const store = { getSnapshot: () => state, times, cells, select() {}, zones: new Map() };
  const before = JSON.stringify([...times]);
  const viewer = new ViewerMap(api, { create: () => map, destroy() {} }, store);
  await viewer.draw();
  const layer = map.geoObjects.items[0];
  assert.equal(layer.items.length, seconds.length);
  assert.deepEqual(layer.items.map(shape => shape.options.fillColor), [2, 2, 4, 4, 4].map(band => A.COLORS[band]));
  assert.match(layer.items[1].properties.hintContent, /≈ 60 мин/);
  state.transport = "auto";
  await viewer.draw();
  assert.equal(layer.items.length, seconds.length);
  assert.deepEqual(layer.items.map(shape => shape.options.fillColor), [2, 2, 3, 3, 4].map(band => A.COLORS[band]));
  state.mode = "zones";
  store.zones.set("hospital", [cells[0].geometry]);
  await viewer.draw();
  assert.equal(layer.items.length, 1, "walking selection does not hide attachment zones");
  assert.equal(JSON.stringify([...times]), before);
  viewer.dispose();
});

test("developer colors the same walking boundary and gray remainder while preserving all source values", async () => {
  const { exports: { createDeveloperAccessibility }, sandbox } = await loadModule("src/runtime/developer-accessibility.js");
  sandbox.Worker = class {
    postMessage(message) {
      const result = message.task === "grid" ? { cells } : { values: times, summary };
      queueMicrotask(() => this.onmessage?.({ data: { id: message.id, result } }));
    }
    terminate() {}
  };
  const map = { geoObjects: new Collection() }, ui = createDeveloperUI();
  const controller = createDeveloperAccessibility(ui).create({
    context: () => ({ revision: 1, epoch: 1, pending: false, map, ym: api,
      organizations: [{ id: "hospital", shortName: "Больница" }],
      destinations: new Map([["hospital", [54, 37]]]), zones: new Map([["hospital", []]]) }),
    persist: async () => { throw new Error("display must never persist inferred values"); },
    notify() {}, onChange() {},
  });
  const before = JSON.stringify([...times]);
  const waitFor = async (predicate) => {
    for (let n = 0; n < 100 && !predicate(); n++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(predicate(), "renderer completed within test deadline");
  };
  try {
    controller.refresh();
    const layer = map.geoObjects.items[0];
    await waitFor(() => layer.items.length === 5);
    ui.change("travel-mode", "pedestrian");
    await waitFor(() => layer.items.length === 5 && layer.items.filter(shape => shape.options.fillColor === A.COLORS[4]).length === 3);
    assert.deepEqual(layer.items.map(shape => shape.options.fillColor), [2, 2, 4, 4, 4].map(band => A.COLORS[band]));
    assert.match(layer.items[1].properties.hintContent, /≈ 60/);
    assert.match(ui.get("access-legend-method").textContent, /60 минут включительно/);
    ui.change("travel-mode", "auto");
    await waitFor(() => layer.items.length === 5 && layer.items.filter(shape => shape.options.fillColor === A.COLORS[4]).length === 1);
    assert.deepEqual(layer.items.map(shape => shape.options.fillColor), [2, 2, 3, 3, 4].map(band => A.COLORS[band]));
    assert.equal(controller.records().length, 0);
    assert.equal(JSON.stringify([...times]), before);
  } finally { controller.dispose(); }
});

test("attachment mode has no legend element; load and travel legends survive with accurate walking bands", async () => {
  const { exports: { ViewerLegend } } = await loadModule("src/viewer/ViewerLegend.tsx");
  const render = (mode, transport = "auto") => renderToStaticMarkup(createElement(ViewerLegend,
    { state: { mode, transport }, store: { setTransport() {} } }));
  assert.equal(render("zones"), "");
  assert.match(render("load"), /Прикреплено на 1 000 жителей/);
  assert.match(render("travel"), /&gt; 60 мин/);
  const walking = render("travel", "pedestrian");
  assert.doesNotMatch(walking, /&gt; 60 мин/);
  assert.match(walking, /60 минут включительно/);
  assert.match(walking, /30–60 мин/);
  assert.match(walking, /Вне часа \/ нет данных/);
  assert.match(walking, /показаны серым/);
});
