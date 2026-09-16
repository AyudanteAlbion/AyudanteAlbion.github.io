package tracker

import (
	"testing"

	"ayudante-albion-desktop/internal/tracker/photon"
)

func TestAuthoritativeCodesOverrideEnvelopeMetadata(t *testing.T) {
	state := NewState()
	handler := newHandlers(nil, state, NewHub(), testCodes(t))
	handler.response(&photon.OperationResponse{Code: 41, ReturnCode: 0, Parameters: map[byte]any{0: int64(42), 1: localGUIDBytes, 2: "Anon", 253: int64(2)}})
	if !state.Snapshot().Identity.Valid {
		t.Fatal("authoritative Join code did not override envelope metadata")
	}
	handler.response(&photon.OperationResponse{Code: 2, ReturnCode: 0, Parameters: map[byte]any{0: "Thetford@instance", 253: int64(41)}})
	if state.Zone() != "Thetford" || state.Snapshot().World.Instance != "instance" {
		t.Fatalf("operation envelope code was treated as authority: %+v", state.Snapshot().World)
	}

	before := state.Snapshot().Identity.Revision
	handler.response(&photon.OperationResponse{Code: 41, ReturnCode: 0, Parameters: map[byte]any{0: int64(99), 1: partyGUIDBytes, 2: "Wrong"}})
	if state.Snapshot().Identity.Revision != before {
		t.Fatal("response without authoritative parameter 253 entered typed dispatch")
	}

	handler.event(&photon.EventData{Code: 29, Parameters: map[byte]any{8: [][]byte{localGUIDBytes, partyGUIDBytes}, 9: []string{"Anon", "Ally"}, 252: int64(231)}})
	if got := len(state.Snapshot().PartyState.Members); got != 2 {
		t.Fatalf("event authority dispatched envelope code: party size = %d", got)
	}
	diagnostics := state.Snapshot().Capture.Diagnostics
	if diagnostics.EnvelopeOperationCodes["2"] == 0 || diagnostics.EnvelopeOperationCodes["41"] == 0 || diagnostics.EnvelopeEventCodes["29"] == 0 || diagnostics.MissingOperationCode == 0 {
		t.Fatalf("safe envelope diagnostics not recorded: %+v", diagnostics)
	}
}

func TestInvalidAuthoritativeCodeIsDiscarded(t *testing.T) {
	state := NewState()
	handler := newHandlers(nil, state, NewHub(), testCodes(t))
	handler.response(&photon.OperationResponse{ReturnCode: 0, Parameters: map[byte]any{0: int64(42), 1: localGUIDBytes, 2: "Anon", 253: int64(40000)}})
	handler.event(&photon.EventData{Parameters: map[byte]any{0: int64(77), 1: "Other", 252: "not-a-code"}})
	snapshot := state.Snapshot()
	if snapshot.Identity.Valid || len(snapshot.Entities) != 0 {
		t.Fatal("invalid signed-16-bit authority reached a typed handler")
	}
	if snapshot.Capture.Diagnostics.MissingOperationCode != 1 || snapshot.Capture.Diagnostics.MissingEventCode != 1 {
		t.Fatalf("invalid authority diagnostics = %+v", snapshot.Capture.Diagnostics)
	}
}
