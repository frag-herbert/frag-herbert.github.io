/*
 * Abgleich eines Imports mit dem Bestand (KONZEPT-WEBAPP.md 12.8.4): reine Regeln, ohne Oberfläche und ohne Datenbank.
 *
 * abgleichen() ordnet jeden eingehenden Platz einer Gruppe zu: neu · gleich · aktualisiert · frage. Fragen haben immer eine
 * Vorgabe, die nichts verliert (vorhandenen Wert behalten, beide Besuche behalten, gelöschten Platz nicht zurückholen).
 * aufloesen() macht aus Eintrag und Antworten den Platz, der geschrieben wird (oder null = überspringen).
 *
 * Fragen: { typ, optionen: [[wert, text]], vorgabe, … }
 *   vermerkt  Platz ist hier als endgültig entfernt vermerkt          wieder · ueberspringen
 *   ort       andere ID, aber ein Platz im Umkreis                   derselbe · eigener · ueberspringen
 *   feld      Wert verschieden, Änderungszeit gleich oder unbekannt  hier · dort (· beide bei der Notiz)
 *   geloescht auf einer Seite gelöscht, auf der anderen danach geändert   wiederherstellen · loeschen
 *   besuch    neuer Besuch überschneidet sich mit einem vorhandenen  beide · zusammen
 */
import { FELDER, AUSSTATTUNG_KEYS, UMKREIS_KM, km, letzteAenderung, jetztIso, tagVon } from "./plaetze.js?v=11";

const gleich = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const leer = (k, w) => w === null || w === undefined || w === "" || w === false || w === 0 && k === "bewertung" || (Array.isArray(w) && !w.length);
/** Felder, die eine Frage wert sind (Koordinaten, Umkreis, gepflegt, Titelfoto regeln sich selbst). */
const FRAGEFELDER = ["name", "land", "art", "preis", "bewertung", "notiz"];
export const FELDNAMEN = { name: "Name", land: "Land", art: "Art", preis: "Preis", bewertung: "Bewertung", notiz: "Notiz" };

const tag = (z) => (z || "").slice(0, 10);
function ueberschneiden(a, b, heute) {
  const [a1, a2, b1, b2] = [tag(a.ankunft), tag(a.abfahrt) || heute, tag(b.ankunft), tag(b.abfahrt) || heute];
  return a1 <= b2 && b1 <= a2;
}

/** Besuche zusammenlegen: neueste Änderung je ID; neue IDs, die sich überschneiden, werden zu Fragen. */
function besucheAbgleichen(hier, dort, heute) {
  const nach = new Map(hier.map((b) => [b.id, b])), fragen = [];
  let geaendert = false;
  for (const b of dort) {
    const h = nach.get(b.id);
    if (h) { if ((b.t || "") > (h.t || "") && !gleich(b, h)) { nach.set(b.id, b); geaendert = true; } continue; }
    const mit = !b.weg && hier.find((x) => !x.weg && ueberschneiden(x, b, heute));
    if (mit) fragen.push({ typ: "besuch", besuch: b, mit, optionen: [["beide", "beide behalten"], ["zusammen", "zu einem Besuch zusammenlegen"]], vorgabe: "beide" });
    else { nach.set(b.id, b); geaendert = true; }
  }
  return { besuche: [...nach.values()], fragen, geaendert };
}

/** Gleiche ID, beide mit Änderungszeiten: je Feld gewinnt die jüngere Änderung, gleiche Zeit → Frage. */
function mitZeitenAbgleichen(hier, dort, heute) {
  const p = { ...hier, zeiten: { ...hier.zeiten } }, fragen = [];
  let geaendert = false;
  for (const k of FELDER) {
    if (k === "geloescht" || gleich(hier[k], dort[k])) continue;
    const th = hier.zeiten?.[k] || "", td = dort.zeiten?.[k] || "";
    if (td > th) { p[k] = dort[k]; p.zeiten[k] = td; geaendert = true; }
    else if (td === th && leer(k, dort[k])) continue; // hier belegt, dort leer: nichts zu fragen
    else if (td === th && FRAGEFELDER.includes(k) && !leer(k, hier[k])) fragen.push(feldFrage(k, hier[k], dort[k], td));
    else if (td === th && !leer(k, dort[k]) && leer(k, hier[k])) { p[k] = dort[k]; geaendert = true; } // z. B. Ausstattung: im Zweifel der belegte Wert
  }
  // Gelöscht auf einer Seite: gilt, außer die andere Seite wurde danach geändert
  if (!gleich(hier.geloescht, dort.geloescht)) {
    const geloeschtDort = !!dort.geloescht && !hier.geloescht, zeit = dort.geloescht || hier.geloescht;
    const andere = geloeschtDort ? hier : dort;
    if (letzteAenderung({ ...andere, zeiten: { ...andere.zeiten, geloescht: "" } }) > zeit) {
      fragen.push({ typ: "geloescht", seite: geloeschtDort ? "dort" : "hier", zeit,
        optionen: [["wiederherstellen", "behalten (nicht gelöscht)"], ["loeschen", "gelöscht lassen"]], vorgabe: "wiederherstellen" });
    } else if ((dort.zeiten?.geloescht || "") > (hier.zeiten?.geloescht || "")) { p.geloescht = dort.geloescht; p.zeiten.geloescht = dort.zeiten.geloescht; geaendert = true; }
  }
  const b = besucheAbgleichen(hier.besuche || [], dort.besuche || [], heute);
  p.besuche = b.besuche;
  return { platz: p, fragen: [...fragen, ...b.fragen], geaendert: geaendert || b.geaendert };
}

