#!/usr/bin/env python3
"""Servidor estático con cabeceras no-cache para desarrollo."""
import http.server

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
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
