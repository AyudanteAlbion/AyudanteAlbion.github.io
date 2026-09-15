package tracker

import (
	"context"
	"encoding/binary"
	"fmt"
	"sync"
	"time"

	"ayudante-albion-desktop/internal/tracker/capture"
	"ayudante-albion-desktop/internal/tracker/photon"
)

// Puertos UDP del servidor de juego de Albion. 5056 es el de Photon; los
// demás aparecen según la región y el modo de conexión.
const bpfFilter = "udp and (port 5055 or port 5056 or port 5057 or port 5058)"

// LiveSource captura tráfico real con Npcap y lo traduce a eventos del
// tracker. Implementa la misma interfaz `Source` que el simulador, así que se
// enchufa sin tocar el hub, el estado ni el frontend.
type LiveSource struct {
	store *CodeStore

	mu        sync.Mutex
	diag      bool
	diagSeen  map[int32]int
	lastError string
}

// NewLiveSource arma la fuente de captura con la tabla de códigos indicada.
func NewLiveSource(store *CodeStore) *LiveSource {
	return &LiveSource{store: store, diagSeen: make(map[int32]int)}
}

// Name identifica la fuente en la interfaz.
func (l *LiveSource) Name() string {
	if v := capture.Version(); v != "" {
		return "npcap (" + v + ")"
	}
	return "npcap"
}

// Available informa si se puede capturar en esta PC.
func (l *LiveSource) Available() (bool, string) {
	ok, reason := capture.Available()
	if !ok {
		return false, reason
	}
	if _, err := capture.Devices(); err != nil {
		return false, err.Error()
	}
	// Un fallo al abrir una interfaz (típicamente, falta de permisos) se
	// reporta acá: la captura arrancó pero no está viendo nada.
	l.mu.Lock()
	last := l.lastError
	l.mu.Unlock()
	return true, last
}

// SetDiagnostic activa el modo diagnóstico: cuenta los códigos de evento que
// llegan para poder actualizar la tabla después de un patch.
func (l *LiveSource) SetDiagnostic(on bool) {
	l.mu.Lock()
	l.diag = on
	if on {
		l.diagSeen = make(map[int32]int)
	}
	l.mu.Unlock()
}

// Diagnostic devuelve el conteo de códigos vistos, separando los conocidos de
// los que no están en la tabla. Es lo que se mira para corregir los números
// después de un patch de Albion.
func (l *LiveSource) Diagnostic() map[string]any {
	l.mu.Lock()
	defer l.mu.Unlock()

	codes, _ := l.store.Current()
	known := make([]map[string]any, 0)
	unknown := make([]map[string]any, 0)
	for code, count := range l.diagSeen {
		row := map[string]any{"code": code, "count": count}
		if codes != nil {
			if name, ok := codes.EventName(code); ok {
				row["name"] = name
				known = append(known, row)
				continue
			}
		}
		unknown = append(unknown, row)
	}
	return map[string]any{
		"enabled": l.diag,
		"known":   known,
		"unknown": unknown,
	}
}

// Run abre la captura y bombea eventos hasta que se cancela el contexto.
func (l *LiveSource) Run(ctx context.Context, st *State, hub *Hub) error {
	codes, warn := l.store.Current()
	if codes == nil {
		var err error
		codes, err = l.store.Load()
		if err != nil {
			return err
		}
		_, warn = l.store.Current()
	}
	if warn != "" {
		hub.Publish(NewEvent("warning", map[string]any{"message": warn}))
	}

	devices, err := capture.Devices()
	if err != nil {
		return err
	}

	// Albion habla por una sola interfaz, pero cuál depende de la PC (Wi-Fi,
	// Ethernet, VPN). Se escuchan todas y la que traiga tráfico gana: es más
	// simple y más robusto que pedirle al usuario que elija.
	var wg sync.WaitGroup
	for _, dev := range devices {
		wg.Add(1)
		go func(name string) {
			defer wg.Done()
			l.pump(ctx, name, st, hub, codes)
		}(dev.Name)
	}

	st.SetCapturing(true, false)
	hub.Publish(NewEvent("status", st.Snapshot()))

	// Empujar la foto periódicamente: los contadores se mueven aunque no
	// haya combate (tiempo de sesión, tasas por hora).
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				hub.Publish(NewEvent("snapshot", st.Snapshot()))
			}
		}
	}()

	<-ctx.Done()
	wg.Wait()
	st.SetCapturing(false, false)
	hub.Publish(NewEvent("status", st.Snapshot()))
	return ctx.Err()
}

