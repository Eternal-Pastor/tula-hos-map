import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import vm from "node:vm";
import { transformSync } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { read } from "./helpers.mjs";

const compiled = transformSync(
  read("src/components/ui/progress.tsx").toString(),
  {
    loader: "tsx",
    format: "cjs",
    target: "es2022",
  },
);
const module = { exports: {} };
vm.runInNewContext(compiled.code, {
  module,
  exports: module.exports,
  require: createRequire(import.meta.url),
  console,
});
const { Progress } = module.exports;

test("progress exposes its real value and maximum to assistive technology", () => {
  const html = renderToStaticMarkup(
    React.createElement(Progress, {
      value: 25,
      max: 50,
      "aria-label": "Маршруты",
    }),
  );
  assert.match(html, /aria-valuenow="25"/);
  assert.match(html, /aria-valuemax="50"/);
  assert.match(html, /translateX\(-50%\)/);
  assert.match(html, /aria-label="Маршруты"/);
});

test("unknown progress stays indeterminate without announcing a false zero", () => {
  const html = renderToStaticMarkup(
    React.createElement(Progress, {
      value: null,
      "aria-label": "Восстановление",
    }),
  );
  assert.match(html, /data-state="indeterminate"/);
  assert.doesNotMatch(html, /aria-valuenow=/);
});
