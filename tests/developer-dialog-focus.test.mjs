import test from "node:test";
import assert from "node:assert/strict";
import {
  rememberDialogOpener,
  restoreDialogFocus,
  hasDialogOpener,
} from "../src/developer/dialog-focus.js";

test("dialog returns to the React event opener after autofocus and nested file selection", () => {
  const store = {},
    focused = [];
  const opener = {
    tagName: "BUTTON",
    isConnected: true,
    closest: () => null,
    focus: () => focused.push("open-settings"),
  };
  const input = {
    tagName: "INPUT",
    isConnected: true,
    closest: () => null,
    focus: () => focused.push("api-key"),
  };
  rememberDialogOpener(store, "settings-dialog", opener, false);
  rememberDialogOpener(store, "settings-dialog", input, true);
  assert.equal(hasDialogOpener(store, "settings-dialog"), true);
  assert.equal(restoreDialogFocus(store, "settings-dialog", null), true);
  assert.deepEqual(focused, ["open-settings"]);
  assert.equal(hasDialogOpener(store, "settings-dialog"), false);
});

test("dialog uses the visible toolbar fallback when connecting the map hides its opener", () => {
  const store = {},
    focused = [];
  const hidden = {
    tagName: "BUTTON",
    isConnected: true,
    closest: () => ({ hidden: true }),
    focus: () => focused.push("connect-map"),
  };
  const fallback = {
    tagName: "BUTTON",
    isConnected: true,
    closest: () => null,
    focus: () => focused.push("open-settings"),
  };
  rememberDialogOpener(store, "settings-dialog", hidden, false);
  assert.equal(restoreDialogFocus(store, "settings-dialog", fallback), true);
  assert.deepEqual(focused, ["open-settings"]);
});
