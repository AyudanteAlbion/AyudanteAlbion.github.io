package tracker

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Codes es la tabla de códigos del protocolo Photon, cargada desde
// `data/photon_codes.json`. Vive fuera del binario a propósito: los códigos
// cambian en casi cada patch de Albion, y así se arreglan editando un archivo
// de texto en vez de recompilar y redistribuir el ejecutable.
type Codes struct {
	Version     string                     `json:"version"`
	GameVersion string                     `json:"gameVersion"`
	ParamKeys   map[string]json.RawMessage `json:"parameterKeys"`

	RawEvents   map[string]json.RawMessage `json:"events"`
	RawOps      map[string]json.RawMessage `json:"operations"`
	RawParams   map[string]json.RawMessage `json:"eventParameters"`
	SelfOp      struct {
		Operation  string         `json:"operation"`
		Parameters map[string]int `json:"parameters"`
	} `json:"selfOperation"`

	// Índices armados al cargar. La clave es int32 y no byte porque Albion
	// manda el código real en el parámetro 252 (eventos) o 253 (operaciones)
	// como entero de 16 bits: hay códigos por encima de 255.
	eventByCode map[int32]string
	opByCode    map[int32]string
	eventParams map[string]map[string]int
	loadedFrom  string
	loadedAt    time.Time
}

// isComment identifica las claves de documentación del archivo. Empiezan con
// guión bajo y pueden contener cualquier cosa (texto o lista de líneas), así
// que se saltean antes de interpretar valores.
func isComment(key string) bool {
	return key == "" || key[0] == '_'
}

// EventName traduce un código numérico al nombre lógico. El segundo valor
// dice si el código está en la tabla.
func (c *Codes) EventName(code int32) (string, bool) {
	name, ok := c.eventByCode[code]
	return name, ok
}

// OperationName hace lo mismo para operaciones.
func (c *Codes) OperationName(code int32) (string, bool) {
	name, ok := c.opByCode[code]
	return name, ok
}

// Param devuelve el índice de un parámetro dentro de un evento.
func (c *Codes) Param(event, field string) (byte, bool) {
	fields, ok := c.eventParams[event]
	if !ok {
		return 0, false
	}
	idx, ok := fields[field]
	if !ok || idx < 0 || idx > 255 {
		return 0, false
	}
	return byte(idx), true
}

// EventCodeKey y OperationCodeKey devuelven los índices de parámetro donde
// Albion manda el código real. Por defecto 252 y 253, pero se pueden cambiar
// desde el archivo si alguna vez se mueven.
func (c *Codes) EventCodeKey() byte { return c.paramKey("eventCode", 252) }

func (c *Codes) OperationCodeKey() byte { return c.paramKey("operationCode", 253) }

func (c *Codes) paramKey(name string, def byte) byte {
	raw, ok := c.ParamKeys[name]
	if !ok {
		return def
	}
	var n int64
	if err := json.Unmarshal(raw, &n); err != nil || n < 0 || n > 255 {
		return def
	}
	return byte(n)
}

// Info resume el estado de la tabla para mostrarlo en la interfaz.
func (c *Codes) Info() map[string]any {
	return map[string]any{
		"version":     c.Version,
		"gameVersion": c.GameVersion,
		"events":      len(c.eventByCode),
		"operations":  len(c.opByCode),
		"loadedFrom":  c.loadedFrom,
		"loadedAt":    c.loadedAt.UnixMilli(),
	}
}

