// Protège le screener crypto existant : l'indice de compression (CHOP 14), le RSI, l'ATR % et les métriques
// doivent donner EXACTEMENT les mêmes résultats qu'au 12/11/2026 (valeurs figées dans golden-chop.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeContext, candles } from "./vmkit.mjs";

const golden = JSON.parse(readFileSync(new URL("./golden-chop.json", import.meta.url), "utf8"));
const { load } = makeContext();
const t = load("screener.js").screener._t;

test("les fonctions de calcul du screener sont accessibles", () => {
  for (const k of ["sma", "chop", "rsi", "atrp", "metrics"]) assert.equal(typeof t[k], "function", k);
});

for (const g of golden.cases) {
  test(`valeurs identiques à la référence (graine ${g.seed}, ${g.n} bougies)`, () => {
    const c = candles(g.n, g.seed);
    const cl = c.map((x) => x.c);
    assert.equal(t.chop(c), g.chop, "CHOP 14");
    assert.equal(t.chop(c, 20), g.chop20, "CHOP 20");
    assert.equal(t.rsi(cl), g.rsi, "RSI");
    assert.equal(t.rsi(cl.slice(-120)), g.rsi120, "RSI sur 120 clôtures");
    assert.equal(t.atrp(c), g.atrp, "ATR %");
    assert.equal(t.sma(cl, 50), g.sma50, "MM50");
    const m = t.metrics({ base: "T" + g.seed, type: "spot", inst: "T-USDT", usd: 1e7, chg: 1.5 }, c, null);
    assert.deepEqual(JSON.parse(JSON.stringify(m)), g.metrics, "metrics()");
  });
}

test("CHOP : formule documentée (100·log10(ΣTR14 / (HH14−LL14)) / log10(14))", () => {
  const c = candles(40, 99);
  const n = 14, w = c.slice(-n);
  let tr = 0;
  for (let i = c.length - n; i < c.length; i++) tr += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
  const hh = Math.max(...w.map((x) => x.h)), ll = Math.min(...w.map((x) => x.l));
  const attendu = 100 * Math.log10(tr / (hh - ll)) / Math.log10(n);
  assert.ok(Math.abs(t.chop(c) - attendu) < 1e-9);
});

test("CHOP : null s'il y a moins de 15 bougies", () => {
  assert.equal(t.chop(candles(14, 3)), null);
  assert.notEqual(t.chop(candles(15, 3)), null);
});

test("CHOP : null si le prix ne bouge pas (amplitude nulle)", () => {
  const plat = Array.from({ length: 30 }, () => ({ h: 10, l: 10, c: 10, v: 1 }));
  assert.equal(t.chop(plat), null);
});

test("RSI : 100 si le prix ne fait que monter", () => {
  const cl = Array.from({ length: 30 }, (_, i) => 100 + i);
  assert.equal(t.rsi(cl), 100);
});
