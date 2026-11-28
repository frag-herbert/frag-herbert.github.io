#!/usr/bin/env python3
"""Durchlauf im echten Browser: test.py <ausgabeordner>. Eigener Server, leere Datenbank je Lauf, keine echten Daten.
WebKit als iPhone und Mac-Fenster; Offline in Chromium (Playwright-WebKit kann keine Service Worker)."""
import json
import os
import struct
import subprocess
import sys
import time
import zipfile

from playwright.sync_api import sync_playwright

HIER = os.path.dirname(os.path.abspath(__file__))
AUS = sys.argv[1]
os.makedirs(AUS, exist_ok=True)
PORT = 8791
URL = f"http://localhost:{PORT}/"
alle = []


def exif_jpeg(roh, lat, lon, zeit):
    """JPEG um ein EXIF-Segment mit Aufnahmezeit und GPS ergänzen."""
    def gms(x):
        x = abs(x); g = int(x); m = int((x - g) * 60); return struct.pack("<6I", g, 1, m, 1, round(((x - g) * 60 - m) * 60 * 10000), 10000)
    e = lambda nr, typ, n, wert: struct.pack("<HHI", nr, typ, n) + wert
    kopf = b"II*\0" + struct.pack("<I", 8)
    o_exif = 8 + 2 + 2 * 12 + 4
    o_zeit = o_exif + 2 + 12 + 4
    o_gps = o_zeit + 20
    o_lat = o_gps + 2 + 4 * 12 + 4
    ifd0 = struct.pack("<H", 2) + e(0x8769, 4, 1, struct.pack("<I", o_exif)) + e(0x8825, 4, 1, struct.pack("<I", o_gps)) + b"\0" * 4
    exif = struct.pack("<H", 1) + e(0x9003, 2, 20, struct.pack("<I", o_zeit)) + b"\0" * 4
    gps = struct.pack("<H", 4) + e(1, 2, 2, (b"S" if lat < 0 else b"N") + b"\0\0\0") + e(2, 5, 3, struct.pack("<I", o_lat)) + e(3, 2, 2, (b"W" if lon < 0 else b"E") + b"\0\0\0") + e(4, 5, 3, struct.pack("<I", o_lat + 24)) + b"\0" * 4
    t = b"Exif\0\0" + kopf + ifd0 + exif + zeit.encode() + b"\0" + gps + gms(lat) + gms(lon)
    return roh[:2] + b"\xff\xe1" + struct.pack(">H", len(t) + 2) + t + roh[2:]


