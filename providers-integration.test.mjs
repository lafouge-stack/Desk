// Test d'intégration : les VRAIS models.js, datakit.js, fx.js, pea.js et providers.js chargés ensemble,
// comme dans index.html (même ordre que build.mjs). Faux réseau et fausse horloge injectés via CK.dk.env.
// Vérifie surtout que les nouveaux appels ne peuvent pas gêner le crypto existant (budget, disjoncteur, onglet caché).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeContext } from "./vmkit.mjs";

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
function fakeClock(t0 = Date.parse("2026-11-16T14:00:00Z")) {
  let t = t0, seq = 0; const q = [];
  return {
    now: () => t,
    setTimeout: (f, ms) => { const h = ++seq; q.push({ h, at: t + Math.max(0, Number(ms) || 0), f }); return h; },
    clearTimeout: (h) => { const i = q.findIndex((x) => x.h === h); if (i >= 0) q.splice(i, 1); },
    pending: () => q.length,
    async tick(ms) {
      const end = t + ms;
      for (;;) { await flush(); q.sort((a, b) => a.at - b.at || a.h - b.h); const n = q[0]; if (!n || n.at > end) break; q.shift(); t = n.at; n.f(); }
      t = end; await flush();
    }
  };
}
const resp = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => JSON.parse(JSON.stringify(body)), text: async () => JSON.stringify(body) });

/** Réponse type du scanner TradingView (colonnes dans l'ordre de CK.mkt.TV_COLS). */
function tvRows(CK, syms) {
  const cols = CK.mkt.TV_COLS;
  const base = { "EURONEXT:CW8": 714.07, "TVC:GOLD": 3881.2, "TVC:FR10Y": 3.41, "SP:SPX": 6850.5, "NASDAQ:AAPL": 251.2 };
  return { totalCount: syms.length, data: syms.filter((s) => base[s]).map((s) => ({ s, d: cols.map((c) => ({ close: base[s], change: 0.5, currency: s === "EURONEXT:CW8" ? "EUR" : "USD", update_mode: s.startsWith("TVC") ? "streaming" : "delayed_streaming_900", last_bar_update_time: 1794830000, "Perf.Y": 12.3, description: "<b>Desc</b> " + s })[c] ?? null) })) };
}

function setup(handler) {
  const { CK, load } = makeContext();
  for (const f of ["models.js", "datakit.js", "fx.js", "pea.js", "providers.js"]) load(f);
  CK.models.setData("referentiel", JSON.parse(readFileSync(new URL("./referentiel.json", import.meta.url), "utf8")));
  CK.cfg = () => ({ id: "test", data: "https://lafouge-stack.github.io/Desk" });
  CK.NET = {};
  const clk = fakeClock(), flags = { hidden: false, online: true }, calls = [];
  const fetch = (url, init) => { calls.push({ url, init }); return Promise.resolve(handler(url, init, calls.length)); };
  CK.dk.env = { fetch, now: clk.now, random: () => 0.5, setTimeout: clk.setTimeout, clearTimeout: clk.clearTimeout, hidden: () => flags.hidden, online: () => flags.online, indexedDB: null };
  return { CK, clk, flags, calls };
}
const tvHandler = (CK) => (url, init) => url.includes("scanner.tradingview.com") ? resp(200, tvRows(CK, JSON.parse(init.body).symbols.tickers)) : resp(404);

test("ordre de build : les nouveaux modules sont juste après core.js", () => {
  const src = readFileSync(new URL("./build.mjs", import.meta.url), "utf8");
  const js = JSON.parse(src.match(/const JS = (\[[^\]]*\])/)[1]);
  assert.deepEqual(js.slice(0, 7), ["core", "models", "datakit", "fx", "calendars", "pea", "providers"]);
});

test("un seul POST TradingView pour actions, indice, or et taux mélangés ; en-têtes et URL corrects", async () => {
  let ctx; const s = setup((u, i) => tvHandler(ctx)(u, i)); ctx = s.CK;
  const { CK, calls } = s;
  const p = CK.mkt.quotes(["isin:LU1681043599", "tv:TVC:GOLD", "tv:TVC:FR10Y", "tv:SP:SPX", "isin:US0378331005"]);
  await s.clk.tick(10);
  const m = await p;
  const tv = calls.filter((c) => c.url.includes("tradingview"));
  assert.equal(tv.length, 1, "un seul POST");
  assert.match(tv[0].url, /global\/scan\?label-product=desk-marches$/);
  assert.equal(tv[0].init.method, "POST");
  assert.equal(tv[0].init.headers["Content-Type"], "text/plain;charset=UTF-8");
  assert.equal(Object.keys(m).length, 5);
  const cw8 = m["isin:LU1681043599"];
  assert.equal(cw8.last, 714.07);
  assert.equal(cw8.currency, "EUR");
  assert.equal(cw8.delay_s, 900);
  assert.equal(cw8.src, "scan", "cotation pour l'affichage seulement");
  assert.equal(m["tv:TVC:GOLD"].delay_s, 0);
  assert.ok(!/[<>]/.test(cw8.info.description), "texte externe nettoyé");
});

