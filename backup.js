/*
 * Backup: eine ZIP-Datei mit daten.json, fotos/<ID>.jpg und vorschau/<ID>.jpg. Einspielen ersetzt alles oder führt zusammen.
 * Inhalte aus Backups gelten als fremd (jemand kann sie verschickt haben) und werden Feld für Feld geprüft.
 * Vermerke (KONZEPT-WEBAPP.md 12.8.6): „entfernt“ = endgültig entfernte Plätze { id, zeit }, Fotos mit „geloescht“ = gelöschte Fotos
 * (ohne Bilddateien). Ältere Versionen ignorieren beides.
 */
import { speicher } from "./speicher.js?v=10";
import { zipLesen, zipSchreiben } from "./zip.js?v=10";
import { platzPruefen, fotoPruefen, vermerkPruefen, zusammenfuehren, letzteAenderung, tagVon } from "./plaetze.js?v=10";

const FORMAT = "frag-herbert", FASSUNG = 1;

export const TEIL_MAX = 500e6; // ab dieser Größe in Teile (KONZEPT-WEBAPP.md 12.8.2)

/**
 * Export im Format Fassung 1. ids: gewählte Plätze (null = alle, auch der Papierkorb); mitFotos: Bilder dazu; teilMax: Größe je Datei.
 * Jeder Teil ist ein vollständiger Export (alle gewählten Plätze, nur die Fotos dieses Teils). Vermerke: bei „alle“ alle, bei einer
 * Auswahl nur gelöschte Fotos der gewählten Plätze – eine weitergegebene Auswahl soll beim Empfänger keine Plätze entfernen.
 */
export async function backupErstellen(version, { ids = null, mitFotos = true, teilMax = TEIL_MAX } = {}, fortschritt = () => {}) {
  const stand = (await speicher.meta("aenderungen")) || 0, zeit = new Date();
  const alles = await speicher.alles(), wahl = ids && new Set(ids);
  const plaetze = wahl ? alles.plaetze.filter((p) => wahl.has(p.id) && !p.geloescht) : alles.plaetze;
  const drin = new Set(plaetze.map((p) => p.id));
  const fotos = mitFotos ? alles.fotos.filter((f) => drin.has(f.platz)) : [];
  const teile = [{ eintraege: [], fotos: [], groesse: 0 }];
  let fehlend = 0;
  for (const f of fotos) {
    const [g, v] = [await speicher.bild(`${f.id}|g`), await speicher.bild(`${f.id}|v`)];
    if (!g || !v) { fehlend++; continue; }
    let t = teile.at(-1);
    if (t.fotos.length && t.groesse + g.size + v.size > teilMax) teile.push((t = { eintraege: [], fotos: [], groesse: 0 }));
    t.fotos.push(f);
    t.eintraege.push({ name: `fotos/${f.id}.jpg`, blob: g }, { name: `vorschau/${f.id}.jpg`, blob: v });
    t.groesse += g.size + v.size;
  }
  const v = await speicher.vermerke();
  const fotoVermerke = Object.entries(v.fotos).filter(([, x]) => !wahl || drin.has(x.platz)).map(([id, x]) => ({ id, platz: x.platz, geloescht: x.zeit }));
  const entfernt = wahl ? [] : Object.entries(v.plaetze).map(([id, z]) => ({ id, zeit: z }));
  const name = `frag-herbert${wahl ? "-auswahl" : ""}-${tagVon(zeit)}`;
  const dateien = [];
  let n = 0;
  const gesamt = teile.reduce((s, t) => s + t.eintraege.length + 1, 0);
  for (const [i, t] of teile.entries()) {
    const daten = { format: FORMAT, fassung: FASSUNG, app: version, erstellt: zeit.toISOString(), umfang: wahl ? "auswahl" : "alle", mit_fotos: mitFotos,
      ...(teile.length > 1 ? { teil: i + 1, teile: teile.length } : {}), plaetze, fotos: [...t.fotos, ...fotoVermerke], entfernt };
    const zip = await zipSchreiben([{ name: "daten.json", blob: new Blob([JSON.stringify(daten, null, 1)]) }, ...t.eintraege], (x) => fortschritt(n + x, gesamt));
    n += t.eintraege.length + 1;
    dateien.push(new File([zip], `${name}${teile.length > 1 ? `-teil-${i + 1}-von-${teile.length}` : ""}.zip`, { type: "application/zip" }));
  }
  return { dateien, stand, zeit: zeit.toISOString(), vollstaendig: !wahl && mitFotos, plaetze: plaetze.filter((p) => !p.geloescht).length,
    fotos: fotos.length - fehlend, fehlend, groesse: dateien.reduce((s, d) => s + d.size, 0) };
}

