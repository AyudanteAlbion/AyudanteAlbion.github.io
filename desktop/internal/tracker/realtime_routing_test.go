package tracker

import (
	"testing"

	"ayudante-albion-desktop/internal/tracker/photon"
)

// Photon packets can carry the logical code only in the envelope. This is
// common for low (<256) event and operation codes and must not stop live data.
func TestRealCodeFallsBackToEnvelope(t *testing.T) {
	got, ok := realCode(map[byte]any{}, 252, 61)
	if !ok || got != 61 {
		t.Fatalf("realCode without parameter = %d/%v, want 61/true", got, ok)
	}
}

// A ChangeCluster request contains the portal ObjectId in parameter zero. The
// destination zone exists only in the response, so requests must never mutate
// world state.
func TestChangeClusterRequestDoesNotBecomeZone(t *testing.T) {
	state := NewState()
	handler := newHandlers(nil, state, NewHub(), testCodes(t))
	handler.response(&photon.OperationResponse{
		Code: 2,
		Parameters: map[byte]any{0: int64(42), 1: localGUIDBytes, 2: "Anon", 8: "Martlock"},
	})

	handler.request(&photon.OperationRequest{Code: 41, Parameters: map[byte]any{0: int64(9876)}})
	if got := state.Zone(); got != "Martlock" {
		t.Fatalf("zone after ChangeCluster request = %q, want Martlock", got)
	}

	handler.response(&photon.OperationResponse{Code: 41, Parameters: map[byte]any{0: "Mase Knoll"}})
	if got := state.Zone(); got != "Mase Knoll" {
		t.Fatalf("zone after ChangeCluster response = %q, want Mase Knoll", got)
	}
}

// HarvestFinished also has to route when 252 is absent. It should immediately
// publish the gathering event for the local character.
func TestHarvestRoutesFromEnvelopeCode(t *testing.T) {
	state := NewState()
	hub := NewHub()
	handler := newHandlers(nil, state, hub, testCodes(t))
	handler.response(&photon.OperationResponse{
		Code: 2,
		Parameters: map[byte]any{0: int64(42), 1: localGUIDBytes, 2: "Anon", 8: "Martlock"},
	})
	stream, cancel := hub.Subscribe()
	defer cancel()

	handler.event(&photon.EventData{Code: 61, Parameters: map[byte]any{
		0: int64(42), 4: int64(1000), 5: int64(2), 6: int64(1), 7: int64(1),
	}})
	select {
	case event := <-stream:
		if event.Type != "gathering" {
			t.Fatalf("event type = %q, want gathering", event.Type)
		}
	default:
		t.Fatal("HarvestFinished did not publish a realtime gathering event")
	}
}
