/* ============================================================
   Ayudante Albion — proxy de solo lectura (Cloudflare Worker)
   Cubre las APIs que un hosting estático no puede llamar directo
   desde el navegador:
     · gameinfo.albiononline.com (killboard) no envía CORS
     · decapi.me (badges de Twitch) sirve como respaldo cuando
       el navegador no puede llamarlo en persona
     · discord.com (OAuth2) exige un secreto que no puede vivir
       en el código de la página: el worker hace el intercambio
   Rutas expuestas:
     GET /gameinfo/<resto>        -> gameinfo.albiononline.com/api/gameinfo/<resto>
                                     (solo las rutas que usa la app; ver GAMEINFO_ROUTES)
     GET /murderledger/<resto>    -> murderledger.albiononline2d.com/api/<resto>
                                     (proveedor secundario del Tracker por Zona:
                                     verificación cruzada de frescura; ver ML_ROUTES)
     GET /twitch/uptime/<canal>   -> decapi.me/twitch/uptime/<canal>
     GET /health                  -> ok
     GET /discord/config          -> {configured} — ¿el acceso SG está activo?
     GET /discord/login?redirect= -> 302 a la pantalla de autorización de Discord
     GET /discord/callback        -> intercambia el código, verifica la membresía
                                     en el servidor SG y vuelve a la app con
                                     #aa_session=<payload firmado con HMAC>
     GET /discord/verify?s=       -> {valid, member, user} — comprueba la firma
                                     y la vigencia de una sesión (la app no
                                     confía en ninguna sesión sin este visto bueno)
   Configuración (Dashboard de Cloudflare → Workers → ajustes →
   Variables y secretos del worker «ayudantealbion»):
     DISCORD_CLIENT_ID     (texto)   — Client ID de la app de Discord
     DISCORD_CLIENT_SECRET (secreto) — Client Secret de la app de Discord
     SG_DISCORD_GUILD_ID   (texto)   — ID del servidor de Discord de SG
     AA_SESSION_KEY        (secreto) — clave HMAC de las sesiones (≥32 chars,
                                       distinta del Client Secret). Obligatoria:
                                       sin ella el acceso SG queda desactivado
   En la app de Discord hay que registrar como «Redirect URI»:
     https://ayudantealbion.josemesina21.workers.dev/discord/callback
   El resto de la app sigue siendo público: nada se guarda del usuario,
   solo se responde si pertenece al gremio al momento de ingresar.
   ============================================================ */

const GAMEINFO = 'https://gameinfo.albiononline.com/api/gameinfo';
/* Murderledger hoy vive bajo AlbionOnline2D (mismo operador): su API pública
   expone el dashboard de kills (/home) con last_update, que usamos para
   verificar si el feed oficial está atrasado. Sin zona por evento: aporta
   frescura y kills destacadas, no el filtrado geográfico. */
const MURDERLEDGER = 'https://murderledger.albiononline2d.com/api';
const DECAPI = 'https://decapi.me/twitch/uptime/';
const DISCORD_API = 'https://discord.com/api/v10';
const SESSION_TTL = 7 * 24 * 3600e3; // la sesión sirve 7 días (TTL corto: si un token llegara a filtrarse, la ventana de abuso es acotada)
const STATE_TTL = 10 * 60e3;          // el state de OAuth vive 10 minutos

/* Orígenes a los que el callback puede devolver al usuario (evita que el
   worker quede como redirector abierto). El exe y el server local usan
   localhost con puerto variable, por eso cualquier puerto entra. */
const ALLOWED_HOSTS = ['ayudantealbion.github.io', 'localhost', '127.0.0.1'];

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

/* Rutas del killboard que la app usa de verdad. El resto no se reenvía:
   así el Worker no sirve de proxy genérico hacia gameinfo. */
const GAMEINFO_ROUTES = [
  /^\/search$/,
  /^\/players\/[A-Za-z0-9_-]{1,64}$/,
  /^\/players\/[A-Za-z0-9_-]{1,64}\/(kills|deaths|topkills|solokills)$/,
  /^\/guilds\/[A-Za-z0-9_-]{1,64}$/,
  /^\/guilds\/[A-Za-z0-9_-]{1,64}\/(members|top)$/,
  /* Mapa de Guerra: kills del gremio + GvG (no existe /guilds/:id/territories)
     + detalle de batalla con participantes (tracker por zona) */
  /^\/events$/,
  /^\/guildmatches\/(next|past|top)$/,
  /^\/guildmatches\/[A-Za-z0-9_-]{1,64}$/,
  /^\/battles$/,
  /^\/battles\/[A-Za-z0-9_-]{1,64}$/,
];
const GAMEINFO_PARAMS = new Set(['q', 'range', 'limit', 'offset', 'sort', 'guildId']);

