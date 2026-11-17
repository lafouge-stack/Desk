// Robot des historiques (histo.mjs) : fuseaux horaires, lecture de Yahoo / FRED / BCE, fusion, nettoyage
// documenté, planification pilotée par l'état, et un passage complet avec un faux réseau dans un dossier temporaire.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as H from "./histo.mjs";

const DAY = 864e5;
const iso = (t) => new Date(t).toISOString();
const NOW = Date.parse("2026-11-17T08:00:00Z");

/** Réponse Yahoo v8 : jours [AAAA-MM-JJ, clôture|null], séance de Paris (ouverture 08:00 UTC en hiver). */
function yahoo(days, { rmp = null, rmt = null, tz = "Europe/Paris", end = "2026-11-16T16:30:00Z", div = null, open = "T08:00:00Z" } = {}) {
  return { chart: { result: [{
    meta: { currency: "EUR", symbol: "CW8.PA", exchangeTimezoneName: tz, currentTradingPeriod: { regular: { end: Date.parse(end) / 1000 } },
      regularMarketPrice: rmp, regularMarketTime: rmt ? Date.parse(rmt) / 1000 : undefined, regularMarketDayHigh: rmp ? rmp + 1 : undefined, regularMarketDayLow: rmp ? rmp - 1 : undefined, regularMarketVolume: 1234 },
    timestamp: days.map((d) => Date.parse(d[0] + open) / 1000),
    events: div ? { dividends: div } : undefined,
    indicators: { quote: [{ open: days.map((d) => d[1]), high: days.map((d) => d[1] && d[1] + 2), low: days.map((d) => d[1] && d[1] - 2), close: days.map((d) => d[1]), volume: days.map(() => 100) }] }
  }], error: null } };
}
/** n séances ouvrées finissant au plus tard le jour `last`, clôture f(k). */
function bdays(last, n, f) { const out = []; let x = Date.parse(last + "T12:00:00Z"); while (out.length < n) { const w = new Date(x).getUTCDay(); if (w && w < 6) out.unshift(iso(x).slice(0, 10)); x -= DAY; } return out.map((d, k) => [d, f(k)]); }

describe("fuseaux horaires", () => {
  test("clôture 17:30 à Paris, 16:00 à New York, en hiver et en été", () => {
    assert.equal(iso(H.zoned("2026-01-05", 17, 30, "Europe/Paris")), "2026-01-05T16:30:00.000Z");
    assert.equal(iso(H.zoned("2026-07-01", 17, 30, "Europe/Paris")), "2026-07-01T15:30:00.000Z");
    assert.equal(iso(H.zoned("2026-01-05", 16, 0, "America/New_York")), "2026-01-05T21:00:00.000Z");
    assert.equal(iso(H.zoned("2026-07-01", 16, 0, "America/New_York")), "2026-07-01T20:00:00.000Z");
  });
  test("jour du changement d'heure et date locale", () => {
    assert.equal(iso(H.zoned("2026-03-29", 17, 30, "Europe/Paris")), "2026-03-29T15:30:00.000Z");
    assert.equal(iso(H.zoned("2026-10-25", 17, 30, "Europe/Paris")), "2026-10-25T16:30:00.000Z");
    assert.equal(H.localDate(Date.parse("2026-11-16T23:30:00Z"), "Europe/Paris"), "2026-11-17");
    assert.equal(H.localDate(Date.parse("2026-11-16T23:30:00Z"), "America/New_York"), "2026-11-16");
  });
});

