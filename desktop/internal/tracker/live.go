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
	"fmt"
	"math"
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

	mu           sync.Mutex
	diagnostics  *protocolDiagnostics
	lastError    string
	device       string // vacío = todas las interfaces disponibles
	activeDevice string
	lastValid    time.Time
}

// NewLiveSource arma la fuente de captura con la tabla de códigos indicada.
func NewLiveSource(store *CodeStore) *LiveSource {
	return &LiveSource{store: store, diagnostics: newProtocolDiagnostics()}
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
	if err != nil {
		return nil, err
	}
	out := make([]map[string]string, 0, len(devices))
	for _, d := range devices {
		if !d.Up || d.Loopback {
			continue
		}
		out = append(out, map[string]string{"name": d.Name, "description": d.Description})
	}
	return out, nil
}

func (l *LiveSource) SetDevice(name string) {
	l.mu.Lock()
	l.device = name
	l.mu.Unlock()
}

func (l *LiveSource) Available() (bool, string) {
	ok, reason := capture.Available()
	if !ok {
		return false, reason
	}
	devices, err := capture.Devices()
	if err != nil {
		return false, err.Error()
	}
	usable := false
	for _, device := range devices {
		if device.Up && !device.Loopback {
			usable = true
			break
		}
	}
	if !usable {
		return false, "Npcap no encontró adaptadores activos que no sean loopback"
	}
	// Un fallo al abrir una interfaz (típicamente, falta de permisos) se
	// reporta acá: la captura arrancó pero no está viendo nada.
	l.mu.Lock()
	last := l.lastError
	l.mu.Unlock()
	return true, last
}

// SetDiagnostic enables privacy-safe numeric diagnostics for Npcap.
func (l *LiveSource) SetDiagnostic(on bool) { l.diagnostics.setEnabled(on) }

func (l *LiveSource) Diagnostic() map[string]any { return l.diagnostics.snapshot(l.store) }

// Run opens every active, non-loopback adapter before announcing network
// capture. It rescans periodically and reopens failed adapters, which covers
// Wi-Fi/Ethernet/VPN changes without silently switching to demo data.
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

	l.mu.Lock()
	l.lastError = ""
	l.activeDevice = ""
	l.lastValid = time.Time{}
	l.mu.Unlock()

	entities := NewEntityStore()
	pipeline := newPacketPipeline(l.diagnostics, st, hub, codes, entities, l.acceptAdapter)
	type worker struct {
		cancel context.CancelFunc
		done   chan struct{}
	}
	workers := make(map[string]worker)

	usableDevices := func() ([]capture.Device, error) {
		devices, err := capture.Devices()
		if err != nil {
			return nil, err
		}
		l.mu.Lock()
		selected := l.device
		l.mu.Unlock()
		out := make([]capture.Device, 0, len(devices))
		for _, device := range devices {
			if !device.Up || device.Loopback {
				continue
			}
			if selected != "" && device.Name != selected {
				continue
			}
			out = append(out, device)
		}
		if selected != "" && len(out) == 0 {
			return nil, fmt.Errorf("el adaptador seleccionado no está activo o ya no existe")
		}
		return out, nil
	}

	refresh := func() (int, error) {
		devices, err := usableDevices()
		if err != nil {
			return 0, err
		}
		wanted := make(map[string]bool, len(devices))
		for _, device := range devices {
			wanted[device.Name] = true
		}
		for name, current := range workers {
			if !wanted[name] {
				current.cancel()
			}
		}
		var lastErr error
		for _, device := range devices {
			if _, exists := workers[device.Name]; exists {
				continue
			}
			handle, openErr := capture.Open(device.Name, bpfFilter)
			if openErr != nil {
				lastErr = openErr
				l.setError(openErr.Error())
				continue
			}
			workerCtx, cancel := context.WithCancel(ctx)
			done := make(chan struct{})
			workers[device.Name] = worker{cancel: cancel, done: done}
			go func(name string, handle *capture.Handle, done chan struct{}) {
				defer close(done)
				l.pumpHandle(workerCtx, name, handle, pipeline)
			}(device.Name, handle, done)
		}
		active := 0
		for _, device := range devices {
			if _, exists := workers[device.Name]; exists {
				active++
			}
		}
		if active == 0 && lastErr != nil {
			return 0, lastErr
		}
		return active, nil
	}

	opened, err := refresh()
	if err != nil || opened == 0 {
		if err == nil {
			err = fmt.Errorf("Npcap no pudo abrir ningún adaptador activo")
		}
		return err
	}
	st.CaptureOpened("npcap", opened)
	hub.Publish(NewEvent("status", st.Snapshot()))

	snapshotTicker := time.NewTicker(time.Second)
	refreshTicker := time.NewTicker(5 * time.Second)
	defer snapshotTicker.Stop()
	defer refreshTicker.Stop()
	for {
		select {
		case <-ctx.Done():
			for _, current := range workers {
				current.cancel()
			}
			for _, current := range workers {
				<-current.done
			}
			return ctx.Err()
		case <-snapshotTicker.C:
			hub.Publish(NewEvent("snapshot", st.Snapshot()))
		case <-refreshTicker.C:
			// Drop workers whose handles died, then rescan all adapters. A live
			// worker closes done; polling that channel here is non-blocking.
			for name, current := range workers {
				select {
				case <-current.done:
					delete(workers, name)
					if l.releaseAdapter(name) {
						pipeline.ResetTransport()
						st.CaptureRecovering("npcap", "el adaptador Photon dejó de responder; buscando otra conexión")
					}
				default:
				}
			}
			if count, refreshErr := refresh(); refreshErr != nil {
				l.setError(refreshErr.Error())
				if count == 0 {
					hub.Publish(NewEvent("warning", map[string]any{"message": "Npcap está esperando que vuelva un adaptador de red activo."}))
				}
			} else if count == 0 {
				st.CaptureRecovering("npcap", "Npcap está esperando que vuelva un adaptador de red activo")
				hub.Publish(NewEvent("warning", map[string]any{"message": "Npcap está esperando que vuelva un adaptador de red activo."}))
			} else {
				st.CaptureOpened("npcap", count)
			}
		}
	}
}

