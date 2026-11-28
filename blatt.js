/*
 * Blatt: Das Bedienfeld über der Karte. Breiter Bildschirm = feste Karte links (nur CSS), Handy = ziehbares Blatt mit drei
 * Höhen: klein (Karte frei), halb, voll (Liste). Beim Ziehen folgt das Blatt dem Finger, beim Loslassen rastet es ein.
 */
const ORDNUNG = ["klein", "halb", "voll"];
const BREIT = matchMedia("(min-width: 820px)");

export class Blatt {
  /** @param o { wurzel, griff, rollbereich() → sichtbares Rollelement, kleinHoehe() → px, aufStufe(stufe) } */
  constructor(o) {
    this.o = o;
    this.stufe = "halb";
    this.gesperrt = false;
    const w = o.wurzel;
    w.addEventListener("touchstart", (e) => this.start(e), { passive: true });
    w.addEventListener("touchmove", (e) => this.zug(e), { passive: false });
    w.addEventListener("touchend", () => this.ende());
    w.addEventListener("touchcancel", () => this.ende());
    // Griff: Tipp wechselt die Höhe (auch mit Maus und Tastatur, z. B. schmales Fenster am Mac)
    o.griff.addEventListener("click", () => { if (!this.gesperrt) this.setzen(this.stufe === "voll" ? "halb" : this.stufe === "halb" ? "voll" : "halb"); });
    addEventListener("resize", () => this.anordnen(false));
    BREIT.addEventListener("change", () => { this.anordnen(false); o.aufStufe(this.stufe); });
    // Tastatur (iOS legt sie über die Seite, ohne sie zu verkleinern): Platz unten freihalten, damit Feld und „Speichern“ sichtbar bleiben
    window.visualViewport?.addEventListener("resize", () => this.tastatur());
    window.visualViewport?.addEventListener("scroll", () => this.tastatur());
    document.addEventListener("focusin", () => setTimeout(() => this.tastatur(), 60));
    document.addEventListener("focusout", () => setTimeout(() => this.tastatur(), 60));
    this.anordnen(false);
  }

  /** Höhe der Seite. Nicht innerHeight: das schrumpft auf dem iPhone mit der Tastatur, und das Blatt rutschte darunter. */
  get seite() { return document.body.clientHeight; }

  tastatur() {
    const v = window.visualViewport, w = this.o.wurzel, feld = document.activeElement;
    const tippt = !this.breit && feld?.matches?.("textarea, input[type=text], input[type=search]") && w.contains(feld);
    const verdeckt = v && tippt ? Math.max(0, Math.round(this.seite - v.offsetTop - v.height)) : 0;
    const neu = verdeckt > 80 ? verdeckt : 0;
    if (neu === (this.frei || 0)) return;
    this.frei = neu;
    w.style.paddingBottom = neu ? `${neu}px` : "";
    w.classList.toggle("tastatur", !!neu);
    if (neu) requestAnimationFrame(() => feld.scrollIntoView({ block: "center" }));
  }

  get breit() { return BREIT.matches; }

  hoehe(stufe) {
    const h = this.seite, oben = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--oben-px")) || 0;
    if (stufe === "klein") return Math.min(this.o.kleinHoehe(), h * 0.4);
    if (stufe === "halb") return Math.round(Math.min(h * 0.52, h - 220));
    return h - Math.max(oben, 0) - 10;
  }

  /** Vom Blatt verdeckte Höhe unten (Handy). */
  get verdeckt() { return this.breit ? 0 : this.hoehe(this.stufe === "voll" ? "halb" : this.stufe); }

  anordnen(animiert = true) {
    const w = this.o.wurzel;
    w.classList.toggle("ziehend", !animiert);
    w.dataset.stufe = this.stufe;
    document.body.dataset.stufe = this.stufe;
    if (this.breit) { w.style.transform = ""; w.style.height = ""; return; }
    w.style.height = `${this.hoehe("voll")}px`;
    this.y = this.hoehe("voll") - this.hoehe(this.stufe);
    w.style.transform = `translate3d(0, ${this.y}px, 0)`;
    document.documentElement.style.setProperty("--blatt", `${this.verdeckt}px`);
  }

  setzen(stufe) {
    const neu = stufe !== this.stufe;
    this.stufe = stufe;
    this.anordnen();
    if (neu) this.o.aufStufe(stufe);
  }

  // ------------------------------------------------------------ Ziehen

  start(e) {
    if (this.breit || this.gesperrt || e.touches.length > 1) return;
    // Waagerecht rollende Bereiche und Eingaben für sich lassen (Richtung entscheidet zug())
    if (e.target.closest("input[type=range], textarea, select")) return;
    const t = e.touches[0];
    this.z = { x: t.clientX, y: t.clientY, y0: this.y, modus: null, verlauf: [], imRollbereich: !!this.o.rollbereich()?.contains(e.target) };
  }

  zug(e) {
    const z = this.z;
    if (!z) return;
    const t = e.touches[0], dx = t.clientX - z.x, dy = t.clientY - z.y;
    if (!z.modus) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (Math.abs(dx) > Math.abs(dy)) { z.modus = "seite"; return; }
      const r = this.o.rollbereich();
      // Voll: Inhalt rollt normal; erst am Anfang nach unten gezogen kommt das Blatt mit
      z.modus = this.stufe === "voll" && z.imRollbereich && (dy < 0 || (r && r.scrollTop > 0)) ? "rollen" : "ziehen";
      if (z.modus === "ziehen") { z.y = t.clientY; this.o.wurzel.classList.add("ziehend"); document.activeElement?.blur?.(); }
    }
    if (z.modus !== "ziehen") return;
    e.preventDefault();
    const max = this.hoehe("voll") - this.hoehe("klein") + 20;
    this.y = Math.max(-6, Math.min(max, z.y0 + t.clientY - z.y));
    this.o.wurzel.style.transform = `translate3d(0, ${this.y}px, 0)`;
    z.verlauf.push([e.timeStamp, t.clientY]);
    if (z.verlauf.length > 6) z.verlauf.shift();
  }

  ende() {
    const z = this.z;
    this.z = null;
    if (z?.modus !== "ziehen") return;
    const [a, b] = [z.verlauf[0], z.verlauf[z.verlauf.length - 1]];
    const tempo = a && b && b[0] > a[0] ? (b[1] - a[1]) / (b[0] - a[0]) : 0; // px/ms
    const ziel = this.hoehe("voll") - (this.y + tempo * 180); // sichtbare Höhe mit Schwung
    const stufe = ORDNUNG.reduce((best, s) => (Math.abs(this.hoehe(s) - ziel) < Math.abs(this.hoehe(best) - ziel) ? s : best));
    this.o.wurzel.classList.remove("ziehend");
    this.setzen(stufe);
  }
}
