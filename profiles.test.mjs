// Phase 9 : allocation choisie par algorithme pour 4 profils, contrôles automatiques, poche Actions = ETF + actions françaises (CAC 40).
// Vérifie : l'optimiseur (bornes, somme 100 %, cible de volatilité, déterminisme), les 4 profils rangés du moins au plus risqué,
// l'horizon, les poids personnalisés et le repli, les actions en direct (CAC 40 seulement, choisies par score, lignes détenues gardées),
// le partage ETF / titres dans les comptes, les contrôles (risque, perte, crises, Sharpe, rangement) et le tableau des 4 profils.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeContext } from "./vmkit.mjs";

const rd = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const REF = JSON.parse(rd("./referentiel.json")), ALLOC = JSON.parse(rd("./allocation.json")), FISCAL = JSON.parse(rd("./fiscal.json"));
const NOW = Date.parse("2026-11-20T10:00:00Z"), DAY = 864e5, ORDER = ["prudent", "modere", "dynamique", "agressif"];
const CAC = ALLOC.selection.univers_actions_directes;

function setup() {
  const { CK, load } = makeContext();
  for (const f of ["models.js", "datakit.js", "fx.js", "calendars.js", "pea.js", "providers.js", "indicators.js", "screener.js", "pfcore.js", "selection.js", "optimizer.js", "allocation.js", "prefs.js", "mscreen.js", "backtest.js", "allocui.js"]) load(f);
  CK.models.setData("referentiel", REF); CK.models.setData("allocation", ALLOC); CK.models.setData("fiscal", FISCAL);
  CK.dk.env = Object.assign({}, CK.dk.env, { now: () => NOW, fetch: () => Promise.reject(new Error("réseau coupé")), indexedDB: null });
  CK.fx.setDaily("USD", [["2010-01-01", 0.9]]);
  return { CK, O: CK.opt, A: CK.alloc, S: CK.sel, M: CK.models };
}
function walk(seed, drift, vol, from = "2014-01-06") {
  let s = seed >>> 0; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const t = [], c = []; let p = 100;
  for (let ts = Date.parse(from + "T16:30:00Z"); ts < NOW - DAY; ts += DAY) { const d = new Date(ts).getUTCDay(); if (d === 0 || d === 6) continue;
    p *= Math.exp(drift / 252 + vol / Math.sqrt(252) * (r() + r() + r() + r() - 2) * 1.732); t.push(ts); c.push(p); }
  return { t, c };
}
const market = () => { const eq = walk(1, 0.08, 0.16); return { series: { actions: eq, obligations: walk(2, 0.02, 0.05), or: walk(3, 0.05, 0.14), matieres_premieres: walk(4, 0.02, 0.15) }, ref: eq, vix: { t: eq.t, c: eq.c.map(() => 18) } }; };
const prefs = (M, extra = {}) => M.normPrefs(Object.assign({ saved: true, risk_profile: "modere", horizon: "long",
  classes: { actions: true, obligations: true, oblig_etat: true, matieres_premieres: true, or: true, liquidites: true }, vehicles: { etf: true, etc_etn: true, titre: true, cash: true } }, extra));

describe("optimiseur", () => {
  const cov = { ids: ["a", "b"], S: [[0.04, 0.006], [0.006, 0.0025]] };   // σ 20 % et 5 %, corrélation 0,6
  test("bornes et somme 100 % respectées ; cible de volatilité atteinte sans la dépasser", () => {
    const { O } = setup();
    const r = O.solve(["a", "b", "liquidites"], { a: 0.08, b: 0.035, liquidites: 0.02 }, cov, { a: 0, b: 0.1, liquidites: 0.05 }, { a: 0.6, b: 0.7, liquidites: 1 }, 0.08);
    const w = r.w, sum = w.a + w.b + w.liquidites;
    assert.ok(Math.abs(sum - 1) < 1e-6); assert.ok(w.a <= 0.6 + 1e-6 && w.b >= 0.1 - 1e-6 && w.liquidites >= 0.05 - 1e-6);
    assert.ok(r.reached); assert.ok(r.sigma <= 0.08 + 1e-4 && r.sigma > 0.075, "σ = " + r.sigma);
  });
  test("cible inatteignable dans les bornes : allocation la moins volatile, signalée", () => {
    const { O } = setup(); const r = O.solve(["a", "b"], { a: 0.08, b: 0.03 }, cov, { a: 0.5, b: 0 }, { a: 1, b: 1 }, 0.02);
    assert.equal(r.reached, false); assert.ok(r.w.a >= 0.5 - 1e-6);
  });
  test("déterministe : mêmes données, même allocation", () => {
    const { O } = setup(); const f = () => JSON.stringify(O.solve(["a", "b", "liquidites"], { a: 0.08, b: 0.035, liquidites: 0.02 }, cov, {}, {}, 0.1).w);
    assert.equal(f(), f());
  });
});

