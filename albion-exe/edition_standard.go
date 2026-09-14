//go:build !tracker

// Edición estándar: exactamente la misma app que la web. No se compila nada
// del motor de captura, así que el binario no gana peso, ni permisos, ni
// dependencias de Npcap. `GET /api/tracker/status` responde que no está
// disponible y el frontend oculta las pestañas de tracking.
package main

import (
	"encoding/json"
	"io/fs"
	"net/http"
)

const editionName = "standard"

// appFiles no se usa en esta edición: la firma se comparte con la edición
// Tracker, que sí necesita leer la tabla de códigos embebida.
func registerEdition(mux *http.ServeMux, touch func(), appFiles fs.FS) {
	mux.HandleFunc("/api/tracker/status", func(w http.ResponseWriter, r *http.Request) {
		touch()
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"edition":   editionName,
			"available": false,
			"reason":    "Esta es la edición estándar. El tracking en vivo está en AyudanteAlbion-Tracker.exe.",
		})
	})
}
