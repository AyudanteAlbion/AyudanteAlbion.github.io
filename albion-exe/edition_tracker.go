//go:build tracker

// Edición Tracker: la misma app más el motor de estadísticas en vivo.
// Se compila con `go build -tags tracker`.
package main

import (
	"io/fs"
	"net/http"

	"ayudante-albion/tracker"
)

const editionName = "tracker"

// registerEdition monta el motor de captura sobre el mux de la app.
//
// `appFiles` es el sistema de archivos embebido (la carpeta app/), de donde
// sale la copia de fábrica de la tabla de códigos Photon. Si el usuario deja
// un photon_codes.json junto al .exe, ese tiene prioridad: así se arregla el
// tracker después de un patch de Albion sin recompilar nada.
func registerEdition(mux *http.ServeMux, touch func(), appFiles fs.FS) {
	store := tracker.NewCodeStore(appFiles, tracker.DefaultPaths()...)
	if _, err := store.Load(); err != nil {
		// Sin tabla no hay traducción posible de los paquetes. Se registra la
		// edición igual para que la interfaz explique el problema en vez de
		// dejar una pestaña muerta.
		tracker.NewEngine(tracker.BrokenSource{Reason: err.Error()}, store, touch).Register(mux)
		return
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

	tracker.NewEngine(source, store, touch).Register(mux)
}
