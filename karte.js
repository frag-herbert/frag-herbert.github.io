/*
 * Karte von Frag Herbert (MapLibre GL, lokal unter maplibre/). Vektorkacheln und Marker zeichnet die Grafikeinheit,
 * dadurch stufenloser Zoom. Marker sind Bilder im Stil (Titelbild im Kreis, Ring in der Farbe der Art), keine HTML-Elemente.
 */
import { PFADE } from "./icons.js?v=13";
import { kartenstil, bildFarben, ART_FARBEN, EBENEN, LUFTBILD, LAENDER } from "./kartenstil.js?v=13";

const MAX_ZOOM = 18.5;
const LEER = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGBgAAAAAP//XRcpzQAAAAZJREFUAwAADwADJDd96QAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0)).buffer;

/** Länder-Luftbilder (kartenstil.js): reines Weiß ist Füllung außerhalb des Landes → durchsichtig, damit Sentinel-2 darunter sichtbar
 *  bleibt. Ganz weiße oder fehlende Kacheln → leeres Bild. Der Abruf geht wie jeder andere durch den Service Worker (Offline-Speicher). */
async function luftbild({ url }, abbruch) {
  const r = await fetch(url.slice(LUFTBILD.length), { signal: abbruch.signal }).catch((e) => { if (e.name === "AbortError") throw e; return null; });
  if (!r?.ok || !/^image\//.test(r.headers.get("content-type") || "")) return { data: LEER.slice(0) }; // eigene Kopie: MapLibre übergibt die Daten an den Worker
  const roh = await r.blob(), bild = await createImageBitmap(roh);
  const c = new OffscreenCanvas(bild.width, bild.height), g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(bild, 0, 0);
  bild.close();
  const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
  let weiss = 0;
  for (let i = 0; i < p.length; i += 4) if (p[i] >= 252 && p[i + 1] >= 252 && p[i + 2] >= 252) { p[i + 3] = 0; weiss++; }
  if (!weiss) return { data: await roh.arrayBuffer() };
  if (weiss === p.length / 4) return { data: LEER.slice(0) }; // eigene Kopie: MapLibre übergibt die Daten an den Worker
  g.putImageData(d, 0, 0);
  return { data: await (await c.convertToBlob({ type: "image/png" })).arrayBuffer() };
}
let luftbildDa = false;
const sammlung = (features) => ({ type: "FeatureCollection", features });
const punkt = (lon, lat, properties = {}) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties });

export class Karte {
  /**
   * @param optionen { wurzel, symbol(art) → Name aus icons.js, bildUrl(schlüssel) → Promise<Adresse>, aufPlatz(id), aufLeer(), aufHover(id|null), rand() → { top, left, right, bottom } verdeckte Ränder }
   */
  constructor(optionen) {
    this.o = optionen;
    this.plaetze = new Map();
    this.fotos = new Map(); // Pfad → HTMLImageElement | Promise
    this.zustand = { dunkel: false, ebene: "standard", plaetze: sammlung([]), auswahl: sammlung([]), hover: sammlung([]), camper: sammlung([]) };
  }

  static moeglich() {
    try { return !!window.maplibregl && !!document.createElement("canvas").getContext("webgl2"); } catch (e) { return false; }
  }

