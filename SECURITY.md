# Política de seguridad — Ayudante Albion

Gracias por ayudar a que Ayudante Albion sea más seguro. 🛡️

## Versiones con soporte

Se aceptan reportes sobre:

- **La web** publicada en `https://ayudantealbion.github.io/` (rama `main`).
- **El Worker de Cloudflare** `ayudantealbion.josemesina21.workers.dev` (código en `worker/`).
- **El ejecutable** `AyudanteAlbion.exe` de los releases publicados (código en `albion-exe/`).

Versiones viejas del ejecutable o código en ramas sin publicar se aceptan como
reportes informativos, pero se corrigen solo en la versión vigente.

## Cómo reportar

**No abras un issue público para vulnerabilidades.**

Usá el **reporte privado de vulnerabilidades de GitHub**:
pestaña **Security** del repositorio → **Report a vulnerability**.
(Si no está habilitada, escribí por el canal privado de moderators del Discord de SG.)

Incluí, si podés:

1. Descripción del problema y tipo (XSS, inyección, acceso no autorizado, etc.).
2. Pasos exactos para reproducirlo (URLs, payloads, archivos).
3. Impacto que imaginás (qué datos o usuarios quedarían expuestos).
4. Evidencia: capturas, videos o código de prueba.

## Qué esperamos de vos

- Que no accedas ni modifiques datos que no sean tuyos.
- Que no ejecutes ataques de denegación de servicio, spam ni ingeniería social.
- Que uses solo cuentas de prueba propias (podés crearte un Discord de prueba
  para probar el flujo OAuth: el Client Secret nunca viaja al cliente).
- Que nos des tiempo razonable antes de publicar detalles.

## Qué te ofrecemos

- **Acuse de recibo:** dentro de 72 horas.
- **Evaluación y plan de fix:** dentro de 7 días.
- **Crédito público** (si querés) en las notas del release que corrija el problema.

## Alcance (exclusiones)

Fuera de alcance:

- Servicios de terceros: `albiononline.com`, `gameinfo.albiononline.com`,
  `west.albion-online-data.com`, `decapi.me`, `albiononline2d.com`,
  `cdn.discordapp.com`, `render.albiononline.com`. Reportalos a sus operadores.
- El hosting `github.io` / `workers.dev` en sí (infraestructura de GitHub y
  Cloudflare): reportalo a sus programas de bug bounty.
- Ataques volumétricos (DoS/DDoS), spam o phishing activo contra usuarios reales.
- Contenido generado por usuarios de terceros que la app solo muestra
  (por ejemplo, nombres del killboard público de Albion Online).

## Notas de arquitectura relevantes

- **`server.py` es solo desarrollo**: escucha en `127.0.0.1` y su simulador de
  Discord emite tokens **sin firma real**. Nunca exponerlo a la red ni usarlo
  como servidor productivo.
- El **ejecutable** corre un servidor local en `127.0.0.1` que valida el
  header `Host` (mitigación anti DNS rebinding) y se apaga solo tras 15 minutos
  sin latidos.
- La **sesión SG** es un token firmado con HMAC que la app siempre revalida con
  el Worker (`/discord/verify`); dura 7 días y los secretos viven solo en el
  Worker de Cloudflare.
