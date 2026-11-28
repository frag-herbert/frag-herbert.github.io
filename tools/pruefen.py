#!/usr/bin/env python3
"""Prüft vor jeder Veröffentlichung (auch in .github/workflows/seite.yml): ?v=-Angaben passen zusammen, sw.js kennt alle Dateien,
Lizenzdateien da, jeder Rechner aus der CSP steht im Datenschutztext (info.js), keine privaten Angaben."""
import os
import re
import sys

W = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
lies = lambda n: open(os.path.join(W, n), encoding="utf-8").read()
fehler, angaben = [], {}
QUELLEN = ["index.html", "sw.js"] + sorted(f for f in os.listdir(W) if f.endswith(".js") and f != "sw.js")
for n in QUELLEN:
    for datei, v in re.findall(r'["\'(](?:\./)?([a-z0-9/.-]+\.(?:js|css|png))\?v=([\d.]+)', lies(n)):
        angaben.setdefault(datei, {}).setdefault(v, []).append(n)
for datei, v in angaben.items():
    if len(v) > 1:
        fehler.append(f"{datei}: verschiedene Versionen {v}")
app = {u.split("?")[0] for u in re.findall(r'"([^"]+)"', re.search(r"const APP = \[(.*?)\];", lies("sw.js"), re.S).group(1))}
for datei in sorted(f for f in os.listdir(W) if re.search(r"\.(js|css|png|webmanifest)$", f) and f != "sw.js"):
    if datei not in app:
        fehler.append(f"{datei} fehlt in sw.js APP")
for a in app - {"./"}:
    if not os.path.exists(os.path.join(W, a)):
        fehler.append(f"sw.js nennt {a}, gibt es nicht")
for n in ("LICENSE", "HINWEISE.md", "maplibre/LICENSE.txt"):
    if not os.path.exists(os.path.join(W, n)):
        fehler.append(f"{n} fehlt")
csp = re.search(r'connect-src ([^"]+)"', lies("index.html")).group(1)
for host in re.findall(r"https://([^\s;]+)", csp):
    if host not in lies("info.js"):
        fehler.append(f"{host} steht in der CSP, aber nicht im Datenschutztext (info.js ANBIETER)")
# Allgemeine Muster hier; persönliche (Namen, Rechner, Konten) stehen je Zeile in tools/privat.txt – nicht im Repo (.gitignore)
muster = [r"privaterelay", r"tail[0-9a-f]{6}", r"\.ts\.net", r"192\.168\.", r"/Users/", r"eyJ[A-Za-z0-9]{10}"]
eigene = os.path.join(W, "tools", "privat.txt")
if os.path.exists(eigene):
    muster += [re.escape(z.strip()) for z in open(eigene, encoding="utf-8") if z.strip() and not z.startswith("#")]
PRIVAT = re.compile("|".join(muster), re.I)
for ordner, unter, dateien in os.walk(W):
    unter[:] = [u for u in unter if u not in (".git", "maplibre", "__pycache__")]
    for n in dateien:
        if re.search(r"\.(js|css|html|md|py|svg|webmanifest|json)$", n) and n != "pruefen.py":
            for i, z in enumerate(open(os.path.join(ordner, n), encoding="utf-8"), 1):
                if PRIVAT.search(z):
                    fehler.append(f"private Angabe? {os.path.relpath(os.path.join(ordner, n), W)}:{i}: {z.strip()[:90]}")
print("\n".join(fehler) or "ok")
sys.exit(bool(fehler))
