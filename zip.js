/*
 * Kleines ZIP ohne Fremdbibliothek. Schreiben: unkomprimiert (JPEGs lassen sich nicht weiter verkleinern). Lesen: unkomprimiert
 * und Deflate (z. B. am Mac neu gepackte Dateien). Grenzen gegen kaputte oder bösartige Dateien.
 */
const MAX_EINTRAEGE = 20000, MAX_DATEI = 60e6, MAX_GESAMT = 2e9;
const TABELLE = Uint32Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = TABELLE[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** eintraege: [{ name, blob }] → Blob. */
export async function zipSchreiben(eintraege, fortschritt = () => {}) {
  if (eintraege.length > MAX_EINTRAEGE) throw new Error("Zu viele Dateien für ein Backup");
  const teile = [], verzeichnis = [], d = new Date();
  const zeit = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), tag = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  let ort = 0, n = 0;
  for (const { name, blob } of eintraege) {
    const nb = new TextEncoder().encode(name), crc = crc32(new Uint8Array(await blob.arrayBuffer()));
    const kopf = (zentral) => {
      const v = new DataView(new ArrayBuffer(zentral ? 46 : 30));
      let o = 0;
      const u16 = (x) => { v.setUint16(o, x, true); o += 2; }, u32 = (x) => { v.setUint32(o, x, true); o += 4; };
      u32(zentral ? 0x02014b50 : 0x04034b50);
      if (zentral) u16(20);
      u16(20); u16(0x0800); u16(0); u16(zeit); u16(tag); u32(crc); u32(blob.size); u32(blob.size); u16(nb.length); u16(0);
      if (zentral) { u16(0); u16(0); u16(0); u32(0); u32(ort); }
      return v.buffer;
    };
    teile.push(kopf(false), nb, blob);
    verzeichnis.push(kopf(true), nb);
    ort += 30 + nb.length + blob.size;
    if (ort > 4e9) throw new Error("Das Backup wäre größer als 4 GB");
    fortschritt(++n, eintraege.length);
  }
  const groesse = verzeichnis.reduce((s, x) => s + x.byteLength, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, eintraege.length, true); e.setUint16(10, eintraege.length, true); e.setUint32(12, groesse, true); e.setUint32(16, ort, true);
  return new Blob([...teile, ...verzeichnis, e.buffer], { type: "application/zip" });
}

/** Blob → Map Name → () => Promise<Uint8Array>. Daten werden erst beim Aufruf gelesen und mit der Prüfsumme verglichen. */
export async function zipLesen(blob) {
  const kaputt = () => new Error("Die Datei ist kein lesbares ZIP");
  const ende0 = Math.max(0, blob.size - 65557), schwanz = new DataView(await blob.slice(ende0).arrayBuffer());
  let e = schwanz.byteLength - 22;
  while (e >= 0 && schwanz.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw kaputt();
  const anzahl = schwanz.getUint16(e + 10, true), groesse = schwanz.getUint32(e + 12, true), start = schwanz.getUint32(e + 16, true);
  if (anzahl > MAX_EINTRAEGE || start + groesse > blob.size) throw kaputt();
  const v = new DataView(await blob.slice(start, start + groesse).arrayBuffer()), karte = new Map();
  let o = 0, gesamt = 0;
  for (let i = 0; i < anzahl; i++) {
    if (o + 46 > v.byteLength || v.getUint32(o, true) !== 0x02014b50) throw kaputt();
    const art = v.getUint16(o + 10, true), crc = v.getUint32(o + 16, true), gepackt = v.getUint32(o + 20, true), roh = v.getUint32(o + 24, true);
    const nl = v.getUint16(o + 28, true), xl = v.getUint16(o + 30, true), kl = v.getUint16(o + 32, true), ort = v.getUint32(o + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(v.buffer, v.byteOffset + o + 46, nl));
    o += 46 + nl + xl + kl;
    if (name.endsWith("/") || name.startsWith("__MACOSX/")) continue;
    gesamt += roh;
    if (roh > MAX_DATEI || gepackt > MAX_DATEI || gesamt > MAX_GESAMT) throw new Error("Die Datei enthält zu große Inhalte");
    karte.set(name, async () => {
      const k = new DataView(await blob.slice(ort, ort + 30).arrayBuffer());
      if (k.byteLength < 30 || k.getUint32(0, true) !== 0x04034b50) throw kaputt();
      const von = ort + 30 + k.getUint16(26, true) + k.getUint16(28, true), stueck = blob.slice(von, von + gepackt);
      let daten;
      if (art === 0) daten = new Uint8Array(await stueck.arrayBuffer());
      else if (art === 8) daten = await entpacken(stueck, roh);
      else throw new Error("Unbekannte Kompression im ZIP");
      if (daten.length !== roh || crc32(daten) !== crc) throw new Error(`Beschädigt: ${name}`);
      return daten;
    });
  }
  return karte;
}

async function entpacken(blob, roh) {
  const leser = blob.stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader(), aus = new Uint8Array(roh);
  let n = 0;
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    if (n + value.length > roh) { leser.cancel(); throw new Error("ZIP-Inhalt größer als angegeben"); }
    aus.set(value, n);
    n += value.length;
  }
  return aus.subarray(0, n);
}
