/*
 * Lokale Datenbank (IndexedDB). Speicher:
 *   plaetze  Platz mit Besuchen (Schlüssel id); Felder siehe plaetze.js
 *   fotos    Angaben je Foto { id, platz, aufnahme, breite, hoehe, angelegt }
 *   bilder   Bilddaten (JPEG), Schlüssel "<Foto-ID>|g" (groß) und "<Foto-ID>|v" (Vorschau) → ArrayBuffer. Kein Blob: den nimmt
 *            WebKit in flüchtigen Sitzungen (privater Modus) nicht an
 *   meta     einzelne Werte (letztes Backup, Zahl der Änderungen seitdem, Vermerke „grabsteine“)
 * Vermerke: { plaetze: { ID: Zeitpunkt }, fotos: { ID: { zeit, platz } } } für endgültig entfernte Plätze und gelöschte Fotos.
 * Damit holt ein älteres Backup sie nicht zurück (KONZEPT-WEBAPP.md 12.8). Rücknahmen (Import, leerer neuer Platz) vermerken nichts.
 * Jede Änderung läuft in einer Transaktion und zählt die Änderungen seit dem letzten Backup mit.
 */
/*
 * Zwei Bestände in getrennten Datenbanken (KONZEPT-WEBAPP.md 12.2.1): „lokal“ (Vorgabe) und „ha“ = Kopie des Stands aus Home Assistant.
 * Der HA-Bestand ist in Stufe 1 nur zum Lesen: schreibend() lehnt ab, nur haUebernehmen() und bildMerken() schreiben dort.
 * Gewählt wird vor dem Laden (localStorage); umschalten = Seite neu laden.
 */
export const BESTAND = (() => { try { return localStorage.getItem("herbert-bestand") === "ha" ? "ha" : "lokal"; } catch (e) { return "lokal"; } })();
export const NUR_LESEN = "Die Plätze aus Home Assistant werden in der Camper-App bearbeitet.";
const NAME = BESTAND === "ha" ? "frag-herbert-ha" : "frag-herbert", FASSUNG = 1;
const kanal = "BroadcastChannel" in window ? new BroadcastChannel(NAME) : null;
let dbVersprechen = null;

const warten = (anfrage) => new Promise((ok, f) => { anfrage.onsuccess = () => ok(anfrage.result); anfrage.onerror = () => f(anfrage.error); });

function oeffnen() {
  dbVersprechen ||= new Promise((ok, f) => {
    const a = indexedDB.open(NAME, FASSUNG);
    // Schrittweise je Fassung: eine Datenbank aus jeder früheren Version muss sich öffnen lassen (README, „Datenformat“).
    // Neue Fassung: FASSUNG erhöhen und hier einen Schritt `if (e.oldVersion < N)` anhängen, nie einen bestehenden ändern.
    a.onupgradeneeded = (e) => {
      const db = a.result;
      if (e.oldVersion < 1) {
        db.createObjectStore("plaetze", { keyPath: "id" });
        db.createObjectStore("fotos", { keyPath: "id" }).createIndex("platz", "platz");
        db.createObjectStore("bilder");
        db.createObjectStore("meta");
      }
    };
    a.onblocked = () => f(new Error("Die Datenbank ist in einem anderen Fenster offen. Bitte dort schließen."));
    a.onerror = () => f(a.error?.name === "VersionError" ? new Error("Deine Daten stammen aus einer neueren Version. Bitte die App neu laden.") : a.error);
    a.onsuccess = () => {
      a.result.onversionchange = () => { a.result.close(); dbVersprechen = null; };
      // iOS beendet die Verbindung im Hintergrund gelegentlich: beim nächsten Zugriff neu öffnen
      a.result.onclose = () => (dbVersprechen = null);
      ok(a.result);
    };
  });
  dbVersprechen.catch(() => (dbVersprechen = null));
  return dbVersprechen;
}

