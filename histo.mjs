// Robot des historiques (phase 3) : node histo.mjs <dossier> [--tout] [--boot N] [--maj N]
//
// Tourne sur GitHub (workflow donnees.yml, plusieurs fois par jour) et écrit dans <dossier>, qui est la
// branche « donnees » du dépôt. Le robot des 10 minutes (desk.yml) copie ensuite ces fichiers dans site/data/ :
//   hist/<id>.json        historique quotidien de chaque instrument {id, ccy, src, t[], o[], h[], l[], c[], v[], div[], split[]}
//   marches-meta.json     état de chaque fichier (première et dernière séance, erreurs), sources et conditions d'utilisation
//   resume.json           performances, volatilité, perte maximale et courbe d'un an de chaque instrument (calculées par indicators.js)
//   taux.json             €STR, taux de dépôt BCE, courbes de taux zone euro (AAA) et États-Unis
//   fx.json               fixings BCE des 3 dernières années (secours de fx.js, format Frankfurter)
//
// Mise à jour pilotée par l'état (marches-meta.json), jamais par l'heure : à chaque passage, au plus --boot
// historiques complets (15 ans) pour les instruments qui n'en ont pas encore, puis au plus --maj mises à jour
// courtes pour les plus anciens. Une source en panne ne fait jamais disparaître un fichier déjà publié.
// --tout : tout traiter d'un coup (amorçage en local).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const DAY = 864e5, YEARS = 15;
const UA = { "User-Agent": "Mozilla/5.0 (DeskRobot; +https://github.com)" };

/* ---------- Calculs partagés avec le navigateur (indicators.js) ---------- */
export function loadInd() {
  const sb = {}; sb.window = sb;
  vm.runInNewContext(readFileSync(new URL("./indicators.js", import.meta.url), "utf8"), sb);
  return sb.CK.ind;
}
const IND = loadInd();

