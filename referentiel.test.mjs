// Contrôle du référentiel (referentiel.json) : chaque ligne valide, statuts PEA cohérents et sourcés.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeContext } from "./vmkit.mjs";

const json = JSON.parse(readFileSync(new URL("./referentiel.json", import.meta.url), "utf8"));
const k = makeContext();
k.load("models.js");
const CK = k.load("pea.js");
CK.models.setData("referentiel", json);
const all = CK.ref.all();
const NOW = Date.parse("2026-11-16T12:00:00Z");

test("le référentiel se charge sans perte de ligne", () => {
  assert.ok(json.instruments.length >= 70, "au moins 70 instruments");
  assert.equal(all.length, json.instruments.length, "aucun doublon ni ligne rejetée");
});

test("chaque instrument est valide (id, nom, classe, véhicule, ISIN, ticker)", () => {
  for (const i of all) {
    const v = CK.models.validateInstrument(i);
    assert.ok(v.ok, `${i.id} : ${v.errors.join(", ")}`);
  }
});

test("ISIN valides et identiques à l'id des titres", () => {
  for (const r of json.instruments) {
    if (!r.isin) continue;
    assert.ok(CK.models.isinValid(r.isin), r.isin);
    if (String(r.id).startsWith("isin:")) assert.equal(r.id, "isin:" + r.isin);
  }
});

test("ids uniques, aucun texte avec < ou >", () => {
  const ids = new Set();
  for (const r of json.instruments) {
    assert.ok(!ids.has(r.id), "doublon " + r.id);
    ids.add(r.id);
    assert.ok(!/[<>]/.test(JSON.stringify(r)), "caractère < ou > dans " + r.id);
  }
});

test("aucun ETF déclaré éligible sans source ; statuts explicites toujours sourcés et datés", () => {
  for (const r of json.instruments) {
    if (r.pea_eligibility_status === "eligible" || r.pea_eligibility_status === "not_eligible") {
      assert.ok(r.pea_source, "source manquante : " + r.id);
      assert.ok(r.pea_last_checked_at, "date de vérification manquante : " + r.id);
    }
    if (r.vehicle !== "titre") assert.notEqual(r.pea_eligibility_status, "eligible_regle", "fonds éligible « par règle » : " + r.id);
  }
});

test("statut calculé : aucune action ni fonds américain éligible, actions françaises éligibles par règle", () => {
  for (const i of all) {
    const s = CK.pea.status(i, { now: NOW }).status;
    if (i.isin && i.isin.startsWith("US")) assert.equal(s, "not_eligible", i.id);
    if (i.vehicle === "titre" && i.isin && i.isin.startsWith("FR") && !i.siic) assert.equal(s, "eligible_regle", i.id);
    if (i.siic) assert.equal(s, "not_eligible", i.id);
    if (!i.is_investable) assert.equal(s, "not_eligible", i.id);
  }
});

test("les ETF éligibles PEA de la recherche sont présents", () => {
  const syms = new Set(all.map((i) => i.symbol));
  for (const s of ["CW8", "WPEA", "DCAM", "GPEA", "PSP5", "ESE", "SPEA", "PUST", "PAEEM", "PAASI", "PTPXE", "PCEU", "ETZ", "C50", "CAC", "CACC", "C40", "MMS"]) {
    assert.ok(syms.has(s), s);
  }
});

test("IWDA et le S&P 500 physique ont des alternatives éligibles PEA", () => {
  const iwda = CK.ref.byIsin("IE00B4L5Y983"), cspx = CK.ref.byIsin("IE00B5BMR087");
  assert.ok(iwda && cspx);
  assert.equal(CK.pea.status(iwda, { now: NOW }).status, "not_eligible");
  const a1 = CK.pea.alternatives(iwda), a2 = CK.pea.alternatives(cspx);
  assert.ok(a1.length >= 2, "MSCI World : " + a1.map((x) => x.symbol));
  assert.ok(a2.length >= 2, "S&P 500 : " + a2.map((x) => x.symbol));
  for (const x of [...a1, ...a2]) assert.equal(CK.pea.allowedIn(x, "PEA").ok, true, x.symbol);
});

test("chaque instrument investissable a un ticker exploitable pour son cours", () => {
  for (const i of all.filter((x) => x.is_investable)) {
    const t = i.tickers;
    assert.ok(t.tv || t.okx || t.binance, i.id + " sans ticker de cotation");
  }
});

test("indices, taux et cours de référence ne sont pas investissables", () => {
  for (const i of all) if (i.vehicle === "indice" || i.vehicle === "taux") assert.equal(i.is_investable, false, i.id);
});

test("les marchés demandés sont couverts (indices, métaux, énergie, taux, devises, crypto)", () => {
  const tv = new Set(all.map((i) => i.tickers.tv));
  for (const s of ["EURONEXT:PX1", "SP:SPX", "NASDAQ:NDX", "NASDAQ:IXIC", "DJ:DJI", "TVC:GOLD", "TVC:SILVER", "FX:USOIL", "FX:UKOIL", "NYMEX:NG1!",
    "TVC:FR10Y", "TVC:DE10Y", "TVC:US10Y", "FX_IDC:EURUSD"]) assert.ok(tv.has(s), s);
  for (const c of ["crypto:BTC", "crypto:ETH", "crypto:SOL"]) assert.ok(CK.ref.get(c), c);
});

test("zone d'exposition : un ETF Monde n'est pas classé selon son pays de domicile", () => {
  const cw8 = CK.ref.byIsin("LU1681043599");
  assert.equal(cw8.region, "monde");
  assert.equal(cw8.domicile, "LU");
});
