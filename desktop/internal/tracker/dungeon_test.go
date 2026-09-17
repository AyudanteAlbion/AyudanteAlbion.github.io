// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 SheniaLiam — gremio Spetsnaz Grail

package tracker

import (
	"encoding/json"
	"testing"

	"ayudante-albion-desktop/internal/tracker/photon"
)

// Todas las zonas y códigos de este archivo usan los formatos REALES del
// protocolo, documentados con capturas en la app de referencia (SAT):
//
//	"@RANDOMDUNGEON@fe968505-9771-4653-8ade-29a1bd6ddb56"
//	"@HIDEOUT@2306@29c344b3-2138-421d-a97c-06e29d4759ec"
//	"@MISTS@9283d553-ab71-4c14-bb34-64567137419a"
//	"@ISLAND@c640e642-5135-4203-89b5-0007e4215605"
//	"DNG-KPR-02-MAIN-021" (cluster fijo del world.xml)
//
// Los códigos numéricos nunca se fijan acá: se resuelven de la tabla
// distribuida (photon_codes.json), que se edita tras cada patch.

// drain recoge los eventos ya publicados de un tipo y los devuelve decodificados.
func drain(events <-chan Event, kind string) []map[string]any {
	var out []map[string]any
	for {
		select {
		case ev := <-events:
			if ev.Type != kind {
				continue
			}
			var payload map[string]any
			if err := json.Unmarshal(ev.Payload, &payload); err == nil {
				out = append(out, payload)
			}
		default:
			return out
		}
	}
}

// eventByCodeOf busca el código numérico de un evento por su nombre lógico.
// Los tests no pueden fijar un número: la tabla se edita tras cada patch de
// Albion, así que el código se resuelve desde la tabla que se distribuye.
func (c *Codes) eventByCodeOf(name string) (int32, bool) {
	for code, indexed := range c.eventByCode {
		if indexed == name {
			return code, true
		}
	}
	return 0, false
}

// operationByCodeOf hace lo mismo para las operaciones.
func (c *Codes) operationByCodeOf(name string) (int32, bool) {
	for code, indexed := range c.opByCode {
		if indexed == name {
			return code, true
		}
	}
	return 0, false
}

// newTestSession arranca una sesión con la identidad instalada por el
// JoinResponse real (respuesta de la operación Join, parámetros 0/1/2) y el
// personaje parado en una ciudad ("3003" = Caerleon en el índice del mundo).
func newTestSession(t *testing.T) (*handlers, *State, *Hub) {
	t.Helper()
	state := NewState()
	hub := NewHub()
	handler := newHandlers(nil, state, hub, testCodes(t))
	joinCode, ok := testCodes(t).operationByCodeOf(handler.codes.SelfOp.Operation)
	if !ok {
		t.Fatalf("la tabla distribuida no tiene la operación %q", handler.codes.SelfOp.Operation)
	}
	handler.response(&photon.OperationResponse{
		Code:       byte(joinCode),
		ReturnCode: 0,
		Parameters: map[byte]any{
			0: int64(42), 1: localGUIDBytes, 2: "Anon",
			8: "3003", 253: int64(joinCode),
		},
	})
	if !state.HasValidIdentity() {
		t.Fatal("el JoinResponse de prueba no instaló la identidad")
	}
	return handler, state, hub
}

// changeCluster simula la respuesta del servidor a ChangeCluster: el cluster
// nuevo viaja en el parámetro 0 como índice del mundo o token de instancia.
func changeCluster(t *testing.T, handler *handlers, zone string) {
	t.Helper()
	code, ok := handler.codes.operationByCodeOf("ChangeCluster")
	if !ok {
		t.Skip("la tabla distribuida no tiene ChangeCluster")
	}
	handler.response(&photon.OperationResponse{
		Code:       byte(code),
		ReturnCode: 0,
		Parameters: map[byte]any{0: zone, 253: int64(code)},
	})
}

// fireEvent dispara un evento del protocolo con su código resuelto de la
// tabla y el parámetro 252 (eventCode) presente, como en los paquetes reales.
func fireEvent(t *testing.T, handler *handlers, name string, params map[byte]any) {
	t.Helper()
	code, ok := handler.codes.eventByCodeOf(name)
	if !ok {
		t.Skipf("la tabla distribuida no tiene el evento %q", name)
	}
	if params == nil {
		params = map[byte]any{}
	}
	params[252] = int64(code)
	handler.event(&photon.EventData{Code: byte(code), Parameters: params})
}

