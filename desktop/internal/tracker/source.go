package tracker

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"time"
)

// Source is a producer selected explicitly by the user. LiveSource and
// SocketSource are real capture providers; Simulator is an opt-in demo and is
// never selected as a fallback for a failed real capture.
type Source interface {
	// Name identifica la fuente en la UI («simulador», «npcap»…).
	Name() string
	// Available indica si la fuente puede arrancar en esta PC.
	Available() (bool, string)
	// Run bombea eventos hasta que el contexto se cancela.
	Run(ctx context.Context, st *State, hub *Hub) error
}

// Diagnosable la implementan las fuentes que pueden reportar qué códigos de
// evento están llegando. Es lo que se usa para actualizar la tabla después de
// un patch de Albion.
type Diagnosable interface {
	SetDiagnostic(on bool)
	Diagnostic() map[string]any
}

// DeviceConfigurable expone las interfaces de red de una fuente de captura.
// Un nombre vacío conserva el modo automático (escuchar todas).
type DeviceConfigurable interface {
	Devices() ([]map[string]string, error)
	SetDevice(string)
}

// Simulator genera una sesión verosímil sin necesidad del juego. Sirve para
// desarrollar la interfaz, para que el usuario vea cómo se ve la pestaña antes
// de instalar Npcap, y para las pruebas automáticas.
type Simulator struct{}

func (Simulator) Name() string { return "simulador" }

func (Simulator) Available() (bool, string) { return true, "" }

func (Simulator) Run(ctx context.Context, st *State, hub *Hub) error {
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))

	party := []string{"SheniaLiam", "GrailHealer", "SpetsnazTank", "MistRunner"}
	zones := []string{"Martlock", "Mase Knoll", "Blackthorn Quarry", "Caerleon", "Thetford"}
	items := []string{"T6_BAG", "T5_MAIN_CURSEDSTAFF", "T4_2H_BOW", "T6_ARMOR_LEATHER_SET2", "T5_HEAD_PLATE_SET1"}
	resources := []struct {
		id, name, kind string
		tier           int
		value          int64
	}{
		{"T5_WOOD", "Troncos de cedro", "wood", 5, 620},
		{"T6_ORE", "Mineral de titanio", "ore", 6, 1180},
		{"T5_FIBER", "Fibra celeste", "fiber", 5, 710},
		{"T6_HIDE", "Piel gruesa", "hide", 6, 1320},
		{"T5_ROCK", "Granito", "stone", 5, 430},
		{"T6_FISH_FRESHWATER_ALL_COMMON", "Pez de agua dulce", "fishing", 6, 980},
	}
	dungeonTypes := []string{"solo", "standard", "static", "avalonian", "corrupted", "hellgate", "hce", "mists", "knightfall", "abyssal", "ancient"}
	abilities := []string{"Bola de fuego", "Tajo", "Flecha perforante", "Maldición", "Golpe heroico"}

	st.SetDemoCapture(true)
	_ = st.ApplyJoinIdentity(LocalIdentity{ObjectID: 1, GUID: "00000000-0000-0000-0000-000000000001", Name: party[0]})
	entities := make([]Entity, 0, len(party))
	for i, name := range party {
		entities = append(entities, Entity{
			GUID:     fmt.Sprintf("00000000-0000-0000-0000-%012d", i+1),
			ObjectID: int64(i + 1), HasObjectID: true, Name: name,
			Local: i == 0, InParty: true,
		})
	}
	st.SyncRegistry(entities, entities)
	hub.Publish(NewEvent("status", st.Snapshot()))

	st.EnterZone(zones[0])
	hub.Publish(NewEvent("map", map[string]any{"zone": zones[0]}))

	combat := time.NewTicker(700 * time.Millisecond)
	defer combat.Stop()
	slow := time.NewTicker(9 * time.Second)
	defer slow.Stop()
	push := time.NewTicker(1 * time.Second)
	defer push.Stop()

	for {
		select {
		case <-ctx.Done():
			st.SetCapturing(false, true)
			hub.Publish(NewEvent("status", st.Snapshot()))
			return ctx.Err()

		case <-combat.C:
			actor := party[rng.Intn(len(party))]
			// Keep the development fallback faithful to the live tracker: the
			// optional SAT-style main-character setting filters aggregation only
			// after its local identity has been established above.
			if !st.IsTrackedPlayer(actor) {
				continue
			}
			if actor == "GrailHealer" {
				eff := int64(150 + rng.Intn(600))
				over := int64(rng.Intn(200))
				st.AddHealing(actor, eff, over)
				hub.Publish(NewEvent("heal", map[string]any{
					"source": actor, "amount": eff, "overheal": over,
					"ability": "Curación santa",
				}))
				continue
			}
			dmg := int64(200 + rng.Intn(1400))
			st.AddDamage(actor, "Mob heretico", dmg)
			st.AddFame(int64(40 + rng.Intn(160)))
			st.AddSilver(int64(90 + rng.Intn(400)))
			hub.Publish(NewEvent("damage", map[string]any{
				"source": actor, "target": "Mob heretico", "amount": dmg,
				"ability": abilities[rng.Intn(len(abilities))],
			}))

		case <-slow.C:
			if rng.Intn(3) == 0 {
				zone := zones[rng.Intn(len(zones))]
				st.EnterZone(zone)
				hub.Publish(NewEvent("map", map[string]any{"zone": zone}))
			}
			if !st.IsTrackedPlayer(party[0]) {
				continue
			}
			entry := LootEntry{
				Player:   party[rng.Intn(len(party))],
				ItemID:   items[rng.Intn(len(items))],
				Quantity: 1 + rng.Intn(3),
				Quality:  1 + rng.Intn(3),
				Source:   "mob",
			}
			st.AddLoot(entry)
			st.AddRespec(int64(rng.Intn(40)))
			hub.Publish(NewEvent("loot", entry))
			resource := resources[rng.Intn(len(resources))]
			quantity := 1 + rng.Intn(8)
			hub.Publish(NewEvent("gathering", map[string]any{
				"uid":      fmt.Sprintf("sim-gat-%d", time.Now().UnixNano()),
				"ts":       time.Now().UnixMilli(),
				"itemId":   resource.id,
				"name":     resource.name,
				"type":     resource.kind,
				"tier":     resource.tier,
				"quantity": quantity,
				"value":    int64(quantity) * resource.value,
				"map":      zones[rng.Intn(len(zones))],
			}))
			hub.Publish(NewEvent("dungeonRun", map[string]any{
				"uid":         fmt.Sprintf("sim-dng-%d", time.Now().UnixNano()),
				"ts":          time.Now().UnixMilli(),
				"type":        dungeonTypes[rng.Intn(len(dungeonTypes))],
				"tier":        4 + rng.Intn(5),
				"enchantment": rng.Intn(5),
				"map":         zones[rng.Intn(len(zones))],
				"duration":    420 + rng.Intn(1800),
				"fame":        12000 + rng.Intn(180000),
				"respec":      rng.Intn(18000),
				"might":       rng.Intn(6000),
				"favor":       rng.Intn(2400),
				"silver":      5000 + rng.Intn(90000),
				"lootValue":   15000 + rng.Intn(500000),
				"deaths":      rng.Intn(3),
				"chests":      1 + rng.Intn(8),
			}))

		case <-push.C:
			hub.Publish(NewEvent("snapshot", st.Snapshot()))
		}
	}
}

