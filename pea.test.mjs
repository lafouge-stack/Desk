// Éligibilité PEA / PEA-PME (pea.js) : ordre de priorité, règles certaines, jamais un fonds éligible par déduction.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeContext } from "./vmkit.mjs";

function setup() {
  const k = makeContext();
  k.load("models.js");
  const CK = k.load("pea.js");
  const I = (o) => CK.models.normInstrument(o);
  return { CK, I };
}
const NOW = Date.parse("2026-11-16T12:00:00Z");
const etf = (o = {}) => ({ id: "isin:FR0011871128", symbol: "PSP5", name: "ETF", isin: "FR0011871128", asset_class: "actions", vehicle: "etf", tickers: { tv: "EURONEXT:PSP5" }, ...o });
const stock = (isin, o = {}) => ({ id: "isin:" + isin, symbol: "X", name: "Action", isin, asset_class: "actions", vehicle: "titre", tickers: { tv: "EURONEXT:X" }, ...o });

test("un fonds n'est JAMAIS éligible par déduction, même domicilié en France", () => {
  const { CK, I } = setup();
  const s = CK.pea.status(I(etf()), { now: NOW });
  assert.equal(s.status, "unknown");
  assert.equal(s.by, "inconnu");
  // même avec un statut « eligible_regle » écrit dans le référentiel
  assert.equal(CK.pea.status(I(etf({ pea_eligibility_status: "eligible_regle", pea_source: "x" })), { now: NOW }).status, "unknown");
});

test("référentiel : statut explicite pris seulement avec une source", () => {
  const { CK, I } = setup();
  const ok = CK.pea.status(I(etf({ pea_eligibility_status: "eligible", pea_source: "justETF", pea_last_checked_at: "2026-11-12" })), { now: NOW });
  assert.equal(ok.status, "eligible");
  assert.equal(ok.by, "referentiel");
  assert.equal(ok.stale_check, false);
  const sansSource = CK.pea.status(I(etf({ pea_eligibility_status: "eligible" })), { now: NOW });
  assert.equal(sansSource.status, "unknown", "un « eligible » sans source est ignoré");
});

test("vérification de plus d'un an → à revérifier", () => {
  const { CK, I } = setup();
  const s = CK.pea.status(I(etf({ pea_eligibility_status: "eligible", pea_source: "justETF", pea_last_checked_at: "2025-11-01" })), { now: NOW });
  assert.equal(s.status, "eligible");
  assert.equal(s.stale_check, true);
  const sansDate = CK.pea.status(I(etf({ pea_eligibility_status: "eligible", pea_source: "justETF" })), { now: NOW });
  assert.equal(sansDate.stale_check, true, "sans date de vérification → à revérifier");
});

test("actions : société UE/EEE → éligible par règle ; hors UE/EEE → non éligible", () => {
  const { CK, I } = setup();
  for (const isin of ["FR0000121014", "NL0000235190", "DE0007164600", "DK0062498333", "NO0010096985"]) {
    const s = CK.pea.status(I(stock(isin)), { now: NOW });
    assert.equal(s.status, "eligible_regle", isin);
    assert.match(s.source, /L221-31/);
  }
  for (const isin of ["US0378331005", "GB0005405286", "CH0038863350", "JP3633400001"]) {
    assert.equal(CK.pea.status(I(stock(isin)), { now: NOW }).status, "not_eligible", isin);
  }
  assert.equal(CK.pea.status(I(stock("XS1234567890")), { now: NOW }).status, "not_eligible", "XS n'est pas un pays de l'EEE");
});

