// Tests de CK.dk (datakit.js) : limiteur, budget, priorités, dédoublonnage, cache, nouvels essais,
// disjoncteurs, onglet caché, repli sur le cache, statuts, journal, IndexedDB.
// Aucun vrai réseau ni vrai délai : fausse horloge, faux fetch et faux indexedDB injectés via CK.dk.env.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeContext } from "./vmkit.mjs";

const flush = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r)); };

/** Horloge virtuelle : setTimeout/clearTimeout factices, tick(ms) exécute les minuteries échues dans l'ordre. */
function fakeClock(t0 = 1_700_000_000_000) {
  let t = t0, seq = 0;
  const q = [];
  return {
    now: () => t,
    setTimeout: (f, ms) => { const h = ++seq; q.push({ h, at: t + Math.max(0, Number(ms) || 0), ms, f }); return h; },
    clearTimeout: (h) => { const i = q.findIndex((x) => x.h === h); if (i >= 0) q.splice(i, 1); },
    pending: () => q.slice(),
    async tick(ms) {
      const end = t + ms;
      for (;;) {
        await flush();
        q.sort((a, b) => a.at - b.at || a.h - b.h);
        const n = q[0];
        if (!n || n.at > end) break;
        q.shift(); t = n.at; n.f();
      }
      t = end; await flush();
    }
  };
}

/** Réponse HTTP factice. */
function resp(status, body = {}, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { ok: status >= 200 && status < 300, status, headers: { get: (k) => h[k.toLowerCase()] ?? null }, json: async () => JSON.parse(text), text: async () => text };
}

/** Faux fetch : handler(url, init, n) → réponse ou promesse ; garde la liste des appels. */
function fakeFetch(handler = () => resp(200, { ok: 1 })) {
  const calls = [];
  const f = (url, init) => { calls.push({ url, init }); return handler(url, init, calls.length); };
  f.calls = calls;
  return f;
}

/** Suit l'état d'une promesse sans jamais laisser de rejet non géré. */
function track(p) {
  const s = { done: false, ok: null, value: undefined, error: undefined };
  p.then((v) => { s.done = true; s.ok = true; s.value = v; }, (e) => { s.done = true; s.ok = false; s.error = e; });
  return s;
}

function setup({ fetch = fakeFetch(), random = 0.5, indexedDB = null } = {}) {
  const { CK, load } = makeContext();
  load("models.js"); load("datakit.js");
  const clk = fakeClock();
  const flags = { hidden: false, online: true };
  CK.dk.env = {
    fetch, now: clk.now, setTimeout: clk.setTimeout, clearTimeout: clk.clearTimeout,
    random: typeof random === "function" ? random : () => random,
    hidden: () => flags.hidden, online: () => flags.online, indexedDB
  };
  return { CK, dk: CK.dk, clk, flags, fetch };
}

/* ---------- Limiteur et budget ---------- */

test("limiteur à jetons : burst immédiat puis un appel par seconde (rate 1)", async () => {
  const { dk, clk, fetch } = setup();
  dk.provider("a", { rate: 1, burst: 2, retries: 0 });
  const r = [1, 2, 3, 4].map((i) => track(dk.fetch("https://x/" + i, { provider: "a" })));
  await flush();
  assert.equal(fetch.calls.length, 2, "le burst laisse passer 2 appels");
  await clk.tick(999); assert.equal(fetch.calls.length, 2);
  await clk.tick(1); assert.equal(fetch.calls.length, 3);
  await clk.tick(1000); assert.equal(fetch.calls.length, 4);
  assert.ok(r.every((s) => s.ok && s.value.from === "net"));
});

test("budget glissant par minute : au-delà, on attend que la fenêtre de 60 s libère des places", async () => {
  const { dk, clk, fetch } = setup();
  dk.provider("b", { budgetPerMin: 3, retries: 0 });
  [1, 2, 3, 4, 5].forEach((i) => track(dk.fetch("https://x/" + i, { provider: "b" })));
  await flush();
  assert.equal(fetch.calls.length, 3);
  await clk.tick(59_999); assert.equal(fetch.calls.length, 3);
  await clk.tick(1); assert.equal(fetch.calls.length, 5);
});

