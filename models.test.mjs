// Tests indépendants de models.js : arbre des classes, garde-fou CK.allow (avec test de propriété),
// normaliseurs, num(), isinValid, cleanText, référentiel CK.ref, avertissement légal.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makeContext, rng } from "./vmkit.mjs";

const fresh = () => makeContext().load("models.js");
const CK = fresh();
const M = CK.models;
// Les objets créés dans le contexte vm ont un autre Object.prototype : on compare des copies JSON.
const plain = (v) => JSON.parse(JSON.stringify(v));

/* Arbre de référence écrit à la main (cahier des charges), indépendant de models.js. */
const TREE = {
  actions: null, obligations: null, oblig_etat: "obligations", oblig_entreprise: "obligations",
  matieres_premieres: null, or: "matieres_premieres", argent: "matieres_premieres", energie: "matieres_premieres",
  petrole: "energie", gaz: "energie", agricole: "matieres_premieres", immobilier_cote: null,
  crypto: null, stablecoin: "crypto", liquidites: null, devises: null
};
const CLS = Object.keys(TREE);
const parents = (c) => { const o = []; for (let p = TREE[c]; p; p = TREE[p]) o.push(p); return o; };
const INVEST_VH = ["titre", "etf", "etc_etn", "fonds", "spot_crypto", "cash"];
const ALL_VH = [...INVEST_VH, "indice", "taux"];
const prefsWith = (classes = [], vehicles = [], limits = {}) => {
  const p = M.defaultPrefs();
  for (const c of classes) p.classes[c] = true;
  for (const v of vehicles) p.vehicles[v] = true;
  Object.assign(p.limits, limits);
  return p;
};
const instr = (o) => M.normInstrument({ id: "t:" + (o.asset_class || "x") + ":" + (o.vehicle || "x"), name: "Test", tickers: { tv: "X:Y" }, ...o });

describe("arbre des classes", () => {
  test("les 16 classes et leurs parents correspondent au cahier des charges", () => {
    assert.deepEqual(plain(M.CLASSES.map((c) => c.id)).sort(), [...CLS].sort());
    for (const c of M.CLASSES) assert.equal(c.parent, TREE[c.id], c.id);
    for (const c of M.CLASSES) assert.ok(c.label && typeof c.label === "string", "libellé " + c.id);
  });
  test("classAncestors remonte toute la chaîne, du parent direct à la racine", () => {
    assert.deepEqual(plain(M.classAncestors("petrole")), ["energie", "matieres_premieres"]);
    assert.deepEqual(plain(M.classAncestors("gaz")), ["energie", "matieres_premieres"]);
    assert.deepEqual(plain(M.classAncestors("oblig_etat")), ["obligations"]);
    assert.deepEqual(plain(M.classAncestors("stablecoin")), ["crypto"]);
    assert.deepEqual(plain(M.classAncestors("actions")), []);
    for (const c of CLS) assert.deepEqual(plain(M.classAncestors(c)), parents(c), c);
  });
  test("classAncestors : classe inconnue ou clé du prototype → aucun parent", () => {
    for (const c of ["inconnue", "", null, undefined, "toString", "constructor", "__proto__"]) assert.deepEqual(plain(M.classAncestors(c)), [], String(c));
  });
  test("classChildren", () => {
    assert.deepEqual(plain(M.classChildren("energie")).sort(), ["gaz", "petrole"]);
    assert.deepEqual(plain(M.classChildren("matieres_premieres")).sort(), ["agricole", "argent", "energie", "or"]);
    assert.deepEqual(plain(M.classChildren("actions")), []);
  });
  test("isClassAllowed : un enfant n'est autorisé que si lui ET tous ses parents sont cochés", () => {
    assert.equal(M.isClassAllowed("petrole", { petrole: true }), false);
    assert.equal(M.isClassAllowed("petrole", { petrole: true, energie: true }), false);
    assert.equal(M.isClassAllowed("petrole", { petrole: true, matieres_premieres: true }), false);
    assert.equal(M.isClassAllowed("petrole", { petrole: true, energie: true, matieres_premieres: true }), true);
    assert.equal(M.isClassAllowed("matieres_premieres", { matieres_premieres: true }), true);
    // Cocher le parent n'autorise pas les enfants non cochés
    assert.equal(M.isClassAllowed("or", { matieres_premieres: true }), false);
    assert.equal(M.isClassAllowed("stablecoin", { crypto: true }), false);
    assert.equal(M.isClassAllowed("stablecoin", { crypto: true, stablecoin: true }), true);
  });
  test("isClassAllowed exige la valeur true (pas une valeur « vraie »)", () => {
    assert.equal(M.isClassAllowed("actions", { actions: 1 }), false);
    assert.equal(M.isClassAllowed("actions", { actions: "true" }), false);
    assert.equal(M.isClassAllowed("or", { or: true, matieres_premieres: "oui" }), false);
  });
  test("isClassAllowed : classe inconnue, cases absentes, clés du prototype → faux", () => {
    assert.equal(M.isClassAllowed("actions", null), false);
    assert.equal(M.isClassAllowed("actions", undefined), false);
    assert.equal(M.isClassAllowed("inconnue", { inconnue: true }), false);
    for (const k of ["toString", "valueOf", "hasOwnProperty", "constructor"]) assert.equal(M.isClassAllowed(k, { [k]: true }), false, k);
  });
  test("chaque classe : autorisée avec toute sa chaîne, refusée dès qu'un maillon manque", () => {
    for (const c of CLS) {
      const chain = [c, ...parents(c)];
      const all = Object.fromEntries(chain.map((x) => [x, true]));
      assert.equal(M.isClassAllowed(c, all), true, c);
      for (const miss of chain) assert.equal(M.isClassAllowed(c, { ...all, [miss]: false }), false, c + " sans " + miss);
    }
  });
});

describe("véhicules et énumérations", () => {
  test("8 véhicules, indice et taux non investissables", () => {
    assert.deepEqual(plain(M.VEHICLES.map((v) => v.id)), ALL_VH);
    for (const v of M.VEHICLES) assert.equal(v.investable, INVEST_VH.includes(v.id), v.id);
  });
  test("defaultPrefs : rien n'est coché, rien n'est enregistré", () => {
    const p = M.defaultPrefs();
    assert.equal(p.saved, false);
    assert.deepEqual(Object.keys(p.classes).sort(), [...CLS].sort());
    assert.ok(Object.values(p.classes).every((x) => x === false));
    assert.deepEqual(Object.keys(p.vehicles), INVEST_VH, "seuls les véhicules investissables sont cochables");
    assert.ok(Object.values(p.vehicles).every((x) => x === false));
    assert.equal(p.limits.levier_autorise, false);
    assert.equal(p.limits.risque_max_sri, null);
  });
  test("defaultPrefs renvoie un nouvel objet à chaque appel", () => {
    const a = M.defaultPrefs(); a.classes.actions = true;
    assert.equal(M.defaultPrefs().classes.actions, false);
  });
});

