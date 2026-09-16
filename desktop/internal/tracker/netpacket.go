// SPDX-License-Identifier: GPL-3.0-only

package tracker

import (
	"encoding/binary"
	"net"
	"sort"
	"time"
)

const (
	linkTypeNull         int32 = 0
	linkTypeEthernet     int32 = 1
	linkTypeRaw          int32 = 101
	protoUDP                   = 17
	maxIPv4Assemblies          = 256
	maxIPv4AssemblyBytes       = 8 << 20
	maxIPv4Payload             = 65535
)

var ipv4AssemblyTTL = 15 * time.Second

func photonPort(port uint16) bool { return port == 5055 || port == 5056 || port == 5058 }

type ipv4FragmentKey struct {
	src, dst [4]byte
	id       uint16
	proto    byte
}

type ipv4FragmentPart struct {
	offset int
	data   []byte
}

type ipv4FragmentSet struct {
	parts  map[int]ipv4FragmentPart
	length int
	bytes  int
	seen   time.Time
}

type ipv4Reassembler struct {
	sets  map[ipv4FragmentKey]*ipv4FragmentSet
	bytes int
	now   func() time.Time
}

func newIPv4Reassembler() *ipv4Reassembler {
	return &ipv4Reassembler{sets: make(map[ipv4FragmentKey]*ipv4FragmentSet), now: time.Now}
}

func (r *ipv4Reassembler) sweep() {
	if r == nil {
		return
	}
	now := r.now()
	for key, set := range r.sets {
		if now.Sub(set.seen) >= ipv4AssemblyTTL {
			r.remove(key)
		}
	}
}

func (r *ipv4Reassembler) remove(key ipv4FragmentKey) {
	if set := r.sets[key]; set != nil {
		r.bytes -= set.bytes
		if r.bytes < 0 {
			r.bytes = 0
		}
	}
	delete(r.sets, key)
}

func (r *ipv4Reassembler) trim(required int) {
	for len(r.sets) >= maxIPv4Assemblies || r.bytes+required > maxIPv4AssemblyBytes {
		var oldestKey ipv4FragmentKey
		var oldest *ipv4FragmentSet
		for key, set := range r.sets {
			if oldest == nil || set.seen.Before(oldest.seen) {
				oldestKey, oldest = key, set
			}
		}
		if oldest == nil {
			return
		}
		r.remove(oldestKey)
	}
}

func (r *ipv4Reassembler) add(key ipv4FragmentKey, offset int, more bool, payload []byte) ([]byte, bool) {
	if r == nil || offset < 0 || len(payload) == 0 || offset+len(payload) > maxIPv4Payload {
		return nil, false
	}
	r.sweep()
	set := r.sets[key]
	if set == nil {
		r.trim(len(payload))
		set = &ipv4FragmentSet{parts: make(map[int]ipv4FragmentPart), seen: r.now()}
		r.sets[key] = set
	}
	set.seen = r.now()
	if existing, ok := set.parts[offset]; ok {
		if len(existing.data) == len(payload) {
			return r.complete(key, set)
		}
		r.remove(key)
		return nil, false
	}
	end := offset + len(payload)
	for _, part := range set.parts {
		partEnd := part.offset + len(part.data)
		if offset < partEnd && end > part.offset {
			r.remove(key)
			return nil, false
		}
	}
	copyOfPayload := append([]byte(nil), payload...)
	set.parts[offset] = ipv4FragmentPart{offset: offset, data: copyOfPayload}
	set.bytes += len(copyOfPayload)
	r.bytes += len(copyOfPayload)
	if !more {
		if set.length != 0 && set.length != end {
			r.remove(key)
			return nil, false
		}
		set.length = end
	}
	return r.complete(key, set)
}

func (r *ipv4Reassembler) complete(key ipv4FragmentKey, set *ipv4FragmentSet) ([]byte, bool) {
	if set.length == 0 {
		return nil, false
	}
	offsets := make([]int, 0, len(set.parts))
	for offset := range set.parts {
		offsets = append(offsets, offset)
	}
	sort.Ints(offsets)
	next := 0
	for _, offset := range offsets {
		if offset != next {
			return nil, false
		}
		next += len(set.parts[offset].data)
	}
	if next != set.length {
		return nil, false
	}
	result := make([]byte, set.length)
	for _, offset := range offsets {
		copy(result[offset:], set.parts[offset].data)
	}
	r.remove(key)
	return result, true
}

