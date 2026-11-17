// Espace « Portefeuille » (phase 4) : portfolio.js chargé avec les VRAIS models, fx, pea, providers et pfcore.
// Vérifie le rendu (avertissement exact, filtre PEA, textes échappés, montants masqués), l'export tableur
// (pas de formule injectée), l'accueil (aucun appel réseau) et que l'abonnement aux cours ne concerne que les lignes détenues.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeContext } from "./vmkit.mjs";

const rd = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const REF = JSON.parse(rd("./referentiel.json"));
const FISCAL = JSON.parse(rd("./fiscal.json"));
const DISC = "Les informations affichées ne constituent pas un conseil en investissement personnalisé. Les performances passées ne préjugent pas des performances futures.";
const T0 = Date.parse("2026-11-17T10:00:00Z");

function setup() {
  const { CK, load } = makeContext();
  CK.cfg = () => ({ data: "https://lafouge-stack.github.io/Desk" });
  for (const f of ["models.js", "datakit.js", "fx.js", "pea.js", "providers.js", "indicators.js", "pfcore.js", "portfolio.js"]) load(f);
  CK.models.setData("referentiel", REF);
  CK.models.setData("fiscal", FISCAL);
  CK.NET = {};
  const calls = [];
  CK.dk.env = Object.assign({}, CK.dk.env, { now: () => T0, fetch: (u) => { calls.push(u); return Promise.reject(new Error("réseau coupé")); }, indexedDB: null });
  CK.fx.setDaily("USD", [["2026-11-16", 0.9]]);
  return { CK, F: CK.pfc, T: CK.pf._t, calls };
}
const px = (CK) => (id) => ({ last: 100, currency: CK.pfc.instr(CK.pfc.load(), id)?.currency || "EUR", change_pct: 1, ts: T0, source: "test" });