// sendRequest simula una operación del cliente (las de pesca viajan así).
func sendRequest(t *testing.T, handler *handlers, name string, params map[byte]any) {
	t.Helper()
	code, ok := handler.codes.operationByCodeOf(name)
	if !ok {
		t.Skipf("la tabla distribuida no tiene la operación %q", name)
	}
	if params == nil {
		params = map[byte]any{}
	}
	params[253] = int64(code)
	handler.request(&photon.OperationRequest{Code: byte(code), Parameters: params})
}

// El formato de zona del protocolo: "@TOKEN@guid" para instancias, "cluster"
// a secas para mapas fijos, "cluster@instancia" como formato interno viejo.
func TestSplitZoneWireFormats(t *testing.T) {
	cases := []struct {
		zone                     string
		wantCluster, wantInstance string
	}{
		{"@RANDOMDUNGEON@fe968505-9771-4653-8ade-29a1bd6ddb56", "RANDOMDUNGEON", "fe968505-9771-4653-8ade-29a1bd6ddb56"},
		{"@HIDEOUT@2306@29c344b3-2138-421d-a97c-06e29d4759ec", "HIDEOUT", "2306@29c344b3-2138-421d-a97c-06e29d4759ec"},
		{"@MISTS@9283d553-ab71-4c14-bb34-64567137419a", "MISTS", "9283d553-ab71-4c14-bb34-64567137419a"},
		{"DNG-KPR-02-MAIN-021", "DNG-KPR-02-MAIN-021", ""},
		{"3003", "3003", ""},
		{"Martlock", "Martlock", ""},
		{"Thetford@instance-1", "Thetford", "instance-1"},
		{"", "", ""},
	}
	for _, tc := range cases {
		cluster, instance := splitZone(tc.zone)
		if cluster != tc.wantCluster || instance != tc.wantInstance {
			t.Errorf("splitZone(%q) = (%q, %q), want (%q, %q)",
				tc.zone, cluster, instance, tc.wantCluster, tc.wantInstance)
		}
	}
}

// La clasificación de zonas replica WorldData.GetMapType / IsDungeonCluster
// de la app de referencia: token primero (MISTSDUNGEON antes que MISTS), y el
// índice del mundo solo abre partidas para estáticas DUNGEON_*.
func TestDungeonKindForZoneMatchesReference(t *testing.T) {
	cases := []struct {
		cluster, instance     string
		wantKind              string
		wantTier, wantLevel   int
	}{
		{"RANDOMDUNGEON", "fe968505-9771-4653-8ade-29a1bd6ddb56", "standard", 0, 0},
		{"CORRUPTEDDUNGEON", "b7e64a12-9d3c-4f8a-b1e2-6c9d0a4f7e31", "corrupted", 0, 0},
		{"HELLCLUSTER", "e2f8c4d6-1a3b-4e7f-9c2d-8b5a6f0e4c19", "hellgate", 0, 0},
		{"EXPEDITION", "5d1f8a2b-3c4d-4e5f-9a8b-7c6d5e4f3a2b", "hce", 0, 0},
		{"MISTSDUNGEON", "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", "knightfall", 0, 0},
		{"MISTS", "9283d553-ab71-4c14-bb34-64567137419a", "mists", 0, 0},
		{"HELLDUNGEON", "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", "abyssal", 0, 0},
		{"DRAGONAREA", "d4c3b2a1-f0e9-4d8c-7b6a-595847464544", "ancient", 0, 0},
		{"DNG-KPR-02-MAIN-021", "", "static", 5, 3},
		{"DNG-KPR-02-MAIN-010", "", "static", 5, 1},
		// Ninguna de estas zonas abre partida, igual que en la referencia.
		{"ISLAND", "c640e642-5135-4203-89b5-0007e4215605", "", 0, 0},
		{"HIDEOUT", "2306@29c344b3-2138-421d-a97c-06e29d4759ec", "", 0, 0},
		{"TNL-151", "", "", 0, 0},              // camino avaloniano
		{"ARENA-01", "", "", 0, 0},             // arena
		{"FishyBusiness-HRD", "", "", 0, 0},    // HCE de cluster fijo
		{"3003", "", "", 0, 0},                 // ciudad
		{"DNG-MISTS-UND-WIP-01-01", "", "", 0, 0}, // mazmorra de las Nieblas
	}
	for _, tc := range cases {
		kind, world := dungeonKindForZone(tc.cluster, tc.instance)
		if kind != tc.wantKind {
			t.Errorf("dungeonKindForZone(%q) tipo = %q, want %q", tc.cluster, kind, tc.wantKind)
			continue
		}
		if world.Tier != tc.wantTier || world.Level != tc.wantLevel {
			t.Errorf("dungeonKindForZone(%q) mundo = T%d/Q%d, want T%d/Q%d",
				tc.cluster, world.Tier, world.Level, tc.wantTier, tc.wantLevel)
		}
	}
}

