/*
 * Plätze, Besuche, Nächte: reine Rechenregeln ohne Oberfläche und ohne Datenbank.
 *
 * Platz: { id, name, land, lat, lon, umkreis_km, art, preis (€, null = unbekannt, 51 = über 50), bewertung 0–5, notiz,
 *   strom … toilette (bool), aktivitaeten [], gepflegt, titelfoto, besuche [], angelegt, zeiten { Feld: Zeitpunkt der letzten
 *   Änderung }, geloescht (Zeitpunkt | null) }. „zeiten“ dient dem Zusammenführen: je Feld gewinnt die letzte Änderung.
 * Besuch: { id, ankunft, abfahrt | null, ganztags, naechte { JJJJ-MM-TT: "aussen" }, t, weg }. Nacht = Datum des Abends; ohne
 *   Eintrag zählt sie als Übernachtung, "aussen" = über Nacht geparkt. t = letzte Änderung, weg = gelöscht (bleibt als Merker).
 * Ein Platz ohne Besuche ist „vorgemerkt“.
 */
export const PREIS_MAX = 51;
export const UMKREIS_KM = 0.3;
export const PAPIERKORB_TAGE = 30;
export const ARTEN_NAMEN = ["Parkplatz", "Natur", "Stellplatz", "Campingplatz"];
export const AUSSTATTUNG_KEYS = ["strom", "entsorgung", "wasser", "dusche", "muell", "toilette"];
export const AKTIVITAET_KEYS = ["klettern_indoor", "klettern_outdoor", "wandern", "laufen", "schwimmen_outdoor", "schwimmbad_sauna", "fitness", "skatepark", "pumptrack"];
export const FELDER = ["name", "land", "lat", "lon", "umkreis_km", "art", "preis", "bewertung", "notiz", ...AUSSTATTUNG_KEYS, "aktivitaeten", "gepflegt", "titelfoto", "geloescht"];

export const jetztIso = () => new Date().toISOString();
export const neueId = () => (crypto.randomUUID ? crypto.randomUUID()
  : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""));

