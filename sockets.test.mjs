// Connexions en direct du crypto (core.js → socket) : durcissement minimal de la phase 8, avec une fausse WebSocket.
// Vérifie : nouvel essai si l'ouverture est refusée, délai qui double (plafonné à 60 s), reconnexion immédiate au retour du
// réseau (« online »), jamais deux connexions ni deux minuteries, et aucun chien de garde sur l'absence de messages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeContext } from "./vmkit.mjs";

function setup(failFirst = 0) {
  const k = makeContext(), w = k.window, on = {};
  w.addEventListener = (t, f) => { (on[t] = on[t] || []).push(f); };
  class FakeWS {
    constructor(url) { if (FakeWS.fail > 0) { FakeWS.fail--; throw new Error("refusé"); } this.url = url; this.readyState = 0; this.sent = []; FakeWS.all.push(this); }
    send(x) { this.sent.push(x); }
    close() { if (this.readyState === 3) return; this.readyState = 3; if (this.onclose) this.onclose(); }
    open() { this.readyState = 1; if (this.onopen) this.onopen(); }
  }
  FakeWS.all = []; FakeWS.fail = failFirst; w.WebSocket = FakeWS;
  k.load("core.js");
  const opened = [], msgs = [];
  // core.js crée son propre objet CK (window.CK = {}) : on lit celui de la fenêtre
  const s = w.CK._socket("Test", "wss://exemple.test/ws", (ws) => opened.push(ws), (m) => msgs.push(m), "ping");
  const fire = (t) => (on[t] || []).forEach((f) => f());
  const due = () => k.timers.filter((x) => x.kind === "timeout" && !x.done);
  const run = (x) => { x.done = true; x.f(); };
  return { k, FakeWS, s, opened, msgs, fire, due, run, timers: k.timers };
}

test("ouverture refusée par le navigateur : un nouvel essai est programmé (avant : abandon définitif)", () => {
  const t = setup(2);
  assert.equal(t.FakeWS.all.length, 0);
  assert.equal(t.due().length, 1); assert.equal(t.due()[0].ms, 1500);
  t.run(t.due()[0]); assert.equal(t.due().length, 1); assert.equal(t.due()[0].ms, 3000, "délai doublé");
  t.run(t.due()[0]); assert.equal(t.FakeWS.all.length, 1);
  t.FakeWS.all[0].open(); assert.equal(t.opened.length, 1);
});

test("fermeture : une seule minuterie de reconnexion, délai qui double jusqu'à 60 s", () => {
  const t = setup(); t.FakeWS.all[0].open();
  const delays = [];
  for (let i = 0; i < 8; i++) { const ws = t.FakeWS.all[t.FakeWS.all.length - 1]; ws.close(); ws.close();
    assert.equal(t.due().length, 1, "une seule minuterie"); delays.push(t.due()[0].ms); t.run(t.due()[0]); }
  assert.deepEqual(delays, [1500, 3000, 6000, 12000, 24000, 48000, 60000, 60000]);
  t.FakeWS.all[t.FakeWS.all.length - 1].open();
  t.FakeWS.all[t.FakeWS.all.length - 1].close(); assert.equal(t.due()[0].ms, 1500, "remis à 1,5 s après une connexion réussie");
});

test("retour du réseau : reconnexion immédiate, et la minuterie en attente n'ouvre pas une deuxième connexion", () => {
  const t = setup(); t.FakeWS.all[0].open(); t.FakeWS.all[0].close(); t.run(t.due()[0]); t.FakeWS.all[1].close();
  assert.equal(t.due()[0].ms, 3000); const pending = t.due()[0];
  t.fire("online"); assert.equal(t.FakeWS.all.length, 3, "reconnexion tout de suite");
  t.run(pending); assert.equal(t.FakeWS.all.length, 3, "pas de deuxième connexion");
  t.FakeWS.all[2].open(); t.fire("online"); assert.equal(t.FakeWS.all.length, 3, "connexion ouverte : rien à faire");
});

test("aucun chien de garde sur le silence : connexion ouverte sans message, seule la minuterie de ping existe", () => {
  const t = setup(); const before = t.timers.length; t.FakeWS.all[0].open();
  const added = t.timers.slice(before);
  assert.deepEqual(added.map((x) => [x.kind, x.ms]), [["interval", 20000]]);
  added[0].f(); assert.deepEqual(t.FakeWS.all[0].sent, ["ping"]);
});

test("messages : JSON lu, « pong » ignoré, envoi seulement quand la connexion est ouverte", () => {
  const t = setup(); const ws = t.FakeWS.all[0];
  t.s.send({ a: 1 }); assert.equal(ws.sent.length, 0);
  ws.open(); t.s.send({ a: 1 }); assert.deepEqual(ws.sent, ['{"a":1}']);
  ws.onmessage({ data: "pong" }); ws.onmessage({ data: '{"x":2}' }); ws.onmessage({ data: "pas du json" });
  assert.deepEqual(JSON.parse(JSON.stringify(t.msgs)), [{ x: 2 }]);
});
