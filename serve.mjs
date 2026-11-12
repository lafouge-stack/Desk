// Aperçu local : node serve.mjs  ->  http://localhost:5173
// Sert les fichiers du dossier (lecture seule). Les adresses /data/… sont lues dans site/data/ (sortie du robot)
// quand ce dossier existe, sinon dans data/ à la racine.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const TYPES = { html: "text/html", json: "application/json", js: "text/javascript", mjs: "text/javascript", css: "text/css", png: "image/png", svg: "image/svg+xml", ico: "image/x-icon", csv: "text/csv", txt: "text/plain" };

createServer(async (req, res) => {
  try {
    const name = decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\/+/, "") || "index.html";
    const ext = (name.match(/\.([a-z]+)$/) || [])[1];
    if (!/^[\w\-./]+$/.test(name) || name.includes("..") || !TYPES[ext]) throw new Error("introuvable");
    let body;
    if (name.startsWith("data/")) {
      try { body = await readFile(new URL("site/" + name, import.meta.url)); } catch { body = await readFile(new URL(name, import.meta.url)); }
    } else body = await readFile(new URL(name, import.meta.url));
    res.writeHead(200, { "content-type": TYPES[ext] + (/^(image\/png|image\/x-icon)$/.test(TYPES[ext]) ? "" : "; charset=utf-8"), "cache-control": "no-store", "access-control-allow-origin": "*" });
    res.end(body);
  } catch (e) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Page introuvable");
  }
}).listen(5173, () => console.log("Desk sur http://localhost:5173"));