describe("les 4 profils", () => {
  test("allocation dans les bornes de chaque profil ; volatilité visée respectée ; profils rangés du moins au plus risqué", () => {
    const { A, M } = setup(); const m = market(), memo = {}, out = {};
    for (const p of ORDER) {
      const R = A.run(Object.assign({ prefs: prefs(M, { risk_profile: p }), now: NOW, current: {}, lite: true, memo, rf: 0.02 }, m));
      assert.equal(R.ok, true); assert.equal(R.algo, true);
      const w = R.steps.strategic, b = ALLOC.profils[p].bornes;
      for (const k of Object.keys(w)) { assert.ok(w[k] >= b[k][0] / 100 - 1e-4 && w[k] <= b[k][1] / 100 + 1e-4, p + " " + k + " = " + w[k]); }
      assert.ok(Math.abs(Object.values(w).reduce((a, x) => a + x, 0) - 1) < 1e-6);
      out[p] = { s: A.sigma(w, A.covariance(m.series, R.universe.filter((x) => x !== "liquidites"), R.T)), act: w.actions, tgt: R.target };
      assert.ok(out[p].s <= out[p].tgt + 1e-3, p + " σ " + out[p].s + " > " + out[p].tgt);
    }
    for (let i = 1; i < ORDER.length; i++) { const a = out[ORDER[i - 1]], b = out[ORDER[i]];
      assert.ok(b.s >= a.s - 1e-6, ORDER[i] + " plus volatil que " + ORDER[i - 1]); assert.ok(b.act >= a.act - 1e-6, ORDER[i] + " au moins autant d'actions"); }
  });
  test("horizon court : volatilité visée réduite (facteur de l'horizon)", () => {
    const { A, M } = setup(); const m = market();
    const L = A.run(Object.assign({ prefs: prefs(M, { horizon: "long" }), now: NOW, current: {}, lite: true }, m)), C = A.run(Object.assign({ prefs: prefs(M, { horizon: "court" }), now: NOW, current: {}, lite: true }, m));
    assert.ok(Math.abs(C.target - L.target * ALLOC.horizons.court.facteur_risque) < 1e-9); assert.ok(C.steps.strategic.actions < L.steps.strategic.actions);
  });
  test("poids personnalisés : l'algorithme n'est pas utilisé ; repli après un échec des contrôles : modèle de référence, signalé", () => {
    const { A, M } = setup(); const m = market();
    const P = A.run(Object.assign({ prefs: prefs(M, { poids_perso: { actions: 50, obligations: 50 } }), now: NOW, current: {}, lite: true }, m));
    assert.equal(P.algo, false); assert.ok(Math.abs(P.steps.strategic.actions - 0.5) < 1e-9);
    const F = A.run(Object.assign({ prefs: prefs(M), now: NOW, current: {}, fallback: "perte maximale" }, m));
    assert.equal(F.profile.algo, false); assert.ok(F.flags.some((f) => f.code === "fallback" && /refusée par les contrôles/.test(f.msg)));
    assert.deepEqual(JSON.parse(JSON.stringify(F.steps.strategic)), JSON.parse(JSON.stringify(F.steps.reference)));
  });
});

