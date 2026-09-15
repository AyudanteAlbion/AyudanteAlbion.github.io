# Plan — App de escritorio independiente (Wails v2)

> **Objetivo:** convertir el ejecutable actual de Ayudante Albion en una **app
> de escritorio nativa e independiente del navegador**, con su propia ventana,
> similar a la app de *Analytics* (AO). Motor elegido: **Wails v2** (backend Go).
> Alcance de esta etapa: **plan detallado** (sin migrar todavía).
> Decisiones tomadas: **app unificada** (un solo binario, tracking on/off
> interno) · **solo Windows**.

---

## 1. Punto de partida (lo que ya existe)

Hoy el "ejecutable" **no es una app de escritorio real**: es un servidor Go que
embebe la web y abre el navegador del usuario.

```
albion-exe/
├── main.go                  Servidor HTTP local (127.0.0.1:3000) + proxies + openBrowser()
├── edition_standard.go      build !tracker  → /api/tracker/status = no disponible
├── edition_tracker.go       build tracker   → monta el motor de captura
├── go.mod                   module ayudante-albion (go 1.23.4, sin dependencias externas)
├── rsrc_windows_amd64.syso  ícono embebido (rsrc)
├── icon.ico
└── tracker/
    ├── server.go            Engine: API HTTP /api/tracker/* (SSE stream, start/stop, reset…)
    ├── source.go            Interfaz Source + Simulator + Fallback + Broken
    ├── live.go              LiveSource (captura real)
    ├── hub.go               Pub/sub de eventos → SSE
    ├── state.go             Estado de sesión (daño, fama, plata, loot, mapas)
    ├── codes.go             CodeStore (tabla photon_codes.json, recargable)
    ├── photon/              Parser Photon (protocol16)
    └── capture/             Npcap vía syscall (pcap_windows.go) + stub (pcap_other.go)
```

**Frontend** (`albion-app/`): HTML/CSS/JS puro. Puntos de acoplamiento clave
con el servidor local:

| Recurso | Uso en el frontend | Notas |
|---|---|---|
| `/alive` | `app.js:43` → `setInterval(fetch('/alive'), 3000)` | Heartbeat que mantiene vivo el proceso. **En una app nativa deja de ser necesario.** |
| `/api/tracker/*` | `js/tracker/client.js` (status, stream vía `EventSource`, start/stop/reset/codes/diagnostic) | El corazón del Tracker. |
| `/gameinfo/*` | `app.js:4224` (Perfil/killboard) | Proxy local; fallback al Worker de Cloudflare. |
| `/murderledger/*` | `app.js:6975` (batallas) | Proxy local; fallback al Worker. |
| `/twitch/uptime/*` | `app.js:5283` (estado EN VIVO) | Proxy local; fallback al Worker. |
| `WORKER_URL` | `app.js:5` | Fallback remoto cuando no hay proxy local. |
| `west.albion-online-data.com` | precios de mercado | Llamada directa (tiene CORS). |

**Conclusión:** todo el valor (proxies + tracker + parser Photon) ya está en Go.
Wails reutiliza ese backend casi tal cual; lo único que cambia es **cómo se
presenta**: en vez de `openBrowser()`, una ventana WebView2 nativa.

---

## 2. Por qué Wails v2 (y no otro motor)

| Motor | Reutiliza tu Go | Ventana nativa Win | Peso | Riesgo |
|---|---|---|---|---|
| **Wails v2** ✅ | **~100%** (proxy + tracker + Photon + frontend) | WebView2 | ~10–20 MB | Bajo |
| webview/webview | 100% pero cableado manual | WebView2 | ~8 MB | Medio |
| Tauri | Solo frontend; reescribir tracker/proxy en Rust | WebView2 | ~5–10 MB | Muy alto |
| Electron | Solo frontend; Go como sidecar aparte | Chromium | ~150+ MB | Alto |

Wails es el camino de menor fricción porque:

- Mantiene el módulo Go actual (`ayudante-albion`) y todo `tracker/`.
- Da una **ventana propia** (título, ícono, tamaño, sin barra de navegador).
- Sigue siendo **un solo `.exe`** con todo embebido, como ahora.
- Compila para Windows y usa el runtime **WebView2** (ya presente en Windows 10/11).

