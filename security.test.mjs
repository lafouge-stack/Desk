// Sécurité de models.js : charges utiles XSS neutralisées, pollution de prototype impossible,
// textes géants tronqués. Tout texte externe passe par cleanText (puis esc() à l'affichage).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { makeContext, rng } from "./vmkit.mjs";

const k = makeContext();
const CK = k.load("models.js");
const M = CK.models;
const plain = (v) => JSON.parse(JSON.stringify(v));
// Object.prototype du contexte vm ET celui de Node : aucun des deux ne doit être pollué.
const VM_PROTO = vm.runInContext("Object.prototype", k.ctx);
const pollue = () => [VM_PROTO, Object.prototype].some((p) => "pollue" in p || "isAdmin" in p);

const XSS = [
  "<img src=x onerror=alert(1)>",
  "<IMG SRC=x OnError=alert(document.cookie)>",
  "<script>alert(1)</script>",
  "<ScRiPt src=//evil.example/x.js></ScRiPt>",
  "<svg/onload=alert(1)>",
  "<a href=\"javascript:alert(1)\">clic</a>",
  "<iframe src=javascript:alert(1)>",
  "<div style=\"background:url(javascript:alert(1))\" onmouseover=\"alert(1)\">x</div>",
  "<img src=x onerror=alert(1)//",
  "<scr<script>ipt>alert(1)</scr</script>ipt>",
  "\"><img src=x onerror=alert(1)>",
  "<body onload=alert(1)>",
  "<details open ontoggle=alert(1)>",
  "<math><mtext></mtext><mglyph><svg><mtext><textarea><path id=\"</textarea><img onerror=alert(1) src=1>\">",
  "<!--<img src=x onerror=alert(1)>-->",
  "<</p>img src=x onerror=alert(1)>"
];
/** Vrai si le texte contient encore un début de balise HTML exploitable. */
const tagLike = (s) => /<[A-Za-z!\/?]/.test(s);

describe("cleanText neutralise les charges utiles XSS", () => {
  for (const p of XSS) test("aucune balise après nettoyage : " + p.slice(0, 50), () => {
    const t = M.cleanText(p, 500);
    assert.equal(tagLike(t), false, JSON.stringify(t));
  });
  test("le texte utile autour de la balise est conservé", () => {
    assert.equal(M.cleanText("Amundi <img src=x onerror=alert(1)> World"), "Amundi World");
    assert.equal(M.cleanText("<script>alert(1)</script>Total"), "alert(1) Total", "le contenu devient du texte inerte (esc() à l'affichage)");
  });
  test("javascript: hors balise reste du texte inerte (aucune balise créée)", () => {
    const t = M.cleanText("javascript:alert(1)");
    assert.equal(t, "javascript:alert(1)");
    assert.equal(tagLike(t), false);
  });
  test("caractères de contrôle et retours à la ligne ne survivent pas (pas d'injection d'en-tête ou de ligne CSV)", () => {
    const t = M.cleanText("Nom\r\nSet-Cookie: x=1\u0000\u2028fin");
    assert.equal(/[\u0000-\u001F\u2028]/.test(t), false);
    assert.equal(t, "Nom Set-Cookie: x=1 fin");
  });
  test("aléatoire : 500 mélanges de fragments HTML → jamais de balise", () => {
    const frag = ["<", ">", "img", "script", " src=x", " onerror=alert(1)", "/", "\"", "'", "a", "<svg", "<!--", "-->", "javascript:", "=", " ", "\n", "</"];
    const r = rng(1337);
    for (let n = 0; n < 500; n++) {
      let s = ""; for (let j = 0; j < 3 + r() * 15; j++) s += frag[Math.floor(r() * frag.length)];
      assert.equal(tagLike(M.cleanText(s, 1000)), false, JSON.stringify(s));
    }
  });
});

