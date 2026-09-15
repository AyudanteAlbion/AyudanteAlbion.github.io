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
// contenido se sincroniza desde albion-app/ en tiempo de build (ver build.sh /
// el workflow). Así el .exe es autocontenido igual que el ejecutable anterior.
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

	// Edición unificada: el motor del tracker SIEMPRE se compila y se monta.
	// El tracking arranca apagado y se enciende desde la UI. Si Npcap no está
	// instalado, se usa el simulador (FallbackSource): la interfaz se ve real
	// con datos de ejemplo y, en cuanto Npcap aparece, el siguiente arranque
	// captura de verdad.
	engine := buildTrackerEngine(sub)
	engine.Register(mux)

	// /alive se mantiene como no-op por compatibilidad con el frontend actual
	// (app.js hace un ping cada 3 s). En la app de escritorio no apaga ni
	// mantiene nada: responder 204 evita ruido de errores en la consola.
	mux.HandleFunc("/alive", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

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

// buildTrackerEngine arma el motor con la fuente de captura real y respaldo al
// simulador, tomando la tabla de códigos embebida (y las externas junto al
// .exe / en la carpeta del usuario, que tienen prioridad).
func buildTrackerEngine(appFiles fs.FS) *tracker.Engine {
	store := tracker.NewCodeStore(appFiles, tracker.DefaultPaths()...)
	if _, err := store.Load(); err != nil {
		// Sin tabla no hay traducción posible de los paquetes. Se registra la
		// edición igual para que la interfaz explique el problema en vez de
		// dejar una pestaña muerta.
		return tracker.NewEngine(tracker.BrokenSource{Reason: err.Error()}, store, nil)
	}

	// Npcap disponible → captura real. Si no, el simulador: la interfaz sigue
	// siendo usable y se ve exactamente cómo va a funcionar una vez instalado.
	var source tracker.Source = tracker.NewLiveSource(store)
	if ok, _ := source.Available(); !ok {
		source = tracker.FallbackSource{
			Primary:  source,
			Fallback: tracker.Simulator{},
		}
	}

	return tracker.NewEngine(source, store, nil)
}
