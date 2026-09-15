// Package tracker contiene el motor de estadísticas en vivo de la edición
// Tracker del ejecutable. La edición estándar no lo compila (build tags), así
// que el binario web queda idéntico al de siempre.
//
// El hub es un pub/sub mínimo: las fuentes de eventos publican y cada pestaña
// abierta consume por Server-Sent Events. Se eligió SSE y no WebSocket porque
// el flujo es unidireccional (servidor → navegador), lo resuelve la librería
// estándar sin dependencias, y reconecta solo desde el navegador.
package tracker

import (
	"encoding/json"
	"sync"
	"time"
)

// Event es la unidad que viaja del motor al navegador.
type Event struct {
	Type    string          `json:"type"`
	TS      int64           `json:"ts"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// NewEvent arma un evento serializando el payload. Si el payload no se puede
// serializar, el evento viaja sin él antes que perderse en silencio.
func NewEvent(kind string, payload any) Event {
	ev := Event{Type: kind, TS: time.Now().UnixMilli()}
	if payload != nil {
		if raw, err := json.Marshal(payload); err == nil {
			ev.Payload = raw
		}
	}
	return ev
}

// Hub reparte eventos entre los suscriptores conectados.
type Hub struct {
	mu   sync.RWMutex
	subs map[int]chan Event
	next int
}

// NewHub crea un hub vacío.
func NewHub() *Hub {
	return &Hub{subs: make(map[int]chan Event)}
}

// Subscribe devuelve un canal de eventos y la función para darlo de baja.
// El canal tiene buffer: un cliente lento pierde eventos pero nunca bloquea
// al motor de captura, que corre en tiempo real.
func (h *Hub) Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, 256)
	h.mu.Lock()
	id := h.next
	h.next++
	h.subs[id] = ch
	h.mu.Unlock()

	return ch, func() {
		h.mu.Lock()
		if existing, ok := h.subs[id]; ok {
			delete(h.subs, id)
			close(existing)
		}
		h.mu.Unlock()
	}
}

// Publish entrega el evento a todos los suscriptores sin bloquear.
func (h *Hub) Publish(ev Event) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, ch := range h.subs {
		select {
		case ch <- ev:
		default: // suscriptor saturado: se descarta este evento para él
		}
	}
}

// Subscribers informa cuántas pestañas están escuchando.
func (h *Hub) Subscribers() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.subs)
}
