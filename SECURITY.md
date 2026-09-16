# Política de seguridad — Ayudante Albion

Gracias por ayudar a que Ayudante Albion sea más seguro. 🛡️

## Versiones con soporte

Se aceptan reportes sobre:

- **La app web** publicada en `https://ayudantealbion.github.io/` (rama `main`,
  código en `albion-app/`).
- **La app de escritorio** `AyudanteAlbionDesktop.exe` (código en `desktop/`).

Los dos productos son independientes y se corrigen por separado.

Versiones viejas del ejecutable o código en ramas sin publicar se aceptan como
reportes informativos, pero se corrigen solo en la versión vigente. El
ejecutable clásico (`AyudanteAlbion.exe` / `AyudanteAlbion-Tracker.exe`, que
abría el navegador del sistema) fue retirado y ya no recibe correcciones.

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


