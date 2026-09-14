//go:build tracker

// Edición Tracker: la misma app más el motor de estadísticas en vivo.
// Se compila con `go build -tags tracker`.
package main

import (
	"net/http"

	"ayudante-albion/tracker"
)

const editionName = "tracker"

func registerEdition(mux *http.ServeMux, touch func()) {
	// Por ahora la fuente es el simulador: produce una sesión verosímil sin
	// tocar la red, lo que permite terminar y probar toda la interfaz. La
	// captura real de Photon implementa la misma interfaz `tracker.Source`
	// y se enchufa acá sin cambiar nada más.
	engine := tracker.NewEngine(tracker.Simulator{}, touch)
	engine.Register(mux)
}
