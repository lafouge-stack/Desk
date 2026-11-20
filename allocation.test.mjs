// Moteur d'allocation mensuelle (phase 5) : allocation.js + selection.js chargés avec les VRAIS models, pea, fx, calendars, indicators, pfcore.
// Vérifie les garde-fous (classe ou type non coché = 0, somme 100 %, plafonds, plancher), la bande d'inaction, la rotation maximale,
// la cible de volatilité, le point-in-time (rien après la date de décision), le placement par enveloppe sans transfert,
// le plafond PEA, la sélection (profil prudent → jamais de levier, titres détenus seulement) et le vocabulaire.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeContext } from "./vmkit.mjs";

const rd = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const REF = JSON.parse(rd("./referentiel.json")), ALLOC = JSON.parse(rd("./allocation.json")), FISCAL = JSON.parse(rd("./fiscal.json"));
const NOW = Date.parse("2026-11-17T10:00:00Z");
const DAY = 864e5;

function setup() {
  const { CK, load } = makeContext();
  for (const f of ["models.js", "datakit.js", "fx.js", "calendars.js", "pea.js", "providers.js", "indicators.js", "pfcore.js", "selection.js", "allocation.js"]) load(f);
  CK.models.setData("referentiel", REF); CK.models.setData("allocation", ALLOC); CK.models.setData("fiscal", FISCAL);
  CK.dk.env = Object.assign({}, CK.dk.env, { now: () => NOW, fetch: () => Promise.reject(new Error("réseau coupé")), indexedDB: null });
  CK.fx.setDaily("USD", [["2020-01-01", 0.9]]);
  return { CK, A: CK.alloc, S: CK.sel, M: CK.models };
}
/** Marche aléatoire déterministe (jours ouvrés, ou 7 j / 7). */
function walk(seed, drift, vol, py = 252, from = "2015-01-05") {
  let s = seed >>> 0; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const t = [], c = []; let p = 100; const T0 = Date.parse(from + "T16:30:00Z");
  for (let ts = T0; ts <= NOW - DAY; ts += DAY) { const d = new Date(ts).getUTCDay(); if (py === 252 && (d === 0 || d === 6)) continue;
    const z = (r() + r() + r() + r() - 2) * 1.732; p *= Math.exp(drift / py + vol / Math.sqrt(py) * z); t.push(ts); c.push(p); }
  return { t, c };
}
function market(seed = 1) {
  const eq = walk(seed, 0.08, 0.16);
  return { series: { actions: eq, obligations: walk(seed + 1, 0.02, 0.05), or: walk(seed + 2, 0.05, 0.14), petrole: walk(seed + 3, 0, 0.3),
      matieres_premieres: walk(seed + 4, 0.02, 0.15), agricole: walk(seed + 5, 0, 0.18), crypto: walk(seed + 6, 0.3, 0.7, 365) },
    ref: eq, vix: { t: eq.t, c: eq.c.map(() => 18) } };
}
const ALL_CLASSES = ["actions", "obligations", "oblig_etat", "oblig_entreprise", "matieres_premieres", "or", "argent", "energie", "petrole", "gaz", "agricole", "immobilier_cote", "crypto", "liquidites"];
const ALL_VEH = ["titre", "etf", "etc_etn", "fonds", "spot_crypto", "cash"];
function prefs(M, o = {}) {
  const classes = {}, vehicles = {};
  (o.classes || ALL_CLASSES).forEach((k) => { classes[k] = true; }); (o.vehicles || ALL_VEH).forEach((k) => { vehicles[k] = true; });
  return M.normPrefs(Object.assign({ saved: true, classes, vehicles, risk_profile: "modere", horizon: "long", pea_mode: "off" }, o.extra || {}));
}
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
/** Portefeuille simple (sans réseau) : comptes et lignes en €. */
function pf(CK, spec) {
  const F = CK.pfc, P = F.empty();
  for (const a of spec.accounts) P.accounts.push(F.normAcc(a));
  for (const h of spec.holdings || []) P.holdings.push(F.normHold(Object.assign({ average_purchase_price: 80 }, h)));
  const V = F.value(P, (id) => ({ last: 100, currency: F.instr(P, id)?.currency || "EUR", ts: NOW, source: "test" }));
  return { P, V };
}

