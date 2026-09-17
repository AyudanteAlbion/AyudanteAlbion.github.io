package tracker

import (
	"testing"

	"ayudante-albion-desktop/internal/tracker/photon"
)

// TestBatchedHealthUpdatesUseGUIDPartyAndIdentityGate cubre el evento
// HealthUpdates (7): un único "targets" para todo el lote y arreglos
// paralelos "values"/"sources". Reglas que debe respetar el lote:
//   - sin identidad (pre-Join) no se crea ninguna métrica;
//   - el daño hecho se atribuye por GUID a la fuente que está en party;
//   - el daño recibido se atribuye al objetivo de party (aunque la fuente
//     sea desconocida);
//   - la autocuración cuenta para el medidor de curación;
//   - el daño autoinfligido (source == target) NO infla el medidor de daño
//     hecho: paridad con CombatController de la app de referencia (SAT).
func TestBatchedHealthUpdatesUseGUIDPartyAndIdentityGate(t *testing.T) {
	state := NewState()
	handler := newHandlers(nil, state, NewHub(), testCodes(t))
	// A pre-Join batch must not create a metric.
	handler.event(&photon.EventData{Code: 7, Parameters: map[byte]any{0: int64(42), 2: []float64{-100000}, 6: []int64{42}, 252: int64(7)}})
	if len(state.Snapshot().Combatants) != 0 {
		t.Fatal("pre-identity HealthUpdates created combat metrics")
	}

	// Join identifica al personaje local (42) y el roster de party trae a una
	// aliada (77) ya correlacionada por GUID, como en las capturas reales.
	handler.response(&photon.OperationResponse{ReturnCode: 0, Parameters: map[byte]any{0: int64(42), 1: localGUIDBytes, 2: "Anon", 253: int64(2)}})
	handler.event(&photon.EventData{Code: 29, Parameters: map[byte]any{0: int64(77), 1: "Aliada", 7: partyGUIDBytes, 252: int64(29)}})
	allGUIDs := append(append([]byte(nil), localGUIDBytes...), partyGUIDBytes...)
	handler.event(&photon.EventData{Code: 231, Parameters: map[byte]any{8: allGUIDs, 9: []string{"Anon", "Aliada"}, 252: int64(231)}})

	// Lote mixto contra el personaje local (42): golpe de la aliada (daño
	// hecho + daño recibido), autocuración y daño autoinfligido (descartado).
	handler.event(&photon.EventData{Code: 7, Parameters: map[byte]any{0: int64(42), 2: []float64{-100000, 50000, -100000}, 6: []int64{77, 42, 42}, 252: int64(7)}})

	metrics := map[string]Combatant{}
	for _, combatant := range state.Snapshot().Combatants {
		metrics[combatant.Name] = combatant
	}
	if len(metrics) != 2 {
		t.Fatalf("batched health metrics = %+v", state.Snapshot().Combatants)
	}
	if got := metrics["Aliada"]; got.Damage != 10 || got.Taken != 0 || got.Healing != 0 {
		t.Fatalf("Aliada metrics = %+v, want Damage 10", got)
	}
	if got := metrics["Anon"]; got.Damage != 0 || got.Taken != 10 || got.Healing != 5 {
		t.Fatalf("Anon metrics = %+v, want Taken 10 and Healing 5", got)
	}
}
