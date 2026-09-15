package tracker

import (
	"context"
	"fmt"
	"sync"
)

// ProviderConfigurable permite cambiar entre Npcap y Socket antes de reiniciar
// la captura, manteniendo un único Engine y una única API para el frontend.
type ProviderConfigurable interface {
	SetProvider(string) error
	Provider() string
}

type SelectableSource struct {
	mu       sync.RWMutex
	provider string
	npcap    Source
	socket   Source
}

func NewSelectableSource(npcap, socket Source) *SelectableSource {
	return &SelectableSource{provider: "npcap", npcap: npcap, socket: socket}
}

func (s *SelectableSource) Provider() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.provider
}

func (s *SelectableSource) SetProvider(provider string) error {
	if provider == "" {
		provider = "npcap"
	}
	if provider != "npcap" && provider != "socket" {
		return fmt.Errorf("proveedor desconocido: %s", provider)
	}
	s.mu.Lock()
	s.provider = provider
	s.mu.Unlock()
	return nil
}

func (s *SelectableSource) active() Source {
	s.mu.RLock()
	provider := s.provider
	s.mu.RUnlock()
	if provider == "socket" {
		return s.socket
	}
	return s.npcap
}

func (s *SelectableSource) Name() string                  { return s.active().Name() }
func (s *SelectableSource) Available() (bool, string)     { return s.active().Available() }
func (s *SelectableSource) Run(ctx context.Context, st *State, hub *Hub) error {
	return s.active().Run(ctx, st, hub)
}

func (s *SelectableSource) Devices() ([]map[string]string, error) {
	if s.Provider() == "socket" {
		return []map[string]string{}, nil
	}
	if d, ok := s.npcap.(DeviceConfigurable); ok {
		return d.Devices()
	}
	return []map[string]string{}, nil
}

func (s *SelectableSource) SetDevice(name string) {
	if d, ok := s.npcap.(DeviceConfigurable); ok {
		d.SetDevice(name)
	}
}

func (s *SelectableSource) SetDiagnostic(on bool) {
	if d, ok := s.active().(Diagnosable); ok {
		d.SetDiagnostic(on)
	}
}

func (s *SelectableSource) Diagnostic() map[string]any {
	if d, ok := s.active().(Diagnosable); ok {
		return d.Diagnostic()
	}
	return map[string]any{"enabled": false, "known": []any{}, "unknown": []any{}}
}
