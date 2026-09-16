package photon

import "testing"

// buildReliableMessage arma el cuerpo de un mensaje "reliable" ya extraído de
// su comando eNet: primer byte de firma Protocol18 (0x00), segundo byte con
// el tipo de mensaje, y el resto según el tipo.
func buildReliableMessage(msgType byte, body []byte) []byte {
	out := make([]byte, 0, 2+len(body))
	out = append(out, 0x00, msgType)
	out = append(out, body...)
	return out
}

// buildOperationResponseBody arma un OperationResponse mínimo en Protocol18:
// código de operación, returnCode (int16 LE), debug=null y cero parámetros.
func buildOperationResponseBody(operationCode byte, returnCode int16) []byte {
	return []byte{
		operationCode,
		byte(returnCode), byte(returnCode >> 8),
		p18Null, // debug type: nulo, sin bytes de valor
		0,       // cantidad de parámetros: ninguno
	}
}

// Algunos builds de Albion mandan la respuesta a una operación (p.ej. Join o
// ChangeCluster) con tipo de mensaje 7 en vez del 3 estándar. Si el parser no
// reconoce el 7, el tracker nunca ve esas respuestas y se queda mostrando
// "Personaje no detectado" / "Ubicación no detectada" aunque los paquetes
// lleguen bien. Ver ao-data/albiondata-client (msgResponseAlt) y
// cantalupo555/albion-lens (MessageTypeInternalResponse) para la misma
// convención en implementaciones independientes del protocolo.
func TestMessageDispatchesAlternateOperationResponseType(t *testing.T) {
	var got *OperationResponse
	p := NewParser(Handler{
		OnResponse: func(op *OperationResponse) { got = op },
	})

	body := buildOperationResponseBody(2, 0)
	msg := buildReliableMessage(msgOperationResponseAlt, body)

	if ok := p.message(msg); !ok {
		t.Fatalf("message() con tipo msgOperationResponseAlt (7) devolvió false")
	}
	if got == nil {
		t.Fatal("OnResponse no se llamó para un mensaje con tipo 7")
	}
	if got.Code != 2 {
		t.Fatalf("Code = %d, want 2", got.Code)
	}
	if got.ReturnCode != 0 {
		t.Fatalf("ReturnCode = %d, want 0", got.ReturnCode)
	}
}

// El tipo estándar 3 debe seguir funcionando igual que antes de agregar la
// variante 7.
func TestMessageDispatchesStandardOperationResponseType(t *testing.T) {
	var got *OperationResponse
	p := NewParser(Handler{
		OnResponse: func(op *OperationResponse) { got = op },
	})

	body := buildOperationResponseBody(41, 0)
	msg := buildReliableMessage(msgOperationResponse, body)

	if ok := p.message(msg); !ok {
		t.Fatalf("message() con tipo msgOperationResponse (3) devolvió false")
	}
	if got == nil {
		t.Fatal("OnResponse no se llamó para un mensaje con tipo 3")
	}
	if got.Code != 41 {
		t.Fatalf("Code = %d, want 41", got.Code)
	}
}
