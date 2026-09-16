package photon

import (
	"encoding/binary"
	"errors"
	"math"
	"reflect"
)

// Protocol18 is the compact Photon wire format used by current Albion game
// sessions. It is deliberately kept alongside Protocol16: old captures use
// the latter, while live Join responses use Protocol18.
//
// The values below are wire type identifiers, not Albion event or operation
// codes. Protocol18 uses little-endian scalar values and varints for lengths;
// Photon/eNet packet and command headers remain big-endian.
const (
	p18Boolean          = 2
	p18Byte             = 3
	p18Short            = 4
	p18Float            = 5
	p18Double           = 6
	p18String           = 7
	p18Null             = 8
	p18CompressedInt    = 9
	p18CompressedLong   = 10
	p18Int1             = 11
	p18Int1Negative     = 12
	p18Int2             = 13
	p18Int2Negative     = 14
	p18Long1            = 15
	p18Long1Negative    = 16
	p18Long2            = 17
	p18Long2Negative    = 18
	p18Custom           = 19
	p18Dictionary       = 20
	p18Hashtable        = 21
	p18ObjectArray      = 23
	p18OperationRequest = 24
	p18OperationReply   = 25
	p18EventData        = 26
	p18False            = 27
	p18True             = 28
	p18ShortZero        = 29
	p18IntZero          = 30
	p18LongZero         = 31
	p18FloatZero        = 32
	p18DoubleZero       = 33
	p18ByteZero         = 34
	p18Array            = 64
	p18BooleanArray     = 66
	p18ByteArray        = 67
	p18ShortArray       = 68
	p18FloatArray       = 69
	p18DoubleArray      = 70
	p18StringArray      = 71
	p18CompressedInts   = 73
	p18CompressedLongs  = 74
	p18CustomArray      = 83
	p18DictionaryArray  = 84
	p18HashtableArray   = 85
	p18SlimCustomFirst  = 128
	p18SlimCustomLast   = 228

	maxP18Depth      = 12
	maxP18Collection = 64 * 1024
)

var errProtocol18 = errors.New("photon: Protocol18 inválido")

// CustomValue preserves an application-specific Protocol18 value without
// interpreting it. The tracker consumes the raw bytes only for the 16-byte
// user GUIDs that identify the local player and party roster.
type CustomValue struct {
	Code byte
	Data []byte
}

// p18Uint32 reads Photon Protocol18's unsigned, little-endian-base-128
// integer encoding. Rejecting overflow and unterminated values is important:
// all following allocation lengths use this reader.
func (r *reader) p18Uint32() (uint32, error) {
	var value uint32
	for shift := uint(0); shift < 35; shift += 7 {
		b, err := r.byte()
		if err != nil {
			return 0, err
		}
		if shift == 28 && b&0xf0 != 0 {
			return 0, errProtocol18
		}
		value |= uint32(b&0x7f) << shift
		if b&0x80 == 0 {
			return value, nil
		}
	}
	return 0, errProtocol18
}

func (r *reader) p18Uint64() (uint64, error) {
	var value uint64
	for shift := uint(0); shift < 70; shift += 7 {
		b, err := r.byte()
		if err != nil {
			return 0, err
		}
		if shift == 63 && b&0xfe != 0 {
			return 0, errProtocol18
		}
		value |= uint64(b&0x7f) << shift
		if b&0x80 == 0 {
			return value, nil
		}
	}
	return 0, errProtocol18
}

func (r *reader) p18Length() (int, error) {
	n, err := r.p18Uint32()
	if err != nil {
		return 0, err
	}
	if n > maxP18Collection || uint64(n) > uint64(r.left()) {
		return 0, errProtocol18
	}
	return int(n), nil
}

func (r *reader) p18Short() (int16, error) {
	b, err := r.bytes(2)
	if err != nil {
		return 0, err
	}
	return int16(binary.LittleEndian.Uint16(b)), nil
}

func (r *reader) p18Float32() (float32, error) {
	b, err := r.bytes(4)
	if err != nil {
		return 0, err
	}
	return math.Float32frombits(binary.LittleEndian.Uint32(b)), nil
}

func (r *reader) p18Float64() (float64, error) {
	b, err := r.bytes(8)
	if err != nil {
		return 0, err
	}
	return math.Float64frombits(binary.LittleEndian.Uint64(b)), nil
}