test("file à priorités : une requête high passe avant les low qui attendent", async () => {
  const { dk, clk, fetch } = setup();
  dk.provider("c", { rate: 1, burst: 1, retries: 0 });
  track(dk.fetch("https://x/low1", { provider: "c" }));
  track(dk.fetch("https://x/low2", { provider: "c", priority: "low" }));
  track(dk.fetch("https://x/low3", { provider: "c" }));
  track(dk.fetch("https://x/high", { provider: "c", priority: "high" }));
  await flush();
  await clk.tick(3000);
  assert.deepEqual(fetch.calls.map((c) => c.url.slice(10)), ["low1", "high", "low2", "low3"]);
});

/* ---------- Dédoublonnage et cache ---------- */

test("dédoublonnage : deux demandes identiques en vol → un seul appel réseau", async () => {
  let release;
  const fetch = fakeFetch(() => new Promise((r) => { release = () => r(resp(200, { v: 7 })); }));
  const { dk } = setup({ fetch });
  const p1 = dk.fetch("https://x/d", { provider: "d" }), p2 = dk.fetch("https://x/d", { provider: "d" });
  assert.equal(p1, p2, "même promesse");
  await flush(); assert.equal(fetch.calls.length, 1);
  release();
  const r = await p1;
  assert.equal(r.data.v, 7);
  // Une fois terminée, une nouvelle demande (sans cache) repart sur le réseau.
  const s = track(dk.fetch("https://x/d", { provider: "d" }));
  await flush(); assert.equal(fetch.calls.length, 2);
  release(); await flush(); assert.ok(s.ok);
  // Un corps différent = une autre clé.
  track(dk.fetch("https://x/d", { provider: "d", method: "POST", body: { a: 1 } }));
  await flush(); assert.equal(fetch.calls.length, 3);
  assert.equal(fetch.calls[2].init.body, '{"a":1}');
});

test("cache TTL : servi depuis le cache pendant ttl, puis redemandé au réseau", async () => {
  const fetch = fakeFetch((u, i, n) => resp(200, { n }));
  const { dk, clk } = setup({ fetch });
  const a = await dk.fetch("https://x/t", { provider: "e", ttl: 1000 });
  assert.equal(a.from, "net"); assert.equal(a.stale, false);
  await clk.tick(999);
  const b = await dk.fetch("https://x/t", { provider: "e", ttl: 1000 });
  assert.equal(b.from, "cache"); assert.equal(b.stale, false); assert.equal(b.data.n, 1); assert.equal(fetch.calls.length, 1);
  await clk.tick(1);
  const c = await dk.fetch("https://x/t", { provider: "e", ttl: 1000 });
  assert.equal(c.from, "net"); assert.equal(c.data.n, 2);
  // ttl 0 : jamais de cache.
  await dk.fetch("https://x/z", { provider: "e" });
  await dk.fetch("https://x/z", { provider: "e" });
  assert.equal(fetch.calls.length, 4);
});

/* ---------- Nouvels essais ---------- */

test("nouvel essai sur 5xx : backoff exponentiel 1 s puis 2 s (jitter neutre)", async () => {
  const fetch = fakeFetch((u, i, n) => (n < 3 ? resp(503) : resp(200, { ok: true })));
  const { dk, clk } = setup({ fetch });
  const s = track(dk.fetch("https://x/r", { provider: "f" }));
  await flush(); assert.equal(fetch.calls.length, 1);
  await clk.tick(999); assert.equal(fetch.calls.length, 1);
  await clk.tick(1); assert.equal(fetch.calls.length, 2);
  await clk.tick(1999); assert.equal(fetch.calls.length, 2);
  await clk.tick(1); assert.equal(fetch.calls.length, 3);
  assert.ok(s.ok); assert.equal(s.value.data.ok, true); assert.equal(s.value.from, "net");
  assert.equal(dk.logs({ provider: "f", level: "warn" }).filter((e) => /nouvel essai/.test(e.msg)).length, 2);
});

