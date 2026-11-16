// Calendriers de marché : fériés par règle, demi-séances, heure d'été, état ouvert/fermé.
// Valeurs de contrôle : research.md §4 (Euronext, NYSE, décalages d'heure 2026-2027).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeContext } from "./vmkit.mjs";

const { load, CK } = makeContext();
load("models.js");
const cal = load("calendars.js").cal;

// Array.from : les tableaux créés dans node:vm viennent d'un autre « royaume » (deepEqual les refuserait)
const closed = (m, y) => Array.from(cal.holidays(m, y)).filter((h) => !h.half).map((h) => h.date);
const halves = (m, y) => Array.from(cal.holidays(m, y)).filter((h) => h.half).map((h) => h.date);
const parisHM = (ts) => cal.hm(ts, "Europe/Paris");
const days = (from, to) => { const out = []; for (let t = Date.parse(from); t <= Date.parse(to); t += 864e5) out.push(new Date(t).toISOString().slice(0, 10)); return out; };
const at = (ymd, hm, tz = "Europe/Paris") => cal.zoned(ymd, hm, tz);

test("Pâques (Meeus/Butcher)", () => {
  assert.equal(cal.easter(2024), "2024-03-31");
  assert.equal(cal.easter(2025), "2025-04-20");
  assert.equal(cal.easter(2026), "2026-04-05");
  assert.equal(cal.easter(2027), "2027-03-28");
  assert.equal(cal.easter(2030), "2030-04-21");
  assert.equal(cal.easter(2019), "2019-04-21");
  assert.equal(cal.easter(2038), "2038-04-25");   // date la plus tardive possible
  assert.equal(cal.easter(2285), "2285-03-22");   // date la plus précoce possible
  assert.equal(cal.easter(1000), null);
});

test("Euronext 2026 : fermetures et demi-séances", () => {
  assert.deepEqual(closed("euronext", 2026), ["2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01", "2026-12-25"]);
  assert.deepEqual(halves("euronext", 2026), ["2026-12-24", "2026-12-31"]);
  for (const d of ["2026-01-02", "2026-04-02", "2026-05-08", "2026-05-14", "2026-05-25", "2026-07-14", "2026-11-11"])
    assert.equal(cal.isTradingDay("euronext", d), true, d + " ouvert");
  assert.equal(cal.holidayName("euronext", "2026-04-03"), "Vendredi saint");
  const s = cal.session("euronext", "2026-12-24");
  assert.equal(s.half, true);
  assert.equal(parisHM(s.open), "09:00");
  assert.equal(parisHM(s.close), "14:05");
  assert.equal(parisHM(cal.session("euronext", "2026-07-15").close), "17:30");
});

test("Euronext 2027 : 1/1, Vendredi saint, lundi de Pâques ; 1/5 et 25/12 un samedi", () => {
  assert.deepEqual(closed("euronext", 2027), ["2027-01-01", "2027-03-26", "2027-03-29"]);
  assert.deepEqual(halves("euronext", 2027), ["2027-12-24", "2027-12-31"]);
  assert.equal(cal.isHoliday("euronext", "2027-05-01"), false, "samedi : week-end, pas férié");
  assert.equal(cal.isTradingDay("euronext", "2027-05-01"), false);
});

test("Xetra : 24/12 et 31/12 fermés", () => {
  assert.deepEqual(closed("xetra", 2026), ["2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01", "2026-12-24", "2026-12-25", "2026-12-31"]);
  assert.deepEqual(halves("xetra", 2026), []);
  assert.equal(cal.lastTradingDayOfMonth("xetra", 2026, 12), "2026-12-30");
});

