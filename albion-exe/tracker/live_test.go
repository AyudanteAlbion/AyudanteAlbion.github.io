package tracker

import (
	"encoding/binary"
	"testing"

	"ayudante-albion/tracker/photon"
)

func testCodes(t *testing.T) *Codes {
	t.Helper()
	codes, err := parseCodes([]byte(`{
		"events": {"NewCharacter": 24, "JoinFinished": 2},
		"operations": {"Join": 2, "ChangeCluster": 41},
		"eventParameters": {
			"NewCharacter": {"id": 0, "name": 1},
			"JoinFinished": {"zone": 0},
			"ChangeCluster": {"zone": 0}
		},
		"selfOperation": {"operation": "Join", "parameters": {"id": 0, "name": 2, "zone": 8}}
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
	if snapshot.Zone != "Martlock" {
		t.Fatalf("Zone = %q, want the MapIndex carried by the JoinResponse", snapshot.Zone)
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
		7, // Protocol18 parameter table count (one byte)
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
		8, 7, 8, 'M', 'a', 'r', 't', 'l', 'o', 'c', 'k', // parameter 8: MapIndex
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

// El JoinResponse es la única fuente de identidad local y trae el mapa en el
// mismo mensaje (parámetro 8). Antes solo se leía el nombre, así que la app
// mostraba "Ubicación no detectada" aunque el personaje ya estuviera dentro.
func TestJoinResponseAlsoSetsZone(t *testing.T) {
	state := NewState()
	handler := newHandlers(nil, state, NewHub(), testCodes(t))

	handler.response(&photon.OperationResponse{
		Code:       2,
		ReturnCode: 0,
		Parameters: map[byte]any{0: int64(42), 2: "PersonajeDePrueba", 8: "Martlock"},
	})

	snapshot := state.Snapshot()
	if snapshot.Character != "PersonajeDePrueba" {
		t.Fatalf("Character = %q, want the JoinResponse character", snapshot.Character)
	}
	if snapshot.Zone != "Martlock" {
		t.Fatalf("Zone = %q, want the JoinResponse MapIndex", snapshot.Zone)
	}
	if len(snapshot.Maps) != 1 || snapshot.Maps[0].Name != "Martlock" {
		t.Fatalf("Maps = %#v, want one Martlock visit", snapshot.Maps)
	}
}

// ChangeCluster viaja como OPERACIÓN, no como evento: el enum de la app de
// referencia no tiene ningún evento con ese nombre. Mientras se escuchaba
// como evento, cambiar de zona no actualizaba nada.
func TestChangeClusterOperationUpdatesZone(t *testing.T) {
	state := NewState()
	handler := newHandlers(nil, state, NewHub(), testCodes(t))

	handler.response(&photon.OperationResponse{
		Code:       2,
		ReturnCode: 0,
		Parameters: map[byte]any{0: int64(42), 2: "PersonajeDePrueba", 8: "Martlock"},
	})
	handler.response(&photon.OperationResponse{
		Code:       41,
		ReturnCode: 0,
		Parameters: map[byte]any{0: "Thetford"},
	})

	snapshot := state.Snapshot()
	if snapshot.Zone != "Thetford" {
		t.Fatalf("Zone = %q, want the cluster from ChangeCluster", snapshot.Zone)
	}
	if snapshot.Character != "PersonajeDePrueba" {
		t.Fatalf("Character = %q, changing zone must not drop the identity", snapshot.Character)
	}
	// Snapshot devuelve el historial del más reciente al más viejo.
	if len(snapshot.Maps) != 2 {
		t.Fatalf("Maps = %#v, want the previous zone closed and the new one open", snapshot.Maps)
	}
	if snapshot.Maps[0].Name != "Thetford" {
		t.Fatalf("Maps[0] = %q, want the newest visit first", snapshot.Maps[0].Name)
	}
	if snapshot.Maps[1].Leave == 0 {
		t.Fatal("the previous map visit must be closed when the cluster changes")
	}
}

// El pedido de ChangeCluster también sirve: si la captura empezó tarde, es la
// primera pista de la zona actual.
func TestChangeClusterRequestUpdatesZone(t *testing.T) {
	state := NewState()
	handler := newHandlers(nil, state, NewHub(), testCodes(t))

	handler.request(&photon.OperationRequest{
		Code:       41,
		Parameters: map[byte]any{0: "Lymhurst"},
	})

	if got := state.Snapshot().Zone; got != "Lymhurst" {
		t.Fatalf("Zone = %q, want the cluster from the ChangeCluster request", got)
	}
}

// Las mazmorras y refugios mandan "guid@tipo@extra". La app de referencia se
// queda con el primer tramo para nombrar la zona.
func TestClusterNameKeepsFirstSegment(t *testing.T) {
	cases := map[string]struct {
		in   any
		want string
	}{
		"plain":    {"Martlock", "Martlock"},
		"compound": {"3007@RANDOMDUNGEON@SOLO", "3007"},
		"numeric":  {int64(1234), "1234"},
		"empty":    {"", ""},
		"nil":      {nil, ""},
	}
	for label, tc := range cases {
		if got := clusterName(tc.in); got != tc.want {
			t.Fatalf("clusterName(%v) [%s] = %q, want %q", tc.in, label, got, tc.want)
		}
	}
}

// Volver a recibir la misma zona (reenvíos, respuesta duplicada) no debe
// ensuciar el historial de mapas con visitas repetidas.
func TestSameZoneIsNotRecordedTwice(t *testing.T) {
	state := NewState()
	handler := newHandlers(nil, state, NewHub(), testCodes(t))

	handler.enterZone("Caerleon")
	handler.enterZone("Caerleon")

	if maps := state.Snapshot().Maps; len(maps) != 1 {
		t.Fatalf("Maps = %#v, want a single Caerleon visit", maps)
	}
}

// Al cambiar de zona el servidor deja de reportar a las entidades del mapa
// anterior, pero la identidad propia tiene que sobrevivir para poder seguir
// atribuyendo daño sin reiniciar la sesión.
func TestZoneChangeKeepsSelfAndDropsOtherEntities(t *testing.T) {
	state := NewState()
	handler := newHandlers(nil, state, NewHub(), testCodes(t))

	handler.response(&photon.OperationResponse{
		Code:       2,
		ReturnCode: 0,
		Parameters: map[byte]any{0: int64(42), 2: "Yo", 8: "Martlock"},
	})
	handler.event(&photon.EventData{
		Code:       24,
		Parameters: map[byte]any{0: int64(77), 1: "Vecino", 252: int64(24)},
	})

	handler.enterZone("Thetford")

	if got := handler.nameOf(42); got != "Yo" {
		t.Fatalf("nameOf(self) = %q, want the local character to survive the zone change", got)
	}
	if got := handler.nameOf(77); got != "" {
		t.Fatalf("nameOf(other) = %q, want entities from the previous zone to be dropped", got)
	}
}

// Si la captura arranca con la sesión ya iniciada nunca se ve el JoinResponse.
// El personaje propio igual se reanuncia con NewCharacter al entrar a cada
// zona, y de ahí se recupera su id de entidad.
func TestNewCharacterRecoversSelfEntityID(t *testing.T) {
	state := NewState()
	state.SetCharacter("Yo")
	handler := newHandlers(nil, state, NewHub(), testCodes(t))

	handler.event(&photon.EventData{
		Code:       24,
		Parameters: map[byte]any{0: int64(99), 1: "Yo", 252: int64(24)},
	})

	if !handler.isSelf(99) {
		t.Fatal("NewCharacter must recover the local entity id when Join was missed")
	}
}

// Recorrido completo desde el datagrama: framing Photon, decodificación
// Protocol18 y actualización de la zona. Es el camino que recorre de verdad
// un cambio de mapa dentro del juego.
func TestProtocol18ChangeClusterPacketUpdatesZone(t *testing.T) {
	state := NewState()
	handler := newHandlers(nil, state, NewHub(), testCodes(t))
	parser := photon.NewParser(photon.Handler{OnResponse: handler.response})

	if ok := parser.Receive(protocol18ChangeClusterPacket("Bridgewatch")); !ok {
		t.Fatal("Receive() rejected a complete Protocol18 ChangeCluster datagram")
	}
	if got := state.Snapshot().Zone; got != "Bridgewatch" {
		t.Fatalf("Zone = %q, want the cluster carried by the datagram", got)
	}
}

func protocol18ChangeClusterPacket(cluster string) []byte {
	body := []byte{
		0, 3, 41, 0, 0, 8, // reliable marker, response, ChangeCluster, success, null debug
		1,    // one parameter
		0, 7, // parameter 0: UTF-8 cluster name
	}
	body = append(body, protocol18VarUint(uint32(len(cluster)))...)
	body = append(body, cluster...)
	return protocol18ReliablePacket(body)
}