test("cache de 60 s : un deuxième appel immédiat ne refait pas de POST", async () => {
  let ctx; const s = setup((u, i) => tvHandler(ctx)(u, i)); ctx = s.CK;
  const p1 = s.CK.mkt.quotes(["isin:LU1681043599"]); await s.clk.tick(10); await p1;
  const p2 = s.CK.mkt.quotes(["isin:LU1681043599"]); await s.clk.tick(10); await p2;
  assert.equal(s.calls.length, 1);
});

test("le screener crypto a reçu un 429 de TradingView (CK.NET.tvscan) → aucun appel des Marchés pendant 10 min", async () => {
  let ctx; const s = setup((u, i) => tvHandler(ctx)(u, i)); ctx = s.CK;
  const t = s.clk.now();
  s.CK.NET.tvscan = { lastErr: t - 60000, lastOk: t - 120000, code: 429, calls: 3, err: 1 };
  const p = s.CK.mkt.quotes(["isin:LU1681043599", "tv:TVC:GOLD"]); await s.clk.tick(10);
  const m = await p;
  assert.equal(s.calls.length, 0, "aucun appel réseau");
  assert.deepEqual(Object.keys(m), [], "rien à afficher, mais pas d'erreur");
  assert.equal(s.CK.mkt.status("equity").paused, true);
});

test("un 429 reçu par les Marchés met TradingView en pause et sert les dernières valeurs", async () => {
  let ctx, n = 0;
  const s = setup((u, i) => { n++; return n === 1 ? tvHandler(ctx)(u, i) : resp(429); }); ctx = s.CK;
  const p1 = s.CK.mkt.quotes(["isin:LU1681043599"]); await s.clk.tick(10); await p1;
  await s.clk.tick(61000); // le cache de 60 s expire
  const p2 = s.CK.mkt.quotes(["isin:LU1681043599"]); await s.clk.tick(120000);
  const m2 = await p2;
  assert.equal(m2["isin:LU1681043599"].stale, true, "dernière valeur marquée obsolète");
  const before = s.calls.length;
  const p3 = s.CK.mkt.quotes(["isin:LU1681043599"]); await s.clk.tick(10); await p3;
  assert.equal(s.calls.length, before, "plus aucun appel pendant la pause");
});

test("onglet caché : aucun appel TradingView", async () => {
  let ctx; const s = setup((u, i) => tvHandler(ctx)(u, i)); ctx = s.CK;
  s.flags.hidden = true;
  const p = s.CK.mkt.quotes(["isin:LU1681043599"]); await s.clk.tick(10); await p;
  assert.equal(s.calls.length, 0);
});

test("budget : au plus 4 POST TradingView par minute, même si on en demande 10", async () => {
  let ctx; const s = setup((u, i) => tvHandler(ctx)(u, i)); ctx = s.CK;
  const ids = ["isin:LU1681043599", "tv:TVC:GOLD", "tv:TVC:FR10Y", "tv:SP:SPX", "isin:US0378331005", "isin:FR0011871128", "isin:FR0000121014", "isin:FR0000120271", "isin:NL0000235190", "isin:FR0000121972"];
  const ps = [];
  for (const id of ids) { ps.push(s.CK.mkt.quotes([id])); await s.clk.tick(1); }
  await s.clk.tick(59000);
  const inMinute = s.calls.filter((c) => c.url.includes("tradingview")).length;
  assert.ok(inMinute <= 4, `${inMinute} POST en une minute`);
  await s.clk.tick(240000);
  await Promise.all(ps);
});

