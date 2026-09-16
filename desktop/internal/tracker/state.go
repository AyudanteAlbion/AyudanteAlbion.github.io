// SPDX-License-Identifier: GPL-3.0-only

package tracker

import (
	"sort"
	"strings"
	"sync"
	"time"
)

// CapturePhase is the user-visible progress of the real capture pipeline.
// Values are API contracts; keep them stable for the desktop frontend.
type CapturePhase string

const (
	CaptureOff         CapturePhase = "off"
	CapturePreparing   CapturePhase = "preparing"
	CaptureNetwork     CapturePhase = "capturing_network"
	CapturePhoton      CapturePhase = "photon_detected"
	CaptureServer      CapturePhase = "server_confirmed"
	CaptureWaitingJoin CapturePhase = "waiting_join"
	CaptureCharacter   CapturePhase = "character_detected"
	CaptureDemo        CapturePhase = "demo"
)

// CaptureState is transport state only. It deliberately contains no player or
// party data, so diagnostics can publish it without leaking game identities.
type CaptureState struct {
	Phase            CapturePhase `json:"phase"`
	Provider         string       `json:"provider"`
	Adapter          string       `json:"adapter,omitempty"`
	OpenSources      int          `json:"openSources"`
	Error            string       `json:"error,omitempty"`
	PacketsReceived  uint64       `json:"packetsReceived"`
	PhotonPackets    uint64       `json:"photonPackets"`
	DecodedMessages  uint64       `json:"decodedMessages"`
	EncryptedDropped uint64       `json:"encryptedDropped"`
	MalformedDropped uint64       `json:"malformedDropped"`
	ServerConfirmed  bool         `json:"serverConfirmed"`
	Server           string       `json:"server,omitempty"`
	StartedAt        int64        `json:"startedAt,omitempty"`
	LastPacketAt     int64        `json:"lastPacketAt,omitempty"`
	LastPhotonAt     int64        `json:"lastPhotonAt,omitempty"`
	RealCapture      bool         `json:"realCapture"`
}

// LocalIdentity is set only by a successful JoinResponse. Name filters and
// NewCharacter packets are never allowed to manufacture local identity.
type LocalIdentity struct {
	ObjectID      int64  `json:"objectId,omitempty"`
	GUID          string `json:"guid,omitempty"`
	Name          string `json:"name,omitempty"`
	Guild         string `json:"guild,omitempty"`
	Alliance      string `json:"alliance,omitempty"`
	Detection     string `json:"detection"` // waiting | detected | filtered
	Valid         bool   `json:"valid"`
	FilterMatched bool   `json:"filterMatched"`
	DetectedAt    int64  `json:"detectedAt,omitempty"`
	Revision      uint64 `json:"revision"`
}

// PartyMemberState uses GUID as the durable membership key. ObjectID is merely
// the current-zone index used by combat packets and can be absent after a zone
// transition.
type PartyMemberState struct {
	GUID     string `json:"guid"`
	Name     string `json:"name"`
	ObjectID *int64 `json:"objectId,omitempty"`
	Local    bool   `json:"local"`
}

type PartyState struct {
	Members []PartyMemberState `json:"members"`
}

// MapVisit and WorldState are independent of combat/session counters.
type MapVisit struct {
	Name     string `json:"name"`
	Instance string `json:"instance,omitempty"`
	Enter    int64  `json:"enter"`
	Leave    int64  `json:"leave,omitempty"`
	Seconds  int64  `json:"seconds"`
}

type WorldState struct {
	Cluster  string     `json:"cluster,omitempty"`
	Map      string     `json:"map,omitempty"`
	Instance string     `json:"instance,omitempty"`
	History  []MapVisit `json:"history"`
}

// Combatant is keyed internally by GUID (never by display name). ObjectID is
// included only as the current-zone diagnostic/reference value.
type Combatant struct {
	GUID       string  `json:"guid,omitempty"`
	ObjectID   *int64  `json:"objectId,omitempty"`
	Name       string  `json:"name"`
	Damage     int64   `json:"damage"`
	Healing    int64   `json:"healing"`
	Overheal   int64   `json:"overheal"`
	Taken      int64   `json:"taken"`
	BiggestHit int64   `json:"biggestHit"`
	Deaths     int     `json:"deaths"`
	Kills      int     `json:"kills"`
	DPS        float64 `json:"dps"`
	HPS        float64 `json:"hps"`
	ShareDmg   float64 `json:"shareDamage"`
	ShareHeal  float64 `json:"shareHealing"`
	Self       bool    `json:"self"`
}