describe("rendu", () => {
  test("filtre PEA « Éligibles » : aucune ligne non éligible n'est rendue (les totaux restent complets)", () => {
    const { CK, F, T } = setup();
    const P = F.empty(); P.accounts.push(F.normAcc({ id: "c", name: "CTO", account_type: "CTO" }));
    for (const id of ["isin:LU1681043599", "isin:IE00B5BMR087", "isin:US0378331005", "isin:IE00B4ND3602"]) P.holdings.push(F.normHold({ account_id: "c", instrument_id: id, quantity: 1, average_purchase_price: 50 }));
    F.save(P);
    const V = F.value(P, px(CK));
    const all = T.positionsHTML(V, { peaf: "tous" }), elig = T.positionsHTML(V, { peaf: "eligibles" });
    assert.equal((all.match(/class="clk pf-row"/g) || []).length, 4);
    assert.equal((elig.match(/class="clk pf-row"/g) || []).length, 1);
    assert.ok(!/mk-pea no/.test(elig), "aucun badge « Non PEA » avec le filtre Éligibles");
    assert.match(elig, /3 lignes masquées par le filtre PEA/);
  });
  test("un nom piégé (balise, guillemets) est toujours échappé, dans toutes les vues", () => {
    const { CK, F, T } = setup();
    const evil = '"><img src=x onerror=alert(1)>';
    const P = F.empty(); P.accounts.push(F.normAcc({ id: "a", name: "PEA", account_type: "PEA", broker: evil }));
    P.instruments.push(F.normCustom({ id: "perso:X", name: "Fonds <script>", symbol: "X", asset_class: "actions", vehicle: "fonds" }));
    P.holdings.push(F.normHold({ account_id: "a", instrument_id: "perso:X", quantity: 1, price_source: "manuel", manual_price: 10, origin: evil }));
    P.transactions.push(F.normTx({ account_id: "a", date: "2026-01-01", type: "versement", amount: 10, origin: evil }));
    const V = F.value(P, () => null);
    const html = [T.resumeHTML(P, V, {}), T.positionsHTML(V, {}), T.opsHTML(P, {}), T.repartHTML(V, {}), T.accountsHTML(P, V, F.checks(P, V), {}),
      T.posForm(P, V.lines[0]), T.accForm(P.accounts[0]), T.txForm(P, P.transactions[0])].join("");
    assert.ok(!/<img|<script/i.test(html), "aucune balise injectée");
    assert.ok(!/onerror=alert\(1\)>/.test(html.replace(/&gt;/g, "")) || !/<img/.test(html));
  });
  test("« Masquer les montants » : aucun montant en euros visible, les pourcentages restent", () => {
    const { CK, F, T } = setup();
    const P = F.demo(); F.save(P);
    const V = F.value(P, px(CK));
    const h = T.resumeHTML(P, V, { hide: true }) + T.positionsHTML(V, { hide: true });
    assert.ok(!/\d[\d   ]*,?\d* €/.test(h.replace(/•••/g, "")), "pas de « 1 234 € »");
    assert.match(h, /••• €/);
    assert.match(h, /\d+,\d %/);
  });
  test("contrôles affichés : alerte pour un ETF non éligible détenu dans un PEA", () => {
    const { CK, F, T } = setup();
    const P = F.empty(); P.accounts.push(F.normAcc({ id: "p", name: "Mon PEA", account_type: "PEA" }));
    P.holdings.push(F.normHold({ account_id: "p", instrument_id: "isin:IE00B5BMR087", quantity: 1, average_purchase_price: 50 }));
    const V = F.value(P, px(CK));
    const h = T.checksHTML(F.checks(P, V));
    assert.match(h, /pf-ck-alerte/); assert.match(h, /SXR8 dans Mon PEA/);
  });
  test("répartition : l'anneau a un segment par famille non nulle, couleur fixe par famille", () => {
    const { CK, F, T } = setup();
    const P = F.demo(); const V = F.value(P, px(CK));
    const svg = T.donutSVG(V.breakdown.groups);
    const n = V.breakdown.groups.filter((g) => g.v > 0).length;
    assert.equal((svg.match(/class="pf-seg /g) || []).length, n);
    assert.match(svg, /pf-c-actions/); assert.match(svg, /pf-c-liq/);
  });
  test("vue vide : invitation à créer un compte, importer ou voir l'exemple", () => {
    const { F, T } = setup();
    const P = F.empty(), h = T.resumeHTML(P, F.value(P, () => null), {});
    assert.match(h, /data-pf="add-acc"/); assert.match(h, /data-pf="import"/); assert.match(h, /data-pf="demo"/);
  });
  test("rappel de sauvegarde : jamais sauvegardé, puis modifié plus de 7 jours après la sauvegarde", () => {
    const { F, T } = setup();
    const P = F.empty(); P.accounts.push(F.normAcc({ name: "PEA", account_type: "PEA" }));
    assert.match(T.backupHTML(P, { now: T0 }), /n(&#39;|')existe que dans ce navigateur/);
    P.exported_at = new Date(T0 - 10 * 864e5).toISOString(); P.updated_at = new Date(T0 - 864e5).toISOString();
    assert.match(T.backupHTML(P, { now: T0 }), /depuis ta dernière sauvegarde/);
    P.updated_at = P.exported_at;
    assert.equal(T.backupHTML(P, { now: T0 }), "");
  });
});

describe("fichiers", () => {
  test("export tableur : « ; », virgule décimale, BOM, et aucune cellule lue comme une formule", () => {
    const { CK, F, T } = setup();
    const P = F.empty(); P.accounts.push(F.normAcc({ id: "a", name: "=HYPERLINK(\"http://x\")", account_type: "CTO" }));
    P.holdings.push(F.normHold({ account_id: "a", instrument_id: "isin:LU1681043599", quantity: 1.5, average_purchase_price: 480.25 }));
    const csv = T.positionsCSV(F.value(P, px(CK)), P);
    assert.ok(csv.startsWith("﻿"));
    const row = csv.split("\r\n")[1];
    assert.match(row, /^"'=HYPERLINK\(""http:\/\/x""\)";CW8;/);
    assert.match(row, /;1,50000000;480,250000;EUR;/);
  });
  test("aperçu d'import : lignes reconnues, nouvelles lignes perso, choix du compte", () => {
    const { F, T } = setup();
    const P = F.empty(); P.accounts.push(F.normAcc({ id: "a", name: "PEA", account_type: "PEA" }));
    const R = F.readCSV(P, "ISIN;Libellé;Quantité\nLU1681043599;World;2\nFR0010000000;Ma SICAV;1\n");
    const h = T.importPreviewHTML(P, R, { file: "x.csv", encoding: "UTF-8" });
    assert.match(h, /reconnu par ISIN/); assert.match(h, /nouvelle ligne perso/); assert.match(h, /Importer 2 lignes/);
  });
});

describe("accueil, recherche et réseau", () => {
  test("home() lit seulement le stockage et le cache : aucun appel réseau", () => {
    const { CK, F, calls } = setup();
    F.save(F.demo());
    const h = CK.pf.home();
    assert.equal(h.has, true); assert.equal(h.accounts, 4);
    assert.equal(calls.length, 0);
    assert.ok(h.groups.some((g) => g.k === "liq" && g.v >= 15200));
  });
  test("home() sans portefeuille : has = false", () => {
    const { CK } = setup();
    assert.equal(CK.pf.home().has, false);
  });
  test("cotations demandées seulement pour les lignes détenues et cotables (jamais les prix manuels)", () => {
    const { CK, F, T } = setup();
    F.save(F.demo());
    const ids = [...T.heldIds()].sort();
    assert.ok(ids.includes("isin:LU1681043599") && ids.includes("crypto:BTC"));
    assert.ok(!ids.some((x) => x.startsWith("perso:")));
  });
  test("recherche d'instrument : référentiel investissable (jamais un indice), crypto, ou « hors liste »", () => {
    const { F, T } = setup();
    const P = F.empty();
    const s = T.suggest(P, "cw8");
    assert.equal(s[0].id, "isin:LU1681043599");
    assert.ok(!T.suggest(P, "CAC 40").some((x) => x.id === "tv:EURONEXT:PX1"), "un indice n'est pas proposé");
    assert.ok(T.suggest(P, "AVAX").some((x) => x.id === "crypto:AVAX"));
    assert.match(T.sugHTML(s, "cw8"), /hors liste/);
  });
  test("l'avertissement exact est présent dans le fichier (affiché sous les onglets)", () => {
    const src = rd("./portfolio.js");
    assert.match(src, /esc\(disclaimer\(\)\)/);
    const { CK } = setup();
    assert.equal(CK.DISCLAIMER, DISC);
  });
});