  aufbauen({ dunkel, ebene, mitte, zoom }) {
    Object.assign(this.zustand, { dunkel, ebene });
    // CSP-Fassung mit eigener Worker-Datei: gleiche Herkunft, damit der Service Worker auch dessen Kachelabrufe sieht
    maplibregl.setWorkerUrl(new URL("maplibre/maplibre-gl-csp-worker.js", location.href).href);
    if (!luftbildDa) { maplibregl.addProtocol(LUFTBILD.slice(0, -3), luftbild); luftbildDa = true; }
    const k = (this.k = new maplibregl.Map({
      container: this.o.wurzel, style: kartenstil(this.zustand), center: mitte || [10.5, 50.5], zoom: zoom ?? 4.8, minZoom: 2, maxZoom: MAX_ZOOM,
      attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false, touchPitch: false, maxPitch: 0, fadeDuration: 180,
      localIdeographFontFamily: false, renderWorldCopies: false,
    }));
    k.touchZoomRotate.disableRotation();
    k.keyboard.disableRotation();
    // Quellenangabe eingeklappt beginnen (Tipp auf ⓘ zeigt sie)
    k.once("load", () => this.o.wurzel.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
    k.on("styleimagemissing", (e) => this.bildErzeugen(e.id));
    k.on("error", (e) => { if (!/Failed to fetch|AJAXError|NetworkError|Load failed/.test(String(e.error))) console.warn("Karte:", e.error?.message || e); });
    const treffer = (p, ebenen, d = 6) => (k.isStyleLoaded() || k.getLayer("platz")
      ? k.queryRenderedFeatures([[p.x - d, p.y - d], [p.x + d, p.y + d]], { layers: ebenen.filter((x) => k.getLayer(x)) })[0] : null);
    k.on("click", async (e) => {
      const platz = treffer(e.point, ["platz-gewaehlt", "platz-hover", "platz"]);
      if (platz) return this.o.aufPlatz(platz.properties.id);
      const gruppe = treffer(e.point, ["gruppe"]);
      if (!gruppe) return this.o.aufLeer();
      const z = await k.getSource("plaetze").getClusterExpansionZoom(gruppe.properties.cluster_id);
      k.easeTo({ center: gruppe.geometry.coordinates, zoom: Math.min(z + 0.4, MAX_ZOOM), offset: this.versatz(), duration: 450 });
    });
    if (matchMedia("(hover: hover)").matches) {
      k.on("mousemove", (e) => {
        const f = treffer(e.point, ["platz-gewaehlt", "platz-hover", "platz", "gruppe"], 1);
        k.getCanvas().style.cursor = f ? "pointer" : "";
        this.o.aufHover(f?.properties.id || null);
      });
      k.getCanvas().addEventListener("mouseleave", () => this.o.aufHover(null));
    }
    if (window.ResizeObserver) new ResizeObserver(() => k.resize()).observe(this.o.wurzel);
    // Länder-Luftbilder nur einblenden, wenn ihr Gebiet im Ausschnitt liegt: spart Abrufe, und die Quellenangabe nennt nur Sichtbares
    k.on("moveend", () => this.laenderZeigen());
    k.on("styledata", () => this.laenderZeigen());
  }

  // ------------------------------------------------------------ Daten

  quelleSetzen(name, daten) {
    this.zustand[name] = daten;
    // Vor dem Laden des Stils steht die Quelle noch nicht bereit → nachreichen
    const s = this.k?.getSource(name);
    if (s) s.setData(daten);
    else this.k?.once("styledata", () => this.k.getSource(name)?.setData(this.zustand[name]));
  }
  feature(p) { return punkt(p.lon, p.lat, { id: p.id, name: p.name }); }

  setzen(liste, hier) {
    for (const p of liste) {
      const alt = this.plaetze.get(p.id);
      this.plaetze.set(p.id, p);
      // Titelbild, Art oder „beschrieben“ geändert → Markerbild neu zeichnen
      if (alt && (alt.titelbild !== p.titelbild || alt.art !== p.art || alt.gepflegt !== p.gepflegt) && this.k?.hasImage(`platz|${p.id}`)) this.bildErzeugen(`platz|${p.id}`);
    }
    const daten = sammlung(liste.map((p) => this.feature(p)));
    const sig = JSON.stringify(daten);
    if (sig !== this.sig) { this.sig = sig; this.quelleSetzen("plaetze", daten); }
    this.quelleSetzen("camper", sammlung(hier ? [punkt(hier[1], hier[0])] : []));
  }

  waehlen(id) {
    const p = id && this.plaetze.get(id);
    this.gewaehlt = p ? id : null;
    this.quelleSetzen("auswahl", sammlung(p ? [this.feature(p)] : []));
  }

  hover(id) {
    const p = id && id !== this.gewaehlt && this.plaetze.get(id);
    this.quelleSetzen("hover", sammlung(p ? [this.feature(p)] : []));
  }

  laenderZeigen() {
    const k = this.k;
    if (!k || this.zustand.ebene !== "satellit") return;
    const b = k.getBounds();
    for (const l of LAENDER) {
      if (!k.getLayer(`bild-${l.id}`)) continue;
      const [w, s, o, n] = l.gebiet, sichtbar = b.getWest() < o && b.getEast() > w && b.getSouth() < n && b.getNorth() > s ? "visible" : "none";
      if (k.getLayoutProperty(`bild-${l.id}`, "visibility") !== sichtbar) k.setLayoutProperty(`bild-${l.id}`, "visibility", sichtbar);
    }
  }

  // ------------------------------------------------------------ Ausschnitt

  versatz() {
    const r = this.o.rand();
    return [(r.left - r.right) / 2, (r.top - r.bottom) / 2];
  }

  /** Platz in den unverdeckten Teil holen; liegt er schon dort und nah genug, bleibt die Karte stehen. */
  zeigen(p, { mindestzoom = 10, immer = false } = {}) {
    if (!this.k) return;
    const r = this.o.rand(), c = this.k.getContainer(), s = this.k.project([p.lon, p.lat]);
    const sichtbar = s.x > r.left + 40 && s.x < c.clientWidth - r.right - 40 && s.y > r.top + 70 && s.y < c.clientHeight - r.bottom - 30;
    if (sichtbar && !immer && this.k.getZoom() >= mindestzoom - 2) return;
    this.k.easeTo({ center: [p.lon, p.lat], zoom: Math.max(this.k.getZoom(), mindestzoom), offset: this.versatz(), duration: 650 });
  }

  alle(liste, animiert = true) {
    if (!this.k || !liste.length) return;
    const b = new maplibregl.LngLatBounds();
    liste.forEach((p) => b.extend([p.lon, p.lat]));
    const r = this.o.rand(), c = this.k.getContainer();
    // Rand nie größer als die Karte (sonst verweigert MapLibre den Ausschnitt)
    const kuerzen = (x, max) => Math.max(0, Math.min(x, max));
    this.k.fitBounds(b, { maxZoom: 12, duration: animiert ? 700 : 0, linear: true, padding: {
      top: r.top + 70, bottom: kuerzen(r.bottom + 40, c.clientHeight - r.top - 190), left: r.left + 40,
      right: r.right + (r.right ? 40 : 80) } }); // Handy: Platz für die Kartenknöpfe (am Mac schon in rand())
  }

  ort(lat, lon) { this.k?.easeTo({ center: [lon, lat], zoom: Math.max(this.k.getZoom(), 13), offset: this.versatz(), duration: 650 }); }
  /** Mitte des unverdeckten Teils: Bildschirmpunkt und Koordinaten. */
  mitte() {
    const c = this.k.getContainer(), [dx, dy] = this.versatz(), x = c.clientWidth / 2 + dx, y = c.clientHeight / 2 + dy, o = this.k.unproject([x, y]);
    return { x, y, lat: o.lat, lon: o.lng };
  }
  zoomen(d) { this.k?.easeTo({ zoom: this.k.getZoom() + d, around: this.k.unproject([this.k.getContainer().clientWidth / 2 + this.versatz()[0], this.k.getContainer().clientHeight / 2 + this.versatz()[1]]), duration: 250 }); }

  // ------------------------------------------------------------ Stil

  stilSetzen({ ebene = this.zustand.ebene, dunkel = this.zustand.dunkel } = {}) {
    if (!EBENEN[ebene]) ebene = "standard";
    if (ebene === this.zustand.ebene && dunkel === this.zustand.dunkel) return;
    const farben = dunkel !== this.zustand.dunkel;
    Object.assign(this.zustand, { ebene, dunkel });
    if (!this.k) return;
    this.k.setStyle(kartenstil(this.zustand), { diff: true });
    if (farben) for (const id of this.k.listImages()) if (/^(platz\||poi-)/.test(id)) this.bildErzeugen(id);
  }

  // ------------------------------------------------------------ Bilder für den Stil (Marker, POI)

  bildSetzen(id, c, dpr) {
    if (!this.k) return;
    const daten = c.getContext("2d").getImageData(0, 0, c.width, c.height);
    if (this.k.hasImage(id)) this.k.updateImage(id, daten);
    else this.k.addImage(id, daten, { pixelRatio: dpr });
  }

  bildErzeugen(id) {
    if (id.startsWith("poi-")) return this.poiBild(id);
    const p = id.startsWith("platz|") && this.plaetze.get(id.slice(6));
    if (!p) return;
    const foto = p.titelbild && this.fotos.get(p.titelbild);
    this.markerBild(id, p, foto instanceof HTMLImageElement ? foto : null);
    if (p.titelbild && !foto) {
      this.fotos.set(p.titelbild, "lädt");
      this.fotoLaden(p.titelbild).then((img) => { this.fotos.set(p.titelbild, img); this.bildErzeugen(id); })
        .catch(() => this.fotos.delete(p.titelbild)); // bleibt beim Symbol
    }
  }

  /** Nach dem Einspielen eines Backups: alle Markerbilder neu zeichnen. */
  fotosVergessen() {
    this.fotos.clear();
    this.plaetze.clear();
    this.sig = null;
    for (const id of this.k?.listImages() || []) if (id.startsWith("platz|")) this.k.removeImage(id);
  }

  async fotoLaden(schluessel) {
    const url = await this.o.bildUrl(schluessel);
    if (!url) throw new Error("kein Bild");
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  }

  /** Marker: Kreis mit Titelbild (sonst Symbol auf der Farbe der Art), Ring in der Farbe der Art, Spitze, gelber Punkt = unbeschrieben. */
  markerBild(id, p, foto) {
    const dpr = 3, G = 44, R = 18, X = 24, Y = 22, B = 48, H = 54;
    const c = document.createElement("canvas");
    c.width = B * dpr; c.height = H * dpr;
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    const f = bildFarben(this.zustand.dunkel);
    const farbe = ART_FARBEN[this.zustand.dunkel ? "dunkel" : "hell"][p.art || ""] || ART_FARBEN.hell[""];
    const kreis = (r) => { g.beginPath(); g.arc(X, Y, r, 0, 7); };
    // Spitze und Grundform in der Artfarbe, außen heller Saum
    g.shadowColor = "rgba(0,0,0,0.35)"; g.shadowBlur = 5; g.shadowOffsetY = 2;
    g.fillStyle = f.rand;
    g.beginPath(); g.arc(X, Y, G / 2 - 0.5, 0.35 * Math.PI, 0.65 * Math.PI, true); g.lineTo(X, H - 3); g.closePath(); g.fill();
    g.shadowColor = "transparent";
    g.fillStyle = farbe;
    g.beginPath(); g.arc(X, Y, G / 2 - 2, 0.36 * Math.PI, 0.64 * Math.PI, true); g.lineTo(X, H - 6); g.closePath(); g.fill();
    if (foto) {
      g.save();
      kreis(R - 0.5); g.clip();
      const s = Math.min(foto.naturalWidth, foto.naturalHeight);
      g.drawImage(foto, (foto.naturalWidth - s) / 2, (foto.naturalHeight - s) / 2, s, s, X - R, Y - R, R * 2, R * 2);
      g.restore();
    } else {
      g.save();
      g.translate(X - 12, Y - 12);
      g.fillStyle = this.zustand.dunkel ? "#0e1513" : "#ffffff";
      g.fill(new Path2D(PFADE[this.o.symbol(p.art)]));
      g.restore();
    }
    if (!p.gepflegt) {
      g.beginPath(); g.arc(X + 15, Y - 14, 7, 0, 7); g.fillStyle = f.rand; g.fill();
      g.beginPath(); g.arc(X + 15, Y - 14, 5, 0, 7); g.fillStyle = f.offen; g.fill();
    }
    this.bildSetzen(id, c, dpr);
  }

  poiBild(id) {
    const dpr = 3, B = 18, c = document.createElement("canvas");
    c.width = c.height = B * dpr;
    const g = c.getContext("2d"), f = bildFarben(this.zustand.dunkel);
    g.scale(dpr, dpr);
    g.fillStyle = f.poiGrund; g.beginPath(); g.arc(B / 2, B / 2, B / 2 - 0.5, 0, 7); g.fill();
    g.translate(3.2, 3.2); g.scale(11.6 / 24, 11.6 / 24);
    g.fillStyle = f.poi;
    g.fill(new Path2D(PFADE[id.slice(4)]));
    this.bildSetzen(id, c, dpr);
  }
}