type LootEntry struct {
	TS         int64  `json:"ts"`
	Player     string `json:"player"`
	PlayerGUID string `json:"playerGuid,omitempty"`
	ItemID     string `json:"itemId"`
	Quantity   int    `json:"quantity"`
	Quality    int    `json:"quality"`
	Source     string `json:"source"`
}

// MetricsSnapshot keeps the identity prerequisite explicit in the API.
type MetricsSnapshot struct {
	Accepted    bool        `json:"accepted"`
	StartedAt   int64       `json:"startedAt"`
	Seconds     int64       `json:"seconds"`
	Fame        int64       `json:"fame"`
	Silver      int64       `json:"silver"`
	Respec      int64       `json:"respec"`
	FamePerHour float64     `json:"famePerHour"`
	SilverPerH  float64     `json:"silverPerHour"`
	Combatants  []Combatant `json:"combatants"`
	Loot        []LootEntry `json:"loot"`
}

// Snapshot preserves legacy flat fields while exposing the explicit contract.
type Snapshot struct {
	Capture           CaptureState    `json:"capture"`
	Identity          LocalIdentity   `json:"identity"`
	Entities          []Entity        `json:"entities"`
	PartyState        PartyState      `json:"partyState"`
	World             WorldState      `json:"world"`
	Metrics           MetricsSnapshot `json:"metrics"`
	Capturing         bool            `json:"capturing"`
	Simulated         bool            `json:"simulated"`
	Character         string          `json:"character"`
	TrackingCharacter string          `json:"trackingCharacter"`
	Zone              string          `json:"zone"`
	Party             []string        `json:"party"`
	StartedAt         int64           `json:"startedAt"`
	Seconds           int64           `json:"seconds"`
	Fame              int64           `json:"fame"`
	Silver            int64           `json:"silver"`
	Respec            int64           `json:"respec"`
	FamePerHour       float64         `json:"famePerHour"`
	SilverPerH        float64         `json:"silverPerHour"`
	Combatants        []Combatant     `json:"combatants"`
	Maps              []MapVisit      `json:"maps"`
	Loot              []LootEntry     `json:"loot"`
	Packets           uint64          `json:"packets"`
	Decoded           uint64          `json:"decoded"`
}

const (
	maxLoot = 500
	maxMaps = 200
)

// State owns the five contracts (capture, identity, entity projection, party,
// world) and the metrics consumer. Every mutation shares one lock so snapshots
// cannot expose a half-applied JoinResponse.
type State struct {
	mu                sync.RWMutex
	capture           CaptureState
	identity          LocalIdentity
	entities          []Entity
	party             PartyState
	world             WorldState
	trackingCharacter string
	demo              bool
	startedAt         time.Time
	fame              int64
	silver            int64
	respec            int64
	players           map[string]*Combatant // GUID -> metrics
	loot              []LootEntry
}

func NewState() *State {
	return &State{
		capture:   CaptureState{Phase: CaptureOff},
		identity:  LocalIdentity{Detection: "waiting", FilterMatched: true},
		startedAt: time.Now(),
		players:   make(map[string]*Combatant),
	}
}

func normalizeFilter(value string) string { return strings.TrimSpace(value) }
func sameCharacter(a, b string) bool {
	return strings.EqualFold(strings.TrimSpace(a), strings.TrimSpace(b))
}

func validIdentity(identity LocalIdentity) bool {
	guid := strings.TrimSpace(identity.GUID)
	return identity.ObjectID != 0 && guid != "" && guid != "00000000-0000-0000-0000-000000000000" && strings.TrimSpace(identity.Name) != ""
}

func (s *State) recomputePhaseLocked() {
	if s.demo {
		s.capture.Phase = CaptureDemo
		return
	}
	if !s.capture.RealCapture {
		if s.capture.Phase != CapturePreparing {
			s.capture.Phase = CaptureOff
		}
		return
	}
	if s.identity.Valid && s.capture.ServerConfirmed {
		s.capture.Phase = CaptureCharacter
	} else if s.capture.ServerConfirmed {
		s.capture.Phase = CaptureWaitingJoin
	} else if s.capture.PhotonPackets > 0 {
		s.capture.Phase = CapturePhoton
	} else {
		s.capture.Phase = CaptureNetwork
	}
}