// Flujo completo de una mazmorra aleatoria con los paquetes reales: se entra
// por la respuesta de ChangeCluster, la salida del evento NewRandomDungeonExit
// la marca como solitaria T7, y al salir a la ciudad se publica la partida con
// la fama, la plata, el poder/favor y las muertes acumulados adentro.
func TestRandomDungeonRunWithRealPackets(t *testing.T) {
	handler, state, hub := newTestSession(t)
	events, unsubscribe := hub.Subscribe()
	defer unsubscribe()

	changeCluster(t, handler, "@RANDOMDUNGEON@fe968505-9771-4653-8ade-29a1bd6ddb56")
	if handler.dungeon == nil {
		t.Fatal("entrar a una instancia @RANDOMDUNGEON@ no abrió la partida")
	}
	if handler.dungeon.Type != "standard" {
		t.Fatalf("tipo inicial = %q, want standard (sin refinar)", handler.dungeon.Type)
	}

	// La salida de la mazmorra trae el modo y el tier reales.
	fireEvent(t, handler, "NewRandomDungeonExit", map[byte]any{
		0: int64(9001), 3: "T7_SOLO_RD", 4: "T7_SOLO", 9: int64(2), 10: false,
	})
	if handler.dungeon.Type != "solo" || handler.dungeon.Tier != 7 {
		t.Fatalf("tras la salida: tipo=%q tier=%d, want solo T7", handler.dungeon.Type, handler.dungeon.Tier)
	}
	if handler.dungeon.Level != 2 {
		t.Fatalf("nivel = %d, want 2", handler.dungeon.Level)
	}

	state.AddFame(5000)
	state.AddSilver(1200)
	fireEvent(t, handler, "MightAndFavorReceived", map[byte]any{
		1: int64(630630000), 4: int64(150150000),
	})
	fireEvent(t, handler, "Died", map[byte]any{1: int64(42)})

	changeCluster(t, handler, "3003")
	if handler.dungeon != nil {
		t.Fatal("salir de la instancia no cerró la partida")
	}

	runs := drain(events, "dungeonRun")
	if len(runs) != 1 {
		t.Fatalf("eventos dungeonRun = %d, want 1", len(runs))
	}
	run := runs[0]
	for key, want := range map[string]any{
		"type": "solo", "tier": float64(7), "level": float64(2),
		"fame": float64(5000), "silver": float64(1200),
		"might": float64(63063), "favor": float64(15015), "deaths": float64(1),
	} {
		if run[key] != want {
			t.Errorf("%s = %v, want %v", key, run[key], want)
		}
	}
	if run["zone"] != "@RANDOMDUNGEON@fe968505-9771-4653-8ade-29a1bd6ddb56" {
		t.Errorf("zone = %v, want el token de instancia completo", run["zone"])
	}
}

// Los pasillos de una mazmorra aleatoria encadenan instancias distintas con el
// mismo token: es UNA sola partida, no una por pasillo.
func TestRandomDungeonCorridorsContinueSameRun(t *testing.T) {
	handler, state, hub := newTestSession(t)
	events, unsubscribe := hub.Subscribe()
	defer unsubscribe()

	changeCluster(t, handler, "@RANDOMDUNGEON@0d5b7de9-4f0a-4a2d-9c28-55d0a3e2f1aa")
	state.AddFame(3000)
	changeCluster(t, handler, "@RANDOMDUNGEON@11c8d9f0-1a2b-4c3d-8e9f-0a1b2c3d4e5f")
	if handler.dungeon == nil {
		t.Fatal("el segundo pasillo cerró la partida")
	}
	if got := len(drain(events, "dungeonRun")); got != 0 {
		t.Fatalf("cambiar de pasillo publicó %d partidas, want 0", got)
	}
	state.AddFame(2000)
	changeCluster(t, handler, "3003")

	runs := drain(events, "dungeonRun")
	if len(runs) != 1 {
		t.Fatalf("eventos dungeonRun = %d, want 1", len(runs))
	}
	if runs[0]["fame"] != float64(5000) {
		t.Errorf("fama = %v, want 5000 (la suma de los dos pasillos)", runs[0]["fame"])
	}
}