describe("normInstrument neutralise les champs texte", () => {
  const TEXT = ["id", "symbol", "name", "sub_asset_class", "exchange", "mic", "currency", "country", "domicile", "sector", "pea_source", "pea_pme_source", "alt_group", "data_source", "notes"];
  for (const p of XSS) test("charge utile dans tous les champs : " + p.slice(0, 40), () => {
    const raw = Object.fromEntries(TEXT.map((f) => [f, p]));
    raw.tickers = { tv: p, yahoo: p, okx: p, euronext: p, binance: p, evil: p };
    raw.isin = p; raw.region = p; raw.asset_class = p; raw.vehicle = p; raw.pea_eligibility_status = p;
    const i = M.normInstrument(raw);
    for (const [f, v] of Object.entries(plain(i))) {
      if (typeof v === "string") assert.equal(tagLike(v), false, f + " = " + JSON.stringify(v));
    }
    for (const v of Object.values(plain(i.tickers))) assert.equal(tagLike(v), false);
    assert.equal("evil" in i.tickers, false);
    assert.equal(i.isin, null); assert.equal(i.region, null); assert.equal(i.asset_class, "actions"); assert.equal(i.vehicle, "titre");
    assert.equal(i.pea_eligibility_status, "unknown");
  });
  test("les autres normaliseurs nettoient aussi leurs textes", () => {
    const p = "<img src=x onerror=alert(1)>Nom";
    const strs = (o) => Object.values(plain(o)).filter((v) => typeof v === "string");
    for (const o of [M.normAccount({ id: p, name: p, broker: p, currency: p }), M.normPosition({ account_id: p, instrument_id: p, currency: p }),
      M.normTransaction({ id: p, account_id: p, instrument_id: p, currency: p }), M.normQuote({ source: p, currency: p })])
      for (const v of strs(o)) assert.equal(tagLike(v), false, v);
  });
});

describe("textes géants tronqués", () => {
  test("un nom de 10 000 caractères est tronqué", () => {
    const long = "A".repeat(10000);
    const i = M.normInstrument({ name: long, notes: long, id: long, symbol: long });
    assert.equal(i.name.length, 120);
    assert.equal(i.notes.length, 300);
    assert.equal(i.id.length, 64);
    assert.equal(i.symbol.length, 20);
    assert.equal(M.cleanText(long).length, 200);
    assert.equal(M.normAccount({ name: long }).name.length, 60);
  });
  test("un nom géant fait de balises reste court et sans balise", () => {
    const i = M.normInstrument({ name: "<b>x</b>".repeat(2000) + "<img src=x onerror=alert(1)>".repeat(500) });
    assert.ok(i.name.length <= 120);
    assert.equal(tagLike(i.name), false);
  });
});

