# Re-deploy del Worker de Cloudflare

El Worker `ayudantealbion` está conectado al repo (Workers Builds): cada push a
`main` que toque `worker/` o `wrangler.toml` lo reconstruye y publica solo. Lo que
**no** viaja con el código son las variables/secretos; esas se cargan una vez en el
dashboard.

## Diagnóstico (2026-09-09)

`GET /discord/config` en producción respondía `{"configured":false}` y `/discord/login`
decía que faltaban `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` o `SG_DISCORD_GUILD_ID`.
El código del Worker y de la app estaban completos: el problema era de configuración.

Causa probable: Workers Builds despliega con `npx wrangler deploy`, y **sin `keep_vars`
en `wrangler.toml` cada deploy borra las variables de tipo Text del dashboard** (los
Secrets no se tocan). Si las variables se cargaron como Text, desaparecían con el
siguiente merge a `main`. Ahora `wrangler.toml` lleva `keep_vars = true` y declara
`SG_DISCORD_GUILD_ID` (es público). El resto se carga como **Secret**, una sola vez.

Desde ahora `/discord/config` devuelve además `missing: [...]` con los nombres de lo
que falta, para no tener que adivinar.

## Orden correcto (importante)

1. Configurar `AA_SESSION_KEY` en el Worker **antes** de mergear.
2. Mergear la rama a `main` → se despliegan Worker (Workers Builds) y web (GitHub Pages)
   a la vez.
3. Verificar.

Si se mergea sin la clave, la web sigue funcionando pero `GET /discord/config` responde
`configured: false`, el botón de Discord se oculta y quien ya tenía sesión la ve
como "no pudimos confirmar" hasta que la clave exista. No se rompe nada, pero el
Salón queda cerrado mientras tanto.

## 1 · Crear la clave de sesión

Generar 32 bytes aleatorios (64 caracteres hex). Cualquiera de estos sirve:

```bash
openssl rand -hex 32
# o, sin openssl:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# o en PowerShell:
-join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
```

Guardarla en el Worker:

Cloudflare Dashboard → **Workers & Pages** → `ayudantealbion` → **Settings** →
**Variables and Secrets** → **Add** →

- Type: **Secret**
- Variable name: `AA_SESSION_KEY`
- Value: la cadena generada

→ **Deploy** (Cloudflare aplica la variable con un redeploy del código actual; es normal).

Requisitos que el Worker comprueba: al menos 32 caracteres y **distinta** del
`DISCORD_CLIENT_SECRET`. Si no se cumplen, `/discord/login` responde 503 con un
mensaje que lo explica.

Mientras estás ahí, confirmar que existen las demás. Cargarlas todas como **Secret**
(así ningún deploy las borra):

| Variable | Tipo | De dónde sale |
|---|---|---|
| `DISCORD_CLIENT_ID` | Secret | Developer Portal → app → OAuth2 → Client ID |
| `DISCORD_CLIENT_SECRET` | Secret | Developer Portal → app → OAuth2 → Client Secret (Reset si no lo tenés) |
| `AA_SESSION_KEY` | Secret | `openssl rand -hex 32` |
| `SG_DISCORD_GUILD_ID` | (ya está en `wrangler.toml`) | `998772435048472628` |

Y en el Developer Portal de Discord, OAuth2 → Redirects debe tener exactamente:
`https://ayudantealbion.josemesina21.workers.dev/discord/callback`

> Efecto colateral esperado: al cambiar la clave de firma, las sesiones que la gente
> tenía guardadas dejan de validar. La app las descarta sola y muestra el botón de
> ingreso; con un clic en «Ingresar con Discord» vuelven a entrar. No hay que avisar
> nada especial, pero conviene saberlo.

## 2 · Mergear

```bash
gh pr create --base main --head arena/01a08770-ayudantealbion-github-io \
  --title "Seguridad: XSS, verificación de sesión, CSP y proxy acotado" \
  --body-file docs/deploy-worker.md
```

o desde GitHub. Al mergear:

- **Workers Builds** detecta el cambio en `worker/index.js` y publica. Se sigue en
  Dashboard → `ayudantealbion` → **Deployments** (tarda ~1 min).
- **GitHub Pages** publica la web por el workflow «Publicar en la web»
  (Actions del repo).

## 3 · Verificar

Desde cualquier terminal con internet (reemplazar `W` por la URL del Worker):

```bash
W=https://ayudantealbion.josemesina21.workers.dev

# a) el worker nuevo está arriba y configurado
curl -s $W/health                    # → ok
curl -s $W/discord/config            # → {"configured":true,"loginUrl":"...","missing":[]}
                                     #   si dice configured:false, `missing` nombra lo que falta

# b) la ruta nueva existe y rechaza basura
curl -s "$W/discord/verify?s=abc.def"    # → {"valid":false}

# c) el proxy quedó acotado
curl -s -o /dev/null -w "%{http_code}\n" "$W/gameinfo/battles"          # → 404
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://evil.example" \
  "$W/gameinfo/search?q=x"                                              # → 403
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://ayudantealbion.github.io" \
  "$W/gameinfo/search?q=x"                                              # → 200
```

En el navegador, en https://ayudantealbion.github.io (Ctrl+F5 para saltar caché):

1. Abrir DevTools → Console: **no** debe haber errores `Refused to ... Content Security Policy`.
   Si aparece uno, dice qué recurso bloqueó; se agrega ese origen a la `<meta>` CSP de `index.html`.
2. SG → Salón de miembros → «Ingresar con Discord» → autorizar → debe volver con el
   toast «Ingreso correcto» y el ranking cargado.
3. Recargar la página: la sesión debe seguir activa (se revalida contra `/discord/verify`).
4. Perfil: buscar un jugador; los íconos de equipo cargan (retry sin `onerror` inline).
5. Registro → Exportar CSV y Exportar respaldo: descargan normal.

## Si algo sale mal

- **`configured:false` después del deploy** → mirar `missing` en `/discord/config`.
  Si nombra `AA_SESSION_KEY` con aclaración, es más corta que 32 o igual al Client Secret.
  Si las variables «desaparecen» tras un merge: estaban como Text y el deploy las borró;
  recargarlas como Secret (con `keep_vars = true` ya no debería pasar).
- **Vuelve con `#aa_error=discord`** → el Redirect URI no coincide exactamente con el
  registrado en el Developer Portal, o el Client Secret está vencido/reseteado.
- **Vuelve con `#aa_error=cancelado`** → el usuario tocó «Cancelar» en Discord; no es error.
- **Botón de Discord no aparece** → mismo caso, o la web vieja está cacheada (Ctrl+F5).
- **«No pudimos confirmar la sesión»** → el Worker todavía no tiene `/discord/verify`
  (deploy en curso o fallido). Mirar Deployments en Cloudflare.
- **Ícono/imagen bloqueada por CSP** → agregar el host a `img-src` en `index.html`.
- **Volver atrás rápido** → Cloudflare Dashboard → `ayudantealbion` → Deployments →
  «Rollback» al deployment anterior. La web se revierte con `git revert` en `main`.
