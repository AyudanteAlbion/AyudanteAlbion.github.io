/* ============================================================
   Ayudante Albion — proxy de solo lectura (Cloudflare Worker)
   Cubre las dos APIs que un hosting estático no puede llamar
   directo desde el navegador:
     · gameinfo.albiononline.com (killboard) no envía CORS
     · decapi.me (badges de Twitch) sirve como respaldo cuando
       el navegador no puede llamarlo en persona
   Rutas expuestas:
     GET /gameinfo/<resto>        -> gameinfo.albiononline.com/api/gameinfo/<resto>
     GET /twitch/uptime/<canal>   -> decapi.me/twitch/uptime/<canal>
     GET /health                  -> ok
   Solo GET, sin almacenamiento y sin secretos: la cache (60 s /
   45 s) vive en el borde de Cloudflare y protege el free tier.
   ============================================================ */

const GAMEINFO = 'https://gameinfo.albiononline.com/api/gameinfo';
const DECAPI = 'https://decapi.me/twitch/uptime/';

/* gameinfo filtra bots desde el borde de Cloudflare (502 a la salida de
   Workers). Darle a la subrequest pinta de navegador del sitio oficial es
   lo único que suele pasar; sin esto el killboard solo vive en el exe. */
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
  'Origin': 'https://gameinfo.albiononline.com',
  'Referer': 'https://gameinfo.albiononline.com/game-info-players/',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET') return plain('solo GET', 405);

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/' || path === '/health') return plain('ok');

    if (path === '/gameinfo' || path.startsWith('/gameinfo/')) {
      const target = GAMEINFO + path.slice('/gameinfo'.length) + url.search;
      return forward(target, { '200-299': 60, '500-502': 0, '503-599': 0 }, BROWSER_HEADERS);
    }

    if (path.startsWith('/twitch/uptime/')) {
      const chan = path.slice('/twitch/uptime/'.length);
      if (!/^[A-Za-z0-9_]{2,39}$/.test(chan)) return plain('canal inválido', 400);
      return forward(DECAPI + chan.toLowerCase(), { '200-299': 45, '400-599': 5 });
    }

    return plain('no existe', 404);
  },
};

/* Reenvía la respuesta tal cual. El navegador ve no-store para que la
   app siempre traiga lo último al actualizar; la cache de borde (cf.
   cacheTtlByStatus) es la que descarga a los upstreams. */
async function forward(target, ttlByStatus, extraHeaders) {
  let res;
  try {
    res = await fetch(target, {
      cf: { cacheTtlByStatus: ttlByStatus },
      headers: extraHeaders || { 'User-Agent': 'ayudante-albion (proxy gremio Spetsnaz Grail)' },
    });
  } catch (e) {
    return plain('arriba sin respuesta', 502);
  }
  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cache-Control', 'no-store');
  const type = (res.headers.get('content-type') || '').includes('json')
    ? 'application/json; charset=utf-8'
    : 'text/plain; charset=utf-8';
  headers.set('Content-Type', type);
  return new Response(res.body, { status: res.status, headers });
}

function plain(msg, status = 200) {
  return new Response(msg, {
    status,
    headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
