// SPDX-License-Identifier: GPL-3.0-only
//
// Capture/pipeline behavior is adapted for Go from Statistics Analysis Tool
// (SAT) revision 9f4471b2905f4152938d84721492c6ac86499750 (GPL-3.0-only).

package tracker

import (
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
	if d.candidate.name != name {
		d.candidate = serverCandidate{name: name, firstSeen: now}
		return name, d.stableFor == 0
	}
	return name, now.Sub(d.candidate.firstSeen) >= d.stableFor
}

type packetPipeline struct {
	mu     sync.Mutex // Protocol parser and handlers are intentionally serial
	state  *State
	hub    *Hub
	parser *photon.Parser
	server *serverDetector
	accept func(string) bool
}

func newPacketPipeline(src *LiveSource, state *State, hub *Hub, codes *Codes, entities *EntityStore, accept func(string) bool) *packetPipeline {
	handlers := newHandlersWithEntities(src, state, hub, codes, entities)
	return &packetPipeline{
		state:  state,
		hub:    hub,
		parser: photon.NewParser(photon.Handler{OnEvent: handlers.event, OnRequest: handlers.request, OnResponse: handlers.response}),
		server: newServerDetector(),
		accept: accept,
	}
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
	if server, confirmed := p.server.Observe(packet, time.Now()); confirmed {
		p.state.ConfirmServer(server)
	}
	if inspection.Encrypted {
		return
	}

	p.mu.Lock()
	ok := p.parser.Receive(packet.Payload)
	p.mu.Unlock()
	if !ok {
		p.state.MarkMalformed()
	}
}