describe("CK.allow et CK.allow.why", () => {
  const etf = instr({ asset_class: "actions", vehicle: "etf" });
  const ok = prefsWith(["actions"], ["etf"]);
  test("autorisé : classe et véhicule cochés, motif vide", () => {
    assert.equal(CK.allow(etf, ok), true);
    assert.equal(CK.allow.why(etf, ok), "");
  });
  test("classe non cochée", () => {
    const p = prefsWith(["obligations"], ["etf"]);
    assert.equal(CK.allow(etf, p), false);
    assert.match(CK.allow.why(etf, p), /^Hors de tes classes : Actions\.$/);
  });
  test("parent non coché : le motif nomme le parent", () => {
    const i = instr({ asset_class: "petrole", vehicle: "etc_etn" });
    const p = prefsWith(["petrole", "matieres_premieres"], ["etc_etn"]);
    assert.equal(CK.allow(i, p), false);
    const why = CK.allow.why(i, p);
    assert.match(why, /Pétrole/);
    assert.match(why, /classe parente non cochée : Énergie/);
    assert.doesNotMatch(why, /Matières premières[,)]/, "le parent coché n'est pas cité");
    const p2 = prefsWith(["petrole"], ["etc_etn"]);
    assert.match(CK.allow.why(i, p2), /Énergie, Matières premières/);
    assert.equal(CK.allow(i, prefsWith(["petrole", "energie", "matieres_premieres"], ["etc_etn"])), true);
  });
  test("véhicule non coché", () => {
    const p = prefsWith(["actions"], ["titre"]);
    assert.equal(CK.allow(etf, p), false);
    assert.equal(CK.allow.why(etf, p), "Type non coché : ETF.");
  });
  test("non investissable : indice et taux refusés même si tout est coché", () => {
    const all = prefsWith(CLS, INVEST_VH, { levier_autorise: true });
    for (const vehicle of ["indice", "taux"]) {
      const i = instr({ asset_class: "actions", vehicle });
      assert.equal(i.is_investable, false);
      assert.equal(CK.allow(i, all), false);
      assert.equal(CK.allow.why(i, all), "Non investissable (indice ou taux).");
    }
    const forced = instr({ asset_class: "actions", vehicle: "indice", is_investable: true });
    assert.equal(forced.is_investable, false, "un indice marqué investissable par erreur reste non investissable");
    assert.equal(CK.allow(forced, { ...all, vehicles: { ...all.vehicles, indice: true } }), false);
    const off = instr({ asset_class: "actions", vehicle: "etf", is_investable: false });
    assert.equal(CK.allow.why(off, ok), "Non investissable (indice ou taux).");
  });
  test("inactif", () => {
    const i = instr({ asset_class: "actions", vehicle: "etf", is_active: false });
    assert.equal(CK.allow(i, ok), false);
    assert.equal(CK.allow.why(i, ok), "Instrument inactif.");
  });
  test("levier ou inverse refusé sauf autorisation", () => {
    for (const leverage of [2, -1, 3, 0.5]) {
      const i = instr({ asset_class: "actions", vehicle: "etf", leverage });
      assert.equal(CK.allow(i, ok), false, "levier " + leverage);
      assert.equal(CK.allow.why(i, ok), "Produit à levier ou inverse non autorisé.");
      assert.equal(CK.allow(i, prefsWith(["actions"], ["etf"], { levier_autorise: true })), true);
    }
  });
  test("SRI au-dessus du maximum refusé, égal accepté, sans SRI accepté", () => {
    const p = prefsWith(["actions"], ["etf"], { risque_max_sri: 4 });
    assert.equal(CK.allow(instr({ asset_class: "actions", vehicle: "etf", risk_level: 5 }), p), false);
    assert.equal(CK.allow.why(instr({ asset_class: "actions", vehicle: "etf", risk_level: 5 }), p), "Niveau de risque 5/7 au-dessus de ton maximum (4/7).");
    assert.equal(CK.allow(instr({ asset_class: "actions", vehicle: "etf", risk_level: 4 }), p), true);
    assert.equal(CK.allow(instr({ asset_class: "actions", vehicle: "etf" }), p), true);
    assert.equal(CK.allow(instr({ asset_class: "actions", vehicle: "etf", risk_level: 7 }), ok), true, "pas de maximum");
  });
  test("instrument ou préférences absents", () => {
    assert.equal(CK.allow(null, ok), false);
    assert.equal(CK.allow.why(null, ok), "Instrument inconnu.");
    assert.equal(CK.allow(etf, null), false);
    assert.equal(CK.allow.why(etf, {}), "Préférences absentes.");
  });
  test("classe hors de l'arbre ou clé du prototype jamais autorisée", () => {
    for (const k of ["toString", "valueOf", "hasOwnProperty"]) {
      const raw = { asset_class: k, vehicle: "etf", is_investable: true, is_active: true, leverage: 1 };
      assert.equal(CK.allow(raw, { classes: { [k]: true }, vehicles: { etf: true }, limits: {} }), false, k);
      assert.equal(instr({ asset_class: k, vehicle: "etf" }).asset_class, "actions", "classe inconnue → actions");
    }
  });
  test("préférences non normalisées : seule la valeur true compte", () => {
    const raw = { classes: { actions: 1 }, vehicles: { etf: true }, limits: {} };
    assert.equal(CK.allow(etf, raw), false);
    assert.equal(CK.allow(etf, { classes: { actions: true }, vehicles: { etf: "oui" }, limits: {} }), false);
  });

  test("PROPRIÉTÉ : 500 combinaisons aléatoires × panel complet → autorisé SEULEMENT si classe, parents, véhicule et contraintes OK", () => {
    const r = rng(20261113);
    const panel = [];
    for (const asset_class of CLS) for (const vehicle of ALL_VH) {
      panel.push(instr({ asset_class, vehicle }));
      panel.push(instr({ asset_class, vehicle, leverage: 2, id: `L:${asset_class}:${vehicle}` }));
      panel.push(instr({ asset_class, vehicle, risk_level: 1 + Math.floor(r() * 7), id: `R:${asset_class}:${vehicle}` }));
    }
    for (const asset_class of CLS) panel.push(instr({ asset_class, vehicle: "etf", is_active: false, id: "I:" + asset_class }));
    // Le panel couvre toutes les classes et tous les véhicules
    assert.deepEqual([...new Set(panel.map((i) => i.asset_class))].sort(), [...CLS].sort());
    assert.deepEqual([...new Set(panel.map((i) => i.vehicle))].sort(), [...ALL_VH].sort());

    let allowed = 0, refused = 0;
    for (let n = 0; n < 500; n++) {
      const dens = 0.3 + r() * 0.6; // densité variable : beaucoup ou peu de cases cochées
      const raw = {
        classes: Object.fromEntries(CLS.map((c) => [c, r() < dens])),
        vehicles: Object.fromEntries(ALL_VH.map((v) => [v, r() < dens])), // indice/taux cochés : doivent être ignorés
        limits: { levier_autorise: r() < 0.3, risque_max_sri: r() < 0.5 ? 1 + Math.floor(r() * 7) : null }
      };
      const p = M.normPrefs(raw);
      for (const i of panel) {
        const vOk = INVEST_VH.includes(i.vehicle) && raw.vehicles[i.vehicle];
        const cOk = raw.classes[i.asset_class] && parents(i.asset_class).every((x) => raw.classes[x]);
        const levOk = raw.limits.levier_autorise || i.leverage === 1;
        const sriOk = !raw.limits.risque_max_sri || !i.risk_level || i.risk_level <= raw.limits.risque_max_sri;
        const expected = !!(i.is_active && vOk && cOk && levOk && sriOk);
        const got = CK.allow(i, p);
        assert.equal(got, expected, `combinaison ${n}, ${i.id} : attendu ${expected}`);
        assert.equal(CK.allow.why(i, p) === "", got, "why() cohérent avec allow()");
        // Sans normalisation (cases brutes) : même résultat pour les véhicules investissables
        if (INVEST_VH.includes(i.vehicle)) assert.equal(CK.allow(i, raw), expected, "prefs brutes " + i.id);
        got ? allowed++ : refused++;
      }
    }
    assert.ok(allowed > 1000 && refused > 1000, `les deux issues sont exercées (${allowed} / ${refused})`);
  });
});

