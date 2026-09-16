package tracker

import (
	"testing"

	"ayudante-albion-desktop/internal/tracker/photon"
)

func diagnosticHandlers(t *testing.T, state *State) (*handlers, *LiveSource) {
	t.Helper()
	codes := testCodes(t)
	store := &CodeStore{}
	store.set(codes, "")
	source := NewLiveSource(store)
	source.SetDiagnostic(true)
	return newHandlers(source, state, NewHub(), codes), source
}

func TestAuthoritativeCodesOverrideEnvelopeMetadata(t *testing.T) {
	state := NewState()
	handler, source := diagnosticHandlers(t, state)
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
	source.mu.Lock()
	defer source.mu.Unlock()
	if source.diagOpEnvelope[2] == 0 || source.diagOpEnvelope[41] == 0 || source.diagEventEnvelope[29] == 0 || source.diagMissingCodes == 0 {
		t.Fatalf("safe envelope diagnostics not recorded: operations=%v events=%v missing=%d", source.diagOpEnvelope, source.diagEventEnvelope, source.diagMissingCodes)
	}
}

func TestInvalidAuthoritativeCodeIsDiscarded(t *testing.T) {
	state := NewState()
	handler, source := diagnosticHandlers(t, state)
	handler.response(&photon.OperationResponse{ReturnCode: 0, Parameters: map[byte]any{0: int64(42), 1: localGUIDBytes, 2: "Anon", 253: int64(40000)}})
	handler.event(&photon.EventData{Parameters: map[byte]any{0: int64(77), 1: "Other", 252: "not-a-code"}})
	snapshot := state.Snapshot()
	if snapshot.Identity.Valid || len(snapshot.Entities) != 0 {
		t.Fatal("invalid signed-16-bit authority reached a typed handler")
	}
	source.mu.Lock()
	defer source.mu.Unlock()
	if source.diagMissingCodes != 2 {
		t.Fatalf("invalid authority diagnostics missing count = %d, want 2", source.diagMissingCodes)
	}
}
