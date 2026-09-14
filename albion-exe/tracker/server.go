package tracker

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

// Engine ata fuente, estado y hub, y publica la API HTTP del tracker.
type Engine struct {
	hub    *Hub
	state  *State
	source Source

	mu     sync.Mutex
	cancel context.CancelFunc
	// touch renueva el latido de vida del proceso: mientras una pestaña
	// escucha el stream, el ejecutable no debe apagarse solo.
	touch func()
}

// NewEngine crea el motor con la fuente indicada.
func NewEngine(src Source, touch func()) *Engine {
	if touch == nil {
		touch = func() {}
	}
	return &Engine{hub: NewHub(), state: NewState(), source: src, touch: touch}
}

func (e *Engine) running() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.cancel != nil
}

// Start arranca la captura si no estaba corriendo.
func (e *Engine) Start() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.cancel != nil {
		return nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	e.cancel = cancel
	go func() {
		_ = e.source.Run(ctx, e.state, e.hub)
	}()
	return nil
}

// Stop detiene la captura.
func (e *Engine) Stop() {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.cancel != nil {
		e.cancel()
		e.cancel = nil
	}
	e.state.SetCapturing(false, false)
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
		writeJSON(w, http.StatusOK, map[string]any{
			"edition":   "tracker",
			"available": ok,
			"reason":    reason,
			"source":    e.source.Name(),
			"capturing": e.running(),
			"listeners": e.hub.Subscribers(),
		})
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

	mux.HandleFunc("/api/tracker/reset", func(w http.ResponseWriter, r *http.Request) {
		e.touch()
		if r.Method != http.MethodPost {
			http.Error(w, "método no permitido", http.StatusMethodNotAllowed)
			return
		}
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
