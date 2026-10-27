import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { context, engineFiles } from "./helpers.mjs";
import { createDeveloperUI } from "../src/runtime/developer-ui-store.js";

const bundled = await build({
  entryPoints: ["src/runtime/developer-controller.js"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
});
const { mountDeveloperController } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString("base64")}`
);

test("developer unmount during IndexedDB read and pending backup open never touches detached UI", async () => {
  const E = context([...engineFiles, "public/data.js"]);
  let rejectRead;
  const pendingRead = new Promise((_resolve, reject) => {
    rejectRead = reject;
  });
  E.HospitalLocalCache.read = () => pendingRead;
  E.setInterval = setInterval;
  E.clearInterval = clearInterval;
  let detached = false,
    destroyCount = 0,
    modalCount = 0;
  const ui = createDeveloperUI();
  const node = ui.get;
  const globals = {
    window: E,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    CSS: { escape: (value) => value },
    document: {
      baseURI: "http://localhost:8765/",
      body: { classList: { toggle() {} } },
    },
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  try {
    let tableUpdates = 0;
    const dispose = mountDeveloperController(
      ui,
      {
        destroy() {
          destroyCount++;
        },
      },
      {
        update(source) {
          assert.equal(detached, false, "table snapshot after unmount");
          assert.equal(source.data.organizations.length, 38);
          tableUpdates++;
        },
        open() {
          assert.equal(detached, false, "table navigation after unmount");
        },
      },
    );
    assert.ok(
      tableUpdates > 0,
      "initial data is delivered through the explicit table boundary",
    );
    const backupOpening = node("open-backup").onclick();
    dispose();
    assert.equal(
      node("open-backup").onclick,
      null,
      "headless commands are removed",
    );
    assert.equal(
      ui.get("view").value,
      "map",
      "React reads page selection from the headless store",
    );
    detached = true;
    rejectRead(new Error("IndexedDB read finished after unmount"));
    await backupOpening;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(modalCount, 0);
    assert.equal(destroyCount, 1);
    dispose();
    assert.equal(destroyCount, 1, "cleanup is idempotent");
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test("controller delivers current table snapshots and card navigation without accessing React table controls", async () => {
  const E = context([...engineFiles, "public/data.js"]);
  const organizationId = "tolstoy";
  const group = E.HospitalTerritories.index(E.HOSPITAL_DATA).byOrganization.get(
    organizationId,
  )[0];
  let finishRead;
  E.HospitalLocalCache.read = () =>
    new Promise((resolve) => {
      finishRead = resolve;
    });
  E.HospitalLocalCache.write = async () => {};
  E.setInterval = setInterval;
  E.clearInterval = clearInterval;
  const snapshots = [],
    opened = [],
    ui = createDeveloperUI();
  const node = ui.get;
  let detached = false,
    dispose;
  const globals = {
    window: E,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    CSS: { escape: (value) => value },
    document: {
      baseURI: "http://localhost:8765/",
      body: { classList: { toggle() {} } },
    },
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  try {
    dispose = mountDeveloperController(
      ui,
      { destroy() {} },
      {
        update(source) {
          assert.equal(detached, false);
          snapshots.push(source);
        },
        open(request) {
          assert.equal(detached, false);
          opened.push(request);
        },
      },
    );
    const initial = snapshots.at(-1);
    assert.equal(initial.ruleAttempts.has(group.id), false);
    finishRead([
      {
        key: "rule:" + group.id,
        type: "rule",
        id: group.id,
        status: "failed",
        error: "адрес не найден",
      },
    ]);
    await new Promise((resolve) => setImmediate(resolve));
    const restored = snapshots.at(-1);
    assert.equal(
      restored.ruleAttempts.has(group.id),
      true,
      "restored address status reaches the table boundary",
    );
    assert.equal(restored.ruleFailures.get(group.id), "адрес не найден");
    assert.equal(
      initial.ruleAttempts.has(group.id),
      false,
      "published snapshots do not change behind React",
    );

    node("metric").value = "absolute";
    node("metric").onchange();
    assert.equal(snapshots.at(-1).metricLabel, "прикреплённых");
    assert.equal(
      snapshots.at(-1).organizationValues.get(organizationId).metric,
      49683,
    );
    assert.equal(
      restored.organizationValues.get(organizationId).metric,
      null,
      "previous metric snapshot remains stable",
    );

    ui.invoke("select-organization", "click", organizationId);
    node("open-areas").onclick();
    node("review-rules").onclick();
    assert.deepEqual(opened, [
      { kind: "areas", organizationId, search: "" },
      { kind: "territories", organizationId, search: "Не подтверждено" },
    ]);

    node("detail-population").onchange({ target: { value: "city-0" } });
    node("population-value").value = "600000";
    node("save-population").onclick();
    const populationSnapshot = snapshots.at(-1);
    assert.equal(populationSnapshot.populationValues["city-0"], 600000);
    assert.equal(
      populationSnapshot.organizationValues.get(organizationId).population
        .value,
      600000,
    );
    assert.equal(restored.populationValues["city-0"], undefined);

    node("manual-lat").value = "54.1";
    node("manual-lon").value = "37.2";
    node("save-coordinates").onclick();
    assert.deepEqual(
      snapshots.at(-1).organizationValues.get(organizationId).coords,
      [54.1, 37.2],
      "coordinate snapshot keeps latitude before longitude",
    );

    await node("retry-rules").onclick();
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      snapshots.at(-1).ruleAttempts.has(group.id),
      false,
      "reset address verification reaches React without a full render or table navigation",
    );
    assert.equal(snapshots.at(-1).ruleFailures.has(group.id), false);
    assert.equal(
      restored.ruleAttempts.has(group.id),
      true,
      "later resets do not mutate earlier snapshots",
    );
    await node("retry-rules").onclick();
    dispose();
    detached = true;
    const delivered = snapshots.length;
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(
      snapshots.length,
      delivered,
      "no delayed table delivery after disposal",
    );
  } finally {
    dispose?.();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test("React backup commands preview checksum errors and restore merge/replace with a previous-project checkpoint", async () => {
  const E = context([...engineFiles, "public/data.js"]);
  const data = E.HOSPITAL_DATA,
    index = E.HospitalTerritories.index(data);
  const groups = [...index.byOrganization.values()].flat();
  const record = (group) => ({
    key: "rule:" + group.id,
    type: "rule",
    id: group.id,
    status: "failed",
    error: "Не найден адрес",
  });
  let stored = [record(groups[0])],
    checkpoint = null,
    installs = 0;
  E.HospitalLocalCache.read = async () => stored;
  E.HospitalLocalCache.write = async () => {};
  E.HospitalLocalCache.checkpoint = async () => checkpoint;
  E.HospitalLocalCache.install = async (records, options) => {
    stored = records;
    checkpoint = options.checkpoint;
    installs++;
  };
  E.setInterval = setInterval;
  E.clearInterval = clearInterval;
  const dataset = await E.HospitalBackup.digest({
    organizations: data.organizations.map((o) => ({
      id: o.id,
      location: o.location,
    })),
    groups: [...index.byOrganization].map(([id, groups]) => [
      id,
      groups.map((g) => [g.id, g.address]),
    ]),
  });
  const backup = await E.HospitalBackup.create({
    settings: { metric: "absolute", showEmpty: true },
    routing: { step: 10000 },
    records: [record(groups[1])],
    dataset,
  });
  const globals = {
    window: E,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { baseURI: "http://localhost:8765/" },
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  const ui = createDeveloperUI();
  let dispose;
  const preview = (value) =>
    ui.invoke("backup-file", "change", {
      target: {
        value: "selected.json",
        files: [{ size: 100, text: async () => JSON.stringify(value) }],
      },
    });
  try {
    dispose = mountDeveloperController(
      ui,
      { destroy() {} },
      { update() {}, open() {} },
    );
    await ui.invoke("open-backup");
    assert.equal(ui.get("backup-dialog").open, true);
    const corrupt = JSON.parse(JSON.stringify(backup));
    corrupt.payload.records[0].status = "tampered";
    await preview(corrupt);
    assert.match(ui.get("backup-status").textContent, /Контрольная сумма/);
    assert.equal(ui.get("backup-status").error, true);
    assert.equal(installs, 0, "invalid files never reach storage");
    await preview(backup);
    assert.equal(ui.get("backup-preview").hidden, false);
    assert.equal(ui.get("backup-status").error, false);
    assert.equal(ui.get("backup-status").success, true);
    await ui.invoke("backup-apply");
    assert.equal(
      stored.filter((item) => item.type === "rule").length,
      2,
      "merge retains current and imported records",
    );
    assert.equal(
      checkpoint.payload.records.filter((item) => item.type === "rule").length,
      1,
    );
    assert.equal(ui.get("metric").value, "absolute");
    assert.equal(ui.get("access-step").value, 10000);
    assert.match(ui.get("backup-status").textContent, /Проект восстановлен/);
    await preview(backup);
    ui.change("backup-mode", "replace");
    await ui.invoke("backup-apply");
    assert.equal(
      stored.filter((item) => item.type === "rule").length,
      1,
      "replace restores the selected project",
    );
    assert.equal(
      checkpoint.payload.records.filter((item) => item.type === "rule").length,
      2,
      "previous merged project is recoverable",
    );
    assert.equal(ui.get("backup-previous").disabled, false);
  } finally {
    dispose?.();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test("successful map connection replaces the loading status before settings reopen", async () => {
  const E = context([...engineFiles, "public/data.js"]);
  E.HOSPITAL_DATA = { ...E.HOSPITAL_DATA, organizations: [] };
  E.HospitalLocalCache.read = async () => [];
  E.HospitalLocalCache.write = async () => {};
  E.setInterval = setInterval;
  E.clearInterval = clearInterval;
  class Collection {
    add() {
      return this;
    }
    removeAll() {}
    getBounds() {
      return null;
    }
  }
  const api = {
    ready: (callback) => callback(),
    GeoObjectCollection: Collection,
  };
  const map = {
    geoObjects: new Collection(),
    container: { fitToViewport() {} },
    setBounds() {},
    setCenter() {},
  };
  const ui = createDeveloperUI();
  const globals = {
    window: E,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: {
      baseURI: "http://localhost:8765/",
      createElement: () => ({ remove() {} }),
      head: {
        append(script) {
          const name = new URL(script.src).searchParams.get("ns");
          E[name] = api;
          script.onload();
        },
      },
    },
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  let dispose;
  try {
    dispose = mountDeveloperController(
      ui,
      { create: () => map, destroy() {} },
      { update() {}, open() {} },
    );
    await new Promise((resolve) => setImmediate(resolve));
    ui.get("api-key").value = "test-key";
    ui.invoke("open-settings");
    ui.invoke("key-form", "submit");
    for (
      let attempt = 0;
      attempt < 30 && ui.get("settings-dialog").open;
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(ui.get("settings-dialog").open, false);
    assert.equal(ui.get("open-settings").textContent, "Настройки карты");
    assert.match(ui.get("key-status").textContent, /Яндекс Карты подключены/);
    assert.equal(ui.get("key-status").success, true);
    assert.equal(ui.get("key-status").error, false);
    assert.doesNotMatch(ui.get("key-status").textContent, /Подключение API/);
    ui.invoke("open-settings");
    assert.match(ui.get("key-status").textContent, /Яндекс Карты подключены/);
  } finally {
    dispose?.();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
