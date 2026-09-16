package tracker

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSessionPersistenceRequiresRealConfirmedIdentity(t *testing.T) {
	store := &sessionStore{directory: t.TempDir()}
	state := NewState()
	if err := store.Save(state.Snapshot()); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(store.directory)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatal("pre-identity snapshot was persisted")
	}

	identity := LocalIdentity{ObjectID: 1, GUID: "00000000-0000-0000-0000-000000000001", Name: "Anon"}
	state.ApplyJoinIdentity(identity)
	if err := store.Save(state.Snapshot()); err != nil {
		t.Fatal(err)
	}
	entries, err = os.ReadDir(store.directory)
	if err != nil || len(entries) != 1 {
		t.Fatalf("saved entries = %d, err = %v", len(entries), err)
	}
	if mode, err := os.Stat(filepath.Join(store.directory, entries[0].Name())); err != nil || mode.Mode().Perm()&0077 != 0 {
		t.Fatalf("session file permissions = %v, err = %v", mode, err)
	}

	demo := NewState()
	demo.SetDemoCapture(true)
	demo.ApplyJoinIdentity(identity)
	before := len(entries)
	if err := store.Save(demo.Snapshot()); err != nil {
		t.Fatal(err)
	}
	entries, _ = os.ReadDir(store.directory)
	if len(entries) != before {
		t.Fatal("demo snapshot was persisted")
	}
}