/* Murderledger: solo el dashboard de frescura y el feed de kills con VOD.
   Nada más se reenvía (el worker no es un proxy genérico hacia AO2D). */
const ML_ROUTES = [
  /^\/home$/,
  /^\/vod-events$/,
];
const ML_PARAMS = new Set(['take', 'skip', 'battle_size', 'weapon', 'q', 'sort']);

/* Orígenes (páginas) que pueden llamar al proxy desde el navegador. El exe y
   server.py corren en localhost con puerto variable; las peticiones sin
   Origin (curl, apps nativas) también pasan porque CORS no las protege igual. */
function corsOrigin(request) {
  const o = request.headers.get('Origin');
  if (!o) return '*';
  try {
    const u = new URL(o);
    return ALLOWED_HOSTS.includes(u.hostname) ? o : null;
  } catch (e) { return null; }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

/* ---------- creación del worker (inyectable para el selftest) ---------- */
/* createWorker(env, fetchImpl): env trae las variables de Cloudflare y
   fetchImpl permite simular las respuestas de Discord en las pruebas. */
export function createWorker(env = {}, fetchImpl) {
  const net = fetchImpl || ((u, init) => fetch(u, init));
  return {
    fetch: request => handle(request, env || {}, net),
  };
}

export default {
  async fetch(request, env) {
    return createWorker(env).fetch(request);
  },
};

async function handle(request, env, net) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'GET') return plain('solo GET', 405);

  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/' || path === '/health') return plain('ok');

  if (path === '/gameinfo' || path.startsWith('/gameinfo/')) {
    const origin = corsOrigin(request);
    if (!origin) return plain('origen no permitido', 403);
    const sub = path.slice('/gameinfo'.length);
    if (!GAMEINFO_ROUTES.some(re => re.test(sub))) return plain('ruta no permitida', 404);
    const qs = new URLSearchParams();
    for (const [k, v] of url.searchParams) if (GAMEINFO_PARAMS.has(k) && v.length <= 100) qs.set(k, v);
    const q = qs.toString();
    const target = GAMEINFO + sub + (q ? '?' + q : '');
    return forward(target, { '200-299': 60, '500-502': 0, '503-599': 0 }, BROWSER_HEADERS, net, origin);
  }

  if (path === '/murderledger' || path.startsWith('/murderledger/')) {
    const origin = corsOrigin(request);
    if (!origin) return plain('origen no permitido', 403);
    const sub = path.slice('/murderledger'.length) || '/home';
    if (!ML_ROUTES.some(re => re.test(sub))) return plain('ruta no permitida', 404);
    const qs = new URLSearchParams();
    for (const [k, v] of url.searchParams) if (ML_PARAMS.has(k) && v.length <= 100) qs.set(k, v);
    const q = qs.toString();
    const target = MURDERLEDGER + sub + (q ? '?' + q : '');
    /* AO2D no bloquea por User-Agent como gameinfo; cabeceras normales bastan.
       Caché corta (30 s): el dashboard se refresca cada ~5 min igual. */
    return forward(target, { '200-299': 30, '500-502': 0, '503-599': 0 }, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
    }, net, origin);
  }

  if (path.startsWith('/twitch/uptime/')) {
    const origin = corsOrigin(request);
    if (!origin) return plain('origen no permitido', 403);
    const chan = path.slice('/twitch/uptime/'.length);
    if (!/^[A-Za-z0-9_]{2,39}$/.test(chan)) return plain('canal inválido', 400);
    return forward(DECAPI + chan.toLowerCase(), { '200-299': 45, '400-599': 5 }, undefined, net, origin);
  }

  /* ---------------- acceso de miembros SG (Discord OAuth2) ---------------- */
  if (path === '/discord/config') {
    const dc = discordConfig(env);
    /* `missing` nombra las variables que faltan (nunca sus valores): sirve
       para saber desde la app o con curl qué quedó sin cargar en Cloudflare */
    return json({ configured: dc.ok, loginUrl: dc.ok ? url.origin + '/discord/login' : null, missing: dc.ok ? [] : dc.missing });
  }

  if (path === '/discord/login') return discordLogin(request, url, env);
  if (path === '/discord/verify') return discordVerify(url, env);
  if (path === '/discord/callback') return discordCallback(request, url, env, net);

  return plain('no existe', 404);
}

/* ============================ Discord OAuth ============================ */