**Requisito nuevo:** WebView2 Runtime. Viene preinstalado en Windows 11 y en la
mayoría de Windows 10 actualizados; Wails puede además configurarse para
instalarlo automáticamente si falta (modo *download bootstrapper*).

---

## 3. Arquitectura propuesta

Wails no elimina el servidor HTTP interno: al contrario, **lo aprovechamos**.
El frontend seguirá hablando con `/api/...`, `/gameinfo/...`, etc., pero contra
un servidor que corre **dentro** del proceso de la app, servido a la WebView.

Dos modos de integración posibles; recomiendo el **A** por mínimo cambio:

### Opción A — WebView + servidor HTTP interno (recomendada)

```
┌─────────────────────────── Proceso .exe (Wails) ───────────────────────────┐
│                                                                             │
│  Ventana nativa (WebView2)                                                  │
│     │  carga  http://127.0.0.1:PUERTO/  (o AssetServer de Wails)            │
│     ▼                                                                        │
│  Frontend actual (albion-app/) — SIN cambios de rutas                       │
│     │  fetch('/gameinfo/…'), EventSource('/api/tracker/stream'), …          │
│     ▼                                                                        │
│  Router Go (el mux de hoy):                                                  │
│     • Proxies: /gameinfo /murderledger /twitch                              │
│     • Tracker: /api/tracker/*  (Engine + Source + Photon + Npcap)           │
│     • Estáticos: embed FS de albion-app/                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Ventaja:** el frontend no se toca (mismas rutas relativas). El `EventSource`
  del tracker sigue funcionando igual.
- Se reemplaza `openBrowser()` por el arranque de la ventana Wails apuntando al
  servidor interno (o se monta el mux como `AssetServer.Handler` de Wails, que
  evita incluso abrir un puerto TCP).

### Opción B — Bindings nativos de Wails (más "puro", más trabajo)

Exponer métodos Go directamente al JS (`window.go.main.App.StartTracker()`) y
eventos Wails (`EventsEmit`) en vez de SSE. Es más idiomático pero obliga a
**reescribir `js/tracker/client.js`** y las llamadas a proxies. Lo dejamos como
evolución futura, no para la primera versión.

**Decisión:** empezar con **Opción A** (servidor interno + AssetServer),
migrar selectivamente a bindings solo donde aporte (p. ej. abrir el diálogo
nativo de "ejecutar como administrador", bandeja del sistema, etc.).

---

## 4. Unificación de ediciones (decisión tomada)

Hoy hay dos binarios (`standard` / `tracker`) por build tags. La nueva app es
**un solo binario** donde el tracking es una capacidad interna:

- Compilar **siempre con el motor de captura incluido** (equivalente al build
  `-tags tracker` actual), pero:
  - El tracking **arranca apagado** (como hoy) y se activa desde la UI.
  - Si **Npcap no está instalado** → se usa el `Simulator`/`FallbackSource`
    existente y la UI explica cómo instalar Npcap. Esto ya está implementado en
    `edition_tracker.go` + `source.go`; se reaprovecha tal cual.
  - `/api/tracker/status` reporta `available`/`reason`/`source`, y el frontend
    ya sabe mostrar/ocultar la pestaña Sesión según eso.
- Se elimina la separación `edition_standard.go` vs `edition_tracker.go`; queda
  una única ruta de registro del motor.

**Peso/permisos:** incluir el motor no obliga a permisos extra en reposo. Npcap
y la captura solo se activan cuando el usuario enciende el tracking. La app se
puede correr sin admin; al activar captura, si hace falta elevación, la UI lo
indica (mensaje ya presente en `capture/pcap_windows.go`).

---

## 5. Estructura de carpetas propuesta

Nueva carpeta hermana para no romper el build actual mientras migramos:

```
desktop/                         (nuevo proyecto Wails)
├── wails.json                   Config del proyecto (nombre, autor, ícono, WebView2)
├── go.mod / go.sum              module ayudante-albion-desktop (o reusar el actual)
├── main.go                      Arranque Wails: options.App, ventana, AssetServer
├── app.go                       struct App (ciclo de vida, bindings mínimos)
├── build/windows/               Ícono, manifiesto, info de versión, NSIS opcional
├── internal/
│   ├── proxy/                   ← migrado desde albion-exe/main.go (gameinfo/ML/twitch)
│   └── tracker/                 ← MOVIDO tal cual desde albion-exe/tracker/
└── frontend/                    ← albion-app/ (se referencia o sincroniza en build)
```

- `tracker/` se mueve **sin cambios de lógica** (parser, Npcap, hub, state).
- Los handlers de proxy de `main.go` se extraen a `internal/proxy/`.
- El heartbeat `/alive` y el watchdog de 15 min **se eliminan** (una app nativa
  se cierra cuando el usuario cierra la ventana; Wails maneja el ciclo de vida).
  → quitar también el `setInterval(fetch('/alive'))` de `app.js:43` **solo en la
  build de escritorio** (o dejar un `/alive` no-op para compatibilidad web).

---

## 6. Cambios concretos por archivo

### Backend (Go)
1. **`desktop/main.go`** — nuevo. `wails.Run` con:
   - `Title: "Ayudante Albion"`, tamaño inicial (p. ej. 1280×800), mínimo, ícono.
   - `AssetServer.Handler = router` (el mux con estáticos + proxies + tracker).
   - `OnStartup`/`OnShutdown` para arrancar/parar limpio el Engine.
   - `Windows: { WebviewIsTransparent, WebviewUserDataPath, Theme, ... }`.
2. **`internal/proxy/proxy.go`** — extraer de `albion-exe/main.go`:
   `gameinfoRoutes`, `gameinfoParams`, handlers `/gameinfo /murderledger /twitch`,
   `browserUA`. Quitar `hostAllowed` DNS-rebinding si usamos AssetServer (no hay
   puerto público); mantenerlo si servimos por TCP local.
3. **`internal/tracker/`** — mover `albion-exe/tracker/` completo (imports pasan
   de `ayudante-albion/tracker` a `.../desktop/internal/tracker`).
4. **Unificar edición** — un único `registerEdition` (o `registerTracker`) que
   siempre monta el motor con `FallbackSource{Live, Simulator}`.

### Frontend (JS) — cambios mínimos
5. **`app.js:43`** — el heartbeat `/alive` se vuelve innecesario. Opciones:
   dejarlo (inofensivo si el servidor responde 204) o condicionarlo a
   `!window.runtime` (Wails inyecta `window.runtime`). Recomendado: detectar
   entorno de escritorio y desactivar keep-alive/anti-pausa.
6. **`js/core/*` y `app.js`** — sin cambios de rutas (todo relativo). Verificar
   que `EventSource('/api/tracker/stream')` funciona bajo el AssetServer de Wails
   (soporta streaming; si hubiera problema con SSE, caer a servidor TCP local
   127.0.0.1 — Opción A original).
7. **Detección de entorno** — añadir un flag `window.__AA_DESKTOP__ = true` para
   que la UI muestre "app de escritorio" y oculte avisos propios del navegador.

### Build / distribución
8. **`build.sh`** — nueva sección/objetivo para compilar con Wails
   (`wails build -platform windows/amd64 -webview2 download`). Mantener el build
   web actual intacto.
9. **Ícono y metadatos** — reusar `albion-exe/icon.ico`; Wails genera el `.syso`.
10. **Firma** — sigue sin firma (SmartScreen mostrará "editor desconocido");
    documentarlo en el LEEME nuevo. Firma de código (opcional/futuro).

---

## 7. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| WebView2 Runtime ausente | La app no abre | `wails build -webview2 download` (bootstrapper) o instrucción en LEEME |
| SSE (`EventSource`) bajo AssetServer | Tracker sin stream en vivo | Si falla, usar servidor TCP 127.0.0.1 interno (Opción A) o migrar a `EventsEmit` de Wails |
| Compilar Wails **desde Linux para Windows** | El build actual cross-compila desde Linux | Wails requiere toolchain nativa/CGO; probablemente **necesite build en Windows** (o Docker/GH Actions con runner Windows). **A validar temprano.** |
| Npcap/captura requiere admin | El usuario no ve datos reales | Ya cubierto: mensaje claro + FallbackSource con simulador |
| Duplicar frontend (web vs desktop) | Divergencia de código | Script de sync (como el `cp` actual en build.sh) o referenciar `albion-app/` directamente |

> ⚠️ **Punto a validar antes de codificar:** cómo se compilará el `.exe`. El
> pipeline actual cross-compila Go desde Linux sin CGO. Wails con WebView2
> suele necesitar build **en Windows** (o CI con runner Windows). Definir esto
> condiciona todo el flujo de release.

---

## 8. Plan de trabajo por fases

- **Fase 0 — Validación de build. ✅ RESUELTA.** Se compila en **GitHub Actions
  sobre `windows-latest`** (`.github/workflows/desktop.yml`). Wails necesita
  Windows (WebView2 + toolchain nativa), así que no se cross-compila desde Linux.
- **Fase 1 — Andamiaje. ✅ HECHA (esta etapa).** Proyecto Wails en `desktop/`:
  `main.go` (ventana + AssetServer), `app.go` (ciclo de vida), `router.go`
  (estáticos + proxies + tracker), `go.mod`, `wails.json`, ícono/manifest,
  `sync_frontend.sh` y el workflow de Windows. **Ya incluye Fases 2 y 3** en el
  andamiaje (ver abajo) porque el backend Go se reutilizó entero.
- **Fase 2 — Proxies. ✅ Incluida.** `/gameinfo /murderledger /twitch` extraídos
  a `desktop/internal/proxy/`. Falta validar Perfil y Batallas en la ventana real.
- **Fase 3 — Tracker unificado. ✅ Incluida.** `tracker/` movido a
  `desktop/internal/tracker/`, motor montado siempre (edición unificada) con
  `FallbackSource{Live, Simulator}`. Falta validar `EventSource` bajo el
  AssetServer (plan B: servidor TCP local o `EventsEmit`).
- **Fase 4 — Ciclo de vida. ✅ Base resuelta.** Heartbeat/watchdog eliminados
  del backend; `AAEnvironment` es la fuente única de `isDesktop` y capacidades.
  Wails no inicia `/alive`, Web Lock ni Wake Lock, y oculta el botón anti-pausa.
  Quedan como mejoras opcionales la bandeja del sistema y "abrir como admin".
- **Fase 5 — Build & release.** El workflow ya produce el `.exe` como artefacto.
  Pendiente: sumarlo al pipeline de release formal y LEEME/README actualizados.
- **Fase 6 — QA.** Probar sin Npcap (simulador), con Npcap (captura real),
  sin WebView2, precios de mercado, Perfil, alertas.

### Cómo probar el primer build

1. Hacer push de la rama (o abrir PR): el workflow **Build desktop app (Wails)**
   corre solo en `windows-latest`.
2. Descargar el artefacto `AyudanteAlbion-Desktop-<sha>` de la ejecución.
3. Ejecutar `AyudanteAlbion.exe` en Windows 10/11 x64. Debe abrir **una ventana
   propia** (no el navegador). Verificar: crafteo/flipping, Perfil (killboard),
   y la pestaña Sesión (simulador si no hay Npcap).

---

## 9. Lo que queda igual

- Toda la lógica de cálculo del frontend (`albion-app/`) intacta.
- El parser Photon, Npcap por syscall, hub/state del tracker.
- El sitio web público (`https://ayudantealbion.github.io`) y el Worker de
  Cloudflare siguen existiendo sin cambios; la app de escritorio es un cliente
  más de los mismos datos.

---

## 10. Decisión pendiente para vos

Antes de pasar a **Fase 1 (andamiaje)** necesito que definamos la **Fase 0**:
¿dónde compilamos el `.exe` de Wails? (Windows local / GitHub Actions / Docker).
Es lo único que bloquea el arranque del código.
