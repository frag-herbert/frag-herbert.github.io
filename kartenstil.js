/*
 * Kartenstil von Frag Herbert (MapLibre): eigene Farben passend zur App, hell und dunkel.
 * Vektorkacheln: OpenFreeMap (OpenMapTiles-Schema, ohne Schlüssel), Relief: Mapterhorn (Terrarium-Höhenkacheln).
 * Rasterebenen mit CORS (nötig für den Offline-Speicher in sw.js): Topografie (OpenTopoMap) und Luftbild. CyclOSM und Esri sind entfernt
 * (Nutzungsbedingungen, KONZEPT-WEBAPP.md 12.9). Luftbild = Sentinel-2 (EOX, weltweit, 10 m) und darüber freie Luftbilder einzelner Länder.
 * Die Länderdienste füllen außerhalb ihres Gebiets mit reinem Weiß; ihre Kacheln laufen deshalb über das Protokoll „luftbild://“
 * (karte.js), das Weiß durchsichtig macht. Schlüssel der Ebene bleibt „satellit“ (gespeicherte Ansichten).
 * Neuer Host → auch in sw.js ergänzen.
 */
const OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
export const LUFTBILD = "luftbild://";
const EOX_JAHR = 2025;
/** Länder-Luftbilder: Gebiet (Rechteck, grob), ab Zoom, bis Zoom. Reihenfolge = Zeichenfolge (spätere oben). */
export const LAENDER = [
  { id: "at", gebiet: [9.4, 46.3, 17.2, 49.1], max: 19, kacheln: "https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg",
    quelle: 'Luftbild Österreich: <a href="https://basemap.at">basemap.at</a> (CC BY 4.0)' },
  { id: "ch", gebiet: [5.9, 45.8, 10.6, 47.9], max: 19, kacheln: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg",
    quelle: 'Luftbild Schweiz: © <a href="https://www.swisstopo.admin.ch">swisstopo</a>' },
  { id: "nl", gebiet: [3.2, 50.7, 7.3, 53.7], max: 19, kacheln: "https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_ortho25/EPSG:3857/{z}/{x}/{y}.jpeg",
    quelle: 'Luchtfoto Nederland: <a href="https://www.beeldmateriaal.nl">Beeldmateriaal Nederland</a> (CC BY 4.0)' },
];
export const EBENEN = {
  standard: { name: "Karte", text: "mit Relief" },
  topo: { name: "Topografie", text: "Höhenlinien", max: 17, kacheln: ["a", "b", "c"].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
    quelle: 'Kartendaten: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap-Mitwirkende</a>, SRTM | Kartendarstellung: © <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)' },
  satellit: { name: "Luftbild", text: "mit Ortsnamen",
    welt: { kacheln: [`https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${EOX_JAHR}_3857/default/g/{z}/{y}/{x}.jpg`], max: 15,
      quelle: `<a href="https://cloudless.eox.at">EOxCloudless ${EOX_JAHR}</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data ${EOX_JAHR}, CC BY-NC-SA 4.0)` },
    laender: LAENDER },
};

/** Farben je Art (Marker auf der Karte, Symbole in Liste und Details; gleiche Werte wie --art-* in app.css). */
export const ART_FARBEN = {
  hell: { Parkplatz: "#5b6bb0", Natur: "#3b8a4c", Stellplatz: "#0f7a8a", Campingplatz: "#c4652a", "": "#7a857f" },
  dunkel: { Parkplatz: "#8b9ae0", Natur: "#6cbf7c", Stellplatz: "#4cb5c6", Campingplatz: "#e8935a", "": "#93a39b" },
};