export function km(lat1, lon1, lat2, lon2) {
  const r = (g) => (g * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Nächster Platz, in dessen Umkreis die Stelle liegt, sonst null. */
export function platzBei(plaetze, lat, lon) {
  let best = null;
  for (const p of plaetze) {
    const d = km(lat, lon, p.lat, p.lon);
    if (d <= (p.umkreis_km || UMKREIS_KM) && (!best || d < best.d)) best = { p, d };
  }
  return best?.p || null;
}

export function neuerPlatz({ lat, lon, name = "", land = "", besuche = [] }) {
  const t = jetztIso();
  const p = { id: neueId(), name, land, lat, lon, umkreis_km: UMKREIS_KM, art: "", preis: null, bewertung: 0, notiz: "",
    ...Object.fromEntries(AUSSTATTUNG_KEYS.map((k) => [k, false])), aktivitaeten: [], gepflegt: false, titelfoto: null, geloescht: null,
    besuche, angelegt: t };
  p.zeiten = Object.fromEntries(FELDER.map((k) => [k, t]));
  return p;
}

/** Felder setzen und nur bei echten Änderungen den Zeitpunkt merken. */
export function setzen(p, werte) {
  const t = jetztIso();
  for (const [k, w] of Object.entries(werte)) {
    if (!FELDER.includes(k) || JSON.stringify(p[k]) === JSON.stringify(w)) continue;
    p[k] = w;
    p.zeiten[k] = t;
  }
  return p;
}

// ---------------------------------------------------------------- Tage (immer Ortszeit, nie über UTC)

const zwei = (n) => String(n).padStart(2, "0");
export const tagVon = (d) => `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`;
export const lokal = (d) => `${tagVon(d)}T${zwei(d.getHours())}:${zwei(d.getMinutes())}`;
const tagPlus = (tag, n) => { const d = new Date(`${tag}T12:00`); d.setDate(d.getDate() + n); return tagVon(d); };

/** Abende, deren Nacht der Besuch umfasst. Offener Besuch: eine Nacht zählt erst ab 9 Uhr am Morgen danach. */
export function kalendernaechte(b, jetzt = new Date()) {
  const bis = b.abfahrt ? b.abfahrt.slice(0, 10) : tagVon(new Date(jetzt.getTime() - 9 * 3600e3));
  const liste = [];
  for (let t = b.ankunft.slice(0, 10); t < bis && liste.length < 1000; t = tagPlus(t, 1)) liste.push(t);
  return liste;
}

export function neuerBesuch({ ankunft, abfahrt = null, ganztags = false }) {
  return { id: neueId(), ankunft, abfahrt, ganztags, naechte: {}, t: jetztIso(), weg: false };
}

/** Platz aus der Datenbank → Platz für die Oberfläche (Kennzahlen, Navigation, Fotos). */
export function aufbereiten(p, fotos) {
  const besuche = p.besuche.filter((b) => !b.weg).sort((a, b) => a.ankunft.localeCompare(b.ankunft));
  const liste = besuche.map((b) => {
    const naechte = kalendernaechte(b).map((n) => ({ nacht: n, art: b.naechte[n] === "aussen" ? "aussen" : "im" }));
    return { id: b.id, ankunft: b.ankunft, abfahrt: b.abfahrt, ganztags: b.ganztags, naechte_liste: naechte,
      naechte: naechte.filter((n) => n.art === "im").length, geparkt: naechte.filter((n) => n.art === "aussen").length };
  });
  const summe = (k) => liste.reduce((s, b) => s + b[k], 0);
  const k = `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
  const eigene = fotos.filter((f) => f.platz === p.id).sort((a, b) => (a.aufnahme || "").localeCompare(b.aufnahme || "") || a.id.localeCompare(b.id));
  const titel = eigene.find((f) => f.id === p.titelfoto) || eigene[0];
  return { ...p, name: p.name || "Ohne Namen", besuche_liste: liste, besuche: liste.length, naechte: summe("naechte"), geparkt: summe("geparkt"),
    letzter_besuch: liste.at(-1)?.ankunft || null, vorgemerkt: !liste.length,
    koordinaten: k.replace(",", ", "), google: `https://www.google.com/maps/dir/?api=1&destination=${k}`, apple: `https://maps.apple.com/?daddr=${k}`,
    fotoliste: eigene.map((f) => ({ name: f.id, foto: `${f.id}|g`, vorschau: `${f.id}|v` })), fotos: eigene.length,
    titelfoto: titel?.id || null, titelbild: titel ? `${titel.id}|v` : null };
}

/** Zwei Stände desselben Platzes: je Feld und je Besuch gewinnt die letzte Änderung. */
export function zusammenfuehren(a, b) {
  const p = { ...a, zeiten: { ...a.zeiten } };
  for (const k of FELDER) {
    if ((b.zeiten[k] || "") <= (a.zeiten[k] || "")) continue;
    p[k] = b[k];
    p.zeiten[k] = b.zeiten[k];
  }
  const besuche = new Map(a.besuche.map((x) => [x.id, x]));
  for (const x of b.besuche) if (!besuche.has(x.id) || x.t > besuche.get(x.id).t) besuche.set(x.id, x);
  p.besuche = [...besuche.values()];
  return p;
}

// ---------------------------------------------------------------- Eingaben lesen

export const gueltigeKoordinaten = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 85 && Math.abs(lon) <= 180;

/** Koordinaten aus freiem Text oder Karten-Link: Dezimalgrad, Grad/Minuten/Sekunden, Google, Apple, OSM, geo:. Sonst null. */
export function koordinatenLesen(text) {
  let s = String(text).trim();
  try { s = decodeURIComponent(s); } catch (e) { /* kein Link */ }
  const fertig = (a, b) => (gueltigeKoordinaten(a, b) ? { lat: a, lon: b } : null);
  const zahl = "(-?\\d{1,3}\\.\\d+)";
  // Reihenfolge: der genaue Punkt (!3d…!4d…) vor der Kartenmitte (@…)
  for (const m of [`!3d${zahl}!4d${zahl}`, `[?&](?:q|query|destination|daddr|ll|sll|center|coordinate)=(?:loc:)?${zahl},\\s*\\+?${zahl}`, `mlat=${zahl}&mlon=${zahl}`,
    `@${zahl},${zahl}`, `#map=\\d+(?:\\.\\d+)?/${zahl}/${zahl}`, `^geo:${zahl},${zahl}`]) {
    const t = s.match(new RegExp(m));
    if (t) return fertig(Number(t[1]), Number(t[2]));
  }
  const gms = [...s.matchAll(/(\d{1,3})\s*°\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*['′’]\s*)?(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:["″”]|'')\s*)?([NSEWO])/gi)];
  if (gms.length === 2) {
    const w = gms.map((g) => ({ r: g[4].toUpperCase(), v: Number(g[1]) + Number((g[2] || "0").replace(",", ".")) / 60 + Number((g[3] || "0").replace(",", ".")) / 3600 }));
    const lat = w.find((x) => "NS".includes(x.r)), lon = w.find((x) => "EWO".includes(x.r));
    return lat && lon ? fertig(lat.r === "S" ? -lat.v : lat.v, lon.r === "W" ? -lon.v : lon.v) : null;
  }
  // „47.6553, 11.3610“, „47,6553 11,3610“, „47.6553 N, 11.3610 E“
  const d = s.match(/^\(?\s*(-?\d{1,2}[.,]\d+)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d{1,3}[.,]\d+)\s*°?\s*([EWO])?\s*\)?$/i);
  if (!d) return null;
  const n = (x, r, minus) => Number(x.replace(",", ".")) * (r && r.toUpperCase() === minus ? -1 : 1);
  return fertig(n(d[1], d[2], "S"), n(d[3], d[4], "W"));
}

// ---------------------------------------------------------------- Fremde Daten prüfen (Backup, Import)

const istId = (x) => typeof x === "string" && /^[A-Za-z0-9:_-]{1,64}$/.test(x);
const ZEIT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const text = (x, max) => (typeof x === "string" ? x.replace(/[\u0000-\u0008\u000b-\u001f]/g, "").slice(0, max) : "");
const zeitpunkt = (x) => (typeof x === "string" && ZEIT.test(x) && !Number.isNaN(Date.parse(x)) ? x.slice(0, 32) : null);
const zahl = (x, min, max, sonst) => (typeof x === "number" && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : sonst);

/** Platz aus fremder Datei: nur bekannte Felder mit passendem Typ. null = unbrauchbar. */
export function platzPruefen(x) {
  if (!x || typeof x !== "object" || !istId(x.id) || !gueltigeKoordinaten(x.lat, x.lon)) return null;
  const t0 = zeitpunkt(x.angelegt) || jetztIso();
  const p = { id: x.id, name: text(x.name, 100), land: text(x.land, 3), lat: x.lat, lon: x.lon, umkreis_km: zahl(x.umkreis_km, 0.05, 20, UMKREIS_KM),
    art: ARTEN_NAMEN.includes(x.art) ? x.art : "", preis: zahl(x.preis, 0, PREIS_MAX, null), bewertung: Math.round(zahl(x.bewertung, 0, 5, 0)),
    notiz: text(x.notiz, 20000), ...Object.fromEntries(AUSSTATTUNG_KEYS.map((k) => [k, x[k] === true])),
    aktivitaeten: AKTIVITAET_KEYS.filter((k) => Array.isArray(x.aktivitaeten) && x.aktivitaeten.includes(k)), gepflegt: x.gepflegt === true,
    titelfoto: istId(x.titelfoto) ? x.titelfoto : null, geloescht: zeitpunkt(x.geloescht), angelegt: t0,
    zeiten: Object.fromEntries(FELDER.map((k) => [k, zeitpunkt(x.zeiten?.[k]) || t0])), besuche: [] };
  for (const b of Array.isArray(x.besuche) ? x.besuche.slice(0, 5000) : []) {
    const ankunft = zeitpunkt(b?.ankunft), abfahrt = zeitpunkt(b?.abfahrt);
    if (!ankunft || !istId(b.id)) continue;
    p.besuche.push({ id: b.id, ankunft, abfahrt: abfahrt && abfahrt >= ankunft ? abfahrt : null, ganztags: b.ganztags === true, t: zeitpunkt(b.t) || t0, weg: b.weg === true,
      naechte: Object.fromEntries(Object.entries(b.naechte && typeof b.naechte === "object" ? b.naechte : {}).filter(([n, w]) => /^\d{4}-\d{2}-\d{2}$/.test(n) && w === "aussen").slice(0, 1000)) });
  }
  return p;
}

/** Foto aus fremder Datei. Mit „geloescht“ ist es ein Vermerk (Foto wurde gelöscht, keine Bilddateien). */
export function fotoPruefen(x) {
  if (!x || typeof x !== "object" || !istId(x.id) || !istId(x.platz)) return null;
  const geloescht = zeitpunkt(x.geloescht);
  if (geloescht) return { id: x.id, platz: x.platz, geloescht };
  return { id: x.id, platz: x.platz, aufnahme: zeitpunkt(x.aufnahme), breite: zahl(x.breite, 1, 20000, 0), hoehe: zahl(x.hoehe, 1, 20000, 0), angelegt: zeitpunkt(x.angelegt) || jetztIso() };
}

/** Vermerk „Platz endgültig entfernt“ aus fremder Datei: { id, zeit } oder null. */
export function vermerkPruefen(x) {
  return x && typeof x === "object" && istId(x.id) && zeitpunkt(x.zeit) ? { id: x.id, zeit: zeitpunkt(x.zeit) } : null;
}

/** Jüngste Änderung an einem Platz (Felder, Besuche, Anlage) als ISO-Zeitpunkt. */
export function letzteAenderung(p) {
  return [p.angelegt || "", ...Object.values(p.zeiten || {}), ...(p.besuche || []).map((b) => b.t || "")].reduce((a, b) => (b > a ? b : a), "");
}
