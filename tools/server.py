#!/usr/bin/env python3
"""Frag Herbert lokal: tools/server.py [Port [Ordner]] → http://localhost:8790/ (nur dieser Mac; Offline und Standort gehen auf localhost).

iPhone-Abnahme im eigenen Tailnet (nicht öffentlich):  tailscale serve --bg --https=443 http://127.0.0.1:8790
Wieder aus:                                            tailscale serve --https=443 off
"""
import functools
import http.server
import os
import sys


class H(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"  # Keep-alive: weniger neue Verbindungen hinter dem Proxy
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".webmanifest": "application/manifest+json", ".js": "text/javascript"}

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
