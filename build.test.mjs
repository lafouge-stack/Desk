// Vérifie que le Desk se construit (node build.mjs) et que index.html contient bien tous les fichiers sources.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rd = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const buildSrc = rd("build.mjs");
const JS = JSON.parse(buildSrc.match(/const JS = (\[[^\]]*\])/)[1]).map((f) => `${f}.js`);
const CSS = JSON.parse(buildSrc.match(/const CSS = (\[[^\]]*\])/)[1]);

test("aucun fichier source ne contient </script ou </style", () => {
  for (const f of [...JS, "config.js"]) assert.ok(!/<\/script/i.test(rd(f)), f);
  for (const f of CSS) assert.ok(!/<\/style/i.test(rd(f)), f);
});

test("node build.mjs réussit", () => {
  const out = execFileSync(process.execPath, [fileURLToPath(new URL("./build.mjs", import.meta.url))], { encoding: "utf8" });
  assert.match(out, /^OK · index\.html/);
});

test("index.html contient chaque fichier JS, CSS et la config", () => {
  const html = rd("index.html");
  for (const f of JS) assert.ok(html.includes(rd(f).trim().slice(0, 400)), `début de ${f}`);
  for (const f of CSS) assert.ok(html.includes(rd(f).trim().slice(0, 400)), `début de ${f}`);
  assert.ok(html.includes("window.COCKPIT_CONFIG"), "config.js");
});
