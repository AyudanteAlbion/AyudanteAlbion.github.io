// SPDX-License-Identifier: GPL-3.0-only

package tracker

import (
	"fmt"
	"time"
)

// Pesca: Albion no emite HarvestFinished al pescar. La captura llega como una
// secuencia de operaciones del cliente (FishingStart → FishingCatch →
// FishingFinish/Cancel), los ítems que aparecen cerca durante la picada
// (NewSimpleItem / NewEquipmentItem) y el RewardGranted que confirma qué se
// llevó. Es la misma máquina de estados que GatheringController de la app de
// referencia: sin picada activa los rewards se ignoran, y solo cuentan los
// ítems que se vieron aparecer.

type fishingCatch struct {
	itemIndex int64
	quantity  int64
}

type fishingState struct {
	active     bool
	eventID    int64
	catchID    int64
	rodItem    int64
	bitten     bool
	discovered map[int64]bool
	confirmed  []fishingCatch
}

// fishingStart arranca una sesión de pesca con la caña usada.
func (h *handlers) fishingStart(params map[byte]any) {
	if !h.trackingAllowed() {
		return
	}
	state := &fishingState{active: true}
	if eventID, ok := h.paramNum("FishingStart", params, "eventId"); ok { state.eventID = eventID }
	if rod, ok := h.paramNum("FishingStart", params, "rod"); ok {
		state.rodItem = rod
	}
	h.fishing = state
}

// fishingCatch marca que el pez mordió: a partir de acá se aceptan ítems.
func (h *handlers) fishingCatch(params map[byte]any) {
	if h.fishing != nil {
		// SAT clears discoveries and confirmations for every new catch action;
		// otherwise a second cast could replay the first fish.
		h.fishing.bitten = true
		if actionID, ok := h.paramNum("FishingCatch", params, "actionId"); ok { h.fishing.catchID = actionID }
		h.fishing.discovered = make(map[int64]bool)
		h.fishing.confirmed = nil
	}
}

// fishingDiscover registra un ítem que apareció cerca durante la picada. La
// caña misma también aparece y se descarta.
func (h *handlers) fishingDiscover(event string, params map[byte]any) {
	state := h.fishing
	if state == nil || !state.active || !state.bitten {
		return
	}
	itemIndex, ok := h.paramNum(event, params, "itemId")
	if !ok || itemIndex == state.rodItem {
		return
	}
	if state.discovered == nil {
		state.discovered = make(map[int64]bool)
	}
	state.discovered[itemIndex] = true
}

// fishingReward confirma la cantidad de un ítem descubierto: sin picada
// activa o sin haberlo visto aparecer, no es parte de la pesca.
func (h *handlers) fishingReward(params map[byte]any) {
	state := h.fishing
	if state == nil || !state.active || !state.bitten {
		return
	}
	itemIndex, ok := h.paramNum("RewardGranted", params, "itemId")
	if !ok {
		return
	}
	// A reward is valid only if the item appeared after the current bite.
	// The reference controller never accepts a reward from an empty discovery
	// set; accepting it made unrelated rewards look like fish.
	if state.discovered == nil || !state.discovered[itemIndex] {
		return
	}
	quantity, _ := h.paramNum("RewardGranted", params, "quantity")
	if quantity <= 0 {
		quantity = 1
	}
	state.confirmed = append(state.confirmed, fishingCatch{itemIndex: itemIndex, quantity: quantity})
	delete(state.discovered, itemIndex)
}

// fishingFinish cierra la pesca: si terminó bien, publica una recolección por
// ítem confirmado. Cancelar o fallar descarta todo, como en la referencia.
func (h *handlers) fishingFinish(params map[byte]any) {
	state := h.fishing
	h.fishing = nil
	if state == nil || !h.trackingAllowed() {
		return
	}
	succeeded, ok := h.paramBool("FishingFinish", params, "succeeded")
	if !ok || !succeeded {
		return
	}
	for _, catch := range state.confirmed {
		h.hub.Publish(NewEvent("gathering", map[string]any{
			"uid":      fmt.Sprintf("fish-%d-%d", func() int64 { if state.catchID > 0 { return state.catchID }; if state.eventID > 0 { return state.eventID }; return time.Now().UnixNano() }(), catch.itemIndex),
			"ts":       time.Now().UnixMilli(),
			"itemId":   fmt.Sprintf("%d", catch.itemIndex),
			"quantity": catch.quantity,
			"fished":   true,
			"map":      h.st.Zone(),
		}))
	}
}

func (h *handlers) fishingCancel() {
	h.fishing = nil
}