// pump lee una interfaz hasta que se cancela el contexto.
func (l *LiveSource) pump(ctx context.Context, device string, st *State, hub *Hub, codes *Codes) {
	h := newHandlers(l, st, hub, codes)
	parser := photon.NewParser(photon.Handler{
		OnEvent:   h.event,
		OnRequest: h.request,
	})

	for ctx.Err() == nil {
		handle, err := capture.Open(device, bpfFilter)
		if err != nil {
			l.setError(err.Error())
			select {
			case <-ctx.Done():
				return
			case <-time.After(capture.Backoff):
				continue
			}
		}

		for ctx.Err() == nil {
			data, ok, err := handle.Next()
			if err != nil {
				break // la interfaz murió: reabrir
			}
			if !ok {
				continue // timeout de lectura
			}
			if payload := udpPayload(data, handle.LinkType()); payload != nil {
				parser.Receive(payload)
			}
		}
		handle.Close()
	}
}

func (l *LiveSource) setError(msg string) {
	l.mu.Lock()
	l.lastError = msg
	l.mu.Unlock()
}

// udpPayload extrae el contenido UDP de una trama Ethernet, salteando IPv4/IPv6.
// Devuelve nil si la trama no es UDP sobre IP.
func udpPayload(frame []byte, linkType int32) []byte {
	const (
		linkEthernet = 1
		linkRaw      = 101
		linkNull     = 0
	)
	var off int

	switch linkType {
	case linkEthernet:
		if len(frame) < 14 {
			return nil
		}
		etherType := binary.BigEndian.Uint16(frame[12:14])
		off = 14
		// VLAN 802.1Q: 4 bytes extra antes del tipo real.
		if etherType == 0x8100 {
			if len(frame) < 18 {
				return nil
			}
			etherType = binary.BigEndian.Uint16(frame[16:18])
			off = 18
		}
		switch etherType {
		case 0x0800: // IPv4
		case 0x86dd: // IPv6
		default:
			return nil
		}
		return ipPayload(frame, off, etherType == 0x86dd)
	case linkRaw, linkNull:
		if len(frame) < 1 {
			return nil
		}
		version := frame[0] >> 4
		return ipPayload(frame, 0, version == 6)
	default:
		return nil
	}
}

func ipPayload(frame []byte, off int, isV6 bool) []byte {
	const protoUDP = 17

	if isV6 {
		if len(frame) < off+40 {
			return nil
		}
		if frame[off+6] != protoUDP {
			return nil // no se siguen cabeceras de extensión: Albion no las usa
		}
		off += 40
	} else {
		if len(frame) < off+20 {
			return nil
		}
		ihl := int(frame[off]&0x0f) * 4
		if ihl < 20 || len(frame) < off+ihl {
			return nil
		}
		if frame[off+9] != protoUDP {
			return nil
		}
		// Paquete IP fragmentado: el payload UDP está incompleto.
		flagsFrag := binary.BigEndian.Uint16(frame[off+6 : off+8])
		if flagsFrag&0x1fff != 0 {
			return nil
		}
		off += ihl
	}

	if len(frame) < off+8 {
		return nil
	}
	length := int(binary.BigEndian.Uint16(frame[off+4 : off+6]))
	if length < 8 {
		return nil
	}
	end := off + length
	if end > len(frame) {
		end = len(frame) // paquete truncado por snaplen
	}
	if off+8 >= end {
		return nil
	}
	return frame[off+8 : end]
}

