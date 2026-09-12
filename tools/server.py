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
# Murderledger/AlbionOnline2D: proveedor secundario del Tracker por Zona
# (verificación cruzada de frescura; el feed oficial puede atrasarse).
MURDERLEDGER = 'https://murderledger.albiononline2d.com/api'
DEC = 'https://decapi.me/twitch'   # ojo: /twitch es parte de la ruta de DecAPI

# gameinfo bloquea User-Agents de bot desde el borde de Cloudflare (502).
# Mismas cabeceras que usa el Worker de Cloudflare: sin esto el killboard
# solo funciona a través del Worker y el Perfil/la Sala quedan vacíos.
BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
    'Origin': 'https://gameinfo.albiononline.com',
    'Referer': 'https://gameinfo.albiononline.com/game-info-players/',
}

# Mismas rutas y parámetros que el Worker de Cloudflare (GAMEINFO_ROUTES /
# GAMEINFO_PARAMS): el proxy local tampoco sirve de relay genérico hacia
# gameinfo. Si la app usa una ruta nueva, sumarla acá, al Worker y al exe.
GAMEINFO_ROUTES = [
    re.compile(r'^/search$'),
    re.compile(r'^/players/[A-Za-z0-9_-]{1,64}$'),
    re.compile(r'^/players/[A-Za-z0-9_-]{1,64}/(kills|deaths|topkills|solokills)$'),
    re.compile(r'^/guilds/[A-Za-z0-9_-]{1,64}$'),
    re.compile(r'^/guilds/[A-Za-z0-9_-]{1,64}/(members|top)$'),
    re.compile(r'^/events$'),
    re.compile(r'^/guildmatches/(next|past|top)$'),
    re.compile(r'^/guildmatches/[A-Za-z0-9_-]{1,64}$'),
    re.compile(r'^/battles$'),
    re.compile(r'^/battles/[A-Za-z0-9_-]{1,64}$'),
]
GAMEINFO_PARAMS = {'q', 'range', 'limit', 'offset', 'sort', 'guildId'}

# --- sincronización simulada: mismas reglas que el Worker (worker/index.js) ---
SYNC_STORE = {}                      # id de Discord -> copia (solo en memoria)
SYNC_MAX_BYTES = 512 * 1024
SYNC_MAX_KEYS = 64
SYNC_MAX_VALUE = 256 * 1024
SYNC_KEYS = {
    'alertSettings', 'farmPrefs', 'favorites', 'flipPrefs', 'gearPlan', 'gearInventory',
    'kaOn', 'manualPrices', 'pfPlayer', 'pfSpecs', 'priceAlerts', 'psHistory',
    'marketHistory', 'tradeLog', 'aaSGChar', 'aaSGGuild',
}
_DAILY_RE = re.compile(r'^dailyBonus_[A-Za-z_]{1,40}$')