/** fn(stores) läuft synchron bis zum ersten await auf IndexedDB-Anfragen; Ergebnis erst nach Abschluss der Transaktion. */
async function transaktion(namen, modus, fn, zweiterVersuch = false) {
  let t;
  try { t = (await oeffnen()).transaction(namen, modus); } catch (e) {
    if (zweiterVersuch || e.name !== "InvalidStateError") throw e;
    dbVersprechen = null;
    return transaktion(namen, modus, fn, true);
  }
  const fertig = new Promise((ok, f) => {
    t.oncomplete = () => ok();
    t.onabort = () => f(t.error?.name === "QuotaExceededError" ? new Error("Der Speicher auf diesem Gerät ist voll.") : t.error || new Error("Speichern abgebrochen"));
  });
  let ergebnis;
  try {
    ergebnis = await fn(Object.fromEntries(namen.map((n) => [n, t.objectStore(n)])));
  } catch (e) {
    try { t.abort(); } catch (x) { /* schon beendet */ }
    fertig.catch(() => {});
    throw e;
  }
  await fertig;
  return ergebnis;
}

const zaehlen = async (meta) => meta.put(((await warten(meta.get("aenderungen"))) || 0) + 1, "aenderungen");
const vermerkeLesen = async (meta) => ({ plaetze: {}, fotos: {}, ...((await warten(meta.get("grabsteine"))) || {}) });
const jetzt = () => new Date().toISOString();

/** Schreiben mit Zähler und Meldung an andere Fenster. */
async function schreibend(namen, fn) {
  if (BESTAND === "ha") throw new Error(NUR_LESEN);
  const r = await transaktion([...new Set([...namen, "meta"])], "readwrite", async (s) => {
    const e = await fn(s);
    await zaehlen(s.meta);
    return e;
  });
  kanal?.postMessage("geaendert");
  return r;
}

