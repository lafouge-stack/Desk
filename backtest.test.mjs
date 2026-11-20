// Backtest (phase 7) : backtest.js + btui.js chargés avec les vrais modules, et rfMonthly du robot (histo.mjs).
// Vérifie : taux sans risque (EONIA − 8,5 pb puis €STR), métriques sur des séries de valeur connue, exécution le jour ouvré
// suivant la décision, coûts (minimum par ordre), fiscalité (compte-titres : impôt annuel et moins-values reportées ; PEA :
// rien en route, impôt à la sortie), aucun regard vers l'avenir, classes ajoutées à leur date de disponibilité, rendu.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeContext } from "./vmkit.mjs";
import { rfMonthly } from "./histo.mjs";

const rd = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const REF = JSON.parse(rd("./referentiel.json")), ALLOC = JSON.parse(rd("./allocation.json")), FISCAL = JSON.parse(rd("./fiscal.json"));
const DISC = "Les informations affichées ne constituent pas un conseil en investissement personnalisé. Les performances passées ne préjugent pas des performances futures.";
const NOW = Date.parse("2026-11-20T10:00:00Z"), DAY = 864e5;

function setup() {
  const { CK, load } = makeContext();
  for (const f of ["models.js", "datakit.js", "fx.js", "calendars.js", "pea.js", "providers.js", "indicators.js", "screener.js", "pfcore.js", "selection.js", "allocation.js", "prefs.js", "mscreen.js", "backtest.js", "btui.js"]) load(f);
  CK.models.setData("referentiel", REF); CK.models.setData("allocation", ALLOC); CK.models.setData("fiscal", FISCAL);
  CK.dk.env = Object.assign({}, CK.dk.env, { now: () => NOW, fetch: () => Promise.reject(new Error("réseau coupé")), indexedDB: null });
  return { CK, BT: CK.bt };
}
function walk(seed, drift, vol, from = "2015-01-05", py = 252) {
  let s = seed >>> 0; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const t = [], c = []; let p = 100;
  for (let ts = Date.parse(from + "T16:30:00Z"); ts < NOW - DAY; ts += DAY) { const d = new Date(ts).getUTCDay(); if (py === 252 && (d === 0 || d === 6)) continue;
    const z = (r() + r() + r() + r() - 2) * 1.732; p *= Math.exp(drift / py + vol / Math.sqrt(py) * z); t.push(ts); c.push(p); }
  return { t, c };
}
function market() {
  const eq = walk(1, 0.08, 0.16);
  return { series: { actions: eq, obligations: walk(2, 0.02, 0.05), or: walk(3, 0.05, 0.14, "2018-01-02") }, ref: eq, vix: { t: eq.t, c: eq.c.map(() => 18) },
    rf: { d: ["2015-01", "2020-01", "2024-01"], v: [0.5, -0.5, 3.5] } };
}
const prefs = (CK, extra = {}) => CK.models.normPrefs(Object.assign({ saved: true, risk_profile: "modere",
  classes: { actions: true, obligations: true, oblig_etat: true, matieres_premieres: true, or: true, liquidites: true }, vehicles: { etf: true, etc_etn: true, cash: true } }, extra));

describe("taux sans risque", () => {
  test("robot : EONIA − 8,5 pb avant octobre 2019, puis moyenne mensuelle de l'€STR ; mois en cours exclu", () => {
    const rf = rfMonthly([["2019-08", -0.36], ["2019-09", -0.40], ["2019-10", -0.46]], [["2019-10-01", -0.549], ["2019-10-02", -0.551], ["2026-11-02", 2.0]], Date.parse("2026-11-20T00:00:00Z"));
    assert.deepEqual(rf.d, ["2019-08", "2019-09", "2019-10"]);
    assert.deepEqual(rf.v, [-0.445, -0.485, -0.55]);
  });
  test("navigateur : taux du mois, sinon le dernier connu (jamais un taux futur)", () => {
    const { BT } = setup(); const f = BT.rfFn({ d: ["2020-01", "2020-03"], v: [1, 2] });
    assert.equal(f(Date.parse("2020-01-15")), 0.01); assert.equal(f(Date.parse("2020-02-15")), 0.01); assert.equal(f(Date.parse("2020-05-15")), 0.02);
    assert.equal(BT.rfFn(null)(Date.now()), 0);
  });
});