function discordConfig(env) {
  const clientId = (env.DISCORD_CLIENT_ID || '').trim();
  const secret = (env.DISCORD_CLIENT_SECRET || '').trim();
  const guildId = (env.SG_DISCORD_GUILD_ID || '').trim();
  const sessionKey = (env.AA_SESSION_KEY || '').trim();
  /* la clave de sesión debe existir y no reutilizar el Client Secret: si
     alguna vez se filtra la firma, no cae también el OAuth (y viceversa) */
  const keyOk = sessionKey.length >= 32 && sessionKey !== secret;
  const ok = !!(clientId && secret && guildId && keyOk);
  const missing = [];
  if (!clientId) missing.push('DISCORD_CLIENT_ID');
  if (!secret) missing.push('DISCORD_CLIENT_SECRET');
  if (!guildId) missing.push('SG_DISCORD_GUILD_ID');
  if (!sessionKey) missing.push('AA_SESSION_KEY');
  else if (!keyOk) missing.push(sessionKey.length < 32 ? 'AA_SESSION_KEY (menos de 32 caracteres)' : 'AA_SESSION_KEY (igual al Client Secret)');
  return { ok, clientId, secret, guildId, sessionKey, keyOk, missing };
}

/* redirect permitido: http(s) + host de la lista (cualquier puerto/camino).
   Se normaliza sin query ni fragmento para no reflejar parámetros. */
function safeRedirect(raw) {
  let u;
  try { u = new URL(raw); } catch (e) { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!ALLOWED_HOSTS.includes(u.hostname)) return null;
  return u.origin + u.pathname;
}

function callbackUrl(url) {
  return new URL('/discord/callback', url).toString();
}

async function discordLogin(request, url, env) {
  const dc = discordConfig(env);
  if (!dc.ok) return json({ error: 'no-configurado', msg: dc.keyOk
    ? 'Faltan DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET o SG_DISCORD_GUILD_ID en las variables del worker.'
    : 'Falta AA_SESSION_KEY (secreto de al menos 32 caracteres, distinto del Client Secret) en las variables del worker.' }, 503);

  const redirect = safeRedirect(url.searchParams.get('redirect') || '');
  if (!redirect) return json({ error: 'redirect', msg: 'Origen de la app no permitido (ayudantealbion.github.io o localhost).' }, 400);

  const st = b64url({ r: redirect, t: Date.now() });
  const state = st + '.' + (await hmac(dc.sessionKey, st));
  const authorize = new URL(DISCORD_API.replace('/api/v10', '') + '/oauth2/authorize');
  authorize.searchParams.set('client_id', dc.clientId);
  authorize.searchParams.set('redirect_uri', callbackUrl(url));
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('scope', 'identify guilds');
  authorize.searchParams.set('state', state);
  return Response.redirect(authorize.toString(), 302);
}