describe("pollution de prototype", () => {
  const BAD = ["__proto__", "constructor", "prototype"];
  const nest = (key, depth) => { let s = `{"${key}":{"pollue":true,"isAdmin":true}}`; for (let d = 0; d < depth; d++) s = `{"a":[${s}]}`; return s; };

  for (const key of BAD) for (const depth of [0, 1, 5, 25, 60]) test(`safeJSON refuse « ${key} » à la profondeur ${depth}`, () => {
    const r = M.safeJSON(nest(key, depth));
    assert.equal(r.ok, false);
    assert.match(r.error, /Clé interdite/);
    assert.equal(r.value, undefined);
    assert.equal(pollue(), false);
  });
  test("safeJSON accepte un JSON propre et signale un JSON illisible", () => {
    assert.deepEqual(plain(M.safeJSON('{"a":[1,{"b":2}]}')), { ok: true, value: { a: [1, { b: 2 }] } });
    assert.equal(M.safeJSON("{pas du json").ok, false);
    assert.match(M.safeJSON("{pas du json").error, /illisible/);
    assert.equal(M.safeJSON(undefined).ok, false);
  });
  test("safeJSON : des noms de méthodes ordinaires (toString, valueOf) ne sont pas des clés interdites", () => {
    assert.equal(M.safeJSON('{"toString":1,"valueOf":2,"hasOwnProperty":3}').ok, true);
  });
  test("hasBadKeys : très grande profondeur et objets cycliques sans plantage", () => {
    let deep = '{"x":1}'; for (let d = 0; d < 2000; d++) deep = `{"a":${deep}}`;
    assert.equal(M.hasBadKeys(JSON.parse(deep)), false);
    assert.equal(M.hasBadKeys(JSON.parse(deep.replace('"x"', '"__proto__"'))), true);
    const cyc = { a: {} }; cyc.a.b = cyc;
    assert.equal(M.hasBadKeys(cyc), false);
    cyc.a.c = JSON.parse('{"__proto__":1}');
    assert.equal(M.hasBadKeys(cyc), true);
  });

  for (const key of BAD) test(`normPrefs rejette « ${key} » (racine et profondeur) et revient aux valeurs par défaut`, () => {
    for (const depth of [0, 2, 30]) {
      let inner = `{"${key}":{"pollue":true}}`; for (let d = 0; d < depth; d++) inner = `{"x":${inner}}`;
      const raw = JSON.parse(`{"saved":true,"classes":{"actions":true},"vehicles":{"etf":true},"limits":${inner}}`);
      const p = M.normPrefs(raw);
      assert.equal(p.saved, false, "préférences refusées");
      assert.equal(p.classes.actions, false);
      assert.equal(M.hasBadKeys(p), false);
      assert.equal(pollue(), false);
    }
  });
  test("normPrefs : une clé de répartition qui DEVIENT dangereuse après nettoyage est ignorée", () => {
    for (const k2 of [" constructor", "<b>__proto__</b>", "prototype\u0000", "\nconstructor\t"]) {
      const p = M.normPrefs({ contribution_split: { [k2]: 50, cto: 10 } });
      assert.deepEqual(Object.keys(p.contribution_split), ["cto"], JSON.stringify(k2));
      assert.equal(M.hasBadKeys(p), false);
    }
    assert.equal(pollue(), false);
  });
  test("normPrefs : clés du prototype comme noms de classes ignorées", () => {
    const p = M.normPrefs({ classes: { toString: true, valueOf: true }, limits: { max_par_classe: { toString: 50, hasOwnProperty: 5, actions: 30 } } });
    assert.deepEqual(plain(p.limits.max_par_classe), { actions: 30 });
    assert.equal(Object.prototype.hasOwnProperty.call(p.classes, "toString"), false);
  });

  test("only() ne copie jamais __proto__, constructor ni prototype, même demandés", () => {
    const src = JSON.parse('{"__proto__":{"pollue":true},"constructor":{"prototype":{"pollue":true}},"prototype":1,"a":1}');
    const o = M.only(src, ["__proto__", "constructor", "prototype", "a", "absent"]);
    assert.deepEqual(Object.getOwnPropertyNames(o), ["a"]);
    assert.equal(o.pollue, undefined);
    assert.equal(Object.getPrototypeOf(o), VM_PROTO);
    assert.equal(pollue(), false);
    assert.deepEqual(plain(M.only(null, ["a"])), {});
    assert.deepEqual(plain(M.only("texte", ["length"])), {});
  });
  test("only() ignore les propriétés héritées", () => {
    const o = M.only(Object.create({ a: 1 }), ["a"]);
    assert.equal("a" in o, false);
  });

  test("normaliseurs : un JSON piégé ne pollue rien et ne laisse aucune clé dangereuse", () => {
    const evil = JSON.parse('{"__proto__":{"pollue":true},"constructor":{"prototype":{"isAdmin":true}},"name":"x","tickers":{"__proto__":{"pollue":true},"tv":"A:B"},' +
      '"classes":{"__proto__":{"actions":true}},"perf":{"__proto__":{"w":1}}}');
    const outs = [M.normInstrument(evil), M.normAccount(evil), M.normPosition(evil), M.normTransaction(evil), M.normQuote(evil), M.normPrefs(evil), M.normBar({ ...evil, t: 1, c: 1 })];
    for (const o of outs) assert.equal(M.hasBadKeys(o), false);
    assert.deepEqual(plain(outs[0].tickers), { tv: "A:B" });
    assert.equal(outs[5].classes.actions, false);
    assert.equal(pollue(), false);
  });
  test("valeurs piégées dans tous les champs : aucun normaliseur ne lève d'exception (l'interface ne casse pas)", () => {
    // String() lève sur ces objets : {"toString":1} venu d'un JSON, objet sans prototype, toString qui lève.
    const hostile = () => [JSON.parse('{"toString":1,"valueOf":2}'), Object.create(null), { toString() { throw new Error("piège"); } }, [JSON.parse('{"toString":1}')]];
    const fields = ["id", "symbol", "name", "isin", "asset_class", "sub_asset_class", "vehicle", "exchange", "mic", "currency", "country", "domicile", "sector", "region",
      "pea_eligibility_status", "pea_source", "pea_last_checked_at", "pea_pme_status", "pea_pme_source", "alt_group", "ter", "risk_level", "leverage", "launch_date",
      "delisted_at", "data_source", "market_cap_eur", "notes", "account_id", "instrument_id", "quantity", "price", "fees", "date", "type", "fx_rate", "account_type",
      "broker", "cash_balance", "opened_at", "updated_at", "last", "ts", "source", "t", "c", "o", "h", "l", "v", "timestamp", "close", "granularity", "manual_price"];
    for (const h of hostile()) {
      const raw = Object.fromEntries(fields.map((f) => [f, h]));
      raw.tickers = { tv: h, yahoo: h }; raw.manual_universe = [h, "isin:A"]; raw.perf = { w: h };
      const run = [() => M.normInstrument(raw), () => M.normAccount(raw), () => M.normPosition(raw), () => M.normTransaction(raw), () => M.normQuote(raw),
        () => M.normBar(raw), () => M.normBar({ ...raw, t: 1, c: 1 }), () => M.validateInstrument(raw), () => M.isinValid(h), () => M.cleanText(h), () => M.num(h), () => M.isoDate(h),
        () => CK.allow(raw, M.defaultPrefs()), () => CK.ref.load([raw, { name: h }, h]), () => CK.ref.search("x")];
      for (const f of run) assert.doesNotThrow(f, f.toString());
      const i = M.normInstrument(raw);
      assert.equal(i.name, ""); assert.equal(i.isin, null); assert.equal(i.asset_class, "actions"); assert.equal(i.ter, null); assert.deepEqual(plain(i.tickers), {});
      assert.deepEqual(plain(M.normAccount(raw).manual_universe), ["isin:A"]);
    }
    CK.ref.load([]);
    assert.equal(pollue(), false);
  });
  test("aléatoire : 300 instruments faits de valeurs de types mélangés → jamais d'exception, textes sans balise", () => {
    const r = rng(4242);
    const vals = [null, undefined, 0, -1, 1e308, NaN, "", " ", "<img src=x onerror=alert(1)>", "FR0000120271", "etf", "or", "indice", true, false, [], ["or"], {}, [1, 2],
      JSON.parse('{"toString":1}'), JSON.parse('{"__proto__":{"pollue":true}}'), "2026-02-30", "01/03/2026", "1.234,5"];
    const keys = ["id", "symbol", "name", "isin", "asset_class", "vehicle", "currency", "country", "region", "ter", "risk_level", "leverage", "is_investable", "is_active",
      "pea_eligibility_status", "pea_last_checked_at", "tickers", "notes", "siic"];
    const list = [];
    for (let n = 0; n < 300; n++) list.push(Object.fromEntries(keys.filter(() => r() < 0.7).map((k2) => [k2, vals[Math.floor(r() * vals.length)]])));
    let out;
    assert.doesNotThrow(() => { out = CK.ref.load(list); });
    for (const i of out) {
      for (const v of Object.values(plain(i))) if (typeof v === "string") assert.equal(tagLike(v), false, JSON.stringify(v));
      assert.equal(typeof i.asset_class, "string"); assert.equal(typeof i.vehicle, "string"); assert.equal(typeof i.is_investable, "boolean");
      assert.ok(i.isin === null || M.isinValid(i.isin) || /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(i.isin));
      assert.doesNotThrow(() => M.validateInstrument(i));
    }
    CK.ref.load([]);
    assert.equal(pollue(), false);
  });
  test("CK.ref.load avec des identifiants piégés : rien n'est pollué", () => {
    CK.ref.load(JSON.parse('[{"id":"__proto__","name":"a"},{"id":"constructor","name":"b"},{"id":"prototype","name":"c"},{"name":"d","isin":"US0378331005"}]'));
    assert.equal(CK.ref.all().length, 4);
    assert.equal(CK.ref.get("__proto__").name, "a");
    assert.equal(CK.ref.byIsin("US0378331005").name, "d");
    assert.equal(pollue(), false);
    CK.ref.load([]);
  });
});