test("règles certaines : SIIC, action de préférence, ETC, obligations, matières premières, crypto, devises, liquidités", () => {
  const { CK, I } = setup();
  const cas = [
    stock("FR0010040865", { asset_class: "immobilier_cote", siic: true }),
    stock("FR0000121014", { preferred: true }),
    etf({ asset_class: "or", vehicle: "etc_etn", isin: "FR0013416716" }),
    etf({ asset_class: "oblig_etat" }), etf({ asset_class: "oblig_entreprise" }), etf({ asset_class: "obligations" }),
    etf({ asset_class: "petrole", vehicle: "etc_etn" }), etf({ asset_class: "matieres_premieres" }), etf({ asset_class: "agricole", vehicle: "etc_etn" }),
    { id: "crypto:BTC", symbol: "BTC", name: "Bitcoin", asset_class: "crypto", vehicle: "spot_crypto", tickers: { okx: "BTC-USDT" } },
    etf({ asset_class: "crypto", vehicle: "etc_etn", isin: "CH0454664001" }),
    { id: "tv:FX_IDC:EURUSD", symbol: "EURUSD", name: "EUR/USD", asset_class: "devises", vehicle: "indice", tickers: { tv: "FX_IDC:EURUSD" } },
    { id: "cash", symbol: "EUR", name: "Espèces", asset_class: "liquidites", vehicle: "cash" },
    { id: "tv:EURONEXT:PX1", symbol: "CAC40", name: "CAC 40", asset_class: "actions", vehicle: "indice", tickers: { tv: "EURONEXT:PX1" } }
  ];
  for (const c of cas) assert.equal(CK.pea.status(I(c), { now: NOW }).status, "not_eligible", c.name + " " + c.asset_class);
});

test("fonds domicilié hors UE/EEE → non éligible", () => {
  const { CK, I } = setup();
  assert.equal(CK.pea.status(I(etf({ isin: "US78462F1030", id: "isin:US78462F1030" })), { now: NOW }).status, "not_eligible");
});

test("foncière non SIIC : à vérifier (jamais éligible par règle)", () => {
  const { CK, I } = setup();
  assert.equal(CK.pea.status(I(stock("FR0000064578", { asset_class: "immobilier_cote" })), { now: NOW }).status, "unknown");
});

test("ta correction passe avant tout, puis peut être retirée", () => {
  const { CK, I } = setup();
  const i = I(etf({ pea_eligibility_status: "not_eligible", pea_source: "justETF" }));
  assert.equal(CK.pea.status(i, { now: NOW }).status, "not_eligible");
  assert.equal(CK.pea.setOverride(i.id, "eligible", "vérifié sur le DIC", "pea", { now: NOW }), true);
  const s = CK.pea.status(i, { now: NOW });
  assert.equal(s.status, "eligible");
  assert.equal(s.by, "utilisateur");
  assert.equal(s.checked_at, "2026-11-16");
  assert.match(s.source, /DIC/);
  CK.pea.setOverride(i.id, null);
  assert.equal(CK.pea.status(i, { now: NOW }).status, "not_eligible");
});

test("corrections refusées : statut inconnu, id dangereux", () => {
  const { CK } = setup();
  assert.equal(CK.pea.setOverride("isin:FR0011871128", "oui"), false);
  assert.equal(CK.pea.setOverride("__proto__", "eligible"), false);
  assert.equal(CK.pea.setOverride("", "eligible"), false);
  assert.deepEqual(Object.keys(CK.pea.overrides()), []);
  assert.equal(({}).status, undefined, "aucune pollution du prototype");
});

test("exportOverrides : JSON valide au format du référentiel", () => {
  const { CK } = setup();
  CK.pea.setOverride("isin:FR0011871128", "eligible", "DIC <b>Amundi</b>", "pea", { now: NOW });
  CK.pea.setOverride("isin:FR0011871128", "not_eligible", "", "pme", { now: NOW });
  const arr = JSON.parse(CK.pea.exportOverrides());
  assert.equal(arr.length, 1);
  assert.equal(arr[0].id, "isin:FR0011871128");
  assert.equal(arr[0].pea_eligibility_status, "eligible");
  assert.equal(arr[0].pea_pme_status, "not_eligible");
  assert.ok(!/[<>]/.test(arr[0].pea_source), "note nettoyée");
});

test("PEA-PME : jamais éligible par déduction ; ETF → non éligible ; non éligible PEA → non éligible PEA-PME", () => {
  const { CK, I } = setup();
  assert.equal(CK.pea.pmeStatus(I(etf()), { now: NOW }).status, "not_eligible");
  assert.equal(CK.pea.pmeStatus(I(stock("FR0000121014")), { now: NOW }).status, "unknown", "action UE : taille à vérifier");
  assert.equal(CK.pea.pmeStatus(I(stock("US0378331005")), { now: NOW }).status, "not_eligible");
  assert.equal(CK.pea.pmeStatus(I({ ...etf(), vehicle: "fonds" }), { now: NOW }).status, "unknown", "un fonds PME n'est pas exclu d'office");
  const ref = I(stock("FR0000121014", { pea_pme_status: "eligible", pea_pme_source: "émetteur" }));
  assert.equal(CK.pea.pmeStatus(ref, { now: NOW }).status, "eligible");
});

