package tracker

import "testing"

func TestAllRealMetricsRequireValidMatchingLocalIdentity(t *testing.T) {
	state := NewState()
	local := Entity{GUID: "00000000-0000-0000-0000-000000000001", ObjectID: 1, HasObjectID: true, Name: "Anon", Local: true, InParty: true}
	state.SyncRegistry([]Entity{local}, []Entity{local})
	if state.AddDamageEntity(local, Entity{}, 100) || state.AddFame(10) || state.AddSilver(20) || state.AddRespec(30) || state.AddLoot(LootEntry{PlayerGUID: local.GUID, ItemID: "T4_TEST", Quantity: 1}) {
		t.Fatal("pre-identity metric was accepted")
	}
	snapshot := state.Snapshot()
	if snapshot.Damage != 0 || snapshot.Fame != 0 || snapshot.Silver != 0 || snapshot.Respec != 0 || len(snapshot.Loot) != 0 {
		t.Fatalf("pre-identity metrics leaked: %+v", snapshot)
	}

	state.ApplyJoinIdentity(LocalIdentity{ObjectID: 1, GUID: local.GUID, Name: local.Name})
	state.SyncRegistry([]Entity{local}, []Entity{local})
	if !state.AddDamageEntity(local, Entity{}, 100) || !state.AddFame(10) || !state.AddSilver(20) || !state.AddRespec(30) || !state.AddLoot(LootEntry{PlayerGUID: local.GUID, ItemID: "T4_TEST", Quantity: 1}) {
		t.Fatal("valid identity metric was rejected")
	}

	state.SetTrackingCharacter("DifferentCharacter")
	if state.AddDamageEntity(local, Entity{}, 100) || state.AddFame(10) || state.AddLoot(LootEntry{PlayerGUID: local.GUID, ItemID: "T4_TEST", Quantity: 1}) {
		t.Fatal("filter-mismatched metric was accepted")
	}
}

func TestJoinIdentityRejectsIncompleteOrZeroGUID(t *testing.T) {
	state := NewState()
	cases := []LocalIdentity{{ObjectID: 1, Name: "Anon"}, {GUID: "00000000-0000-0000-0000-000000000001", Name: "Anon"}, {ObjectID: 1, GUID: "00000000-0000-0000-0000-000000000000", Name: "Anon"}}
	for _, identity := range cases {
		state.ApplyJoinIdentity(identity)
		if state.Snapshot().Identity.Valid {
			t.Fatalf("invalid identity accepted: %+v", identity)
		}
	}
}

func TestWorldStatePreservesInstanceAndIdentityAcrossZones(t *testing.T) {
	state := NewState()
	state.ApplyJoinIdentityAndRegistry(LocalIdentity{ObjectID: 1, GUID: "00000000-0000-0000-0000-000000000001", Name: "Anon"}, "MapA@instance-1", nil, nil)
	state.EnterZone("MapB@instance-2")
	snapshot := state.Snapshot()
	if !snapshot.Identity.Valid || snapshot.Identity.Name != "Anon" {
		t.Fatal("zone transition cleared canonical identity")
	}
	if snapshot.World.Map != "MapB" || snapshot.World.Instance != "instance-2" || len(snapshot.World.History) != 2 {
		t.Fatalf("unexpected world state: %+v", snapshot.World)
	}
}
