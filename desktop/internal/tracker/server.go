package tracker

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"
)

// Engine ata fuente, estado y hub, y publica la API HTTP del tracker.
type Engine struct {
	hub    *Hub
	state  *State
	source Source
	codes  *CodeStore
	store  *sessionStore

	mu        sync.Mutex
	cancel    context.CancelFunc
	runID     uint64
	lastError string
	// touch renueva el latido de vida del proceso: mientras una pestaña
	// escucha el stream, el ejecutable no debe apagarse solo.
	touch func()
}

// NewEngine crea el motor con la fuente indicada. `codes` puede ser nil
// cuando la fuente no necesita tabla (el simulador, por ejemplo).
func NewEngine(src Source, codes *CodeStore, touch func()) *Engine {
	if touch == nil {
		touch = func() {}
	}
	return &Engine{hub: NewHub(), state: NewState(), source: src, codes: codes, store: newSessionStore(), touch: touch}
}

func (e *Engine) runStatus() (bool, string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.cancel != nil, e.lastError
}

func (e *Engine) running() bool {
	running, _ := e.runStatus()
	return running
}

// Start arranca la captura si no estaba corriendo. Source.Run lives in its own
// goroutine, but a normal return (for example a closed raw socket) must clear
// the running state and reach the UI rather than leaving "capturing" stuck on.
func (e *Engine) Start() error {
	e.mu.Lock()
	if e.cancel != nil {
		e.mu.Unlock()
		return nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	e.cancel = cancel
	e.runID++
	runID := e.runID
	e.lastError = ""
	provider := e.source.Name()
	if configured, ok := e.source.(ProviderConfigurable); ok {
		provider = configured.Provider()
	}
	e.mu.Unlock()

	e.state.PrepareCapture(provider)
	e.hub.Publish(NewEvent("status", e.state.Snapshot()))
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_ = e.store.Save(e.state.Snapshot())
			}
		}
	}()
	go func() {
		e.finishRun(runID, e.source.Run(ctx, e.state, e.hub))
	}()
	return nil
}

func (e *Engine) finishRun(runID uint64, err error) {
	e.mu.Lock()
	if runID != e.runID {
		e.mu.Unlock()
		return // a stopped/restarted source must not overwrite the new run state
	}
	e.cancel = nil
	if err != nil && !errors.Is(err, context.Canceled) {
		e.lastError = err.Error()
	}
	e.mu.Unlock()

	_ = e.store.Save(e.state.Snapshot())
	if err != nil && !errors.Is(err, context.Canceled) {
		e.state.CaptureFailed(err.Error())
		e.hub.Publish(NewEvent("warning", map[string]any{"message": "La captura se detuvo: " + err.Error()}))
	} else {
		e.state.StopCapture()
	}
	e.hub.Publish(NewEvent("status", e.state.Snapshot()))
}

// Stop detiene la captura.
func (e *Engine) Stop() {
	e.mu.Lock()
	if e.cancel != nil {
		e.cancel()
		e.cancel = nil
	}
	// Invalidate the goroutine being stopped, so a late return cannot clear a
	// source that a subsequent Start has already installed.
	e.runID++
	e.lastError = ""
	e.mu.Unlock()
	_ = e.store.Save(e.state.Snapshot())
	e.state.StopCapture()
	e.hub.Publish(NewEvent("status", e.state.Snapshot()))
}

func writeJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}

