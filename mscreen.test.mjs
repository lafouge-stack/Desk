// Screener mensuel multi-actifs (phase 6) : mscreen.js (calculs) et msui.js (rendu), avec les vrais modules.
// Vérifie : dividendes réinvestis sans regarder vers l'avenir, point-in-time (rien après la date de décision),
// indice de compression = fonction du screener crypto inchangée, pondérations lues dans allocation.json,
// table d'étiquettes (une seule étiquette, jamais d'action hors de tes classes, pas d'étiquette sans règles),
// bascule (moins cher, PEA, coût de bascule), rendu (avertissement, textes échappés, filtres).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeContext } from "./vmkit.mjs";

const rd = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const REF = JSON.parse(rd("./referentiel.json")), ALLOC = JSON.parse(rd("./allocation.json")), FISCAL = JSON.parse(rd("./fiscal.json"));
const DISC = "Les informations affichées ne constituent pas un conseil en investissement personnalisé. Les performances passées ne préjugent pas des performances futures.";
const NOW = Date.parse("2026-11-17T10:00:00Z"), DAY = 864e5;

function setup(alloc = ALLOC) {
  const { CK, load } = makeContext();
  for (const f of ["models.js", "datakit.js", "fx.js", "calendars.js", "pea.js", "providers.js", "indicators.js", "screener.js", "pfcore.js", "selection.js", "allocation.js", "prefs.js", "mscreen.js", "msui.js"]) load(f);
  CK.models.setData("referentiel", REF); CK.models.setData("allocation", alloc); CK.models.setData("fiscal", FISCAL);
  CK.dk.env = Object.assign({}, CK.dk.env, { now: () => NOW, fetch: () => Promise.reject(new Error("réseau coupé")), indexedDB: null });
  return { CK, MS: CK.ms, T: CK.alloc.decision(NOW).T };
}
/** Bougies quotidiennes déterministes (jours ouvrés), dérive et volatilité données. */
function bars(seed, drift, vol, from = "2016-01-04") {
  let s = seed >>> 0; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const out = []; let p = 100;
  for (let ts = Date.parse(from + "T16:30:00Z"); ts < NOW; ts += DAY) {
    const d = new Date(ts).getUTCDay(); if (d === 0 || d === 6) continue;
    const z = (r() + r() + r() + r() - 2) * 1.732, o = p; p *= Math.exp(drift / 252 + vol / Math.sqrt(252) * z);
    out.push({ timestamp: ts, open: o, high: Math.max(o, p) * (1 + r() * 0.004), low: Math.min(o, p) * (1 - r() * 0.004), close: p, volume: 1000 + Math.round(r() * 500) });
  }
  return out;
}
const prefsAll = (CK, extra = {}) => CK.models.normPrefs(Object.assign({ saved: true,
  classes: { actions: true, obligations: true, oblig_etat: true, oblig_entreprise: true, matieres_premieres: true, or: true, crypto: true, liquidites: true },
  vehicles: { etf: true, etc_etn: true, titre: true, spot_crypto: true, cash: true, fonds: true } }, extra));
function universe(CK, MS, ids, seedBase = 1) {
  const series = {}; ids.forEach((id, k) => { series[id] = MS.prep(bars(seedBase + k, 0.03 + (k % 5) * 0.03, 0.12 + (k % 3) * 0.05), null, "EUR", null); });
  for (const r of Object.values(MS.REFS)) if (!series[r]) series[r] = MS.prep(bars(99, 0.07, 0.15), null, "EUR", null);
  return series;
}
const IDS = ["isin:LU1681043599", "isin:IE0002XZSHO1", "isin:FR0011871128", "isin:IE00B5BMR087", "isin:FR0000120271", "isin:IE00B4WXJJ64", "isin:IE00B4ND3602", "isin:JE00B78CGV99", "isin:FR0010342592", "isin:LU1190417599"];

