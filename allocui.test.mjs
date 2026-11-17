// « Mes règles » (prefs.js) et onglet Allocation (allocui.js), chargés avec les vrais modules.
// Vérifie : formulaire → préférences (sous-classe sans parent ignorée, poids personnalisés, répartition du versement), contrôles,
// nettoyage des nouveaux champs (poches écartées, poids personnalisés), rendu (avertissement exact, rien avant tes règles,
// textes échappés, montants masqués), journal figé par mois (sans doublon, relu sans confiance), et aucun appel au scanner.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeContext } from "./vmkit.mjs";

const rd = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const REF = JSON.parse(rd("./referentiel.json")), ALLOC = JSON.parse(rd("./allocation.json")), FISCAL = JSON.parse(rd("./fiscal.json"));
const DISC = "Les informations affichées ne constituent pas un conseil en investissement personnalisé. Les performances passées ne préjugent pas des performances futures.";
const NOW = Date.parse("2026-11-17T10:00:00Z");

function setup() {
  const { CK, load } = makeContext();
  CK.cfg = () => ({ data: "https://lafouge-stack.github.io/Desk" });
  for (const f of ["models.js", "datakit.js", "fx.js", "calendars.js", "pea.js", "providers.js", "indicators.js", "pfcore.js", "selection.js", "allocation.js", "prefs.js", "allocui.js"]) load(f);
  CK.models.setData("referentiel", REF); CK.models.setData("allocation", ALLOC); CK.models.setData("fiscal", FISCAL);
  const calls = [];
  CK.dk.env = Object.assign({}, CK.dk.env, { now: () => NOW, fetch: (u) => { calls.push(String(u)); return Promise.reject(new Error("réseau coupé")); }, indexedDB: null });
  return { CK, P: CK.prefs, T: CK.alui._t, M: CK.models, calls };
}
function walk(seed, vol) {
  let s = seed; const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const t = [], c = []; let p = 100;
  for (let ts = Date.parse("2016-01-04T16:30:00Z"); ts < NOW; ts += 864e5) { const d = new Date(ts).getUTCDay(); if (d === 0 || d === 6) continue; p *= Math.exp(0.0002 + vol * (r() - 0.5) / 8); t.push(ts); c.push(p); }
  return { t, c };
}

