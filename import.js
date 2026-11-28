/*
 * Import: liest fremde Dateien und liefert Kandidaten { name, lat, lon, notiz, land, art, preis, bewertung, ausstattung…, datum, abfahrt, bilder }.
 * bilder: im KMZ eingebettete Bilder { name, laden() }; Links ins Netz werden nie geladen, nur gezählt (KONZEPT-WEBAPP.md 12.8.6).
 * Formate: GPX, KML/KMZ, GeoJSON, Google Takeout (Saved Places.json, Listen als CSV), CSV (auch Garmin-POI ohne Kopfzeile), Fotos mit GPS.
 * Geschrieben wird hier nichts. Alle Inhalte gelten als fremd: nur Text und Zahlen, geprüft und gekürzt.
 */
import { zipLesen } from "./zip.js?v=11";
import { koordinatenLesen, gueltigeKoordinaten, km, AUSSTATTUNG_KEYS, PREIS_MAX } from "./plaetze.js?v=11";
import { exifLesen } from "./daten.js?v=11";

const MAX_BYTE = 50e6, MAX_PLAETZE = 5000;
const FOTO_KM = 0.3; // Fotos im Umkreis gehören zu einem Platz

const kurz = (x, max) => String(x ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
/** HTML aus Beschreibungen → Text. DOMParser führt nichts aus und lädt nichts nach. */
function ohneHtml(t) {
  if (!/<[a-z!/]|&[a-z#0-9]+;/i.test(t || "")) return t || "";
  const d = new DOMParser().parseFromString(String(t).replace(/<(br|\/p|\/div|\/li|\/tr)\b[^>]*>/gi, "$&\n"), "text/html");
  d.querySelectorAll("script, style").forEach((e) => e.remove());
  return d.body.textContent;
}
const zahl = (x) => { const t = String(x ?? "").trim().replace(/\s/g, ""); if (!/^[-+]?\d+([.,]\d+)?$/.test(t)) return NaN; return Number(t.replace(",", ".")); };
const tag = (x) => {
  const t = String(x ?? "").trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/) || t.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (!m) { m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/); if (m) m = [m[0], m[3], m[2].padStart(2, "0"), m[1].padStart(2, "0")]; }
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00`);
  // „2026-02-31“ rutscht sonst in den März
  return !Number.isNaN(d.getTime()) && d.getDate() === Number(m[3]) && d.getTime() < Date.now() + 864e5 && d.getFullYear() > 1980 ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const artAus = (x) => {
  const t = String(x ?? "").toLowerCase();
  if (/campingplatz|campground|camp ?site|camping/.test(t)) return "Campingplatz";
  if (/stellplatz|motorhome|wohnmobil|\baire\b|rv park/.test(t)) return "Stellplatz";
  if (/parkplatz|parking|car park|\bparken\b/.test(t)) return "Parkplatz";
  if (/\bnatur|\bnature\b|\bwild/.test(t)) return "Natur";
  return "";
};

function kandidat(x) {
  if (!gueltigeKoordinaten(x.lat, x.lon) || (x.lat === 0 && x.lon === 0)) return null; // 0,0 = „unbekannt“ bei Google
  const preis = typeof x.preis === "number" && Number.isFinite(x.preis) && x.preis >= 0 ? Math.min(PREIS_MAX, Math.round(x.preis)) : null;
  const bew = typeof x.bewertung === "number" && Number.isFinite(x.bewertung) ? Math.min(5, Math.max(0, Math.round(x.bewertung))) : 0;
  const datum = tag(x.datum), ab = tag(x.abfahrt);
  return { name: kurz(ohneHtml(x.name), 100).replace(/\n/g, " "), lat: x.lat, lon: x.lon, notiz: kurz(ohneHtml(x.notiz), 20000), land: /^[A-Za-z]{2}$/.test(x.land || "") ? x.land.toUpperCase() : "",
    art: artAus(x.art), preis, bewertung: bew, merkmale: AUSSTATTUNG_KEYS.filter((k) => x[k] === true), datum, abfahrt: datum && ab && ab >= datum ? ab : null,
    bilder: Array.isArray(x.bilder) ? x.bilder : [] };
}

// ---------------------------------------------------------------- XML: GPX, KML

function xml(text) {
  if (/<!ENTITY/i.test(text)) throw new Error("Die Datei enthält nicht erlaubte XML-Angaben");
  const d = new DOMParser().parseFromString(text, "application/xml");
  if (d.querySelector("parsererror")) throw new Error("Die Datei ist beschädigt (kein gültiges XML)");
  return d;
}
const kinder = (e, name) => [...e.children].filter((k) => k.localName === name);
const kind = (e, name) => kinder(e, name)[0]?.textContent.trim() || "";

function gpx(text) {
  const d = xml(text);
  return [...d.getElementsByTagNameNS("*", "wpt")].map((w) => ({ lat: zahl(w.getAttribute("lat")), lon: zahl(w.getAttribute("lon")), name: kind(w, "name"),
    notiz: [kind(w, "desc"), kind(w, "cmt")].filter((t, i, l) => t && l.indexOf(t) === i && t !== kind(w, "name")).join("\n\n"), art: `${kind(w, "type")} ${kind(w, "sym")}`, datum: kind(w, "time") }));
}

/** Bildverweise eines Orts: <img src> in der Beschreibung und gx_media_links (My Maps). Links mit Schema („https:“, „data:“) gelten als fremd. */
function bildquellen(p) {
  const quellen = [...kind(p, "description").matchAll(/<img\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  for (const d of p.getElementsByTagNameNS("*", "Data")) if (d.getAttribute("name") === "gx_media_links") quellen.push(...kind(d, "value").split(/\s+/));
  const eigen = [];
  let fremd = 0;
  for (const q of new Set(quellen.map((x) => x.trim()).filter(Boolean))) /^[a-z][a-z0-9+.-]*:|^\/\//i.test(q) ? fremd++ : eigen.push(q);
  return { eigen, fremd };
}

/** Pfad im KMZ: relativ zur KML-Datei, „./“ und „../“ aufgelöst, ohne Abfrage und Anker. */
function pfadImZip(basis, q) {
  let p = q.split(/[?#]/)[0];
  try { p = decodeURIComponent(p); } catch (e) { /* bleibt */ }
  const teile = [];
  for (const t of (p.startsWith("/") ? p.slice(1) : basis + p).split("/")) t === ".." ? teile.pop() : t && t !== "." && teile.push(t);
  return teile.join("/");
}
const BILD = /\.(jpe?g|png|webp|gif|heic|heif)$/i, BILDER_JE_ORT = 50;

/** z, basis: nur beim KMZ – dann werden eingebettete Bilder als { name, laden } mitgegeben, sonst nur gezählt. */
function kml(text, z = null, basis = "") {
  const d = xml(text);
  return [...d.getElementsByTagNameNS("*", "Placemark")].flatMap((p) => {
    const punkt = p.getElementsByTagNameNS("*", "Point")[0];
    if (!punkt) return []; // Linien und Flächen sind keine Plätze
    const [lon, lat] = (punkt.getElementsByTagNameNS("*", "coordinates")[0]?.textContent || "").trim().split(/[\s,]+/).map(zahl);
    const ordner = p.parentElement?.localName === "Folder" ? kind(p.parentElement, "name") : "";
    const zeit = p.getElementsByTagNameNS("*", "when")[0]?.textContent || p.getElementsByTagNameNS("*", "begin")[0]?.textContent;
    const q = bildquellen(p), bilder = [];
    let fehlen = 0;
    for (const b of q.eigen) {
      const pfad = z ? pfadImZip(basis, b) : "";
      if (pfad && BILD.test(pfad) && z.has(pfad) && bilder.length < BILDER_JE_ORT) bilder.push({ name: pfad.split("/").pop(), laden: z.get(pfad) });
      else fehlen++;
    }
    return [{ lat, lon, name: kind(p, "name"), notiz: kind(p, "description"), art: ordner, datum: zeit, bilder, fotolinks: q.fremd, bilderFehlen: fehlen }];
  });
}

async function kmz(blob) {
  const z = await zipLesen(blob);
  const namen = [...z.keys()].filter((n) => /\.kml$/i.test(n));
  if (!namen.length) throw new Error("Im KMZ steckt keine KML-Datei");
  const alle = [];
  for (const n of namen) alle.push(...kml(new TextDecoder().decode(await z.get(n)()), z, n.includes("/") ? n.slice(0, n.lastIndexOf("/") + 1) : ""));
  return alle;
}

// ---------------------------------------------------------------- JSON: GeoJSON, Google Takeout

function geojson(text) {
  let d;
  try { d = JSON.parse(text); } catch (e) { throw new Error("Die Datei ist beschädigt (kein gültiges JSON)"); }
  const f = d?.type === "FeatureCollection" ? d.features : d?.type === "Feature" ? [d] : null;
  if (!Array.isArray(f)) throw new Error("Diese JSON-Datei enthält keine Orte (GeoJSON erwartet)");
  const google = f.some((x) => x?.properties?.google_maps_url || x?.properties?.["Google Maps URL"]);
  const liste = f.filter((x) => x?.geometry?.type === "Point" || google).map((x) => {
    const p = x.properties && typeof x.properties === "object" ? x.properties : {}, l = p.location || p.Location || {}, url = p.google_maps_url || p["Google Maps URL"] || "";
    let [lon, lat] = Array.isArray(x.geometry?.coordinates) ? x.geometry.coordinates : [];
    if (!lat && !lon) { // Google kennt die Stelle nicht (0,0) → Adresse des Links versuchen
      const k = (l["Geo Coordinates"] && { lat: zahl(l["Geo Coordinates"].Latitude), lon: zahl(l["Geo Coordinates"].Longitude) }) || koordinatenLesen(url);
      if (k) ({ lat, lon } = k);
    }
    const wort = (...k) => k.map((n) => p[n]).find((w) => typeof w === "string" && w.trim()) || "";
    return { lat, lon, name: l.name || l["Business Name"] || wort("name", "title", "Title", "Name", "titel"), land: l.country_code || l["Country Code"] || wort("land", "country_code"),
      notiz: [wort("Comment", "comment", "notiz", "description", "desc", "note"), google ? l.address || l.Address || "" : ""].filter(Boolean).join("\n\n"), art: wort("art", "type", "category", "tourism"),
      // Googles Datum ist der Tag des Speicherns, kein Besuch
      datum: google ? null : wort("datum", "ankunft", "date", "time"), abfahrt: google ? null : wort("abfahrt"), bewertung: typeof p.bewertung === "number" ? p.bewertung : p.rating, preis: p.preis };
  });
  return { name: google ? "Google Maps" : "GeoJSON", liste };
}

// ---------------------------------------------------------------- CSV

export function csvZeilen(text) {
  text = text.replace(/^\ufeff/, "");
  const erste = text.slice(0, (text.search(/\r?\n/) + 1 || text.length + 1) - 1), zaehle = (z) => erste.replace(/"[^"]*"/g, "").split(z).length;
  const trenner = [";", "\t", ","].reduce((a, b) => (zaehle(b) > zaehle(a) ? b : a));
  const zeilen = [];
  let zeile = [], feld = "", inAnf = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inAnf) { if (c === '"') { if (text[i + 1] === '"') { feld += '"'; i++; } else inAnf = false; } else feld += c; }
    else if (c === '"' && feld === "") inAnf = true;
    else if (c === trenner) { zeile.push(feld); feld = ""; }
    else if (c === "\n") { zeile.push(feld.replace(/\r$/, "")); zeilen.push(zeile); zeile = []; feld = ""; }
    else feld += c;
  }
  if (feld || zeile.length) { zeile.push(feld); zeilen.push(zeile); }
  return zeilen.filter((z) => z.some((f) => f.trim()));
}

const SPALTEN = { lat: ["lat", "latitude", "breite", "breitengrad", "y"], lon: ["lon", "lng", "long", "longitude", "laenge", "länge", "laengengrad", "längengrad", "x"],
  ort: ["koordinaten", "coordinates", "coords", "gps", "position", "location", "wkt"], name: ["name", "titel", "title", "bezeichnung", "platz", "stellplatz", "ort"],
  notiz: ["notiz", "notizen", "note", "notes", "beschreibung", "description", "kommentar", "comment", "bemerkung"], url: ["url", "link", "google maps url", "google_maps_url"],
  art: ["art", "typ", "type", "kategorie", "category"], land: ["land", "country", "country_code"], preis: ["preis", "price", "kosten"], bewertung: ["bewertung", "rating", "sterne", "stars"],
  datum: ["datum", "ankunft", "date", "besuch", "besucht", "von", "arrival"], abfahrt: ["abfahrt", "bis", "departure"], ...Object.fromEntries(AUSSTATTUNG_KEYS.map((k) => [k, [k]])) };

function csv(text) {
  const z = csvZeilen(text);
  if (!z.length) throw new Error("Die Datei ist leer");
  const kopf = z[0].map((k) => k.trim().toLowerCase()), sp = {};
  for (const [k, namen] of Object.entries(SPALTEN)) { const i = kopf.findIndex((x) => namen.includes(x)); if (i >= 0) sp[k] = i; }
  const hatOrt = ("lat" in sp && "lon" in sp) || "ort" in sp || "url" in sp;
  if (!hatOrt) {
    // Ohne Kopfzeile: zwei Zahlen vorn. Garmin-POI schreibt Länge, Breite, Name, Kommentar
    if (!Number.isNaN(zahl(z[0][0])) && !Number.isNaN(zahl(z[0][1]))) return { name: "CSV ohne Kopfzeile", tauschbar: true, liste: z.map((r) => ({ lon: zahl(r[0]), lat: zahl(r[1]), name: r[2], notiz: r[3] })) };
    throw new Error("Keine Spalten mit Koordinaten gefunden (z. B. „lat“ und „lon“ oder „Koordinaten“)");
  }
  const liste = z.slice(1).map((r) => {
    const w = (k) => (k in sp ? (r[sp[k]] || "").trim() : "");
    let lat = zahl(w("lat")), lon = zahl(w("lon"));
    if (!gueltigeKoordinaten(lat, lon)) {
      const wkt = w("ort").match(/^POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)$/i);
      const k = wkt ? { lon: Number(wkt[1]), lat: Number(wkt[2]) } : koordinatenLesen(w("ort")) || koordinatenLesen(w("url"));
      if (k) ({ lat, lon } = k);
    }
    const preis = w("preis").replace(/[€\s]/g, "");
    return { lat, lon, name: w("name"), notiz: w("notiz"), art: w("art"), land: w("land"), preis: /kostenlos|gratis|free/i.test(preis) ? 0 : preis ? zahl(preis) : null, bewertung: zahl(w("bewertung")), datum: w("datum"), abfahrt: w("abfahrt"),
      ...Object.fromEntries(AUSSTATTUNG_KEYS.map((k) => [k, /^(1|x|ja|yes|true|wahr)$/i.test(w(k))])) };
  });
  return { name: "CSV", liste };
}

// ---------------------------------------------------------------- Datei erkennen

async function textVon(blob) {
  const b = new Uint8Array(await blob.arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(b); } catch (e) { return new TextDecoder("windows-1252").decode(b); } // ältere Excel-Dateien
}

/** → { backup: true } oder { quelle, kandidaten, ohneOrt, doppelt, tauschbar }. Erkannt wird am Inhalt, nicht an der Endung. */
export async function dateiLesen(datei) {
  if (datei.size > MAX_BYTE) {
    const k = new Uint8Array(await datei.slice(0, 4).arrayBuffer());
    if (!(k[0] === 0x50 && k[1] === 0x4b)) throw new Error("Die Datei ist zu groß");
  }
  const anfang = new Uint8Array(await datei.slice(0, 4).arrayBuffer());
  let quelle, liste, tauschbar = false;
  if (anfang[0] === 0x50 && anfang[1] === 0x4b) {
    const namen = [...(await zipLesen(datei)).keys()];
    if (namen.some((n) => /(^|\/)daten\.json$/.test(n))) return { backup: true };
    if (!namen.some((n) => /\.kml$/i.test(n))) throw new Error("In diesem ZIP habe ich keine Orte gefunden. Bitte die Datei darin einzeln auswählen.");
    quelle = "KMZ"; liste = await kmz(datei);
  } else {
    const text = await textVon(datei), t = text.replace(/^\ufeff/, "").trimStart();
    if (t.startsWith("<")) {
      const kopf = t.slice(0, 4000);
      if (/<(\w+:)?gpx[\s>]/i.test(kopf)) { quelle = "GPX"; liste = gpx(t); }
      else if (/<(\w+:)?kml[\s>]/i.test(kopf)) { quelle = "KML"; liste = kml(t); }
      else throw new Error("Dieses Format kenne ich nicht");
    } else if (t.startsWith("{") || t.startsWith("[")) ({ name: quelle, liste } = geojson(t));
    else ({ name: quelle, liste, tauschbar = false } = csv(text));
  }
  if (!liste.length) throw new Error(quelle === "GPX" ? "Die GPX-Datei enthält keine Wegpunkte (nur Strecken?)" : "Die Datei enthält keine Orte");
  if (liste.length > MAX_PLAETZE) throw new Error(`Mehr als ${MAX_PLAETZE.toLocaleString("de-DE")} Orte auf einmal gehen nicht`);
  const summe = (k) => liste.reduce((s, x) => s + (x[k] || 0), 0);
  return { quelle, tauschbar, roh: liste, fotolinks: summe("fotolinks"), bilderFehlen: summe("bilderFehlen"), ...auswerten(liste) };
}

/** Rohliste → Kandidaten; gleiche Orte (gleicher Name, ≤ 30 m) nur einmal. tauschen = Breite und Länge vertauscht. */
export function auswerten(liste, tauschen = false) {
  const kandidaten = [], raster = new Map();
  let ohneOrt = 0, doppelt = 0;
  for (const x of liste) {
    const k = kandidat(tauschen ? { ...x, lat: x.lon, lon: x.lat } : x);
    if (!k) { ohneOrt++; continue; }
    const schluessel = k.name.toLowerCase();
    const gleiche = raster.get(schluessel) || [];
    if (gleiche.some((g) => km(g.lat, g.lon, k.lat, k.lon) <= 0.03)) { doppelt++; continue; }
    raster.set(schluessel, [...gleiche, k]);
    kandidaten.push(k);
  }
  return { kandidaten, ohneOrt, doppelt };
}

// ---------------------------------------------------------------- Fotos mit GPS

/** Fotos nach Ort bündeln: je Gruppe ein Platz, je Tag ein Besuch. → { gruppen: [{ lat, lon, fotos: [{ datei, zeit }] }], ohneOrt } */
export async function fotosLesen(dateien, fortschritt = () => {}) {
  const gruppen = [];
  let ohneOrt = 0, n = 0;
  for (const datei of dateien) {
    const e = await exifLesen(datei).catch(() => null);
    fortschritt(++n, dateien.length);
    if (!e || !gueltigeKoordinaten(e.lat, e.lon) || (e.lat === 0 && e.lon === 0)) { ohneOrt++; continue; }
    const g = gruppen.find((x) => km(x.lat, x.lon, e.lat, e.lon) <= FOTO_KM);
    if (g) g.fotos.push({ datei, zeit: e.zeit }); else gruppen.push({ lat: e.lat, lon: e.lon, fotos: [{ datei, zeit: e.zeit }] });
  }
  for (const g of gruppen) g.tage = [...new Set(g.fotos.map((f) => f.zeit?.slice(0, 10)).filter((t) => t && tag(t)))].sort();
  return { gruppen, ohneOrt };
}