function feldFrage(feld, hier, dort, zeit = "") {
  const optionen = [["hier", "hier behalten"], ["dort", "aus der Datei"]];
  if (feld === "notiz") optionen.push(["beide", "beide behalten"]);
  return { typ: "feld", feld, hier, dort, zeit, optionen, vorgabe: "hier" };
}

/** Andere ID, „derselbe Platz“: leere Felder füllen, belegte und verschiedene werden zu Fragen. */
function ohneZeitenAbgleichen(hier, dort, heute) {
  const p = { ...hier, zeiten: { ...hier.zeiten } }, fragen = [], t = jetztIso();
  let geaendert = false;
  for (const k of FELDER) {
    if (["lat", "lon", "umkreis_km", "geloescht", "gepflegt", "titelfoto"].includes(k) || leer(k, dort[k]) || gleich(hier[k], dort[k])) continue;
    if (AUSSTATTUNG_KEYS.includes(k) || k === "aktivitaeten") {
      p[k] = k === "aktivitaeten" ? [...new Set([...(hier[k] || []), ...dort[k]])] : true;
      if (!gleich(p[k], hier[k])) { p.zeiten[k] = t; geaendert = true; }
    } else if (leer(k, hier[k])) { p[k] = dort[k]; p.zeiten[k] = t; geaendert = true; }
    else if (FRAGEFELDER.includes(k)) fragen.push(feldFrage(k, hier[k], dort[k]));
  }
  if (!p.titelfoto && dort.titelfoto) p.titelfoto = dort.titelfoto;
  if (dort.gepflegt && !p.gepflegt) p.gepflegt = true;
  // Besuche des anderen Platzes kommen mit, IDs bleiben eindeutig
  const b = besucheAbgleichen(hier.besuche || [], dort.besuche || [], heute);
  p.besuche = b.besuche;
  return { platz: p, fragen: [...fragen, ...b.fragen], geaendert: geaendert || b.geaendert };
}

/**
 * bestand: alle Plätze hier (auch im Papierkorb); plaetze: eingehende, geprüfte Plätze; fotos: eingehende Fotos;
 * vermerke: { plaetze, fotos } hier; bekannteFotos: Set der Foto-IDs hier; mitZeiten: Quelle führt Änderungszeiten (Frag-Herbert-Export).
 * → { eintraege: [{ platz, ziel, gruppe, fragen, neueFotos, abstand }] }
 */
export function abgleichen({ bestand, plaetze, fotos = [], vermerke = { plaetze: {}, fotos: {} }, bekannteFotos = new Set(), mitZeiten = true, heute = tagVon(new Date()) }) {
  // Ohne IDs (fremde Formate) ist ein Ort-Treffer meist derselbe Platz aus einer anderen Liste: Vorgabe „nicht übernehmen“
  const nachId = new Map(bestand.map((p) => [p.id, p]));
  const fotosJe = new Map();
  for (const f of fotos) if (!bekannteFotos.has(f.id) && !vermerke.fotos[f.id]) fotosJe.set(f.platz, (fotosJe.get(f.platz) || 0) + 1);
  const eintraege = plaetze.map((dort) => {
    const neueFotos = fotosJe.get(dort.id) || 0;
    if (vermerke.plaetze[dort.id] && !nachId.has(dort.id)) {
      return { platz: dort, ziel: null, gruppe: "frage", neueFotos,
        fragen: [{ typ: "vermerkt", zeit: vermerke.plaetze[dort.id], optionen: [["ueberspringen", "nicht zurückholen"], ["wieder", "wieder anlegen"]], vorgabe: "ueberspringen" }] };
    }
    const hier = mitZeiten ? nachId.get(dort.id) : null;
    if (hier) {
      const r = mitZeitenAbgleichen(hier, dort, heute);
      return { platz: dort, ziel: hier, gruppe: r.fragen.length ? "frage" : r.geaendert || neueFotos ? "aktualisiert" : "gleich", fragen: r.fragen, neueFotos, ergebnis: r.platz };
    }
    // Andere ID: liegt ein Platz im Umkreis?
    let naechster = null;
    for (const p of bestand) {
      if (p.geloescht || p.id === dort.id) continue;
      const d = km(p.lat, p.lon, dort.lat, dort.lon);
      if (d <= (p.umkreis_km || UMKREIS_KM) && (!naechster || d < naechster.d)) naechster = { p, d };
    }
    if (naechster) {
      const gleicherName = (naechster.p.name || "").trim().toLowerCase() === (dort.name || "").trim().toLowerCase() && !!dort.name;
      return { platz: dort, ziel: naechster.p, gruppe: "frage", neueFotos, abstand: naechster.d,
        fragen: [{ typ: "ort", abstand: naechster.d, gleicherName,
          optionen: [["derselbe", `derselbe Platz wie „${naechster.p.name || "Ohne Namen"}“`], ["eigener", "eigener Platz"], ["ueberspringen", "nicht übernehmen"]],
          vorgabe: gleicherName && naechster.d <= 0.03 ? "derselbe" : mitZeiten ? "eigener" : "ueberspringen" }] };
    }
    return { platz: dort, ziel: null, gruppe: "neu", fragen: [], neueFotos };
  });
  return { eintraege };
}

