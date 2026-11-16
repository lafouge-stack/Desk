// Tests de CK.dk.ws (datakit.js) : reconnexion, backoff plafonné avec jitter, remise à zéro à l'ouverture,
// délai de connexion, constructeur qui lève, chien de garde sur le ping uniquement, close() définitif, online().
// Faux WebSocket et fausse horloge injectés via CK.dk.env : aucun vrai réseau, aucune vraie minuterie.
//
// Comportement attendu du chien de garde :
//  - sans ping configuré : AUCUN chien de garde (une connexion silencieuse reste ouverte indéfiniment) ;
//  - avec ping {msg, every, isPong, timeout} : un ping part toutes les `every` ms ; si aucun message reconnu
//    par isPong n'arrive pendant `timeout`, on reconnecte, MÊME si d'autres données arrivent entre-temps.
//    Les messages pong ne sont pas transmis à onMessage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeContext } from "./vmkit.mjs";

const flush = async () => { for (let i = 0; i < 2; i++) await new Promise((r) => setImmediate(r)); };

function fakeClock(t0 = 1_700_000_000_000) {
  let t = t0, seq = 0;
  const q = [];
  return {
    now: () => t,
    setTimeout: (f, ms) => { const h = ++seq; q.push({ h, at: t + Math.max(0, Number(ms) || 0), ms, f }); return h; },
    clearTimeout: (h) => { const i = q.findIndex((x) => x.h === h); if (i >= 0) q.splice(i, 1); },
    pending: () => q.slice().sort((a, b) => a.at - b.at || a.h - b.h),
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

/** Faux WebSocket : garde les sockets créés ; open()/msg()/drop() simulent le serveur. */
function wsKit() {
  const socks = [];
  const kit = { socks, throwNext: 0 };
  kit.WS = class FakeWS {
    constructor(url) {
      if (kit.throwNext > 0) { kit.throwNext--; throw new Error("refusé"); }
      this.url = url; this.sent = []; this.closed = false; socks.push(this);
    }
    send(m) { this.sent.push(m); }
    close() { this.closed = true; }
    open() { if (this.onopen) this.onopen({}); }
    msg(d) { if (this.onmessage) this.onmessage({ data: d }); }
    drop(code = 1006) { this.closed = true; if (this.onclose) this.onclose({ code }); }
  };
  kit.last = () => socks[socks.length - 1];
  return kit;
}

function setup({ random = 0.5 } = {}) {
  const { CK, load } = makeContext();
  load("models.js"); load("datakit.js");
  const clk = fakeClock(), kit = wsKit();
  CK.dk.env = { WebSocket: kit.WS, now: clk.now, setTimeout: clk.setTimeout, clearTimeout: clk.clearTimeout, random: () => random, hidden: () => true, online: () => true };
  return { dk: CK.dk, clk, kit };
}
/** Délai de la prochaine minuterie programmée (la plus récente). */
const lastDelay = (clk) => { const p = clk.pending(); return p.reduce((a, b) => (b.h > a.h ? b : a)).ms; };

test("connexion, onOpen, onMessage, send ; reconnexion après fermeture", async () => {
  const { dk, clk, kit } = setup();
  const got = [], opened = [];
  const h = dk.ws("wss://x", { name: "t", onOpen: (s) => opened.push(s), onMessage: (d) => got.push(d) });
  assert.equal(h.state(), "connexion");
  assert.equal(kit.socks.length, 1); assert.equal(kit.last().url, "wss://x");
  assert.equal(h.send("tôt"), false, "rien n'est envoyé avant l'ouverture");
  kit.last().open();
  assert.equal(h.state(), "ouvert"); assert.equal(opened[0], kit.socks[0]);
  assert.equal(h.send({ op: "subscribe" }), true); assert.equal(h.send("brut"), true);
  assert.deepEqual(kit.last().sent, ['{"op":"subscribe"}', "brut"]);
  kit.last().msg("a"); kit.last().msg("b");
  assert.deepEqual(got, ["a", "b"]);
  kit.last().drop();
  assert.equal(h.state(), "reconnexion");
  await clk.tick(1499); assert.equal(kit.socks.length, 1);
  await clk.tick(1); assert.equal(kit.socks.length, 2);
  assert.equal(h.state(), "reconnexion");
  kit.last().open(); assert.equal(h.state(), "ouvert");
  kit.socks[0].msg("fantôme"); assert.deepEqual(got, ["a", "b"], "l'ancien socket est ignoré");
  h.close();
});

test("backoff 1,5 s × 2^k plafonné par maxBackoff, avec jitter ×0,5..1,5", async () => {
  for (const [rnd, f] of [[0.5, 1], [0, 0.5], [1, 1.5]]) {
    const { dk, clk, kit } = setup({ random: rnd });
    const h = dk.ws("wss://x", { maxBackoff: 10_000 });
    const delays = [];
    for (let i = 0; i < 5; i++) {
      kit.last().drop();
      const d = lastDelay(clk); delays.push(d);
      await clk.tick(d);
    }
    assert.deepEqual(delays, [1500, 3000, 6000, 10_000, 10_000].map((x) => Math.round(x * f)), "aléa " + rnd);
    assert.equal(kit.socks.length, 6);
    h.close();
  }
});

test("le backoff repart de zéro après une ouverture réussie", async () => {
  const { dk, clk, kit } = setup();
  const h = dk.ws("wss://x", {});
  kit.last().drop(); await clk.tick(1500);
  kit.last().drop(); assert.equal(lastDelay(clk), 3000); await clk.tick(3000);
  kit.last().drop(); assert.equal(lastDelay(clk), 6000); await clk.tick(6000);
  kit.last().open();
  kit.last().drop(); assert.equal(lastDelay(clk), 1500);
  h.close();
});

test("délai de connexion : pas ouvert après connectTimeout → fermeture et nouvel essai", async () => {
  const { dk, clk, kit } = setup();
  const h = dk.ws("wss://x", { connectTimeout: 10_000 });
  await clk.tick(9999);
  assert.equal(kit.socks[0].closed, false); assert.equal(h.state(), "connexion");
  await clk.tick(1);
  assert.equal(kit.socks[0].closed, true); assert.equal(h.state(), "reconnexion");
  await clk.tick(1500);
  assert.equal(kit.socks.length, 2);
  kit.last().open();
  await clk.tick(60_000);
  assert.equal(kit.socks.length, 2, "une fois ouvert, le délai de connexion ne joue plus");
  assert.ok(dk.logs().some((e) => /délai de connexion/.test(e.msg)));
  h.close();
});

test("constructeur WebSocket qui lève → nouvel essai programmé, sans abandon", async () => {
  const { dk, clk, kit } = setup();
  kit.throwNext = 3;
  const h = dk.ws("wss://x", {});
  assert.equal(kit.socks.length, 0); assert.equal(h.state(), "reconnexion");
  await clk.tick(1500); assert.equal(kit.socks.length, 0);
  await clk.tick(3000); assert.equal(kit.socks.length, 0);
  await clk.tick(6000); assert.equal(kit.socks.length, 1);
  kit.last().open(); assert.equal(h.state(), "ouvert");
  assert.ok(dk.logs().some((e) => /connexion impossible : refusé/.test(e.msg)));
  h.close();
});

test("sans ping configuré : aucun chien de garde, même sans aucune donnée pendant 1 h", async () => {
  const { dk, clk, kit } = setup();
  const h = dk.ws("wss://x", {});
  kit.last().open();
  await clk.tick(3_600_000);
  assert.equal(kit.socks.length, 1); assert.equal(kit.socks[0].closed, false); assert.equal(h.state(), "ouvert");
  assert.deepEqual(kit.socks[0].sent, []);
  h.close();
});

test("avec ping : reconnexion si aucun pong pendant ping.timeout, même si des données arrivent", async () => {
  const { dk, clk, kit } = setup();
  const got = [];
  const h = dk.ws("wss://x", { onMessage: (d) => got.push(d), ping: { msg: "ping", every: 20_000, timeout: 90_000, isPong: (d) => d === "pong" } });
  const s = kit.last(); s.open();
  for (let t = 0; t < 95_000; t += 5000) { await clk.tick(5000); s.msg("donnée"); }
  assert.equal(s.closed, false, "encore ouvert à 95 s");
  assert.equal(s.sent.filter((m) => m === "ping").length, 4, "un ping toutes les 20 s");
  await clk.tick(5000);
  assert.equal(s.closed, true, "aucun pong depuis plus de 90 s → reconnexion");
  assert.equal(h.state(), "reconnexion");
  assert.ok(got.length >= 18 && got.every((d) => d === "donnée"));
  await clk.tick(1500); assert.equal(kit.socks.length, 2);
  h.close();
});

test("avec ping : des pongs réguliers suffisent, même sans données ; les pongs ne vont pas à onMessage", async () => {
  const { dk, clk, kit } = setup();
  const got = [];
  const h = dk.ws("wss://x", { onMessage: (d) => got.push(d), ping: { msg: { op: "ping" }, every: 20_000, timeout: 90_000, isPong: (d) => d === "pong" } });
  const s = kit.last(); s.open();
  for (let t = 0; t < 600_000; t += 20_000) { await clk.tick(20_000); s.msg("pong"); }
  assert.equal(s.closed, false); assert.equal(kit.socks.length, 1); assert.equal(h.state(), "ouvert");
  assert.deepEqual(got, []);
  assert.equal(s.sent[0], '{"op":"ping"}', "un ping objet est envoyé en JSON");
  h.close();
});

test("close() est définitif : plus aucune reconnexion", async () => {
  const { dk, clk, kit } = setup();
  const h = dk.ws("wss://x", { ping: { msg: "ping", isPong: () => false } });
  kit.last().open();
  h.close();
  assert.equal(h.state(), "ferme"); assert.equal(kit.socks[0].closed, true);
  kit.socks[0].drop();
  await clk.tick(3_600_000);
  assert.equal(kit.socks.length, 1); assert.equal(h.state(), "ferme");
  assert.equal(h.online(), false); assert.equal(h.send("x"), false);
  assert.equal(clk.pending().length, 0, "aucune minuterie restante");
  // close() pendant l'attente d'une reconnexion annule la minuterie.
  const h2 = dk.ws("wss://y", {});
  kit.last().drop(); assert.equal(clk.pending().length, 1);
  h2.close(); assert.equal(clk.pending().length, 0);
});

test("online() reconnecte tout de suite et remet le backoff à zéro", async () => {
  const { dk, clk, kit } = setup();
  const h = dk.ws("wss://x", {});
  kit.last().drop(); await clk.tick(1500);
  kit.last().drop(); assert.equal(lastDelay(clk), 3000);
  assert.equal(h.online(), true);
  assert.equal(kit.socks.length, 3, "nouvelle connexion immédiate");
  await clk.tick(3000); assert.equal(kit.socks.length, 3, "l'ancienne minuterie est annulée");
  kit.last().drop(); assert.equal(lastDelay(clk), 1500, "backoff remis à zéro");
  await clk.tick(1500);
  kit.last().open();
  assert.equal(h.online(), false, "déjà ouvert : rien à faire");
  assert.equal(kit.socks.length, 4);
  // Variante globale : CK.dk.ws.online() relance toutes les connexions en attente.
  kit.last().drop();
  assert.equal(dk.ws.online(), 1); assert.equal(kit.socks.length, 5);
  h.close();
});

test("onglet caché : pas de pause pour les WebSocket ; statut du provider", async () => {
  const { dk, clk, kit } = setup();
  assert.equal(dk.status("okxws").state, "inactif");
  const h = dk.ws("wss://x", { provider: "okxws" });
  kit.last().open();
  assert.equal(dk.status("okxws").state, "connectee");
  await clk.tick(60_000);
  assert.equal(kit.socks[0].closed, false);
  kit.last().drop();
  assert.equal(dk.status("okxws").errors, 1);
  h.close();
});

test("erreurs dans onOpen / onMessage : journalisées, la connexion continue", async () => {
  const { dk, kit } = setup();
  const h = dk.ws("wss://x", { name: "z", onOpen: () => { throw new Error("o"); }, onMessage: () => { throw new Error("m"); } });
  kit.last().open(); kit.last().msg("x");
  assert.equal(h.state(), "ouvert");
  assert.deepEqual([...dk.logs({ provider: "z", level: "error" })].map((e) => e.msg), ["onOpen : o", "onMessage : m"]);
  h.close();
});

/* ---------- Cas limites ajoutés à la relecture ---------- */

test("ping.timeout plus court que ping.every : pas de reconnexion si chaque ping reçoit son pong", async () => {
  const { dk, clk, kit } = setup();
  let s;
  const h = dk.ws("wss://x", { ping: { msg: "ping", every: 30_000, timeout: 10_000, isPong: (d) => d === "pong" } });
  s = kit.last();
  // Le serveur répond 100 ms après chaque ping.
  s.send = function (m) { this.sent.push(m); clk.setTimeout(() => this.msg("pong"), 100); };
  s.open();
  await clk.tick(300_000);
  assert.equal(s.closed, false); assert.equal(kit.socks.length, 1); assert.equal(h.state(), "ouvert");
  assert.ok(s.sent.length >= 9);
  // Plus aucun pong : reconnexion.
  s.send = function (m) { this.sent.push(m); };
  await clk.tick(120_000);
  assert.equal(s.closed, true); assert.equal(h.state(), "reconnexion");
  h.close();
});

test("statut d'un WebSocket qui n'arrive jamais à s'ouvrir : hors ligne (et non inactif)", async () => {
  const { dk, clk, kit } = setup();
  kit.throwNext = 1;
  const h = dk.ws("wss://x", { provider: "binws2", connectTimeout: 5000 });
  assert.equal(dk.status("binws2").state, "hors_ligne");
  await clk.tick(1500); assert.equal(kit.socks.length, 1);
  await clk.tick(5000);
  assert.equal(dk.status("binws2").state, "hors_ligne");
  assert.match(dk.status("binws2").msg, /délai de connexion/);
  await clk.tick(3000);
  kit.last().open();
  assert.equal(dk.status("binws2").state, "degradee", "ouvert, mais erreurs récentes");
  // Coupure après ouverture : données récentes, donc dégradée ; échec de la reconnexion → hors ligne.
  kit.last().drop();
  assert.equal(dk.status("binws2").state, "degradee");
  await clk.tick(1500); await clk.tick(5000);
  assert.equal(dk.status("binws2").state, "hors_ligne");
  h.close();
});
