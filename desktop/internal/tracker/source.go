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

func (Simulator) Name() string { return "Demo — NO ES TRACKING REAL" }

func (Simulator) Available() (bool, string) { return true, "" }

func (Simulator) Run(ctx context.Context, st *State, hub *Hub) error {
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))

	party := []string{"SheniaLiam", "GrailHealer", "SpetsnazTank", "MistRunner"}
	// Zonas con el formato real del protocolo: índices del mundo ("3004") y
	// tokens de instancia ("@RANDOMDUNGEON@<guid>"), como en la captura viva.
	zones := []string{"3004", "3210", "3007", "3003", "@MISTS@9283d553-ab71-4c14-bb34-64567137419a"}
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
	// Pares tipo/cluster verosímiles: el mapa de una instancia es su token.
	dungeonTypes := []struct{ kind, cluster, zone string }{
		{"solo", "RANDOMDUNGEON", "@RANDOMDUNGEON@fe968505-9771-4653-8ade-29a1bd6ddb56"},
		{"standard", "RANDOMDUNGEON", "@RANDOMDUNGEON@0d5b7de9-4f0a-4a2d-9c28-55d0a3e2f1aa"},
		{"static", "DNG-KPR-02-MAIN-021", "DNG-KPR-02-MAIN-021"},
		{"avalonian", "RANDOMDUNGEON", "@RANDOMDUNGEON@c4b7a1c3-2b1e-4f6d-8a90-7d3c5e9b1f02"},
		{"corrupted", "CORRUPTEDDUNGEON", "@CORRUPTEDDUNGEON@b7e64a12-9d3c-4f8a-b1e2-6c9d0a4f7e31"},
		{"hellgate", "HELLCLUSTER", "@HELLCLUSTER@e2f8c4d6-1a3b-4e7f-9c2d-8b5a6f0e4c19"},
		{"hce", "FishyBusiness-HRD", "FishyBusiness-HRD"},
		{"mists", "MISTS", "@MISTS@9283d553-ab71-4c14-bb34-64567137419a"},
		{"knightfall", "KNIGHTFALLABBEY", "@KNIGHTFALLABBEY@f1e2d3c4-b5a6-4788-9c0d-1e2f3a4b5c6d"},
		{"abyssal", "HELLDUNGEON", "@HELLDUNGEON@a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"},
		{"ancient", "DRAGONAREA", "@DRAGONAREA@d4c3b2a1-f0e9-4d8c-7b6a-595847464544"},
	}
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
			fameGain := int64(40 + rng.Intn(160))
			silverGain := int64(90 + rng.Intn(400))
			st.AddDamage(actor, "Mob heretico", dmg)
			st.AddFame(fameGain)
			st.AddSilver(silverGain)
			hub.Publish(NewEvent("damage", map[string]any{
				"source": actor, "target": "Mob heretico", "amount": dmg,
				"ability": abilities[rng.Intn(len(abilities))],
			}))
			hub.Publish(NewEvent("fame", map[string]any{
				"amount": fameGain, "total": st.Fame(),
			}))
			hub.Publish(NewEvent("silver", map[string]any{
				"amount": silverGain, "total": st.Silver(), "source": "ground",
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
			dungeon := dungeonTypes[rng.Intn(len(dungeonTypes))]
			simDuration := 420 + rng.Intn(1800)
			simEndedAt := time.Now()
			hub.Publish(NewEvent("dungeonRun", map[string]any{
				"uid":         fmt.Sprintf("sim-dng-%d", time.Now().UnixNano()),
				"ts":          simEndedAt.UnixMilli(),
				"startedAt":   simEndedAt.UnixMilli(),
				"type":        dungeon.kind,
				"tier":        4 + rng.Intn(5),
				"level":       rng.Intn(5),
				"enchantment": 0,
				"map":         dungeon.cluster,
				"zone":        dungeon.zone,
				"duration":    simDuration,
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