describe("num()", () => {
  const cases = [
    [12, 12], [0, 0], [-3.5, -3.5], ["12", 12], ["-12", -12], ["+4", 4], ["0", 0],
    ["1 234,5", 1234.5], ["1\u00A0234,5", 1234.5], ["1\u202F234,5", 1234.5], ["12 345 678", 12345678], ["-1 234,56", -1234.56],
    ["1.234,56", 1234.56], ["1.234.567", 1234567], ["1.234.567,8", 1234567.8],
    ["1,234.5", 1234.5], ["1,234,567.89", 1234567.89], ["12,345.67", 12345.67],
    ["3,14", 3.14], ["-0,5", -0.5], ["0,125", 0.125],
    ["0.125", 0.125], ["1.500", 1.5], ["43250.12000000", 43250.12], ["0.00001234", 0.00001234], [".5", 0.5],
    ["1e3", 1000], ["2.5E-3", 0.0025]
  ];
  for (const [v, want] of cases) test(`num(${JSON.stringify(v)}) = ${want}`, () => assert.equal(M.num(v), want));
  test("valeurs non numériques → null", () => {
    for (const v of [null, undefined, "", " ", "   ", "\t", NaN, Infinity, -Infinity, "NaN", "Infinity", "-Infinity", "abc", "12abc", "1,2,3x", "0x10", "€", "--1", {}, [], true, false])
      assert.equal(M.num(v), null, JSON.stringify(String(v)));
  });
  test("le résultat est toujours un nombre fini ou null (500 entrées aléatoires)", () => {
    const r = rng(7), alpha = "0123456789.,- e+\u00A0x";
    for (let n = 0; n < 500; n++) {
      let s = ""; for (let k = 0; k < 1 + r() * 12; k++) s += alpha[Math.floor(r() * alpha.length)];
      const v = M.num(s);
      assert.ok(v === null || (typeof v === "number" && Number.isFinite(v)), JSON.stringify(s));
    }
  });
});

describe("isinValid", () => {
  const vrais = ["LU1681043599", "FR0011871128", "IE00B4L5Y983", "US0378331005", "FR0000120271", "DE0007164600", "IE00BK5BQT80"];
  for (const i of vrais) test("ISIN réel valide : " + i, () => assert.equal(M.isinValid(i), true));
  test("clé de contrôle fausse → invalide (toutes les autres clés)", () => {
    for (const i of vrais) for (let d = 0; d <= 9; d++) {
      const f = i.slice(0, 11) + d;
      if (f !== i) assert.equal(M.isinValid(f), false, f);
    }
  });
  test("chiffres permutés détectés", () => assert.equal(M.isinValid("US0378331050"), false));
  test("format invalide", () => {
    for (const v of ["", null, undefined, 12, "lu1681043599", "LU168104359", "LU16810435999", "1U1681043599", "LU168104359X", " LU1681043599", "LU-681043599"])
      assert.equal(M.isinValid(v), false, String(v));
  });
});

describe("cleanText", () => {
  test("retire les balises et compacte les espaces", () => {
    assert.equal(M.cleanText("<b>Amundi</b>   MSCI\n\tWorld"), "Amundi MSCI World");
    assert.equal(M.cleanText("<p>a</p><p>b</p>"), "a b");
    assert.equal(M.cleanText("Air&nbsp;Liquide"), "Air Liquide");
  });
  test("retire les caractères de contrôle et les marques de sens d'écriture", () => {
    assert.equal(M.cleanText("a\u0000b\u0007c\u001Fd\u007Fe"), "a b c d e");
    assert.equal(M.cleanText("a\u0085b\u009Fc"), "a b c");
    assert.equal(M.cleanText("abc\u202Egpj.exe"), "abc gpj.exe");
    assert.equal(M.cleanText("x\u2066y\u2069"), "x y");
  });
  test("garde les comparaisons et les accents", () => {
    assert.equal(M.cleanText("Obligations < 3 ans"), "Obligations < 3 ans");
    assert.equal(M.cleanText("taux <3 %"), "taux <3 %");
    assert.equal(M.cleanText("Société Générale — Énergie"), "Société Générale — Énergie");
  });
  test("longueur : 200 par défaut, max personnalisé", () => {
    assert.equal(M.cleanText("x".repeat(500)).length, 200);
    assert.equal(M.cleanText("abcdef", 3), "abc");
  });
  test("null, undefined, nombres", () => {
    assert.equal(M.cleanText(null), "");
    assert.equal(M.cleanText(undefined), "");
    assert.equal(M.cleanText(42), "42");
    assert.equal(M.cleanText(0), "0");
  });
});

describe("isoDate", () => {
  test("formats acceptés et refusés", () => {
    assert.equal(M.isoDate("2026-03-15"), "2026-03-15");
    assert.equal(M.isoDate(Date.UTC(2026, 0, 2, 12)), "2026-01-02");
    assert.equal(M.isoDate("2026-03-15T10:00:00Z"), "2026-03-15");
    for (const v of [null, undefined, "", "pas une date"]) assert.equal(M.isoDate(v), null);
  });
});