func (s *State) PrepareCapture(provider string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.demo = false
	s.capture = CaptureState{Phase: CapturePreparing, Provider: provider, StartedAt: time.Now().UnixMilli()}
}

func (s *State) CaptureOpened(provider string, openSources int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.demo = false
	s.capture.Provider = provider
	s.capture.OpenSources = openSources
	s.capture.RealCapture = openSources > 0
	s.capture.Error = ""
	s.recomputePhaseLocked()
}

func (s *State) CaptureRecovering(provider, message string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.capture.Provider = provider
	s.capture.Adapter = ""
	s.capture.OpenSources = 0
	s.capture.RealCapture = false
	s.capture.Error = message
	s.capture.Phase = CapturePreparing
}

func (s *State) CaptureFailed(message string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.capture.Error = message
	s.capture.RealCapture = false
	s.demo = false
	s.capture.Phase = CaptureOff
}

func (s *State) StopCapture() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.capture.RealCapture = false
	s.capture.OpenSources = 0
	s.demo = false
	s.capture.Phase = CaptureOff
}

func (s *State) SetDemoCapture(on bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.demo = on
	if on {
		s.capture = CaptureState{Phase: CaptureDemo, Provider: "demo", StartedAt: time.Now().UnixMilli(), OpenSources: 1}
	} else {
		s.capture = CaptureState{Phase: CaptureOff}
	}
}

// SetCapturing is retained for old call sites; real sources should use the
// explicit PrepareCapture/CaptureOpened methods.
func (s *State) SetCapturing(on, simulated bool) {
	if simulated {
		s.SetDemoCapture(on)
		return
	}
	if on {
		s.CaptureOpened("capture", 1)
	} else {
		s.StopCapture()
	}
}

func (s *State) SetCaptureAdapter(adapter string) {
	s.mu.Lock()
	s.capture.Adapter = adapter
	s.mu.Unlock()
}

func (s *State) MarkPacket() {
	s.mu.Lock()
	s.capture.PacketsReceived++
	s.capture.LastPacketAt = time.Now().UnixMilli()
	s.mu.Unlock()
}

func (s *State) MarkPhoton(adapter string, encrypted bool) {
	s.mu.Lock()
	s.capture.PhotonPackets++
	s.capture.LastPhotonAt = time.Now().UnixMilli()
	if adapter != "" {
		s.capture.Adapter = adapter
	}
	if encrypted {
		s.capture.EncryptedDropped++
	}
	s.recomputePhaseLocked()
	s.mu.Unlock()
}

func (s *State) MarkMalformed() {
	s.mu.Lock()
	s.capture.MalformedDropped++
	s.mu.Unlock()
}

func (s *State) MarkDecoded() {
	s.mu.Lock()
	s.capture.DecodedMessages++
	s.mu.Unlock()
}

func (s *State) ConfirmServer(name string) {
	if name == "" {
		return
	}
	s.mu.Lock()
	s.capture.ServerConfirmed = true
	s.capture.Server = name
	s.recomputePhaseLocked()
	s.mu.Unlock()
}

func normalizeIdentity(identity LocalIdentity) LocalIdentity {
	identity.Name = strings.TrimSpace(identity.Name)
	identity.GUID = strings.ToLower(strings.TrimSpace(identity.GUID))
	identity.Guild = strings.TrimSpace(identity.Guild)
	identity.Alliance = strings.TrimSpace(identity.Alliance)
	return identity
}

func (s *State) applyJoinIdentityLocked(identity LocalIdentity) {
	changedCharacter := s.identity.Valid && s.identity.GUID != identity.GUID
	identity.Valid = true
	identity.DetectedAt = time.Now().UnixMilli()
	identity.Revision = s.identity.Revision + 1
	identity.FilterMatched = s.trackingCharacter == "" || sameCharacter(s.trackingCharacter, identity.Name)
	identity.Detection = "detected"
	if !identity.FilterMatched {
		identity.Detection = "filtered"
	}
	s.identity = identity
	if changedCharacter {
		s.resetMetricsLocked()
	}
	s.recomputePhaseLocked()
}

