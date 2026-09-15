// Package photon decodifica el protocolo de red Photon que usa Albion Online.
//
// Implementación propia y sin dependencias externas: el ejecutable se compila
// con la toolchain fija de build.sh y sin acceso a proxy.golang.org, así que
// todo lo que necesita viaja en este repositorio.
package photon

import (
	"encoding/binary"
	"errors"
	"math"
)

// Tipos de Protocol16 (los valores son los caracteres ASCII que usa Photon).
const (
	typeUnknown           = 0
	typeNull              = 42  // '*'
	typeDictionary        = 68  // 'D'
	typeStringArray       = 97  // 'a'
	typeByte              = 98  // 'b'
	typeDouble            = 100 // 'd'
	typeEventData         = 101 // 'e'
	typeFloat             = 102 // 'f'
	typeHashtable         = 104 // 'h'
	typeInteger           = 105 // 'i'
	typeShort             = 107 // 'k'
	typeLong              = 108 // 'l'
	typeIntegerArray      = 110 // 'n'
	typeBoolean           = 111 // 'o'
	typeOperationResponse = 112 // 'p'
	typeOperationRequest  = 113 // 'q'
	typeString            = 115 // 's'
	typeByteArray         = 120 // 'x'
	typeArray             = 121 // 'y'
	typeObjectArray       = 122 // 'z'
)

// ErrShort indica que el búfer se terminó antes de lo que declaraba el dato.
// No es excepcional: los paquetes se cortan, se pierden y llegan desordenados.
var ErrShort = errors.New("photon: datos insuficientes")

// reader recorre un búfer en big-endian, que es como serializa Photon.
type reader struct {
	buf []byte
	pos int
}

func (r *reader) left() int { return len(r.buf) - r.pos }

func (r *reader) byte() (byte, error) {
	if r.left() < 1 {
		return 0, ErrShort
	}
	v := r.buf[r.pos]
	r.pos++
	return v, nil
}

func (r *reader) bytes(n int) ([]byte, error) {
	if n < 0 || r.left() < n {
		return nil, ErrShort
	}
	v := r.buf[r.pos : r.pos+n]
	r.pos += n
	return v, nil
}

func (r *reader) int16() (int16, error) {
	b, err := r.bytes(2)
	if err != nil {
		return 0, err
	}
	return int16(binary.BigEndian.Uint16(b)), nil
}

func (r *reader) int32() (int32, error) {
	b, err := r.bytes(4)
	if err != nil {
		return 0, err
	}
	return int32(binary.BigEndian.Uint32(b)), nil
}

func (r *reader) int64() (int64, error) {
	b, err := r.bytes(8)
	if err != nil {
		return 0, err
	}
	return int64(binary.BigEndian.Uint64(b)), nil
}

func (r *reader) float32() (float32, error) {
	b, err := r.bytes(4)
	if err != nil {
		return 0, err
	}
	return math.Float32frombits(binary.BigEndian.Uint32(b)), nil
}

func (r *reader) float64() (float64, error) {
	b, err := r.bytes(8)
	if err != nil {
		return 0, err
	}
	return math.Float64frombits(binary.BigEndian.Uint64(b)), nil
}

