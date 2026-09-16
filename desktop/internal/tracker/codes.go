package tracker

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
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

	RawEvents map[string]json.RawMessage `json:"events"`
	RawOps    map[string]json.RawMessage `json:"operations"`
	RawParams map[string]json.RawMessage `json:"eventParameters"`
	SelfOp    struct {
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

// CodeEntry es una fila código->nombre para mostrar en la interfaz.
type CodeEntry struct {
	Code int32  `json:"code"`
	Name string `json:"name"`
}

// codeList vuelca un índice código->nombre ordenado por código, para que la
// interfaz siempre muestre la tabla en el mismo orden.
func codeList(m map[int32]string) []CodeEntry {
	out := make([]CodeEntry, 0, len(m))
	for code, name := range m {
		out = append(out, CodeEntry{Code: code, Name: name})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Code < out[j].Code })
	return out
}

// Events y Operations devuelven la tabla completa cargada desde
// photon_codes.json, no solo el conteo. Es lo que necesita el diagnóstico
// avanzado para mostrar qué códigos conoce el tracker, sin tener que esperar
// a que el juego los mande primero.
func (c *Codes) Events() []CodeEntry { return codeList(c.eventByCode) }

func (c *Codes) Operations() []CodeEntry { return codeList(c.opByCode) }

func safeCodeOrigin(origin string) string {
	if index := strings.LastIndexAny(origin, `/\\`); index >= 0 {
		return origin[index+1:]
	}
	return origin
}

// Info resume el estado de la tabla para mostrarlo en la interfaz.
func (c *Codes) Info() map[string]any {
	return map[string]any{
		"version":       c.Version,
		"gameVersion":   c.GameVersion,
		"events":        len(c.eventByCode),
		"operations":    len(c.opByCode),
		"loadedFrom":    safeCodeOrigin(c.loadedFrom),
		"loadedAt":      c.loadedAt.UnixMilli(),
		"eventList":     c.Events(),
		"operationList": c.Operations(),
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
		if *n < 0 || *n > 32767 {
			return fmt.Errorf("%s %q: el código %d está fuera del rango Photon int16 (0-32767)", kind, name, *n)
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
	return c.validateContract()
}

// validateContract prevents a syntactically valid but incompatible external
// table from becoming active. The identity/party contract is intentionally
// mandatory because every metrics consumer depends on it.
func (c *Codes) validateContract() error {
	if strings.TrimSpace(c.Version) == "" || strings.TrimSpace(c.GameVersion) == "" {
		return errors.New("faltan version o gameVersion")
	}
	readKey := func(name string) (byte, error) {
		raw, ok := c.ParamKeys[name]
		if !ok {
			return 0, fmt.Errorf("falta parameterKeys.%s", name)
		}
		var value int
		if err := json.Unmarshal(raw, &value); err != nil || value < 0 || value > 255 {
			return 0, fmt.Errorf("parameterKeys.%s debe ser un byte", name)
		}
		return byte(value), nil
	}
	eventKey, err := readKey("eventCode")
	if err != nil {
		return err
	}
	operationKey, err := readKey("operationCode")
	if err != nil {
		return err
	}
	returnKey, err := readKey("returnCode")
	if err != nil {
		return err
	}
	if eventKey != 252 || operationKey != 253 || returnKey != 254 {
		return fmt.Errorf("las claves de protocolo deben ser eventCode=252, operationCode=253 y returnCode=254")
	}

	requiredEvents := map[string][]string{
		"NewCharacter":       {"id", "name", "guid", "guild", "alliance"},
		"Leave":              {"id"},
		"JoinFinished":       {"zone"},
		"HealthUpdate":       {"target", "value", "source"},
		"HealthUpdates":      {"targets", "values", "sources"},
		"UpdateFame":         {"gained"},
		"UpdateReSpecPoints": {"gained"},
		"TakeSilver":         {"id", "amount"},
		"UpdateCurrency":     {"gained"},
		"PartySilverGained":  {"amount"},
		"OtherGrabbedLoot":   {"itemId", "quantity", "looter"},
		"PartyJoined":        {"guids", "names"},
		"PartyPlayerJoined":  {"guid", "name"},
		"PartyPlayerLeft":    {"guid"},
		"PartyDisbanded":     {},
	}
	for name, fields := range requiredEvents {
		found := false
		for _, indexedName := range c.eventByCode {
			if indexedName == name {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("falta el evento obligatorio %q", name)
		}
		for _, field := range fields {
			index, ok := c.eventParams[name][field]
			if !ok || index < 0 || index > 251 {
				return fmt.Errorf("falta un índice válido para %s.%s", name, field)
			}
		}
	}
	requiredOperations := map[string][]string{"Join": nil, "ChangeCluster": {"zone"}}
	for name, fields := range requiredOperations {
		found := false
		for _, indexedName := range c.opByCode {
			if indexedName == name {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("falta la operación obligatoria %q", name)
		}
		for _, field := range fields {
			index, ok := c.eventParams[name][field]
			if !ok || index < 0 || index > 251 {
				return fmt.Errorf("falta un índice válido para %s.%s", name, field)
			}
		}
	}
	if c.SelfOp.Operation != "Join" {
		return errors.New("selfOperation.operation debe ser Join")
	}
	for _, field := range []string{"id", "guid", "name", "zone", "guild", "alliance"} {
		index, ok := c.SelfOp.Parameters[field]
		if !ok || index < 0 || index > 251 {
			return fmt.Errorf("falta selfOperation.parameters.%s", field)
		}
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
	var trailing any
	if err := dec.Decode(&trailing); err != io.EOF {
		if err == nil {
			err = errors.New("hay más de un documento JSON")
		}
		return nil, fmt.Errorf("%s: contenido adicional inválido (%w)", origin, err)
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
		codes, err := parseCodes(raw, safeCodeOrigin(path))
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		s.set(codes, "")
		return codes, nil
	}

	if firstErr != nil {
		s.mu.Lock()
		if s.codes != nil {
			s.err = firstErr.Error() + " — se conserva la última tabla válida"
			s.mu.Unlock()
			return nil, firstErr
		}
		s.mu.Unlock()
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
