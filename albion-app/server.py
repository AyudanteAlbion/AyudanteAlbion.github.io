#!/usr/bin/env python3
"""Servidor estático con cabeceras no-cache para desarrollo.
Incluye proxy /gameinfo/* hacia la API oficial de Albion (que no envía CORS)."""
import http.server
import urllib.request
import urllib.error

GAMEINFO = 'https://gameinfo.albiononline.com/api/gameinfo'

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/gameinfo/'):
            return self.proxy_gameinfo()
        return super().do_GET()

    def proxy_gameinfo(self):
        url = GAMEINFO + self.path[len('/gameinfo'):]
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'AyudanteAlbion/1.0'})
            with urllib.request.urlopen(req, timeout=15) as r:
                body = r.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as e:
            self.send_error(e.code)
        except Exception:
            self.send_error(502)

    def end_headers(self):
        if self.path.startswith('/icons/'):
            # Los íconos son inmutables: cachear agresivamente en el navegador
            self.send_header('Cache-Control', 'public, max-age=604800, immutable')
        else:
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *args):
        pass

if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('0.0.0.0', 3000), NoCacheHandler).serve_forever()
