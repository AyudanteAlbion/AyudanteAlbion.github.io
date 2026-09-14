package photon

import (
	"encoding/binary"
	"time"
)

// Cabeceras y tipos de comando del envoltorio Photon (capa eNet).
const (
	headerLength         = 12
	commandHeaderLength  = 12
	fragmentHeaderLength = 20

	cmdDisconnect     = 4
	cmdSendReliable   = 6
	cmdSendUnreliable = 7
	cmdSendFragment   = 8

	msgOperationRequest  = 2
	msgOperationResponse = 3
	msgEventData         = 4

	fragmentTTL      = 30 * time.Second
	maxFragmentSets  = 64
	maxPayloadLength = 1 << 20 // 1 MB: tope defensivo contra longitudes absurdas
)

// Handler recibe los mensajes ya decodificados.
type Handler struct {
	OnEvent    func(*EventData)
	OnRequest  func(*OperationRequest)
	OnResponse func(*OperationResponse)
}

type fragmentSet struct {
	total    int32
	received int32
	length   int32
	chunks   map[int32][]byte
	seen     time.Time
}

// Parser reensambla los paquetes Photon y entrega mensajes completos.
// No es seguro para uso concurrente: usar uno por goroutine de captura.
type Parser struct {
	handler   Handler
	fragments map[int32]*fragmentSet
	lastSweep time.Time
}

// NewParser crea un parser con los callbacks indicados.
func NewParser(h Handler) *Parser {
	return &Parser{handler: h, fragments: make(map[int32]*fragmentSet), lastSweep: time.Now()}
}

// Receive procesa el payload UDP de un paquete. Devuelve false si el paquete
// no era Photon válido o si algo vino cortado; el llamador simplemente sigue
// con el próximo, porque en UDP perder paquetes es lo normal.
func (p *Parser) Receive(payload []byte) bool {
	p.sweep()

	if len(payload) < headerLength {
		return false
	}
	commandCount := int(binary.BigEndian.Uint16(payload[2:4]))
	offset := headerLength
	ok := true

	for i := 0; i < commandCount; i++ {
		if offset+commandHeaderLength > len(payload) {
			return false
		}
		cmdType := payload[offset]
		cmdLength := int32(binary.BigEndian.Uint32(payload[offset+4 : offset+8]))
		if cmdLength < commandHeaderLength || int(cmdLength) > len(payload)-offset {
			return false
		}
		body := payload[offset+commandHeaderLength : offset+int(cmdLength)]
		offset += int(cmdLength)

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
			if !p.fragment(body) {
				ok = false
			}
		}
	}
	return ok
}

// fragment acumula las partes de un mensaje partido en varios paquetes.
func (p *Parser) fragment(body []byte) bool {
	if len(body) < fragmentHeaderLength-commandHeaderLength+8 {
		return false
	}
	seq := int32(binary.BigEndian.Uint32(body[0:4]))
	count := int32(binary.BigEndian.Uint32(body[4:8]))
	number := int32(binary.BigEndian.Uint32(body[8:12]))
	total := int32(binary.BigEndian.Uint32(body[12:16]))
	offset := int32(binary.BigEndian.Uint32(body[16:20]))
	data := body[20:]

	if count <= 0 || number < 0 || number >= count || total <= 0 || total > maxPayloadLength {
		return false
	}
	if offset < 0 || offset > total || int32(len(data)) > total-offset {
		return false
	}

	set, ok := p.fragments[seq]
	if !ok {
		if len(p.fragments) >= maxFragmentSets {
			// Tope defensivo: fragmentos huérfanos no pueden crecer sin fin.
			p.dropOldest()
		}
		set = &fragmentSet{total: count, length: total, chunks: make(map[int32][]byte, count)}
		p.fragments[seq] = set
	}
	set.seen = time.Now()
	if _, dup := set.chunks[number]; dup {
		return true
	}
	// Copia: el búfer de captura se reutiliza en la próxima lectura.
	chunk := make([]byte, len(data))
	copy(chunk, data)
	set.chunks[number] = chunk
	set.received++

	if set.received < set.total {
		return true
	}

	full := make([]byte, 0, set.length)
	for i := int32(0); i < set.total; i++ {
		part, ok := set.chunks[i]
		if !ok {
			delete(p.fragments, seq)
			return false
		}
		full = append(full, part...)
	}
	delete(p.fragments, seq)
	return p.message(full)
}

// message decodifica un mensaje Photon ya completo.
func (p *Parser) message(data []byte) bool {
	if len(data) < 2 {
		return false
	}
	// data[0] es el byte significador (0xF3); data[1] el tipo de mensaje.
	msgType := data[1] & 0x7f
	// El bit alto marca payload cifrado: no se puede leer y no se intenta.
	if data[1]&0x80 != 0 {
		return false
	}
	r := &reader{buf: data, pos: 2}

	switch msgType {
	case msgEventData:
		ev, err := r.eventData(0)
		if err != nil {
			return false
		}
		if p.handler.OnEvent != nil {
			p.handler.OnEvent(ev)
		}
	case msgOperationRequest:
		op, err := r.operationRequest(0)
		if err != nil {
			return false
		}
		if p.handler.OnRequest != nil {
			p.handler.OnRequest(op)
		}
	case msgOperationResponse:
		op, err := r.operationResponse(0)
		if err != nil {
			return false
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
	for seq, set := range p.fragments {
		if now.Sub(set.seen) > fragmentTTL {
			delete(p.fragments, seq)
		}
	}
}

func (p *Parser) dropOldest() {
	var oldestSeq int32
	var oldest time.Time
	first := true
	for seq, set := range p.fragments {
		if first || set.seen.Before(oldest) {
			oldestSeq, oldest, first = seq, set.seen, false
		}
	}
	if !first {
		delete(p.fragments, oldestSeq)
	}
}