describe("normInstrument", () => {
  const CAHIER = ["id", "symbol", "name", "isin", "asset_class", "sub_asset_class", "exchange", "currency", "country", "sector", "region",
    "pea_eligible", "pea_eligibility_status", "pea_last_checked_at", "data_source", "is_active"];
  test("contient tous les champs du cahier des charges, même pour une entrée vide", () => {
    for (const raw of [{}, null, undefined, { name: "x" }]) {
      const i = M.normInstrument(raw);
      for (const k of CAHIER) assert.ok(Object.prototype.hasOwnProperty.call(i, k), k);
      for (const k of ["vehicle", "is_investable", "tickers", "leverage", "risk_level", "ter", "pea_pme_status", "alt_group", "siic", "preferred"]) assert.ok(k in i, k);
    }
  });
  test("valeurs par défaut", () => {
    const i = M.normInstrument({});
    assert.equal(i.asset_class, "actions");
    assert.equal(i.vehicle, "titre");
    assert.equal(i.isin, null);
    assert.equal(i.pea_eligibility_status, "unknown");
    assert.equal(i.pea_eligible, null);
    assert.equal(i.pea_pme_status, "unknown");
    assert.equal(i.leverage, 1);
    assert.equal(i.is_active, true);
    assert.equal(i.is_investable, true);
    assert.equal(i.siic, false);
    assert.equal(i.preferred, false);
    assert.equal(i.data_source, "tvscan");
    assert.equal(i.region, null);
    assert.deepEqual(plain(i.tickers), {});
  });
  test("instrument complet (ETF CW8)", () => {
    const i = M.normInstrument({
      id: "isin:LU1681043599", symbol: "cw8", name: "Amundi MSCI World", isin: "lu1681043599", asset_class: "actions", sub_asset_class: "monde",
      vehicle: "etf", exchange: "euronext", currency: "eur", country: "lu", sector: "diversifie", region: "monde",
      pea_eligibility_status: "eligible", pea_source: "DIC", pea_last_checked_at: "2026-10-01", ter: "0,38", risk_level: "4",
      tickers: { tv: "EURONEXT:CW8", yahoo: "CW8.PA", inconnu: "x" }, alt_group: "msci_world"
    });
    assert.equal(i.symbol, "CW8");
    assert.equal(i.isin, "LU1681043599");
    assert.equal(i.exchange, "EURONEXT");
    assert.equal(i.currency, "EUR");
    assert.equal(i.country, "LU");
    assert.equal(i.region, "monde");
    assert.equal(i.pea_eligible, true);
    assert.equal(i.pea_last_checked_at, "2026-10-01");
    assert.equal(i.ter, 0.38);
    assert.equal(i.risk_level, 4);
    assert.deepEqual(plain(i.tickers), { tv: "EURONEXT:CW8", yahoo: "CW8.PA" });
    assert.equal(M.validateInstrument(i).ok, true);
  });
  test("identifiant déduit : ISIN, puis ticker TradingView, puis symbole", () => {
    assert.equal(M.normInstrument({ isin: "FR0011871128" }).id, "isin:FR0011871128");
    assert.equal(M.normInstrument({ tickers: { tv: "TVC:GOLD" } }).id, "tv:TVC:GOLD");
    assert.equal(M.normInstrument({ symbol: "abc" }).id, "x:abc");
  });
  test("bornes et listes fermées", () => {
    assert.equal(M.normInstrument({ isin: "PASUNISIN" }).isin, null);
    assert.equal(M.normInstrument({ region: "lune" }).region, null);
    assert.equal(M.normInstrument({ vehicle: "fusee" }).vehicle, "titre");
    assert.equal(M.normInstrument({ pea_eligibility_status: "peut-etre" }).pea_eligibility_status, "unknown");
    assert.equal(M.normInstrument({ pea_eligibility_status: "not_eligible" }).pea_eligible, false);
    assert.equal(M.normInstrument({ pea_eligibility_status: "eligible_regle" }).pea_eligible, true);
    for (const [v, want] of [[0, null], [8, null], [1, 1], [7, 7], ["3,6", 4], [-2, null], ["x", null]]) assert.equal(M.normInstrument({ risk_level: v }).risk_level, want, String(v));
    assert.equal(M.normInstrument({ leverage: -1 }).leverage, -1);
    assert.equal(M.normInstrument({ leverage: "x" }).leverage, 1);
    assert.equal(M.normInstrument({ symbol: "x".repeat(50) }).symbol.length, 20);
    assert.equal(M.normInstrument({ currency: "usdollar" }).currency, "USDO");
    assert.equal(M.normInstrument({ is_active: "non" }).is_active, true, "seul false désactive");
    assert.equal(M.normInstrument({ is_active: false }).is_active, false);
    assert.equal(M.normInstrument({ siic: "true" }).siic, false, "seul true compte");
  });
  test("crypto : source par défaut « crypto »", () => {
    assert.equal(M.normInstrument({ asset_class: "crypto" }).data_source, "crypto");
    assert.equal(M.normInstrument({ asset_class: "stablecoin" }).data_source, "crypto");
  });
  test("clés inconnues ignorées", () => {
    const i = M.normInstrument({ name: "a", pirate: 1, html: "<b>" });
    assert.equal("pirate" in i, false);
    assert.equal("html" in i, false);
  });
  test("validateInstrument signale les erreurs", () => {
    const v = M.validateInstrument(M.normInstrument({ id: "a", vehicle: "etf" }));
    assert.equal(v.ok, false);
    assert.ok(v.errors.includes("nom manquant"));
    assert.ok(v.errors.includes("aucun ticker pour obtenir un cours"));
    assert.equal(M.validateInstrument(M.normInstrument({ id: "b", name: "Indice", vehicle: "indice" })).ok, true, "un indice n'a pas besoin de ticker");
    assert.ok(M.validateInstrument({ id: "c", name: "x", isin: "LU1681043598", asset_class: "actions", vehicle: "etf", tickers: { tv: "a" } }).errors[0].startsWith("ISIN invalide"));
  });
});

describe("normBar", () => {
  const KEYS = ["instrument_id", "timestamp", "open", "high", "low", "close", "volume", "currency", "source", "granularity"];
  test("champs exacts du cahier des charges", () => {
    const b = M.normBar({ t: 1, o: 10, h: 12, l: 9, c: 11, v: 100 }, "isin:X", "EUR", "robot", "1d");
    assert.deepEqual(Object.keys(b).sort(), [...KEYS].sort());
    assert.deepEqual(plain(b), { instrument_id: "isin:X", timestamp: 1, open: 10, high: 12, low: 9, close: 11, volume: 100, currency: "EUR", source: "robot", granularity: "1d" });
  });
  test("noms longs acceptés", () => {
    const b = M.normBar({ instrument_id: "a", timestamp: 5, open: 1, high: 2, low: 0.5, close: 1.5, volume: "1 000", currency: "USD", source: "s", granularity: "1w" });
    assert.equal(b.instrument_id, "a"); assert.equal(b.volume, 1000); assert.equal(b.granularity, "1w"); assert.equal(b.currency, "USD");
  });
  test("barre rejetée sans horodatage ou sans clôture positive", () => {
    assert.equal(M.normBar({ c: 10 }), null);
    assert.equal(M.normBar({ t: 1 }), null);
    assert.equal(M.normBar({ t: 1, c: 0 }), null);
    assert.equal(M.normBar({ t: 1, c: -5 }), null);
    assert.equal(M.normBar({ t: 1, c: "NaN" }), null);
    assert.equal(M.normBar(null), null);
  });
  test("OHLC incohérents réparés : low ≤ open,close ≤ high", () => {
    const b = M.normBar({ t: 1, o: 10, h: 8, l: 12, c: 11 });
    assert.equal(b.high, 11); assert.equal(b.low, 10);
    const b2 = M.normBar({ t: 1, c: 5 });
    assert.equal(b2.open, 5); assert.equal(b2.high, 5); assert.equal(b2.low, 5);
    assert.equal(b2.volume, null);
    assert.equal(b2.granularity, "1d");
    assert.equal(b2.source, "");
  });
  test("propriété : pour 300 barres aléatoires, low ≤ min(open,close) et high ≥ max(open,close)", () => {
    const r = rng(42), v = () => (r() < 0.15 ? null : r() < 0.1 ? -1 : r() * 100);
    for (let n = 0; n < 300; n++) {
      const b = M.normBar({ t: n + 1, o: v(), h: v(), l: v(), c: 1 + r() * 100 });
      assert.ok(b.low <= Math.min(b.open, b.close) && b.high >= Math.max(b.open, b.close) && b.low > 0, JSON.stringify(b));
    }
  });
  test("granularité inconnue → 1d", () => assert.equal(M.normBar({ t: 1, c: 1 }, "a", "EUR", "s", "5m").granularity, "1d"));
});