// BrokenSource representa un motor que no puede arrancar (por ejemplo, tabla
// de códigos ilegible). Existe para que la interfaz explique el problema en
// lugar de mostrar una pestaña muerta sin motivo aparente.
type BrokenSource struct{ Reason string }

func (b BrokenSource) Name() string { return "no disponible" }

func (b BrokenSource) Available() (bool, string) { return false, b.Reason }

func (b BrokenSource) Run(ctx context.Context, st *State, hub *Hub) error {
	return errors.New(b.Reason)
}

// FallbackSource usa la fuente principal cuando está disponible y, si no,
// la de respaldo. Sirve para que la edición Tracker siga siendo usable sin
// Npcap instalado: se ve la interfaz real con datos simulados, y en cuanto
// Npcap aparece, el siguiente arranque usa la captura de verdad.
type FallbackSource struct {
	Primary  Source
	Fallback Source
}

func (f FallbackSource) active() Source {
	if ok, _ := f.Primary.Available(); ok {
		return f.Primary
	}
	return f.Fallback
}

func (f FallbackSource) Name() string {
	if ok, _ := f.Primary.Available(); ok {
		return f.Primary.Name()
	}
	_, reason := f.Primary.Available()
	return f.Fallback.Name() + " — " + reason
}

// Available siempre es true: si la principal no está, corre la de respaldo.
func (f FallbackSource) Available() (bool, string) {
	if ok, _ := f.Primary.Available(); ok {
		return true, ""
	}
	_, reason := f.Primary.Available()
	return true, reason + " Mientras tanto se muestran datos simulados."
}

func (f FallbackSource) Run(ctx context.Context, st *State, hub *Hub) error {
	return f.active().Run(ctx, st, hub)
}

// SetDiagnostic y Diagnostic delegan en la fuente activa si la soporta.
func (f FallbackSource) SetDiagnostic(on bool) {
	if d, ok := f.active().(Diagnosable); ok {
		d.SetDiagnostic(on)
	}
}

func (f FallbackSource) Devices() ([]map[string]string, error) {
	if d, ok := f.Primary.(DeviceConfigurable); ok {
		return d.Devices()
	}
	return []map[string]string{}, errors.New("la fuente no expone adaptadores")
}

func (f FallbackSource) SetDevice(name string) {
	if d, ok := f.Primary.(DeviceConfigurable); ok {
		d.SetDevice(name)
	}
}

func (f FallbackSource) Diagnostic() map[string]any {
	if d, ok := f.active().(Diagnosable); ok {
		return d.Diagnostic()
	}
	return map[string]any{"enabled": false, "known": []any{}, "unknown": []any{}}
}