describe("séries", () => {
  test("dividendes réinvestis : le cours ne change qu'à partir de la date de détachement", () => {
    const { CK } = setup();
    const t = [1, 2, 3, 4].map((d) => d * DAY), c = [100, 100, 98, 99];
    const tr = CK.ind.totalReturn(t, c, [[3 * DAY, 2]]);
    assert.deepEqual([...tr.slice(0, 2)], [100, 100]);
    assert.ok(Math.abs(tr[2] - 98 * 1.02) < 1e-9 && Math.abs(tr[3] - 99 * 1.02) < 1e-9);
    assert.deepEqual([...CK.ind.totalReturn(t, c, null)], c);
  });
  test("conversion en euros à la date de chaque clôture ; o / h / l suivent le facteur de rendement total", () => {
    const { MS } = setup();
    const b = [{ timestamp: Date.parse("2024-01-02T21:00:00Z"), open: 9, high: 11, low: 8, close: 10, volume: 5 }, { timestamp: Date.parse("2024-01-03T21:00:00Z"), open: 10, high: 12, low: 9, close: 10, volume: 5 }];
    const S = MS.prep(b, [[Date.parse("2024-01-03T00:00:00Z"), 1]], "USD", (c, d) => (d === "2024-01-02" ? 0.9 : 0.8));
    assert.equal(S.c[0], 9); assert.ok(Math.abs(S.c[1] - 10 * 1.1 * 0.8) < 1e-9); assert.ok(Math.abs(S.h[1] - 12 * 1.1 * 0.8) < 1e-9);
    assert.ok(Math.abs(S.raw[1] - 8) < 1e-9, "cours brut gardé pour la liquidité");
  });
});

describe("indicateurs", () => {
  test("indice de compression : exactement la fonction CHOP du screener crypto (inchangée) sur les 15 dernières bougies", () => {
    const { CK, MS, T } = setup();
    const S = MS.prep(bars(3, 0.05, 0.2), null, "EUR", null), m = MS.analyze(S, T, 252, null);
    const e = CK.ind.idxAt(S.t, T), cs = []; for (let k = e - 14; k <= e; k++) cs.push({ h: S.h[k], l: S.l[k], c: S.c[k] });
    assert.equal(m.chop, CK.screener._t.chop(cs, 14));
    assert.ok(m.chopPct >= 0 && m.chopPct <= 100);
  });
  test("tendance : 100 sur une série qui monte régulièrement, 0 sur une série qui baisse", () => {
    const { MS, T } = setup();
    const up = bars(5, 0.4, 0.02), down = up.map((b) => Object.assign({}, b, { close: 1e4 / b.close, open: 1e4 / b.open, high: 1e4 / b.low, low: 1e4 / b.high }));
    assert.equal(MS.analyze(MS.prep(up, null, "EUR", null), T, 252, null).trendPts, 100);
    assert.equal(MS.analyze(MS.prep(down, null, "EUR", null), T, 252, null).trendPts, 0);
  });
  test("point-in-time : changer les cours APRÈS la date de décision ne change ni les scores ni les étiquettes", () => {
    const { CK, MS, T } = setup();
    const series = universe(CK, MS, IDS);
    const bumped = {}; for (const [k, S] of Object.entries(series)) bumped[k] = Object.assign({}, S, { c: S.c.map((v, i) => (S.t[i] > T ? v * 5 : v)), h: S.h.map((v, i) => (S.t[i] > T ? v * 5 : v)), l: S.l.map((v, i) => (S.t[i] > T ? v * 0.1 : v)) });
    const p = prefsAll(CK), a = MS.run({ T, series, ids: IDS, prefs: p, rf12: 0.02 }), b = MS.run({ T, series: bumped, ids: IDS, prefs: p, rf12: 0.02 });
    assert.deepEqual(a.rows.map((r) => [r.id, r.score, r.label]), b.rows.map((r) => [r.id, r.score, r.label]));
  });
  test("pondérations lues dans allocation.json (MSCREEN_WEIGHTS) : score = moyenne pondérée des sous-scores", () => {
    const alt = JSON.parse(JSON.stringify(ALLOC)); alt.MSCREEN_WEIGHTS = { momentum: 100, tendance: 0, risque: 0, volatilite: 0, diversification: 0 };
    const { CK, MS, T } = setup(alt);
    const R = MS.run({ T, series: universe(CK, MS, IDS), ids: IDS, prefs: null, rf12: 0 });
    for (const r of R.rows) if (r.score != null) assert.equal(r.score, Math.round(r.sub.momentum * 10) / 10);
    assert.equal(MS.global({ momentum: 80, tendance: 40, risque: null, volatilite: null, diversification: null }), 80);
  });
});

