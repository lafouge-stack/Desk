// Espace « Marchés » (phase 2) : markets.js chargé avec les VRAIS models, datakit, fx, calendars, pea et providers.
// Vérifie le classement par onglet, le filtre PEA, les formats (pb pour les taux), la sécurité du HTML produit,
// la fiche (avertissement, source et date PEA), et qu'un seul appel groupé au scanner est fait, arrêté à la sortie.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeContext } from "./vmkit.mjs";

const rd = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const REF = JSON.parse(rd("./referentiel.json"));
const DISC = "Les informations affichées ne constituent pas un conseil en investissement personnalisé. Les performances passées ne préjugent pas des performances futures.";
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
const resp = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => JSON.parse(JSON.stringify(body)), text: async () => JSON.stringify(body) });

function fakeClock(t0 = Date.parse("2026-11-16T14:00:00Z")) {
  let t = t0, seq = 0; const q = [];
  return {
    now: () => t,
    setTimeout: (f, ms) => { const h = ++seq; q.push({ h, at: t + Math.max(0, Number(ms) || 0), f }); return h; },
    clearTimeout: (h) => { const i = q.findIndex((x) => x.h === h); if (i >= 0) q.splice(i, 1); },
    async tick(ms) {
      const end = t + ms;
      for (;;) { await flush(); q.sort((a, b) => a.at - b.at || a.h - b.h); const n = q[0]; if (!n || n.at > end) break; q.shift(); t = n.at; n.f(); }
      t = end; await flush();
    }
  };
}

/** Réponse du scanner pour TOUS les symboles demandés (colonnes dans l'ordre de CK.mkt.TV_COLS). */
const PX = { "FX_IDC:EURUSD": 1.1, "TVC:FR10Y": 3.41, "TVC:DE10Y": 2.71, "EURONEXT:PX1": 8100, "SP:SPX": 6850.5 };
function tvRows(CK, syms) {
  const cols = CK.mkt.TV_COLS;
  return { totalCount: syms.length, data: syms.map((s) => ({ s, d: cols.map((c) => ({ close: PX[s] ?? 100, change: s === "EURONEXT:PX1" ? -1.2 : 0.5, currency: "EUR",
    update_mode: s.startsWith("EURONEXT") ? "delayed_streaming_900" : "streaming", last_bar_update_time: Date.parse("2026-11-16T13:59:00Z") / 1000, high: (PX[s] ?? 100) * 1.01, low: (PX[s] ?? 100) * 0.99 }[c] ?? null)) })) };
}

function setup(handler) {
  const { CK, load } = makeContext();
  CK.cfg = () => ({ id: "test", data: "https://lafouge-stack.github.io/Desk", marches: { gaz: false } });
  for (const f of ["models.js", "datakit.js", "fx.js", "calendars.js", "pea.js", "providers.js", "indicators.js", "markets.js"]) load(f);
  CK.models.setData("referentiel", REF);
  CK.NET = {};
  const clk = fakeClock(), flags = { hidden: false }, calls = [];
  const fetch = (url, init) => { calls.push({ url, init }); return Promise.resolve(handler ? handler(url, init, CK) : resp(404)); };
  CK.dk.env = { fetch, now: clk.now, random: () => 0.5, setTimeout: clk.setTimeout, clearTimeout: clk.clearTimeout, hidden: () => flags.hidden, online: () => true, indexedDB: null };
  return { CK, clk, flags, calls, T: CK.mk._t };
}
const tvHandler = (url, init, CK) => url.includes("scanner.tradingview.com") ? resp(200, tvRows(CK, JSON.parse(init.body).symbols.tickers)) : resp(404);
const bySym = (CK, s) => CK.ref.all().find((i) => i.symbol === s);