const HELL = {
  land: "#f4f4ec", wald: "#cfe2c3", wiese: "#e2edd3", acker: "#f1f1e2", fels: "#e6e2da", sand: "#f3e8c8", eis: "#f3f8fa", ort: "#e9e7df", park: "#d8e8cb", gewerbe: "#e6e5e1",
  wasser: "#a6d3e0", wasserText: "#2f7086", gebaeude: "#dedbd1", gebaeudeRand: "#cfcbc0",
  weg: "#b39a75", klein: "#ffffff", kleinRand: "#dcd9cf", mittel: "#ffffff", mittelRand: "#d2cec2", haupt: "#fdebbd", hauptRand: "#e3c98a", auto: "#f6c583", autoRand: "#dc9f57",
  bahn: "#c2c4bd", grenze: "#97a39b", text: "#2b3832", text2: "#5d6b64", halo: "rgba(255,255,255,0.88)", berg: "#7a5c3a", poi: "#54726a", poiHalo: "rgba(255,255,255,0.9)",
  schatten: "#5f6b62", licht: "#ffffff", relief: 0.19, platzText: "#16211d", platzHalo: "#ffffff", cluster: "#0e6b5c", clusterText: "#ffffff", rand: "#ffffff", hier: "#1f6feb",
};
const DUNKEL = {
  land: "#1d2825", wald: "#20362a", wiese: "#212f28", acker: "#1f2b26", fels: "#272f2c", sand: "#2a2a20", eis: "#22302f", ort: "#262f2c", park: "#20382b", gewerbe: "#272f2d",
  wasser: "#134155", wasserText: "#7fc0d6", gebaeude: "#2f3a36", gebaeudeRand: "#394640",
  weg: "#6b5d48", klein: "#38453f", kleinRand: "#1c2622", mittel: "#43514a", mittelRand: "#1c2622", haupt: "#5d5840", hauptRand: "#1f241c", auto: "#8a6f42", autoRand: "#2a2619",
  bahn: "#3a4540", grenze: "#5d6b64", text: "#d5dfd9", text2: "#96a69e", halo: "rgba(14,21,19,0.88)", berg: "#c9a880", poi: "#8fb3a8", poiHalo: "rgba(14,21,19,0.9)",
  schatten: "#000000", licht: "#5c7268", relief: 0.28, platzText: "#eef4f1", platzHalo: "#0e1513", cluster: "#4fc3a8", clusterText: "#06241d", rand: "#16201d", hier: "#5b9dff",
};
// Über dem Satellitenbild: helle Schrift mit dunklem Rand, in beiden Darstellungen gleich
const AUF_BILD = { text: "#ffffff", text2: "#e6ece9", halo: "rgba(0,0,0,0.75)", wasserText: "#d6eef7", grenze: "rgba(255,255,255,0.5)", berg: "#ffe9cf", platzText: "#ffffff", platzHalo: "rgba(0,0,0,0.85)" };

const FETT = ["Noto Sans Bold"], NORMAL = ["Noto Sans Regular"], KURSIV = ["Noto Sans Italic"];
const NAME = ["coalesce", ["get", "name:de"], ["get", "name"]];
const zoom = (...werte) => ["interpolate", ["exponential", 1.4], ["zoom"], ...werte];
const linear = (...werte) => ["interpolate", ["linear"], ["zoom"], ...werte];
const klasse = (...k) => ["in", ["get", "class"], ["literal", k]];
const leer = { type: "FeatureCollection", features: [] };

/** POI, die unterwegs nützen; Symbol = Name aus icons.js (Bild „poi-…“ erzeugt karte.js auf Anfrage). */
const POI = { campsite: "tent", grocery: "cart", fuel: "gas-station", drinking_water: "water-pump", toilets: "toilet", swimming: "pool", parking: "parking" };

function flaechen(f) {
  const fl = (id, schicht, filter, farbe, mehr = {}) => ({ id, type: "fill", source: "osm", "source-layer": schicht, ...(filter ? { filter } : {}),
    paint: { "fill-color": farbe, "fill-antialias": false, ...mehr.paint }, ...(mehr.ab ? { minzoom: mehr.ab } : {}) });
  return [
    fl("acker", "landcover", klasse("farmland"), f.acker),
    fl("wiese", "landcover", klasse("grass"), f.wiese),
    fl("sand", "landcover", klasse("sand"), f.sand),
    fl("fels", "landcover", klasse("rock"), f.fels, { paint: { "fill-opacity": 0.7 } }),
    fl("eis", "landcover", klasse("ice"), f.eis),
    fl("ort", "landuse", klasse("residential", "suburb", "neighbourhood"), f.ort, { paint: { "fill-opacity": linear(6, 0.5, 12, 0.9) } }),
    fl("gewerbe", "landuse", klasse("industrial", "commercial", "retail"), f.gewerbe),
    fl("park", "park", null, f.park, { paint: { "fill-opacity": linear(5, 0.25, 10, 0.45) } }),
    fl("wald", "landcover", klasse("wood"), f.wald, { paint: { "fill-opacity": linear(6, 0.7, 12, 1) } }),
    fl("sport", "landuse", klasse("pitch", "playground", "cemetery", "stadium"), f.park),
  ];
}