describe("préférences : formulaire", () => {
  test("valeurs du formulaire → règles enregistrées ; une sous-classe sans sa classe parente n'est jamais autorisée", () => {
    const { P, M } = setup();
    const p = P.fromValues({ cls: ["actions", "or"], veh: ["etf", "etc_etn"], prof: "dynamique", hor: "moyen", pea: "prioritaire", contrib: "1 500", mpi: "35", mcr: "8", sri: "5", reg: ["monde", "europe"], ccy: ["EUR"], poche: ["actions_etf", "or"] });
    assert.equal(p.saved, true); assert.equal(p.risk_profile, "dynamique"); assert.equal(p.horizon, "moyen"); assert.equal(p.pea_mode, "prioritaire");
    assert.equal(p.monthly_contribution_eur, 1500); assert.equal(p.limits.max_par_instrument, 35); assert.equal(p.limits.max_crypto, 8); assert.equal(p.limits.risque_max_sri, 5);
    assert.equal(p.classes.or, true); assert.equal(M.isClassAllowed("or", p.classes), false, "or sans « Matières premières » : refusé");
    assert.deepEqual([...p.filters.regions], ["monde", "europe"]);
    assert.ok(p.poches_exclues.includes("obligations") && !p.poches_exclues.includes("or"));
  });
  test("poids personnalisés et répartition du versement : contrôlés (100 %)", () => {
    const { P } = setup();
    const w = { perso: ["1"] }; for (const q of ALLOC.poches) w["w_" + q.id] = "0"; w.w_actions_etf = "70"; w.w_liquidites = "20";
    const p = P.fromValues(Object.assign({ cls: ["actions", "liquidites"], veh: ["etf"], sp_pea: "60", sp_cto: "30" }, w));
    assert.equal(p.poids_perso.actions_etf, 70);
    const pb = P.problems(p);
    assert.ok(pb.some((x) => /poids personnalisés font 90/.test(x))); assert.ok(pb.some((x) => /versement fait 90/.test(x)));
    assert.equal(p.vehicles.cash, true, "les liquidités sont les espèces des comptes");
  });
  test("rien de coché : refusé avec un message clair", () => {
    const { P } = setup();
    assert.match(P.problems(P.fromValues({}))[0], /Coche au moins une classe/);
  });
  test("champs nouveaux nettoyés : clés dangereuses refusées, poids bornés", () => {
    const { M } = setup();
    const p = M.normPrefs({ poches_exclues: ["or", "constructor", "<img>", 3, "x".repeat(40)], poids_perso: { actions_etf: 250, or: -4, "<b>": 5 } });
    assert.deepEqual([...p.poches_exclues], ["or"]);
    assert.equal(p.poids_perso.actions_etf, 100); assert.equal(p.poids_perso.or, 0); assert.ok(!("<b>" in p.poids_perso));
    // une clé « __proto__ » n'importe où : tout l'objet est refusé (préférences par défaut, rien d'enregistré)
    const bad = M.normPrefs(JSON.parse('{"saved":true,"poids_perso":{"__proto__":50,"actions_etf":60}}'));
    assert.equal(bad.saved, false); assert.equal(bad.poids_perso, null);
    assert.equal(M.normPrefs({ poids_perso: [1, 2] }).poids_perso, null);
  });
  test("formulaire : avertissement exact, profils présentés comme modèles publics, sous-classes grisées sans parent", () => {
    const { P, CK } = setup();
    const h = P._t.formHTML(CK.models.normPrefs({ classes: { matieres_premieres: false, or: true } }), { accounts: [{ id: "a", name: '<img src=x onerror=1>', account_type: "PEA" }] });
    assert.ok(h.includes(DISC)); assert.match(h, /modèles publics d'exemple/); assert.match(h, /Rien n'est calculé tant que/);
    assert.match(h, /<label class="pr-cl d1 off"><input type="checkbox" name="cls" value="or" disabled/);
    assert.ok(!/<img/.test(h), "nom de compte échappé");
  });
});