describe("étiquettes", () => {
  test("sans règles enregistrées : scores visibles, aucune étiquette", () => {
    const { CK, MS, T } = setup();
    const R = MS.run({ T, series: universe(CK, MS, IDS), ids: IDS, prefs: null, rf12: 0 });
    assert.ok(R.rows.some((r) => r.score != null)); assert.ok(R.rows.every((r) => r.label === null));
  });
  test("une seule étiquette de la liste par ligne ; jamais d'action hors de tes classes", () => {
    const { CK, MS, T } = setup();
    const p = prefsAll(CK, { classes: { actions: true }, vehicles: { etf: true } });
    const R = MS.run({ T, series: universe(CK, MS, IDS), ids: IDS, prefs: p, rf12: 0.02 });
    for (const r of R.rows) {
      assert.ok(["RENFORCER", "CONSERVER", "SURVEILLER", "RÉDUIRE", "BASCULER", "HORS"].includes(r.label), r.id + " " + r.label);
      if (!CK.allow(r.i, p)) assert.equal(r.label, "HORS", r.id);
    }
    assert.equal(R.rows.find((r) => r.id === "isin:IE00B4WXJJ64").label, "HORS", "obligations non cochées");
    assert.equal(R.rows.find((r) => r.id === "isin:FR0010342592").label, "HORS", "levier non autorisé");
  });
  test("table ordonnée : RSI extrême → Surveiller ; seuils de Renforcer / Réduire / Conserver lus dans la configuration", () => {
    const { CK, MS } = setup(); const p = prefsAll(CK), i = CK.ref.get("isin:FR0011871128");
    const row = (o) => Object.assign({ id: i.id, i, score: 60, sub: { tendance: 50 }, m: { years: 5, rsi: 50, mom12_1: 0.05 } }, o, { m: Object.assign({ years: 5, rsi: 50, mom12_1: 0.05 }, o.m || {}) });
    const L = (r) => MS.label(r, [r], { prefs: p, rf12: 0.02 }).label;
    assert.equal(L(row({ m: { rsi: 80 } })), "SURVEILLER");
    assert.equal(L(row({ score: 75, sub: { tendance: 100 } })), "RENFORCER");
    assert.equal(L(row({ score: 75, sub: { tendance: 100 }, m: { mom12_1: 0.01 } })), "CONSERVER", "12 mois sous le taux sans risque");
    assert.equal(L(row({ score: 35, sub: { tendance: 25 } })), "RÉDUIRE");
    assert.equal(L(row({ score: 45, sub: { tendance: 50 } })), "SURVEILLER");
    assert.equal(L(row({ score: null })), "SURVEILLER", "données insuffisantes");
    assert.equal(L(row({ m: { years: 0.5 } })), "SURVEILLER");
  });
  test("fonds monétaire : toujours Conserver (son score sert peu)", () => {
    const { CK, MS } = setup(); const i = CK.ref.get("isin:LU1190417599");
    const r = { id: i.id, i, score: 90, sub: { tendance: 100 }, m: { years: 3, rsi: 95, mom12_1: 0.03 } };
    assert.equal(MS.label(r, [r], { prefs: prefsAll(CK), rf12: 0 }).label, "CONSERVER");
  });
  test("Basculer : même exposition moins chère ; en mode PEA, jamais d'un éligible vers un non éligible ; ligne détenue → seulement si le gain dépasse le coût", () => {
    const { CK, MS } = setup();
    const mk = (id) => { const i = CK.ref.get(id); return { id, i, score: 60, sub: { tendance: 50 }, m: { years: 5, rsi: 50, mom12_1: 0.05 } }; };
    const cw8 = mk("isin:LU1681043599"), wpea = mk("isin:IE0002XZSHO1"), ese = mk("isin:FR0011550185"), sxr8 = mk("isin:IE00B5BMR087");
    const off = prefsAll(CK), on = prefsAll(CK, { pea_mode: "prioritaire" });
    const a = MS.label(cw8, [cw8, wpea], { prefs: off }); assert.equal(a.label, "BASCULER"); assert.match(a.why, /WPEA/);
    assert.notEqual(MS.label(ese, [ese, sxr8], { prefs: on }).label, "BASCULER", "ESE (PEA) ne bascule pas vers SXR8 (hors PEA)");
    assert.equal(MS.label(sxr8, [sxr8, mk("isin:IE000DQLYVB9")], { prefs: on }).label, "BASCULER", "SXR8 → SPEA (éligible PEA)");
    const small = MS.label(cw8, [cw8, wpea], { prefs: off, held: { [cw8.id]: { value: 500, account_type: "CTO", gain_share: 0.3 } } });
    assert.notEqual(small.label, "BASCULER", "500 € : 0,9 €/an de frais en moins ne paie pas la bascule");
  });
});

