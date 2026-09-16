package photon

import (
	"encoding/binary"
	"testing"
)

// Los tres casos de abajo reproducen paquetes que el juego manda de verdad y
// que el parser descartaba enteros. Están construidos con el mismo layout que
// usan las pruebas de la aplicación de referencia (PhotonParserTests):
// cabecera Photon de 12 bytes + un comando SendReliable de 12 bytes, y dentro
// del comando el par [firma, tipo de mensaje] seguido del cuerpo Protocol18.

func reliablePacketWithSignature(signature, msgType byte, body []byte, flags byte) []byte {
	message := append([]byte{signature, msgType}, body...)
	commandLength := commandHeaderLength + len(message)
	packet := make([]byte, headerLength+commandLength)
	binary.BigEndian.PutUint16(packet[0:2], 0xf100)
	packet[2] = flags
	packet[3] = 1
	binary.BigEndian.PutUint32(packet[4:8], 1000)
	binary.BigEndian.PutUint32(packet[8:12], 123456)
	packet[headerLength] = cmdSendReliable
	packet[headerLength+1] = 1
	binary.BigEndian.PutUint32(packet[headerLength+4:headerLength+8], uint32(commandLength))
	binary.BigEndian.PutUint32(packet[headerLength+8:headerLength+12], 1)
	copy(packet[headerLength+commandHeaderLength:], message)
	return packet
}

// operationResponseBody replica BuildReliableResponsePayload de la app de
// referencia: código, returnCode int16, debug nulo y cero parámetros.
func operationResponseBody(operationCode byte) []byte {
	return []byte{operationCode, 0, 0, p18Null, 0}
}

// La firma del mensaje NO elige el decodificador. La app de referencia la
// saltea y siempre usa Protocol18. Cuando acá se interpretaba como selector,
// cualquier firma distinta de 0x00 caía en Protocol16, fallaba al decodificar
// y el mensaje se perdía: es exactamente el síntoma de "0 decodificados" con
// el juego abierto y tráfico Photon entrando.
func TestMessageSignatureDoesNotSelectDecoder(t *testing.T) {
	// 0xF3 es el caso que faltaba y el único que disparaba el bug: era la
	// firma que mandaba el mensaje al decodificador Protocol16 y hacía perder
	// el JoinResponse del juego actual.
	for _, signature := range []byte{0x00, 0xf1, 0xfe, 0x02, 0x7f, 0xf3} {
		calls := 0
		parser := NewParser(Handler{OnResponse: func(*OperationResponse) { calls++ }})
		packet := reliablePacketWithSignature(signature, msgOperationResponse, operationResponseBody(2), 0)
		if !parser.Receive(packet) || calls != 1 {
			t.Fatalf("firma 0x%02x: Receive() decodificó %d respuestas, want 1", signature, calls)
		}
	}
}

// Un byte de relleno al final del mensaje no puede invalidar lo ya decodificado.
// La app de referencia acota el mensaje por la longitud del comando y no exige
// que el lector consuma hasta el último byte.
func TestMessageAcceptsTrailingBytes(t *testing.T) {
	calls := 0
	parser := NewParser(Handler{OnResponse: func(*OperationResponse) { calls++ }})
	body := append(operationResponseBody(2), 0x00, 0x00)
	if !parser.Receive(reliablePacketWithSignature(0x00, msgOperationResponse, body, 0)) || calls != 1 {
		t.Fatalf("relleno final: Receive() decodificó %d respuestas, want 1", calls)
	}
}

// Relleno DESPUÉS del paquete completo, que es como llegan muchos datagramas
// reales. Inspect() es la primera compuerta —pipeline.Ingest descarta el
// datagrama si no lo da por válido—, así que este caso se prueba acá y no solo
// a través de Receive(): el test anterior llamaba al parser directamente y por
// eso nunca detectó que Inspect anulaba el datagrama entero.
func TestInspectKeepsValidPacketsDespiteTrailingPadding(t *testing.T) {
	packet := reliablePacketWithSignature(0x00, msgOperationResponse, operationResponseBody(2), 0)

	clean := Inspect(packet)
	if !clean.Valid || clean.Packets != 1 {
		t.Fatalf("datagrama limpio: Valid=%v Packets=%d, want true/1", clean.Valid, clean.Packets)
	}

	for _, padding := range []int{1, 2, 11} {
		padded := append(append([]byte(nil), packet...), make([]byte, padding)...)
		got := Inspect(padded)
		if !got.Valid || got.Packets != 1 {
			t.Fatalf("relleno de %d byte(s): Valid=%v Packets=%d, want true/1", padding, got.Valid, got.Packets)
		}
	}
}

// Y el datagrama con relleno debe además decodificarse de punta a punta.
func TestReceiveDecodesPacketWithTrailingPadding(t *testing.T) {
	calls := 0
	parser := NewParser(Handler{OnResponse: func(*OperationResponse) { calls++ }})
	packet := reliablePacketWithSignature(0x00, msgOperationResponse, operationResponseBody(2), 0)
	padded := append(append([]byte(nil), packet...), 0x00, 0x00, 0x00)

	if !parser.Receive(padded) || calls != 1 {
		t.Fatalf("relleno tras el paquete: Receive() decodificó %d respuestas, want 1", calls)
	}
}

// Basura sin ningún paquete válido sigue siendo un datagrama inválido: la
// tolerancia al relleno no puede convertirse en aceptar cualquier cosa.
func TestInspectStillRejectsGarbage(t *testing.T) {
	if got := Inspect([]byte{0x01, 0x02, 0x03}); got.Valid || got.Packets != 0 {
		t.Fatalf("basura: Valid=%v Packets=%d, want false/0", got.Valid, got.Packets)
	}
}

// Solo flags==1 (cifrado) y flags==0xCC (CRC) son especiales. Cualquier otro
// valor se enmarca como un paquete normal en vez de descartarse.
func TestUnknownHeaderFlagsAreFramedNormally(t *testing.T) {
	calls := 0
	parser := NewParser(Handler{OnResponse: func(*OperationResponse) { calls++ }})
	packet := reliablePacketWithSignature(0x00, msgOperationResponse, operationResponseBody(2), 0x04)
	if !parser.Receive(packet) || calls != 1 {
		t.Fatalf("flags 0x04: Receive() decodificó %d respuestas, want 1", calls)
	}
}

// Protocol16 sigue disponible para capturas históricas, detrás de su firma.
func TestProtocol16SignatureStillUsesLegacyDecoder(t *testing.T) {
	calls := 0
	parser := NewParser(Handler{OnResponse: func(op *OperationResponse) { calls++ }})
	// Cuerpo Protocol16: código, returnCode int16 BE, debug null ('*'), y
	// cantidad de parámetros int16 BE en cero.
	body := []byte{2, 0, 0, typeNull, 0, 0}
	if !parser.Receive(reliablePacketWithSignature(protocol16Signature, msgOperationResponse, body, 0)) || calls != 1 {
		t.Fatalf("firma Protocol16: Receive() decodificó %d respuestas, want 1", calls)
	}
}
