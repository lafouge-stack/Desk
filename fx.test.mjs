// Change : conversion en EUR datée (fixings BCE), taux en direct, alias (pence, stablecoins), chargement Frankfurter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeContext } from "./vmkit.mjs";

const NOW = Date.UTC(2026, 10, 13, 12, 0);   // vendredi 13/11/2026 midi UTC
const near = (a, b, eps = 1e-12) => assert.ok(a != null && Math.abs(a - b) < eps, `${a} ≠ ${b}`);

/** Faux CK.dk minimal : horloge fixe, réponses par adresse, appels enregistrés. */
function fakeDk(routes, now = NOW) {
  const dk = {
    calls: [], providers: {}, logs: [],
    env: { now: () => now },
    provider(id, o) { dk.providers[id] = o; },
    log(level, provider, msg) { dk.logs.push({ level, provider, msg }); },
    fetch(url, opts) {
      dk.calls.push({ url, opts });
      const key = Object.keys(routes).find((k) => url.startsWith(k));
      const r = key ? routes[key] : null;
      if (!r || r instanceof Error) return Promise.reject(r || new Error("HTTP 404"));
      const v = opts.validate ? opts.validate(r) : true;
      if (v !== true) return Promise.reject(new Error("réponse invalide : " + v));
      return Promise.resolve({ data: JSON.parse(JSON.stringify(r)), stale: false, ts: now, from: "net" });
    }
  };
  return dk;
}
function fresh(dk) {
  const { load, CK } = makeContext();
  load("models.js");
  if (dk) CK.dk = dk;
  return load("fx.js").fx;
}

// Extraits réels de Frankfurter (format vérifié le 13/11/2026)
const LATEST = { amount: 1.0, base: "EUR", date: "2026-11-12", rates: { CHF: 0.9232, GBP: 0.83595, JPY: 176.96, USD: 1.1081 } };
const RANGE = { amount: 1.0, base: "EUR", start_date: "2026-10-30", end_date: "2026-11-12", rates: {
  "2026-10-30": { GBP: 0.8338, USD: 1.1172 }, "2026-11-02": { GBP: 0.8358, USD: 1.1216 }, "2026-11-03": { GBP: 0.83358, USD: 1.1179 },
  "2026-11-10": { GBP: 0.83545, USD: 1.1214 }, "2026-11-11": { GBP: 0.83618, USD: 1.1127 }, "2026-11-12": { GBP: 0.83595, USD: 1.1081 } } };

test("EUR = 1, devise inconnue → null (jamais 1 par défaut)", () => {
  const fx = fresh();
  assert.equal(fx.rate("EUR"), 1);
  assert.equal(fx.rate("eur", "2001-01-01"), 1);
  assert.equal(fx.toEUR(250, "EUR"), 250);
  assert.equal(fx.rate("USD"), null, "aucun taux chargé");
  assert.equal(fx.rate("XYZ"), null);
  assert.equal(fx.rate(""), null);
  assert.equal(fx.rate(null), null);
  assert.equal(fx.rate("__proto__"), null);
  assert.equal(fx.toEUR(100, "XYZ"), null);
  assert.equal(fx.toEUR(null, "EUR"), null);
});

test("chargement Frankfurter : « 1 EUR = x » est inversé", async () => {
  const dk = fakeDk({ "https://api.frankfurter.dev/v1/latest": LATEST, "https://api.frankfurter.dev/v1/20": RANGE });
  const fx = fresh(dk);
  const r = await fx.load({ from: "2026-10-30" });
  assert.equal(r.ok, true);
  assert.equal(r.source, "frankfurter");
  assert.equal(r.date, "2026-11-12");
  assert.equal(r.errors.length, 0);
  near(fx.rate("USD"), 1 / 1.1081);
  near(fx.rate("JPY"), 1 / 176.96);
  near(fx.rate("USD", "2026-11-03"), 1 / 1.1179);
  near(fx.toEUR(1108.1, "USD", "2026-11-12"), 1000, 1e-9);
  // provider « fx » déclaré, ttl 6 h, deux appels (dernier fixing + historique)
  assert.equal(dk.providers.fx.rate, 1);
  assert.equal(dk.providers.fx.burst, 2);
  assert.equal(dk.providers.fx.timeout, 12000);
  assert.equal(dk.calls.length, 2);
  assert.ok(dk.calls.every((c) => c.opts.provider === "fx" && c.opts.ttl === 6 * 3600000));
  assert.ok(dk.calls.some((c) => c.url.startsWith("https://api.frankfurter.dev/v1/2026-10-30..?base=EUR&symbols=USD,GBP,")));
});