export const speicher = {
  beiAenderung(fn) { if (kanal) kanal.onmessage = fn; },

  alles: () => transaktion(["plaetze", "fotos"], "readonly", async (s) => {
    const [plaetze, fotos] = await Promise.all([warten(s.plaetze.getAll()), warten(s.fotos.getAll())]);
    return { plaetze, fotos };
  }),
  platz: (id) => transaktion(["plaetze"], "readonly", (s) => warten(s.plaetze.get(id))),
  async bild(schluessel) {
    const daten = await transaktion(["bilder"], "readonly", (s) => warten(s.bilder.get(schluessel)));
    return daten ? new Blob([daten], { type: "image/jpeg" }) : null;
  },

  /** Platz lesen, mit fn ändern (darf ihn auch ersetzen) und schreiben – in einer Transaktion, damit nichts verloren geht. */
  platzAendern: (id, fn) => schreibend(["plaetze"], async (s) => {
    const alt = await warten(s.plaetze.get(id));
    if (!alt) throw new Error("Stellplatz nicht gefunden");
    const neu = fn(alt) || alt;
    await warten(s.plaetze.put(neu));
    return neu;
  }),
  platzAnlegen: (p) => schreibend(["plaetze"], (s) => warten(s.plaetze.add(p))),
  plaetzeAnlegen: (liste) => schreibend(["plaetze"], (s) => Promise.all(liste.map((p) => warten(s.plaetze.add(p))))),

  /** Platz samt Fotos endgültig entfernen; vermerken = nicht nur zurücknehmen, sondern als entfernt merken. */
  platzEntfernen(id, vermerken = false) { return this.plaetzeEntfernen([id], vermerken); },
  plaetzeEntfernen: (liste, vermerken = false) => schreibend(["plaetze", "fotos", "bilder"], async (s) => {
    const v = vermerken ? await vermerkeLesen(s.meta) : null, t = jetzt();
    for (const id of liste) {
      const ids = await warten(s.fotos.index("platz").getAllKeys(id));
      s.plaetze.delete(id);
      for (const f of ids) { s.fotos.delete(f); s.bilder.delete(`${f}|g`); s.bilder.delete(`${f}|v`); if (v) v.fotos[f] = { zeit: t, platz: id }; }
      if (v) v.plaetze[id] = t;
    }
    if (v) await warten(s.meta.put(v, "grabsteine"));
  }),

  async fotoAnlegen(foto, gross, vorschau) {
    const [g, v] = await Promise.all([gross.arrayBuffer(), vorschau.arrayBuffer()]); // vor der Transaktion: sie wartet nicht auf andere Arbeit
    return schreibend(["fotos", "bilder"], async (s) => {
      s.bilder.put(g, `${foto.id}|g`);
      s.bilder.put(v, `${foto.id}|v`);
      await warten(s.fotos.add(foto));
    });
  },
  fotoEntfernen: (id, vermerken = false) => schreibend(["fotos", "bilder"], async (s) => {
    const f = vermerken ? await warten(s.fotos.get(id)) : null;
    s.bilder.delete(`${id}|g`);
    s.bilder.delete(`${id}|v`);
    await warten(s.fotos.delete(id));
    if (f) {
      const v = await vermerkeLesen(s.meta);
      v.fotos[id] = { zeit: jetzt(), platz: f.platz };
      await warten(s.meta.put(v, "grabsteine"));
    }
  }),
  vermerke: () => transaktion(["meta"], "readonly", (s) => vermerkeLesen(s.meta)),

  /**
   * Backup einspielen. Alles ist schon geprüft; ersetzen = vorher alles leeren (auch die Vermerke). Alles oder nichts.
   * entfernt/fotoVermerke: Vermerke aus dem Backup. Ein mitgebrachter Vermerk entfernt den Platz hier, außer er wurde danach noch geändert.
   * Vermerkte Plätze und Fotos aus dem Backup werden übersprungen. → Zahlen für die Meldung.
   */
  einspielen: ({ plaetze, fotos, bilder, ersetzen, zusammenfuehren, letzteAenderung, entfernt = [], fotoVermerke = [] }) => schreibend(["plaetze", "fotos", "bilder"], async (s) => {
    const v = ersetzen ? { plaetze: {}, fotos: {} } : await vermerkeLesen(s.meta);
    if (ersetzen) { s.plaetze.clear(); s.fotos.clear(); s.bilder.clear(); }
    const alt = new Map((ersetzen ? [] : await warten(s.plaetze.getAll())).map((p) => [p.id, p]));
    const bekannt = new Set(ersetzen ? [] : await warten(s.fotos.getAllKeys()));
    const z = { uebersprungen: 0, fotosUebersprungen: 0, entfernt: 0, fotosEntfernt: 0, behalten: 0 };
    const fotoWeg = (id) => { s.fotos.delete(id); s.bilder.delete(`${id}|g`); s.bilder.delete(`${id}|v`); bekannt.delete(id); };
    for (const e of entfernt) {
      const da = alt.get(e.id);
      if (da && letzteAenderung(da) > e.zeit) { z.behalten++; continue; } // nach dem Entfernen anderswo hier geändert: bleibt
      if (da) {
        for (const f of await warten(s.fotos.index("platz").getAllKeys(e.id))) { fotoWeg(f); v.fotos[f] ||= { zeit: e.zeit, platz: e.id }; }
        s.plaetze.delete(e.id);
        alt.delete(e.id);
        z.entfernt++;
      }
      if (!(v.plaetze[e.id] >= e.zeit)) v.plaetze[e.id] = e.zeit;
    }
    for (const f of fotoVermerke) {
      if (bekannt.has(f.id)) { fotoWeg(f.id); z.fotosEntfernt++; }
      v.fotos[f.id] ||= { zeit: f.geloescht, platz: f.platz };
    }
    for (const p of plaetze) {
      if (v.plaetze[p.id]) { z.uebersprungen++; continue; }
      s.plaetze.put(alt.has(p.id) ? zusammenfuehren(alt.get(p.id), p) : p);
    }
    for (const f of fotos) {
      if (bekannt.has(f.id)) continue;
      if (v.fotos[f.id] || v.plaetze[f.platz]) { z.fotosUebersprungen++; continue; }
      s.fotos.put(f);
      s.bilder.put(bilder.get(`${f.id}|g`), `${f.id}|g`);
      s.bilder.put(bilder.get(`${f.id}|v`), `${f.id}|v`);
    }
    await warten(s.meta.put(v, "grabsteine"));
    return z;
  }),

  /**
   * Ergebnis der Import-Vorschau übernehmen (abgleich.js), alles oder nichts. schreiben: fertige Plätze; fotos: schon dem Zielplatz
   * zugeordnet; vermerkeWeg: wieder angelegte Plätze; entfernt/fotoVermerke: Vermerke aus der Datei (wie bei einspielen).
   * → { z: Zahlen, rueck: Stand vorher } für zuruecknehmen().
   */
  uebernehmen: ({ schreiben, fotos = [], bilder = new Map(), vermerkeWeg = [], entfernt = [], fotoVermerke = [], letzteAenderung }) =>
    schreibend(["plaetze", "fotos", "bilder"], async (s) => {
      const v = await vermerkeLesen(s.meta);
      const rueck = { plaetze: new Map(), fotosNeu: [], fotosWeg: [], vermerke: JSON.parse(JSON.stringify(v)) };
      const alt = new Map((await warten(s.plaetze.getAll())).map((p) => [p.id, p]));
      const bekannt = new Set(await warten(s.fotos.getAllKeys()));
      const z = { neu: 0, aktualisiert: 0, entfernt: 0, fotosEntfernt: 0, behalten: 0, fotos: 0, fotosUebersprungen: 0 };
      const fotoWeg = async (id) => {
        const f = await warten(s.fotos.get(id));
        if (!f) return;
        rueck.fotosWeg.push({ f, g: await warten(s.bilder.get(`${id}|g`)), v: await warten(s.bilder.get(`${id}|v`)) });
        s.fotos.delete(id); s.bilder.delete(`${id}|g`); s.bilder.delete(`${id}|v`); bekannt.delete(id);
      };
      for (const id of vermerkeWeg) delete v.plaetze[id];
      for (const e of entfernt) {
        const da = alt.get(e.id);
        if (da && letzteAenderung(da) > e.zeit) { z.behalten++; continue; }
        if (da) {
          for (const f of await warten(s.fotos.index("platz").getAllKeys(e.id))) { await fotoWeg(f); v.fotos[f] ||= { zeit: e.zeit, platz: e.id }; }
          if (!rueck.plaetze.has(e.id)) rueck.plaetze.set(e.id, da);
          s.plaetze.delete(e.id);
          alt.delete(e.id);
          z.entfernt++;
        }
        if (!(v.plaetze[e.id] >= e.zeit)) v.plaetze[e.id] = e.zeit;
      }
      for (const f of fotoVermerke) {
        if (bekannt.has(f.id)) { await fotoWeg(f.id); z.fotosEntfernt++; }
        v.fotos[f.id] ||= { zeit: f.geloescht, platz: f.platz };
      }
      for (const p of schreiben) {
        if (v.plaetze[p.id]) continue; // in derselben Datei als entfernt vermerkt
        if (!rueck.plaetze.has(p.id)) rueck.plaetze.set(p.id, alt.get(p.id) || null);
        z[alt.has(p.id) ? "aktualisiert" : "neu"]++;
        s.plaetze.put(p);
      }
      for (const f of fotos) {
        if (bekannt.has(f.id)) continue;
        if (v.fotos[f.id] || v.plaetze[f.platz]) { z.fotosUebersprungen++; continue; }
        s.fotos.put(f);
        s.bilder.put(bilder.get(`${f.id}|g`), `${f.id}|g`);
        s.bilder.put(bilder.get(`${f.id}|v`), `${f.id}|v`);
        rueck.fotosNeu.push(f.id);
        z.fotos++;
      }
      await warten(s.meta.put(v, "grabsteine"));
      return { z, rueck };
    }),

  /** Übernahme zurücknehmen: Plätze, Fotos und Vermerke wie vorher. */
  zuruecknehmen: (rueck) => schreibend(["plaetze", "fotos", "bilder"], async (s) => {
    for (const id of rueck.fotosNeu) { s.fotos.delete(id); s.bilder.delete(`${id}|g`); s.bilder.delete(`${id}|v`); }
    for (const [id, p] of rueck.plaetze) { if (p) s.plaetze.put(p); else s.plaetze.delete(id); }
    for (const { f, g, v } of rueck.fotosWeg) { s.fotos.put(f); if (g) s.bilder.put(g, `${f.id}|g`); if (v) s.bilder.put(v, `${f.id}|v`); }
    await warten(s.meta.put(rueck.vermerke, "grabsteine"));
  }),

  /**
   * Stand aus HA übernehmen (nur im HA-Bestand): Plätze und Fotos ganz ersetzen; schon geholte Bilder bleiben, solange es das Foto noch gibt.
   * Kein Änderungszähler (keine eigenen Änderungen, nichts zu sichern).
   */
  async haUebernehmen({ plaetze, fotos, gelesen, ganz = true, entfernt = [], kennung = null, stand = null }) {
    if (BESTAND !== "ha") throw new Error("Nur im Bestand aus Home Assistant");
    await transaktion(["plaetze", "fotos", "bilder", "meta"], "readwrite", async (s) => {
      // Die Fotoliste kommt immer ganz (auch bei „Änderungen seit Stand N“), Plätze nur bei ganz
      const bleiben = new Set(fotos.map((f) => f.id));
      for (const k of await warten(s.bilder.getAllKeys())) if (!bleiben.has(String(k).split("|")[0])) s.bilder.delete(k);
      if (ganz) s.plaetze.clear();
      for (const id of entfernt) s.plaetze.delete(id);
      s.fotos.clear();
      for (const p of plaetze) s.plaetze.put(p);
      for (const f of fotos) s.fotos.put(f);
      s.meta.put(gelesen, "ha-gelesen");
      await warten(s.meta.put({ kennung, stand }, "ha-stand"));
    });
    kanal?.postMessage("geaendert");
  },
  /** Aus HA geholtes Bild ablegen (Zwischenspeicher für offline). */
  bildMerken: (schluessel, daten) => transaktion(["bilder"], "readwrite", (s) => warten(s.bilder.put(daten, schluessel))),

  /** Plätze (ohne Papierkorb) und Fotos je Bestand, ohne eine Datenbank anzulegen: { lokal, ha } mit { plaetze, fotos } oder null. */
  async bestaende() {
    const da = new Set((await indexedDB.databases?.().catch(() => null) || [{ name: "frag-herbert" }, { name: "frag-herbert-ha" }]).map((d) => d.name));
    const zaehlen = (name) => new Promise((ok) => {
      if (!da.has(name)) return ok(null);
      const a = indexedDB.open(name);
      a.onerror = () => ok(null);
      a.onsuccess = () => {
        const db = a.result;
        try {
          const t = db.transaction(["plaetze", "fotos"], "readonly"), e = {};
          t.objectStore("plaetze").getAll().onsuccess = (x) => (e.plaetze = x.target.result.filter((p) => !p.geloescht).length);
          t.objectStore("fotos").count().onsuccess = (x) => (e.fotos = x.target.result);
          t.oncomplete = () => { db.close(); ok(e); };
          t.onabort = () => { db.close(); ok(null); };
        } catch (x) { db.close(); ok(null); }
      };
    });
    return { lokal: await zaehlen("frag-herbert"), ha: await zaehlen("frag-herbert-ha") };
  },

  /** Beide Datenbanken löschen. Andere Fenster schließen ihre Verbindung von selbst (onversionchange). */
  async allesLoeschen() {
    if (dbVersprechen) { try { (await dbVersprechen).close(); } catch (e) { /* war nicht offen */ } dbVersprechen = null; }
    for (const name of ["frag-herbert", "frag-herbert-ha"]) {
      await new Promise((ok, f) => {
        const a = indexedDB.deleteDatabase(name);
        let frist = null;
        a.onsuccess = () => { clearTimeout(frist); ok(); };
        a.onerror = () => { clearTimeout(frist); f(a.error); };
        a.onblocked = () => { frist = setTimeout(() => f(new Error("Frag Herbert ist noch in einem anderen Fenster offen. Bitte dort schließen.")), 8000); };
      });
    }
    kanal?.postMessage("geaendert");
  },

  meta: (schluessel) => transaktion(["meta"], "readonly", (s) => warten(s.meta.get(schluessel))),
  /** stand = Änderungszähler beim Erstellen: was danach geändert wurde, zählt weiter als ungesichert. */
  backupGemerkt: (zeit, stand) => transaktion(["meta"], "readwrite", async (s) => {
    const n = (await warten(s.meta.get("aenderungen"))) || 0;
    s.meta.put(Math.max(0, n - stand), "aenderungen");
    s.meta.put(zeit, "backup");
  }),
};