describe("date de décision", () => {
  test("dernière séance Euronext du mois, 22 h 30 à Paris ; proposition du mois suivant", () => {
    const { A } = setup();
    const d = A.decision(NOW);
    assert.equal(d.date, "2026-10-30"); assert.equal(d.month, "2026-11"); assert.equal(d.monthLabel, "novembre 2026");
    assert.equal(new Date(d.T).toISOString(), "2026-10-30T21:30:00.000Z");
    // le 31 décembre 2026 est un jeudi ouvré, le 24 décembre une demi-séance : la décision de décembre est le 31
    assert.equal(A.decision(Date.parse("2027-01-04T10:00:00Z")).date, "2026-12-31");
    // avant 22 h 30 le dernier jour, c'est encore le mois précédent qui compte
    assert.equal(A.decision(Date.parse("2026-11-30T20:00:00Z")).date, "2026-10-30");
  });
});

describe("garde-fous du moteur", () => {
  test("rien n'est calculé tant que les règles ne sont pas enregistrées", () => {
    const { A, M } = setup(); const m = market();
    const R = A.run(Object.assign({ prefs: M.normPrefs({ classes: { actions: true }, vehicles: { etf: true } }), now: NOW, current: {} }, m));
    assert.equal(R.ok, false); assert.match(R.why, /Enregistre d'abord tes règles/);
  });
  test("propriété (500 combinaisons de cases, graine fixe) : classe ou type non coché = 0, somme 100 %, poids ≥ 0, plafonds respectés", () => {
    const { A, M, CK } = setup(); const m = market(3); const memo = {};
    let s = 12345; const r = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    let checked = 0;
    for (let n = 0; n < 500; n++) {
      const cls = ALL_CLASSES.filter(() => r() < 0.5), veh = ALL_VEH.filter(() => r() < 0.6);
      const crypto = Math.round(r() * 20), cap = r() < 0.5 ? Math.round(20 + r() * 60) : null;
      const p = prefs(M, { classes: cls, vehicles: veh, extra: { risk_profile: ["prudent", "modere", "dynamique", "agressif"][n % 4], horizon: ["court", "moyen", "long"][n % 3],
        limits: { max_crypto: crypto, max_par_classe: cap ? { actions: cap } : {} } } });
      const R = A.run(Object.assign({ prefs: p, now: NOW, current: {}, memo }, m));
      if (!R.ok) { assert.match(R.why, /Aucune classe proposable/); continue; }
      checked++;
      const w = R.steps.final;
      assert.ok(Math.abs(sum(w) - 1) < 1e-9, "somme = 1 (" + sum(w) + ")");
      for (const [k, v] of Object.entries(w)) {
        assert.ok(v >= -1e-12, k + " ≥ 0");
        const pc = A.poche(k);
        if (!M.isClassAllowed(pc.classe, p.classes) && v > 1e-9) assert.fail("classe non cochée " + k + " = " + v);
        if (k !== "liquidites" && v > 1e-9 && !pc.vehicules.some((x) => p.vehicles[x])) assert.fail("type non coché " + k);
      }
      // aucun instrument proposé hors de tes cases (garde-fou unique CK.allow)
      for (const d of R.decisions) for (const l of d.instruments_proposes) assert.ok(CK.allow(CK.ref.get(l.id), Object.assign({}, p, { limits: Object.assign({}, p.limits, { risque_max_sri: null }) })), l.id);
      const crW = w.crypto || 0; if (R.universe.length > 1 && !R.flags.some((f) => f.code === "caps")) assert.ok(crW <= crypto / 100 + 1e-9, "crypto ≤ plafond");
      if (cap && !R.flags.some((f) => f.code === "caps")) assert.ok((w.actions_etf || 0) + (w.actions_titres || 0) <= cap / 100 + 1e-9, "actions ≤ plafond");
    }
    assert.ok(checked > 200, "assez de cas calculés (" + checked + ")");
  });
  test("« Actions + ETF + Crypto » seulement : tout le poids est réparti entre la poche Actions et la crypto", () => {
    const { A, M } = setup(); const m = market();
    const R = A.run(Object.assign({ prefs: prefs(M, { classes: ["actions", "crypto"], vehicles: ["etf", "spot_crypto"], extra: { limits: { max_crypto: 15 } } }), now: NOW, current: {} }, m));
    assert.equal(R.ok, true);
    assert.deepEqual([...R.universe].sort(), ["actions", "crypto"]);
    assert.ok(Math.abs(R.steps.final.actions + R.steps.final.crypto - 1) < 1e-9);
    assert.ok(R.steps.final.crypto <= 0.15 + 1e-9);
    assert.ok(R.excluded.some((x) => x.id === "obligations" && /non cochée/.test(x.why)));
  });
  test("plancher de liquidités respecté", () => {
    const { A, M } = setup(); const m = market();
    const R = A.run(Object.assign({ prefs: prefs(M, { extra: { limits: { min_liquidites: 30 } } }), now: NOW, current: {} }, m));
    assert.ok(R.steps.final.liquidites >= 0.3 - 1e-9);
  });
  test("cible de volatilité : l'algorithme la respecte avec des liquidités ; inatteignable sans refuge → drapeau", () => {
    const { A, M } = setup(); const m = market();
    const R = A.run(Object.assign({ prefs: prefs(M, { classes: ["actions", "liquidites"], vehicles: ["etf", "cash"], extra: { risk_profile: "prudent" } }), now: NOW, current: {} }, m));
    assert.ok(R.steps.final.liquidites > 0.5, "le reste en liquidités (" + R.steps.final.liquidites + ")");
    assert.ok(R.totals.sigma_engine <= 0.05 + 1e-6, "volatilité ≤ 5 % (" + R.totals.sigma_engine + ")");
    const R2 = A.run(Object.assign({ prefs: prefs(M, { classes: ["actions"], vehicles: ["etf"], extra: { risk_profile: "prudent" } }), now: NOW, current: {} }, m));
    assert.ok(R2.flags.some((f) => f.code === "vol" && /inatteignable/.test(f.msg)));
  });
  test("données manquantes : poids du profil sans inclinaison, confiance faible, jamais de repli sur le scanner", () => {
    const { A, M, CK } = setup(); const m = market();
    delete m.series.or;
    let scanned = 0; CK.mkt.quotes = () => { scanned++; return Promise.resolve({}); };
    const R = A.run(Object.assign({ prefs: prefs(M), now: NOW, current: {} }, m));
    const d = R.decisions.find((x) => x.poche === "or");
    assert.equal(d.score, null); assert.equal(d.confiance.label, "faible");
    // sans score, l'or n'est pas incliné : il évolue comme les liquidités (jamais inclinées), seulement par la remise à 100 %
    assert.ok(Math.abs(R.steps.tilted.or / R.steps.strategic.or - R.steps.tilted.liquidites / R.steps.strategic.liquidites) < 1e-12);
    assert.equal(scanned, 0);
  });
  test("point-in-time : modifier les cours APRÈS la date de décision ne change rien", () => {
    const { A, M } = setup(); const m = market(9), T = A.decision(NOW).T;
    const bump = (S) => ({ t: S.t, c: S.c.map((v, k) => (S.t[k] > T ? v * (k % 2 ? 3 : 0.2) : v)) });
    const m2 = { series: Object.fromEntries(Object.entries(m.series).map(([k, v]) => [k, bump(v)])), ref: bump(m.ref), vix: { t: m.vix.t, c: m.vix.c.map((v, k) => (m.vix.t[k] > T ? 80 : v)) } };
    m2.series.actions_titres = m2.series.actions_etf;
    const p = prefs(M);
    const a = A.run(Object.assign({ prefs: p, now: NOW, current: {} }, m)), b = A.run(Object.assign({ prefs: p, now: NOW, current: {} }, m2));
    assert.deepEqual(JSON.parse(JSON.stringify(a.steps)), JSON.parse(JSON.stringify(b.steps)));
    assert.equal(a.regime.id, b.regime.id);
    assert.deepEqual(a.decisions.map((d) => d.score), b.decisions.map((d) => d.score));
  });
  test("score de rotation en série temporelle : cocher une autre classe ne change pas le score d'une classe", () => {
    const { A, M } = setup(); const m = market(4);
    const a = A.run(Object.assign({ prefs: prefs(M, { classes: ["actions", "or", "matieres_premieres"], vehicles: ["etf", "etc_etn"] }), now: NOW, current: {} }, m));
    const b = A.run(Object.assign({ prefs: prefs(M), now: NOW, current: {} }, m));
    const sc = (R) => R.decisions.find((d) => d.poche === "or").score;
    assert.ok(sc(a) != null); assert.equal(sc(a), sc(b));
  });
});

describe("portefeuille réel : bande, rotation, enveloppes", () => {
  const ACC = [{ id: "pea", name: "PEA", account_type: "PEA", cash_balance: 0, deposits_total: 20000, opened_at: "2020-01-01" },
    { id: "cto", name: "CTO", account_type: "CTO", cash_balance: 0 }];
  test("achats ≤ espèces + versement + ventes dans chaque compte ; jamais d'ETF non éligible dans le PEA ; aucun transfert", () => {
    const { A, M, CK } = setup(); const m = market();
    const { P, V } = pf(CK, { accounts: ACC, holdings: [{ account_id: "pea", instrument_id: "isin:LU1681043599", quantity: 200 }, { account_id: "cto", instrument_id: "isin:IE00B5BMR087", quantity: 50 }] });
    const p = prefs(M, { extra: { monthly_contribution_eur: 1000 } });
    const R = A.run(Object.assign({ prefs: p, now: NOW, current: A.current(P, V, 1000) }, m));
    assert.equal(R.invariants.buys_ok, true); assert.equal(R.invariants.pea_room_ok, true);
    for (const o of R.orders) if (o.account_type === "PEA" && o.side === "achat" && !o.skipped) assert.ok(CK.pea.allowedIn(o.i, "PEA").ok, o.instrument_id + " dans le PEA");
    // aucun transfert : la valeur de chaque compte après ordres = avant + sa part du versement
    for (const a of ["pea", "cto"]) {
      const before = V.accounts.find((x) => x.id === a).value, ct = R.contrib[a] || 0;
      const buys = R.orders.filter((o) => o.account_id === a && !o.skipped && o.side === "achat").reduce((s, o) => s + o.amount, 0);
      const sells = R.orders.filter((o) => o.account_id === a && !o.skipped && o.side === "vente").reduce((s, o) => s + o.amount, 0);
      assert.ok(buys <= sells + ct + 0.01 + V.accounts.find((x) => x.id === a).cash_eur, a);
      assert.ok(before + ct > 0);
    }
    assert.ok(Math.abs(Object.values(R.contrib).reduce((s, v) => s + v, 0) - 1000) < 0.01, "le versement est réparti en entier");
  });
  test("plafond PEA atteint : le versement va au compte-titres", () => {
    const { A, M, CK } = setup(); const m = market();
    const { P, V } = pf(CK, { accounts: [Object.assign({}, ACC[0], { deposits_total: 150000 }), ACC[1]], holdings: [{ account_id: "pea", instrument_id: "isin:LU1681043599", quantity: 100 }, { account_id: "cto", instrument_id: "isin:IE00B5BMR087", quantity: 100 }] });
    const R = A.run(Object.assign({ prefs: prefs(M, { extra: { monthly_contribution_eur: 2000 } }), now: NOW, current: A.current(P, V, 2000) }, m));
    assert.equal(R.contrib.pea || 0, 0); assert.ok(Math.abs(R.contrib.cto - 2000) < 0.01);
  });
  test("bande d'inaction : un portefeuille déjà à sa cible ne bouge pas (CONSERVER, aucun ordre)", () => {
    const { A, M, CK } = setup(); const m = market();
    const p = prefs(M, { classes: ["actions", "liquidites"], vehicles: ["etf", "cash"], extra: { risk_profile: "agressif", limits: { bande_inaction_pp: 5, max_par_instrument: 100 } } });
    const R0 = A.run(Object.assign({ prefs: p, now: NOW, current: {} }, m)), wa = R0.steps.final.actions;
    const V0 = 10000, cash = Math.round(V0 * (1 - wa));
    const { P, V } = pf(CK, { accounts: [Object.assign({}, ACC[0], { cash_balance: cash })], holdings: [{ account_id: "pea", instrument_id: "isin:LU1681043599", quantity: (V0 - cash) / 100 }] });
    const R = A.run(Object.assign({ prefs: p, now: NOW, current: A.current(P, V, 0) }, m));
    assert.equal(R.decisions.find((d) => d.poche === "actions").action, "CONSERVER");
    assert.equal(R.orders.filter((o) => !o.skipped).length, 0);
  });
  test("rotation maximale : les ventes libres sont réduites à la limite ; une classe décochée est vendue (ventes obligatoires)", () => {
    const { A, M, CK } = setup(); const m = market();
    const { P, V } = pf(CK, { accounts: [ACC[1]], holdings: [{ account_id: "cto", instrument_id: "isin:IE00B5BMR087", quantity: 100 }, { account_id: "cto", instrument_id: "isin:IE00B4ND3602", quantity: 100 }] });
    const p = prefs(M, { classes: ["actions", "obligations", "oblig_etat", "liquidites"], vehicles: ["etf", "cash"], extra: { risk_profile: "prudent", limits: { max_turnover_mensuel: 10 } } });
    const R = A.run(Object.assign({ prefs: p, now: NOW, current: A.current(P, V, 0) }, m));
    const or = R.decisions.find((d) => d.poche === "or");
    assert.ok(or && or.w_target < 0.0005, "or (décoché) vendu"); assert.notEqual(or.action, "CONSERVER");
    assert.ok(R.flags.some((f) => /ventes obligatoires/.test(f.msg)), "ventes obligatoires au-delà de la limite signalées");
    // les ventes obligatoires dépassent déjà la limite : aucune vente libre en plus
    const w0 = A.current(P, V, 0).w0, freeSells = R.universe.reduce((s, k) => s + Math.max(0, (w0[k] || 0) - R.steps.final[k]), 0);
    assert.ok(freeSells < 1e-9, "ventes libres " + freeSells);
  });
  test("lignes bloquées (assurance-vie) : comptées dans l'actuel, jamais déplacées", () => {
    const { A, M, CK } = setup(); const m = market();
    const { P, V } = pf(CK, { accounts: [ACC[1], { id: "av", name: "AV", account_type: "assurance_vie", cash_balance: 0 }],
      holdings: [{ account_id: "cto", instrument_id: "isin:LU1681043599", quantity: 100 }, { account_id: "av", instrument_id: "isin:IE00B4ND3602", quantity: 50 }] });
    const R = A.run(Object.assign({ prefs: prefs(M, { classes: ["actions", "liquidites"], vehicles: ["etf", "cash"] }), now: NOW, current: A.current(P, V, 0) }, m));
    assert.equal(R.orders.filter((o) => o.account_id === "av").length, 0);
    assert.ok(R.flags.some((f) => /bloqué hors de tes classes/.test(f.msg)));
    assert.ok(R.decisions.find((d) => d.poche === "or").w_target > 0.2, "l'or de l'assurance-vie reste");
  });
});

describe("sélection des instruments", () => {
  const ctx = (CK, p, extra = {}) => Object.assign({ prefs: p, T: CK.alloc.decision(NOW).T, resume: null, held: {}, accounts: [], pocheOf: CK.alloc.pocheOf, pea_mode: p.pea_mode, vols: {} }, extra);
  test("profil prudent : un ETF à levier (LQQ) n'est jamais candidat (risque max 4/7, levier non autorisé)", () => {
    const { S, M, CK } = setup(); const p = prefs(M, { extra: { risk_profile: "prudent", limits: { risque_max_sri: 4 } } });
    const c = S.candidates("actions_etf", ctx(CK, p)).find((x) => x.id === "isin:FR0010342592");
    assert.equal(c.ok, false); assert.match(c.why, /levier|risque/i);
  });
  test("mode PEA strict : seuls les éligibles ; l'or et la crypto sortent de l'univers", () => {
    const { A, M } = setup(); const m = market();
    const R = A.run(Object.assign({ prefs: prefs(M, { extra: { pea_mode: "strict" } }), now: NOW, current: {} }, m));
    assert.ok(R.excluded.some((x) => x.id === "or" && /PEA strict/.test(x.why)));
    assert.ok(R.excluded.some((x) => x.id === "crypto"));
    for (const d of R.decisions) for (const l of d.instruments_proposes) assert.ok(l.pea && l.pea.ok, l.id);
  });
  test("titres en direct : sans notes du screener, seuls les titres détenus sont gardés (aucun nouveau)", () => {
    const { S, M, CK } = setup(); const p = prefs(M);
    const prof = ALLOC.profils.modere;
    assert.deepEqual([...S.stocksPlan(S.candidates("actions_titres", ctx(CK, p)), ctx(CK, p), prof).ids], []);
    const c1 = S.candidates("actions_titres", ctx(CK, p, { held: { "isin:FR0000120271": 5000 } }));
    assert.deepEqual([...S.stocksPlan(c1, ctx(CK, p), prof).ids], ["isin:FR0000120271"]);
    const pk = S.pick("actions_titres", c1, 8000, 100000, Object.assign(ctx(CK, p), { stockIds: ["isin:FR0000120271"] }));
    assert.deepEqual([...pk.lines.map((l) => l.id)], ["isin:FR0000120271"]);
  });
  test("une ligne détenue et autorisée est gardée (pas de bascule inutile) ; pas deux ETF de même exposition", () => {
    const { S, M, CK } = setup(); const p = prefs(M, { extra: { limits: { max_par_instrument: 100 } } });
    const cands = S.candidates("actions_etf", ctx(CK, p, { held: { "isin:IE00B4L5Y983": 3000 } }));
    const pk = S.pick("actions_etf", cands, 9000, 100000, ctx(CK, p));
    assert.equal(pk.lines[0].id, "isin:IE00B4L5Y983"); assert.equal(pk.lines.length, 1);
    const groups = pk.lines.map((l) => l.i.alt_group); assert.equal(new Set(groups).size, groups.length);
  });
  test("plafond par instrument : la poche se répartit sur plusieurs instruments d'expositions différentes", () => {
    const { S, M, CK } = setup(); const p = prefs(M, { extra: { limits: { max_par_instrument: 20 } } });
    const pk = S.pick("actions_etf", S.candidates("actions_etf", ctx(CK, p)), 50000, 100000, ctx(CK, p));
    assert.ok(pk.lines.length >= 3); for (const l of pk.lines) assert.ok(l.amount <= 20000 + 1e-6 || pk.flags.length);
    assert.equal(new Set(pk.lines.map((l) => l.i.alt_group)).size, pk.lines.length);
  });
  test("données trop anciennes ou instrument lancé après la date de décision : exclu avec le motif", () => {
    const { S, M, CK } = setup(); const p = prefs(M);
    const res = { "isin:LU1681043599": { d: "2026-09-01", first: "2011-11-17", n: 3800 }, "isin:FR0014017NX3": { d: "2026-11-16", first: "2026-11-05", n: 96 } };
    const c = S.candidates("actions_etf", ctx(CK, p, { resume: res }));
    assert.match(c.find((x) => x.id === "isin:LU1681043599").why, /trop anciennes/);
    assert.match(c.find((x) => x.id === "isin:FR0014017NX3").why, /Pas encore coté/);
    assert.match(c.find((x) => x.id === "isin:IE00B4L5Y983").why, /Aucun historique publié/);
  });
  test("coût d'un ordre : minimum par ordre, demi-spread, change hors euro", () => {
    const { S, CK } = setup();
    const cw8 = CK.ref.get("isin:LU1681043599"), igln = CK.ref.get("isin:IE00B4ND3602");
    assert.ok(Math.abs(S.orderCost(50, "PEA", cw8) - (1 + 50 * (5 + 5) / 1e4)) < 1e-9);
    assert.ok(S.orderCost(10000, "CTO", igln) > S.orderCost(10000, "CTO", cw8));
    assert.equal(S.saleTax(1000, "PEA", 0.5), 0); assert.ok(Math.abs(S.saleTax(1000, "CTO", 0.5) - 157) < 1e-9);
  });
});

describe("vocabulaire et explications", () => {
  test("chaque décision a une action de la liste, des raisons, une confiance et la date de calcul", () => {
    const { A, M } = setup(); const m = market();
    const R = A.run(Object.assign({ prefs: prefs(M), now: NOW, current: {} }, m));
    for (const d of R.decisions) {
      assert.ok(A.ACTIONS.includes(d.action), d.action);
      assert.ok(d.raisons.length >= 1 && d.raisons.length <= 3);
      assert.ok(["faible", "moyenne", "élevée"].includes(d.confiance.label));
      assert.equal(d.date_calcul, "2026-10-30");
    }
    const txt = JSON.stringify(R);
    assert.ok(!/recommandation|conseil/i.test(txt), "jamais « recommandation » ni « conseil » dans la proposition");
  });
});
