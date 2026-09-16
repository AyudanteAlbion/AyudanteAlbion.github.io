package main

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"

	"ayudante-albion-desktop/internal/proxy"
	"ayudante-albion-desktop/internal/tracker"
)

// frontendFS embebe la app completa (HTML, JS, CSS, íconos y datos). El
// contenido lo prepara desktop/sync_frontend.sh en tiempo de build: el código
// sale de desktop/ui/ (fork propio del escritorio) y los assets compartidos
// (data/, icons/, img/) de albion-app/. Así el .exe es autocontenido.
//
//go:embed all:frontend
var frontendFS embed.FS

// newRouter arma el handler HTTP que la WebView consume: estáticos de la app,
// los proxies (gameinfo / murderledger / twitch) y el motor del tracker.
//
// Devuelve también el *tracker.Engine para que el ciclo de vida de la ventana
// pueda detenerlo limpio al cerrar. A diferencia del ejecutable anterior, acá
// NO hay heartbeat /alive ni watchdog: la app se apaga cuando se cierra la
// ventana (lo maneja Wails), no cuando dejan de llegar latidos.
func newRouter() (http.Handler, *tracker.Engine) {
	sub, err := fs.Sub(frontendFS, "frontend")
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(sub))
	mux := http.NewServeMux()

	// Edición unificada: el motor del tracker siempre se compila y arranca
	// apagado. A capture failure is reported as such; demo data is available
	// only when the user explicitly selects the visually distinct demo provider.
	engine := buildTrackerEngine(sub)
	engine.Register(mux)

	// Proxies hacia servicios sin CORS, con la misma allowlist que el Worker.
	proxy.Register(mux, nil)

	// Estáticos de la app. Mismas reglas de caché que server.py: íconos 7 días,
	// resto sin caché.
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/icons/") {
			w.Header().Set("Cache-Control", "public, max-age=604800")
		} else {
			w.Header().Set("Cache-Control", "no-store")
		}
		fileServer.ServeHTTP(w, r)
	})

	// X-Content-Type-Options para que la WebView no adivine tipos de contenido.
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		mux.ServeHTTP(w, r)
	})

	return handler, engine
}

// buildTrackerEngine wires both real capture providers plus an explicit demo,
// using the embedded/reloadable validated Photon code table.
func buildTrackerEngine(appFiles fs.FS) *tracker.Engine {
	store := tracker.NewCodeStore(appFiles, tracker.DefaultPaths()...)
	if _, err := store.Load(); err != nil {
		// Sin tabla no hay traducción posible de los paquetes. Se registra la
		// edición igual para que la interfaz explique el problema en vez de
		// dejar una pestaña muerta.
		return tracker.NewEngine(tracker.BrokenSource{Reason: err.Error()}, store, nil)
	}

	// No silent fallback: selecting Npcap always means Npcap and selecting
	// Socket always means a Windows raw socket. Demo must be chosen explicitly.
	live := tracker.NewLiveSource(store)
	source := tracker.NewSelectableSource(live, tracker.NewSocketSource(store))
	return tracker.NewEngine(source, store, nil)
}