func (l *LiveSource) pumpHandle(ctx context.Context, device string, handle *capture.Handle, pipeline *packetPipeline) {
	defer handle.Close()
	reassembler := newIPv4Reassembler()
	for ctx.Err() == nil {
		data, ok, err := handle.Next()
		if err != nil {
			l.setError(err.Error())
			return
		}
		if !ok {
			continue
		}
		datagram, valid := parseCapturedFrame(data, handle.LinkType(), device, reassembler)
		// Se cuenta la trama SIEMPRE, se haya podido interpretar o no: una
		// captura con tramas y cero datagramas apunta al tipo de enlace del
		// adaptador, no a la red ni al protocolo.
		pipeline.MarkFrame(handle.LinkType(), valid)
		if valid {
			pipeline.Ingest(datagram)
		}
	}
}

// acceptAdapter locks to the first adapter carrying a structurally valid
// Photon envelope. The lease expires after 20 seconds without Photon traffic,
// allowing a VPN or network switch to win on the next packet.
func (l *LiveSource) acceptAdapter(device string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if l.activeDevice != "" && now.Sub(l.lastValid) > 20*time.Second {
		l.activeDevice = ""
	}
	if l.activeDevice == "" {
		l.activeDevice = device
	}
	if l.activeDevice != device {
		return false
	}
	l.lastValid = now
	return true
}

func (l *LiveSource) releaseAdapter(device string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.activeDevice != device {
		return false
	}
	l.activeDevice = ""
	l.lastValid = time.Time{}
	return true
}

func (l *LiveSource) setError(msg string) {
	l.mu.Lock()
	l.lastError = msg
	l.mu.Unlock()
}

// handlers traduce eventos Photon a mutaciones del estado, usando la tabla de
// códigos cargada desde disco.
type pendingPlayerKill struct {
	victimID   int64
	victimName string
	killer     Entity
	at         time.Time
}

type silverTaxRates struct {
	cluster, guild, alliance float64
	valid                    bool
}

type handlers struct {
	diag     *protocolDiagnostics
	st       *State
	hub      *Hub
	codes    *Codes
	entities *EntityStore
	pendingKills []pendingPlayerKill
	silverTaxes silverTaxRates
	// dungeon es la partida de mazmorra en curso, abierta al entrar a una
	// instancia y cerrada al salir. nil mientras el personaje está afuera.
	dungeon *dungeonRun
	// fishing es la pesca en curso; nil mientras no se está pescando.
	fishing *fishingState
}

