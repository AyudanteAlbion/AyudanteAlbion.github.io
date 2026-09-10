# Cloudflare Worker — configuración y re-deploy

El Worker `ayudantealbion` (`https://ayudantealbion.josemesina21.workers.dev`) es el
proxy de la app: killboard (gameinfo), badges de Twitch y OAuth de Discord del
Salón de miembros. Está conectado al repo por **Workers Builds**: cada push a
`main` que toque `worker/` o `wrangler.toml` lo reconstruye y publica solo.

Lo que **no** viaja con el código son las variables/secretos; esas se cargan una
vez en el dashboard.

## Estado actual

| Pieza | Estado |
|---|---|
| Worker en producción | `ayudantealbion.josemesina21.workers.dev` |
| Acceso Discord (Salón) | **Activo** desde 2026-09-09 (`/discord/config` → `configured:true`) |
| Mapa de Guerra (GvG) | Requiere re-deploy del código con rutas `guildmatches/*` y `events` |
| Web (GitHub Pages) | Se publica al mergear a `main` (workflow «Publicar en la web») |

## Checklist rápido (lo que tenés que tener en Cloudflare)

### A · Variables and Secrets

Dashboard → **Workers & Pages** → `ayudantealbion` → **Settings** →
**Variables and Secrets**.

Cargarlas **todas como Secret** (así ningún deploy las borra):

