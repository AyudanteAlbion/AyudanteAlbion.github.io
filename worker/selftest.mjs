// Selftest del sistema de acceso de miembros SG (worker + Discord OAuth)
// Correr con:  node worker/selftest.mjs
// No necesita red: las respuestas de Discord se simulan con fetchImpl.

import { createWorker } from './index.js';

const RESULTS = { ok: 0, err: 0 };
function check(cond, okMsg, errMsg) {
  if (cond) { RESULTS.ok++; console.log('  ✓', okMsg); }
  else { RESULTS.err++; console.log('  ✗', errMsg); }
}

/* ---------- helpers: HMAC y base64url igual que el worker ---------- */
async function hmac(keyStr, dataStr) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(keyStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(dataStr));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const b64url = obj => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = s => JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/')));

/* ---------- Discord simulado ---------- */
function discordMock({ member = true, tokenOk = true, meOk = true, guildStatus = null } = {}) {
  return async (url, init) => {
    url = String(url);
    if (url.includes('/oauth2/token')) {
      const body = String(init?.body || '');
      if (!tokenOk || !body.includes('code=good')) {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      check(body.includes('grant_type=authorization_code') && body.includes('client_secret'),
        'token: intercambio con authorization_code + client_secret',
        'token: faltan parámetros del intercambio → ' + body);
      return new Response(JSON.stringify({ access_token: 'MOCK_TOKEN', token_type: 'Bearer' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/users/@me/guilds/')) {
      const auth = init?.headers?.Authorization || '';
      check(auth === 'Bearer MOCK_TOKEN', 'gremio: consulta con el token del usuario', 'gremio: Authorization incorrecta → ' + auth);
      const status = guildStatus != null ? guildStatus : (member ? 200 : 404);
      return new Response(status === 200 ? JSON.stringify({ id: '999', name: 'Spetsnaz Grail' }) : '{"message":"Unknown Guild"}',
        { status, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/users/@me')) {
      if (!meOk) return new Response('{}', { status: 401 });
      return new Response(JSON.stringify({ id: '42', username: 'tester', global_name: 'Tester Global', avatar: 'abc123' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  };
}

const ENV = {
  DISCORD_CLIENT_ID: 'client-id-test',
  DISCORD_CLIENT_SECRET: 'secreto-test',
  SG_DISCORD_GUILD_ID: '999',
  AA_SESSION_KEY: 'clave-hmac-test',
};

console.log('Selftest del sistema de acceso SG (Discord OAuth)\n');

/* ============ 1 · sin configurar ============ */
console.log('— Worker sin configurar —');
const w0 = createWorker({});
check((await (await w0.fetch(new Request('http://w.test/health'))).text()) === 'ok', 'health responde ok', 'health no responde');
const cfg0 = await (await w0.fetch(new Request('http://w.test/discord/config'))).json();
check(cfg0.configured === false, 'discord/config: configured=false', 'discord/config mal sin configurar → ' + JSON.stringify(cfg0));
const login0 = await w0.fetch(new Request('http://w.test/discord/login?redirect=http%3A%2F%2Flocalhost%3A3000%2F'));
check(login0.status === 503, 'discord/login sin configurar → 503 con guía', 'discord/login sin configurar → status ' + login0.status);

/* ============ 2 · login: redirect a Discord ============ */
console.log('\n— /discord/login configurado —');
const w1 = createWorker(ENV);
const loginBad = await w1.fetch(new Request('http://w.test/discord/login?redirect=https%3A%2F%2Fevil.com%2Fapp'));
check(loginBad.status === 400, 'login: rechaza redirect de un origen ajeno (anti redirector abierto)', 'login: aceptó redirect ajeno → ' + loginBad.status);
const loginNoParam = await w1.fetch(new Request('http://w.test/discord/login'));
check(loginNoParam.status === 400, 'login: sin redirect → 400', 'login: sin redirect devolvió ' + loginNoParam.status);

const loginRes = await w1.fetch(new Request('http://w.test/discord/login?redirect=http%3A%2F%2Flocalhost%3A3457%2F'));
const loc = loginRes.headers.get('location') || '';
const locUrl = new URL(loc);
check(loginRes.status === 302 && locUrl.hostname === 'discord.com', 'login: 302 a discord.com/oauth2/authorize', 'login: Location raro → ' + loc.slice(0, 80));
check(locUrl.searchParams.get('client_id') === 'client-id-test', 'login: client_id correcto', 'login: client_id → ' + locUrl.searchParams.get('client_id'));
check((locUrl.searchParams.get('scope') || '').includes('identify') && (locUrl.searchParams.get('scope') || '').includes('guilds'),
  'login: scopes identify + guilds', 'login: scopes → ' + locUrl.searchParams.get('scope'));
check((locUrl.searchParams.get('redirect_uri') || '').endsWith('/discord/callback'),
  'login: redirect_uri apunta al callback del worker', 'login: redirect_uri → ' + locUrl.searchParams.get('redirect_uri'));
const state = locUrl.searchParams.get('state') || '';
check(state.includes('.'), 'login: state firmado (payload.firma)', 'login: state sin firma → ' + state);

/* ============ 3 · callback feliz: miembro de SG ============ */
console.log('\n— /discord/callback: usuario miembro —');
const w2 = createWorker(ENV, discordMock({ member: true }));
const cb1 = await w2.fetch(new Request('http://w.test/discord/callback?code=good&state=' + encodeURIComponent(state)));
const back1 = cb1.headers.get('location') || '';
check(cb1.status === 302 && back1.startsWith('http://localhost:3457/#aa_session='),
  'callback: 302 de vuelta a la app con #aa_session', 'callback: Location → ' + back1.slice(0, 80));
const token1 = decodeURIComponent(back1.split('#aa_session=')[1] || '');
const [pl1, sig1] = token1.split('.');
const sess1 = fromB64url(pl1);
check(sig1 === (await hmac('clave-hmac-test', pl1)), 'sesión: firma HMAC válida y verificable', 'sesión: firma no coincide');
check(sess1.m === true, 'sesión: miembro=true', 'sesión: m → ' + sess1.m);
check(sess1.u && sess1.u.i === '42' && sess1.u.n === 'Tester Global' && sess1.u.a === 'abc123',
  'sesión: usuario (id, nombre global, avatar)', 'sesión: usuario → ' + JSON.stringify(sess1.u));
check(typeof sess1.e === 'number' && sess1.e > Date.now() && sess1.e - Date.now() <= 31 * 24 * 3600e3,
  'sesión: vence en ~30 días', 'sesión: expiración rara → ' + sess1.e);

/* ============ 4 · callback: NO miembro ============ */
console.log('\n— /discord/callback: usuario NO miembro —');
const w3 = createWorker(ENV, discordMock({ member: false }));
const cb2 = await w3.fetch(new Request('http://w.test/discord/callback?code=good&state=' + encodeURIComponent(state)));
const back2 = cb2.headers.get('location') || '';
const sess2 = fromB64url(decodeURIComponent(back2.split('#aa_session=')[1] || '').split('.')[0]);
check(back2.includes('#aa_session=') && sess2.m === false, 'no-miembro: sesión con m=false (puede usar la app pública)', 'no-miembro: sesión → ' + JSON.stringify(sess2));

/* ============ 5 · errores ============ */
console.log('\n— Errores y validaciones —');
const w4 = createWorker(ENV, discordMock({ tokenOk: false }));
const cb3 = await w4.fetch(new Request('http://w.test/discord/callback?code=bad&state=' + encodeURIComponent(state)));
check((cb3.headers.get('location') || '').includes('#aa_error=discord'), 'código inválido → vuelve con #aa_error=discord', 'código inválido → ' + cb3.headers.get('location'));

const tampered = state.slice(0, -4) + 'beef';
const cb4 = await w2.fetch(new Request('http://w.test/discord/callback?code=good&state=' + encodeURIComponent(tampered)));
check(cb4.status === 200 && (cb4.headers.get('content-type') || '').includes('text/html'),
  'state alterado → página amable, no redirect', 'state alterado → status ' + cb4.status);

const expiredData = b64url({ r: 'http://localhost:3000/', t: Date.now() - 11 * 60e3 });
const expired = expiredData + '.' + (await hmac('clave-hmac-test', expiredData));
const cb5 = await w2.fetch(new Request('http://w.test/discord/callback?code=good&state=' + encodeURIComponent(expired)));
check(cb5.status === 200, 'state vencido (>10 min) → rechazado', 'state vencido aceptado → ' + cb5.status);

const cb6 = await w2.fetch(new Request('http://w.test/discord/callback?code=good'));
check(cb6.status === 200, 'callback sin state → rechazado', 'callback sin state → ' + cb6.status);

/* state bien firmado pero con redirect a un origen ajeno: no puede volver */
const evilData = b64url({ r: 'https://evil.com/app', t: Date.now() });
const evil = evilData + '.' + (await hmac('clave-hmac-test', evilData));
const cb7 = await w2.fetch(new Request('http://w.test/discord/callback?code=good&state=' + encodeURIComponent(evil)));
check(cb7.status === 200, 'state con redirect ajeno → bloqueado (anti redirector)', 'state con redirect ajeno devolvió ' + cb7.status);

/* guild endpoint caído (500) → error explícito, no un falso no-miembro */
const w5 = createWorker(ENV, discordMock({ guildStatus: 500 }));
const cb8 = await w5.fetch(new Request('http://w.test/discord/callback?code=good&state=' + encodeURIComponent(state)));
check((cb8.headers.get('location') || '').includes('#aa_error=gremio'), 'API de gremios caída → #aa_error=gremio (no falso negativo)', 'gremio caído → ' + cb8.headers.get('location'));

/* ============ 6 · config y rutas viejas ============ */
console.log('\n— Config y rutas previas —');
const w6 = createWorker(ENV);
const cfg1 = await (await w6.fetch(new Request('http://w.test/discord/config'))).json();
check(cfg1.configured === true && /\/discord\/login$/.test(cfg1.loginUrl || ''), 'discord/config: configured=true + loginUrl', 'discord/config → ' + JSON.stringify(cfg1));
const cfgNoSecret = await (await createWorker({ DISCORD_CLIENT_ID: 'x', SG_DISCORD_GUILD_ID: 'y' }).fetch(new Request('http://w.test/discord/config'))).json();
check(cfgNoSecret.configured === false, 'config: falta el secret → configured=false', 'config sin secret → ' + JSON.stringify(cfgNoSecret));
const r404 = await w6.fetch(new Request('http://w.test/no-existe'));
check(r404.status === 404, 'ruta desconocida → 404', 'ruta desconocida → ' + r404.status);
const rPost = await w6.fetch(new Request('http://w.test/health', { method: 'POST' }));
check(rPost.status === 405, 'POST → 405 (solo GET)', 'POST → ' + rPost.status);

/* Upstream que responde sin cuerpo (204/304): construir new Response(cuerpo,
   {status:204}) lanza RangeError en el runtime de Workers, así que el proxy
   tiene que nulear el cuerpo en esos statuses. */
const w7 = createWorker(ENV, async () => ({
  status: 204, headers: new Headers({ 'content-type': 'text/plain' }), body: 'no debería ir',
}));
try {
  const r204 = await w7.fetch(new Request('http://w.test/twitch/uptime/canal1'));
  check(r204.status === 204 && (await r204.text()) === '', 'upstream 204 → se reenvía sin cuerpo', 'upstream 204 → ' + r204.status);
} catch (e) { check(false, '', 'upstream 204 lanzó ' + e.message); }

/* gameinfo/twitch dependen de la red: tolerantes */
try {
  const res = await w6.fetch(new Request('http://w.test/gameinfo/search?q=x'));
  console.log('  ·', 'gameinfo proxy: status ' + res.status + ' (con red debería ser 200)');
} catch (e) { console.log('  ·', 'gameinfo proxy: sin red en este entorno, ok'); }

console.log(`\n${RESULTS.ok} OK · ${RESULTS.err} errores`);
process.exit(RESULTS.err ? 1 : 0);