describe("onglets et groupes", () => {
  test("chaque instrument du référentiel a un onglet, sauf la crypto au comptant ; aucun onglet vide", () => {
    const { CK, T } = setup();
    for (const i of CK.ref.all()) {
      const t = T.tabOf(i);
      if (i.vehicle === "spot_crypto") assert.equal(t, null, i.id);
      else assert.ok(CK.mk.TABS.some((x) => x.id === t), `${i.id} → ${t}`);
    }
    for (const t of CK.mk.TABS) assert.ok(T.listTab(t.id).length > 0, `onglet ${t.id} vide`);
  });
  test("classement attendu des instruments typiques", () => {
    const { CK, T } = setup();
    const tab = (id) => T.tabOf(CK.ref.get(id));
    assert.equal(tab("isin:LU1681043599"), "etf");        // CW8
    assert.equal(tab("tv:EURONEXT:PX1"), "indices");
    assert.equal(tab("isin:FR0000121014"), "actions");    // LVMH
    assert.equal(tab("isin:FR0010040865"), "actions");    // Gecina (foncière)
    assert.equal(tab("tv:TVC:FR10Y"), "taux");
    assert.equal(tab("isin:IE00B4WXJJ64"), "taux");       // ETF obligataire
    assert.equal(tab("isin:FR0013416716"), "mp");         // ETC or
    assert.equal(tab("tv:TVC:GOLD"), "mp");
    assert.equal(tab("tv:FX_IDC:EURUSD"), "devises");
    assert.equal(tab("isin:IE000I4R3252"), "etf");        // EPEA (monétaire)
    assert.equal(T.groupOf(CK.ref.get("isin:IE000I4R3252")), "Monétaire");
    assert.equal(T.groupOf(CK.ref.get("isin:CH0454664001")), "Crypto (ETN)");
    assert.equal(T.groupOf(CK.ref.get("tv:TVC:VIX")), "Volatilité");
    assert.equal(T.groupOf(CK.ref.get("isin:FR0010040865")), "Immobilier coté (foncières)");
    assert.equal(T.groupOf(CK.ref.get("tv:TVC:FR10Y")), "Rendements d'État (indicatifs, non investissables)");
  });
  test("le tableau sans tri affiche les groupes dans l'ordre du référentiel ; avec tri, une liste à plat", () => {
    const { T } = setup();
    const list = T.listTab("taux");
    const h = T.tableHTML(list, {}, null);
    assert.ok(h.indexOf("Rendements d") < h.indexOf("ETF obligataires"));
    assert.equal((h.match(/class="mk-grp"/g) || []).length, 2);
    const h2 = T.tableHTML(list, {}, { k: "chg", dir: -1 });
    assert.equal((h2.match(/class="mk-grp"/g) || []).length, 0);
    assert.equal((h2.match(/data-mk-id=/g) || []).length, list.length);
  });
  test("bandeau : 9 repères, 10 avec le gaz ; tous présents dans le référentiel", () => {
    const { CK, T } = setup();
    assert.equal(T.stripItems(false).length, 9);
    assert.equal(T.stripItems(true).length, 10);
    for (const s of T.STRIP) assert.ok(CK.ref.get(s.id), s.id);
    assert.deepEqual([...T.stripItems(false).map((s) => s.n)].slice(0, 5), ["CAC 40", "S&P 500", "Nasdaq 100", "Nasdaq Composite", "Dow Jones"]);
    assert.ok(!T.stripHTML({}, false).includes("Gaz naturel"));
    assert.ok(T.stripHTML({}, true).includes("Gaz naturel"));
  });
});