test("report du dernier fixing ≤ date (week-end, jour férié BCE), null avant le premier", async () => {
  const fx = fresh(fakeDk({ "https://api.frankfurter.dev/v1/latest": LATEST, "https://api.frankfurter.dev/v1/20": RANGE }));
  await fx.load({ from: "2026-10-30" });
  near(fx.rate("USD", "2026-10-31"), 1 / 1.1172, 1e-15);   // samedi → vendredi 30/10
  near(fx.rate("USD", "2026-11-01"), 1 / 1.1172, 1e-15);   // dimanche
  near(fx.rate("USD", "2026-11-06"), 1 / 1.1179, 1e-15);   // trou dans l'extrait (jours sans fixing) → 03/11
  near(fx.rate("USD", "2026-11-15"), 1 / 1.1081, 1e-15);   // après le dernier fixing
  near(fx.rate("USD", Date.UTC(2026, 10, 1, 15)), 1 / 1.1172, 1e-15);   // date en ms
  assert.equal(fx.rate("USD", "2026-10-29"), null, "aucun fixing ≤ date");
  assert.equal(fx.rate("USD", "pas une date"), null);
  assert.deepEqual({ ...fx.fixing("USD", "2026-11-01") }, { date: "2026-10-30", rate: 1 / 1.1172 });
  // Jour férié BCE (1er mai, Noël) : setDaily direct
  fx.setDaily("CHF", [["2026-04-30", 1.06], ["2026-05-04", 1.07]]);
  assert.equal(fx.rate("CHF", "2026-05-01"), 1.06);
  assert.equal(fx.rate("CHF", "2026-05-04"), 1.07);
});

test("GBX / GBp = GBP / 100 ; USDT, USDC, FDUSD, DAI ≈ USD", () => {
  const fx = fresh();
  fx.setDaily("GBP", { "2026-11-12": 1.2 });
  fx.setDaily("USD", { "2026-11-12": 0.9 });
  near(fx.rate("GBX", "2026-11-12"), 0.012);
  near(fx.rate("GBp", "2026-11-12"), 0.012);
  near(fx.toEUR(2500, "GBX", "2026-11-12"), 30);
  assert.equal(fx.rate("GBP", "2026-11-12"), 1.2, "« GBP » reste la livre");
  for (const c of ["USDT", "USDC", "FDUSD", "DAI", "usdt"]) assert.equal(fx.rate(c, "2026-11-12"), 0.9, c);
  assert.equal(fx.setDaily("GBX", { "2026-11-12": 1 }), 0, "pas de série propre pour un alias");
  assert.equal(fx.setLive("USDT", 0.5), false);
  assert.equal(fx.rate("USDT", "2026-11-12"), 0.9);
});

test("live vs daily : le direct (< 1 jour) prime sans date ; une date utilise toujours le fixing", () => {
  const dk = fakeDk({});
  const fx = fresh(dk);
  fx.setDaily("USD", [["2026-11-12", 0.9]]);
  assert.equal(fx.rate("USD"), 0.9, "sans direct : dernier fixing");
  assert.equal(fx.setLive("USD", 0.91, NOW - 3600000), true);
  assert.equal(fx.rate("USD"), 0.91);
  assert.equal(fx.rate("USD", "2026-11-13"), 0.9, "date → fixing, jamais le direct");
  near(fx.toEUR(100, "USDT"), 91);
  fx.setLive("USD", 0.92, NOW - 25 * 3600000);
  assert.equal(fx.rate("USD"), 0.9, "direct de plus d'un jour ignoré");
  assert.equal(fx.setLive("USD", -1), false);
  assert.equal(fx.setLive("EUR", 1), false);
  assert.equal(fx.info().live.USD.rate, 0.92);
});

