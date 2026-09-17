package photon

import (
	"encoding/binary"
	"time"
)

// Cabeceras y tipos de comando del envoltorio Photon (capa eNet).
const (
	headerLength         = 12
	crcLength            = 4
	commandHeaderLength  = 12
	fragmentHeaderLength = 20

	cmdDisconnect     = 4
	cmdSendReliable   = 6
	cmdSendUnreliable = 7
	cmdSendFragment   = 8

	msgOperationRequest  = 2
	msgOperationResponse = 3
	msgEventData         = 4
	// msgOperationResponseAlt es una variante que algunos builds de Albion
	// usan para el mismo OperationResponse en vez del tipo 3 estándar.
	// Confirmado en implementaciones independientes del mismo protocolo
	// (p.ej. ao-data/albiondata-client, que la llama msgResponseAlt, y
	// cantalupo555/albion-lens, que la llama MessageTypeInternalResponse):
	// ambas la despachan al mismo decodificador que el tipo 3. Si no se
	// reconoce, el tracker nunca ve la respuesta a Join ni a ChangeCluster
	// y se queda en "Personaje no detectado"/"Ubicación no detectada".
	msgOperationResponseAlt = 7

	// protocol16Signature es la firma histórica de Photon ('ó', 0xF3).
	// YA NO selecciona decodificador: es el signifier byte del mensaje, no un
	// número de versión, y usarlo como selector hacía que el juego actual
	// cayera en Protocol16 y perdiera el JoinResponse. Se conserva como
	// constante documental y para las pruebas de capturas históricas, que hoy
	// se resuelven por el reintento de `message`.
	protocol16Signature = 0xf3

	// Analytics/SAT accepts large fragmented Photon messages (Join and player
	// context can be split across many UDP fragments). Match those operational
	// limits instead of the old 1 MB cap that could drop valid Join/Trade flows.
	fragmentTTL      = 15 * time.Second
	maxFragmentSets  = 256
	maxPayloadLength = 16 << 20
	maxFragmentCount = 16 * 1024
)

// Handler recibe los mensajes ya decodificados.
type Handler struct {
	OnEvent    func(*EventData)
	OnRequest  func(*OperationRequest)
	OnResponse func(*OperationResponse)
}

type fragmentKey struct {
	peerID    uint16
	challenge uint32
	channel   byte
	sequence  int32
}

type fragmentChunk struct {
	offset int32
	data   []byte
}

type fragmentSet struct {
	total    int32
	received int32
	length   int32
	chunks   map[int32]fragmentChunk
	seen     time.Time
}

// Parser reensambla los paquetes Photon y entrega mensajes completos.
// No es seguro para uso concurrente: usar uno por goroutine de captura.
type Parser struct {
	handler   Handler
	fragments map[fragmentKey]*fragmentSet
	lastSweep time.Time
}

// NewParser crea un parser con los callbacks indicados.
func NewParser(h Handler) *Parser {
	return &Parser{
		handler:   h,
		fragments: make(map[fragmentKey]*fragmentSet),
		lastSweep: time.Now(),
	}
}

// Inspection classifies Photon framing without decoding player data. Capture
// providers use it before adapter selection and expose only these counters.
type Inspection struct {
	Valid     bool
	Encrypted bool
	Packets   int
}

// Inspect validates every coalesced Photon envelope in a UDP payload. An
// encrypted envelope is valid Photon traffic but is reported for discard.
//
// El relleno final NO invalida el datagrama. La aplicación de referencia
// avanza paquete a paquete y corta el recorrido cuando el enmarcado falla,
// conservando lo que ya reconoció. Acá antes se devolvía Inspection{} ante
// cualquier byte sobrante: como pipeline.Ingest descarta el datagrama cuando
// Inspect no lo da por válido, un JoinResponse perfectamente decodificable se
// tiraba ANTES de llegar al parser. Ese era el corte más temprano de la
// cadena y el motivo de "Personaje no detectado" con Photon entrando.
func Inspect(payload []byte) Inspection {
	result := Inspection{}
	if len(payload) == 0 {
		return result
	}
	for offset := 0; offset < len(payload); {
		length, ok := photonPacketLength(payload[offset:])
		if !ok || length <= 0 {
			break
		}
		if payload[offset+2] == 1 {
			result.Encrypted = true
		}
		result.Packets++
		offset += length
	}
	result.Valid = result.Packets > 0
	return result
}

// Receive procesa uno o varios paquetes Photon presentes en el payload UDP.
// Devuelve false si ningún paquete del datagrama pudo procesarse; el llamador
// sigue con la siguiente captura porque perder paquetes es normal en UDP.
//
// Un fallo de enmarcado corta el recorrido pero NO descarta lo ya entregado,
// igual que ReceivePacket en la aplicación de referencia. Devolver false de
// entrada hacía que el relleno final de un datagrama válido contara como
// malformado y ocultaba mensajes ya decodificados.
func (p *Parser) Receive(payload []byte) bool {
	p.sweep()
	if len(payload) == 0 {
		return false
	}

	ok := true
	handled := 0
	for offset := 0; offset < len(payload); {
		packetLength, frameOK := photonPacketLength(payload[offset:])
		if !frameOK {
			// Relleno o basura al final: se conserva lo ya procesado.
			break
		}
		if !p.receivePacket(payload[offset : offset+packetLength]) {
			ok = false
		}
		handled++
		offset += packetLength
	}
	return ok && handled > 0
}

