#!/usr/bin/env python3
"""Update-Test: tools/uebergang.py <alte Fassung (git-Ref)> [ausgabeordner]

Legt in der alten Version (git archive <ref>) Daten an, tauscht dann auf derselben Adresse die Dateien gegen den aktuellen
Arbeitsstand – so wie ein Tester ein Update bekommt (Service Worker, gleiche IndexedDB). Danach müssen alle Plätze, Besuche
und Fotos unverändert da sein, ein Backup muss sich erstellen und wieder lesen lassen. Vor jeder Veröffentlichung gegen die
zuletzt veröffentlichte Version laufen lassen (README, „Datenformat“). Chromium, weil Playwright-WebKit keine Service Worker kann.
"""
import io
import os
import re
import subprocess
import sys
import tarfile
import tempfile
import time

from playwright.sync_api import sync_playwright

HIER = os.path.dirname(os.path.abspath(__file__))
WURZEL = os.path.realpath(os.path.join(HIER, ".."))
ALT = sys.argv[1] if len(sys.argv) > 1 else "HEAD"
AUS = sys.argv[2] if len(sys.argv) > 2 else tempfile.mkdtemp(prefix="uebergang-")
os.makedirs(AUS, exist_ok=True)
PORT = 8792
URL = f"http://localhost:{PORT}/"
ergebnisse = []


def schritt(titel, fn):
    try:
        info, ok = fn() or "", True
    except Exception as e:  # noqa: BLE001
        info, ok = str(e).split("\n")[0][:220], False
    ergebnisse.append(ok)
    print(("OK   " if ok else "FEHL ") + f"{titel} {info}", flush=True)
    return ok


def muss(x, text):
    if not x:
        raise AssertionError(text)


def server(ordner):
    s = subprocess.Popen([sys.executable, os.path.join(HIER, "server.py"), str(PORT), ordner], stdout=subprocess.DEVNULL)
    time.sleep(1)
    return s


def modul(ordner, name):
    """Import-Pfad eines Moduls samt ?v= aus app.js der jeweiligen Fassung."""
    return re.search(rf'"(\./{name}\.js\?v=[\d.]+)"', open(os.path.join(ordner, "app.js"), encoding="utf-8").read()).group(1)


def version(ordner):
    return re.search(r'const VERSION = "([^"]+)"', open(os.path.join(ordner, "app.js"), encoding="utf-8").read()).group(1)


alt = tempfile.mkdtemp(prefix="herbert-alt-")
tar = subprocess.run(["git", "-C", WURZEL, "archive", ALT], capture_output=True, check=True).stdout
tarfile.open(fileobj=io.BytesIO(tar)).extractall(alt)  # eigenes Repo, vertrauenswürdig
print(f"alt {version(alt)} ({ALT}) → neu {version(WURZEL)} (Arbeitsstand)")

