// SPDX-License-Identifier: GPL-3.0-only

package tracker

import "sync"

// protocolDiagnostics is shared by Npcap and Socket. It deliberately stores
// only numeric codes and counts; protocol parameters and identity never cross
// this boundary.
type protocolDiagnostics struct {
	mu                sync.Mutex
	enabled           bool
	events            map[int32]int
	operations        map[int32]int
	eventEnvelope     map[byte]int
	operationEnvelope map[byte]int
	missing           uint64
	missingEvents     uint64
	missingOperations uint64
}

func newProtocolDiagnostics() *protocolDiagnostics {
	result := &protocolDiagnostics{}
	result.setEnabled(false)
	return result
}

func (d *protocolDiagnostics) setEnabled(enabled bool) {
	if d == nil {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.enabled = enabled
	if enabled || d.events == nil {
		d.events = make(map[int32]int)
		d.operations = make(map[int32]int)
		d.eventEnvelope = make(map[byte]int)
		d.operationEnvelope = make(map[byte]int)
		d.missing, d.missingEvents, d.missingOperations = 0, 0, 0
	}
}

func (d *protocolDiagnostics) envelope(event bool, code byte) {
	if d == nil {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if !d.enabled {
		return
	}
	if event {
		d.eventEnvelope[code]++
	} else {
		d.operationEnvelope[code]++
	}
}
func (d *protocolDiagnostics) missingCode(event bool) {
	if d == nil {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if !d.enabled {
		return
	}
	d.missing++
	if event {
		d.missingEvents++
	} else {
		d.missingOperations++
	}
}
func (d *protocolDiagnostics) logical(event bool, code int32) {
	if d == nil {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if !d.enabled {
		return
	}
	if event {
		d.events[code]++
	} else {
		d.operations[code]++
	}
}

func (d *protocolDiagnostics) snapshot(store *CodeStore) map[string]any {
	if d == nil {
		return map[string]any{"enabled": false}
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	var codes *Codes
	if store != nil {
		codes, _ = store.Current()
	}
	rows := func(seen map[int32]int, event bool) map[string]any {
		known, unknown := make([]map[string]any, 0), make([]map[string]any, 0)
		for code, count := range seen {
			row := map[string]any{"code": code, "count": count}
			name, ok := "", false
			if codes != nil {
				if event {
					name, ok = codes.EventName(code)
				} else {
					name, ok = codes.OperationName(code)
				}
			}
			if ok {
				row["name"] = name
				known = append(known, row)
			} else {
				unknown = append(unknown, row)
			}
		}
		return map[string]any{"known": known, "unknown": unknown}
	}
	envelopes := func(seen map[byte]int) []map[string]any {
		result := make([]map[string]any, 0, len(seen))
		for code, count := range seen {
			result = append(result, map[string]any{"code": code, "count": count})
		}
		return result
	}
	events, operations := rows(d.events, true), rows(d.operations, false)
	return map[string]any{
		"enabled": d.enabled, "known": events["known"], "unknown": events["unknown"], "operations": operations,
		"envelope":                  map[string]any{"events": envelopes(d.eventEnvelope), "operations": envelopes(d.operationEnvelope)},
		"missingAuthoritativeCode":  d.missing,
		"missingAuthoritativeCodes": map[string]uint64{"event252": d.missingEvents, "operation253": d.missingOperations},
	}
}
