package tracker

import "testing"

func TestRealCapturePhaseContract(t *testing.T) {
	state := NewState()
	if phase := state.Snapshot().Capture.Phase; phase != CaptureOff {
		t.Fatalf("initial phase = %s", phase)
	}
	state.PrepareCapture("npcap")
	if phase := state.Snapshot().Capture.Phase; phase != CapturePreparing {
		t.Fatalf("prepare phase = %s", phase)
	}
	state.CaptureOpened("npcap", 2)
	if phase := state.Snapshot().Capture.Phase; phase != CaptureNetwork {
		t.Fatalf("network phase = %s", phase)
	}
	state.MarkPhoton("adapter", false, 3)
	if snapshot := state.Snapshot(); snapshot.Capture.Phase != CapturePhoton || snapshot.Capture.PhotonPackets != 3 {
		t.Fatalf("Photon state = %+v", snapshot.Capture)
	}
	state.ConfirmServer("Americas")
	if phase := state.Snapshot().Capture.Phase; phase != CaptureWaitingJoin {
		t.Fatalf("waiting phase = %s", phase)
	}
	state.ApplyJoinIdentity(LocalIdentity{ObjectID: 1, GUID: "00000000-0000-0000-0000-000000000001", Name: "Anon"})
	if phase := state.Snapshot().Capture.Phase; phase != CaptureCharacter {
		t.Fatalf("character phase = %s", phase)
	}
	state.CaptureRecovering("npcap", "network changed")
	if snapshot := state.Snapshot(); snapshot.Capture.Phase != CapturePreparing || snapshot.Capture.ServerConfirmed || snapshot.Capture.PhotonPackets != 0 {
		t.Fatalf("recovery state = %+v", snapshot.Capture)
	}
}

func TestDemoPhaseIsNeverRealCapture(t *testing.T) {
	state := NewState()
	state.SetDemoCapture(true)
	snapshot := state.Snapshot()
	if snapshot.Capture.Phase != CaptureDemo || snapshot.Capture.RealCapture || !snapshot.Simulated {
		t.Fatalf("demo state = %+v", snapshot)
	}
}
