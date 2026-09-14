package tracker

import (
	"sort"
	"sync"
	"time"
)

// Combatant son los números acumulados de un jugador dentro de la sesión.
type Combatant struct {
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

// MapVisit es una entrada del historial de mapas.
type MapVisit struct {
	Name    string `json:"name"`
	Enter   int64  `json:"enter"`
	Leave   int64  `json:"leave,omitempty"`
	Seconds int64  `json:"seconds"`
}

// LootEntry es un ítem recogido por algún jugador a la vista.
type LootEntry struct {
	TS       int64  `json:"ts"`
	Player   string `json:"player"`
	ItemID   string `json:"itemId"`
	Quantity int    `json:"quantity"`
	Quality  int    `json:"quality"`
	Source   string `json:"source"`
}

// Snapshot es la foto completa que consume el frontend en el primer render.
type Snapshot struct {
	Capturing   bool        `json:"capturing"`
	Simulated   bool        `json:"simulated"`
	Character   string      `json:"character"`
	Zone        string      `json:"zone"`
	Party       []string    `json:"party"`
	StartedAt   int64       `json:"startedAt"`
	Seconds     int64       `json:"seconds"`
	Fame        int64       `json:"fame"`
	Silver      int64       `json:"silver"`
	Respec      int64       `json:"respec"`
	FamePerHour float64     `json:"famePerHour"`
	SilverPerH  float64     `json:"silverPerHour"`
	Combatants  []Combatant `json:"combatants"`
	Maps        []MapVisit  `json:"maps"`
	Loot        []LootEntry `json:"loot"`
}

const (
	maxLoot = 500
	maxMaps = 200
)

// State es el estado agregado de la sesión. Todos los métodos son seguros
// para uso concurrente: la fuente de captura escribe desde su goroutine y los
// handlers HTTP leen desde las suyas.
type State struct {
	mu        sync.RWMutex
	capturing bool
	simulated bool
	character string
	zone      string
	party     []string
	startedAt time.Time
	fame      int64
	silver    int64
	respec    int64
	players   map[string]*Combatant
	maps      []MapVisit
	loot      []LootEntry
}

// NewState crea el estado de una sesión nueva.
func NewState() *State {
	return &State{
		startedAt: time.Now(),
		players:   make(map[string]*Combatant),
	}
}

func (s *State) player(name string) *Combatant {
	c, ok := s.players[name]
	if !ok {
		c = &Combatant{Name: name}
		s.players[name] = c
	}
	return c
}

// SetCapturing marca si el motor está leyendo tráfico y si la fuente es
// simulada (modo demo, sin juego abierto).
func (s *State) SetCapturing(on, simulated bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.capturing = on
	s.simulated = simulated
}

// SetCharacter fija el personaje propio y lo marca como tal en la tabla.
func (s *State) SetCharacter(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.character = name
	if name != "" {
		s.player(name).Self = true
	}
}

// SetParty reemplaza la lista de miembros de la party.
func (s *State) SetParty(members []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.party = append([]string(nil), members...)
	for _, m := range members {
		s.player(m)
	}
}

// EnterZone cierra la visita anterior y abre una nueva.
func (s *State) EnterZone(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UnixMilli()
	if n := len(s.maps); n > 0 && s.maps[n-1].Leave == 0 {
		s.maps[n-1].Leave = now
		s.maps[n-1].Seconds = (now - s.maps[n-1].Enter) / 1000
	}
	s.zone = name
	s.maps = append(s.maps, MapVisit{Name: name, Enter: now})
	if len(s.maps) > maxMaps {
		s.maps = s.maps[len(s.maps)-maxMaps:]
	}
}

// AddDamage suma daño hecho por source sobre target.
func (s *State) AddDamage(source, target string, amount int64) {
	if amount <= 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	c := s.player(source)
	c.Damage += amount
	if amount > c.BiggestHit {
		c.BiggestHit = amount
	}
	// El daño recibido solo se acumula para jugadores conocidos (vos o tu
	// party). Si no, cada mob golpeado aparecería como una fila más en el
	// medidor, que es exactamente lo que no queremos ver ahí.
	if target != "" {
		if victim, known := s.players[target]; known {
			victim.Taken += amount
		}
	}
}

// AddHealing suma curación efectiva y sobrecuración.
func (s *State) AddHealing(source string, effective, overheal int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c := s.player(source)
	if effective > 0 {
		c.Healing += effective
	}
	if overheal > 0 {
		c.Overheal += overheal
	}
}

// AddKill registra una muerte y, si se conoce, quién la causó.
func (s *State) AddKill(killer, victim string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if killer != "" {
		s.player(killer).Kills++
	}
	if victim != "" {
		s.player(victim).Deaths++
	}
}

// AddFame, AddSilver y AddRespec acumulan las ganancias de la sesión.
func (s *State) AddFame(v int64)   { s.mu.Lock(); s.fame += v; s.mu.Unlock() }
func (s *State) AddSilver(v int64) { s.mu.Lock(); s.silver += v; s.mu.Unlock() }
func (s *State) AddRespec(v int64) { s.mu.Lock(); s.respec += v; s.mu.Unlock() }

// AddLoot guarda un ítem recogido, recortando el historial al tope.
func (s *State) AddLoot(entry LootEntry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if entry.TS == 0 {
		entry.TS = time.Now().UnixMilli()
	}
	s.loot = append(s.loot, entry)
	if len(s.loot) > maxLoot {
		s.loot = s.loot[len(s.loot)-maxLoot:]
	}
}

// Reset vacía los contadores y arranca una sesión nueva, conservando
// personaje, zona y party (no cambian porque el usuario apriete «reiniciar»).
func (s *State) Reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.startedAt = time.Now()
	s.fame, s.silver, s.respec = 0, 0, 0
	s.players = make(map[string]*Combatant)
	s.loot = nil
	s.maps = nil
	if s.character != "" {
		s.player(s.character).Self = true
	}
	for _, m := range s.party {
		s.player(m)
	}
}

// Snapshot arma la foto ordenada por daño, con tasas y porcentajes ya
// calculados para que el frontend solo dibuje.
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

	maps := append([]MapVisit(nil), s.maps...)
	for i := range maps {
		if maps[i].Leave == 0 {
			maps[i].Seconds = (time.Now().UnixMilli() - maps[i].Enter) / 1000
		}
	}
	// El historial se muestra del más nuevo al más viejo, como en SAT.
	for i, j := 0, len(maps)-1; i < j; i, j = i+1, j-1 {
		maps[i], maps[j] = maps[j], maps[i]
	}

	loot := append([]LootEntry(nil), s.loot...)
	for i, j := 0, len(loot)-1; i < j; i, j = i+1, j-1 {
		loot[i], loot[j] = loot[j], loot[i]
	}

	return Snapshot{
		Capturing:   s.capturing,
		Simulated:   s.simulated,
		Character:   s.character,
		Zone:        s.zone,
		Party:       append([]string(nil), s.party...),
		StartedAt:   s.startedAt.UnixMilli(),
		Seconds:     int64(elapsed),
		Fame:        s.fame,
		Silver:      s.silver,
		Respec:      s.respec,
		FamePerHour: float64(s.fame) / hours,
		SilverPerH:  float64(s.silver) / hours,
		Combatants:  list,
		Maps:        maps,
		Loot:        loot,
	}
}
