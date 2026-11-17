// Tests de providers.js (CK.mkt) : scanner TradingView, historiques du robot et de Binance, crypto depuis CK.S,
// registre (providerFor, quotes, history, subscribe, status). Aucun réseau réel : un faux CK.dk respecte
// l'interface de datakit (provider, fetch, status, log, env) et enregistre chaque appel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeContext } from "./vmkit.mjs";

/* ---------- Fixtures RÉELLES (raccourcies) relevées le 13/11/2026 ----------
   POST https://scanner.tradingview.com/global/scan?label-product=desk-marches (Content-Type text/plain;charset=UTF-8),
   tickers EURONEXT:CW8, TVC:GOLD, TVC:FR10Y, SP:SPX, NASDAQ:AAPL, FX_IDC:EURUSD, NYMEX:NG1!, EURONEXT:ZZZNOPE123 :
   200, totalCount 7, le ticker inexistant est simplement absent de data. Lignes gardées : CW8, GOLD, FR10Y, SPX. */
const TV_REAL = { totalCount: 7, data: [
  { s: "EURONEXT:CW8", d: ["CW8", "Amundi MSCI World Swap -UCITS ETF- Capitalisation", "fund", "etf", "EURONEXT", "EUR", "LU1681043599", 714.16, 711.5, 714.47, 710.27, 2927, -0.1216732165083989, 4.46280991735537, -0.538974694650642, 1.3697463485259227, 7.97744291102445, 16.97919923892103, 17.30022244271766, 2310668.8221279997, "delayed_streaming_900", 1794576398, 719.95, 583.3146, 8360.9, 7631468017.906966, 0.38, "Luxembourg", "Miscellaneous"] },
  { s: "TVC:GOLD", d: ["GOLD", "Gold", "commodity", "cfd", "TVC", "USD", null, 3880.909, 3876.4, 3923.135, 3875.2, 0, 0.11476966097934893, -5.068149017881162, -6.734252474688366, -10.82187348771629, -16.607739911470198, -7.487711619968446, -10.128153172451011, null, "streaming", 1794576406, 5598.75, 3852.62, 0, null, null, null, null] },
  { s: "TVC:FR10Y", d: ["FR10Y", "France 10 Year Government Bonds Yield", "bond", "government", "TVC", null, null, 4.9019, 4.8617, 4.9174, 4.8525, null, 1.3270769167166316, 2.7571602297982962, 1.041151245258132, 23.547947968135524, 28.33948726006232, 44.774311709795576, 37.30703499285574, null, "streaming", 1794576417, 5.1415, 3.2163, null, null, null, null, null] },
  { s: "SP:SPX", d: ["SPX", "S&P 500", "index", "main", "SP", null, "US78378X1072", 7592.4, 7550.84, 7652.76, 7550.84, 3182097606, -0.3540970525160902, -1.1241456909484995, -2.602475603795645, -2.743832142033673, 1.978345518064877, 10.551168719977504, 10.384974942244309, null, "delayed_streaming_600", 1794562847, 7844.52, 6316.91, 3644176196.6, null, null, null, null] }
] };
// GET https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=3 à 1794576428 s (13/11/2026 13:27 UTC) :
// la 3e bougie (closeTime 1794614399999) n'est pas clôturée.
const BIN_REAL = [
  [1794355200000, "73796.06000000", "74811.45000000", "73209.12000000", "74015.19000000", "16145.87951000", 1794441599999, "1194367325.89646630", 3704443, "8248.81240000", "610236272.18600950", "0"],
  [1794441600000, "74015.20000000", "74217.49000000", "71113.06000000", "71460.00000000", "15228.24045000", 1794527999999, "1102718687.94971090", 3537912, "7465.64423000", "540900392.65919480", "0"],
  [1794528000000, "71460.00000000", "71514.01000000", "67568.00000000", "69280.65000000", "21077.02612000", 1794614399999, "1459828155.97673090", 4194522, "10013.03659000", "693235571.58135690", "0"]
];
const NOW = 1794576428000;
const DAY = 864e5;
const TV_URL = "https://scanner.tradingview.com/global/scan?label-product=desk-marches";
const SPEC_COLS = ["name", "description", "type", "subtype", "exchange", "currency", "isin", "close", "open", "high", "low", "volume", "change", "Perf.W", "Perf.1M", "Perf.3M", "Perf.6M", "Perf.Y", "Perf.YTD", "Value.Traded", "update_mode", "last_bar_update_time", "price_52_week_high", "price_52_week_low", "average_volume_10d_calc", "aum", "expense_ratio", "country", "sector"];

/* ---------- Faux datakit (interface de la spécification) ---------- */
function fakeDk(handler) {
  const dk = {
    t: NOW, isHidden: false, calls: [], logs: [], provs: {}, timers: [],
    provider(id, o) { dk.provs[id] = o; },
    async fetch(url, o) {
      dk.calls.push({ url, ...o });
      const data = await handler(url, o, dk);
      if (o.validate) { const v = o.validate(data); if (v !== true) throw new Error("réponse invalide : " + v); }
      return { data, stale: false, ts: dk.t, from: "net" };
    },
    status(id) { return { state: "connectee", label: "Connectée", id }; },
    log(level, provider, msg, extra) { dk.logs.push({ level, provider, msg, extra }); }
  };
  dk.env = {
    now: () => dk.t, random: () => 0.5, hidden: () => dk.isHidden, online: () => true,
    setTimeout: (f, ms) => { dk.timers.push({ f, ms, live: true }); return dk.timers.length; },
    clearTimeout: (id) => { const t = dk.timers[id - 1]; if (t) t.live = false; }
  };
  return dk;
}
/** Exécute les minuteries en attente (une génération). */
function fire(dk) { const due = dk.timers.filter((t) => t.live); due.forEach((t) => { t.live = false; }); due.forEach((t) => t.f()); return due.length; }
const settle = () => new Promise((r) => setTimeout(r, 0));
const notFound = () => Object.assign(new Error("HTTP 404"), { status: 404 });
/** Réponse du scanner pour les tickers demandés : lignes réelles si connues, sinon ligne synthétique (sauf "absents"). */
function tvHandler({ absent = ["EURONEXT:ZZZNOPE123"], fail = false } = {}) {
  const real = Object.fromEntries(TV_REAL.data.map((r) => [r.s, r]));
  return (url, o) => {
    if (fail) throw new Error("réseau coupé");
    const body = JSON.parse(o.body);
    return { totalCount: 0, data: body.symbols.tickers.filter((s) => !absent.includes(s)).map((s) => real[s] || { s, d: synth(s) }) };
  };
}
function synth(s) { const d = SPEC_COLS.map(() => null); d[0] = s.split(":")[1]; d[5] = "EUR"; d[7] = 10; d[12] = 1; d[20] = "delayed_streaming_900"; return d; }

