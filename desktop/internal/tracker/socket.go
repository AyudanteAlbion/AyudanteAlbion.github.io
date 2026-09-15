package tracker

import (
	"context"
	"encoding/binary"
	"errors"
	"net"
	"runtime"
	"time"

	"ayudante-albion-desktop/internal/tracker/photon"
)

// SocketSource usa un socket IP sin procesar. En Windows no necesita Npcap,
// pero el sistema solo permite abrirlo a procesos elevados.
type SocketSource struct {
	store *CodeStore
}

func NewSocketSource(store *CodeStore) *SocketSource { return &SocketSource{store: store} }
func (s *SocketSource) Name() string                 { return "socket de Windows" }

func (s *SocketSource) Available() (bool, string) {
	if runtime.GOOS != "windows" {
		return false, "Socket solo está disponible en Windows"
	}
	conn, err := net.ListenPacket("ip4:udp", "0.0.0.0")
	if err != nil {
		return false, "no se pudo abrir el socket sin procesar — ejecutá la herramienta como administrador"
	}
	_ = conn.Close()
	return true, ""
}

func (s *SocketSource) Run(ctx context.Context, st *State, hub *Hub) error {
	codes, warn := s.store.Current()
	if codes == nil {
		var err error
		codes, err = s.store.Load()
		if err != nil {
			return err
		}
		_, warn = s.store.Current()
	}
	if warn != "" {
		hub.Publish(NewEvent("warning", map[string]any{"message": warn}))
	}

	conn, err := net.ListenPacket("ip4:udp", "0.0.0.0")
	if err != nil {
		return errors.New("no se pudo iniciar Socket; ejecutá Ayudante Albion como administrador")
	}
	defer conn.Close()

	h := newHandlers(nil, st, hub, codes)
	parser := photon.NewParser(photon.Handler{OnEvent: h.event, OnRequest: h.request, OnResponse: h.response})
	st.SetCapturing(true, false)
	hub.Publish(NewEvent("status", st.Snapshot()))

	buf := make([]byte, 65536)
	for ctx.Err() == nil {
		_ = conn.SetReadDeadline(time.Now().Add(250 * time.Millisecond))
		n, _, readErr := conn.ReadFrom(buf)
		if readErr != nil {
			if timeout, ok := readErr.(net.Error); ok && timeout.Timeout() {
				continue
			}
			return readErr
		}
		if payload := socketUDPPayload(buf[:n]); payload != nil {
			st.MarkPacket()
			parser.Receive(payload)
		}
	}
	st.SetCapturing(false, false)
	hub.Publish(NewEvent("status", st.Snapshot()))
	return ctx.Err()
}

// Un socket ip4:udp entrega la cabecera UDP seguida del payload. Solo se
// aceptan los puertos de juego documentados; el resto se descarta sin parsear.
func socketUDPPayload(packet []byte) []byte {
	if len(packet) < 9 {
		return nil
	}
	src := binary.BigEndian.Uint16(packet[0:2])
	dst := binary.BigEndian.Uint16(packet[2:4])
	allowed := func(port uint16) bool { return port == 5055 || port == 5056 || port == 5058 }
	if !allowed(src) && !allowed(dst) {
		return nil
	}
	length := int(binary.BigEndian.Uint16(packet[4:6]))
	if length < 9 || length > len(packet) {
		length = len(packet)
	}
	return packet[8:length]
}