test("allowedIn : PEA strict pour les fonds, règle acceptée pour les actions, CTO ouvert", () => {
  const { CK, I } = setup();
  const fondsOk = I(etf({ pea_eligibility_status: "eligible", pea_source: "justETF", pea_last_checked_at: "2026-11-12" }));
  const fondsInconnu = I(etf());
  const actionUE = I(stock("FR0000121014")), actionUS = I(stock("US0378331005"));
  const indice = I({ id: "tv:SP:SPX", symbol: "SPX", name: "S&P 500", asset_class: "actions", vehicle: "indice", tickers: { tv: "SP:SPX" } });
  assert.equal(CK.pea.allowedIn(fondsOk, "PEA").ok, true);
  assert.equal(CK.pea.allowedIn(fondsInconnu, "PEA").ok, false);
  assert.equal(CK.pea.allowedIn(actionUE, "PEA").ok, true);
  assert.match(CK.pea.allowedIn(actionUE, "PEA").reason, /courtier/);
  assert.equal(CK.pea.allowedIn(actionUS, "PEA").ok, false);
  assert.equal(CK.pea.allowedIn(actionUS, "CTO").ok, true);
  assert.equal(CK.pea.allowedIn(fondsInconnu, "CTO").ok, true);
  assert.equal(CK.pea.allowedIn(indice, "CTO").ok, false, "un indice n'est investissable nulle part");
  assert.equal(CK.pea.allowedIn(actionUE, "PEA_PME").ok, false, "PEA-PME : statut à vérifier → refusé");
  assert.equal(CK.pea.allowedIn(null, "PEA").ok, false);
});

test("alternatives : même groupe, éligibles PEA seulement, triées par frais", () => {
  const { CK, I } = setup();
  const src = { pea_eligibility_status: "eligible", pea_source: "justETF", pea_last_checked_at: "2026-11-12" };
  const list = [
    I({ id: "a", symbol: "A", name: "A", isin: "FR0011871128", asset_class: "actions", vehicle: "etf", alt_group: "sp500", ter: 0.15, ...src, tickers: { tv: "X:A" } }),
    I({ id: "b", symbol: "B", name: "B", isin: "FR0011550185", asset_class: "actions", vehicle: "etf", alt_group: "sp500", ter: 0.10, ...src, tickers: { tv: "X:B" } }),
    I({ id: "c", symbol: "C", name: "C", isin: "IE00B5BMR087", asset_class: "actions", vehicle: "etf", alt_group: "sp500", ter: 0.05, pea_eligibility_status: "not_eligible", pea_source: "justETF", tickers: { tv: "X:C" } }),
    I({ id: "d", symbol: "D", name: "D", isin: "LU1681043599", asset_class: "actions", vehicle: "etf", alt_group: "msci_world", ter: 0.01, ...src, tickers: { tv: "X:D" } }),
    I({ id: "e", symbol: "E", name: "E", isin: "FR0013412020", asset_class: "actions", vehicle: "etf", alt_group: "sp500", ter: 0.02, tickers: { tv: "X:E" } })
  ];
  const alt = CK.pea.alternatives(list[2], list).map((x) => x.id);
  assert.deepEqual([...alt], ["b", "a"], "C exclu (lui-même), D autre groupe, E non confirmé");
  assert.deepEqual([...CK.pea.alternatives(I({ id: "z", symbol: "Z", name: "Z", asset_class: "actions", vehicle: "etf", tickers: { tv: "X:Z" } }), list)], []);
});

test("EEA : UE 27 + Islande, Norvège, Liechtenstein ; pas le Royaume-Uni ni la Suisse", () => {
  const { CK } = setup();
  assert.equal(CK.pea.EEA.length, 30);
  for (const c of ["FR", "DE", "IE", "LU", "NL", "IS", "NO", "LI"]) assert.ok(CK.pea.EEA.includes(c), c);
  for (const c of ["GB", "CH", "US", "JE", "XS"]) assert.ok(!CK.pea.EEA.includes(c), c);
});