function setup(handler, { tick, uni, data = "https://robot.example/" } = {}) {
  const { CK, load, timers } = makeContext();
  load("models.js");
  CK.S = { tick: tick || {}, uni: uni || null };
  CK.cfg = () => ({ data });
  const dk = fakeDk(handler || (() => { throw new Error("aucun réseau attendu"); }));
  CK.dk = dk;
  load("providers.js");
  return { CK, dk, mkt: CK.mkt, M: CK.models, vmTimers: timers };
}
const plain = (x) => JSON.parse(JSON.stringify(x));
/** deepEqual entre royaumes (objets créés dans node:vm) : on compare des copies JSON. */
const eq = (a, b, m) => assert.deepEqual(plain(a), b, m);
const I = (M, o) => M.normInstrument(o);

/* ---------- Chargement ---------- */
test("chargement sans effet : ni minuterie, ni réseau, ni appel à datakit ; pas de </script", () => {
  const src = readFileSync(new URL("./providers.js", import.meta.url), "utf8");
  assert.ok(!/<\/script/i.test(src) && !/<\/style/i.test(src));
  new Function(src); // même contrôle que build.mjs
  const { CK, load, timers, window } = makeContext();
  let net = 0; window.fetch = () => { net++; return Promise.reject(new Error("x")); };
  load("models.js"); load("providers.js");
  assert.equal(timers.length, 0); assert.equal(net, 0);
  eq(CK.mkt.providers().map((p) => p.id), ["crypto", "equity", "index", "commodity", "bond"]);
  for (const p of CK.mkt.providers()) for (const k of ["getQuotes", "getHistory", "status"]) assert.equal(typeof p[k], "function", p.id + "." + k);
  eq([...CK.mkt.TV_COLS], SPEC_COLS);
});

/* ---------- TvScanAdapter ---------- */
test("TradingView : réponse réelle → Quote exacte (CW8)", async () => {
  const { mkt, M, dk } = setup(tvHandler());
  const cw8 = I(M, { id: "isin:LU1681043599", symbol: "CW8", isin: "LU1681043599", vehicle: "etf", currency: "EUR", tickers: { tv: "EURONEXT:CW8" } });
  const q = await mkt.quotes([cw8]);
  const d = TV_REAL.data[0].d;
  eq(plain(q["isin:LU1681043599"]), {
    instrument_id: "isin:LU1681043599", last: 714.16, prev_close: 714.16 / (1 + d[12] / 100), open: 711.5, high: 714.47, low: 710.27,
    volume: 2927, value_traded: 2310668.8221279997, change_pct: -0.1216732165083989,
    perf: { w: d[13], m1: d[14], m3: d[15], m6: d[16], y1: d[17], ytd: d[18] },
    currency: "EUR", ts: 1794576398000, delay_s: 900, source: "TradingView", stale: false, src: "scan",
    info: { ticker: "EURONEXT:CW8", name: "CW8", description: "Amundi MSCI World Swap -UCITS ETF- Capitalisation", type: "fund", subtype: "etf",
      exchange: "EURONEXT", isin: "LU1681043599", high_52w: 719.95, low_52w: 583.3146, avg_volume_10d: 8360.9, aum: 7631468017.906966, ter: 0.38,
      country: "Luxembourg", sector: "Miscellaneous" }
  });
  assert.ok(Math.abs(q["isin:LU1681043599"].prev_close - 715.03) < 0.01);
  assert.equal(dk.calls.length, 1);
});

test("TradingView : delay_s selon update_mode, taux sans devise ni volume, symbole absent → pas de Quote + journal", async () => {
  const { mkt, dk } = setup(tvHandler());
  const ids = ["tv:TVC:GOLD", "tv:TVC:FR10Y", "tv:SP:SPX", "tv:EURONEXT:ZZZNOPE123"];
  const q = await mkt.quotes(ids);
  eq(Object.keys(q).sort(), ["tv:SP:SPX", "tv:TVC:FR10Y", "tv:TVC:GOLD"]);
  assert.equal(q["tv:TVC:GOLD"].delay_s, 0);
  assert.equal(q["tv:SP:SPX"].delay_s, 600);
  const fr = q["tv:TVC:FR10Y"];
  assert.equal(fr.delay_s, 0); assert.equal(fr.currency, null); assert.equal(fr.volume, null); assert.equal(fr.last, 4.9019);
  assert.equal(fr.perf.y1, 44.774311709795576); assert.equal(fr.ts, 1794576417000);
  for (const k in q) assert.equal(q[k].src, "scan");
  const w = dk.logs.filter((l) => l.msg === "symbole sans réponse");
  assert.equal(w.length, 1); assert.equal(w[0].level, "warn"); assert.equal(w[0].extra.symbol, "EURONEXT:ZZZNOPE123");
  assert.equal(mkt.last("tv:EURONEXT:ZZZNOPE123"), null);
});

