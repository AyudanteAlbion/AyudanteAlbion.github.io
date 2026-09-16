package tracker

import (
	"encoding/binary"
	"net"
	"testing"
)

func ipv4Fragment(id uint16, offset int, more bool, payload []byte) []byte {
	packet := make([]byte, 20+len(payload))
	packet[0] = 0x45
	binary.BigEndian.PutUint16(packet[2:4], uint16(len(packet)))
	binary.BigEndian.PutUint16(packet[4:6], id)
	flags := uint16(offset / 8)
	if more {
		flags |= 0x2000
	}
	binary.BigEndian.PutUint16(packet[6:8], flags)
	packet[8] = 64
	packet[9] = 17
	copy(packet[12:16], net.IPv4(10, 0, 0, 1).To4())
	copy(packet[16:20], net.IPv4(5, 188, 125, 10).To4())
	copy(packet[20:], payload)
	return packet
}

func TestIPv4FragmentReassemblyOutOfOrder(t *testing.T) {
	application := []byte("photon-payload-for-fragments")
	udp := make([]byte, 8+len(application))
	binary.BigEndian.PutUint16(udp[0:2], 5055)
	binary.BigEndian.PutUint16(udp[2:4], 5056)
	binary.BigEndian.PutUint16(udp[4:6], uint16(len(udp)))
	copy(udp[8:], application)
	first, second := ipv4Fragment(55, 0, true, udp[:16]), ipv4Fragment(55, 16, false, udp[16:])
	reassembler := newIPv4Reassembler()
	if datagram, ok := parseCapturedFrame(second, linkTypeRaw, "test", reassembler); ok || len(datagram.Payload) != 0 {
		t.Fatal("last fragment must wait for the first")
	}
	datagram, ok := parseCapturedFrame(first, linkTypeRaw, "test", reassembler)
	if !ok {
		t.Fatal("complete fragmented UDP datagram was not emitted")
	}
	if string(datagram.Payload) != string(application) || datagram.SourcePort != 5055 || datagram.DestinationPort != 5056 {
		t.Fatalf("unexpected datagram: %+v", datagram)
	}
}

func TestParseVLANIPv4UDP(t *testing.T) {
	udp := make([]byte, 11)
	binary.BigEndian.PutUint16(udp[0:2], 5056)
	binary.BigEndian.PutUint16(udp[2:4], 5055)
	binary.BigEndian.PutUint16(udp[4:6], 11)
	copy(udp[8:], "alb")
	ip := ipv4Fragment(1, 0, false, udp)
	frame := make([]byte, 18+len(ip))
	binary.BigEndian.PutUint16(frame[12:14], 0x8100)
	binary.BigEndian.PutUint16(frame[16:18], 0x0800)
	copy(frame[18:], ip)
	datagram, ok := parseCapturedFrame(frame, linkTypeEthernet, "test", newIPv4Reassembler())
	if !ok || string(datagram.Payload) != "alb" {
		t.Fatalf("VLAN datagram = %+v, %v", datagram, ok)
	}
}

func TestParseRawIPv6UDP(t *testing.T) {
	udp := make([]byte, 12)
	binary.BigEndian.PutUint16(udp[0:2], 5058)
	binary.BigEndian.PutUint16(udp[2:4], 5055)
	binary.BigEndian.PutUint16(udp[4:6], 12)
	copy(udp[8:], "test")
	packet := make([]byte, 40+len(udp))
	packet[0] = 0x60
	binary.BigEndian.PutUint16(packet[4:6], uint16(len(udp)))
	packet[6] = 17
	packet[7] = 64
	copy(packet[8:24], net.ParseIP("2001:db8::1").To16())
	copy(packet[24:40], net.ParseIP("2001:db8::2").To16())
	copy(packet[40:], udp)
	datagram, ok := parseCapturedFrame(packet, linkTypeRaw, "test", newIPv4Reassembler())
	if !ok || string(datagram.Payload) != "test" {
		t.Fatalf("IPv6 datagram = %+v, %v", datagram, ok)
	}
}
