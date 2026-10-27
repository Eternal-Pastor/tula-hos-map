import test from "node:test";
import assert from "node:assert/strict";
import { read } from "./helpers.mjs";
import { createDeveloperUI } from "../src/runtime/developer-ui-store.js";

test("calculation coordinators never query or replace React UI DOM", () => {
  for (const file of [
    "src/runtime/developer-controller.js",
    "src/runtime/developer-accessibility.js",
  ]) {
    const source = read(file).toString();
    assert.doesNotMatch(
      source,
      /querySelector|innerHTML|showModal\(\)\s*;?\s*document/,
    );
    assert.match(source, /ui\.(get|setData)/);
  }
});

test("headless fields publish changes, preserve commands and dispatch React input values", async () => {
  const ui = createDeveloperUI();
  let notifications = 0,
    received;
  const unsubscribe = ui.subscribe(() => notifications++);
  const step = ui.get("access-step");
  step.onchange = (event) => {
    received = event.target.value;
  };
  ui.change("access-step", "10000");
  ui.get("backup-dialog").showModal();
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(received, "10000");
  assert.equal(ui.get("access-step").value, "10000");
  assert.equal(ui.get("backup-dialog").open, true);
  assert.equal(
    notifications,
    1,
    "coordinator updates share one React notification",
  );
  ui.get("backup-dialog").close();
  assert.equal(ui.get("backup-dialog").open, false);
  unsubscribe();
  ui.clearCommands();
  assert.equal(step.onchange, null);
});
