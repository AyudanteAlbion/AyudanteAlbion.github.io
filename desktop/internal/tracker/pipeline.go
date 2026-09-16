// SPDX-License-Identifier: GPL-3.0-only
//
// Capture/pipeline behavior is adapted for Go from Statistics Analysis Tool
// (SAT) revision 9f4471b2905f4152938d84721492c6ac86499750 (GPL-3.0-only).

package tracker

import (
	"encoding/binary"
	"hash/fnv"
	"net"
	"strings"
	"sync"
	"time"

	"ayudante-albion-desktop/internal/tracker/photon"
)

// CapturedDatagram is the single input contract shared by Npcap and raw
// sockets. No provider is allowed to bypass this pipeline.
type CapturedDatagram struct {
	Adapter         string
	SourceIP        net.IP
	DestinationIP   net.IP
	SourcePort      uint16
	DestinationPort uint16
	Payload         []byte
}

type serverCandidate struct {
	name      string
	firstSeen time.Time
	lastSeen  time.Time
}

type serverDetector struct {
	candidate serverCandidate
	stableFor time.Duration
}

func newServerDetector() *serverDetector {
	return &serverDetector{stableFor: 5 * time.Second}
}

var albionServerPrefixes = map[string]string{
	"5.188.125.":   "Americas",
	"5.45.187.":    "Asia",
	"193.169.238.": "Europe",
}

func albionServerForIP(ip net.IP) string {
	if ip == nil {
		return ""
	}
	value := ip.String()
	for prefix, name := range albionServerPrefixes {
		if strings.HasPrefix(value, prefix) {
			return name
		}
	}
	return ""
}

// Observe follows SAT's stability window: a known server prefix must keep
// appearing for five seconds before it is called confirmed. Both directions
// are inspected because outgoing datagrams carry the server as destination.
func (d *serverDetector) Observe(packet CapturedDatagram, now time.Time) (string, bool) {
	name := albionServerForIP(packet.SourceIP)
	if name == "" {
		name = albionServerForIP(packet.DestinationIP)
	}
	if name == "" {
		return "", false
	}
	if d.candidate.name != name || !d.candidate.lastSeen.IsZero() && now.Sub(d.candidate.lastSeen) > 2*time.Second {
		d.candidate = serverCandidate{name: name, firstSeen: now, lastSeen: now}
		return name, d.stableFor == 0
	}
	d.candidate.lastSeen = now
	return name, now.Sub(d.candidate.firstSeen) >= d.stableFor
}

type packetPipeline struct {
	mu      sync.Mutex // Protocol parser and handlers are intentionally serial
	state   *State
	hub     *Hub
	parser  *photon.Parser
	handler photon.Handler
	server  *serverDetector
	accept  func(string) bool
	recent  map[uint64]time.Time
}

func newPacketPipeline(diagnostics *protocolDiagnostics, state *State, hub *Hub, codes *Codes, entities *EntityStore, accept func(string) bool) *packetPipeline {
	handlers := newHandlersWithDiagnostics(diagnostics, state, hub, codes, entities)
	callbacks := photon.Handler{OnEvent: handlers.event, OnRequest: handlers.request, OnResponse: handlers.response}
	return &packetPipeline{
		state:   state,
		hub:     hub,
		parser:  photon.NewParser(callbacks),
		handler: callbacks,
		server:  newServerDetector(),
		accept:  accept,
		recent:  make(map[uint64]time.Time),
	}
}

func (p *packetPipeline) ResetTransport() {
	p.mu.Lock()
	p.parser = photon.NewParser(p.handler)
	p.server = newServerDetector()
	p.recent = make(map[uint64]time.Time)
	p.mu.Unlock()
}

func packetFingerprint(packet CapturedDatagram) uint64 {
	hash := fnv.New64a()
	_, _ = hash.Write(packet.SourceIP)
	_, _ = hash.Write(packet.DestinationIP)
	var ports [4]byte
	binary.BigEndian.PutUint16(ports[0:2], packet.SourcePort)
	binary.BigEndian.PutUint16(ports[2:4], packet.DestinationPort)
	_, _ = hash.Write(ports[:])
	_, _ = hash.Write(packet.Payload)
	return hash.Sum64()
}

func (p *packetPipeline) duplicateLocked(packet CapturedDatagram, now time.Time) bool {
	const duplicateWindow = 500 * time.Millisecond
	fingerprint := packetFingerprint(packet)
	if seen, ok := p.recent[fingerprint]; ok && now.Sub(seen) <= duplicateWindow {
		return true
	}
	p.recent[fingerprint] = now
	if len(p.recent) > 1024 {
		for key, seen := range p.recent {
			if now.Sub(seen) > duplicateWindow {
				delete(p.recent, key)
			}
		}
	}
	return false
}

// MarkFrame registra una trama entregada por el driver de captura, con o sin
// datagrama utilizable. Deja a la vista el tramo del camino que antes no tenía
// ningún contador.
func (p *packetPipeline) MarkFrame(linkType int32, parsed bool) {
	p.state.MarkFrame(linkType, parsed)
}

func (p *packetPipeline) Ingest(packet CapturedDatagram) {
	if len(packet.Payload) == 0 {
		return
	}
	p.state.MarkPacket()
	inspection := photon.Inspect(packet.Payload)
	if !inspection.Valid {
		p.state.MarkMalformed()
		return
	}
	if p.accept != nil && !p.accept(packet.Adapter) {
		return
	}

	p.state.MarkPhoton(packet.Adapter, inspection.Encrypted, inspection.Packets)
	p.mu.Lock()
	now := time.Now()
	if p.duplicateLocked(packet, now) {
		p.mu.Unlock()
		return
	}
	if server, confirmed := p.server.Observe(packet, now); confirmed {
		p.state.ConfirmServer(server)
	}
	if inspection.Encrypted {
		p.mu.Unlock()
		return
	}

	ok := p.parser.Receive(packet.Payload)
	p.mu.Unlock()
	if !ok {
		p.state.MarkMalformed()
	}
}