/** Unterfragen, die erst nach einer Antwort entstehen (Felder und Besuche bei „derselbe Platz“). */
export function folgefragen(e, antworten, heute = tagVon(new Date())) {
  const ort = e.fragen.find((f) => f.typ === "ort");
  if (!ort || (antworten[0] ?? ort.vorgabe) !== "derselbe") return [];
  return ohneZeitenAbgleichen(e.ziel, e.platz, heute).fragen;
}

/**
 * Eintrag + Antworten (Liste je Frage, dann je Folgefrage; fehlende = Vorgabe) → { platz, fotoZiel, vermerkWeg } oder null.
 * fotoZiel: ID, unter der die Fotos dieses Platzes landen. vermerkWeg: Vermerk „entfernt“ löschen (wieder angelegt).
 */
export function aufloesen(e, antworten = [], heute = tagVon(new Date())) {
  const wahl = (i, f) => antworten[i] ?? f.vorgabe;
  const t = jetztIso();
  if (e.fragen[0]?.typ === "vermerkt") return wahl(0, e.fragen[0]) === "wieder" ? { platz: e.platz, fotoZiel: e.platz.id, vermerkWeg: true } : null;
  let r, fragen = e.fragen, versatz = 0;
  if (e.fragen[0]?.typ === "ort") {
    if (wahl(0, e.fragen[0]) === "ueberspringen") return null;
    if (wahl(0, e.fragen[0]) === "eigener") return { platz: e.platz, fotoZiel: e.platz.id };
    r = ohneZeitenAbgleichen(e.ziel, e.platz, heute);
    fragen = r.fragen;
    versatz = 1;
  } else if (e.ziel) r = { platz: e.ergebnis };
  else return { platz: e.platz, fotoZiel: e.platz.id };
  const p = { ...r.platz, zeiten: { ...r.platz.zeiten }, besuche: [...r.platz.besuche] };
  fragen.forEach((f, i) => {
    const w = wahl(i + versatz, f);
    if (f.typ === "feld" && w !== "hier") {
      p[f.feld] = w === "beide" ? `${f.hier}\n\n${f.dort}` : f.dort;
      p.zeiten[f.feld] = t;
    } else if (f.typ === "geloescht") {
      p.geloescht = w === "loeschen" ? f.zeit : null;
      p.zeiten.geloescht = t;
    } else if (f.typ === "besuch") {
      if (w === "beide") p.besuche.push(f.besuch);
      else {
        const i2 = p.besuche.findIndex((b) => b.id === f.mit.id), a = p.besuche[i2], b = f.besuch;
        p.besuche[i2] = { ...a, ankunft: a.ankunft < b.ankunft ? a.ankunft : b.ankunft,
          abfahrt: !a.abfahrt || !b.abfahrt ? null : a.abfahrt > b.abfahrt ? a.abfahrt : b.abfahrt,
          ganztags: a.ganztags && b.ganztags, naechte: { ...b.naechte, ...a.naechte }, t };
      }
    }
  });
  return { platz: p, fotoZiel: p.id };
}

/** Mitgebrachte Vermerke „entfernt“: welche Plätze hier gehen, welche bleiben (nach dem Entfernen hier geändert). */
export function entfernungen(bestand, entfernt = []) {
  const nachId = new Map(bestand.map((p) => [p.id, p])), entfernen = [], behalten = [];
  for (const e of entfernt) {
    const p = nachId.get(e.id);
    if (p) (letzteAenderung(p) > e.zeit ? behalten : entfernen).push(p);
  }
  return { entfernen, behalten };
}