describe("normQuote", () => {
  test("champs, valeurs par défaut et marquage src « scan »", () => {
    const q = M.normQuote({});
    assert.deepEqual(Object.keys(q).sort(), ["change_pct", "currency", "delay_s", "high", "instrument_id", "last", "low", "open", "perf", "prev_close", "source", "src", "stale", "ts", "value_traded", "volume"]);
    assert.deepEqual(plain(q.perf), { w: null, m1: null, m3: null, m6: null, y1: null, ytd: null });
    assert.equal(q.ts, 0); assert.equal(q.stale, false); assert.equal(q.src, "scan"); assert.equal(q.last, null); assert.equal(q.currency, null);
  });
  test("conversion des valeurs", () => {
    const q = M.normQuote({ instrument_id: "a", last: "101,5", change_pct: "1.2", currency: "usd", ts: 1000, delay_s: 900, source: "<b>TradingView</b>", stale: true, perf: { ytd: "3,5", w: Infinity } });
    assert.equal(q.last, 101.5); assert.equal(q.change_pct, 1.2); assert.equal(q.currency, "USD"); assert.equal(q.source, "TradingView");
    assert.equal(q.stale, true); assert.equal(q.perf.ytd, 3.5); assert.equal(q.perf.w, null); assert.equal(q.delay_s, 900);
    assert.equal(M.normQuote({ stale: "oui" }).stale, false);
    assert.equal(M.normQuote(null).src, "scan");
  });
});

describe("normAccount", () => {
  const CAHIER = ["id", "name", "account_type", "currency", "cash_balance", "total_value_eur", "broker", "is_active"];
  test("champs du cahier des charges et valeurs par défaut", () => {
    const a = M.normAccount({});
    for (const k of CAHIER) assert.ok(k in a, k);
    assert.deepEqual(plain(a), { id: null, name: "Compte", account_type: "other", currency: "EUR", cash_balance: 0, total_value_eur: null, broker: null,
      is_active: true, opened_at: null, deposits_total: null, manual_universe: [] });
  });
  test("types de comptes", () => {
    for (const t of ["PEA", "PEA_PME", "CTO", "assurance_vie", "crypto_wallet", "bank_account", "other"]) assert.equal(M.normAccount({ account_type: t }).account_type, t);
    assert.equal(M.normAccount({ account_type: "pea" }).account_type, "other");
  });
  test("conversion et bornes", () => {
    const a = M.normAccount({ id: "pea1", name: "Mon <b>PEA</b>", account_type: "PEA", currency: "eur", cash_balance: "1 234,50", broker: "Boursorama", is_active: false,
      opened_at: "2020-05-04", deposits_total: "50000", manual_universe: ["isin:A", "", null, "<i>isin:B</i>", ...Array(300).fill("z")] });
    assert.equal(a.name, "Mon PEA"); assert.equal(a.cash_balance, 1234.5); assert.equal(a.is_active, false); assert.equal(a.opened_at, "2020-05-04");
    assert.equal(a.deposits_total, 50000);
    assert.deepEqual(plain(a.manual_universe.slice(0, 2)), ["isin:A", "isin:B"]);
    assert.ok(a.manual_universe.length <= 200);
    assert.equal(M.normAccount({ name: "x".repeat(500) }).name.length, 60);
  });
});

describe("normPosition", () => {
  const CAHIER = ["account_id", "instrument_id", "quantity", "average_purchase_price", "current_price", "market_value_eur", "unrealized_pnl", "realized_pnl",
    "asset_class", "currency", "account_type", "updated_at"];
  test("champs du cahier des charges et valeurs par défaut", () => {
    const p = M.normPosition({});
    for (const k of CAHIER) assert.ok(k in p, k);
    assert.equal(p.quantity, 0); assert.equal(p.price_source, "marche"); assert.equal(p.asset_class, null); assert.equal(p.account_type, null);
    for (const k of ["average_purchase_price", "current_price", "market_value_eur", "unrealized_pnl", "realized_pnl", "updated_at", "currency"]) assert.equal(p[k], null, k);
  });
  test("conversion et listes fermées", () => {
    const p = M.normPosition({ account_id: "pea1", instrument_id: "isin:X", quantity: "10,5", average_purchase_price: "100.25", asset_class: "or", account_type: "PEA",
      currency: "eur", updated_at: "2026-11-01", price_source: "manuel", manual_price: "12" });
    assert.equal(p.quantity, 10.5); assert.equal(p.average_purchase_price, 100.25); assert.equal(p.asset_class, "or"); assert.equal(p.account_type, "PEA");
    assert.equal(p.currency, "EUR"); assert.equal(p.updated_at, "2026-11-01"); assert.equal(p.price_source, "manuel"); assert.equal(p.manual_price, 12);
    assert.equal(M.normPosition({ asset_class: "toString" }).asset_class, null);
    assert.equal(M.normPosition({ account_type: "LIVRET" }).account_type, null);
    assert.equal(M.normPosition({ price_source: "autre" }).price_source, "marche");
    assert.equal(M.normPosition({ quantity: "0.125" }).quantity, 0.125, "quantité crypto en notation anglaise");
  });
});

describe("normTransaction", () => {
  test("valeurs par défaut et types", () => {
    assert.deepEqual(plain(M.normTransaction({})), { id: null, account_id: null, instrument_id: null, date: null, type: "achat", quantity: 0, price: null, fees: 0, currency: "EUR", fx_rate: null });
    for (const t of M.TX_TYPES) assert.equal(M.normTransaction({ type: t }).type, t);
    assert.equal(M.normTransaction({ type: "vol" }).type, "achat");
    const t = M.normTransaction({ id: "t1", date: "2026-01-05", type: "dividende", quantity: "3", price: "1,25", fees: "0,5", currency: "usd", fx_rate: "0.91" });
    assert.equal(t.price, 1.25); assert.equal(t.fees, 0.5); assert.equal(t.currency, "USD"); assert.equal(t.fx_rate, 0.91); assert.equal(t.date, "2026-01-05");
  });
});