// ApplyJoinIdentity atomically replaces local identity and, when the GUID
// changes, starts a fresh statistics session so two characters never mix.
func (s *State) ApplyJoinIdentity(identity LocalIdentity) bool {
	identity = normalizeIdentity(identity)
	if !validIdentity(identity) {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.applyJoinIdentityLocked(identity)
	return true
}

// ApplyJoinIdentityAndRegistry is the single JoinResponse transaction exposed
// to the live handler: identity, world, registry and party become visible in
// one state lock, so a concurrent snapshot can never observe a half-Join.
func (s *State) ApplyJoinIdentityAndRegistry(identity LocalIdentity, zone string, entities, members []Entity) bool {
	identity = normalizeIdentity(identity)
	if !validIdentity(identity) {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.applyJoinIdentityLocked(identity)
	s.enterZoneLocked(zone)
	s.syncRegistryLocked(entities, members)
	return true
}

func (s *State) ClearCharacter() {
	s.mu.Lock()
	revision := s.identity.Revision + 1
	s.identity = LocalIdentity{Detection: "waiting", FilterMatched: s.trackingCharacter == "", Revision: revision}
	s.entities = nil
	s.party = PartyState{}
	s.recomputePhaseLocked()
	s.mu.Unlock()
}

func (s *State) SetTrackingCharacter(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := normalizeFilter(name)
	changed := !sameCharacter(s.trackingCharacter, next)
	s.trackingCharacter = next
	if s.identity.Valid {
		s.identity.FilterMatched = s.trackingCharacter == "" || sameCharacter(s.trackingCharacter, s.identity.Name)
		s.identity.Detection = "detected"
		if !s.identity.FilterMatched {
			s.identity.Detection = "filtered"
		}
	} else {
		s.identity.FilterMatched = s.trackingCharacter == ""
	}
	if changed {
		s.resetMetricsLocked()
		if s.identity.Valid && s.identity.FilterMatched {
			for _, entity := range s.entities {
				if entity.InParty {
					s.ensureCombatantLocked(entity)
				}
			}
		}
	}
}

func (s *State) TrackingCharacter() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.trackingCharacter
}

func (s *State) Identity() LocalIdentity {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.identity
}

func (s *State) HasValidIdentity() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.identity.Valid
}

func (s *State) MetricsAllowed() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.metricsAllowedLocked()
}

func (s *State) metricsAllowedLocked() bool {
	return s.identity.Valid && s.identity.FilterMatched
}

// SyncRegistry projects the GUID registry into the public EntityRegistry and
// PartyState contracts. It never changes LocalIdentity; only JoinResponse may.
func (s *State) syncRegistryLocked(entities []Entity, members []Entity) {
	if !s.identity.Valid && !s.demo {
		return
	}
	s.entities = append([]Entity(nil), entities...)
	s.party.Members = make([]PartyMemberState, 0, len(members))
	for _, entity := range members {
		if entity.GUID == "" || entity.Name == "" {
			continue
		}
		member := PartyMemberState{GUID: entity.GUID, Name: entity.Name, Local: entity.Local}
		if entity.HasObjectID {
			id := entity.ObjectID
			member.ObjectID = &id
		}
		s.party.Members = append(s.party.Members, member)
		s.ensureCombatantLocked(entity)
	}
}

func (s *State) SyncRegistry(entities []Entity, members []Entity) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.syncRegistryLocked(entities, members)
}

func (s *State) ensureCombatantLocked(entity Entity) *Combatant {
	if entity.GUID == "" {
		return nil
	}
	combatant := s.players[entity.GUID]
	if combatant == nil {
		combatant = &Combatant{GUID: entity.GUID}
		s.players[entity.GUID] = combatant
	}
	combatant.Name = entity.Name
	combatant.Self = entity.Local
	if entity.HasObjectID {
		id := entity.ObjectID
		combatant.ObjectID = &id
	} else {
		combatant.ObjectID = nil
	}
	return combatant
}

func (s *State) Character() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if !s.identity.Valid {
		return ""
	}
	return s.identity.Name
}

func (s *State) Zone() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.world.Map
}

func (s *State) IsCurrentZone(raw string) bool {
	cluster, instance := splitZone(raw)
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cluster != "" && s.world.Map == cluster && s.world.Instance == instance
}

func splitZone(name string) (cluster, instance string) {
	parts := strings.Split(name, "@")
	cluster = strings.TrimSpace(parts[0])
	if len(parts) > 1 {
		instance = strings.Join(parts[1:], "@")
	}
	return cluster, instance
}