func (c *Codes) index() error {
	c.eventByCode = make(map[int32]string, len(c.RawEvents))
	c.opByCode = make(map[int32]string, len(c.RawOps))
	c.eventParams = make(map[string]map[string]int, len(c.RawParams))

	// Un código nulo desactiva la entrada sin borrarla del archivo: sirve para
	// aislar un evento que quedó mal después de un patch.
	readCode := func(kind, name string, raw json.RawMessage, dst map[int32]string) error {
		var n *int64
		if err := json.Unmarshal(raw, &n); err != nil {
			return fmt.Errorf("%s %q: se esperaba un número o null", kind, name)
		}
		if n == nil {
			return nil
		}
		if *n < 0 || *n > 65535 {
			return fmt.Errorf("%s %q: el código %d está fuera de rango (0-65535)", kind, name, *n)
		}
		if prev, dup := dst[int32(*n)]; dup {
			return fmt.Errorf("%s %q: el código %d ya lo usa %q", kind, name, *n, prev)
		}
		dst[int32(*n)] = name
		return nil
	}

	for name, raw := range c.RawEvents {
		if isComment(name) {
			continue
		}
		if err := readCode("evento", name, raw, c.eventByCode); err != nil {
			return err
		}
	}
	for name, raw := range c.RawOps {
		if isComment(name) {
			continue
		}
		if err := readCode("operación", name, raw, c.opByCode); err != nil {
			return err
		}
	}
	for name, raw := range c.RawParams {
		if isComment(name) {
			continue
		}
		var fields map[string]int
		if err := json.Unmarshal(raw, &fields); err != nil {
			return fmt.Errorf("parámetros de %q: se esperaba un objeto de nombre a índice", name)
		}
		c.eventParams[name] = fields
	}

	if len(c.eventByCode) == 0 {
		return errors.New("la tabla no define ningún evento")
	}
	return nil
}

// CodeStore mantiene la tabla vigente y permite recargarla en caliente.
type CodeStore struct {
	mu       sync.RWMutex
	codes    *Codes
	embedded fs.FS
	// Rutas donde se busca la tabla, en orden de prioridad. La primera es
	// junto al .exe, para que el usuario pueda corregirla sin tocar nada más.
	paths []string
	err   string
}

// NewCodeStore arma el almacén. `embedded` es el sistema de archivos que trae
// el ejecutable adentro (la copia de fábrica); `external` son rutas del disco
// que tienen prioridad sobre ella.
func NewCodeStore(embedded fs.FS, external ...string) *CodeStore {
	return &CodeStore{embedded: embedded, paths: external}
}

// DefaultPaths arma las rutas externas habituales: junto al ejecutable y en
// la carpeta de datos del usuario.
func DefaultPaths() []string {
	var out []string
	if exe, err := os.Executable(); err == nil {
		out = append(out, filepath.Join(filepath.Dir(exe), "photon_codes.json"))
	}
	if dir, err := os.UserConfigDir(); err == nil {
		out = append(out, filepath.Join(dir, "AyudanteAlbion", "photon_codes.json"))
	}
	return out
}

func parseCodes(raw []byte, origin string) (*Codes, error) {
	var c Codes
	dec := json.NewDecoder(bytes.NewReader(raw))
	if err := dec.Decode(&c); err != nil {
		return nil, fmt.Errorf("%s: JSON inválido (%w)", origin, err)
	}
	if err := c.index(); err != nil {
		return nil, fmt.Errorf("%s: %w", origin, err)
	}
	c.loadedFrom = origin
	c.loadedAt = time.Now()
	return &c, nil
}

// Load busca la tabla en las rutas externas y, si no hay ninguna válida, cae
// a la copia embebida. Una tabla externa rota nunca deja al tracker sin tabla:
// se informa el error y se sigue con la de fábrica.
func (s *CodeStore) Load() (*Codes, error) {
	var firstErr error

	for _, path := range s.paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			continue // no existe: es lo normal
		}
		codes, err := parseCodes(raw, path)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		s.set(codes, "")
		return codes, nil
	}

	raw, err := fs.ReadFile(s.embedded, "data/photon_codes.json")
	if err != nil {
		if firstErr != nil {
			return nil, firstErr
		}
		return nil, fmt.Errorf("no se encontró la tabla de códigos: %w", err)
	}
	codes, err := parseCodes(raw, "tabla incluida en el ejecutable")
	if err != nil {
		return nil, err
	}

	warn := ""
	if firstErr != nil {
		warn = firstErr.Error() + " — se usa la tabla incluida en el ejecutable"
	}
	s.set(codes, warn)
	return codes, nil
}

func (s *CodeStore) set(c *Codes, warn string) {
	s.mu.Lock()
	s.codes = c
	s.err = warn
	s.mu.Unlock()
}

// Current devuelve la tabla vigente y la advertencia activa, si hay.
func (s *CodeStore) Current() (*Codes, string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.codes, s.err
}

// Nota sobre las claves "_comment" del JSON: son claves normales del objeto y
// encoding/json las ignora al no existir en la estructura. Documentan el
// archivo para quien lo edite a mano, que es justamente el caso de uso.