describe("normPrefs", () => {
  test("entrée vide → préférences par défaut (rien de coché, non enregistrées)", () => {
    for (const raw of [undefined, null, 5, "x", []]) assert.deepEqual(plain(M.normPrefs(raw)), plain(M.defaultPrefs()), String(raw));
  });
  test("cases : seule la valeur true coche ; classes et véhicules inconnus ignorés", () => {
    const p = M.normPrefs({ saved: true, classes: { actions: true, or: 1, inconnue: true }, vehicles: { etf: true, indice: true, fusee: true } });
    assert.equal(p.saved, true);
    assert.equal(p.classes.actions, true); assert.equal(p.classes.or, false); assert.equal("inconnue" in p.classes, false);
    assert.equal(p.vehicles.etf, true); assert.equal("indice" in p.vehicles, false); assert.equal("fusee" in p.vehicles, false);
    assert.equal(M.normPrefs({ saved: "true" }).saved, false);
  });
  test("bornes des limites", () => {
    const p = M.normPrefs({ limits: { max_par_instrument: 0, max_crypto: 150, min_liquidites: -5, max_turnover_mensuel: "30", bande_inaction_pp: 50,
      risque_max_sri: 9, levier_autorise: "oui", max_par_classe: { actions: 120, or: "15,5", inconnue: 5 } } });
    assert.equal(p.limits.max_par_instrument, 1); assert.equal(p.limits.max_crypto, 100); assert.equal(p.limits.min_liquidites, 0);
    assert.equal(p.limits.max_turnover_mensuel, 30); assert.equal(p.limits.bande_inaction_pp, 20); assert.equal(p.limits.risque_max_sri, null);
    assert.equal(p.limits.levier_autorise, false);
    assert.deepEqual(plain(p.limits.max_par_classe), { actions: 100, or: 15.5 });
    assert.equal(M.normPrefs({ limits: { risque_max_sri: "5" } }).limits.risque_max_sri, 5);
  });
  test("énumérations, apport mensuel, filtres, fiscalité", () => {
    const p = M.normPrefs({ pea_mode: "strict", pea_filter: "eligibles", risk_profile: "agressif", horizon: "court", monthly_contribution_eur: "-200",
      filters: { regions: ["europe", "lune"], devises: ["EUR", "eur", "USDT"], secteurs: ["Tech", 5, "x".repeat(80)] }, fiscal: { pfu_par_defaut: false, tmi: 60 },
      contribution_split: { "<b>pea1</b>": 70, cto: 200 } });
    assert.equal(p.pea_mode, "strict"); assert.equal(p.pea_filter, "eligibles"); assert.equal(p.risk_profile, "agressif"); assert.equal(p.horizon, "court");
    assert.equal(p.monthly_contribution_eur, 0);
    assert.deepEqual(plain(p.filters), { regions: ["europe"], devises: ["EUR"], secteurs: ["Tech"] });
    assert.deepEqual(plain(p.fiscal), { pfu_par_defaut: false, tmi: 45 });
    assert.deepEqual(plain(p.contribution_split), { pea1: 70, cto: 100 });
    const d = M.normPrefs({ pea_mode: "x", risk_profile: "x", horizon: "x" });
    assert.equal(d.pea_mode, "off"); assert.equal(d.risk_profile, "modere"); assert.equal(d.horizon, "long");
  });
  test("idempotent : normPrefs(normPrefs(x)) = normPrefs(x)", () => {
    const r = rng(3);
    for (let n = 0; n < 50; n++) {
      const raw = { saved: r() < 0.5, classes: Object.fromEntries(CLS.map((c) => [c, r() < 0.5])), vehicles: Object.fromEntries(INVEST_VH.map((v) => [v, r() < 0.5])),
        limits: { max_crypto: r() * 200 - 50, risque_max_sri: Math.floor(r() * 9) } };
      const a = M.normPrefs(raw);
      assert.deepEqual(plain(M.normPrefs(plain(a))), plain(a));
    }
  });
});

describe("CK.ref", () => {
  const LIST = [
    { id: "isin:LU1681043599", symbol: "CW8", name: "Amundi MSCI World", isin: "LU1681043599", asset_class: "actions", vehicle: "etf", region: "monde", currency: "EUR", tickers: { tv: "EURONEXT:CW8" } },
    { id: "isin:FR0000120271", symbol: "TTE", name: "TotalÉnergies", isin: "FR0000120271", asset_class: "actions", vehicle: "titre", region: "france", currency: "EUR", tickers: { tv: "EURONEXT:TTE" } },
    { id: "tv:TVC:UKOIL", symbol: "BRENT", name: "Pétrole Brent", asset_class: "petrole", vehicle: "indice", tickers: { tv: "TVC:UKOIL" } },
    { id: "isin:IE00B4L5Y983", symbol: "IWDA", name: "iShares Core MSCI World", isin: "IE00B4L5Y983", asset_class: "actions", vehicle: "etf", region: "monde", currency: "USD", tickers: { tv: "AMS:IWDA" } },
    { id: "isin:LU1681043599", symbol: "DOUBLON", name: "Doublon ignoré", asset_class: "actions", vehicle: "etf" },
    { id: "crypto:BTC", symbol: "BTC", name: "Bitcoin", asset_class: "crypto", vehicle: "spot_crypto", tickers: { okx: "BTC-USDT" } }
  ];
  const C = fresh();
  test("avant chargement : référentiel vide (marqueur non remplacé)", () => {
    assert.deepEqual(plain(C.ref.all()), []);
    assert.equal(C.ref.get("x"), null);
  });
  test("load : normalise et ignore les doublons d'identifiant (le premier gagne)", () => {
    const all = C.ref.load(LIST);
    assert.equal(all.length, 5);
    assert.equal(C.ref.get("isin:LU1681043599").symbol, "CW8");
    assert.equal(C.ref.all().length, 5);
    assert.equal(C.ref.load("pas une liste").length, 0);
    C.ref.load(LIST);
  });
  test("get, byIsin (insensible à la casse), byTv", () => {
    assert.equal(C.ref.get("crypto:BTC").name, "Bitcoin");
    assert.equal(C.ref.get("absent"), null);
    assert.equal(C.ref.byIsin("ie00b4l5y983").symbol, "IWDA");
    assert.equal(C.ref.byIsin(null), null);
    assert.equal(C.ref.byTv("EURONEXT:TTE").symbol, "TTE");
    assert.equal(C.ref.byTv("INCONNU"), null);
    for (const k of ["toString", "constructor", "__proto__", "valueOf"]) assert.equal(C.ref.get(k), null, k);
  });
  test("un identifiant « toString » ou « constructor » est un instrument comme un autre", () => {
    C.ref.load([{ id: "constructor", name: "A" }, { id: "toString", name: "B" }]);
    assert.equal(C.ref.all().length, 2);
    assert.equal(C.ref.get("toString").name, "B");
    C.ref.load(LIST);
  });
  test("search : texte sans accents ni casse (nom, symbole, ISIN)", () => {
    const ids = (r) => [...r].map((i) => i.id).sort();
    assert.deepEqual(ids(C.ref.search("energies")), ["isin:FR0000120271"]);
    assert.deepEqual(ids(C.ref.search("PÉTROLE")), ["tv:TVC:UKOIL"]);
    assert.deepEqual(ids(C.ref.search("msci world")), ["isin:IE00B4L5Y983", "isin:LU1681043599"]);
    assert.deepEqual(ids(C.ref.search("iwda")), ["isin:IE00B4L5Y983"]);
    assert.deepEqual(ids(C.ref.search("lu16810")), ["isin:LU1681043599"]);
    assert.equal(C.ref.search("").length, 5);
    assert.equal(C.ref.search(null).length, 5);
    assert.equal(C.ref.search("zzz").length, 0);
  });
  test("search : filtres (classe avec enfants, véhicule, région, devise, investissable)", () => {
    const ids = (r) => [...r].map((i) => i.id).sort();
    assert.deepEqual(ids(C.ref.search("", { asset_class: "matieres_premieres" })), ["tv:TVC:UKOIL"], "un enfant est trouvé par sa classe parente");
    assert.deepEqual(ids(C.ref.search("", { asset_class: "energie" })), ["tv:TVC:UKOIL"]);
    assert.deepEqual(ids(C.ref.search("", { asset_class: "or" })), []);
    assert.deepEqual(ids(C.ref.search("", { vehicle: "etf" })), ["isin:IE00B4L5Y983", "isin:LU1681043599"]);
    assert.deepEqual(ids(C.ref.search("", { region: "france" })), ["isin:FR0000120271"]);
    assert.deepEqual(ids(C.ref.search("world", { currency: "USD" })), ["isin:IE00B4L5Y983"]);
    assert.deepEqual(ids(C.ref.search("", { investable: false })), ["tv:TVC:UKOIL"]);
    assert.equal(C.ref.search("", { investable: true }).length, 4);
    assert.deepEqual(ids(C.ref.search("msci", { vehicle: "etf", region: "monde", currency: "EUR" })), ["isin:LU1681043599"]);
  });
  test("setData('referentiel') recharge le référentiel", () => {
    const D = fresh();
    D.models.setData("referentiel", { version: 1, instruments: LIST.slice(0, 2) });
    assert.equal(D.ref.all().length, 2);
    assert.equal(D.ref.byTv("EURONEXT:CW8").id, "isin:LU1681043599");
    D.models.setData("referentiel", { version: 1, instruments: LIST.slice(0, 1) });
    assert.equal(D.ref.all().length, 1);
  });
});