test("jitter : délai × (0,5 + aléa), plafonné à 30 s avant jitter", async () => {
  for (const [rnd, first] of [[0, 500], [1, 1500]]) {
    const fetch = fakeFetch((u, i, n) => (n < 2 ? resp(500) : resp(200)));
    const { dk, clk } = setup({ fetch, random: rnd });
    track(dk.fetch("https://x/j", { provider: "g" }));
    await flush();
    await clk.tick(first - 1); assert.equal(fetch.calls.length, 1, "aléa " + rnd);
    await clk.tick(1); assert.equal(fetch.calls.length, 2, "aléa " + rnd);
  }
  // Plafond : le 6e nouvel essai attend 30 s (et non 32 s).
  const fetch = fakeFetch(() => resp(500));
  const { dk, clk } = setup({ fetch });
  const s = track(dk.fetch("https://x/cap", { provider: "h", retries: 6 }));
  await flush();
  await clk.tick(1000 + 2000 + 4000 + 8000 + 16000);
  assert.equal(fetch.calls.length, 6);
  await clk.tick(29_999); assert.equal(fetch.calls.length, 6);
  await clk.tick(1); assert.equal(fetch.calls.length, 7);
  await flush(); assert.equal(s.ok, false); assert.match(s.error.message, /HTTP 500/);
});

test("Retry-After (secondes) est respecté sur un 429", async () => {
  const fetch = fakeFetch((u, i, n) => (n === 1 ? resp(429, {}, { "Retry-After": "5" }) : resp(200, { v: 1 })));
  const { dk, clk } = setup({ fetch });
  const s = track(dk.fetch("https://x/ra", { provider: "i" }));
  await flush();
  await clk.tick(4999); assert.equal(fetch.calls.length, 1);
  await clk.tick(1); assert.equal(fetch.calls.length, 2);
  assert.ok(s.ok); assert.equal(s.value.data.v, 1);
  // Retry-After au-delà de 60 s : on n'insiste pas.
  const f2 = fakeFetch(() => resp(429, {}, { "retry-after": "120" }));
  const k2 = setup({ fetch: f2 });
  const s2 = track(k2.dk.fetch("https://x/ra", { provider: "i" }));
  await k2.clk.tick(200_000);
  assert.equal(f2.calls.length, 1); assert.equal(s2.ok, false); assert.match(s2.error.message, /HTTP 429/);
});

test("nombre maximal d'essais : retries 2 → 3 appels puis rejet", async () => {
  const fetch = fakeFetch(() => resp(502));
  const { dk, clk } = setup({ fetch });
  const s = track(dk.fetch("https://x/m", { provider: "j", retries: 2 }));
  await clk.tick(60_000);
  assert.equal(fetch.calls.length, 3); assert.equal(s.ok, false); assert.match(s.error.message, /HTTP 502/);
  assert.ok(dk.logs({ provider: "j", level: "error" }).length >= 1, "échec final journalisé");
  // Option du provider : retries 0 → un seul appel.
  const f2 = fakeFetch(() => resp(500));
  const k2 = setup({ fetch: f2 });
  k2.dk.provider("j", { retries: 0 });
  const s2 = track(k2.dk.fetch("https://x/m", { provider: "j" }));
  await k2.clk.tick(60_000); assert.equal(f2.calls.length, 1); assert.equal(s2.ok, false);
});

test("nouvel essai sur erreur réseau et sur délai dépassé ; pas de nouvel essai sur 404", async () => {
  const fetch = fakeFetch((u, i, n) => (n === 1 ? Promise.reject(new TypeError("Failed to fetch")) : n === 2 ? new Promise(() => {}) : resp(200, { v: 3 })));
  const { dk, clk } = setup({ fetch });
  const s = track(dk.fetch("https://x/n", { provider: "k", timeout: 5000 }));
  await flush(); assert.equal(fetch.calls.length, 1);
  await clk.tick(1000); assert.equal(fetch.calls.length, 2, "après l'erreur réseau");
  await clk.tick(4999); assert.equal(s.done, false);
  await clk.tick(1); // délai dépassé
  await clk.tick(2000); assert.equal(fetch.calls.length, 3, "après le délai dépassé");
  assert.ok(s.ok); assert.equal(s.value.data.v, 3);
  assert.ok(dk.logs("k").some((e) => /Délai dépassé/.test(e.msg)));
  const f2 = fakeFetch(() => resp(404));
  const k2 = setup({ fetch: f2 });
  const s2 = track(k2.dk.fetch("https://x/404", { provider: "k" }));
  await k2.clk.tick(60_000); assert.equal(f2.calls.length, 1); assert.equal(s2.ok, false); assert.match(s2.error.message, /HTTP 404/);
});

