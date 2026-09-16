// SPDX-License-Identifier: GPL-3.0-only

package tracker

import "sort"

// Typed operation/event models keep protocol parameter indexes at the edge.
// Handlers below this boundary no longer pass unstructured maps around.
type JoinResponseData struct {
	ObjectID int64
	GUID     string
	Name     string
	Zone     string
	Guild    string
	Alliance string
}

type NewCharacterData struct {
	ObjectID    int64
	HasObjectID bool
	GUID        string
	Name        string
	Guild       string
	Alliance    string
}

type PartyJoinedData struct{ Members []partyMember }
type PartyPlayerJoinedData struct{ Member partyMember }
type PartyPlayerLeftData struct {
	GUID        string
	ObjectID    int64
	HasObjectID bool
}
type ChangeClusterData struct{ Zone string }
type JoinFinishedData struct{ Zone string }
type PartyDisbandedData struct{}
type HealthUpdateData struct {
	TargetID int64
	SourceID int64
	Value    int64
}
type HealthUpdatesData struct{ Updates []HealthUpdateData }

// decodeJoinResponse lee cada campo por separado, como hace la aplicación de
// referencia, en vez de exigirlos todos juntos. El segundo valor indica si la
// respuesta alcanza para ATRIBUIR estadísticas (nombre + ObjectID + GUID); el
// tercero, si alcanza para MOSTRAR el personaje (nombre + ObjectID). Un Join
// sin GUID deja de traducirse en "Personaje no detectado" aunque el juego ya
// haya dicho quién sos.
func decodeJoinResponse(codes *Codes, params map[byte]any) (JoinResponseData, bool, bool) {
	var result JoinResponseData
	value := func(field string) (any, bool) {
		index, ok := codes.SelfOp.Parameters[field]
		if !ok || index < 0 || index > 255 {
			return nil, false
		}
		current, ok := params[byte(index)]
		return current, ok
	}
	if raw, ok := value("id"); ok {
		result.ObjectID, _ = num(raw)
	}
	if raw, ok := value("guid"); ok {
		result.GUID, _ = GUIDFromPhoton(raw)
	}
	if raw, ok := value("name"); ok {
		result.Name, _ = str(raw)
	}
	if raw, ok := value("zone"); ok {
		result.Zone = worldLocation(raw)
	}
	if raw, ok := value("guild"); ok {
		result.Guild, _ = str(raw)
	}
	if raw, ok := value("alliance"); ok {
		result.Alliance, _ = str(raw)
	}
	identifiable := result.ObjectID != 0 && result.Name != ""
	return result, identifiable && result.GUID != "", identifiable
}

func (h *handlers) decodeNewCharacter(params map[byte]any) NewCharacterData {
	const event = "NewCharacter"
	var result NewCharacterData
	if id, ok := h.paramNum(event, params, "id"); ok {
		result.ObjectID, result.HasObjectID = id, true
	}
	result.Name, _ = h.paramStr(event, params, "name")
	if raw, ok := h.param(event, params, "guid"); ok {
		result.GUID, _ = GUIDFromPhoton(raw)
	}
	result.Guild, _ = h.paramStr(event, params, "guild")
	result.Alliance, _ = h.paramStr(event, params, "alliance")
	return result
}

func (h *handlers) decodePartyJoined(params map[byte]any) PartyJoinedData {
	guids, names := []string(nil), []string(nil)
	if value, ok := h.param("PartyJoined", params, "guids"); ok {
		guids = GUIDsFromPhoton(value)
	}
	if value, ok := h.param("PartyJoined", params, "names"); ok {
		names = stringsFromPhoton(value)
	}
	result := PartyJoinedData{}
	for i := 0; i < len(guids) && i < len(names); i++ {
		if guids[i] != "" && names[i] != "" {
			result.Members = append(result.Members, partyMember{GUID: guids[i], Name: names[i]})
		}
	}
	return result
}

func (h *handlers) decodePartyPlayerJoined(params map[byte]any) PartyPlayerJoinedData {
	var result PartyPlayerJoinedData
	if raw, ok := h.param("PartyPlayerJoined", params, "guid"); ok {
		result.Member.GUID, _ = GUIDFromPhoton(raw)
	}
	result.Member.Name, _ = h.paramStr("PartyPlayerJoined", params, "name")
	return result
}

func (h *handlers) decodePartyPlayerLeft(params map[byte]any) PartyPlayerLeftData {
	var result PartyPlayerLeftData
	if raw, ok := h.param("PartyPlayerLeft", params, "guid"); ok {
		result.GUID, _ = GUIDFromPhoton(raw)
	}
	if id, ok := h.paramNum("PartyPlayerLeft", params, "id"); ok {
		result.ObjectID, result.HasObjectID = id, true
	}
	return result
}

func numericSequence(value any) []int64 {
	result := []int64{}
	appendNumber := func(value any) {
		if number, ok := num(value); ok {
			result = append(result, number)
		}
	}
	switch values := value.(type) {
	case []byte:
		for _, value := range values {
			appendNumber(value)
		}
	case []int16:
		for _, value := range values {
			appendNumber(value)
		}
	case []int32:
		for _, value := range values {
			appendNumber(value)
		}
	case []int64:
		return append(result, values...)
	case []float32:
		for _, value := range values {
			appendNumber(value)
		}
	case []float64:
		for _, value := range values {
			appendNumber(value)
		}
	case []any:
		for _, value := range values {
			appendNumber(value)
		}
	case map[any]any:
		type entry struct {
			index int64
			value any
		}
		entries := make([]entry, 0, len(values))
		for key, value := range values {
			if index, ok := num(key); ok {
				entries = append(entries, entry{index: index, value: value})
			}
		}
		sort.Slice(entries, func(i, j int) bool { return entries[i].index < entries[j].index })
		for _, entry := range entries {
			appendNumber(entry.value)
		}
	}
	return result
}

func (h *handlers) decodeHealthUpdates(params map[byte]any) HealthUpdatesData {
	target, _ := h.paramNum("HealthUpdates", params, "targets")
	valuesRaw, _ := h.param("HealthUpdates", params, "values")
	sourcesRaw, _ := h.param("HealthUpdates", params, "sources")
	values, sources := numericSequence(valuesRaw), numericSequence(sourcesRaw)
	result := HealthUpdatesData{Updates: make([]HealthUpdateData, 0, len(values))}
	for index, value := range values {
		source := int64(0)
		if index < len(sources) {
			source = sources[index]
		}
		result.Updates = append(result.Updates, HealthUpdateData{TargetID: target, SourceID: source, Value: value})
	}
	return result
}

func (h *handlers) decodeJoinFinished(params map[byte]any) (JoinFinishedData, bool) {
	index, ok := h.codes.Param("JoinFinished", "zone")
	if !ok {
		return JoinFinishedData{}, false
	}
	zone := worldLocation(params[index])
	return JoinFinishedData{Zone: zone}, zone != ""
}

func (h *handlers) decodePartyDisbanded(map[byte]any) PartyDisbandedData { return PartyDisbandedData{} }

func (h *handlers) decodeChangeCluster(params map[byte]any) (ChangeClusterData, bool) {
	index, ok := h.codes.Param("ChangeCluster", "zone")
	if !ok {
		return ChangeClusterData{}, false
	}
	zone := worldLocation(params[index])
	return ChangeClusterData{Zone: zone}, zone != ""
}