function strassen(f) {
  // [id, Klassen, Farbe, Randfarbe, ab Zoom, Breiten]
  const arten = [
    ["klein", ["minor", "service"], f.klein, f.kleinRand, 12.5, [12.5, 0.5, 15, 3.2, 18, 13]],
    ["mittel", ["tertiary"], f.mittel, f.mittelRand, 10.5, [10.5, 0.6, 14, 3.4, 18, 16]],
    ["neben", ["secondary"], f.mittel, f.mittelRand, 8.5, [8.5, 0.5, 13, 3.2, 18, 18]],
    ["haupt", ["primary", "trunk"], f.haupt, f.hauptRand, 6.5, [6.5, 0.5, 12, 3, 18, 20]],
    ["auto", ["motorway"], f.auto, f.autoRand, 4.5, [4.5, 0.5, 9, 2, 12, 3.6, 18, 24]],
  ];
  const basis = (id, klassen, ab) => ({ id, type: "line", source: "osm", "source-layer": "transportation", minzoom: ab,
    filter: ["all", klasse(...klassen), ["==", ["geometry-type"], "LineString"]], layout: { "line-cap": "round", "line-join": "round" } });
  const tunnel = ["case", ["==", ["get", "brunnel"], "tunnel"], 0.45, 1];
  const rand = arten.map(([id, k, , r, ab, b]) => ({ ...basis(`${id}-rand`, k, Math.max(ab, 8)),
    paint: { "line-color": r, "line-opacity": tunnel, "line-width": zoom(...b.map((w, i) => (i % 2 ? w + 1.4 : w))) } }));
  const voll = arten.map(([id, k, farbe, , ab, b]) => ({ ...basis(id, k, ab), paint: { "line-color": farbe, "line-opacity": tunnel, "line-width": zoom(...b) } }));
  return [
    { ...basis("weg", ["path", "track"], 12.5), layout: { "line-cap": "butt", "line-join": "round" },
      paint: { "line-color": f.weg, "line-dasharray": [2.4, 1.4], "line-opacity": linear(12.5, 0.35, 15, 0.85), "line-width": zoom(12.5, 0.7, 16, 1.6, 18, 2.6) } },
    ...rand,
    { ...basis("bahn", ["rail", "transit"], 9), layout: {}, paint: { "line-color": f.bahn, "line-width": zoom(9, 0.6, 15, 1.8) } },
    { ...basis("seilbahn", ["aerialway"], 12), paint: { "line-color": f.text2, "line-width": 1, "line-dasharray": [4, 2] } },
    { ...basis("faehre", ["ferry"], 9), paint: { "line-color": f.wasserText, "line-width": 0.9, "line-opacity": 0.35, "line-dasharray": [4, 3] } },
    ...voll,
  ];
}