describe("rendu", () => {
  test("vue : avertissement exact, invitation à définir ses règles, textes échappés", () => {
    const { CK, MS, T } = setup();
    const R = MS.run({ T, series: universe(CK, MS, IDS), ids: IDS, prefs: null, rf12: 0 });
    R.rows[0].explain = '<img src=x onerror=alert(1)>';
    const h = CK.msui._t.viewHTML({ R, prefs: CK.models.normPrefs({}), o: {}, open: { [R.rows[0].id]: true }, monthLabel: "novembre 2026", dataLabel: "données arrêtées au 30/10/2026" });
    assert.ok(h.includes(DISC)); assert.match(h, /data-ms="prefs"/); assert.ok(!/<img/.test(h));
    assert.match(h, /MSCREEN_WEIGHTS/); assert.match(h, /class="ms-det"/);
  });
  test("filtres : « Seulement mes classes » retire les lignes hors classes ; « Éligibles PEA » retire les non éligibles", () => {
    const { CK, MS, T } = setup();
    const R = MS.run({ T, series: universe(CK, MS, IDS), ids: IDS, prefs: prefsAll(CK, { classes: { actions: true }, vehicles: { etf: true } }), rf12: 0 });
    const F = CK.msui._t.filterRows;
    assert.ok(F(R.rows, {}).some((r) => r.label === "HORS")); assert.ok(!F(R.rows, { mine: true }).some((r) => r.label === "HORS"));
    for (const r of F(R.rows, { peaf: "eligibles" })) assert.ok(["eligible", "eligible_regle"].includes(CK.pea.status(r.i).status), r.id);
    const s = F(R.rows, { sort: "score" }).map((r) => r.score).filter((x) => x != null); assert.deepEqual([...s], [...s].sort((a, b) => b - a));
  });
  test("taux sans risque : €STR publié au plus tard à la date de décision", () => {
    const { CK, T } = setup();
    const taux = { estr: { serie: { d: ["2026-10-29", "2026-10-30", "2026-11-03"], v: [2.0, 2.1, 9.9] } } };
    assert.equal(CK.msui._t.rfAt(taux, T), 0.021); assert.equal(CK.msui._t.rfAt(null, T), 0);
  });
});