test("robot sans historiques (404) : history() renvoie [], plus aucun appel, et ni le robot ni Connexions ne passent en erreur", async () => {
  const s = setup(() => resp(404));
  let netErr = 0; s.CK.netErr = () => { netErr++; };
  const p1 = s.CK.mkt.history("isin:LU1681043599", { from: "2025-01-01" }); await s.clk.tick(10);
  assert.deepEqual([...(await p1)], []);
  const n1 = s.calls.length;
  const p2 = s.CK.mkt.history("isin:FR0011871128"); await s.clk.tick(10);
  assert.deepEqual([...(await p2)], []);
  assert.equal(s.calls.length, n1, "l'absence de marches-meta.json est mémorisée");
  assert.equal(netErr, 0, "un 404 attendu n'est pas une panne");
  assert.notEqual(s.CK.dk.status("robotdata").state, "hors_ligne");
});

test("historique du robot : fichier assaini, barres PriceBar triées, filtre from/to", async () => {
  const day = 864e5, t0 = Date.parse("2026-01-02T16:30:00Z");
  const hist = { id: "isin:LU1681043599", ccy: "EUR", src: "Yahoo", t: [t0 + 2 * day, t0, t0 + day], o: [3, 1, 2], h: [3, 1, 2], l: [3, 1, 2], c: [3, 1, 2], v: [1, 1, 1] };
  const s = setup((url) => url.endsWith("/marches-meta.json") ? resp(200, { v: 1, files: ["isin_LU1681043599"] }) : url.endsWith("/hist/isin_LU1681043599.json") ? resp(200, hist) : resp(404));
  const p = s.CK.mkt.history("isin:LU1681043599", { from: "2026-01-03" }); await s.clk.tick(10);
  const bars = await p;
  assert.deepEqual([...bars.map((b) => b.close)], [2, 3]);
  assert.equal(bars[0].currency, "EUR");
  assert.equal(bars[0].granularity, "1d");
});

test("crypto : cotations depuis le flux OKX existant, sans aucun appel réseau", async () => {
  const s = setup(() => { throw new Error("aucun appel attendu"); });
  s.CK.S = { tick: { "BTC-USDT": { last: 65000, open: 64000, high: 65500, low: 63800, ts: s.clk.now() } } };
  const p = s.CK.mkt.quotes(["crypto:BTC"]); await s.clk.tick(10);
  const m = await p;
  assert.equal(m["crypto:BTC"].last, 65000);
  assert.equal(m["crypto:BTC"].currency, "USDT");
  assert.equal(s.calls.length, 0);
});

test("historique crypto : Binance (pas OKX), bougies non clôturées exclues", async () => {
  const day = 864e5, now = Date.parse("2026-11-16T14:00:00Z"), d0 = Date.parse("2026-11-14T00:00:00Z");
  const k = (ot) => [ot, "1", "2", "0.5", "1.5", "10", ot + day - 1];
  const s = setup((url) => { assert.match(url, /data-api\.binance\.vision\/api\/v3\/klines\?symbol=BTCUSDT/); return resp(200, [k(d0), k(d0 + day), k(d0 + 2 * day)]); });
  assert.equal(s.clk.now(), now);
  const p = s.CK.mkt.history("crypto:BTC"); await s.clk.tick(10);
  const bars = await p;
  assert.equal(bars.length, 2, "la bougie du jour (pas encore clôturée) est exclue");
  assert.ok(s.calls.every((c) => !c.url.includes("okx.com")));
});

test("désabonnement : plus aucune minuterie active", async () => {
  let ctx; const s = setup((u, i) => tvHandler(ctx)(u, i)); ctx = s.CK;
  s.CK.S = { tick: { "BTC-USDT": { last: 1, open: 1, high: 1, low: 1, ts: s.clk.now() } } };
  const stop = s.CK.mkt.subscribe(["crypto:BTC", "isin:LU1681043599"], () => {});
  await s.clk.tick(130000);
  stop();
  await s.clk.tick(10);
  const before = s.calls.length;
  await s.clk.tick(600000);
  assert.equal(s.calls.length, before, "aucun appel après stop()");
  assert.equal(s.clk.pending(), 0, "aucune minuterie restante");
});

test("PEA + référentiel + garde-fou : un ETF éligible passe en PEA, un ETC or jamais", () => {
  const { CK } = setup(() => resp(404));
  const cw8 = CK.ref.byIsin("LU1681043599"), gold = CK.ref.byIsin("FR0013416716");
  assert.equal(CK.pea.allowedIn(cw8, "PEA").ok, true);
  assert.equal(CK.pea.allowedIn(gold, "PEA").ok, false);
  assert.equal(CK.pea.allowedIn(gold, "CTO").ok, true);
  const prefs = CK.models.normPrefs({ classes: { actions: true }, vehicles: { etf: true } });
  assert.equal(CK.allow(cw8, prefs), true);
  assert.equal(CK.allow(gold, prefs), false, "or non coché → jamais proposé");
});
