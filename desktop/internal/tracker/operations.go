// SPDX-License-Identifier: GPL-3.0-only

package tracker

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

func decodeJoinResponse(codes *Codes, params map[byte]any) (JoinResponseData, bool) {
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
	return result, result.ObjectID != 0 && result.GUID != "" && result.Name != ""
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

func (h *handlers) decodeChangeCluster(params map[byte]any) (ChangeClusterData, bool) {
	index, ok := h.codes.Param("ChangeCluster", "zone")
	if !ok {
		return ChangeClusterData{}, false
	}
	zone := worldLocation(params[index])
	return ChangeClusterData{Zone: zone}, zone != ""
}