test("ret() : un actif en USD à prix constant suit l'EURUSD", () => {
  const fx = fresh();
  const dates = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10"];
  const eurusd = [1.1216, 1.1179, 1.1267, 1.1224, 1.1165, 1.1193, 1.1214];
  fx.setDaily("USD", dates.map((d, i) => [d, 1 / eurusd[i]]));
  // r_EUR = (1 + 0)·(fx1/fx0) − 1 = EURUSD0/EURUSD1 − 1
  const r = dates.slice(1).map((d, i) => fx.ret(0, "USD", dates[i], d));
  r.forEach((x, i) => near(x, eurusd[i] / eurusd[i + 1] - 1, 1e-12));
  // même volatilité que le change
  const sd = (a) => { const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
  const fxRet = dates.slice(1).map((d, i) => fx.rate("USD", d) / fx.rate("USD", dates[i]) - 1);
  near(sd(r), sd(fxRet), 1e-15);
  // rendement local et change se composent
  near(fx.ret(0.1, "USD", "2026-11-02", "2026-11-10"), 1.1 * (1.1216 / 1.1214) - 1);
  near(fx.ret(0.05, "EUR", "2026-11-02", "2026-11-10"), 0.05, 1e-15);
  assert.equal(fx.ret(0.05, "USD", "2020-01-01", "2026-11-10"), null, "pas de fixing à d0");
  assert.equal(fx.ret(null, "USD", "2026-11-02", "2026-11-10"), null);
  assert.equal(fx.ret(0, "XYZ", "2026-11-02", "2026-11-10"), null);
});

test("setDaily : fusion, valeurs invalides ignorées", () => {
  const fx = fresh();
  assert.equal(fx.setDaily("USD", [["2026-11-10", 0.9], ["2026-11-11", "0.91"], ["mauvaise", 1], ["2026-11-12", -3], ["2026-11-12", NaN]]), 2);
  assert.equal(fx.setDaily("usd", { "2026-11-12": 0.92 }), 1);
  assert.equal(fx.rate("USD"), 0.92);
  assert.equal(fx.rate("USD", "2026-11-11"), 0.91);
  assert.equal(fx.setDaily("EUR", { "2026-11-12": 2 }), 0);
  assert.equal(fx.setDaily("ABCD", { "2026-11-12": 2 }), 0);
  assert.equal(fx.rate("EUR"), 1);
  assert.deepEqual([...fx.currencies()], ["USD"]);
});

test("Frankfurter en panne → fichier du robot (même format) ; tout en panne → ok:false sans rejet", async () => {
  const robot = { base: "EUR", src: "BCE", updated: "2026-11-12", rates: { "2026-11-11": { USD: 1.1127 }, "2026-11-12": { USD: 1.1081 } } };
  const dk = fakeDk({ "https://api.frankfurter.dev/": new Error("HTTP 503"), "https://robot.example/data/fx.json": robot });
  const fx = fresh(dk);
  const r = await fx.load({ base: "https://robot.example/" });
  assert.equal(r.ok, true);
  assert.equal(r.source, "robot");
  assert.equal(r.errors.length, 2);
  near(fx.rate("USD", "2026-11-11"), 1 / 1.1127);
  assert.ok(dk.logs.some((l) => l.provider === "fx" && l.level === "warn"));

  const fx2 = fresh(fakeDk({}));
  const r2 = await fx2.load({ base: "" });
  assert.equal(r2.ok, false);
  assert.equal(r2.points, 0);
  assert.equal(fx2.rate("USD"), null);
});

test("réponse sans base EUR refusée", async () => {
  const fx = fresh(fakeDk({ "https://api.frankfurter.dev/v1/latest": { base: "USD", date: "2026-11-12", rates: { EUR: 0.9 } } }));
  const r = await fx.load({ base: "" });
  assert.equal(r.ok, false);
  assert.equal(fx.rate("USD"), null);
});

test("sans CK.dk : repli sur window.fetch lu à l'appel", async () => {
  const { load, CK, window } = makeContext();
  load("models.js");
  const fx = load("fx.js").fx;
  const seen = [];
  window.fetch = (url) => { seen.push(url); const d = url.includes("latest") ? LATEST : RANGE; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(d) }); };
  const r = await fx.load({ from: "2026-10-30", base: "" });
  assert.equal(r.ok, true);
  assert.equal(seen.length, 2);
  near(fx.rate("GBP", "2026-11-01"), 1 / 0.8338);
  assert.equal(CK.dk, undefined);
});

// ---------- Cas limites ajoutés à la relecture ----------

test("date inexistante (2026-13-45, 2026-02-30) ignorée : elle ne devient pas le « dernier fixing »", () => {
  const fx = fresh();
  assert.equal(fx.setDaily("USD", { "2026-13-45": 5, "2026-02-30": 4, "2026-11-12": 0.9 }), 1);
  assert.equal(fx.rate("USD"), 0.9);
  assert.equal(fx.rate("USD", "2026-13-45"), null);
  assert.equal(fx.rate("USD", "2026-11-12T23:00:00Z"), 0.9, "horodatage ISO : jour retenu");
  assert.equal(fx.rate("USD", new Date(Date.UTC(2026, 10, 13))), 0.9, "Date venue d'un autre royaume");
});