/* ---------- Fuseaux horaires : instant exact de clôture d'une séance ---------- */
const FMT = new Map();
function fmt(tz) {
  if (!FMT.has(tz)) FMT.set(tz, new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  return FMT.get(tz);
}
/** Décalage (ms) du fuseau tz à l'instant ts : heure locale − UTC. */
export function tzOffset(ts, tz) {
  const p = {}; for (const x of fmt(tz).formatToParts(new Date(ts))) p[x.type] = x.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000;
}
/** Date locale "AAAA-MM-JJ" d'un instant dans le fuseau tz. */
export function localDate(ts, tz) {
  const p = {}; for (const x of fmt(tz).formatToParts(new Date(ts))) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}`;
}
/** Instant UTC (ms) de « date à hh:mm, heure de tz » (changements d'heure gérés). */
export function zoned(date, hh, mm, tz) {
  const [y, m, d] = date.split("-").map(Number), guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - tzOffset(guess, tz); t = guess - tzOffset(t, tz); return t;
}
/** Heure locale de clôture "hh:mm" d'après la séance régulière annoncée par Yahoo. */
function closeTime(meta) {
  const tz = meta.exchangeTimezoneName || "UTC", end = meta.currentTradingPeriod && meta.currentTradingPeriod.regular && meta.currentTradingPeriod.regular.end;
  if (!end) return [23, 59];
  const p = {}; for (const x of fmt(tz).formatToParts(new Date(end * 1000))) p[x.type] = x.value;
  return [+p.hour % 24, +p.minute];
}

/* ---------- Sources ---------- */
/** Yahoo v8 chart → historique (t = instant de clôture ; la séance du jour pas encore close est écartée). */
export function yahooToHist(json, id, now) {
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  if (!r || !Array.isArray(r.timestamp)) throw new Error((json && json.chart && json.chart.error && json.chart.error.description) || "réponse Yahoo vide");
  const meta = r.meta || {}, tz = meta.exchangeTimezoneName || "UTC", [hh, mm] = closeTime(meta), q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
  const out = { id, ccy: (meta.currency || "").toUpperCase() || null, src: "yahoo", ticker: meta.symbol || null, tz, t: [], o: [], h: [], l: [], c: [], v: [], div: [], split: [] };
  const seen = new Set(), rmt = (meta.regularMarketTime || 0) * 1000, num = (x) => (typeof x === "number" && x > 0 ? x : null);
  r.timestamp.forEach((ts, k) => {
    const day = localDate(ts * 1000, tz), T = zoned(day, hh, mm, tz);
    if (T > now || seen.has(day)) return;   // séance en cours, ou doublon renvoyé par Yahoo
    const n = (a) => (a && typeof a[k] === "number" && a[k] > 0 ? a[k] : null);
    let c = n(q.close), o = n(q.open), h = n(q.high), l = n(q.low), v = q.volume && typeof q.volume[k] === "number" ? q.volume[k] : null;
    // Yahoo laisse souvent la dernière séance vide : son cours de clôture est dans meta (regularMarketPrice), relevé après la clôture
    const prev = out.c.length ? out.c[out.c.length - 1] : null, rmp = num(meta.regularMarketPrice);
    if (c == null && rmt && localDate(rmt, tz) === day && rmt >= T - 10 * 60000 && rmp && (prev == null || Math.abs(rmp / prev - 1) < 0.25)) {
      c = meta.regularMarketPrice; h = num(meta.regularMarketDayHigh) || h; l = num(meta.regularMarketDayLow) || l; v = num(meta.regularMarketVolume) ?? v;
    }
    if (c == null) return;
    seen.add(day);
    out.t.push(T); out.o.push(o); out.h.push(h); out.l.push(l); out.c.push(c); out.v.push(v);
  });
  // Série incohérente avec le dernier cours annoncé par Yahoo lui-même (ex. mauvaise base d'indice) : refusée
  const lastC = out.c[out.c.length - 1], lastT = out.t[out.t.length - 1], rmpx = num(meta.regularMarketPrice);
  if (lastC && rmpx && rmt && Math.abs(rmt - lastT) < 5 * DAY && Math.abs(rmpx / lastC - 1) > 0.25)
    throw new Error(`série Yahoo incohérente (dernière clôture ${lastC}, cours annoncé ${rmpx})`);
  // Série arrêtée alors que Yahoo annonce un cours récent (ex. ^SBF120, figé en 2015) : refusée
  if (lastT && rmt && rmt - lastT > 20 * DAY) throw new Error(`série Yahoo arrêtée le ${localDate(lastT, tz).split("-").reverse().join("/")}`);
  const ev = (o, f) => Object.values(o || {}).map((e) => { const d = localDate(e.date * 1000, tz); return [zoned(d, hh, mm, tz), f(e)]; }).filter((x) => x[1] > 0).sort((a, b) => a[0] - b[0]);
  out.div = ev(r.events && r.events.dividends, (e) => e.amount);
  out.split = ev(r.events && r.events.splits, (e) => (e.numerator > 0 && e.denominator > 0 ? e.numerator / e.denominator : 0));
  return out;
}
/** CSV de FRED ("date,valeur", "." = absent) → [[AAAA-MM-JJ, valeur]]. */
export function fredCsv(text) {
  return String(text).trim().split(/\r?\n/).slice(1).map((l) => l.split(",")).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x[0]) && x[1] !== "." && x[1] !== "" && isFinite(+x[1])).map((x) => [x[0], +x[1]]);
}
/** CSV de la BCE (format csvdata) → {clé de série: [[période, valeur]]}. */
export function ecbCsv(text) {
  const rows = parseCsv(String(text)); if (!rows.length) return {};
  const h = rows[0], iK = h.indexOf("KEY"), iT = h.indexOf("TIME_PERIOD"), iV = h.indexOf("OBS_VALUE"), out = {};
  for (const r of rows.slice(1)) { if (r.length <= Math.max(iK, iT, iV) || r[iV] === "" || !isFinite(+r[iV])) continue; (out[r[iK]] = out[r[iK]] || []).push([r[iT], +r[iV]]); }
  for (const k in out) out[k].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return out;
}
function parseCsv(s) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; continue; }
    if (ch === '"') q = true; else if (ch === ",") { row.push(cur); cur = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && s[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = []; } else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
/** Série [[date, valeur]] → historique (o = h = l = c). when(date) donne l'instant de publication. */
export function seriesToHist(id, pts, src, ccy, when) {
  const out = { id, ccy, src, t: [], o: [], h: [], l: [], c: [], v: [], div: [], split: [] };
  for (const [d, x] of pts) { if (!(x > -50)) continue; out.t.push(when(d)); out.o.push(x); out.h.push(x); out.l.push(x); out.c.push(x); out.v.push(null); }
  return out;
}
const fredWhen = (d) => zoned(d, 17, 30, "America/New_York");
const monthEnd = (p) => { const [y, m] = p.split("-").map(Number); return zoned(new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10), 18, 0, "Europe/Paris"); };

/** D'où vient l'historique de chaque instrument (null = aucun : crypto lue sur Binance par le navigateur, OAT 2 ans). */
export const RATES = {
  "tv:TVC:US02Y": { kind: "fred", code: "DGS2" },
  "tv:TVC:FR10Y": { kind: "ecb", code: "IRS/M.FR.L.L40.CI.0000.EUR.N.Z" },
  "tv:TVC:DE10Y": { kind: "ecb", code: "IRS/M.DE.L.L40.CI.0000.EUR.N.Z" },
  "tv:TVC:IT10Y": { kind: "ecb", code: "IRS/M.IT.L.L40.CI.0000.EUR.N.Z" }
};
export function sourceOf(i) {
  if (RATES[i.id]) return RATES[i.id];
  const y = i.tickers && i.tickers.yahoo;
  return y ? { kind: "yahoo", code: y } : null;
}
export function fileOf(id) { return String(id || "").replace(/[^A-Za-z0-9_-]/g, "_"); }

/* ---------- Fusion, compactage ---------- */
const COLS = ["o", "h", "l", "c", "v"];
/** Fusionne l'ancien et le nouvel historique (le nouveau l'emporte jour par jour), garde 15 ans, trie. */
export function merge(old, fresh, now) {
  if (!old || !Array.isArray(old.t) || !old.t.length) old = null;
  const keep = now - YEARS * 365.25 * DAY, by = new Map();
  const add = (h) => h && h.t.forEach((T, k) => { by.set(IND.ymd(T), { T, row: COLS.map((c) => (h[c] ? h[c][k] ?? null : null)) }); });
  add(old); add(fresh);
  const days = [...by.keys()].sort(), out = { ...(old || {}), ...fresh, t: [] };
  COLS.forEach((c) => (out[c] = []));
  for (const d of days) { const x = by.get(d); if (x.T < keep) continue; out.t.push(x.T); COLS.forEach((c, j) => out[c].push(x.row[j])); }
  const ev = (a, b) => { const m = new Map(); for (const e of [...(a || []), ...(b || [])]) m.set(IND.ymd(e[0]), e); return [...m.values()].filter((e) => e[0] >= keep).sort((x, y) => x[0] - y[0]); };
  out.div = ev(old && old.div, fresh.div); out.split = ev(old && old.split, fresh.split);
  return out;
}
/**
 * Nettoyage des défauts connus de Yahoo, toujours documenté (note publiée dans marches-meta.json et resume.json) :
 * 1) pic isolé (±20 % puis retour à moins de 10 % du cours d'avant) : point retiré (pas pour la volatilité, ex. VIX) ;
 * 2) rupture de niveau impossible (×2,5 ou ÷2,5 en une séance : changement d'unité, mauvaise série) : on ne garde que ce qui suit la dernière.
 */
export function clean(h, { spikes = true } = {}) {
  const notes = [], n = h.t.length, drop = new Set();
  if (spikes) for (let k = 1; k < n - 1; k++) {
    const a = h.c[k] / h.c[k - 1], b = h.c[k + 1] / h.c[k];
    if (((a > 1.2 && b < 1 / 1.2) || (a < 1 / 1.2 && b > 1.2)) && Math.abs(h.c[k + 1] / h.c[k - 1] - 1) < 0.1) drop.add(k);
  }
  if (drop.size) notes.push(`${drop.size} cours isolé${drop.size > 1 ? "s" : ""} aberrant${drop.size > 1 ? "s" : ""} retiré${drop.size > 1 ? "s" : ""}`);
  const idx = [...Array(n).keys()].filter((k) => !drop.has(k));
  let cut = 0;
  for (let j = 1; j < idx.length; j++) { const r = h.c[idx[j]] / h.c[idx[j - 1]]; if (r > 2.5 || r < 0.4) cut = j; }
  if (cut) notes.push(`historique coupé avant le ${IND.ymd(h.t[idx[cut]]).split("-").reverse().join("/")} (variation de ${Math.round((h.c[idx[cut]] / h.c[idx[cut - 1]] - 1) * 100)} % en une séance, jugée anormale)`);
  const keep = idx.slice(cut), out = { ...h, t: [], div: h.div, split: h.split };
  COLS.forEach((c) => (out[c] = []));
  for (const k of keep) { out.t.push(h.t[k]); COLS.forEach((c) => out[c].push(h[c] ? h[c][k] ?? null : null)); }
  if (cut && out.t.length) { const t0 = out.t[0]; out.div = (h.div || []).filter((e) => e[0] >= t0); out.split = (h.split || []).filter((e) => e[0] >= t0); }
  return { h: out, notes };
}
/** Arrondit les prix (6 chiffres significatifs) ; retire les volumes s'il n'y en a aucun (indices). */
export function compact(h) {
  const r = (v) => (v == null ? null : IND.round(v, 6));
  const o = { ...h, o: h.o.map(r), h: h.h.map(r), l: h.l.map(r), c: h.c.map(r), div: (h.div || []).map((e) => [e[0], IND.round(e[1], 6)]), split: h.split || [] };
  o.v = h.v && h.v.some((x) => x > 0) ? h.v.map((x) => (x == null ? null : Math.round(x))) : [];
  return o;
}

/* ---------- Planification (pilotée par l'état) ---------- */
/**
 * Liste des tâches de ce passage : d'abord les historiques manquants (complets), puis les mises à jour courtes
 * des fichiers les plus anciens. Un instrument en échec attend 6 h avant un nouvel essai.
 */
export function plan(instruments, meta, now, { boot = 15, maj = 60, tout = false } = {}) {
  const files = (meta && meta.files) || {}, boots = [], upds = [];
  for (const i of instruments) {
    const s = sourceOf(i); if (!s) continue;
    const f = fileOf(i.id), st = files[f] || {};
    if (st.err && st.try && now - st.try < 6 * 36e5 && !tout) continue;
    if (!st.last) boots.push({ i, s, f, full: true, at: st.try || 0 });
    else if (tout || now - (st.ok || 0) > 3 * 36e5) upds.push({ i, s, f, full: false, at: st.ok || 0 });
  }
  boots.sort((a, b) => a.at - b.at); upds.sort((a, b) => a.at - b.at);
  return tout ? boots.concat(upds) : boots.slice(0, boot).concat(upds.slice(0, maj));
}

/* ---------- Réseau ---------- */
function getter(fetchImpl) {
  return async function get(url, type = "text", ms = 30000) {
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetchImpl(url, { headers: UA, signal: ctl.signal });
      if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
      return type === "json" ? await r.json() : await r.text();
    } finally { clearTimeout(tm); }
  };
}
const ymdUTC = (ts) => new Date(ts).toISOString().slice(0, 10);

async function fetchHist(get, task, old, now) {
  const { i, s, full } = task;
  if (s.kind === "yahoo") {
    const last = old && old.t && old.t.length ? old.t[old.t.length - 1] : 0;
    const p1 = Math.floor((full || !last ? now - YEARS * 365.25 * DAY : last - 12 * DAY) / 1000), p2 = Math.floor(now / 1000) + 86400;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s.code)}?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplit&includeAdjustedClose=false`;
    return yahooToHist(await get(url, "json"), i.id, now);
  }
  if (s.kind === "fred") {
    const from = ymdUTC(full || !old ? now - YEARS * 365.25 * DAY : old.t[old.t.length - 1] - 30 * DAY);
    const pts = fredCsv(await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(s.code)}&cosd=${from}`));
    return Object.assign(seriesToHist(i.id, pts.filter((p) => fredWhen(p[0]) <= now), "fred", null, fredWhen), { ticker: s.code });
  }
  if (s.kind === "ecb") {
    const from = ymdUTC(now - YEARS * 365.25 * DAY).slice(0, 7);
    const d = ecbCsv(await get(`https://data-api.ecb.europa.eu/service/data/${s.code}?format=csvdata&startPeriod=${from}`));
    const pts = Object.values(d)[0] || [];
    return Object.assign(seriesToHist(i.id, pts.filter((p) => monthEnd(p[0]) <= now), "bce", null, monthEnd), { ticker: s.code, freq: "M" });
  }
  throw new Error("source inconnue");
}