test("TradingView : un seul POST text/plain pour N instruments, URL label-product, colonnes et provider tvscan2", async () => {
  const { mkt, dk } = setup(tvHandler());
  await mkt.quotes(["tv:EURONEXT:CW8", "tv:TVC:GOLD", "tv:SP:SPX", "tv:EURONEXT:CW8"]);
  assert.equal(dk.calls.length, 1);
  const c = dk.calls[0];
  assert.equal(c.url, TV_URL); assert.equal(c.method, "POST"); assert.equal(c.provider, "tvscan2");
  assert.equal(c.headers["Content-Type"], "text/plain;charset=UTF-8"); assert.equal(c.ttl, 60000);
  const body = JSON.parse(c.body);
  eq(body.symbols.tickers, ["EURONEXT:CW8", "SP:SPX", "TVC:GOLD"]);
  eq(body.columns, SPEC_COLS);
  eq(plain(dk.provs.tvscan2), { label: "TradingView (marchés)", rate: 0.2, burst: 2, budgetPerMin: 4, pauseHidden: true, guard: ["tvscan"], guardMs: 600000, timeout: 12000 });
  eq(plain(dk.provs.robotdata), { label: "Robot (historiques)", rate: 5, burst: 10, timeout: 15000 });
  assert.equal(c.validate({ data: [] }), true);
  assert.notEqual(c.validate({ error: "x" }), true);
});

test("TradingView : actions, indice, matière première et taux du même appel → toujours UN SEUL POST", async () => {
  const { mkt, M, dk } = setup(tvHandler());
  const list = [
    I(M, { id: "isin:LU1681043599", vehicle: "etf", tickers: { tv: "EURONEXT:CW8" } }),
    I(M, { id: "tv:SP:SPX", vehicle: "indice", tickers: { tv: "SP:SPX" } }),
    I(M, { id: "tv:TVC:GOLD", asset_class: "or", vehicle: "indice", tickers: { tv: "TVC:GOLD" } }),
    I(M, { id: "xau-etc", asset_class: "or", vehicle: "etc_etn", tickers: { tv: "XETR:4GLD" } }),
    I(M, { id: "tv:TVC:FR10Y", asset_class: "oblig_etat", vehicle: "taux", tickers: { tv: "TVC:FR10Y" } })
  ];
  eq(list.map((i) => mkt.providerFor(i).id), ["equity", "index", "index", "commodity", "bond"]);
  const q = await mkt.quotes(list);
  assert.equal(dk.calls.length, 1);
  assert.equal(JSON.parse(dk.calls[0].body).symbols.tickers.length, 5);
  assert.equal(Object.keys(q).length, 5);
});

test("TradingView : au-delà de 200 tickers, découpage en plusieurs POST", async () => {
  const { mkt, dk } = setup(tvHandler());
  const ids = Array.from({ length: 250 }, (_, k) => "tv:EURONEXT:T" + String(k).padStart(3, "0"));
  const q = await mkt.quotes(ids);
  assert.equal(dk.calls.length, 2);
  eq(dk.calls.map((c) => JSON.parse(c.body).symbols.tickers.length), [200, 50]);
  assert.equal(Object.keys(q).length, 250);
  assert.equal(q["tv:EURONEXT:T123"].last, 10);
});

test("quotes() ne rejette jamais : échec sans historique → {}, puis dernières valeurs marquées stale", async () => {
  let mode = "fail";
  const ok = tvHandler(), ko = tvHandler({ fail: true });
  const { mkt, dk } = setup((u, o, d) => (mode === "fail" ? ko : ok)(u, o, d));
  eq(await mkt.quotes(["tv:TVC:GOLD"]), {});
  assert.ok(dk.logs.some((l) => l.level === "warn" && /scanner/.test(l.msg)));
  mode = "ok";
  const a = await mkt.quotes(["tv:TVC:GOLD"]);
  assert.equal(a["tv:TVC:GOLD"].stale, false);
  mode = "fail";
  const b = await mkt.quotes(["tv:TVC:GOLD", "inconnu:xx"]);
  assert.equal(b["tv:TVC:GOLD"].stale, true);
  assert.equal(b["tv:TVC:GOLD"].last, 3880.909);
  assert.equal(b["tv:TVC:GOLD"].src, "scan");
  assert.equal(mkt.last("tv:TVC:GOLD").stale, false, "la valeur mémorisée n'est pas modifiée");
  // datakit absent : toujours une promesse résolue
  const { CK } = setup(tvHandler());
  delete CK.dk;
  eq(await CK.mkt.quotes(["tv:TVC:GOLD"]), {});
  eq(await CK.mkt.history("tv:TVC:GOLD"), []);
});

test("TradingView : symbole absent après un succès → dernière valeur stale ; ts absent → maintenant ; cours nul → pas de Quote", async () => {
  let absent = [];
  const { mkt, dk, CK } = setup((u, o, d) => tvHandler({ absent })(u, o, d));
  await mkt.quotes(["tv:TVC:GOLD"]);
  absent = ["TVC:GOLD"];
  const q = await mkt.quotes(["tv:TVC:GOLD"]);
  assert.equal(q["tv:TVC:GOLD"].stale, true);
  const row = { s: "X:Y", d: synth("X:Y") };
  const t = CK.mkt._t;
  assert.equal(t.tvQuote({ id: "a" }, row).ts, NOW);
  row.d[7] = null; assert.equal(t.tvQuote({ id: "a" }, row), null);
  row.d[7] = 0; assert.equal(t.tvQuote({ id: "a" }, row), null);
  assert.equal(t.tvDelay("delayed_streaming_900"), 900); assert.equal(t.tvDelay("delayed_streaming_600"), 600);
  assert.equal(t.tvDelay("streaming"), 0); assert.equal(t.tvDelay(null), null);
  assert.ok(dk.logs.length >= 1);
});