func parseCapturedFrame(frame []byte, linkType int32, adapter string, reassembler *ipv4Reassembler) (CapturedDatagram, bool) {
	if len(frame) == 0 {
		return CapturedDatagram{}, false
	}
	offset := 0
	switch linkType {
	case linkTypeEthernet:
		if len(frame) < 14 {
			return CapturedDatagram{}, false
		}
		etherType := binary.BigEndian.Uint16(frame[12:14])
		offset = 14
		for etherType == 0x8100 || etherType == 0x88a8 {
			if len(frame) < offset+4 {
				return CapturedDatagram{}, false
			}
			etherType = binary.BigEndian.Uint16(frame[offset+2 : offset+4])
			offset += 4
		}
		if etherType == 0x0800 {
			return parseIPv4(frame[offset:], adapter, reassembler)
		}
		if etherType == 0x86dd {
			return parseIPv6(frame[offset:], adapter)
		}
		return CapturedDatagram{}, false
	case linkTypeRaw:
		if frame[0]>>4 == 4 {
			return parseIPv4(frame, adapter, reassembler)
		}
		if frame[0]>>4 == 6 {
			return parseIPv6(frame, adapter)
		}
	case linkTypeNull:
		// DLT_NULL normally has a four-byte native-endian address family.
		if len(frame) < 5 {
			return CapturedDatagram{}, false
		}
		if frame[4]>>4 == 4 {
			return parseIPv4(frame[4:], adapter, reassembler)
		}
		if frame[4]>>4 == 6 {
			return parseIPv6(frame[4:], adapter)
		}
	}
	return CapturedDatagram{}, false
}

func parseIPv4(packet []byte, adapter string, reassembler *ipv4Reassembler) (CapturedDatagram, bool) {
	if len(packet) < 20 || packet[0]>>4 != 4 {
		return CapturedDatagram{}, false
	}
	ihl := int(packet[0]&0x0f) * 4
	total := int(binary.BigEndian.Uint16(packet[2:4]))
	if ihl < 20 || total < ihl || total > len(packet) {
		return CapturedDatagram{}, false
	}
	proto := packet[9]
	if proto != protoUDP {
		return CapturedDatagram{}, false
	}
	var key ipv4FragmentKey
	copy(key.src[:], packet[12:16])
	copy(key.dst[:], packet[16:20])
	key.id = binary.BigEndian.Uint16(packet[4:6])
	key.proto = proto
	flagsOffset := binary.BigEndian.Uint16(packet[6:8])
	offset := int(flagsOffset&0x1fff) * 8
	more := flagsOffset&0x2000 != 0
	payload := packet[ihl:total]
	if offset != 0 || more {
		var complete bool
		payload, complete = reassembler.add(key, offset, more, payload)
		if !complete {
			return CapturedDatagram{}, false
		}
	}
	return parseUDP(payload, adapter, net.IP(key.src[:]), net.IP(key.dst[:]))
}

func parseIPv6(packet []byte, adapter string) (CapturedDatagram, bool) {
	if len(packet) < 40 || packet[0]>>4 != 6 {
		return CapturedDatagram{}, false
	}
	payloadLength := int(binary.BigEndian.Uint16(packet[4:6]))
	end := 40 + payloadLength
	if payloadLength == 0 {
		end = len(packet)
	}
	if end > len(packet) {
		return CapturedDatagram{}, false
	}
	next := packet[6]
	offset := 40
	// Follow the common extension headers. Fragmented IPv6 is deliberately not
	// assembled; SAT's Npcap contract only requires IPv4 reassembly.
	for next == 0 || next == 43 || next == 60 {
		if offset+2 > end {
			return CapturedDatagram{}, false
		}
		headerLength := (int(packet[offset+1]) + 1) * 8
		next = packet[offset]
		offset += headerLength
		if offset > end {
			return CapturedDatagram{}, false
		}
	}
	if next == 44 || next != protoUDP {
		return CapturedDatagram{}, false
	}
	return parseUDP(packet[offset:end], adapter, net.IP(append([]byte(nil), packet[8:24]...)), net.IP(append([]byte(nil), packet[24:40]...)))
}

func parseUDP(packet []byte, adapter string, sourceIP, destinationIP net.IP) (CapturedDatagram, bool) {
	if len(packet) < 8 {
		return CapturedDatagram{}, false
	}
	sourcePort := binary.BigEndian.Uint16(packet[0:2])
	destinationPort := binary.BigEndian.Uint16(packet[2:4])
	if !photonPort(sourcePort) && !photonPort(destinationPort) {
		return CapturedDatagram{}, false
	}
	length := int(binary.BigEndian.Uint16(packet[4:6]))
	if length == 0 {
		length = len(packet)
	}
	if length < 8 || length > len(packet) {
		return CapturedDatagram{}, false
	}
	return CapturedDatagram{Adapter: adapter, SourceIP: sourceIP, DestinationIP: destinationIP, SourcePort: sourcePort, DestinationPort: destinationPort, Payload: append([]byte(nil), packet[8:length]...)}, true
}
