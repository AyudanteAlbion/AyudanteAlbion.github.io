package tracker

import (
	"net"
	"testing"
)

func TestPacketPipelineDrivesCaptureIdentityWorldAndParty(t *testing.T) {
	state := NewState()
	state.PrepareCapture("test")
	state.CaptureOpened("test", 1)
	codes := testCodes(t)
	pipeline := newPacketPipeline(nil, state, NewHub(), codes, NewEntityStore(), nil)
	pipeline.server.stableFor = 0
	packet := func(name string) CapturedDatagram {
		return CapturedDatagram{Adapter: "test-adapter", SourceIP: net.ParseIP("5.188.125.10"), SourcePort: 5055, DestinationPort: 5056, Payload: photonFixture(t, name)}
	}

	pipeline.Ingest(packet("join_response.hex"))
	snapshot := state.Snapshot()
	if snapshot.Capture.Phase != CaptureCharacter || !snapshot.Capture.ServerConfirmed || !snapshot.Identity.Valid || snapshot.Identity.Name != "AnonPlayer" || snapshot.World.Map != "Martlock" {
		t.Fatalf("Join pipeline state = %+v", snapshot)
	}

	pipeline.Ingest(packet("party_complete.hex"))
	snapshot = state.Snapshot()
	if len(snapshot.PartyState.Members) != 2 || snapshot.PartyState.Members[0].GUID == "" || snapshot.PartyState.Members[1].GUID == "" {
		t.Fatalf("party pipeline state = %+v", snapshot.PartyState)
	}

	before := snapshot.Capture.EncryptedDropped
	pipeline.Ingest(packet("encrypted_discard.hex"))
	if after := state.Snapshot().Capture.EncryptedDropped; after != before+1 {
		t.Fatalf("encrypted dropped = %d, want %d", after, before+1)
	}
}