describe("actions françaises en direct (poche Actions)", () => {
  const ctx = (CK, p, extra = {}) => Object.assign({ prefs: p, T: CK.alloc.decision(NOW).T, resume: null, held: {}, accounts: [], pocheOf: CK.alloc.pocheOf, pea_mode: p.pea_mode, vols: {} }, extra);
  test("seulement des valeurs du CAC 40 : une action étrangère ou hors CAC 40 n'est jamais candidate", () => {
    const { CK, S, M } = setup(); const p = prefs(M);
    const c = S.candidates("actions_titres", ctx(CK, p, { held: { "isin:US0378331005": 3000 } }));
    assert.equal(CAC.length, 39);
    for (const x of c) if (x.ok) assert.ok(CAC.includes(x.id), x.id);
    assert.match(c.find((x) => x.id === "isin:US0378331005").why, /CAC 40/);
    assert.match(c.find((x) => x.id === "isin:DE0007164600").why, /CAC 40/, "SAP (allemande) écartée");
    assert.ok(c.some((x) => x.id === "isin:FR0000131906" && x.ok), "Renault (CAC 40) candidate");
  });
  test("choix par score : au plus « nombre » titres du profil, part = part_max × retenus / nombre, une ligne détenue reste plus longtemps", () => {
    const { CK, S, M } = setup(); const p = prefs(M), prof = ALLOC.profils.modere;
    const scores = {}; CAC.forEach((id, k) => { scores[id] = { score: 40 + k, trend: 75, label: "CONSERVER" }; });
    scores["isin:US0378331005"] = { score: 99, trend: 100, label: "RENFORCER" };   // Apple : jamais
    scores[CAC[0]] = { score: 50, trend: 75, label: "CONSERVER" };                // détenue, sous le seuil d'entrée mais au-dessus du seuil de maintien
    scores[CAC[38]].label = "RÉDUIRE";
    const c = S.candidates("actions_titres", ctx(CK, p, { held: { [CAC[0]]: 2000 } }));
    const plan = S.stocksPlan(c, ctx(CK, p, { stocks: scores }), prof);
    assert.equal(plan.ids.length, prof.titres_vifs.nombre); assert.ok(plan.ids.includes(CAC[0]), "ligne détenue gardée");
    assert.ok(!plan.ids.includes("isin:US0378331005")); assert.ok(!plan.ids.includes(CAC[38]), "étiquette Réduire exclue");
    assert.ok(Math.abs(plan.share - prof.titres_vifs.part_max / 100) < 1e-9);
    const few = {}; few[CAC[1]] = { score: 80, trend: 80, label: "RENFORCER" };
    const p2 = S.stocksPlan(S.candidates("actions_titres", ctx(CK, p)), ctx(CK, p, { stocks: few }), prof);
    assert.ok(Math.abs(p2.share - prof.titres_vifs.part_max / 100 / prof.titres_vifs.nombre) < 1e-9);
  });
  test("dans un compte : la poche Actions se partage entre ETF et titres retenus, achats de titres seulement dans le CAC 40", () => {
    const { CK, A, M } = setup(); const m = market(), F = CK.pfc, P = F.empty();
    P.accounts.push(F.normAcc({ id: "pea", name: "PEA", account_type: "PEA", cash_balance: 50000, deposits_total: 50000 }));
    const V = F.value(P, () => null);
    const scores = {}; CAC.forEach((id, k) => { scores[id] = { score: k < 10 ? 90 - k : 30, trend: 80, label: "RENFORCER" }; });
    const R = A.run(Object.assign({ prefs: prefs(M, { risk_profile: "dynamique", limits: { max_par_instrument: 100 } }), now: NOW, current: A.current(P, V, 0), stocks: scores }, m));
    const buys = R.orders.filter((o) => !o.skipped && o.side === "achat"), titres = buys.filter((o) => o.i.vehicle === "titre");
    assert.equal(titres.length, ALLOC.profils.dynamique.titres_vifs.nombre);
    for (const o of titres) assert.ok(CAC.includes(o.instrument_id), o.instrument_id);
    const act = buys.filter((o) => CK.alloc.pocheOf(o.i) === "actions").reduce((s, o) => s + o.amount, 0), ti = titres.reduce((s, o) => s + o.amount, 0);
    assert.ok(Math.abs(ti / act - ALLOC.profils.dynamique.titres_vifs.part_max / 100) < 0.02, "part des titres " + ti / act);
    const amounts = titres.map((o) => o.amount); assert.ok(Math.max(...amounts) - Math.min(...amounts) < 1, "poids égaux");
  });
});