/* ---------- providerFor ---------- */
test("providerFor() pour chaque classe et véhicule", () => {
  const { mkt, M } = setup();
  const pf = (o) => mkt.providerFor(I(M, o)).id;
  assert.equal(pf({ id: "crypto:BTC", asset_class: "crypto", vehicle: "spot_crypto" }), "crypto");
  assert.equal(pf({ id: "crypto:USDC", asset_class: "stablecoin", vehicle: "spot_crypto" }), "crypto");
  assert.equal(pf({ id: "c", asset_class: "crypto" }), "crypto", "véhicule par défaut sans ticker TV");
  assert.equal(pf({ id: "btce", asset_class: "crypto", vehicle: "etc_etn", tickers: { tv: "XETR:BTCE" } }), "equity", "ETN crypto coté");
  assert.equal(pf({ id: "a", asset_class: "actions", vehicle: "titre" }), "equity");
  assert.equal(pf({ id: "b", asset_class: "actions", vehicle: "etf" }), "equity");
  assert.equal(pf({ id: "f", asset_class: "actions", vehicle: "fonds" }), "equity");
  assert.equal(pf({ id: "r", asset_class: "immobilier_cote", vehicle: "titre" }), "equity");
  assert.equal(pf({ id: "i", asset_class: "actions", vehicle: "indice" }), "index");
  for (const c of ["or", "argent", "energie", "petrole", "gaz", "agricole", "matieres_premieres"]) assert.equal(pf({ id: c, asset_class: c, vehicle: "etc_etn" }), "commodity", c);
  for (const c of ["obligations", "oblig_etat", "oblig_entreprise"]) assert.equal(pf({ id: c, asset_class: c, vehicle: "etf" }), "bond", c);
  assert.equal(pf({ id: "t", asset_class: "obligations", vehicle: "taux" }), "bond");
  assert.equal(pf({ id: "t2", asset_class: "actions", vehicle: "taux" }), "bond");
  assert.equal(pf({ id: "d", asset_class: "devises", vehicle: "cash" }), "equity", "défaut");
  assert.equal(pf({ id: "x", asset_class: "actions", data_source: "commodity" }), "commodity", "data_source enregistré prioritaire");
  assert.equal(pf({ id: "y", asset_class: "or", data_source: "tvscan" }), "commodity", "data_source non enregistré → classe");
  assert.equal(mkt.providerFor(null), null);
});

/* ---------- Crypto ---------- */
test("crypto : CK.S.tick puis CK.S.uni, sans aucun appel réseau", async () => {
  const tick = { "BTC-USDT": { last: 70000, open: 68000, high: 71000, low: 67500, ts: NOW - 1000 } };
  const uni = { spot: [{ inst: "ETH-USDT", base: "ETH", last: 2500, chg: 2, usd: 1e9 }], perp: [{ inst: "SOL-USDT-SWAP", base: "SOL", last: 150, chg: -1, usd: 5e8 }] };
  const { mkt, dk } = setup(null, { tick, uni });
  const q = await mkt.quotes(["crypto:BTC", "crypto:ETH", "crypto:SOL", "crypto:NOPE", "crypto:USDT"]);
  assert.equal(dk.calls.length, 0);
  eq(Object.keys(q).sort(), ["crypto:BTC", "crypto:ETH", "crypto:SOL", "crypto:USDT"]);
  const b = q["crypto:BTC"];
  assert.equal(b.last, 70000); assert.equal(b.prev_close, 68000); assert.equal(b.high, 71000);
  assert.ok(Math.abs(b.change_pct - (70000 / 68000 - 1) * 100) < 1e-12);
  assert.equal(b.currency, "USDT"); assert.equal(b.delay_s, 0); assert.equal(b.ts, NOW - 1000); assert.equal(b.stale, false); assert.equal(b.src, "scan");
  const e = q["crypto:ETH"];
  assert.equal(e.last, 2500); assert.equal(e.delay_s, 60); assert.equal(e.change_pct, 2); assert.equal(e.value_traded, 1e9);
  assert.ok(Math.abs(e.prev_close - 2500 / 1.02) < 1e-9); assert.equal(e.ts, NOW); assert.equal(e.src, "scan");
  assert.equal(q["crypto:SOL"].last, 150);
  assert.equal(q["crypto:USDT"].last, 1);
  // tick prioritaire sur uni
  const { mkt: m2 } = setup(null, { tick, uni: { spot: [{ base: "BTC", last: 1, chg: 0, usd: 1 }] } });
  assert.equal((await m2.quotes(["crypto:BTC"]))["crypto:BTC"].last, 70000);
});

test("crypto : flux arrêté depuis plus de 5 min → stale ; ticker OKX explicite ; statut", async () => {
  const tick = { "ARB-USDT": { last: 1.2, open: 1.1, high: 1.3, low: 1, ts: NOW - 600000 } };
  const { mkt, M, dk } = setup(null, { tick });
  const arb = I(M, { id: "x:arb", symbol: "ARBITRUM", asset_class: "crypto", vehicle: "spot_crypto", tickers: { okx: "ARB-USDT" } });
  const q = await mkt.quotes([arb]);
  assert.equal(q["x:arb"].stale, true);
  assert.equal(mkt.status("crypto").state, "obsolete");
  dk.t = NOW - 600000 + 1000;
  assert.equal(mkt.status("crypto").state, "connectee");
  assert.equal(mkt.status("crypto").label, "Connectée");
  assert.equal(mkt.status("tv:TVC:GOLD").state, "connectee");
  assert.equal(mkt.status("equity").hist.id, "robotdata");
  eq(Object.keys(mkt.status()), ["crypto", "equity", "index", "commodity", "bond"]);
});

test("crypto : historique Binance réel → PriceBar, bougie non clôturée exclue", async () => {
  const { mkt, dk } = setup((url) => BIN_REAL);
  const bars = await mkt.history("crypto:BTC");
  assert.equal(dk.calls.length, 1);
  assert.equal(dk.calls[0].url, "https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1000");
  assert.equal(dk.calls[0].provider, "binhist");
  assert.equal(bars.length, 2);
  eq(plain(bars[0]), { instrument_id: "crypto:BTC", timestamp: 1794441600000, open: 73796.06, high: 74811.45, low: 73209.12, close: 74015.19,
    volume: 16145.87951, currency: "USDT", source: "Binance", granularity: "1d" });
  assert.equal(bars[0].timestamp, BIN_REAL[0][0] + DAY, "horodatage = clôture exacte = ouverture + 1 jour");
  assert.equal(bars[1].close, 71460);
});

