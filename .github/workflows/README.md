# Workflows — revisión y estado

El repositorio tiene **tres productos independientes**, y los workflows están
organizados para que cada uno tenga su propio ciclo de vida:

| Producto | Código | Workflow |
|---|---|---|
| App web | `albion-app/` | `web.yml` |
| App de escritorio | `desktop/` | `desktop.yml` |
| Worker (proxy) | `worker/` | — (deploy manual con wrangler) |

**La web no se ve afectada por los cambios del escritorio, y viceversa.**
Ningún workflow compila los dos productos juntos, y sus disparadores no se
solapan.

## Workflows activos

### `web.yml` — App web
Publica `albion-app/` en GitHub Pages. Se dispara solo con cambios de la web.
No compila Go ni depende de `desktop/`.

### `desktop.yml` — App de escritorio
Compila `AyudanteAlbionDesktop.exe` (Wails v2 + WebView2) en `windows-latest` y
lo deja como **artefacto de la ejecución** (7 días). No publica releases.

Se dispara con `desktop/**` y con `albion-app/{data,icons,img}` — esos assets
compartidos se embeben en el `.exe`, así que un cambio ahí sí le llega. Los
cambios en el **código** de la web (`albion-app/app.js`, `js/`, …) **no** lo
disparan: el frontend del escritorio está forkeado en `desktop/ui/`.

### `validate.yml` — Calidad transversal
Corre `npm test` (sintaxis JS/Python, JSON/TOML, referencias locales, tabla
Photon y QA de fases) sobre todo el repo. No compila ni publica nada.

### `commit-messages.yml` — Convención de commits
Valida los mensajes de commit. Sin cambios.

### `main.yml` — Notificaciones a Discord
Avisa del changelog y de releases publicadas. Renombrado a «Notificaciones»
para que su nombre refleje lo que hace.

## Workflows eliminados

| Workflow | Por qué se eliminó |
|---|---|
| `test-desktop-releases.yml` | Compilaba y empaquetaba las **dos** ediciones (`AyudanteAlbion.exe` y `AyudanteAlbion-Tracker.exe`) desde `albion-exe/`. Al unificar en un solo binario, quedó totalmente obsoleto: duplicaba lo que hace `desktop.yml`. |
| `build.yml` | Compilaba las dos ediciones con `build.sh` (cross-compile desde Linux) y subía los assets de release. Tanto `albion-exe/` como `build.sh` fueron retirados. |
| `release.yml` | Publicaba la GitHub Release con los artefactos de `build.yml`, con notas que describían las dos ediciones. Sin `build.yml` no tenía de dónde tomar nada. |

`pages.yml` se renombró a `web.yml` para que el nombre diga qué producto
despliega.

## Distribución del escritorio

Hoy el `.exe` se descarga desde la pestaña **Actions** → ejecución de
*Escritorio* → artefacto `AyudanteAlbionDesktop-<sha>`, que incluye el binario,
`photon_codes.json`, `SHA256SUMS.txt` y `BUILD_INFO.txt`.

Para volver a publicar releases automáticas más adelante, hay que sumar un
workflow que dispare con tags y suba ese mismo artefacto.
