/*
 * Service Worker von Frag Herbert: App-Dateien und Kartenkacheln offline. Plätze und Fotos liegen in IndexedDB, nicht hier.
 * Neue Version: VERSION erhöhen und die ?v=-Angaben in APP, index.html und den import-Zeilen angleichen (tools/pruefen.py).
 * Es werden nur eigene Caches („herbert-…“) angefasst.
 */
const VERSION = "herbert-app-9";
const APP = ["./", "app.js?v=9", "app.css?v=9", "thema.js?v=9", "daten.js?v=9", "speicher.js?v=9", "plaetze.js?v=9", "backup.js?v=9", "abgleich.js?v=9", "zip.js?v=9", "import.js?v=9", "karte.js?v=9",
  "kartenstil.js?v=9", "blatt.js?v=9", "icons.js?v=9", "info.js?v=9", "manifest.webmanifest", "maplibre/maplibre-gl-csp.js?v=6.24.0", "maplibre/maplibre-gl-csp-worker.js",
  "maplibre/maplibre-gl.css?v=6.24.0", "icon-180.png?v=13", "icon-192.png?v=13", "icon-512.png?v=13"];
const KACHELN = "herbert-karte";
const KACHEL_TAGE = 60;
const KACHEL_MAX = 3000;
// Kartenebenen (kartenstil.js). CyclOSM und Esri sind entfernt: ihre Kacheln werden beim Aktivieren gelöscht (Nutzungsbedingungen).
const KACHEL_HOSTS = /^tiles\.(openfreemap\.org|mapterhorn\.com)$|\.tile\.opentopomap\.org$|^tiles\.maps\.eox\.at$|^mapsneu\.wien\.gv\.at$|^wmts\.geo\.admin\.ch$|^service\.pdok\.nl$/;
const ENTFERNT = /tile-cyclosm\.openstreetmap\.fr|arcgisonline\.com/;
const WURZEL = new URL("./", location.href);

self.addEventListener("install", (e) => {
  // cache: "reload" – GitHub Pages setzt max-age=600, sonst käme z. B. eine alte index.html in den neuen Cache
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(APP.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

async function aufraeumen() {
  const cache = await caches.open(KACHELN);
  for (const k of await cache.keys()) if (ENTFERNT.test(k.url)) await cache.delete(k);
}

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((namen) => Promise.all(namen.filter((n) => n.startsWith("herbert-") && n !== VERSION && n !== KACHELN).map((n) => caches.delete(n))))
    .then(aufraeumen).then(() => self.clients.claim()));
});

self.addEventListener("message", (e) => { if (e.data === "aktivieren") self.skipWaiting(); });

async function begrenzen(name, max) {
  const cache = await caches.open(name), schluessel = await cache.keys();
  for (const k of schluessel.slice(0, Math.max(0, schluessel.length - max))) await cache.delete(k);
}

async function appDatei(req, url) {
  const cache = await caches.open(VERSION);
  const startseite = url.pathname === WURZEL.pathname || url.pathname === `${WURZEL.pathname}index.html`;
  return (startseite ? await cache.match("./") : await cache.match(req)) || fetch(req);
}

async function netzZuerst(req) {
  const cache = await caches.open(KACHELN);
  try {
    const antwort = await fetch(req);
    if (antwort.ok) await cache.put(req, antwort.clone());
    return antwort;
  } catch (e) {
    const alt = await cache.match(req);
    if (alt) return alt;
    throw e;
  }
}

let kachelZaehler = 0;
async function kachel(req, url) {
  // …/planet/20261122_124456_pt/10/536/330.pbf → …/planet/10/536/330.pbf; Rasterserver a/b/c → eine Adresse
  const schluessel = new Request((url.origin + url.pathname).replace(/\/planet\/[^/]+\//, "/planet/").replace(/\/\/[abc]\.(tile)/, "//$1"));
  const cache = await caches.open(KACHELN), alt = await cache.match(schluessel);
  if (alt && Date.now() - Date.parse(alt.headers.get("date") || 0) < KACHEL_TAGE * 864e5) return alt;
  try {
    const antwort = await fetch(req);
    if (!antwort.ok) return alt || antwort;
    await cache.put(schluessel, antwort.clone());
    if (++kachelZaehler % 50 === 0) begrenzen(KACHELN, KACHEL_MAX);
    return antwort;
  } catch (e) {
    if (alt) return alt;
    throw e;
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.startsWith(WURZEL.pathname) && !url.pathname.endsWith("/sw.js")) e.respondWith(appDatei(req, url));
    return;
  }
  if (url.href === "https://tiles.openfreemap.org/planet") {
    e.respondWith(netzZuerst(req).catch(() => new Response("", { status: 504 })));
  } else if (KACHEL_HOSTS.test(url.hostname)) {
    e.respondWith(kachel(req, url).catch(() => new Response("", { status: 504 })));
  }
});
