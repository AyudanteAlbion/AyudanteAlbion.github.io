package tracker

import "testing"

func TestRelogContinuesSameCharacterAndResetsDifferentCharacter(t *testing.T) {
	state := NewState()
	first := LocalIdentity{ObjectID: 1, GUID: "00000000-0000-0000-0000-000000000001", Name: "First"}
	state.ApplyJoinIdentity(first)
	if !state.AddFame(10) {
		t.Fatal("first identity did not enable metrics")
	}

	state.ClearCharacter()
	first.ObjectID = 2
	state.ApplyJoinIdentity(first)
	if got := state.Snapshot().Fame; got != 10 {
		t.Fatalf("same-character relog fame = %d, want 10", got)
	}

	state.ClearCharacter()
	state.ApplyJoinIdentity(LocalIdentity{ObjectID: 3, GUID: "00000000-0000-0000-0000-000000000002", Name: "Second"})
	if got := state.Snapshot().Fame; got != 0 {
		t.Fatalf("different-character fame = %d, want reset", got)
	}
}