describe("Yahoo → historique", () => {
  test("t = instant de clôture ; séance en cours écartée ; clôture absente ignorée ; doublon retiré", () => {
    const j = yahoo([["2026-11-12", 715.03], ["2026-11-12", 715.5], ["2026-11-13", null], ["2026-11-16", 706.39], ["2026-11-17", 700]]);
    const h = H.yahooToHist(j, "isin:LU1681043599", NOW);
    assert.deepEqual(h.t.map(iso), ["2026-11-12T16:30:00.000Z", "2026-11-16T16:30:00.000Z"]);
    assert.deepEqual(h.c, [715.03, 706.39]);
    assert.equal(h.ccy, "EUR"); assert.equal(h.src, "yahoo"); assert.equal(h.tz, "Europe/Paris");
  });
  test("dernière séance vide chez Yahoo : complétée par le cours de clôture annoncé, seulement s'il est cohérent", () => {
    const days = [["2026-11-12", 715.03], ["2026-11-13", 708.8], ["2026-11-16", null]];
    const h = H.yahooToHist(yahoo(days, { rmp: 706.39, rmt: "2026-11-16T16:35:28Z" }), "x", NOW);
    assert.equal(h.c[h.c.length - 1], 706.39); assert.equal(h.h[h.h.length - 1], 707.39); assert.equal(h.v[h.v.length - 1], 1234);
    // cours relevé avant la clôture : pas de complément
    const h2 = H.yahooToHist(yahoo(days, { rmp: 706.39, rmt: "2026-11-16T14:00:00Z" }), "x", NOW);
    assert.equal(h2.c.length, 2);
  });
  test("série incohérente (autre base) ou arrêtée depuis longtemps : refusée avec un motif clair", () => {
    assert.throws(() => H.yahooToHist(yahoo([["2026-11-13", 3648.33], ["2026-11-16", null]], { rmp: 6312.03, rmt: "2026-11-16T16:35:00Z" }), "x", NOW), /incohérente/);
    assert.throws(() => H.yahooToHist(yahoo([["2015-12-17", 3637.25], ["2015-12-18", 3648.33]], { rmp: 6312.03, rmt: "2026-11-16T16:35:00Z" }), "x", NOW), /arrêtée le 18\/12\/2015/);
    assert.throws(() => H.yahooToHist({ chart: { result: null, error: { description: "No data found" } } }, "x", NOW), /No data found/);
  });
  test("dividendes datés à la clôture du jour", () => {
    const h = H.yahooToHist(yahoo([["2026-11-12", 50], ["2026-11-13", 51]], { div: { a: { amount: 0.42, date: Date.parse("2026-11-13T08:00:00Z") / 1000 } } }), "x", NOW);
    assert.deepEqual(h.div, [[Date.parse("2026-11-13T16:30:00Z"), 0.42]]);
  });
});

describe("FRED et BCE", () => {
  test("CSV FRED : valeurs manquantes (« . ») ignorées", () => {
    assert.deepEqual(H.fredCsv("observation_date,DGS2\n2026-11-12,4.85\n2026-11-13,.\n2026-11-14,4.9\n"), [["2026-11-12", 4.85], ["2026-11-14", 4.9]]);
  });
  test("CSV BCE : colonnes trouvées par leur nom, guillemets et virgules dans les champs", () => {
    const csv = 'KEY,FREQ,TIME_PERIOD,OBS_VALUE,TITLE\nEST.B.X,B,2026-11-13,2.437,"Euro short-term rate, volume-weighted"\nEST.B.X,B,2026-11-12,2.43,"a ""b"""\nEST.B.X,B,2026-11-14,,x\n';
    assert.deepEqual(H.ecbCsv(csv), { "EST.B.X": [["2026-11-12", 2.43], ["2026-11-13", 2.437]] });
  });
  test("courbe : aujourd'hui, il y a 1 mois, il y a 1 an (dernière observation ≤ date)", () => {
    const s = { "2Y": [["2025-11-10", 2.0], ["2026-10-12", 2.4], ["2026-11-13", 2.5]], "10Y": [["2025-11-13", 3.0], ["2026-10-13", 3.3], ["2026-11-13", 3.4]] };
    const c = H.curveAt(s, ["2Y", "10Y"]);
    assert.deepEqual(c.dates, ["2026-11-13", "2026-10-13", "2025-11-13"]);
    assert.deepEqual(c.vals, [[2.5, 3.4], [2.4, 3.3], [2.0, 3.0]]);
  });
});

