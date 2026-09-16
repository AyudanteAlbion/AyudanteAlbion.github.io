package tracker

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ayudante-albion-desktop/internal/tracker/photon"
)

func photonFixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "photon", name))
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := hex.DecodeString(strings.TrimSpace(string(data)))
	if err != nil {
		t.Fatal(err)
	}
	return decoded
}

func TestAnonymizedPhotonFixtures(t *testing.T) {
	var responses, events int
	parser := photon.NewParser(photon.Handler{OnResponse: func(*photon.OperationResponse) { responses++ }, OnEvent: func(*photon.EventData) { events++ }})
	if !parser.Receive(photonFixture(t, "join_response.hex")) || responses != 1 {
		t.Fatalf("normal JoinResponse callbacks = %d, want 1", responses)
	}
	if !parser.Receive(photonFixture(t, "change_cluster.hex")) || responses != 2 {
		t.Fatalf("ChangeCluster callbacks = %d, want 2", responses)
	}
	if !parser.Receive(photonFixture(t, "party_complete.hex")) || events != 1 {
		t.Fatalf("party callbacks = %d, want 1", events)
	}

	responses, events = 0, 0
	parser = photon.NewParser(photon.Handler{OnResponse: func(*photon.OperationResponse) { responses++ }, OnEvent: func(*photon.EventData) { events++ }})
	if !parser.Receive(photonFixture(t, "multi_message_udp.hex")) || responses != 2 || events != 1 {
		t.Fatalf("coalesced callbacks = (%d,%d), want (2,1)", responses, events)
	}

	encrypted := photonFixture(t, "encrypted_discard.hex")
	inspection := photon.Inspect(encrypted)
	if !inspection.Valid || !inspection.Encrypted || parser.Receive(encrypted) {
		t.Fatalf("encrypted classification = %+v; receive must discard", inspection)
	}
}

func TestAnonymizedFragmentedJoinResponseFixture(t *testing.T) {
	var fixture struct {
		Fragments []string `json:"fragments"`
	}
	data, err := os.ReadFile(filepath.Join("testdata", "photon", "join_response_fragmented.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	responses := 0
	parser := photon.NewParser(photon.Handler{OnResponse: func(*photon.OperationResponse) { responses++ }})
	for _, encoded := range fixture.Fragments {
		packet, err := hex.DecodeString(encoded)
		if err != nil {
			t.Fatal(err)
		}
		if !parser.Receive(packet) {
			t.Fatal("valid fragment rejected")
		}
	}
	if responses != 1 {
		t.Fatalf("fragmented JoinResponse callbacks = %d, want 1", responses)
	}
}
