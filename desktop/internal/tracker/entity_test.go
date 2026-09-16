// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 SheniaLiam — gremio Spetsnaz Grail

package tracker

import (
	"reflect"
	"testing"

	"ayudante-albion-desktop/internal/tracker/photon"
)

var (
	localGUIDBytes = []byte{0x33, 0x22, 0x11, 0x00, 0x55, 0x44, 0x77, 0x66, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff}
	partyGUIDBytes = []byte{0x10, 0x32, 0x54, 0x76, 0x98, 0xba, 0xdc, 0xfe, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0}
)

func TestGUIDFromPhotonUsesSystemGuidByteOrder(t *testing.T) {
	guid, ok := GUIDFromPhoton(photon.CustomValue{Code: 1, Data: localGUIDBytes})
	if !ok {
		t.Fatal("GUIDFromPhoton() did not accept a 16-byte Protocol18 custom value")
	}
	if want := "00112233-4455-6677-8899-aabbccddeeff"; guid != want {
		t.Fatalf("GUIDFromPhoton() = %q, want %q", guid, want)
	}
}

func TestEntityStoreRebindsObjectIDByGUID(t *testing.T) {
	store := NewEntityStore()
	localGUID, _ := GUIDFromPhoton(localGUIDBytes)
	store.SetLocal(entityUpdate{GUID: localGUID, ObjectID: 42, HasObjectID: true, Name: "Yo"})

	store.BeginZone()
	store.Upsert(entityUpdate{GUID: localGUID, ObjectID: 99, HasObjectID: true, Name: "Yo"})

	if store.IsLocalObjectID(42) {
		t.Fatal("old ObjectId must not stay associated after a GUID rebind")
	}
	if !store.IsLocalObjectID(99) {
		t.Fatal("new ObjectId must resolve to the local GUID")
	}
	if got := store.NameOfObjectID(99); got != "Yo" {
		t.Fatalf("NameOfObjectID(99) = %q, want Yo", got)
	}
}

func TestEntityStorePartyLifecycleKeepsLocalPlayer(t *testing.T) {
	store := NewEntityStore()
	localGUID, _ := GUIDFromPhoton(localGUIDBytes)
	partyGUID, _ := GUIDFromPhoton(partyGUIDBytes)
	store.SetLocal(entityUpdate{GUID: localGUID, ObjectID: 42, HasObjectID: true, Name: "Yo"})

	store.SetParty([]partyMember{{GUID: localGUID, Name: "Yo"}, {GUID: partyGUID, Name: "Aliada"}})
	if got, want := store.PartyNames(), []string{"Yo", "Aliada"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("PartyNames() = %#v, want %#v", got, want)
	}

	store.RemovePartyMemberByGUID(partyGUID)
	if got, want := store.PartyNames(), []string{"Yo"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("PartyNames() after leave = %#v, want %#v", got, want)
	}

	store.AddPartyMember(partyMember{GUID: partyGUID, Name: "Aliada"})
	store.ResetPartyKeepLocal()
	if got, want := store.PartyNames(), []string{"Yo"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("PartyNames() after disband = %#v, want %#v", got, want)
	}
}

func TestMainCharacterFilterDoesNotGuessIdentity(t *testing.T) {
	state := NewState()
	handler := newHandlers(nil, state, NewHub(), testCodes(t))
	state.SetTrackingCharacter("PersonajeElegido")
	if !handler.trackingAllowed() {
		t.Fatal("filter must remain permissive before Join identifies a character")
	}

	state.SetCharacter("OtroPersonaje")
	state.SetParty([]string{"OtroPersonaje", "Aliada"})
	if handler.trackingAllowed() {
		t.Fatal("a different confirmed local character must block session statistics")
	}
	if state.IsTrackedPlayer("OtroPersonaje") || state.IsTrackedPlayer("Aliada") {
		t.Fatal("a rejected character must not admit its own party")
	}

	state.SetCharacter("PersonajeElegido")
	if !handler.trackingAllowed() || !state.IsTrackedPlayer("PersonajeElegido") || !state.IsTrackedPlayer("Aliada") {
		t.Fatal("the configured local character and its party must be tracked")
	}
}
