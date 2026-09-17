// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 SheniaLiam — gremio Spetsnaz Grail

package tracker

import (
	"encoding/json"
	"testing"

	"ayudante-albion-desktop/internal/tracker/photon"
)

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

func TestDungeonKindClassifiesInstances(t *testing.T) {
	cases := map[string]string{
		"RANDOMDUNGEON@SOLO":      "solo",
		"RANDOMDUNGEON@STANDARD":  "standard",
		"CORRUPTEDDUNGEON":        "corrupted",
		"HELLGATE":                "hellgate",
		"AVALONDUNGEON":           "avalonian",
		"MISTSDUNGEON":            "mists",
		"EXPEDITION":              "hce",
		"RANDOMDUNGEON@STATIC":    "static",
		"DUNGEON":                 "standard",
		"HIDEOUT":                 "",
		"":                        "",
		"PLAYERISLAND":            "",
		"KNIGHTFALLABBEY_DUNGEON": "knightfall",
	}
	for instance, want := range cases {
		if got := dungeonKind(instance); got != want {
			t.Errorf("dungeonKind(%q) = %q, want %q", instance, got, want)
		}
	}
}

func TestDungeonTierReadsTokenOnly(t *testing.T) {
	cases := map[string]int{
		"RANDOMDUNGEON@SOLO@T6": 6,
		"T4_DUNGEON":            4,
		"RANDOMDUNGEON":         0, // la T de DUNGEON no es un tier
		"":                      0,
		"T9_DUNGEON":            0, // fuera de rango
	}
	for instance, want := range cases {
		if got := dungeonTier(instance); got != want {
			t.Errorf("dungeonTier(%q) = %d, want %d", instance, got, want)
		}
	}
}

// Entrar a una instancia de mazmorra y salir publica una partida con la fama
// ganada adentro, sin que el usuario active nada en la pestaña Mazmorras.
func TestDungeonRunPublishedOnExitWithFameDelta(t *testing.T) {
	state := NewState()
	hub := NewHub()
	handler := newHandlers(nil, state, hub, testCodes(t))
	state.ApplyJoinIdentity(LocalIdentity{ObjectID: 1, GUID: "00000000-0000-0000-0000-000000000001", Name: "Anon"})

	events, unsubscribe := hub.Subscribe()
	defer unsubscribe()

	handler.enterZone("3007@RANDOMDUNGEON@SOLO")
	if handler.dungeon == nil {
		t.Fatal("entering a dungeon instance did not open a run")
	}
	state.AddFame(5000)
	state.AddSilver(1200)
	handler.enterZone("Martlock")
	if handler.dungeon != nil {
		t.Fatal("leaving the instance did not close the run")
	}

	runs := drain(events, "dungeonRun")
	if len(runs) != 1 {
		t.Fatalf("dungeonRun events = %d, want 1", len(runs))
	}
	run := runs[0]
	if run["type"] != "solo" {
		t.Errorf("type = %v, want solo", run["type"])
	}
	if run["fame"] != float64(5000) {
		t.Errorf("fame = %v, want 5000", run["fame"])
	}
	if run["silver"] != float64(1200) {
		t.Errorf("silver = %v, want 1200", run["silver"])
	}
}

// Una ciudad no es una mazmorra: moverse entre zonas abiertas no debe generar
// partidas fantasma en la pestaña Mazmorras.
func TestOpenWorldZonesDoNotOpenRuns(t *testing.T) {
	state := NewState()
	handler := newHandlers(nil, state, NewHub(), testCodes(t))
	state.ApplyJoinIdentity(LocalIdentity{ObjectID: 1, GUID: "00000000-0000-0000-0000-000000000001", Name: "Anon"})

	handler.enterZone("Martlock")
	if handler.dungeon != nil {
		t.Fatal("a city must not open a dungeon run")
	}
	handler.enterZone("Mase Knoll")
	if handler.dungeon != nil {
		t.Fatal("an open-world zone must not open a dungeon run")
	}
}

// La recolección del personaje propio se publica para la pestaña Recolección
// sumando las tres porciones (base + bonus de recolector + premium).
func TestHarvestFinishedPublishesOwnGathering(t *testing.T) {
	state := NewState()
	hub := NewHub()
	codes := testCodes(t)
	handler := newHandlers(nil, state, hub, codes)
	// La identidad tiene que entrar por el JoinResponse real: es lo que
	// registra el ObjectID local en el store que consulta isSelf().
	handler.response(&photon.OperationResponse{ReturnCode: 0, Parameters: map[byte]any{
		0: int64(42), 1: localGUIDBytes, 2: "Anon", 253: int64(2),
	}})

	events, unsubscribe := hub.Subscribe()
	defer unsubscribe()

	code, ok := codes.eventByCodeOf("HarvestFinished")
	if !ok {
		t.Skip("HarvestFinished is disabled in the shipped table")
	}
	handler.event(&photon.EventData{Code: byte(code), Parameters: map[byte]any{
		0: int64(42), 4: int64(1234), 5: int64(3), 6: int64(2), 7: int64(1),
		252: int64(code),
	}})

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
	state := NewState()
	hub := NewHub()
	codes := testCodes(t)
	handler := newHandlers(nil, state, hub, codes)
	// La identidad tiene que entrar por el JoinResponse real: es lo que
	// registra el ObjectID local en el store que consulta isSelf().
	handler.response(&photon.OperationResponse{ReturnCode: 0, Parameters: map[byte]any{
		0: int64(42), 1: localGUIDBytes, 2: "Anon", 253: int64(2),
	}})

	events, unsubscribe := hub.Subscribe()
	defer unsubscribe()

	code, ok := codes.eventByCodeOf("HarvestFinished")
	if !ok {
		t.Skip("HarvestFinished is disabled in the shipped table")
	}
	handler.event(&photon.EventData{Code: byte(code), Parameters: map[byte]any{
		0: int64(777), 4: int64(1234), 5: int64(9), 252: int64(code),
	}})

	if rows := drain(events, "gathering"); len(rows) != 0 {
		t.Fatalf("another player's harvest was recorded: %v", rows)
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
