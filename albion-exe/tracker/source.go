package tracker

import (
	"context"
	"math/rand"
	"time"
)

// Source es cualquier productor de eventos de juego. Hoy existe el simulador;
// la captura real de paquetes Photon implementará esta misma interfaz y se
// enchufa sin tocar ni el hub, ni el estado, ni el frontend.
type Source interface {
	// Name identifica la fuente en la UI («simulador», «npcap»…).
	Name() string
	// Available indica si la fuente puede arrancar en esta PC.
	Available() (bool, string)
	// Run bombea eventos hasta que el contexto se cancela.
	Run(ctx context.Context, st *State, hub *Hub) error
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
	abilities := []string{"Bola de fuego", "Tajo", "Flecha perforante", "Maldición", "Golpe heroico"}

	st.SetCharacter(party[0])
	st.SetParty(party)
	st.SetCapturing(true, true)
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

		case <-push.C:
			hub.Publish(NewEvent("snapshot", st.Snapshot()))
		}
	}
}