profil = tempfile.mkdtemp(prefix="herbert-profil-")
with sync_playwright() as p:
    c = p.chromium.launch_persistent_context(profil, viewport={"width": 1280, "height": 800}, locale="de-DE", timezone_id="Europe/Berlin")
    g = c.new_page()
    fehler = []
    g.on("pageerror", lambda e: fehler.append(str(e)[:200]))
    js = g.evaluate

    def warte(ausdruck, sek=30):
        ende = time.time() + sek
        while time.time() < ende:
            if js(f"async () => !!({ausdruck})"):
                return
            g.wait_for_timeout(200)
        raise AssertionError("wartete vergeblich auf " + ausdruck[:120])

    srv = server(alt)
    vorher = {}
    try:
        def anlegen():
            g.goto(URL)
            g.wait_for_selector(".willkommen")
            warte("navigator.serviceWorker.controller")
            d, s = modul(alt, "daten"), modul(alt, "speicher")
            js(f"""async () => {{
              const {{ quelle }} = await import('{d}');
              const a = await quelle.anlegen({{ lat: 47.6553, lon: 11.361, besuch: {{ ankunft: '2026-07-01T18:00', abfahrt: '2026-07-03T10:00' }} }});
              await quelle.speichern(a, {{ name: 'Am See', notiz: 'Ruhig, „Umlaute“ & <Zeichen>', art: 'stellplatz', bewertung: 4 }});
              await quelle.besuchAnlegen(a, {{ ankunft: '2026-08-10T12:00', abfahrt: '2026-08-11T09:00' }});
              const b = await quelle.anlegen({{ lat: 46.0, lon: 7.5 }});
              await quelle.speichern(b, {{ name: 'Pass' }});
              const c = document.createElement('canvas'); c.width = 1200; c.height = 800;
              const x = c.getContext('2d'); x.fillStyle = '#0f6b5c'; x.fillRect(0, 0, 1200, 800);
              const blob = await new Promise((o) => c.toBlob(o, 'image/jpeg', 0.8));
              await quelle.fotoAnlegen(a, new File([blob], 'probe.jpg', {{ type: 'image/jpeg' }}));
              const c2 = await quelle.anlegen({{ lat: 52.1, lon: 5.1 }});
              await quelle.loeschen(c2);
            }}""")
            vorher.update(js(f"import('{s}').then(m => m.speicher.alles())"))
            muss(len(vorher["plaetze"]) == 3 and len(vorher["fotos"]) == 1, vorher)
            return f"{len(vorher['plaetze'])} Plätze, {len(vorher['fotos'])} Foto in {version(alt)}"
        schritt("Daten in der alten Version anlegen", anlegen)
    finally:
        srv.terminate()
        srv.wait()

    srv = server(WURZEL)
    try:
        neu = version(WURZEL)

        def update():
            # Wie beim Tester: App öffnen, der Service Worker holt die neue Version und lädt die Seite neu
            g.reload()
            cache = re.search(r'VERSION = "(herbert-app-\d+)"', open(os.path.join(WURZEL, "sw.js"), encoding="utf-8").read()).group(1)
            warte(f"(await caches.keys()).includes('{cache}')")
            g.wait_for_timeout(1500)
            g.reload()
            g.wait_for_selector("#liste .platz")
            js("document.querySelector('[data-menue]').click()")
            g.wait_for_selector("#menue[open]")
            muss(neu in g.inner_text("#menue"), "Menü zeigt nicht " + neu)
            js("document.querySelector('#menue').close()")
            return neu
        schritt("Update über den Service Worker", update)

        def gleich():
            nachher = js(f"import('{modul(WURZEL, 'speicher')}').then(m => m.speicher.alles())")
            muss(nachher == vorher, "Daten nach dem Update anders")
            bild = js(f"""async () => {{ const m = await import('{modul(WURZEL, 'speicher')}'); const f = (await m.speicher.alles()).fotos[0];
              const b = await m.speicher.bild(f.id + '|g'); const v = await m.speicher.bild(f.id + '|v'); return [b?.size || 0, v?.size || 0]; }}""")
            muss(all(bild), f"Bilddaten fehlen {bild}")
        schritt("Plätze, Besuche, Fotos unverändert", gleich)

        def backup():
            r = js(f"""async () => {{ const b = await import('{modul(WURZEL, 'backup')}');
              const e = await b.backupErstellen('{neu}'); const datei = Array.isArray(e) ? e[0] : (e.dateien ? e.dateien[0] : e.datei || e);
              const l = await b.backupLesen(datei); return [l.plaetze.length, l.fotos.length, l.sichtbar]; }}""")
            muss(r == [3, 1, 2], r)
        schritt("Backup aus den übernommenen Daten", backup)

        schritt("Keine Fehler in der Seite", lambda: muss(not fehler, " | ".join(fehler[:3])))
        g.screenshot(path=f"{AUS}/uebergang.png")
    finally:
        srv.terminate()
        c.close()

print(f"{sum(ergebnisse)} von {len(ergebnisse)} ok ({AUS})")
sys.exit(0 if all(ergebnisse) else 1)