function beschriftung(f, { bild = false } = {}) {
  const text = (id, schicht, mehr) => ({ id, type: "symbol", source: "osm", "source-layer": schicht, ...mehr,
    paint: { "text-color": f.text, "text-halo-color": f.halo, "text-halo-width": 1.4, "text-halo-blur": 0.4, ...mehr.paint } });
  const grenzen = [
    { id: "grenze-land", type: "line", source: "osm", "source-layer": "boundary", filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
      paint: { "line-color": f.grenze, "line-width": linear(3, 0.6, 10, 1.8), "line-opacity": 0.7 } },
    { id: "grenze-bund", type: "line", source: "osm", "source-layer": "boundary", minzoom: 5, filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
      paint: { "line-color": f.grenze, "line-width": 0.8, "line-opacity": 0.45, "line-dasharray": [3, 2] } },
  ];
  const ort = (id, klassen, ab, groesse, mehr = {}) => text(id, "place", { minzoom: ab, filter: klasse(...klassen),
    layout: { "text-field": NAME, "text-font": mehr.schrift || NORMAL, "text-size": groesse, "text-max-width": 8, "symbol-sort-key": ["coalesce", ["get", "rank"], 99], "text-padding": 4, ...mehr.layout },
    paint: mehr.paint || {}, ...(mehr.bis ? { maxzoom: mehr.bis } : {}) });
  return [
    ...grenzen,
    text("fluss-name", "waterway", { minzoom: 12, filter: ["==", ["get", "class"], "river"],
      layout: { "symbol-placement": "line", "text-field": NAME, "text-font": KURSIV, "text-size": 11.5, "symbol-spacing": 350 }, paint: { "text-color": f.wasserText } }),
    text("see-name", "water_name", { minzoom: 3, layout: { "text-field": NAME, "text-font": KURSIV, "text-size": linear(3, 11, 12, 13), "text-max-width": 7, "text-letter-spacing": 0.04 },
      paint: { "text-color": f.wasserText } }),
    ...(bild ? [] : [
      text("strasse-name", "transportation_name", { minzoom: 14, filter: klasse("minor", "service", "tertiary", "secondary", "primary", "trunk"),
        layout: { "symbol-placement": "line", "text-field": NAME, "text-font": NORMAL, "text-size": linear(14, 10.5, 18, 13), "symbol-spacing": 300 }, paint: { "text-color": f.text2 } }),
      text("strasse-nr", "transportation_name", { minzoom: 8, filter: ["all", klasse("motorway", "trunk", "primary"), ["has", "ref"], ["<=", ["get", "ref_length"], 6]],
        layout: { "symbol-placement": "line", "text-rotation-alignment": "viewport", "text-field": ["get", "ref"], "text-font": FETT, "text-size": 10, "symbol-spacing": 420 },
        paint: { "text-color": f.text2, "text-halo-width": 2 } }),
      { id: "poi", type: "symbol", source: "osm", "source-layer": "poi", minzoom: 13,
        filter: ["all", klasse(...Object.keys(POI)), [">=", ["zoom"], ["match", ["get", "class"], ["campsite"], 13, ["grocery", "fuel", "drinking_water", "swimming"], 14, 15.5]]],
        layout: { "icon-image": ["concat", "poi-", ["match", ["get", "class"], ...Object.entries(POI).flat(), "tent"]], "icon-size": 1, "icon-padding": 6,
          "text-field": ["step", ["zoom"], "", 15, NAME], "text-font": NORMAL, "text-size": 10.5, "text-offset": [0, 1], "text-anchor": "top", "text-optional": true, "text-max-width": 8,
          "symbol-sort-key": ["get", "rank"] },
        paint: { "text-color": f.poi, "text-halo-color": f.poiHalo, "text-halo-width": 1.2 } },
    ]),
    text("berg", "mountain_peak", { minzoom: 10.5, filter: ["<=", ["get", "rank"], ["step", ["zoom"], 1, 12, 3, 14, 99]],
      layout: { "text-field": ["format", "▲\n", { "font-scale": 0.7 }, ["coalesce", NAME, ""], {}, ["case", ["has", "ele"], ["concat", "\n", ["to-string", ["get", "ele"]], " m"], ""], { "font-scale": 0.85 }],
        "text-font": NORMAL, "text-size": 11, "text-line-height": 1.05, "text-max-width": 8 }, paint: { "text-color": f.berg } }),
    ort("dorf", ["village"], 10.5, linear(10, 10.5, 15, 14)),
    ort("ortsteil", ["hamlet", "suburb", "neighbourhood", "isolated_dwelling"], 13, linear(13, 10, 16, 13), { paint: { "text-color": f.text2 } }),
    ort("kleinstadt", ["town"], 7.5, linear(7, 10.5, 14, 17)),
    ort("stadt", ["city"], 3.8, linear(4, 10.5, 12, 20), { schrift: FETT, bis: 15 }),
    ort("bundesland", ["state", "province"], 5, 10.5, { bis: 8, layout: { "text-transform": "uppercase", "text-letter-spacing": 0.14 }, paint: { "text-color": f.text2, "text-opacity": 0.7 } }),
    ort("staat", ["country"], 2, linear(2, 10, 6, 15), { schrift: FETT, bis: 8, layout: { "text-letter-spacing": 0.06 }, paint: { "text-color": f.text2 } }),
  ];
}