// Si la respuesta de ChangeCluster se pierde, el JoinResponse (parámetro 8)
// es la segunda señal de cambio de zona: una corrupta debe abrir partida igual.
func TestDungeonRunOpensWhenChangeClusterIsLost(t *testing.T) {
	handler, state, hub := newTestSession(t)
	events, unsubscribe := hub.Subscribe()
	defer unsubscribe()

	joinCode, _ := handler.codes.operationByCodeOf(handler.codes.SelfOp.Operation)
	handler.response(&photon.OperationResponse{
		Code:       byte(joinCode),
		ReturnCode: 0,
		Parameters: map[byte]any{
			0: int64(42), 1: localGUIDBytes, 2: "Anon",
			8: "@CORRUPTEDDUNGEON@b7e64a12-9d3c-4f8a-b1e2-6c9d0a4f7e31", 253: int64(joinCode),
		},
	})
	if handler.dungeon == nil || handler.dungeon.Type != "corrupted" {
		t.Fatalf("el JoinResponse dentro de la corrupta no abrió la partida: %+v", handler.dungeon)
	}
	state.AddFame(1000)

	changeCluster(t, handler, "3003")
	runs := drain(events, "dungeonRun")
	if len(runs) != 1 || runs[0]["type"] != "corrupted" {
		t.Fatalf("partidas publicadas = %v, want 1 corrupta", runs)
	}
}

// Una estática negra se entra como cluster fijo del world.xml: el tier y el
// nivel Q salen del índice embebido.
func TestStaticDungeonRunFromWorldIndex(t *testing.T) {
	handler, state, hub := newTestSession(t)
	events, unsubscribe := hub.Subscribe()
	defer unsubscribe()

	changeCluster(t, handler, "DNG-KPR-02-MAIN-021")
	if handler.dungeon == nil || handler.dungeon.Type != "static" {
		t.Fatalf("entrar a la estática no abrió la partida: %+v", handler.dungeon)
	}
	if handler.dungeon.Tier != 5 || handler.dungeon.Level != 3 {
		t.Fatalf("tier/nivel = T%d/Q%d, want T5/Q3", handler.dungeon.Tier, handler.dungeon.Level)
	}
	state.AddFame(800)
	changeCluster(t, handler, "3003")

	runs := drain(events, "dungeonRun")
	if len(runs) != 1 {
		t.Fatalf("eventos dungeonRun = %d, want 1", len(runs))
	}
	if runs[0]["tier"] != float64(5) || runs[0]["level"] != float64(3) {
		t.Errorf("tier/level = %v/%v, want 5/3", runs[0]["tier"], runs[0]["level"])
	}
}

// Ciudades, caminos avalonianos, islas, escondites, arenas y HCE de cluster
// fijo no abren partidas: son las mismas exclusiones que la referencia.
func TestNonDungeonZonesNeverOpenRuns(t *testing.T) {
	handler, _, _ := newTestSession(t)
	for _, zone := range []string{
		"3003", "Martlock", "TNL-151", "ARENA-01", "FishyBusiness-HRD",
		"@ISLAND@c640e642-5135-4203-89b5-0007e4215605",
		"@HIDEOUT@2306@29c344b3-2138-421d-a97c-06e29d4759ec",
		"DNG-MISTS-UND-WIP-01-01",
	} {
		changeCluster(t, handler, zone)
		if handler.dungeon != nil {
			t.Fatalf("la zona %q abrió una partida de mazmorra", zone)
		}
	}
}

// Una niebla y su mazmorra (Abadía de Knightfall) son DOS partidas distintas.
func TestMistsAndMistsDungeonAreSeparateRuns(t *testing.T) {
	handler, state, hub := newTestSession(t)
	events, unsubscribe := hub.Subscribe()
	defer unsubscribe()

	changeCluster(t, handler, "@MISTS@9283d553-ab71-4c14-bb34-64567137419a")
	if handler.dungeon == nil || handler.dungeon.Type != "mists" {
		t.Fatalf("la niebla no abrió su partida: %+v", handler.dungeon)
	}
	state.AddFame(400)
	changeCluster(t, handler, "@MISTSDUNGEON@1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d")
	if handler.dungeon == nil || handler.dungeon.Type != "knightfall" {
		t.Fatalf("la mazmorra de las Nieblas no abrió su partida: %+v", handler.dungeon)
	}
	state.AddFame(600)
	changeCluster(t, handler, "3003")

	runs := drain(events, "dungeonRun")
	if len(runs) != 2 {
		t.Fatalf("eventos dungeonRun = %d, want 2", len(runs))
	}
	if runs[0]["type"] != "mists" || runs[1]["type"] != "knightfall" {
		t.Fatalf("tipos = %v y %v, want mists y knightfall", runs[0]["type"], runs[1]["type"])
	}
}

