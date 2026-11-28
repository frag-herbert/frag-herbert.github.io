#!/usr/bin/env python3
"""Frag Herbert lokal: tools/server.py [Port [Ordner]] → http://localhost:8790/ (nur dieser Mac; Offline und Standort gehen auf localhost).

iPhone-Abnahme im eigenen Tailnet (nicht öffentlich):  tailscale serve --bg --https=443 http://127.0.0.1:8790
Wieder aus:                                            tailscale serve --https=443 off
"""
import functools
import http.server
import json
import os
import sys
import urllib.parse

# Nur für tools/test.py: HERBERT_HA_ATTRAPPE=<datei.json> bildet die Integration „frag_herbert“ samt HA-Anmeldung nach
# ({ "stand": {...}, "bild": "<pfad.jpg>" }), unter derselben Adresse wie die App (KONZEPT-WEBAPP.md 12.2.1).
ATTRAPPE = os.environ.get("HERBERT_HA_ATTRAPPE")
TOKEN = "attrappe-token"


class H(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"  # Keep-alive: weniger neue Verbindungen hinter dem Proxy
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".webmanifest": "application/manifest+json", ".js": "text/javascript"}

    def do_GET(self):
        if ATTRAPPE and self.attrappe():
            return
        super().do_GET()

    def do_POST(self):
        if ATTRAPPE and self.attrappe():
            return
        self.send_error(405)

    def antwort(self, status, daten=b"", art="application/json", kopf=None):
        self.send_response(status)
        for k, v in (kopf or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Type", art)
        self.send_header("Content-Length", str(len(daten)))
        super().end_headers()
        self.wfile.write(daten)

    def attrappe(self):
        u = urllib.parse.urlsplit(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        a = json.load(open(ATTRAPPE, encoding="utf-8"))
        angemeldet = self.headers.get("Authorization") == f"Bearer {TOKEN}"
        if u.path == "/auth/authorize":
            ziel = f"{q['redirect_uri']}?{urllib.parse.urlencode({'code': 'attrappe-code', 'state': q['state']})}"
            self.antwort(302, kopf={"Location": ziel})
        elif u.path == "/auth/token":
            self.rfile.read(int(self.headers.get("Content-Length") or 0))
            self.antwort(200, json.dumps({"access_token": TOKEN, "refresh_token": "attrappe-refresh", "expires_in": 1800}).encode())
        elif u.path == "/auth/revoke":
            self.rfile.read(int(self.headers.get("Content-Length") or 0))
            self.antwort(200)
        elif u.path == "/api/frag_herbert/stand":
            self.antwort(200 if angemeldet else 401, json.dumps(a["stand"]).encode() if angemeldet else b"")
        elif u.path.startswith("/api/frag_herbert/foto/"):
            self.antwort(200, open(a["bild"], "rb").read(), "image/jpeg") if angemeldet else self.antwort(401)
        else:
            return False
        return True

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, *a):
        pass


class Server(http.server.ThreadingHTTPServer):
    # Der Browser lädt über „tailscale serve“ alle Module gleichzeitig; mit der Vorgabe (5) lehnt macOS den Rest ab → 502
    request_queue_size = 128
    daemon_threads = True


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
    wurzel = os.path.realpath(sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    print(f"http://localhost:{port}/", flush=True)
    Server(("127.0.0.1", port), functools.partial(H, directory=wurzel)).serve_forever()