func (s *State) enterZoneLocked(name string) {
	if !s.identity.Valid && !s.demo {
		return
	}
	cluster, instance := splitZone(name)
	if cluster == "" || s.world.Map == cluster && s.world.Instance == instance {
		return
	}
	now := time.Now().UnixMilli()
	if n := len(s.world.History); n > 0 && s.world.History[n-1].Leave == 0 {
		s.world.History[n-1].Leave = now
		s.world.History[n-1].Seconds = (now - s.world.History[n-1].Enter) / 1000
	}
	s.world.Cluster, s.world.Map, s.world.Instance = cluster, cluster, instance
	s.world.History = append(s.world.History, MapVisit{Name: cluster, Instance: instance, Enter: now})
	if len(s.world.History) > maxMaps {
		s.world.History = s.world.History[len(s.world.History)-maxMaps:]
	}
}

func (s *State) EnterZone(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.enterZoneLocked(name)
}

func (s *State) AddDamageEntity(source, target Entity, amount int64) bool {
	if amount <= 0 || source.GUID == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.metricsAllowedLocked() || !source.InParty {
		return false
	}
	c := s.ensureCombatantLocked(source)
	if c == nil {
		return false
	}
	c.Damage += amount
	if amount > c.BiggestHit {
		c.BiggestHit = amount
	}
	if target.GUID != "" {
		if victim := s.players[target.GUID]; victim != nil {
			victim.Taken += amount
		}
	}
	return true
}

func (s *State) AddHealingEntity(source Entity, effective, overheal int64) bool {
	if source.GUID == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.metricsAllowedLocked() || !source.InParty {
		return false
	}
	c := s.ensureCombatantLocked(source)
	if c == nil {
		return false
	}
	if effective > 0 {
		c.Healing += effective
	}
	if overheal > 0 {
		c.Overheal += overheal
	}
	return effective > 0 || overheal > 0
}

// Legacy name-based methods remain for explicit demo data only. Real packet
// handlers use GUID/ObjectID methods above.
func (s *State) IsTrackedPlayer(name string) bool {
	if name == "" {
		return false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if !s.metricsAllowedLocked() {
		return false
	}
	for _, member := range s.party.Members {
		if sameCharacter(member.Name, name) {
			return true
		}
	}
	return false
}

func (s *State) AddDamage(source, target string, amount int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.demo || !s.metricsAllowedLocked() || amount <= 0 {
		return
	}
	var sourceEntity, targetEntity Entity
	for _, member := range s.entities {
		if sameCharacter(member.Name, source) {
			sourceEntity = member
		}
		if sameCharacter(member.Name, target) {
			targetEntity = member
		}
	}
	if sourceEntity.GUID == "" || !sourceEntity.InParty {
		return
	}
	c := s.ensureCombatantLocked(sourceEntity)
	c.Damage += amount
	if amount > c.BiggestHit {
		c.BiggestHit = amount
	}
	if targetEntity.GUID != "" && s.players[targetEntity.GUID] != nil {
		s.players[targetEntity.GUID].Taken += amount
	}
}

func (s *State) AddHealing(source string, effective, overheal int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.demo || !s.metricsAllowedLocked() {
		return
	}
	for _, entity := range s.entities {
		if sameCharacter(entity.Name, source) && entity.InParty {
			c := s.ensureCombatantLocked(entity)
			if effective > 0 {
				c.Healing += effective
			}
			if overheal > 0 {
				c.Overheal += overheal
			}
			return
		}
	}
}

func (s *State) AddKill(killer, victim string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.demo || !s.metricsAllowedLocked() {
		return
	}
	for _, entity := range s.entities {
		if killer != "" && sameCharacter(entity.Name, killer) {
			if c := s.ensureCombatantLocked(entity); c != nil {
				c.Kills++
			}
		}
		if victim != "" && sameCharacter(entity.Name, victim) {
			if c := s.ensureCombatantLocked(entity); c != nil {
				c.Deaths++
			}
		}
	}
}

func (s *State) AddFame(v int64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.metricsAllowedLocked() {
		return false
	}
	s.fame += v
	return true
}
func (s *State) AddSilver(v int64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.metricsAllowedLocked() {
		return false
	}
	s.silver += v
	return true
}
func (s *State) AddRespec(v int64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.metricsAllowedLocked() {
		return false
	}
	s.respec += v
	return true
}

func (s *State) AddLoot(entry LootEntry) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.metricsAllowedLocked() {
		return false
	}
	if entry.PlayerGUID == "" {
		for _, member := range s.party.Members {
			if sameCharacter(member.Name, entry.Player) {
				entry.PlayerGUID = member.GUID
				break
			}
		}
	}
	if entry.PlayerGUID == "" {
		return false
	}
	allowed := false
	for _, member := range s.party.Members {
		if member.GUID == entry.PlayerGUID {
			allowed = true
			entry.Player = member.Name
			break
		}
	}
	if !allowed {
		return false
	}
	if entry.TS == 0 {
		entry.TS = time.Now().UnixMilli()
	}
	s.loot = append(s.loot, entry)
	if len(s.loot) > maxLoot {
		s.loot = s.loot[len(s.loot)-maxLoot:]
	}
	return true
}