/* ---------- Taux (€STR, dépôt BCE, courbes) ---------- */
const EA_MAT = ["3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "15Y", "20Y", "30Y"];
const US_MAT = [["1M", "DGS1MO"], ["3M", "DGS3MO"], ["6M", "DGS6MO"], ["1Y", "DGS1"], ["2Y", "DGS2"], ["3Y", "DGS3"], ["5Y", "DGS5"], ["7Y", "DGS7"], ["10Y", "DGS10"], ["20Y", "DGS20"], ["30Y", "DGS30"]];
/** Valeur de chaque maturité à la dernière date commune, il y a 1 mois et il y a 1 an (dernière observation ≤ date). */
export function curveAt(series, mats) {
  const at = (pts, d) => { let v = null; for (const p of pts || []) { if (p[0] <= d) v = p[1]; else break; } return v; };
  const lasts = mats.map((m) => series[m] && series[m].length ? series[m][series[m].length - 1][0] : null).filter(Boolean);
  if (!lasts.length) return null;
  const d0 = lasts.sort()[0], back = (n, unit) => { const t = new Date(d0 + "T00:00:00Z"); if (unit === "m") t.setUTCMonth(t.getUTCMonth() - n); else t.setUTCFullYear(t.getUTCFullYear() - n); return t.toISOString().slice(0, 10); };
  const dates = [d0, back(1, "m"), back(1, "y")];
  return { mats, dates, vals: dates.map((d) => mats.map((m) => { const v = at(series[m], d); return v == null ? null : IND.round(v, 5); })) };
}
/**
 * Taux sans risque mensuel (en %, moyenne du mois) pour le backtest : €STR (moyenne des fixings quotidiens du mois) depuis
 * octobre 2019, et avant, EONIA mensuel − 8,5 pb (écart officiel fixé par la BCE entre les deux taux). Un mois n'est publié
 * qu'une fois terminé. eonia : [["AAAA-MM", %]] ; estr : [["AAAA-MM-JJ", %]].
 */
export function rfMonthly(eonia, estr, now) {
  const cur = ymdUTC(now).slice(0, 7), by = {}, out = {};
  for (const [d, v] of estr || []) { const m = String(d).slice(0, 7); (by[m] = by[m] || []).push(v); }
  for (const [m, v] of eonia || []) { const k = String(m).slice(0, 7); if (k < "2019-10" && isFinite(v)) out[k] = Math.round((v - 0.085) * 1e4) / 1e4; }
  for (const m in by) if (m >= "2019-10") out[m] = Math.round(by[m].reduce((a, b) => a + b, 0) / by[m].length * 1e4) / 1e4;
  const d = Object.keys(out).filter((m) => m < cur).sort();
  return d.length ? { d, v: d.map((m) => out[m]), src: "BCE (EONIA − 8,5 pb avant 10/2019, puis €STR)" } : null;
}
async function taux(get, now, prev) {
  const out = { ...(prev || {}), ts: now }, errs = [];
  const from3y = ymdUTC(now - 3 * 365 * DAY), from14m = ymdUTC(now - 430 * DAY);
  try {
    const d = ecbCsv(await get(`https://data-api.ecb.europa.eu/service/data/EST/B.EU000A2X2A25.WT?format=csvdata&startPeriod=${from3y}`));
    const pts = Object.values(d)[0] || [];
    if (pts.length) out.estr = { d: pts[pts.length - 1][0], v: pts[pts.length - 1][1], serie: { d: pts.map((p) => p[0]), v: pts.map((p) => p[1]) }, src: "BCE" };
  } catch (e) { errs.push("€STR : " + e.message); }
  try {
    const eo = Object.values(ecbCsv(await get(`https://data-api.ecb.europa.eu/service/data/FM/M.U2.EUR.4F.MM.EONIA.HSTA?format=csvdata&startPeriod=2005-01`)))[0] || [];
    const es = Object.values(ecbCsv(await get(`https://data-api.ecb.europa.eu/service/data/EST/B.EU000A2X2A25.WT?format=csvdata&startPeriod=2019-10-01`)))[0] || [];
    const rf = rfMonthly(eo, es, now); if (rf) out.rf = rf;
  } catch (e) { errs.push("taux sans risque mensuel : " + e.message); }
  try {
    const d = ecbCsv(await get(`https://data-api.ecb.europa.eu/service/data/FM/D.U2.EUR.4F.KR.DFR.LEV?format=csvdata&lastNObservations=1`));
    const pts = Object.values(d)[0] || []; if (pts.length) out.depo = { d: pts[pts.length - 1][0], v: pts[pts.length - 1][1], src: "BCE" };
  } catch (e) { errs.push("taux de dépôt : " + e.message); }
  try {
    const d = ecbCsv(await get(`https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.${EA_MAT.map((m) => "SR_" + m).join("+")}?format=csvdata&startPeriod=${from14m}`));
    const s = {}; for (const k in d) { const m = k.split(".").pop().replace("SR_", ""); s[m] = d[k]; }
    const c = curveAt(s, EA_MAT); if (c) out.ea = { ...c, label: "Zone euro (États notés AAA)", src: "BCE" };
  } catch (e) { errs.push("courbe zone euro : " + e.message); }
  try {
    const s = {};
    for (const [m, code] of US_MAT) s[m] = fredCsv(await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${code}&cosd=${from14m}`));
    const c = curveAt(s, US_MAT.map((x) => x[0])); if (c) out.us = { ...c, label: "États-Unis (bons du Trésor)", src: "FRED" };
  } catch (e) { errs.push("courbe US : " + e.message); }
  out.err = errs;
  return out;
}

/* ---------- Résumé pour le navigateur (une seule requête pour tout le tableau) ---------- */
export function resumeOf(h, perYear, diff) {
  const s = IND.summary(h.t, h.c, perYear, diff); if (!s) return null;
  const r4 = (v) => (v == null ? null : Math.round(v * 1e4) / 1e4), p = {};
  for (const k in s.p) p[k] = r4(s.p[k]);
  if (h.freq === "M") p.w = null;   // série mensuelle : pas de variation sur une semaine
  return { d: s.d, c: IND.round(s.c, 6), ccy: h.ccy, src: h.src, freq: h.freq || "D", diff: !!diff, p, vol1y: r4(s.vol1y), mdd1y: r4(s.mdd1y), mdd5y: r4(s.mdd5y),
    hi52: IND.round(s.hi52, 6), lo52: IND.round(s.lo52, 6), n: s.n, first: s.first, spark: s.spark.map((x) => IND.round(x, 5)) };
}

/* ---------- Un passage complet ---------- */
async function readJSON(f) { try { return JSON.parse(await readFile(f, "utf8")); } catch { return null; } }
export async function run(dir, opts = {}) {
  const now = opts.now ?? Date.now(), fetchImpl = opts.fetch || fetch, sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const get = getter(fetchImpl), log = opts.log || console.log;
  const refPath = opts.ref || new URL("./referentiel.json", import.meta.url);
  const ref = JSON.parse(await readFile(refPath, "utf8")).instruments.filter((i) => i.is_active !== false);
  await mkdir(dir + "/hist", { recursive: true });
  const meta = (await readJSON(dir + "/marches-meta.json")) || {};
  meta.v = (meta.v | 0) + 1; meta.updated = now; meta.files = meta.files || {};
  meta.sources = {
    yahoo: "Yahoo Finance (API publique non officielle) : séries quotidiennes republiées pour un usage personnel, source citée.",
    fred: "FRED, Federal Reserve Bank of St. Louis (données publiques).",
    bce: "Banque centrale européenne, data-api.ecb.europa.eu (données publiques).",
    frankfurter: "Frankfurter (fixings de référence de la BCE)."
  };
  const tasks = plan(ref, meta, now, opts), stats = { ok: 0, err: 0, skipped: 0 };
  let yahoo429 = 0;
  for (const task of tasks) {
    const st = meta.files[task.f] || (meta.files[task.f] = { id: task.i.id });
    if (task.s.kind === "yahoo" && yahoo429 >= 3) { stats.skipped++; continue; }   // Yahoo nous limite : on s'arrête pour ce passage
    st.try = now; st.src = task.s.kind; st.ticker = task.s.code;
    const path = `${dir}/hist/${task.f}.json`, old = await readJSON(path);
    try {
      const fresh = await fetchHist(get, task, old, now);
      if (!fresh.t.length && !(old && old.t && old.t.length)) throw new Error("aucune séance reçue");
      const merged = merge(old, fresh, now);
      // les taux (proches de zéro, parfois négatifs) ne passent pas par le nettoyage fondé sur des rapports de prix
      const cl = task.i.vehicle === "taux" ? { h: merged, notes: [] } : clean(merged, { spikes: !/VIX/i.test(task.i.symbol || "") });
      const h = compact(cl.h);
      if (h.t.length < 2) throw new Error("historique inutilisable après nettoyage");
      st.note = cl.notes.join(" ; ");
      await writeFile(path, JSON.stringify(h));
      Object.assign(st, { ok: now, err: "", ccy: h.ccy, first: h.t.length ? IND.ymd(h.t[0]) : null, last: h.t.length ? IND.ymd(h.t[h.t.length - 1]) : null, n: h.t.length });
      stats.ok++; yahoo429 = 0;
    } catch (e) {
      st.err = String(e.message || e).slice(0, 200); stats.err++;
      if (e.status === 429) yahoo429++;
      log("✕", task.i.id, st.err);
    }
    if (task.s.kind === "yahoo" || task.s.kind === "fred") await sleep(opts.pause ?? 400);
  }
  // Résumé : relu depuis les fichiers (y compris ceux non touchés ce passage)
  const resume = { v: meta.v, ts: now, items: {} };
  for (const i of ref) {
    const f = fileOf(i.id); if (!meta.files[f] || !meta.files[f].last) continue;
    const h = await readJSON(`${dir}/hist/${f}.json`); if (!h) continue;
    const r = resumeOf(h, i.asset_class === "crypto" ? 365 : 252, i.vehicle === "taux"); if (r) { if (meta.files[f].note) r.note = meta.files[f].note; resume.items[i.id] = r; }
  }
  await writeFile(dir + "/resume.json", JSON.stringify(resume));
  if (opts.taux !== false) {
    const t = await taux(get, now, await readJSON(dir + "/taux.json"));
    meta.taux = { ts: now, err: t.err };
    await writeFile(dir + "/taux.json", JSON.stringify(t));
  }
  if (opts.fx !== false) {
    try {
      const fx = await get(`https://api.frankfurter.dev/v1/${ymdUTC(now - 1100 * DAY)}..?base=EUR`, "json");
      if (fx && fx.rates && Object.keys(fx.rates).length) { await writeFile(dir + "/fx.json", JSON.stringify(fx)); meta.fx = { ts: now, err: "" }; }
    } catch (e) { meta.fx = { ts: now, err: String(e.message || e) }; }
  }
  await writeFile(dir + "/marches-meta.json", JSON.stringify(meta));
  log(`Historiques : ${stats.ok} à jour, ${stats.err} en erreur, ${stats.skipped} reportés · ${Object.keys(resume.items).length} résumés · version ${meta.v}`);
  return { meta, resume, stats, tasks: tasks.length };
}

/* ---------- Ligne de commande ---------- */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), dir = a.find((x) => !x.startsWith("--")) || "donnees";
  const num = (k, d) => { const i = a.indexOf(k); return i >= 0 ? +a[i + 1] : d; };
  run(dir, { tout: a.includes("--tout"), boot: num("--boot", 15), maj: num("--maj", 60) }).catch((e) => { console.error(e); process.exit(1); });
}
