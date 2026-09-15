package tracker

import (
	"encoding/binary"
	"testing"

	"ayudante-albion/tracker/photon"
)

func testCodes(t *testing.T) *Codes {
	t.Helper()
	codes, err := parseCodes([]byte(`{
		"events": {"NewCharacter": 24},
		"operations": {"Join": 2},
		"eventParameters": {"NewCharacter": {"id": 0, "name": 1}},
		"selfOperation": {"operation": "Join", "parameters": {"id": 0, "name": 2}}
	}`), "test")
	if err != nil {
		t.Fatalf("parseCodes() error = %v", err)
	}
	return codes
}

func TestJoinResponseIdentifiesLocalCharacter(t *testing.T) {
	state := NewState()
	handler := newHandlers(nil, state, NewHub(), testCodes(t))

	// Albion envía el personaje local en la respuesta exitosa de Join, no en
	// el pedido que originó la operación.
	handler.response(&photon.OperationResponse{
		Code:       2,
		ReturnCode: 0,
		Parameters: map[byte]any{0: int64(42), 2: "PersonajeDePrueba"},
	})

	snapshot := state.Snapshot()
	if snapshot.Character != "PersonajeDePrueba" {
		t.Fatalf("Character = %q, want %q", snapshot.Character, "PersonajeDePrueba")
	}
	if got := handler.nameOf(42); got != "PersonajeDePrueba" {
		t.Fatalf("nameOf(42) = %q, want %q", got, "PersonajeDePrueba")
	}
	if len(snapshot.Combatants) != 1 || !snapshot.Combatants[0].Self {
		t.Fatalf("Join response must mark the local character as self: %#v", snapshot.Combatants)
	}
}

func TestFailedJoinResponseDoesNotIdentifyCharacter(t *testing.T) {
	state := NewState()
	handler := newHandlers(nil, state, NewHub(), testCodes(t))

	handler.response(&photon.OperationResponse{
		Code:       2,
		ReturnCode: 1,
		Parameters: map[byte]any{0: int64(42), 2: "NoDebeUsarse"},
	})

	if got := state.Snapshot().Character; got != "" {
		t.Fatalf("Character = %q after failed Join, want empty", got)
	}
}

func TestProtocol18JoinResponsePacketIdentifiesLocalCharacter(t *testing.T) {
	state := NewState()
	handler := newHandlers(nil, state, NewHub(), testCodes(t))
	parser := photon.NewParser(photon.Handler{OnResponse: handler.response})

	// Datagrama Photon/eNet completo, con el formato compacto Protocol18 que
	// usa Albion actualmente. El marcador 0 y el null (8) del debug distinguen
	// este cuerpo del Protocol16 histórico.
	if ok := parser.Receive(protocol18JoinResponsePacket("PersonajeProtocol18")); !ok {
		t.Fatal("Receive() rejected a complete Protocol18 JoinResponse datagram")
	}

	snapshot := state.Snapshot()
	if snapshot.Character != "PersonajeProtocol18" {
		t.Fatalf("Character = %q, want Protocol18 JoinResponse character", snapshot.Character)
	}
	if got := handler.nameOf(42); got != "PersonajeProtocol18" {
		t.Fatalf("nameOf(42) = %q, want Protocol18 name", got)
	}
}

func TestProtocol18EventPacketRoutesToTracker(t *testing.T) {
	state := NewState()
	handler := newHandlers(nil, state, NewHub(), testCodes(t))
	parser := photon.NewParser(photon.Handler{OnEvent: handler.event})

	if ok := parser.Receive(protocol18NewCharacterPacket("AliadoProtocol18")); !ok {
		t.Fatal("Receive() rejected a complete Protocol18 event datagram")
	}
	if got := handler.nameOf(77); got != "AliadoProtocol18" {
		t.Fatalf("nameOf(77) = %q, want Protocol18 event name", got)
	}
}

// protocol18JoinResponsePacket makes a complete UDP payload with one Photon
// reliable command. It is intentionally built at the transport boundary so
// the test covers framing, Protocol18 decoding, callback routing and tracker
// identity handling together.
func protocol18JoinResponsePacket(name string) []byte {
	body := []byte{
		0, 3, 2, 0, 0, 8, // reliable marker, response, Join, success, null debug
		6, // Protocol18 parameter table count (one byte)
		0, 10, 84, // parameter 0: compressed long entity id = 42 (zig-zag varint)
		1, 19, 1, 16, // parameter 1: custom GUID value (type 1, 16 bytes)
	}
	body = append(body, make([]byte, 16)...)
	body = append(body,
		2, 7, // parameter 2: UTF-8 character name
	)
	body = append(body, protocol18VarUint(uint32(len(name)))...)
	body = append(body, name...)
	body = append(body,
		43, 74, 2, 0, 2, // parameter 43: two compressed long values
		64, 69, 2, 0, 0, 0, 0, 0, 0, 128, 63, // parameter 64: two float positions
		58, 7, 5, 'G', 'u', 'i', 'l', 'd', // parameter 58: guild name
	)
	return protocol18ReliablePacket(body)
}

func protocol18NewCharacterPacket(name string) []byte {
	body := []byte{
		0, 4, 24, // reliable marker, event, NewCharacter code
		2, // Protocol18 parameter table count (one byte)
		0, 11, 77, // parameter 0: Int1 entity id = 77
		1, 7, // parameter 1: UTF-8 character name
	}
	body = append(body, protocol18VarUint(uint32(len(name)))...)
	body = append(body, name...)
	return protocol18ReliablePacket(body)
}

func protocol18ReliablePacket(body []byte) []byte {
	packet := make([]byte, 12+12+len(body))
	packet[2] = 0 // unencrypted, no CRC
	packet[3] = 1 // one command
	binary.BigEndian.PutUint32(packet[4:8], 1000)
	binary.BigEndian.PutUint32(packet[8:12], 123456)
	packet[12] = 6 // send reliable
	binary.BigEndian.PutUint32(packet[16:20], uint32(12+len(body)))
	binary.BigEndian.PutUint32(packet[20:24], 1)
	copy(packet[24:], body)
	return packet
}

func protocol18VarUint(value uint32) []byte {
	var out []byte
	for {
		part := byte(value & 0x7f)
		value >>= 7
		if value != 0 {
			part |= 0x80
		}
		out = append(out, part)
		if value == 0 {
			return out
		}
	}
}

func TestDiagnosticSeparatesOperationCodes(t *testing.T) {
	store := NewCodeStore(nil)
	store.set(testCodes(t), "")
	source := NewLiveSource(store)
	source.SetDiagnostic(true)
	handler := newHandlers(source, NewState(), NewHub(), testCodes(t))

	handler.response(&photon.OperationResponse{
		Code:       2,
		ReturnCode: 0,
		Parameters: map[byte]any{0: int64(42), 2: "PersonajeDePrueba"},
	})

	diagnostic := source.Diagnostic()
	operations, ok := diagnostic["operations"].(map[string]any)
	if !ok {
		t.Fatalf("operations diagnostic = %#v, want map", diagnostic["operations"])
	}
	known, ok := operations["known"].([]map[string]any)
	if !ok || len(known) != 1 {
		t.Fatalf("known operations = %#v, want one Join", operations["known"])
	}
	if known[0]["code"] != int32(2) || known[0]["name"] != "Join" || known[0]["count"] != 1 {
		t.Fatalf("Join diagnostic = %#v, want Join code 2 once", known[0])
	}
}
