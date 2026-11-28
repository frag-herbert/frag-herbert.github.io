/*
 * Texte für „Datenschutz“ und „Lizenzen“ (Einstellungen). Beim Hinzufügen einer Kartenquelle hier, in HINWEISE.md,
 * in der CSP (index.html) und in sw.js KACHEL_HOSTS nachtragen.
 */
const a = (url, text) => `<a href="${url}" target="_blank" rel="noopener">${text}</a>`;

/** Wer beim Benutzen etwas vom Gerät mitbekommt: Name, Rechner, wofür. */
export const ANBIETER = [
  ["GitHub Pages", "frag-herbert.github.io", "liefert die App selbst aus", a("https://docs.github.com/de/site-policy/privacy-policies/github-general-privacy-statement", "Datenschutz")],
  ["OpenFreeMap", "tiles.openfreemap.org", "Grundkarte und Schrift", a("https://openfreemap.org", "openfreemap.org")],
  ["Mapterhorn", "tiles.mapterhorn.com", "Geländeschattierung", a("https://mapterhorn.com", "mapterhorn.com")],
  ["OpenTopoMap", "*.tile.opentopomap.org", "Ebene „Topo“", a("https://opentopomap.org/about", "opentopomap.org")],
  ["EOX IT Services", "tiles.maps.eox.at", "Ebene „Luftbild“ weltweit", a("https://cloudless.eox.at", "cloudless.eox.at")],
  ["basemap.at", "mapsneu.wien.gv.at", "Luftbild Österreich", a("https://basemap.at", "basemap.at")],
  ["swisstopo", "wmts.geo.admin.ch", "Luftbild Schweiz", a("https://www.swisstopo.admin.ch", "swisstopo.admin.ch")],
  ["PDOK", "service.pdok.nl", "Luftbild Niederlande", a("https://www.pdok.nl", "pdok.nl")],
];

export const DATENSCHUTZ = `
  <p><b>Deine Plätze, Besuche und Fotos liegen nur auf diesem Gerät</b>, in der Datenbank des Browsers. Es gibt kein Konto, keinen Server von Frag Herbert,
    keine Statistik, keine Werbung und keine Cookies.</p>
  <p>Daten verlassen das Gerät nur, wenn du selbst ein Backup oder einen Export speicherst oder teilst. Wohin, entscheidest du.</p>
  <p><b>Standort:</b> wird nur auf dem Gerät verwendet (Entfernungen, „Hier“, neuer Platz) und nirgends hingeschickt.
    <b>Fotos:</b> werden beim Speichern verkleinert; Aufnahmeort und andere Angaben in der Datei fallen dabei weg.</p>
  <h3>Wer etwas mitbekommt</h3>
  <p>Beim Laden der App und der Kartenausschnitte sehen die folgenden Anbieter, wie bei jeder Webseite, deine IP-Adresse, den Browser und
    welche Kartengegend abgerufen wird – nicht aber deine Plätze.</p>
  <table class="anbieter">${ANBIETER.map(([n, h, w, l]) => `<tr><td><b>${n}</b><small>${h}</small></td><td>${w}<small>${l}</small></td></tr>`).join("")}</table>
  <p><b>Mit Home Assistant verbunden</b> (nur wer das in den Einstellungen einrichtet): Die App spricht direkt mit deiner eigenen
    Home Assistant, ohne Umweg. Die Anmeldung bleibt in diesem Browser; die Kopie deiner Plätze liegt wie alles andere nur auf dem Gerät.</p>
  <p>Angesehene Kartenausschnitte bleiben eine Weile auf dem Gerät, damit die Karte auch ohne Netz geht.</p>
  <h3>Löschen</h3>
  <p>Alles löschen: die App vom Home-Bildschirm entfernen bzw. die Websitedaten von frag-herbert.github.io im Browser löschen.
    Vorher ein Backup machen, wenn du die Plätze behalten willst.</p>`;

export const LIZENZEN = `
  <p><b>Frag Herbert</b> ist freie Software unter der ${a("https://github.com/frag-herbert/frag-herbert.github.io/blob/main/LICENSE", "MIT-Lizenz")}.</p>
  <h3>Enthaltene Software</h3>
  <p><b>MapLibre GL JS</b> – © MapLibre contributors, © Mapbox; BSD-3-Clause (${a("maplibre/LICENSE.txt", "Lizenztext")})<br>
    <b>Material Design Icons</b> – © Pictogrammers; ${a("https://pictogrammers.com/docs/general/license/", "Apache License 2.0")}</p>
  <h3>Karten</h3>
  <p><b>Kartendaten</b> © ${a("https://www.openstreetmap.org/copyright", "OpenStreetMap-Mitwirkende")} (ODbL)<br>
    <b>Grundkarte</b> ${a("https://openfreemap.org", "OpenFreeMap")}, ${a("https://openmaptiles.org", "OpenMapTiles")}; Schrift Noto Sans (SIL Open Font License)<br>
    <b>Gelände</b> © ${a("https://mapterhorn.com/attribution", "Mapterhorn")}<br>
    <b>Topo</b> Kartendarstellung © ${a("https://opentopomap.org", "OpenTopoMap")} (${a("https://creativecommons.org/licenses/by-sa/3.0/", "CC-BY-SA")}), SRTM<br>
    <b>Luftbild weltweit</b> ${a("https://cloudless.eox.at", "Sentinel-2 cloudless")} by EOX IT Services GmbH (Contains modified Copernicus Sentinel data,
      ${a("https://creativecommons.org/licenses/by-nc-sa/4.0/", "CC BY-NC-SA 4.0")})<br>
    <b>Luftbild Österreich</b> ${a("https://basemap.at", "basemap.at")} (CC BY 4.0) ·
    <b>Schweiz</b> © ${a("https://www.swisstopo.admin.ch", "swisstopo")} ·
    <b>Niederlande</b> ${a("https://www.beeldmateriaal.nl", "Beeldmateriaal Nederland")} (CC BY 4.0)</p>
  <p class="grau klein">Die Quellen des gerade sichtbaren Ausschnitts stehen auch unten rechts auf der Karte.</p>`;