test("crypto : historique Binance paginé par startTime, from/to sur l'ouverture", async () => {
  const start = Date.UTC(2020, 0, 1), total = 1500;
  const all = Array.from({ length: total }, (_, k) => { const o = start + k * DAY; return [o, "1", "2", "0.5", String(1 + k), "10", o + DAY - 1]; });
  const page = (url) => {
    const p = new URL(url).searchParams, st = +p.get("startTime"), lim = +p.get("limit"), et = p.get("endTime");
    return all.filter((k) => k[0] >= st && (et == null || k[0] <= +et)).slice(0, lim);
  };
  const ctx = setup(page);
  const btc = I(ctx.M, { id: "crypto:BTC", asset_class: "crypto", vehicle: "spot_crypto", tickers: { binance: "BTCUSDT" } });
  // la dernière bougie de la série n'est pas clôturée
  ctx.dk.t = all[total - 1][6] - 1;
  const bars = await ctx.mkt.history(btc, { from: "2020-01-01" });
  assert.equal(ctx.dk.calls.length, 2);
  const st = ctx.dk.calls.map((c) => +new URL(c.url).searchParams.get("startTime"));
  eq(st, [start, all[999][0] + 1]);
  assert.equal(bars.length, total - 1);
  assert.equal(bars[0].timestamp, start + DAY);
  assert.ok(bars.every((b, k) => k === 0 || b.timestamp > bars[k - 1].timestamp));
  // from/to : jours UTC inclus, sur l'ouverture de la bougie
  const r = await ctx.mkt.history(btc, { from: "2020-01-10", to: "2020-01-12" });
  eq(r.map((b) => ctx.M.isoDate(b.timestamp - 1)), ["2020-01-10", "2020-01-11", "2020-01-12"]);
  assert.equal(new URL(ctx.dk.calls.at(-1).url).searchParams.get("endTime"), String(Date.UTC(2020, 0, 12) + DAY - 1));
});

/* ---------- RobotHistAdapter ---------- */
const HIST = { id: "isin:LU1681043599", ccy: "EUR", src: "yahoo", t: [Date.UTC(2026, 0, 2, 16), Date.UTC(2026, 0, 5, 16), Date.UTC(2026, 0, 6, 16), Date.UTC(2026, 1, 2, 16)],
  o: [600, 602, null, 610], h: [605, 606, 607, 612], l: [598, 600, 601, 608], c: [603, 604, 606, 611], v: [100, 200, 300, 400], div: [[Date.UTC(2026, 0, 5), 1.5]], split: [] };

test("robot : nom de fichier assaini, URL, conversion en PriceBar et filtre from/to", async () => {
  const { mkt, M, dk } = setup((url) => {
    if (url.endsWith("/data/marches-meta.json")) return { v: 7, files: ["isin_LU1681043599"] };
    if (url.endsWith("/data/hist/isin_LU1681043599.json")) return HIST;
    throw notFound();
  });
  assert.equal(mkt._t.fileOf("isin:LU1681043599"), "isin_LU1681043599");
  assert.equal(mkt._t.fileOf("tv:NYMEX:NG1!"), "tv_NYMEX_NG1_");
  assert.equal(mkt._t.fileOf("../x/é"), "___x__");
  const cw8 = I(M, { id: "isin:LU1681043599", vehicle: "etf", tickers: { tv: "EURONEXT:CW8" } });
  const bars = await mkt.history(cw8);
  eq(dk.calls.map((c) => c.url), ["https://robot.example/data/marches-meta.json", "https://robot.example/data/hist/isin_LU1681043599.json"]);
  assert.ok(dk.calls.every((c) => c.provider === "robotdata" && c.ttl === 6 * 36e5));
  assert.equal(dk.calls[1].cacheKey, "GET https://robot.example/data/hist/isin_LU1681043599.json#7");
  assert.equal(bars.length, 4);
  eq(plain(bars[2]), { instrument_id: "isin:LU1681043599", timestamp: Date.UTC(2026, 0, 6, 16), open: 606, high: 607, low: 601, close: 606,
    volume: 300, currency: "EUR", source: "yahoo", granularity: "1d" });
  const f = await mkt.history(cw8, { from: "2026-01-05", to: "2026-01-06" });
  eq(f.map((b) => b.close), [604, 606]);
  const f2 = await mkt.history(cw8, { from: Date.UTC(2026, 0, 6), to: Date.UTC(2026, 11, 31) });
  eq(f2.map((b) => b.close), [606, 611]);
  const m = await mkt.history(cw8, { granularity: "1M" });
  eq(m.map((b) => [b.close, b.open, b.high, b.low, b.volume, b.granularity]), [[606, 600, 607, 598, 600, "1M"], [611, 610, 612, 608, 400, "1M"]]);
  eq(plain(mkt.adapters().hist.events(cw8)), { div: [[Date.UTC(2026, 0, 5), 1.5]], split: [] });
  // fichier non listé dans marches-meta.json → aucun appel
  const n = dk.calls.length;
  eq(await mkt.history("tv:SP:SPX"), []);
  assert.equal(dk.calls.length, n);
});

test("robot : 404 mémorisé (fichier puis marches-meta.json) → plus aucun appel", async () => {
  const { mkt, dk } = setup((url) => { if (url.endsWith("marches-meta.json")) return { v: 1 }; throw notFound(); });
  eq(await mkt.history("tv:SP:SPX"), []);
  assert.equal(dk.calls.length, 2);
  eq(await mkt.history("tv:SP:SPX"), []);
  eq(await mkt.history("tv:SP:SPX", { from: "2020-01-01" }), []);
  assert.equal(dk.calls.length, 2, "fichier absent : plus redemandé");
  assert.ok(dk.logs.some((l) => l.provider === "robotdata" && /absent/.test(l.msg)));

  const ctx = setup(() => { throw notFound(); });
  eq(await ctx.mkt.history("tv:SP:SPX"), []);
  eq(await ctx.mkt.history("tv:TVC:GOLD"), []);
  eq(await ctx.mkt.history("tv:TVC:FR10Y"), []);
  assert.equal(ctx.dk.calls.length, 1, "robot sans marches-meta.json : un seul appel pour toute la session");

  // erreur réseau (pas 404) : rien de mémorisé, nouvel essai au prochain appel, jamais de rejet
  let n = 0;
  const c3 = setup(() => { n++; throw new Error("réseau coupé"); });
  eq(await c3.mkt.history("tv:SP:SPX"), []);
  eq(await c3.mkt.history("tv:SP:SPX"), []);
  assert.ok(n >= 4);
  // adresse du robot absente
  const c4 = setup(() => HIST, { data: "" });
  eq(await c4.mkt.history("tv:SP:SPX"), []);
  assert.equal(c4.dk.calls.length, 0);
});