describe("filtre PEA", () => {
  test("éligibles / + à vérifier / tous ; les repères non investissables restent visibles", () => {
    const { CK, T } = setup();
    const g = (s) => bySym(CK, s);
    for (const [s, tous, elig, verif] of [["CW8", 1, 1, 1], ["MEUD", 1, 0, 0], ["EPEA", 1, 0, 1], ["IWDA", 1, 0, 0], ["AAPL", 1, 0, 0], ["MC", 1, 1, 1], ["CAC40", 1, 1, 1], ["FR10Y", 1, 1, 1]]) {
      assert.equal(T.peaPass(g(s), "tous"), !!tous, s + " tous");
      assert.equal(T.peaPass(g(s), "eligibles"), !!elig, s + " éligibles");
      assert.equal(T.peaPass(g(s), "verifier"), !!verif, s + " à vérifier");
    }
  });
  test("ta correction est prise en compte (puis retirée)", () => {
    const { CK, T } = setup();
    const epea = bySym(CK, "EPEA");
    assert.equal(T.peaPass(epea, "eligibles"), false);
    assert.ok(CK.pea.setOverride(epea.id, "eligible", "https://www.ishares.com/fiche"));
    assert.equal(T.peaPass(epea, "eligibles"), true);
    assert.match(T.peaBadge(epea), /✎/);
    CK.pea.setOverride(epea.id, null);
    assert.equal(T.peaPass(epea, "eligibles"), false);
  });
  test("recherche dans tous les onglets : symbole, ISIN, nom sans accents", () => {
    const { T } = setup();
    const ids = (q) => [...T.visible("indices", q, "tous").map((i) => i.symbol)];
    assert.ok(ids("CW8").includes("CW8"));
    assert.ok(ids("lu1681043599").includes("CW8"));
    assert.ok(ids("moet").includes("MC"));
    assert.ok(!ids("BTC").includes("BTC"), "la crypto au comptant n'est pas dans Marchés");
    assert.ok(T.visible("indices", "", "tous").every((i) => T.tabOf(i) === "indices"));
  });
});

