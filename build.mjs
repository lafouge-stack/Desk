// Construit le Desk : assemble les fichiers du dossier (page.html + .js + .css) en un seul index.html.
// Usage : node build.mjs   (Node.js 18 ou plus, aucune installation)
import { readFileSync, writeFileSync } from "node:fs";

const rd = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const JS = ["core", "models", "datakit", "fx", "calendars", "pea", "providers", "indicators", "bg", "layout", "day", "signals", "liqmap", "pos", "extra", "screener", "ui", "net", "veille", "markets", "pfcore", "selection", "allocation", "prefs", "allocui", "mscreen", "msui", "portfolio", "worlds", "sound"].map((f) => `${f}.js`);
const CSS = ["style.css", "worlds.css"];

// Le manuel de l'agent (agent-manuel.md) est inséré dans veille.js
// Données éditables (JSON à la racine) insérées dans models.js : referentiel.json, allocation.json, fiscal.json.
// « < » est échappé pour qu'aucune donnée ne puisse fermer la balise <script>.
const jsonData = (f) => {
  let v;
  try { v = JSON.parse(rd(f)); } catch (e) { throw new Error(`${f} n'est pas un JSON valide : ${e.message}`); }
  return JSON.stringify(v).replace(/</g, "\\u003c");
};
const DATA = { "@@REFERENTIEL@@": "referentiel.json", "@@ALLOCATION@@": "allocation.json", "@@FISCAL@@": "fiscal.json" };
let js = JS.map(rd).join("\n").replace('"@@MANUEL@@"', () => JSON.stringify(rd("agent-manuel.md")));
for (const [mark, file] of Object.entries(DATA)) {
  if (!js.includes(`"${mark}"`)) throw new Error(`marqueur ${mark} introuvable dans les .js`);
  js = js.replace(`"${mark}"`, () => jsonData(file));
}
const css = CSS.map(rd).join("\n");
const cfg = rd("config.js");

// Le tout est inséré dans des balises <script> et <style> : ces séquences casseraient la page
for (const [name, code] of [["js", js], ["config", cfg]]) {
  if (/<\/script/i.test(code)) throw new Error(`"</script" interdit dans ${name}`);
}
if (/<\/style/i.test(css)) throw new Error('"</style" interdit dans le CSS');

const html = rd("page.html")
  .replace("/*@@CONFIG@@*/", () => cfg.trim())
  .replace("/*@@CSS@@*/", () => css.trim())
  .replace("/*@@JS@@*/", () => js.trim());

// Contrôles : balises équilibrées, JavaScript valide, commentaires CSS fermés
const count = (re) => (html.match(re) || []).length;
const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
if (/<\/?script/i.test(html.replace(re, ""))) throw new Error("balise <script> orpheline");
if (count(/<style[\s>]/g) !== count(/<\/style>/g)) throw new Error("<style> déséquilibré");
let m, n = 0;
while ((m = re.exec(html))) { n++; try { new Function(m[1]); } catch (e) { throw new Error(`Script ${n} invalide : ${e.message}`); } }
const opens = (css.match(/\/\*/g) || []).length, closes = (css.match(/\*\//g) || []).length;
if (opens !== closes) throw new Error(`Commentaires CSS déséquilibrés : ${opens} ouverts / ${closes} fermés`);

writeFileSync(new URL("index.html", import.meta.url), html);
console.log(`OK · index.html · ${(html.length / 1024).toFixed(1)} Ko · ${n} scripts valides`);