func (s *State) resetMetricsLocked() {
	s.startedAt = time.Now()
	s.fame, s.silver, s.respec = 0, 0, 0
	s.players = make(map[string]*Combatant)
	s.loot = nil
}

func (s *State) Reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.resetMetricsLocked()
	for _, entity := range s.entities {
		if entity.InParty {
			s.ensureCombatantLocked(entity)
		}
	}
}

func (s *State) Snapshot() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	elapsed := time.Since(s.startedAt).Seconds()
	if elapsed < 1 {
		elapsed = 1
	}
	var totalDmg, totalHeal int64
	for _, c := range s.players {
		totalDmg += c.Damage
		totalHeal += c.Healing
	}
	list := make([]Combatant, 0, len(s.players))
	for _, c := range s.players {
		row := *c
		row.DPS = float64(row.Damage) / elapsed
		row.HPS = float64(row.Healing) / elapsed
		if totalDmg > 0 {
			row.ShareDmg = float64(row.Damage) / float64(totalDmg) * 100
		}
		if totalHeal > 0 {
			row.ShareHeal = float64(row.Healing) / float64(totalHeal) * 100
		}
		list = append(list, row)
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].Damage != list[j].Damage {
			return list[i].Damage > list[j].Damage
		}
		if list[i].Healing != list[j].Healing {
			return list[i].Healing > list[j].Healing
		}
		return list[i].Name < list[j].Name
	})
	hours := elapsed / 3600
	maps := append([]MapVisit(nil), s.world.History...)
	now := time.Now().UnixMilli()
	for i := range maps {
		if maps[i].Leave == 0 {
			maps[i].Seconds = (now - maps[i].Enter) / 1000
		}
	}
	for i, j := 0, len(maps)-1; i < j; i, j = i+1, j-1 {
		maps[i], maps[j] = maps[j], maps[i]
	}
	loot := append([]LootEntry(nil), s.loot...)
	for i, j := 0, len(loot)-1; i < j; i, j = i+1, j-1 {
		loot[i], loot[j] = loot[j], loot[i]
	}
	partyNames := make([]string, 0, len(s.party.Members))
	for _, m := range s.party.Members {
		partyNames = append(partyNames, m.Name)
	}
	capturing := s.capture.RealCapture || s.demo || s.capture.Phase == CapturePreparing
	character := ""
	if s.identity.Valid {
		character = s.identity.Name
	}
	metrics := MetricsSnapshot{Accepted: s.metricsAllowedLocked(), StartedAt: s.startedAt.UnixMilli(), Seconds: int64(elapsed), Fame: s.fame, Silver: s.silver, Respec: s.respec, FamePerHour: float64(s.fame) / hours, SilverPerH: float64(s.silver) / hours, Combatants: list, Loot: loot}
	world := s.world
	world.History = maps
	return Snapshot{
		Capture: s.capture, Identity: s.identity, Entities: append([]Entity(nil), s.entities...), PartyState: PartyState{Members: append([]PartyMemberState(nil), s.party.Members...)}, World: world, Metrics: metrics,
		Capturing: capturing, Simulated: s.demo, Character: character, TrackingCharacter: s.trackingCharacter, Zone: s.world.Map, Party: partyNames,
		StartedAt: metrics.StartedAt, Seconds: metrics.Seconds, Fame: s.fame, Silver: s.silver, Respec: s.respec, FamePerHour: metrics.FamePerHour, SilverPerH: metrics.SilverPerH, Combatants: list, Maps: maps, Loot: loot,
		Packets: s.capture.PacketsReceived, Decoded: s.capture.DecodedMessages,
	}
}
