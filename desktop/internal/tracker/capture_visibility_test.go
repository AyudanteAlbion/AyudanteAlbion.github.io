package tracker

import (
	"encoding/binary"
	"net"
	"testing"
)

// Un datagrama de Albion en un puerto remapeado (VPN, ExitLag) se reconoce por
// el envelope Photon. Antes se descartaba por puerto y el tracker quedaba en
// cero sin ninguna señal de por qué.
func TestPhotonEnvelopeAcceptedOnRemappedPort(t *testing.T) {
	payload := []byte{0xf2, 0x01, 0x02, 0x03}
	udp := make([]byte, 8+len(payload))
	binary.BigEndian.PutUint16(udp[0:2], 41234)
	binary.BigEndian.PutUint16(udp[2:4], 27015)
	binary.BigEndian.PutUint16(udp[4:6], uint16(len(udp)))
	copy(udp[8:], payload)

	datagram, ok := parseCapturedFrame(ipv4Fragment(7, 0, false, udp), linkTypeRaw, "vpn", newIPv4Reassembler())
	if !ok {
		t.Fatal("un envelope Photon en un puerto no estándar fue descartado")
	}
	if string(datagram.Payload) != string(payload) {
		t.Fatalf("Payload = %v, want %v", datagram.Payload, payload)
	}
}

// Tráfico que no es Photon en un puerto ajeno se sigue descartando: el
// heurístico no puede convertirse en un colador.
func TestNonPhotonTrafficOnForeignPortStillDropped(t *testing.T) {
	udp := make([]byte, 8+4)
	binary.BigEndian.PutUint16(udp[0:2], 443)
	binary.BigEndian.PutUint16(udp[2:4], 51000)
	binary.BigEndian.PutUint16(udp[4:6], uint16(len(udp)))
	copy(udp[8:], []byte{0x17, 0x03, 0x03, 0x00})

	if _, ok := parseCapturedFrame(ipv4Fragment(8, 0, false, udp), linkTypeRaw, "wifi", newIPv4Reassembler()); ok {
		t.Fatal("tráfico ajeno fue aceptado como Photon")
	}
}

// El contador de tramas separa "no llega nada" de "llega y no se interpreta".
func TestFrameCountersSeparateCaptureFromParsing(t *testing.T) {
	state := NewState()
	state.PrepareCapture("npcap")
	state.CaptureOpened("npcap", 1)

	state.MarkFrame(1, false)
	state.MarkFrame(1, false)
	state.MarkFrame(1, true)

	capture := state.Snapshot().Capture
	if capture.FramesCaptured != 3 {
		t.Fatalf("FramesCaptured = %d, want 3", capture.FramesCaptured)
	}
	if capture.FramesUnparsed != 2 {
		t.Fatalf("FramesUnparsed = %d, want 2", capture.FramesUnparsed)
	}
	if capture.LinkType != 1 {
		t.Fatalf("LinkType = %d, want 1", capture.LinkType)
	}
	if capture.PacketsReceived != 0 {
		t.Fatalf("PacketsReceived = %d: contar tramas no puede inflar el contador de datagramas", capture.PacketsReceived)
	}
}

// Una captura viva que entrega tramas pero ningún datagrama de Albion debe
// quedar registrada como tal, que es el caso del adaptador equivocado.
func TestPipelineMarksFramesWithoutDatagrams(t *testing.T) {
	state := NewState()
	state.PrepareCapture("npcap")
	state.CaptureOpened("npcap", 1)
	pipeline := newPacketPipeline(nil, state, NewHub(), testCodes(t), NewEntityStore(), nil)

	for i := 0; i < 5; i++ {
		pipeline.MarkFrame(1, false)
	}

	capture := state.Snapshot().Capture
	if capture.FramesCaptured != 5 || capture.FramesUnparsed != 5 || capture.PacketsReceived != 0 {
		t.Fatalf("capture = %+v", capture)
	}
}

// ethernetFrame arma una trama Ethernet/IPv4/UDP completa, con la posibilidad
// de agregar el relleno que la placa añade a las tramas cortas.
func ethernetFrame(payload []byte, sourcePort, destinationPort uint16, padding int) []byte {
	udp := make([]byte, 8+len(payload))
	binary.BigEndian.PutUint16(udp[0:2], sourcePort)
	binary.BigEndian.PutUint16(udp[2:4], destinationPort)
	binary.BigEndian.PutUint16(udp[4:6], uint16(len(udp)))
	copy(udp[8:], payload)

	ip := make([]byte, 20+len(udp))
	ip[0] = 0x45
	binary.BigEndian.PutUint16(ip[2:4], uint16(len(ip)))
	ip[8] = 64
	ip[9] = 17
	copy(ip[12:16], net.IPv4(5, 188, 125, 10).To4())
	copy(ip[16:20], net.IPv4(192, 168, 1, 20).To4())
	copy(ip[20:], udp)

	frame := make([]byte, 14+len(ip)+padding)
	binary.BigEndian.PutUint16(frame[12:14], 0x0800)
	copy(frame[14:], ip)
	return frame
}

// Camino completo tal como llega de la placa de red: trama Ethernet con un
// JoinResponse real adentro, con y sin relleno. Es la prueba de que los
// contadores se mueven de punta a punta.
func TestEthernetJoinResponseMovesEveryCounter(t *testing.T) {
	state := NewState()
	state.PrepareCapture("npcap")
	state.CaptureOpened("npcap", 1)
	pipeline := newPacketPipeline(nil, state, NewHub(), testCodes(t), NewEntityStore(), nil)
	pipeline.server.stableFor = 0

	payload := photonFixture(t, "join_response.hex")
	for _, padding := range []int{0, 20} {
		frame := ethernetFrame(payload, 5056, 51000, padding)
		datagram, ok := parseCapturedFrame(frame, linkTypeEthernet, "eth", newIPv4Reassembler())
		pipeline.MarkFrame(linkTypeEthernet, ok)
		if !ok {
			t.Fatalf("relleno %d: la trama Ethernet fue rechazada", padding)
		}
		// El relleno de la trama no puede colarse en el payload Photon.
		if len(datagram.Payload) != len(payload) {
			t.Fatalf("relleno %d: payload de %d bytes, want %d", padding, len(datagram.Payload), len(payload))
		}
		pipeline.Ingest(datagram)
	}

	capture := state.Snapshot().Capture
	if capture.FramesCaptured != 2 || capture.FramesUnparsed != 0 {
		t.Fatalf("contadores de trama = %+v", capture)
	}
	if capture.PacketsReceived == 0 || capture.PhotonPackets == 0 || capture.DecodedMessages == 0 {
		t.Fatalf("el camino feliz no movió los contadores: %+v", capture)
	}
	if !state.Snapshot().Identity.Valid {
		t.Fatal("el JoinResponse no identificó al personaje")
	}
}