/** Eigene Ebenen: Stellplätze (gebündelt), ausgewählter Platz, Platz unter der Maus, Camper. */
function eigene(f) {
  const bild = ["concat", "platz|", ["get", "id"]];
  const name = { "text-font": FETT, "text-size": 12, "text-anchor": "top", "text-offset": [0, 0.35], "text-max-width": 9 };
  const schrift = { "text-color": f.platzText, "text-halo-color": f.platzHalo, "text-halo-width": 1.8 };
  const einzeln = ["!", ["has", "point_count"]];
  return [
    { id: "camper-hof", type: "circle", source: "camper", paint: { "circle-radius": 22, "circle-color": f.hier, "circle-opacity": 0.18 } },
    { id: "camper", type: "circle", source: "camper", paint: { "circle-radius": 8, "circle-color": f.hier, "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } },
    { id: "gruppe-hof", type: "circle", source: "plaetze", filter: ["has", "point_count"],
      paint: { "circle-color": f.cluster, "circle-opacity": 0.22, "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 2, 23, 10, 30, 40, 40] } },
    { id: "gruppe", type: "circle", source: "plaetze", filter: ["has", "point_count"],
      paint: { "circle-color": f.cluster, "circle-stroke-color": f.rand, "circle-stroke-width": 2.5, "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 2, 17, 10, 22, 40, 30] } },
    { id: "gruppe-zahl", type: "symbol", source: "plaetze", filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": FETT, "text-size": 14, "text-allow-overlap": true, "text-ignore-placement": true }, paint: { "text-color": f.clusterText } },
    { id: "platz", type: "symbol", source: "plaetze", filter: einzeln,
      layout: { "icon-image": bild, "icon-anchor": "bottom", "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-size": linear(3, 0.72, 8, 0.9, 12, 1), "symbol-z-order": "viewport-y",
        "text-field": ["step", ["zoom"], "", 8, ["get", "name"]], "text-optional": true, ...name, "text-size": linear(8, 11, 13, 13) }, paint: schrift },
    { id: "platz-hover", type: "symbol", source: "hover",
      layout: { "icon-image": bild, "icon-anchor": "bottom", "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-size": 1.2, "text-field": ["get", "name"], "text-allow-overlap": true, ...name }, paint: schrift },
    { id: "platz-gewaehlt", type: "symbol", source: "auswahl",
      layout: { "icon-image": bild, "icon-anchor": "bottom", "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-size": 1.4, "text-field": ["get", "name"], "text-allow-overlap": true, ...name, "text-size": 13.5 }, paint: schrift },
  ];
}

export function kartenstil({ dunkel = false, ebene = "standard", plaetze = leer, auswahl = leer, hover = leer, camper = leer } = {}) {
  const e = EBENEN[ebene] ? ebene : "standard";
  const f = { ...(dunkel ? DUNKEL : HELL), ...(e === "satellit" ? AUF_BILD : {}) };
  const d = EBENEN[e];
  const osm = { type: "vector", url: "https://tiles.openfreemap.org/planet" };
  const quellen = {
    ...(e === "standard" ? { osm, relief: { type: "raster-dem", tiles: ["https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"], encoding: "terrarium", tileSize: 512, maxzoom: 12,
      attribution: '© <a href="https://mapterhorn.com/attribution">Mapterhorn</a>' } } : {}),
    // Geländefarben für die Übersicht (Natural Earth), gehen ab Zoom 6 in die Vektorflächen über
    ...(e === "standard" ? { natur: { type: "raster", tiles: ["https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 6 } } : {}),
    ...(e === "satellit" ? { osm } : {}),
    ...(d.kacheln ? { [`bild-${e}`]: { type: "raster", tiles: d.kacheln, tileSize: 256, maxzoom: d.max, attribution: d.quelle } } : {}),
    ...(d.welt ? { "bild-welt": { type: "raster", tiles: d.welt.kacheln, tileSize: 256, maxzoom: d.welt.max, attribution: d.welt.quelle } } : {}),
    ...Object.fromEntries((d.laender || []).map((l) => [`bild-${l.id}`, { type: "raster", tiles: [LUFTBILD + l.kacheln], tileSize: 256, bounds: l.gebiet, minzoom: 8,
      maxzoom: l.max, attribution: l.quelle }])),
    camper: { type: "geojson", data: camper },
    plaetze: { type: "geojson", data: plaetze, cluster: true, clusterRadius: 46, clusterMaxZoom: 12 },
    hover: { type: "geojson", data: hover },
    auswahl: { type: "geojson", data: auswahl },
  };
  const grund = { id: "grund", type: "background", paint: { "background-color": e === "satellit" ? "#0b1a24" : f.land } };
  const wasser = e === "standard" ? [
    { id: "bach", type: "line", source: "osm", "source-layer": "waterway", minzoom: 8, filter: ["!=", ["get", "brunnel"], "tunnel"], layout: { "line-cap": "round" },
      paint: { "line-color": f.wasser, "line-width": zoom(8, 0.5, 14, 1.6, 18, 6) } },
    { id: "wasser", type: "fill", source: "osm", "source-layer": "water", filter: ["!=", ["get", "brunnel"], "tunnel"], paint: { "fill-color": f.wasser } },
  ] : [];
  const basis = e === "standard" ? [
    { id: "natur", type: "raster", source: "natur", maxzoom: 8, paint: { "raster-opacity": linear(5.5, dunkel ? 0.35 : 0.55, 7.5, 0),
      ...(dunkel ? { "raster-brightness-max": 0.36, "raster-saturation": -0.1 } : { "raster-saturation": 0.1 }) } },
    ...flaechen(f),
    { id: "relief", type: "hillshade", source: "relief", maxzoom: 16,
      paint: { "hillshade-method": "igor", "hillshade-exaggeration": linear(4, f.relief * 0.7, 9, f.relief, 14, f.relief * 0.8, 16, 0), "hillshade-shadow-color": f.schatten, "hillshade-highlight-color": f.licht, "hillshade-accent-color": f.schatten } },
    ...wasser,
    { id: "gebaeude", type: "fill", source: "osm", "source-layer": "building", minzoom: 13.5,
      paint: { "fill-color": f.gebaeude, "fill-outline-color": f.gebaeudeRand, "fill-opacity": linear(13.5, 0, 15, 1) } },
    ...strassen(f),
    ...beschriftung(f),
  ] : [
    // Rasterkarten im Dunkelmodus gedämpft; Satellit bleibt
    ...(d.kacheln ? [{ id: "bild", type: "raster", source: `bild-${e}`, paint: { "raster-fade-duration": 150,
      ...(dunkel ? { "raster-brightness-max": 0.58, "raster-saturation": -0.35, "raster-contrast": 0.05 } : {}) } }] : []),
    ...(d.welt ? [{ id: "bild-welt", type: "raster", source: "bild-welt", paint: { "raster-fade-duration": 150 } }] : []),
    ...(d.laender || []).map((l) => ({ id: `bild-${l.id}`, type: "raster", source: `bild-${l.id}`, minzoom: 8, paint: { "raster-fade-duration": 150 } })),
    ...(e === "satellit" ? beschriftung(f, { bild: true }) : []),
  ];
  return { version: 8, name: `Stellplätze ${e}`, glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf", sources: quellen, layers: [grund, ...basis, ...eigene(f)],
    transition: { duration: 200, delay: 0 } };
}

/** Farben für die erzeugten Bilder (Marker, POI) in karte.js. */
export const bildFarben = (dunkel) => ({ rand: dunkel ? "#16201d" : "#ffffff", poi: dunkel ? DUNKEL.poi : HELL.poi, poiGrund: dunkel ? "#1f2b27" : "#ffffff", offen: "#f2a71b" });
