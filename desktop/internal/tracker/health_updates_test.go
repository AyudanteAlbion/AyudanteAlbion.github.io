package tracker

import (
	"testing"

	"ayudante-albion-desktop/internal/tracker/photon"
)

func TestBatchedHealthUpdatesUseGUIDPartyAndIdentityGate(t *testing.T) {
	state := NewState()
	handler := newHandlers(nil, state, NewHub(), testCodes(t))
	// A pre-Join batch must not create a metric.
	handler.event(&photon.EventData{Code: 7, Parameters: map[byte]any{0: int64(42), 2: []float64{-100000}, 6: []int64{42}, 252: int64(7)}})
	if len(state.Snapshot().Combatants) != 0 {
		t.Fatal("pre-identity HealthUpdates created combat metrics")
	}

	handler.response(&photon.OperationResponse{ReturnCode: 0, Parameters: map[byte]any{0: int64(42), 1: localGUIDBytes, 2: "Anon", 253: int64(2)}})
	handler.event(&photon.EventData{Code: 7, Parameters: map[byte]any{0: int64(42), 2: []float64{-100000, 50000}, 6: []int64{42, 42}, 252: int64(7)}})
	snapshot := state.Snapshot()
	if len(snapshot.Combatants) != 1 || snapshot.Combatants[0].Damage != 10 || snapshot.Combatants[0].Healing != 5 {
		t.Fatalf("batched health metrics = %+v", snapshot.Combatants)
	}
}