describe("avertissement légal", () => {
  const PHRASE = "Les informations affichées ne constituent pas un conseil en investissement personnalisé. Les performances passées ne préjugent pas des performances futures.";
  test("CK.DISCLAIMER est exactement la phrase imposée", () => {
    assert.equal(CK.DISCLAIMER, PHRASE);
    assert.equal(M.DISCLAIMER, PHRASE);
  });
});

describe("chargement", () => {
  test("aucune minuterie ni accès réseau au chargement", () => {
    const k = makeContext();
    k.load("models.js");
    assert.equal(k.timers.length, 0);
  });
  test("CK.DATA conserve les marqueurs tant que build.mjs ne les a pas remplacés", () => {
    const k = fresh();
    assert.equal(k.models.data("referentiel"), null);
    assert.equal(k.models.data("allocation"), null);
  });
  test("data() et setData() ignorent les clés du prototype", () => {
    const k = fresh();
    for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty"]) assert.equal(k.models.data(key), null, key);
    k.models.setData("__proto__", { referentiel: { instruments: [{ id: "piege", name: "x" }] } });
    assert.equal(k.ref.all().length, 0, "setData('__proto__') ne change pas le prototype de CK.DATA");
    assert.equal(k.models.data("referentiel"), null);
  });
});

/* ---------- Cas limites ajoutés à la relecture (chacun échouait sur la version précédente de models.js) ---------- */
const MINUS = String.fromCharCode(0x2212);
describe("relecture : num() et isoDate()", () => {
  test("num : seuls les nombres et les chaînes sont lus (un tableau [1,2] ne devient pas 1,2)", () => {
    for (const v of [[1, 2], ["5"], [5], { toString: () => "5" }, JSON.parse('{"toString":1}'), Object.create(null), new Date(0), () => 5])
      assert.equal(M.num(v), null, Object.prototype.toString.call(v));
  });
  test("num : signe moins typographique", () => {
    assert.equal(M.num(MINUS + "12,5"), -12.5);
    assert.equal(M.num(MINUS + "1 234,5"), -1234.5);
    assert.equal(M.num("1" + MINUS + "2"), null);
  });
  test("isoDate : format français JJ/MM/AAAA, jamais lu à l'américaine", () => {
    assert.equal(M.isoDate("01/03/2026"), "2026-03-01");
    assert.equal(M.isoDate("1/3/2026"), "2026-03-01");
    assert.equal(M.isoDate("15/03/2026"), "2026-03-15");
    assert.equal(M.isoDate("31.12.2026"), "2026-12-31");
    assert.equal(M.isoDate("31/02/2026"), null);
  });
  test("isoDate : jour inexistant refusé (pas de report au mois suivant)", () => {
    for (const v of ["2026-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "2026-00-10", "2026-01-00", "2026-03-15abc"]) assert.equal(M.isoDate(v), null, v);
    assert.equal(M.isoDate("2024-02-29"), "2024-02-29");
    assert.equal(M.isoDate("2000-02-29"), "2000-02-29");
    assert.equal(M.isoDate("1900-02-29"), null);
  });
  test("isoDate : une date AAAA-MM-JJ garde son jour, même avec une heure et un décalage", () => {
    assert.equal(M.isoDate("2026-03-15T00:30:00+02:00"), "2026-03-15");
    assert.equal(M.isoDate("2026-03-15T23:59:59-05:00"), "2026-03-15");
    assert.equal(M.isoDate("2026-03-15 10:00"), "2026-03-15");
    assert.equal(M.isoDate("  2026-03-15  "), "2026-03-15");
  });
  test("isoDate : texte libre lu sans recul d'un jour, fuseau explicite respecté", () => {
    assert.equal(M.isoDate("March 15, 2026"), "2026-03-15");
    assert.equal(M.isoDate("Sun, 15 Mar 2026 23:30:00 GMT"), "2026-03-15");
  });
  test("isoDate : objets Date, nombres non finis et valeurs piégées", () => {
    assert.equal(M.isoDate(new Date(Date.UTC(2026, 5, 1, 12))), "2026-06-01");
    for (const v of [NaN, Infinity, 8.64e15 + 1, new Date("x"), [2026], {}, JSON.parse('{"toString":1}'), true]) assert.equal(M.isoDate(v), null, Object.prototype.toString.call(v));
  });
});

describe("relecture : normaliseurs", () => {
  test("ISIN : jamais tronqué, espaces retirés", () => {
    assert.equal(M.normInstrument({ isin: "FR00001202711" }).isin, null, "13 caractères : pas un ISIN");
    assert.equal(M.normInstrument({ isin: "fr0000120271 " }).isin, "FR0000120271");
    assert.equal(M.normInstrument({ isin: "FR 0000 1202 71" }).isin, "FR0000120271");
  });
  test("pays et MIC : code exact ou null (pas de troncature trompeuse)", () => {
    assert.equal(M.normInstrument({ country: "Allemagne" }).country, null);
    assert.equal(M.normInstrument({ domicile: "Irlande" }).domicile, null);
    assert.equal(M.normInstrument({ country: "fr", domicile: " ie " }).country, "FR");
    assert.equal(M.normInstrument({ domicile: " ie " }).domicile, "IE");
    assert.equal(M.normInstrument({ mic: "xpar" }).mic, "XPAR");
    assert.equal(M.normInstrument({ mic: "XPARIS" }).mic, null);
  });
  test("classe donnée sous forme de tableau ou d'objet → jamais acceptée telle quelle", () => {
    for (const v of [["or"], { toString: () => "or" }]) {
      assert.equal(M.normInstrument({ asset_class: v }).asset_class, "actions");
      assert.equal(M.normPosition({ asset_class: v }).asset_class, null);
      assert.equal(M.isClassAllowed(v, { or: true, matieres_premieres: true }), false);
      assert.deepEqual(plain(M.classAncestors(v)), []);
    }
  });
  test("normBar et normQuote nettoient les champs texte bruts", () => {
    const b = M.normBar({ t: 1, c: 2, instrument_id: "<b>isin:X</b>", currency: "usd<i>", source: "<img src=x onerror=alert(1)>robot" });
    assert.equal(b.instrument_id, "isin:X"); assert.equal(b.currency, "USD"); assert.equal(b.source, "robot");
    assert.equal(M.normQuote({ instrument_id: "<svg onload=alert(1)>a" }).instrument_id, "a");
    assert.equal(M.normQuote({ instrument_id: { x: 1 } }).instrument_id, null);
  });
  test("cleanText : comparaisons conservées, objets refusés, emoji jamais coupé en deux", () => {
    assert.equal(M.cleanText("rendement <3 % et >2 %"), "rendement <3 % et >2 %");
    assert.equal(M.cleanText("a<b>c"), "a c");
    for (const v of [{}, [], ["a"], JSON.parse('{"toString":1}'), Object.create(null), () => "x"]) assert.equal(M.cleanText(v), "", Object.prototype.toString.call(v));
    assert.equal(M.cleanText(true), "true");
    const smile = String.fromCodePoint(0x1F600);
    assert.equal(M.cleanText("ab" + smile, 3), "ab");
    assert.equal(M.cleanText("ab" + smile, 4), "ab" + smile);
    for (const cp of [0x200E, 0x200F, 0x061C, 0x200B]) assert.equal(M.cleanText("a" + String.fromCharCode(cp) + "b"), "a b", cp.toString(16));
  });
  test("normPrefs : répartition et devises de forme inattendue", () => {
    assert.deepEqual(plain(M.normPrefs({ contribution_split: "abc" }).contribution_split), {});
    assert.deepEqual(plain(M.normPrefs({ contribution_split: [10, 20] }).contribution_split), {});
    const many = Object.fromEntries(Array.from({ length: 500 }, (_, n) => ["c" + n, 1]));
    assert.equal(Object.keys(M.normPrefs({ contribution_split: many }).contribution_split).length, 50);
    assert.deepEqual(plain(M.normPrefs({ filters: { devises: [["EUR"], "USD"] } }).filters.devises), ["USD"]);
  });
  test("validateInstrument ne plante jamais", () => {
    for (const v of [null, undefined, 5, "x"]) assert.deepEqual(plain(M.validateInstrument(v)), { ok: false, errors: ["instrument absent"] });
    const v = M.validateInstrument({ id: "a", name: "b", asset_class: "actions", vehicle: "etf", is_investable: true });
    assert.deepEqual(plain(v.errors), ["aucun ticker pour obtenir un cours"]);
    assert.ok(M.validateInstrument({ id: "a", name: "b", asset_class: ["actions"], vehicle: ["etf"] }).errors.includes("classe inconnue"));
  });
});

describe("relecture : CK.allow sur des objets non normalisés", () => {
  const all = { classes: Object.fromEntries(CLS.map((c) => [c, true])), vehicles: Object.fromEntries(ALL_VH.map((v) => [v, true]).concat([["fusee", true]])), limits: {} };
  const raw = (o) => ({ asset_class: "actions", vehicle: "etf", is_investable: true, is_active: true, leverage: 1, ...o });
  test("indice ou taux marqué investissable par erreur : toujours refusé", () => {
    for (const vehicle of ["indice", "taux"]) {
      assert.equal(CK.allow(raw({ vehicle }), all), false, vehicle);
      assert.equal(CK.allow.why(raw({ vehicle }), all), "Non investissable (indice ou taux).");
    }
  });
  test("véhicule inconnu ou d'un autre type que texte : refusé", () => {
    assert.equal(CK.allow.why(raw({ vehicle: "fusee" }), all), "Type de produit inconnu.");
    assert.equal(CK.allow(raw({ vehicle: ["etf"] }), all), false);
    assert.equal(CK.allow(raw({ vehicle: "toString" }), { ...all, vehicles: { ...all.vehicles, toString: true } }), false);
  });
  test("seule la valeur true rend investissable ou autorise le levier", () => {
    assert.equal(CK.allow(raw({ is_investable: "oui" }), all), false);
    assert.equal(CK.allow(raw({ is_investable: 1 }), all), false);
    assert.equal(CK.allow(raw({ leverage: 2 }), { ...all, limits: { levier_autorise: "oui" } }), false);
    assert.equal(CK.allow(raw({ leverage: 2 }), { ...all, limits: { levier_autorise: true } }), true);
  });
  test("SRI comparé en nombres, même écrit en texte", () => {
    const p = { ...all, limits: { risque_max_sri: "4" } };
    assert.equal(CK.allow(raw({ risk_level: "5" }), p), false);
    assert.equal(CK.allow(raw({ risk_level: "10" }), p), false, "« 10 » > « 4 » en nombres");
    assert.equal(CK.allow.why(raw({ risk_level: "6" }), p), "Niveau de risque 6/7 au-dessus de ton maximum (4/7).");
    assert.equal(CK.allow(raw({ risk_level: "4" }), p), true);
  });
});

describe("relecture : CK.ref", () => {
  test("un ISIN partagé (deux cotations) ne fait pas disparaître l'instrument dont c'est l'identifiant", () => {
    const C = fresh();
    C.ref.load([
      { id: "tv:LSE:SWDA", symbol: "SWDA", name: "iShares MSCI World (Londres)", isin: "IE00B4L5Y983", vehicle: "etf", tickers: { tv: "LSE:SWDA" } },
      { id: "isin:IE00B4L5Y983", symbol: "IWDA", name: "iShares MSCI World (Amsterdam)", isin: "IE00B4L5Y983", vehicle: "etf", tickers: { tv: "AMS:IWDA" } }
    ]);
    assert.equal(C.ref.all().length, 2);
    assert.equal(C.ref.get("isin:IE00B4L5Y983").symbol, "IWDA", "l'identifiant réel gagne sur l'alias");
    assert.equal(C.ref.byIsin("IE00B4L5Y983").symbol, "IWDA");
    assert.equal(C.ref.byTv("LSE:SWDA").symbol, "SWDA");
    assert.equal(C.ref.get("tv:AMS:IWDA").symbol, "IWDA", "alias tv: toujours trouvé");
    assert.equal(C.ref.byIsin(" ie00b4l5y983 ").symbol, "IWDA");
  });
  test("arguments d'un autre type que texte → null, sans exception", () => {
    const C = fresh();
    C.ref.load([{ id: "a", name: "A", isin: "FR0000120271" }]);
    for (const v of [["a"], { toString: () => "a" }, JSON.parse('{"toString":1}'), 5, undefined]) {
      assert.equal(C.ref.get(v), null); assert.equal(C.ref.byIsin(v), null); assert.equal(C.ref.byTv(v), null);
    }
  });
});