/* ---------- subscribe ---------- */
test("subscribe crypto : relit CK.S.tick toutes les 2 s, n'émet que les changements, désabonnement définitif", async () => {
  const tick = { "BTC-USDT": { last: 70000, open: 69000, high: 70500, low: 68000, ts: NOW } };
  const { mkt, dk, CK } = setup(null, { tick });
  const got = [];
  const stop = mkt.subscribe(["crypto:BTC"], (m) => got.push(plain(m)));
  assert.equal(got.length, 1); assert.equal(got[0]["crypto:BTC"].last, 70000);
  assert.equal(dk.timers.filter((t) => t.live).length, 1); assert.equal(dk.timers[0].ms, 2000);
  fire(dk); assert.equal(got.length, 1, "rien de neuf");
  CK.S.tick["BTC-USDT"] = { last: 70100, open: 69000, high: 70500, low: 68000, ts: NOW + 500 };
  fire(dk); assert.equal(got.length, 2); assert.equal(got[1]["crypto:BTC"].last, 70100);
  assert.equal(mkt.last("crypto:BTC").last, 70100);
  stop();
  assert.equal(dk.timers.filter((t) => t.live).length, 0);
  CK.S.tick["BTC-USDT"].last = 1;
  assert.equal(fire(dk), 0); assert.equal(got.length, 2);
  assert.equal(dk.calls.length, 0);
});

test("subscribe autres : rafraîchit toutes les 60 s seulement si l'onglet est visible ; désabonnement arrête tout", async () => {
  const { mkt, dk } = setup(tvHandler());
  const got = [];
  const stop = mkt.subscribe(["tv:TVC:GOLD", "tv:EURONEXT:CW8"], (m) => got.push(m));
  await settle();
  assert.equal(dk.calls.length, 1); assert.equal(dk.calls[0].priority, "low");
  assert.equal(got.length, 1); eq(Object.keys(got[0]).sort(), ["tv:EURONEXT:CW8", "tv:TVC:GOLD"]);
  const live = dk.timers.filter((t) => t.live); assert.equal(live.length, 1); assert.equal(live[0].ms, 60000);
  dk.isHidden = true;
  fire(dk); await settle();
  assert.equal(dk.calls.length, 1, "onglet caché : aucun appel");
  assert.equal(dk.timers.filter((t) => t.live).length, 1, "mais la boucle continue");
  dk.isHidden = false;
  fire(dk); await settle();
  assert.equal(dk.calls.length, 2); assert.equal(got.length, 2);
  // désabonnement pendant une requête en vol : pas d'émission tardive
  fire(dk); stop(); await settle();
  assert.equal(got.length, 2);
  assert.equal(dk.timers.filter((t) => t.live).length, 0);
  assert.equal(fire(dk), 0);
});

test("subscribe mixte : crypto par relecture, TradingView par interrogation, un seul désabonnement", async () => {
  const tick = { "ETH-USDT": { last: 2500, open: 2400, high: 2550, low: 2390, ts: NOW } };
  const { mkt, dk } = setup(tvHandler(), { tick });
  const got = [];
  const stop = mkt.subscribe(["crypto:ETH", "tv:TVC:GOLD"], (m) => got.push(Object.keys(m)));
  await settle();
  eq(got.flat().sort(), ["crypto:ETH", "tv:TVC:GOLD"]);
  eq(dk.timers.filter((t) => t.live).map((t) => t.ms).sort(), [2000, 60000]);
  stop();
  assert.equal(dk.timers.filter((t) => t.live).length, 0);
});

/* ---------- Relecture adversariale : cas limites ---------- */
test("alias du référentiel : quotes(['tv:…']) et last('tv:…') répondent sous l'id demandé", async () => {
  const { mkt, M, CK } = setup(tvHandler());
  CK.ref.load([{ id: "isin:LU1681043599", symbol: "CW8", name: "Amundi MSCI World", isin: "LU1681043599", vehicle: "etf", tickers: { tv: "EURONEXT:CW8" } }]);
  const q = await mkt.quotes(["tv:EURONEXT:CW8"]);
  assert.equal(q["tv:EURONEXT:CW8"].last, 714.16);
  assert.equal(q["tv:EURONEXT:CW8"].instrument_id, "isin:LU1681043599");
  assert.equal(q["isin:LU1681043599"].last, 714.16);
  assert.equal(mkt.last("tv:EURONEXT:CW8").last, 714.16);
  const got = [];
  const stop = mkt.subscribe(["tv:EURONEXT:CW8"], (m) => got.push(Object.keys(m).sort()));
  await settle(); stop();
  eq(got, [["isin:LU1681043599", "tv:EURONEXT:CW8"]]);
});

test("désabonnement immédiat ou depuis l'abonné : aucune minuterie ne survit", async () => {
  const tick = { "BTC-USDT": { last: 70000, open: 69000, high: 70500, low: 68000, ts: NOW } };
  const { mkt, dk } = setup(tvHandler(), { tick });
  const stop = mkt.subscribe(["crypto:BTC", "tv:TVC:GOLD"], () => {});
  stop(); stop();
  await settle();
  assert.equal(dk.timers.filter((t) => t.live).length, 0);
  let h = null, calls = 0;
  h = mkt.subscribe(["crypto:BTC", "tv:TVC:GOLD"], () => { calls++; queueMicrotask(() => h()); });
  await settle();
  assert.ok(calls >= 1);
  assert.equal(dk.timers.filter((t) => t.live).length, 0, "plus de relecture après désabonnement");
});

