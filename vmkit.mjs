// Kit de test : charge les fichiers du Desk (écrits pour le navigateur) dans Node, sans navigateur.
// Utilisé par les fichiers *.test.mjs. Lancer tous les tests : node --test "*.test.mjs"
//
// Chaque fichier du Desk est une fonction auto-exécutée qui lit et complète window.CK.
// On crée un faux « navigateur » minimal : window, document, localStorage et minuteries factices
// (les minuteries ne tournent jamais, pour que les tests se terminent).
import { readFileSync } from "node:fs";
import vm from "node:vm";

const rd = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

function fakeElement() {
  const el = {
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    appendChild: (c) => c, insertBefore: (c) => c, remove() {}, querySelector: () => null, querySelectorAll: () => [],
    closest: () => null, getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
    innerHTML: "", textContent: "", hidden: false, children: [], focus() {}, blur() {}
  };
  return el;
}

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; }
  };
}

/** Utilitaires minimaux équivalents à CK.u de core.js (formatage simplifié, échappement identique). */
export function miniU() {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = (v, d) => (v == null || isNaN(v) ? "—" : Number(v).toLocaleString("fr-FR", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }));
  return {
    $: () => null, esc, nf,
    pct: (v, d) => (v == null || isNaN(v) ? "—" : (v >= 0 ? "+" : "−") + nf(Math.abs(v), d == null ? 2 : d) + " %"),
    safeUrl: (x) => (/^https?:\/\//i.test(String(x || "")) ? String(x) : "#"),
    fetchJSON: () => Promise.reject(new Error("réseau désactivé dans les tests"))
  };
}

/**
 * Crée un contexte isolé. `ck` : objet CK de départ (par défaut un CK minimal suffisant pour les modules de calcul).
 * Renvoie { ctx, window, CK, load(fichier), timers } .
 */
export function makeContext({ ck } = {}) {
  const timers = [];
  const store = fakeStorage();
  const doc = fakeElement();
  Object.assign(doc, {
    body: fakeElement(), documentElement: fakeElement(), head: fakeElement(),
    getElementById: () => null, createElement: () => fakeElement(), createElementNS: () => fakeElement(),
    readyState: "complete", hidden: false, visibilityState: "visible"
  });
  const sandbox = {
    console, Intl, Date, Math, JSON, Promise, URL, URLSearchParams, TextEncoder, TextDecoder, structuredClone,
    document: doc, localStorage: store, sessionStorage: fakeStorage(), navigator: { onLine: true, userAgent: "vmkit" },
    location: { href: "http://localhost/", origin: "http://localhost", hostname: "localhost", protocol: "http:", search: "", hash: "" },
    performance: { now: () => 0 },
    setTimeout: (f, ms) => { timers.push({ f, ms, kind: "timeout" }); return timers.length; },
    setInterval: (f, ms) => { timers.push({ f, ms, kind: "interval" }); return timers.length; },
    clearTimeout() {}, clearInterval() {},
    requestAnimationFrame: (f) => { timers.push({ f, kind: "raf" }); return timers.length; }, cancelAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    fetch: () => Promise.reject(new Error("réseau désactivé dans les tests"))
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  const CK = ck || {
    S: {}, u: miniU(), STABLES: {},
    _ls: {}, ls(k, v) { if (v === undefined) return this._ls[k] ?? null; if (v === null) delete this._ls[k]; else this._ls[k] = String(v); },
    lsj(k, v) { if (v === undefined) { const r = this.ls(k); return r == null ? null : JSON.parse(r); } this.ls(k, v === null ? null : JSON.stringify(v)); },
    merge(a, b) { return JSON.parse(JSON.stringify(Object.assign({}, a, b))); },
    cfg: () => ({ screenerPreset: "compression", screenerMax: 150, modules: {}, espaces: {} })
  };
  sandbox.CK = CK;
  const load = (file) => { vm.runInContext(rd(file), ctx, { filename: file }); return sandbox.CK; };
  return { ctx, window: sandbox, CK, load, timers };
}

/** Générateur pseudo-aléatoire déterministe (mulberry32) : mêmes données à chaque exécution. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Bougies synthétiques {h,l,c,v} (format du screener), déterministes. */
export function candles(n, seed, start = 100) {
  const r = rng(seed); const out = []; let c = start;
  for (let i = 0; i < n; i++) {
    const ch = (r() - 0.5) * 0.06 * c; const o = c; c = Math.max(0.01, c + ch);
    const h = Math.max(o, c) * (1 + r() * 0.02), l = Math.min(o, c) * (1 - r() * 0.02);
    out.push({ h, l, c, v: Math.round(1000 + r() * 9000) });
  }
  return out;
}