// handlers traduce eventos Photon a mutaciones del estado, usando la tabla de
// códigos cargada desde disco.
type handlers struct {
	src   *LiveSource
	st    *State
	hub   *Hub
	codes *Codes

	mu    sync.Mutex
	names map[int64]string // id de entidad -> nombre de jugador
	selfID int64
}

func newHandlers(src *LiveSource, st *State, hub *Hub, codes *Codes) *handlers {
	return &handlers{src: src, st: st, hub: hub, codes: codes,
		names: make(map[int64]string), selfID: -1}
}

// realCode obtiene el código de mensaje: primero del parámetro especial
// (252 eventos / 253 operaciones), y si no está, del byte del envelope.
func realCode(params map[byte]any, key byte, fallback byte) (int32, bool) {
	if v, ok := params[key]; ok {
		if n, ok := num(v); ok && n >= 0 && n <= 65535 {
			return int32(n), true
		}
	}
	return int32(fallback), true
}

// num convierte cualquier entero de Photon a int64.
func num(v any) (int64, bool) {
	switch n := v.(type) {
	case byte:
		return int64(n), true
	case int16:
		return int64(n), true
	case int32:
		return int64(n), true
	case int64:
		return n, true
	case float32:
		return int64(n), true
	case float64:
		return int64(n), true
	}
	return 0, false
}

func str(v any) (string, bool) {
	s, ok := v.(string)
	return s, ok
}

// param busca un parámetro del evento según la tabla de códigos.
func (h *handlers) param(event string, params map[byte]any, field string) (any, bool) {
	idx, ok := h.codes.Param(event, field)
	if !ok {
		return nil, false
	}
	v, ok := params[idx]
	return v, ok
}

func (h *handlers) paramNum(event string, params map[byte]any, field string) (int64, bool) {
	v, ok := h.param(event, params, field)
	if !ok {
		return 0, false
	}
	return num(v)
}

func (h *handlers) paramStr(event string, params map[byte]any, field string) (string, bool) {
	v, ok := h.param(event, params, field)
	if !ok {
		return "", false
	}
	return str(v)
}

// nameOf resuelve el nombre de una entidad; vacío si no se conoce.
func (h *handlers) nameOf(id int64) string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.names[id]
}

func (h *handlers) request(op *photon.OperationRequest) {
	// El código real viene en el parámetro 253; el byte del envelope suele
	// venir en 0 y no alcanza para distinguir operaciones por encima de 255.
	code, ok := realCode(op.Parameters, h.codes.OperationCodeKey(), op.Code)
	if !ok {
		return
	}
	name, ok := h.codes.OperationName(code)
	if !ok || name != h.codes.SelfOp.Operation {
		return
	}
	// La operación Join trae los datos del personaje propio.
	if idx, ok := h.codes.SelfOp.Parameters["name"]; ok && idx >= 0 && idx <= 255 {
		if v, ok := op.Parameters[byte(idx)]; ok {
			if character, ok := str(v); ok && character != "" {
				h.st.SetCharacter(character)
				if idIdx, ok := h.codes.SelfOp.Parameters["id"]; ok && idIdx >= 0 && idIdx <= 255 {
					if idv, ok := op.Parameters[byte(idIdx)]; ok {
						if id, ok := num(idv); ok {
							h.mu.Lock()
							h.selfID = id
							h.names[id] = character
							h.mu.Unlock()
						}
					}
				}
				h.hub.Publish(NewEvent("status", h.st.Snapshot()))
			}
		}
	}
}