// photonPacketLength reads just enough of a Photon envelope to split a
// coalesced UDP payload without trusting a length outside the current buffer.
func photonPacketLength(payload []byte) (int, bool) {
	if len(payload) < headerLength {
		return 0, false
	}
	flags := payload[2]
	// Cipher text cannot be framed as individual commands. It is intentionally
	// ignored by receivePacket, so preserve the rest of this UDP payload as one.
	if flags == 1 {
		return len(payload), true
	}

	offset := headerLength
	if flags == 0xcc {
		if len(payload) < offset+crcLength {
			return 0, false
		}
		offset += crcLength
	}
	// Cualquier otro valor de flags se enmarca igual que un paquete sin
	// cifrar. La aplicación de referencia solo trata distinto el 1 (cifrado) y
	// el 0xCC (CRC); rechazar el resto tiraba datagramas perfectamente válidos.

	for i := 0; i < int(payload[3]); i++ {
		if offset+commandHeaderLength > len(payload) {
			return 0, false
		}
		commandLength := int(binary.BigEndian.Uint32(payload[offset+4 : offset+8]))
		if commandLength < commandHeaderLength || commandLength > len(payload)-offset {
			return 0, false
		}
		offset += commandLength
	}
	return offset, true
}

func (p *Parser) receivePacket(payload []byte) bool {
	if len(payload) < headerLength {
		return false
	}
	flags := payload[2]
	if flags == 1 {
		// El contenido está cifrado y el tracker nunca intenta descifrarlo.
		return false
	}

	peerID := binary.BigEndian.Uint16(payload[0:2])
	challenge := binary.BigEndian.Uint32(payload[8:12])
	offset := headerLength
	if flags == 0xcc {
		if len(payload) < offset+crcLength {
			return false
		}
		want := binary.BigEndian.Uint32(payload[offset : offset+crcLength])
		if want != photonCRC(payload, offset, crcLength) {
			return false
		}
		offset += crcLength
	}

	ok := true
	for i := 0; i < int(payload[3]); i++ {
		if offset+commandHeaderLength > len(payload) {
			return false
		}
		cmdType := payload[offset]
		channel := payload[offset+1]
		cmdLength := int(binary.BigEndian.Uint32(payload[offset+4 : offset+8]))
		if cmdLength < commandHeaderLength || cmdLength > len(payload)-offset {
			return false
		}
		body := payload[offset+commandHeaderLength : offset+cmdLength]
		offset += cmdLength

		switch cmdType {
		case cmdDisconnect:
			// Nada que hacer: la sesión termina y el estado se reinicia solo.
		case cmdSendReliable, cmdSendUnreliable:
			data := body
			if cmdType == cmdSendUnreliable {
				// Los no confiables anteponen 4 bytes de número de secuencia.
				if len(data) < 4 {
					ok = false
					continue
				}
				data = data[4:]
			}
			if !p.message(data) {
				ok = false
			}
		case cmdSendFragment:
			key := fragmentKey{
				peerID:    peerID,
				challenge: challenge,
				channel:   channel,
			}
			if !p.fragment(body, key) {
				ok = false
			}
		}
	}
	// No se exige haber consumido el búfer completo: la longitud de cada
	// comando ya acota su mensaje, y los datagramas reales traen relleno al
	// final. Pedir offset == len(payload) marcaba como malformado un paquete
	// cuyos comandos se habían decodificado sin un solo error.
	return ok
}

// photonCRC is Photon/eNet's reflected CRC-32 over the full packet. The CRC
// field itself is treated as four zero bytes during calculation.
func photonCRC(payload []byte, zeroOffset, zeroLength int) uint32 {
	crc := ^uint32(0)
	zeroEnd := zeroOffset + zeroLength
	for i, b := range payload {
		if i >= zeroOffset && i < zeroEnd {
			b = 0
		}
		crc ^= uint32(b)
		for bit := 0; bit < 8; bit++ {
			if crc&1 != 0 {
				crc = (crc >> 1) ^ 0xedb88320
			} else {
				crc >>= 1
			}
		}
	}
	return crc
}