test("subscribe crypto : cotations REST et parité USDT non réémises toutes les 2 s si rien ne change", () => {
  const uni = { spot: [{ inst: "ETH-USDT", base: "ETH", last: 2500, chg: 2, usd: 1e9 }] };
  const { mkt, dk, CK } = setup(null, { uni });
  const got = [];
  const stop = mkt.subscribe(["crypto:ETH", "crypto:USDT"], (m) => got.push(Object.keys(m).sort()));
  eq(got, [["crypto:ETH", "crypto:USDT"]]);
  dk.t += 2000; fire(dk); dk.t += 2000; fire(dk);
  assert.equal(got.length, 1, "rien de neuf");
  CK.S.uni.spot[0] = { inst: "ETH-USDT", base: "ETH", last: 2510, chg: 2.4, usd: 1e9 };
  dk.t += 2000; fire(dk);
  eq(got[1], ["crypto:ETH"]);
  // flux : une nouvelle transaction au même prix est réémise (horodatage), puis le passage en « stale » aussi
  CK.S.tick = { "ETH-USDT": { last: 2510, open: 2400, high: 2550, low: 2390, ts: dk.t } };
  fire(dk); assert.equal(got.length, 3);
  CK.S.tick["ETH-USDT"] = { ...CK.S.tick["ETH-USDT"], ts: dk.t + 1 }; fire(dk); assert.equal(got.length, 4);
  dk.t += 400000; fire(dk); assert.equal(got.length, 5);
  stop();
});

test("clés piégées (toString, constructor, __proto__) : jamais prises pour un provider, une granularité ou un id", async () => {
  const { mkt, M, dk } = setup(() => BIN_REAL);
  assert.equal(mkt.providerFor(I(M, { id: "a", data_source: "toString" })).id, "equity");
  assert.equal(mkt.providerFor({ id: "b", asset_class: "constructor", vehicle: "constructor" }).id, "equity");
  assert.equal(mkt.status("constructor").state, "inactif");
  eq(await mkt.quotes(["__proto__", "constructor", "toString"]), {});
  assert.equal(mkt.last("__proto__"), null);
  assert.equal(mkt.last("toString"), null);
  await mkt.history("crypto:BTC", { granularity: "constructor" });
  assert.match(dk.calls[0].url, /interval=1d&/);
});

test("subscribe : un provider dont subscribe lève ne casse pas l'abonnement aux autres", async () => {
  const { mkt, dk } = setup(tvHandler());
  mkt.register({ id: "crypto", label: "cassé", classes: ["crypto"], getQuotes: async () => [], getHistory: async () => [], status: () => ({}),
    subscribe() { throw new Error("boum"); } });
  const got = [];
  let stop;
  assert.doesNotThrow(() => { stop = mkt.subscribe(["crypto:BTC", "tv:TVC:GOLD"], (m) => got.push(m)); });
  await settle();
  assert.equal(typeof stop, "function");
  assert.ok(dk.logs.some((l) => l.level === "error"));
  assert.ok(got.some((m) => m["tv:TVC:GOLD"]), "TradingView toujours interrogé");
  stop();
  assert.equal(dk.timers.filter((t) => t.live).length, 0);
});

test("robot : files listés avec l'extension .json ; ccy en minuscules normalisée", async () => {
  const { mkt, dk } = setup((url) => {
    if (url.endsWith("/data/marches-meta.json")) return { version: "2026-11-13", files: ["tv_SP_SPX.json"] };
    if (url.endsWith("/data/hist/tv_SP_SPX.json")) return { ...HIST, id: "tv:SP:SPX", ccy: "usd" };
    throw notFound();
  });
  const bars = await mkt.history("tv:SP:SPX");
  assert.equal(bars.length, 4);
  assert.equal(bars[0].currency, "USD");
  assert.equal(dk.calls[1].cacheKey, "GET https://robot.example/data/hist/tv_SP_SPX.json#2026-11-13");
});

/* ---------- Compatibilité avec le VRAI datakit.js ---------- */
function realSetup(route, { data = "https://robot.example" } = {}) {
  const { CK, load } = makeContext();
  load("models.js"); load("datakit.js"); load("providers.js");
  CK.S = { tick: {}, uni: null };
  CK.cfg = () => ({ data });
  const calls = [];
  const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
  CK.dk.env.fetch = (url, init) => { calls.push({ url, init }); try { const [st, body] = route(url, init); return Promise.resolve(resp(st, body)); } catch (e) { return Promise.reject(e); } };
  CK.dk.env.hidden = () => false;
  return { CK, calls, mkt: CK.mkt };
}

test("vrai datakit : POST TradingView (en-tête, corps, provider), réglages conservés après CK.dk._reset()", async () => {
  const { CK, calls, mkt } = realSetup((url, init) => [200, tvHandler()(url, init)]);
  const q = await mkt.quotes(["tv:TVC:GOLD", "tv:EURONEXT:CW8"]);
  assert.equal(q["tv:TVC:GOLD"].last, 3880.909);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "text/plain;charset=UTF-8");
  eq(JSON.parse(calls[0].init.body).symbols.tickers, ["EURONEXT:CW8", "TVC:GOLD"]);
  assert.equal(CK.dk.status("tvscan2").state, "connectee");
  CK.dk._reset();
  await mkt.quotes(["tv:SP:SPX"]);
  const cfg = CK.dk.provider("tvscan2");
  assert.equal(cfg.budgetPerMin, 4); assert.equal(cfg.pauseHidden, true); eq([...cfg.guard], ["tvscan"]);
  assert.equal(CK.dk.provider("binhist").rate, 2);
});