def lauf(p, name, motor, optionen):
    b = getattr(p, motor).launch()
    c = b.new_context(**optionen, accept_downloads=True, locale="de-DE", timezone_id="Europe/Berlin")
    c.grant_permissions(["geolocation"])
    c.set_geolocation({"latitude": 47.6553, "longitude": 11.3610, "accuracy": 12})
    g = c.new_page()
    meldungen = []
    g.on("pageerror", lambda e: meldungen.append("pageerror " + str(e)[:200]))
    g.on("console", lambda m: meldungen.append("console " + m.text[:200]) if m.type == "error" and "Failed to load resource" not in m.text else None)
    js = g.evaluate

    def warte(ausdruck, sek=20):
        """Wie wait_for_function, aber ohne eval in der Seite (die CSP verbietet es)."""
        ende = time.time() + sek
        while time.time() < ende:
            if js(f"() => !!({ausdruck})"):
                return
            g.wait_for_timeout(150)
        raise AssertionError("wartete vergeblich auf " + ausdruck[:120])

    def schritt(titel, fn):
        try:
            info, ok = fn() or "", True
        except Exception as e:  # noqa: BLE001
            info, ok = str(e).split("\n")[0][:220], False
        alle.append(ok)
        print(("OK   " if ok else "FEHL ") + f"[{name}] {titel} {info}", flush=True)
        if not ok:
            g.screenshot(path=f"{AUS}/{name}-FEHLER-{len(alle)}.png")

    def muss(x, text):
        if not x:
            raise AssertionError(text)

    bild = lambda n: g.screenshot(path=f"{AUS}/{name}-{n}.png")
    mobil = optionen.get("is_mobile", False)
    ueberlauf = lambda: js("[...document.querySelectorAll('#blatt, dialog[open]')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.id)")
    offen = lambda pfad: (js(f"location.hash = {json.dumps(pfad)}"), g.wait_for_timeout(500))
    daten = lambda: js("import('./speicher.js?v=10').then(m => m.speicher.alles())")

    def start():
        g.goto(URL)
        g.wait_for_selector(".willkommen")
        muss(not ueberlauf(), ueberlauf())
        muss("Testversion" in g.inner_text(".willkommen"), "Hinweis Testversion fehlt")
        g.wait_for_timeout(2500)
        bild("1-start")
    schritt("Start leer", start)

    def rechnen():
        r = js("""async () => { const m = await import('./plaetze.js?v=10'); const k = (t) => { const x = m.koordinatenLesen(t); return x && [x.lat.toFixed(4), x.lon.toFixed(4)].join(); };
          const n = (a, b, j) => m.kalendernaechte({ ankunft: a, abfahrt: b, naechte: {} }, j && new Date(j)).length;
          return { k: ['47.6553, 11.3610', '47,6553 11,3610', 'https://www.google.com/maps/place/X/@47.1,11.1,15z/data=!3d47.6553!4d11.3610', 'https://www.google.com/maps/search/?api=1&query=47.6553%2C11.3610',
            'https://maps.apple.com/?ll=47.6553,11.3610&q=Hier', 'https://www.openstreetmap.org/?mlat=47.6553&mlon=11.3610#map=15/47.6/11.3', 'geo:47.6553,11.3610', `47°39'19.1"N 11°21'39.6"E`, '33.8568 S, 151.2153 E'].map(k),
            nichts: ['', 'Hallo', '99.5, 11.2', 'https://maps.app.goo.gl/abc', '12, 13'].map(k),
            n: [n('2026-10-01T18:00', '2026-10-03T09:00'), n('2026-10-01T10:00', '2026-10-01T18:00'), n('2026-03-28T12:00', '2026-03-30T12:00'), n('2026-10-24T12:00', '2026-10-26T12:00'), n('2026-10-01T18:00', null, '2026-10-02T08:00'), n('2026-10-01T18:00', null, '2026-10-02T10:00')] }; }""")
        muss(all(x == "47.6553,11.3610" for x in r["k"][:8]), r["k"])
        muss(r["k"][8] == "-33.8568,151.2153", r["k"][8])
        muss(not any(r["nichts"]), r["nichts"])
        muss(r["n"] == [2, 0, 2, 2, 0, 1], r["n"])
    schritt("Koordinaten lesen, Nächte (auch Zeitumstellung)", rechnen)

    def standort():
        g.click("[data-neu]")
        muss(not ueberlauf(), ueberlauf())
        g.wait_for_timeout(600)
        bild("2-anlegen")
        g.click('[data-weg="standort"]')
        g.wait_for_selector("form.formular #speichern, #speichern", state="attached")
        g.wait_for_timeout(1000)  # Blatt klappt auf: vorher treffen Druck und Loslassen verschiedene Elemente
        g.fill('input[name="name"]', "Seeufer <b>Test</b>")
        g.click('label.wahl:has(input[value="Stellplatz"])')
        g.click('.bewertung [data-n="4"]')
        g.fill("textarea", "Ruhig, \"hintere\" Reihe & <i>Ufer</i>")
        muss(not ueberlauf(), ueberlauf())
        bild("3-formular")
        g.click("#speichern")
        g.wait_for_selector("#detail .d-kopf h1")
        g.wait_for_timeout(700)
        muss(g.inner_text("#detail h1") == "Seeufer <b>Test</b>", g.inner_text("#detail h1"))
        d = daten()["plaetze"][0]
        muss(len(d["besuche"]) == 1 and d["gepflegt"] and d["bewertung"] == 4 and d["art"] == "Stellplatz", d)
        muss(g.locator("#detail .etikett.hier").count() == 1, "„Du bist hier“ fehlt")
        bild("4-detail")
    schritt("Platz am Standort anlegen", standort)

    def vormerken():
        offen("#/")
        g.click("#hierknopf")
        g.fill('[name="ort"]', "unsinn")
        g.click('[data-weg="text"]')
        muss("keine Koordinaten" in g.inner_text("#neu .fehlertext"), "Fehlertext")
        g.fill('[name="ort"]', "45.7520, 10.8020")
        g.click('[data-weg="text"]')
        g.wait_for_selector("#speichern")
        g.fill('input[name="name"]', "Limoneto")
        g.click("#speichern")
        g.wait_for_selector("#detail .d-kopf h1")
        muss("vorgemerkt" in g.inner_text(".fakten"), g.inner_text(".fakten"))
        offen("#/")
        muss("Vorgemerkt" in g.inner_text("#liste"), g.inner_text("#liste"))
        for s in ("entfernung", "bewertung", "preis", "naechte", "besuche", "name", "zuletzt"):
            g.select_option("#sortierung", s)
            muss(g.locator("#liste .platz").count() == 2, s)
        if mobil:
            js("document.querySelector('#griff').click()")
            g.wait_for_timeout(500)
        g.click('#schnellfilter [data-gruppe="vorgemerkt"]')
        muss(g.locator("#liste .platz").count() == 1, "Filter vorgemerkt")
        g.click('#schnellfilter [data-gruppe="vorgemerkt"]')
        bild("5-liste")
        if mobil:
            js("document.querySelector('#griff').click()")
            g.wait_for_timeout(500)
    schritt("Vormerken über Koordinaten, Sortierung, Filter", vormerken)

    def abbrechen():
        g.click("#hierknopf")
        g.fill('[name="ort"]', "50.1, 8.6")
        g.click('[data-weg="text"]')
        g.wait_for_selector("#speichern")
        g.click(".fussleiste [data-abbrechen]")
        g.wait_for_timeout(700)
        muss(len(daten()["plaetze"]) == 2 and g.locator("#detail").is_hidden(), "Rest geblieben")
        muss(not js("location.hash.includes('platz')"), js("location.hash"))
    schritt("Anlegen abbrechen lässt nichts zurück", abbrechen)

    def doppelt():
        g.click("#hierknopf")
        g.fill('[name="ort"]', "45.7521, 10.8021")
        g.click('[data-weg="text"]')
        g.wait_for_selector("#frage[open]")
        muss("Limoneto" in g.inner_text("#frage"), g.inner_text("#frage"))
        g.click('#frage [value="ja"]')
        g.wait_for_selector("#detail .d-kopf h1")
        muss(len(daten()["plaetze"]) == 2, "doppelt angelegt")
    schritt("Vorhandenen Platz erkennen", doppelt)

    def besuche():
        if mobil:
            js("document.querySelector('#griff').click()")
            g.wait_for_timeout(400)
        g.click('[data-klappe="besuche"] > summary')
        g.click("[data-besuch-neu]")
        g.fill('#besuch [name="an"]', "2026-10-10")
        g.fill('#besuch [name="ab"]', "2026-10-08")
        g.click("#bs-ok")
        muss("vor der Ankunft" in g.inner_text("#besuch .fehlertext"), "Prüfung")
        muss(not ueberlauf(), ueberlauf())
        bild("6-besuch")
        g.fill('#besuch [name="ab"]', "2026-10-13")
        g.click("#bs-ok")
        g.wait_for_selector("#besuch", state="hidden")
        t = g.inner_text('[data-klappe="besuche"]')
        muss("3 Übernachtungen" in t, t)
        g.click("[data-korrigieren]")
        g.click('[data-nacht="2026-10-11"]')
        g.wait_for_timeout(500)
        t = g.inner_text('[data-klappe="besuche"]')
        muss("2 Übernachtungen" in t and "1× über Nacht geparkt" in t, t)
        bild("7-besuche")
        g.click("[data-besuch-bearbeiten]")
        g.click("#bs-weg")
        g.click('#frage [value="ja"]')
        g.wait_for_selector("#besuch", state="hidden")
        muss("vorgemerkt" in g.inner_text('[data-klappe="besuche"]'), "nach Löschen")
        g.click("[data-besuch-neu]")
        g.fill('#besuch [name="an"]', "2026-10-10")
        g.fill('#besuch [name="ab"]', "2026-10-13")
        g.click("#bs-ok")
        g.wait_for_selector("#besuch", state="hidden")
    schritt("Besuche eintragen, Nacht umschalten, löschen", besuche)

    def fotos():
        pfad = f"{AUS}/probe.png"
        if not os.path.exists(pfad):
            open(pfad, "wb").write(bytes(js("""async () => { const c = document.createElement('canvas'); c.width = 2400; c.height = 1500; const x = c.getContext('2d');
              const v = x.createLinearGradient(0,0,2400,1500); v.addColorStop(0,'#6fb3da'); v.addColorStop(1,'#0f6b5c'); x.fillStyle = v; x.fillRect(0,0,2400,1500);
              const b = await new Promise(o => c.toBlob(o,'image/png')); return [...new Uint8Array(await b.arrayBuffer())]; }""")))
        kaputt = f"{AUS}/kaputt.jpg"
        open(kaputt, "wb").write(b"kein bild")
        g.set_input_files("#detail #upload", [pfad, pfad, kaputt])
        warte("document.querySelectorAll('#detail .foto img').length === 2 && [...document.querySelectorAll('#detail .foto img')][0].naturalWidth > 0")
        muss("kein lesbares Bild" in g.inner_text("#meldung"), g.inner_text("#meldung"))
        f = daten()["fotos"]
        muss(len(f) == 2 and f[0]["breite"] == 1600, f)
        g.wait_for_timeout(600)
        bild("8-fotos")
        g.click("#detail .foto >> nth=1")
        g.wait_for_selector("#gross[open] img")
        g.click('#gross [data-a="titel"]')
        g.wait_for_timeout(500)
        muss(next(x for x in daten()["plaetze"] if x["name"] == "Limoneto")["titelfoto"], "Titelbild")
        g.click("#detail .foto >> nth=0")
        g.click('#gross [data-a="loeschen"]')
        g.click('#frage [value="ja"]')
        g.wait_for_timeout(700)
        muss(len(daten()["fotos"]) == 1, "Foto nicht gelöscht")
    schritt("Fotos: speichern, kaputte Datei, Titelbild, löschen", fotos)

    zipdatei = f"{AUS}/{name}.zip"

    def abholen(ziel):
        """Fertigen Export sichern: iPhone über das (ersetzte) Teilen-Menü, sonst Download."""
        g.wait_for_selector("#b-sichern")
        if "Herunterladen" not in g.inner_text("#b-sichern"):
            js("() => { window.__t = null; navigator.share = async (x) => { window.__t = [...new Uint8Array(await x.files[0].arrayBuffer())]; }; }")
            g.click("#b-sichern")
            warte("window.__t")
            open(ziel, "wb").write(bytes(js("window.__t")))
        else:
            with g.expect_download() as d:
                g.click("#b-sichern")
            d.value.save_as(ziel)
        g.wait_for_selector("#backup", state="hidden")

    def exportOeffnen():
        offen("#/")
        js("document.querySelectorAll('dialog[open]').forEach(d => d.close())")
        js("document.querySelector('[data-menue]').click()")
        g.wait_for_selector("#menue[open]")
        g.click("#m-backup")
        g.wait_for_selector("#b-erstellen")

    def backup():
        offen("#/")
        js("document.querySelector('[data-menue]').click()")
        g.wait_for_selector("#menue[open]")
        muss(not ueberlauf(), ueberlauf())
        g.wait_for_timeout(600)
        bild("9-einstellungen")
        g.click("#m-backup")
        g.wait_for_selector("#b-erstellen")
        muss("Alle Plätze" in g.inner_text("#backup") and g.locator("#e-fotos:checked").count() == 1, g.inner_text("#backup"))
        g.click("#b-erstellen")
        abholen(zipdatei)
        z = zipfile.ZipFile(zipdatei)
        muss(z.testzip() is None, "ZIP beschädigt")
        n = z.namelist()
        muss("daten.json" in n and len([x for x in n if x.startswith("fotos/")]) == 1, n)
        g.wait_for_timeout(500)
        muss(js("import('./speicher.js?v=10').then(m => m.speicher.meta('aenderungen'))") == 0, "Zähler")
        return f"{os.path.getsize(zipdatei) // 1024} KB"
    schritt("Backup erstellen (mit Python gegengeprüft)", backup)

    def einspielen(pfad, knopf):
        js("document.querySelectorAll('dialog[open]').forEach(d => d.close())")
        js("document.querySelector('[data-menue]').click()")
        g.wait_for_selector("#menue[open]")
        g.click("#m-import")
        with g.expect_file_chooser() as fc:
            g.click("label:has(#i-datei)")
        fc.value.set_files(pfad)
        g.wait_for_selector("#import[open] #i-ok, #import[open] #i-zurueck")
        if not knopf:
            return g.inner_text("#import")
        if knopf == "dazu" and g.locator("#i-ok[disabled]").count():
            t = g.inner_text("#import")
            js("document.querySelectorAll('dialog[open]').forEach(d => d.close())")
            return t
        if knopf == "ersetzen" and g.locator("#i-ersetzen").count():
            g.click("#i-ersetzen")
            g.click('#frage [value="ja"]')
        else:
            g.click("#i-ok")
        warte("document.querySelector('#i-rueck') || !document.querySelector('#import').open", 30)
        if not g.locator("#i-rueck").count():
            g.wait_for_timeout(500)
            return g.inner_text("#meldung")
        t = g.inner_text("#import")
        js("document.querySelectorAll('dialog[open]').forEach(d => d.close())")
        g.wait_for_timeout(300)
        return t

    def zusammen():
        # Nach dem Backup ändern: die jüngere Änderung muss bleiben, der gelöschte Besuch auch
        js("""async () => { const m = await import('./daten.js?v=10'), s = await import('./speicher.js?v=10'); const p = (await s.speicher.alles()).plaetze.find(x => x.name === 'Limoneto'); await m.quelle.feld(p.id, { name: 'Limoneto neu' }); }""")
        einspielen(zipdatei, "dazu")
        d = daten()
        muss(len(d["plaetze"]) == 2 and len(d["fotos"]) == 1, (len(d["plaetze"]), len(d["fotos"])))
        muss(any(x["name"] == "Limoneto neu" for x in d["plaetze"]), [x["name"] for x in d["plaetze"]])
    schritt("Zusammenführen: jüngere Änderung bleibt", zusammen)

    def ersetzen():
        einspielen(zipdatei, "ersetzen")
        d = daten()
        muss(sorted(x["name"] for x in d["plaetze"]) == ["Limoneto", "Seeufer <b>Test</b>"], [x["name"] for x in d["plaetze"]])
        offen(f"#/platz/{next(x['id'] for x in d['plaetze'] if x['name'] == 'Limoneto')}")
        warte("[...document.querySelectorAll('#detail .foto img')].some(i => i.naturalWidth > 0)")
    schritt("Ersetzen: Stand des Backups samt Foto", ersetzen)

    def vermerke():
        d0 = daten()
        lim = next(x for x in d0["plaetze"] if x["name"] == "Limoneto")
        see = next(x for x in d0["plaetze"] if x["name"].startswith("Seeufer"))
        fid = next(f["id"] for f in d0["fotos"] if f["platz"] == lim["id"])
        hat = lambda d, pid=None, f=None: (any(x["id"] == pid for x in d["plaetze"]) if pid else any(x["id"] == f for x in d["fotos"]))
        # Foto löschen wie in der Galerie, Platz endgültig entfernen wie nach 30 Tagen Papierkorb
        js(f"""async () => {{ const m = await import('./daten.js?v=10'), s = await import('./speicher.js?v=10');
          await m.quelle.fotoEntfernen('{fid}');
          await s.speicher.platzAendern('{see["id"]}', (p) => {{ p.geloescht = new Date(Date.now() - 40 * 864e5).toISOString(); }});
          await m.quelle.daten(); }}""")
        v = js("import('./speicher.js?v=10').then(m => m.speicher.vermerke())")
        muss(see["id"] in v["plaetze"] and fid in v["fotos"], v)
        # Altes Backup zusammenführen: beides kommt nicht zurück
        t = einspielen(zipdatei, "dazu")
        d = daten()
        muss(not hat(d, see["id"]) and not hat(d, f=fid), (len(d["plaetze"]), len(d["fotos"])))
        muss("endgültig entfernt" in t and "nicht zurückholen" in t, t)  # nur Gelöschtes im alten Backup: nichts zu übernehmen
        # Neues Backup trägt die Vermerke
        roh = js("async () => { const b = await import('./backup.js?v=10'); const r = await b.backupErstellen('test'); return [...new Uint8Array(await r.dateien[0].arrayBuffer())]; }")
        neu = f"{AUS}/{name}-vermerke.zip"
        open(neu, "wb").write(bytes(roh))
        dj = json.loads(zipfile.ZipFile(neu).read("daten.json"))
        muss(dj.get("umfang") == "alle" and dj.get("mit_fotos") is True, {k: dj.get(k) for k in ("umfang", "mit_fotos")})
        muss(any(e["id"] == see["id"] for e in dj["entfernt"]) and any(f["id"] == fid and f.get("geloescht") for f in dj["fotos"]), dj.get("entfernt"))
        # Anderes Gerät mit altem Stand, dort Seeufer nachträglich geändert: der Platz bleibt, das Foto geht
        einspielen(zipdatei, "ersetzen")
        muss(hat(daten(), see["id"]) and hat(daten(), f=fid), "Altstand nicht hergestellt")
        js(f"import('./daten.js?v=10').then(m => m.quelle.feld('{see['id']}', {{ name: 'Seeufer geändert' }}))")
        t = einspielen(neu, "dazu")
        d = daten()
        muss(hat(d, see["id"]) and not hat(d, f=fid), (hat(d, see["id"]), hat(d, f=fid)))
        muss("behalten" in t, t)
        # Ohne Änderung: der Platz geht mit
        einspielen(zipdatei, "ersetzen")
        t = einspielen(neu, "dazu")
        muss(not hat(daten(), see["id"]) and "entfernt" in t, t)
        einspielen(zipdatei, "ersetzen")  # Ausgangsstand für die folgenden Schritte
        muss(hat(daten(), see["id"]) and hat(daten(), f=fid), "Ausgangsstand fehlt")
    schritt("Vermerke: Gelöschtes kommt aus alten Backups nicht zurück", vermerke)

    def vorschau():
        lim0 = next(x for x in daten()["plaetze"] if x["name"] == "Limoneto")
        js(f"import('./daten.js?v=10').then(m => m.quelle.feld('{lim0['id']}', {{ notiz: 'Notiz hier' }}))")
        d0 = daten()
        lim = next(x for x in d0["plaetze"] if x["name"] == "Limoneto")
        see = next(x for x in d0["plaetze"] if x["name"].startswith("Seeufer"))
        roh = zipfile.ZipFile(zipdatei)
        dj = json.loads(roh.read("daten.json"))
        L = next(p for p in dj["plaetze"] if p["id"] == lim["id"])
        L["preis"], L["zeiten"]["preis"] = 17, "2099-01-01T00:00:00.000Z"   # jünger: wird übernommen
        L["notiz"], L["zeiten"]["notiz"] = "Notiz aus der Datei", lim["zeiten"]["notiz"]  # gleiche Zeit, beide belegt: Frage
        besuch = next((b for b in L["besuche"] if not b.get("weg")), None)
        if besuch:  # gleicher Zeitraum, neue ID: Frage
            L["besuche"].append({**besuch, "id": "vorschau-besuch", "t": "2099-01-01T00:00:00.000Z"})
        dj["plaetze"] += [{"id": "vorschau-nah", "lat": see["lat"] + 0.0003, "lon": see["lon"], "name": "Anderer Name", "preis": 9},
                          {"id": "vorschau-neu", "lat": 10.0, "lon": 10.0, "name": "Ganz neu"}]
        pfad = f"{AUS}/{name}-vorschau.zip"
        with zipfile.ZipFile(pfad, "w") as z:
            z.writestr("daten.json", json.dumps(dj))
            for n in roh.namelist():
                if n != "daten.json":
                    z.writestr(n, roh.read(n))
        t = einspielen(pfad, None)
        muss("1 neuer Platz" in t and "2 Fragen" in t and "1 unverändert" in t, t)
        muss((not besuch) or "überschneidet sich" in t, "Besuchsfrage fehlt")
        bild("10-vorschau")
        g.click('#import .i-frage:has-text("Anderer Name") input[value="derselbe"]')
        warte("document.querySelector('#import').innerText.includes('Name: hier')")
        g.click('#import .i-frage:has-text("Limoneto") input[value="dort"]')
        g.click('#import .i-liste label:has-text("Ganz neu") input')
        muss("2 Plätze übernehmen" in g.inner_text("#i-ok"), g.inner_text("#i-ok"))
        g.click("#i-ok")
        g.wait_for_selector("#i-rueck", timeout=15000)
        d = daten()
        L2, S2 = next(x for x in d["plaetze"] if x["id"] == lim["id"]), next(x for x in d["plaetze"] if x["id"] == see["id"])
        muss(L2["preis"] == 17 and L2["notiz"] == "Notiz aus der Datei", (L2["preis"], L2["notiz"]))
        muss(len(d["plaetze"]) == len(d0["plaetze"]) and S2["name"] == see["name"] and S2["preis"] in (see["preis"], 9), (len(d["plaetze"]), S2["name"], S2["preis"]))
        muss(see["preis"] is not None or S2["preis"] == 9, "leeres Feld nicht gefüllt")
        muss((not besuch) or len(L2["besuche"]) == len(lim["besuche"]) + 1, "beide Besuche behalten")
        g.click("#i-rueck")
        g.wait_for_selector("#import", state="hidden")
        g.wait_for_timeout(300)
        norm = lambda x: sorted(json.dumps(p, sort_keys=True) for p in x["plaetze"])
        muss(norm(daten()) == norm(d0), "Rückgängig unvollständig")
    schritt("Vorschau: Fragen, Abwählen, Übernehmen, Rückgängig", vorschau)

    def export():
        d0 = daten()
        lim = next(x for x in d0["plaetze"] if x["name"] == "Limoneto")
        zaehler = lambda: js("import('./speicher.js?v=10').then(m => m.speicher.meta('aenderungen'))")
        vorher = zaehler()
        # Einzeln gewählt, ohne Fotos: nur dieser Platz, keine Vermerke „entfernt“, zählt nicht als Backup
        exportOeffnen()
        g.click('#backup input[name="umfang"][value="einzeln"]')
        g.click("#e-alle")
        muss("Nichts ausgewählt" in g.inner_text("#b-erstellen"), g.inner_text("#b-erstellen"))
        g.click(f'#backup [data-e="{lim["id"]}"]')
        g.click("#e-fotos")
        g.wait_for_timeout(300)
        bild("14-export")
        muss("1 Platz exportieren" in g.inner_text("#b-erstellen") and "Beim Einlesen anderswo" in g.inner_text("#backup"), g.inner_text("#backup"))
        g.click("#b-erstellen")
        pfad = f"{AUS}/{name}-auswahl.zip"
        abholen(pfad)
        z = zipfile.ZipFile(pfad)
        dj = json.loads(z.read("daten.json"))
        muss(dj["umfang"] == "auswahl" and dj["mit_fotos"] is False and [p["id"] for p in dj["plaetze"]] == [lim["id"]] and dj["entfernt"] == []
             and not any(n.startswith("fotos/") for n in z.namelist()), {k: dj[k] for k in ("umfang", "mit_fotos", "entfernt")})
        muss(zaehler() == vorher, "Auswahl als Backup gezählt")
        # KML: Name, Ort, Notiz; gültiges XML
        exportOeffnen()
        g.click('#backup input[name="format"][value="kml"]')
        muss(g.locator("#e-notiz").count() == 1 and g.locator("#e-fotos").count() == 0, "KML-Schalter")
        g.click("#b-erstellen")
        pfad = f"{AUS}/{name}.kml"
        abholen(pfad)
        import xml.etree.ElementTree as ET
        k = ET.parse(pfad).getroot()
        orte = k.findall(".//{http://www.opengis.net/kml/2.2}Placemark")
        muss(len(orte) == len(d0["plaetze"]) and any(o.findtext("{http://www.opengis.net/kml/2.2}name") == "Limoneto" for o in orte), len(orte))
        muss(any("<b>" in (o.findtext("{http://www.opengis.net/kml/2.2}name") or "") for o in orte), "Sonderzeichen im Namen verloren")
        # Teile: zweites Foto, Grenze 1 Byte → je Foto ein Teil, jeder Teil mit allen Plätzen
        fid = js(f"""async () => {{ const c = document.createElement('canvas'); c.width = 400; c.height = 300; c.getContext('2d').fillRect(0, 0, 400, 300);
          const b = await new Promise(o => c.toBlob(o, 'image/jpeg')); const m = await import('./daten.js?v=10');
          return m.quelle.fotoAnlegen('{lim["id"]}', new File([b], 'zwei.jpg', {{ type: 'image/jpeg' }})); }}""")
        teile = js("""async () => { const b = await import('./backup.js?v=10'); const r = await b.backupErstellen('test', { teilMax: 1 });
          return Promise.all(r.dateien.map(async d => [d.name, [...new Uint8Array(await d.arrayBuffer())]])); }""")
        muss(len(teile) == len(daten()["fotos"]) >= 2, len(teile))
        for i, (n, roh) in enumerate(teile):
            open(f"{AUS}/{n}", "wb").write(bytes(roh))
            zt = zipfile.ZipFile(f"{AUS}/{n}")
            dt = json.loads(zt.read("daten.json"))
            muss(f"teil-{i + 1}-von-{len(teile)}" in n and dt["teil"] == i + 1 and len(dt["plaetze"]) == len(d0["plaetze"])
                 and len([x for x in zt.namelist() if x.startswith("fotos/")]) == 1, (n, dt.get("teil")))
        js(f"import('./daten.js?v=10').then(m => m.quelle.fotoEntfernen('{fid}', {{ vermerken: false }}))")
        muss(len(daten()["fotos"]) == len(d0["fotos"]), "Zusatzfoto nicht entfernt")
        return f"{len(teile)} Teile"
    schritt("Export: Auswahl ohne Fotos, KML, Teile", export)

    def boese():
        roh = zipfile.ZipFile(zipdatei)
        d = json.loads(roh.read("daten.json"))
        fid = d["fotos"][0]["id"]
        def schreiben(n, dat, foto=None, deflate=False, unterordner=""):
            with zipfile.ZipFile(f"{AUS}/{n}", "w", zipfile.ZIP_DEFLATED if deflate else zipfile.ZIP_STORED) as z:
                z.writestr(unterordner + "daten.json", json.dumps(dat) if not isinstance(dat, str) else dat)
                z.writestr(f"{unterordner}fotos/{fid}.jpg", foto or roh.read(f"fotos/{fid}.jpg"))
                z.writestr(f"{unterordner}vorschau/{fid}.jpg", roh.read(f"vorschau/{fid}.jpg"))
            return f"{AUS}/{n}"
        vorher = daten()
        def abgelehnt(inhalt, erwartet):
            open(f"{AUS}/unsinn.zip", "wb").write(inhalt)
            js("document.querySelectorAll('dialog[open]').forEach(d => d.close())")
            js("document.querySelector('[data-menue]').click()")
            g.click("#m-import")
            with g.expect_file_chooser() as fc:
                g.click("label:has(#i-datei)")
            fc.value.set_files(f"{AUS}/unsinn.zip")
            g.wait_for_selector("#i-zurueck")
            muss(erwartet in g.inner_text("#import"), g.inner_text("#import"))
        abgelehnt(os.urandom(5000), "")
        abgelehnt(open(zipdatei, "rb").read()[:-200], "kein lesbares ZIP")
        muss(daten() == vorher, "Unsinn hat etwas geändert")
        einspielen(schreiben("fremd.zip", {"format": "anders"}), None)
        muss("kein Backup" in g.inner_text("#import"), g.inner_text("#import"))
        # Foto, das kein JPEG ist: nichts darf sich ändern
        pfad = schreiben("svg.zip", d, b"<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>")
        js("document.querySelectorAll('dialog[open]').forEach(d => d.close())")
        js("document.querySelector('[data-menue]').click()")
        g.click("#m-import")
        with g.expect_file_chooser() as fc:
            g.click("label:has(#i-datei)")
        fc.value.set_files(pfad)
        g.click("#i-ersetzen")
        g.click('#frage [value="ja"]')
        warte("document.querySelector('#import').innerText.includes('Nichts geändert')")
        muss(daten() == vorher, "trotz Fehler geändert")
        # Fremde Felder und falsche Typen: werden verworfen, am Mac neu gepackt (Deflate, Unterordner) geht
        x = json.loads(json.dumps(d))
        x["plaetze"][0].update(art="<img src=x onerror=alert(1)>", bewertung=99, boese="x", aktivitaeten="alles")
        x["plaetze"].append({"id": "\"><script>", "lat": 1, "lon": 2})
        x["plaetze"].append({"lat": 1, "lon": 2})
        x["plaetze"].append({"id": "ok-1", "lat": "47", "lon": 2})
        einspielen(schreiben("gemischt.zip", x, deflate=True, unterordner="Backup/"), "ersetzen")
        n = daten()["plaetze"]
        muss(len(n) == 2 and all(p["art"] in ("", "Stellplatz") and p["bewertung"] <= 5 and "boese" not in p for p in n), n)
        offen("#/")
        einspielen(zipdatei, "ersetzen")
    schritt("Kaputte und bösartige Backups", boese)

    def importe():
        def lege(n, inhalt):
            open(f"{AUS}/{n}", "wb").write(inhalt if isinstance(inhalt, bytes) else inhalt.encode())
            return f"{AUS}/{n}"
        def lies(pfad):
            js("document.querySelectorAll('dialog[open]').forEach(d => d.close())")
            js("document.querySelector('[data-menue]').click()")
            g.click("#m-import")
            with g.expect_file_chooser() as fc:
                g.click("label:has(#i-datei)")
            fc.value.set_files(pfad)
            for _ in range(60):
                t = g.inner_text("#import")
                if "wird gelesen" not in t and "Datei wählen" not in t:
                    break
                g.wait_for_timeout(100)
            return g.inner_text("#import")
        gpx = """<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><wpt lat="43.5" lon="3.9"><time>2025-06-01T10:00:00Z</time><name>Strand &amp; Meer</name><desc><![CDATA[<b>Schön</b><br>ruhig<script>alert(1)</script>]]></desc><type>Campground</type></wpt>
          <wpt lat="43.5" lon="3.9"><name>Strand &amp; Meer</name></wpt><wpt lat="45.7521" lon="10.8021"><name>Fast Limoneto</name></wpt><wpt lat="0" lon="0"><name>Nirgends</name></wpt><trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk></gpx>"""
        t = lies(lege("a.gpx", gpx))
        muss("1 neuer Platz" in t and "1 Frage" in t and "1 Eintrag war doppelt" in t and "1 Eintrag hat keine Koordinaten" in t, t)
        muss("von „Limoneto“" in t and g.locator('#import .i-frage:has-text("Fast Limoneto") input[value="ueberspringen"]:checked').count() == 1 and "1 Platz übernehmen" in g.inner_text("#i-ok"), t)
        muss(not ueberlauf(), ueberlauf())
        g.wait_for_timeout(400)
        bild("13-import")
        vorher = daten()
        g.click("#i-ok")
        g.wait_for_selector("#i-rueck")
        x = next(p for p in daten()["plaetze"] if p["name"] == "Strand & Meer")
        muss(x["art"] == "Campingplatz" and x["notiz"] == "Schön\nruhig" and x["besuche"] == [], x)
        g.click("#i-rueck")
        g.wait_for_selector("#import", state="hidden")
        muss(daten() == vorher, "Rückgängig unvollständig")
        # Ort-Treffer als „derselbe Platz“: füllt nur leere Felder, Name bleibt; Rückgängig stellt den Platz wieder her
        lies(f"{AUS}/a.gpx")
        g.click('#import .i-frage:has-text("Fast Limoneto") input[value="derselbe"]')
        muss("Name: hier „Limoneto“" in g.inner_text("#import") and "2 Plätze übernehmen" in g.inner_text("#i-ok"), g.inner_text("#import"))
        g.click("#i-ok")
        g.wait_for_selector("#i-rueck")
        d = daten()
        muss(len(d["plaetze"]) == len(vorher["plaetze"]) + 1 and any(p["name"] == "Limoneto" for p in d["plaetze"]) and not any(p["name"] == "Fast Limoneto" for p in d["plaetze"]), [p["name"] for p in d["plaetze"]])
        g.click("#i-rueck")
        g.wait_for_selector("#import", state="hidden")
        muss(daten() == vorher, "Rückgängig nach Zusammenführen unvollständig")
        lies(f"{AUS}/a.gpx")
        g.click("#i-besuche")
        g.click("#i-ok")
        g.wait_for_selector("#i-rueck")
        x = next(p for p in daten()["plaetze"] if p["name"] == "Strand & Meer")
        muss(x["besuche"][0]["ankunft"] == "2025-06-01T12:00", x["besuche"])
        g.click("#i-rueck")
        g.wait_for_selector("#import", state="hidden")

        kml = """<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>Wild</name><Placemark><name>Pass</name><description>oben</description><Point><coordinates>8.407,46.574,2200</coordinates></Point></Placemark></Folder><Placemark><name>Linie</name><LineString><coordinates>1,2 3,4</coordinates></LineString></Placemark></Document></kml>"""
        t = lies(lege("b.kml", kml))
        muss("1 neuer Platz" in t and "Natur" in t and "46.5740, 8.4070" in t, t)
        with zipfile.ZipFile(f"{AUS}/b.kmz", "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("doc.kml", kml)
        muss("Aus KMZ" in lies(f"{AUS}/b.kmz"), "KMZ")
        # KMZ mit eingebetteten Bildern (KML im Unterordner, Pfade mit ../), dazu ein Link ins Netz und ein fehlendes Bild
        jpg = bytes(js("""async () => { const c = document.createElement('canvas'); c.width = 320; c.height = 240; c.getContext('2d').fillRect(0, 0, 320, 240);
          return [...new Uint8Array(await (await new Promise(o => c.toBlob(o, 'image/jpeg'))).arrayBuffer())]; }"""))
        kml_bild = """<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Mit Bild</name>
          <description><![CDATA[<img src="../files/a.jpg" height="200"/><br><br>Text <img src="../files/fehlt.jpg">]]></description>
          <ExtendedData><Data name="gx_media_links"><value><![CDATA[../files/b.jpg https://example.org/x.jpg]]></value></Data></ExtendedData>
          <Point><coordinates>7.0,46.0,0</coordinates></Point></Placemark></Document></kml>"""
        with zipfile.ZipFile(f"{AUS}/bild.kmz", "w") as z:
            z.writestr("kml/doc.kml", kml_bild)
            z.writestr("files/a.jpg", jpg)
            z.writestr("files/b.jpg", jpg)
        vorher_bild = daten()
        t = lies(f"{AUS}/bild.kmz")
        muss("+2 Fotos" in t and "1 Fotolink ins Netz wird nicht geladen" in t and "1 Bild fehlt" in t, t)
        g.click("#i-ok")
        g.wait_for_selector("#i-rueck", timeout=20000)
        muss("2 Fotos" in g.inner_text("#import"), g.inner_text("#import"))
        d = daten()
        x = next(p for p in d["plaetze"] if p["name"] == "Mit Bild")
        fb = [f for f in d["fotos"] if f["platz"] == x["id"]]
        muss(len(fb) == 2 and all(f["aufnahme"] is None for f in fb) and x["notiz"] == "Text", (len(fb), [f["aufnahme"] for f in fb], x["notiz"]))
        g.click("#i-rueck")
        g.wait_for_selector("#import", state="hidden")
        muss(daten() == vorher_bild, "Rückgängig ließ Fotos zurück")
        google = {"type": "FeatureCollection", "features": [
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": [7.357, 48.214]}, "properties": {"date": "2024-05-01T00:00:00Z", "google_maps_url": "http://maps.google.com/?cid=1", "location": {"name": "Aire des Vignes", "address": "Rue 1", "country_code": "FR"}}},
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]}, "properties": {"google_maps_url": "http://maps.google.com/?q=48.5,7.5", "Comment": "Pin"}},
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]}, "properties": {"google_maps_url": "http://maps.google.com/?cid=2", "location": {"name": "Ohne"}}}]}
        t = lies(lege("Saved Places.json", json.dumps(google)))
        muss("Aus Google Maps" in t and "2 neue Plätze" in t and "keine Koordinaten" in t and g.locator("#i-besuche").count() == 0, t)
        g.select_option("#i-art", "Stellplatz")
        g.click("#i-ok")
        g.wait_for_selector("#i-rueck")
        x = next(p for p in daten()["plaetze"] if p["name"] == "Aire des Vignes")
        muss(x["land"] == "FR" and x["art"] == "Stellplatz" and "Rue 1" in x["notiz"], x)
        g.click("#i-rueck")
        g.wait_for_selector("#import", state="hidden")
        # Excel: Semikolon, Komma, Windows-1252, Zeilenumbruch im Feld
        c = 'Name;Breite;Länge;Preis;Strom;Notiz;Ankunft;Abfahrt\r\n"Grün; schön";47,1;9,5;12,50 €;ja;"Zeile 1\nZeile 2";01.07.2025;03.07.2025\r\nOhne;;;;;;;\r\n'
        t = lies(lege("c.csv", c.encode("windows-1252")))
        muss("Grün; schön" in t and "1 neuer Platz" in t and "01.07.2025" in t, t)
        g.click("#i-besuche")
        g.click("#i-ok")
        g.wait_for_selector("#i-rueck")
        x = next(p for p in daten()["plaetze"] if p["name"] == "Grün; schön")
        muss(x["preis"] == 13 and x["strom"] and x["notiz"] == "Zeile 1\nZeile 2" and x["besuche"][0]["abfahrt"] == "2025-07-03T12:00", x)
        g.click("#i-rueck")
        g.wait_for_selector("#import", state="hidden")
        t = lies(lege("garmin.csv", '11.5,48.1,"Halle","nach 22 Uhr"\n11.6,48.2,"Zwei",""\n'))
        muss("48.1000, 11.5000" in t, t)
        g.click("#i-tausch")
        muss("11.5000, 48.1000" in g.inner_text("#import"), "tauschen")
        muss("Koordinaten" in lies(lege("liste.csv", "Titel,Notiz,URL\nA,,https://maps.google.com/?cid=5\n")), "Takeout-Liste")
        for n, inhalt, erwartet in (("x1.xml", "<html></html>", "kenne ich nicht"), ("x2.gpx", "<gpx><wpt", "beschädigt"), ("x3.json", "{kaputt", "beschädigt"), ("x4.json", '{"a":1}', "keine Orte"),
                                    ("x5.gpx", '<!DOCTYPE g [<!ENTITY a "b">]><gpx><wpt lat="1" lon="1"><name>&a;</name></wpt></gpx>', "nicht erlaubte"), ("x6.gpx", "<gpx><trk/></gpx>", "keine Wegpunkte"), ("x7.txt", "nur text", "Keine Spalten"), ("x8.bin", b"", "leer")):
            t = lies(lege(n, inhalt))
            muss(erwartet in t, f"{n}: {t}")
        # Backup über denselben Weg
        lies(zipdatei)
        g.wait_for_selector("#import[open] #i-ok")
        js("document.querySelectorAll('dialog[open]').forEach(d => d.close())")
        muss(daten() == vorher, "Daten verändert")
    schritt("Import: GPX, KML, KMZ, Google, CSV, Fehlerfälle, rückgängig", importe)

    def fotoimport():
        roh = bytes(js("""async () => { const c = document.createElement('canvas'); c.width = 900; c.height = 600; const x = c.getContext('2d'); x.fillStyle = '#c84'; x.fillRect(0, 0, 900, 600); return [...new Uint8Array(await (await new Promise(o => c.toBlob(o, 'image/jpeg'))).arrayBuffer())]; }"""))
        dateien = []
        for i, (lat, lon, zeit) in enumerate(((-33.8568, -70.5, "2025:02:03 10:00:00"), (-33.8569, -70.5001, "2025:02:03 18:00:00"), (-33.8568, -70.5, "2025:02:05 09:00:00"), (45.752, 10.802, "2025:08:01 12:00:00"))):
            open(f"{AUS}/f{i}.jpg", "wb").write(exif_jpeg(roh, lat, lon, zeit))
            dateien.append(f"{AUS}/f{i}.jpg")
        open(f"{AUS}/ohne.jpg", "wb").write(roh)
        vorher = daten()
        js("document.querySelector('[data-menue]').click()")
        g.click("#m-import")
        with g.expect_file_chooser() as fc:
            g.click("label:has(#i-fotos)")
        fc.value.set_files(dateien + [f"{AUS}/ohne.jpg"])
        g.wait_for_selector("#import #i-ok")
        t = g.inner_text("#import")
        muss("1 Foto enthält keinen Ort" in t and "zu „Limoneto“" in t and "3 Fotos" in t and "-33.8568, -70.5000" in t, t)
        g.wait_for_timeout(400)
        bild("14-fotoimport")
        g.click("#i-ok")
        g.wait_for_selector("#i-rueck", timeout=20000)
        d = daten()
        muss(len(d["fotos"]) == len(vorher["fotos"]) + 4 and len(d["plaetze"]) == len(vorher["plaetze"]) + 1, (len(d["fotos"]), len(d["plaetze"])))
        x = next(p for p in d["plaetze"] if p["lat"] < 0)
        muss(sorted(b["ankunft"] for b in x["besuche"]) == ["2025-02-03T12:00", "2025-02-05T12:00"], x["besuche"])
        muss(sorted(f["aufnahme"] for f in d["fotos"] if f["platz"] == x["id"])[1] == "2025-02-03T18:00:00", d["fotos"])
        # Gespeicherte Fotos tragen kein EXIF (GPS) mehr
        muss(not js("""async () => { const s = await import('./speicher.js?v=10'); for (const f of (await s.speicher.alles()).fotos) { const b = new Uint8Array(await (await s.speicher.bild(f.id + '|g')).arrayBuffer()); for (let i = 0; i < Math.min(b.length, 4000); i++) if (b[i] === 0x45 && b[i+1] === 0x78 && b[i+2] === 0x69 && b[i+3] === 0x66 && f.breite === 900 && b[i+6] === 0x49 ) return true; } return false; }"""), "GPS noch im Foto")
        g.click("#i-rueck")
        g.wait_for_selector("#import", state="hidden")
        n = daten()
        muss(len(n["fotos"]) == len(vorher["fotos"]) and len(n["plaetze"]) == len(vorher["plaetze"]), "Rückgängig")
        offen("#/")
    schritt("Import: Fotos mit GPS, neuer und vorhandener Platz, rückgängig", fotoimport)

    def papierkorb():
        d = daten()["plaetze"]
        offen(f"#/platz/{next(x['id'] for x in d if x['name'] == 'Limoneto')}/bearbeiten")
        g.click("#loeschen")
        g.click('#frage [value="ja"]')
        g.wait_for_timeout(700)
        muss(g.locator("#liste .platz").count() == 1, "noch in der Liste")
        js("document.querySelector('[data-menue]').click()")
        g.click("[data-wieder]")
        g.wait_for_selector("#detail .d-kopf h1")
        muss(g.inner_text("#detail h1") == "Limoneto", "nicht zurück")
        offen("#/")
    schritt("Papierkorb", papierkorb)

    def abfahrt():
        js("""import('./daten.js?v=10').then(async (m) => { const p = (await (await import('./speicher.js?v=10')).speicher.alles()).plaetze.find(x => x.name === 'Limoneto'); await m.quelle.besuchAnlegen(p.id, { ankunft: '2026-11-01T18:00' }); })""")
        g.reload()
        g.wait_for_selector("#hinweis [data-tun]")
        muss("Abfahrt ist noch offen" in g.inner_text("#hinweis"), g.inner_text("#hinweis"))
        g.click("#hinweis [data-tun]")
        g.fill('#besuch [name="ab"]', "2026-11-03")
        g.click("#bs-ok")
        g.wait_for_selector("#besuch", state="hidden")
        muss("Abfahrt ist noch offen" not in g.inner_text("#hinweis"), "Hinweis bleibt")
        b = [x for p in daten()["plaetze"] if p["name"] == "Limoneto" for x in p["besuche"] if x["ankunft"] == "2026-11-01T18:00"][0]
        muss(b["abfahrt"] == "2026-11-03T12:00", b)
    schritt("Offene Abfahrt: Hinweis und Nachtrag", abfahrt)

    def karte():
        if not g.evaluate("!!document.createElement('canvas').getContext('webgl2')"):
            return "ohne WebGL übersprungen"
        g.click("#hierknopf")
        g.click('[data-weg="karte"]')
        g.wait_for_timeout(1200)
        muss(g.locator("#waehlen .kreuz").is_visible(), "Fadenkreuz")
        bild("10-karte-waehlen")
        g.click('[data-w="nein"]')
        g.wait_for_timeout(500)
        muss(g.locator("#waehlen").is_hidden() and g.locator("#blatt").is_visible(), "Blatt fehlt")
        g.click("#hierknopf")
        g.click('[data-weg="karte"]')
        g.wait_for_timeout(700)
        g.click('[data-w="ja"]')
        g.wait_for_timeout(900)
        if g.locator("#frage[open]").count():
            g.click('#frage [value="nein"]')
            g.wait_for_timeout(300)
            g.click('#frage [value="ja"]')
        g.wait_for_selector("#speichern")
        g.click(".fussleiste [data-abbrechen]")
        g.wait_for_timeout(600)
        muss(len(daten()["plaetze"]) == 2, "Rest")
    schritt("Auf der Karte wählen", karte)

    def neustart():
        vorher = daten()
        g.reload()
        g.wait_for_selector("#liste .platz")
        muss(daten() == vorher, "Daten nach Neuladen anders")
        g.wait_for_timeout(2500)
        bild("11-ende")
        js("document.querySelector('[data-menue]').click()")
        g.click('[data-darstellung="dunkel"]')
        js("document.querySelector('#menue').close()")
        g.wait_for_timeout(1500)
        bild("12-dunkel")
    schritt("Neu laden behält alles, dunkel", neustart)

    def rechtliches():
        js("document.querySelector('[data-menue]').click()")
        g.wait_for_selector("#menue[open]")
        for art, muss_text in (("datenschutz", ["GitHub Pages", "service.pdok.nl", "nur auf diesem Gerät"]), ("lizenzen", ["MIT-Lizenz", "MapLibre", "Pictogrammers", "OpenTopoMap"])):
            g.click(f'[data-info="{art}"]')
            g.wait_for_selector("#info[open]")
            text = g.inner_text("#info")
            muss(all(t in text for t in muss_text), [t for t in muss_text if t not in text])
            muss(not ueberlauf(), ueberlauf())
            g.wait_for_timeout(600)
            bild(f"13-{art}")
            g.click("#info [data-zu]")
            g.wait_for_timeout(300)
        js("document.querySelector('#menue').close()")
    schritt("Datenschutz und Lizenzen", rechtliches)

    def ha_lesen():
        """HA-Bestand mit der Attrappe aus server.py: verbinden, nur lesen, Nächte mit Herkunft, Fotos, zurück zum lokalen Bestand."""
        vorher = daten()
        js("document.querySelector('[data-menue]').click()")
        g.wait_for_selector("#menue[open]")
        g.click("#m-ha-verbinden")
        g.fill("#ha-adresse", URL)
        g.click('#frage [value="ja"]')
        warte("document.documentElement.classList.contains('nurlesen') && document.querySelectorAll('#liste .platz').length === 2")
        muss("code=" not in g.url, g.url)
        muss(not g.is_visible("#hierknopf"), "Neu-Knopf sichtbar")
        p = js("import('./daten.js?v=10').then(m => m.quelle.daten()).then(d => d.plaetze.find(p => p.id === '2026-08-01T18:00'))")
        muss((p["naechte"], p["geparkt"], p["fotos"]) == (2, 1, 1), (p["naechte"], p["geparkt"], p["fotos"]))
        offen("#/platz/" + "2026-08-01T18%3A00")
        warte("[...document.querySelectorAll('#detail .foto img')].some(i => i.naturalWidth > 0)")
        muss(not js("[...document.querySelectorAll('#detail a[href$=\"/bearbeiten\"], #detail [data-besuch-neu]')].some(e => e.offsetParent)"), "Bearbeiten sichtbar")
        offen("#/platz/" + "2026-08-01T18%3A00/bearbeiten")
        muss(not js("location.hash.endsWith('/bearbeiten')"), "Bearbeiten erreichbar")
        fehler = js("import('./daten.js?v=10').then(m => m.quelle.anlegen({ lat: 1, lon: 1 })).then(() => 'geschrieben', e => e.message)")
        muss("Camper-App" in fehler, fehler)
        g.wait_for_timeout(400)
        bild("14-ha")
        js("document.querySelector('[data-menue]').click()")
        g.wait_for_selector("#menue[open]")
        muss("aus Home Assistant" in g.inner_text("#menue"), "Abschnitt fehlt")
        g.click('[data-bestand="lokal"]')
        warte("!document.documentElement.classList.contains('nurlesen') && document.querySelector('#liste .platz')")
        muss(daten() == vorher, "lokale Daten verändert")
    schritt("Home Assistant: verbinden, nur lesen, zurück", ha_lesen)

    if motor == "chromium":
        def offline():
            warte("navigator.serviceWorker.controller")
            c.set_offline(True)
            g.reload()
            g.wait_for_selector("#liste .platz")
            g.click("#hierknopf")
            g.fill('[name="ort"]', "51.0, 9.0")
            g.click('[data-weg="text"]')
            g.wait_for_selector("#speichern")
            g.fill('input[name="name"]', "Offline angelegt")
            g.click("#speichern")
            g.wait_for_selector("#detail .d-kopf h1")
            c.set_offline(False)
            muss(any(x["name"] == "Offline angelegt" for x in daten()["plaetze"]), "fehlt")
        schritt("Ohne Netz starten und anlegen", offline)

        def zweites_fenster():
            h = c.new_page()
            h.goto(URL)
            h.wait_for_selector("#liste .platz")
            vorher = h.locator("#liste .platz").count()
            g.bring_to_front()
            js("import('./daten.js?v=10').then(m => m.quelle.anlegen({ lat: 52, lon: 10 }))")
            for _ in range(40):
                if h.locator("#liste .platz").count() == vorher + 1:
                    break
                h.wait_for_timeout(150)
            muss(h.locator("#liste .platz").count() == vorher + 1, "nicht nachgezogen")
            h.close()
        schritt("Zweites Fenster zieht nach", zweites_fenster)

    erlaubt = ("ERR_INTERNET_DISCONNECTED", "ERR_FAILED", "net::")
    schlimm = [m for m in meldungen if not any(e in m for e in erlaubt)]
    schritt("Keine Fehler in der Konsole", lambda: muss(not schlimm, " | ".join(schlimm[:4])))
    b.close()