def _sync_key_ok(k):
    return isinstance(k, str) and (k in SYNC_KEYS or bool(_DAILY_RE.match(k)))

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/gameinfo/'):
            return self.proxy_gameinfo()
        if self.path.startswith('/murderledger/'):
            return self.proxy_murderledger()
        if self.path.startswith('/twitch/'):
            return self.proxy_twitch()
        if self.path == '/discord/config':
            return self.discord_config()
        if self.path.startswith('/discord/login'):
            return self.discord_login()
        if self.path.startswith('/discord/callback'):
            return self.discord_callback()
        if self.path.startswith('/discord/verify'):
            return self.discord_verify()
        if self.path.startswith('/sync'):
            return self.sync_get()
        return super().do_GET()

    def do_PUT(self):
        if self.path.startswith('/sync'):
            return self.sync_put()
        return self.send_error(405)

    def do_DELETE(self):
        if self.path.startswith('/sync'):
            return self.sync_delete()
        return self.send_error(405)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Content-Length', '0')
        self.end_headers()

    # ---------- sincronización simulada (KV en memoria) ----------
    # En producción esto vive en Workers KV (binding AA_SYNC). Acá alcanza con
    # un dict de proceso para probar el flujo completo de la app sin Cloudflare.

    def _bearer_token(self):
        value = self.headers.get('Authorization', '')
        return value[7:].strip() if value.startswith('Bearer ') else ''

    def _sync_session(self):
        """Devuelve la sesión del simulador o None. Misma regla que el Worker:
        firma válida, no vencida y miembro de SG."""
        raw = self._bearer_token()
        try:
            pl, sig = raw.split('.', 1)
            if sig != 'dev-sin-firma':
                return None
            pad = '=' * (-len(pl) % 4)
            p = json.loads(base64.urlsafe_b64decode(pl + pad))
            if p.get('e', 0) <= int(time.time() * 1000):
                return None
            if p.get('m') is not True or not p.get('u', {}).get('i'):
                return None
            return p
        except Exception:
            return None

    def _sync_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def sync_get(self):
        s = self._sync_session()
        if not s:
            return self._sync_json({'ok': False, 'error': 'sesion'}, 401)
        rec = SYNC_STORE.get(s['u']['i'])
        if not rec:
            return self._sync_json({'ok': True, 'updated': 0, 'data': None})
        return self._sync_json({'ok': True, 'updated': rec['updated'], 'data': rec['data'],
                                'bytes': rec['bytes']})

    def sync_put(self):
        s = self._sync_session()
        if not s:
            return self._sync_json({'ok': False, 'error': 'sesion'}, 401)
        n = int(self.headers.get('Content-Length') or 0)
        if n > SYNC_MAX_BYTES:
            return self._sync_json({'ok': False, 'error': 'tamano', 'max': SYNC_MAX_BYTES}, 413)
        try:
            body = json.loads(self.rfile.read(n) or b'{}')
        except Exception:
            return self._sync_json({'ok': False, 'error': 'json'}, 400)
        data = body.get('data')
        if not isinstance(data, dict):
            return self._sync_json({'ok': False, 'error': 'formato'}, 400)
        entries = {k: v for k, v in data.items()
                   if _sync_key_ok(k) and isinstance(v, str) and len(v) <= SYNC_MAX_VALUE}
        if not entries:
            return self._sync_json({'ok': False, 'error': 'vacio'}, 400)
        if len(entries) > SYNC_MAX_KEYS:
            return self._sync_json({'ok': False, 'error': 'claves', 'max': SYNC_MAX_KEYS}, 400)
        for v in entries.values():
            try:
                json.loads(v)
            except Exception:
                return self._sync_json({'ok': False, 'error': 'valor'}, 400)
        updated = body.get('updated')
        now = int(time.time() * 1000)
        updated = updated if isinstance(updated, (int, float)) and 0 < updated <= now + 60000 else now
        size = len(json.dumps({'v': 1, 'updated': updated, 'data': entries}))
        SYNC_STORE[s['u']['i']] = {'updated': int(updated), 'data': entries, 'bytes': size}
        return self._sync_json({'ok': True, 'updated': int(updated),
                                'keys': len(entries), 'bytes': size})

    def sync_delete(self):
        s = self._sync_session()
        if not s:
            return self._sync_json({'ok': False, 'error': 'sesion'}, 401)
        SYNC_STORE.pop(s['u']['i'], None)
        return self._sync_json({'ok': True, 'deleted': True})

    # ---------- acceso SG: simulador de Discord (solo desarrollo) ----------
    # En producción el flujo real lo resuelven Discord y el Worker de
    # Cloudflare; acá se simula la pantalla de autorización para poder
    # probar el ingreso, la Sala de miembros y los no-miembros sin claves.

    def _discord_redirect_ok(self, redirect):
        """Allowlist fija (solo localhost, cualquier puerto): anti redirector
        abierto. El header Host no se usa: el cliente manda el Host que quiere,
        y con DNS rebinding un sitio remoto puede terminar apuntando acá.
        Devuelve el destino normalizado (sin query ni fragmento) o None."""
        if not redirect:
            return None
        u = urllib.parse.urlparse(redirect)
        if u.scheme not in ('http', 'https'):
            return None
        if u.hostname not in ('localhost', '127.0.0.1'):
            return None
        return urllib.parse.urlunsplit((u.scheme, u.netloc, u.path, '', ''))

    def discord_config(self):
        body = json.dumps({'configured': True, 'loginUrl': '/discord/login', 'sync': True}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def discord_login(self):
        """Pantalla de autorización simulada (dos roles: miembro y no miembro)."""
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        redirect = self._discord_redirect_ok((q.get('redirect') or [''])[0])
        if not redirect:
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
        member = (q.get('member') or ['1'])[0] == '1'
        redirect = self._discord_redirect_ok((q.get('redirect') or [''])[0])
        if not redirect:
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

    def discord_verify(self):
        """Simula la verificación del Worker: solo acepta los tokens que emite
        este mismo simulador (sufijo '.dev-sin-firma') y que no estén vencidos."""
        raw = self._bearer_token()
        out = {'valid': False}
        try:
            pl, sig = raw.split('.', 1)
            if sig == 'dev-sin-firma':
                pad = '=' * (-len(pl) % 4)
                p = json.loads(base64.urlsafe_b64decode(pl + pad))
                if p.get('e', 0) > int(time.time() * 1000) and p.get('u', {}).get('i'):
                    out = {'valid': True, 'member': p.get('m') is True, 'user': p['u'], 'e': p['e']}
        except Exception:
            pass
        body = json.dumps(out).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def proxy_twitch(self):
        """Estado EN VIVO/OFFLINE de canales de Twitch vía DecAPI (sin clave).
        La app intenta el fetch directo primero; esto es el respaldo para
        entornos donde DecAPI no manda CORS (hosting estático)."""
        # la app pide /twitch/uptime/<canal> -> https://decapi.me/twitch/uptime/<canal>
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
        sub = self.path[len('/gameinfo'):]
        path, _, query = sub.partition('?')
        # allowlist de rutas y parámetros, igual que el Worker
        if not any(rx.match(path) for rx in GAMEINFO_ROUTES):
            return self.send_error(404)
        params = [(k, v) for k, v in urllib.parse.parse_qsl(query, keep_blank_values=True)
                  if k in GAMEINFO_PARAMS and len(v) <= 100]
        url = GAMEINFO + path + ('?' + urllib.parse.urlencode(params) if params else '')
        try:
            req = urllib.request.Request(url, headers=BROWSER_HEADERS)
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

    def proxy_murderledger(self):
        """Murderledger (AlbionOnline2D): dashboard de kills con last_update.
        El Tracker por Zona lo usa para verificar si el feed oficial está al día."""
        sub = self.path[len('/murderledger'):] or '/home'
        # allowlist estricta, igual que el Worker
        if sub.split('?', 1)[0] not in ('/home', '/vod-events'):
            return self.send_error(404)
        url = MURDERLEDGER + sub
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                              'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
            })
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
    # Solo local: el simulador de Discord no debe quedar expuesto a la LAN.
    http.server.ThreadingHTTPServer(('127.0.0.1', 3000), NoCacheHandler).serve_forever()

