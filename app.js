/*
 * Frag Herbert – dein Stellplatzbuch.
 *
 * Statische Seite ohne Server: alle Daten liegen in der Datenbank des Browsers (speicher.js). daten.js = Datenschicht, plaetze.js = Rechenregeln,
 * backup.js + zip.js = Sichern und Einspielen, karte.js + kartenstil.js = Karte (MapLibre), blatt.js = Bedienfeld/ziehbares Blatt.
 */
import { icon } from "./icons.js?v=9";
import { quelle, lesen, schreiben, SPEICHER, APP_URL } from "./daten.js?v=9";
import { speicher } from "./speicher.js?v=9";
import { backupErstellen, backupLesen, backupEinspielen, backupUebernehmen, kmlErstellen } from "./backup.js?v=9";
import { dateiLesen, fotosLesen, auswerten } from "./import.js?v=9";
import { abgleichen, aufloesen, folgefragen, entfernungen, FELDNAMEN } from "./abgleich.js?v=9";
import { km, koordinatenLesen, lokal, tagVon, letzteAenderung, PREIS_MAX, UMKREIS_KM, PAPIERKORB_TAGE } from "./plaetze.js?v=9";
import { Karte } from "./karte.js?v=9";
import { EBENEN } from "./kartenstil.js?v=9";
import { Blatt } from "./blatt.js?v=9";
import { DATENSCHUTZ, LIZENZEN } from "./info.js?v=9";

const VERSION = "0.8.0";
const TESTVERSION = VERSION.startsWith("0."); // bis 1.0: Hinweis beim Start, frühere Backup-Erinnerung
const ERINNERN_TAGE = TESTVERSION ? 7 : 14; // Backup-Erinnerung frühestens so lange nach dem letzten Backup

// Symbole = Namen aus icons.js (Material Design Icons, wie in der HA-Karte)
const ARTEN = [["Parkplatz", "parking"], ["Natur", "pine-tree"], ["Stellplatz", "rv-truck"], ["Campingplatz", "tent"]];
const ART_SYMBOL = Object.fromEntries(ARTEN);
const AUSSTATTUNG = [["strom", "Strom", "power-plug"], ["entsorgung", "Entsorgung", "water-sync"], ["wasser", "Wasser", "water-pump"],
  ["dusche", "Dusche", "shower-head"], ["muell", "Müll", "trash-can-outline"], ["toilette", "Toilette", "toilet"]];
const AKTIVITAETEN = [["klettern_indoor", "Klettern/Bouldern (indoor)", "wall"], ["klettern_outdoor", "Klettern/Bouldern (outdoor)", "image-filter-hdr"],
  ["wandern", "Wandern", "hiking"], ["laufen", "Laufen", "run"], ["schwimmen_outdoor", "Schwimmen (outdoor)", "swim"],
  ["schwimmbad_sauna", "Schwimmbad/Sauna", "pool"], ["fitness", "Fitness", "dumbbell"], ["skatepark", "Skatepark", "skateboarding"], ["pumptrack", "Pumptrack", "bike-fast"]];