# HA-Attrappe: zwei Plätze; Besuch mit Nächten aus Messung (naechte_auto) und einer Handkorrektur (naechte) → 2 Nächte, 1× geparkt
subprocess.run(["sips", "-s", "format", "jpeg", os.path.join(HIER, "..", "icon-192.png"), "--out", f"{AUS}/ha-foto.jpg"], capture_output=True, check=True)
json.dump({"bild": f"{AUS}/ha-foto.jpg", "stand": {"format": "frag-herbert", "fassung": 1, "quelle": "ha", "gelesen": "2026-11-28T12:00:00+01:00",
    "plaetze": [{"id": "2026-08-01T18:00", "name": "Am Weiher", "land": "DE", "lat": 47.9, "lon": 11.4, "art": "Natur", "gepflegt": True, "titelfoto": "ha_eins",
                 "besuche": [{"id": "2026-08-01T18:00", "ankunft": "2026-08-01T18:00:00+02:00", "abfahrt": "2026-08-04T10:00:00+02:00",
                              "naechte": {"2026-08-03": "im"}, "naechte_auto": {"2026-08-01": "im", "2026-08-02": "aussen", "2026-08-03": "aussen"}}]},
                {"id": "2026-09-10T12:00", "name": "Pass", "land": "AT", "lat": 47.2, "lon": 12.1, "besuche": [{"id": "2026-09-10T12:00", "ankunft": "2026-09-10T12:00:00+02:00", "abfahrt": "2026-09-10T15:00:00+02:00"}]}],
    "fotos": [{"id": "ha_eins", "platz": "2026-08-01T18:00", "aufnahme": "2026-08-02T09:00:00+02:00", "breite": 192, "hoehe": 192}]}},
    open(f"{AUS}/ha-attrappe.json", "w"))
srv = subprocess.Popen([sys.executable, os.path.join(HIER, "server.py"), str(PORT)], stdout=subprocess.DEVNULL,
                       env={**os.environ, "HERBERT_HA_ATTRAPPE": f"{AUS}/ha-attrappe.json"})
time.sleep(1)
try:
    with sync_playwright() as p:
        ip = p.devices["iPhone 15 Pro Max"]
        for lauf_name, motor, opt in (("iphone", "webkit", ip), ("mac", "webkit", {"viewport": {"width": 1440, "height": 900}}), ("chrome", "chromium", {"viewport": {"width": 1280, "height": 800}})):
            if len(sys.argv) < 3 or sys.argv[2] == lauf_name:
                lauf(p, lauf_name, motor, opt)
finally:
    srv.terminate()
print(f"{sum(alle)} von {len(alle)} ok")
sys.exit(0 if all(alle) else 1)
