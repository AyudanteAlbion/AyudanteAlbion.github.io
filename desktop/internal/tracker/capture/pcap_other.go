//go:build !windows

// Stub para compilar y probar en Linux/macOS. La captura real solo existe en
// Windows, que es donde se distribuye la edición Tracker; esto mantiene el
// paquete compilable en el resto de las plataformas (tests, `go vet`, CI).
package capture

import (
	"errors"
	"time"
)

// Device es una interfaz de red disponible para capturar.
type Device struct {
	Name        string
	Description string
	Up          bool
	Loopback    bool
}

// Handle es una captura abierta sobre una interfaz.
type Handle struct{}

var errUnsupported = errors.New("la captura de red solo está disponible en Windows con Npcap")

// Available informa si Npcap está instalado y utilizable.
func Available() (bool, string) { return false, errUnsupported.Error() }

// Version devuelve la versión de la librería de captura.
func Version() string { return "" }

// Devices lista las interfaces que Npcap puede abrir.
func Devices() ([]Device, error) { return nil, errUnsupported }

// Open abre la interfaz y le aplica el filtro BPF indicado.
func Open(device, filter string) (*Handle, error) { return nil, errUnsupported }

// LinkType devuelve el tipo de enlace (1 = Ethernet).
func (h *Handle) LinkType() int32 { return 0 }

// Next devuelve el próximo paquete.
func (h *Handle) Next() ([]byte, bool, error) { return nil, false, errUnsupported }

// Close cierra la captura.
func (h *Handle) Close() {}

// Backoff entre reintentos de apertura, para no martillar la interfaz.
const Backoff = 3 * time.Second
