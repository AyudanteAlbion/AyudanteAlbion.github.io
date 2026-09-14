package tracker

import (
	"context"
	"errors"
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

// Diagnosable la implementan las fuentes que pueden reportar qué códigos de
// evento están llegando. Es lo que se usa para actualizar la tabla después de
// un patch de Albion.
type Diagnosable interface {
	SetDiagnostic(on bool)
	Diagnostic() map[string]any
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

func (f FallbackSource) Diagnostic() map[string]any {
	if d, ok := f.active().(Diagnosable); ok {
		return d.Diagnostic()
	}
	return map[string]any{"enabled": false, "known": []any{}, "unknown": []any{}}
}