// La pesca no emite HarvestFinished: la captura entera viaja en operaciones
// del cliente (FishingStart/Catch/Finish) más los ítems descubiertos y el
// RewardGranted, como en GatheringController de la referencia.
func TestFishingPublishesGathering(t *testing.T) {
	handler, _, hub := newTestSession(t)
	events, unsubscribe := hub.Subscribe()
	defer unsubscribe()

	sendRequest(t, handler, "FishingStart", map[byte]any{0: int64(77), 2: int64(1000)})
	sendRequest(t, handler, "FishingCatch", map[byte]any{0: int64(77)})
	fireEvent(t, handler, "NewSimpleItem", map[byte]any{0: int64(5001), 1: int64(144), 2: int64(1)})
	fireEvent(t, handler, "RewardGranted", map[byte]any{1: int64(144), 3: int64(2)})
	sendRequest(t, handler, "FishingFinish", map[byte]any{1: true})

	rows := drain(events, "gathering")
	if len(rows) != 1 {
		t.Fatalf("eventos gathering = %d, want 1", len(rows))
	}
	if rows[0]["itemId"] != "144" || rows[0]["quantity"] != float64(2) {
		t.Errorf("captura = %v, want itemId 144 cantidad 2", rows[0])
	}
	if rows[0]["fished"] != true {
		t.Errorf("fished = %v, want true", rows[0]["fished"])
	}

	// Cancelar la pesca descarta todo lo descubierto.
	sendRequest(t, handler, "FishingStart", map[byte]any{0: int64(78), 2: int64(1000)})
	sendRequest(t, handler, "FishingCatch", map[byte]any{0: int64(78)})
	fireEvent(t, handler, "RewardGranted", map[byte]any{1: int64(144), 3: int64(1)})
	sendRequest(t, handler, "FishingCancel", nil)
	sendRequest(t, handler, "FishingFinish", map[byte]any{1: true})
	if got := len(drain(events, "gathering")); got != 0 {
		t.Fatalf("una pesca cancelada publicó %d recolecciones", got)
	}
}

// Un RewardGranted ajeno a la pesca (por ejemplo una recompensa de evento)
// nunca se registra como recolección: no hay picada activa.
func TestRewardOutsideFishingIsIgnored(t *testing.T) {
	handler, _, hub := newTestSession(t)
	events, unsubscribe := hub.Subscribe()
	defer unsubscribe()

	fireEvent(t, handler, "RewardGranted", map[byte]any{1: int64(144), 3: int64(5)})
	if got := len(drain(events, "gathering")); got != 0 {
		t.Fatalf("un reward sin pesca publicó %d recolecciones", got)
	}
}

// La recolección del personaje propio se publica para la pestaña Recolección
// sumando las tres porciones (base + bonus de recolector + premium).
func TestHarvestFinishedPublishesOwnGathering(t *testing.T) {
	handler, _, hub := newTestSession(t)
	events, unsubscribe := hub.Subscribe()
	defer unsubscribe()

	fireEvent(t, handler, "HarvestFinished", map[byte]any{
		0: int64(42), 4: int64(1234), 5: int64(3), 6: int64(2), 7: int64(1),
	})

	rows := drain(events, "gathering")
	if len(rows) != 1 {
		t.Fatalf("gathering events = %d, want 1", len(rows))
	}
	if rows[0]["quantity"] != float64(6) {
		t.Fatalf("quantity = %v, want 6 (3+2+1)", rows[0]["quantity"])
	}
	if rows[0]["itemId"] != "1234" {
		t.Fatalf("itemId = %v, want \"1234\"", rows[0]["itemId"])
	}
}

// La recolección de otro jugador visible en la zona no es nuestra: no debe
// sumarse a las estadísticas del personaje propio.
func TestHarvestFinishedIgnoresOtherPlayers(t *testing.T) {
	handler, _, hub := newTestSession(t)
	events, unsubscribe := hub.Subscribe()
	defer unsubscribe()

	fireEvent(t, handler, "HarvestFinished", map[byte]any{
		0: int64(777), 4: int64(1234), 5: int64(9),
	})

	if rows := drain(events, "gathering"); len(rows) != 0 {
		t.Fatalf("another player's harvest was recorded: %v", rows)
	}
}