test("Frankfurter v1 en panne → v2 (fournisseur BCE) avant le robot", async () => {
  const V2L = [{ date: "2026-11-12", base: "EUR", quote: "USD", rate: 1.1081 }, { date: "2026-11-12", base: "EUR", quote: "GBP", rate: 0.83595 }];
  const V2H = [{ date: "2026-11-11", base: "EUR", quote: "USD", rate: 1.1127 }, { date: "2026-11-12", base: "EUR", quote: "USD", rate: 1.1081 },
    { date: "2026-13-01", base: "EUR", quote: "USD", rate: 9 }, { date: "2026-11-12", base: "USD", quote: "JPY", rate: 150 }];
  const dk = fakeDk({ "https://api.frankfurter.dev/v1/": new Error("HTTP 410"),
    "https://api.frankfurter.dev/v2/rates?base=EUR&providers=ECB&from=": V2H, "https://api.frankfurter.dev/v2/rates?base=EUR&providers=ECB": V2L,
    "https://robot.example/": new Error("ne doit pas être appelé") });
  const fx = fresh(dk);
  const r = await fx.load({ from: "2026-11-11", base: "https://robot.example" });
  assert.equal(r.ok, true);
  assert.equal(r.source, "frankfurter-v2");
  assert.equal(r.errors.length, 0, "chaque partie a fini par réussir");
  assert.ok(!dk.calls.some((c) => c.url.startsWith("https://robot.example")), "robot non appelé");
  assert.ok(dk.calls.some((c) => c.url === "https://api.frankfurter.dev/v2/rates?base=EUR&providers=ECB&from=2026-11-11&quotes=USD,GBP,CHF,JPY,SEK,NOK,DKK,PLN,CZK,HUF,CAD,AUD,HKD,SGD,CNY"));
  near(fx.rate("USD", "2026-11-11"), 1 / 1.1127);
  near(fx.rate("GBP"), 1 / 0.83595);
  assert.equal(fx.rate("JPY"), null, "ligne en base USD ignorée");
  assert.equal(fx.fixing("USD").date, "2026-11-12", "date inexistante ignorée");
});

test("load() ne rejette jamais : réponse vide, configuration en erreur, fetch qui ne répond pas", async () => {
  const fx = fresh({ env: { now: () => NOW }, provider() { throw new Error("x"); }, log() {}, fetch: () => Promise.resolve({ data: null, stale: false }) });
  const r = await fx.load({ base: "" });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2);

  const { load, CK, window } = makeContext();
  load("models.js");
  const fx2 = load("fx.js").fx;
  CK.cfg = () => { throw new Error("cfg cassée"); };
  window.fetch = () => new Promise(() => {});          // ne répond jamais
  window.setTimeout = (f) => setTimeout(f, 0);           // le délai maximal se déclenche tout de suite
  const r2 = await fx2.load();
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.every((e) => e.includes("Délai dépassé")), r2.errors.join(" | "));
});

test("avec le vrai datakit.js : provider « fx », cache 6 h, secours v2 après les nouveaux essais", async () => {
  const { load, CK } = makeContext();
  load("models.js");
  load("datakit.js");
  const fx = load("fx.js").fx;
  const seen = [];
  const reply = (status, body) => ({ ok: status === 200, status, headers: { get: () => null }, json: () => Promise.resolve(body) });
  let v1down = false, t = NOW;
  // Horloge virtuelle : une minuterie avance l'horloge de son délai quand elle se déclenche (le limiteur à jetons se recharge)
  Object.assign(CK.dk.env, {
    now: () => t, random: () => 0.5, hidden: () => false, online: () => true,
    setTimeout: (f, ms) => setTimeout(() => { t += ms || 0; f(); }, 0), clearTimeout: (h) => clearTimeout(h),
    fetch: (url) => { seen.push(url);
      if (url.includes("/v2/")) return Promise.resolve(reply(200, [{ date: "2026-11-12", base: "EUR", quote: "USD", rate: 1.25 }]));
      if (v1down) return Promise.resolve(reply(503, {}));
      return Promise.resolve(reply(200, url.includes("latest") ? LATEST : RANGE)); }
  });
  const r = await fx.load({ from: "2026-10-30", base: "" });
  assert.equal(r.ok, true);
  assert.equal(r.source, "frankfurter");
  near(fx.rate("USD", "2026-11-03"), 1 / 1.1179);
  assert.equal(CK.dk.status("fx").state, "connectee");
  assert.equal(seen.length, 2);
  t += 3 * 3600000;
  assert.equal(CK.dk.status("fx").state, "connectee", "3 h plus tard : toujours connectée (fixings quotidiens)");
  await fx.load({ from: "2026-10-30", base: "" });
  assert.equal(seen.length, 2, "second chargement servi par le cache (ttl 6 h)");

  CK.dk._reset(); fx._reset(); seen.length = 0; v1down = true;
  const r2 = await fx.load({ from: "2026-10-30", base: "" });
  assert.equal(r2.ok, true);
  assert.equal(r2.source, "frankfurter-v2");
  assert.equal(seen.filter((u) => u.includes("/v1/")).length, 8, "2 parties × (1 + 3 nouveaux essais)");
  near(fx.rate("USD"), 1 / 1.25);
});