describe("onglet Allocation : rendu", () => {
  test("règles non enregistrées : invitation, aucun calcul ni appel réseau", () => {
    const { CK, calls } = setup();
    const F = CK.pfc, Pf = F.demo(), V = F.value(Pf, () => null);
    const h = CK.alui.html(Pf, V, {});
    assert.match(h, /data-pf="al-prefs"/); assert.match(h, /Rien n'est calculé tant que tu n'as pas enregistré/);
    CK.alui.ensure(Pf, V, () => {});
    assert.equal(calls.length, 0); assert.equal(CK.alui.state().busy, false);
  });
  test("proposition complète : titre du mois, avertissement exact, actions lisibles, montants masqués", () => {
    const { CK, T, M } = setup();
    const eq = walk(1, 0.2), F = CK.pfc, Pf = F.demo();
    CK.fx.setDaily("USD", [["2020-01-01", 0.9]]);
    const V = F.value(Pf, (id) => ({ last: 100, currency: F.instr(Pf, id)?.currency || "EUR", ts: NOW, source: "t" }));
    const p = M.normPrefs({ saved: true, classes: { actions: true, obligations: true, oblig_etat: true, liquidites: true }, vehicles: { etf: true, titre: true, cash: true }, risk_profile: "modere" });
    const R = CK.alloc.run({ prefs: p, now: NOW, series: { actions_etf: eq, actions_titres: eq, obligations: walk(2, 0.05) }, ref: eq, vix: null, current: CK.alloc.current(Pf, V, 0) });
    assert.equal(R.ok, true);
    const h = T.viewHTML({ prefs: p, R, journal: [], open: { [R.decisions[0].poche]: true }, hide: true, peaAlt: [] });
    assert.match(h, /Proposition de novembre 2026 selon tes règles/); assert.ok(h.includes(DISC));
    assert.match(h, /Aucun ordre n'est passé/); assert.match(h, /class="al-det"/);
    const leak = h.replace(/•••/g, "").replace(/\d+ €\/mois/g, "").match(/.{0,80}\d[\d  ]*,?\d* €.{0,20}/);
    assert.ok(!leak, "aucun montant visible en mode masqué : " + (leak && leak[0]));
    const hv = h.replace(DISC, "").replace(/ce n'est pas un conseil personnalisé/g, "");
    assert.ok(!/recommandation|conseil/i.test(hv), "vocabulaire : jamais « recommandation » ni « conseil »");
  });
  test("textes échappés dans les ordres et les motifs", () => {
    const { T } = setup();
    const evil = '"><img src=x onerror=alert(1)>';
    const R = { ok: true, portfolio: true, contrib: {}, orders: [{ account_id: "a", account: evil, account_type: "CTO", instrument_id: "x", i: { symbol: evil, name: evil }, side: "achat", amount: 100, cost: 1, tax: 0 }],
      excluded: [{ id: "or", label: evil, why: evil }] };
    const h = T.ordersHTML(R, {}) + T.excludedHTML(R) + T.flagsHTML([{ level: "attention", msg: evil }]);
    assert.ok(!/<img/.test(h));
  });
});

describe("journal", () => {
  test("une entrée par mois, figée ; remplacée seulement sur demande ; relue sans confiance", () => {
    const { CK, T } = setup();
    const R = { ok: true, month: "2026-11", monthLabel: "novembre 2026", asOf: "2026-10-30", prefs_hash: "a", profile: { label: "Modéré" }, regime: { label: "Neutre" },
      totals: { sigma_before: 0.1, sigma_after: 0.08 }, decisions: [{ poche: "or", label: "Or", action: "RENFORCER", w0: 0, w_target: 0.05 }] };
    T.jAdd(R, false); T.jAdd(Object.assign({}, R, { profile: { label: "Prudent" } }), false);
    let j = T.jRead(); assert.equal(j.length, 1); assert.equal(j[0].profile, "Modéré");
    T.jAdd(Object.assign({}, R, { profile: { label: "Prudent" } }), true); j = T.jRead(); assert.equal(j[0].profile, "Prudent");
    CK.lsj("alloc:hist", { v: 1, items: [{ month: "2026-10", profile: "<script>x</script>", decisions: [{ l: "<b>", a: "RENFORCER" }] }, { month: "../x" }, null] });
    j = T.jRead(); assert.equal(j.length, 1); assert.ok(!/<script/.test(j[0].profile));
    assert.ok(!/<b>|<script/.test(T.journalHTML(j, "2026-11")));
  });
});

describe("données", () => {
  test("historiques demandés : seulement les poches de tes classes, l'indice de référence et le VIX (jamais le scanner)", () => {
    const { T, M } = setup();
    const ids = T.needIds(M.normPrefs({ classes: { actions: true, crypto: true } }));
    assert.ok(ids.includes("isin:LU1681043599") && ids.includes("crypto:BTC") && ids.includes("tv:TVC:VIX"));
    assert.ok(!ids.includes("isin:IE00B4WXJJ64"), "pas d'obligations sans la case");
  });
  test("conversion en euros : fixing BCE, sinon EURUSD du robot à la même date (jamais une date future)", () => {
    const { T, CK } = setup();
    CK.fx.setDaily("USD", [["2024-01-02", 0.91]]);
    const eu = { t: [Date.parse("2020-01-02T16:00:00Z"), Date.parse("2025-01-02T16:00:00Z")], c: [1.25, 1.03] };
    const fx = T.fxFn(eu);
    assert.equal(fx("USD", "2024-06-03"), 0.91);
    assert.equal(fx("USD", "2021-06-01"), 1 / 1.25);
    assert.equal(fx("USD", "2019-01-01"), null);
  });
});