test("validate : réponse invalide journalisée, ni nouvel essai ni mise en cache", async () => {
  const fetch = fakeFetch(() => resp(200, { data: "pas un tableau" }));
  const { dk, clk } = setup({ fetch });
  const o = { provider: "l", ttl: 60_000, validate: (d) => Array.isArray(d.data) || "data n'est pas un tableau" };
  const s = track(dk.fetch("https://x/v", o));
  await clk.tick(60_000);
  assert.equal(fetch.calls.length, 1); assert.equal(s.ok, false);
  assert.match(s.error.message, /Réponse invalide : data n'est pas un tableau/);
  assert.ok(dk.logs({ provider: "l", level: "error" }).some((e) => /Réponse invalide/.test(e.msg)));
  const s2 = track(dk.fetch("https://x/v", o));
  await flush(); assert.equal(fetch.calls.length, 2, "rien en cache : nouvel appel"); assert.equal(s2.ok, false);
});

test("CK.netOk / CK.netErr sont appelés s'ils existent", async () => {
  const fetch = fakeFetch((u, i, n) => (n === 1 ? resp(500) : resp(200)));
  const { CK, dk, clk } = setup({ fetch });
  const seen = [];
  CK.netOk = (url) => seen.push("ok " + url);
  CK.netErr = (url, e) => seen.push("err " + e.message);
  track(dk.fetch("https://x/no", { provider: "m" }));
  await clk.tick(5000);
  assert.deepEqual(seen, ["err HTTP 500", "ok https://x/no"]);
});

/* ---------- Disjoncteurs, onglet caché, repli ---------- */

test("disjoncteur guard : tvscan en 429 récent → aucun appel, cache stale servi ou rejet", async () => {
  const fetch = fakeFetch(() => resp(200, { data: [1] }));
  const { CK, dk, clk } = setup({ fetch });
  dk.provider("tvscan2", { rate: 0.2, burst: 2, budgetPerMin: 4, pauseHidden: true, guard: ["tvscan"], guardMs: 600_000 });
  const u = "https://scanner.tradingview.com/global/scan";
  await dk.fetch(u, { provider: "tvscan2", method: "POST", body: "{}", ttl: 60_000 });
  assert.equal(fetch.calls.length, 1);
  await clk.tick(120_000); // cache expiré
  CK.NET = { tvscan: { lastErr: clk.now() - 1000, lastOk: clk.now() - 500, code: 429 } };
  const r = await dk.fetch(u, { provider: "tvscan2", method: "POST", body: "{}", ttl: 60_000 });
  assert.equal(fetch.calls.length, 1, "aucun appel réseau");
  assert.equal(r.stale, true); assert.equal(r.from, "cache"); assert.deepEqual([...r.data.data], [1]);
  await assert.rejects(dk.fetch(u + "?autre", { provider: "tvscan2" }), /pause : tvscan en difficulté/);
  assert.equal(fetch.calls.length, 1);
  const st = dk.status("tvscan2");
  assert.equal(st.paused, true); assert.equal(st.until, CK.NET.tvscan.lastErr + 600_000);
  // Erreur plus récente que le dernier succès (sans 429) → pause aussi ; succès plus récent → pas de pause.
  CK.NET.tvscan = { lastErr: clk.now() - 1000, lastOk: clk.now() - 5000, code: 0 };
  await assert.rejects(dk.fetch(u + "?b", { provider: "tvscan2" }), /pause/);
  CK.NET.tvscan = { lastErr: clk.now() - 5000, lastOk: clk.now() - 1000, code: 0 };
  await dk.fetch(u + "?c", { provider: "tvscan2" });
  assert.equal(fetch.calls.length, 2);
  // Erreur vieille de plus de guardMs → plus de pause.
  CK.NET.tvscan = { lastErr: clk.now() - 600_001, lastOk: 0, code: 429 };
  await clk.tick(10_000);
  await dk.fetch(u + "?d", { provider: "tvscan2" });
  assert.equal(fetch.calls.length, 3);
});

test("disjoncteur propre : après un 429 du provider, pause guardMs sans appel réseau", async () => {
  const fetch = fakeFetch((u, i, n) => (n === 1 ? resp(429) : resp(200)));
  const { dk, clk } = setup({ fetch });
  dk.provider("n", { retries: 0, guardMs: 60_000 });
  await assert.rejects(dk.fetch("https://x/1", { provider: "n" }), /HTTP 429/);
  await assert.rejects(dk.fetch("https://x/2", { provider: "n" }), /pause : n en difficulté/);
  assert.equal(fetch.calls.length, 1);
  assert.equal(dk.status("n").paused, true);
  await clk.tick(60_000);
  const r = await dk.fetch("https://x/3", { provider: "n" });
  assert.equal(r.from, "net"); assert.equal(fetch.calls.length, 2); assert.equal(dk.status("n").paused, false);
});

test("pauseHidden : onglet caché → pas de réseau (cache stale ou rejet), sauf priorité high", async () => {
  const fetch = fakeFetch((u, i, n) => resp(200, { n }));
  const { dk, clk, flags } = setup({ fetch });
  dk.provider("o", { pauseHidden: true });
  await dk.fetch("https://x/c", { provider: "o", ttl: 1000 });
  await clk.tick(5000);
  flags.hidden = true;
  const r = await dk.fetch("https://x/c", { provider: "o", ttl: 1000 });
  assert.equal(r.stale, true); assert.equal(r.from, "cache"); assert.equal(fetch.calls.length, 1);
  await assert.rejects(dk.fetch("https://x/autre", { provider: "o" }), /onglet caché/);
  const h = await dk.fetch("https://x/autre", { provider: "o", priority: "high" });
  assert.equal(h.from, "net"); assert.equal(fetch.calls.length, 2);
  // Sans pauseHidden, l'onglet caché ne change rien.
  await dk.fetch("https://x/p", { provider: "p" });
  assert.equal(fetch.calls.length, 3);
});

test("échec final : cache expiré → {stale:true, from:'cache'} ; sans cache → rejet", async () => {
  const fetch = fakeFetch((u, i, n) => (n === 1 ? resp(200, { v: "ancien" }) : resp(500)));
  const { dk, clk } = setup({ fetch });
  dk.provider("q", { retries: 0 });
  const a = await dk.fetch("https://x/s", { provider: "q", ttl: 1000 });
  await clk.tick(2000);
  const b = await dk.fetch("https://x/s", { provider: "q", ttl: 1000 });
  assert.equal(fetch.calls.length, 2);
  assert.equal(b.stale, true); assert.equal(b.from, "cache"); assert.equal(b.data.v, "ancien"); assert.equal(b.ts, a.ts);
  await assert.rejects(dk.fetch("https://x/sans-cache", { provider: "q", ttl: 1000 }), /HTTP 500/);
});

test("hors ligne (env.online faux) : aucun appel, cache ou rejet", async () => {
  const { dk, flags, fetch } = setup();
  flags.online = false;
  await assert.rejects(dk.fetch("https://x/off", { provider: "r" }), /hors ligne/);
  assert.equal(fetch.calls.length, 0);
});

test("provider obligatoire", async () => {
  const { dk } = setup();
  await assert.rejects(dk.fetch("https://x/"), /provider manquant/);
});

/* ---------- Statuts ---------- */

test("statuts : inactif, connectee, degradee, obsolete, hors_ligne", async () => {
  let mode = "ok";
  const fetch = fakeFetch(() => (mode === "ok" ? resp(200, { v: 1 }) : resp(500)));
  const { dk, clk } = setup({ fetch });
  assert.equal(dk.status("inconnu").state, "inactif");
  dk.provider("s", { period: 60_000, staleMs: 1_800_000, retries: 0 });
  const s0 = dk.status("s");
  assert.equal(s0.state, "inactif"); assert.equal(s0.label, "Inactive"); assert.equal(s0.calls, 0);
  await dk.fetch("https://x/1", { provider: "s", ttl: 30_000 });
  let st = dk.status("s");
  assert.equal(st.state, "connectee"); assert.equal(st.label, "Connectée"); assert.equal(st.calls, 1); assert.equal(st.lastOk, clk.now());
  await clk.tick(120_001);
  assert.equal(dk.status("s").state, "degradee", "pas de nouvelles depuis plus de 2 périodes");
  await clk.tick(1_800_000);
  assert.equal(dk.status("s").state, "obsolete");
  // Échec avec cache : servi stale → dégradée tant que les données ont moins de staleMs… ici elles sont trop vieilles → obsolète.
  mode = "err";
  const r = await dk.fetch("https://x/1", { provider: "s", ttl: 30_000 });
  assert.equal(r.stale, true);
  st = dk.status("s");
  assert.equal(st.state, "obsolete"); assert.equal(st.label, "Données obsolètes"); assert.equal(st.errors, 1); assert.match(st.msg, /HTTP 500/);
  // Échec sans données → hors ligne.
  await assert.rejects(dk.fetch("https://x/2", { provider: "s" }));
  assert.equal(dk.status("s").state, "hors_ligne"); assert.equal(dk.status("s").label, "Hors ligne");
  // Retour à la normale, mais erreur récente → dégradée, puis connectée après 2 périodes sans erreur.
  mode = "ok";
  await dk.fetch("https://x/3", { provider: "s" });
  assert.equal(dk.status("s").state, "degradee");
  await clk.tick(120_001);
  await dk.fetch("https://x/4", { provider: "s" });
  assert.equal(dk.status("s").state, "connectee");
});

test("statut dégradé quand le cache stale récent est servi", async () => {
  const fetch = fakeFetch((u, i, n) => (n === 1 ? resp(200) : resp(503)));
  const { dk, clk } = setup({ fetch });
  dk.provider("t", { retries: 0, period: 60_000 });
  await dk.fetch("https://x/1", { provider: "t", ttl: 10_000 });
  await clk.tick(10_000);
  const r = await dk.fetch("https://x/1", { provider: "t", ttl: 10_000 });
  assert.equal(r.stale, true);
  assert.equal(dk.status("t").state, "degradee");
});

/* ---------- Journal ---------- */

test("journal : anneau de 500 entrées, plus récentes en dernier, filtres", () => {
  const { dk } = setup();
  for (let i = 0; i < 600; i++) dk.log(i % 2 ? "warn" : "info", i % 3 ? "a" : "b", "m" + i, { i });
  const all = dk.logs();
  assert.equal(all.length, 500);
  assert.equal(all[0].msg, "m100"); assert.equal(all[499].msg, "m599"); assert.equal(all[499].extra.i, 599);
  assert.deepEqual(Object.keys(all[0]).sort(), ["extra", "level", "msg", "provider", "ts"]);
  assert.ok(dk.logs("b").every((e) => e.provider === "b"));
  assert.ok(dk.logs({ level: "warn" }).every((e) => e.level === "warn"));
  assert.equal(dk.logs((e) => e.msg === "m42").length, 0);
  assert.equal(dk.log("bizarre", "x", "y").level, "info", "niveau inconnu → info");
  dk._reset();
  assert.equal(dk.logs().length, 0);
});

/* ---------- IndexedDB ---------- */

async function idbRoundTrip(dk) {
  await dk.idb.put("bars", "k1", { a: [1, 2] });
  await dk.idb.put("bars", "k2", 5);
  const v = await dk.idb.get("bars", "k1");
  assert.deepEqual(JSON.parse(JSON.stringify(v)), { a: [1, 2] });
  assert.deepEqual([...(await dk.idb.keys("bars"))].sort(), ["k1", "k2"]);
  await dk.idb.del("bars", "k1");
  assert.equal(await dk.idb.get("bars", "k1"), undefined);
  await dk.idb.clear("bars");
  assert.equal((await dk.idb.keys("bars")).length, 0);
  await assert.rejects(dk.idb.get("inconnu", "x"), /store inconnu/);
}

test("idb : indexedDB absent → repli mémoire transparent", async () => {
  const { dk } = setup({ indexedDB: null });
  assert.equal(dk.idb.mode(), "memoire");
  await idbRoundTrip(dk);
  assert.equal(dk.idb.mode(), "memoire");
  assert.equal(dk.idb.name(), "cockpit:desk:marches");
});

test("idb : indexedDB.open qui lève, ou qui échoue → repli mémoire", async () => {
  const k1 = setup({ indexedDB: { open() { throw new Error("SecurityError"); } } });
  await idbRoundTrip(k1.dk);
  assert.equal(k1.dk.idb.mode(), "memoire");
  const opened = [];
  const k2 = setup({ indexedDB: { open(name) { opened.push(name); const r = {}; Promise.resolve().then(() => r.onerror && r.onerror()); return r; } } });
  k2.CK.cfg = () => ({ id: "perso" });
  await idbRoundTrip(k2.dk);
  assert.equal(k2.dk.idb.mode(), "memoire");
  assert.deepEqual(opened, ["cockpit:perso:marches"]);
});

test("idb : base ouverte mais transaction en erreur → repli mémoire", async () => {
  const db = { objectStoreNames: { contains: () => true }, transaction() { throw new Error("InvalidStateError"); } };
  const fake = { open() { const r = { result: db }; Promise.resolve().then(() => r.onsuccess && r.onsuccess()); return r; } };
  const { dk } = setup({ indexedDB: fake });
  assert.equal(dk.idb.mode(), "indexeddb");
  await dk.idb.put("meta", "x", 1);
  assert.equal(dk.idb.mode(), "memoire");
  assert.equal(await dk.idb.get("meta", "x"), 1);
});

test("aucune minuterie, aucun appel réseau au chargement", () => {
  const { CK, load, timers, window } = makeContext();
  let called = 0;
  window.fetch = () => { called++; return new Promise(() => {}); };
  load("models.js"); load("datakit.js");
  assert.equal(timers.length, 0); assert.equal(called, 0);
  for (const k of ["fetch", "WebSocket", "now", "random", "setTimeout", "clearTimeout", "hidden", "online"]) assert.equal(typeof CK.dk.env[k], "function", k);
});

test("environnement par défaut : les globals sont lus au moment de l'appel, pas au chargement", async () => {
  const { CK, load, window } = makeContext();
  load("models.js"); load("datakit.js");
  const urls = [];
  window.fetch = (u) => { urls.push(u); return Promise.resolve(resp(200, { tard: true })); };
  const r = await CK.dk.fetch("https://x/tard", { provider: "u" });
  assert.equal(r.data.tard, true); assert.deepEqual(urls, ["https://x/tard"]);
});

/* ---------- Cas limites ajoutés à la relecture ---------- */

test("disjoncteur propre : les requêtes déjà en file ne partent plus après un 429", async () => {
  const fetch = fakeFetch((u, i, n) => (n === 1 ? resp(429) : resp(200)));
  const { dk, clk } = setup({ fetch });
  dk.provider("w", { rate: 1, burst: 1, retries: 0, guardMs: 60_000 });
  const a = track(dk.fetch("https://x/a", { provider: "w" }));
  const b = track(dk.fetch("https://x/b", { provider: "w" }));
  const c = track(dk.fetch("https://x/c", { provider: "w" }));
  await clk.tick(5000);
  assert.equal(fetch.calls.length, 1, "aucun appel après le 429");
  assert.equal(a.ok, false); assert.match(a.error.message, /HTTP 429/);
  assert.equal(b.ok, false); assert.match(b.error.message, /pause : w en difficulté/);
  assert.equal(c.ok, false); assert.match(c.error.message, /pause/);
  assert.equal(dk.status("w").errors, 1, "une pause n'est pas comptée comme une erreur réseau");
});

test("guard : une erreur du provider lui-même (non 429) ne le met pas en pause 10 min", async () => {
  // CK.netErr de core.js remplit CK.NET.tvscan pour toute URL du scanner, y compris celles de tvscan2.
  const fetch = fakeFetch((u, i, n) => (n === 1 ? resp(503) : resp(200, { data: [] })));
  const { CK, dk, clk } = setup({ fetch });
  CK.NET = {};
  CK.netErr = () => { const r = CK.NET.tvscan || (CK.NET.tvscan = { lastOk: 0, lastErr: 0, code: 0 }); r.lastErr = clk.now(); r.code = 0; };
  CK.netOk = () => { const r = CK.NET.tvscan || (CK.NET.tvscan = { lastOk: 0, lastErr: 0, code: 0 }); r.lastOk = clk.now(); };
  dk.provider("tvscan2", { guard: ["tvscan"], guardMs: 600_000, retries: 0 });
  const u = "https://scanner.tradingview.com/global/scan";
  await assert.rejects(dk.fetch(u, { provider: "tvscan2" }), /HTTP 503/);
  await clk.tick(1000);
  const r = await dk.fetch(u, { provider: "tvscan2" });
  assert.equal(r.from, "net"); assert.equal(fetch.calls.length, 2);
  // Une erreur venue d'ailleurs (le screener) déclenche toujours la pause.
  CK.NET.tvscan.lastErr = clk.now() + 1;
  await clk.tick(10);
  await assert.rejects(dk.fetch(u + "?x", { provider: "tvscan2" }), /pause : tvscan en difficulté/);
  assert.equal(fetch.calls.length, 2);
});

test("fetch ne lève jamais : un corps circulaire ou une option bizarre donne un rejet", async () => {
  const { dk, fetch } = setup();
  const body = {}; body.self = body;
  const p = dk.fetch("https://x/circ", { provider: "y", method: "POST", body });
  assert.ok(p && typeof p.then === "function");
  await assert.rejects(p);
  assert.equal(fetch.calls.length, 0);
});

test("options numériques passées en chaîne : guardMs et budget restent des nombres", async () => {
  const fetch = fakeFetch((u, i, n) => (n === 1 ? resp(429) : resp(200)));
  const { dk, clk } = setup({ fetch });
  const c = dk.provider("z", { retries: "0", guardMs: "60000", budgetPerMin: "2" });
  assert.equal(c.guardMs, 60_000); assert.equal(c.retries, 0); assert.equal(c.budgetPerMin, 2);
  await assert.rejects(dk.fetch("https://x/1", { provider: "z" }), /HTTP 429/);
  assert.equal(dk.status("z").until, clk.now() + 60_000);
});

test("idb : window.indexedDB qui lève à la lecture → repli mémoire, sans rejet", async () => {
  // Dans un navigateur, lire window.indexedDB peut lever (iframe isolée, cookies bloqués). node:vm ne relaie pas
  // un accesseur posé sur window : on le pose donc sur CK.dk.env, lu de la même façon.
  const { CK, load } = makeContext();
  load("models.js"); load("datakit.js");
  CK.dk.env.setTimeout = () => 1; CK.dk.env.clearTimeout = () => {};
  Object.defineProperty(CK.dk.env, "indexedDB", { get() { throw new Error("SecurityError"); }, configurable: true });
  assert.equal(CK.dk.idb.mode(), "memoire");
  await CK.dk.idb.put("quotes", "a", { v: 1 });
  assert.equal((await CK.dk.idb.get("quotes", "a")).v, 1);
  assert.equal(CK.dk.idb.mode(), "memoire");
});

test("idb : ouverture trop lente → mémoire, et la base ouverte trop tard est refermée", async () => {
  let closed = 0, req;
  const db = { objectStoreNames: { contains: () => true }, close() { closed++; } };
  const fake = { open() { req = { result: db }; return req; } };
  const { dk, clk } = setup({ indexedDB: fake });
  const s = track(dk.idb.put("bars", "k", 1));
  await clk.tick(5000);
  assert.ok(s.ok); assert.equal(dk.idb.mode(), "memoire");
  req.onsuccess();
  assert.equal(closed, 1);
  assert.equal(await dk.idb.get("bars", "k"), 1);
});
