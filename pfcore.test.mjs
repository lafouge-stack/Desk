// Portefeuille (phase 4) : pfcore.js chargé avec les VRAIS models, fx et pea.
// Vérifie le stockage (navigateur seulement, clés dangereuses refusées), le rejeu des opérations (PRU, réalisé, espèces),
// la valorisation en euros et le partage exact plus-value prix / change, l'import CSV des courtiers français
// (« ; », virgule décimale, Windows-1252), les contrôles d'enveloppe (PEA strict, plafonds) et les calculs de risque.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeContext } from "./vmkit.mjs";

const rd = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const REF = JSON.parse(rd("./referentiel.json"));
const FISCAL = JSON.parse(rd("./fiscal.json"));
const near = (a, b, eps = 1e-6, m = "") => assert.ok(a != null && Math.abs(a - b) < eps, `${m} ${a} ≠ ${b}`);
const T0 = Date.parse("2026-11-17T10:00:00Z");

function setup() {
  const { CK, load } = makeContext();
  CK.cfg = () => ({ data: "" });
  for (const f of ["models.js", "datakit.js", "fx.js", "pea.js", "indicators.js", "pfcore.js"]) load(f);
  CK.models.setData("referentiel", REF);
  CK.models.setData("fiscal", FISCAL);
  CK.dk.env = Object.assign({}, CK.dk.env, { now: () => T0 });
  // USD : 0,90 € aujourd'hui, 0,95 € au 2026-01-05
  CK.fx.setDaily("USD", [["2026-01-05", 0.95], ["2026-11-16", 0.9]]);
  return { CK, F: CK.pfc };
}
const acc = (F, o) => F.normAcc(Object.assign({ id: "a1", name: "Mon PEA", account_type: "PEA" }, o));

describe("stockage", () => {
  test("enregistré dans ce navigateur seulement (clé pf), relu à l'identique", () => {
    const { CK, F } = setup();
    const P = F.empty(); P.accounts.push(acc(F));
    P.holdings.push(F.normHold({ account_id: "a1", instrument_id: "isin:LU1681043599", quantity: "10,5", average_purchase_price: "480,25" }));
    assert.equal(F.save(P), true);
    assert.ok(CK._ls.pf, "stocké sous CK.lsj('pf')");
    const Q = F.load();
    assert.equal(Q.accounts[0].name, "Mon PEA");
    assert.equal(Q.holdings[0].quantity, 10.5);
    assert.equal(Q.holdings[0].average_purchase_price, 480.25);
  });
  test("une sauvegarde avec __proto__ ou constructor est refusée ; un autre format aussi", () => {
    const { F } = setup();
    assert.equal(F.importJSON('{"format":"desk-portefeuille","accounts":[{"__proto__":{"x":1}}]}').ok, false);
    assert.equal(F.importJSON('{"accounts":[]}').ok, false);
    assert.equal(F.importJSON("pas du json").ok, false);
  });
  test("export puis import : même portefeuille ; les lignes d'un compte inconnu sont retirées ; textes nettoyés", () => {
    const { F } = setup();
    const P = F.demo();
    P.holdings.push(F.normHold({ account_id: "fantome", instrument_id: "isin:X", quantity: 1 }));
    P.accounts[0].name = "<img src=x onerror=alert(1)>PEA";
    const r = F.importJSON(F.exportJSON(F.norm(JSON.parse(JSON.stringify(P)))));
    assert.equal(r.ok, true);
    assert.equal(r.P.accounts.length, 4);
    assert.ok(!r.P.holdings.some((h) => h.account_id === "fantome"));
    assert.ok(!/[<>]/.test(r.P.accounts[0].name), "balises retirées");
  });
});

