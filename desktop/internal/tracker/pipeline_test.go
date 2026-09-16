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
	pipeline.Ingest(packet("join_response.hex"))
	if revision := state.Snapshot().Identity.Revision; revision != snapshot.Identity.Revision {
		t.Fatalf("duplicate raw-socket datagram applied Join twice: revision = %d", revision)
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

// Prueba de regresión del corte más temprano de la cadena: un JoinResponse
// real con relleno al final, entrando por la MISMA ruta que en producción.
// Antes, Inspect() anulaba el datagrama entero y pipeline.Ingest lo descartaba
// sin llegar al parser, así que el personaje nunca se detectaba. Las pruebas
// existentes no lo veían porque llamaban al parser directamente.
func TestPipelineDetectsCharacterFromPaddedJoinResponse(t *testing.T) {
	state := NewState()
	state.PrepareCapture("test")
	state.CaptureOpened("test", 1)
	pipeline := newPacketPipeline(nil, state, NewHub(), testCodes(t), NewEntityStore(), nil)
	pipeline.server.stableFor = 0

	payload := append(photonFixture(t, "join_response.hex"), 0x00, 0x00, 0x00)
	pipeline.Ingest(CapturedDatagram{
		Adapter: "test-adapter", SourceIP: net.ParseIP("5.188.125.10"),
		SourcePort: 5055, DestinationPort: 5056, Payload: payload,
	})

	snapshot := state.Snapshot()
	if !snapshot.Identity.Valid || snapshot.Identity.Name != "AnonPlayer" {
		t.Fatalf("JoinResponse con relleno no identificó al personaje: %+v", snapshot.Identity)
	}
	if snapshot.Capture.Phase != CaptureCharacter {
		t.Fatalf("Phase = %q, want %q", snapshot.Capture.Phase, CaptureCharacter)
	}
}