| Variable | Tipo | De dónde sale |
|---|---|---|
| `DISCORD_CLIENT_ID` | **Secret** | [Discord Developer Portal](https://discord.com/developers/applications) → tu app → OAuth2 → Client ID |
| `DISCORD_CLIENT_SECRET` | **Secret** | Misma pantalla → Client Secret (Reset si no lo tenés) |
| `AA_SESSION_KEY` | **Secret** | `openssl rand -hex 32` (≥32 chars, **distinta** del Client Secret) |
| `SG_DISCORD_GUILD_ID` | ya en `wrangler.toml` | `998772435048472628` (público; no hace falta en el dashboard) |

Generar la clave de sesión:

```bash
openssl rand -hex 32
# o:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Tras agregar/editar un Secret, Cloudflare hace un redeploy del código actual
(es normal). Al **cambiar** `AA_SESSION_KEY`, las sesiones guardadas dejan de
validar: la gente vuelve a tocar «Ingresar con Discord» y listo.

### B · Discord Developer Portal

En la app de Discord → **OAuth2** → **Redirects**, exactamente:

```
https://ayudantealbion.josemesina21.workers.dev/discord/callback
```

No hace falta bot ni scopes extra: la app usa `identify` + `guilds`.

### C · Workers Builds (conexión al repo)

Dashboard → **Workers & Pages** → `ayudantealbion` → **Settings** → **Build**:

- Repo: `AyudanteAlbion/AyudanteAlbion.github.io`
- Branch de producción: `main`
- Build command: el que Cloudflare/Workers Builds usa por defecto con `wrangler.toml`
  en la raíz (`npx wrangler deploy`)
- `wrangler.toml` en la raíz declara `name`, `main = "worker/index.js"`,
  `keep_vars = true` y `SG_DISCORD_GUILD_ID`

`keep_vars = true` evita que cada deploy borre variables de tipo Text del
dashboard. Aun así, **preferí Secrets** para Client ID / Secret / Session Key.

### D · Redeploy del Mapa de Guerra (este cambio)

El Mapa de Guerra necesita que el Worker permita:

| Ruta | Para qué |
|---|---|
| `GET /gameinfo/guildmatches/past` | Historial GvG → dueños de territorios |
| `GET /gameinfo/guildmatches/next` | Ataques / defensas próximos |
| `GET /gameinfo/guildmatches/top` | GvG destacados |
| `GET /gameinfo/events?guildId=…` | Kills del gremio y rivales |
| `GET /gameinfo/battles` | Batallas (opcional) |

`/guilds/:id/territories` **no existe** en el killboard y el Worker sigue
respondiendo 404 a propósito.

**Cómo publicarlo:**

1. Mergear a `main` la rama con los cambios de `worker/index.js` (y la app).
2. Esperar ~1 min: **Workers Builds** publica solo (Deployments en el dashboard).
3. GitHub Pages publica la web en paralelo.
4. Verificar con el bloque de curls de abajo.

Si Workers Builds no está conectado o falló, deploy manual desde tu máquina
(con sesión de Cloudflare ya hecha una vez con `npx wrangler login`):

```bash
# desde la raíz del repo, en main con los cambios mergeados
npx wrangler deploy
```

No hace falta tocar variables: solo se actualiza el código del proxy.

## Orden correcto al sumar features del Worker

1. Confirmar Secrets en el dashboard (A).
2. Mergear a `main` → Workers Builds + GitHub Pages.
3. Verificar (sección siguiente).

Si se mergea sin Secrets, la web sigue y el Salón muestra «configuración
pendiente»; no se rompe nada.

## Verificar

Desde cualquier terminal con internet:

```bash
W=https://ayudantealbion.josemesina21.workers.dev

# 1 · vivo y Discord OK
curl -s $W/health
# → ok

curl -s $W/discord/config
# → {"configured":true,"loginUrl":"...","missing":[]}
#    si configured:false, "missing" nombra lo que falta (nunca valores)

# 2 · sesión basura rechazada
curl -s "$W/discord/verify?s=abc.def"
# → {"valid":false}

# 3 · Mapa de Guerra: rutas nuevas abiertas
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://ayudantealbion.github.io" \
  "$W/gameinfo/guildmatches/past?limit=1&offset=0"
# → 200 (o 502 si el killboard de Albion está caído; no 404)

curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://ayudantealbion.github.io" \
  "$W/gameinfo/guildmatches/next?limit=1"
# → 200 (o 502)

curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://ayudantealbion.github.io" \
  "$W/gameinfo/events?limit=1&offset=0"
# → 200 (o 502)

# 4 · endpoint inexistente sigue bloqueado
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://ayudantealbion.github.io" \
  "$W/gameinfo/guilds/x/territories"
# → 404

# 5 · anti proxy abierto
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://evil.example" \
  "$W/gameinfo/search?q=x"
# → 403

curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://ayudantealbion.github.io" \
  "$W/gameinfo/search?q=x"
# → 200 (o 502 del killboard)
```

En el navegador (https://ayudantealbion.github.io, Ctrl+F5):

1. DevTools → Console: sin errores de Content Security Policy.
2. **SG → Salón de miembros** → Ingresar con Discord → ranking OK.
3. Dentro del Salón → pestaña **Mapa de Guerra** → «Actualizar»:
   - Si hay GvG recientes de SG, aparecen territorios / próximos / rivales.
   - Si el Worker viejo sigue arriba, las peticiones a `guildmatches` fallan y
     el mapa queda vacío o con error: mirar la pestaña Network.
4. Recargar: la sesión Discord sigue activa (`/discord/verify`).

## Si algo sale mal

| Síntoma | Qué mirar |
|---|---|
| `configured:false` | `missing` en `/discord/config`. Secrets faltantes o `AA_SESSION_KEY` &lt; 32 / igual al Client Secret. Variables Text borradas por un deploy viejo → recargarlas como **Secret**. |
| `#aa_error=discord` | Redirect URI no coincide exactamente, o Client Secret reseteado. |
| `#aa_error=cancelado` | El usuario tocó Cancelar en Discord (no es fallo). |
| `#aa_error=gremio` | Discord no respondió la lista de servidores; reintentar. |
| Botón Discord no aparece | Config inactiva o caché (Ctrl+F5). |
| «No pudimos confirmar la sesión» | Deploy en curso o `/discord/verify` caído → Deployments. |
| Mapa de Guerra vacío / 404 en Network a `guildmatches` | Worker **sin** el código nuevo. Merge a `main` o `npx wrangler deploy`. |
| Mapa con error del killboard (502) | Albion/gameinfo saturado; «Actualizar» en unos segundos. |
| Rollback | Dashboard → `ayudantealbion` → **Deployments** → Rollback. Web: `git revert` en `main`. |

## Diagnóstico histórico (2026-09-09)

`GET /discord/config` respondía `configured:false` porque faltaba
`DISCORD_CLIENT_ID`: estaba como Text y un `wrangler deploy` de Workers Builds
lo borró. Se recargó como **Secret** y se agregó `keep_vars = true` +
`SG_DISCORD_GUILD_ID` en `wrangler.toml`.

## Pruebas locales (sin tocar Cloudflare)

```bash
node worker/selftest.mjs           # OAuth + verify + allowlist del proxy (sin red)
cd albion-app && python3 server.py # http://127.0.0.1:3000 — proxy gameinfo abierto + Discord simulado
cd albion-app && node qa-test.js   # QA completa (requiere jsdom)
```

`server.py` no usa la allowlist del Worker: en local el Mapa de Guerra ya habla
directo con el killboard. Cloudflare solo hace falta para la web pública y el
ejecutable cuando no hay server local.