// newHandlers is the isolated constructor used by parser tests and one-off
// sources. LiveSource uses newHandlersWithEntities so that all selected network
// interfaces share one GUID/ObjectId correlation store.
func newHandlers(src *LiveSource, st *State, hub *Hub, codes *Codes) *handlers {
	return newHandlersWithEntities(src, st, hub, codes, NewEntityStore())
}

func newHandlersWithEntities(src *LiveSource, st *State, hub *Hub, codes *Codes, entities *EntityStore) *handlers {
	var diagnostics *protocolDiagnostics
	if src != nil {
		diagnostics = src.diagnostics
	}
	return newHandlersWithDiagnostics(diagnostics, st, hub, codes, entities)
}

func newHandlersWithDiagnostics(diagnostics *protocolDiagnostics, st *State, hub *Hub, codes *Codes, entities *EntityStore) *handlers {
	if entities == nil {
		entities = NewEntityStore()
	}
	return &handlers{diag: diagnostics, st: st, hub: hub, codes: codes, entities: entities}
}

// realCode resolves the dispatch code from Photon parameter 252 (events) or
// 253 (operations): the parameter is the authority because it carries the full
// 16-bit code, while the envelope byte truncates high codes. When the message
// does not duplicate the code in the parameter, the envelope byte is the
// fallback so low-code packets keep routing; callers record that byte
// separately for diagnostics.
func realCode(params map[byte]any, key byte, envelope byte) (int32, bool) {
	v, ok := params[key]
	if !ok {
		// Protocol16/18 do not always duplicate the logical operation/event
		// code in parameters 253/252. For codes that fit in the Photon
		// envelope byte, the envelope keeps the message routing; high codes
		// still require parameter 252 because the envelope necessarily
		// truncates them.
		return int32(envelope), true
	}
	var n int64
	switch value := v.(type) {
	case byte:
		n = int64(value)
	case int16:
		n = int64(value)
	case int32:
		n = int64(value)
	case int64:
		n = value
	default:
		return 0, false
	}
	if n < 0 || n > 32767 {
		return 0, false
	}
	return int32(n), true
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

// paramBool acepta el booleano del protocolo en cualquiera de sus formas
// (bool puro o entero distinto de cero), igual que ObjectToBool de SAT.
func (h *handlers) paramBool(event string, params map[byte]any, field string) (bool, bool) {
	v, ok := h.param(event, params, field)
	if !ok {
		return false, false
	}
	switch value := v.(type) {
	case bool:
		return value, true
	case byte:
		return value != 0, true
	case int16:
		return value != 0, true
	case int32:
		return value != 0, true
	case int64:
		return value != 0, true
	}
	return false, false
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
	// Build the pre-existing roster internally, but do not expose party/entity
	// state until JoinResponse establishes which member is local.
	if !h.st.HasValidIdentity() {
		return
	}
	h.st.SyncRegistry(h.entities.Snapshot(), h.entities.PartyEntities())
}

// No metrics are accepted before a complete JoinResponse identity exists.
// Once detected, the optional character filter is enforced by State as a real
// backend guard rather than merely a saved UI preference.
func (h *handlers) trackingAllowed() bool {
	return h.st.MetricsAllowed()
}

// request registra y procesa el contexto de operaciones salientes. No usa el
// pedido para detectar identidad: el servidor la confirma en una respuesta
// exitosa de Join, junto con el GUID y ObjectId locales.
func (h *handlers) request(op *photon.OperationRequest) {
	h.st.MarkDecoded()
	h.recordEnvelope(false, op.Code)
	code, ok := realCode(op.Parameters, h.codes.OperationCodeKey(), op.Code)
	if !ok {
		h.recordMissingCode(false)
		return
	}
	h.recordOperation(code)
	// ChangeCluster request parameter 0 is the gate/target ObjectId, not the
	// destination map. Only the server response contains the new cluster.
	// Treating requests as responses made the UI briefly (or permanently, when
	// the response was lost) report zones such as "2" or "-57".
	//
	// Las operaciones que SÍ importan del lado cliente son las de pesca (la
	// captura entera viaja en requests) y la apertura de cofres.
	name, _ := h.codes.OperationName(code)
	switch name {
	case "FishingStart":
		h.fishingStart(op.Parameters)
	case "FishingCatch":
		h.fishingCatch(op.Parameters)
	case "FishingFinish":
		h.fishingFinish(op.Parameters)
	case "FishingCancel":
		h.fishingCancel()
	case "UseLootChest":
		if h.dungeon != nil && h.trackingAllowed() {
			h.dungeon.Chests++
		}
	}
}

// response procesa las respuestas del servidor. La aplicación de referencia
// resuelve el personaje local desde JoinResponse (operación 2): parámetros 0
// para el id de entidad, 1 para GUID, 2 para el nombre y 8 para el mapa.
func (h *handlers) response(op *photon.OperationResponse) {
	h.st.MarkDecoded()
	h.recordEnvelope(false, op.Code)
	// El ReturnCode NO descarta la respuesta. La aplicación de referencia lo
	// recibe en OnResponse y lo ignora: el handler corre igual. Filtrar por él
	// tiraba JoinResponse legítimos cuando el campo traía un valor distinto de
	// cero o se decodificaba mal. Se registra para diagnóstico y la decisión
	// real queda en decodeJoinResponse, que exige los datos de identidad.
	h.recordReturnCode(op.ReturnCode)
	code, ok := realCode(op.Parameters, h.codes.OperationCodeKey(), op.Code)
	if !ok {
		h.recordMissingCode(false)
		return
	}
	h.recordOperation(code)
	h.identifyJoinResponse(code, op.Parameters)
	h.operation(code, op.Parameters)
}

func (h *handlers) recordEnvelope(event bool, code byte) { h.diag.envelope(event, code) }

func (h *handlers) recordMissingCode(event bool) { h.diag.missingCode(event) }

// recordReturnCode guarda el ReturnCode observado. No filtra nada: existe para
// que el diagnóstico muestre si el servidor manda códigos distintos de cero.
func (h *handlers) recordReturnCode(code int16) { h.diag.returnCode(code) }

// recordOperation maintains privacy-safe diagnostics: only codes and counts,
// never player names, GUIDs, or packet parameters.
func (h *handlers) recordOperation(code int32) { h.diag.logical(false, code) }

// identifyJoinResponse applies the Join response model adapted from SAT:
// name, ObjectId and GUID come from a successful server response, not from the
// client request. GUID is the durable key; ObjectId is kept as the lookup key
// needed by combat and loot events in the current zone.
func (h *handlers) identifyJoinResponse(code int32, params map[byte]any) {
	name, ok := h.codes.OperationName(code)
	if !ok || name != h.codes.SelfOp.Operation {
		return
	}

	join, confirmed, identifiable := decodeJoinResponse(h.codes, params)
	if !identifiable {
		return
	}
	if !confirmed {
		// El servidor dijo quién sos, pero sin GUID no hay clave estable para
		// atribuir daño, fama ni botín. Se muestra el personaje y se deja el
		// registro de entidades intacto: las métricas siguen cerradas hasta
		// que llegue un Join completo.
		h.st.ApplyPartialJoinIdentity(LocalIdentity{
			ObjectID: join.ObjectID, Name: join.Name,
			Guild: join.Guild, Alliance: join.Alliance,
		}, join.Zone)
		h.hub.Publish(NewEvent("status", h.st.Snapshot()))
		return
	}
	// Clear zone-transient ObjectIDs before installing Join's fresh local ID;
	// GUID-keyed party membership survives this boundary.
	h.entities.BeginZone()
	local, err := h.entities.SetLocal(entityUpdate{
		ObjectID: join.ObjectID, HasObjectID: true, GUID: join.GUID,
		Name: join.Name, Guild: join.Guild, Alliance: join.Alliance,
	})
	if err != nil {
		return
	}
	// El JoinResponse también es una señal de cambio de mapa (parámetro 8):
	// la app de referencia abre las partidas de mazmorra exactamente ahí. La
	// comparación contra la zona vigente hay que hacerla ANTES de que el
	// estado aplique la zona nueva del propio Join.
	prevZone := h.st.Zone()
	zoneWasCurrent := h.st.IsCurrentZone(join.Zone)
	if !h.st.ApplyJoinIdentityAndRegistry(LocalIdentity{
		ObjectID: local.ObjectID, GUID: local.GUID, Name: local.Name,
		Guild: local.Guild, Alliance: local.Alliance,
	}, join.Zone, h.entities.Snapshot(), h.entities.PartyEntities()) {
		return
	}
	if join.Zone != "" && !zoneWasCurrent {
		h.applyZoneChange(prevZone, join.Zone)
	}

	// ChangeCluster can update world state later, but it cannot bootstrap
	// identity if this authoritative JoinResponse was missed.
	h.hub.Publish(NewEvent("status", h.st.Snapshot()))
}

// operation atiende las operaciones que no identifican al personaje pero sí
// cambian el contexto de la sesión. ChangeCluster es la importante: Albion la
// manda como OPERACIÓN (no como evento) cada vez que el personaje cambia de
// zona, y su respuesta trae el cluster nuevo en el parámetro 0.
func (h *handlers) operation(code int32, params map[byte]any) {
	name, ok := h.codes.OperationName(code)
	if !ok {
		return
	}
	if name == "ChangeCluster" {
		change, valid := h.decodeChangeCluster(params)
		if !valid {
			return
		}
		h.enterZone(change.Zone)
	}
}

// enterZone aplica un cambio de zona con deduplicación: para una misma
// transición llegan hasta TRES señales (respuesta de ChangeCluster,
// JoinResponse y evento JoinFinished) y todas deben converger en un solo
// cambio de estado.
func (h *handlers) enterZone(zone string) {
	if zone == "" || !h.st.HasValidIdentity() {
		return
	}
	if h.st.IsCurrentZone(zone) {
		return
	}
	h.applyZoneChange(h.st.Zone(), zone)
}

// applyZoneChange ejecuta el cambio de zona: cierra (o continúa) la partida
// de mazmorra, invalida los ObjectId de la zona anterior y abre la partida
// nueva si corresponde.
func (h *handlers) applyZoneChange(prevZone, zone string) {
	cluster, instance := splitZone(zone)
	if cluster == "" {
		return
	}

	// Salir de una instancia cierra la partida antes de mover el estado: el
	// resumen se calcula con los contadores de la mazmorra que termina. Los
	// pasillos encadenados de una aleatoria continúan la MISMA partida (con
	// su foto de contadores original: la fama se acumula entre pasillos).
	if h.continueDungeon(cluster) {
		if h.dungeon != nil {
			h.dungeon.Cluster, h.dungeon.Instance = cluster, instance
		}
	} else {
		h.finishDungeon()
	}

	h.fishingCancel()
	h.pendingKills = nil

	h.entities.BeginZone()
	h.st.EnterZone(zone)
	h.hub.Publish(NewEvent("map", map[string]any{"zone": zone}))
	h.hub.Publish(NewEvent("status", h.st.Snapshot()))

	// Solo se abre una partida nueva si no hubo continuación: beginDungeon
	// re-fotografía los contadores y pisaría la partida en curso.
	if h.dungeon == nil {
		h.beginDungeon(prevZone, cluster, instance)
	}
}

// clusterName normaliza el identificador de zona que manda Albion. Puede ser
// un índice numérico ("1234"), un nombre de cluster, o una cadena compuesta
// "guid@tipo@extra" en mazmorras y refugios: en ese caso la app de referencia
// se queda con el primer tramo.
func worldLocation(v any) string {
	switch value := v.(type) {
	case string:
		return strings.TrimSpace(value)
	case nil:
		return ""
	default:
		if n, ok := num(v); ok {
			return fmt.Sprintf("%d", n)
		}
	}
	return ""
}

func clusterName(v any) string {
	name := worldLocation(v)
	if i := strings.IndexByte(name, '@'); i > 0 {
		return name[:i]
	}
	return name
}

func (h *handlers) event(ev *photon.EventData) {
	h.st.MarkDecoded()
	h.recordEnvelope(true, ev.Code)
	// Parameter 252 is authoritative. The envelope byte is diagnostic only.
	code, ok := realCode(ev.Parameters, h.codes.EventCodeKey(), ev.Code)
	if !ok {
		h.recordMissingCode(true)
		return
	}

	h.diag.logical(true, code)

	name, ok := h.codes.EventName(code)
	if !ok {
		return // código fuera de la tabla: se ignora en silencio
	}
	p := ev.Parameters

	switch name {
	case "NewCharacter":
		character := h.decodeNewCharacter(p)
		if character.HasObjectID || character.GUID != "" || character.Name != "" {
			h.entities.Upsert(entityUpdate{ObjectID: character.ObjectID, HasObjectID: character.HasObjectID, GUID: character.GUID, Name: character.Name, Guild: character.Guild, Alliance: character.Alliance})
			h.syncRoster()
		}

	case "Leave":
		if id, ok := h.paramNum(name, p, "id"); ok {
			h.entities.ClearObjectID(id)
			h.syncRoster()
		}

	// ChangeCluster NO existe como evento: es una operación y se atiende en
	// operation(). Acá solo queda JoinFinished, que confirma la entrada al
	// mapa después de un Join.
	case "JoinFinished":
		if joined, ok := h.decodeJoinFinished(p); ok {
			h.enterZone(joined.Zone)
		}

	case "HealthUpdate":
		h.health(name, p)

	case "HealthUpdates":
		for _, update := range h.decodeHealthUpdates(p).Updates {
			h.applyHealth(update)
		}

	case "UpdateFame":
		if !h.trackingAllowed() {
			break
		}
		if gained, ok := h.paramNum(name, p, "gained"); ok && gained > 0 {
			// SAT records TotalGainedFame, not just FameWithZoneMultiplier:
			// premium and satchel fame are separate FixPoint parameters.
			totalInternal := float64(gained)
			premium := false
			if value, known := h.paramBool(name, p, "premiumBonus"); known { premium = value }
			if premium { totalInternal += math.Round(float64(gained) * 0.5) }
			satchel, _ := h.paramNum(name, p, "satchel")
			if satchel > 0 { totalInternal += float64(satchel) }
			amount := int64(math.Round(totalInternal)) / 10000
			if h.st.AddFame(amount) {
				h.hub.Publish(NewEvent("fame", map[string]any{
					"amount": amount,
					"total": h.st.Fame(),
					"premium": premium,
					"satchel": satchel / 10000,
				}))
			}
		}

	case "UpdateReSpecPoints":
		if !h.trackingAllowed() { break }
		payload := map[string]any{"amount": int64(0), "total": h.st.Respec()}
		changed := false
		if gained, ok := h.paramNum(name, p, "gained"); ok && gained > 0 {
			amount := gained / 10000
			if h.st.AddRespec(amount) {
				payload["amount"], payload["total"] = amount, h.st.Respec()
				changed = true
			}
		}
		if paid, paidOK := h.paramNum(name, p, "paidSilver"); paidOK && paid > 0 {
			cost := paid / 10000
			if h.st.AddPaidRespecSilver(cost) { payload["paidSilver"], changed = cost, true }
		}
		if changed { h.hub.Publish(NewEvent("respec", payload)) }

	case "TakeSilver":
		if !h.trackingAllowed() {
			break
		}
		// La plata recogida del mundo solo cuenta si la levantó el personaje
		// propio: el servidor también reporta la de la party.
		id, idOK := h.paramNum(name, p, "id")
		target, _ := h.paramNum(name, p, "target")
		isLocal := idOK && h.isSelf(id)
		isParty := idOK && h.entities.IsPartyObjectID(id) && id != target
		if !isLocal && !isParty { break }
		preTax, ok := h.paramNum(name, p, "amount")
		if !ok || preTax <= 0 { break }
		clusterTax, _ := h.paramNum(name, p, "clusterTax")
		guildTax, _ := h.paramNum(name, p, "guildTax")
		alliancePenalty, _ := h.paramNum(name, p, "alliancePenalty")
		if isLocal && id != target && preTax > 0 {
			h.silverTaxes = silverTaxRates{
				cluster: float64(clusterTax) / float64(preTax),
				guild: float64(guildTax) / float64(preTax),
				alliance: float64(alliancePenalty) / float64(preTax),
				valid: true,
			}
		}
		// Party TakeSilver packets are estimates: SAT reuses the local
		// player's last observed tax percentages so the party total is not
		// inflated by missing per-member tax metadata.
		if isParty && !isLocal && h.silverTaxes.valid {
			clusterTax = int64(math.Round(float64(preTax) * h.silverTaxes.cluster))
			guildTax = int64(math.Round(float64(preTax) * h.silverTaxes.guild))
			alliancePenalty = int64(math.Round(float64(preTax) * h.silverTaxes.alliance))
		}
		net := preTax - clusterTax - guildTax - alliancePenalty
		if net < 0 { net = 0 }
		amount := net / 10000
		if amount > 0 && h.st.AddSilver(amount) {
			h.hub.Publish(NewEvent("silver", map[string]any{
				"amount": amount,
				"total": h.st.Silver(),
				"source": "ground",
				"preTax": preTax / 10000,
				"tax": (clusterTax + guildTax + alliancePenalty) / 10000,
			}))
		}

	case "UpdateCurrency":
		// SAT treats UpdateCurrency as faction points, not silver. Silver from
		// the world is handled by TakeSilver.
		if h.trackingAllowed() {
			if gained, ok := h.paramNum(name, p, "gained"); ok && gained > 0 {
				amount := gained / 10000
				city, _ := h.paramNum(name, p, "cityFaction")
				if h.st.AddFactionPoints(amount) {
					h.hub.Publish(NewEvent("faction", map[string]any{"amount": amount, "total": h.st.FactionPoints(), "cityFaction": city}))
				}
			}
		}

	case "UpdateFactionStanding":
		if h.trackingAllowed() {
			if gained, ok := h.paramNum(name, p, "gained"); ok && gained > 0 {
				amount := gained / 10000
				city, _ := h.paramNum(name, p, "cityFaction")
				if h.st.AddFactionStanding(amount) {
					h.hub.Publish(NewEvent("factionStanding", map[string]any{"amount": amount, "total": h.st.FactionStanding(), "cityFaction": city}))
				}
			}
		}

	case "PartyJoined":
		party := h.decodePartyJoined(p)
		h.entities.SetParty(party.Members)
		h.syncRoster()
		h.hub.Publish(NewEvent("status", h.st.Snapshot()))

	case "PartyPlayerJoined":
		joined := h.decodePartyPlayerJoined(p)
		h.entities.AddPartyMember(joined.Member)
		h.syncRoster()
		h.hub.Publish(NewEvent("status", h.st.Snapshot()))

	case "PartyPlayerLeft":
		left := h.decodePartyPlayerLeft(p)
		if left.GUID != "" {
			h.entities.RemovePartyMemberByGUID(left.GUID)
		} else if left.HasObjectID {
			h.entities.RemovePartyMemberByObjectID(left.ObjectID)
		}
		h.syncRoster()
		h.hub.Publish(NewEvent("status", h.st.Snapshot()))

	case "PartyDisbanded":
		_ = h.decodePartyDisbanded(p)
		h.entities.ResetPartyKeepLocal()
		h.syncRoster()
		h.hub.Publish(NewEvent("status", h.st.Snapshot()))

	case "HarvestFinished":
		h.harvest(p)

	case "NewSimpleItem", "NewEquipmentItem":
		h.fishingDiscover(name, p)

	case "RewardGranted":
		h.fishingReward(p)

	case "NewRandomDungeonExit":
		if h.trackingAllowed() {
			dungeonType, _ := h.paramStr(name, p, "dungeonType")
			uniqueName, _ := h.paramStr(name, p, "uniqueName")
			level, _ := h.paramNum(name, p, "level")
			alreadyEntered, _ := h.paramBool(name, p, "alreadyEntered")
			h.refineDungeonRun(dungeonType, uniqueName, level, alreadyEntered)
		}

	case "MightAndFavorReceived":
		if h.trackingAllowed() {
			might, _ := h.paramNum(name, p, "might")
			favor, _ := h.paramNum(name, p, "favor")
			might, favor = might/10000, favor/10000
			if h.st.AddMight(might) { h.hub.Publish(NewEvent("might", map[string]any{"amount": might, "total": h.st.Might()})) }
			if h.st.AddFavor(favor) { h.hub.Publish(NewEvent("favor", map[string]any{"amount": favor, "total": h.st.Favor()})) }
			if h.dungeon != nil { h.dungeon.Might += might; h.dungeon.Favor += favor }
		}
	case "KilledPlayer":
		if h.trackingAllowed() {
			killerID, killerOK := h.paramNum(name, p, "killer")
			victimID, victimOK := h.paramNum(name, p, "victimId")
			victimName, _ := h.paramStr(name, p, "victim")
			if killerOK && victimOK {
				if killer, exists := h.entities.ByObjectID(killerID); exists && killer.InParty {
					h.pendingKills = append(h.pendingKills, pendingPlayerKill{victimID: victimID, victimName: victimName, killer: killer, at: time.Now()})
				}
			}
		}

	case "Died":
		if h.trackingAllowed() {
			victimID, victimOK := h.paramNum(name, p, "victimId")
			killerID, _ := h.paramNum(name, p, "killerId")
			isLethal, lethalKnown := h.paramBool(name, p, "isLethal")
			if !lethalKnown { isLethal = true } // older captures omitted the field
			if victimOK {
				if victim, exists := h.entities.ByObjectID(victimID); exists && victim.InParty && isLethal {
					if h.st.AddDeathEntity(victim) && victim.Local && h.dungeon != nil { h.dungeon.Deaths++ }
					if victim.Local { h.hub.Publish(NewEvent("died", map[string]any{"victim": victim.Name})) }
				}
				// KilledPlayer is only a candidate in SAT; Died is the confirmation.
				for i := len(h.pendingKills) - 1; i >= 0; i-- {
					candidate := h.pendingKills[i]
					if time.Since(candidate.at) > 10*time.Second {
						h.pendingKills = append(h.pendingKills[:i], h.pendingKills[i+1:]...)
						continue
					}
					if candidate.victimID != victimID || (killerID != 0 && candidate.killer.HasObjectID && candidate.killer.ObjectID != killerID) { continue }
					h.pendingKills = append(h.pendingKills[:i], h.pendingKills[i+1:]...)
					if isLethal && h.st.AddKillEntity(candidate.killer) {
						h.hub.Publish(NewEvent("kill", map[string]any{"killer": candidate.killer.Name, "victim": candidate.victimName}))
					}
					break
				}
			}
		}
	case "OtherGrabbedLoot":
		h.loot(name, p)
	}
}

// harvest publica una recolección terminada para la pestaña Recolección.
// Solo cuenta la del personaje propio: el servidor también informa las de
// otros jugadores visibles en la zona.
func (h *handlers) harvest(p map[byte]any) {
	if !h.trackingAllowed() {
		return
	}
	data, ok := h.decodeHarvestFinished(p)
	if !ok {
		return
	}
	if data.HasUser && !h.isSelf(data.UserObjectID) {
		return
	}
	// Sin identificar al recolector no se puede afirmar que sea propio.
	if !data.HasUser {
		return
	}
	uid := fmt.Sprintf("gat-%d-%d", time.Now().UnixNano(), data.ItemID)
	if data.HasObject { uid = fmt.Sprintf("gat-object-%d", data.ObjectID) }
	h.hub.Publish(NewEvent("gathering", map[string]any{
		"uid":      uid,
		"ts":       time.Now().UnixMilli(),
		"itemId":   fmt.Sprintf("%d", data.ItemID),
		"quantity": data.Total(),
		"map":      h.st.Zone(),
	}))
}

// health traduce el evento de cambio de vida en daño o curación.
// En Albion, un valor negativo es daño y uno positivo es curación.
func (h *handlers) health(event string, p map[byte]any) {
	targetID, ok1 := h.paramNum(event, p, "target")
	value, ok2 := h.paramNum(event, p, "value")
	if !ok1 || !ok2 { return }
	sourceID, _ := h.paramNum(event, p, "source")
	update := HealthUpdateData{TargetID: targetID, SourceID: sourceID, Value: value}
	if newHealth, ok := h.paramNum(event, p, "newHealth"); ok { update.NewHealth, update.HasNewHealth = newHealth, true }
	h.applyHealth(update)
}

func (h *handlers) applyHealth(update HealthUpdateData) {
	if !h.trackingAllowed() || update.Value == 0 { return }
	target, targetKnown := h.entities.ByObjectID(update.TargetID)
	source, sourceKnown := h.entities.ByObjectID(update.SourceID)
	amount := update.Value / 10000
	if amount == 0 { return }

	if amount < 0 {
		damage := -amount
		addedDamage := sourceKnown && source.InParty && h.st.AddDamageEntity(source, target, damage)
		selfDamage := sourceKnown && targetKnown && source.HasObjectID && target.HasObjectID && source.ObjectID == target.ObjectID
		addedTaken := targetKnown && target.InParty && !selfDamage && h.st.AddTakenDamageEntity(target, damage)
		if addedDamage || addedTaken {
			h.hub.Publish(NewEvent("damage", map[string]any{"source": source.Name, "target": target.Name, "amount": damage}))
		}
		return
	}

	if !sourceKnown || !source.InParty { return }
	if h.st.AddHealingEntity(source, amount, 0) {
		h.hub.Publish(NewEvent("heal", map[string]any{"source": source.Name, "target": target.Name, "amount": amount}))
	}
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
	looterEntity, ok := h.entities.PartyByName(looter)
	if !ok {
		return // botín únicamente propio o de la party identificada por GUID
	}
	if qty <= 0 {
		qty = 1
	}
	entry := LootEntry{
		Player:     looterEntity.Name,
		PlayerGUID: looterEntity.GUID,
		ItemID:     fmt.Sprintf("%d", itemID),
		Quantity:   int(qty),
		Source:     "mundo",
	}
	if h.st.AddLoot(entry) {
		h.hub.Publish(NewEvent("loot", entry))
	}
}