test("vrai datakit : 404 du robot reconnu et mémorisé ; 400 de Binance → [] sans rejet ; échec TV → {}", async () => {
  const { calls, mkt } = realSetup((url) => {
    if (url.includes("marches-meta.json")) return [200, { v: 3 }];
    if (url.includes("/data/hist/")) return [404, { message: "Not Found" }];
    if (url.includes("binance")) return [400, { code: -1121, msg: "Invalid symbol." }];
    return [200, { data: "pas un tableau" }];
  });
  eq(await mkt.history("tv:SP:SPX"), []);
  eq(await mkt.history("tv:SP:SPX"), []);
  assert.equal(calls.filter((c) => c.url.includes("/data/hist/")).length, 1, "404 mémorisé");
  assert.equal(calls.filter((c) => c.url.includes("marches-meta")).length, 1);
  eq(await mkt.history("crypto:NOPE"), []);
  assert.equal(calls.filter((c) => c.url.includes("binance")).length, 1, "400 : pas de nouvel essai");
  eq(await mkt.quotes(["tv:TVC:GOLD"]), {}, "réponse invalide : aucune cotation, aucun rejet");
});

/* ---------- Phase 3 : version par fichier, IndexedDB, résumé et taux ---------- */
function fakeIdb() { const m = new Map(); return { m, get: async (s, k) => m.get(s + "|" + k), put: async (s, k, v) => { m.set(s + "|" + k, JSON.parse(JSON.stringify(v))); return k; } }; }
const META3 = { v: 9, files: { isin_LU1681043599: { last: "2026-02-02", n: 4 }, tv_SP_SPX: { last: "2026-11-16", n: 3770 } } };

test("robot : version propre à chaque fichier (dernière séance + nombre de séances) dans la clé de cache", async () => {
  const { mkt, M, dk } = setup((url) => url.endsWith("marches-meta.json") ? META3 : HIST);
  const cw8 = I(M, { id: "isin:LU1681043599", vehicle: "etf", tickers: { tv: "EURONEXT:CW8" } });
  await mkt.history(cw8);
  assert.equal(dk.calls[1].cacheKey, "GET https://robot.example/data/hist/isin_LU1681043599.json#2026-02-02.4");
});

test("robot : copie IndexedDB réutilisée tant que la version ne change pas (aucun téléchargement), puis renouvelée", async () => {
  const idb = fakeIdb();
  const a = setup((url) => url.endsWith("marches-meta.json") ? META3 : HIST); a.dk.idb = idb;
  const cw8 = I(a.M, { id: "isin:LU1681043599", vehicle: "etf", tickers: { tv: "EURONEXT:CW8" } });
  assert.equal((await a.mkt.history(cw8)).length, 4);
  await settle();
  assert.ok(idb.m.has("bars|https://robot.example/data/hist/isin_LU1681043599.json"), "copie enregistrée");
  // nouvelle session (page rechargée) : même version → lu dans IndexedDB
  const b = setup((url) => { if (url.endsWith("marches-meta.json")) return META3; throw new Error("téléchargement inattendu"); }); b.dk.idb = idb;
  const bars = await b.mkt.history(I(b.M, { id: "isin:LU1681043599", vehicle: "etf", tickers: { tv: "EURONEXT:CW8" } }));
  assert.equal(bars.length, 4); assert.equal(b.dk.calls.length, 1, "seulement marches-meta.json");
  // le robot a publié une séance de plus → nouveau téléchargement
  const META4 = { v: 10, files: { isin_LU1681043599: { last: "2026-02-03", n: 5 } } };
  const c = setup((url) => url.endsWith("marches-meta.json") ? META4 : HIST); c.dk.idb = idb;
  await c.mkt.history(I(c.M, { id: "isin:LU1681043599", vehicle: "etf", tickers: { tv: "EURONEXT:CW8" } }));
  assert.equal(c.dk.calls.length, 2);
});

test("robot : copie IndexedDB invalide ou IndexedDB en panne → téléchargement normal", async () => {
  const idb = { get: async () => ({ ver: "2026-02-02.4", data: { t: [1], c: [] } }), put: async () => { throw new Error("quota"); } };
  const a = setup((url) => url.endsWith("marches-meta.json") ? META3 : HIST); a.dk.idb = idb;
  const bars = await a.mkt.history(I(a.M, { id: "isin:LU1681043599", vehicle: "etf", tickers: { tv: "EURONEXT:CW8" } }));
  assert.equal(bars.length, 4); assert.equal(a.dk.calls.length, 2);
});

test("robot : marches-meta.json relu au plus une fois par heure", async () => {
  const { mkt, M, dk } = setup((url) => url.endsWith("marches-meta.json") ? META3 : HIST);
  const cw8 = I(M, { id: "isin:LU1681043599", vehicle: "etf", tickers: { tv: "EURONEXT:CW8" } });
  await mkt.history(cw8); await mkt.history(cw8);
  assert.equal(dk.calls.filter((c) => c.url.endsWith("marches-meta.json")).length, 1);
  dk.t += 61 * 60000;
  await mkt.history(cw8);
  assert.equal(dk.calls.filter((c) => c.url.endsWith("marches-meta.json")).length, 2);
});

test("résumé et taux du robot : bonnes adresses, null si absents ou invalides, jamais de rejet", async () => {
  const { mkt, dk } = setup((url) => {
    if (url.endsWith("/data/resume.json")) return { v: 3, items: { "isin:LU1681043599": { d: "2026-11-16", c: 706.39, p: { y1: 0.17 } } } };
    if (url.endsWith("/data/taux.json")) return { estr: { d: "2026-11-16", v: 2.44 } };
    throw notFound();
  });
  const r = await mkt.resume();
  assert.equal(r.items["isin:LU1681043599"].c, 706.39);
  assert.equal((await mkt.taux()).estr.v, 2.44);
  assert.ok(dk.calls.every((c) => c.provider === "robotdata"));
  const b = setup((url) => { if (url.endsWith("resume.json")) return { items: "pas un objet" }; throw notFound(); });
  assert.equal(await b.mkt.resume(), null);
  assert.equal(await b.mkt.taux(), null);
  const c = setup(() => ({}), { data: "" });
  assert.equal(await c.mkt.resume(), null);
});