func (r *reader) string() (string, error) {
	n, err := r.int16()
	if err != nil {
		return "", err
	}
	b, err := r.bytes(int(n))
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// value deserializa un valor con el tipo indicado.
// La profundidad acota estructuras anidadas: un paquete corrupto no puede
// hacer que el parser se hunda en recursión.
func (r *reader) value(kind byte, depth int) (any, error) {
	if depth > 8 {
		return nil, errors.New("photon: anidamiento excesivo")
	}
	switch kind {
	case typeNull, typeUnknown:
		return nil, nil
	case typeBoolean:
		b, err := r.byte()
		return b != 0, err
	case typeByte:
		return r.byte()
	case typeShort:
		return r.int16()
	case typeInteger:
		return r.int32()
	case typeLong:
		return r.int64()
	case typeFloat:
		return r.float32()
	case typeDouble:
		return r.float64()
	case typeString:
		return r.string()
	case typeByteArray:
		n, err := r.int32()
		if err != nil {
			return nil, err
		}
		return r.bytes(int(n))
	case typeIntegerArray:
		n, err := r.int32()
		if err != nil {
			return nil, err
		}
		if n < 0 {
			return nil, ErrShort
		}
		out := make([]int32, 0, min(int(n), 4096))
		for i := int32(0); i < n; i++ {
			v, err := r.int32()
			if err != nil {
				return nil, err
			}
			out = append(out, v)
		}
		return out, nil
	case typeStringArray:
		n, err := r.int16()
		if err != nil {
			return nil, err
		}
		if n < 0 {
			return nil, ErrShort
		}
		out := make([]string, 0, min(int(n), 4096))
		for i := int16(0); i < n; i++ {
			v, err := r.string()
			if err != nil {
				return nil, err
			}
			out = append(out, v)
		}
		return out, nil
	case typeArray:
		// Arreglo homogéneo: primero la cantidad, después el tipo.
		n, err := r.int16()
		if err != nil {
			return nil, err
		}
		sub, err := r.byte()
		if err != nil {
			return nil, err
		}
		if n < 0 {
			return nil, ErrShort
		}
		out := make([]any, 0, min(int(n), 4096))
		for i := int16(0); i < n; i++ {
			v, err := r.value(sub, depth+1)
			if err != nil {
				return nil, err
			}
			out = append(out, v)
		}
		return out, nil
	case typeObjectArray:
		// Arreglo heterogéneo: cada elemento trae su propio tipo.
		n, err := r.int16()
		if err != nil {
			return nil, err
		}
		if n < 0 {
			return nil, ErrShort
		}
		out := make([]any, 0, min(int(n), 4096))
		for i := int16(0); i < n; i++ {
			sub, err := r.byte()
			if err != nil {
				return nil, err
			}
			v, err := r.value(sub, depth+1)
			if err != nil {
				return nil, err
			}
			out = append(out, v)
		}
		return out, nil
	case typeHashtable:
		n, err := r.int16()
		if err != nil {
			return nil, err
		}
		out := make(map[any]any, min(int(n), 1024))
		for i := int16(0); i < n; i++ {
			kt, err := r.byte()
			if err != nil {
				return nil, err
			}
			k, err := r.value(kt, depth+1)
			if err != nil {
				return nil, err
			}
			vt, err := r.byte()
			if err != nil {
				return nil, err
			}
			v, err := r.value(vt, depth+1)
			if err != nil {
				return nil, err
			}
			out[k] = v
		}
		return out, nil
	case typeDictionary:
		return r.dictionary(depth)
	case typeEventData:
		ev, err := r.eventData(depth)
		if err != nil {
			return nil, err
		}
		return ev, nil
	case typeOperationRequest:
		op, err := r.operationRequest(depth)
		if err != nil {
			return nil, err
		}
		return op, nil
	case typeOperationResponse:
		op, err := r.operationResponse(depth)
		if err != nil {
			return nil, err
		}
		return op, nil
	default:
		// Tipo desconocido: no se puede saber cuánto ocupa, así que se corta
		// este mensaje en vez de leer basura desalineada.
		return nil, errors.New("photon: tipo desconocido")
	}
}

func (r *reader) dictionary(depth int) (map[any]any, error) {
	keyType, err := r.byte()
	if err != nil {
		return nil, err
	}
	valType, err := r.byte()
	if err != nil {
		return nil, err
	}
	n, err := r.int16()
	if err != nil {
		return nil, err
	}
	out := make(map[any]any, min(int(n), 1024))
	for i := int16(0); i < n; i++ {
		kt := keyType
		if kt == typeUnknown {
			if kt, err = r.byte(); err != nil {
				return nil, err
			}
		}
		k, err := r.value(kt, depth+1)
		if err != nil {
			return nil, err
		}
		vt := valType
		if vt == typeUnknown {
			if vt, err = r.byte(); err != nil {
				return nil, err
			}
		}
		v, err := r.value(vt, depth+1)
		if err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, nil
}

// params lee el diccionario de parámetros que acompaña a cada mensaje.
func (r *reader) params(depth int) (map[byte]any, error) {
	n, err := r.int16()
	if err != nil {
		return nil, err
	}
	if n < 0 {
		return nil, ErrShort
	}
	out := make(map[byte]any, min(int(n), 256))
	for i := int16(0); i < n; i++ {
		key, err := r.byte()
		if err != nil {
			return nil, err
		}
		kind, err := r.byte()
		if err != nil {
			return nil, err
		}
		v, err := r.value(kind, depth+1)
		if err != nil {
			return nil, err
		}
		out[key] = v
	}
	return out, nil
}

// EventData es un evento del servidor hacia el cliente.
type EventData struct {
	Code       byte
	Parameters map[byte]any
}

// OperationRequest es un pedido del cliente hacia el servidor.
type OperationRequest struct {
	Code       byte
	Parameters map[byte]any
}

// OperationResponse es la respuesta del servidor a un pedido.
type OperationResponse struct {
	Code       byte
	ReturnCode int16
	Debug      string
	Parameters map[byte]any
}

func (r *reader) eventData(depth int) (*EventData, error) {
	code, err := r.byte()
	if err != nil {
		return nil, err
	}
	params, err := r.params(depth)
	if err != nil {
		return nil, err
	}
	return &EventData{Code: code, Parameters: params}, nil
}

func (r *reader) operationRequest(depth int) (*OperationRequest, error) {
	code, err := r.byte()
	if err != nil {
		return nil, err
	}
	params, err := r.params(depth)
	if err != nil {
		return nil, err
	}
	return &OperationRequest{Code: code, Parameters: params}, nil
}

func (r *reader) operationResponse(depth int) (*OperationResponse, error) {
	code, err := r.byte()
	if err != nil {
		return nil, err
	}
	ret, err := r.int16()
	if err != nil {
		return nil, err
	}
	kind, err := r.byte()
	if err != nil {
		return nil, err
	}
	var debug string
	if kind == typeString {
		if debug, err = r.string(); err != nil {
			return nil, err
		}
	} else if kind != typeNull {
		if _, err = r.value(kind, depth+1); err != nil {
			return nil, err
		}
	}
	params, err := r.params(depth)
	if err != nil {
		return nil, err
	}
	return &OperationResponse{Code: code, ReturnCode: ret, Debug: debug, Parameters: params}, nil
}