describe("fusion, nettoyage, compactage", () => {
  const T = (d) => Date.parse(d + "T16:30:00Z");
  const mk = (rows) => ({ id: "x", ccy: "EUR", src: "yahoo", t: rows.map((r) => T(r[0])), o: rows.map((r) => r[1]), h: rows.map((r) => r[1]), l: rows.map((r) => r[1]), c: rows.map((r) => r[1]), v: rows.map(() => 0), div: [], split: [] });
  test("fusion : le nouveau l'emporte jour par jour, tri, 15 ans au plus", () => {
    const old = mk([["2010-01-04", 1], ["2026-11-12", 10], ["2026-11-13", 11]]), fresh = mk([["2026-11-13", 11.5], ["2026-11-16", 12]]);
    const m = H.merge(old, fresh, NOW);
    assert.deepEqual(m.c, [10, 11.5, 12], "2010 retiré (plus de 15 ans), 13/11 remplacé");
  });
  test("pic isolé retiré, rupture de niveau coupée, notes en français", () => {
    const rows = [["2026-01-05", 100], ["2026-01-06", 101], ["2026-01-07", 150], ["2026-01-08", 102], ["2026-01-09", 103]];
    const a = H.clean(mk(rows));
    assert.deepEqual(a.h.c, [100, 101, 102, 103]); assert.match(a.notes[0], /1 cours isolé aberrant retiré/);
    const b = H.clean(mk([["2026-01-05", 0.4], ["2026-01-06", 0.41], ["2026-01-07", 86], ["2026-01-08", 87]]));
    assert.deepEqual(b.h.c, [86, 87]); assert.match(b.notes[0], /coupé avant le 07\/01\/2026/);
    const vix = H.clean(mk(rows), { spikes: false });
    assert.equal(vix.h.c.length, 5, "VIX : les pics sont réels");
    assert.deepEqual(H.clean(mk([["2026-01-05", 100], ["2026-01-06", 130]])).notes, [], "+30 % : réel, gardé");
  });
  test("compactage : 6 chiffres significatifs, volumes retirés s'ils sont tous nuls", () => {
    const h = H.compact(mk([["2026-01-05", 708.80000001]]));
    assert.deepEqual(h.c, [708.8]); assert.deepEqual(h.v, []);
  });
});

describe("planification pilotée par l'état", () => {
  const ins = (n) => Array.from({ length: n }, (_, k) => ({ id: "isin:X" + k, tickers: { yahoo: "X" + k } }));
  test("au plus 15 historiques complets et 60 mises à jour, les plus anciens d'abord ; crypto sans source ignorée", () => {
    const L = ins(100).concat([{ id: "crypto:BTC", tickers: { okx: "BTC-USDT" } }]), files = {};
    for (let k = 0; k < 70; k++) files["isin_X" + k] = { last: "2026-11-13", ok: NOW - (k + 4) * 36e5 };
    const p = H.plan(L, { files }, NOW);
    assert.equal(p.filter((x) => x.full).length, 15); assert.equal(p.filter((x) => !x.full).length, 60);
    assert.equal(p.find((x) => !x.full).i.id, "isin:X69", "le plus ancien d'abord");
    assert.ok(!p.some((x) => x.i.id === "crypto:BTC"));
    assert.equal(H.plan(L, { files }, NOW, { tout: true }).length, 100);
  });
  test("à jour depuis moins de 3 h : rien ; en échec depuis moins de 6 h : attend", () => {
    const L = ins(2), files = { isin_X0: { last: "2026-11-16", ok: NOW - 2 * 36e5 }, isin_X1: { err: "HTTP 429", try: NOW - 5 * 36e5 } };
    assert.equal(H.plan(L, { files }, NOW).length, 0);
    assert.equal(H.plan(L, { files }, NOW + 2 * 36e5).length, 2);
  });
  test("taux sans ticker Yahoo : FRED (2 ans US) et BCE (10 ans France, Allemagne, Italie)", () => {
    assert.equal(H.sourceOf({ id: "tv:TVC:US02Y" }).kind, "fred");
    assert.equal(H.sourceOf({ id: "tv:TVC:FR10Y" }).kind, "ecb");
    assert.equal(H.sourceOf({ id: "tv:TVC:FR02Y" }), null);
    assert.equal(H.fileOf("tv:NYMEX:NG1!"), "tv_NYMEX_NG1_");
  });
});

