// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 SheniaLiam — gremio Spetsnaz Grail
//
// Portions of this entity lifecycle are adapted for Go/Wails from
// AlbionOnline-StatisticsAnalysis (SAT), commit
// 9f4471b2905f4152938d84721492c6ac86499750, licensed GPL-3.0.
// See NOTICE at the repository root for attribution and corresponding source.

package tracker

import (
	"encoding/hex"
	"sort"
	"strconv"
	"sync"

	"ayudante-albion-desktop/internal/tracker/photon"
)

// Entity is the small, persistent identity record needed to attribute game
// events. Albion can replace an ObjectId after a zone transition; the player
// GUID is the stable key used to join that new ObjectId to the same player.
type Entity struct {
	GUID        string
	ObjectID    int64
	HasObjectID bool
	Name        string
	Guild       string
	Alliance    string
	Local       bool
	InParty     bool
}

type entityUpdate struct {
	GUID        string
	ObjectID    int64
	HasObjectID bool
	Name        string
	Guild       string
	Alliance    string
}

type partyMember struct {
	GUID string
	Name string
}

// EntityStore is the Go/Wails adaptation of SAT's entity correlation model.
// It keeps a stable GUID index as well as the short-lived ObjectId index that
// combat, loot, and leave packets use. It has no UI or packet-capture concern,
// so one store can safely be shared by all active capture interfaces.
type EntityStore struct {
	mu              sync.RWMutex
	byKey           map[string]*Entity
	keyByObjectID   map[int64]string
	localKey        string
	anonymousSerial uint64
}

func NewEntityStore() *EntityStore {
	return &EntityStore{
		byKey:         make(map[string]*Entity),
		keyByObjectID: make(map[int64]string),
	}
}

// Upsert updates known identity information while retaining facts that are not
// present in every packet (notably party and local-player membership).
func (s *EntityStore) Upsert(update entityUpdate) Entity {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.upsertLocked(update)
}

func (s *EntityStore) upsertLocked(update entityUpdate) Entity {
	key := update.GUID
	if key == "" && update.HasObjectID {
		key = s.keyByObjectID[update.ObjectID]
	}
	if key == "" && update.Name != "" {
		key = "name:" + update.Name
	}
	if key == "" {
		s.anonymousSerial++
		key = "anonymous:" + strconv.FormatUint(s.anonymousSerial, 10)
	}

	entity := s.byKey[key]
	// A NewCharacter packet can finally bring the GUID for an entity previously
	// known only by ObjectId. Move the old record to that stable key instead of
	// creating a second row and losing party/local membership.
	if entity == nil && update.HasObjectID {
		if oldKey, ok := s.keyByObjectID[update.ObjectID]; ok && oldKey != key {
			entity = s.byKey[oldKey]
			if entity != nil {
				delete(s.byKey, oldKey)
				s.byKey[key] = entity
				if s.localKey == oldKey {
					s.localKey = key
				}
			}
		}
	}
	if entity == nil {
		entity = &Entity{}
		s.byKey[key] = entity
	}

	if update.GUID != "" {
		entity.GUID = update.GUID
	}
	if update.HasObjectID {
		if entity.HasObjectID && entity.ObjectID != update.ObjectID {
			delete(s.keyByObjectID, entity.ObjectID)
		}
		// A GUID-bearing update may supersede an older name/ObjectId-only
		// record. Mark that former record stale before replacing the index so it
		// cannot invalidate this newer mapping during a later zone transition.
		if previousKey, ok := s.keyByObjectID[update.ObjectID]; ok && previousKey != key {
			if previous := s.byKey[previousKey]; previous != nil && previous.HasObjectID && previous.ObjectID == update.ObjectID {
				previous.HasObjectID = false
			}
		}
		entity.ObjectID = update.ObjectID
		entity.HasObjectID = true
		s.keyByObjectID[update.ObjectID] = key
	}
	if update.Name != "" {
		entity.Name = update.Name
	}
	if update.Guild != "" {
		entity.Guild = update.Guild
	}
	if update.Alliance != "" {
		entity.Alliance = update.Alliance
	}
	return *entity
}

// SetLocal records the only source of automatic local-player identity: a
// successful Join response. The local character is always part of the tracked
// party, including after PartyDisbanded, matching SAT's entity lifecycle.
func (s *EntityStore) SetLocal(update entityUpdate) Entity {
	s.mu.Lock()
	defer s.mu.Unlock()

	entity := s.upsertLocked(update)
	key := s.keyForLocked(entity)
	if s.localKey != "" && s.localKey != key {
		if old := s.byKey[s.localKey]; old != nil {
			old.Local = false
			old.InParty = false
		}
	}
	stored := s.byKey[key]
	stored.Local = true
	stored.InParty = true
	s.localKey = key
	return *stored
}

func (s *EntityStore) keyForLocked(entity Entity) string {
	if entity.GUID != "" {
		return entity.GUID
	}
	if entity.HasObjectID {
		return s.keyByObjectID[entity.ObjectID]
	}
	for key, known := range s.byKey {
		if known == nil {
			continue
		}
		if known == s.byKey[s.localKey] && entity.Local {
			return key
		}
		if known.Name == entity.Name && known.GUID == entity.GUID {
			return key
		}
	}
	return ""
}

func (s *EntityStore) NameOfObjectID(objectID int64) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	key, ok := s.keyByObjectID[objectID]
	if !ok || s.byKey[key] == nil {
		return ""
	}
	return s.byKey[key].Name
}

func (s *EntityStore) IsLocalObjectID(objectID int64) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	key, ok := s.keyByObjectID[objectID]
	return ok && s.byKey[key] != nil && s.byKey[key].Local
}

