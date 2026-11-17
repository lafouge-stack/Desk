// Calculs sur historiques (indicators.js, CK.ind) : valeurs attendues calculées à la main,
// et propriété « point-in-time » (un calcul à la date T ne dépend jamais des clôtures après T).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeContext } from "./vmkit.mjs";
import { loadInd } from "./histo.mjs";

const { CK, load } = makeContext();
load("indicators.js");
const I = CK.ind;
const DAY = 864e5;
const near = (a, b, eps = 1e-9, m) => assert.ok(a != null && Math.abs(a - b) < eps, `${m || ""} ${a} ≠ ${b}`);
/** Séance chaque jour ouvré (lun-ven) à 16:30 UTC, du d0 inclus, n séances. */
function days(d0, n) { const t = []; let x = Date.parse(d0 + "T16:30:00Z"); while (t.length < n) { const w = new Date(x).getUTCDay(); if (w && w < 6) t.push(x); x += DAY; } return t; }

test("idxAt : dernière clôture ≤ T", () => {
  const t = [10, 20, 30];
  assert.equal(I.idxAt(t, 5), -1); assert.equal(I.idxAt(t, 10), 0); assert.equal(I.idxAt(t, 25), 1); assert.equal(I.idxAt(t, 99), 2);
  assert.equal(I.idxAt([], 1), -1);
});

test("minusMonths : fin de mois et années bissextiles", () => {
  assert.equal(I.ymd(I.minusMonths(Date.UTC(2024, 2, 31, 16), 1)), "2024-02-29");
  assert.equal(I.ymd(I.minusMonths(Date.UTC(2026, 2, 31, 16), 1)), "2026-02-28");
  assert.equal(I.ymd(I.minusMonths(Date.UTC(2026, 0, 15, 16), 12)), "2025-01-15");
  assert.equal(new Date(I.minusMonths(Date.UTC(2026, 0, 15, 16, 30), 3)).getUTCHours(), 16, "garde l'heure");
});

test("perfs : périodes calendaires, null si l'historique est trop court, ytd depuis la dernière clôture de l'an passé", () => {
  // clôture = 100 × (1 + numéro du jour / 1000) : chaque valeur se recalcule à la main
  const t = days("2024-01-02", 600), c = t.map((_, k) => 100 * (1 + k / 1000));
  const p = I.perfs(t, c);
  const e = t.length - 1, at = (T) => c[I.idxAt(t, T)];
  near(p.w, c[e] / at(t[e] - 7 * DAY) - 1, 1e-12, "1 sem");
  near(p.m1, c[e] / at(I.minusMonths(t[e], 1)) - 1, 1e-12, "1 mois");
  near(p.y1, c[e] / at(I.minusMonths(t[e], 12)) - 1, 1e-12, "1 an");
  assert.equal(p.y3, null, "3 ans : historique trop court → null, jamais « depuis le début »");
  assert.equal(p.y5, null);
  const y = new Date(t[e]).getUTCFullYear();
  near(p.ytd, c[e] / at(Date.UTC(y, 0, 1) - 1) - 1, 1e-12, "depuis janvier");
  near(p.max, c[e] / c[0] - 1, 1e-12);
});

test("perfs en mode taux : écarts de niveau (points de %)", () => {
  const t = days("2025-01-02", 300), c = t.map((_, k) => 3 + k * 0.001);
  const p = I.perfs(t, c, undefined, true);
  const e = t.length - 1;
  near(p.m1, c[e] - c[I.idxAt(t, I.minusMonths(t[e], 1))], 1e-12);
  const s = I.summary(t, c, 252, true);
  assert.equal(s.vol1y, null); assert.equal(s.mdd1y, null); assert.equal(s.mdd5y, null);
});

test("point-in-time : un calcul à la date T ignore les clôtures après T", () => {
  const t = days("2020-01-02", 1500), c = t.map((_, k) => 50 + 10 * Math.sin(k / 30) + k / 20);
  const T = t[900];
  const a = I.perfs(t, c, T), va = I.vol(t, c, 252, T), da = I.maxDD(t, c, null, T), sa = I.weekly(t, c, 10, T);
  const c2 = c.slice(); for (let k = 901; k < c2.length; k++) c2[k] = c2[k] * 3 + 1000;   // avenir modifié
  assert.deepEqual(I.perfs(t, c2, T), a);
  assert.equal(I.vol(t, c2, 252, T), va); assert.equal(I.maxDD(t, c2, null, T), da);
  assert.deepEqual(I.weekly(t, c2, 10, T), sa);
});

test("volatilité : nulle pour une croissance régulière, √252 × écart-type sinon ; null si trop peu de données", () => {
  const t = days("2024-01-02", 300);
  near(I.vol(t, t.map((_, k) => 100 * Math.pow(1.001, k))), 0, 1e-12);
  const c = t.map((_, k) => (k % 2 ? 101 : 100)), r = [];
  for (let k = c.length - 252; k < c.length; k++) r.push(Math.log(c[k] / c[k - 1]));
  const m = r.reduce((s, x) => s + x, 0) / r.length, sd = Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1));
  near(I.vol(t, c), sd * Math.sqrt(252), 1e-12);
  near(I.vol(t, c, 252, null, 365), sd * Math.sqrt(365), 1e-12, "crypto : √365");
  assert.equal(I.vol(t.slice(0, 50), c.slice(0, 50)), null);
});

test("perte maximale et plus haut / plus bas sur 52 semaines", () => {
  const t = days("2026-01-05", 5), c = [100, 120, 90, 130, 65];
  near(I.maxDD(t, c), 65 / 130 - 1);
  near(I.maxDD(t, c, null, t[2]), 90 / 120 - 1, 1e-12, "jusqu'à T");
  assert.deepEqual({ ...I.range52(t, c) }, { hi: 130, lo: 65 });
  assert.equal(I.maxDD(t, [100, 101, 102]), 0);
});

test("clôtures hebdomadaires : dernière séance de chaque semaine (lundi-dimanche)", () => {
  const t = days("2026-01-05", 10), c = t.map((_, k) => k + 1);   // 2 semaines : 5 + 5 séances
  assert.deepEqual([...I.weekly(t, c).map((x) => x[1])], [5, 10]);
  assert.deepEqual([...I.weekly(t, c, 1).map((x) => x[1])], [10]);
});

test("summary : champs du résumé publié par le robot", () => {
  const t = days("2020-01-02", 1800), c = t.map((_, k) => 100 + k / 10);
  const s = I.summary(t, c);
  assert.equal(s.d, I.ymd(t[t.length - 1])); assert.equal(s.c, c[c.length - 1]); assert.equal(s.n, 1800);
  assert.equal(s.first, "2020-01-02"); assert.equal(s.spark.length, 52);
  assert.equal(s.mdd1y, 0); assert.ok(s.mdd5y === null || s.mdd5y === 0);
  assert.equal(I.summary([], []), null);
});

test("round : chiffres significatifs", () => {
  assert.equal(I.round(708.80000001, 6), 708.8);
  assert.equal(I.round(0.0001234567, 3), 0.000123);
  assert.equal(I.round(0, 6), 0); assert.equal(I.round(null, 6), null);
});

test("le robot (histo.mjs) charge exactement le même fichier : mêmes résultats", () => {
  const R = loadInd(), t = days("2022-01-03", 900), c = t.map((_, k) => 80 + Math.cos(k / 17) * 5 + k / 30);
  assert.deepEqual(JSON.parse(JSON.stringify(R.summary(t, c))), JSON.parse(JSON.stringify(I.summary(t, c))));
});
