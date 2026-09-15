package tracker

import (
	"context"
	"encoding/binary"
	"fmt"
	"strings"
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
	diagOps   map[int32]int
	lastError string
	device    string // vacío = todas las interfaces disponibles
}

// NewLiveSource arma la fuente de captura con la tabla de códigos indicada.
func NewLiveSource(store *CodeStore) *LiveSource {
	return &LiveSource{
		store:    store,
		diagSeen: make(map[int32]int),
		diagOps:  make(map[int32]int),
	}
}

// Name identifica la fuente en la interfaz.
func (l *LiveSource) Name() string {
	if v := capture.Version(); v != "" {
		return "npcap (" + v + ")"
	}
	return "npcap"
}

// Available informa si se puede capturar en esta PC.
func (l *LiveSource) Devices() ([]map[string]string, error) {
	devices, err := capture.Devices()
	if err != nil { return nil, err }
	out := make([]map[string]string, 0, len(devices))
	for _, d := range devices { out = append(out, map[string]string{"name": d.Name, "description": d.Description}) }
	return out, nil
}

func (l *LiveSource) SetDevice(name string) {
	l.mu.Lock(); l.device = name; l.mu.Unlock()
}

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
		l.diagOps = make(map[int32]int)
	}
	l.mu.Unlock()
}

