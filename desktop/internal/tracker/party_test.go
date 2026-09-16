// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 SheniaLiam — gremio Spetsnaz Grail

package tracker

import (
	"reflect"
	"testing"

	"ayudante-albion-desktop/internal/tracker/photon"
)

// This exercises the Photon parameter layout used by SAT's PartyJoined and
// PartyPlayerLeft handlers: the roster uses concatenated 16-byte GUIDs and a
// parallel name array, while incremental updates address one GUID.
func TestPartyEventsCorrelateRosterByGUID(t *testing.T) {
	state := NewState()
	handler := newHandlers(nil, state, NewHub(), testCodes(t))

	handler.response(&photon.OperationResponse{
		Code:       2,
		ReturnCode: 0,
		Parameters: map[byte]any{0: int64(42), 1: localGUIDBytes, 2: "Yo"},
	})
	allGUIDs := append(append([]byte(nil), localGUIDBytes...), partyGUIDBytes...)
	handler.event(&photon.EventData{
		Code:       231,
		Parameters: map[byte]any{8: allGUIDs, 9: []string{"Yo", "Aliada"}, 252: int64(231)},
	})
	if got, want := state.Snapshot().Party, []string{"Yo", "Aliada"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("Party after PartyJoined = %#v, want %#v", got, want)
	}

	handler.event(&photon.EventData{
		Code:       235,
		Parameters: map[byte]any{1: partyGUIDBytes, 252: int64(235)},
	})
	if got, want := state.Snapshot().Party, []string{"Yo"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("Party after PartyPlayerLeft = %#v, want %#v", got, want)
	}

	handler.event(&photon.EventData{
		Code:       233,
		Parameters: map[byte]any{1: partyGUIDBytes, 2: "Aliada", 252: int64(233)},
	})
	handler.event(&photon.EventData{
		Code:       232,
		Parameters: map[byte]any{252: int64(232)},
	})
	if got, want := state.Snapshot().Party, []string{"Yo"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("Party after PartyDisbanded = %#v, want %#v", got, want)
	}
}