describe("mesures", () => {
  test("croissance régulière de 10 % par an : rendement annualisé 10 %, volatilité nulle, aucune perte", () => {
    const { BT } = setup(); const t0 = Date.parse("2020-01-01"), curve = [];
    for (let k = 0; k <= 3 * 365; k++) curve.push([t0 + k * DAY, 100 * Math.pow(1.1, k / 365.25)]);
    const m = BT.metrics(curve, () => 0);
    assert.ok(Math.abs(m.cagr - 0.1) < 1e-6); assert.ok(m.vol < 1e-9); assert.equal(m.mdd, 0); assert.equal(m.win, 1);
  });
  test("aller-retour : perte maximale −50 %, dates du sommet et du creux, Calmar", () => {
    const { BT } = setup(); const t0 = Date.parse("2020-01-01"), v = [100, 120, 60, 90, 130], curve = v.map((x, i) => [t0 + i * 30 * DAY, x]);
    const m = BT.metrics(curve, () => 0);
    assert.equal(m.mdd, -0.5); assert.equal(m.mddFrom, "2020-01-31"); assert.equal(m.mddTo, "2020-03-01"); assert.ok(m.calmar > 0);
  });
});

describe("mécanique", () => {
  test("dates de décision : une par mois (dernière séance Euronext), une par trimestre", () => {
    const { BT } = setup(); const a = Date.parse("2024-01-01"), b = Date.parse("2024-12-31T23:00:00Z");
    const m = BT.decisions(a, b, 1), q = BT.decisions(a, b, 3);
    assert.equal(m.length, 12); assert.equal(q.length, 4); assert.equal(new Date(m[2]).toISOString().slice(0, 10), "2024-03-28", "29/03/2024 : Vendredi saint, Euronext fermé");
  });
  test("coût d'un ordre de 50 € = minimum par ordre ; gains réalisés au prix de revient moyen", () => {
    const { BT, CK } = setup(); const b = BT.book("x"); b.val.liquidites = 1000; b.basis.liquidites = 1000;
    const ctx = { costs: true, env: "CTO", tax: "CTO", instr: (p) => CK.ref.get(ALLOC.proxies[p].id) };
    const x = BT.rebalance(b, { actions: 0.05, liquidites: 0.95 }, ctx);
    assert.ok(Math.abs(x.cost - CK.sel.orderCost(50, "CTO", CK.ref.get("isin:LU1681043599"))) < 1e-9);
    b.val.actions *= 2; BT.rebalance(b, { liquidites: 1 }, Object.assign({}, ctx, { costs: false }));
    assert.ok(Math.abs(b.yearReal - b.real) < 1e-9 && b.real > 40, "plus-value réalisée sur la vente");
  });
  test("compte-titres : impôt sur le gain net de l'année ; une moins-value est reportée puis imputée", () => {
    const { BT } = setup(); const b = BT.book("x"); b.val.liquidites = 1000;
    b.yearReal = -100; assert.equal(BT.yearEnd(b, 2020, 0.3, 10), 0); assert.equal(b.losses[0].v, 100);
    b.yearReal = 150; const tax = BT.yearEnd(b, 2021, 0.3, 10); assert.ok(Math.abs(tax - 15) < 1e-9, "(150 − 100) × 30 %");
    b.yearReal = -50; BT.yearEnd(b, 2022, 0.3, 10); b.yearReal = 60; assert.ok(Math.abs(BT.yearEnd(b, 2033, 0.3, 10) - 18) < 1e-9, "moins-value de plus de 10 ans perdue");
  });
});

