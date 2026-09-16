// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 SheniaLiam — gremio Spetsnaz Grail
//
// Portions of the entity and party lifecycle below are adapted for Go/Wails
// from AlbionOnline-StatisticsAnalysis (SAT), commit
// 9f4471b2905f4152938d84721492c6ac86499750, licensed GPL-3.0.
// See NOTICE at the repository root for attribution and corresponding source.

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
// Además de UDP directo, se capturan fragmentos IPv4: las respuestas grandes
// de Join/ChangeCluster pueden llegar partidas antes de alcanzar Npcap. La
// aplicación Analytics de referencia usa el mismo criterio y reensambla esos
// fragmentos antes de pasarlos a Photon.
const bpfFilter = "((ip and ((udp and (port 5055 or port 5056 or port 5058)) or (ip[6:2] & 0x3fff != 0))) or (ip6 and udp and (port 5055 or port 5056 or port 5058)))"

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
	// simple y más robusto que pedirle al usuario que elija. El índice de
	// entidades es compartido: GUID, ObjectId y party no pueden depender de la
	// interfaz que haya visto el paquete.
	entities := NewEntityStore()
	var wg sync.WaitGroup
	for _, dev := range devices {
		wg.Add(1)
		go func(name string) {
			defer wg.Done()
			l.pump(ctx, name, st, hub, codes, entities)
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
func (l *LiveSource) pump(ctx context.Context, device string, st *State, hub *Hub, codes *Codes, entities *EntityStore) {
	h := newHandlersWithEntities(l, st, hub, codes, entities)
	parser := photon.NewParser(photon.Handler{
		OnEvent:    h.event,
		OnRequest:  h.request,
		OnResponse: h.response,
	})
	reassembler := newIPv4Reassembler()

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
			if payload := udpPayloadReassembled(data, handle.LinkType(), reassembler); payload != nil {
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

type ipv4FragmentKey struct {
	src, dst [4]byte
	id       uint16
	proto    byte
}

type ipv4FragmentSet struct {
	parts map[int][]byte
	last  int
	seen  time.Time
}

type ipv4Reassembler struct {
	sets map[ipv4FragmentKey]*ipv4FragmentSet
}

func newIPv4Reassembler() *ipv4Reassembler {
	return &ipv4Reassembler{sets: make(map[ipv4FragmentKey]*ipv4FragmentSet)}
}

// udpPayloadReassembled is deliberately small but follows the same rule as
// StatisticsAnalysisTool: capture IPv4 fragments, retain them by (src,dst,id)
// and only expose a UDP datagram after every byte arrived. Without this, the
// large JoinResponse is silently discarded and character/zone never appear.
func udpPayloadReassembled(frame []byte, linkType int32, re *ipv4Reassembler) []byte {
	if linkType != 1 || len(frame) < 14 {
		return udpPayload(frame, linkType)
	}
	etherType := binary.BigEndian.Uint16(frame[12:14])
	if etherType != 0x0800 {
		return udpPayload(frame, linkType)
	}
	off := 14
	if len(frame) < off+20 {
		return nil
	}
	ihl := int(frame[off]&0x0f) * 4
	if ihl < 20 || len(frame) < off+ihl {
		return nil
	}
	flagsFrag := binary.BigEndian.Uint16(frame[off+6 : off+8])
	fragOffset := int(flagsFrag&0x1fff) * 8
	more := flagsFrag&0x2000 != 0
	if fragOffset == 0 && !more {
		return udpPayload(frame, linkType)
	}
	if frame[off+9] != 17 || re == nil {
		return nil
	}
	ipEnd := off + int(binary.BigEndian.Uint16(frame[off+2:off+4]))
	if ipEnd > len(frame) { ipEnd = len(frame) }
	payload := frame[off+ihl:ipEnd]
	if fragOffset == 0 {
		if len(payload) < 8 { return nil }
		port := binary.BigEndian.Uint16(payload[0:2])
		dst := binary.BigEndian.Uint16(payload[2:4])
		if !((port == 5055 || port == 5056 || port == 5058) || (dst == 5055 || dst == 5056 || dst == 5058)) { return nil }
	}
	var key ipv4FragmentKey
	copy(key.src[:], frame[off+12:off+16]); copy(key.dst[:], frame[off+16:off+20])
	key.id = binary.BigEndian.Uint16(frame[off+4:off+6]); key.proto = frame[off+9]
	set := re.sets[key]
	if set == nil { set = &ipv4FragmentSet{parts: make(map[int][]byte)}; re.sets[key] = set }
	set.parts[fragOffset] = append([]byte(nil), payload...); set.seen = time.Now()
	if !more { set.last = fragOffset + len(payload) }
	if set.last == 0 { return nil }
	assembled := make([]byte, set.last)
	for start, part := range set.parts {
		if start < 0 || start+len(part) > len(assembled) { delete(re.sets, key); return nil }
		copy(assembled[start:], part)
	}
	// Verify there are no holes before deleting the assembly.
	covered := 0
	for covered < len(assembled) { part, ok := set.parts[covered]; if !ok { return nil }; covered += len(part) }
	delete(re.sets, key)
	if len(assembled) < 8 { return nil }
	return assembled[8:]
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
	src      *LiveSource
	st       *State
	hub      *Hub
	codes    *Codes
	entities *EntityStore
}

// newHandlers is the isolated constructor used by parser tests and one-off
// sources. LiveSource uses newHandlersWithEntities so that all selected network
// interfaces share one GUID/ObjectId correlation store.
func newHandlers(src *LiveSource, st *State, hub *Hub, codes *Codes) *handlers {
	return newHandlersWithEntities(src, st, hub, codes, NewEntityStore())
}

func newHandlersWithEntities(src *LiveSource, st *State, hub *Hub, codes *Codes, entities *EntityStore) *handlers {
	if entities == nil {
		entities = NewEntityStore()
	}
	return &handlers{src: src, st: st, hub: hub, codes: codes, entities: entities}
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

// nameOf resuelve el nombre actual de una entidad; vacío si su ObjectId no
// pertenece a la zona o sesión visible.
func (h *handlers) nameOf(id int64) string {
	return h.entities.NameOfObjectID(id)
}

// isSelf dice si el ObjectId está ligado al GUID del personaje local.
func (h *handlers) isSelf(id int64) bool {
	return h.entities.IsLocalObjectID(id)
}

func (h *handlers) syncRoster() {
	if local, ok := h.entities.Local(); ok {
		h.st.SetCharacter(local.Name)
	}
	h.st.SetParty(h.entities.PartyNames())
}

// trackingAllowed implements SAT's main-character filter for statistics. It
// never guesses identity: before a successful Join it remains permissive; once
// the local character is known, a configured different name accepts no metrics.
func (h *handlers) trackingAllowed() bool {
	expected := h.st.TrackingCharacter()
	actual := h.st.Character()
	return expected == "" || actual == "" || expected == actual
}

// request registra y procesa el contexto de operaciones salientes. No usa el
// pedido para detectar identidad: el servidor la confirma en una respuesta
// exitosa de Join, junto con el GUID y ObjectId locales.
func (h *handlers) request(op *photon.OperationRequest) {
	h.st.MarkDecoded()
	code, ok := realCode(op.Parameters, h.codes.OperationCodeKey(), op.Code)
	if !ok {
		return
	}
	h.recordOperation(code)
	h.operation(code, op.Parameters)
}

// response procesa las respuestas del servidor. La aplicación de referencia
// resuelve el personaje local desde JoinResponse (operación 2): parámetros 0
// para el id de entidad, 1 para GUID, 2 para el nombre y 8 para el mapa.
func (h *handlers) response(op *photon.OperationResponse) {
	h.st.MarkDecoded()
	if op.ReturnCode != 0 {
		return
	}
	code, ok := realCode(op.Parameters, h.codes.OperationCodeKey(), op.Code)
	if !ok {
		return
	}
	h.recordOperation(code)
	h.identifyJoinResponse(code, op.Parameters)
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

// identifyJoinResponse applies the Join response model adapted from SAT:
// name, ObjectId and GUID come from a successful server response, not from the
// client request. GUID is the durable key; ObjectId is kept as the lookup key
// needed by combat and loot events in the current zone.
func (h *handlers) identifyJoinResponse(code int32, params map[byte]any) {
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

	update := entityUpdate{Name: character}
	if idIdx, ok := h.codes.SelfOp.Parameters["id"]; ok && idIdx >= 0 && idIdx <= 255 {
		if id, ok := num(params[byte(idIdx)]); ok {
			update.ObjectID = id
			update.HasObjectID = true
		}
	}
	if guidIdx, ok := h.codes.SelfOp.Parameters["guid"]; ok && guidIdx >= 0 && guidIdx <= 255 {
		update.GUID, _ = GUIDFromPhoton(params[byte(guidIdx)])
	}
	if guildIdx, ok := h.codes.SelfOp.Parameters["guild"]; ok && guildIdx >= 0 && guildIdx <= 255 {
		update.Guild, _ = str(params[byte(guildIdx)])
	}
	if allianceIdx, ok := h.codes.SelfOp.Parameters["alliance"]; ok && allianceIdx >= 0 && allianceIdx <= 255 {
		update.Alliance, _ = str(params[byte(allianceIdx)])
	}

	h.entities.SetLocal(update)
	h.syncRoster()

	// The same Join response carries the cluster where the character appeared
	// (parameter 8 = MapIndex). ChangeCluster can update this later, but it
	// cannot bootstrap identity if this Join response was missed.
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

// enterZone records the new map and invalidates transient ObjectIds for other
// visible entities. Their GUID/name/party entries remain, so NewCharacter can
// rebind them without confusing an old zone's ObjectId for a new one.
func (h *handlers) enterZone(zone string) {
	if zone == "" {
		return
	}
	if h.st.Zone() == zone {
		return // reenvío de la misma zona: no duplicar la visita
	}

	h.entities.BeginZone()
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
	h.st.MarkDecoded()
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
		update := entityUpdate{}
		if id, ok := h.paramNum(name, p, "id"); ok {
			update.ObjectID = id
			update.HasObjectID = true
		}
		update.Name, _ = h.paramStr(name, p, "name")
		if guid, ok := h.param(name, p, "guid"); ok {
			update.GUID, _ = GUIDFromPhoton(guid)
		}
		update.Guild, _ = h.paramStr(name, p, "guild")
		update.Alliance, _ = h.paramStr(name, p, "alliance")
		if update.HasObjectID || update.GUID != "" || update.Name != "" {
			h.entities.Upsert(update)
			h.syncRoster()
		}

	case "Leave":
		if id, ok := h.paramNum(name, p, "id"); ok {
			h.entities.ClearObjectID(id)
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
		if !h.trackingAllowed() {
			break
		}
		if gained, ok := h.paramNum(name, p, "gained"); ok && gained > 0 {
			// La fama viene multiplicada por 10000 en el protocolo.
			h.st.AddFame(gained / 10000)
		}

	case "UpdateReSpecPoints":
		if !h.trackingAllowed() {
			break
		}
		if gained, ok := h.paramNum(name, p, "gained"); ok && gained > 0 {
			h.st.AddRespec(gained / 10000)
		}

	case "TakeSilver":
		if !h.trackingAllowed() {
			break
		}
		// La plata recogida del mundo solo cuenta si la levantó el personaje
		// propio: el servidor también reporta la de la party.
		if id, ok := h.paramNum(name, p, "id"); ok && !h.isSelf(id) {
			break
		}
		if gained, ok := h.paramNum(name, p, "amount"); ok && gained > 0 {
			h.st.AddSilver(gained / 10000)
		}

	case "UpdateCurrency", "PartySilverGained":
		if !h.trackingAllowed() {
			break
		}
		field := "gained"
		if name == "PartySilverGained" {
			field = "amount"
		}
		if gained, ok := h.paramNum(name, p, field); ok && gained > 0 {
			h.st.AddSilver(gained / 10000)
		}

	case "PartyJoined":
		var members []partyMember
		guids, names := []string(nil), []string(nil)
		if value, ok := h.param(name, p, "guids"); ok {
			guids = GUIDsFromPhoton(value)
		}
		if value, ok := h.param(name, p, "names"); ok {
			names = stringsFromPhoton(value)
		}
		for i := 0; i < len(guids) && i < len(names); i++ {
			if guids[i] != "" && names[i] != "" {
				members = append(members, partyMember{GUID: guids[i], Name: names[i]})
			}
		}
		h.entities.SetParty(members)
		h.syncRoster()
		h.hub.Publish(NewEvent("status", h.st.Snapshot()))

	case "PartyPlayerJoined":
		member := partyMember{}
		if guid, ok := h.param(name, p, "guid"); ok {
			member.GUID, _ = GUIDFromPhoton(guid)
		}
		member.Name, _ = h.paramStr(name, p, "name")
		h.entities.AddPartyMember(member)
		h.syncRoster()
		h.hub.Publish(NewEvent("status", h.st.Snapshot()))

	case "PartyPlayerLeft":
		if guid, ok := h.param(name, p, "guid"); ok {
			if key, ok := GUIDFromPhoton(guid); ok {
				h.entities.RemovePartyMemberByGUID(key)
			} else if id, ok := h.paramNum(name, p, "id"); ok {
				h.entities.RemovePartyMemberByObjectID(id)
			}
		} else if id, ok := h.paramNum(name, p, "id"); ok {
			h.entities.RemovePartyMemberByObjectID(id)
		}
		h.syncRoster()
		h.hub.Publish(NewEvent("status", h.st.Snapshot()))

	case "PartyDisbanded":
		h.entities.ResetPartyKeepLocal()
		h.syncRoster()
		h.hub.Publish(NewEvent("status", h.st.Snapshot()))

	case "OtherGrabbedLoot":
		h.loot(name, p)
	}
}

// health traduce el evento de cambio de vida en daño o curación.
// En Albion, un valor negativo es daño y uno positivo es curación.
func (h *handlers) health(event string, p map[byte]any) {
	if !h.trackingAllowed() {
		return
	}
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
	if !h.trackingAllowed() {
		return
	}
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