func (s *EntityStore) ClearObjectID(objectID int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key, ok := s.keyByObjectID[objectID]
	if !ok {
		return
	}
	delete(s.keyByObjectID, objectID)
	if entity := s.byKey[key]; entity != nil && entity.HasObjectID && entity.ObjectID == objectID {
		entity.HasObjectID = false
	}
}

// BeginZone invalidates ObjectIds for other visible entities. Their GUID/name
// records and party membership survive, so a NewCharacter in the new zone can
// safely bind the new ObjectId to the existing member.
func (s *EntityStore) BeginZone() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, entity := range s.byKey {
		if entity == nil || entity.Local || !entity.HasObjectID {
			continue
		}
		if indexedKey, ok := s.keyByObjectID[entity.ObjectID]; ok && indexedKey == key {
			delete(s.keyByObjectID, entity.ObjectID)
		}
		entity.HasObjectID = false
	}
}

func (s *EntityStore) AddPartyMember(member partyMember) {
	if member.GUID == "" && member.Name == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	entity := s.upsertLocked(entityUpdate{GUID: member.GUID, Name: member.Name})
	if key := s.keyForLocked(entity); key != "" && s.byKey[key] != nil {
		s.byKey[key].InParty = true
	}
}

// SetParty is used by the full PartyJoined roster packet. Unlike a sequence of
// incremental joins, it first removes stale members then preserves the local
// entity as a tracked party member.
func (s *EntityStore) SetParty(members []partyMember) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, entity := range s.byKey {
		if entity != nil {
			entity.InParty = false
		}
	}
	for _, member := range members {
		if member.GUID == "" && member.Name == "" {
			continue
		}
		entity := s.upsertLocked(entityUpdate{GUID: member.GUID, Name: member.Name})
		if key := s.keyForLocked(entity); key != "" && s.byKey[key] != nil {
			s.byKey[key].InParty = true
		}
	}
	if local := s.byKey[s.localKey]; local != nil {
		local.InParty = true
	}
}

func (s *EntityStore) RemovePartyMemberByGUID(guid string) {
	if guid == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if entity := s.byKey[guid]; entity != nil && !entity.Local {
		entity.InParty = false
	}
}

func (s *EntityStore) RemovePartyMemberByObjectID(objectID int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := s.keyByObjectID[objectID]
	if entity := s.byKey[key]; entity != nil && !entity.Local {
		entity.InParty = false
	}
}

// ResetPartyKeepLocal implements SAT's PartyDisbanded behavior: the party is
// cleared, but the local player remains in the local tracked roster.
func (s *EntityStore) ResetPartyKeepLocal() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, entity := range s.byKey {
		if entity != nil {
			entity.InParty = entity.Local
		}
	}
}

func (s *EntityStore) Local() (Entity, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	entity := s.byKey[s.localKey]
	if entity == nil || !entity.Local {
		return Entity{}, false
	}
	return *entity, true
}

func (s *EntityStore) PartyNames() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	seen := make(map[string]bool)
	out := make([]string, 0)
	appendName := func(entity *Entity) {
		if entity == nil || !entity.InParty || entity.Name == "" || seen[entity.Name] {
			return
		}
		seen[entity.Name] = true
		out = append(out, entity.Name)
	}
	appendName(s.byKey[s.localKey])
	for key, entity := range s.byKey {
		if key != s.localKey {
			appendName(entity)
		}
	}
	if len(out) > 1 {
		sort.Strings(out[1:])
	}
	return out
}

// GUIDFromPhoton accepts the custom GUID value emitted by Protocol18 and the
// byte-array representations found in Protocol16 and party roster packets.
// Albion's GUID bytes follow System.Guid(byte[]) ordering, so they are rendered
// in the same canonical form that SAT uses for its GUID dictionary keys.
func GUIDFromPhoton(value any) (string, bool) {
	var raw []byte
	switch v := value.(type) {
	case photon.CustomValue:
		raw = v.Data
	case []byte:
		raw = v
	case [16]byte:
		raw = v[:]
	default:
		return "", false
	}
	if len(raw) != 16 {
		return "", false
	}
	return dotNetGUID(raw), true
}

func GUIDsFromPhoton(value any) []string {
	switch v := value.(type) {
	case []byte:
		out := make([]string, 0, len(v)/16)
		for start := 0; start+16 <= len(v); start += 16 {
			if guid, ok := GUIDFromPhoton(v[start : start+16]); ok {
				out = append(out, guid)
			}
		}
		return out
	case []photon.CustomValue:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if guid, ok := GUIDFromPhoton(item); ok {
				out = append(out, guid)
			}
		}
		return out
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if guid, ok := GUIDFromPhoton(item); ok {
				out = append(out, guid)
			}
		}
		return out
	default:
		return nil
	}
}

func stringsFromPhoton(value any) []string {
	switch v := value.(type) {
	case []string:
		return append([]string(nil), v...)
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if name, ok := str(item); ok {
				out = append(out, name)
			}
		}
		return out
	default:
		return nil
	}
}

func dotNetGUID(raw []byte) string {
	return hex.EncodeToString(raw[3:4]) + hex.EncodeToString(raw[2:3]) +
		hex.EncodeToString(raw[1:2]) + hex.EncodeToString(raw[0:1]) + "-" +
		hex.EncodeToString(raw[5:6]) + hex.EncodeToString(raw[4:5]) + "-" +
		hex.EncodeToString(raw[7:8]) + hex.EncodeToString(raw[6:7]) + "-" +
		hex.EncodeToString(raw[8:10]) + "-" + hex.EncodeToString(raw[10:16])
}