func (h *handlers) event(ev *photon.EventData) {
	// Albion manda el código real en el parámetro 252 como entero de 16 bits.
	// El byte del envelope solo sirve para los códigos bajos, así que se usa
	// como respaldo cuando el parámetro no está.
	code, ok := realCode(ev.Parameters, h.codes.EventCodeKey(), ev.Code)
	if !ok {
		return
	}

	if h.src != nil {
		h.src.mu.Lock()
		if h.src.diag {
			h.src.diagSeen[code]++
		}
		h.src.mu.Unlock()
	}

	name, ok := h.codes.EventName(code)
	if !ok {
		return // código fuera de la tabla: se ignora en silencio
	}
	p := ev.Parameters

	switch name {
	case "NewCharacter":
		id, ok1 := h.paramNum(name, p, "id")
		who, ok2 := h.paramStr(name, p, "name")
		if ok1 && ok2 && who != "" {
			h.mu.Lock()
			h.names[id] = who
			h.mu.Unlock()
		}

	case "Leave":
		if id, ok := h.paramNum(name, p, "id"); ok {
			h.mu.Lock()
			delete(h.names, id)
			h.mu.Unlock()
		}

	case "JoinFinished", "ChangeCluster":
		if zone, ok := h.paramStr(name, p, "zone"); ok && zone != "" {
			h.st.EnterZone(zone)
			h.hub.Publish(NewEvent("map", map[string]any{"zone": zone}))
		}

	case "HealthUpdate":
		h.health(name, p)

	case "UpdateFame":
		if gained, ok := h.paramNum(name, p, "gained"); ok && gained > 0 {
			// La fama viene multiplicada por 10000 en el protocolo.
			h.st.AddFame(gained / 10000)
		}

	case "UpdateReSpecPoints":
		if gained, ok := h.paramNum(name, p, "gained"); ok && gained > 0 {
			h.st.AddRespec(gained / 10000)
		}

	case "UpdateCurrency", "TakeSilver", "PartySilverGained":
		field := "gained"
		if name != "UpdateCurrency" {
			field = "amount"
		}
		if gained, ok := h.paramNum(name, p, field); ok && gained > 0 {
			h.st.AddSilver(gained / 10000)
		}

	case "PartyPlayerJoined":
		if who, ok := h.paramStr(name, p, "name"); ok && who != "" {
			h.st.AddPartyMember(who)
			h.hub.Publish(NewEvent("status", h.st.Snapshot()))
		}

	case "PartyDisbanded":
		h.st.SetParty(nil)
		h.hub.Publish(NewEvent("status", h.st.Snapshot()))

	case "OtherGrabbedLoot":
		h.loot(name, p)
	}
}

// health traduce el evento de cambio de vida en daño o curación.
// En Albion, un valor negativo es daño y uno positivo es curación.
func (h *handlers) health(event string, p map[byte]any) {
	targetID, ok1 := h.paramNum(event, p, "target")
	value, ok2 := h.paramNum(event, p, "value")
	if !ok1 || !ok2 || value == 0 {
		return
	}
	sourceID, hasSource := h.paramNum(event, p, "source")

	target := h.nameOf(targetID)
	source := ""
	if hasSource {
		source = h.nameOf(sourceID)
	}

	// Los valores vienen multiplicados por 10000.
	amount := value / 10000
	if amount == 0 {
		return
	}

	if amount < 0 {
		if source == "" {
			return // daño de algo que no tenemos identificado
		}
		h.st.AddDamage(source, target, -amount)
		h.hub.Publish(NewEvent("damage", map[string]any{
			"source": source, "target": target, "amount": -amount,
		}))
		return
	}

	if source == "" {
		return
	}
	h.st.AddHealing(source, amount, 0)
	h.hub.Publish(NewEvent("heal", map[string]any{
		"source": source, "target": target, "amount": amount,
	}))
}

func (h *handlers) loot(event string, p map[byte]any) {
	looterID, _ := h.paramNum(event, p, "looter")
	itemID, hasItem := h.paramNum(event, p, "itemId")
	qty, _ := h.paramNum(event, p, "quantity")
	if !hasItem {
		return
	}
	looter := h.nameOf(looterID)
	if looter == "" {
		looter = "desconocido"
	}
	if qty <= 0 {
		qty = 1
	}
	entry := LootEntry{
		Player:   looter,
		ItemID:   fmt.Sprintf("%d", itemID),
		Quantity: int(qty),
		Source:   "mundo",
	}
	h.st.AddLoot(entry)
	h.hub.Publish(NewEvent("loot", entry))
}