describe("opérations rejouées", () => {
  test("achats : PRU frais inclus pondéré ; vente : réalisé en euros, PRU inchangé ; espèces suivies", () => {
    const { F } = setup();
    const P = F.empty(); P.accounts.push(acc(F, { cash_balance: 0 }));
    const tx = (o) => P.transactions.push(F.normTx(Object.assign({ account_id: "a1", instrument_id: "isin:LU1681043599", currency: "EUR" }, o)));
    tx({ date: "2026-01-02", type: "versement", amount: 10000, instrument_id: null });
    tx({ date: "2026-01-10", type: "achat", quantity: 10, price: 500, fees: 2 });
    tx({ date: "2026-03-10", type: "achat", quantity: 10, price: 520, fees: 2 });
    tx({ date: "2026-06-10", type: "vente", quantity: 5, price: 600, fees: 1 });
    const C = F.compute(P), p = C.positions[0], a = C.accounts[0];
    near(p.quantity, 15);
    near(p.pru, (5002 + 5202) / 20, 1e-9, "PRU");
    near(p.realized, (5 * 600 - 1) - 5 * ((5002 + 5202) / 20), 1e-9, "réalisé");
    near(a.cash, 10000 - 5002 - 5202 + 2999, 1e-9, "espèces");
    near(a.deposits, 10000);
    assert.equal(C.errors.length, 0);
  });
  test("une vente supérieure à la quantité détenue est refusée et signalée", () => {
    const { F } = setup();
    const P = F.empty(); P.accounts.push(acc(F));
    P.holdings.push(F.normHold({ account_id: "a1", instrument_id: "isin:LU1681043599", quantity: 3, average_purchase_price: 400 }));
    P.transactions.push(F.normTx({ account_id: "a1", instrument_id: "isin:LU1681043599", date: "2026-05-01", type: "vente", quantity: 4, price: 500 }));
    const C = F.compute(P);
    assert.equal(C.positions[0].quantity, 3);
    assert.equal(C.errors.length, 1);
    assert.match(C.errors[0].msg, /Vente de 4/);
  });
  test("une opération sans mouvement d'espèces ne touche pas au solde", () => {
    const { F } = setup();
    const P = F.empty(); P.accounts.push(acc(F, { cash_balance: 100 }));
    P.transactions.push(F.normTx({ account_id: "a1", instrument_id: "isin:LU1681043599", date: "2026-05-01", type: "achat", quantity: 1, price: 500, cash: false }));
    near(F.compute(P).accounts[0].cash, 100);
  });
});

