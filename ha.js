/*
 * Verbindung zu Home Assistant (KONZEPT-WEBAPP.md 12.2.1, Stufe 1: nur lesen). Nur wer eine eigene HA mit der Integration
 * „frag_herbert“ hat, kann sich verbinden; für alle anderen bleibt es ein Eintrag in den Einstellungen ohne Wirkung.
 *   Anmeldung: HA-eigene Anmeldeseite (OAuth, client_id = Adresse der App), Token nur in diesem Browser (localStorage).
 *   Stand:     GET <HA>/api/frag_herbert/stand  → ganzer Stand, ersetzt die Kopie im HA-Bestand (speicher.haUebernehmen)
 *   Bilder:    GET <HA>/api/frag_herbert/foto/<ID>[?groesse=vorschau] → bei Bedarf, dann offline im Zwischenspeicher
 */
import { speicher, BESTAND } from "./speicher.js?v=10";
import { platzPruefen, fotoPruefen } from "./plaetze.js?v=10";

const SEITE = new URL("./", location.href).href.split(/[?#]/)[0];
const K = { ha: "herbert-ha", zustand: "herbert-ha-zustand", bestand: "herbert-bestand", loeschen: "herbert-ha-loeschen" };
const FRIST_MS = 20000;
const hole = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const merke = (k, w) => { try { w === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(w)); } catch (e) { /* gesperrt */ } };
const abruf = (url, optionen = {}) => fetch(url, { ...optionen, signal: AbortSignal.timeout?.(FRIST_MS) }).catch((e) => {
  throw new Error(e.name === "TimeoutError" ? "Home Assistant antwortet nicht." : "Home Assistant ist nicht erreichbar (Netz, Tailscale?).");
});

export const ha = {
  get adresse() { return hole(K.ha)?.adresse || null; },
  get verbunden() { return !!hole(K.ha)?.tokens; },
  get bestand() { return BESTAND; },

  /** Zur Anmeldeseite von HA; kommt mit ?code=… zurück (rueckkehr). */
  anmelden(text) {
    let u;
    try { u = new URL(text.trim().replace(/^(?!https?:\/\/)/, "https://")); } catch (e) { throw new Error("Die Adresse ist ungültig."); }
    const lokal = ["localhost", "127.0.0.1"].includes(u.hostname);
    if (u.protocol !== "https:" && !lokal) throw new Error("Home Assistant muss über https erreichbar sein.");
    const zustand = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    merke(K.ha, { adresse: u.origin });
    merke(K.zustand, zustand);
    location.href = `${u.origin}/auth/authorize?${new URLSearchParams({ response_type: "code", client_id: SEITE, redirect_uri: SEITE, state: zustand })}`;
  },

  /** Nach der Anmeldung: Code gegen Token tauschen. null = keine Rückkehr; sonst true oder Fehler. */
  async rueckkehr() {
    const q = new URLSearchParams(location.search);
    if (!q.has("code") && !q.has("error")) return null;
    history.replaceState(null, "", SEITE + location.hash);
    const zustand = hole(K.zustand);
    merke(K.zustand, null);
    if (q.has("error")) throw new Error("Die Anmeldung wurde abgebrochen.");
    if (!zustand || zustand !== q.get("state")) throw new Error("Die Anmeldung gehört nicht zu diesem Gerät. Bitte noch einmal verbinden.");
    const adresse = this.adresse;
    let fehler;
    // iOS: direkt nach dem Rücksprung ist das Netz manchmal noch nicht da
    for (const warte of [0, 1000, 2500]) {
      await new Promise((ok) => setTimeout(ok, warte));
      try {
        const r = await abruf(`${adresse}/auth/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code: q.get("code"), client_id: SEITE }) });
        if (!r.ok) throw new Error(`Die Anmeldung wurde abgelehnt (${r.status}).`);
        const t = await r.json();
        merke(K.ha, { adresse, tokens: { access: t.access_token, refresh: t.refresh_token, bis: Date.now() + t.expires_in * 1000 } });
        return true;
      } catch (e) { fehler = e; if (/abgelehnt/.test(e.message)) break; }
    }
    throw fehler;
  },

  async token() {
    const d = hole(K.ha);
    if (!d?.tokens) throw new Error("Nicht mit Home Assistant verbunden.");
    if (Date.now() < d.tokens.bis - 60000) return d.tokens.access;
    const r = await abruf(`${d.adresse}/auth/token`, { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: d.tokens.refresh, client_id: SEITE }) });
    if (r.status === 400 || r.status === 401) { merke(K.ha, { adresse: d.adresse }); throw new Error("Die Anmeldung bei Home Assistant ist abgelaufen. Bitte neu verbinden."); }
    if (!r.ok) throw new Error(`Home Assistant: Fehler ${r.status}`);
    const n = await r.json();
    merke(K.ha, { ...d, tokens: { ...d.tokens, access: n.access_token, bis: Date.now() + n.expires_in * 1000 } });
    return n.access_token;
  },

  async holen(pfad) {
    const r = await abruf(`${this.adresse}${pfad}`, { headers: { Authorization: `Bearer ${await this.token()}` }, cache: "no-store" });
    if (r.status === 404) throw new Error("In Home Assistant fehlt die Integration „Frag Herbert“.");
    if (r.status === 401) { merke(K.ha, { adresse: this.adresse }); throw new Error("Die Anmeldung bei Home Assistant ist abgelaufen. Bitte neu verbinden."); }
    if (!r.ok) throw new Error(`Home Assistant: Fehler ${r.status}`);
    return r;
  },

  /** Ganzen Stand holen und die Kopie ersetzen (nur im HA-Bestand). → { plaetze, fotos } Anzahlen */
  async standHolen() {
    let d;
    try { d = await (await this.holen("/api/frag_herbert/stand")).json(); } catch (e) { throw e instanceof SyntaxError ? new Error("Die Antwort von Home Assistant ist unlesbar.") : e; }
    if (d?.format !== "frag-herbert" || d.quelle !== "ha" || !Array.isArray(d.plaetze)) throw new Error("Die Antwort von Home Assistant passt nicht zu dieser App.");
    if (!(d.fassung <= 1)) throw new Error("Home Assistant liefert eine neuere Fassung. Bitte die App aktualisieren.");
    const plaetze = d.plaetze.map(platzPruefen).filter(Boolean), ids = new Set(plaetze.map((p) => p.id));
    const fotos = (Array.isArray(d.fotos) ? d.fotos : []).map(fotoPruefen).filter((f) => f && !f.geloescht && ids.has(f.platz));
    await speicher.haUebernehmen({ plaetze, fotos, gelesen: typeof d.gelesen === "string" ? d.gelesen : new Date().toISOString() });
    return { plaetze: plaetze.length, fotos: fotos.length };
  },

  /** Bild "<Foto-ID>|g" oder "|v" aus HA holen und für offline ablegen → Blob oder null. */
  async bildHolen(schluessel) {
    const [id, art] = schluessel.split("|");
    const r = await this.holen(`/api/frag_herbert/foto/${encodeURIComponent(id)}${art === "v" ? "?groesse=vorschau" : ""}`);
    const daten = await r.arrayBuffer(), b = new Uint8Array(daten, 0, 2);
    if (b[0] !== 0xff || b[1] !== 0xd8) return null;
    await speicher.bildMerken(schluessel, daten).catch(() => {});
    return new Blob([daten], { type: "image/jpeg" });
  },

  /** Zwischen „lokal“ und „ha“ wechseln: lädt die Seite neu. */
  wechseln(bestand) {
    try { localStorage.setItem(K.bestand, bestand); } catch (e) { /* gesperrt */ }
    location.reload();
  },

  /** Abmelden: Token widerrufen, zurück zum lokalen Bestand; die Kopie aus HA wird beim nächsten Start gelöscht. */
  async abmelden() {
    const d = hole(K.ha);
    if (d?.tokens) await abruf(`${d.adresse}/auth/revoke`, { method: "POST", body: new URLSearchParams({ token: d.tokens.refresh }) }).catch(() => {});
    merke(K.ha, null);
    try { localStorage.setItem(K.loeschen, "1"); } catch (e) { /* gesperrt */ }
    this.wechseln("lokal");
  },

  /** Beim Start im lokalen Bestand: Kopie aus HA nach dem Abmelden löschen. */
  aufraeumen() {
    try {
      if (BESTAND === "lokal" && localStorage.getItem(K.loeschen)) { indexedDB.deleteDatabase("frag-herbert-ha"); localStorage.removeItem(K.loeschen); }
    } catch (e) { /* später erneut */ }
  },
};
