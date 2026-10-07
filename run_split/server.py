# -*- coding: utf-8 -*-
"""
Run Split - local static server for PC testing (Python standard library only).

NOTE: iPhone Safari only allows GPS on https pages. Over http://<LAN IP> the
GPS will NOT work. Use the GitHub Pages URL (https) on the iPhone; this server is
for checking the screen and the simulator (/?sim=1&speed=20) on the PC.
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8520


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".json": "application/manifest+json; charset=utf-8",
    }

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=BASE, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)


def main():
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    srv.daemon_threads = True
    print("=" * 60)
    print("Run Split（1kmラップ計測）を起動しました")
    print(f"  このPC:            http://localhost:{PORT}/")
    print(f"  シミュレーション:  http://localhost:{PORT}/?sim=1&speed=20")
    print("  ※ iPhone では GPS に https が必要です。公開URL（URL.txt）から開いてください。")
    print("  終了: このウィンドウを閉じる（または Ctrl+C）")
    print("=" * 60)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
