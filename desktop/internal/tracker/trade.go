// SPDX-License-Identifier: GPL-3.0-only
//
// Player-trade tracking is adapted for Go/Wails from Statistics Analysis Tool
// (SAT) revision 9f4471b2905f4152938d84721492c6ac86499750 (GPL-3.0-only).

package tracker

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

const maxSignedInt64 = uint64(1<<63 - 1)

type playerTradeItem struct {
	ItemIndex int64 `json:"itemIndex"`
	Quantity  int64 `json:"quantity"`
}

type playerTradeUpdate struct {
	TradeID               int64             `json:"tradeId"`
	Revision              int64             `json:"revision"`
	LocalSilverInternal   int64             `json:"localSilverInternal"`
	PartnerSilverInternal int64             `json:"partnerSilverInternal"`
	LocalItems            []playerTradeItem `json:"localItems"`
	PartnerItems          []playerTradeItem `json:"partnerItems"`
}

type playerTradeSession struct {
	TradeID     int64
	PartnerName string
	LastUpdate  *playerTradeUpdate
}

// PlayerTradeEntry mirrors SAT's PlayerTradeContent rows in the live SSE
// contract so the Sesión tab can keep a player-trade history independently of
// the manual commerce ledger (buy/sell/craft).
type PlayerTradeEntry struct {
	UID                    string `json:"uid"`
	TS                     int64  `json:"ts"`
	TradeID                int64  `json:"tradeId"`
	Revision               int64  `json:"revision"`
	PartnerName            string `json:"partnerName,omitempty"`
	Direction              string `json:"direction"` // incoming | outgoing
	IsSilver               bool   `json:"isSilver"`
	ItemIndex              int64  `json:"itemIndex,omitempty"`
	ItemID                 string `json:"itemId,omitempty"`
	Quantity               int64  `json:"quantity"`
	Silver                 int64  `json:"silver,omitempty"`
	InternalSilver         int64  `json:"internalSilver,omitempty"`
	Map                    string `json:"map,omitempty"`
	AnalyticsDirectionName string `json:"analyticsDirectionName,omitempty"`
}

func (h *handlers) registerPlayerTradeSession(tradeID int64, partnerName string) {
	if tradeID <= 0 || !h.trackingAllowed() {
		return
	}
	if h.playerTrades == nil {
		h.playerTrades = make(map[int64]*playerTradeSession)
	}
	partnerName = h.normalizeTradePartner(partnerName)
	if session, ok := h.playerTrades[tradeID]; ok {
		if partnerName != "" {
			session.PartnerName = partnerName
		}
		return
	}
	h.playerTrades[tradeID] = &playerTradeSession{TradeID: tradeID, PartnerName: partnerName}
}

func (h *handlers) updatePlayerTrade(update playerTradeUpdate) {
	if update.TradeID <= 0 || !h.trackingAllowed() {
		return
	}
	if h.playerTrades == nil {
		h.playerTrades = make(map[int64]*playerTradeSession)
	}
	session, ok := h.playerTrades[update.TradeID]
	if !ok {
		session = &playerTradeSession{TradeID: update.TradeID}
		h.playerTrades[update.TradeID] = session
	}
	if session.LastUpdate == nil || update.Revision >= session.LastUpdate.Revision {
		copyUpdate := update
		session.LastUpdate = &copyUpdate
	}
}

func (h *handlers) removePlayerTradeSession(tradeID int64) {
	if tradeID <= 0 || h.playerTrades == nil {
		return
	}
	delete(h.playerTrades, tradeID)
}

func (h *handlers) finishPlayerTrade(tradeID int64) {
	if tradeID <= 0 || h.playerTrades == nil {
		return
	}
	session, ok := h.playerTrades[tradeID]
	delete(h.playerTrades, tradeID)
	if !ok || !h.trackingAllowed() || session.LastUpdate == nil {
		return
	}
	entries := h.createPlayerTradeEntries(session, time.Now())
	if len(entries) == 0 {
		return
	}
	h.hub.Publish(NewEvent("trade", map[string]any{
		"tradeId":     tradeID,
		"partnerName": session.PartnerName,
		"map":         h.st.Zone(),
		"entries":     entries,
	}))
}

func (h *handlers) createPlayerTradeEntries(session *playerTradeSession, at time.Time) []PlayerTradeEntry {
	if session == nil || session.LastUpdate == nil {
		return nil
	}
	base := at.UnixMilli()
	zone := h.st.Zone()
	partner := h.normalizeTradePartner(session.PartnerName)
	entries := make([]PlayerTradeEntry, 0, len(session.LastUpdate.PartnerItems)+len(session.LastUpdate.LocalItems)+2)
	index := 0
	addItem := func(direction string, item playerTradeItem) {
		if item.ItemIndex <= 0 {
			return
		}
		quantity := item.Quantity
		if quantity <= 0 {
			quantity = 1
		}
		entries = append(entries, PlayerTradeEntry{
			UID:                    createPlayerTradeEntryUID(base, index),
			TS:                     base + int64(index),
			TradeID:                session.TradeID,
			Revision:               session.LastUpdate.Revision,
			PartnerName:            partner,
			Direction:              direction,
			AnalyticsDirectionName: analyticsDirectionName(direction),
			IsSilver:               false,
			ItemIndex:              item.ItemIndex,
			ItemID:                 strconv.FormatInt(item.ItemIndex, 10),
			Quantity:               quantity,
			Map:                    zone,
		})
		index++
	}
	addSilver := func(direction string, internal int64) {
		if internal <= 0 {
			return
		}
		entries = append(entries, PlayerTradeEntry{
			UID:                    createPlayerTradeEntryUID(base, index),
			TS:                     base + int64(index),
			TradeID:                session.TradeID,
			Revision:               session.LastUpdate.Revision,
			PartnerName:            partner,
			Direction:              direction,
			AnalyticsDirectionName: analyticsDirectionName(direction),
			IsSilver:               true,
			Quantity:               1,
			Silver:                 fixPointInteger(internal),
			InternalSilver:         internal,
			Map:                    zone,
		})
		index++
	}

	// Same ordering used by SAT's TradeController: partner content first is
	// incoming, local content second is outgoing, then silver for each side.
	for _, item := range session.LastUpdate.PartnerItems {
		addItem("incoming", item)
	}
	for _, item := range session.LastUpdate.LocalItems {
		addItem("outgoing", item)
	}
	addSilver("incoming", session.LastUpdate.PartnerSilverInternal)
	addSilver("outgoing", session.LastUpdate.LocalSilverInternal)
	return entries
}

