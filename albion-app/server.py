#!/usr/bin/env python3
"""Servidor estático con cabeceras no-cache para desarrollo.
Incluye proxy /gameinfo/* hacia la API oficial de Albion (que no envía CORS)
y un simulador de Discord para probar el acceso de miembros SG sin
configurar el Worker de Cloudflare (solo en este servidor local)."""
import base64
import json
import re
import time
import urllib.parse
import http.server
import urllib.request
import urllib.error

GAMEINFO = 'https://gameinfo.albiononline.com/api/gameinfo'
DEC = 'https://decapi.me'

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/gameinfo/'):
            return self.proxy_gameinfo()
        if self.path.startswith('/twitch/'):
            return self.proxy_twitch()
        if self.path == '/discord/config':
            return self.discord_config()
        if self.path.startswith('/discord/login'):
            return self.discord_login()
        if self.path.startswith('/discord/callback'):
            return self.discord_callback()
        return super().do_GET()

    # ---------- acceso SG: simulador de Discord (solo desarrollo) ----------
    # En producción el flujo real lo resuelven Discord y el Worker de
    # Cloudflare; acá se simula la pantalla de autorización para poder
    # probar el ingreso, la Sala de miembros y los no-miembros sin claves.

    def _discord_redirect_ok(self, redirect):
        """Solo acepta volver al propio origen (o localhost): anti redirector abierto."""
        if not redirect:
            return False
        host = self.headers.get('Host', '')
        if host and redirect.startswith('http://' + host + '/'):
            return True
        return bool(re.match(r'^https?://(localhost|127\.0\.0\.1)(:\d+)?/', redirect))

    def discord_config(self):
        body = json.dumps({'configured': True, 'loginUrl': '/discord/login'}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def discord_login(self):
        """Pantalla de autorización simulada (dos roles: miembro y no miembro)."""
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        redirect = (q.get('redirect') or [''])[0]
        if not self._discord_redirect_ok(redirect):
            return self.send_error(400, 'redirect no permitido')
        safe = urllib.parse.quote(redirect, safe='')
        html = """<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Autorización — Discord (simulado)</title>
<style>
 body{background:#1e1f22;color:#dbdee1;font-family:"gg sans","Segoe UI",system-ui,sans-serif;
   display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
 .card{max-width:440px;background:#313338;border-radius:8px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,.4)}
 .head{padding:18px 20px;background:#2b2d31;border-bottom:1px solid #1e1f22;display:flex;gap:12px;align-items:center}
 .logo{width:34px;height:34px;border-radius:50%;background:#5865f2;display:flex;align-items:center;
   justify-content:center;font-weight:800;color:#fff}
 h1{font-size:1rem;margin:0}
 .body{padding:18px 20px}
 p{font-size:.88rem;line-height:1.5;margin:0 0 8px}
 .perm{font-size:.8rem;color:#949ba4;margin:12px 0 0;padding-left:4px}
 .btns{display:grid;gap:10px;padding:4px 20px 20px}
 a{display:block;text-align:center;padding:11px;border-radius:4px;font-size:.9rem;
   font-weight:600;text-decoration:none}
 .si{background:#5865f2;color:#fff}
 .si:hover{background:#4752c4}
 .no{background:#2b2d31;color:#dbdee1;border:1px solid #3f4147}
 .no:hover{border-color:#72767d}
 .note{font-size:.72rem;color:#949ba4;text-align:center;padding:0 20px 16px}
</style></head><body><div class="card">
 <div class="head"><span class="logo">D</span><div><h1>Ayudante Albion quiere acceder a tu cuenta</h1></div></div>
 <div class="body">
   <p><b>DevTester</b>, esta app podrá:</p>
   <p>· Acceder a tu nombre de usuario y avatar</p>
   <p>· Ver la lista de servidores a los que pertenecés</p>
   <p class="perm">Autorizando, podés probar el ingreso como miembro de Spetsnaz Grail o como externo. Este es el simulador del server.py local: en producción esta pantalla es la de Discord real y la verificación la hace el Worker de Cloudflare.</p>
 </div>
 <div class="btns">
   <a class="si" href="/discord/callback?redirect=__R__&member=1">Autorizar (soy miembro de SG)</a>
   <a class="no" href="/discord/callback?redirect=__R__&member=0">Autorizar (no soy miembro)</a>
 </div>
 <div class="note">Servidor de desarrollo — no hay Discord real de por medio</div>
</div></body></html>""".replace('__R__', safe)
        data = html.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def discord_callback(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        redirect = (q.get('redirect') or [''])[0]
        member = (q.get('member') or ['1'])[0] == '1'
        if not self._discord_redirect_ok(redirect):
            return self.send_error(400, 'redirect no permitido')
        now = int(time.time() * 1000)
        payload = {
            'u': {'i': 'dev-0001', 'n': 'DevTester', 'a': ''},
            'm': member, 't': now, 'e': now + 30 * 24 * 3600 * 1000,
        }
        pl = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip('=')
        token = pl + '.dev-sin-firma'
        back = redirect + '#aa_session=' + urllib.parse.quote(token, safe='')
        self.send_response(302)
        self.send_header('Location', back)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def proxy_twitch(self):
        """Estado EN VIVO/OFFLINE de canales de Twitch vía DecAPI (sin clave).
        La app intenta el fetch directo primero; esto es el respaldo para
        entornos donde DecAPI no manda CORS (hosting estático)."""
        url = DEC + self.path[len('/twitch'):]
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'AyudanteAlbion/1.0'})
            with urllib.request.urlopen(req, timeout=15) as r:
                body = r.read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/plain; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as e:
            self.send_error(e.code)
        except Exception:
            self.send_error(502)

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
