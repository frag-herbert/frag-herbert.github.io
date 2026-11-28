/*
 * Datenschicht: liest und schreibt die lokale Datenbank (speicher.js) und liefert der Oberfläche fertige Plätze (plaetze.js).
 * Im Bestand „ha“ (Kopie aus Home Assistant, nur lesen) kommen fehlende Bilder bei Bedarf aus HA (ha.js).
 */
import { speicher, BESTAND } from "./speicher.js?v=12";
import { ha } from "./ha.js?v=12";
import { aufbereiten, neuerBesuch, neuerPlatz, neueId, platzBei, setzen, jetztIso, lokal, PAPIERKORB_TAGE } from "./plaetze.js?v=12";

export const APP_URL = new URL("./", location.href).href.split(/[?#]/)[0];
export const SPEICHER = { ansicht: "herbert-ansicht", hinweise: "herbert-hinweise" };
export const lesen = (k, vorgabe) => { try { return JSON.parse(localStorage.getItem(k)) ?? vorgabe; } catch (e) { return vorgabe; } };
export const schreiben = (k, w) => { try { localStorage.setItem(k, JSON.stringify(w)); } catch (e) { /* voll oder gesperrt */ } };

const GROSS_PX = 1600, VORSCHAU_PX = 800;
const POSITION_GENAU_M = 200;
const adressen = new Map(); // Bildschlüssel → Promise<blob:-Adresse>

export const quelle = {
  async daten() {
    const { plaetze, fotos } = await speicher.alles();
    const grenze = new Date(Date.now() - PAPIERKORB_TAGE * 864e5).toISOString();
    // vermerkt: kommt aus alten Backups nicht zurück. Im HA-Bestand räumt HA selbst auf
    if (BESTAND === "lokal") for (const p of plaetze) if (p.geloescht && p.geloescht < grenze) await speicher.platzEntfernen(p.id, true);
    const da = plaetze.filter((p) => !p.geloescht).map((p) => aufbereiten(p, fotos));
    const korb = plaetze.filter((p) => p.geloescht && p.geloescht >= grenze).sort((a, b) => b.geloescht.localeCompare(a.geloescht)).map((p) => ({ id: p.id, name: p.name || "Ohne Namen", geloescht: p.geloescht }));
    if (BESTAND === "ha") return { plaetze: da, papierkorb: [], ha: true, gelesen: await speicher.meta("ha-gelesen"), aenderungen: 0 };
    return { plaetze: da, papierkorb: korb, backup: await speicher.meta("backup"), aenderungen: (await speicher.meta("aenderungen")) || 0 };
  },

  // ------------------------------------------------------------ Plätze
  async anlegen({ lat, lon, besuch }) {
    const p = neuerPlatz({ lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, besuche: besuch ? [neuerBesuch(besuch)] : [] });
    await speicher.platzAnlegen(p);
    return p.id;
  },
  speichern: (id, werte) => speicher.platzAendern(id, (p) => setzen(p, { ...werte, gepflegt: true })),
  feld: (id, werte) => speicher.platzAendern(id, (p) => setzen(p, werte)),
  loeschen: (id) => speicher.platzAendern(id, (p) => setzen(p, { geloescht: jetztIso() })),
  wiederherstellen: (id) => speicher.platzAendern(id, (p) => setzen(p, { geloescht: null })),
  entfernen: (ids) => speicher.plaetzeEntfernen([].concat(ids)),
  bei: (plaetze, lat, lon) => platzBei(plaetze, lat, lon),

  // ------------------------------------------------------------ Import
  /** Kandidaten (import.js) als neue, noch nicht gespeicherte Plätze; geschrieben wird nach dem Abgleich (abgleich.js). */
  kandidatenAlsPlaetze(kandidaten, { besuche, art }) {
    return kandidaten.map((k) => {
      const b = besuche && k.datum ? [neuerBesuch({ ankunft: `${k.datum}T12:00`, abfahrt: `${k.abfahrt || k.datum}T12:00`, ganztags: true })] : [];
      const p = neuerPlatz({ lat: Math.round(k.lat * 1e6) / 1e6, lon: Math.round(k.lon * 1e6) / 1e6, name: k.name, land: k.land, besuche: b });
      return Object.assign(p, { notiz: k.notiz, art: k.art || art, preis: k.preis, bewertung: k.bewertung, gepflegt: !!(k.art || art) }, Object.fromEntries(k.merkmale.map((m) => [m, true])));
    });
  },

  // ------------------------------------------------------------ Besuche
  async besuchAnlegen(id, b) {
    const neu = neuerBesuch(b);
    await speicher.platzAendern(id, (p) => { p.besuche.push(neu); });
    return neu.id;
  },
  besuchAendern: (id, besuch, werte) => speicher.platzAendern(id, (p) => {
    const b = p.besuche.find((x) => x.id === besuch);
    if (!b) throw new Error("Besuch nicht gefunden");
    Object.assign(b, werte, { t: jetztIso() });
  }),
  nachtSetzen: (id, besuch, nacht, art) => speicher.platzAendern(id, (p) => {
    const b = p.besuche.find((x) => x.id === besuch);
    if (!b) throw new Error("Besuch nicht gefunden");
    if (art === "aussen") b.naechte[nacht] = "aussen"; else delete b.naechte[nacht];
    b.t = jetztIso();
  }),

  // ------------------------------------------------------------ Fotos
  /** ohneZeit: ohne EXIF-Zeit bleibt die Aufnahmezeit leer (Bilder aus Importen), sonst Dateidatum. */
  async fotoAnlegen(platz, datei, { ohneZeit = false } = {}) {
    const gross = await verkleinern(datei, GROSS_PX, 0.82), vorschau = await verkleinern(gross.blob, VORSCHAU_PX, 0.8);
    const aufnahme = (await exifLesen(datei)).zeit || (ohneZeit ? null : lokal(new Date(datei.lastModified || Date.now())));
    const id = neueId();
    await speicher.fotoAnlegen({ id, platz, aufnahme, breite: gross.breite, hoehe: gross.hoehe, angelegt: jetztIso() }, gross.blob, vorschau.blob);
    return id;
  },
  /** vermerken: false nur beim Zurücknehmen eines Imports. */
  async fotoEntfernen(id, { vermerken = true } = {}) {
    await speicher.fotoEntfernen(id, vermerken);
    for (const s of [`${id}|g`, `${id}|v`]) { adressen.get(s)?.then((u) => u && URL.revokeObjectURL(u)); adressen.delete(s); }
  },
  /** Adresse für ein gespeichertes Bild ("<Foto-ID>|g" oder "|v") oder null. */
  bild(schluessel) {
    if (!schluessel) return Promise.resolve(null);
    if (!adressen.has(schluessel)) {
      const v = speicher.bild(schluessel).then((b) => b || (BESTAND === "ha" ? ha.bildHolen(schluessel).catch(() => null) : null)).then((b) => (b ? URL.createObjectURL(b) : null));
      adressen.set(schluessel, v);
      v.then((u) => { if (!u) adressen.delete(schluessel); }, () => adressen.delete(schluessel));
    }
    return adressen.get(schluessel);
  },
  /** Nach dem Einspielen eines Backups: alte Adressen freigeben. */
  bilderVergessen() {
    for (const v of adressen.values()) v.then((u) => u && URL.revokeObjectURL(u)).catch(() => {});
    adressen.clear();
  },

  // ------------------------------------------------------------ Standort dieses Geräts
  /** { latitude, longitude, accuracy }; wirft mit verständlichem Text. */
  position() {
    return new Promise((ok, f) => {
      if (!navigator.geolocation || !window.isSecureContext) return f(new Error("Der Standort ist hier nicht verfügbar."));
      navigator.geolocation.getCurrentPosition(
        (p) => (p.coords.accuracy <= POSITION_GENAU_M ? ok(p.coords) : f(new Error(`Der Standort ist zu ungenau (± ${Math.round(p.coords.accuracy)} m).`))),
        (e) => f(new Error(e.code === 1 ? "Der Zugriff auf den Standort ist nicht erlaubt." : "Der Standort wurde nicht gefunden.")),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    });
  },
  /** Ist der Zugriff schon erlaubt? Dann darf die App den Standort ohne Rückfrage holen. */
  async standortErlaubt() {
    try { return (await navigator.permissions.query({ name: "geolocation" })).state === "granted"; } catch (e) { return false; }
  },
};

// ================================================================ Fotos vorbereiten

/** Aufnahmezeit (Ortszeit „JJJJ-MM-TTTHH:MM:SS“) und Ort aus den EXIF-Daten eines JPEG → { zeit, lat, lon }, fehlende Werte null. */
export async function exifLesen(datei) {
  const aus = { zeit: null, lat: null, lon: null };
  try {
    const buf = new DataView(await datei.slice(0, 262144).arrayBuffer());
    if (buf.getUint16(0) !== 0xffd8) return aus;
    let o = 2;
    while (o < buf.byteLength - 4) {
      const marke = buf.getUint16(o), laenge = buf.getUint16(o + 2);
      if (marke === 0xffe1 && buf.getUint32(o + 4) === 0x45786966) {
        const t = o + 10, le = buf.getUint16(t) === 0x4949;
        const u16 = (p) => buf.getUint16(t + p, le), u32 = (p) => buf.getUint32(t + p, le);
        const eintraege = (ifd) => Array.from({ length: u16(ifd) }, (_, i) => ifd + 2 + i * 12);
        const finde = (ifd, nr) => eintraege(ifd).find((e) => u16(e) === nr);
        const kopf = u32(4), exif = finde(kopf, 0x8769), gps = finde(kopf, 0x8825);
        const zeit = exif && finde(u32(exif + 8), 0x9003);
        if (zeit) {
          const p = t + u32(zeit + 8);
          const m = Array.from({ length: 19 }, (_, i) => String.fromCharCode(buf.getUint8(p + i))).join("").match(/^(\d{4}):(\d\d):(\d\d) (\d\d:\d\d:\d\d)$/);
          if (m) aus.zeit = `${m[1]}-${m[2]}-${m[3]}T${m[4]}`;
        }
        if (gps) {
          const ifd = u32(gps + 8);
          const grad = (nr, refNr, minus) => {
            const w = finde(ifd, nr), ref = finde(ifd, refNr);
            if (!w || !ref) return null;
            const p = u32(w + 8), bruch = (i) => u32(p + i * 8) / (u32(p + i * 8 + 4) || 1);
            const g = bruch(0) + bruch(1) / 60 + bruch(2) / 3600;
            return String.fromCharCode(buf.getUint8(t + ref + 8)) === minus ? -g : g;
          };
          aus.lat = grad(2, 1, "S");
          aus.lon = grad(4, 3, "W");
        }
        return aus;
      }
      o += 2 + laenge;
    }
  } catch (e) { /* kein oder beschädigtes EXIF */ }
  return aus;
}

/** Verkleinern (längste Kante px) und als JPEG neu schreiben; dabei fallen EXIF-Angaben samt GPS weg. → { blob, breite, hoehe } */
async function verkleinern(datei, px, guete) {
  let bild, adresse = null;
  try { bild = await createImageBitmap(datei); } catch (e) {
    bild = new Image();
    adresse = URL.createObjectURL(datei);
    bild.src = adresse;
    try { await bild.decode(); } catch (x) { URL.revokeObjectURL(adresse); throw new Error(`„${datei.name || "Foto"}“ ist kein lesbares Bild`); }
  }
  const b = bild.naturalWidth || bild.width, h = bild.naturalHeight || bild.height, f = Math.min(1, px / Math.max(b, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(b * f)); c.height = Math.max(1, Math.round(h * f));
  c.getContext("2d").drawImage(bild, 0, 0, c.width, c.height);
  bild.close?.();
  if (adresse) URL.revokeObjectURL(adresse);
  const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", guete));
  if (!blob) throw new Error("Das Foto konnte nicht verarbeitet werden");
  return { blob, breite: c.width, hoehe: c.height };
}