func (h *handlers) registerPlayerTradeFromParams(name string, params map[byte]any) {
	tradeID := h.paramInt64(name, "tradeId", params)
	partner := h.paramString(name, "partnerName", params)
	h.registerPlayerTradeSession(tradeID, partner)
}

func (h *handlers) paramValue(event, field string, params map[byte]any) any {
	value, _ := h.param(event, params, field)
	return value
}

func (h *handlers) paramInt64(event, field string, params map[byte]any) int64 {
	value, _ := h.paramNum(event, params, field)
	return value
}

func (h *handlers) paramString(event, field string, params map[byte]any) string {
	value, _ := h.paramStr(event, params, field)
	return value
}

func (h *handlers) updatePlayerTradeFromParams(params map[byte]any) {
	name := "PlayerTradeUpdate"
	update := playerTradeUpdate{
		TradeID:               h.paramInt64(name, "tradeId", params),
		Revision:              h.paramInt64(name, "revision", params),
		LocalSilverInternal:   h.paramInt64(name, "localSilver", params),
		PartnerSilverInternal: h.paramInt64(name, "partnerSilver", params),
		LocalItems:            buildPlayerTradeItems(h.paramValue(name, "localItems", params), h.paramValue(name, "localQuantities", params)),
		PartnerItems:          buildPlayerTradeItems(h.paramValue(name, "partnerItems", params), h.paramValue(name, "partnerQuantities", params)),
	}
	h.updatePlayerTrade(update)
}

func buildPlayerTradeItems(indexesValue, quantitiesValue any) []playerTradeItem {
	indexes := int64Slice(indexesValue)
	quantities := int64Slice(quantitiesValue)
	count := len(indexes)
	if len(quantities) > count {
		count = len(quantities)
	}
	items := make([]playerTradeItem, 0, count)
	for i := 0; i < count; i++ {
		itemIndex := int64At(indexes, i)
		if itemIndex <= 0 {
			continue
		}
		quantity := int64At(quantities, i)
		if quantity <= 0 {
			quantity = 1
		}
		items = append(items, playerTradeItem{ItemIndex: itemIndex, Quantity: quantity})
	}
	return items
}

func int64At(values []int64, index int) int64 {
	if index < 0 || index >= len(values) {
		return 0
	}
	return values[index]
}

func int64Slice(value any) []int64 {
	switch v := value.(type) {
	case nil:
		return nil
	case []int64:
		return append([]int64(nil), v...)
	case []int32:
		out := make([]int64, 0, len(v))
		for _, n := range v {
			out = append(out, int64(n))
		}
		return out
	case []int16:
		out := make([]int64, 0, len(v))
		for _, n := range v {
			out = append(out, int64(n))
		}
		return out
	case []byte:
		out := make([]int64, 0, len(v))
		for _, n := range v {
			out = append(out, int64(n))
		}
		return out
	case []float32:
		out := make([]int64, 0, len(v))
		for _, n := range v {
			out = append(out, int64(n))
		}
		return out
	case []float64:
		out := make([]int64, 0, len(v))
		for _, n := range v {
			out = append(out, int64(n))
		}
		return out
	case []any:
		out := make([]int64, 0, len(v))
		for _, item := range v {
			if n, ok := anyToInt64(item); ok {
				out = append(out, n)
			}
		}
		return out
	default:
		if n, ok := anyToInt64(v); ok {
			return []int64{n}
		}
		return nil
	}
}

func anyToInt64(value any) (int64, bool) {
	switch v := value.(type) {
	case int:
		return int64(v), true
	case int8:
		return int64(v), true
	case int16:
		return int64(v), true
	case int32:
		return int64(v), true
	case int64:
		return v, true
	case uint:
		if uint64(v) > maxSignedInt64 {
			return 0, false
		}
		return int64(v), true
	case uint8:
		return int64(v), true
	case uint16:
		return int64(v), true
	case uint32:
		return int64(v), true
	case uint64:
		if v > maxSignedInt64 {
			return 0, false
		}
		return int64(v), true
	case float32:
		return int64(v), true
	case float64:
		return int64(v), true
	case string:
		if strings.TrimSpace(v) == "" {
			return 0, false
		}
		parsed, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func fixPointInteger(internal int64) int64 {
	return internal / 10000
}

func createPlayerTradeEntryUID(base int64, index int) string {
	return fmt.Sprintf("pt:%d:%d", base, index)
}

func analyticsDirectionName(direction string) string {
	if direction == "incoming" {
		return "Incoming"
	}
	return "Outgoing"
}

func (h *handlers) normalizeTradePartner(partnerName string) string {
	partnerName = strings.TrimSpace(partnerName)
	local := strings.TrimSpace(h.st.Character())
	if local != "" && strings.EqualFold(partnerName, local) {
		return ""
	}
	return partnerName
}
