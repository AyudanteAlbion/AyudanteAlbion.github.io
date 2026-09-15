# Ayudante Albion — App de escritorio (Wails v2)

App de escritorio **nativa e independiente del navegador**. A diferencia del
ejecutable anterior (`albion-exe/`, que abría el navegador del sistema), esta
corre en su **propia ventana** (WebView2) con el mismo backend Go de siempre.

> **Estado:** andamiaje (Fase 1). El código está listo; la compilación real se
> hace en GitHub Actions sobre `windows-latest` (ver `.github/workflows/desktop.yml`).
> Wails requiere compilar **en Windows** (WebView2 + toolchain nativa), por eso
> no se cross-compila desde Linux como el ejecutable anterior.

## Arquitectura

```
Ventana nativa (WebView2)
   │  pide http://wails/…  →  AssetServer.Handler (router.go)
   ▼
Frontend (albion-app/, sincronizado en frontend/) — rutas relativas sin cambios
   │  fetch('/gameinfo/…'), EventSource('/api/tracker/stream'), fetch('/alive')…
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
Wails). El endpoint `/alive` se mantiene como no-op solo por compatibilidad con
el frontend actual.

## Estructura

```
desktop/
├── main.go            Arranque Wails (ventana + AssetServer)
├── app.go             Ciclo de vida (OnStartup / OnShutdown → para el tracker)
├── router.go          http.Handler: estáticos + proxies + tracker
├── go.mod             module ayudante-albion-desktop
├── wails.json         Config del proyecto Wails
├── sync_frontend.sh   Copia albion-app/ → frontend/ antes de compilar
├── build/
│   ├── appicon.png    Ícono de la app
│   └── windows/       icon.ico, manifest, info de versión
├── frontend/          Sincronizado desde albion-app/ (no versionado)
└── internal/
    ├── proxy/         Relays sin CORS (extraídos de albion-exe/main.go)
    └── tracker/       Motor del tracker (movido desde albion-exe/tracker/)
```

## Compilar localmente (en Windows)

Requiere Go 1.23+ y la CLI de Wails:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.10.1
./desktop/sync_frontend.sh          # pobla frontend/ desde albion-app/
cd desktop && go mod tidy && wails build -platform windows/amd64 -webview2 download
# → build/bin/AyudanteAlbion.exe
```

En CI esto lo hace `.github/workflows/desktop.yml` automáticamente.

## Fuente única del frontend

`albion-app/` sigue siendo la única fuente de la interfaz (la misma que usa la
web y el ejecutable anterior). `sync_frontend.sh` la copia a `frontend/` para
que `//go:embed` la incluya. No se edita `frontend/` a mano.

## Pendiente / a validar

- **SSE bajo AssetServer:** el tracker usa `EventSource('/api/tracker/stream')`.
  Si el streaming no funciona a través del AssetServer de Wails, el plan B es
  un servidor TCP local en `127.0.0.1` (como el ejecutable anterior) o migrar a
  `EventsEmit` de Wails. Validar en la primera compilación.
- **Detección de entorno de escritorio** en el frontend (desactivar keep-alive
  / anti-pausa del navegador). Ver `docs/PLAN_APP_ESCRITORIO.md`, Fase 4.