describe("contrôles automatiques", () => {
  const fake = (vol, mdd, sharpe, refSharpe, crash = mdd, ws = { actions: 0.3, obligations: 0.3, liquidites: 0.4 }) => {   // dans les bornes de Prudent et Modéré
    const t0 = Date.parse("2019-01-02"), curve = [];
    for (let k = 0; k < 1400; k++) { const t = t0 + k * DAY, d = new Date(t).toISOString().slice(0, 10); curve.push([t, d >= "2020-02-20" && d <= "2020-04-30" ? 100 * (1 + crash) : 100]); }
    return { ok: true, journal: [{ algo: true, ws, universe: ["actions", "liquidites", "obligations"], target: 0.08 }],
      books: { strategie: { metrics: { vol, mdd, sharpe }, curve, value: 1 }, fixe: { metrics: { sharpe: refSharpe } } } };
  };
  test("un profil qui dépasse sa perte maximale ou sa volatilité est refusé, avec le motif ; un profil sain est validé", () => {
    const { CK } = setup();
    const V = CK.bt.checks({ prudent: fake(0.05, -0.10, 0.8, 0.8), modere: fake(0.08, -0.30, 0.9, 0.9), dynamique: fake(0.20, -0.30, 1, 1), agressif: fake(0.21, -0.32, 1, 1) });
    assert.equal(V.prudent.ok, true);
    assert.equal(V.modere.ok, false); assert.ok(V.modere.checks.some((c) => c.label === "Perte maximale" && !c.ok));
    assert.equal(V.dynamique.ok, false); assert.ok(V.dynamique.checks.some((c) => c.label === "Risque tenu" && !c.ok));
  });
  test("crise : baisse mesurée dans la fenêtre ; Sharpe trop loin de la référence refusé ; rangement des profils vérifié", () => {
    const { CK } = setup();
    const V = CK.bt.checks({ prudent: fake(0.05, -0.10, 0.8, 0.8, -0.20), modere: fake(0.04, -0.12, 0.5, 1.0), dynamique: fake(0.10, -0.2, 1, 1), agressif: fake(0.15, -0.3, 1, 1) });
    assert.ok(V.prudent.checks.some((c) => /Covid/.test(c.label) && !c.ok), "baisse de 20 % pendant le krach, limite 15 %");
    assert.ok(V.modere.checks.some((c) => /référence/.test(c.label) && !c.ok));
    assert.ok(V.modere.checks.some((c) => /Plus risqué que Prudent/.test(c.label) && !c.ok), "Modéré moins volatil que Prudent");
    assert.equal(CK.bt.windowLoss([[Date.parse("2021-01-01"), 1]], "2020-02-19", "2020-04-30"), null, "période non couverte");
  });
  test("bornes : une décision hors des bornes du profil est refusée", () => {
    const { CK } = setup(); const ok = fake(0.05, -0.1, 0.8, 0.8);
    const V = CK.bt.checks({ prudent: fake(0.05, -0.1, 0.8, 0.8, -0.1, { actions: 0.6, liquidites: 0.4 }), modere: ok, dynamique: ok, agressif: ok });
    assert.ok(V.prudent.checks.some((c) => c.label === "Bornes du profil" && !c.ok));
  });
});

describe("tableau des 4 profils", () => {
  test("4 colonnes du moins au plus risqué, ton profil marqué, bouton Choisir, refus visible et textes échappés", () => {
    const { CK, M } = setup();
    const P = {}; ORDER.forEach((p, k) => { P[p] = { ok: true, w: { actions: 0.2 + k * 0.2, liquidites: 0.8 - k * 0.2 }, target: 0.05 + k * 0.03, direct: 0.02 * k, label: ALLOC.profils[p].label }; });
    const valid = { prudent: { ok: true, checks: [], m: { cagr: 0.03, vol: 0.04, mdd: -0.1, from: "2013-01" } }, modere: { ok: false, checks: [{ label: "Perte maximale", ok: false, txt: "<img src=x onerror=1>" }], m: { cagr: 0.05, vol: 0.07, mdd: -0.3 } } };
    const h = CK.alui._t.profilesHTML({ prefs: prefs(M, { risk_profile: "dynamique" }), profiles: P, valid });
    const heads = [...h.matchAll(/<th class="r[^"]*">([^<]*)/g)].map((x) => x[1].trim());
    assert.deepEqual(heads, ["Prudent", "Modéré", "Dynamique", "Agressif"]);
    assert.equal((h.match(/data-pf="al-profil"/g) || []).length, 3); assert.match(h, /Ton profil/);
    assert.match(h, /✗ refusé · modèle de référence/); assert.match(h, /dont actions françaises en direct/);
    assert.ok(!/<img/.test(h));
  });
});