describe("valorisation en euros", () => {
  test("plus-value latente = part prix + part change (exactement) ; poids sur le total espèces comprises", () => {
    const { F } = setup();
    const P = F.empty(); P.accounts.push(acc(F, { id: "c1", account_type: "CTO", cash_balance: 1000 }));
    // Apple : 8 actions à 185 $ achetées avec 1 $ = 0,95 € ; cours 200 $, 1 $ = 0,90 € aujourd'hui
    P.holdings.push(F.normHold({ account_id: "c1", instrument_id: "isin:US0378331005", quantity: 8, average_purchase_price: 185, fx_rate_at_purchase: 0.95 }));
    const V = F.value(P, (id) => (id === "isin:US0378331005" ? { last: 200, currency: "USD", change_pct: 1, ts: T0, source: "test" } : null));
    const L = V.lines[0];
    near(L.value, 8 * 200 * 0.9);
    near(L.cost, 8 * 185 * 0.95);
    near(L.pnl_px, 8 * (200 - 185) * 0.9, 1e-9, "prix");
    near(L.pnl_fx, 8 * 185 * (0.9 - 0.95), 1e-9, "change");
    near(L.pnl_px + L.pnl_fx, L.pnl, 1e-9, "prix + change = total");
    near(V.total.value, 1440 + 1000);
    near(L.weight, 1440 / 2440);
    near(L.day, 1440 - 1440 / 1.01, 1e-9, "variation du jour");
  });
  test("sans cours : clôture publiée, puis prix manuel, puis prix d'achat (signalé)", () => {
    const { F } = setup();
    const P = F.empty(); P.accounts.push(acc(F));
    P.holdings.push(F.normHold({ account_id: "a1", instrument_id: "isin:LU1681043599", quantity: 2, average_purchase_price: 400 }));
    let V = F.value(P, () => null, { close: () => ({ c: 610, d: "2026-11-14" }) });
    assert.equal(V.lines[0].kind, "cloture"); near(V.lines[0].value, 1220);
    V = F.value(P, () => null);
    assert.equal(V.lines[0].kind, "pru"); near(V.lines[0].value, 800);
    assert.ok(F.checks(P, V).some((c) => /prix d'achat/.test(c.text)));
  });
  test("prix manuel (assurance-vie, fonds hors référentiel) : jamais de cotation demandée", () => {
    const { F } = setup();
    const P = F.empty(); P.accounts.push(acc(F, { account_type: "assurance_vie" }));
    P.instruments.push(F.normCustom({ id: "perso:FE", name: "Fonds euros", asset_class: "liquidites", vehicle: "fonds" }));
    P.holdings.push(F.normHold({ account_id: "a1", instrument_id: "perso:FE", quantity: 1, price_source: "manuel", manual_price: 15000, manual_price_date: "2026-11-01" }));
    let asked = 0;
    const V = F.value(P, () => { asked++; return null; });
    assert.equal(asked, 0);
    near(V.total.value, 15000);
    assert.equal(V.lines[0].group, "liq");
  });
  test("répartition : familles dans un ordre fixe, somme = total", () => {
    const { F } = setup();
    const P = F.demo();
    const V = F.value(P, (id) => ({ last: 100, currency: F.instr(P, id).currency, ts: T0 }));
    assert.deepEqual([...V.breakdown.groups.map((g) => g.k)], ["actions", "obligations", "mp", "immo", "crypto", "liq", "autre"]);
    near(V.breakdown.groups.reduce((s, g) => s + g.v, 0), V.total.value, 1e-6);
  });
});

describe("contrôles d'enveloppe", () => {
  test("PEA strict : un ETF non éligible et une action américaine sont signalés en alerte ; un ETF éligible ne l'est pas", () => {
    const { F } = setup();
    const P = F.empty(); P.accounts.push(acc(F, { opened_at: "2024-01-15" }));
    for (const id of ["isin:LU1681043599", "isin:IE00B5BMR087", "isin:US0378331005"]) P.holdings.push(F.normHold({ account_id: "a1", instrument_id: id, quantity: 1, average_purchase_price: 100 }));
    const C = F.checks(P, F.value(P, () => null));
    assert.ok(C.some((c) => c.level === "alerte" && /^SXR8/.test(c.text)));
    assert.ok(C.some((c) => c.level === "alerte" && /^AAPL/.test(c.text)));
    assert.ok(!C.some((c) => /^CW8 dans/.test(c.text)));
    assert.ok(C.some((c) => /5 ans le 15\/01\/2029/.test(c.text)));
  });
  test("plafond PEA (150 000 €) et plafond commun PEA + PEA-PME (225 000 €) lus dans fiscal.json", () => {
    const { F } = setup();
    const P = F.empty();
    P.accounts.push(acc(F, { deposits_total: 160000 }), acc(F, { id: "a2", name: "PME", account_type: "PEA_PME", deposits_total: 70000 }));
    const C = F.checks(P, F.value(P, () => null));
    assert.ok(C.some((c) => c.level === "alerte" && /plafond de 150/.test(c.text.replace(/\s/g, " "))));
    assert.ok(C.some((c) => c.level === "alerte" && /plafond commun/.test(c.text)));
  });
});

describe("import CSV", () => {
  test("Windows-1252 (é, €) et UTF-8 avec BOM sont décodés", () => {
    const { F } = setup();
    const w = new Uint8Array([0x4c, 0x69, 0x62, 0x65, 0x6c, 0x6c, 0xe9, 0x3b, 0x80]);   // « Libellé;€ » en Windows-1252
    assert.deepEqual({ ...F.decode(w) }, { text: "Libellé;€", encoding: "Windows-1252" });
    const u = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Libellé;€")]);
    assert.deepEqual({ ...F.decode(u) }, { text: "Libellé;€", encoding: "UTF-8" });
  });
  test("positions d'un courtier : « ; », virgule décimale, milliers, guillemets, ligne de total ignorée", () => {
    const { F } = setup();
    const csv = 'Libellé;Code ISIN;Quantité;PRU;Dernier cours;Valorisation\r\n' +
      'AMUNDI MSCI WORLD;LU1681043599;12;"480,50";612,3;"7 347,60 €"\r\n' +
      '"TOTALENERGIES; SE";FR0000120271;40;55,00;60;2 400\r\n' +
      'FONDS EUROS SECURITE;;;;;15 200,00\r\n' +
      'Total;;;;;24 947,60\r\n';
    const R = F.readCSV(F.empty(), csv);
    assert.equal(R.ok, true); assert.equal(R.mode, "positions"); assert.equal(R.delim, ";");
    assert.equal(R.items.length, 3);
    const [cw8, tte, fe] = R.items;
    assert.equal(cw8.inst.id, "isin:LU1681043599"); assert.equal(cw8.qty, 12); assert.equal(cw8.pru, 480.5);
    assert.equal(tte.name, "TOTALENERGIES; SE");
    assert.equal(fe.inst.draft, true); assert.equal(fe.inst.i.asset_class, "liquidites"); assert.equal(fe.manual, 15200);
    const P = F.empty(); P.accounts.push(acc(F, { id: "av", account_type: "assurance_vie" }));
    const out = F.applyCSV(P, R, { account_id: "av", file: "export.csv", date: "2026-11-17" });
    assert.equal(out.added, 3); assert.equal(out.customs, 1);
    assert.match(out.P.holdings[0].origin, /Import CSV « export\.csv » du 17\/11\/2026/);
    assert.equal(out.P.holdings[2].price_source, "manuel");
  });
  test("opérations : sens reconnus, doublons ignorés au second import", () => {
    const { F } = setup();
    const csv = "Date;Opération;ISIN;Libellé;Quantité;Cours;Frais;Montant\n" +
      "02/01/2026;Versement;;;;;;5 000,00\n" +
      "10/01/2026;ACHAT COMPTANT;LU1681043599;AMUNDI MSCI WORLD;5;500,00;2,00;-2 502,00\n" +
      "15/06/2026;Dividende;FR0000120271;TOTALENERGIES;;;;12,30\n" +
      "20/06/2026;Vente;LU1681043599;AMUNDI MSCI WORLD;2;550;1;1 099\n" +
      "21/06/2026;Truc bizarre;;;;;;3\n";
    const R = F.readCSV(F.empty(), csv);
    assert.equal(R.mode, "operations");
    assert.deepEqual([...R.items.map((i) => i.type)], ["versement", "achat", "dividende", "vente", null]);
    assert.equal(R.items[4].ok, false);
    const P = F.empty(); P.accounts.push(acc(F));
    const o1 = F.applyCSV(P, R, { account_id: "a1" });
    assert.equal(o1.added, 4); assert.equal(o1.skipped, 1);
    const o2 = F.applyCSV(o1.P, F.readCSV(o1.P, csv), { account_id: "a1" });
    assert.equal(o2.added, 0); assert.equal(o2.dup, 4);
    const C = F.compute(o1.P);
    near(C.positions[0].quantity, 3);
    near(C.accounts[0].cash, 5000 - 2502 + 12.3 + 1099);
  });
  test("un en-tête inconnu est refusé avec une explication", () => {
    const { F } = setup();
    const R = F.readCSV(F.empty(), "a;b;c\n1;2;3\n");
    assert.equal(R.ok, false); assert.match(R.error, /Quantité/);
  });
  test("nombres d'export : parenthèses négatives, signe moins typographique, symbole monétaire", () => {
    const { F } = setup();
    assert.equal(F.csvNum("(12,50)"), -12.5);
    assert.equal(F.csvNum("−3,2 %"), -3.2);
    assert.equal(F.csvNum("1 234,56 €"), 1234.56);
    assert.equal(F.csvNum(""), null);
    assert.equal(F.csvDate("05-03-2026"), "2026-03-05");
    assert.equal(F.csvDate("05/03/26"), "2026-03-05");
  });
});

describe("risques", () => {
  const weeks = (n, f) => { const o = {}; for (let k = 0; k < n; k++) o[new Date(Date.UTC(2023, 0, 2 + 7 * k)).toISOString().slice(0, 10)] = f(k); return o; };
  test("contributions au risque : somme 100 % ; deux lignes identiques corrélées à 1", () => {
    const { F } = setup();
    let s = 1; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
    const ra = [], rb = [];
    for (let k = 0; k < 160; k++) { ra.push(rnd() * 0.06); rb.push(rnd() * 0.02); }
    const path = (r) => { let v = 100; return weeks(160, (k) => (k ? (v *= 1 + r[k]) : v)); };
    const A = path(ra), B = path(rb);
    const R = F.risk([{ id: "a", label: "A", w: 0.5, weekly: A }, { id: "b", label: "B", w: 0.3, weekly: B }, { id: "a2", label: "A bis", w: 0.1, weekly: A }], 0.1);
    assert.equal(R.ok, true);
    near(R.contrib.reduce((x, c) => x + c.rc, 0), 1, 1e-9);
    const ia = R.corr.ids.indexOf("a"), ia2 = R.corr.ids.indexOf("a2");
    near(R.corr.m[ia][ia2], 1, 1e-9);
    assert.ok(R.vol > 0 && R.mdd <= 0 && R.worst < 0);
    near(R.coverage, 1);
  });
  test("une ligne sans historique suffisant n'est pas mesurée (et le dit) ; HHI et nombre effectif", () => {
    const { F } = setup();
    const R = F.risk([{ id: "a", label: "A", w: 0.5, weekly: weeks(100, (k) => 100 + k) }, { id: "x", label: "X", w: 0.5, weekly: weeks(10, () => 1) }], 0);
    assert.deepEqual([...R.unmeasured.map((u) => u.id)], ["x"]);
    near(R.coverage, 0.5);
    near(R.concentration.hhi, 0.5); near(R.concentration.neff, 2);
  });
  test("clôtures hebdomadaires converties au fixing du jour", () => {
    const { F } = setup();
    const t = Date.parse("2026-01-05T21:00:00Z");
    const w = F.weeklyEUR([{ timestamp: t, close: 100 }], "USD", (c, d) => CK_rate(F, c, d));
    assert.deepEqual({ ...w }, { "2026-01-05": 95 });
  });
});
function CK_rate(F, c, d) { return F.fxRate(c, d); }