async function discordCallback(request, url, env, net) {
  const dc = discordConfig(env);
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';

  /* validar state (firma + frescura) y recuperar el destino de la app */
  let redirect = null;
  let stOk = false;
  /* sin clave no hay firma que comprobar (y HMAC con clave vacía lanza) */
  if (dc.sessionKey && state.includes('.')) {
    const [st, sig] = state.split('.');
    /* comparación en tiempo constante, igual que en /discord/verify */
    if (timingSafeEqual(sig, await hmac(dc.sessionKey, st))) {
      try {
        const p = fromB64url(st);
        if (typeof p.r === 'string' && Date.now() - p.t <= STATE_TTL) {
          redirect = safeRedirect(p.r);
          stOk = !!redirect;
        }
      } catch (e) {}
    }
  }
  if (!stOk) {
    /* sin state válido no hay destino confiable: página amable directa */
    return htmlPage('Ayudante Albion — ingreso', 'El enlace de ingreso venció o no es válido.',
      'Volvé a abrir <b>Ayudante Albion</b> y tocá «Ingresar con Discord» desde la app.');
  }

  if (!dc.ok) return backWith(redirect, 'config');
  /* el usuario tocó «Cancelar» en la pantalla de Discord */
  if (url.searchParams.get('error') === 'access_denied') return backWith(redirect, 'cancelado');
  if (!code) return backWith(redirect, 'discord');

  /* 1 · canjear el código por un token de usuario */
  let token;
  try {
    const body = new URLSearchParams({
      client_id: dc.clientId,
      client_secret: dc.secret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl(url),
    });
    const res = await net(DISCORD_API + '/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) return backWith(redirect, 'discord');
    token = data.access_token;
  } catch (e) {
    return backWith(redirect, 'discord');
  }

  /* 2 · quién es (identify) */
  let me;
  try {
    const res = await net(DISCORD_API + '/users/@me', {
      headers: { Authorization: 'Bearer ' + token },
    });
    me = await res.json().catch(() => null);
    if (!res.ok || !me || !me.id) return backWith(redirect, 'discord');
  } catch (e) {
    return backWith(redirect, 'discord');
  }

  /* 3 · ¿está en el servidor de Discord de SG?
     OAuth2 scope `guilds` permite listar los servidores con GET /users/@me/guilds?limit=200.
     Pagina con `after` si el usuario está en más de 200 servidores (hasta 2000). */
  let member = false;
  try {
    let after = '';
    let page = 0;
    while (page < 10) {
      page++;
      const query = '?limit=200' + (after ? '&after=' + encodeURIComponent(after) : '');
      const res = await net(DISCORD_API + '/users/@me/guilds' + query, {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!res.ok) return backWith(redirect, 'gremio');
      const list = await res.json().catch(() => null);
      if (!Array.isArray(list)) return backWith(redirect, 'gremio');
      if (list.some(g => g && g.id === dc.guildId)) {
        member = true;
        break;
      }
      if (list.length < 200) break;
      after = list[list.length - 1].id;
    }
  } catch (e) {
    return backWith(redirect, 'gremio');
  }

  /* 4 · sesión firmada → la app la guarda y muestra el candado abierto */
  const payload = b64url({
    u: { i: me.id, n: me.global_name || me.username || 'miembro', a: me.avatar || '' },
    m: member,
    t: Date.now(),
    e: Date.now() + SESSION_TTL,
  });
  const sess = payload + '.' + (await hmac(dc.sessionKey, payload));
  return Response.redirect(redirect + '#aa_session=' + encodeURIComponent(sess), 302);
}

/* Verifica una sesión emitida por el callback: firma HMAC con comparación
   en tiempo constante, estructura y vencimiento. Devuelve solo lo que la
   app necesita pintar; nunca un motivo detallado del rechazo. */
async function discordVerify(url, env) {
  const dc = discordConfig(env);
  const invalid = () => json({ valid: false }, 200);
  if (!dc.ok) return invalid();
  const raw = url.searchParams.get('s') || '';
  if (raw.length > 4096) return invalid();
  const dot = raw.indexOf('.');
  if (dot <= 0) return invalid();
  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[0-9a-f]{64}$/.test(sig)) return invalid();
  const expect = await hmac(dc.sessionKey, payload);
  if (!timingSafeEqual(sig, expect)) return invalid();
  let s;
  try { s = fromB64url(payload); } catch (e) { return invalid(); }
  if (!s || typeof s !== 'object' || !s.u || typeof s.u.i !== 'string') return invalid();
  if (typeof s.e !== 'number' || s.e < Date.now()) return invalid();
  return json({
    valid: true,
    member: s.m === true,
    user: { i: String(s.u.i), n: String(s.u.n || 'miembro').slice(0, 80), a: /^[a-z0-9_]{0,64}$/i.test(String(s.u.a || '')) ? String(s.u.a || '') : '' },
    e: s.e,
  });
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function backWith(redirect, errCode) {
  return Response.redirect(redirect + '#aa_error=' + errCode, 302);
}

/* ============================ firmas y base64 ============================ */

async function hmac(keyStr, dataStr) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(keyStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(dataStr));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* base64url de objetos JSON (unicode-safe vía TextEncoder) */
function b64url(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/* ============================ respuestas ============================ */

/* Reenvía la respuesta tal cual. El navegador ve no-store para que la
   app siempre traiga lo último al actualizar; la cache de borde (cf.
   cacheTtlByStatus) es la que descarga a los upstreams. */
async function forward(target, ttlByStatus, extraHeaders, net, origin = '*') {
  let res;
  try {
    res = await net(target, {
      cf: { cacheTtlByStatus: ttlByStatus },
      headers: extraHeaders || { 'User-Agent': 'ayudante-albion (proxy gremio Spetsnaz Grail)' },
    });
  } catch (e) {
    return plain('arriba sin respuesta', 502);
  }
  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', origin);
  if (origin !== '*') headers.set('Vary', 'Origin');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  const type = (res.headers.get('content-type') || '').includes('json')
    ? 'application/json; charset=utf-8'
    : 'text/plain; charset=utf-8';
  headers.set('Content-Type', type);
  /* 204/205/304 no admiten cuerpo: pasar res.body tal cual lanza un RangeError
     dentro del runtime y el navegador veía un 500 del Worker en lugar de la
     respuesta vacía del servicio (DecAPI lo devuelve cuando no hay canal). */
  const noBody = res.status === 204 || res.status === 205 || res.status === 304;
  return new Response(noBody ? null : res.body, { status: res.status, headers });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function plain(msg, status = 200) {
  return new Response(msg, {
    status,
    headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function htmlPage(title, head, body) {
  return new Response(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body{background:#0e1117;color:#d5dae4;font-family:"Inter","Segoe UI",system-ui,sans-serif;
    display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
  .card{max-width:420px;background:#141821;border:1px solid #252b3a;border-radius:12px;padding:32px;text-align:center}
  h1{font-size:1.15rem;margin:0 0 10px}p{color:#808697;font-size:.92rem;line-height:1.5;margin:0}
  b{color:#d5dae4}
</style></head><body><div class="card"><h1>${head}</h1><p>${body}</p></div></body></html>`, {
    headers: { ...CORS, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