// Register cuelga las rutas del tracker en el mux que ya usa la app.
func (e *Engine) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/tracker/status", func(w http.ResponseWriter, r *http.Request) {
		e.touch()
		ok, reason := e.source.Available()
		running, runError := e.runStatus()
		snapshot := e.state.Snapshot()
		body := map[string]any{
			"edition":           "tracker",
			"available":         ok,
			"reason":            reason,
			"source":            e.source.Name(),
			"trackingCharacter": e.state.TrackingCharacter(),
			"capturing":         running,
			"capture":           snapshot.Capture,
			"identityValid":     snapshot.Identity.Valid,
			"filterMatched":     snapshot.Identity.FilterMatched,
			"listeners":         e.hub.Subscribers(),
		}
		if runError != "" {
			body["runError"] = runError
		}
		if e.codes != nil {
			if codes, warn := e.codes.Current(); codes != nil {
				body["codes"] = codes.Info()
				if warn != "" {
					body["codesWarning"] = warn
				}
			}
		}
		writeJSON(w, http.StatusOK, body)
	})

	// Recarga la tabla de códigos desde disco sin reiniciar la app. Es lo que
	// permite arreglar el tracker después de un patch de Albion editando un
	// archivo de texto: no hace falta recompilar ni volver a descargar nada.
	mux.HandleFunc("/api/tracker/codes/reload", func(w http.ResponseWriter, r *http.Request) {
		e.touch()
		if r.Method != http.MethodPost {
			http.Error(w, "método no permitido", http.StatusMethodNotAllowed)
			return
		}
		if e.codes == nil {
			writeJSON(w, http.StatusConflict, map[string]any{
				"ok": false, "reason": "esta fuente no usa tabla de códigos"})
			return
		}
		codes, err := e.codes.Load()
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"ok": false, "reason": err.Error()})
			return
		}
		wasRunning := e.running()
		if wasRunning {
			// La fuente toma la tabla al arrancar: reiniciarla es lo que hace
			// efectivo el cambio sin cerrar la aplicación.
			e.Stop()
			_ = e.Start()
		}
		_, warn := e.codes.Current()
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": true, "codes": codes.Info(), "warning": warn, "restarted": wasRunning,
		})
	})

	// Modo diagnóstico: lista los códigos de evento que están llegando y con
	// qué frecuencia, separando los que la tabla reconoce de los que no. Es la
	// herramienta para actualizar photon_codes.json después de un patch.
	mux.HandleFunc("/api/tracker/diagnostic", func(w http.ResponseWriter, r *http.Request) {
		e.touch()
		diag, ok := e.source.(Diagnosable)
		if !ok {
			writeJSON(w, http.StatusConflict, map[string]any{
				"enabled": false, "reason": "esta fuente no expone diagnóstico"})
			return
		}
		if r.Method == http.MethodPost {
			diag.SetDiagnostic(r.URL.Query().Get("on") != "0")
		}
		writeJSON(w, http.StatusOK, diag.Diagnostic())
	})

	mux.HandleFunc("/api/tracker/devices", func(w http.ResponseWriter, r *http.Request) {
		e.touch()
		configurable, ok := e.source.(DeviceConfigurable)
		if !ok {
			writeJSON(w, http.StatusOK, map[string]any{"devices": []any{}})
			return
		}
		devices, err := configurable.Devices()
		if err != nil {
			writeJSON(w, http.StatusConflict, map[string]any{"devices": []any{}, "reason": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"devices": devices})
	})

	// Aplica el proveedor y el adaptador elegidos y reinicia la captura. Socket
	// valida al arrancar que Windows haya concedido permisos de administrador.
	mux.HandleFunc("/api/tracker/restart", func(w http.ResponseWriter, r *http.Request) {
		e.touch()
		if r.Method != http.MethodPost {
			http.Error(w, "método no permitido", http.StatusMethodNotAllowed)
			return
		}
		if configurable, ok := e.source.(ProviderConfigurable); ok {
			if err := configurable.SetProvider(r.URL.Query().Get("provider")); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "reason": err.Error()})
				return
			}
		}
		if configurable, ok := e.source.(DeviceConfigurable); ok {
			configurable.SetDevice(r.URL.Query().Get("adapter"))
		}
		e.state.SetTrackingCharacter(r.URL.Query().Get("character"))
		if ok, reason := e.source.Available(); !ok {
			writeJSON(w, http.StatusConflict, map[string]any{"ok": false, "reason": reason})
			return
		}
		e.Stop()
		if err := e.Start(); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "reason": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "capturing": true, "source": e.source.Name()})
	})

	mux.HandleFunc("/api/tracker/start", func(w http.ResponseWriter, r *http.Request) {
		e.touch()
		if r.Method != http.MethodPost {
			http.Error(w, "método no permitido", http.StatusMethodNotAllowed)
			return
		}
		if ok, reason := e.source.Available(); !ok {
			writeJSON(w, http.StatusConflict, map[string]any{"ok": false, "reason": reason})
			return
		}
		_ = e.Start()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "capturing": true})
	})

	mux.HandleFunc("/api/tracker/stop", func(w http.ResponseWriter, r *http.Request) {
		e.touch()
		if r.Method != http.MethodPost {
			http.Error(w, "método no permitido", http.StatusMethodNotAllowed)
			return
		}
		e.Stop()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "capturing": false})
	})

	// Fuerza una nueva detección del personaje. Se limpia solo la identidad
	// (no las estadísticas de la sesión) y se reinicia/activa la captura para
	// que el próximo Join de Albion vuelva a fijarla.
	mux.HandleFunc("/api/tracker/character/refresh", func(w http.ResponseWriter, r *http.Request) {
		e.touch()
		if r.Method != http.MethodPost {
			http.Error(w, "método no permitido", http.StatusMethodNotAllowed)
			return
		}
		if ok, reason := e.source.Available(); !ok {
			writeJSON(w, http.StatusConflict, map[string]any{"ok": false, "reason": reason})
			return
		}
		wasRunning := e.running()
		if wasRunning {
			e.Stop()
		}
		e.state.ClearCharacter()
		if err := e.Start(); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "reason": err.Error()})
			return
		}
		snap := e.state.Snapshot()
		e.hub.Publish(NewEvent("status", snap))
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": true, "capturing": true, "restarted": wasRunning, "snapshot": snap,
		})
	})

	mux.HandleFunc("/api/tracker/reset", func(w http.ResponseWriter, r *http.Request) {
		e.touch()
		if r.Method != http.MethodPost {
			http.Error(w, "método no permitido", http.StatusMethodNotAllowed)
			return
		}
		_ = e.store.Save(e.state.Snapshot())
		e.state.Reset()
		snap := e.state.Snapshot()
		e.hub.Publish(NewEvent("snapshot", snap))
		writeJSON(w, http.StatusOK, snap)
	})

	mux.HandleFunc("/api/tracker/session", func(w http.ResponseWriter, r *http.Request) {
		e.touch()
		writeJSON(w, http.StatusOK, e.state.Snapshot())
	})

	mux.HandleFunc("/api/tracker/stream", e.stream)
}