const xml = (t) => String(t ?? "").replace(/[&<>"]/g, (z) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[z])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** KML für andere Programme (Google My Maps, Personal POI, Navis): Name, Ort, auf Wunsch Notiz; keine Fotos, keine Besuche. */
export function kmlErstellen(plaetze, { notiz = true } = {}) {
  const zeit = new Date();
  const orte = plaetze.map((p) => `  <Placemark><name>${xml(p.name || "Ohne Namen")}</name>${notiz && p.notiz ? `<description>${xml(p.notiz)}</description>` : ""}<Point><coordinates>${p.lon},${p.lat}</coordinates></Point></Placemark>`);
  const text = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n  <name>Frag Herbert ${tagVon(zeit)}</name>\n${orte.join("\n")}\n</Document>\n</kml>\n`;
  return new File([text], `frag-herbert-${tagVon(zeit)}.kml`, { type: "application/vnd.google-earth.kml+xml" });
}

/** Datei lesen und prüfen, noch nichts schreiben. */
export async function backupLesen(datei) {
  const zip = await zipLesen(datei);
  // Am Mac neu gepackt liegt alles in einem Unterordner
  const haupt = [...zip.keys()].find((n) => /^([^/]+\/)?daten\.json$/.test(n));
  if (!haupt) throw new Error("Das ist kein Backup von Frag Herbert");
  let d;
  try { d = JSON.parse(new TextDecoder().decode(await zip.get(haupt)())); } catch (e) { throw new Error("Das Backup ist beschädigt"); }
  if (d?.format !== FORMAT || !Array.isArray(d.plaetze)) throw new Error("Das ist kein Backup von Frag Herbert");
  if (!(d.fassung <= FASSUNG)) throw new Error("Das Backup stammt aus einer neueren Version. Bitte zuerst die App aktualisieren.");
  const ordner = haupt.slice(0, -"daten.json".length), eindeutig = (l) => [...new Map(l.filter(Boolean).map((x) => [x.id, x])).values()];
  const plaetze = eindeutig(d.plaetze.map(platzPruefen)), ids = new Set(plaetze.map((p) => p.id));
  const alleFotos = eindeutig((Array.isArray(d.fotos) ? d.fotos.slice(0, 100000) : []).map(fotoPruefen));
  const fotoVermerke = alleFotos.filter((f) => f.geloescht);
  const fotos = alleFotos.filter((f) => !f.geloescht && ids.has(f.platz) && zip.has(`${ordner}fotos/${f.id}.jpg`) && zip.has(`${ordner}vorschau/${f.id}.jpg`));
  const entfernt = eindeutig((Array.isArray(d.entfernt) ? d.entfernt.slice(0, 100000) : []).map(vermerkPruefen));
  return { zip, ordner, plaetze, fotos, fotoVermerke, entfernt, erstellt: typeof d.erstellt === "string" ? d.erstellt : null, sichtbar: plaetze.filter((p) => !p.geloescht).length,
    verworfen: d.plaetze.length - plaetze.length + ((d.fotos?.length || 0) - fotos.length - fotoVermerke.length) };
}

export async function backupEinspielen(b, ersetzen, fortschritt = () => {}) {
  const bilder = new Map();
  let n = 0;
  // Alle Bilder vor der Transaktion lesen: IndexedDB wartet nicht auf andere Arbeit, und ein kaputtes ZIP darf nichts verändern
  for (const f of b.fotos) {
    for (const [art, ordner] of [["g", "fotos"], ["v", "vorschau"]]) {
      const daten = await b.zip.get(`${b.ordner}${ordner}/${f.id}.jpg`)();
      if (daten[0] !== 0xff || daten[1] !== 0xd8) throw new Error("Das Backup enthält ein ungültiges Foto");
      bilder.set(`${f.id}|${art}`, daten.slice().buffer);
    }
    fortschritt(++n, b.fotos.length);
  }
  return speicher.einspielen({ plaetze: b.plaetze, fotos: b.fotos, bilder, ersetzen, zusammenfuehren, letzteAenderung, entfernt: b.entfernt, fotoVermerke: b.fotoVermerke });
}

/**
 * Ergebnis der Vorschau übernehmen. ergebnisse: [{ von: ID in der Datei, platz, fotoZiel, vermerkWeg }] (abgleich.js aufloesen);
 * nur deren Fotos werden gelesen und dem Zielplatz zugeordnet. entfernen=false: Vermerke „entfernt“ aus der Datei nicht anwenden.
 */
export async function backupUebernehmen(b, ergebnisse, { entfernen = true } = {}, fortschritt = () => {}) {
  const ziel = new Map(ergebnisse.map((r) => [r.von, r.fotoZiel]));
  const fotos = b.fotos.filter((f) => ziel.has(f.platz)).map((f) => ({ ...f, platz: ziel.get(f.platz) }));
  const bilder = new Map();
  let n = 0;
  for (const f of fotos) {
    for (const [art, ordner] of [["g", "fotos"], ["v", "vorschau"]]) {
      const daten = await b.zip.get(`${b.ordner}${ordner}/${f.id}.jpg`)();
      if (daten[0] !== 0xff || daten[1] !== 0xd8) throw new Error("Das Backup enthält ein ungültiges Foto");
      bilder.set(`${f.id}|${art}`, daten.slice().buffer);
    }
    fortschritt(++n, fotos.length);
  }
  return speicher.uebernehmen({ schreiben: ergebnisse.map((r) => r.platz), fotos, bilder, vermerkeWeg: ergebnisse.filter((r) => r.vermerkWeg).map((r) => r.platz.id),
    entfernt: entfernen ? b.entfernt : [], fotoVermerke: entfernen ? b.fotoVermerke : [], letzteAenderung });
}