const artName = (art) => ART_SYMBOL[art] || "map-marker";
const artFarbe = (art) => `--farbe: var(--art-${ART_SYMBOL[art] ? art : ""})`;
const PREIS_FILTER = [[-1, "alle"], [0, "kostenlos"], [5, "bis 5 €"], [10, "bis 10 €"], [15, "bis 15 €"], [20, "bis 20 €"], [30, "bis 30 €"], [50, "bis 50 €"]];
// Vorgemerkte Plätze (ohne Besuch) stehen hinten
const zuletzt = (a, b) => (b.letzter_besuch || "").localeCompare(a.letzter_besuch || "") || a.name.localeCompare(b.name, "de");
const SORTIERUNG = {
  zuletzt: ["Zuletzt besucht", (a, b) => zuletzt(a, b)],
  entfernung: ["Entfernung", (a, b) => (a._km ?? 1e9) - (b._km ?? 1e9)],
  bewertung: ["Bewertung", (a, b) => (b.bewertung || 0) - (a.bewertung || 0) || zuletzt(a, b)],
  preis: ["Preis", (a, b) => (a.preis ?? 999) - (b.preis ?? 999) || (b.bewertung || 0) - (a.bewertung || 0)],
  naechte: ["Übernachtungen", (a, b) => b.naechte - a.naechte || b.geparkt - a.geparkt || b.besuche - a.besuche],
  besuche: ["Besuche", (a, b) => b.besuche - a.besuche || b.naechte - a.naechte],
  name: ["Name", (a, b) => a.name.localeCompare(b.name, "de")],
};
const FILTER_LEER = { arten: [], ausstattung: [], aktivitaeten: [], maxPreis: -1, minSterne: 0, unbeschrieben: false, vorgemerkt: false };

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (z) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[z]));
const datum = (iso) => (iso ? new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");
const uhrzeit = (iso) => (iso ? new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const uhr = (iso) => new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const plural = (n, eins, mehr) => `${n} ${n === 1 ? eins : mehr}`;
/** Nacht = Datum des Abends → „Fr., 06.11.“ */
const nachtDatum = (n) => new Date(`${n}T12:00`).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
const naechteText = (n, g) => [n ? plural(n, "Übernachtung", "Übernachtungen") : "", g ? `${g}× über Nacht geparkt` : ""].filter(Boolean).join(" · ");
const preisText = (p) => (p === null || p === undefined ? "" : p === 0 ? "kostenlos" : p >= PREIS_MAX ? "über 50 €" : `${p} €`);
const kmText = (k) => (k < 10 ? `${k.toFixed(1).replace(".", ",")} km` : `${Math.round(k).toLocaleString("de-DE")} km`);
const sterneHtml = (n) => `<span class="sterne" role="img" aria-label="${n} von 5 Sternen">${[1, 2, 3, 4, 5].map((i) => icon("star", i <= n ? "" : "aus")).join("")}</span>`;
const platzLink = (id) => `#/platz/${encodeURIComponent(id)}`;

function vorZeit(iso) {
  const tag = (d) => Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 864e5);
  const d = new Date(iso), tage = tag(new Date()) - tag(d);
  if (tage <= 0) return "heute";
  if (tage === 1) return "gestern";
  if (tage < 14) return `vor ${tage} Tagen`;
  if (tage < 60) return `vor ${Math.round(tage / 7)} Wochen`;
  if (tage < 330) return `vor ${Math.round(tage / 30.4)} Monaten`;
  return d.toLocaleDateString("de-DE", { month: "short", year: "numeric" });
}

/** „12.–14. Okt. 2026“, über Monatsgrenzen „30. Okt. – 2. Nov. 2026“. */
function zeitraum(von, bis) {
  const a = new Date(von), b = bis ? new Date(bis) : null;
  const lang = (d, jahr = true) => d.toLocaleDateString("de-DE", { day: "numeric", month: "short", ...(jahr ? { year: "numeric" } : {}) });
  if (!b || a.toDateString() === b.toDateString()) return lang(a);
  if (a.getFullYear() !== b.getFullYear()) return `${lang(a)} – ${lang(b)}`;
  if (a.getMonth() !== b.getMonth()) return `${lang(a, false)} – ${lang(b)}`;
  return `${a.getDate()}.–${lang(b)}`;
}

const installiert = () => navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// Kleine Vorschau je Kartenebene im Ebenen-Menü
const MUSTER = {
  standard: `<rect width="120" height="46" fill="#f4f4ec"/><path d="M0 0h52q-8 18-26 22T0 30Z" fill="#cfe2c3"/><path d="M74 46q4-22 24-26t22-10v36Z" fill="#a6d3e0"/><path d="M0 40Q50 34 66 14T120 4" fill="none" stroke="#dc9f57" stroke-width="6"/><path d="M0 40Q50 34 66 14T120 4" fill="none" stroke="#f6c583" stroke-width="4"/>`,
  topo: `<rect width="120" height="46" fill="#eef0dc"/><g fill="none" stroke="#b98a56" stroke-width="1"><path d="M-5 40Q30 2 62 20T125 10"/><path d="M-5 48Q34 10 62 27T125 18"/><path d="M-5 30Q28-8 64 12T125 2"/><path d="M14 52Q40 22 66 34T125 27"/><path d="M34 54Q52 34 70 42T125 36"/></g>`,
  rad: `<rect width="120" height="46" fill="#f5f2e8"/><path d="M0 0h44L22 46H0Z" fill="#d4e6c3"/><path d="M8 46Q40 10 120 22" fill="none" stroke="#2a62c9" stroke-width="3"/><path d="M60 0Q66 24 90 46" fill="none" stroke="#b3472f" stroke-width="2" stroke-dasharray="5 3"/>`,
  satellit: `<rect width="120" height="46" fill="#3c5236"/><path d="M0 46V22l34-10 18 18-12 16Z" fill="#6d6a48"/><path d="M62 0h58v30q-30 10-44-6T62 0Z" fill="#17384a"/><path d="M44 12l22 8-8 18-20-8Z" fill="#54703f"/>`,
};

// ================================================================ App

const app = {
  daten: null,
  ansicht: { text: "", ...FILTER_LEER, sort: "zuletzt", ebene: "standard", darstellung: "auto", ...lesen(SPEICHER.ansicht, {}) },
  hier: null,
  karte: null, blatt: null,
  route: { platz: null, bearbeiten: false },
  offen: new Set(), // aufgeklappte Abschnitte in den Details (bleiben beim Wechsel des Platzes offen)

  async start() {
    this.ansicht.text = "";
    this.ansicht.arten = this.ansicht.arten.filter((a) => ART_SYMBOL[a]);
    // Rückkehr von „App-Dateien neu laden“ (?r=…): Adresse wieder sauber
    if (new URLSearchParams(location.search).has("r")) history.replaceState(null, "", APP_URL + location.hash);
    if ("serviceWorker" in navigator) this.updatesEinrichten();
    this.abstandMessen();
    this.steuerungAufbauen();
    window.addEventListener("hashchange", () => this.routeLesen());
    speicher.beiAenderung(() => this.laden()); // anderes Fenster hat etwas geändert
    this.routeLesen(false);
    this.karteAufbauen();
    this.zeichnen();
    await this.laden();
    const nachladen = () => { if (document.visibilityState === "visible") { this.laden(); this.standortHolen(); } };
    document.addEventListener("visibilitychange", nachladen);
    this.standortHolen();
  },

  /** Sicherer Abstand oben (Dynamic Island) als Zahl für blatt.js – env() ist in JS nicht lesbar. */
  abstandMessen() {
    const messen = () => {
      const d = document.createElement("div");
      d.style.cssText = "position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top, 0px);padding-bottom:env(safe-area-inset-bottom, 0px)";
      document.body.append(d);
      const s = getComputedStyle(d);
      document.documentElement.style.setProperty("--oben-px", parseFloat(s.paddingTop) || 0);
      this.untenPx = parseFloat(s.paddingBottom) || 0;
      d.remove();
    };
    messen();
    addEventListener("resize", messen);
  },

  // ------------------------------------------------------------ Daten

  async laden() {
    try {
      this.daten = await quelle.daten();
      this.hinweisWaehlen();
      // Leeres Buch: am Handy ganz aufziehen, sonst lägen die Knöpfe unter dem Rand
      if (!this.daten.plaetze.length && !this.blatt.breit && !this.willkommenGezeigt) { this.willkommenGezeigt = true; this.blatt.setzen("voll"); }
      if (this.formularOffen()) this.formularFotosZeichnen();
      this.zeichnen();
      // Erst wenn es etwas zu schützen gibt: um dauerhaften Speicher bitten (manche Browser fragen nach)
      if (this.daten.plaetze.length && !this.speicherGefragt) { this.speicherGefragt = true; navigator.storage?.persist?.().catch(() => {}); }
    } catch (e) {
      this.hinweis(`Die Daten konnten nicht gelesen werden: ${e.message}`, true);
    }
  },

  /** Standort still holen, wenn er schon erlaubt ist (Entfernung, „Du bist hier“). */
  async standortHolen() {
    if (!(await quelle.standortErlaubt())) return;
    try { this.standortSetzen(await quelle.position()); } catch (e) { /* bleibt unbekannt */ }
  },
  standortSetzen(pos) {
    this.hier = [pos.latitude, pos.longitude];
    if (this.daten) this.hinweisWaehlen();
    if (!this.formularOffen()) this.zeichnen();
  },

  /** Hinweis über der Liste: erst Installation (Datenverlust droht), dann Backup. Beides lässt sich für eine Weile ausblenden. */
  hinweisWaehlen() {
    const d = this.daten, aus = lesen(SPEICHER.hinweise, {}), ruhe = (k) => (aus[k] || 0) > Date.now();
    if (!d.plaetze.length) return this.hinweis(null);
    // Offener Besuch von gestern oder früher, obwohl das Gerät woanders ist (oder der Ort unbekannt): sonst zählen die Nächte endlos weiter
    const heute = tagVon(new Date());
    for (const p of d.plaetze) {
      const b = p.besuche_liste.find((x) => !x.abfahrt && x.ankunft.slice(0, 10) < heute);
      if (b && p.id !== this.hierId() && !ruhe(`abfahrt-${b.id}`)) {
        return this.hinweis(`„${p.name}“: Die Abfahrt ist noch offen.`, false, { text: "Eintragen", tun: () => this.besuchZeigen(p, b), ruhe: `abfahrt-${b.id}`, tage: 1 });
      }
    }
    if (ios && !installiert() && !ruhe("installation")) {
      return this.hinweis("Im Browser kann Safari deine Plätze löschen, wenn du länger nicht hier warst. Sicher ist die App auf dem Home-Bildschirm.", false, { text: "So geht’s", tun: () => this.installationZeigen(), ruhe: "installation" });
    }
    const tage = d.backup ? (Date.now() - Date.parse(d.backup)) / 864e5 : Infinity;
    if (d.aenderungen && tage > ERINNERN_TAGE && d.plaetze.length >= (TESTVERSION ? 1 : 3) && !ruhe("backup")) {
      return this.hinweis(d.backup ? `Letztes Backup ${vorZeit(d.backup)}. Seitdem hat sich etwas geändert.` : "Deine Plätze liegen nur auf diesem Gerät. Es gibt noch kein Backup.", false, { text: "Backup", tun: () => this.backupZeigen(), ruhe: "backup" });
    }
    this.hinweis(null);
  },
  installationZeigen() {
    this.frage({ titel: "Auf den Home-Bildschirm", text: `1. In Safari unten auf „Teilen“ tippen
2. „Zum Home-Bildschirm“ wählen
3. Frag Herbert von dort starten

Die App dort hat einen eigenen Speicher. Plätze aus dem Browser nimmst du mit einem Backup mit: hier sichern, dort einspielen.`, knopf: "Verstanden", nurEins: true });
  },

  // ------------------------------------------------------------ Updates
  // sw.js übernimmt eine neue Version sofort (skipWaiting + clients.claim). Damit nicht alte app.js und neue Dateien gemischt
  // laufen, lädt die Seite danach neu: kurz nach dem Start automatisch, später erst auf Knopfdruck (Leiste oben).
  // Geprüft wird beim Start, beim Zurückkehren in die App (iOS lässt Web-Apps oft nur ruhen) und über das Menü.

  updatesEinrichten() {
    const sw = navigator.serviceWorker;
    const hatteSteuerung = !!sw.controller;
    this.gestartet = Date.now();
    sw.addEventListener("controllerchange", () => { if (hatteSteuerung) this.updateBereit(); });
    sw.register("sw.js", { updateViaCache: "none" }).then((reg) => {
      this.swReg = reg;
      if (reg.waiting) reg.waiting.postMessage("aktivieren"); // hängengebliebene neue Version
      this.updatePruefen();
    }).catch((e) => (this.swFehler = e.message));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && Date.now() - (this.updateGeprueft || 0) > 15 * 60000) this.updatePruefen();
    });
  },

  /** Fragt nach einer neuen sw.js. Ergebnis: "neu" | "aktuell" | "offline" | "fehler" | "kein". */
  async updatePruefen() {
    const reg = this.swReg || (await navigator.serviceWorker?.getRegistration?.().catch(() => null));
    if (!reg) return "kein";
    this.updateGeprueft = Date.now();
    try { await reg.update(); } catch (e) { return navigator.onLine ? "fehler" : "offline"; }
    const neu = reg.installing || reg.waiting;
    if (!neu) return this.updateWartet ? "neu" : "aktuell";
    // Installation abwarten (lädt alle App-Dateien neu); scheitert sie, bleibt die alte Version unverändert in Betrieb
    const zustand = await new Promise((ok) => {
      const fertig = () => ["activated", "redundant"].includes(neu.state) && ok(neu.state);
      neu.addEventListener("statechange", fertig);
      if (neu.state === "installed") neu.postMessage("aktivieren");
      fertig();
      setTimeout(() => ok(neu.state), 60000);
    });
    return zustand === "redundant" ? "fehler" : "neu";
  },

  updateBereit() {
    this.updateWartet = true;
    const frisch = Date.now() - this.gestartet < 20000;
    if ((frisch && !this.route.bearbeiten) || this.sofortNeu) return location.reload();
    const u = $("#update");
    u.innerHTML = `${icon("update")}<span>Neue Version geladen.</span><button class="knopf haupt flach" id="u-jetzt">Aktualisieren</button>`;
    u.hidden = false;
    $("#u-jetzt").onclick = () => location.reload();
  },

  /** Notfall: App-Dateien und Service Worker dieser App verwerfen und frisch holen (Plätze, Fotos und Karten bleiben). */
  async appNeuLaden() {
    try {
      for (const n of await caches.keys()) if (/^herbert-app-/.test(n)) await caches.delete(n);
      await (await navigator.serviceWorker.getRegistration(APP_URL))?.unregister();
    } catch (e) { /* trotzdem neu laden */ }
    location.replace(`${APP_URL}?r=${Date.now()}${location.hash}`);
  },

  // ------------------------------------------------------------ Hinweise und Rückfragen

  /** aktion: { text, tun, ruhe, tage } – Knopf und „später“ (so viele Tage Ruhe unter diesem Namen, sonst 30). */
  hinweis(text, fehler = false, aktion = null) {
    const h = $("#hinweis");
    h.hidden = !text;
    h.innerHTML = text ? `${icon("information-outline")}<span>${esc(text)}</span>${aktion ? `<span class="h-knoepfe"><button class="knopf flach" data-tun>${esc(aktion.text)}</button><button class="rund" data-spaeter aria-label="Ausblenden">${icon("close")}</button></span>` : ""}` : "";
    h.classList.toggle("fehler", fehler);
    if (!text || !aktion) return;
    h.querySelector("[data-tun]").onclick = aktion.tun;
    h.querySelector("[data-spaeter]").onclick = () => { schreiben(SPEICHER.hinweise, { ...lesen(SPEICHER.hinweise, {}), [aktion.ruhe]: Date.now() + (aktion.tage || 30) * 864e5 }); this.hinweisWaehlen(); };
  },

  meldung(text, fehler = false) {
    const m = $("#meldung");
    m.textContent = text;
    m.classList.toggle("fehler", fehler);
    m.hidden = false;
    clearTimeout(this.meldungZeit);
    this.meldungZeit = setTimeout(() => (m.hidden = true), fehler || text.length > 40 ? 7000 : 3000);
  },

  /** Rückfrage im Stil der App → true, wenn bestätigt. */
  frage({ titel, text, knopf, warnung = false, nurEins = false }) {
    const d = $("#frage");
    d.innerHTML = `<div class="f-kopf"><h2 tabindex="-1" autofocus>${esc(titel)}</h2></div><div class="f-rollen"><p class="umbruch">${esc(text)}</p></div>
      <div class="f-fuss">${nurEins ? "" : `<button class="knopf" value="nein">Abbrechen</button>`}<button class="knopf ${warnung ? "warnung" : "haupt"}" style="flex:1" value="ja">${esc(knopf)}</button></div>`;
    d.returnValue = "nein";
    d.onclick = (e) => { const b = e.target.closest("button"); if (b) d.close(b.value); else if (e.target === d) d.close("nein"); };
    d.showModal();
    return new Promise((ok) => d.addEventListener("close", () => ok(d.returnValue === "ja"), { once: true }));
  },

  fensterOeffnen(id) {
    const d = $(id);
    if (!d.dataset.bereit) { d.dataset.bereit = "1"; d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-zu]")) d.close(); }); }
    if (!d.open) d.showModal();
    return d;
  },

  // ------------------------------------------------------------ Route (#/platz/<id>[/bearbeiten])

  routeLesen(zeichnen = true) {
    const m = location.hash.match(/^#\/platz\/([^/]+)(\/bearbeiten)?/);
    const vorher = this.route;
    this.route = { platz: m ? decodeURIComponent(m[1]) : null, bearbeiten: !!m?.[2] };
    if (this.blatt && !this.blatt.breit) {
      if (this.route.bearbeiten) this.blatt.setzen("voll");
      else if (this.route.platz && !vorher.platz) {
        this.stufeVorher = this.blatt.stufe;
        if (this.blatt.stufe === "klein") this.blatt.setzen("halb");
      } else if (!this.route.platz && vorher.platz && this.stufeVorher) this.blatt.setzen(this.stufeVorher);
    }
    if (zeichnen) this.zeichnen();
    if (this.blatt) this.blatt.gesperrt = this.route.bearbeiten;
    const p = this.route.platz && this.platz(this.route.platz);
    if (zeichnen && p && this.route.platz !== vorher.platz) this.karte?.zeigen(p);
  },
  formularOffen() { return this.route.bearbeiten; },

  // ------------------------------------------------------------ Bedienfeld, Schnellfilter, Filter

  steuerungAufbauen() {
    $("#suchsymbol").innerHTML = icon("magnify");
    $("#sortiersymbol").innerHTML = icon("chevron-down");
    $("#menueknopf").innerHTML = icon("cog-outline");
    $("#hierknopf").innerHTML = icon("map-marker-plus");
    $("#hierknopf").onclick = () => this.neuZeigen();
    $("#sortierung").innerHTML = Object.entries(SORTIERUNG).map(([k, [t]]) => `<option value="${k}">${t}</option>`).join("");
    $("#sortierung").value = this.ansicht.sort;
    $("#sortierung").onchange = (e) => { this.ansicht.sort = e.target.value; this.merken(); this.zeichnen(); $("#rollen").scrollTop = 0; };
    $("#suche").oninput = (e) => { this.ansicht.text = e.target.value; this.zeichnen(); this.ausschnittAnpassen(600); };
    $("#suche").onfocus = () => { if (!this.blatt.breit) this.blatt.setzen("voll"); };
    $("#suche").onkeydown = (e) => { if (e.key === "Enter") e.target.blur(); };
    // Einstellungen: Zahnrad in der Kartenleiste (immer da); am Handy bei ganz aufgezogenem Blatt im Kopf von Liste und Details
    document.addEventListener("click", (e) => { if (e.target.closest("[data-menue]")) { this.ebenenZeigen(false); this.menueZeichnen(); } });
    $("#schnellfilter").onclick = (e) => {
      if (e.target.closest("#filterknopf")) return this.filterZeichnen();
      this.filterKlick(e);
    };
    $("#filter").addEventListener("click", (e) => this.filterKlick(e));
    // iOS schiebt die Seite für die Tastatur hoch und lässt sie danach manchmal verschoben stehen
    document.addEventListener("focusout", () => setTimeout(() => { if (!document.activeElement?.matches?.("input, textarea, select")) scrollTo(0, 0); }, 50));
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
      if (!$("#ebenen").hidden) return this.ebenenZeigen(false);
      if (this.route.platz && !this.route.bearbeiten) location.hash = "#/";
    });
    // Maus über einem Listeneintrag (Mac): Punkt auf der Karte hervorheben
    // nur mit echter Maus: auf dem Handy meldet ein Tipp sonst „hover“ und der Punkt bliebe hervorgehoben
    if (matchMedia("(hover: hover)").matches) {
      $("#liste").addEventListener("mouseover", (e) => this.hover(e.target.closest(".platz")?.dataset.id || null));
      $("#liste").addEventListener("mouseleave", () => this.hover(null));
    }
    // Navigationsknopf im Listeneintrag: Google Maps öffnen statt das Detail
    $("#liste").addEventListener("click", (e) => {
      const nav = e.target.closest("[data-nav]");
      if (nav) {
        e.preventDefault();
        e.stopPropagation();
        window.open(nav.dataset.nav, "_blank", "noopener");
      } else if (e.target.closest("[data-neu]")) this.neuZeigen();
      else if (e.target.closest("[data-import]")) this.importZeigen();
      else if (e.target.closest("[data-installieren]")) this.installationZeigen();
      else if (e.target.closest("[data-zuruecksetzen]")) {
        Object.assign(this.ansicht, structuredClone(FILTER_LEER), { text: "" });
        $("#suche").value = "";
        this.merken();
        this.zeichnen();
        this.ausschnittAnpassen();
      }
    });
    this.blatt = new Blatt({
      wurzel: $("#blatt"), griff: $("#griff"),
      rollbereich: () => (this.route.platz ? $("#detail .d-rollen") : $("#rollen")),
      kleinHoehe: () => 22 + (this.route.platz ? ($("#detail .d-kopf")?.offsetHeight || 90) + ($("#detail .aktionen")?.offsetHeight || 0) : $("#uebersicht header").offsetHeight) + (this.untenPx || 0),
      aufStufe: (s) => { if (s === "klein") document.activeElement?.blur?.(); },
    });
  },
  merken() { const { text, ...rest } = this.ansicht; schreiben(SPEICHER.ansicht, rest); },

  filterZahl() {
    const a = this.ansicht;
    return a.arten.length + a.ausstattung.length + a.aktivitaeten.length + (a.maxPreis >= 0) + (a.minSterne > 0) + a.unbeschrieben + !!a.vorgemerkt;
  },

  chip(gruppe, wert, text, an, stil = "") {
    return `<button class="chip ${an ? "an" : ""}" data-gruppe="${gruppe}" data-wert="${esc(wert)}" aria-pressed="${!!an}" style="${stil}">${text}</button>`;
  },

  schnellfilterZeichnen() {
    const a = this.ansicht, n = this.filterZahl(), neu = (this.daten?.plaetze || []).filter((p) => !p.gepflegt).length, vor = (this.daten?.plaetze || []).filter((p) => p.vorgemerkt).length;
    const html = `<button class="chip" id="filterknopf" aria-label="Alle Filter">${icon("tune-variant")}Filter${n ? `<span class="zahl">${n}</span>` : ""}</button>` +
      (neu || a.unbeschrieben ? this.chip("unbeschrieben", "", `${icon("pencil")}Offen <span class="zahl">${neu}</span>`, a.unbeschrieben) : "") +
      (vor || a.vorgemerkt ? this.chip("vorgemerkt", "", `${icon("map-marker-plus")}Vorgemerkt <span class="zahl">${vor}</span>`, a.vorgemerkt) : "") +
      ARTEN.map(([t, s]) => this.chip("arten", t, icon(s) + t, a.arten.includes(t), artFarbe(t))).join("") +
      this.chip("kostenlos", "", "Kostenlos", a.maxPreis === 0) + this.chip("gut", "", `${icon("star")}ab 4`, a.minSterne >= 4);
    if (html !== this.schnellHtml) { this.schnellHtml = html; $("#schnellfilter").innerHTML = html; }
  },

  filterZeichnen() {
    const a = this.ansicht, d = $("#filter");
    const rollen = d.querySelector(".f-rollen")?.scrollTop || 0;
    const gruppe = (titel, inhalt) => `<div><div class="ueber">${titel}</div><div class="chips">${inhalt}</div></div>`;
    d.innerHTML = `<div class="f-kopf"><h2 tabindex="-1" autofocus>Filter</h2><button class="rund" data-zu aria-label="Schließen">${icon("close")}</button></div><div class="f-rollen">` +
      gruppe("Art", ARTEN.map(([t, s]) => this.chip("arten", t, icon(s) + t, a.arten.includes(t), artFarbe(t))).join("")) +
      gruppe("Preis pro Nacht", PREIS_FILTER.map(([w, t]) => this.chip("preis", w, t, a.maxPreis === w)).join("")) +
      gruppe("Bewertung", [0, 2, 3, 4, 5].map((n) => this.chip("sterne", n, n ? `${icon("star")}${n === 5 ? "5" : `ab ${n}`}` : "alle", a.minSterne === n)).join("")) +
      gruppe("Ausstattung", AUSSTATTUNG.map(([k, t, s]) => this.chip("ausstattung", k, icon(s) + t, a.ausstattung.includes(k))).join("")) +
      gruppe("In der Nähe", AKTIVITAETEN.map(([k, t, s]) => this.chip("aktivitaeten", k, icon(s) + t, a.aktivitaeten.includes(k))).join("")) +
      gruppe("Stand", this.chip("unbeschrieben", "", `${icon("pencil")}noch nicht beschrieben`, a.unbeschrieben) + this.chip("vorgemerkt", "", `${icon("map-marker-plus")}vorgemerkt, noch nicht besucht`, a.vorgemerkt)) +
      `</div><div class="f-fuss"><button class="knopf" data-gruppe="zuruecksetzen" ${this.filterZahl() ? "" : "disabled"}>Zurücksetzen</button>
        <button class="knopf haupt" data-zu>${plural(this.gefiltert().length, "Platz", "Plätze")} anzeigen</button></div>`;
    d.querySelector(".f-rollen").scrollTop = rollen;
    if (!d.open) this.fensterOeffnen("#filter");
  },

  filterKlick(e) {
    const b = e.target.closest("[data-gruppe]");
    if (!b) return;
    const a = this.ansicht, { gruppe, wert } = b.dataset;
    if (["arten", "ausstattung", "aktivitaeten"].includes(gruppe)) a[gruppe] = a[gruppe].includes(wert) ? a[gruppe].filter((x) => x !== wert) : [...a[gruppe], wert];
    else if (gruppe === "preis") a.maxPreis = Number(wert);
    else if (gruppe === "sterne") a.minSterne = Number(wert);
    else if (gruppe === "kostenlos") a.maxPreis = a.maxPreis === 0 ? -1 : 0;
    else if (gruppe === "gut") a.minSterne = a.minSterne >= 4 ? 0 : 4;
    else if (gruppe === "unbeschrieben") a.unbeschrieben = !a.unbeschrieben;
    else if (gruppe === "vorgemerkt") a.vorgemerkt = !a.vorgemerkt;
    else if (gruppe === "zuruecksetzen") Object.assign(a, structuredClone(FILTER_LEER));
    this.merken();
    this.zeichnen();
    if ($("#filter").open) this.filterZeichnen();
    this.ausschnittAnpassen();
  },

  /** Nach Filter oder Suche: Karte auf die Treffer ausrichten (nur wenn sie sich geändert haben; ohne Treffer bleibt sie stehen). */
  ausschnittAnpassen(wartezeit = 200) {
    clearTimeout(this.ausschnittZeit);
    this.ausschnittZeit = setTimeout(() => {
      const liste = this.gefiltert(), sig = liste.map((p) => p.id).sort().join();
      if (!liste.length || sig === this.ausschnittSig || this.route.platz) return;
      this.ausschnittSig = sig;
      this.karte?.alle(liste);
    }, wartezeit);
  },

  // ------------------------------------------------------------ Einstellungen

  async menueZeichnen() {
    const d = $("#menue"), korb = this.daten?.papierkorb || [];
    let belegt = "", dauerhaft = null;
    try { const s = await navigator.storage?.estimate?.(); if (s) belegt = `${(s.usage / 1048576).toFixed(1).replace(".", ",")} MB belegt`; } catch (e) { /* egal */ }
    try { dauerhaft = await navigator.storage?.persisted?.(); } catch (e) { /* unbekannt */ }
    const jn = (b) => (b ? "ja" : b === false ? "nein" : "?");
    const n = this.daten?.plaetze.length || 0, fotos = (this.daten?.plaetze || []).reduce((s, p) => s + p.fotos, 0);
    const rollen = d.querySelector(".f-rollen")?.scrollTop || 0;
    d.innerHTML = `<div class="f-kopf"><h2 tabindex="-1" autofocus>Einstellungen</h2><button class="rund" data-zu aria-label="Schließen">${icon("close")}</button></div><div class="f-rollen">
      <div><div class="ueber">Darstellung</div><div class="segmente" id="m-darstellung">${[["auto", "Automatisch"], ["hell", "Hell"], ["dunkel", "Dunkel"]].map(([k, t]) =>
        `<button data-darstellung="${k}" class="${this.ansicht.darstellung === k ? "an" : ""}">${t}</button>`).join("")}</div></div>
      <div><div class="ueber">Deine Daten</div><div class="block">
        <div class="zeile"><span>${plural(n, "Platz", "Plätze")}, ${plural(fotos, "Foto", "Fotos")}<small>Liegt nur auf diesem Gerät, niemand sonst kann es sehen.</small></span></div>
        <div class="zeile"><span>Backup und Export<small>${this.daten?.backup ? `zuletzt ${uhrzeit(this.daten.backup)}${this.daten.aenderungen ? ", seitdem geändert" : ", aktuell"}` : "noch keines erstellt"}</small></span>
          <button class="knopf flach" id="m-backup" ${n || korb.length ? "" : "disabled"}>Exportieren</button></div>
        <div class="zeile"><span>Importieren<small>Backup, GPX, KML, GeoJSON, CSV, Google Maps, Fotos mit Ort</small></span><button class="knopf flach" id="m-import">Auswählen</button></div>
        ${ios && !installiert() ? `<div class="zeile"><span>Auf den Home-Bildschirm<small>Schützt deine Daten besser als der Browser.</small></span><button class="knopf flach" id="m-install">So geht’s</button></div>` : ""}</div></div>
      ${korb.length ? `<div><div class="ueber">Papierkorb (${PAPIERKORB_TAGE} Tage)</div><div class="block">${korb.map((k) => `<div class="zeile"><span>${esc(k.name)}<small>gelöscht am ${datum(k.geloescht)}</small></span>
        <button class="knopf flach" data-wieder="${esc(k.id)}">Zurückholen</button></div>`).join("")}</div></div>` : ""}
      <div><div class="ueber">App</div><div class="block">
        <div class="zeile"><span>${TESTVERSION ? "Testversion" : "Version"} ${VERSION}<small id="m-updatestand">Wird bei jedem Start geprüft${this.updateGeprueft ? `, zuletzt ${uhrzeit(new Date(this.updateGeprueft).toISOString())}` : ""}.</small></span>
          <button class="knopf flach" id="m-update">Nach Update suchen</button></div>
        <div class="zeile"><span>App-Dateien neu laden<small>Falls etwas klemmt. Plätze, Fotos und Karten bleiben.</small></span><button class="knopf flach" id="m-reparieren" ${navigator.onLine ? "" : "disabled"}>Neu laden</button></div>
        <div class="zeile"><span>Datenschutz<small>Was auf dem Gerät bleibt, wer etwas mitbekommt</small></span><button class="knopf flach" data-info="datenschutz">Lesen</button></div>
        <div class="zeile"><span>Lizenzen<small>Software und Kartenquellen</small></span><button class="knopf flach" data-info="lizenzen">Lesen</button></div>
        <details><summary>Diagnose</summary><p>HTTPS ${jn(window.isSecureContext)} · Offline-Dienst ${navigator.serviceWorker?.controller ? "aktiv" : "nicht aktiv"} · Speicher dauerhaft ${jn(dauerhaft)}${belegt ? ` · ${belegt}` : ""} · ${installiert() ? "installiert" : "im Browser"}${this.swFehler ? ` · Fehler: ${esc(this.swFehler)}` : ""}</p></details></div></div></div>`;
    d.querySelector(".f-rollen").scrollTop = rollen;
    this.fensterOeffnen("#menue");
    $("#m-darstellung").onclick = (e) => {
      const b = e.target.closest("[data-darstellung]");
      if (!b) return;
      this.darstellungSetzen(b.dataset.darstellung);
      d.querySelectorAll("[data-darstellung]").forEach((x) => x.classList.toggle("an", x === b));
    };
    $("#m-backup").onclick = () => { d.close(); this.backupZeigen(); };
    $("#m-import").onclick = () => { d.close(); this.importZeigen(); };
    if ($("#m-install")) $("#m-install").onclick = () => this.installationZeigen();
    d.querySelectorAll("[data-info]").forEach((b) => (b.onclick = () => this.infoZeigen(b.dataset.info)));
    $("#m-update").onclick = async (e) => {
      const k = e.currentTarget, anzeige = $("#m-updatestand");
      k.disabled = true;
      anzeige.textContent = "Suche nach Update …";
      this.sofortNeu = true; // ausdrücklich gewünscht: nach der Übernahme gleich neu laden
      const r = await this.updatePruefen();
      this.sofortNeu = false;
      k.disabled = false;
      if (r === "neu") { anzeige.textContent = "Neue Version geladen – wird gestartet …"; setTimeout(() => location.reload(), 1500); }
      else anzeige.textContent = { aktuell: `${VERSION} ist die neueste Version.`, offline: "Keine Verbindung – später erneut versuchen.", kein: "Der Offline-Dienst ist hier nicht aktiv.",
        fehler: "Das Update konnte nicht geladen werden. Die bisherige Version läuft weiter." }[r];
    };
    $("#m-reparieren").onclick = async () => {
      if (await this.frage({ titel: "App-Dateien neu laden?", text: "Die App wird frisch geladen. Plätze, Fotos und Karten bleiben erhalten.", knopf: "Neu laden" })) this.appNeuLaden();
    };
    d.querySelectorAll("[data-wieder]").forEach((b) => (b.onclick = async () => { await this.aktion(() => quelle.wiederherstellen(b.dataset.wieder), b, this.formularOffen() ? undefined : platzLink(b.dataset.wieder)); d.close(); }));
  },

  /** Datenschutz oder Lizenzen (info.js), über den Einstellungen. */
  infoZeigen(art) {
    const d = $("#info");
    d.innerHTML = `<div class="f-kopf"><h2 tabindex="-1" autofocus>${art === "lizenzen" ? "Lizenzen" : "Datenschutz"}</h2><button class="rund" data-zu aria-label="Schließen">${icon("close")}</button></div>
      <div class="f-rollen text">${art === "lizenzen" ? LIZENZEN : DATENSCHUTZ}</div>`;
    this.fensterOeffnen("#info");
  },

  // ------------------------------------------------------------ Backup

  /** Export (KONZEPT-WEBAPP.md 12.8.2): erst wählen (Plätze, Format, Fotos), dann erstellen und sichern oder teilen. */
  backupZeigen() {
    const d = $("#backup");
    const bild = (inhalt, fuss) => (d.innerHTML = `<div class="f-kopf"><h2 tabindex="-1" autofocus>Exportieren</h2><button class="rund" data-zu aria-label="Schließen">${icon("close")}</button></div><div class="f-rollen">${inhalt}</div><div class="f-fuss">${fuss}</div>`);
    const alle = this.daten?.plaetze || [], gefiltert = this.gefiltert(), korb = this.daten?.papierkorb?.length || 0;
    const w = { umfang: "alle", format: "herbert", fotos: true, notiz: true, ids: new Set(alle.map((p) => p.id)) };
    const wahl = (name, wert, text, klein) => `<label class="zeile"><input type="radio" name="${name}" value="${wert}" ${w[name] === wert ? "checked" : ""}><span>${text}${klein ? `<small>${klein}</small>` : ""}</span></label>`;
    const zeichnen = () => {
      const liste = w.umfang === "alle" ? null : w.umfang === "filter" ? gefiltert.map((p) => p.id) : alle.filter((p) => w.ids.has(p.id)).map((p) => p.id);
      const gewaehlt = liste ? alle.filter((p) => liste.includes(p.id)) : alle, n = gewaehlt.length;
      const fotos = gewaehlt.reduce((s, p) => s + (p.fotos || 0), 0), herbert = w.format === "herbert";
      const hinweis = !herbert ? `Für andere Programme: Name, Ort${w.notiz ? " und Notiz" : ""}; Besuche, Fotos und Bewertungen fehlen. Google My Maps nimmt höchstens 2 000 Orte je Datei.${n > 2000 ? " <b>Hier sind es mehr.</b>" : ""}`
        : liste ? "Enthält Besuche, Notizen und die genauen Orte der gewählten Plätze. Beim Einlesen anderswo wird nichts gelöscht."
        : w.fotos ? "Sichert alle Daten, auch den Papierkorb. Am besten in einen Ordner legen, der selbst gesichert wird (z. B. iCloud Drive)."
        : "Ohne Fotos zählt der Export nicht als vollständige Sicherung.";
      bild(`<div class="block">${wahl("umfang", "alle", `Alle Plätze (${alle.length})`, korb && herbert ? `dazu ${plural(korb, "Platz", "Plätze")} im Papierkorb` : "")}
          ${gefiltert.length < alle.length ? wahl("umfang", "filter", `Aktueller Filter (${gefiltert.length})`) : ""}
          ${wahl("umfang", "einzeln", "Einzeln auswählen", w.umfang === "einzeln" ? `${n} gewählt` : "")}</div>
        ${w.umfang === "einzeln" ? `<div class="block i-liste"><label class="zeile"><input type="checkbox" id="e-alle" ${n === alle.length ? "checked" : ""}><span><b>Alle</b></span></label>${alle.map((p) => `<label class="zeile i-zeile"><input type="checkbox" data-e="${esc(p.id)}" ${w.ids.has(p.id) ? "checked" : ""}><span>${esc(p.name)}<small>${esc([p.art, p.letzter_besuch && datum(p.letzter_besuch)].filter(Boolean).join(" · "))}</small></span></label>`).join("")}</div>` : ""}
        <div class="block">${wahl("format", "herbert", "Frag Herbert", "alle Daten, wieder einlesbar")}${wahl("format", "kml", "KML", "für Google My Maps, Navis und andere Apps")}</div>
        <div class="block">${herbert ? `<label class="zeile"><span>Mit Fotos<small>${plural(fotos, "Foto", "Fotos")}; große Exporte werden ab 500 MB aufgeteilt</small></span><input type="checkbox" class="schalter" id="e-fotos" ${w.fotos ? "checked" : ""}></label>`
          : `<label class="zeile"><span>Mit Notiz</span><input type="checkbox" class="schalter" id="e-notiz" ${w.notiz ? "checked" : ""}></label>`}</div>
        <p class="grau klein">${hinweis}</p>`,
        `<button class="knopf haupt" style="flex:1" id="b-erstellen" ${n ? "" : "disabled"}>${n ? `${plural(n, "Platz", "Plätze")} exportieren` : "Nichts ausgewählt"}</button>`);
      const rollen = d.querySelector(".f-rollen");
      d.querySelectorAll('input[type="radio"]').forEach((r) => (r.onchange = () => { w[r.name] = r.value; const pos = rollen.scrollTop; zeichnen(); d.querySelector(".f-rollen").scrollTop = pos; }));
      d.querySelectorAll("[data-e]").forEach((h) => (h.onchange = () => { h.checked ? w.ids.add(h.dataset.e) : w.ids.delete(h.dataset.e); const pos = rollen.scrollTop; zeichnen(); d.querySelector(".f-rollen").scrollTop = pos; }));
      if ($("#e-alle")) $("#e-alle").onchange = (e) => { w.ids = new Set(e.target.checked ? alle.map((p) => p.id) : []); const pos = rollen.scrollTop; zeichnen(); d.querySelector(".f-rollen").scrollTop = pos; };
      if ($("#e-fotos")) $("#e-fotos").onchange = (e) => { w.fotos = e.target.checked; zeichnen(); };
      if ($("#e-notiz")) $("#e-notiz").onchange = (e) => { w.notiz = e.target.checked; zeichnen(); };
      $("#b-erstellen").onclick = async () => {
        bild(`<p id="b-stand">Export wird erstellt …</p>`, "");
        let e;
        try {
          if (herbert) e = await backupErstellen(VERSION, { ids: liste, mitFotos: w.fotos }, (x, y) => { const z = $("#b-stand"); if (z) z.textContent = `Export wird erstellt … ${x} von ${y}`; });
          else { const datei = kmlErstellen(gewaehlt, { notiz: w.notiz }); e = { dateien: [datei], groesse: datei.size, plaetze: n, fotos: 0, fehlend: 0, vollstaendig: false }; }
        } catch (x) { return bild(`<p>Der Export ist fehlgeschlagen: ${esc(x.message)}</p>`, `<button class="knopf haupt" style="flex:1" data-zu>Schließen</button>`); }
        if (d.open) this.exportSichern(e, bild);
      };
    };
    zeichnen();
    this.fensterOeffnen("#backup");
  },

  /** Fertigen Export sichern oder teilen (iPhone/Android: Teilen-Menü, sonst Download). Nur „alle mit Fotos“ zählt als Backup. */
  exportSichern(e, bild) {
    const d = $("#backup");
    const teilen = !!navigator.canShare?.({ files: e.dateien }) && (ios || /Android/.test(navigator.userAgent));
    const mb = (e.groesse / 1048576).toFixed(1).replace(".", ",");
    bild(`<p>${plural(e.plaetze, "Platz", "Plätze")}${e.fotos ? ` und ${plural(e.fotos, "Foto", "Fotos")}` : ""}, ${mb} MB${e.dateien.length > 1 ? `, aufgeteilt in ${e.dateien.length} Dateien. Zum Einlesen alle nacheinander öffnen.` : "."}${e.fehlend ? ` ${plural(e.fehlend, "Foto fehlt", "Fotos fehlen")}, weil die Bilddaten nicht lesbar sind.` : ""}</p>
      <p class="grau klein">${teilen ? "Zum Sichern „In Dateien sichern“ und iCloud Drive wählen, dann überlebt es auch ein verlorenes Gerät." : "Lege die Datei am besten in einen Ordner, der selbst gesichert wird."} Die Datei enthält die genauen Orte.</p>`,
      `<button class="knopf haupt" style="flex:1" id="b-sichern">${teilen ? "Sichern oder teilen" : e.dateien.length > 1 ? `${e.dateien.length} Dateien herunterladen` : "Herunterladen"}</button>`);
    $("#b-sichern").onclick = async () => {
      try {
        if (teilen) await navigator.share({ files: e.dateien });
        else {
          for (const datei of e.dateien) {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(datei);
            a.download = datei.name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 60000);
            await new Promise((ok) => setTimeout(ok, 400)); // mehrere Downloads nacheinander, sonst blockt der Browser
          }
        }
      } catch (x) {
        if (x.name !== "AbortError") this.meldung(`Fehler: ${x.message}`, true);
        return; // abgebrochen: nicht als gesichert zählen
      }
      if (e.vollstaendig) await speicher.backupGemerkt(e.zeit, e.stand);
      d.close();
      await this.laden();
      this.meldung(e.vollstaendig ? "Backup gesichert" : "Export gesichert");
    };
  },

  // ------------------------------------------------------------ Import

  importZeigen() {
    if (this.formularOffen()) return this.meldung("Erst speichern oder abbrechen.");
    const d = $("#import");
    d.innerHTML = `<div class="f-kopf"><h2 tabindex="-1" autofocus>Importieren</h2><button class="rund" data-zu aria-label="Schließen">${icon("close")}</button></div>
      <div class="f-rollen"><div class="block">
        <label class="zeile wahlzeile">${icon("map")}<span>Datei wählen<small>Backup, GPX, KML/KMZ, GeoJSON, CSV oder Google Takeout („Saved Places.json“)</small></span><input type="file" id="i-datei" hidden></label>
        <label class="zeile wahlzeile">${icon("image-plus")}<span>Fotos mit Ort<small>Legt Plätze dort an, wo die Fotos aufgenommen wurden</small></span><input type="file" id="i-fotos" accept="image/jpeg,image/*" multiple hidden></label></div>
        <p class="grau klein">Vor dem Übernehmen siehst du, was gefunden wurde. Nichts wird hochgeladen.</p></div>`;
    $("#i-datei").onchange = (e) => { const f = e.target.files[0]; if (f) this.importLesen(f); };
    $("#i-fotos").onchange = (e) => { const f = [...e.target.files]; if (f.length) this.importFotos(f); };
    this.fensterOeffnen("#import");
  },

  importBild(titel, inhalt, fuss) {
    const d = $("#import");
    d.innerHTML = `<div class="f-kopf"><h2 tabindex="-1">${esc(titel)}</h2><button class="rund" data-zu aria-label="Schließen">${icon("close")}</button></div><div class="f-rollen">${inhalt}</div><div class="f-fuss">${fuss}</div>`;
    return d;
  },
  importFehler(text) { this.importBild("Importieren", `<p>${esc(text)}</p>`, `<button class="knopf" id="i-zurueck">Zurück</button><button class="knopf haupt" style="flex:1" data-zu>Schließen</button>`); $("#i-zurueck").onclick = () => this.importZeigen(); },

  async importLesen(datei) {
    this.importBild("Importieren", `<p>Datei wird gelesen …</p>`, "");
    let r;
    try { r = await dateiLesen(datei); } catch (e) { return this.importFehler(e.message); }
    if (r.backup) return this.einspielenZeigen(datei);
    const { plaetze: bestand } = await speicher.alles();
    let tauschen = false, besuche = false, art = "", eintraege, aus, antworten;
    const mitDatum = r.kandidaten.some((k) => k.datum), ohneArt = r.kandidaten.some((k) => !k.art);
    // Ohne IDs und Änderungszeiten zählt nur der Ort. Treffer im Umkreis bleiben abgewählt, außer gleicher Name ≤ 30 m (füllt nur leere Felder).
    const rechnen = () => {
      ({ eintraege } = abgleichen({ bestand, plaetze: quelle.kandidatenAlsPlaetze(r.kandidaten, { besuche, art }), mitZeiten: false }));
      eintraege.forEach((e, i) => (e.k = r.kandidaten[i]));
      antworten = eintraege.map(() => []);
      aus = new Set();
    };
    rechnen();
    const zeigen = () => this.vorschau({
      titel: `Aus ${r.quelle}`, eintraege, aus, antworten,
      kopf: () => `${r.doppelt || r.ohneOrt || r.fotolinks || r.bilderFehlen ? `<p class="grau klein">${[r.doppelt && `${plural(r.doppelt, "Eintrag war", "Einträge waren")} doppelt.`, r.ohneOrt && `${plural(r.ohneOrt, "Eintrag hat", "Einträge haben")} keine Koordinaten und ${r.ohneOrt === 1 ? "fehlt" : "fehlen"}.`,
          r.fotolinks && `${plural(r.fotolinks, "Fotolink ins Netz wird", "Fotolinks ins Netz werden")} nicht geladen.`, r.bilderFehlen && `${plural(r.bilderFehlen, "Bild fehlt", "Bilder fehlen")} in der Datei.`].filter(Boolean).join(" ")}</p>` : ""}
        ${r.tauschbar ? `<label class="zeile"><span>Breite und Länge vertauschen<small>Falls die Koordinaten unten nicht stimmen können</small></span><input type="checkbox" class="schalter" id="i-tausch" ${tauschen ? "checked" : ""}></label>` : ""}
        ${mitDatum ? `<label class="zeile"><span>Datum als Besuch übernehmen<small>Aus: alle Plätze werden vorgemerkt. Bei GPX ist das Datum oft nur der Tag des Speicherns.</small></span><input type="checkbox" class="schalter" id="i-besuche" ${besuche ? "checked" : ""}></label>` : `<p class="grau klein">Die Plätze werden vorgemerkt, Besuche kannst du danach eintragen.</p>`}
        ${ohneArt ? `<label class="zeile"><span>Art, wo sie fehlt</span><select id="i-art"><option value="">offen lassen</option>${ARTEN.map(([t]) => `<option ${t === art ? "selected" : ""}>${t}</option>`).join("")}</select></label>` : ""}`,
      zusatz: (e) => [e.platz.art, e.k.datum && datum(`${e.k.datum}T12:00`), e.k.bilder.length && `+${plural(e.k.bilder.length, "Foto", "Fotos")}`, `${e.platz.lat.toFixed(4)}, ${e.platz.lon.toFixed(4)}`].filter(Boolean).join(" · "),
      hinweis: "Orte in der Nähe vorhandener Plätze werden nur übernommen, wenn du es wählst; „derselbe Platz“ füllt dort nur leere Felder.",
      binden: () => {
        const neu = () => { rechnen(); zeigen(); };
        if ($("#i-tausch")) $("#i-tausch").onchange = (e) => { tauschen = e.target.checked; Object.assign(r, auswerten(r.roh, tauschen)); neu(); };
        if ($("#i-besuche")) $("#i-besuche").onchange = (e) => { besuche = e.target.checked; neu(); };
        if ($("#i-art")) $("#i-art").onchange = (e) => { art = e.target.value; neu(); };
      },
      uebernehmen: async (ergebnisse) => {
        const { z, rueck } = await speicher.uebernehmen({ schreiben: ergebnisse.map((x) => x.platz), letzteAenderung });
        // Eingebettete Bilder (KMZ) wie ein Upload: verkleinert, ohne EXIF; Aufnahmezeit nur aus dem EXIF
        const kNach = new Map(eintraege.map((e) => [e.platz.id, e.k])), bilder = ergebnisse.flatMap((x) => (kNach.get(x.von)?.bilder || []).map((b) => [x.fotoZiel, b]));
        const fotos = [];
        let fehler = 0;
        for (const [i, [platz, b]] of bilder.entries()) {
          const s = $("#b-stand");
          if (s) s.textContent = `Foto ${i + 1} von ${bilder.length} …`;
          try { fotos.push(await quelle.fotoAnlegen(platz, new File([await b.laden()], b.name), { ohneZeit: true })); } catch (e) { fehler++; }
        }
        if (fotos.length) this.bilderNeu();
        const text = [z.neu && plural(z.neu, "neuer Platz", "neue Plätze"), z.aktualisiert && `${plural(z.aktualisiert, "vorhandener Platz", "vorhandene Plätze")} ergänzt`,
          fotos.length && plural(fotos.length, "Foto", "Fotos"), fehler && `${plural(fehler, "Bild", "Bilder")} nicht lesbar`].filter(Boolean);
        await this.importFertig(`Übernommen: ${text.join(", ") || "nichts"}.`, async () => {
          for (const id of fotos) await quelle.fotoEntfernen(id, { vermerken: false });
          await speicher.zuruecknehmen(rueck);
          if (fotos.length) this.bilderNeu();
        }, ergebnisse.map((x) => x.platz.id));
      },
    });
    zeigen();
  },

  async importFotos(dateien) {
    this.importBild("Fotos mit Ort", `<p id="i-stand">Fotos werden gelesen …</p>`, "");
    const { gruppen, ohneOrt } = await fotosLesen(dateien, (n, g) => { const z = $("#i-stand"); if (z) z.textContent = `Foto ${n} von ${g} wird gelesen …`; });
    const hinweis = `${plural(ohneOrt, "Foto enthält", "Fotos enthalten")} keinen Ort.${ios ? " Auf dem iPhone beim Auswählen oben auf „Optionen“ tippen und „Standort“ einschalten." : ""}`;
    if (!gruppen.length) return this.importFehler(hinweis);
    const eintraege = gruppen.map((g) => ({ g, da: quelle.bei(this.daten.plaetze, g.lat, g.lon) })).sort((a, b) => !!b.da - !!a.da);
    this.importBild("Fotos mit Ort", `${ohneOrt ? `<p>${esc(hinweis)}</p>` : ""}<p class="grau klein">Je Ort ein Platz, je Tag ein Besuch ohne Übernachtung. Fotos an vorhandenen Plätzen kommen dort dazu.</p>
      <div class="block i-liste">${eintraege.map((e, i) => `<label class="zeile i-zeile"><input type="checkbox" data-i="${i}" checked><span>${e.da ? `zu „${esc(e.da.name)}“` : `Neuer Platz <span class="grau">${e.g.lat.toFixed(4)}, ${e.g.lon.toFixed(4)}</span>`}<small>${plural(e.g.fotos.length, "Foto", "Fotos")}${e.g.tage.length ? ` · ${e.g.tage.slice(0, 3).map((t) => datum(`${t}T12:00`)).join(", ")}${e.g.tage.length > 3 ? " …" : ""}` : ""}</small></span></label>`).join("")}</div>`,
      `<button class="knopf haupt" style="flex:1" id="i-ok">Übernehmen</button>`);
    const haken = [...$("#import").querySelectorAll("[data-i]")], knopf = $("#i-ok");
    haken.forEach((h) => (h.onchange = () => (knopf.disabled = !haken.some((x) => x.checked))));
    knopf.onclick = async () => {
      const wahl = haken.filter((h) => h.checked).map((h) => eintraege[h.dataset.i]), summe = wahl.reduce((s, e) => s + e.g.fotos.length, 0);
      this.importBild("Fotos mit Ort", `<p id="i-stand">Wird übernommen …</p>`, "");
      const neu = [], besuche = [], fotos = [], fehler = [];
      let n = 0;
      const zurueck = async () => {
        for (const f of fotos) await quelle.fotoEntfernen(f, { vermerken: false });
        for (const [p, b] of besuche) await quelle.besuchAendern(p, b, { weg: true });
        if (neu.length) await quelle.entfernen(neu);
      };
      try {
        for (const { g, da } of wahl) {
          const id = da?.id || (await quelle.anlegen({ lat: g.lat, lon: g.lon }));
          if (!da) neu.push(id);
          // Tage, die schon in einem Besuch liegen, nicht doppelt eintragen
          for (const t of g.tage) if (!da?.besuche_liste.some((b) => b.ankunft.slice(0, 10) <= t && (!b.abfahrt || b.abfahrt.slice(0, 10) >= t))) besuche.push([id, await quelle.besuchAnlegen(id, { ankunft: `${t}T12:00`, abfahrt: `${t}T12:00`, ganztags: true })]);
          for (const f of g.fotos) {
            const z = $("#i-stand");
            if (z) z.textContent = `Foto ${++n} von ${summe} …`;
            try { fotos.push(await quelle.fotoAnlegen(id, f.datei)); } catch (e) { fehler.push(e.message); }
          }
        }
        await this.importFertig(`${plural(fotos.length, "Foto", "Fotos")} übernommen, ${plural(neu.length, "neuer Platz", "neue Plätze")}.${fehler.length ? ` Nicht übernommen: ${fehler.length} (${fehler[0]}).` : ""}`, zurueck, wahl.map((e, i) => e.da?.id).concat(neu).filter(Boolean));
      } catch (e) {
        await zurueck().catch(() => {});
        await this.laden();
        this.importFehler(`Nichts übernommen: ${e.message}`);
      }
    };
  },

  /** Ergebnis mit „Rückgängig“; die Karte zeigt die übernommenen Plätze. */
  async importFertig(text, zurueck, ids) {
    this.importBild("Importiert", `<p>${esc(text)}</p>`, `<button class="knopf" id="i-rueck">Rückgängig</button><button class="knopf haupt" style="flex:1" data-zu>Fertig</button>`);
    $("#i-rueck").onclick = async (e) => {
      e.currentTarget.disabled = true;
      try { await zurueck(); $("#import").close(); await this.laden(); this.meldung("Import rückgängig gemacht"); } catch (x) { this.meldung(`Fehler: ${x.message}`, true); }
    };
    Object.assign(this.ansicht, structuredClone(FILTER_LEER), { text: "" });
    $("#suche").value = "";
    this.merken();
    await this.laden();
    this.karte?.alle(this.daten.plaetze.filter((p) => ids.includes(p.id)));
  },

  /**
   * Vorschau eines Abgleichs (abgleich.js) für Backup und fremde Formate. o: { titel, eintraege, aus: Set abgewählter, antworten,
   * kopf(): HTML über den Listen, zusatz(e): Text je neuem Platz, hinweis, bereit(): auch ohne Plätze übernehmbar, binden(): eigene Felder,
   * uebernehmen(ergebnisse, nichtZurueck), ersetzen(): Notfallknopf }
   */
  vorschau(o) {
    const { eintraege, aus, antworten } = o;
    const wert = (feld, w) => (w === null || w === undefined || w === "" ? "–" : feld === "preis" ? preisText(w) : feld === "bewertung" ? (w ? `${w} ★` : "–")
      : feld === "notiz" ? (String(w).length > 140 ? `${String(w).slice(0, 140)} …` : String(w)) : String(w));
    const zeitraum = (x) => `${datum(x.ankunft)}${x.abfahrt && x.abfahrt.slice(0, 10) !== x.ankunft.slice(0, 10) ? `–${datum(x.abfahrt)}` : ""}`;
    const frageText = (e, f) => ({
      vermerkt: () => `Hier am ${datum(f.zeit)} endgültig entfernt.`,
      ort: () => `Liegt ${Math.round(f.abstand * 1000)} m von „${e.ziel?.name || "Ohne Namen"}“.`,
      feld: () => `${FELDNAMEN[f.feld]}: hier „${wert(f.feld, f.hier)}“ · in der Datei „${wert(f.feld, f.dort)}“`,
      geloescht: () => (f.seite === "dort" ? "In der Datei gelöscht, hier danach geändert." : "Hier gelöscht, in der Datei danach geändert."),
      besuch: () => `Besuch ${zeitraum(f.besuch)} überschneidet sich mit ${zeitraum(f.mit)}.`,
    }[f.typ]());
    const TYPNAMEN = { vermerkt: "hier gelöscht", ort: "Platz in der Nähe", feld: "verschiedene Werte", geloescht: "gelöscht", besuch: "Besuche überschneiden sich" };
    const fragenVon = (i) => [...eintraege[i].fragen, ...folgefragen(eintraege[i], antworten[i])];
    const zeile = (e, i, zusatz) => `<label class="zeile i-zeile"><input type="checkbox" data-i="${i}" ${aus.has(i) ? "" : "checked"}><span>${esc(e.platz.name || "Ohne Namen")}<small>${esc(zusatz)}</small></span></label>`;
    const zeichnen = () => {
      const rollen = $("#import .f-rollen"), pos = rollen?.scrollTop || 0;
      const g = (n) => eintraege.map((e, i) => [e, i]).filter(([e]) => e.gruppe === n);
      const fr = g("frage"), ne = g("neu"), ak = g("aktualisiert"), gl = g("gleich");
      const anzahl = {};
      fr.forEach(([, i]) => fragenVon(i).forEach((f) => (anzahl[f.typ] = (anzahl[f.typ] || 0) + 1)));
      const typen = Object.keys(anzahl).filter((t) => anzahl[t] > 1); // „für alle“ erst ab zwei gleichen Fragen
      const alleGleich = typen.map((t) => {
        const opt = fr.flatMap(([, i]) => fragenVon(i)).find((f) => f.typ === t).optionen;
        return `<label class="zeile"><span>Alle „${TYPNAMEN[t]}“</span><select data-alle="${t}"><option value="">einzeln</option>${opt.map(([w, x]) => `<option value="${w}">${esc(x)}</option>`).join("")}</select></label>`;
      }).join("");
      const karten = fr.map(([e, i]) => `<div class="block i-frage">${zeile(e, i, e.fragen[0]?.typ === "vermerkt" ? "hier gelöscht" : e.ziel && e.fragen[0]?.typ !== "ort" ? "schon vorhanden" : o.zusatz?.(e) || "")}
        ${fragenVon(i).map((f, j) => `<div class="i-q"><p class="klein">${esc(frageText(e, f))}</p><div class="i-optionen">${f.optionen.map(([w, t]) =>
          `<label><input type="radio" name="q-${i}-${j}" value="${w}" data-q="${i}-${j}" ${(antworten[i][j] ?? f.vorgabe) === w ? "checked" : ""}>${esc(t)}</label>`).join("")}</div></div>`).join("")}</div>`).join("");
      const n = eintraege.filter((e, i) => e.gruppe !== "gleich" && !aus.has(i) && aufloesen(e, antworten[i]) !== null).length;
      const zusammen = [ne.length && plural(ne.length, "neuer Platz", "neue Plätze"), ak.length && `${ak.length} aktualisiert`, gl.length && `${gl.length} unverändert`, fr.length && plural(fr.length, "Frage", "Fragen")].filter(Boolean).join(", ") || "nichts Neues";
      const neuAlle = ne.length > 1 ? `<label class="zeile"><input type="checkbox" id="i-alle" ${ne.every(([, i]) => !aus.has(i)) ? "checked" : ""}><span><b>Alle neuen</b></span></label>` : "";
      this.importBild(o.titel, `<p>${esc(o.vorText || "Gefunden")}: ${zusammen}.</p>${o.kopf?.() || ""}
        ${fr.length ? `<h3 class="i-titel">Fragen</h3>${typen.length ? `<div class="block">${alleGleich}</div>` : ""}${karten}` : ""}
        ${ne.length ? `<h3 class="i-titel">Neu</h3><div class="block i-liste">${neuAlle}${ne.map(([e, i]) => zeile(e, i, o.zusatz?.(e) || "")).join("")}</div>` : ""}
        ${ak.length ? `<h3 class="i-titel">Wird aktualisiert</h3><div class="block i-liste">${ak.map(([e, i]) => zeile(e, i, ["jüngere Änderungen aus der Datei", e.neueFotos && `+${plural(e.neueFotos, "Foto", "Fotos")}`].filter(Boolean).join(" · "))).join("")}</div>` : ""}
        ${o.hinweis ? `<p class="grau klein">${esc(o.hinweis)}</p>` : ""}
        ${o.ersetzen ? `<button class="knopf warnung" id="i-ersetzen">Stattdessen alles ersetzen …</button>` : ""}`,
        `<button class="knopf haupt" style="flex:1" id="i-ok" ${n || o.bereit?.() ? "" : "disabled"}>${n ? `${plural(n, "Platz", "Plätze")} übernehmen` : o.bereit?.() ? "Übernehmen" : "Nichts ausgewählt"}</button>`);
      const d = $("#import");
      d.querySelector(".f-rollen").scrollTop = pos;
      d.querySelectorAll("[data-i]").forEach((h) => (h.onchange = () => { h.checked ? aus.delete(Number(h.dataset.i)) : aus.add(Number(h.dataset.i)); zeichnen(); }));
      if ($("#i-alle")) $("#i-alle").onchange = (x) => { ne.forEach(([, i]) => (x.target.checked ? aus.delete(i) : aus.add(i))); zeichnen(); };
      d.querySelectorAll("[data-q]").forEach((r) => (r.onchange = () => {
        const [i, j] = r.dataset.q.split("-").map(Number);
        antworten[i][j] = r.value;
        if (eintraege[i].fragen[j]?.typ === "ort") { antworten[i].length = 1; if (r.value !== "ueberspringen") aus.delete(i); } // Antwort heißt: übernehmen
        zeichnen();
      }));
      d.querySelectorAll("[data-alle]").forEach((s) => (s.onchange = () => {
        if (!s.value) return;
        fr.forEach(([, i]) => fragenVon(i).forEach((f, j) => { if (f.typ === s.dataset.alle && f.optionen.some(([w]) => w === s.value)) { antworten[i][j] = s.value; if (f.typ === "ort") aus.delete(i); } }));
        zeichnen();
      }));
      if ($("#i-ersetzen")) $("#i-ersetzen").onclick = () => o.ersetzen();
      o.binden?.(zeichnen);
      $("#i-ok").onclick = async () => {
        const ergebnisse = [];
        let nichtZurueck = 0;
        eintraege.forEach((e, i) => {
          if (aus.has(i) || e.gruppe === "gleich") return;
          const r = aufloesen(e, antworten[i]);
          if (r) ergebnisse.push({ von: e.platz.id, ...r }); else if (e.fragen[0]?.typ === "vermerkt") nichtZurueck++;
        });
        this.importBild(o.titel, `<p id="b-stand">Wird übernommen …</p>`, "");
        try { await o.uebernehmen(ergebnisse, nichtZurueck); } catch (e) { this.importFehler(`Nichts geändert. ${e.message}`); }
      };
    };
    zeichnen();
  },

  /** Backup: Vorschau mit Abgleich (KONZEPT-WEBAPP.md 12.8.3/12.8.4); bei leerem Bestand direkt einspielen. */
  async einspielenZeigen(datei) {
    if ($("#menue").open) $("#menue").close();
    if (!$("#import").open) this.fensterOeffnen("#import");
    this.importBild("Backup", `<p>Datei wird geprüft …</p>`, "");
    let b;
    try { b = await backupLesen(datei); } catch (e) { return this.importFehler(e.message); }
    const { plaetze: bestand, fotos: fotosHier } = await speicher.alles();
    const vom = b.erstellt ? ` vom ${uhrzeit(b.erstellt)}` : "";
    const verworfen = b.verworfen ? `<p class="grau klein">${plural(b.verworfen, "Eintrag ist", "Einträge sind")} unlesbar und ${b.verworfen === 1 ? "wird" : "werden"} übersprungen.</p>` : "";
    if (!bestand.length) {
      this.importBild("Backup", `<p>Backup${esc(vom)}: ${plural(b.sichtbar, "Platz", "Plätze")}, ${plural(b.fotos.length, "Foto", "Fotos")}.</p>${verworfen}`,
        `<button class="knopf haupt" style="flex:1" id="i-ok">Einspielen</button>`);
      $("#i-ok").onclick = () => this.ersetzenAusfuehren(b);
      return;
    }
    const vermerke = await speicher.vermerke(), hierIds = new Set(fotosHier.map((f) => f.id));
    const { eintraege } = abgleichen({ bestand, plaetze: b.plaetze, fotos: b.fotos, vermerke, bekannteFotos: hierIds });
    const ent = entfernungen(bestand, b.entfernt), fotosWeg = b.fotoVermerke.filter((f) => hierIds.has(f.id)).length;
    let entfernen = true;
    this.vorschau({
      titel: "Backup", vorText: `Backup${vom}`, eintraege, aus: new Set(), antworten: eintraege.map(() => []),
      kopf: () => `${verworfen}
        ${ent.entfernen.length || fotosWeg ? `<label class="zeile"><span>Im Backup Gelöschtes auch hier entfernen<small>${esc([ent.entfernen.length && `${plural(ent.entfernen.length, "Platz", "Plätze")}: ${ent.entfernen.slice(0, 5).map((p) => p.name || "Ohne Namen").join(", ")}${ent.entfernen.length > 5 ? " …" : ""}`, fotosWeg && plural(fotosWeg, "Foto", "Fotos")].filter(Boolean).join(" · "))}</small></span><input type="checkbox" class="schalter" id="i-entfernen" ${entfernen ? "checked" : ""}></label>` : ""}
        ${ent.behalten.length ? `<p class="grau klein">${plural(ent.behalten.length, "Platz bleibt", "Plätze bleiben")}, obwohl im Backup gelöscht: hier danach geändert.</p>` : ""}`,
      zusatz: (e) => [e.platz.art, e.neueFotos && plural(e.neueFotos, "Foto", "Fotos"), `${e.platz.lat.toFixed(4)}, ${e.platz.lon.toFixed(4)}`].filter(Boolean).join(" · "),
      hinweis: "Vorhandene Werte werden nur durch jüngere Änderungen ersetzt; im Zweifel wird gefragt. Danach lässt sich alles rückgängig machen.",
      bereit: () => entfernen && !!(ent.entfernen.length || fotosWeg),
      binden: (neuZeichnen) => { if ($("#i-entfernen")) $("#i-entfernen").onchange = (e) => { entfernen = e.target.checked; neuZeichnen(); }; },
      ersetzen: async () => {
        if (await this.frage({ titel: "Alles ersetzen?", text: `Alle ${plural(bestand.filter((p) => !p.geloescht).length, "vorhandene Platz", "vorhandenen Plätze")} samt Fotos werden gelöscht, auch der Papierkorb. Das lässt sich nicht rückgängig machen.`, knopf: "Ersetzen", warnung: true })) this.ersetzenAusfuehren(b);
      },
      uebernehmen: async (ergebnisse, nichtZurueck) => {
        const { z, rueck } = await backupUebernehmen(b, ergebnisse, { entfernen }, (x, y) => { const s = $("#b-stand"); if (s) s.textContent = `Foto ${x} von ${y} …`; });
        const text = [z.neu && plural(z.neu, "neuer Platz", "neue Plätze"), z.aktualisiert && `${z.aktualisiert} aktualisiert`, z.fotos && plural(z.fotos, "Foto", "Fotos"),
          z.entfernt && `${plural(z.entfernt, "Platz", "Plätze")} entfernt (im Backup gelöscht)`, z.fotosEntfernt && `${plural(z.fotosEntfernt, "Foto", "Fotos")} entfernt (im Backup gelöscht)`,
          z.behalten && `${plural(z.behalten, "Platz", "Plätze")} behalten (hier nach dem Löschen geändert)`, nichtZurueck && `${plural(nichtZurueck, "gelöschter Platz", "gelöschte Plätze")} nicht zurückgeholt`,
          z.fotosUebersprungen && `${plural(z.fotosUebersprungen, "gelöschtes Foto", "gelöschte Fotos")} nicht zurückgeholt`].filter(Boolean);
        this.bilderNeu();
        await this.importFertig(`Übernommen: ${text.join(", ") || "nichts geändert"}.`, async () => { await speicher.zuruecknehmen(rueck); this.bilderNeu(); }, ergebnisse.map((x) => x.platz.id));
      },
    });
  },

  /** Ganzes Backup einspielen und den Bestand ersetzen (leerer Bestand oder Notfall). */
  async ersetzenAusfuehren(b) {
    this.importBild("Backup", `<p id="b-stand">Wird eingespielt …</p>`, "");
    let z;
    try { z = await backupEinspielen(b, true, (n, g) => { const s = $("#b-stand"); if (s) s.textContent = `Foto ${n} von ${g} …`; }); } catch (e) {
      return this.importFehler(`Nichts geändert. ${e.message}`);
    }
    this.bilderNeu();
    $("#import").close();
    location.hash = "#/";
    await this.laden();
    this.meldung(`Backup eingespielt${z.uebersprungen ? ` · ${plural(z.uebersprungen, "gelöschter Platz", "gelöschte Plätze")} nicht zurückgeholt` : ""}`);
  },

  bilderNeu() {
    quelle.bilderVergessen();
    this.karte?.fotosVergessen();
    this.ersterAusschnitt = false;
    this.listeHtml = this.detailHtml = null;
  },

  /** Darstellung der ganzen App samt Karte: hell, dunkel oder automatisch (wie das Gerät). */
  darstellungSetzen(modus) {
    this.ansicht.darstellung = ["hell", "dunkel", "auto"].includes(modus) ? modus : "auto";
    this.merken();
    this.themaAnwenden();
  },
  themaAnwenden() {
    const a = this.ansicht.darstellung, dunkel = a === "dunkel" || (a === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.thema = dunkel ? "dunkel" : "hell";
    document.querySelector('meta[name="theme-color"]').content = dunkel ? "#16201d" : "#f4f4ec";
    this.karte?.stilSetzen({ dunkel });
    return dunkel;
  },

  // ------------------------------------------------------------ Liste

  gefiltert() {
    const a = this.ansicht, text = a.text.trim().toLowerCase();
    return (this.daten?.plaetze || []).map((p) => ({ ...p, _km: this.hier ? km(this.hier[0], this.hier[1], p.lat, p.lon) : null }))
      .filter((p) =>
        (!text || [p.name, p.land, p.art, p.notiz, preisText(p.preis), ...AKTIVITAETEN.filter(([k]) => (p.aktivitaeten || []).includes(k)).map(([, t]) => t)]
          .join(" ").toLowerCase().includes(text)) &&
        (!a.arten.length || a.arten.includes(p.art)) &&
        a.ausstattung.every((k) => p[k]) &&
        a.aktivitaeten.every((k) => (p.aktivitaeten || []).includes(k)) &&
        (a.maxPreis < 0 || (p.preis !== null && p.preis !== undefined && p.preis <= a.maxPreis)) &&
        (p.bewertung || 0) >= a.minSterne && (!a.unbeschrieben || !p.gepflegt) && (!a.vorgemerkt || p.vorgemerkt))
      .sort(SORTIERUNG[a.sort]?.[1] || SORTIERUNG.zuletzt[1]);
  },

  zeichnen() {
    document.body.classList.toggle("mit-detail", !!this.route.platz);
    this.schnellfilterZeichnen();
    if (!this.daten) {
      $("#listenkopf").hidden = true;
      $("#liste").innerHTML = `<div class="leer">Lade Stellplätze …</div>`;
      return;
    }
    $("#listenkopf").hidden = !this.daten.plaetze.length;
    $("#schnellfilter").hidden = !this.daten.plaetze.length;
    const liste = this.gefiltert(), gesamt = this.daten.plaetze.length;
    $("#zaehler").textContent = liste.length === gesamt ? plural(gesamt, "Stellplatz", "Stellplätze") : `${liste.length} von ${gesamt} Stellplätzen`;
    const gefiltert = this.filterZahl() || this.ansicht.text.trim();
    const hier = !gefiltert && this.platz(this.hierId());
    let jahr = null;
    const zeilen = liste.filter((p) => p.id !== hier?.id).map((p) => {
      const j = this.ansicht.sort !== "zuletzt" ? null : p.vorgemerkt ? "Vorgemerkt" : new Date(p.letzter_besuch).getFullYear();
      const kopf = j && j !== jahr && !gefiltert ? `<div class="jahr">${(jahr = j)}</div>` : "";
      return kopf + this.zeileHtml(p);
    }).join("");
    const html = !gesamt ? this.willkommenHtml() : (hier ? this.zeileHtml(liste.find((p) => p.id === hier.id), true) : "") + (zeilen ||
      (hier ? "" : `<div class="leer">Keine Stellplätze für diese Auswahl.<button class="knopf zart" data-zuruecksetzen>Suche und Filter zurücksetzen</button></div>`));
    // Nur bei echten Änderungen neu setzen: sonst flackern die Bilder und die Rollposition springt
    if (html !== this.listeHtml) {
      this.listeHtml = html;
      $("#liste").innerHTML = html;
      this.bilderEinsetzen($("#liste"));
    }
    this.detailZeichnen();
    this.karteZeichnen(liste);
    this.blatt.anordnen();
  },

  willkommenHtml() {
    return `<div class="willkommen"><img src="icon-192.png?v=13" alt=""><h2>Frag Herbert</h2><p>Dein Stellplatzbuch: Plätze sammeln, beschreiben und wiederfinden.<br>Alles bleibt auf deinem Gerät.</p>
      ${TESTVERSION ? `<p class="grau klein"><b>Testversion ${VERSION}</b> – Funktionen können sich noch ändern. Bitte regelmäßig ein Backup machen (Einstellungen → Exportieren).</p>` : ""}
      ${ios && !installiert() ? `<div class="aufruf">${icon("information-outline")}<span>Bitte zuerst auf den Home-Bildschirm legen, sonst kann Safari deine Plätze später löschen.</span><button class="knopf flach" data-installieren>So geht’s</button></div>` : ""}
      <button class="knopf haupt" data-neu>${icon("map-marker-plus")}Ersten Platz anlegen</button><button class="knopf zart" data-import>Importieren oder Backup einspielen</button></div>`;
  },

  zeileHtml(p, jetzt = false) {
    const s = this.ansicht.sort, hier = p.id === this.hierId();
    const preis = preisText(p.preis);
    // Zweite Zeile: das Sortierkriterium steht vorn und hervorgehoben, der Rest grau
    const teile = [
      ["entfernung", p._km !== null && !hier ? kmText(p._km) : ""],
      [s === "besuche" ? "besuche" : "naechte", s === "besuche" ? plural(p.besuche, "Besuch", "Besuche") : p.naechte ? plural(p.naechte, "Nacht", "Nächte") : p.geparkt ? `${p.geparkt}× geparkt` : ""],
      ["zuletzt", p.vorgemerkt ? "vorgemerkt" : vorZeit(p.letzter_besuch)],
    ].filter(([, t]) => t).sort((a, b) => (b[0] === s) - (a[0] === s)).map(([k, t]) => (k === s && s !== "zuletzt" ? `<b>${t}</b>` : t));
    return `<a class="platz ${jetzt ? "jetzt" : ""}" href="${platzLink(p.id)}" data-id="${esc(p.id)}" style="${artFarbe(p.art)}">
      <div class="bild">${p.titelbild ? `<img data-medium="${esc(p.titelbild)}" alt="" loading="lazy">` : icon(artName(p.art))}</div>
      <div class="text">
        <div class="name"><span>${esc(p.name)}</span>${hier && !jetzt ? `<span class="etikett hier">Hier</span>` : p.gepflegt ? "" : `<span class="etikett">Offen</span>`}</div>
        <div class="zeile1">${p.art ? `<span class="art">${icon(artName(p.art))}${esc(p.art)}</span>` : ""}${preis ? `<span class="${p.preis === 0 ? "frei" : ""}">${preis}</span>` : ""}${p.bewertung ? `<span class="note">${icon("star")}${p.bewertung}</span>` : ""}</div>
        <div class="zeile2">${jetzt ? "Du bist gerade hier" : teile.join(" · ")}${p.land && p.land !== "DE" ? ` · ${esc(p.land)}` : ""}</div>
      </div>
      <span class="nav-knopf" role="link" data-nav="${esc(p.google)}" title="Navigation mit Google Maps" aria-label="Navigation">${icon("directions")}</span></a>`;
  },

  bilderEinsetzen(wurzel) {
    wurzel.querySelectorAll("img[data-medium]").forEach(async (img) => {
      const url = await quelle.bild(img.dataset.medium).catch(() => null);
      if (url) img.src = url;
      if (!img.dataset.gut) return;
      const gut = await quelle.bild(img.dataset.gut).catch(() => null); // schärfer, sobald geladen
      if (gut) { const g = new Image(); g.onload = () => (img.src = gut); g.src = gut; }
    });
  },

  // ------------------------------------------------------------ Details

  platz(id) { return this.daten?.plaetze.find((p) => p.id === id); },

  /** Platz, an dem dieses Gerät gerade ist (Standort im Umkreis), sonst null. */
  hierId() { return (this.hier && this.daten && quelle.bei(this.daten.plaetze, this.hier[0], this.hier[1])?.id) || null; },

  detailZeichnen() {
    const ziel = $("#detail");
    const p = this.route.platz && this.platz(this.route.platz);
    ziel.hidden = !p;
    if (!p) {
      this.detailHtml = null;
      if (this.route.platz && this.daten) location.hash = "#/";
      return;
    }
    if (this.route.bearbeiten) {
      if (ziel.dataset.formular === p.id) return; // Eingaben nicht überschreiben
      ziel.dataset.formular = p.id;
      this.detailHtml = null;
      ziel.innerHTML = this.formularHtml(p);
      this.formularVerbinden(p);
      return;
    }
    const html = this.detailInhalt(p);
    if (html === this.detailHtml && !ziel.dataset.formular) return;
    delete ziel.dataset.formular;
    // Gleicher Platz mit neuen Daten: Rollposition, Foto und Aufgeklapptes behalten
    const gleich = this.detailId === p.id;
    const rollen = gleich ? ziel.querySelector(".d-rollen")?.scrollTop || 0 : 0, band = gleich ? ziel.querySelector(".fotoband")?.scrollLeft || 0 : 0;
    const korrigieren = gleich && !!ziel.querySelector(".besuche.korrigieren"), notizAuf = gleich && !!ziel.querySelector(".notiz:not(.gekuerzt)");
    this.detailHtml = html;
    this.detailId = p.id;
    ziel.innerHTML = html;
    this.bilderEinsetzen(ziel);
    this.detailVerbinden(p, { korrigieren, notizAuf });
    ziel.querySelector(".d-rollen").scrollTop = rollen;
    const b = ziel.querySelector(".fotoband");
    if (b) b.scrollLeft = band;
  },

  detailInhalt(p) {
    const hier = p.id === this.hierId();
    const merkmale = AUSSTATTUNG.filter(([k]) => p[k]).map(([, t, s]) => `<span class="merkmal">${icon(s)}${t}</span>`).join("");
    const aktiv = AKTIVITAETEN.filter(([k]) => (p.aktivitaeten || []).includes(k)).map(([, t, s]) => `<span class="merkmal akt">${icon(s)}${t}</span>`).join("");
    const entf = this.hier && !hier ? kmText(km(this.hier[0], this.hier[1], p.lat, p.lon)) : "";
    const fotos = [...p.fotoliste].sort((a, b) => (b.name === p.titelfoto) - (a.name === p.titelfoto));
    const naechte = p.naechte || p.geparkt;
    return `
      <div class="d-kopf" style="${artFarbe(p.art)}"><div class="d-titel"><h1>${esc(p.name)}</h1>
        <div class="d-meta">${p.art ? `<span class="art">${icon(artName(p.art))}${esc(p.art)}</span>` : ""}${p.bewertung ? sterneHtml(p.bewertung) : ""}${hier ? `<span class="etikett hier">Du bist hier</span>` : ""}
          ${[p.land && p.land !== "DE" ? esc(p.land) : "", entf].filter(Boolean).map((t) => `<span>${t}</span>`).join("")}</div></div>
        <button class="rund nur-voll" data-menue title="Einstellungen" aria-label="Einstellungen">${icon("cog-outline")}</button>
        <a class="rund" href="#/" title="Schließen" aria-label="Details schließen">${icon("close")}</a></div>
      <div class="aktionen">
        <a class="knopf haupt" href="${esc(p.google)}" target="_blank" rel="noopener">${icon("directions")}Navigation</a>
        <button class="knopf" data-aufkarte>${icon("map")}Karte</button>
        <label class="knopf">${icon("image-plus")}Fotos<input type="file" accept="image/*" multiple hidden id="upload"></label>
        <a class="knopf" href="${platzLink(p.id)}/bearbeiten">${icon("pencil")}Bearbeiten</a></div>
      <div class="d-rollen">
        ${fotos.length ? `<div class="fotos"><div class="fotoband">${fotos.map((f, i) => `<button class="foto" data-gross="${esc(f.name)}" aria-label="Foto ${i + 1} groß anzeigen">
          <img data-medium="${esc(f.vorschau)}" data-gut="${esc(f.foto)}" alt="" loading="lazy"></button>`).join("")}</div>${fotos.length > 1 ? `<span class="fotozahl">1 / ${fotos.length}</span>` : ""}</div>` : ""}
        <div id="fortschritt"></div>
        <div class="inhalt">
          ${p.gepflegt ? "" : `<div class="aufruf">${icon("pencil")}<span>Noch nicht beschrieben</span><a class="knopf flach" href="${platzLink(p.id)}/bearbeiten">Beschreiben</a></div>`}
          <div class="fakten">
            <div class="fakt ${p.preis === 0 ? "gut" : ""}"><b>${preisText(p.preis) || "–"}</b><span>${p.preis === 0 ? "pro Nacht" : preisText(p.preis) ? "pro Nacht" : "Preis unbekannt"}</span></div>
            <div class="fakt"><b>${p.naechte || p.geparkt || 0}</b><span>${p.naechte ? (p.naechte === 1 ? "Nacht" : "Nächte") : p.geparkt ? "Nächte geparkt" : "Nächte"}</span></div>
            <div class="fakt ${hier ? "hier" : ""}"><b>${p.vorgemerkt ? "–" : vorZeit(p.letzter_besuch).replace(/^vor (\d+ (?:Tag|Monat)e)n$/, "$1").replace(/^vor /, "")}</b><span>${p.vorgemerkt ? "vorgemerkt" : /^vor /.test(vorZeit(p.letzter_besuch)) ? "her" : "zuletzt hier"}</span></div></div>
          ${p.notiz ? `<div><div class="notiz gekuerzt">${esc(p.notiz)}</div><button class="mehr" hidden>Mehr anzeigen</button></div>` : ""}
          ${merkmale ? `<div><div class="ueber">Am Platz</div><div class="merkmale">${merkmale}</div></div>` : ""}
          ${aktiv ? `<div><div class="ueber">In der Nähe</div><div class="merkmale">${aktiv}</div></div>` : ""}
          <div class="klappen">
            ${this.klappe("besuche", "calendar-month", "Besuche", [p.besuche ? plural(p.besuche, "Besuch", "Besuche") : "vorgemerkt", naechte ? plural(p.naechte + p.geparkt, "Nacht", "Nächte") : ""].filter(Boolean).join(" · "), this.besucheHtml(p))}
            ${this.klappe("ort", "map-marker", "Ort", esc(p.koordinaten), `<dl class="werte"><dt>Koordinaten</dt><dd><button class="kopierbar" data-koordinaten title="In die Zwischenablage kopieren">${esc(p.koordinaten)}${icon("content-copy")}</button></dd>
              ${p.umkreis_km > UMKREIS_KM ? `<dt>Umkreis</dt><dd>${String(p.umkreis_km).replace(".", ",")} km</dd>` : ""}</dl>
              <div class="knoepfe"><a class="knopf flach" href="https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(5)},${p.lon.toFixed(5)}" target="_blank" rel="noopener">${icon("google-maps")}Google Maps</a>
              <a class="knopf flach" href="${esc(p.apple)}" target="_blank" rel="noopener">Route in Apple Karten</a></div>`)}
          </div>
        </div>
      </div>`;
  },

  klappe(id, symbol, titel, kurz, inhalt) {
    return `<details class="klappe" data-klappe="${id}" ${this.offen.has(id) ? "open" : ""}><summary>${icon(symbol)}<b>${titel}</b><span class="kurz">${kurz}</span>${icon("chevron-down", "pfeil")}</summary><div>${inhalt}</div></details>`;
  },

  besucheHtml(p) {
    const mitNaechten = p.besuche_liste.some((b) => b.naechte_liste.length);
    return `<ul class="besuche">${p.besuche_liste.slice().reverse().map((b) => {
      const jetzt = !b.abfahrt && p.id === this.hierId();
      const zusatz = [b.ganztags ? "" : `${uhr(b.ankunft)}${b.abfahrt ? `–${uhr(b.abfahrt)}` : ""} Uhr`, b.abfahrt ? naechteText(b.naechte, b.geparkt) || "ohne Übernachtung" : jetzt ? "jetzt hier" : "Abfahrt offen"].filter(Boolean).join(" · ");
      return `<li class="${jetzt ? "jetzt" : ""}"><div class="b-zeile"><div><b>${b.abfahrt ? zeitraum(b.ankunft, b.abfahrt) : `seit ${zeitraum(b.ankunft)}`}</b>
        <span>${zusatz}</span></div><button class="rund klein" data-besuch-bearbeiten="${esc(b.id)}" aria-label="Besuch ändern">${icon("pencil")}</button></div>${this.naechteHtml(b)}</li>`;
    }).join("") || `<li class="keine">Noch kein Besuch – der Platz ist vorgemerkt.</li>`}</ul>
      <div class="knoepfe"><button class="knopf flach" data-besuch-neu>${icon("calendar-month")}Besuch eintragen</button>${mitNaechten ? `<button class="knopf flach" data-korrigieren>${icon("weather-night")}Nächte korrigieren</button>` : ""}</div>`;
  },

  /** Nächte eines Besuchs als Schalter: Übernachtung ↔ über Nacht geparkt. */
  naechteHtml(b) {
    if (!b.naechte_liste.length) return "";
    return `<div class="naechte">${b.naechte_liste.map((n) => `<button class="chip nacht ${n.art}" data-besuch="${esc(b.id)}" data-nacht="${esc(n.nacht)}"
      data-wert="${n.art === "im" ? "aussen" : "im"}" title="Antippen zum Umschalten">${icon(n.art === "im" ? "weather-night" : "parking")}
      ${nachtDatum(n.nacht)} ${n.art === "im" ? "Übernachtung" : "geparkt"}</button>`).join("")}</div>`;
  },

  detailVerbinden(p, { korrigieren, notizAuf }) {
    const ziel = $("#detail");
    ziel.querySelectorAll("[data-gross]").forEach((el) => (el.onclick = () => this.grossZeigen(p, el.dataset.gross)));
    const band = ziel.querySelector(".fotoband"), zahl = ziel.querySelector(".fotozahl");
    if (band && zahl) band.addEventListener("scroll", () => {
      const i = Math.round(band.scrollLeft / (band.firstElementChild.offsetWidth + 8));
      zahl.textContent = `${Math.min(i + 1, p.fotoliste.length)} / ${p.fotoliste.length}`;
    }, { passive: true });
    ziel.querySelectorAll("details.klappe").forEach((d) => d.addEventListener("toggle", () => this.offen[d.open ? "add" : "delete"](d.dataset.klappe)));
    // Zugeklapptes aufgetippt: am Handy das Blatt ganz aufziehen, sonst läge der Inhalt unter dem Rand
    ziel.querySelectorAll("details.klappe > summary").forEach((s) => s.addEventListener("click", () => { if (!this.blatt.breit) this.blatt.setzen("voll"); }));
    const notiz = ziel.querySelector(".notiz"), mehr = ziel.querySelector(".mehr");
    if (notiz) {
      if (notizAuf) notiz.classList.remove("gekuerzt");
      else if (notiz.scrollHeight > notiz.clientHeight + 4) {
        mehr.hidden = false;
        mehr.onclick = () => { notiz.classList.remove("gekuerzt"); mehr.hidden = true; if (!this.blatt.breit) this.blatt.setzen("voll"); };
      } else notiz.classList.remove("gekuerzt");
    }
    ziel.querySelector("[data-aufkarte]").onclick = () => {
      if (!this.blatt.breit) this.blatt.setzen("klein");
      this.karte?.zeigen(p, { mindestzoom: 14, immer: true });
    };
    ziel.querySelector("[data-koordinaten]").onclick = () => this.kopieren(p.koordinaten, "Koordinaten kopiert");
    const up = ziel.querySelector("#upload");
    if (up) up.onchange = () => { const d = [...up.files]; up.value = ""; this.hochladen(p, d); };
    const kor = ziel.querySelector("[data-korrigieren]"), ul = ziel.querySelector(".besuche");
    if (kor) {
      const schalten = (an) => { ul.classList.toggle("korrigieren", an); kor.lastChild.textContent = an ? "Fertig" : "Nächte korrigieren"; };
      if (korrigieren) schalten(true);
      kor.onclick = () => schalten(!ul.classList.contains("korrigieren"));
    }
    ziel.querySelectorAll("[data-nacht]").forEach((el) => (el.onclick = () =>
      this.aktion(() => quelle.nachtSetzen(p.id, el.dataset.besuch, el.dataset.nacht, el.dataset.wert), el)));
    ziel.querySelector("[data-besuch-neu]").onclick = () => this.besuchZeigen(p, null);
    ziel.querySelectorAll("[data-besuch-bearbeiten]").forEach((el) => (el.onclick = () => this.besuchZeigen(p, p.besuche_liste.find((b) => b.id === el.dataset.besuchBearbeiten))));
  },

  /** Besuch eintragen oder ändern. Nur Tage: die Uhrzeit bleibt erhalten, solange der Tag gleich bleibt. */
  besuchZeigen(p, b) {
    const d = $("#besuch"), heute = tagVon(new Date());
    d.innerHTML = `<div class="f-kopf"><h2 tabindex="-1" autofocus>${b ? "Besuch ändern" : "Besuch eintragen"}</h2><button class="rund" data-zu aria-label="Schließen">${icon("close")}</button></div>
      <div class="f-rollen"><form class="formular schlicht" onsubmit="return false"><label class="feld"><span class="ueber">Ankunft</span><input type="date" name="an" max="${heute}" value="${b ? b.ankunft.slice(0, 10) : heute}"></label>
        <label class="feld"><span class="ueber">Abfahrt</span><input type="date" name="ab" max="${heute}" value="${b?.abfahrt ? b.abfahrt.slice(0, 10) : b ? "" : heute}"><small class="grau">Leer lassen, solange du noch dort bist.</small></label><p class="fehlertext" hidden></p></form></div>
      <div class="f-fuss">${b ? `<button class="knopf warnung" id="bs-weg" aria-label="Besuch löschen">${icon("trash-can-outline")}</button>` : ""}<button class="knopf haupt" style="flex:1" id="bs-ok">Speichern</button></div>`;
    const f = d.querySelector("form"), fehler = d.querySelector(".fehlertext");
    d.querySelector("#bs-ok").onclick = (e) => {
      const an = f.an.value, ab = f.ab.value;
      const text = !an ? "Bitte den Tag der Ankunft eintragen." : ab && ab < an ? "Die Abfahrt liegt vor der Ankunft." : an > heute || ab > heute ? "Der Besuch liegt in der Zukunft." : "";
      fehler.hidden = !text;
      fehler.textContent = text;
      if (text) return;
      const anGleich = b && b.ankunft.slice(0, 10) === an, abGleich = b?.abfahrt && b.abfahrt.slice(0, 10) === ab;
      const werte = { ankunft: anGleich ? b.ankunft : `${an}T12:00`, abfahrt: !ab ? null : abGleich ? b.abfahrt : `${ab}T12:00`, ganztags: !(anGleich && !b.ganztags && (!ab || abGleich)) };
      if (werte.abfahrt && werte.abfahrt < werte.ankunft) werte.abfahrt = werte.ankunft;
      this.aktion(() => (b ? quelle.besuchAendern(p.id, b.id, werte) : quelle.besuchAnlegen(p.id, werte)), e.currentTarget).then(() => d.close());
    };
    if (b) d.querySelector("#bs-weg").onclick = async (e) => {
      const k = e.currentTarget;
      if (await this.frage({ titel: "Besuch löschen?", text: p.besuche > 1 ? "Der Besuch wird gelöscht." : "Der Besuch wird gelöscht. Der Platz bleibt als vorgemerkt erhalten.", knopf: "Löschen", warnung: true })) { await this.aktion(() => quelle.besuchAendern(p.id, b.id, { weg: true }), k); d.close(); }
    };
    this.fensterOeffnen("#besuch");
  },

  /** Text in die Zwischenablage. Ohne https gibt es navigator.clipboard nicht → Auswahl in einem Hilfsfeld kopieren. */
  async kopieren(text, meldung) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
      const t = document.createElement("textarea");
      t.value = text;
      t.readOnly = true; // keine Tastatur
      t.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
      document.body.append(t);
      t.focus({ preventScroll: true });
      t.setSelectionRange(0, text.length);
      try { ok = document.execCommand("copy"); } catch (f) { /* unten */ }
      t.remove();
    }
    if (ok) this.meldung(meldung); else prompt("Kopieren:", text);
  },

  // ------------------------------------------------------------ Formular

  formularHtml(p) {
    const ja = (b) => (b ? "checked" : "");
    const unbekannt = p.preis === null || p.preis === undefined;
    const haken = (name, t, s, an) => `<label class="wahl"><input type="checkbox" name="${name}" ${ja(an)}>${icon(s)}${t}</label>`;
    return `<div class="d-kopf"><div class="d-titel"><h1>${p.gepflegt ? "Platz bearbeiten" : "Platz beschreiben"}</h1></div>
        <button type="button" class="rund" data-abbrechen title="Abbrechen" aria-label="Abbrechen">${icon("close")}</button></div>
      <div class="d-rollen"><form class="formular" onsubmit="return false">
        <div class="feld"><label><span class="ueber">Name</span><input type="text" name="name" value="${p.name === "Ohne Namen" ? "" : esc(p.name)}" maxlength="100" placeholder="z. B. Waldparkplatz am See"></label></div>
        <div class="feld"><span class="ueber">Fotos</span><div id="formfotos" class="formfotos">${this.formularFotosHtml(p)}</div><div id="fortschritt"></div></div>
        <div class="feld"><span class="ueber">Art</span><div class="artwahl">${ARTEN.map(([t, s]) => `<label class="wahl" style="${artFarbe(t)}"><input type="radio" name="art" value="${esc(t)}" ${ja(p.art === t)}>${icon(s)}${t}</label>`).join("")}</div></div>
        <div class="feld"><span class="ueber">Bewertung</span><div class="bewertung" data-wert="${p.bewertung || 0}">
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="s ${n <= (p.bewertung || 0) ? "an" : ""}" data-n="${n}" aria-label="${plural(n, "Stern", "Sterne")}">${icon("star")}</button>`).join("")}
          <button type="button" class="knopf flach" data-n="0">keine</button></div></div>
        <div class="feld"><div class="preiskopf"><span class="ueber" style="margin:0">Preis pro Nacht</span><b id="preiswert">${unbekannt ? "unbekannt" : preisText(p.preis)}</b></div>
          <input type="range" name="preis" min="0" max="${PREIS_MAX}" step="1" value="${p.preis ?? 0}" aria-label="Preis pro Nacht" ${unbekannt ? "disabled" : ""}>
          <div class="skala"><span>0 €</span><span>25 €</span><span>&gt; 50 €</span></div>
          <label class="zeile"><span>Preis unbekannt</span><input type="checkbox" class="schalter" name="preis_unbekannt" ${ja(unbekannt)}></label></div>
        <div class="feld"><span class="ueber">Am Platz</span><div class="haken">${AUSSTATTUNG.map(([k, t, s]) => haken(k, t, s, p[k])).join("")}</div></div>
        <div class="feld"><span class="ueber">In der Nähe</span><div class="haken">${AKTIVITAETEN.map(([k, t, s]) => haken(`akt_${k}`, t, s, (p.aktivitaeten || []).includes(k))).join("")}</div></div>
        <label class="feld"><span class="ueber">Notiz</span><textarea name="notiz">${esc(p.notiz)}</textarea></label>
        <button type="button" class="knopf warnung" id="loeschen">${icon("trash-can-outline")}Platz löschen</button>
      </form></div>
      <div class="fussleiste"><button type="button" class="knopf" data-abbrechen>Abbrechen</button><button type="button" class="knopf haupt" id="speichern">Speichern</button></div>`;
  },

  /** Fotos im Formular: antippen = Großansicht (Titelbild, Löschen), „Hinzufügen“ lädt sofort hoch – unabhängig vom Speichern. */
  formularFotosHtml(p) {
    const fotos = [...p.fotoliste].sort((a, b) => (b.name === p.titelfoto) - (a.name === p.titelfoto));
    return `<label class="fotoplus">${icon("image-plus")}Hinzufügen<input type="file" accept="image/*" multiple hidden id="upload"></label>` +
      fotos.map((f, i) => `<button type="button" data-gross="${esc(f.name)}" aria-label="Foto ${i + 1} groß anzeigen"><img data-medium="${esc(f.vorschau)}" alt="" loading="lazy">${f.name === p.titelfoto ? `<span>${icon("star")}</span>` : ""}</button>`).join("");
  },

  /** Nach neuen Daten nur die Fotos im offenen Formular erneuern; die Eingaben bleiben stehen. */
  formularFotosZeichnen() {
    const ziel = $("#formfotos"), p = this.route.platz && this.platz(this.route.platz);
    if (!ziel || !p) return;
    const html = this.formularFotosHtml(p);
    if (html !== this.formFotosHtml) { this.formFotosHtml = html; ziel.innerHTML = html; }
    else if (ziel.dataset.fertig === p.id) return;
    ziel.dataset.fertig = p.id;
    this.bilderEinsetzen(ziel);
    ziel.querySelectorAll("[data-gross]").forEach((b) => (b.onclick = () => this.grossZeigen(p, b.dataset.gross)));
    const up = ziel.querySelector("#upload");
    up.onchange = () => { const d = [...up.files]; up.value = ""; this.hochladen(p, d); };
  },

  formularVerbinden(p) {
    const ziel = $("#detail"), f = ziel.querySelector("form");
    this.formularFotosZeichnen();
    const regler = f.querySelector('[name="preis"]'), unbekannt = f.querySelector('[name="preis_unbekannt"]');
    const preisNeu = () => { regler.disabled = unbekannt.checked; $("#preiswert").textContent = unbekannt.checked ? "unbekannt" : preisText(Number(regler.value)); };
    regler.oninput = preisNeu; unbekannt.onchange = preisNeu;
    // Art wieder abwählen: noch einmal antippen
    let art = p.art;
    f.querySelectorAll('[name="art"]').forEach((r) => (r.onclick = () => { if (art === r.value) { r.checked = false; art = ""; } else art = r.value; }));
    const bew = f.querySelector(".bewertung");
    bew.onclick = (e) => {
      const n = e.target.closest("[data-n]")?.dataset.n;
      if (n === undefined) return;
      bew.dataset.wert = n;
      bew.querySelectorAll(".s").forEach((s) => s.classList.toggle("an", Number(s.dataset.n) <= Number(n)));
    };
    const land = p.land;
    // Abbrechen bei einem gerade angelegten Platz ohne Fotos: wieder entfernen, damit nichts Leeres zurückbleibt
    ziel.querySelectorAll("[data-abbrechen]").forEach((k) => (k.onclick = async () => {
      const neu = this.frisch === p.id && !this.platz(p.id)?.fotos;
      this.frisch = null;
      if (neu) return this.aktion(() => quelle.entfernen(p.id), k, "#/");
      location.hash = platzLink(p.id);
    }));
    ziel.querySelector("#speichern").onclick = (e) => {
      const d = new FormData(f);
      const daten = {
        name: d.get("name").trim(), land, art: d.get("art") || "",
        preis: unbekannt.checked ? null : Number(regler.value),
        bewertung: Number(bew.dataset.wert || 0), notiz: d.get("notiz"),
        aktivitaeten: AKTIVITAETEN.map(([k]) => k).filter((k) => d.get(`akt_${k}`) === "on"),
      };
      AUSSTATTUNG.forEach(([k]) => (daten[k] = d.get(k) === "on"));
      this.frisch = null;
      this.aktion(() => quelle.speichern(p.id, daten), e.currentTarget, platzLink(p.id));
    };
    ziel.querySelector("#loeschen").onclick = async (e) => {
      const knopf = e.currentTarget;
      if (await this.frage({ titel: "Platz löschen?", text: `„${p.name}“ wird mit allen Besuchen und Fotos gelöscht und liegt danach ${PAPIERKORB_TAGE} Tage im Papierkorb (Einstellungen).`, knopf: "Löschen", warnung: true })) {
        this.aktion(() => quelle.loeschen(p.id), knopf, "#/");
      }
    };
  },

  // ------------------------------------------------------------ Platz anlegen

  neuZeigen() {
    if (this.formularOffen()) return this.meldung("Erst speichern oder abbrechen.");
    const d = $("#neu");
    d.innerHTML = `<div class="f-kopf"><h2 tabindex="-1" autofocus>Platz anlegen</h2><button class="rund" data-zu aria-label="Schließen">${icon("close")}</button></div>
      <div class="f-rollen"><div class="block">
        <button class="zeile wahlzeile" data-weg="standort">${icon("map-marker")}<span>Ich bin gerade hier<small>Standort dieses Geräts, Besuch ab jetzt</small></span></button>
        ${this.karte ? `<button class="zeile wahlzeile" data-weg="karte">${icon("map")}<span>Auf der Karte wählen<small>Vormerken oder früheren Besuch eintragen</small></span></button>` : ""}</div>
        <form class="formular schlicht" onsubmit="return false"><label class="feld"><span class="ueber">Koordinaten oder Karten-Link</span><input type="text" name="ort" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="47.6553, 11.3610"></label><p class="fehlertext" hidden></p></form></div>
      <div class="f-fuss"><button class="knopf haupt" style="flex:1" data-weg="text">Übernehmen</button></div>`;
    const fehler = d.querySelector(".fehlertext"), zeigen = (t) => { fehler.hidden = !t; fehler.textContent = t; };
    const ausText = () => {
      const t = d.querySelector('[name="ort"]').value, k = koordinatenLesen(t);
      if (k) { d.close(); this.anlegen(k.lat, k.lon); } else zeigen(/maps\.app\.goo\.gl|goo\.gl\/maps/.test(t) ? "Kurze Google-Links enthalten keine Koordinaten. Öffne den Link und kopiere die Koordinaten oder die lange Adresse." : "Darin habe ich keine Koordinaten gefunden.");
    };
    d.querySelector('[name="ort"]').onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); ausText(); } };
    d.querySelectorAll("[data-weg]").forEach((b) => (b.onclick = async () => {
      if (b.dataset.weg === "text") return ausText();
      if (b.dataset.weg === "karte") { d.close(); return this.waehlenZeigen(); }
      b.disabled = true;
      zeigen("");
      try {
        const pos = await quelle.position();
        this.standortSetzen(pos);
        d.close();
        await this.anlegen(pos.latitude, pos.longitude, { ankunft: lokal(new Date()) });
      } catch (e) { zeigen(e.message); } finally { b.disabled = false; }
    }));
    this.fensterOeffnen("#neu");
  },

  /** Karte unter einem festen Fadenkreuz verschieben und die Stelle übernehmen. */
  waehlenZeigen() {
    location.hash = "#/";
    if (!this.blatt.breit) this.blatt.setzen("klein");
    document.body.classList.add("waehlt");
    const w = $("#waehlen"), r = this.karte.mitte();
    w.hidden = false;
    w.innerHTML = `<div class="kreuz" style="left:${r.x}px;top:${r.y}px">${icon("map-marker")}</div><div class="w-leiste"><span>Karte verschieben, bis die Nadel stimmt</span><button class="knopf" data-w="nein">Abbrechen</button><button class="knopf haupt" data-w="ja">Übernehmen</button></div>`;
    const ende = () => { w.hidden = true; w.innerHTML = ""; document.body.classList.remove("waehlt"); if (!this.blatt.breit) this.blatt.setzen("halb"); };
    w.querySelector('[data-w="nein"]').onclick = ende;
    w.querySelector('[data-w="ja"]').onclick = () => { const o = this.karte.mitte(); ende(); this.anlegen(o.lat, o.lon); };
  },

  /** Liegt dort schon ein Platz? Dann nachfragen; sonst anlegen und das Formular öffnen. */
  async anlegen(lat, lon, besuch = null) {
    const da = quelle.bei(this.daten.plaetze, lat, lon);
    if (da) {
      const offen = besuch && da.besuche_liste.some((b) => !b.abfahrt || b.abfahrt.slice(0, 10) >= besuch.ankunft.slice(0, 10));
      const ja = await this.frage({ titel: "Hier gibt es schon einen Platz", text: besuch && !offen ? `„${da.name}“ liegt ganz in der Nähe. Dort einen Besuch ab jetzt eintragen?` : `„${da.name}“ liegt ganz in der Nähe (${kmText(km(lat, lon, da.lat, da.lon))}). Diesen Platz öffnen?`, knopf: besuch && !offen ? "Besuch eintragen" : "Öffnen" });
      if (ja) {
        if (besuch && !offen) await this.aktion(() => quelle.besuchAnlegen(da.id, besuch));
        location.hash = platzLink(da.id);
        return;
      }
      if (!(await this.frage({ titel: "Trotzdem neu anlegen?", text: "Du bekommst zwei Plätze nah beieinander.", knopf: "Neu anlegen" }))) return;
    }
    try {
      const id = await quelle.anlegen({ lat, lon, besuch });
      this.frisch = id;
      await this.laden();
      location.hash = `${platzLink(id)}/bearbeiten`;
      this.karte?.zeigen(this.platz(id), { mindestzoom: 13 });
    } catch (e) { this.meldung(`Fehler: ${e.message}`, true); }
  },

  /** Änderung ausführen (fn → Promise), neu laden, danach ggf. Adresse wechseln. */
  async aktion(fn, knopf, danach) {
    if (knopf) knopf.disabled = true;
    try {
      await fn();
      if (danach !== undefined) { delete $("#detail").dataset.formular; this.route.bearbeiten = false; }
      await this.laden();
      if (danach !== undefined) location.hash = danach;
    } catch (e) {
      this.meldung(`Fehler: ${e.message}`, true);
    } finally {
      if (knopf) knopf.disabled = false;
    }
  },

  async hochladen(p, dateien) {
    // Das Feld jedes Mal neu suchen: neue Daten können die Details zwischendurch neu zeichnen
    const anzeige = (t) => { const a = $("#fortschritt"); if (a) a.textContent = t; };
    let n = 0;
    const fehler = [];
    for (const d of dateien) {
      anzeige(`Foto ${++n} von ${dateien.length} wird gespeichert …`);
      try { await quelle.fotoAnlegen(p.id, d); } catch (e) { fehler.push(e.message); }
    }
    anzeige("");
    await this.laden();
    if (fehler.length) this.meldung(fehler.length === 1 ? fehler[0] : `${fehler.length} Fotos nicht gespeichert: ${fehler[0]}`, true);
  },

  // ------------------------------------------------------------ Großansicht (wischen, Titelbild, Löschen)

  async grossZeigen(p, name) {
    const g = $("#gross");
    const liste = [...p.fotoliste].sort((a, b) => (b.name === p.titelfoto) - (a.name === p.titelfoto)); // wie im Fotoband
    let i = Math.max(0, liste.findIndex((f) => f.name === name));
    const zeigen = async () => {
      const f = liste[i];
      g.innerHTML = `<div class="kopf"><span class="zaehlung" tabindex="-1" autofocus>${i + 1} / ${liste.length}</span><button data-a="zu" aria-label="Schließen">${icon("close")}</button></div>
        <div class="bildflaeche"><img alt="">
          ${liste.length > 1 ? `<button class="blaettern links" data-a="zurueck" aria-label="Vorheriges Foto">${icon("chevron-left")}</button>
            <button class="blaettern rechts" data-a="vor" aria-label="Nächstes Foto">${icon("chevron-right")}</button>` : ""}</div>
        <div class="leiste">${f.name === p.titelfoto ? `<button disabled>${icon("star")}Titelbild</button>` : `<button data-a="titel">${icon("star-outline")}Als Titelbild</button>`}
          <button class="warnung" data-a="loeschen">${icon("trash-can-outline")}Löschen</button></div>`;
      const img = g.querySelector("img");
      img.src = await quelle.bild(f.vorschau); // erst klein, dann das Original
      quelle.bild(f.foto).then((u) => { const gross = new Image(); gross.onload = () => (img.src = u); gross.src = u; });
    };
    const blaettern = (d) => { if (liste.length > 1) { i = (i + d + liste.length) % liste.length; zeigen(); } };
    await zeigen();
    if (!g.open) g.showModal();
    g.onkeydown = (e) => { if (e.key === "ArrowRight") blaettern(1); else if (e.key === "ArrowLeft") blaettern(-1); };
    g.onclose = () => (g.innerHTML = "");
    g.onclick = async (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a; // auch beim Tipp genau aufs Symbol im Knopf
      if (a === "zu") g.close();
      else if (a === "vor") blaettern(1);
      else if (a === "zurueck") blaettern(-1);
      else if (a === "titel") { const f = liste[i]; g.close(); this.aktion(() => quelle.feld(p.id, { titelfoto: f.name }), null); }
      else if (a === "loeschen") {
        const f = liste[i];
        if (await this.frage({ titel: "Foto löschen?", text: "Das Foto wird endgültig gelöscht.", knopf: "Löschen", warnung: true })) {
          g.close();
          this.aktion(() => quelle.fotoEntfernen(f.name), null);
        }
      }
    };
    let x0 = null;
    g.ontouchstart = (e) => (x0 = e.touches.length === 1 ? e.touches[0].clientX : null);
    g.ontouchend = (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50) blaettern(dx < 0 ? 1 : -1);
      x0 = null;
    };
  },

  // ------------------------------------------------------------ Karte

  karteAufbauen() {
    const dunkel = this.themaAnwenden();
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.themaAnwenden());
    if (!EBENEN[this.ansicht.ebene]) this.ansicht.ebene = "standard";
    const n = $("#kartenknoepfe");
    n.innerHTML = `<div class="kgruppe"><button data-menue title="Einstellungen" aria-label="Einstellungen">${icon("cog-outline")}</button></div>` + (!Karte.moeglich() ? "" : `<div class="kgruppe"><button data-k="ebenen" title="Kartenebene" aria-label="Kartenebene">${icon("layers-outline")}</button></div>
      <div class="kgruppe"><button data-k="standort" title="Mein Standort" aria-label="Mein Standort">${icon("map-marker")}</button>
        <button data-k="alle" title="Alle Plätze zeigen" aria-label="Alle Plätze zeigen">${icon("arrow-expand-all")}</button></div>
      <div class="kgruppe nur-mac"><button data-k="plus" class="zoom" title="Vergrößern" aria-label="Vergrößern">+</button><button data-k="minus" class="zoom" title="Verkleinern" aria-label="Verkleinern">−</button></div>`);
    n.onclick = (e) => {
      const k = e.target.closest("[data-k]")?.dataset.k;
      if (k === "ebenen") this.ebenenZeigen($("#ebenen").hidden);
      else if (k === "standort") {
        const b = e.target.closest("[data-k]");
        b.disabled = true;
        quelle.position().then((pos) => { this.standortSetzen(pos); this.karte.ort(pos.latitude, pos.longitude); }, (x) => this.meldung(x.message, true)).finally(() => (b.disabled = false));
      }
      else if (k === "alle") this.karte.alle(this.gefiltert());
      else if (k === "plus") this.karte.zoomen(1);
      else if (k === "minus") this.karte.zoomen(-1);
    };
    if (!Karte.moeglich()) { this.hinweis("Die Karte braucht WebGL, das dieser Browser nicht anbietet. Liste und Details funktionieren trotzdem.", true); return; }
    this.karte = new Karte({
      wurzel: $("#karte"), symbol: artName, bildUrl: (pfad) => quelle.bild(pfad),
      rand: () => (this.blatt.breit ? { top: 0, bottom: 0, right: 70, left: $("#blatt").getBoundingClientRect().right } : { top: this.oben(), bottom: this.blatt.verdeckt, left: 0, right: 0 }),
      aufPlatz: (id) => {
        this.ebenenZeigen(false);
        if (document.body.classList.contains("waehlt")) return;
        if (this.formularOffen()) return this.meldung("Erst speichern oder abbrechen.");
        if (!this.blatt.breit && this.blatt.stufe !== "halb" && this.route.platz) this.blatt.setzen("halb");
        location.hash = platzLink(id);
      },
      aufLeer: () => { this.ebenenZeigen(false); if (!this.blatt.breit && !this.formularOffen()) this.blatt.setzen("klein"); },
      aufHover: (id) => this.hover(id, false),
    });
    this.karte.aufbauen({ dunkel, ebene: this.ansicht.ebene });
    $("#ebenen").onclick = (e) => {
      const b = e.target.closest("[data-ebene]");
      if (!b) return;
      this.ansicht.ebene = b.dataset.ebene;
      this.merken();
      this.karte.stilSetzen({ ebene: b.dataset.ebene });
      this.ebenenZeigen(false);
    };
  },
  oben() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--oben-px")) || 0; },

  ebenenZeigen(an) {
    const e = $("#ebenen");
    e.hidden = !an;
    $('[data-k="ebenen"]')?.classList.toggle("an", an);
    if (an) e.innerHTML = `<div class="ebenenliste">${Object.entries(EBENEN).map(([k, d]) => `<button data-ebene="${k}" class="${k === this.ansicht.ebene ? "an" : ""}" aria-pressed="${k === this.ansicht.ebene}">
      <i class="muster"><svg viewBox="0 0 120 46" preserveAspectRatio="xMidYMid slice">${MUSTER[k]}</svg></i><span>${d.name}<small>${d.text}</small></span></button>`).join("")}</div>`;
  },

  karteZeichnen(liste) {
    if (!this.karte) return;
    // Der geöffnete Platz bleibt sichtbar, auch wenn ihn der Filter ausblendet
    const p = this.route.platz && this.platz(this.route.platz);
    this.karte.setzen(liste, this.hier);
    if (p && !liste.some((x) => x.id === p.id)) this.karte.plaetze.set(p.id, p);
    this.karte.waehlen(p?.id || null);
    if (!this.ersterAusschnitt && liste.length) {
      this.ersterAusschnitt = true;
      this.ausschnittSig = liste.map((x) => x.id).sort().join();
      if (p) this.karte.zeigen(p, { immer: true, mindestzoom: 12 }); else this.karte.alle(liste, false);
    }
  },

  /** Hervorheben per Maus: aus der Liste (Punkt) oder von der Karte (Listeneintrag). */
  hover(id, ausListe = true) {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.karte?.hover(id);
    if (!ausListe) document.querySelectorAll("#liste .platz").forEach((z) => z.classList.toggle("markiert", z.dataset.id === id));
  },
};

app.start();
if (location.hostname === "localhost") window.stellplatzApp = app; // nur für tools/webapp-test gegen die Demo
