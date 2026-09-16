package photon

import (
	"encoding/binary"
	"testing"
)

func transportPacket(command byte, channel byte, sequence uint32, body []byte, crc bool) []byte {
	headerLengthForPacket := headerLength
	flags := byte(0)
	if crc {
		headerLengthForPacket += crcLength
		flags = 0xcc
	}
	packet := make([]byte, headerLengthForPacket+commandHeaderLength+len(body))
	binary.BigEndian.PutUint16(packet[0:2], 0xf100)
	packet[2] = flags
	packet[3] = 1
	binary.BigEndian.PutUint32(packet[4:8], 1000)
	binary.BigEndian.PutUint32(packet[8:12], 123456)
	offset := headerLengthForPacket
	packet[offset] = command
	packet[offset+1] = channel
	binary.BigEndian.PutUint32(packet[offset+4:offset+8], uint32(commandHeaderLength+len(body)))
	binary.BigEndian.PutUint32(packet[offset+8:offset+12], sequence)
	copy(packet[offset+12:], body)
	if crc {
		binary.BigEndian.PutUint32(packet[headerLength:headerLength+crcLength], photonCRC(packet, headerLength, crcLength))
	}
	return packet
}

func TestReliableUnreliableAndCRCPackets(t *testing.T) {
	message := buildReliableMessage(msgOperationResponse, buildOperationResponseBody(2, 0))
	cases := []struct {
		name    string
		command byte
		body    []byte
		crc     bool
	}{
		{name: "reliable", command: cmdSendReliable, body: message},
		{name: "unreliable", command: cmdSendUnreliable, body: append([]byte{0, 0, 0, 7}, message...)},
		{name: "crc", command: cmdSendReliable, body: message, crc: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			parser := NewParser(Handler{OnResponse: func(*OperationResponse) { calls++ }})
			if !parser.Receive(transportPacket(tc.command, 0, 1, tc.body, tc.crc)) || calls != 1 {
				t.Fatalf("calls = %d, want 1", calls)
			}
		})
	}
}

func TestBadCRCIsRejected(t *testing.T) {
	message := buildReliableMessage(msgOperationResponse, buildOperationResponseBody(2, 0))
	packet := transportPacket(cmdSendReliable, 0, 1, message, true)
	packet[headerLength] ^= 0xff
	if NewParser(Handler{}).Receive(packet) {
		t.Fatal("packet with invalid CRC was accepted")
	}
}

func TestPhotonFragmentsReassembleOutOfOrder(t *testing.T) {
	message := buildReliableMessage(msgOperationResponse, buildOperationResponseBody(2, 0))
	split := len(message) / 2
	chunks := [][]byte{message[:split], message[split:]}
	offsets := []int{0, split}
	calls := 0
	parser := NewParser(Handler{OnResponse: func(*OperationResponse) { calls++ }})
	for _, index := range []int{1, 0} {
		body := make([]byte, fragmentHeaderLength+len(chunks[index]))
		binary.BigEndian.PutUint32(body[0:4], 100)
		binary.BigEndian.PutUint32(body[4:8], 2)
		binary.BigEndian.PutUint32(body[8:12], uint32(index))
		binary.BigEndian.PutUint32(body[12:16], uint32(len(message)))
		binary.BigEndian.PutUint32(body[16:20], uint32(offsets[index]))
		copy(body[20:], chunks[index])
		if !parser.Receive(transportPacket(cmdSendFragment, 1, uint32(index+1), body, false)) {
			t.Fatalf("fragment %d rejected", index)
		}
	}
	if calls != 1 {
		t.Fatalf("fragment callbacks = %d, want 1", calls)
	}
}