describe("formats", () => {
  test("taux : variation en points de base, pas de performances en % du taux", () => {
    const { CK, T } = setup();
    const fr = CK.ref.get("tv:TVC:FR10Y"), q = { last: 3.41, prev_close: 3.38, change_pct: 0.89, perf: { w: 5 } };
    const c = T.chg(fr, q);
    assert.equal(c.u, "pb"); assert.ok(Math.abs(c.v - 3) < 1e-9);
    assert.equal(T.fmtChg(c), "+3,0 pb");
    assert.equal(T.fmtPx(fr, 3.41), "3,410 %");
    assert.match(T.rowHTML(fr, q), /mk-dim">—<\/td>/);
  });
  test("prix : variation en %, décimales selon l'instrument, volumes abrégés", () => {
    const { CK, T } = setup();
    const cw8 = bySym(CK, "CW8"), eur = CK.ref.get("tv:FX_IDC:EURUSD"), jpy = CK.ref.get("tv:FX_IDC:EURJPY");
    assert.equal(T.fmtChg(T.chg(cw8, { change_pct: -1.234 })), "−1,23 %");
    assert.equal(T.fmtPx(eur, 1.10456), "1,1046");
    assert.equal(T.fmtPx(jpy, 172.456), "172,46");
    assert.equal(T.fmtVol(2.5e9), "2,5 Md"); assert.equal(T.fmtVol(0), "—");
    assert.equal(T.delayTxt({ delay_s: 900 }), "différé 15 min");
    assert.equal(T.delayTxt({ delay_s: 0 }), "temps réel");
    assert.equal(T.delayTxt({ delay_s: 900, stale: true }), "obsolète");
  });
  test("écarts de taux en pb et leur variation du jour", () => {
    const { T } = setup();
    const Q = { "tv:TVC:FR10Y": { last: 3.41, prev_close: 3.38 }, "tv:TVC:DE10Y": { last: 2.71, prev_close: 2.70 } };
    const s = T.spreads(Q)[0];
    assert.equal(s.label, "OAT − Bund 10 ans");
    assert.ok(Math.abs(s.v - 70) < 1e-9); assert.ok(Math.abs(s.d - 2) < 1e-9);
    assert.equal(T.spreads({})[0].v, null);
  });
  test("tri : valeurs absentes toujours en bas, tri stable", () => {
    const { CK, T } = setup();
    const L = ["CW8", "WPEA", "DCAM", "PSP5"].map((s) => bySym(CK, s));
    const Q = { [L[0].id]: { change_pct: 1 }, [L[2].id]: { change_pct: -2 }, [L[3].id]: { change_pct: 1 } };
    assert.deepEqual([...T.sortList(L, Q, "chg", -1).map((i) => i.symbol)], ["CW8", "PSP5", "DCAM", "WPEA"]);
    assert.deepEqual([...T.sortList(L, Q, "chg", 1).map((i) => i.symbol)], ["DCAM", "CW8", "PSP5", "WPEA"]);
  });
});

describe("sécurité du HTML produit", () => {
  const evil = { id: "x\"><img src=x onerror=alert(1)>", symbol: "<b>X</b>", name: "<img src=x onerror=alert(1)>", isin: null, asset_class: "actions", vehicle: "etf",
    is_investable: true, region: "monde", sector: "<script>alert(1)</script>", exchange: "<i>", currency: "EUR", tickers: { tv: "EURONEXT:\"><svg onload=alert(1)>" },
    pea_eligibility_status: "eligible", pea_source: "javascript:alert(1)", pea_last_checked_at: "2026-11-13", notes: "<iframe>" };
  const q = { last: 10, change_pct: 1, source: "<script>x</script>", currency: "<b>", ts: 0, delay_s: 0, perf: {}, info: { sector: "<img>" } };
  test("ligne, fiche, bandeau : tout texte externe est échappé, aucun lien javascript:", () => {
    const { T, CK } = setup();
    const out = [T.rowHTML(evil, q), T.ficheHTML(evil, q), T.priceHTML(evil, q), T.peaBlock(evil), T.tableHTML([evil], { [evil.id]: q }, null)].join("");
    assert.ok(!/<img|<script|<svg|<iframe|<b>X/i.test(out), "balise externe non échappée");
    assert.ok(!/href="javascript:/i.test(out));
    assert.ok(!/onerror=alert\(1\)"?>/.test(out.replace(/&quot;|&gt;|&lt;/g, "")) || !/<img/.test(out));
    // source PEA avec une vraie adresse : lien https uniquement
    const ok = T.peaBlock(bySym(CK, "CW8"));
    assert.match(ok, /href="https:\/\/www\.justetf\.com[^"]*" target="_blank" rel="noopener noreferrer">voir la source/);
  });
});

describe("fiche instrument", () => {
  test("avertissement exact, badge PEA, source et date, bouton Corriger", () => {
    const { CK, T } = setup();
    assert.equal(CK.DISCLAIMER, DISC);
    const h = T.ficheHTML(bySym(CK, "CW8"), null);
    assert.ok(h.includes(DISC));
    assert.match(h, /Éligible PEA/);
    assert.match(h, /13\/11\/2026/);
    assert.match(h, /data-mk-fix=/);
    assert.match(h, /Cours en attente/);
    assert.match(h, /n'est pas exhaustive/);
  });
  test("ETF non éligible : alternatives éligibles du même groupe", () => {
    const { CK, T } = setup();
    const h = T.peaBlock(bySym(CK, "IWDA"));
    assert.match(h, /Alternatives éligibles au PEA/);
    assert.match(h, /CW8/);
    assert.ok(!/IWDA ·/.test(h), "pas l'instrument lui-même");
  });
  test("indice : non investissable, pas de correction possible", () => {
    const { CK, T } = setup();
    const h = T.peaBlock(CK.ref.get("tv:EURONEXT:PX1"));
    assert.match(h, /Non investissable/);
    assert.ok(!/data-mk-fix/.test(h));
  });
  test("cours en devise : équivalent en euros avec le taux connu", () => {
    const { CK, T } = setup();
    CK.fx.setLive("USD", 0.9);
    const h = T.priceHTML(bySym(CK, "AAPL"), { last: 200, currency: "USD", change_pct: 1, ts: Date.now(), delay_s: 900, perf: {}, info: {} });
    assert.match(h, /≈ 180,00 €/);
  });
});

describe("réseau : un seul abonnement, arrêté à la sortie", () => {
  test("start() : un seul POST groupé (≤ 200 symboles) vers le scanner des Marchés ; EUR/USD alimente CK.fx", async () => {
    const s = setup(tvHandler);
    s.CK.mk.start();
    await s.clk.tick(50);
    const tv = s.calls.filter((c) => c.url.includes("scanner.tradingview.com"));
    assert.equal(tv.length, 1, "un seul POST");
    assert.match(tv[0].url, /label-product=desk-marches$/);
    const syms = JSON.parse(tv[0].init.body).symbols.tickers;
    assert.ok(syms.length > 60 && syms.length <= 200, String(syms.length));
    assert.ok(syms.includes("EURONEXT:PX1") && syms.includes("TVC:FR10Y") && syms.includes("FX_IDC:EURUSD"));
    assert.ok(!syms.some((x) => /^OKX:/.test(x)), "la crypto ne passe pas par le scanner");
    assert.ok(s.CK.mk.state().quotes > 60);
    assert.ok(Math.abs(s.CK.fx.rate("USD") - 1 / 1.1) < 1e-9, "taux en direct depuis EUR/USD");
    const h = s.CK.mk.home();
    assert.equal(h.items[0].n, "CAC 40"); assert.equal(h.items[0].last, 8100); assert.equal(h.items[0].txt, "−1,20 %");
    s.CK.mk.stop();
  });
  test("une minute plus tard : un nouvel appel ; après stop(), plus aucun", async () => {
    const s = setup(tvHandler);
    s.CK.mk.start(); await s.clk.tick(50);
    await s.clk.tick(61000);
    const n1 = s.calls.filter((c) => c.url.includes("scanner")).length;
    assert.equal(n1, 2);
    s.CK.mk.stop();
    await s.clk.tick(5 * 60000);
    assert.equal(s.calls.filter((c) => c.url.includes("scanner")).length, n1, "plus d'appel après la sortie de l'espace");
    assert.equal(s.CK.mk.state().running, false);
  });
  test("onglet caché : aucun appel au scanner", async () => {
    const s = setup(tvHandler);
    s.flags.hidden = true;
    s.CK.mk.start(); await s.clk.tick(120000);
    assert.equal(s.calls.filter((c) => c.url.includes("scanner")).length, 0);
    s.CK.mk.stop();
  });
  test("accueil sans aucun appel : relit les valeurs déjà chargées par les Signaux (CK.S.mk)", () => {
    const s = setup();
    s.CK.S = { mk: { SPX: { c: 6850.5, ch: 0.42 } } };
    const h = s.CK.mk.home();
    const sp = h.items.find((x) => x.n === "S&P 500");
    assert.equal(sp.last, 6850.5); assert.equal(sp.txt, "+0,42 %");
    assert.equal(h.items[0].last, null);
    assert.equal(s.calls.length, 0);
  });
});

describe("intégration dans le Desk", () => {
  test("espace Marchés en touche 8, juste après Connexions ; blocs, noms et tailles déclarés", () => {
    const lay = rd("./layout.js");
    assert.match(lay, /\{id:"net",name:"Connexions",key:"7"\},\s*\{id:"marches",name:"Marchés",key:"8"\}/);
    for (const id of ["mkbandeau", "mktable"]) {
      assert.match(lay, new RegExp(`\\{id:"${id}",x:`), id + " dans DEFAULTS");
      assert.match(lay, new RegExp(`MIN=\\{[^}]*${id}:`), id + " dans MIN");
      assert.match(lay, new RegExp(`NAMES=\\{[^}]*${id}:`), id + " dans NAMES");
      assert.match(rd("./page.html"), new RegExp(`data-mod="${id}"`), id + " dans page.html");
      assert.match(rd("./core.js"), new RegExp(`modules:\\{[^}]*${id}:true`), id + " dans DEF.modules");
      assert.match(rd("./core.js"), new RegExp(`${id}:"marches"`), id + " dans ESPM");
    }
    assert.match(rd("./core.js"), /espaces:\{[^}]*marches:true/);
    assert.match(rd("./worlds.js"), /\{v:"marches",name:"Marchés",key:"8"/);
    assert.match(lay, /CK\.onView=function/);
  });
  test("Connexions : les sources des Marchés ont leur fiche et leur règle de journal", () => {
    const net = rd("./net.js"), core = rd("./core.js");
    for (const id of ["tvscan2", "fx", "robotdata", "binhist"]) {
      assert.match(net, new RegExp(`\\{id:"${id}",`), id + " dans SRC");
      assert.match(core, new RegExp(`,"${id}"\\]`), id + " dans netId");
    }
    assert.match(net, /\{id:"marches",name:"Marchés"/);
  });
  test("avertissement visible partout : pied de page, accueil, tableau et fiche", () => {
    assert.ok(rd("./page.html").includes(`<p class="foot-disc">${DISC}</p>`));
    assert.match(rd("./worlds.js"), /class="ln-disc">'\+esc\(CK\.DISCLAIMER/);
    assert.match(rd("./markets.js"), /'<p class="mk-disc">'\+esc\(disclaimer\(\)\)/);
  });
  test("le chargement de markets.js ne fait aucun appel ni minuterie", () => {
    const { CK, load, timers } = makeContext();
    CK.cfg = () => ({});
    let n = 0; CK.dk = { env: { fetch: () => { n++; return Promise.reject(new Error("non")); } } };
    load("markets.js");
    assert.equal(n, 0); assert.equal(timers.length, 0);
    assert.equal(typeof CK.mk.boot, "function");
  });
});

describe("historiques du robot (phase 3)", () => {
  const RES = { v: 1, items: {
    "isin:LU1681043599": { d: "2026-11-16", c: 706.39, p: { w: 0.0115, m1: -0.0045, y1: 0.1753, ytd: 0.16 }, spark: [600, 620, 610, 650, 706], note: "<img src=x onerror=alert(1)>" },
    "tv:TVC:FR10Y": { d: "2026-10-31", c: 4.89, diff: true, freq: "M", p: { m1: 0.45, y1: 1.45 }, spark: [4.4, 4.5, 4.89] } } };
  test("performances : TradingView d'abord, sinon l'historique ; taux en points de base depuis l'historique", () => {
    const { CK, T } = setup();
    T.setResume(RES);
    const cw8 = bySym(CK, "CW8"), fr = CK.ref.get("tv:TVC:FR10Y");
    assert.equal(T.perfVal(cw8, { perf: { y1: 18.1 } }, "y1"), 18.1, "TradingView en direct");
    assert.ok(Math.abs(T.perfVal(cw8, null, "y1") - 17.53) < 1e-9, "repli sur l'historique");
    assert.ok(Math.abs(T.perfVal(fr, { perf: { y1: 40 } }, "y1") - 145) < 1e-9, "taux : écart en pb, jamais un % du taux");
    assert.match(T.rowHTML(fr, null), /\+45 pb/);
    T.setResume({ items: "nimporte" }); assert.equal(T.perfVal(cw8, null, "y1"), null);
  });
  test("courbe d'un an : SVG simple (nombres seulement), couleur selon le sens, tiret sans données", () => {
    const { T } = setup();
    const up = T.sparkSVG([1, 2, 3]), down = T.sparkSVG([3, 2, "<script>", 1]);
    assert.match(up, /class="mk-spark up"/); assert.match(down, /class="mk-spark down"/);
    assert.ok(!/script/.test(down));
    assert.equal((down.match(/,/g) || []).length, 3, "valeur non numérique ignorée");
    assert.match(T.sparkSVG([5]), /—/); assert.match(T.sparkSVG(null), /—/);
  });
  test("le tableau affiche la courbe d'un an de chaque instrument publié", () => {
    const { CK, T } = setup();
    T.setResume(RES);
    const h = T.tableHTML([bySym(CK, "CW8"), bySym(CK, "WPEA")], {}, null);
    assert.match(h, />Courbe 1 an</); assert.equal((h.match(/mk-spark/g) || []).length, 1);
    assert.match(h, /jusqu'au 16\/11\/2026/);
  });
  test("courbes de taux : 3 tracés (aujourd'hui, 1 mois, 1 an), libellés échappés, rien sans données", () => {
    const { T } = setup();
    const c = { label: "<b>Zone euro</b>", src: "BCE", mats: ["3M", "2Y", "10Y"], dates: ["2026-11-13", "2026-10-13", "2025-11-13"], vals: [[2.6, 3.0, 3.4], [2.7, 3.1, 3.3], [2.9, 3.0, 3.0]] };
    const h = T.curvesHTML({ ea: c, estr: { d: "2026-11-16", v: 2.44 }, depo: { d: "2026-11-17", v: 2.5 } });
    assert.equal((h.match(/<polyline/g) || []).length, 3);
    assert.ok(!h.includes("<b>Zone")); assert.match(h, /&lt;b&gt;Zone euro/);
    assert.match(h, /€STR \(BCE\)<\/em><b>2,440 %/); assert.match(h, /Taux de dépôt BCE<\/em><b>2,50 %/); assert.match(h, /13\/11\/2026/);
    assert.equal(T.curvesHTML(null), ""); assert.equal(T.curveSVG({ mats: [], vals: [] }), "");
  });
  test("fiche : statistiques calculées par le Desk sur l'historique, source et note de nettoyage échappée", () => {
    const { CK, T } = setup();
    T.setResume(RES);
    const cw8 = bySym(CK, "CW8"), D = 864e5, t0 = Date.parse("2016-01-04T16:30:00Z");
    const bars = Array.from({ length: 2600 }, (_, k) => ({ timestamp: t0 + k * D, close: 100 * Math.pow(1.0003, k), source: "yahoo" }));
    const h = T.histStatsHTML(cw8, bars);
    assert.match(h, /Calculé par le Desk sur 2\s600 clôtures/); assert.match(h, /source : Yahoo Finance/);
    assert.match(h, /\/an\)/, "3, 5 et 10 ans annualisés"); assert.match(h, /Volatilité sur 1 an/);
    assert.match(h, /Données nettoyées/); assert.ok(!h.includes("<img")); assert.match(h, /&lt;img/);
    assert.match(T.histStatsHTML(cw8, []), /pas encore publié/);
    const fr = CK.ref.get("tv:TVC:FR10Y");
    const hb = T.histStatsHTML(fr, bars.slice(0, 400).map((b, k) => ({ ...b, close: 3 + k / 1000, source: "bce" })));
    assert.match(hb, / pb</); assert.ok(!/Volatilité/.test(hb)); assert.match(hb, /BCE \(moyenne mensuelle\)/);
  });
  test("start() lit le résumé et les taux du robot une seule fois (puis au plus toutes les 30 min)", async () => {
    const s = setup((url, init, CK) => {
      if (url.includes("scanner.tradingview.com")) return tvHandler(url, init, CK);
      if (url.endsWith("/data/resume.json")) return resp(200, RES);
      if (url.endsWith("/data/taux.json")) return resp(200, { estr: { d: "2026-11-16", v: 2.44 } });
      return resp(404);
    });
    s.CK.mk.start(); await s.clk.tick(50);
    const robot = s.calls.filter((c) => /resume|taux/.test(c.url));
    assert.equal(robot.length, 2);
    assert.ok(robot.every((c) => c.url.startsWith("https://lafouge-stack.github.io/Desk/data/")));
    s.CK.mk.stop(); s.CK.mk.start(); await s.clk.tick(50);
    assert.equal(s.calls.filter((c) => /resume|taux/.test(c.url)).length, 2, "pas de nouvelle lecture avant 30 min");
    s.CK.mk.stop();
  });
});