// stream publica los eventos por Server-Sent Events.
func (e *Engine) stream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming no soportado", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	events, unsubscribe := e.hub.Subscribe()
	defer unsubscribe()

	// Primer mensaje: la foto completa, para que la pestaña dibuje al toque
	// sin esperar al próximo evento.
	e.writeEvent(w, flusher, NewEvent("snapshot", e.state.Snapshot()))

	// Mientras el stream vive, hay una pestaña abierta: renovar el latido.
	keepalive := time.NewTicker(10 * time.Second)
	defer keepalive.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case ev, open := <-events:
			if !open {
				return
			}
			e.writeEvent(w, flusher, ev)
		case <-keepalive.C:
			e.touch()
			// Comentario SSE: mantiene viva la conexión sin ensuciar el flujo.
			if _, err := w.Write([]byte(": keepalive\n\n")); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (e *Engine) writeEvent(w http.ResponseWriter, flusher http.Flusher, ev Event) {
	e.touch()
	raw, err := json.Marshal(ev)
	if err != nil {
		return
	}
	if _, err := w.Write([]byte("data: ")); err != nil {
		return
	}
	if _, err := w.Write(raw); err != nil {
		return
	}
	if _, err := w.Write([]byte("\n\n")); err != nil {
		return
	}
	flusher.Flush()
}
