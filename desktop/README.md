# Ayudante Albion — App de escritorio (Wails v2)

App de escritorio **nativa e independiente del navegador**: corre en su
**propia ventana** (WebView2) con un backend Go.

El artefacto es **`AyudanteAlbionDesktop.exe`**, un binario único.

> **Unificación:** antes se publicaban dos ejecutables (`AyudanteAlbion.exe` y
> `AyudanteAlbion-Tracker.exe`), construidos con build tags desde el ya
> retirado `albion-exe/`. Ahora hay **uno solo**, con el tracker siempre
> compilado y apagado por defecto, que se enciende desde la interfaz.

> **Independencia de la web:** esta app **no comparte código** con la app web.
> Su frontend vive en `desktop/ui/` (ver más abajo). Tocar `albion-app/` no
> afecta al `.exe`, y tocar `desktop/` no afecta a la web.

> La compilación real se hace en GitHub Actions sobre `windows-latest` (ver
> `.github/workflows/desktop.yml`). Wails requiere compilar **en Windows**
> (WebView2 + toolchain nativa), por eso no se cross-compila desde Linux.

## Arquitectura

```
Ventana nativa (WebView2)
   │  pide http://wails/…  →  AssetServer.Handler (router.go)
   ▼
Frontend (desktop/ui/ + assets, armado en frontend/) — rutas relativas
   │  fetch('/gameinfo/…'), EventSource('/api/tracker/stream')…
   ▼
Router Go (router.go):
   • Estáticos     → embed all:frontend
   • Proxies       → internal/proxy  (gameinfo / murderledger / twitch)
   • Tracker       → internal/tracker (Engine + Npcap + Photon, edición unificada)
```

Un **solo binario**, edición unificada: el motor del tracker siempre se compila
y el tracking se enciende desde la interfaz. Sin Npcap instalado, cae al
simulador (la UI se ve real con datos de ejemplo).

**Sin heartbeat ni watchdog:** la app se apaga al cerrar la ventana (lo maneja
Wails). `AAEnvironment` detecta el contenedor una sola vez, por lo que Wails no
crea el temporizador de `/alive` ni activa Web Lock/Wake Lock.

## Estructura

```
desktop/
├── main.go            Arranque Wails (ventana + AssetServer)
├── app.go             Ciclo de vida (OnStartup / OnShutdown → para el tracker)
├── router.go          http.Handler: estáticos + proxies + tracker
├── go.mod             module ayudante-albion-desktop
├── wails.json         Config del proyecto Wails
├── ui/                FRONTEND PROPIO (versionado) — fork de albion-app/
├── sync_frontend.sh   Arma frontend/ = ui/ + assets de albion-app/
├── build/
│   ├── appicon.png    Ícono de la app
│   └── windows/       icon.ico, manifest, info de versión
├── frontend/          GENERADO por sync_frontend.sh (no versionado)
└── internal/
    ├── proxy/         Relays sin CORS (gameinfo / murderledger / twitch)
    └── tracker/       Motor del tracker (Engine + Npcap + Photon)
```

## Compilar localmente (en Windows)

Requiere Go 1.23+ y la CLI de Wails:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.10.1
./desktop/sync_frontend.sh          # arma frontend/ (ui/ + assets)
cd desktop && go mod tidy && wails build -platform windows/amd64 -webview2 download
# → build/bin/AyudanteAlbionDesktop.exe
```

En CI esto lo hace `.github/workflows/desktop.yml` automáticamente.

## Frontend: qué es propio y qué es compartido

El frontend embebido se arma desde **dos orígenes distintos**:

| Contenido | Origen | ¿Versionado? | ¿Compartido con la web? |
|---|---|---|---|
| `index.html`, `app.js`, `styles.css`, `js/`, `css/` | `desktop/ui/` | **sí** | **no** — fork propio |
| `data/`, `icons/`, `img/` | `albion-app/` | no (se copian) | sí, en una sola dirección |

**El código es un fork.** `desktop/ui/` es propiedad exclusiva del escritorio:
se puede modificar libremente sin riesgo para la web. No hay sincronización
automática — si querés traer un arreglo hecho en la web, se porta a mano
(`diff -u albion-app/app.js desktop/ui/app.js`).

**Los assets se comparten.** `data/`, `icons/` e `img/` son íconos de ítems y
tablas de Albion: ~18 MB y más de 3.300 archivos sin lógica, que nunca divergen
entre los dos productos. Duplicarlos en git sería puro peso muerto, así que se
copian desde `albion-app/` al compilar. El flujo es de una sola dirección
(web → escritorio), por lo que el escritorio **nunca** puede romper la web.

`desktop/frontend/` es **generado**: no se versiona y no se edita a mano.

## Pendiente / a validar

- **SSE bajo AssetServer:** el tracker usa `EventSource('/api/tracker/stream')`.
  Si el streaming no funciona a través del AssetServer de Wails, el plan B es
  un servidor TCP local en `127.0.0.1` (como el ejecutable anterior) o migrar a
  `EventsEmit` de Wails. Validar en la primera compilación.
La detección central del entorno, la eliminación del heartbeat y la
inactivación del anti-pausa dentro de Wails quedaron resueltas en la Fase 4.