// Diagnostic devuelve el conteo de códigos vistos, separados por tipo de
// mensaje. Las operaciones son importantes para diagnosticar la identidad:
// Albion entrega el personaje propio en la respuesta a Join, no en un evento.
func (l *LiveSource) Diagnostic() map[string]any {
	l.mu.Lock()
	defer l.mu.Unlock()

	codes, _ := l.store.Current()
	rows := func(seen map[int32]int, lookup func(int32) (string, bool)) map[string]any {
		known := make([]map[string]any, 0)
		unknown := make([]map[string]any, 0)
		for code, count := range seen {
			row := map[string]any{"code": code, "count": count}
			if codes != nil {
				if name, ok := lookup(code); ok {
					row["name"] = name
					known = append(known, row)
					continue
				}
			}
			unknown = append(unknown, row)
		}
		return map[string]any{"known": known, "unknown": unknown}
	}

	events := rows(l.diagSeen, func(code int32) (string, bool) {
		if codes == nil {
			return "", false
		}
		return codes.EventName(code)
	})
	operations := rows(l.diagOps, func(code int32) (string, bool) {
		if codes == nil {
			return "", false
		}
		return codes.OperationName(code)
	})
	return map[string]any{
		"enabled":    l.diag,
		"known":      events["known"],
		"unknown":    events["unknown"],
		"operations": operations,
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
	if err != nil { return err }
	l.mu.Lock(); selected := l.device; l.mu.Unlock()
	if selected != "" {
		filtered := devices[:0]
		for _, d := range devices { if d.Name == selected { filtered = append(filtered, d) } }
		if len(filtered) == 0 { return fmt.Errorf("el adaptador seleccionado ya no está disponible") }
		devices = filtered
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
		OnEvent:    h.event,
		OnRequest:  h.request,
		OnResponse: h.response,
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
				st.MarkPacket()
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

// isSelf dice si el id de entidad es el del personaje propio.
func (h *handlers) isSelf(id int64) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.selfID >= 0 && h.selfID == id
}

// request se conserva como respaldo para versiones que incluyan la identidad
// en el pedido del cliente. La fuente principal es response: Albion devuelve
// los datos del personaje propio en la respuesta exitosa a Join.
func (h *handlers) request(op *photon.OperationRequest) {
	code, ok := realCode(op.Parameters, h.codes.OperationCodeKey(), op.Code)
	if !ok {
		return
	}
	h.recordOperation(code)
	h.identify(code, op.Parameters)
	h.operation(code, op.Parameters)
}

// response procesa las respuestas del servidor. La aplicación de referencia
// resuelve el personaje local desde JoinResponse (operación 2): parámetros 0
// para el id de entidad, 1 para GUID, 2 para el nombre y 8 para el mapa.
func (h *handlers) response(op *photon.OperationResponse) {
	if op.ReturnCode != 0 {
		return
	}
	code, ok := realCode(op.Parameters, h.codes.OperationCodeKey(), op.Code)
	if !ok {
		return
	}
	h.recordOperation(code)
	h.identify(code, op.Parameters)
	h.operation(code, op.Parameters)
}

// recordOperation mantiene el diagnóstico libre de contenido: registra solo
// el código y la frecuencia, nunca nombres, GUIDs ni parámetros del juego.
func (h *handlers) recordOperation(code int32) {
	if h.src == nil {
		return
	}
	h.src.mu.Lock()
	if h.src.diag {
		h.src.diagOps[code]++
	}
	h.src.mu.Unlock()
}

// identify aplica la configuración selfOperation a una operación Join. Tanto
// pedidos como respuestas pasan por acá, pero la respuesta es la que Albion
// usa para entregar los datos completos del personaje local.
func (h *handlers) identify(code int32, params map[byte]any) {
	name, ok := h.codes.OperationName(code)
	if !ok || name != h.codes.SelfOp.Operation {
		return
	}

	nameIdx, ok := h.codes.SelfOp.Parameters["name"]
	if !ok || nameIdx < 0 || nameIdx > 255 {
		return
	}
	character, ok := str(params[byte(nameIdx)])
	if !ok || character == "" {
		return
	}

	h.st.SetCharacter(character)
	if idIdx, ok := h.codes.SelfOp.Parameters["id"]; ok && idIdx >= 0 && idIdx <= 255 {
		if idv, ok := params[byte(idIdx)]; ok {
			if id, ok := num(idv); ok {
				h.mu.Lock()
				h.selfID = id
				h.names[id] = character
				h.mu.Unlock()
			}
		}
	}

	// El mismo JoinResponse trae el mapa donde apareció el personaje
	// (parámetro 8 = MapIndex). Sin esto la ubicación quedaba en "no
	// detectada" hasta el primer cambio de zona, que además nunca llegaba
	// porque ChangeCluster no se estaba escuchando.
	if zoneIdx, ok := h.codes.SelfOp.Parameters["zone"]; ok && zoneIdx >= 0 && zoneIdx <= 255 {
		if zone := clusterName(params[byte(zoneIdx)]); zone != "" {
			h.enterZone(zone)
		}
	}
	h.hub.Publish(NewEvent("status", h.st.Snapshot()))
}

// operation atiende las operaciones que no identifican al personaje pero sí
// cambian el contexto de la sesión. ChangeCluster es la importante: Albion la
// manda como OPERACIÓN (no como evento) cada vez que el personaje cambia de
// zona, y su respuesta trae el cluster nuevo en el parámetro 0.
func (h *handlers) operation(code int32, params map[byte]any) {
	name, ok := h.codes.OperationName(code)
	if !ok || name != "ChangeCluster" {
		return
	}
	idx, ok := h.codes.Param(name, "zone")
	if !ok {
		return
	}
	zone := clusterName(params[idx])
	if zone == "" {
		return
	}
	h.enterZone(zone)
}

// enterZone registra el mapa nuevo y avisa al frontend. Al cambiar de cluster
// el servidor deja de reportar a las entidades del mapa anterior, así que el
// índice de nombres se descarta: los jugadores de la zona nueva llegan otra
// vez por NewCharacter. La identidad propia se conserva, que es justamente lo
// que permite seguir midiendo sin volver a iniciar sesión.
func (h *handlers) enterZone(zone string) {
	if zone == "" {
		return
	}
	if h.st.Zone() == zone {
		return // reenvío de la misma zona: no duplicar la visita
	}

	h.mu.Lock()
	selfID, selfName := h.selfID, ""
	if selfID >= 0 {
		selfName = h.names[selfID]
	}
	h.names = make(map[int64]string)
	if selfName != "" {
		h.names[selfID] = selfName
	}
	h.mu.Unlock()

	h.st.EnterZone(zone)
	h.hub.Publish(NewEvent("map", map[string]any{"zone": zone}))
	h.hub.Publish(NewEvent("status", h.st.Snapshot()))
}

// clusterName normaliza el identificador de zona que manda Albion. Puede ser
// un índice numérico ("1234"), un nombre de cluster, o una cadena compuesta
// "guid@tipo@extra" en mazmorras y refugios: en ese caso la app de referencia
// se queda con el primer tramo.
func clusterName(v any) string {
	switch value := v.(type) {
	case string:
		name := value
		if i := strings.IndexByte(name, '@'); i > 0 {
			name = name[:i]
		}
		return name
	case nil:
		return ""
	default:
		if n, ok := num(v); ok {
			return fmt.Sprintf("%d", n)
		}
	}
	return ""
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
			// Si la captura arrancó con la sesión ya iniciada nunca se vio el
			// JoinResponse, pero el personaje propio igual se reanuncia al
			// entrar a cada zona. Recuperar su id permite atribuirle daño y
			// plata sin pedirle al usuario que reinicie el juego.
			if h.selfID < 0 && who == h.st.Character() {
				h.selfID = id
			}
			h.mu.Unlock()
		}

	case "Leave":
		if id, ok := h.paramNum(name, p, "id"); ok {
			h.mu.Lock()
			delete(h.names, id)
			h.mu.Unlock()
		}

	// ChangeCluster NO existe como evento: es una operación y se atiende en
	// operation(). Acá solo queda JoinFinished, que confirma la entrada al
	// mapa después de un Join.
	case "JoinFinished":
		if idx, ok := h.codes.Param(name, "zone"); ok {
			h.enterZone(clusterName(p[idx]))
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

	case "TakeSilver":
		// La plata recogida del mundo solo cuenta si la levantó el personaje
		// propio: el servidor también reporta la de la party.
		if id, ok := h.paramNum(name, p, "id"); ok && !h.isSelf(id) {
			break
		}
		if gained, ok := h.paramNum(name, p, "amount"); ok && gained > 0 {
			h.st.AddSilver(gained / 10000)
		}

	case "UpdateCurrency", "PartySilverGained":
		field := "gained"
		if name == "PartySilverGained" {
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

	case "PartyPlayerLeft":
		if id, ok := h.paramNum(name, p, "id"); ok {
			h.st.RemovePartyMember(h.nameOf(id))
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
		if !h.st.IsTrackedPlayer(source) {
			return // nunca medir enemigos ni jugadores ajenos a la party
		}
		h.st.AddDamage(source, target, -amount)
		h.hub.Publish(NewEvent("damage", map[string]any{
			"source": source, "target": target, "amount": -amount,
		}))
		return
	}

	if !h.st.IsTrackedPlayer(source) {
		return // la curación ajena tampoco debe perfilar a terceros
	}
	h.st.AddHealing(source, amount, 0)
	h.hub.Publish(NewEvent("heal", map[string]any{
		"source": source, "target": target, "amount": amount,
	}))
}

func (h *handlers) loot(event string, p map[byte]any) {
	itemID, hasItem := h.paramNum(event, p, "itemId")
	qty, _ := h.paramNum(event, p, "quantity")
	if !hasItem {
		return
	}
	// Albion manda el nombre del saqueador como texto, no como id de entidad.
	// Si alguna tabla vieja lo declara numérico se resuelve contra el índice.
	looter, ok := h.paramStr(event, p, "looter")
	if !ok || looter == "" {
		if id, ok := h.paramNum(event, p, "looter"); ok {
			looter = h.nameOf(id)
		}
	}
	if !h.st.IsTrackedPlayer(looter) {
		return // botín únicamente propio o de la party actual
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