test("NYSE 2026 : fériés et séances écourtées", () => {
  assert.deepEqual(closed("nyse", 2026),
    ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"]);
  assert.deepEqual(halves("nyse", 2026), ["2026-11-27", "2026-12-24"]);
  assert.equal(cal.isHalfDay("nyse", "2026-07-02"), false, "pas de séance écourtée le 2 juillet 2026");
  const s = cal.session("nyse", "2026-11-27");
  assert.equal(s.half, true);
  assert.equal(cal.hm(s.close, "America/New_York"), "13:00");
  assert.equal(parisHM(s.close), "19:00");
});

test("NYSE 2027 : fériés observés et séance écourtée", () => {
  assert.deepEqual(closed("nyse", 2027),
    ["2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"]);
  assert.deepEqual(halves("nyse", 2027), ["2027-11-26"]);
  assert.equal(cal.isTradingDay("nyse", "2027-12-31"), true, "1/1/2028 un samedi : pas d'observation le 31/12");
});

test("NYSE : règles d'observation sur d'autres années", () => {
  assert.equal(cal.isHoliday("nyse", "2023-01-02"), true, "1/1/2023 dimanche → lundi 2");
  assert.equal(cal.isHoliday("nyse", "2022-06-20"), true, "Juneteenth 2022 dimanche → lundi 20");
  assert.equal(cal.isHoliday("nyse", "2021-06-18"), false, "pas de Juneteenth avant 2022");
  assert.equal(cal.isHalfDay("nyse", "2025-07-03"), true, "3/7/2025 jeudi écourté");
  assert.equal(cal.isHalfDay("nyse", "2024-07-03"), true);
  assert.equal(cal.isHoliday("nyse", "2022-12-26"), true, "Noël 2022 dimanche → lundi 26");
});

test("heures de Paris du NYSE pendant les décalages d'heure (mars et octobre 2026)", () => {
  const short = new Set([...days("2026-03-09", "2026-03-27"), ...days("2026-10-26", "2026-10-30")]);
  for (const d of days("2026-02-23", "2026-11-13")) {
    const s = cal.session("nyse", d);
    if (!s) continue;
    const exp = short.has(d) ? ["14:30", "21:00"] : ["15:30", s.half ? "19:00" : "22:00"];
    assert.deepEqual([parisHM(s.open), parisHM(s.close)], exp, d);
    assert.equal(cal.hm(s.open, "America/New_York"), "09:30", d);
  }
  assert.equal(parisHM(cal.session("nyse", "2026-03-06").open), "15:30");
  assert.equal(parisHM(cal.session("nyse", "2026-03-30").open), "15:30");
  assert.equal(parisHM(cal.session("nyse", "2026-11-02").open), "15:30");
});

test("heure d'été : zoned() et parisDay()", () => {
  assert.equal(at("2026-07-01", "09:00"), Date.UTC(2026, 6, 1, 7, 0));
  assert.equal(at("2026-01-15", "09:00"), Date.UTC(2026, 0, 15, 8, 0));
  assert.equal(at("2026-03-29", "09:00"), Date.UTC(2026, 2, 29, 7, 0), "jour du passage à l'heure d'été");
  assert.equal(at("2026-10-25", "09:00"), Date.UTC(2026, 9, 25, 8, 0), "jour du retour à l'heure d'hiver");
  assert.equal(at("2026-03-09", "09:30", "America/New_York"), Date.UTC(2026, 2, 9, 13, 30));
  assert.equal(cal.parisDay(Date.UTC(2026, 11, 31, 23, 30)), "2027-01-01");
  assert.equal(cal.parisDay(Date.UTC(2026, 5, 30, 21, 59)), "2026-06-30");
  assert.equal(cal.parisDay(Date.UTC(2026, 5, 30, 22, 0)), "2026-07-01");
  assert.equal(cal.zoned("2026-02-30", "09:00", "Europe/Paris"), null);
});

test("non-expiration : 2030 et 2035 calculés par règle", () => {
  assert.deepEqual(closed("euronext", 2030), ["2030-01-01", "2030-04-19", "2030-04-22", "2030-05-01", "2030-12-25", "2030-12-26"]);
  assert.deepEqual(closed("nyse", 2030),
    ["2030-01-01", "2030-01-21", "2030-02-18", "2030-04-19", "2030-05-27", "2030-06-19", "2030-07-04", "2030-09-02", "2030-11-28", "2030-12-25"]);
  assert.equal(cal.easter(2035), "2035-03-25");
  assert.deepEqual(closed("euronext", 2035), ["2035-01-01", "2035-03-23", "2035-03-26", "2035-05-01", "2035-12-25", "2035-12-26"]);
  for (const m of ["euronext", "xetra", "nyse"]) for (const y of [2030, 2035, 2050])
    assert.ok(cal.holidays(m, y).filter((h) => !h.half).length >= 3, `${m} ${y}`);   // 2050 : 1/5, 25/12 un week-end
  assert.ok(cal.session("nyse", "2035-06-12").open > 0);
});

test("jours de bourse suivant/précédent et dernier jour du mois", () => {
  assert.equal(cal.lastTradingDayOfMonth("euronext", 2026, 12), "2026-12-31");
  assert.equal(cal.isHalfDay("euronext", "2026-12-31"), true, "31/12/2026 : demi-séance");
  assert.equal(cal.lastTradingDayOfMonth("euronext", 2026, 1), "2026-01-30", "31/01/2026 un samedi");
  assert.equal(cal.lastTradingDayOfMonth("nyse", 2026, 5), "2026-05-29", "31/05/2026 un dimanche");
  assert.equal(cal.lastTradingDayOfMonth("nyse", 2027, 12), "2027-12-31");
  assert.equal(cal.lastTradingDayOfMonth("crypto", 2026, 1), "2026-01-31");
  assert.equal(cal.nextTradingDay("euronext", "2026-04-02"), "2026-04-07", "Pâques");
  assert.equal(cal.prevTradingDay("euronext", "2026-04-07"), "2026-04-02");
  assert.equal(cal.nextTradingDay("nyse", "2026-07-02"), "2026-07-06");
  assert.equal(cal.nextTradingDay("euronext", "2026-12-24"), "2026-12-28");
  assert.equal(cal.lastTradingDayOfMonth("euronext", 2026, 13), null);
});

test("state() et isOpen() à des instants précis", () => {
  const e = (ymd, hm) => cal.state("euronext", at(ymd, hm));
  let st = e("2026-11-13", "10:00");
  assert.equal(st.open, true); assert.equal(st.label, "Ouvert"); assert.equal(st.next_open, null);
  assert.equal(st.close, at("2026-11-13", "17:30"));
  st = e("2026-11-13", "08:59");
  assert.equal(st.open, false); assert.equal(st.label, "Fermé"); assert.equal(st.next_open, at("2026-11-13", "09:00"));
  st = e("2026-11-13", "17:30");
  assert.equal(st.open, false); assert.equal(st.next_open, at("2026-11-16", "09:00"), "vendredi soir → lundi");
  st = e("2026-11-14", "12:00");
  assert.equal(st.label, "Fermé (week-end)"); assert.equal(st.next_open, at("2026-11-16", "09:00"));
  st = e("2026-04-03", "12:00");
  assert.equal(st.label, "Fermé (jour férié)"); assert.equal(st.holiday, "Vendredi saint"); assert.equal(st.next_open, at("2026-04-07", "09:00"));
  st = e("2026-12-24", "13:00");
  assert.equal(st.open, true); assert.equal(st.label, "Séance écourtée");
  assert.equal(e("2026-12-24", "14:10").open, false);
  assert.equal(cal.isOpen("euronext", at("2026-12-24", "14:04")), true);
  // NYSE vu de Paris pendant la fenêtre de mars : ouvert à 14:45, fermé à 21:05
  assert.equal(cal.isOpen("nyse", at("2026-03-10", "14:45")), true);
  assert.equal(cal.isOpen("nyse", at("2026-03-10", "21:05")), false);
  assert.equal(cal.isOpen("nyse", at("2026-04-10", "14:45")), false);
  assert.equal(cal.isOpen("nyse", at("2026-04-10", "21:05")), true);
  assert.equal(cal.state("nyse", at("2026-11-26", "16:00")).label, "Fermé (jour férié)");
  assert.equal(cal.state("nyse", at("2026-11-27", "18:00")).label, "Séance écourtée");
  assert.equal(cal.isOpen("nyse", at("2026-11-27", "19:30")), false);
  assert.equal(cal.state("inconnu", 0), null);
  assert.equal(cal.isOpen("inconnu", 0), false);
});

test("state() sans instant lit l'horloge injectable CK.dk.env.now()", () => {
  CK.dk = { env: { now: () => at("2026-11-14", "12:00") } };
  try { assert.equal(cal.state("euronext").label, "Fermé (week-end)"); assert.equal(cal.parisDay(), "2026-11-14"); }
  finally { delete CK.dk; }
});

test("crypto : toujours ouvert", () => {
  for (const ts of [at("2026-12-25", "03:00"), at("2026-11-14", "12:00"), at("2027-01-01", "00:00")]) {
    assert.equal(cal.isOpen("crypto", ts), true);
    assert.equal(cal.state("crypto", ts).label, "Ouvert");
  }
  assert.equal(cal.isHoliday("crypto", "2026-12-25"), false);
  assert.equal(cal.isTradingDay("crypto", "2026-11-14"), true);
  assert.equal(cal.holidays("crypto", 2026).length, 0);
  const s = cal.session("crypto", "2026-11-14");
  assert.equal(s.close - s.open, 864e5);
  assert.equal(cal.nextTradingDay("crypto", "2026-12-31"), "2027-01-01");
});

test("entrées invalides : pas d'exception", () => {
  assert.equal(cal.isTradingDay("euronext", "n'importe quoi"), false);
  assert.equal(cal.session("euronext", "2026-13-01"), null);
  assert.equal(cal.isHoliday("marche", "2026-01-01"), false);
  assert.equal(cal.isTradingDay("euronext", at("2026-11-13", "10:00")), true, "accepte un instant en ms");
});

// ---------- Cas limites ajoutés à la relecture ----------

test("instant hors limites, fuseau inconnu, heure impossible : null, jamais d'exception", () => {
  assert.equal(cal.state("euronext", 1e20), null, "au-delà des dates JavaScript");
  assert.equal(cal.isOpen("euronext", 1e20), false);
  assert.equal(cal.isTradingDay("euronext", 1e20), false);
  assert.equal(cal.session("nyse", 1e20), null);
  assert.equal(cal.hm(NaN), null);
  assert.equal(cal.dayIn(0, "Mars/Olympus"), null);
  assert.equal(cal.dayIn(0, "__proto__"), null);
  assert.equal(cal.zoned("2026-01-01", "09:00", "Mars/Olympus"), null);
  assert.equal(cal.zoned("2026-01-01", "25:00", "Europe/Paris"), null);
  assert.equal(cal.zoned("2026-01-01", "09:75", "Europe/Paris"), null);
  assert.equal(cal.zoned("2026-01-01", "23:59", "UTC"), Date.UTC(2026, 0, 1, 23, 59));
  assert.equal(cal.dayIn(Date.UTC(2026, 0, 1, 2), "America/New_York"), "2025-12-31");
});

test("NYSE : observations samedi → vendredi et dimanche → lundi (Noël, 4 juillet, Juneteenth)", () => {
  // 2021 : Noël un samedi → vendredi 24 fermé, pas de séance écourtée le 23
  assert.equal(cal.holidayName("nyse", "2021-12-24"), "Noël");
  assert.equal(cal.isHalfDay("nyse", "2021-12-23"), false);
  // 2027 : 1/1/2028 un samedi : le 31/12/2027 reste une séance normale
  assert.equal(cal.isHalfDay("nyse", "2027-12-31"), false);
  // 2032 : 4 juillet un dimanche → lundi 5 ; le samedi 3 n'est pas une séance
  assert.equal(cal.isHoliday("nyse", "2032-07-05"), true);
  assert.equal(cal.isHalfDay("nyse", "2032-07-02"), false);
  // 2026 : Juneteenth un vendredi, 2027 un samedi → vendredi 18, 2033 un dimanche → lundi 20
  assert.equal(cal.isHoliday("nyse", "2027-06-18"), true);
  assert.equal(cal.isHoliday("nyse", "2033-06-20"), true);
  // 2023 : 4 juillet un mardi → lundi 3 écourté
  assert.equal(cal.isHalfDay("nyse", "2023-07-03"), true);
  assert.equal(cal.hm(cal.session("nyse", "2023-07-03").close, "America/New_York"), "13:00");
});

test("state() : séance écourtée terminée → « Fermé » et prochaine ouverture le jour de bourse suivant", () => {
  const st = cal.state("nyse", at("2026-11-27", "19:30"));
  assert.equal(st.label, "Fermé");
  assert.equal(st.next_open, at("2026-11-30", "09:30", "America/New_York"));
  const x = cal.state("xetra", at("2026-12-24", "10:00", "Europe/Berlin"));
  assert.equal(x.label, "Fermé (jour férié)");
  assert.equal(x.holiday, "Veille de Noël");
  assert.equal(x.next_open, at("2026-12-28", "09:00", "Europe/Berlin"));
});