// fragment accumula las partes de un mensaje partido en varios paquetes.
func (p *Parser) fragment(body []byte, key fragmentKey) bool {
	if len(body) <= fragmentHeaderLength {
		return false
	}
	key.sequence = int32(binary.BigEndian.Uint32(body[0:4]))
	count := int32(binary.BigEndian.Uint32(body[4:8]))
	number := int32(binary.BigEndian.Uint32(body[8:12]))
	totalLength := int32(binary.BigEndian.Uint32(body[12:16]))
	chunkOffset := int32(binary.BigEndian.Uint32(body[16:20]))
	data := body[20:]

	if count <= 0 || count > maxFragmentCount || number < 0 || number >= count ||
		totalLength <= 0 || totalLength > maxPayloadLength {
		return false
	}
	if chunkOffset < 0 || chunkOffset > totalLength || int32(len(data)) > totalLength-chunkOffset {
		return false
	}

	set, found := p.fragments[key]
	if !found {
		if len(p.fragments) >= maxFragmentSets {
			// Tope defensivo: fragmentos huérfanos no pueden crecer sin fin.
			p.dropOldest()
		}
		set = &fragmentSet{total: count, length: totalLength, chunks: make(map[int32]fragmentChunk, count)}
		p.fragments[key] = set
	} else if set.total != count || set.length != totalLength {
		delete(p.fragments, key)
		return false
	}
	set.seen = time.Now()
	if _, duplicate := set.chunks[number]; duplicate {
		return true
	}

	// Copia: el búfer de captura se reutiliza en la próxima lectura.
	chunk := make([]byte, len(data))
	copy(chunk, data)
	set.chunks[number] = fragmentChunk{offset: chunkOffset, data: chunk}
	set.received++
	if set.received < set.total {
		return true
	}

	full := make([]byte, set.length)
	nextOffset := int32(0)
	for i := int32(0); i < set.total; i++ {
		part, exists := set.chunks[i]
		if !exists || part.offset != nextOffset || int32(len(part.data)) > set.length-nextOffset {
			delete(p.fragments, key)
			return false
		}
		copy(full[nextOffset:], part.data)
		nextOffset += int32(len(part.data))
	}
	delete(p.fragments, key)
	if nextOffset != set.length {
		return false
	}
	return p.message(full)
}

// message decodifica un mensaje Photon ya completo.
//
// El primer byte es la FIRMA del mensaje y el segundo el tipo. La aplicación
// de referencia SALTEA la firma sin mirarla y decodifica siempre con
// Protocol18, que es el formato que habla el juego hoy.
//
// Acá esa firma se usaba como selector de decodificador: si valía 0xF3 el
// mensaje caía en Protocol16, fallaba y se perdía entero. Ese byte es el
// signifier byte de Photon, no un número de versión, así que el criterio era
// incorrecto y bastaba para que el JoinResponse nunca llegara.
//
// Ahora se intenta Protocol18 primero, siempre, y solo si falla se reintenta
// con Protocol16 desde el inicio del cuerpo. Así el juego actual funciona sin
// depender de la firma y las capturas históricas se siguen leyendo. El
// reintento necesita un lector nuevo porque el primer intento ya consumió
// bytes del búfer.
//
// Tampoco se exige que el lector consuma el búfer completo: los mensajes
// reales traen relleno al final y descartarlos por un byte sobrante tiraba
// JoinResponse y ChangeCluster ya decodificados correctamente.
func (p *Parser) message(data []byte) bool {
	if len(data) < 2 {
		return false
	}
	msgType := data[1] & 0x7f
	// El bit alto marca payload cifrado: no se puede leer y no se intenta.
	if data[1]&0x80 != 0 {
		return false
	}
	// Cada intento arranca con su propio lector, posicionado después de la
	// firma y el tipo de mensaje.
	newReader := func() *reader { return &reader{buf: data, pos: 2} }

	switch msgType {
	case msgEventData:
		ev, err := newReader().p18EventData(0)
		if err != nil {
			if ev, err = newReader().eventData(0); err != nil {
				return false
			}
		}
		if p.handler.OnEvent != nil {
			p.handler.OnEvent(ev)
		}
	case msgOperationRequest:
		op, err := newReader().p18OperationRequest(0)
		if err != nil {
			if op, err = newReader().operationRequest(0); err != nil {
				return false
			}
		}
		if p.handler.OnRequest != nil {
			p.handler.OnRequest(op)
		}
	case msgOperationResponse, msgOperationResponseAlt:
		op, err := newReader().p18OperationResponse(0)
		if err != nil {
			if op, err = newReader().operationResponse(0); err != nil {
				return false
			}
		}
		if p.handler.OnResponse != nil {
			p.handler.OnResponse(op)
		}
	default:
		return false
	}
	return true
}

// sweep descarta fragmentos que nunca se completaron.
func (p *Parser) sweep() {
	now := time.Now()
	if now.Sub(p.lastSweep) < 10*time.Second {
		return
	}
	p.lastSweep = now
	for key, set := range p.fragments {
		if now.Sub(set.seen) > fragmentTTL {
			delete(p.fragments, key)
		}
	}
}

func (p *Parser) dropOldest() {
	var oldestKey fragmentKey
	var oldest time.Time
	first := true
	for key, set := range p.fragments {
		if first || set.seen.Before(oldest) {
			oldestKey, oldest, first = key, set.seen, false
		}
	}
	if !first {
		delete(p.fragments, oldestKey)
	}
}