func (r *reader) p18String() (string, error) {
	n, err := r.p18Length()
	if err != nil {
		return "", err
	}
	b, err := r.bytes(n)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func (r *reader) p18Bytes() ([]byte, error) {
	n, err := r.p18Length()
	if err != nil {
		return nil, err
	}
	return r.bytes(n)
}

func (r *reader) p18CollectionLength() (int, error) {
	n, err := r.p18Uint32()
	if err != nil {
		return 0, err
	}
	if n > maxP18Collection {
		return 0, errProtocol18
	}
	return int(n), nil
}

func (r *reader) p18Value(kind byte, depth int) (any, error) {
	if depth > maxP18Depth {
		return nil, errProtocol18
	}
	if kind >= p18SlimCustomFirst && kind <= p18SlimCustomLast {
		return r.p18Custom(kind - p18SlimCustomFirst)
	}

	switch kind {
	case 0, p18Null:
		return nil, nil
	case p18Boolean:
		b, err := r.byte()
		return b != 0, err
	case p18Byte:
		return r.byte()
	case p18Short:
		return r.p18Short()
	case p18Float:
		return r.p18Float32()
	case p18Double:
		return r.p18Float64()
	case p18String:
		return r.p18String()
	case p18CompressedInt:
		v, err := r.p18Uint32()
		return int32((v >> 1) ^ uint32(-int32(v&1))), err
	case p18CompressedLong:
		v, err := r.p18Uint64()
		return int64((v >> 1) ^ uint64(-int64(v&1))), err
	case p18Int1:
		v, err := r.byte()
		return int32(v), err
	case p18Int1Negative:
		v, err := r.byte()
		return -int32(v), err
	case p18Int2:
		v, err := r.p18Short()
		return int32(uint16(v)), err
	case p18Int2Negative:
		v, err := r.p18Short()
		return -int32(uint16(v)), err
	case p18Long1:
		v, err := r.byte()
		return int64(v), err
	case p18Long1Negative:
		v, err := r.byte()
		return -int64(v), err
	case p18Long2:
		v, err := r.p18Short()
		return int64(uint16(v)), err
	case p18Long2Negative:
		v, err := r.p18Short()
		return -int64(uint16(v)), err
	case p18Custom:
		code, err := r.byte()
		if err != nil {
			return nil, err
		}
		return r.p18Custom(code)
	case p18Dictionary:
		return r.p18Dictionary(depth + 1)
	case p18Hashtable:
		return r.p18Hashtable(depth + 1)
	case p18ObjectArray, p18Array:
		return r.p18ObjectArray(depth + 1)
	case p18OperationRequest:
		return r.p18OperationRequest(depth + 1)
	case p18OperationReply:
		return r.p18OperationResponse(depth + 1)
	case p18EventData:
		return r.p18EventData(depth + 1)
	case p18False:
		return false, nil
	case p18True:
		return true, nil
	case p18ShortZero:
		return int16(0), nil
	case p18IntZero:
		return int32(0), nil
	case p18LongZero:
		return int64(0), nil
	case p18FloatZero:
		return float32(0), nil
	case p18DoubleZero:
		return float64(0), nil
	case p18ByteZero:
		return byte(0), nil
	case p18BooleanArray:
		return r.p18BooleanArray()
	case p18ByteArray:
		return r.p18Bytes()
	case p18ShortArray:
		return r.p18ShortArray()
	case p18FloatArray:
		return r.p18FloatArray()
	case p18DoubleArray:
		return r.p18DoubleArray()
	case p18StringArray:
		return r.p18StringArray()
	case p18CompressedInts:
		return r.p18CompressedInts()
	case p18CompressedLongs:
		return r.p18CompressedLongs()
	case p18CustomArray:
		return r.p18CustomArray()
	case p18DictionaryArray:
		return r.p18DictionaryArray(depth + 1)
	case p18HashtableArray:
		return r.p18HashtableArray(depth + 1)
	default:
		return nil, errProtocol18
	}
}

func (r *reader) p18Custom(code byte) (CustomValue, error) {
	data, err := r.p18Bytes()
	if err != nil {
		return CustomValue{}, err
	}
	return CustomValue{Code: code, Data: data}, nil
}

func (r *reader) p18BooleanArray() ([]bool, error) {
	n, err := r.p18CollectionLength()
	if err != nil {
		return nil, err
	}
	byteCount := (n + 7) / 8
	data, err := r.bytes(byteCount)
	if err != nil {
		return nil, err
	}
	out := make([]bool, n)
	for i := range out {
		out[i] = data[i/8]&(1<<uint(i%8)) != 0
	}
	return out, nil
}

func (r *reader) p18ShortArray() ([]int16, error) {
	n, err := r.p18CollectionLength()
	if err != nil || n > r.left()/2 {
		return nil, protocol18Error(err)
	}
	out := make([]int16, n)
	for i := range out {
		if out[i], err = r.p18Short(); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (r *reader) p18FloatArray() ([]float32, error) {
	n, err := r.p18CollectionLength()
	if err != nil || n > r.left()/4 {
		return nil, protocol18Error(err)
	}
	out := make([]float32, n)
	for i := range out {
		if out[i], err = r.p18Float32(); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (r *reader) p18DoubleArray() ([]float64, error) {
	n, err := r.p18CollectionLength()
	if err != nil || n > r.left()/8 {
		return nil, protocol18Error(err)
	}
	out := make([]float64, n)
	for i := range out {
		if out[i], err = r.p18Float64(); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (r *reader) p18StringArray() ([]string, error) {
	n, err := r.p18CollectionLength()
	if err != nil || n > r.left() {
		return nil, protocol18Error(err)
	}
	out := make([]string, n)
	for i := range out {
		if out[i], err = r.p18String(); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (r *reader) p18CompressedInts() ([]int32, error) {
	n, err := r.p18CollectionLength()
	if err != nil || n > r.left() {
		return nil, protocol18Error(err)
	}
	out := make([]int32, n)
	for i := range out {
		v, readErr := r.p18Uint32()
		if readErr != nil {
			return nil, readErr
		}
		out[i] = int32((v >> 1) ^ uint32(-int32(v&1)))
	}
	return out, nil
}

func (r *reader) p18CompressedLongs() ([]int64, error) {
	n, err := r.p18CollectionLength()
	if err != nil || n > r.left() {
		return nil, protocol18Error(err)
	}
	out := make([]int64, n)
	for i := range out {
		v, readErr := r.p18Uint64()
		if readErr != nil {
			return nil, readErr
		}
		out[i] = int64((v >> 1) ^ uint64(-int64(v&1)))
	}
	return out, nil
}

func (r *reader) p18ObjectArray(depth int) ([]any, error) {
	n, err := r.p18CollectionLength()
	if err != nil || n > r.left() {
		return nil, protocol18Error(err)
	}
	out := make([]any, n)
	for i := range out {
		kind, readErr := r.byte()
		if readErr != nil {
			return nil, readErr
		}
		if out[i], readErr = r.p18Value(kind, depth+1); readErr != nil {
			return nil, readErr
		}
	}
	return out, nil
}

func (r *reader) p18CustomArray() ([]CustomValue, error) {
	n, err := r.p18CollectionLength()
	if err != nil || n > r.left() {
		return nil, protocol18Error(err)
	}
	code, err := r.byte()
	if err != nil {
		return nil, err
	}
	out := make([]CustomValue, n)
	for i := range out {
		if out[i], err = r.p18Custom(code); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (r *reader) p18Hashtable(depth int) (map[any]any, error) {
	n, err := r.p18CollectionLength()
	if err != nil || n > r.left()/2 {
		return nil, protocol18Error(err)
	}
	out := make(map[any]any, n)
	for i := 0; i < n; i++ {
		keyType, readErr := r.byte()
		if readErr != nil {
			return nil, readErr
		}
		key, readErr := r.p18Value(keyType, depth+1)
		if readErr != nil {
			return nil, readErr
		}
		valueType, readErr := r.byte()
		if readErr != nil {
			return nil, readErr
		}
		value, readErr := r.p18Value(valueType, depth+1)
		if readErr != nil {
			return nil, readErr
		}
		p18MapPut(out, key, value)
	}
	return out, nil
}

func (r *reader) p18Dictionary(depth int) (map[any]any, error) {
	keyType, valueType, err := r.p18DictionaryTypes()
	if err != nil {
		return nil, err
	}
	return r.p18DictionaryEntries(keyType, valueType, depth)
}

func (r *reader) p18DictionaryTypes() (byte, byte, error) {
	keyType, err := r.byte()
	if err != nil {
		return 0, 0, err
	}
	valueType, err := r.byte()
	if err != nil {
		return 0, 0, err
	}
	return keyType, valueType, nil
}

func (r *reader) p18DictionaryEntries(keyType, valueType byte, depth int) (map[any]any, error) {
	n, err := r.p18CollectionLength()
	if err != nil {
		return nil, err
	}
	out := make(map[any]any, n)
	for i := 0; i < n; i++ {
		keyKind := keyType
		if keyKind == 0 {
			if keyKind, err = r.byte(); err != nil {
				return nil, err
			}
		}
		key, readErr := r.p18Value(keyKind, depth+1)
		if readErr != nil {
			return nil, readErr
		}
		valueKind := valueType
		if valueKind == 0 {
			if valueKind, err = r.byte(); err != nil {
				return nil, err
			}
		}
		value, readErr := r.p18Value(valueKind, depth+1)
		if readErr != nil {
			return nil, readErr
		}
		p18MapPut(out, key, value)
	}
	return out, nil
}

func (r *reader) p18DictionaryArray(depth int) ([]map[any]any, error) {
	keyType, valueType, err := r.p18DictionaryTypes()
	if err != nil {
		return nil, err
	}
	n, err := r.p18CollectionLength()
	if err != nil || n > r.left() {
		return nil, protocol18Error(err)
	}
	out := make([]map[any]any, n)
	for i := range out {
		if out[i], err = r.p18DictionaryEntries(keyType, valueType, depth+1); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (r *reader) p18HashtableArray(depth int) ([]map[any]any, error) {
	n, err := r.p18CollectionLength()
	if err != nil || n > r.left() {
		return nil, protocol18Error(err)
	}
	out := make([]map[any]any, n)
	for i := range out {
		if out[i], err = r.p18Hashtable(depth+1); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func p18MapPut(target map[any]any, key, value any) {
	if key == nil {
		return
	}
	if kind := reflect.TypeOf(key); kind != nil && kind.Comparable() {
		target[key] = value
	}
}

func (r *reader) p18Params(depth int) (map[byte]any, error) {
	n, err := r.byte()
	if err != nil {
		return nil, err
	}
	out := make(map[byte]any, int(n))
	for i := 0; i < int(n); i++ {
		key, readErr := r.byte()
		if readErr != nil {
			return nil, readErr
		}
		kind, readErr := r.byte()
		if readErr != nil {
			return nil, readErr
		}
		value, readErr := r.p18Value(kind, depth+1)
		if readErr != nil {
			return nil, readErr
		}
		out[key] = value
	}
	return out, nil
}

func (r *reader) p18EventData(depth int) (*EventData, error) {
	code, err := r.byte()
	if err != nil {
		return nil, err
	}
	params, err := r.p18Params(depth + 1)
	if err != nil {
		return nil, err
	}
	return &EventData{Code: code, Parameters: params}, nil
}

func (r *reader) p18OperationRequest(depth int) (*OperationRequest, error) {
	code, err := r.byte()
	if err != nil {
		return nil, err
	}
	params, err := r.p18Params(depth + 1)
	if err != nil {
		return nil, err
	}
	return &OperationRequest{Code: code, Parameters: params}, nil
}

func (r *reader) p18OperationResponse(depth int) (*OperationResponse, error) {
	code, err := r.byte()
	if err != nil {
		return nil, err
	}
	returnCode, err := r.p18Short()
	if err != nil {
		return nil, err
	}
	debugType, err := r.byte()
	if err != nil {
		return nil, err
	}
	debugValue, err := r.p18Value(debugType, depth+1)
	if err != nil {
		return nil, err
	}
	params, err := r.p18Params(depth + 1)
	if err != nil {
		return nil, err
	}
	debug, _ := debugValue.(string)
	return &OperationResponse{Code: code, ReturnCode: returnCode, Debug: debug, Parameters: params}, nil
}

func protocol18Error(err error) error {
	if err != nil {
		return err
	}
	return errProtocol18
}