describe("passage complet (faux réseau, dossier temporaire)", () => {
  const REF = { instruments: [
    { id: "isin:LU1681043599", symbol: "CW8", asset_class: "actions", vehicle: "etf", tickers: { yahoo: "CW8.PA" } },
    { id: "isin:US0378331005", symbol: "AAPL", asset_class: "actions", vehicle: "titre", tickers: { yahoo: "AAPL" } },
    { id: "tv:TVC:US02Y", symbol: "US02Y", asset_class: "oblig_etat", vehicle: "taux", tickers: {} },
    { id: "tv:TVC:FR10Y", symbol: "FR10Y", asset_class: "oblig_etat", vehicle: "taux", tickers: {} },
    { id: "crypto:BTC", symbol: "BTC", asset_class: "crypto", vehicle: "spot_crypto", tickers: { okx: "BTC-USDT" } }
  ] };
  const res = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
  function net({ cw8 = 200, aapl = 429 } = {}) {
    const calls = [];
    const f = async (url) => {
      calls.push(url);
      if (url.includes("/chart/CW8.PA")) return cw8 === 200 ? res(200, yahoo(bdays("2026-11-16", 300, (k) => 600 + k / 2))) : res(cw8, "");
      if (url.includes("/chart/AAPL")) return res(aapl, "");
      if (url.includes("fred") && url.includes("DGS2")) return res(200, "observation_date,DGS2\n2026-11-12,4.85\n2026-11-13,4.88\n");
      if (url.includes("IRS/M.FR")) return res(200, "KEY,TIME_PERIOD,OBS_VALUE\nIRS.M.FR,2026-08,4.5\nIRS.M.FR,2026-09,4.44\nIRS.M.FR,2026-10,4.89\n");
      return res(404, "");
    };
    return { f, calls };
  }
  async function setup() {
    const dir = await mkdtemp(join(tmpdir(), "histo-")), ref = join(dir, "ref.json");
    await writeFile(ref, JSON.stringify(REF));
    return { dir: join(dir, "donnees"), root: dir, ref };
  }
  const opts = (s, n, now = NOW, extra = {}) => ({ ref: s.ref, now, fetch: n.f, sleep: async () => {}, log: () => {}, taux: false, fx: false, ...extra });

  test("écrit les historiques, l'état et le résumé ; une erreur est notée sans rien casser", async () => {
    const s = await setup(), n = net();
    try {
      const r = await H.run(s.dir, opts(s, n));
      assert.equal(r.stats.ok, 3); assert.equal(r.stats.err, 1);
      const meta = JSON.parse(readFileSync(join(s.dir, "marches-meta.json"), "utf8"));
      assert.equal(meta.v, 1);
      assert.equal(meta.files.isin_LU1681043599.last, "2026-11-16"); assert.equal(meta.files.isin_LU1681043599.n, 300);
      assert.equal(meta.files.isin_US0378331005.err, "HTTP 429"); assert.equal(meta.files.isin_US0378331005.last, undefined);
      assert.ok(!existsSync(join(s.dir, "hist", "crypto_BTC.json")), "crypto : lue sur Binance par le navigateur");
      assert.match(meta.sources.yahoo, /usage personnel, source citée/);
      const cw8 = JSON.parse(readFileSync(join(s.dir, "hist", "isin_LU1681043599.json"), "utf8"));
      assert.equal(cw8.t.length, 300); assert.equal(iso(cw8.t[299]), "2026-11-16T16:30:00.000Z"); assert.equal(cw8.ccy, "EUR");
      const resume = JSON.parse(readFileSync(join(s.dir, "resume.json"), "utf8"));
      assert.deepEqual(Object.keys(resume.items).sort(), ["isin:LU1681043599", "tv:TVC:FR10Y", "tv:TVC:US02Y"]);
      const fr = resume.items["tv:TVC:FR10Y"];
      assert.equal(fr.freq, "M"); assert.equal(fr.diff, true); assert.equal(fr.p.w, null); assert.equal(fr.c, 4.89);
      assert.equal(fr.p.m1, 0.45, "écart en points (4,89 − 4,44)");
      assert.equal(resume.items["isin:LU1681043599"].spark.length, 52);
    } finally { await rm(s.root, { recursive: true, force: true }); }
  });

  test("passages suivants : rien avant 3 h ; mise à jour courte ensuite ; source en panne → ancien fichier gardé", async () => {
    const s = await setup();
    try {
      await H.run(s.dir, opts(s, net()));
      const n2 = net(), r2 = await H.run(s.dir, opts(s, n2, NOW + 36e5));
      assert.equal(r2.tasks, 0); assert.equal(n2.calls.length, 0); assert.equal(r2.meta.v, 2);
      const n3 = net(), r3 = await H.run(s.dir, opts(s, n3, NOW + 4 * 36e5));
      const y = n3.calls.find((u) => u.includes("CW8.PA"));
      const p1 = +new URL(y).searchParams.get("period1") * 1000;
      assert.ok(p1 > NOW - 20 * DAY, "mise à jour courte, pas 15 ans");
      assert.equal(r3.stats.ok, 3);
      const before = await readFile(join(s.dir, "hist", "isin_LU1681043599.json"), "utf8");
      const n4 = net({ cw8: 500 }), r4 = await H.run(s.dir, opts(s, n4, NOW + 8 * 36e5));
      assert.ok(n4.calls.some((u) => u.includes("CW8.PA")), "nouvel essai fait");
      assert.equal(await readFile(join(s.dir, "hist", "isin_LU1681043599.json"), "utf8"), before, "fichier inchangé");
      assert.equal(r4.meta.files.isin_LU1681043599.err, "HTTP 500");
      assert.equal(r4.meta.files.isin_LU1681043599.last, "2026-11-16", "état précédent conservé");
      assert.ok(r4.resume.items["isin:LU1681043599"], "toujours dans le résumé");
    } finally { await rm(s.root, { recursive: true, force: true }); }
  });

  test("Yahoo refuse 3 fois de suite (429) : les autres instruments Yahoo sont reportés au passage suivant", async () => {
    const s = await setup(), ref = { instruments: ["A", "B", "C", "D", "E"].map((x) => ({ id: "isin:" + x, symbol: x, asset_class: "actions", vehicle: "titre", tickers: { yahoo: x } })) };
    await writeFile(s.ref, JSON.stringify(ref));
    let n = 0;
    try {
      const r = await H.run(s.dir, opts(s, { f: async () => { n++; return res(429, ""); } }));
      assert.equal(n, 3); assert.equal(r.stats.err, 3); assert.equal(r.stats.skipped, 2);
    } finally { await rm(s.root, { recursive: true, force: true }); }
  });
});

describe("workflows GitHub", () => {
  const rd = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
  test("donnees.yml : écriture dans la branche donnees, jamais annulé en cours, séparé du robot", () => {
    const y = rd("./.github/workflows/donnees.yml");
    assert.match(y, /contents: write/); assert.match(y, /group: donnees/); assert.match(y, /cancel-in-progress: false/);
    assert.match(y, /node histo\.mjs donnees/); assert.match(y, /push -q -f .* donnees:donnees/);
    assert.match(y, /workflow_dispatch/);
  });
  test("desk.yml : copie la branche donnees dans le site, sans échouer si elle n'existe pas encore", () => {
    const y = rd("./.github/workflows/desk.yml");
    assert.match(y, /if git fetch --depth=1 origin donnees; then .*git archive FETCH_HEAD \| tar -x -C site\/data/);
    assert.ok(y.indexOf("node robot.mjs") < y.indexOf("origin donnees"), "après robot.mjs");
  });
});