describe("backtest complet", () => {
  test("exécution au jour ouvré suivant la décision ; trois portefeuilles ; métriques complètes", () => {
    const { BT, CK } = setup(); const m = market();
    const R = BT.run(Object.assign({ prefs: prefs(CK), capital: 10000, now: NOW }, m));
    assert.equal(R.ok, true); assert.deepEqual(Object.keys(R.books).sort(), ["achat", "fixe", "strategie"]);
    for (const j of R.journal.slice(0, 20)) assert.ok(j.exec > j.date, j.date + " → " + j.exec);
    const s = R.books.strategie;
    for (const k of ["cagr", "vol", "sharpe", "sortino", "mdd", "calmar", "win", "sharpeLo", "sharpeHi"]) assert.ok(Number.isFinite(s.metrics[k]), k);
    assert.ok(s.costs > 0 && R.books.achat.costs < s.costs, "l'achat-conservation ne paie que l'achat initial");
    const w = R.journal.at(-1).w; assert.ok(Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 0.01);
  });
  test("aucun regard vers l'avenir : changer les cours après une date ne change aucune décision jusqu'à cette date", () => {
    const { BT, CK } = setup(); const m = market(), cut = Date.parse("2021-06-15T00:00:00Z");
    const bump = (S) => ({ t: S.t, c: S.c.map((v, i) => (S.t[i] > cut ? v * (i % 2 ? 2.5 : 0.3) : v)) });
    const m2 = Object.assign({}, m, { series: Object.fromEntries(Object.entries(m.series).map(([k, v]) => [k, bump(v)])) }); m2.ref = m2.series.actions;   // comme dans m : la référence EST la série actions
    const a = BT.run(Object.assign({ prefs: prefs(CK), now: NOW }, m)), b = BT.run(Object.assign({ prefs: prefs(CK), now: NOW }, m2));
    const before = (R) => R.journal.filter((j) => Date.parse(j.date) < cut).map((j) => [j.date, j.w, j.regime]);
    assert.ok(before(a).length > 50); assert.deepEqual(JSON.parse(JSON.stringify(before(a))), JSON.parse(JSON.stringify(before(b))));
  });
  test("une classe n'entre qu'après 13 mois d'historique (l'or, coté depuis 2018, arrive en 2019)", () => {
    const { BT, CK } = setup(); const R = BT.run(Object.assign({ prefs: prefs(CK), now: NOW }, market()));
    const firstOr = R.journal.find((j) => j.universe.includes("or"));
    assert.ok(firstOr.date >= "2019-01-31" && firstOr.date < "2019-04-01", firstOr.date);
    assert.ok(!R.journal[0].universe.includes("or"));
  });
  test("fiscalité : rien payé en route dans un PEA (impôt à la sortie), impôt annuel au compte-titres ; le PEA écarte l'or et les obligations", () => {
    const { BT, CK } = setup(); const m = market();
    const pea = BT.run(Object.assign({ prefs: prefs(CK), tax: "PEA", now: NOW }, m)), cto = BT.run(Object.assign({ prefs: prefs(CK), tax: "CTO", now: NOW }, m));
    assert.equal(pea.books.strategie.taxes, 0); assert.ok(pea.books.strategie.exitTax > 0);
    assert.ok(pea.flags.some((f) => /PEA ne peut détenir/.test(f.msg))); assert.ok(pea.journal.every((j) => !j.universe.includes("or") && !j.universe.includes("obligations")));
    assert.ok(cto.books.strategie.taxes > 0); assert.ok(cto.books.strategie.net < cto.books.strategie.value);
  });
  test("grille de sensibilité : 9 réglages (inclinaison × bande), même période", () => {
    const { BT, CK } = setup(); const g = BT.grid(Object.assign({ prefs: prefs(CK), now: NOW, freq: 3 }, market()));
    assert.equal(g.length, 9); assert.deepEqual([...new Set(g.map((x) => x.band))], [1, 2, 4]);
    const cells = g.slice(0, 3).map((x) => ({ m: BT.run(x.o).books.strategie.metrics })); assert.ok(BT.summarize(cells).cagr.min <= BT.summarize(cells).cagr.max);
  });
  test("règles non enregistrées ou aucune classe mesurable : refus clair", () => {
    const { BT, CK } = setup();
    assert.equal(BT.run(Object.assign({ prefs: prefs(CK, { classes: { crypto: true }, vehicles: { spot_crypto: true } }), now: NOW }, market())).ok, false);
  });
});

describe("rendu", () => {
  test("vue : avertissement exact, biais du survivant, trois courbes, montants masqués", () => {
    const { BT, CK } = setup(); const R = BT.run(Object.assign({ prefs: prefs(CK), now: NOW, freq: 3 }, market()));
    const h = CK.btui._t.viewHTML({ prefs: prefs(CK), f: { capital: 10000 }, R, hide: true });
    assert.ok(h.includes(DISC)); assert.match(h, /Biais du survivant/); assert.equal((h.match(/class="bt-line"/g) || []).length, 3);
    assert.ok(!/\d[\d  ]*\d €/.test(h.replace(/•••/g, "").replace(/\d+ jours/g, "")), "aucun montant en euros visible");
    assert.match(CK.btui._t.viewHTML({ prefs: CK.models.normPrefs({}), f: {} }), /Définir mes règles/);
  });
  test("journal : textes échappés", () => {
    const { BT, CK } = setup(); const R = BT.run(Object.assign({ prefs: prefs(CK), now: NOW, freq: 3 }, market()));
    R.journal[R.journal.length - 1].regime = "<img src=x onerror=alert(1)>";
    assert.ok(!/<img/.test(CK.btui._t.journalHTML(R, true)));
  });
});
